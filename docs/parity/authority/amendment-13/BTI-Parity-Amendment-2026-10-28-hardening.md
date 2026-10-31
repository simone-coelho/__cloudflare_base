# Parity programme, amendment 13: what the scale programme's walk and reviews found (2026-10-28) — in force

## 1. Why this amendment exists

Amendment 12's first four items are built, receipted and live-accepted (P93–P96, lane L20, R-P540–R-P542); the fifth (E22, the new visitor's first answer) waits on the owner's design decision. The walk and the delivery reviews found defects in what was delivered and two seams worth a ticket. They were told once (R-P543) and are in force on the owner's message of 28 October, morning (R-P544), in the order E25, E23, E24, E26; the owner may strike any of them.

## 2. The items

#### E25 · Catalogue loads that do not fail at random, and run faster
- **Authority:** lane L20 (R-P540): 15% of the fill loads (29 of 193) answered 503 `publication_unavailable`, nothing written, a re-send succeeding; ~200 s for a 5,000-product file. The diagnosis `S42/analyst-503/DIAGNOSIS.md` (R-P543): one storage call failing with no retry (about 1 call in 8,000), every failure mapped to one answer that hides its cause and whether anything is pending; reads strictly one at a time and writes 8 at a time with a barrier, so a 5,000-product load is ~1,250 sequential steps; the `changed` count over-counting on a fresh isolate; a refused load's objects never collected.
- **Done when:** a failed storage call on the load's path is retried once inside the request (bounded, idempotent: exact-creates and reads only); the load's calls run in a bounded pool without batch barriers; the 503 names the operation, the object kind and the storage error's number (never a key or a body) and a `state` — `nothing_written`, `pending` (recover) or `committed`; the `changed` count compares records independent of field order; the purge collects the objects a refused load left once they are older than the grace; kit 02 and kit 03 state the load protocol (file size, client timeout, read the status then recover or re-send); the live walk measures the refusal rate and the time per 5,000 products on both pair hosts, one host at a time.
- **Starts from:** `src/config/publication.ts` (the error mapping, the part and shard writes, the purge), `src/routes/content.ts` (the import path, the `changed` count).
- **Needed by:** the December test (the customer's 40,000-product loads). Two to three days.

#### E23 · The purge at scale
- **Authority:** P93's delivery review (R-P506): under its 256-call budget the purge never removes a revision whose load touched all 256 shards (storage grows by one such revision per large load; nothing lost); P95's delivery review (R-P531): a tenant whose stored learn history can never establish the salt count (an early revision purged, a retained baseline) now keeps every learn revision for good under the retention setting.
- **Done when:** the purge keeps its progress across passes so a large revision is removed over several publications; the latent delete order (shard keys queued before the parts behind them) cannot strand a part; a tenant whose salt count can never be established is told (an advisory on the operator's reads) and its learn revisions purged past a stated bound once the count is null for good, or the owner's alternative.
- **Needed by:** before the first activation (January). Two days.

#### E24 · A browser that drew while the salt version was unknown
- **Authority:** P95's delivery review (R-P531): a browser that drew its class while its tenant read a null salt version keeps null and misses every later rotation on the head-script-only path (`src/sdk/head.ts:155–158`).
- **Done when:** the head script adopts the table's number when it holds null, without treating that as a rotation; the SDK bundles regenerated within their budgets; the jsdom leg shows the next rotation repainting once.
- **Needed by:** before the first activation. Hours.

#### E26 · A malformed page-view id answered as what it is
- **Authority:** the 401 diagnosis (R-P541): a `pageInstance` outside 1–128 characters of `A-Za-z0-9_-` is accepted by the route and refused later, when a render offer is minted, as 401 "Shopper session unavailable" — a request error answered as a session failure, after the decision's work (older than the scale programme; the SDK sends a UUID).
- **Done when:** the decision routes refuse a malformed `pageInstance` with `400 Invalid page instance` before any work, as they do a malformed `arm`; kit 02 states the format.
- **Needed by:** before the first activation. Hours.

#### E27 · The first answer's content read
- **Authority:** P97's root-cause analysis (R-P547) left the customer stamps' first answer bounded by reading the published content; the diagnosis `S44/analyst-stamps-content/DESIGN.md` (R-P553): every first answer on a machine holding nothing reads the published content in three sequential storage trips, the per-isolate memory forgets after 30 s, and a stamp's storage trip costs about 1.7× the pair's. In force under the owner's direction of 28 October (R-P545): every problem fixed at its root cause.
- **Done when:** a publication's set and documents are kept for as long as memory allows (the head still checked on every decision); the head carries each document's version so a machine holding nothing reads the content in one round, existing tenants backfilled without an operator's publication; a brand-new machine reaches the content in one trip; the per-trip storage time reported so the stamps' slower trip is measured live; the answers identical; the stamps' cold first answer within about 300 ms of server time once P97 ships.
- **Needed by:** the first activation (January), with P97. Three to four days.

#### E28 · Money learning: a money policy that can be published, and one credit rule online and offline
- **Authority:** the airline demo's engine verification (`S47/engine/VERIFY.md` §1 Engine 18, R-P557): a slot whose objective is `revenue` or `margin` refuses every outcome that names a currency, and no money policy can be published: the learn document has no member for it, no producer reads one (`src/learn/route.ts:228`, `src/ledger/recovery.ts:303`, `:325`), the offline folds weigh value with no currency check so the report credits revenue that live learning refused, and the SDK sends `USD` when the page names no currency (`src/sdk/emit.ts:121`); 7 of the airline demo's 10 money slots learn nothing even from its synthetic history. A defect of the shipped engine, hitting any customer with a money slot fed by the SDK; fixed at its cause under the owner's direction of 28 October (R-P545).
- **Done when:** the learn document carries a money policy (`money`: the currency its money counters are in, and what a value at or below zero means), validated when it is published; both outcome producers and the recovery path pass it on; the money rule sits inside the one credit rule that live learning and every offline fold read, so the report credits exactly what live learning credits; the SDK sends a currency only when the page's data layer names one; kit 02 says how to publish the policy. The policy's values are the tenant's to publish; what a starting assumption means for a revenue slot (D09) is not part of this item, and priors on money slots stay as they are.
- **Needed by:** before a customer's revenue or margin slot is relied on (the airline demo's and any SDK-fed tenant's). Two to three days.

#### E29 · The learning report's fold, with a fixed memory bound per step
- **Authority:** the same verification (§1 Engine 20, R-P557) and the fold's root-cause design (`S49/analyst-report-fold/DESIGN.md`, R-P561): the hourly fold works in one request holding the hour's raw rows twice, all 64 shards' 48-hour rings and a copy of every new shard body, under 16 MiB limits, so an hour is refused above about 8,900 decisions, the next hour once the rings pass 3.69 MiB (the day then "incomplete"), and an hour at 40 visitors with a realistic spread of context (`cells`); lifting every limit would need about 6.9 GB in one request at 10,000 visitors a day against a 128 MB isolate. Fixed at its cause under the owner's direction (R-P545); the W24 rebuild's ring and the day's answer past 8 MiB ruled by the lead (R-P561).
- **Done when:** the hourly fold and the day report work in fixed-size steps (a plan, partition pages, leaves of visitors that split as they grow, a merge tree, a close), every step holding at most 64 MiB whatever the traffic, measured in the harness at 10,000, 100,000 and 1,000,000 visitors a day; on the same records the result equals today's fold; an hour is committed by two conditional writes, so no hour is lost or counted twice and a failed run resumes; the day report is summed one hour at a time and stored by slot, a day whose grids pass 8 MiB answering 200 by slot, never 413; the W24 rebuild folds with the 200-entry ring and the previous day's carry-in, as the hourly fold and live learning do; kit 02 states the envelope.
- **Needed by:** before a tenant's production traffic reaches the learning report (its first busy hour). 16 to 22 days, 12 to 15 of them to the bound (S49's estimate).

Section 3 row 1 would gain, beside E27: "and E28, E29 added on 28 October (R-P557, R-P561) in their own programme `tapestry-parity-learning-truth`".

#### E30 · The published-audience list, read once and never on a timer
- **Authority:** the P97 delivery reviewer's cause of P61.LO3's 53 acknowledgement calls (`S41/reviewer-p97/REPORT-p61-lo3.md`, R-P603, R-P607) and the root-cause design `S52/analyst-audience/DESIGN.md`.
  - **What happens.** On both hosts, any visitor action (and the buffered action, the segment and personalization reads) qualifies against the tenant's published audiences. It reads them as one KV list and then one get per audience, each awaited in turn (`src/connectors/AudienceStore.ts:79–84`), whenever this machine's copy is ten seconds old. The age counts from the last re-read, not the last use (`:25`, `:76`, `:86`).
  - **What it costs** (reproduced at a5118d38):
    - 11, 51, 201 and 1,001 calls at 10, 50, 200 and 1,000 audiences;
    - at 78 ms a call, 0.9 s, 4 s, 16 s and 78 s on the paying action;
    - from about 130 audiences up, every action pays, because the re-read outlasts the copy.
  - **Past 1,000 records** the list is cut at its first page, so the 1,001st audience published never qualifies anyone.
  - The customer path qualifies through this store on every tenant (`src/connectors/index.ts:29–37`).
  - A defect of the shipped engine, fixed at its cause under the owner's direction of 28 October (R-P545).
- **Done when:**
  - **The document.** The tenant's published audiences are one document, an optional member of its configuration publication, written by every publish, archive, rename, pin and seed as one set publication.
  - **The read.** Every qualification on both hosts reads it through the pin the action already holds: none while the publication is unchanged, one storage read after a change or on a new machine, at any number of audiences.
  - **Writes.** A write is seen on the next action everywhere, with no timer and no KV propagation window, and no write is lost to a concurrent one.
  - **Limits and failures.** The audiences member is bound like every publication member, 2 MiB (about 3,300 audiences of today's size), refused by name past it (R-P621). An unreadable publication fails qualification and never falls back.
  - **The move.** Existing tenants are moved from their KV records by their first audience write and by the five-minute scheduled run, every page read. The demo's regeneration is one publication.
  - **The flaky test.** P61.LO3 passes with the copy's old ten-second line crossed between its rounds (today 53 and 51 calls where 5 and 3 are expected).
- **Needed by:** before a customer tenant publishes more than a handful of audiences on a hosted stamp, and before P97's gate relies on P61.LO3. Four and a half to six days (S52's estimate).

#### E31 · The catalogue publish's cost, at its cause
- **Authority:** the gate-speed analysis `_evidence/parity-step3/R-P665-gate-speed/ANALYSIS.md`, adopted by the lead on 29 October (R-P671), under the owner's direction of 28 October (R-P545: "Everything needs to be fixed").
  - **What happens.** `catalogShardName` awaits one WebCrypto digest per id, and the index edit hashes the same ids again at every step: a 40,000-product publish makes 240,027 small digests, six per product. Each one is a thread-pool round trip in Node (49–87 µs under load, against 3–5 µs with `createHash`). `canonical` serialises the same values three to four times. Two harness caches are shared across the twin hosts, and `resolve` re-checks every stored revision.
  - **What it costs:** P98's file takes about 36 minutes of the gate, most of it this waste. Measured in Node, the publish falls from 43 s to 5 s, LD3 from 265 s to 63 s, and LD1 at scale from 265 s to 41 s with the fixes.
- **Done when:**
  - **Once per request.** Each id's shard name is computed once per request, and the catalogue's SHA-256 is computed synchronously with `node:crypto` (`nodejs_compat` is on), provided the bundle locks and a native run stay green; otherwise once per request alone.
  - **Once per value.** Each value is serialised once: a part's bytes and digest are carried into the pack, one serialisation gives a shard both its size and its digest, and the writing build reuses the plain build when it moves nothing.
  - **The harness.** The two harness caches are keyed by bucket, and `resolve` verifies each pack once per stored pack string, with every expectation unchanged.
  - **No limits.** Stored bytes, names, pointers and digests equal today's. The proof counts digests and serialisations and never sets a time cap.
#### E32 · Exploration at share 1 explores every visitor
- **Authority:** the analysis `_evidence/parity-step3/S55/analyst-intermittents/DESIGN.md` §4, adopted by the lead on 30 October (R-P707), under the owner's direction of 28 October (R-P545).
  - **What happens.** `explorationPick` (`src/learn/explore.ts:219`) rounds the visitor's bucket to three decimals, then refuses on `bucket >= share` (:237). A visitor whose bucket rounds to 1.000 never explores at share 1: 94 of 200,000 random visitors, reproduced without load. P04.N2's gate failure was this, not load.
- **Done when:**
  - **Share 1 is everyone.** At share 1 every visitor explores, the boundary visitor included.
  - **Nothing else moves.** At every share below 1 the decision equals today's, and a recorded decision replays under its recorded rules unchanged.
  - **The controls are pinned.** P04's N1/N2 CONTROL, and P10's and P15's exploration controls where their share is below 1, draw a pinned visitor at a pinned hour.
#### E33 · The gate counts, never times
- **Authority:** the same analysis, §1–§3 and §5, adopted on 30 October (R-P707), under R-P695 (4) and the box law (R-P706).
  - **What happens.** Five tests failed whole-suite gates because the shared box was busy, each failure costing a 1–2 hour re-run. W12.02 has a 10 s observation deadline racing the real queue delivery. P35.Z2 expects one order of two concurrent writes. P102.CR1–CR3 assert wall-clock medians. P105.AL6 asserts a 250 ms margin.
- **Done when:**
  - **Counts, not clocks.** Each named test asserts waves, calls, a recorded event, or order per action. The time stays printed as evidence only.
  - **Still a test.** Each counted form turns RED on the defect the timed form caught, shown by a deterministic variant, never by manufactured load.
#### E34 · The gate counts, never times: the remaining sites
- **Authority:** the same analysis, §6 (named for a later ticket by P109's D1 and R-P716), P109's review follow-ups (R-P718 (2)) and W12.02's later legs (R-P719), adopted on 31 October (R-P738), under R-P695 (4) and the box law (R-P706).
  - **What happens.** On 30–31 October P61.LO3 failed both hosts in P104's gate and P105.AL6 failed builder runs at load 74 and 39, on a 250 ms margin; P105 converted both (R-P734). The same shape remains: W12.02's later legs (an absolute alarm time the object re-arms, elapsed-time waits), P102.CR4's trip window, the wall-clock bounds in P94, P97, P62, the consent and boundary tests, the unaudited `performance.now()` assertions, and P10's random visitor at an exploration control.
- **Done when:**
  - **Counts, not clocks.** No assertion in the gate's tests bounds wall-clock time from above or depends on one random visitor; each asserts waves, calls, a recorded event, a pinned subject or order per action. The time stays printed as evidence only.
  - **Still a test.** Each counted form turns RED on the defect the timed form caught, shown by a deterministic variant, never by manufactured load.
#### E35 · Proving a catalogue pack unnamed from what changed
- **Authority:** the analysis `_evidence/parity-step3/S59/analyst-p107/DESIGN.md` (design D4), adopted on 31 October (R-P741); P99's residual, split out of P106 by R-P683; owner decision 3 below (refused loads' objects collected by the redesigned purge, not by hand), under the owner's direction of 28 October (R-P545).
  - **What happens.** Every catalogue publication's purge reads every stored revision to prove a pack unnamed, and P98's sweep reads them all again. Past about 250 revisions the purge spends its 256 calls inside one proof, removes one revision while each load adds one, and never collects a refused load's pack or a stage never published.
- **Done when:**
  - **What changed, not everything.** The purge keeps a reach ledger from the immutable stored revisions and reads only the revisions committed since its watermark; in steady state no body beyond the publication's own.
  - **No stall, no hand step.** At any count the walk removes up to 16 revisions per publication, and ordinary publications build the ledger for stores written today.
  - **Nothing lost.** Re-entry after a rollback, revisions no purge saw, stops at every call and concurrent publications keep every object a stored revision names; every object today's code writes is byte-identical.
#### Text corrections (no item; by name in whichever ticket next touches the file)
Kit 03's "distinct salts" rows and gendered experiment rows; `src/content/types.ts:673–674`'s comment; kit 02's other gendered sentences; kit 02's "every other answer carries the platform's `total`" (app answers only; the Worker entry's refusals carry none); the stamps answering 404 for `edge-head.js.csp`; `scripts/latency.mjs:18`; program.json's stale `src/index.ts:67`.

## 3. The owner's decisions
| # | Decision | Status |
|---|---|---|
| 1 | E25, E23, E24, E26 in force in this order (E25 first, for the December test), E27 added on 28 October (R-P553) in its own programme `tapestry-parity-first-paint`, and E28 and E29 added on 28 October (R-P557, R-P561) in the programme `tapestry-parity-learning-truth`, and E30 added on 28 October (R-P607, R-P621) in its own programme `tapestry-parity-request-path`, and E31 added on 29 October (R-P671, R-P683) in its own programme `tapestry-parity-publish-cost`, and E32 and E33 added on 30 October (R-P707) in the programme `tapestry-parity-gate-determinism`, and E34 added on 31 October (R-P738) in its own programme `tapestry-parity-gate-sweep`, and E35 added on 31 October (R-P741) in its own programme `tapestry-parity-pack-proof`; the owner may strike any | in force on the owner's message of 28 October, morning: "I'm not seeing any movement, action, or work. Why are we paused? What's the status?" (R-P544) |
| 2 | E22's design (amendment 12, P97's DC1): none of (a), (b), (c) as framed — the root cause of the new visitor's record creation found and the first answer redesigned not to wait on it (the record created asynchronously, the profile used later), the safeguards kept by design | the owner, 28 October (R-P545): "What happens during the creation of that record? Does it need to be created synchronously or can it be created asynchronously? … Nothing should take 1.4 seconds." |
| 3 | The objects refused loads left on the pair's l3 are collected by the redesigned load and purge, not swept by hand | the owner, 28 October (R-P545): "Everything needs to be fixed. Stop proposing … solutions that are papering over or hiding the problem." |
