// src/units/P104/LEDGER.unit.test.ts
// P104 under the Closure Ledger: the tests for the LOCAL criteria RF1–RF7 of the work order
// (docs/parity/learning-truth/program.json, programme tapestry-parity-learning-truth, ticket P104 "The learning report's
// fold, with a fixed memory bound per step"). LV1 is a deferred live row and gets no test.
//
// THE AUTHORITY — amendment 13, E29 (docs/parity/authority/amendment-13/BTI-Parity-Amendment-2026-10-28-hardening.md),
// verbatim:
//   "**Authority:** the same verification (§1 Engine 20, R-P557) and the fold's root-cause design
//   (`S49/analyst-report-fold/DESIGN.md`, R-P561): the hourly fold works in one request holding the hour's raw rows
//   twice, all 64 shards' 48-hour rings and a copy of every new shard body, under 16 MiB limits, so an hour is refused
//   above about 8,900 decisions, the next hour once the rings pass 3.69 MiB (the day then "incomplete"), and an hour at
//   40 visitors with a realistic spread of context (`cells`); lifting every limit would need about 6.9 GB in one
//   request at 10,000 visitors a day against a 128 MB isolate. Fixed at its cause under the owner's direction (R-P545);
//   the W24 rebuild's ring and the day's answer past 8 MiB ruled by the lead (R-P561).
//   **Done when:** the hourly fold and the day report work in fixed-size steps (a plan, partition pages, leaves of
//   visitors that split as they grow, a merge tree, a close), every step holding at most 64 MiB whatever the traffic,
//   measured in the harness at 10,000, 100,000 and 1,000,000 visitors a day; on the same records the result equals
//   today's fold; an hour is committed by two conditional writes, so no hour is lost or counted twice and a failed run
//   resumes; the day report is summed one hour at a time and stored by slot, a day whose grids pass 8 MiB answering 200
//   by slot, never 413; the W24 rebuild folds with the 200-entry ring and the previous day's carry-in, as the hourly
//   fold and live learning do; kit 02 states the envelope."
//
// THE READINGS (where the work order is silent; each one rules a single representation for every criterion):
//   1 The real path. Every leg drives the REAL Worker default export (src/index.ts): its five-minute run (`scheduled`,
//     cron '*/5 * * * *') and its queue consumer (`queue`, batch.queue 'events', the existing events queue the steps are
//     sent on, wrangler.toml [[queues.consumers]]), and the operator's routes, over src/units/_parity.ts's mounted
//     environment on BOTH shopper hosts (session and do), with STORAGE replaced by ./_fold.ts's R2 double (ranged
//     reads, conditional writes, listings with size, etag and upload time, custom and HTTP metadata only when `include`
//     names them, as R2's) holding the publication set _parity published. The events queue is captured (a sendBatch of
//     more than 100 messages refused, as the platform's); every message the platform sends is delivered alone in its batch, in
//     order (but in RF6's R-P604 leg, where three shopper events are delivered together, as the platform batches up to
//     max_batch_size = 100), again when its step neither acknowledges it nor finishes (at most three deliveries, max_retries = 2), and
//     the five-minute run repeats at the frozen time until a run and its queue change no stored object but the
//     warehouse slice's schedule. No internal of the staged fold is read: not its message bodies, its object names, its
//     state head or its packs (P98's pack code is the builder's to build on); only the public stores — the hour
//     aggregate at aggregates/<tenant>/<date>/<hh>.json (src/learn/hourly.ts:114 hourKey, its shape kept, the design
//     §6), the day through GET /v1/:tenant/learn/report — the statistics objects' counters, and what storage was asked.
//   2 A STEP is one invocation — one queue message, one five-minute run with every waitUntil it schedules, one
//     operator request with the Durable Object calls it makes. What a step HOLDS is every byte the process holds during
//     it — its V8 heap and its ArrayBuffer and Buffer memory (R-P642), less the bytes the R2 doubles keep as the bucket
//     (each stored body in its own ArrayBuffer) — sampled at every storage call it makes and when it ends, above what was
//     held before it began (collected); a sample above 64 MiB is collected and taken again, so garbage never counts. Its FIXED INPUTS as storage shows them: the ledger
//     bytes and objects it reads (keys of the writer's layout, isLearningKey) at most a page, 16 MiB and 200 objects.
//   3 The volumes. A harness holds no 1,000,000-visitor tenant (its state alone is ~38 GB, DESIGN §3), so "at V visitors
//     a day" is what a step meets at V, as the analyst measured it (DESIGN §5, logs/proto.jsonl V1, V2): a leaf holding
//     the 48-hour state one leaf holds at V once leaves split above 8 MiB (64·2^k leaves, k the smallest depth keeping a
//     leaf's state at 879 B a decision and 22 decisions a visitor (DESIGN §2 T1) within 8 MiB: 10,000 → 64 leaves of
//     5.76 MiB, 100,000 → 512 of 7.2 MiB, 1,000,000 → 8,192 of 4.5 MiB), reached over hours 9–12, then its share of the
//     peak hour (V/12 visitors over the leaves) in hour 13, the peak hour of 10,000 visitors a day over every leaf (1/12 of
//     them, ~37 MiB, 600+ objects), the merge of the 64 depth-0 leaves' partials, the close and the day. The three leaves
//     live in one tenant at depth 0, in three residue classes of today's visitor hash (FNV-1a, frozen in _fold.ts).
//     "Leaves that split as they grow": one residue class carried to ~30 MiB of today's state over nine hours, twenty of
//     its first hour's visitors returning after the splits (a purchase, within the policy's 7-day window), each hour's
//     credits the witness's (creditedOf). "A merge at most 64 partials": nine classes grown past 8 MiB split, then an
//     hour with visitors in all 73 leaves; a leaf is a step that reads another step's output by byte range (its sections
//     of a page's pack, the design §4), and no step reads the outputs of more than 64 of them. Peak hours (R-P660): one hour
//     of 8,333 visitors (the 100,000-a-day peak, ~362 MiB of ledger) and one of 22,000 (~956 MiB), written in batches of
//     500 visitors as the queue writes them: the hour is folded on a fresh tenant (every object read, every decision
//     counted), never refused by name (R-P684: a refusal by name stays only for a step no partition depth brings within its
//     bound, which these volumes never reach), and every step, its merges and close among them, holds at most 64 MiB.
//   4 Parity is pinned against a COMMITTED reference (fixtures/reference.json): today's fold at d5d8581c — buildHour
//     through the five-minute catch-up — with only its refusal budgets lifted (REPORT_LIMITS, MAX_HOUR_OBJECTS; the
//     analyst's tree-lifted edit), run on the same records at the same times, three times identical and identical on the
//     do host; never computed at test time, so a build that changes buildHour cannot move the reference. "The day" is the
//     day the canonical POST builds from the hours at the scenario's last moment (its grids decay to that one time).
//     Generation and builtAt are left out; an aggregate or a day may carry top-level members today's does not (the
//     design's optional leafDepth); every member today's carries is equal: counts, identifiers and integers exactly, a
//     floating sum to a relative 1e-12 (an absolute 1e-12 for a value under 1) — the work order's (R-P660): a tree of
//     partial sums adds in another order than today's single pass and moves only the last bits. The leaf states are compared through what they decide — every later hour's
//     aggregate and the day — since their storage is the builder's (ring state v3 is in the work order's own remaining
//     work).
//   5 The commit's crash model: a step whose acknowledgement is lost after it finished (delivered again), a step cut
//     off at a storage call (it never returns, nothing after it runs), and the close cut off right after it wrote the
//     hour aggregate (between the two writes). Two coordinators: every message delivered twice at once and the
//     five-minute run run twice at once. A newer hour waits: its aggregate is first written after the in-flight hour's.
//   6 Resume: no ledger object a finished step read is read again after a later step reading the hour is cut off at its
//     second object; a filed conflict re-runs only its leaf: after the operator files it, the hour's ledger is read only at
//     the two objects holding the conflicting id; abandoned outputs: forty minutes after a run whose first five-minute run
//     of 14:06 was cut off at its second write of the fold's (the warehouse slice's schedule, which every run rewrites,
//     not counted), nothing a cut-off step wrote is still stored unless a later step wrote it again (adopted). A catch-up
//     (R-P632): after six hours without a five-minute run, the runs that resume fold the six hours in no more runs than
//     today's catch-up, which folds at most two closed hours a run (src/learn/hourly.ts catchUp, `opts.maxHours ?? 2`;
//     src/index.ts's run passes none) — a LOCK, green today.
//   7 A conflict is filed as today: by the operator's custom-policy POST /v1/:tenant/learn/report (src/routes/
//     decisions.ts:2030–2043, the only surface that files one); the fold never files. Past a page that request is a job
//     (reading 13), which files a read conflict it meets as the inline request does: RF3's newer-hour leg files at 14:20,
//     on a day of 28 MiB (scenario C's day is within a page at every other filing: 8.6 MiB at 13:20, P's 5.6 MiB).
//   8 The day by slot: GET without `slot` on a day whose grids pass 8 MiB answers 200, its body within 8 MiB, carrying
//     outside `grids` a list of exactly the day's slots (the slot index; its member name is the builder's); GET ?slot=<slot> answers 200 with that
//     slot's grid under every policy, and reads at most a quarter of the bytes the day's stored objects hold (ten slots).
//     A complete day is coverage with no missing and no truncated hour and status not 'incomplete' (report.ts:1247).
//   9 "A 1,000,000-visitor day from 24 hours": its hours are aggregates at the size content bounds them, not at a size
//     visitors set (DESIGN §9); one real hour of T5's wide context (ten slots of ten pieces, 240 finest cells) folded and
//     copied to the other 23 hours in the shape today stores (a legacy hour: no operator step, the design §6), 24 of them
//     past 32 MiB of aggregate (today refuses 16 MiB, aggregateBytes; T4 at 868 KB an hour, DESIGN §2).
//  10 The open hour on the same steps: an open hour of two pages answers `current` in the day's hours.open; a step past
//     its bound: an open hour holding one visitor with ~30 MB of decisions (a bot; a leaf cannot split one visitor)
//     answers `refused` with refusal.code 'fold_step_bound' and the refusal naming the step 'leaf' as one of its values
//     (its member name is the builder's) — the open hour's refusal is the one surface that names a fold refusal today
//     (src/learn/hourly.ts refusalOf, :3198). No closed hour left unfolded without a refusal stored that names it (R-P660):
//     the same visitor in closed hour 12, between two ordinary hours — the stored day names fold_step_bound with hour 12
//     among its coverage's missing hours (refusedByName, the one reading the peak hours' refused branch uses too), and
//     still does after hour 13 folds; today a closed hour's refusal reaches no day (reportFromHours carries refusals for
//     open hours only, hourly.ts:1932).
//  11 The rebuild (POST /v1/:tenant/learn/generation { slot, brand, rebuildFrom }) answers 2xx; its counters are read
//     from the statistics objects (_parity's `learned`) once the queue is drained. "As live learning": the shopper's
//     real pages and clicks on both hosts; the carry-in: a click at 00:05 on a decision served at 23:55 the day before;
//     the ring: a click on a piece shown only in a decision 400 decisions old. The money case publishes P103's member
//     `money: { currency: 'EUR', nonpositive: 'refuse' }` (P103 MP1) and fails first with PRECONDITION P103 until it reads
//     back (R-P6); its purchases are sent as the data layer sends them (P103's own fixture: orderId, value, margin, currency,
//     items naming a Coach product a checkout piece features).
//  12 R-P604 (finding 3 of P103's specification review, S50/reviewer-spec/REPORT-0b55b548.md, its probe 5): ledger keys do
//     not sort by write time (ts36(min)-ts36(max)-batch over the batch's client times, src/ledger/writer.ts:85,
//     src/ledger/records.ts:409-411), so every reader of rows sharing a logical id keeps the EARLIEST-BORN copy (the ledger
//     retention stamp's bornAt, mergeRetention's rule, src/retention.ts:126-133; a tie keeps the first read), never the
//     first read. Probe 5's shape on the direct outcome path (LEDGER_RECOVERY_ENABLED 'false', where each delivery is
//     admitted again under its own stamps): a EUR purchase taken under no money policy (refused on the revenue slot,
//     money_policy_unset), EUR published (PRECONDITION P103), then an add to bag timed 20 s before it, the purchase's SDK
//     retry (its first wire body) and a new EUR purchase delivered together, so the batch's ledger object sorts before
//     the first delivery's; on a day past a page (other visitors' traffic on the nine other slots), so the rebuild takes
//     the staged steps. Live learning, the open hour's and the closed hour's fold and the rebuild credit alike: the new
//     purchase 120, the retried one nothing (it is taken under its first stamp, P103 R-P588). P104's readers are its
//     leaves (the hour's, the rebuild's and the custom-policy job's); the raw day's ReportRowIdentity and loadHourRecords
//     are P103's (R-P604 (3)). Since R-P620 (P103's direct path writes its ledger row with the stamp the ring decided under)
//     both copies carry the same money stamp, so this leg pins what is credited and no longer which copy is kept. Which
//     copy is kept is pinned by R-P629's case (R-P642 (5); P103's round 7, its R18): the purchase's first delivery, under
//     no policy, is held on its way to the ring past RING_DECISION_BOUND_MS (P103's constant, read through the module;
//     PRECONDITION P103 when absent), so the action answers within the bound and its record carries the producer's own
//     stamp, marked `money_stamped_by: 'producer'`, batched with an event 20 s older so it sorts first; EUR is published,
//     the SDK's retry reaches the ring first and is decided under EUR (575 credited live, once), then the held delivery is
//     let through. Every reader of P104's — the open and the closed hour's leaves, the rebuild's, the custom-policy job's
//     — keeps the ring-stamped copy over the producer-stamped one, then the earliest-born: they credit what live learning
//     took (575 and the new purchase's 120); a reader keeping the first copy read, or the earliest-born alone, credits 120.
//
//  13 R-P615 (RF1, the custom-policy day past a page): a custom-policy request on a day past one page (16 MiB or 200
//     objects) answers 202, naming the job and where its day is read — read here as a string of the answer naming GET
//     /v1/:tenant/learn/report with that date in its query (the member and the digest's parameter are the builder's) —
//     and the same day and policy sent again names the same job (every string of the first answer is in the second);
//     that GET answers 202 while the job's steps run and 200 with { report } when they are done — read before the steps and
//     after every delivery of the queue: 202 mid-job, its body reporting progress (the numbers of the 202 answers, read in
//     order, never fall and some rise: steps done never fall), every 200 the day as done, and a job finished by a later
//     five-minute run accepted — and a job is named by its day and policy: the day before, past a page by its 211
//     objects, asked with the same policy, is its own job answering its own day; within a page the
//     request answers inline as today (RF6's ring and money legs). The job's grids under the request's policy, which is
//     the learning policy's own definition, equal the hourly fold's learning grids of the same day (exposures and credits
//     per slot, item and level, rounded under a hundred-year horizon; the witness: 2 x 460 clicks and the one carried in).
//     The fixture's visitor carried in from the day before (a hero at 23:55, clicked at 00:05, then 250 decisions at noon)
//     tells a job re-run from the date's start (the design §4, "the head version saved at 00:00") from one re-run from
//     the head as it stands, whose 200-entry ring no longer holds the 23:55 decision.
//
//  14 R-P684 (the delivery review at 18905092, S51/reviewer-p104/REPORT-18905092.md; the reviewer's probe ported where it did
//     the work). Each leg reads only the public stores, as reading 1; a message delivered again is delivered as the platform
//     held it, never read. RF1: the peak hours fold (reading 3); a rebuild leaf's rows — what it reads by range of the
//     pages' packs (reading 3's leaf) — at most 8 MiB, on a day whose rows crowd one residue class past it; over seven
//     dates of the same traffic, each with a job, the five-minute run with nothing due makes no more storage calls and
//     reads on the seventh date than on the fourth (its bytes within 1%), and no object outside the ledger and erasures/
//     holds a visitor erased on the second date. When a date's start record or a job's outputs may go is not fixed by the
//     work order or the design (§4: "re-run from the head version saved at 00:00"); the leg pins the run's inputs and the
//     erasure, not a retention period. RF3: every message of hour 11 delivered again after its commit and a collection —
//     the hour's aggregate unchanged, hour 12 crediting purchases on hour 10's decisions (creditedOf). RF4: an object of
//     hour 12 deleted at the first read of the hour (an erased visitor's object, as the rewrite deletes it) — hours 12 and
//     13 fold, the erased rows hidden. RF5: the canonical POST during an open hour — stored day, answer and stored day after
//     credit the witness; an inline custom-policy day after a day before of 100 MiB and 50,600 decisions — 200, and the
//     click at 00:05 on the hero of 23:55 credited (the latest decisions carried in). RF6: a staged rebuild whose steps wait
//     past the run of 13:30 — applied; a rebuild step refused for its bound — the rebuilt date's day names no refused hour
//     and keeps its credits (where the rebuild's own refusal is read is not fixed: no surface is named); every step delivered
//     three times — counted once. RF7: a stale open hour (800 objects after its working fold, today's RUN_BUDGET 700 calls)
//     read after the run that finds them and before their fold is done — refused open_fold_deferred, as kit 02 says today.
//
// ONE REPRESENTATION: the tenant (coach) of _fold.ts — ten slots on six pages, three rewards, ten pieces a slot, the
// checkout pieces each featuring one Coach product — and the frozen producer record; every scenario's traffic, its times and its operator actions
// are in _fold.ts (no expected value there). Fixtures: fixtures/reference.json (C, M, P), fixtures/v2-store.json (M's
// interrupted store), fixtures/old-day.json (a day today's writer stored, and today's two answers for it).
//
// DEFERRED: LV1 (lane L21 on the pair's next release). RESIDUALS (told): the harness's heap is Node's, not workerd's
// (UNVERIFIED, DESIGN §9); the volumes are per-step loads (reading 3), not a tenant at depth 7; a slot past the live
// table's 256 items or 4,096 counters is not exercised (the work order does not say whether it is refused or capped);
// the five-minute run is measured as one step with the monitor and the warehouse slice it shares; a step's figure is
// what it holds sampled at its storage calls (heap and ArrayBuffer memory), collected only above 64 MiB, so a figure
// under 64 MiB includes garbage (an upper figure, as the analyst's); "a merge at most 64 partials" is measured where a
// tree is needed (73 leaves, reading 3), not at 8,192; queue batches of more than one message (but RF6's R-P604 batch of three), and several
// invocations in one isolate, are LV1's.
//
// MEASURED (_evidence/parity-step3/S51/specifier/logs/r5/, serial, --no-cache, one worker, env -C the tree, --root the
// tree; scratch trees built by scratch/r5/bin/mk.sh from this branch's head; the sketch is scratch/r5/{stagedFold.ts,apply.py};
// one run each, scratch/r5/bin/run.sh):
//   TODAY (today: the worktree at the merge of rem/integration 022b17c2, P98 and P103 merged, + this file): 49 of 55 RED,
//   six green: the four LOCK legs (RF5's old day, RF4's catch-up) and the money leg ×2, a LOCK behind P103 now that P103
//   is merged. RED for P104's missing behaviour: RF1 hour 10 of the volumes refused, the class refused at hour 8, the
//   73-leaf hour never reached, both peak hours unfolded with no refusal named (365 MiB, 966 MiB), the closed hour's
//   refusal named nowhere on the day, T5's wide hour refused (cells), the open hour refused rawBytes, the bot named
//   report_budget_exceeded rawBytes, the job answered 413 rawBytes; RF2 and RF3 the hours above a page refused; RF4 38
//   and 50 re-reads, the migration's hour 13 refused; RF5 the head counts 0 of 5,060, hour 0 of T5 refused, C's day built
//   [12]; RF6 the custom-policy day crediting the 400-decision-old click, the big rebuild 503 (R-P604's and R-P629's
//   legs included, their PRECONDITION P103 now met); RF7 every fact absent.
//   THE SKETCH (sketch: staged day rebuild kit born job, P103 merged, no P103 sketch): 55 of 55 green. Every step ≤ 64 MiB
//   counting ArrayBuffer and Buffer memory — the peak hours' merges and close included — a page ≤ 16.0 MiB and 200
//   objects; parity to the work order's relative 1e-12 with the design's merge (mergeStats, no replay).
//   THE 22,000 STALL'S CAUSE (R-P660; the design's DESIGN.md §4 and the round-4 sketch): leaves split on their STATE only
//   (DESIGN.md §4 "A leaf that would pass 8 MiB splits", :121), so a fresh tenant's hour is partitioned at the head's
//   64 depth-0 leaves; 966 MiB of ledger gives each ~15 MiB of rows, past the leaf's 8 MiB of rows (DESIGN.md :218;
//   scratch/r5/stagedFold.ts leaf, :322, throws FoldStepBound('leaf') before a pack is read); a closed hour's refusal was
//   kept only in the fold head's `refused` map (stagedFold.ts refuse, :557–568), which no day reads, and its basis stops the
//   hour being planned again (planNextDue, :865): the hour unfolded, nothing named. 8,333 visitors (365 MiB, ~5.7 MiB a
//   leaf) stays under the bound, which is why only 22,000 stalls. The sketch partitions the hour's rows at a row depth
//   keeping each leaf's share within 6 MiB (rowDepthOf, rowLeaf, :234–244; 256 leaves at 22,000, a merge tree) and stores
//   a closed hour's refusal where the day reads it (refusals/<tenant>/<date>/<hh>.json; the day's hours.refused, the hour
//   among its missing hours).
//   THE SKETCH, per leg (never committed; files and the code each leg needs):
//     src/learn/stagedFold.ts (new): RF1–RF4 — the five-minute run plans the oldest due hour and each close plans the next,
//       so every due hour is folded in order through the queue without waiting for a run (a listing cut into pages of
//       ≤ 16 MiB and ≤ 200 objects, written create-only, the state head naming it in flight; quiet hours of a stateless
//       tenant closed in place; a quiet hour of a small state — no ledger object, at most 64 leaves — taking its bounded
//       steps in the invocation that plans it rather than a queue hop each), partition (one pack and its index per page, sections by leaf, rows checked as
//       ReportRowIdentity checks them and digested), leaf (its sections read by range, de-duplicated by digest in global
//       order keeping a ring-stamped copy over one marked producer-stamped, then the earliest-born (R-P604, R-P629: the
//       ledger stamp's bornAt, a tie keeping the first read), a conflict filed or raised; today's cleanupShard,
//       foldableRows, hourBrands, foldShard and countMembership unchanged; a state past 8 MiB split by visitor hash; the
//       hour's rows partitioned at a row depth (R-P660) keeping each leaf's share within 6 MiB of its 8 MiB of rows, a
//       shallower leaf of the head split for the hour, its children starting from its state filtered to their visitors;
//       one visitor's rows past 8 MiB refused fold_step_bound), merge (the design's: partials summed with mergeStats, at
//       most 64 a merge, in today's shard order; within an hour the date's distinct visitors add; parity to 1e-12), close (closeBrands; the aggregate written create-only
//       or on the plan's etag, then the head CAS), resume (one listing finds the missing outputs), each fan-out sent once
//       (a create-only marker, sent in batches of at most 100), unnamed outputs collected after 15 minutes; leaves merged in
//       today's shard order; the open hour on the same steps never moving the
//       head, its refusal naming its step; RF6 the rebuild of a day past a page planned on the same steps, each leaf
//       keeping the earliest-born copy of a row and folding its visitors with foldRetainedDay and the day before carried in,
//       the counters applied at the statistics object. R-P615 the custom-policy day past a page as a job (reportJob,
//       readJob): the date re-run hour by hour on the same steps from the head's version at the date's start (a create-only
//       record written at the date's first commit), under the learning policy and the request's, into the job's own
//       namespace, a read conflict filed as the inline request files it, the day summed from the job's hours; collection
//       keeps what a running job and a date's start name; the date's day published at each hour's close.
//     src/learn/hourly.ts: RF1/RF5 the cells bound per slot and policy (256 items, 4,096 counters) in admitHours; RF5
//       loadHours summing one hour at a time into the running statistics, reportFromHours taking them and refusing no
//       outputBytes; the open refusal admitting `step`; the internals the steps reuse exported (stagedInternals); loadHours
//       reading a job's hours (jobDayFromHours).
//     src/learn/report.ts: RF5 a day past 8 MiB stored as today's summary frame, a part index, the head and one part per
//       slot in one object (a day within 8 MiB byte-for-byte as today), its head and slot parts read by range, the saved
//       grid rows bounded per slot; a day of parts says so in its object's metadata (written with it), so one get reads a
//       day within 8 MiB as today, and the answer without a slot carries the slot index; RF6 the custom-policy day's
//       ring: the day before carried in, 200 kept (ringAtHour).
//     src/learn/fan.ts: RF6 foldRetainedDay with the day before carried in and the ring of the hourly fold at the
//       outcome's hour (the helper ringAtHour, which the sketch placed in policy.ts: the builder keeps it in fan.ts or
//       report.ts, P104's grant). src/durable-objects/LearnStats.ts: RF6 the rebuild reads the day before; past a page it
//       plans the staged rebuild and applies its counters on '/rebuild-apply'. src/routes/decisions.ts: RF5 the POST
//       answering a day past 8 MiB with its head and slot index; R-P615 the custom-policy request past a page answering
//       202 with the job and its read (GET …&policy=<digest>: 202 with progress, 200 with the day). src/index.ts: RF1/RF4 the five-minute run calls the
//       staged run (it only enqueues); the queue consumer runs fold messages (ack, or retry on a throw).
//       docs/kit/02-api-reference.md: RF7 one paragraph before the aggregate-to-day budgets, which lose "16MiB combined
//       aggregate JSON". The sketch adds no input cap and no new queue. P103's R-P604 readers (ReportRowIdentity,
//       loadHourRecords) are P103's sketch's `earliest`, not P104's.
//   THE WRONG FIXES (round 4: logs r4-*, the reviewer's controls applied by its rv.py and kitopp.py after the sketch;
//     earlier rounds' f-*, g-*, n-*, j-*, c-*), each RED on the legs named: today's fold with its limits lifted (the
//     bound met by constants) — 37 of 49 RED, the 12 green: RF1 wide, RF2, RF3 coordinators, RF5 complete, the four
//     LOCKs (r4-lifted); 96 MiB held as an ArrayBuffer in every leaf step (abheap) and as a JS array (jsheap) — RF1
//     volumes; one flat merge (fanin) — RF1 merge tree (73 partials in one step); a split losing the leaf's rings
//     (splitdrop) — RF1 split (569 of 589 credits); the leaf row bound not enforced (nobound) — RF1 bot; the leaves
//     reading the first page only (pagetrunc) — RF1 volumes, RF2; the day without its last hour (partialday) — RF5 24
//     hours, complete; a catch-up newest hour first (reverse) — RF2, RF5 complete; one due hour a run (onehour) — RF4
//     catch-up; outputs never collected (nogc) — RF4 resume; the day's hours held together (nostream) — RF5 24 hours;
//     the slot index missing a slot (slotindex) and a stored day missing a slot's part (slotpart) — RF5 by slot; the
//     job's read answering 200 after its first hour (early200) — RF1 job (every 200 the day as done); the job named
//     without its day (jobnodate) — RF1 job (the day before answered with the other day); the custom-policy day left as
//     today (nojob), a new job a request (newjob), the job re-run from the head as it stands (headstart) — RF1 job; the
//     leaves keeping the first copy read (firstread) — RF6 R-P629 at the open hour (120 for 575 + 120); the preferred
//     copy kept in the hour's leaves only (houronly) — RF6 R-P629 at the rebuild; the earliest-born copy alone, a
//     ring-stamped copy not preferred (noringpref) — RF6 R-P629 at the open hour; kit 02's paragraph with every clause
//     negated (kitopp) — RF7 (r6-rf7-kitopp). R-P660 (round 5, logs s5-*, every control above measured again on the
//     round-5 sketch, each RED on its legs): round 4's merge, the hour's accumulator updates replayed in one merge
//     (replay) — RF1 the 100,000-a-day peak hour (its merge past 64 MiB); the hour's rows at the head's leaves only
//     (norowdepth, the stall) — RF1 the 22,000-visitor hour (unfolded, nothing named); kit 02 with the reviewer's two
//     negation-free contradictions (kitnf) — RF7 (perStepBound, bySlot; s5-rf7-kitnf); a step hiding 96 MiB in the bucket
//     while keeping it (abput) — RF1 volumes. Round 5 final (logs r5/w-*, one run each on the final sketch): the hour's
//     accumulator updates replayed in order in its one merge (w-replay) — RF1 the 8,333 peak hour ×2 (a merge 127.1 MiB, its
//     close 80.7 MiB); the hour's rows at the head's leaves and a closed refusal kept in the head alone (w-unfolded, the
//     stall) — RF1 the 22,000 peak hour ×2 (not folded, not named) and the closed hour ×2; the merge gathering its leaves'
//     rows to de-duplicate across them (w-mergerows) — RF1 both peak hours ×2 (merges of 186.6 and 126.9 MiB). Earlier rounds': steps but leaves that never split — RF1 split; the head
//     written before the aggregate — RF3 crash; a failed run started again — RF4 resume; the open hour left on today's
//     working fold — RF1 open hour, bot; leaves merged as hours are — RF2; duplicates removed within a page only — RF2;
//     the leaf skipping today's cleanup — RF2; an hour past a page refused — RF1 volumes; the day left as today — RF1 wide,
//     RF5; the rebuild without the day before or the 200-entry ring, or fixed alone — RF6 ring; kit 02 left as today — RF7.
//   LOCKS (the work order's learn suites, W23, W24, W26, W27, W32 B1, P33, P94 and every suite touching the fold, the day
//     report, the rebuild or the scheduled run: 63 files, scratch/locks-all.txt), round 4 on the whole sketch with the R10
//     re-forms in place (l5-sketch): 864 of 866 green; P87's packaging leg fails alike without the sketch (l5-today: the
//     stamp workflow outside a checkout); index.api-boundary's "post-upgrade private delivery on do" failed once in the
//     sweep and passed 72/72 run alone on the same tree (ab-full-sketch), as on today's (ab-full-today; its W15 leg timed
//     out once in the sweep's today run). P103's legs (rem/spec-p103 7a5b49ba, the reviewer's note 8: its MP3 legs are
//     locks for this fold) on P103's round-7 sketch with this one, as committed and re-pointed (the re-point's `failed`
//     check live: settleMounted returns a run or delivery that threw and a message given up): 49 of 52 green each
//     (r4-p103legs-*); the three others are the parts the scratch trees leave out (sdk, kit, kit03; no packages/sdk).
//   R10s (R-P615, R-P632, by name): src/learn/hourly.test.ts W32.03 :908–910 and src/learn/report.test.ts W32.04
//     :379–382, the 8 MiB refusal re-pointed to RF5's by-slot answer (a day of 2 x 150 items x 20 levels built, not
//     refused; a canonical day of grids past 8 MiB stored, its answer without a slot within 8 MiB naming every slot, ?slot=
//     answering the slot's items; the slot index a list of exactly the day's slots, R-P642 (6)); report.test.ts's ReportR2
//     keeps an object's customMetadata and answers a ranged text() with its range, as R2 does (R-P632, granted by name):
//     both RED today on outputBytes, green on the sketch (r5-learn 59/59; r5-today-learn 57/59); nothing else moves.
//     src/units/W37/LEDGER.unit.test.ts's and FIX2.unit.test.ts's five-minute fold legs (R-P615, R-P632) declare the
//     shipped events queue (wrangler.toml EVENT_QUEUE → "events", its consumer's four settings) through src/units/_native.ts's
//     optional pass-through, their wrappers hand a delivered batch to the Worker's queue handler (FIX2's outage holding for
//     it as for the scheduled run), and after each run they wait, bounded, for the queue's deliveries (the stored
//     aggregates and days unchanged across 7 s, at most 90 s); no run limit is raised. Green today (c-w37-today) and on
//     the sketch (c-w37-sketch2). P103's legs (src/units/P103/LEDGER.unit.test.ts, merged with P103 at 022b17c2; its
//     MP3 open and closed hour, :858–860 and :863–865): scratch/bin/edit-r10-p103.py re-points foldOpenHours and catchUp
//     to the Worker's five-minute run and its queue (settleMounted in ./_fold.ts), adds the three module mocks every unit
//     importing src/index.ts carries, every expectation unchanged: 66 of 66 green today (r5/p103-today), 65 of 66 on the
//     sketch (r5/p103-sketch; the one other its SDK leg, the scratch tree carrying no packages/sdk).
//   R10 (R-P660 (5), by name): src/units/_parity.ts mount's EVENT_QUEUE double takes at most 100 messages a sendBatch, as
//     the platform's queue; every test file using _parity.ts but this one (scratch/r5/parity-users.txt, 89 files) run once
//     on the worktree (r5/queue-users): 1,727 of 1,727 green.
//
// Imports from src/units/: ../_parity, ./_fold, ./fixtures/*.json (P103's legs: ../P104/_fold). NO NEW EXPORT IS IMPORTED.

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import * as learnRoute from '@/learn/route';
import type { DecisionRecord } from '@/content/types';
import { isLearningKey, type OutcomeRecord } from '@/ledger/records';

import { BRAND, HOSTS, learned, PAGE_VIEW, putDocument, readTree, rounded, shopperOn, TENANT } from '../_parity';
import {
  at, customDay, DATE, decisionRow, documents, drainBatch, drainQueue, drainStepwise, featuredProduct, holdRing, fiveMinuteRun, FULL, H, hourPrefixOf, ledgerObjects, MiB, MIN, operator, overBound, overPage, play,
  outcomeRow, RAW_POLICY, REWARD_OF, retentionRegistry, rng, rowsOf, scenarioC, scenarioM, scenarioP, settleAt, SLOTS, SMALL, stamp, visit, visitorsOf, WIDE, writeLedger,
  type DeliveryPlan, type Fault, type Queued, type Scenario, type Stamp, type StepRecord,
} from './_fold';

const BOUND = 64 * MiB;
const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;
type Json = Record<string, unknown>;
const REF = fixture<Record<'C' | 'M' | 'P', { aggregates: Record<string, Json | null>; day: Json }>>('reference.json');

const aggregateKey = (date: string, hour: number) => `aggregates/${TENANT}/${date}/${String(hour).padStart(2, '0')}.json`;
const withoutIdentity = (v: Json): Json => { const { generation: _g, builtAt: _b, ...rest } = v; void _g; void _b; return rest; };
function aggregateOf(s: Stamp, hour: number, date = DATE): Json | null {
  const body = s.r2.text(aggregateKey(date, hour));
  return body === null ? null : withoutIdentity(JSON.parse(body) as Json);
}
async function dayOf(s: Stamp, date = DATE, query = ''): Promise<{ status: number; body: Json; record: StepRecord }> {
  return operator(s, 'GET', `/v1/${TENANT}/learn/report?date=${date}${query}`);
}

/** Every difference between what the platform holds and what today's fold held: keys, strings, counts and integers exactly; floating sums to a relative 1e-12, an absolute 1e-12 for a value under 1 (the work order's, R-P660). */
function differences(actual: unknown, expected: unknown, path = '$', out: string[] = [], extraAllowed = false): string[] {
  if (out.length >= 12) return out;
  if (typeof expected === 'number' && typeof actual === 'number') {
    const exact = Number.isInteger(expected) && Number.isInteger(actual);
    const scale = Math.max(Math.abs(actual), Math.abs(expected));
    const off = scale < 1 ? Math.abs(actual - expected) : Math.abs(actual - expected) / scale;
    if (exact ? actual !== expected : off > 1e-12) out.push(`${path}: ${actual} where today's fold has ${expected}`);
    return out;
  }
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    if (actual !== expected) out.push(`${path}: ${JSON.stringify(actual)?.slice(0, 120)} where today's fold has ${JSON.stringify(expected)?.slice(0, 120)}`);
    return out;
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) { out.push(`${path}: an ${Array.isArray(actual) ? 'array' : 'object'} where today's fold has the other`); return out; }
  const a = actual as Json, e = expected as Json;
  const missing = Object.keys(e).filter(k => !Object.hasOwn(a, k)), extra = Object.keys(a).filter(k => !Object.hasOwn(e, k));
  if (missing.length) out.push(`${path}: lacks ${missing.slice(0, 5).join(', ')}`);
  if (extra.length && !extraAllowed) out.push(`${path}: carries ${extra.slice(0, 5).join(', ')} today's fold does not`);
  for (const k of Object.keys(e)) if (Object.hasOwn(a, k)) differences(a[k], e[k], `${path}.${k}`, out);
  return out;
}

/** The scenario's aggregates and its day (built at its last moment) against today's fold (reading 4). */
async function parity(s: Stamp, name: 'C' | 'M' | 'P', sc: Scenario, day = true): Promise<string[]> {
  const found: string[] = [];
  for (const hour of sc.hours) {
    const expected = REF[name].aggregates[String(hour)]!, actual = aggregateOf(s, hour);
    if (actual === null) { found.push(`hour ${hour}: no aggregate (today's fold has one with ${(expected.brands as Json & { coach: Json }).coach.decisions} decisions)`); continue; }
    found.push(...differences(actual, expected, `hour ${hour}`, [], true));
  }
  if (!day) return found;
  // The day built from the hours at the scenario's last moment, as the reference's was: its grids decay to that one time.
  const read = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE }, sc.moments[sc.moments.length - 1]!.at);
  if (read.status !== 200) found.push(`the day: the canonical build answered ${read.status} ${JSON.stringify(read.body).slice(0, 200)}`);
  else found.push(...differences(withoutIdentity(read.body.report as Json), REF[name].day, 'the day', [], true));
  return found;
}

/** A statistics horizon of a hundred years (P103's fixture): decay moves nothing between sums taken minutes apart. */
const CENTURY = { n0: 30, tauLearnMs: 3_153_600_000_000, liftMin: 0.5, liftMax: 2, nMin: 30 };
/**
 * Witness: the outcomes the learning policy credits among rows the generator made — each outcome names a piece its own
 * visitor was shown shortly before (two minutes at most, or, for a returning purchase, hours before: within the default
 * policy's windows, click 30 minutes, add to bag 6 hours, purchase 7 days; src/learn/policy.ts DEFAULT_POLICY), and is
 * credited once when the piece's slot learns the outcome's reward (REWARD_OF), never otherwise.
 */
const creditedOf = (rows: ReadonlyArray<DecisionRecord | OutcomeRecord>) => rows.filter((row): row is OutcomeRecord => 'outcome_id' in row)
  .filter(o => REWARD_OF[String(o.item_id).split('.')[0]!] === o.type).length;
/**
 * A closed hour refused by name with its refusal stored (R-P660), one reading for every leg that asks it: the stored day
 * names fold_step_bound and holds the hour among its coverage's missing hours (the refusal's form is the builder's).
 */
function refusedByName(day: { body: Record<string, unknown> }, hour: number): boolean {
  const coverage = (day.body.report as { coverage?: { missingHours?: number[] } } | undefined)?.coverage;
  return stringsOf(day.body).includes('fold_step_bound') && (coverage?.missingHours ?? []).includes(hour);
}
/** Every number an answer carries, in document order. */
function numbersOf(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) numbersOf(v, out);
  return out;
}
/** A job's progress across its 202 answers: the same numbers each time, none of them ever falling, at least one rising. */
function progressMoves(bodies: unknown[]): boolean {
  const rows = bodies.map(body => numbersOf(body));
  if (rows.length < 2 || rows.some(row => row.length !== rows[0]!.length)) return false;
  let rose = false;
  for (let i = 1; i < rows.length; i++) for (let k = 0; k < rows[i]!.length; k++) {
    if (rows[i]![k]! < rows[i - 1]![k]!) return false;
    if (rows[i]![k]! > rows[i - 1]![k]!) rose = true;
  }
  return rose;
}
/** Every list of strings an answer carries, at any depth. */
function listsOfStrings(value: unknown, out: string[][] = []): string[][] {
  if (Array.isArray(value)) { if (value.length && value.every(v => typeof v === 'string')) out.push(value as string[]); else for (const v of value) listsOfStrings(v, out); }
  else if (value && typeof value === 'object') for (const v of Object.values(value)) listsOfStrings(v, out);
  return out;
}
/** Every string an answer carries, at any depth. */
function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringsOf(v, out);
  return out;
}
/** Where an answer says a day is read: the path of the first string naming GET /v1/:tenant/learn/report with a query. */
function locationOf(body: unknown): string | null {
  const found = stringsOf(body).find(x => x.includes(`/v1/${TENANT}/learn/report?`));
  return found ? found.slice(found.indexOf(`/v1/${TENANT}/learn/report?`)) : null;
}
/** A day's grids under one policy: slot, item and level to its exposures (n) and credits (s), rounded. */
function gridsOf(report: Json | undefined, policy: string): Record<string, Record<string, Record<string, [number, number]>>> {
  const grids = (report?.grids ?? {}) as Record<string, Record<string, { items: Record<string, Record<string, { n: number; s: number }>> }>>;
  return Object.fromEntries(Object.entries(grids).filter(([, policies]) => policies[policy]).map(([slot, policies]) => [slot, Object.fromEntries(Object.entries(policies[policy]!.items)
    .map(([item, levels]) => [item, Object.fromEntries(Object.entries(levels).map(([level, c]) => [level, [Math.round(c.n), Math.round(c.s)] as [number, number]]))]))]));
}
const exposures = (grids: ReturnType<typeof gridsOf>) => Object.values(grids).reduce((n, items) => n + Object.values(items).reduce((m, levels) => m + (levels['*']?.[0] ?? 0), 0), 0);

/** The steps of a run that broke the bound or read more than a page. */
const bounds = (s: Stamp) => [...overBound(s.steps.filter(r => r.outcome !== 'cut'), BOUND), ...overPage(s.steps)];

/**
 * Witness of a home-hero rebuild (the RF6 at-volume leg's): every home-hero decision of the visits is an exposure of its
 * piece (n), and each visit's click on its first piece (home-hero, 30 s later) is credited to that piece (s).
 */
function heroWitness() {
  const n: Record<string, number> = {}, s: Record<string, number> = {};
  return {
    add(visits: ReadonlyArray<{ decisions: DecisionRecord[] }>) {
      for (const v of visits) {
        for (const d of v.decisions) if (d.slot === 'home-hero') n[d.item_id] = (n[d.item_id] ?? 0) + 1;
        s[v.decisions[0]!.item_id] = (s[v.decisions[0]!.item_id] ?? 0) + 1;
      }
    },
    expected: () => ({ n: { ...n }, s: { ...s } }),
  };
}

const frozen = { useFake: () => vi.useFakeTimers({ toFake: ['Date'] }) };
beforeEach(() => { frozen.useFake(); vi.setSystemTime(at(11)); });
afterEach(() => { vi.useRealTimers(); });

const T = 900_000;

// ===========================================================================
// unit:P104.RF1 — the bound: every step at most 64 MiB, fixed inputs, nothing refused or truncated by volume
// ===========================================================================

/** The hour's own rows: decisions (distinct ids) and the ledger objects the writer named for it. */
function hourFacts(objects: Map<string, string>, hour: number) {
  const prefix = hourPrefixOf(at(hour)) + '/';
  const keys = [...objects.keys()].filter(k => k.startsWith(prefix));
  const ids = new Set<string>();
  for (const k of keys) if (k.includes('/decision/')) for (const line of objects.get(k)!.split('\n')) if (line) ids.add((JSON.parse(line) as { decision_id: string }).decision_id);
  return { objects: keys.length, decisions: ids.size, bytes: keys.reduce((n, k) => n + Buffer.byteLength(objects.get(k)!), 0) };
}
function expectHourFolded(s: Stamp, hour: number, facts: ReturnType<typeof hourFacts>, label: string) {
  const agg = aggregateOf(s, hour) as (Json & { objects: number; objectsRead: number; truncated: boolean; brands: Record<string, { decisions: number }> }) | null;
  expect(agg === null ? 'no aggregate: refused or never finished' : 'folded', `${label}: hour ${hour} (${(facts.bytes / MiB).toFixed(1)} MiB of ledger in ${facts.objects} objects, ${facts.decisions} decisions) is folded`).toBe('folded');
  expect({ objects: agg!.objects, objectsRead: agg!.objectsRead, truncated: agg!.truncated, decisions: agg!.brands[TENANT]?.decisions },
    `${label}: every object of hour ${hour} is read, in pages, and every decision folded`).toEqual({ objects: facts.objects, objectsRead: facts.objects, truncated: false, decisions: facts.decisions });
}

/**
 * Reading 3: the three volumes' leaves and the peak hour of a 10,000-visitor day, in one tenant: each leaf's 48-hour state
 * reached over hours 9 to 12 (a quarter of its visitors an hour), then the peak hour 13 over every leaf.
 */
function volumeScenario(registry: ReturnType<typeof retentionRegistry>) {
  const r = rng(104_101);
  const decisionBytes = 879, perVisitor = 22, leafCap = 8 * MiB;
  const volumes = [10_000, 100_000, 1_000_000].map((visitorsPerDay, i) => {
    let depth = 0; while ((2 * visitorsPerDay * perVisitor * decisionBytes) / (64 * 2 ** depth) > leafCap) depth++;
    const leaves = 64 * 2 ** depth, state = (2 * visitorsPerDay * perVisitor * decisionBytes) / leaves;
    const ids = visitorsOf(`vol${i}`, Math.round(state / (perVisitor * decisionBytes)), 11 + 20 * i);
    return { visitorsPerDay, depth, leaves, state, ids, peak: Math.max(1, Math.round(visitorsPerDay / 12 / leaves)) };
  });
  const steady = volumes.flatMap(v => v.ids.map((id, n) => visit(registry, id, at(9 + (n % 4)) + Math.floor(r() * 35 * MIN), perVisitor, r, FULL)));
  const peakVisitors = [...visitorsOf('peak10k', Math.round(10_000 / 12)), ...volumes.flatMap(v => v.ids.slice(0, v.peak))];
  const peak = peakVisitors.map(id => visit(registry, id, at(13) + Math.floor(r() * 35 * MIN), perVisitor, r, FULL, 'peak-'));
  const objects = ledgerObjects(rowsOf(steady), 500, 'b');
  for (const [k, v] of ledgerObjects(rowsOf(peak), 30, 'p')) objects.set(k, v);
  return { volumes, objects };
}

describe('unit:P104.RF1 (E29: every step at most 64 MiB at 10,000, 100,000 and 1,000,000 visitors a day)', () => {
  for (const host of HOSTS) {
    it(`RF1 ${host}: the leaves of 10,000, 100,000 and 1,000,000 visitors a day and the peak hour of 10,000 fold in steps of at most 64 MiB, a page at most 16 MiB and 200 objects, every object read`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 volumes');
      const { volumes, objects } = volumeScenario(registry);
      const facts = new Map([9, 10, 11, 12, 13].map(h => [h, hourFacts(objects, h)]));
      expect(facts.get(13)!.objects, 'the fixture: the peak hour is written in more than 600 objects (today\'s MAX_HOUR_OBJECTS, hourly.ts:78)').toBeGreaterThan(600);
      expect(facts.get(13)!.bytes, 'the fixture: the peak hour holds more than two pages of ledger').toBeGreaterThan(32 * MiB);
      expect(volumes.map(v => [v.visitorsPerDay, v.leaves]), 'the fixture: the geometry of reading 3').toEqual([[10_000, 64], [100_000, 512], [1_000_000, 8192]]);
      const byHour = new Map([9, 10, 11, 12, 13].map(h => [h, new Map([...objects].filter(([k]) => k.startsWith(hourPrefixOf(at(h)))))]));
      objects.clear();
      for (const hour of [9, 10, 11, 12, 13]) { writeLedger(s, byHour.get(hour)!); byHour.get(hour)!.clear(); await settleAt(s, at(hour + 1, 6)); }
      for (const hour of [9, 10, 11, 12, 13]) expectHourFolded(s, hour, facts.get(hour)!, `RF1 ${host}`);
      expect(bounds(s), `RF1 ${host}: every step holds at most 64 MiB and reads at most a page (16 MiB, 200 objects) of ledger`).toEqual([]);
    }, T);

    it(`RF1 ${host}: a leaf that would pass 8 MiB splits by visitor hash — one residue class growing to ~30 MiB of state over nine hours folds in steps of at most 64 MiB, and its visitors who return after the splits are credited as before them`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 split');
      const r = rng(104_102);
      const ids = visitorsOf('grow', 9 * 182, 37);
      // Twenty of hour 6's visitors return at 14:40 and buy what their plp-banner showed them at hour 6 (their third piece;
      // the slot learns purchases, whose window is 7 days).
      const returning: OutcomeRecord[] = [];
      for (const [n, hour] of [6, 7, 8, 9, 10, 11, 12, 13, 14].entries()) {
        const visits = ids.slice(n * 182, (n + 1) * 182).map(id => visit(registry, id, at(hour) + Math.floor(r() * 35 * MIN), 22, r, FULL));
        if (hour === 6) for (const [k, v] of visits.slice(0, 20).entries()) returning.push(outcomeRow({ visitor: v.visitor, ts: at(14, 40) + k * 1_000, event: 'purchase', item: v.decisions[2]!.item_id, nonce: `return-${v.visitor}` }, registry));
        const rows = [...rowsOf(visits), ...(hour === 14 ? returning : [])];
        const objects = ledgerObjects(rows, 500, 'b');
        const facts = hourFacts(objects, hour);
        // Witness (creditedOf): the returning visitors' purchases name a piece their rings hold from hour 6.
        const credited = creditedOf(rows);
        writeLedger(s, objects);
        objects.clear();
        await settleAt(s, at(hour + 1, 6));
        expectHourFolded(s, hour, facts, `RF1 ${host} (the class at ~${((n + 1) * 4004 * 879 / MiB).toFixed(1)} MiB of today's state)`);
        const agg = aggregateOf(s, hour) as (Json & { brands: Record<string, { policies: Record<string, { credits: number }> }> }) | null;
        expect(agg?.brands[TENANT]?.policies.learning?.credits, `RF1 ${host}: hour ${hour}'s learning credits are its ${credited} credited outcomes${hour === 14 ? `, the ${returning.length} returning visitors' purchases among them (their rings carried across the splits)` : ''}`).toBe(credited);
      }
      expect(bounds(s), `RF1 ${host}: no leaf holds more than 8 MiB of state: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF1 ${host}: more leaves than one merge may take — 73 leaves holding partials in one hour (nine residue classes split): every leaf's partial merged through a tree of at most 64 partials a merge, every row folded and credited`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 merge tree');
      const r = rng(104_106);
      // Nine residue classes, sixty visitors each, grow to ~10 MiB of state over hours 6–9 (fifty decisions a visitor an hour).
      const heavy = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(residue => visitorsOf(`heavy${residue}-`, 60, residue));
      for (const hour of [6, 7, 8, 9]) {
        const objects = ledgerObjects(rowsOf(heavy.flat().map(id => visit(registry, id, at(hour) + Math.floor(r() * 35 * MIN), 50, r, FULL))), 500, 'b');
        writeLedger(s, objects);
        objects.clear();
        await settleAt(s, at(hour + 1, 6));
      }
      // Hour 10: two new visitors in each of the 64 classes, and two in each half of each class that split.
      const fresh = [...Array.from({ length: 64 }, (_, residue) => visitorsOf(`all${residue}-`, 2, residue)).flat(),
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(residue => [...visitorsOf(`half${residue}-`, 2, residue, 128), ...visitorsOf(`half${residue + 64}-`, 2, residue + 64, 128)])];
      const rows = rowsOf(fresh.map(id => visit(registry, id, at(10) + Math.floor(r() * 35 * MIN), 8, r, FULL)));
      const objects = ledgerObjects(rows, 500, 'b');
      const facts = hourFacts(objects, 10), credited = creditedOf(rows);
      writeLedger(s, objects);
      objects.clear();
      const first = s.steps.length;
      await settleAt(s, at(11, 6));
      expectHourFolded(s, 10, facts, `RF1 ${host} (hour 10, after the splits)`);
      const agg = aggregateOf(s, 10) as (Json & { brands: Record<string, { policies: Record<string, { credits: number }> }> }) | null;
      expect(agg?.brands[TENANT]?.policies.learning?.credits, `RF1 ${host}: hour 10's learning credits are its ${credited} credited outcomes (creditedOf)`).toBe(credited);
      // A leaf reads its sections of each page's pack by byte range; a merge reads the leaves' partials whole. No step reads
      // the outputs of more than 64 steps that read other steps' outputs by range (the leaves).
      const hour10 = s.steps.slice(first), leaves = new Set(hour10.filter(step => step.rangedFromSteps).map(step => step.index));
      const widest = Math.max(0, ...hour10.map(step => [...step.readFrom].filter(w => leaves.has(w)).length));
      expect({ leaves: leaves.size > 64, widest: widest <= 64 }, `RF1 ${host}: ${leaves.size} leaf steps in hour 10; the widest step read ${widest} leaves' partials`).toEqual({ leaves: true, widest: true });
      expect(bounds(s), `RF1 ${host}: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF1 ${host}: T5's wide context (4 channels x 3 visit buckets x 10 regions, ten slots of ten pieces) folds, the cells bound kept per slot at the live table's capacity`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 wide');
      const r = rng(104_103);
      const objects = ledgerObjects(rowsOf(visitorsOf('wide', 80).map(id => visit(registry, id, at(12) + Math.floor(r() * 35 * MIN), 22, r, { ...FULL, context: WIDE }))), 500, 'b');
      writeLedger(s, objects);
      await settleAt(s, at(13, 6));
      expectHourFolded(s, 12, hourFacts(objects, 12), `RF1 ${host} (T5: today refused on cells 16,385 > 16,384)`);
      const day = await dayOf(s);
      expect(day.status, `RF1 ${host}: the wide day answers: ${JSON.stringify(day.body).slice(0, 200)}`).toBe(200);
      const grids = (day.body.report as { grids: Record<string, Record<string, { items: Record<string, Record<string, unknown>> }>> }).grids;
      const perSlot = Object.fromEntries(Object.entries(grids).map(([slot, policies]) => [slot, Math.max(...Object.values(policies).map(p =>
        Object.values(p.items).reduce((n, levels) => n + Object.keys(levels).length, 0)))]));
      expect(Object.keys(perSlot).sort(), `RF1 ${host}: every slot's grid is reported`).toEqual([...SLOTS].sort());
      expect(Object.entries(perSlot).filter(([, n]) => n > 4096), `RF1 ${host}: no slot past the live table's 4,096 counters a policy (LearnStats.ts:38–39)`).toEqual([]);
      expect(bounds(s), `RF1 ${host}: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF1 ${host}: the open hour takes the same steps — an open hour of two pages answers current in the day, every step at most 64 MiB`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 open hour');
      const r = rng(104_104);
      await settleAt(s, at(12, 6));
      const objects = ledgerObjects(rowsOf(visitorsOf('open', 440).map(id => visit(registry, id, at(13) + Math.floor(r() * 25 * MIN), 22, r, FULL))), 500, 'b');
      const facts = hourFacts(objects, 13);
      expect(facts.bytes, 'the fixture: the open hour holds more than a page').toBeGreaterThan(16 * MiB);
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(13, 50));
      const day = await dayOf(s);
      expect(day.status, `RF1 ${host}: the day answers with its open hour: ${JSON.stringify(day.body).slice(0, 200)}`).toBe(200);
      const report = day.body.report as { hours?: { open?: Array<{ hour: number; status: string; refusal?: Json }> }; counts: { decisions: number } };
      const open = (report.hours?.open ?? []).find(h => h.hour === 13);
      expect(open ? { status: open.status, refusal: open.refusal ?? null } : 'not named',
        `RF1 ${host}: the open hour 13 (${(facts.bytes / MiB).toFixed(1)} MiB) is folded into its working aggregate on the same steps, not refused by a budget`).toEqual({ status: 'current', refusal: null });
      expect(report.counts.decisions, `RF1 ${host}: the day counts the open hour's decisions`).toBe(facts.decisions);
      expect(bounds(s), `RF1 ${host}: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    for (const [visitors, label] of [[8_333, 'the 100,000-a-day peak hour'], [22_000, 'a peak hour of 22,000 visitors']] as const) {
      it(`RF1 ${host}: ${label} (${visitors.toLocaleString('en')} visitors in one hour) folds on a fresh tenant in steps of at most 64 MiB — every merge and close among them — its leaves partitioned at a depth that keeps each within its rows bound, never refused by name (R-P684)`, async () => {
        const registry = retentionRegistry();
        const s = await stamp(host, documents(), registry, `P104.RF1 peak ${visitors}`);
        const r = rng(104_500 + visitors);
        // Written in batches of 500 visitors (as the queue writes it), so the test never holds the hour's ledger.
        const ids = visitorsOf(`peak${visitors}-`, visitors);
        let objects = 0, decisions = 0, bytes = 0;
        for (let i = 0; i < ids.length; i += 500) {
          const batch = ledgerObjects(rowsOf(ids.slice(i, i + 500).map(id => visit(registry, id, at(12) + Math.floor(r() * 35 * MIN), 22, r, FULL))), 500, `p${i}-`);
          const facts = hourFacts(batch, 12);
          objects += facts.objects; decisions += facts.decisions; bytes += facts.bytes;
          writeLedger(s, batch);
          batch.clear();
        }
        await settleAt(s, at(13, 6));
        const agg = aggregateOf(s, 12) as (Json & { objects: number; objectsRead: number; brands: Record<string, { decisions: number }> }) | null;
        const day = await dayOf(s);
        // R-P684 (RF1 as amended): these volumes never reach a step no partition depth brings within its bound, so the hour
        // folds — every object read and every decision counted; a refusal by name (the day naming fold_step_bound with the
        // hour missing) is not an answer here.
        const seen = agg !== null
          ? { hour: 'folded', objects: agg.objects, objectsRead: agg.objectsRead, decisions: agg.brands[TENANT]?.decisions }
          : { hour: refusedByName(day, 12) ? 'refused by name' : 'not folded, not named' };
        expect(seen, `RF1 ${host}: hour 12 (${(bytes / MiB).toFixed(0)} MiB of ledger in ${objects} objects, ${decisions} decisions) is folded, not refused by name (${JSON.stringify(day.body).slice(0, 160)})`)
          .toEqual({ hour: 'folded', objects, objectsRead: objects, decisions });
        expect(bounds(s), `RF1 ${host}: every step of the peak hour — its merges and its close among them — holds at most 64 MiB and reads at most a page`).toEqual([]);
      }, T);
    }

    it(`RF1 ${host}: a step past its bound is refused naming its step (fold_step_bound) — one visitor's ~30 MB of decisions in an open hour`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 fold_step_bound');
      const r = rng(104_105);
      await settleAt(s, at(12, 6));
      const objects = ledgerObjects(rowsOf([visit(registry, visitorsOf('bot', 1)[0]!, at(13, 1), 16_000, r, FULL)]), 400, 'b');
      expect(hourFacts(objects, 13).bytes, 'the fixture: one visitor\'s rows past a leaf\'s 8 MiB').toBeGreaterThan(24 * MiB);
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(13, 50));
      const day = await dayOf(s);
      expect(day.status, `RF1 ${host}: the day answers: ${JSON.stringify(day.body).slice(0, 200)}`).toBe(200);
      const open = ((day.body.report as { hours?: { open?: Array<{ hour: number; status: string; refusal?: Json }> } }).hours?.open ?? []).find(h => h.hour === 13);
      const refusal = open?.refusal ?? {};
      expect({ status: open?.status ?? 'not named', code: refusal.code ?? null, namesLeaf: Object.values(refusal).includes('leaf') },
        `RF1 ${host}: the leaf holding one visitor's rows past 8 MiB cannot split; the open hour names the refusal fold_step_bound and its step (${JSON.stringify(refusal)})`)
        .toEqual({ status: 'refused', code: 'fold_step_bound', namesLeaf: true });
      expect(bounds(s), `RF1 ${host}: the refusing step holds at most 64 MiB too`).toEqual([]);
    }, T);

    it(`RF1 ${host}: no closed hour left unfolded without a refusal stored that names it — one visitor's ~30 MB of decisions in closed hour 12 is refused fold_step_bound, the stored day names it, and it is still named after the next hour folds`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 closed fold_step_bound');
      const r = rng(104_106);
      // Hour 11 ordinary (the day exists), hour 12 one visitor no leaf can split, hour 13 ordinary again.
      writeLedger(s, ledgerObjects(rowsOf(visitorsOf('c11-', 40).map(id => visit(registry, id, at(11, 5) + Math.floor(r() * 30 * MIN), 6, r, FULL))), 200, 'c11-'));
      await settleAt(s, at(12, 6));
      const objects = ledgerObjects(rowsOf([visit(registry, visitorsOf('cbot', 1)[0]!, at(12, 1), 16_000, r, FULL)]), 400, 'cb');
      expect(hourFacts(objects, 12).bytes, 'the fixture: one visitor\'s rows past a leaf\'s 8 MiB, in closed hour 12').toBeGreaterThan(24 * MiB);
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(13, 6));
      const first = await dayOf(s);
      writeLedger(s, ledgerObjects(rowsOf(visitorsOf('c13-', 40).map(id => visit(registry, id, at(13, 5) + Math.floor(r() * 30 * MIN), 6, r, FULL))), 200, 'c13-'));
      await settleAt(s, at(14, 6));
      const later = await dayOf(s);
      expect({ status: first.status, folded: aggregateOf(s, 12) !== null, named: refusedByName(first, 12), laterStatus: later.status, stillNamed: refusedByName(later, 12), next: aggregateOf(s, 13) !== null },
        `RF1 ${host}: closed hour 12 cannot fold (one visitor past a leaf's 8 MiB of rows); the stored day names fold_step_bound with hour 12 missing, and does again once hour 13 has folded (${JSON.stringify(first.body).slice(0, 240)})`)
        .toEqual({ status: 200, folded: false, named: true, laterStatus: 200, stillNamed: true, next: true });
      expect(bounds(s), `RF1 ${host}: the refusing step holds at most 64 MiB too`).toEqual([]);
    }, T);

    it(`RF1 ${host}: the custom-policy day past a page is a job on the same steps, named by its day and policy — 202 naming the job and where its day is read, the same job named again, 202 with its progress while its steps run and 200 with the day only once they are done, its grids the hourly fold's learning grids, the day before its own job, every step at most 64 MiB`, async () => {
      const registry = retentionRegistry();
      vi.setSystemTime(at(-1, 50));
      const s = await stamp(host, documents({ stats: CENTURY }), registry, 'P104.RF1 custom-policy job');
      const day = customDay(registry);
      const facts = hourFacts(day.objects, 12), before = new Date(at(-1)).toISOString().slice(0, 10);
      expect({ bytes: facts.bytes > 16 * MiB, before: [...day.previous.keys()].length > 200 }, 'the fixture: the day holds more than 16 MiB of ledger, the day before more than 200 objects: each past one page')
        .toEqual({ bytes: true, before: true });
      writeLedger(s, day.previous);
      await settleAt(s, at(0, 6));
      writeLedger(s, day.early);
      await settleAt(s, at(1, 6));
      writeLedger(s, day.objects);
      day.objects.clear();
      await settleAt(s, day.settleAt);
      const ask = (date: string) => operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date, policies: [RAW_POLICY] }, day.postAt);
      const first = await ask(DATE), prior = await ask(before);
      const where = locationOf(first.body), whereBefore = locationOf(prior.body);
      const dated = (date: string) => new RegExp(`^/v1/${TENANT}/learn/report\\?(?:.*&)?date=${date}(?:&|$)`);
      expect({ status: first.status, where: dated(DATE).test(where ?? ''), before: prior.status, whereBefore: dated(before).test(whereBefore ?? '') },
        `RF1 ${host}: each custom-policy day past a page (${(facts.bytes / MiB).toFixed(1)} MiB; the day before's 211 objects) is accepted as a job naming where its day is read, GET /v1/${TENANT}/learn/report for that day (${JSON.stringify(first.body).slice(0, 200)})`)
        .toEqual({ status: 202, where: true, before: 202, whereBefore: true });
      const again = await ask(DATE);
      expect({ status: again.status, unnamed: stringsOf(first.body).filter(x => !stringsOf(again.body).includes(x)) },
        `RF1 ${host}: the same day and policy sent again names the same job (${JSON.stringify(again.body).slice(0, 200)})`).toEqual({ status: 202, unnamed: [] });
      // The day's job read before its steps run and after every step of the queue, until the queue is empty.
      const reads: Array<{ status: number; body: Json; delivered: number }> = [];
      let delivered = 0;
      const look = async () => { const r = await operator(s, 'GET', where!, undefined, day.postAt); reads.push({ status: r.status, body: r.body, delivered }); };
      await look();
      await drainStepwise(s, day.postAt, async () => { delivered++; await look(); });
      await settleAt(s, day.postAt);
      const done = await operator(s, 'GET', where!, undefined, day.postAt);
      expect(done.status, `RF1 ${host}: its steps done, its day answers 200: ${JSON.stringify(done.body).slice(0, 200)}`).toBe(200);
      const final = JSON.stringify(withoutIdentity(done.body.report as Json));
      const running = reads.filter(r => r.status === 202), answered = reads.filter(r => r.status === 200);
      expect({
        // 202 while its steps run — read before any step and between them — and 200 once they are done (by the queue's
        // deliveries or by a five-minute run after them).
        statuses: reads.every(r => r.status === 202 || r.status === 200),
        midJob: running.some(r => r.delivered > 0),
        // Its progress: the 202 answers' numbers (steps done, and what they are out of) move as the steps run and never fall.
        progress: progressMoves(running.map(r => r.body)),
        // Each 200 is the day as done, never an answer before the job is complete.
        everyDayDone: answered.every(r => JSON.stringify(withoutIdentity((r.body.report ?? {}) as Json)) === final),
      }, `RF1 ${host}: the job's read answers 202 with its progress while the steps run, then 200 with the day (${reads.length} reads over ${delivered} deliveries; 202 bodies ${JSON.stringify(running.slice(0, 3).map(r => r.body)).slice(0, 300)})`)
        .toEqual({ statuses: true, midJob: true, progress: true, everyDayDone: true });
      const folded = (await dayOf(s)).body.report as Json & { policies?: Array<{ role: string; credits: number }> };
      const learning = gridsOf(folded, 'learning');
      // Witness: every decision of the day is an exposure; each of the 460 visits' two clicks on a hero, and the click carried in from the day before, is a credit.
      expect({ exposures: exposures(learning), credits: folded.policies?.find(p => p.role === 'learning')?.credits },
        'PRECONDITION: the hourly fold\'s day counts every decision of the day and credits 2 x 460 + 1 clicks').toEqual({ exposures: facts.decisions, credits: 921 });
      expect(gridsOf(done.body.report as Json, RAW_POLICY.name), `RF1 ${host}: the job credits what the hourly fold credits: its grids under the request's policy (the learning policy's own definition) are the learning grids of the hourly fold's day`)
        .toEqual(learning);
      // The day before: its own job, named by its own day; its day that date's, its grids the hourly fold's of that date.
      const beforeDone = await operator(s, 'GET', whereBefore!, undefined, day.postAt);
      const beforeFolded = gridsOf((await dayOf(s, before)).body.report as Json, 'learning');
      expect({ status: beforeDone.status, date: (beforeDone.body.report as Json | undefined)?.date, exposures: exposures(beforeFolded) },
        `RF1 ${host}: the day before's job answers that day (${JSON.stringify(beforeDone.body).slice(0, 200)})`).toEqual({ status: 200, date: before, exposures: 211 });
      expect(gridsOf(beforeDone.body.report as Json, RAW_POLICY.name), `RF1 ${host}: the day before's job credits what the hourly fold credits that day`).toEqual(beforeFolded);
      expect(bounds(s), `RF1 ${host}: every step of the jobs holds at most 64 MiB and reads at most a page`).toEqual([]);
    }, T);
    it(`RF1 ${host}: a rebuild leaf past 8 MiB of rows splits by visitor hash (R-P684, finding 6c) — a day whose rows crowd one residue class (more than 10 MiB of its ledger) is rebuilt with no leaf reading more than 8 MiB of rows, every exposure and credit counted, every step at most 64 MiB`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF1 rebuild leaf rows');
      const r = rng(104_160);
      const witness = heroWitness();
      let crowded = 0, total = 0;
      // Hours 10–12: 200 visitors an hour in residue class 21 of today's visitor hash (the one leaf of a depth-0 partition),
      // 150 others spread over every class; each hour within a leaf's 8 MiB of rows on its own, the day not.
      for (const hour of [10, 11, 12]) {
        const crowd = visitorsOf(`crowd${hour}`, 200, 21).map(id => visit(registry, id, at(hour) + Math.floor(r() * 35 * MIN), 22, r, FULL));
        const spread = visitorsOf(`spread${hour}`, 150).map(id => visit(registry, id, at(hour) + Math.floor(r() * 35 * MIN), 22, r, FULL));
        witness.add([...crowd, ...spread]);
        const objects = ledgerObjects(rowsOf(crowd), 500, `c${hour}-`);
        for (const body of objects.values()) crowded += Buffer.byteLength(body);
        for (const [k, v] of ledgerObjects(rowsOf(spread), 500, `s${hour}-`)) objects.set(k, v);
        for (const body of objects.values()) total += Buffer.byteLength(body);
        writeLedger(s, objects);
        objects.clear();
        await settleAt(s, at(hour + 1, 6));
      }
      expect({ crowded: crowded > 10 * MiB, total: total > 16 * MiB }, `the fixture: residue class 21 holds ${(crowded / MiB).toFixed(1)} MiB of the day's ${(total / MiB).toFixed(1)} MiB of ledger (more than 10 MiB; the day past a page)`)
        .toEqual({ crowded: true, total: true });
      const first = s.steps.length;
      const rebuilt = await operator(s, 'POST', `/v1/${TENANT}/learn/generation`, { slot: 'home-hero', brand: BRAND, rebuildFrom: DATE }, at(13, 10));
      expect(rebuilt.status, `RF1 ${host}: the rebuild is accepted: ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBeLessThan(300);
      await settleAt(s, at(13, 10));
      const counters = await learned(s.m);
      expect({ n: rounded(counters, 'n'), s: rounded(counters, 's') }, `RF1 ${host}: the rebuilt day counts every exposure and credit`).toEqual(witness.expected());
      // A leaf is a step reading its sections of the pages' packs by byte range (reading 3); what it reads that way is its rows.
      const leaves = s.steps.slice(first).filter(step => step.rangedFromSteps);
      expect(leaves.length, 'PRECONDITION: the rebuild\'s leaves read their sections of the pages\' packs by range (reading 3)').toBeGreaterThan(0);
      expect(leaves.filter(step => step.rangedBytes > 8 * MiB).map(step => `${step.label}: ${(step.rangedBytes / MiB).toFixed(1)} MiB of rows`),
        `RF1 ${host}: no rebuild leaf reads more than 8 MiB of rows — a leaf past it splits by visitor hash (the widest read ${(Math.max(...leaves.map(step => step.rangedBytes)) / MiB).toFixed(1)} MiB)`).toEqual([]);
      expect(bounds(s), `RF1 ${host}: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF1 ${host}: what a date keeps is let go once the date no longer needs it (R-P684, finding 7) — over seven dates of the same traffic, each with a custom-policy day past a page, the five-minute run reads no more on the seventh date than on the fourth, and a visitor erased on the second date is held at rest by nothing outside the ledger and the erasure records`, async () => {
      const registry = retentionRegistry();
      vi.setSystemTime(at(0, 50));
      const s = await stamp(host, documents(), registry, 'P104.RF1 dates');
      const r = rng(104_170);
      const erased = visitorsOf('erased', 1)[0]!;
      const dateOf = (k: number) => new Date(at(24 * k)).toISOString().slice(0, 10);
      const idle: StepRecord[] = [];
      for (let k = 0; k < 7; k++) {
        // Each date: forty visitors at 02:05–02:35 (and on the first date the visitor erased on the second), one row an object, so
        // the date is past a page by its objects (more than 200) and its custom-policy day is a job (R-P615).
        const visits = visitorsOf(`d${k}`, 40).map(id => visit(registry, id, at(24 * k + 2, 5) + Math.floor(r() * 30 * MIN), 6, r, SMALL, `d${k}-`));
        if (k === 0) visits.push(visit(registry, erased, at(2, 10), 6, r, SMALL));
        const objects = ledgerObjects(rowsOf(visits), 1, `d${k}-`);
        expect(objects.size, 'the fixture: each date is past a page by its objects').toBeGreaterThan(200);
        vi.setSystemTime(at(24 * k + 2, 40));
        writeLedger(s, objects);
        objects.clear();
        await settleAt(s, at(24 * k + 3, 6));
        if (k === 1) expect((await operator(s, 'POST', `/v1/${TENANT}/ledger/erasures`, { visitorId: erased }, at(24 + 3, 8))).status, 'PRECONDITION: the erasure is recorded').toBe(200);
        const job = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: dateOf(k), policies: [RAW_POLICY] }, at(24 * k + 3, 10));
        expect(job.status, `PRECONDITION: ${dateOf(k)}'s custom-policy day, past a page, is a job (R-P615): ${JSON.stringify(job.body).slice(0, 160)}`).toBe(202);
        await drainQueue(s, at(24 * k + 3, 10));
        await settleAt(s, at(24 * k + 3, 10));
        const done = await operator(s, 'GET', locationOf(job.body)!, undefined, at(24 * k + 3, 12));
        expect(done.status, `PRECONDITION: ${dateOf(k)}'s job is done: ${JSON.stringify(done.body).slice(0, 160)}`).toBe(200);
        // Past the 15-minute grace, then one five-minute run with nothing due: what it reads is what the dates kept make it read.
        await settleAt(s, at(24 * k + 3, 31));
        idle.push(await fiveMinuteRun(s, at(24 * k + 3, 36)));
        await drainQueue(s, at(24 * k + 3, 36));
      }
      await settleAt(s, at(24 * 6 + 3, 56));
      const fourth = idle[3]!, seventh = idle[6]!;
      const grown = seventh.otherKeys.filter(key => !fourth.otherKeys.some(k => k.replace(/\d{4}-\d{2}-\d{2}/g, 'D') === key.replace(/\d{4}-\d{2}-\d{2}/g, 'D')));
      // Witness (RF1): a step's inputs are fixed whatever the traffic; the dates already folded are traffic. The run on the
      // seventh date makes no more storage calls and reads no more objects than on the fourth, its bytes within 1% (text of counters).
      expect({ calls: seventh.calls <= fourth.calls, reads: seventh.otherReads <= fourth.otherReads, bytes: seventh.otherBytes <= fourth.otherBytes * 1.01 },
        `RF1 ${host}: the five-minute run with nothing due on the 4th and the 7th date: ${fourth.calls} and ${seventh.calls} storage calls, ${fourth.otherReads} and ${seventh.otherReads} reads, ${(fourth.otherBytes / 1024).toFixed(0)} and ${(seventh.otherBytes / 1024).toFixed(0)} KiB (read on the 7th only, dates as D: ${grown.slice(0, 8).join(', ')})`)
        .toEqual({ calls: true, reads: true, bytes: true });
      // Witness (the erasure, src/ledger/erasure.ts: rows at or before it are hidden, then removed): five dates on, no object the
      // platform keeps but the ledger itself (the rewrite's) and the erasure's own records holds the erased visitor's rows.
      const holding = [...s.r2.objects.keys()].filter(key => !isLearningKey(key) && !key.startsWith('erasures/') && new RegExp(`${erased}(?![0-9])`).test(s.r2.text(key) ?? ''));
      expect(holding, `RF1 ${host}: no state, start-of-date record or job output keeps the erased visitor ${erased} at rest`).toEqual([]);
    }, T);
  }
});

// ===========================================================================
// unit:P104.RF2 — parity with today's fold, value for value
// ===========================================================================

describe('unit:P104.RF2 (E29: on the same records the result equals today\'s fold)', () => {
  for (const host of HOSTS) {
    it(`RF2 ${host}: scenario P (crossing visitors, duplicates across pages, a filed conflict, erasures, an expired stamp, a re-fold of a grown hour, an earlier hour folded after a later one) equals today's fold hour for hour and for the day`, async () => {
      const registry = retentionRegistry(3 * H);
      const s = await stamp(host, documents(), registry, 'P104.RF2 parity');
      const sc = scenarioP(registry);
      await play(s, sc);
      expect(s.answers.filter(a => a.method === 'POST').map(a => a.status), 'PRECONDITION: the conflict is filed (409) and both erasures recorded, as today').toEqual([409, 200, 200]);
      expect(await parity(s, 'P', sc), `RF2 ${host}: the aggregates of hours 10–14 and the day equal today's fold (fixtures/reference.json P)`).toEqual([]);
    }, T);
  }
});

// ===========================================================================
// unit:P104.RF3 — the commit: two conditional writes; no hour lost or counted twice
// ===========================================================================

const HOUR_AGGREGATE = /^aggregates\/[^/]+\/\d{4}-\d{2}-\d{2}\/\d{2}\.json$/;
/**
 * The commit's two crash points, once per hour: (i) the first queue message to reach an hour's aggregate write is cut
 * off there on every delivery it gets (whatever it wrote before it stays written; the platform gives the message up
 * and the five-minute run must find the hour again), and (ii) the first step whose aggregate write lands is cut off
 * right after it (between the two writes).
 */
function commitCrashes(): Fault {
  const armed = new Set<number>(), landed = new Set<string>(), held = new Map<string, string>();
  return ({ op, key, step }) => {
    if (armed.has(step.index)) { armed.delete(step.index); return 'cut'; }
    if (op !== 'put' || !HOUR_AGGREGATE.test(key)) return undefined;
    const message = /^message (m\d+) /.exec(step.label)?.[1];
    if (message && (!held.has(key) || held.get(key) === message)) { held.set(key, message); return 'cut'; }
    if (!landed.has(key)) { landed.add(key); armed.add(step.index); }
    return undefined;
  };
}

describe('unit:P104.RF3 (E29: an hour committed by two conditional writes; no hour lost or counted twice)', () => {
  for (const host of HOSTS) {
    it(`RF3 ${host}: a crash after every step, before the commit's first write and between its two writes leaves no hour lost and none counted twice (scenario C: hour 13's rings past today's 3.69 MiB)`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF3 crash');
      const sc = scenarioC(registry);
      const cut = commitCrashes();
      const plan: DeliveryPlan = { before: message => (message.attempts === 1 ? { dropAck: true, fault: cut } : { fault: cut }) };
      s.r2.fault = cut;
      await play(s, sc, plan);
      s.r2.fault = null;
      expect(await parity(s, 'C', sc), `RF3 ${host}: every step run twice, each hour's first commit given up at its aggregate write and the next cut right after it, the aggregates and the day equal today's fold (fixtures/reference.json C)`).toEqual([]);
      expect(bounds(s), `RF3 ${host}: the commit stages no copy of the state: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF3 ${host}: of two coordinators one wins and the other adopts or stops — every message delivered twice at once and the five-minute run run twice at once`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF3 coordinators');
      const sc = scenarioC(registry);
      const plan: DeliveryPlan = { before: () => ({ twice: true }) };
      for (const moment of sc.moments) {
        vi.setSystemTime(moment.at);
        if (moment.ledger) writeLedger(s, moment.ledger);
        for (const action of moment.actions ?? []) { await action(s); await drainQueue(s, moment.at, plan); }
        for (let i = 0; i < 30; i++) {
          const before = s.r2.journal.filter(j => !j.key.startsWith('warehouse/')).length;
          await Promise.all([fiveMinuteRun(s, moment.at), fiveMinuteRun(s, moment.at)]);
          await drainQueue(s, moment.at, plan);
          if (s.r2.journal.filter(j => !j.key.startsWith('warehouse/')).length === before) break;
        }
      }
      expect(await parity(s, 'C', sc), `RF3 ${host}: two coordinators at every step, the aggregates and the day equal today's fold`).toEqual([]);
    }, T);

    it(`RF3 ${host}: a newer hour waits while a plan is in flight — hour 12 held by its conflict until the operator files it at 14:20, hour 13 is folded after it`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF3 order');
      const sc = scenarioC(registry);
      const held: Scenario = { ...sc, moments: sc.moments.map(m => (m.at === at(13, 20) ? { at: at(14, 20), ...(m.actions ? { actions: m.actions } : {}) } : m))
        .sort((a, b) => a.at - b.at) };
      await play(s, held);
      await settleAt(s, at(14, 26));
      const firstWrite = (hour: number) => s.r2.journal.findIndex(j => j.op === 'put' && j.key === aggregateKey(DATE, hour));
      expect({ twelve: firstWrite(12) >= 0, thirteenAfterTwelve: firstWrite(13) > firstWrite(12) },
        `RF3 ${host}: hour 13's aggregate is first written after hour 12's commit (journal positions ${firstWrite(12)}, ${firstWrite(13)})`).toEqual({ twelve: true, thirteenAfterTwelve: true });
      expect(await parity(s, 'C', sc, false), `RF3 ${host}: and both hours equal today's fold of them in order (the day, built an hour later, decays to its own build time)`).toEqual([]);
    }, T);
    it(`RF3 ${host}: every message of an hour delivered again after its commit and after a collection (their acknowledgements lost, as the queue delivers at least once) leaves the committed hours as they were — the visitors' earlier decisions still credited in the next hour (R-P684, finding 2)`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF3 late redelivery');
      const r = rng(104_311);
      const ids = visitorsOf('late', 40);
      // Forty visitors at hour 10 and again at hour 11; at 12:40 each buys what its plp-banner showed it at hour 10 (the
      // slot learns purchases, whose window is 7 days, src/learn/policy.ts DEFAULT_POLICY).
      const h10 = ids.map(id => visit(registry, id, at(10, 5) + Math.floor(r() * 30 * MIN), 6, r, FULL, 'h10-'));
      writeLedger(s, ledgerObjects(rowsOf(h10), 200, 'l10-'));
      await settleAt(s, at(11, 6));
      writeLedger(s, ledgerObjects(rowsOf(ids.map(id => visit(registry, id, at(11, 5) + Math.floor(r() * 30 * MIN), 6, r, FULL, 'h11-'))), 200, 'l11-'));
      // Every message hour 11's fold sent, as first delivered (its body as the platform held it, never read here).
      const again: Queued[] = [];
      await settleAt(s, at(12, 6), { before: message => { if (message.attempts === 1) again.push({ id: `again-${message.id}`, body: structuredClone(message.body), attempts: 0 }); return undefined; } });
      const hour11 = s.r2.text(aggregateKey(DATE, 11));
      expect({ messages: again.length > 0, hour11: hour11 !== null }, 'PRECONDITION: hour 11 is folded by steps sent on the events queue').toEqual({ messages: true, hour11: true });
      // The next five-minute run collects what the fold no longer names (hour 10's outputs are past the 15-minute grace); then
      // every one of hour 11's messages is delivered again.
      await settleAt(s, at(12, 11));
      s.queue.push(...again);
      await drainQueue(s, at(12, 11));
      await settleAt(s, at(12, 16));
      const returning = h10.map((v, k) => outcomeRow({ visitor: v.visitor, ts: at(12, 40) + k * 1_000, event: 'purchase', item: v.decisions[2]!.item_id, nonce: `again-${v.visitor}` }, registry));
      writeLedger(s, ledgerObjects(returning, 200, 'l12-'));
      await settleAt(s, at(13, 6));
      const agg = aggregateOf(s, 12) as (Json & { brands: Record<string, { policies: Record<string, { credits: number }> }> }) | null;
      // Witness (creditedOf): each purchase names a piece its visitor's ring holds from hour 10.
      expect({ hour11: s.r2.text(aggregateKey(DATE, 11)) === hour11, credits: agg?.brands[TENANT]?.policies.learning?.credits ?? null },
        `RF3 ${host}: hour 11's ${again.length} messages delivered again after its commit change no committed hour: its aggregate as committed, and hour 12 credits its ${returning.length} purchases on hour 10's decisions`)
        .toEqual({ hour11: true, credits: creditedOf(returning) });
    }, T);
  }
});

// ===========================================================================
// unit:P104.RF4 — resume
// ===========================================================================

describe('unit:P104.RF4 (E29: a failed run resumes)', () => {
  for (const host of HOSTS) {
    it(`RF4 ${host}: a step cut off resumes from the outputs present — no ledger object a finished step read is read again; what cut-off steps left is collected after the 15-minute grace`, async () => {
      const registry = retentionRegistry();
      const sc = scenarioC(registry);
      const s = await stamp(host, documents(), registry, 'P104.RF4 resume');
      const h13 = hourPrefixOf(at(13)) + '/';
      let cutRead = -1, cutRun = -1, given: string | null = null;
      const fault: Fault = ({ op, key, step }) => {
        // The first five-minute run of 14:06 is cut off at its second write of the fold's (whatever it was writing: a plan, a
        // head), after one write it never named: the warehouse slice's schedule, which every run rewrites, is not counted.
        if (cutRun < 0 && step.kind === 'scheduled' && op === 'put' && !/^warehouse\//.test(key) && Date.now() === at(14, 6)
          && step.writes.filter(k => !/^warehouse\//.test(k)).length === 1) { cutRun = step.index; return 'cut'; }
        if (op !== 'get' || !key.startsWith(h13)) return undefined;
        // A queue message reading hour 13's ledger after another step finished reading it is cut off at its second object on
        // every delivery it gets: the platform gives it up, and the five-minute run must find what is missing.
        const message = /^message (m\d+) /.exec(step.label)?.[1] ?? null;
        if (given !== null) return message === given && step.ledgerObjects >= 1 ? 'cut' : undefined;
        if (step.ledgerObjects >= 1 && s.steps.some(r => r.index < step.index && r.outcome === 'done' && r.ledgerKeys.some(k => k.startsWith(h13)))) {
          cutRead = step.index; given = message ?? `run ${step.index}`; return 'cut';
        }
        return undefined;
      };
      s.r2.fault = fault;
      await play(s, sc);
      s.r2.fault = null;
      const resumed = await parity(s, 'C', sc);
      await settleAt(s, at(14, 50)); await settleAt(s, at(14, 55));
      expect(cutRead >= 0 ? 'cut' : 'never cut', 'PRECONDITION: a step reading hour 13\'s ledger after another one finished was cut off mid-page, on every delivery').toBe('cut');
      const before = new Set(s.steps.filter(r => r.index < cutRead && r.outcome === 'done').flatMap(r => r.ledgerKeys.filter(k => k.startsWith(h13))));
      const again = s.steps.filter(r => r.index > cutRead && r.outcome === 'done').flatMap(r => r.ledgerKeys.filter(k => before.has(k)));
      expect(again.length, `RF4 ${host}: only the missing steps re-run: ${again.length} reads of hour 13's ledger objects a finished step had already read`).toBe(0);
      expect(resumed, `RF4 ${host}: the resumed hours and their day equal today's fold`).toEqual([]);
      expect(cutRun >= 0 ? 'cut' : 'never cut', 'PRECONDITION: the five-minute run of 14:06 was cut off after a write of the fold\'s').toBe('cut');
      const cut = new Set(s.steps.filter(r => r.outcome === 'cut').map(r => r.index));
      const left = [...new Set(s.r2.journal.filter(j => j.op === 'put' && cut.has(j.step)).map(j => j.key))]
        .filter(key => s.r2.objects.has(key) && !s.r2.journal.some(j => j.key === key && !cut.has(j.step) && j.step > Math.min(...cut) && j.op === 'put'));
      expect(left, `RF4 ${host}: forty minutes on, nothing a cut-off step wrote is left unless a later step wrote it again (adopted)`).toEqual([]);
      expect(bounds(s), `RF4 ${host}: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF4 ${host}: LOCK — a catch-up after a gap of six hours takes no more five-minute runs than today's, which folds two closed hours a run`, async () => {
      const registry = retentionRegistry();
      vi.setSystemTime(at(5, 50));
      const s = await stamp(host, documents(), registry, 'P104.RF4 catch-up');
      // The platform ran until 06:06: every closed hour of the lookback is folded.
      await settleAt(s, at(6, 6));
      // Then no five-minute run for six hours, while the ledger kept being written: hours 6 to 11, twenty visitors each.
      const r = rng(104_401), gap = [6, 7, 8, 9, 10, 11];
      for (const hour of gap) {
        vi.setSystemTime(at(hour, 40));
        writeLedger(s, ledgerObjects(rowsOf(visitorsOf(`gap${hour}-`, 20).map(id => visit(registry, id, at(hour) + Math.floor(r() * 35 * MIN), 8, r, SMALL))), 200, 'b'));
      }
      // The runs resume at 12:06, five minutes apart, each followed by the queue it fed.
      let runs = 0;
      for (; runs < 10 && gap.some(hour => aggregateOf(s, hour) === null); runs++) { await fiveMinuteRun(s, at(12, 6 + 5 * runs)); await drainQueue(s, at(12, 6 + 5 * runs)); }
      // Witness: today's catch-up folds at most two closed hours a run (src/learn/hourly.ts catchUp, `opts.maxHours ?? 2`; src/index.ts's five-minute run passes none).
      expect({ folded: gap.filter(hour => aggregateOf(s, hour) !== null), withinToday: runs <= Math.ceil(gap.length / 2) },
        `RF4 ${host}: the six hours of the gap are folded within ${Math.ceil(gap.length / 2)} five-minute runs (it took ${runs})`).toEqual({ folded: gap, withinToday: true });
    }, T);

    it(`RF4 ${host}: a filed conflict re-runs only its own leaf — after the operator files it, hour 12's ledger is read only where the conflicting id is`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF4 conflict');
      const sc = scenarioC(registry);
      await play(s, sc, {}, at(13, 6));
      expect(aggregateOf(s, 12) === null ? 'waits' : 'folded', 'PRECONDITION: hour 12 waits on its conflict while it is not filed, as today (the fold files none)').toBe('waits');
      const filed = s.steps.length;
      await play(s, { ...sc, moments: sc.moments.filter(m => m.at > at(13, 6)) });
      expect(s.answers.find(a => a.method === 'POST')?.status, 'PRECONDITION: the operator\'s custom-policy POST files the conflict (409), as today').toBe(409);
      const h12 = hourPrefixOf(at(12)) + '/';
      const reread = [...new Set(s.steps.slice(filed).filter(r => r.kind !== 'request').flatMap(r => r.ledgerKeys.filter(k => k.startsWith(h12))))];
      const allowed = new Set(sc.conflictKeys);
      expect(reread.filter(k => !allowed.has(k)).length, `RF4 ${host}: after the filing the fold reads hour 12's ledger only at the two objects holding the conflicting id; it read ${reread.length} of its objects`).toBe(0);
      expect(await parity(s, 'C', sc), `RF4 ${host}: and hour 12 counts the filed conflict as today's fold does`).toEqual([]);
    }, T);

    it(`RF4 ${host}: a store today's code wrote (64 shards, hour 12's v2 plan interrupted) is finished by today's finishHour and continued by the staged fold with identical next-hour results`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF4 migration');
      const store = fixture<{ objects: Record<string, string> }>('v2-store.json').objects;
      for (const [key, body] of Object.entries(store)) s.r2.seed(key, body);
      const sc = scenarioM(registry);
      await play(s, sc);
      expect(await parity(s, 'M', sc), `RF4 ${host}: hour 12 finished from today's plan and hour 13 (two pages) folded on, both equal today's uninterrupted fold`).toEqual([]);
      expect(bounds(s), `RF4 ${host}: every step holds at most 64 MiB`).toEqual([]);
    }, T);
    it(`RF4 ${host}: a ledger object deleted after the hour is planned and before it is read (as the erasure rewrite deletes an object it empties) — the hour still folds without it and the next hour after it, nothing left in flight unnamed (R-P684, finding 3)`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF4 vanished object');
      const r = rng(104_411);
      writeLedger(s, ledgerObjects(rowsOf(visitorsOf('v11', 40).map(id => visit(registry, id, at(11, 5) + Math.floor(r() * 30 * MIN), 6, r, FULL))), 200, 'v11-'));
      await settleAt(s, at(12, 6));
      // Hour 12: forty visitors, and one visitor erased at 12:50 whose rows are objects of their own; the rewrite empties
      // (deletes) that visitor's decision object while the fold of hour 12 runs.
      const kept = ledgerObjects(rowsOf(visitorsOf('v12', 40).map(id => visit(registry, id, at(12, 5) + Math.floor(r() * 30 * MIN), 6, r, FULL))), 100, 'v12-');
      const erased = visitorsOf('gone', 1)[0]!;
      const gone = ledgerObjects(rowsOf([visit(registry, erased, at(12, 5), 6, r, FULL)]), 200, 'gone-');
      const victim = [...gone.keys()].find(k => k.includes('/decision/'))!;
      const facts = hourFacts(kept, 12);
      writeLedger(s, kept); writeLedger(s, gone);
      expect((await operator(s, 'POST', `/v1/${TENANT}/ledger/erasures`, { visitorId: erased }, at(12, 50))).status, 'PRECONDITION: the erasure is recorded').toBe(200);
      const h12 = hourPrefixOf(at(12)) + '/';
      let deleted = false;
      // At the first read of any of hour 12's objects — after the hour was listed — the victim is gone.
      s.r2.fault = ({ op, key }) => { if (!deleted && op === 'get' && key.startsWith(h12)) deleted = s.r2.drop(victim); return undefined; };
      await settleAt(s, at(13, 6));
      s.r2.fault = null;
      writeLedger(s, ledgerObjects(rowsOf(visitorsOf('v13', 40).map(id => visit(registry, id, at(13, 5) + Math.floor(r() * 30 * MIN), 6, r, FULL))), 200, 'v13-'));
      await settleAt(s, at(14, 6));
      await settleAt(s, at(14, 31));
      const agg = aggregateOf(s, 12) as (Json & { objects: number; objectsRead: number; brands: Record<string, { decisions: number }> }) | null;
      const day = await dayOf(s);
      // Witness: the erased visitor's rows at or before the erasure are hidden (src/ledger/erasure.ts hidden); the others are folded.
      expect({ deleted, hour11: aggregateOf(s, 11) !== null, hour12: agg === null ? 'not folded' : { everyObjectRead: agg.objectsRead === agg.objects, decisions: agg.brands[TENANT]?.decisions ?? 0 }, hour13: aggregateOf(s, 13) !== null },
        `RF4 ${host}: hour 12 folds from the objects still there, and hour 13 after it (the day: ${JSON.stringify(day.body).slice(0, 200)})`)
        .toEqual({ deleted: true, hour11: true, hour12: { everyObjectRead: true, decisions: facts.decisions }, hour13: true });
    }, T);
  }
});

// ===========================================================================
// unit:P104.RF5 — the day: summed one hour at a time, stored by slot, 200 past 8 MiB
// ===========================================================================

describe('unit:P104.RF5 (E29: the day summed one hour at a time and stored by slot, 200 past 8 MiB, never 413)', () => {
  for (const host of HOSTS) {
    it(`RF5 ${host}: a day whose grids pass 8 MiB answers 200 with the head and a slot index; GET ?slot= answers that slot's grid and reads only its part`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF5 by slot');
      const r = rng(104_201);
      const objects = ledgerObjects(rowsOf(visitorsOf('grid', 230).map(id => visit(registry, id, at(12) + Math.floor(r() * 35 * MIN), 22, r, { ...FULL, context: WIDE }))), 500, 'b');
      const facts = hourFacts(objects, 12);
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(13, 6));
      const built = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE });
      expect(built.status, `RF5 ${host}: the day is built, never 413: ${JSON.stringify(built.body).slice(0, 240)}`).toBe(200);
      await settleAt(s, at(13, 12));
      const whole = await dayOf(s);
      expect(whole.status, `RF5 ${host}: GET of the day answers 200: ${JSON.stringify(whole.body).slice(0, 240)}`).toBe(200);
      expect((whole.body.report as { counts: { decisions: number } }).counts.decisions, `RF5 ${host}: the head counts the day's ${facts.decisions} decisions (today: hour 12 refused on cells)`).toBe(facts.decisions);
      const text = JSON.stringify(whole.body), head = JSON.stringify({ ...whole.body, report: { ...(whole.body.report as Json), grids: undefined } });
      expect(Buffer.byteLength(text), `RF5 ${host}: the answer without a slot is within 8 MiB (outputBytes)`).toBeLessThanOrEqual(8 * MiB);
      // The slot index (its member is the builder's): a list in the answer, outside the grids, of exactly the day's slots.
      const lists = listsOfStrings({ ...(whole.body.report as Json), grids: undefined }).map(list => JSON.stringify([...list].sort()));
      expect(lists.includes(JSON.stringify([...SLOTS].sort())), `RF5 ${host}: the answer carries the slot index, exactly the day's ${SLOTS.length} slots (lists found: ${lists.join(' ').slice(0, 300)})`).toBe(true);
      void head;
      const stored = [...s.r2.objects.entries()].filter(([k]) => k.startsWith(`reports/${TENANT}/${BRAND}/${DATE}`)).reduce((n, [, v]) => n + v.bytes.length, 0);
      for (const slot of SLOTS) {
        const part = await dayOf(s, DATE, `&slot=${slot}`);
        expect(part.status, `RF5 ${host}: GET ?slot=${slot} answers: ${JSON.stringify(part.body).slice(0, 200)}`).toBe(200);
        const grid = ((part.body.report as { grids: Record<string, Record<string, unknown>> }).grids ?? {})[slot] ?? {};
        expect(Object.keys(grid).length, `RF5 ${host}: ?slot=${slot} carries the slot's grid under all five policies`).toBe(5);
        expect(part.record.otherBytes, `RF5 ${host}: ?slot=${slot} reads its slot's part (at most a quarter of the ${(stored / MiB).toFixed(1)} MiB the day's objects hold), not the whole day`).toBeLessThanOrEqual(stored / 4);
      }
    }, T);

    it(`RF5 ${host}: a 1,000,000-visitor day is built complete from 24 hours, summed one hour at a time — hours at the size content bounds them (T5's wide hour), 24 of them past today's 16 MiB`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF5 24 hours');
      const r = rng(104_202);
      const objects = ledgerObjects(rowsOf(visitorsOf('hour0', 80).map(id => visit(registry, id, at(0) + Math.floor(r() * 35 * MIN), 22, r, { ...FULL, context: WIDE }))), 500, 'b');
      const facts = hourFacts(objects, 0);
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(1, 6));
      const body = s.r2.text(aggregateKey(DATE, 0));
      expect(body === null ? 'not folded' : 'folded', 'PRECONDITION: hour 0 (T5\'s wide hour: 80 visitors, ten slots of ten pieces) is folded').toBe('folded');
      expect(Buffer.byteLength(body!) * 24, 'the fixture: 24 such hours hold more than 32 MiB of aggregate (today refuses 16 MiB: aggregateBytes)').toBeGreaterThan(32 * MiB);
      const hour0 = JSON.parse(body!) as Json & { from: number; to: number };
      const { leafDepth: _depth, ...legacy } = hour0; void _depth;
      for (let h = 1; h < 24; h++) s.r2.seed(aggregateKey(DATE, h), JSON.stringify({ ...legacy, hour: h, from: hour0.from + h * H, to: hour0.to + h * H }));
      s.steps.length = 0;
      const built = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE }, at(24, 10));
      expect(built.status, `RF5 ${host}: the day of 24 hours is built: ${JSON.stringify(built.body).slice(0, 240)}`).toBe(200);
      await settleAt(s, at(24, 12));
      const day = await dayOf(s);
      const report = day.body.report as { counts: { decisions: number }; hours: { built: number[] }; coverage: { missingHours: number[]; truncatedHours: number[] } };
      expect({ status: day.status, built: report?.hours?.built?.length, missing: report?.coverage?.missingHours, truncated: report?.coverage?.truncatedHours, decisions: report?.counts?.decisions },
        `RF5 ${host}: the day is complete: 24 hours built, none missing or truncated, every hour's decisions counted`)
        .toEqual({ status: 200, built: 24, missing: [], truncated: [], decisions: 24 * facts.decisions });
      expect(bounds(s), `RF5 ${host}: the day step holds one aggregate and the running total: at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF5 ${host}: no hour refused by volume leaves the day incomplete — scenario C's day (today: hour 13 missing) is complete and equals today's fold`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF5 complete');
      const sc = scenarioC(registry);
      await play(s, sc);
      const day = await dayOf(s);
      const report = day.body.report as { coverage?: { status: string; missingHours: number[]; truncatedHours: number[] }; hours?: { built: number[] } } | undefined;
      const coverage = report?.coverage;
      expect({ status: day.status, built: [12, 13].filter(h => report?.hours?.built.includes(h)), missing: coverage?.missingHours, truncated: coverage?.truncatedHours, incomplete: coverage?.status === 'incomplete' },
        `RF5 ${host}: the day of hours 12 and 13 is complete: both built, none missing or truncated`).toEqual({ status: 200, built: [12, 13], missing: [], truncated: [], incomplete: false });
      expect(await parity(s, 'C', sc), `RF5 ${host}: and equals today's fold`).toEqual([]);
    }, T);

    it(`RF5 ${host}: LOCK — an old single-JSON day still reads (report.ts:388–398), whole and by slot, as today`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF5 old day');
      const old = fixture<{ key: string; body: string; whole: Json; slot: Json }>('old-day.json');
      s.r2.seed(old.key, old.body);
      vi.setSystemTime(at(10, 6));
      const whole = await dayOf(s), slot = await dayOf(s, DATE, '&slot=home-hero&limit=5');
      expect({ whole: whole.status, slot: slot.status }, `RF5 ${host}: both reads answer`).toEqual({ whole: 200, slot: 200 });
      expect(whole.body, `RF5 ${host}: the old day reads as today's reader read it`).toEqual(old.whole);
      expect(slot.body, `RF5 ${host}: its slot page as today's`).toEqual(old.slot);
    }, T);
    it(`RF5 ${host}: the canonical POST during an open hour answers, and stores, the day the run published — the open hour's credits counted, never a refold from rings the steps no longer keep (R-P684, finding 4)`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF5 canonical POST, open hour');
      const r = rng(104_888);
      const visits = visitorsOf('o11', 40).map(id => visit(registry, id, at(11, 5) + Math.floor(r() * 30 * MIN), 6, r, FULL));
      writeLedger(s, ledgerObjects(rowsOf(visits), 200, 'o11-'));
      await settleAt(s, at(12, 6));
      // Open hour 12: each visitor adds to bag what its pdp-story showed it at hour 11 (the slot learns add to bag, window 6 hours).
      const late = visits.map((v, k) => outcomeRow({ visitor: v.visitor, ts: at(12, 10) + k * 1_000, event: 'add_to_cart', item: v.decisions[4]!.item_id, nonce: `late-${v.visitor}` }, registry));
      writeLedger(s, ledgerObjects(late, 200, 'o12-'));
      await settleAt(s, at(12, 20));
      const credits = (body: Json) => ((body.report as { policies?: Array<{ role: string; credits: number }> } | undefined)?.policies ?? []).find(p => p.role === 'learning')?.credits ?? null;
      const before = await dayOf(s);
      const posted = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE }, at(12, 21));
      const after = await operator(s, 'GET', `/v1/${TENANT}/learn/report?date=${DATE}`, undefined, at(12, 21));
      // Witness (creditedOf): hour 11's credited outcomes and the open hour's forty adds to bag.
      const expected = creditedOf([...rowsOf(visits), ...late]);
      expect({ stored: credits(before.body), post: credits(posted.body), storedAfter: credits(after.body) },
        `RF5 ${host}: the stored day, the canonical POST's answer and the day it stores credit hour 11's outcomes and the open hour's ${late.length} (POST ${posted.status})`)
        .toEqual({ stored: expected, post: expected, storedAfter: expected });
    }, T);

    it(`RF5 ${host}: an inline custom-policy day after a full day before (100 MiB, more than 50,000 decisions) answers 200, never 413, and its carry-in keeps the latest 50,000 decisions — a click at 00:05 on a decision of 23:55 the day before is credited (R-P684, finding 5)`, async () => {
      const registry = retentionRegistry();
      vi.setSystemTime(at(1, 10));
      const s = await stamp(host, documents(), registry, 'P104.RF5 inline carry-in');
      const r = rng(104_555);
      // The day before: 2,300 visitors over its hours 0–22, 22 decisions each (50,600 decisions), then one visitor's hero at 23:55.
      const ids = visitorsOf('prev', 2_300);
      let bytes = 0, decisions = 0;
      for (let i = 0; i < ids.length; i += 500) {
        const batch = ledgerObjects(rowsOf(ids.slice(i, i + 500).map((id, k) => visit(registry, id, at(-24 + ((i + k) % 23)) + Math.floor(r() * 35 * MIN), 22, r, FULL))), 500, `pv${i}-`);
        for (const [key, body] of batch) { bytes += Buffer.byteLength(body); if (key.includes('/decision/')) decisions += body.split('\n').filter(Boolean).length; }
        writeLedger(s, batch);
        batch.clear();
      }
      const carry = 'carry-late', cell = { channel: 'direct', visit_bucket: '1', region: 'US-NY' };
      writeLedger(s, ledgerObjects([decisionRow({ visitor: carry, ts: at(-1, 55), page: 'home', slot: 'home-hero', item: 'home-hero.7', cell }, registry)], 500, 'c'));
      // The day: the carried-in click at 00:05, and twenty visitors at 00:10–00:40 (within a page).
      const today = visitorsOf('today', 20).map(id => visit(registry, id, at(0, 10) + Math.floor(r() * 30 * MIN), 6, r, FULL));
      writeLedger(s, ledgerObjects([outcomeRow({ visitor: carry, ts: at(0, 5), event: 'content_click', item: 'home-hero.7', nonce: `${carry}-click` }, registry), ...rowsOf(today)], 500, 't0-'));
      expect({ bytes: bytes > 96 * MiB, decisions: decisions > 50_000 }, `the fixture: the day before holds ${(bytes / MiB).toFixed(1)} MiB of ledger and ${decisions} decisions`).toEqual({ bytes: true, decisions: true });
      const posted = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE, policies: [RAW_POLICY] }, at(1, 10));
      // Witness: each of today's visits' click on its hero 30 s after it, and the carried-in click on the hero of 23:55.
      const expected: Record<string, number> = { 'home-hero.7': 1 };
      for (const v of today) expected[v.decisions[0]!.item_id] = (expected[v.decisions[0]!.item_id] ?? 0) + 1;
      expect({ status: posted.status, credits: posted.status === 200 ? gridCredits(posted.body.report as Json, 'home-hero', RAW_POLICY.name) : null },
        `RF5 ${host}: the custom-policy day within a page answers inline as before, the day before carried in from its latest decisions (${JSON.stringify(posted.body).slice(0, 200)})`)
        .toEqual({ status: 200, credits: expected });
    }, T);
  }
});

// ===========================================================================
// unit:P104.RF6 — the W24 rebuild: the 200-entry ring, the previous day's carry-in, the one credit rule
// ===========================================================================

const RAW = { name: 'p104-day', scope: 'session', match: 'direct', credit: 'last' };
/** A slot's credited outcomes (s) at the root level of a day report's grid under one policy, rounded; zeros left out. */
function gridCredits(report: Json | undefined, slot: string, policy: string): Record<string, number> {
  const items = ((report?.grids as Record<string, Record<string, { items: Record<string, Record<string, { s: number }>> }>> | undefined)?.[slot]?.[policy]?.items) ?? {};
  return Object.fromEntries(Object.entries(items).map(([item, levels]) => [item, Math.round(levels['*']?.s ?? 0)] as const).filter(([, v]) => v !== 0));
}

describe('unit:P104.RF6 (E29: the W24 rebuild with the 200-entry ring and the previous day\'s carry-in, as the hourly fold and live learning)', () => {
  for (const host of HOSTS) {
    it(`RF6 ${host}: the rebuild credits what live learning, the hourly fold and the custom-policy day credit — a click carried in from the day before, none on a decision 400 decisions old`, async () => {
      const registry = retentionRegistry();
      vi.setSystemTime(at(-1, 50));
      const s = await stamp(host, documents(), registry, 'P104.RF6 ring and carry-in');
      vi.setSystemTime(at(-1, 55));
      const a = await shopperOn(s.m);
      const aPage = await a.snapshot('home');
      const aHero = aPage.decisions.find(d => d.slot === 'home-hero')!;
      await drainQueue(s, at(-1, 55));
      vi.setSystemTime(at(0, 5));
      expect((await a.click(aPage, aHero)).status, 'PRECONDITION: the carried-in click is accepted').toBe(200);
      await drainQueue(s, at(0, 5));
      vi.setSystemTime(at(1, 0));
      const b = await shopperOn(s.m);
      const bPage = await b.snapshot('home');
      const bHero = bPage.decisions.find(d => d.slot === 'home-hero' && d.contentId !== aHero.contentId)!;
      for (let i = 0; i < 50; i++) { vi.setSystemTime(at(1, 1, i)); await b.snapshot('pdp'); }
      await drainQueue(s, at(1, 2));
      vi.setSystemTime(at(1, 30));
      expect((await b.click(bPage, bHero)).status, 'PRECONDITION: the click on the piece of the old decision is accepted').toBe(200);
      await drainQueue(s, at(1, 30));
      expect(bHero, 'the fixture: the second shopper clicks a piece other than the first one\'s, so the grid tells the two clicks apart').toBeDefined();
      const live = rounded(await learned(s.m), 's');
      const expected = { [aHero.contentId]: 1 };
      expect(live, `PRECONDITION ${host}: live learning credited the carried-in click and not the click on the decision its 200-entry ring no longer holds`).toEqual(expected);
      await settleAt(s, at(2, 6));
      const day = await dayOf(s, DATE);
      expect(gridCredits(day.body.report as Json, 'home-hero', 'learning'), `${host}: the hourly fold credits the same (48-hour ring of 200)`).toEqual(expected);
      const custom = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE, policies: [RAW] }, at(2, 8));
      await drainQueue(s, at(2, 8));
      expect(gridCredits(custom.body.report as Json, 'home-hero', RAW.name), `RF6 ${host}: the custom-policy day credits the same outcomes (${custom.status})`).toEqual(expected);
      const rebuilt = await operator(s, 'POST', `/v1/${TENANT}/learn/generation`, { slot: 'home-hero', brand: BRAND, rebuildFrom: DATE }, at(2, 10));
      expect(rebuilt.status, `RF6 ${host}: the rebuild is accepted: ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBeLessThan(300);
      await settleAt(s, at(2, 10));
      expect(rounded(await learned(s.m), 's'), `RF6 ${host}: the rebuild folds with the 200-entry ring and the previous day's carry-in: the carried-in click credited, the click on the 400-decision-old one not`).toEqual(expected);
    }, T);

    it(`RF6 ${host}: LOCK behind P103 — one credit rule with P103's money rule: live learning, the hourly fold, the custom-policy day and the rebuild credit a EUR purchase and refuse a GBP one alike`, async () => {
      const registry = retentionRegistry();
      vi.setSystemTime(at(2, 50));
      // A horizon of a hundred years (P103's own fixture): decay moves nothing between the live sum and the offline ones taken an hour later.
      const docs = documents({ money: { currency: 'EUR', nonpositive: 'refuse' }, stats: { n0: 30, tauLearnMs: 3_153_600_000_000, liftMin: 0.5, liftMax: 2, nMin: 30 } },
        { 'checkout-upsell': { reward: 'purchase', objective: 'revenue' } });
      const s = await stamp(host, docs, registry, 'P104.RF6 money');
      const read = await operator(s, 'GET', '/content/learn');
      const published = JSON.stringify(read.body);
      expect(published.includes('"money"') && published.includes('"EUR"'), `RF6 ${host}: PRECONDITION P103 — the learn document's money member { currency, nonpositive } (P103.MP1) is published and read back: ${published.slice(0, 160)}`).toBe(true);
      vi.setSystemTime(at(3, 0));
      const c = await shopperOn(s.m);
      expect((await c.action(PAGE_VIEW)).status, 'PRECONDITION: the shopper\'s page view is accepted').toBe(200);
      const page = await c.snapshot('checkout');
      const pieces = page.decisions.filter(d => d.slot === 'checkout-upsell');
      vi.setSystemTime(at(3, 2));
      const productOf = (contentId: string) => featuredProduct('checkout-upsell', Number(contentId.split('.').pop()))!;
      // As the data layer sends a purchase (P103's own fixture, src/units/P103: orderId, value, margin, currency, items).
      const buy = (contentId: string, value: number, currency: string) => c.action({ type: 'purchase', data: { orderId: `p104-${contentId}`, value, margin: Math.round(value * 0.4), currency,
        items: [{ productId: productOf(contentId), quantity: 1, price: value }] } });
      expect([(await buy(pieces[0]!.contentId, 120, 'EUR')).status, (await buy(pieces[1]!.contentId, 80, 'GBP')).status], 'PRECONDITION: both purchases are accepted').toEqual([200, 200]);
      await drainQueue(s, at(3, 2));
      const expected = { [pieces[0]!.contentId]: 120 };
      const live = Object.fromEntries(Object.entries(rounded(await learned(s.m), 's')).filter(([item]) => item.startsWith('checkout-upsell.')));
      expect(live, `RF6 ${host}: live learning credits the EUR purchase by its value and refuses the GBP one`).toEqual(expected);
      await settleAt(s, at(4, 6));
      const day = await dayOf(s, DATE);
      expect(gridCredits(day.body.report as Json, 'checkout-upsell', 'learning'), `RF6 ${host}: the hourly fold credits the same`).toEqual(expected);
      const custom = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE, policies: [RAW] }, at(4, 8));
      await drainQueue(s, at(4, 8));
      expect(gridCredits(custom.body.report as Json, 'checkout-upsell', RAW.name), `RF6 ${host}: the custom-policy day credits the same`).toEqual(expected);
      const rebuilt = await operator(s, 'POST', `/v1/${TENANT}/learn/generation`, { slot: 'checkout-upsell', brand: BRAND, rebuildFrom: DATE }, at(4, 10));
      expect(rebuilt.status, `RF6 ${host}: the rebuild is accepted: ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBeLessThan(300);
      await settleAt(s, at(4, 10));
      const after = Object.fromEntries(Object.entries(rounded(await learned(s.m), 's')).filter(([item]) => item.startsWith('checkout-upsell.')));
      expect(after, `RF6 ${host}: the rebuild credits the same`).toEqual(expected);
    }, T);

    it(`RF6 ${host}: R-P604 — an SDK retry batched with an event 20 s older, its copy sorting first: the open and the closed hour, the rebuild and the custom-policy day's job on a day past a page keep the earliest-born copy and credit what live learning took`, async () => {
      const registry = retentionRegistry();
      vi.setSystemTime(at(1, 50));
      // The direct outcome path (each delivery admitted again with its own stamps); P103's horizon of a hundred years.
      const docs = documents({ stats: CENTURY }, { 'checkout-upsell': { reward: 'purchase', objective: 'revenue' } });
      const s = await stamp(host, docs, registry, 'P104.RF6 retry order', { recovery: false });
      // The day past a page: other visitors' traffic at hour 1 on the nine other slots (none on checkout-upsell), so the rebuild takes the staged steps.
      const r = rng(104_302);
      const background = ledgerObjects(rowsOf(visitorsOf('order', 460).map(id => visit(registry, id, at(1) + Math.floor(r() * 35 * MIN), 22, r, { ...FULL, slots: SLOTS.filter(x => x !== 'checkout-upsell') }))), 500, 'b');
      const bytes = hourFacts(background, 1).bytes;
      expect(bytes, 'the fixture: the day holds more than 16 MiB of ledger').toBeGreaterThan(16 * MiB);
      writeLedger(s, background);
      background.clear();
      await settleAt(s, at(2, 6));
      vi.setSystemTime(at(3, 0));
      const c = await shopperOn(s.m);
      expect((await c.action(PAGE_VIEW)).status, 'PRECONDITION: the shopper\'s page view is accepted').toBe(200);
      const pieces = (await c.snapshot('checkout')).decisions.filter(d => d.slot === 'checkout-upsell');
      const productOf = (contentId: string) => featuredProduct('checkout-upsell', Number(contentId.split('.').pop()))!;
      // The wire body as the SDK sends it and sends it again: a retry carries its first event id and time (src/routes/realtime.ts:143-146).
      const send = async (wire: Json) => {
        const response = await s.m.fetch(new Request('https://shop.invalid/realtime/action', { method: 'POST',
          headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: c.grant.capability, 'Content-Type': 'application/json' }, body: JSON.stringify(wire) }));
        await s.m.drain();
        return response.status;
      };
      const event = (type: string, data: Json, timestamp = Date.now()): Json => ({ type, data, source: 'sdk', userId: c.grant.subject, sessionId: c.grant.sessionId, timestamp, eventId: crypto.randomUUID() });
      const purchaseOf = (contentId: string, value: number) => event('purchase', { orderId: `p104-order-${contentId}`, value, margin: Math.round(value * 0.4), currency: 'EUR',
        items: [{ productId: productOf(contentId), quantity: 1, price: value }] });
      vi.setSystemTime(at(3, 2));
      const first = purchaseOf(pieces[0]!.contentId, 575);
      expect(await send(first), 'PRECONDITION: the EUR purchase is accepted, under no money policy').toBe(200);
      await drainQueue(s, at(3, 2));
      vi.setSystemTime(at(3, 3));
      const published = await putDocument(s.m, 'learn', { ...(docs.learn as Json), money: { currency: 'EUR', nonpositive: 'refuse' } }, 'P104 R-P604: EUR after the first delivery');
      const read = JSON.stringify((await operator(s, 'GET', '/content/learn')).body);
      expect({ status: published.status, money: read.includes('"money"') && read.includes('"EUR"') },
        `RF6 ${host}: PRECONDITION P103 — the learn document's money member { currency, nonpositive } (P103.MP1) is published and read back: ${read.slice(0, 160)}`).toEqual({ status: 200, money: true });
      vi.setSystemTime(at(3, 4));
      const older = event('add_to_cart', { productId: productOf(pieces[2]!.contentId), price: 375, quantity: 1 }, (first.timestamp as number) - 20_000);
      const fresh = purchaseOf(pieces[1]!.contentId, 120);
      expect([await send(older), await send(first), await send(fresh)], 'PRECONDITION: the older event, the retry and a new EUR purchase are accepted').toEqual([200, 200, 200]);
      await drainBatch(s, at(3, 4));
      // The fixture: the batch's ledger object begins at the older event's time, so it sorts before the first delivery's.
      const outcomeObjects = [...s.r2.objects.keys()].filter(k => k.startsWith(hourPrefixOf(at(3)) + '/') && k.includes('/outcome/')).sort()
        .map(k => (s.r2.text(k) ?? '').split('\n').filter(Boolean).map(line => String((JSON.parse(line) as { event_id?: unknown }).event_id)));
      expect(outcomeObjects.map(ids => ids.includes(first.eventId as string)), 'the fixture: the retry\'s copy is in the first object of the hour, the first delivery\'s in the second')
        .toEqual([true, true]);
      expect(outcomeObjects[0]!.includes(older.eventId as string) && !outcomeObjects[1]!.includes(older.eventId as string), 'the fixture: the older event is batched with the retry').toBe(true);
      // Witness: live learning took the 575 purchase under no policy — refused on the revenue slot for its currency (money_policy_unset) —
      // and its retry is that outcome under its first stamp (P103 R-P588); the new purchase is credited 120 under EUR (P103 MP2).
      const expected = { [pieces[1]!.contentId]: 120 };
      const upsell = (held: Record<string, number>) => Object.fromEntries(Object.entries(held).filter(([item]) => item.startsWith('checkout-upsell.')));
      expect(upsell(rounded(await learned(s.m), 's')), `RF6 ${host}: live learning credits the new purchase and refuses the retried one, as it refused its first delivery`).toEqual(expected);
      await settleAt(s, at(3, 30));
      const open = await dayOf(s, DATE);
      expect(gridCredits(open.body.report as Json, 'checkout-upsell', 'learning'), `RF6 ${host}: the open hour's fold keeps the earliest-born copy of the retried purchase, not the copy read first (${open.status})`).toEqual(expected);
      await settleAt(s, at(4, 6));
      const day = await dayOf(s, DATE);
      expect(gridCredits(day.body.report as Json, 'checkout-upsell', 'learning'), `RF6 ${host}: the closed hour's fold keeps the earliest-born copy (${day.status})`).toEqual(expected);
      const rebuilt = await operator(s, 'POST', `/v1/${TENANT}/learn/generation`, { slot: 'checkout-upsell', brand: BRAND, rebuildFrom: DATE }, at(4, 8));
      expect(rebuilt.status, `RF6 ${host}: the rebuild of a ${(bytes / MiB).toFixed(1)} MiB day is accepted: ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBeLessThan(300);
      await settleAt(s, at(4, 8));
      expect(upsell(rounded(await learned(s.m), 's')), `RF6 ${host}: the rebuild keeps the earliest-born copy`).toEqual(expected);
      const job = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE, policies: [RAW] }, at(4, 10));
      const where = locationOf(job.body);
      expect({ status: job.status, where }, `RF6 ${host}: the custom-policy day of the ${(bytes / MiB).toFixed(1)} MiB day is a job naming where its day is read (R-P615): ${JSON.stringify(job.body).slice(0, 200)}`)
        .toEqual({ status: 202, where: expect.stringMatching(new RegExp(`^/v1/${TENANT}/learn/report\\?(?:.*&)?date=${DATE}(?:&|$)`)) });
      await settleAt(s, at(4, 10));
      const jobDay = await operator(s, 'GET', where!, undefined, at(4, 12));
      expect(gridCredits(jobDay.body.report as Json, 'checkout-upsell', RAW.name), `RF6 ${host}: the custom-policy day's job keeps the earliest-born copy (${jobDay.status})`).toEqual(expected);
      expect(bounds(s), `RF6 ${host}: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF6 ${host}: R-P629 — a copy stamped by the producer past the ring's bound, sorting first, beside the ring-stamped copy of the same outcome: the open and the closed hour, the rebuild and the custom-policy day's job on a day past a page keep the ring-stamped copy, then the earliest-born, and credit what live learning took`, async () => {
      // P103's bound on the direct path's wait for the ring's decision (R-P629 (1), its R18), read through the module namespace.
      const bound = (learnRoute as unknown as Record<string, unknown>).RING_DECISION_BOUND_MS;
      expect(typeof bound === 'number' && bound > 0 ? 'bounded' : String(bound), `RF6 ${host}: PRECONDITION P103 (R-P629) — the direct path's wait for the ring is bounded by RING_DECISION_BOUND_MS, exported from src/learn/route.ts`).toBe('bounded');
      const registry = retentionRegistry();
      vi.setSystemTime(at(1, 50));
      const docs = documents({ stats: CENTURY }, { 'checkout-upsell': { reward: 'purchase', objective: 'revenue' } });
      const s = await stamp(host, docs, registry, 'P104.RF6 ring-stamped copy', { recovery: false });
      const r = rng(104_303);
      const background = ledgerObjects(rowsOf(visitorsOf('stamp', 460).map(id => visit(registry, id, at(1) + Math.floor(r() * 35 * MIN), 22, r, { ...FULL, slots: SLOTS.filter(x => x !== 'checkout-upsell') }))), 500, 'b');
      const bytes = hourFacts(background, 1).bytes;
      expect(bytes, 'the fixture: the day holds more than 16 MiB of ledger').toBeGreaterThan(16 * MiB);
      writeLedger(s, background);
      background.clear();
      await settleAt(s, at(2, 6));
      vi.setSystemTime(at(3, 0));
      const c = await shopperOn(s.m);
      expect((await c.action(PAGE_VIEW)).status, 'PRECONDITION: the shopper\'s page view is accepted').toBe(200);
      const pieces = (await c.snapshot('checkout')).decisions.filter(d => d.slot === 'checkout-upsell');
      const productOf = (contentId: string) => featuredProduct('checkout-upsell', Number(contentId.split('.').pop()))!;
      const send = async (wire: Json) => {
        const response = await s.m.fetch(new Request('https://shop.invalid/realtime/action', { method: 'POST',
          headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: c.grant.capability, 'Content-Type': 'application/json' }, body: JSON.stringify(wire) }));
        await s.m.drain();
        return response.status;
      };
      const event = (type: string, data: Json, timestamp = Date.now()): Json => ({ type, data, source: 'sdk', userId: c.grant.subject, sessionId: c.grant.sessionId, timestamp, eventId: crypto.randomUUID() });
      const purchaseOf = (contentId: string, value: number) => event('purchase', { orderId: `p104-stamp-${contentId}`, value, margin: Math.round(value * 0.4), currency: 'EUR',
        items: [{ productId: productOf(contentId), quantity: 1, price: value }] });
      vi.setSystemTime(at(3, 2));
      const first = purchaseOf(pieces[0]!.contentId, 575);
      const older = event('add_to_cart', { productId: productOf(pieces[2]!.contentId), price: 375, quantity: 1 }, (first.timestamp as number) - 20_000);
      // The purchase's first delivery, under no money policy, is held on its way to the ring past the bound: the action answers
      // within the bound and its record carries the producer's own stamp; it is batched with an event 20 s older, so its
      // ledger object sorts before every later one.
      const hold = holdRing(s.m, first.eventId as string);
      try {
        expect(await send(older), 'PRECONDITION: the older event is accepted').toBe(200);
        const answered = await Promise.race([send(first).then(status => ({ status })),
          new Promise<string>(resolve => { setTimeout(() => resolve('no answer'), (bound as number) + 500); })]);
        expect(answered, `PRECONDITION P103 (R-P629): with the ring held, the purchase is answered within the ring's bound (${String(bound)} ms) and 500 ms more`).toEqual({ status: 200 });
        await drainBatch(s, at(3, 2));
        vi.setSystemTime(at(3, 3));
        const published = await putDocument(s.m, 'learn', { ...(docs.learn as Json), money: { currency: 'EUR', nonpositive: 'refuse' } }, 'P104 R-P629: EUR after the first delivery');
        const read = JSON.stringify((await operator(s, 'GET', '/content/learn')).body);
        expect({ status: published.status, money: read.includes('"money"') && read.includes('"EUR"') },
          `RF6 ${host}: PRECONDITION P103 — the learn document's money member is published and read back: ${read.slice(0, 160)}`).toEqual({ status: 200, money: true });
        // The SDK's retry reaches the ring first and is decided under EUR, then the held delivery is let through.
        vi.setSystemTime(at(3, 4));
        const fresh = purchaseOf(pieces[1]!.contentId, 120);
        expect([await send(first), await send(fresh)], 'PRECONDITION: the retry and a new EUR purchase are accepted').toEqual([200, 200]);
      } finally { hold.release(); }
      await hold.done;
      await drainQueue(s, at(3, 4));
      // The fixture: the hour's first outcome object holds the producer-stamped copy, a later one the ring-stamped copy.
      const copies = [...s.r2.objects.keys()].filter(k => k.startsWith(hourPrefixOf(at(3)) + '/') && k.includes('/outcome/')).sort()
        .flatMap(k => (s.r2.text(k) ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line) as Json).filter(row => row.event_id === first.eventId)
          .map(row => (row.money_stamped_by === 'producer' ? 'producer' : 'ring')));
      expect(copies, 'the fixture: two copies of the purchase, the producer-stamped one first in key order (P103 R18 names the mark money_stamped_by)').toEqual(['producer', 'ring']);
      // Witness (P103 R-P629, its R18): the ring decided the retry first, under EUR, so live learning credited the 575
      // purchase by its value, once; and the new purchase 120.
      const expected = { [pieces[0]!.contentId]: 575, [pieces[1]!.contentId]: 120 };
      const upsell = (held: Record<string, number>) => Object.fromEntries(Object.entries(held).filter(([item]) => item.startsWith('checkout-upsell.')));
      expect(upsell(rounded(await learned(s.m), 's')), `RF6 ${host}: live learning credits the purchase once, under the stamp the ring decided, and the new one`).toEqual(expected);
      await settleAt(s, at(3, 30));
      const open = await dayOf(s, DATE);
      expect(gridCredits(open.body.report as Json, 'checkout-upsell', 'learning'), `RF6 ${host}: the open hour's fold keeps the ring-stamped copy, not the producer-stamped one read first (${open.status})`).toEqual(expected);
      await settleAt(s, at(4, 6));
      const day = await dayOf(s, DATE);
      expect(gridCredits(day.body.report as Json, 'checkout-upsell', 'learning'), `RF6 ${host}: the closed hour's fold keeps the ring-stamped copy (${day.status})`).toEqual(expected);
      const rebuilt = await operator(s, 'POST', `/v1/${TENANT}/learn/generation`, { slot: 'checkout-upsell', brand: BRAND, rebuildFrom: DATE }, at(4, 8));
      expect(rebuilt.status, `RF6 ${host}: the rebuild of a ${(bytes / MiB).toFixed(1)} MiB day is accepted: ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBeLessThan(300);
      await settleAt(s, at(4, 8));
      expect(upsell(rounded(await learned(s.m), 's')), `RF6 ${host}: the rebuild keeps the ring-stamped copy`).toEqual(expected);
      const job = await operator(s, 'POST', `/v1/${TENANT}/learn/report`, { date: DATE, policies: [RAW] }, at(4, 10));
      const where = locationOf(job.body);
      expect({ status: job.status, where }, `RF6 ${host}: the custom-policy day is a job naming where its day is read: ${JSON.stringify(job.body).slice(0, 200)}`)
        .toEqual({ status: 202, where: expect.stringMatching(new RegExp(`^/v1/${TENANT}/learn/report\\?(?:.*&)?date=${DATE}(?:&|$)`)) });
      await settleAt(s, at(4, 10));
      const jobDay = await operator(s, 'GET', where!, undefined, at(4, 12));
      expect(gridCredits(jobDay.body.report as Json, 'checkout-upsell', RAW.name), `RF6 ${host}: the custom-policy day's job keeps the ring-stamped copy (${jobDay.status})`).toEqual(expected);
      expect(bounds(s), `RF6 ${host}: every step holds at most 64 MiB`).toEqual([]);
    }, T);

    it(`RF6 ${host}: a day past today's caps (rawBytes 16 MiB) is rebuilt on the same steps — every exposure and credit counted, every step at most 64 MiB`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF6 rebuild at volume');
      const r = rng(104_301);
      let visits = visitorsOf('day', 460).map(id => visit(registry, id, at(12) + Math.floor(r() * 35 * MIN), 22, r, FULL));
      const objects = ledgerObjects(rowsOf(visits), 500, 'b');
      const facts = hourFacts(objects, 12);
      expect(facts.bytes, 'the fixture: the day holds more than 16 MiB of ledger').toBeGreaterThan(16 * MiB);
      // Witness: every home-hero decision is an exposure; each visit's click on its first piece (home-hero, 30 s later) is credited to that decision.
      const n: Record<string, number> = {}, credits: Record<string, number> = {};
      for (const v of visits) {
        for (const d of v.decisions) if (d.slot === 'home-hero') n[d.item_id] = (n[d.item_id] ?? 0) + 1;
        credits[v.decisions[0]!.item_id] = (credits[v.decisions[0]!.item_id] ?? 0) + 1;
      }
      visits = [];
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(13, 6));
      s.steps.length = 0;
      const rebuilt = await operator(s, 'POST', `/v1/${TENANT}/learn/generation`, { slot: 'home-hero', brand: BRAND, rebuildFrom: DATE }, at(13, 10));
      expect(rebuilt.status, `RF6 ${host}: the rebuild of a ${(facts.bytes / MiB).toFixed(1)} MiB day is accepted, not refused for capacity: ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBeLessThan(300);
      await settleAt(s, at(13, 10));
      const counters = await learned(s.m);
      expect({ n: rounded(counters, 'n'), s: rounded(counters, 's') }, `RF6 ${host}: every exposure and credit of the day counted`).toEqual({ n, s: credits });
      expect(bounds(s), `RF6 ${host}: the rebuild's steps hold at most 64 MiB each`).toEqual([]);
    }, T);
    it(`RF6 ${host}: a staged rebuild still running past a five-minute run's collection is applied, not collected — its steps held in the queue for twenty minutes after the first, every exposure and credit of the day counted (R-P684, finding 6a)`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF6 rebuild past a collection');
      const r = rng(104_301);
      const witness = heroWitness();
      const visits = visitorsOf('day', 460).map(id => visit(registry, id, at(12) + Math.floor(r() * 35 * MIN), 22, r, FULL));
      witness.add(visits);
      const objects = ledgerObjects(rowsOf(visits), 500, 'b');
      visits.length = 0;
      expect(hourFacts(objects, 12).bytes, 'the fixture: the day holds more than 16 MiB of ledger').toBeGreaterThan(16 * MiB);
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(13, 6));
      const rebuilt = await operator(s, 'POST', `/v1/${TENANT}/learn/generation`, { slot: 'home-hero', brand: BRAND, rebuildFrom: DATE }, at(13, 10));
      expect(rebuilt.status, `RF6 ${host}: the rebuild is accepted: ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBeLessThan(300);
      // Its first step is delivered at once; the others wait in the queue past the five-minute runs of 13:30 (twenty minutes).
      const held = s.queue.splice(1);
      expect(held.length + s.queue.length, 'PRECONDITION: the rebuild of a day past a page sends its steps on the events queue').toBeGreaterThan(1);
      await drainQueue(s, at(13, 10));
      await settleAt(s, at(13, 30));
      s.queue.push(...held);
      await drainQueue(s, at(13, 30));
      await settleAt(s, at(13, 31));
      await settleAt(s, at(13, 36));
      const counters = await learned(s.m);
      expect({ n: rounded(counters, 'n'), s: rounded(counters, 's') }, `RF6 ${host}: the rebuild is applied once its steps run, past the collection: every exposure and credit of the day counted`).toEqual(witness.expected());
    }, T);

    it(`RF6 ${host}: a rebuild step refused for its bound is the rebuild's refusal, never an hour's — the day before holding one visitor no leaf can split, the rebuilt date's day (its hour 0 still open) stays as its hours made it (R-P684, finding 6b)`, async () => {
      const registry = retentionRegistry();
      vi.setSystemTime(at(-3));
      const s = await stamp(host, documents(), registry, 'P104.RF6 refused rebuild step');
      const r = rng(104_620);
      // The day before: one visitor's ~30 MB of decisions at 22:01 (a bot; its hour is refused by name on that date).
      writeLedger(s, ledgerObjects(rowsOf([visit(registry, visitorsOf('rbot', 1)[0]!, at(-2, 1), 16_000, r, FULL)]), 400, 'rb'));
      await settleAt(s, at(-1, 6));
      // The date: forty ordinary visitors at 00:01–00:22, folded into open hour 0; the rebuild of the date at 00:30, its
      // steps delivered; five more visitors at 00:31–00:33, folded into the open hour at 00:35 (the date's day published
      // again); the day read before hour 0 closes.
      const visits = visitorsOf('r6b', 40).map(id => visit(registry, id, at(0, 1) + Math.floor(r() * 2 * MIN), 6, r, FULL));
      writeLedger(s, ledgerObjects(rowsOf(visits), 200, 'r6b-'));
      await settleAt(s, at(0, 25));
      const rebuilt = await operator(s, 'POST', `/v1/${TENANT}/learn/generation`, { slot: 'home-hero', brand: BRAND, rebuildFrom: DATE }, at(0, 30));
      await drainQueue(s, at(0, 30));
      await settleAt(s, at(0, 30));
      const more = visitorsOf('r6c', 5).map(id => visit(registry, id, at(0, 31), 1, r, FULL));
      visits.push(...more);
      writeLedger(s, ledgerObjects(rowsOf(more), 200, 'r6c-'));
      await settleAt(s, at(0, 35));
      const day = await dayOf(s);
      const report = day.body.report as { coverage?: { missingHours?: number[] }; policies?: Array<{ role: string; credits: number }> } | undefined;
      // Witness: no hour of the date is closed, none refused; the learning policy credits the open hour's credited outcomes.
      expect({ status: day.status, refusalNamed: stringsOf(day.body).includes('fold_step_bound'), missing: report?.coverage?.missingHours ?? null,
        credits: report?.policies?.find(p => p.role === 'learning')?.credits ?? null },
        `RF6 ${host}: the rebuild (${rebuilt.status}) names no hour of ${DATE} refused and republishes nothing of its day (${JSON.stringify(day.body).slice(0, 240)})`)
        .toEqual({ status: 200, refusalNamed: false, missing: [], credits: creditedOf(rowsOf(visits)) });
    }, T);

    it(`RF6 ${host}: every step of a staged rebuild delivered again (each acknowledgement lost, three deliveries) counts the day once (R-P684, finding 10)`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF6 rebuild redelivered');
      const r = rng(104_301);
      const witness = heroWitness();
      const visits = visitorsOf('day', 460).map(id => visit(registry, id, at(12) + Math.floor(r() * 35 * MIN), 22, r, FULL));
      witness.add(visits);
      const objects = ledgerObjects(rowsOf(visits), 500, 'b');
      visits.length = 0;
      writeLedger(s, objects);
      objects.clear();
      await settleAt(s, at(13, 6));
      const rebuilt = await operator(s, 'POST', `/v1/${TENANT}/learn/generation`, { slot: 'home-hero', brand: BRAND, rebuildFrom: DATE }, at(13, 10));
      expect(rebuilt.status, `RF6 ${host}: the rebuild is accepted: ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBeLessThan(300);
      let deliveries = 0;
      await settleAt(s, at(13, 10), { before: () => { deliveries++; return { dropAck: true }; } });
      const counters = await learned(s.m);
      expect({ n: rounded(counters, 'n'), s: rounded(counters, 's') }, `RF6 ${host}: ${deliveries} deliveries, each step's acknowledgement lost: every exposure and credit counted once`).toEqual(witness.expected());
    }, T);
  }
});

// ===========================================================================
// unit:P104.RF7 — kit 02 states the report as built
// ===========================================================================

describe('unit:P104.RF7 (E29: kit 02 states the envelope)', () => {
  it('RF7: kit 02 states the per-step bound and no volume limit on the fold, the day read by slot (?slot=), the 200 by slot past 8 MiB in place of 413, coverage, and the open hour\'s deferral (open_fold_deferred), each by a sentence that does not negate it, none said the other way', () => {
    const kit = readTree('docs/kit/02-api-reference.md');
    /** The kit's reading units: prose paragraphs, and each table row on its own (unit:W24.R2's idiom, P103.MP5's). */
    const units = kit.split(/\n\s*\n/).flatMap(block => block.trimStart().startsWith('|') ? block.split('\n') : [block]).map(u => u.replace(/\s+/g, ' '));
    // The paragraphs that speak of the report fold's envelope (kit 02's catalog in parts and the rest are not read).
    const envelope = units.filter(u => /64\s?MiB|[?&]slot=|by slot|open_fold_deferred|fixed-size steps|volume limit|whatever the traffic|stored in parts|part per slot|slot index/i.test(u));
    const sentences = envelope.flatMap(u => u.split(/(?<=[.;!?])\s+(?=[A-Z`(])/));
    /** A sentence negating what it says (R-P604 (6), P103.MP5). */
    const negated = (x: string) => /\b(never|not|cannot|can't|no longer|nor)\b/i.test(x);
    const says = (test: (x: string) => boolean) => sentences.some(x => test(x) && !negated(x));
    // Each fact stated by a sentence that does not negate it, and no sentence of the envelope says its opposite.
    const facts = {
      perStepBound: says(x => /64\s?MiB/.test(x) && /\bstep/i.test(x) && /\bat most\b|\bholds?\b|\bwithin\b/i.test(x))
        && !sentences.some(x => /64\s?MiB/.test(x) && /\b(refus|drop|truncat|lost)\w*/i.test(x) && /\b(traffic|hours?|tenant)\b/i.test(x))
        && !sentences.some(x => /\b(more than|over|above|exceed\w*|past|beyond)\s+64\s?MiB/i.test(x))
        && !sentences.some(x => /\b(hours?|fold)\b/i.test(x) && /\bskips?\b|\bskipped\b|\bunfolded\b/i.test(x)),
      noVolumeLimit: sentences.some(x => /no volume limit|whatever the traffic/i.test(x) && /\bfold/i.test(x) && !/\b(never|cannot|can't|no longer)\b/i.test(x))
        && !sentences.some(x => /\b(traffic|volume|busy)\b/i.test(x) && /\b(refus|drop)\w*/i.test(x) && /\b(fold|hours?|steps?)\b/i.test(x)),
      bySlot: says(x => /[?&]slot=/.test(x) && /\bparts?\b/i.test(x))
        && !sentences.some(x => /\bday\b/i.test(x) && /in parts|part per slot|[?&]slot=/i.test(x) && (negated(x) || /only the first|first page/i.test(x)))
        && !sentences.some(x => /[?&]slot=/.test(x) && /\b(every|all|each|whole)\b[^.]*\b(parts?|day)\b/i.test(x) && /\b(loads?|reads?|fetch\w*)\b/i.test(x) && !/only (that|its|the asked|one)/i.test(x)),
      pastEightMiB: says(x => /8\s?MiB/.test(x) && /\b200\b/.test(x) && /slot/i.test(x) && /in place of 413|instead of 413/.test(x))
        && !sentences.some(x => /8\s?MiB|by slot/i.test(x) && /\b413\b/.test(x) && !/in place of 413|instead of 413/.test(x)),
      coverage: says(x => /coverage/.test(x) && /(missing|incomplete|truncated)/i.test(x) && /\bnames?\b|\bsays?\b|\blists?\b/i.test(x))
        && !sentences.some(x => /coverage/.test(x) && /\b(does not|doesn't|never|cannot) (name|say|list)/i.test(x)),
      openDeferral: says(x => /open_fold_deferred/.test(x)),
      todaysCombinedBudgetGone: !/16\s?MiB combined aggregate JSON/.test(kit),
    };
    expect(envelope.length, 'PRECONDITION: kit 02 has paragraphs on the report fold').toBeGreaterThan(3);
    expect(facts, 'RF7: the report as built, in kit 02, sentence by sentence').toEqual(Object.fromEntries(Object.keys(facts).map(key => [key, true])));
  });
  for (const host of HOSTS) {
    it(`RF7 ${host}: a stale open hour is named refused open_fold_deferred, as today — 800 new objects in open hour 13 (13:26–13:33) after its working fold, the day read after the five-minute run that finds them and before their fold is done (R-P684, finding 9)`, async () => {
      const registry = retentionRegistry();
      const s = await stamp(host, documents(), registry, 'P104.RF7 stale open hour');
      const r = rng(104_701);
      await settleAt(s, at(12, 6));
      // Twenty visitors at 13:01–13:22 (every row born before the run that folds it).
      writeLedger(s, ledgerObjects(rowsOf(visitorsOf('w13', 20).map(id => visit(registry, id, at(13, 1) + Math.floor(r() * 2 * MIN), 6, r, FULL))), 200, 'w13-'));
      await settleAt(s, at(13, 25));
      const fresh = (await dayOf(s)).body.report as { hours?: { open?: Array<{ hour: number; status: string }> } } | undefined;
      expect((fresh?.hours?.open ?? []).find(h => h.hour === 13)?.status, `PRECONDITION: open hour 13 is current after its working fold (${JSON.stringify(fresh?.hours ?? null).slice(0, 300)})`).toBe('current');
      // Then 800 objects of one row each (today's run budget, RUN_BUDGET 700 storage calls, cannot take them in one run).
      const late = visitorsOf('x13', 200).map(id => visit(registry, id, at(13, 26) + Math.floor(r() * 5 * MIN), 1, r, FULL));
      const objects = ledgerObjects(rowsOf(late).slice(0, 800), 1, 'x13-');
      expect(objects.size, 'the fixture: 800 new objects').toBe(800);
      writeLedger(s, objects);
      objects.clear();
      await fiveMinuteRun(s, at(13, 35));
      const day = await operator(s, 'GET', `/v1/${TENANT}/learn/report?date=${DATE}`, undefined, at(13, 36));
      const open = ((day.body.report as { hours?: { open?: Array<{ hour: number; status: string; refusal?: Json }> } } | undefined)?.hours?.open ?? []).find(h => h.hour === 13);
      // Witness: kit 02 (as today): an open hour whose working fold the run deferred is named refused with open_fold_deferred.
      expect(open ? { status: open.status, code: open.refusal?.code ?? null } : 'not named',
        `RF7 ${host}: the day read while the open hour's new objects are not yet folded names it deferred, not current (${JSON.stringify(open ?? null).slice(0, 200)})`)
        .toEqual({ status: 'refused', code: 'open_fold_deferred' });
      await drainQueue(s, at(13, 36));
    }, T);
  }
});
