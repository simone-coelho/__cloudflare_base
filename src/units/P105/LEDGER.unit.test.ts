// src/units/P105/LEDGER.unit.test.ts
// P105 under the Closure Ledger: the tests for the LOCAL criteria of the P105 work
// order (programme tapestry-parity-request-path, docs/parity/request-path/program.json:
// "The published-audience list: one document in the tenant's configuration
// publication, read through the action's own pin, never re-read on a timer"). One
// `describe('unit:P105.<criterion>')` per LOCAL criterion (AL1-AL7); every host leg is
// walked on both shopper hosts. LV1 is a deferred live row and gets no test.
//
// THE AUTHORITY, verbatim (docs/parity/authority/amendment-13/BTI-Parity-Amendment-2026-10-28-hardening.md,
// section 2, E30, "Done when"):
//   - The document. The tenant's published audiences are one document, an optional
//     member of its configuration publication, written by every publish, archive,
//     rename, pin and seed as one set publication.
//   - The read. Every qualification on both hosts reads it through the pin the action
//     already holds: none while the publication is unchanged, one storage read after a
//     change or on a new machine, at any number of audiences.
//   - Writes. A write is seen on the next action everywhere, with no timer and no KV
//     propagation window, and no write is lost to a concurrent one.
//   - Limits and failures. The audiences member is bound like every publication member,
//     2 MiB (about 3,300 audiences of today's size), refused by name past it (R-P621). An
//     unreadable publication fails qualification and never falls back.
//   - The move. Existing tenants are moved from their KV records by their first audience
//     write and by the five-minute scheduled run, every page read. The demo's
//     regeneration is one publication.
//   - The flaky test. P61.LO3 passes with the copy's old ten-second line crossed between
//     its rounds (today 53 and 51 calls where 5 and 3 are expected).
// The design pinned: _evidence/parity-step3/S52/analyst-audience/DESIGN.md (design D, §5;
// the move, §7; the tests it names, §9), adopted by R-P621; the cause R-P603, R-P607.
//
// THE ONE REPRESENTATION THESE UNITS READ (design D, §5; the publication's own names):
// the member is the set ref `audiences:<tenant>` (publication.ts `member`), its revision
// object `config-publication/v1/<tenant>/audiences/rev/<n>.json` (`revisionKey`), its
// value `{ version: 1, audiences: AudienceDef[] }`, every entry `status: 'published'`.
// The units read it from the stored objects (`audiencesMember` below), never through an
// export, so no export name is ruled here; the store's KV records stay
// `audience:<key>` under the tenant's KV prefix (src/tenancy/tenant.ts TenantKV).
//
// READINGS (R1, R2, R3, R5 and R6 ratified by R-P644 (8); R4 and R7 replaced by its rulings (2) and (3)):
//   R1. "A tenant whose set has no audiences member" (AL4) is the moved/unmoved line. A
//       tenant with NO publication at all — no STORAGE binding, or a head storage answers
//       absent (`publication_uninitialized`, publication.ts requiredHead / currentSet) — is
//       read as unmoved: its KV records are read (every page, the gets together) and its
//       writes stay KV writes until it has a publication; it is never "unreadable". Only a
//       publication that exists and cannot be read (`publication_unavailable`) fails
//       qualification (AL3). This keeps W01.08's and W03.02's fixtures (tenants with no
//       publication) answering as today, their call lists gaining the head read only (R10s).
//   R2. "No audience read while the publication is unchanged and the isolate holds it"
//       (AL1) is measured with the clock moved 25 s before each measured action (under the
//       publication's own 30 s idle expiry, PUBLICATION_CACHE_MS, which P102 lifts), six
//       measured actions, so every old ten-second line is crossed and any audience timer
//       up to 150 s is crossed too; a timer on any other clock, or longer, is caught by
//       AL2 (another isolate's write seen on the next action with no clock moved) and AL6
//       (10.5 s of real time). An "audience read" is any KV or R2 read whose key names the
//       audiences OR that qualification issued (MockSegmentProvider.fetchQualifiedSegments on
//       the call's stack, awaiting frames included): a pin of its own, a head and a set read
//       for the audiences, is an audience read whatever its key (the `no-pin` wrong fix made
//       exactly that, and the empty-member baseline paid it too). "Within half a call of the
//       same action with no audiences": the baseline is the same action on the tenant moved
//       with an empty member; the one unrelated timed read an action makes on its own
//       schedule, the shopper's feature-variable override read (lane E4's other ten-second
//       copy, FeatureVariableManager OVERRIDES_LIST_MS; DESIGN.md "out of scope, noticed" 1),
//       is counted at one call's latency where the two differ, and nothing else is. Since
//       R-P652 that read leaves the request path (AL7 pins its absence on her view and on her
//       personalization read); the allowance is kept as ratified and is unused on the sketch.
//   R3. "An isolate holding nothing" is simulated as a new isolate: the request path's
//       bindings replaced by new binding objects over the same data (every isolate cache
//       is keyed by its binding, publication.ts storageIdentity, sessionAuthority.ts
//       ownerBindingIdentity) and the publication's serving cache emptied
//       (`invalidatePublicationCache`). "Another isolate" (AL2, AL3) is the operator
//       routes served over another pair of binding objects over the same data.
//   R4 (R-P644 (2), replacing the specifier's): the operator door answers the store's 413 by
//       name — status 413, the answer naming document_too_large and the audiences member —
//       on publish (and on rename and pin, the other doors that can grow the member);
//       operator.ts's audience routes are granted. AL3 pins the publish door on both hosts.
//   R5. "Every get issued at once" (AL4) is read literally: all of the unmoved read's gets
//       are in flight together (one wave after the list's pages), not one wave per page.
//   R6. "The kit left as today" (the brief's wrong-fix list): the work order changes no kit
//       file (allowedPaths) and kit 02 states nothing about the audience list (no
//       `/operator/audiences`, no ten-second or KV-minute sentence: grep of docs/kit). What
//       a kit reader can see is kit 02's kind list (§4, "kind must be catalog, slots,
//       learn, priors, vocabulary, import-sources or layouts"), which design D keeps true
//       (the member is not a `/content/{kind}`): AL5 locks it. No kit sentence is
//       demanded here; if the lead wants one (the member's bound, the operator door), the
//       work order needs docs/kit/02-api-reference.md in its paths and a ruled sentence.
//   R7 (R-P644 (3), replacing the specifier's): the operator's audience list (GET
//       /operator/audiences, operator.ts:159) reads through the publication like every other
//       reader, never a held 30 s entry: another isolate's write is on the operator's next
//       list read with no clock moved (AL2). Measured before the ruling: the worker-level read
//       held its identical-handle entry (publication.ts pinPublication) up to 30 s.
//   R8. The deploy window (R-P644 (4)): "any KV audience record written after the move" is
//       told by content. A KV record that disagrees with the member — a published record
//       absent from it or different, an archived record of a member audience — is an earlier
//       release's write and the five-minute run reconciles it into the member, one
//       publication per run, none when nothing disagrees. This release writes each record
//       after its commit, so its records agree. Not told apart: a record left behind by a
//       post-commit KV write that failed would read as an earlier release's (named; a
//       release marker needs KV list metadata, which the harness's KV double,
//       src/units/_parity.ts UnitKV, keeps since R-P699's R10).
//   R9. R-P644 (5)'s "a cold machine reads that member in the same wave as the head and the
//       copy": the member's revision is known only from the head or the set, so a read in
//       the head's own wave needs the member under a fixed name (a second serving object)
//       and a pin that names the member. A decision names no audiences member and reads none:
//       AL1 pins its one wave at 2,000 audiences on P102's build. An action's first pin is the
//       reflex read's (src/reflex/configStore.ts, RealtimeSegmentEngine, ShopperReflex: none
//       granted), so the action's same-wave read is not pinned here; AL1 keeps a cold
//       action's audience read at exactly one (the member's document).
//   R10. The 409 (R-P644 (7)): the move is a set publication, so an operator publication that
//       meets it is refused 409 publication_conflict, at most once per tenant: optimistic
//       concurrency, the publication's documented contract, accepted. Pinned by AL4 since R-P696: 409 once, the retry 200.
//   R11. The override read (AL7, ruled at the cause by R-P652): measured at 78 ms a KV call with
//       lane E4's copy expired, the per-event read (FeatureVariableManager.getUserOverrides via
//       getSessionFeatureVariables, RealtimeSegmentEngine.ts:1032: every personalization read and
//       every action that changes her segments or stage, session host only) made 1 + N sequential
//       calls: 0 overrides 1 call 82 ms; 10, 11 calls 869 ms; 100, 101 calls 7,963 ms; 1,000,
//       1,001 calls 78,842 ms (logs/p4-overrides-base.log). No route writes an override and no
//       answer used the result (enhancedFeatureVariables consumed by nothing), so the read leaves
//       the request path; override records that exist are still erased and exported. AL7 pins, on
//       both hosts at 0, 10, 100 and 1,000 overrides, that neither her view that changes her
//       segments (the action that builds her personalization, step 6 of processEvent) nor her
//       personalization read (GET /realtime/personalization/:userId, at once and 25 s on) makes an
//       override read or a KV list, and locks the export and the erasure of her override records.
//       Clauses today (logs/r4-al7-today.log): session — override reads RED (at 10 overrides 22:
//       11 on the view, 11 on the later read; 2,002 at 1,000), KV lists RED (the override list and
//       the audience list); object host — override reads GREEN (the object host never read them, so
//       this clause is a lock there), KV lists RED on `CACHE.list {"prefix":"audience:"}` alone
//       (the unmoved audience read, AL1/AL4's cause, which the move removes). On the sketch 10/10.
//       R10s of R-P652, before → after:
//       - src/connectors/AudienceStore.memory.test.ts, "E4 a shopper's feature-variable overrides".
//         Before: the per-event probes (getSessionFeatureVariables) listed the override records
//         once per OVERRIDES_LIST_MS, an override set through this isolate applied by the next
//         probe and its removal by the next, a direct getUserOverrides listing KV once; it imported
//         OVERRIDES_LIST_MS and forgetListedOverrides. After, what remains once the request path no
//         longer reads overrides: the direct reads (getFeatureVariables, getUserOverrides) each list
//         KV once per read with no copy between them, and read a set or a removal through this
//         isolate at once (after the removal the read answers exactly what it answered before the
//         set, where round 3 asked only that its source not be 'override'); it no longer imports
//         the copy's exports. Green today and on both sketch forms (logs/r4-r10-today.log, r4-*).
//         A condition on the build, not a collision: src/services/OptimizelyService.datafileMemory.test.ts
//         (not granted) imports and calls forgetListedOverrides (:12, :47) and calls
//         getSessionFeatureVariables directly (:73, eight probes, the override list filtered out of
//         its call check), so the build keeps both exported and callable.
//       - src/services/telemetry.boundary.test.ts ("retains feature overrides and fallback results
//         without dynamic feature/error labels", :470-473): not edited, before = after. Its fault at
//         `cache.list` is reached by its own direct `manager.getUserOverrides(SUBJECT)`, never by the
//         request path, before or after; getUserOverrides stays (the grant takes the read off the
//         request path only), and the line 'Error fetching user overrides' is logged by it alone, so
//         no read the request path still makes can carry the same expectation. Measured green today
//         and on the sketch (logs/r4-*). Round 2 named it against that round's one-document sketch,
//         which made no list; the grant is unused.
//       - COLLISION, not granted (for the lead's ruling): src/routes/realtime.sdkContract.test.ts
//         W05.08 ("keeps preference writes necessary-only and gates populated reads/assignment
//         under every switch combination…", :5202): on a consented personalization read the session
//         host must call FeatureVariableManager.getSessionFeatureVariables, `expect(io.calls[3])
//         .toHaveBeenCalled()` (spy :5157). A build that removes the call at RealtimeSegmentEngine
//         :1032, as the grant words it, turns it RED ('expected "getSessionFeatureVariables" to be
//         called at least once', logs/r3-locks-sketch.log and r4-*). Two consistent ways: (a) R10,
//         before `if (host === 'session') { expect(io.calls[0]).not.toHaveBeenCalled();
//         expect(io.calls[3]).toHaveBeenCalled(); }` → after the same with
//         `expect(io.calls[3]).not.toHaveBeenCalled()` (the personalization read runs no override
//         probe; the gate with consent off, `io.quiet()`, unchanged); or (b) the build keeps the call
//         and getSessionFeatureVariables reads no override (sketch B, measured: this file 47/49 as
//         sketch A, the two legs that need P102 aside; W05.08's file and the other override-touching
//         files 229/229; logs/r4-sketchB-p105.log, r4-sketchB-al7-files.log).
//   GREEN-AT-SPEC: AL5's five lock legs and AL7's two lock legs (the export and the erasure of her
//   override records) pass today and on the sketch (measured).
//   ADDENDUM (R-P687 (5), R-P692): AL5's "R-P687" leg pins the render offer's binding on both hosts:
//   accepted after audience writes, refused 401 after a slots, learn or reflex republish. RED at
//   19b3d063 on the audience clause; GREEN at 4c766850; RED on 4c766850 with each of slots, learn,
//   reflex left out of renderIdentity, on that member's clause (S53/specifier/logs-addendum/).
//   ADDENDUM r2 (R-P696, after the delivery review S53/reviewer-p105/REPORT-1793d6d4.md; work order 32d24783):
//   - AL1 is counted, never timed (R-P695 (4)): each held action makes the same own remote calls, in the same waves
//     (`wavesOf`), as the same action with no audiences; its time is logged as evidence ("P105.AL1 evidence") and
//     asserted nowhere. This replaces R2's "within half a call" and its override allowance.
//   - AL4 (M2): the five-minute run adopts a KV record only when it was written after the member's version of that
//     audience, never because it differs (this replaces R8's "told by content"). Two legs per host: a run landing
//     between a rename's, then a pin's, commit and KV put; a run reading a stale KV value. The deploy-window leg is
//     unchanged: an earlier release's record (src/connectors/AudienceStore.ts at 2a90ecf0) is its read record spread
//     with the change, so whatever this release keeps in a record is copied into it beside the changed field; a
//     representation that tells it apart from this release's own older record exists (for one, a record stamped with
//     the member's revision and a digest of its own entry: the earlier release's change breaks the digest), so both
//     legs can be green at once.
//   - Follow-up 3: the 409 (R10 below) is pinned (AL4, both hosts), and the 413 by name on the rename and pin doors
//     (AL3, both hosts), as on the publish door.
//   - W29.R2's R10 also excepts the tenant's serving copy, which the move's commit rewrites, and asserts it is the
//     committed head's (src/units/W29/LEDGER.unit.test.ts).
//   ADDENDUM r3 (R-P699, work order be4b070f, AL4's last sentence): the reconciliation's cost, one leg per host. At 10
//     and at 1,000 audiences moved from an earlier release's records, once the move's records are marked (the run
//     repeated until every record is listed with KV metadata), a run with no write since makes ceil(N/1,000) KV lists
//     and no KV get; an earlier release's KV-only rename (a put with no metadata) is adopted by the next run, which
//     gets that record alone; the run's meter (RUN_BUDGET less the open hour's fold budget and the catch-up's calls,
//     read through a pass-through mock of src/learn/hourly.ts) equals the reconciliation's calls observed (an
//     AudienceStore frame on the call's stack, not qualification's). Counts only. R10 on src/units/_parity.ts UnitKV
//     (granted by name, R-P699 (3)): put keeps `options.metadata`, list returns `{ name, metadata }` for a key that
//     has it, a put without metadata clears it, get unchanged.
//   ADDENDUM r4 (R-P713, work order 671b0948; the delivery review S53/reviewer-p105-r3/REPORT-4cf183bc.md B1-B4), both hosts:
//     B1 (AL5) an audience write committed during runSynthetic (a store's publish; the five-minute run's reconciliation)
//     leaves the run pending with its decision, as base; B2 (AL4) an over-bound legacy tenant: every run under RUN_BUDGET
//     with its calls metered, the refusal stored by name with its size, no record read again while unchanged, the
//     operator's publish 200 on base's KV path; B3 (AL4) the notes, the reviewer's D3 ported; B4 (AL4) the cap: 1,000
//     legacy records moved and marked across runs, each under RUN_BUDGET, every call metered. The meter reads the
//     catch-up's own budget where the catch-up spent all it was handed (the open hour's fold budget then 0).
//
// DEFERRED: LV1 (lane L21 on the pair's next release, the stamps read-only) — no test.
//
// RESIDUALS (named, not tested here):
//   - The deploy window is reconciled by the five-minute run (AL4); a record left by a failed
//     post-commit KV write is not told apart from an earlier release's (R8). LV1 walks a
//     rolling release (R-P644 (4)).
//   - "No clone of the whole list per call" (work order, remaining work 2): not observable
//     within half a call at 1,000 audiences; the reviewer reads it.
//   - The unmoved tenant's path may keep lane E4's ten-second copy (work order: "left only
//     on the unmoved tenant's path or removed"): an unmoved tenant pays one KV list per ten
//     seconds per isolate until the five-minute run moves it (one run after the deploy).
//   - An action's first read of the audiences member on a machine holding nothing is in the
//     wave after the head, not the head's own (R9).
//
// CROSS-BATCH FACTS WITH P102 (E27; spec rem/spec-p102 02170b7d, build rem/p102-build c3b6031b):
//   - P102's serving copy (`config-publication/v2/<scope>/serving.json`, written at every
//     commit at or under 1 MiB) held every member. R-P644 (5): it leaves the audiences member
//     out, so a tenant with thousands of audiences keeps P102's one-wave first decision. AL1
//     pins it at 2,000 audiences (about 1.2 MB of member), first failing today on its
//     PRECONDITION naming P102 (R-P6). Measured on P102's build with the sketch.
//   - A cold action names no members in P102 as built (only the decision's documents
//     stage does), so it reads the head alone and the audiences member by its own read:
//     AL1's "exactly one audience read (the member's document)" holds over P102. If a
//     builder names the audiences member in the action's pin on a machine holding nothing,
//     P102 reads it from the serving copy (`serving.json`) and AL1's cold count must be
//     re-pointed to "the member's document or the serving copy, exactly one": R10 by name
//     then, not before.
//   - P102 holds a set and its documents by identity beyond 30 s (fix A) and still reads
//     the head on every operation by a new handle: AL1's held state and AL2's "seen on
//     the next action" are unchanged by it; the five-minute run's move is placed inside the
//     tenant's existing job, as P102's backfill is (W07.04 counts the jobs).
//   - MEASURED on P102's build c3b6031b with the P105 sketch: this file 49/49, P61 44/44 and P102
//     31/31 with the CR2 R10 below applied to the scratch copy (logs/r4-p102-sketch.log); without
//     that R10, P102 27/31 (round 1, logs p102-sketch.log). The four are P102.CR2's two five-minute-run legs on both hosts
//     ("an existing tenant (a head without the metadata, no serving copy) … rewrites its head
//     with the same bytes" and "a publication committed between the five-minute run's read
//     and its write wins … (R6) …"), green on P102's build alone (p102-alone-cr2.log, 12/12).
//     Cause: the five-minute run now also MOVES each tenant (AL4: every provisioned tenant,
//     one with no audience included), which is a set publication: the head's bytes change,
//     and an operator publication that meets the move is refused 409 publication_conflict
//     (the publication's own CAS; at most once per tenant, retried by the operator with a
//     fresh If-Match; accepted, R-P644 (7)). R10 granted by name (R-P644 (1)), P105's after
//     P102 joins, not committed to P102's file now; the edit is kept as a script,
//     _evidence/parity-step3/S53/specifier/scratch/tools/p102-cr2-r10.cjs. In both legs, one
//     `fiveMinuteRun` (the move) before each `asCommittedToday(...)` (worlds `m` and `n`), so
//     the run under test is the backfill alone; and the literal `committed: 2` in the R6
//     leg becomes 3 (set 2 is the move's). Proven on P102's build with the sketch:
//     r10-proof-p102-cr2b.log, CR2 12/12. The alternative — the move skipping a tenant with
//     no KV record — leaves that tenant's request path listing KV, contrary to AL4.
//
// R10 (expectations that pinned today's storage location; granted by name by R-P644 (1) and made in
// this commit, each "after" as written below; each was first run on the sketch in a scratch copy:
// _evidence/parity-step3/S53/specifier/logs/r10-proof-sketch.log, r10-proof-w29-sketch.log):
//   - W01.08 (src/index.api-boundary.test.ts:2557, :2560, :2573-2574). Before: the exact call
//     lists `[['CACHE.list','audience:']]`, `[['CACHE.list','audience:'], ['CACHE.get','audience:authored']]`
//     and the shopper's segment read ending `['SESSIONS.get', …], ['CACHE.list','audience:'],
//     ['CACHE.get','audience:authored']`. The probe's coach tenant has no publication (unmoved,
//     R1), so each read now first reads `config-publication/v2/coach/head.json` (measured:
//     `[['STORAGE.get','config-publication/v2/coach/head.json'], ['CACHE.list','audience:']]`).
//     After: the same KV and object calls in the same order, the only other calls reads of
//     `STORAGE.get config-publication/v2/coach/head.json`; statuses, bodies and before/after
//     state unchanged. It pins a storage location (no publication read), not a behaviour.
//   - W03.02 (:3198). Before: exactly `[['CACHE.put', t:<tenant>:audience:w0302], ['CACHE.list',
//     t:<tenant>:audience:], ['CACHE.get', t:<tenant>:audience:w0302]]`. The probe's tenant has no
//     publication (unmoved, R1); measured: a head read before the put and one before the list.
//     After: the same three KV calls in the same order, the only other calls reads of
//     `STORAGE.get config-publication/v2/<tenant>/head.json`.
//   - W22.07 (src/routes/realtime.sdkContract.test.ts:2803-2812, failure 'qualification').
//     Before: the qualification fault injected at the KV get of `t:meridian:audience:`, which a
//     moved tenant never makes (the fixture publishes its two audiences through
//     KvAudienceStore.publish over a meridian publication, so they become the member; on the
//     sketch the action then answers 200, the fault never reached). After: the same fault at
//     the member's read, `STORAGE.get` of a key starting `config-publication/v1/meridian/audiences/rev/`,
//     after `invalidatePublicationCache()` (a new isolate, so the member is read), with the same
//     expectation (status >= 400 or dropped, nothing applied, queued, learned or captured).
//   - src/connectors/AudienceStore.memory.test.ts (lane E4). Before: its env has no STORAGE (an
//     unmoved tenant under R1, so it passes on the sketch unchanged), it imports
//     AUDIENCE_LIST_MS and forgetListedAudiences, and its list counts (:48, :51, :68, :91,
//     :95) pin the ten-second copy. After: the same four behaviours on a moved tenant (an env
//     with a STORAGE publication carrying the audiences member): published audiences qualify
//     exactly as a fresh read does; a write through any store of the isolate (publish,
//     archive, rename, pin, the authoring adapter) is read on the next read; a write
//     through another binding is read on the next read with no clock moved; no read lists
//     KV; a caller cannot change what the next caller reads. The ten-second counts stay
//     only on an unmoved env's path, or go with the copy, as the builder keeps or removes it.
//   - W29.R2 (src/units/W29/LEDGER.unit.test.ts:236-239, native). Before: each of the three
//     crons leaves every `config-publication/` byte unchanged; the five-minute run's move is
//     one publication (measured: set/2.json and audiences/rev/1.json added, the head moved).
//     After: one five-minute run first, asserting it adds exactly `set/2.json` and
//     `audiences/rev/1.json`, the new set's refs other than `audiences:coach` equal set 1's,
//     and no other object but the head and the serving copy changed, the copy being the committed head's
//     (R-P696); then today's detector, unchanged, from that
//     state for all three crons (the five-minute run's second pass included: the move is
//     once). Autonomy's configuration (slots, learn, proposals) is still byte-identical.
//   - No collision, a condition on the build: W07.04 (src/index.api-boundary.test.ts:3492,
//     `scheduledJobs['*/5 * * * *'] = jobs(1, 2)`) holds only if the move runs inside the
//     tenant's existing five-minute job; a `ctx.waitUntil` of its own makes it `jobs(1, 3)`.
//
// HARNESS: src/units/_parity.ts (the mounted routes over the real Durable Object classes,
// both shopper hosts), src/units/_parity8.ts (the AA2 latency lever, the wire without a
// drain, `within`), src/units/_parity9.ts (P61's lift world, for AL6). Imports from
// src/units/: ../_parity, ../_parity8, ../_parity9.

import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { memoryAuthority } from '@/auth/authority';
import { memoryStore } from '@/auth/store';

import { documentBytes, initializePublicationSet, invalidatePublicationCache, PUBLICATION_MAX_BYTES, type PublicationBaseline } from '@/config/publication';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import { KvAudienceStore, moveAudiences } from '@/connectors/AudienceStore';
import { MockSegmentProvider } from '@/connectors/SegmentProvider';
import type { AudienceDef } from '@/connectors/types';
import catalog from '@/data/coach-catalog.json';
import { SEED_AUDIENCES } from '@/data/seed-audiences';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { FeatureVariableManager } from '@/services/FeatureVariableManager';
import { RUN_BUDGET } from '@/learn/hourly';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { operatorWrites } from '@/middleware/edgeAccess';
import { errorHandler } from '@/middleware/error';
import { generateAffinityAudiences, regenerateCatalogAudiences } from '@/reflex/audienceGenerator';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import type { ReflexConfig } from '@/reflex/core';
import { configRoutes } from '@/routes/config';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import { identityRoutes } from '@/routes/identity';
import { operatorRoutes } from '@/routes/operator';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';

import {
  BRAND, expectPublished, HOSTS, MODULES, PAID_SOCIAL_ENTRY, REFLEX_DOCUMENT, TENANT, VIEW_TABBY_26, declaredSlots, layoutSlot, learnDocument, mount,
  pageInstanceOf, recentSlot, shopperOn, type Decision, type Host, type Mounted, type Shopper, type Snapshot,
} from '../_parity';
import { ackWire, actionWire, remoteLatency, settle, UNANSWERED, within, type Latency, type Wire, type WorkerApp } from '../_parity8';
import { fanExports, liftWorld, POOLED } from '../_parity9';

// AL4 loads the Worker's own entry (src/index.ts) for its scheduled handler. The three module
// doubles src/demos/kit/root.worker.test.ts:24-26 (and src/units/W08/C1.unit.test.ts:136-138)
// register, so the entry loads under Node; none is on the scheduled run's path.
vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

// R-P699 (AL4, the reconciliation's cost): the five-minute run's meter, read where the run spends it. The
// scheduled handler (src/index.ts, the tenant's five-minute job) hands the open hour's fold what is left of
// RUN_BUDGET (src/learn/hourly.ts) after what it counted; the catch-up's own calls are counted here through the
// storage it is handed. So what the run counted before the folds, beside the catch-up, is
// RUN_BUDGET - (the fold's budget) - (the catch-up's calls). Both are passed through unchanged; nothing is
// recorded unless an AL4 cost leg arms the probe.
const hourlyProbe = vi.hoisted(() => ({ armed: false, catchUpCalls: [] as number[], catchUpBudgets: [] as Array<number | undefined>, foldBudgets: [] as number[] }));
vi.mock('@/learn/hourly', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/learn/hourly')>();
  const catchUp = (...args: Parameters<typeof real.catchUp>) => {
    if (!hourlyProbe.armed) return real.catchUp(...args);
    const at = hourlyProbe.catchUpCalls.push(0) - 1, storage = args[0];
    hourlyProbe.catchUpBudgets.push(args[4]?.budget);
    args[0] = new Proxy(storage, { get: (target, property, receiver) => {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...callArgs: unknown[]) => { hourlyProbe.catchUpCalls[at] = (hourlyProbe.catchUpCalls[at] ?? 0) + 1; return (value as (...a: unknown[]) => unknown).apply(target, callArgs); };
    } });
    return real.catchUp(...args);
  };
  const foldOpenHours = (...args: Parameters<typeof real.foldOpenHours>) => {
    if (hourlyProbe.armed) hourlyProbe.foldBudgets.push(args[4]?.budget ?? Number.NaN);
    return real.foldOpenHours(...args);
  };
  return { ...real, catchUp, foldOpenHours };
});

// ===========================================================================
// The world, the levers and the readers.
// ===========================================================================

/** The parity documents every world publishes (src/units/_parity.ts). */
const DOCS = { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument() };
/** The AA2 lever's latency per remote call (src/units/_parity8.ts remoteLatency; P56's AA2). */
const PER_CALL_MS = 500;
/** AL1's bound: half a call. */
const MARGIN_MS = PER_CALL_MS / 2;
/** R2: the clock moved before each measured action, under the publication's own 30 s idle expiry. */
const STEP_MS = 25_000;
const ROUNDS = 2;
const SIZES = [10, 50, 200, 1000] as const;
/** The second provisioned tenant of the tenant-boundary and five-minute-run legs. */
const OTHER = 'acme';
/** A third provisioned tenant, with no audience record at all (the five-minute run's leg). */
const EMPTY = 'globex';
const COLD_BOUND_MS = 20 * PER_CALL_MS;

// ---------------------------------------------------------------------------
// The clock (R2): `Date.now` moved forward only, never back, for the rest of this file.
// ---------------------------------------------------------------------------
const flooredNow = Date.now.bind(Date);
let clockOffset = 0, clockInstalled = false;
function advanceClock(ms: number): void {
  if (!clockInstalled) { vi.spyOn(Date, 'now').mockImplementation(() => flooredNow() + clockOffset); clockInstalled = true; }
  clockOffset += ms;
}

// ---------------------------------------------------------------------------
// Coach's launch audiences (src/data/seed-audiences.ts, the ten ODP insight views),
// at any number: the same definitions under indexed keys.
// ---------------------------------------------------------------------------
const seedOf = (key: string): AudienceDef => {
  const found = SEED_AUDIENCES.find(a => a.key === key);
  if (!found) throw new Error(`fixture: no Coach launch audience ${key}`);
  return structuredClone(found);
};
/** The i-th of n: Coach's ten launch audiences in turn, keyed `p<i>_<launch key>`. */
const atScale = (i: number): AudienceDef => {
  const seed = SEED_AUDIENCES[i % SEED_AUDIENCES.length]!;
  return { ...structuredClone(seed), key: `p${String(i).padStart(5, '0')}_${seed.key}`, status: 'published' };
};
/** A Coach launch audience under another key, as an operator publishes it (the door's own fields). */
const authored = (launchKey: string, key: string, name = `${seedOf(launchKey).name} (${key})`): AudienceDef =>
  ({ ...seedOf(launchKey), key, name, source: 'manual', status: 'published', createdAt: 1 });
/** She meets this one from her first Tabby view (price_band_viewed: elevated). */
const LUXE = 'luxe_affinity';
/** She never meets this one (no loyalty tier). */
const VIP = 'vip_loyalist';

// ---------------------------------------------------------------------------
// The app the stamp mounts for these routes (src/index.ts: the tenant middleware, the
// operator gate on `/operator/*`, the worker's error handler, the routes), over an
// environment: the mounted one, or another isolate's bindings (R3).
// ---------------------------------------------------------------------------
function appOf(env: Env): WorkerApp {
  const pending: Promise<unknown>[] = [];
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.use('/operator/*', operatorWrites());
  app.onError(errorHandler);
  app.route('/operator', operatorRoutes);
  app.route('/config', configRoutes);
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', identityRoutes);
  app.route('/v1', decisionRoutes);
  const fetch = async (request: Request) => app.fetch(request, env,
    { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); };
  return { fetch, drain };
}

/** Another isolate (R3): its own binding objects over the same storage, so nothing this isolate holds is its own. */
function elsewhere(w: World): WorkerApp {
  return appOf({ ...w.m.env, CACHE: Object.create(w.m.env.CACHE as object), STORAGE: Object.create(w.m.env.STORAGE as object) } as Env);
}

/** A new isolate on the request path (R3): new binding objects over the same storage, and the serving cache empty. */
function newIsolate(w: World): void {
  const env = w.m.env as unknown as Record<string, unknown>;
  env.CACHE = Object.create(env.CACHE as object);
  env.STORAGE = Object.create(env.STORAGE as object);
  invalidatePublicationCache();
}

// ---------------------------------------------------------------------------
// Every KV and R2 call the mounted bindings receive, with its key, when it was issued and
// whether qualification issued it: the one reader every caller goes through (work order AL1:
// MockSegmentProvider.fetchQualifiedSegments, src/connectors/SegmentProvider.ts:35-36) on the
// call's stack, its awaiting frames included (V8's async stack traces). A read qualification
// issues is an audience read whatever its key: a pin of its own (a head or a set read) as
// much as a KV record or the member's document.
// ---------------------------------------------------------------------------
interface Traced { binding: 'CACHE' | 'STORAGE'; method: string; key: string; at: number; qualifying: boolean }
const QUALIFICATION_FRAME = /connectors[\\/]SegmentProvider\.[jt]s/;
function issuedByQualification(): boolean {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 200;
  try { return QUALIFICATION_FRAME.test(new Error('P105 trace').stack ?? ''); } finally { Error.stackTraceLimit = limit; }
}
function traceBindings(m: Mounted): Traced[] {
  const seen: Traced[] = [];
  const wrap = (binding: Traced['binding'], target: object, methods: string[]) => {
    for (const method of methods) {
      const current = (target as Record<string, (...args: unknown[]) => Promise<unknown>>)[method];
      if (typeof current !== 'function') continue;
      Object.defineProperty(target, method, { configurable: true, writable: true, value: (...args: unknown[]) => {
        const first = args[0];
        seen.push({ binding, method, key: typeof first === 'string' ? first : JSON.stringify(first ?? null), at: performance.now(), qualifying: issuedByQualification() });
        return current.apply(target, args);
      } });
    }
  };
  wrap('CACHE', m.cache, ['get', 'list', 'put', 'delete']);
  wrap('STORAGE', m.storage, ['get', 'head', 'put', 'list', 'delete']);
  return seen;
}
const READS = new Set(['get', 'list', 'head']);
/** An audience read: a KV list or get of the store's records, an R2 read of the member's revision object, or any read qualification issued. */
const isAudienceRead = (c: Traced) => READS.has(c.method) && (c.qualifying || (c.binding === 'CACHE' ? c.key.includes('audience:') : c.key.includes('/audiences/')));
const isKvAudience = (c: Traced) => c.binding === 'CACHE' && c.key.includes('audience:');
const named = (c: Traced) => `${c.binding}.${c.method} ${c.key}`;

// ---------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------
interface World { m: Mounted; host: Host; app: WorkerApp; latency: Latency; trace: Traced[]; token: string }

/**
 * The customer profile's operator authority, as src/units/W08/_customer.ts builds it: a
 * synthetic human account with a session in an AccountStore (`memoryStore`) and an admin
 * membership on each tenant in an AuthorityStore (`memoryAuthority`), and an `access`
 * token for that session, signed with the mount's own synthetic signing material
 * (src/units/_parity.ts `mount`: JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE). On the customer
 * profile a service token needs a registered credential (src/middleware/auth.ts); this
 * session works on either profile.
 */
async function operatorCredential(m: Mounted, tenants: string[]): Promise<string> {
  const env = m.env as unknown as Record<string, unknown>, at = Date.now(), id = 'p105-synthetic-operator', sid = 'p105-synthetic-operator-session';
  const accounts = memoryStore(), authority = memoryAuthority(accounts);
  await accounts.put({ id, email: `${id}@example.invalid`, name: 'Synthetic P105 operator', roles: ['operator'], permissions: ['read'], updatedAt: at });
  await accounts.putSession({ jti: sid, accountId: id, tokenHash: 'p105-synthetic-unused', createdAt: at, expiresAt: at + 6 * 3_600_000 });
  for (const tenant of tenants) {
    authority.memberships.set(JSON.stringify([id, tenant]), { tenant, accountId: id, role: 'admin', revision: `p105-${tenant}`, updatedAt: at, disabled: false, removed: false });
  }
  env.ACCOUNTS = accounts; env.AUTHORITY = authority;
  return new SignJWT({ sub: id, type: 'access', sid }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
    .setIssuer(String(env.JWT_ISSUER)).setAudience(String(env.JWT_AUDIENCE)).setExpirationTime('6h').sign(new TextEncoder().encode(String(env.JWT_SECRET)));
}

const baselineOf = (kind: PublicationBaseline['kind'], value: unknown, scope: string): PublicationBaseline =>
  ({ kind, scope, revision: { revision: 1, at: 1, actor: 'p105-fixture', note: 'fixture', value } });

/**
 * One shopper host over the parity documents, on the customer profile unless `demo`
 * (the profile staging and production run, src/connectors/index.ts:29-37: every
 * tenant qualifies through KvAudienceStore). `tenants` provisions more tenants beside
 * coach, each with its own publication of the same documents.
 */
async function world(host: Host, opts: { demo?: boolean; tenants?: string[] } = {}): Promise<World> {
  const m = await mount(host, DOCS);
  expectPublished(m, 'P105 — the parity documents publish');
  const env = m.env as unknown as Record<string, unknown>;
  if (opts.tenants?.length) {
    const all = [TENANT, ...opts.tenants];
    env.TENANTS = JSON.stringify({ provisioned: all, operatorGrants: { ops: all } });
    const retention = JSON.parse(m.env.RETENTION as string) as { tenants: Record<string, unknown> };
    for (const tenant of opts.tenants) {
      retention.tenants[tenant] = retention.tenants[TENANT];
      await initializePublicationSet(m.env, [
        baselineOf(CONTENT_KIND, { version: 'p105-catalogue', pieces: DOCS.pieces }, tenant), baselineOf(SLOTS_KIND, DOCS.slots, tenant),
        baselineOf(LEARN_KIND, DOCS.learn, tenant), baselineOf(PRIORS_KIND, EMPTY_PRIORS, tenant),
        baselineOf(REFLEX_KIND, REFLEX_DOCUMENT, reflexScopeForTenant(tenant)),
      ], '0:' + crypto.randomUUID());
    }
    env.RETENTION = JSON.stringify(retention);
    invalidatePublicationCache();
  }
  if (!opts.demo) env.DEPLOYMENT_PROFILE = 'customer';
  const token = await operatorCredential(m, [TENANT, ...(opts.tenants ?? [])]);
  const latency = remoteLatency(m);
  const trace = traceBindings(m);
  return { m, host, app: appOf(m.env), latency, trace, token };
}

// ---------------------------------------------------------------------------
// The operator, through the door operators use (src/routes/operator.ts).
// ---------------------------------------------------------------------------
interface Answer { status: number; body: Record<string, unknown>; sentAt: number; answeredAt: number }
async function operator(w: World, method: 'GET' | 'POST', path: string, body?: unknown, opts: { app?: WorkerApp; tenant?: string } = {}): Promise<Answer> {
  const app = opts.app ?? w.app, sentAt = performance.now();
  const response = await app.fetch(new Request('http://console.test' + path, { method,
    headers: { 'X-Tenant': opts.tenant ?? TENANT, Authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const answeredAt = performance.now();
  const parsed = await response.json().catch(() => ({})) as Record<string, unknown>;
  await settle(w.m, app);
  return { status: response.status, body: parsed, sentAt, answeredAt };
}
const publishThrough = (w: World, def: AudienceDef, opts: { app?: WorkerApp; tenant?: string } = {}) =>
  operator(w, 'POST', '/operator/audiences/publish', { audience: { key: def.key, name: def.name, description: def.description, conditions: def.conditions,
    evaluation: def.evaluation, source: 'manual', status: 'published' } }, opts);
const verb = (w: World, key: string, action: 'rename' | 'pin' | 'prune', body: unknown = {}, opts: { app?: WorkerApp; tenant?: string } = {}) =>
  operator(w, 'POST', `/operator/audiences/${encodeURIComponent(key)}/${action}`, body, opts);
/** The members R-P687's leg republishes (AL5): every publication member but the audiences that no committed leg pinned. */
const REPUBLISHED = ['slots', 'learn', 'reflex'] as const;
type Republished = typeof REPUBLISHED[number];
/**
 * The member's document republished as in force (a new revision of the same value) through the
 * operator's door with the authored preconditions (kit 02: If-Match plus Idempotency-Key):
 * `PUT /content/:kind` for the slots and the learn document, `PUT /config/reflex` for the reflex
 * configuration (src/units/P39/LEDGER.unit.test.ts putRegistry). Its status.
 */
async function republish(w: World, member: Republished): Promise<number> {
  const path = member === 'reflex' ? '/config/reflex' : `/content/${member}?scope=${TENANT}`;
  const base = await operator(w, 'GET', path);
  expect(base.status, `PRECONDITION (${w.host}): the operator reads the ${member} document (${JSON.stringify(base.body).slice(0, 200)})`).toBe(200);
  const revision = base.body.revision as number, publication = base.body.publication as { revision: number; digest: string };
  const body = member === 'reflex' ? { config: base.body.authored ?? base.body.config, note: 'P105 render binding' } : { document: base.body.document, note: 'P105 render binding' };
  const response = await w.app.fetch(new Request('http://console.test' + path, { method: 'PUT', body: JSON.stringify(body), headers: {
    'X-Tenant': TENANT, Authorization: `Bearer ${w.token}`, 'content-type': 'application/json',
    'If-Match': `"${revision}/${publication.revision}/${publication.digest}"`, 'Idempotency-Key': `${revision}:${crypto.randomUUID()}` } }));
  await settle(w.m, w.app);
  return response.status;
}
/** The operator's list read, with every KV audience call it made. */
async function listedReads(w: World): Promise<{ defs: AudienceDef[]; kv: string[] }> {
  const from = w.trace.length, defs = await listedThrough(w);
  return { defs, kv: w.trace.slice(from).filter(isKvAudience).map(named) };
}
async function listedThrough(w: World, opts: { app?: WorkerApp; tenant?: string } = {}): Promise<AudienceDef[]> {
  const read = await operator(w, 'GET', '/operator/audiences', undefined, opts);
  expect(read.status, `PRECONDITION (${w.host}): the operator reads the published audiences (${JSON.stringify(read.body).slice(0, 200)})`).toBe(200);
  return (read.body.audiences ?? []) as AudienceDef[];
}

// ---------------------------------------------------------------------------
// The stored publication, read from the objects (never through a binding call).
// ---------------------------------------------------------------------------
const stored = (m: Mounted, key: string): Record<string, unknown> | null => {
  const raw = m.storage.objects.get(key);
  return raw === undefined ? null : JSON.parse(raw) as Record<string, unknown>;
};
/** The tenant's committed set revision (0 where it has none). */
function setRevision(m: Mounted, tenant: string = TENANT): number {
  const head = stored(m, `config-publication/v2/${tenant}/head.json`) as { committed?: { revision?: number } | null } | null;
  return head?.committed?.revision ?? 0;
}
/** The audiences member of the tenant's committed set: its revision and its audiences, or null where the set has none. */
function audiencesMember(m: Mounted, tenant: string = TENANT): { revision: number; audiences: AudienceDef[] } | null {
  const revision = setRevision(m, tenant);
  if (!revision) return null;
  const set = stored(m, `config-publication/v2/${tenant}/set/${revision}.json`) as { refs?: Record<string, { revision: number }> } | null;
  const ref = set?.refs?.[`audiences:${tenant}`];
  if (!ref) return null;
  const document = stored(m, `config-publication/v1/${tenant}/audiences/rev/${ref.revision}.json`) as { value?: { audiences?: AudienceDef[] } } | null;
  return { revision: ref.revision, audiences: document?.value?.audiences ?? [] };
}
const keysOf = (defs: readonly AudienceDef[] | null | undefined) => (defs ?? []).map(d => d.key).sort();
/** A KV record as an earlier release wrote it (src/connectors/AudienceStore.ts at 2a90ecf0: `audience:<key>` under the tenant's prefix). */
function legacyRecord(m: Mounted, tenant: string, def: AudienceDef): void {
  const key = `${tenant === TENANT ? '' : `t:${tenant}:`}audience:${def.key}`;
  // R-P703: the earlier release's put carries no metadata, so Workers KV clears the key's (the UnitKV R10 on put).
  m.cache.data.set(key, JSON.stringify(def));
  m.cache.metadata.delete(key);
}

// ---------------------------------------------------------------------------
// A measured action: the shopper's wire under the lever, bounded, then everything it
// caused settled; its answer, time, own remote calls and every audience read it made.
// ---------------------------------------------------------------------------
interface Measured { status: number; body: Record<string, unknown>; ms: number | null; own: number; waves: string[][]; reads: string[]; kv: string[]; overrideLists: number }
/**
 * AL1's count (R-P695 (4), R-P696): the action's own remote calls up to its answer, as the lever saw them
 * (`binding.method`), in waves. A call joins the current wave where it started before the wave's first call
 * could have answered (90% of the lever's latency after it, so a timer firing a millisecond early opens no
 * wave); otherwise it opens the next wave, which only a call waiting on an earlier answer does. Under the
 * lever equal calls in equal waves are equal latency, so the count replaces the time and the time is evidence.
 */
function wavesOf(calls: ReadonlyArray<{ binding: string; method: string; at: number }>, lever: number): string[][] {
  const out: Array<{ first: number; calls: string[] }> = [];
  for (const call of [...calls].sort((a, b) => a.at - b.at)) {
    const last = out.at(-1);
    if (last && call.at < last.first + 0.9 * lever) last.calls.push(`${call.binding}.${call.method}`);
    else out.push({ first: call.at, calls: [`${call.binding}.${call.method}`] });
  }
  return out.map(wave => wave.calls.sort());
}
/**
 * The one unrelated timed read an action can make on its own schedule: the shopper's
 * feature-variable override list, lane E4's other ten-second copy (FeatureVariableManager
 * OVERRIDES_LIST_MS; DESIGN.md "out of scope, noticed" 1; AL7). AL1's time bound counts each override
 * read (its list or a record), made by the measured action and not by its baseline, at one call's latency.
 */
const isOverrideList = (c: Traced) => c.binding === 'CACHE' && READS.has(c.method) && c.key.includes('override:');
async function measured(w: World, send: () => Promise<Wire>, bound: number, lever = PER_CALL_MS): Promise<Measured> {
  const fromCalls = w.latency.calls.length, fromTrace = w.trace.length;
  w.latency.set(lever);
  const work = send();
  const raced = await within(work, bound);
  w.latency.set(0);
  const wire = raced === UNANSWERED ? await work : raced;
  await settle(w.m, w.app);
  const caused = w.trace.slice(fromTrace), own = w.latency.calls.slice(fromCalls).filter(c => c.at <= wire.answeredAt);
  return { status: wire.status, body: wire.body, ms: raced === UNANSWERED ? null : Math.round(wire.answeredAt - wire.sentAt),
    own: own.length, waves: wavesOf(own, lever),
    reads: caused.filter(isAudienceRead).map(named), kv: caused.filter(isKvAudience).map(named),
    overrideLists: caused.filter(c => c.at <= wire.answeredAt && isOverrideList(c)).length };
}
/** Whether the answer names her segments, and whether `key` is among them. */
const stillQualifies = (m: Measured, key: string) => { const segments = segmentsOf(m.body); return { segmentsNamed: segments !== null, qualifies: segments?.includes(key) ?? null }; };
/** The shopper's segments the action's answer names (`update.data.segments`, present when her membership changed), or null. */
const segmentsOf = (body: Record<string, unknown>): string[] | null => {
  const update = body.update as { data?: { segments?: unknown } } | undefined;
  return Array.isArray(update?.data?.segments) ? update!.data!.segments as string[] : null;
};

type Kind = 'view' | 'buffered' | 'ack';
const KINDS: readonly Kind[] = ['view', 'buffered', 'ack'];
const LABEL: Record<Kind, string> = { view: 'Tabby view', buffered: 'buffered action', ack: 'render acknowledgement' };
/** The wire of one action kind, its unmeasured part done first (the acknowledgement's own page). */
async function sender(w: World, s: Shopper, kind: Kind): Promise<() => Promise<Wire>> {
  if (kind === 'view') return () => actionWire(w.app, s, VIEW_TABBY_26);
  if (kind === 'buffered') {
    const original = Date.now() - 60_000;
    return () => actionWire(w.app, s, { ...VIEW_TABBY_26, processing: 'buffered', browsingSessionId: s.grant.sessionId } as unknown as typeof VIEW_TABBY_26,
      { eventId: crypto.randomUUID(), timestamp: original });
  }
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p105-ack') });
  const offered = page.decisions.find(d => d.renderOffer);
  expect(offered ? page.status : `no offered decision (${page.status})`, `PRECONDITION (${w.host}): the product page offers a decision to acknowledge`).toBe(200);
  return () => ackWire(w.app, s, page, offered!);
}

/** The tenant moved with no audience in it: one published and pruned through the operator door. */
async function movedEmpty(w: World): Promise<void> {
  const placeholder = authored(VIP, 'p105_placeholder');
  expect((await publishThrough(w, placeholder)).status, `PRECONDITION (${w.host}): the operator publishes an audience`).toBe(200);
  expect((await verb(w, placeholder.key, 'prune')).status, `PRECONDITION (${w.host}): and prunes it`).toBe(200);
}

// ===========================================================================
// unit:P105.AL1 — no audience read on a held publication; one after a change or cold.
// ===========================================================================

/**
 * The publication's object reads while armed, each held `g` ms, in waves as P102's own read log counts them
 * (src/units/P102/LEDGER.unit.test.ts `waves`, rem/spec-p102 02170b7d): a read that starts before the earliest end of
 * the current wave joins it, else it opens the next.
 */
function publicationReads(m: Mounted, g = 20) {
  const reads: Array<{ key: string; start: number; end: number }> = [];
  let armed = false;
  for (const op of ['get', 'head'] as const) {
    const current = (m.storage as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[op]!;
    Object.defineProperty(m.storage, op, { configurable: true, writable: true, value: async (...args: unknown[]) => {
      const key = String(args[0]), counted = armed && key.startsWith('config-publication/'), start = performance.now();
      const answer = current.apply(m.storage, args);
      if (counted) await new Promise(resolve => setTimeout(resolve, g));
      const out = await answer;
      if (counted) reads.push({ key, start, end: performance.now() });
      return out;
    } });
  }
  const waves = () => {
    const out: Array<{ end: number; keys: string[] }> = [];
    for (const r of [...reads].sort((a, b) => a.start - b.start)) {
      const last = out.at(-1);
      if (last && r.start < last.end - 0.5) { last.keys.push(r.key); last.end = Math.min(last.end, r.end); } else out.push({ end: r.end, keys: [r.key] });
    }
    return out.map(w => w.keys.map(k => k.replace(`config-publication/v2/${TENANT}/`, '').replace(`config-publication/v1/${TENANT}/`, '')).sort());
  };
  return { arm: () => { armed = true; reads.length = 0; }, disarm: () => { armed = false; }, waves };
}

describe('unit:P105.AL1', () => {
  for (const host of HOSTS) for (const n of SIZES) {
    it(`host (${host}): at ${n} published audiences, under the AA2 lever (${PER_CALL_MS} ms on every remote call, customer profile), a Tabby view, a buffered action and a render acknowledgement on an isolate that holds the unchanged publication make no audience read and make the same own remote calls, in the same waves, as the same action with no audiences (counted, never timed; the time recorded as evidence, R-P696), with the clock moved ${STEP_MS / 1000} s before each (the old ten-second line crossed every time); the action right after the publication changed, and a view on a new isolate, each make exactly one audience read, the member's document, and no KV list or audience get`, async () => {
      const w = await world(host);
      await movedEmpty(w);
      const s = await shopperOn(w.m);
      expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, `PRECONDITION (${host}): her first view is accepted`).toBe(200);
      await settle(w.m, w.app);

      // The same actions with no audiences: the baseline each held action is compared with.
      const baseline = {} as Record<Kind, Measured>;
      for (const kind of KINDS) {
        advanceClock(STEP_MS);
        baseline[kind] = await measured(w, await sender(w, s, kind), COLD_BOUND_MS);
        expect(baseline[kind].status, `PRECONDITION (${host}): the ${LABEL[kind]} with no audiences answers under the lever`).toBe(200);
      }

      // n of Coach's launch audiences published, through the store's own batch write.
      await new KvAudienceStore(w.m.env, TENANT as TenantId).seed(Array.from({ length: n }, (_, i) => atScale(i)));
      const changed = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);

      const held: Array<{ label: string; base: Measured; got: Measured }> = [];
      for (let round = 1; round <= ROUNDS; round++) for (const kind of KINDS) {
        advanceClock(STEP_MS);
        held.push({ label: `${LABEL[kind]} (round ${round})`, base: baseline[kind], got: await measured(w, await sender(w, s, kind), COLD_BOUND_MS) });
      }
      newIsolate(w);
      const cold = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS);

      // Evidence only (R-P696): each held action's time beside its baseline's, never asserted.
      console.log(`P105.AL1 evidence ${host} n=${n} ${JSON.stringify(held.map(({ label, base, got }) => ({ label, baseMs: base.ms, gotMs: got.ms, baseWaves: base.waves.length, gotWaves: got.waves.length, baseOwn: base.own, gotOwn: got.own })))}`);
      for (const { label, base, got } of held) {
        expect({ status: got.status, audienceReads: got.reads, ownCallsInWaves: got.waves },
          `${host}: P105.AL1 — at ${n} audiences the ${label}, ${STEP_MS / 1000} s after the last action on an isolate holding the unchanged publication, makes no audience read and the same own remote calls, in the same waves, as the same action with no audiences (${got.own} calls in ${got.waves.length} waves against ${base.own} in ${base.waves.length}; ${got.reads.length} audience reads: ${got.reads.slice(0, 3).join(', ')}${got.reads.length > 3 ? ', …' : ''}; time, evidence only: ${got.ms ?? 'unanswered within ' + COLD_BOUND_MS} ms against ${base.ms ?? 'unanswered within ' + COLD_BOUND_MS} ms)`)
          .toEqual({ status: 200, audienceReads: [], ownCallsInWaves: base.waves });
      }
      const member = audiencesMember(w.m);
      const memberRead = `STORAGE.get config-publication/v1/${TENANT}/audiences/rev/${member?.revision}.json`;
      expect({ status: changed.status, audienceReads: changed.reads },
        `${host}: P105.AL1 — at ${n} audiences the view right after the publication changed reads the audiences once, the member's document (${changed.reads.length} audience reads: ${changed.reads.slice(0, 3).join(', ')}${changed.reads.length > 3 ? ', …' : ''})`)
        .toEqual({ status: 200, audienceReads: [memberRead] });
      expect(segmentsOf(changed.body) ?? [], `${host}: P105.AL1 — and qualifies her against them: she meets ${atScale(6).key} (${LUXE}, her elevated price band)`).toContain(atScale(6).key);
      expect({ status: cold.status, audienceReads: cold.reads, kv: cold.kv },
        `${host}: P105.AL1 — at ${n} audiences a view on a new isolate reads the audiences once, the member's document, and no KV list or audience get (${cold.reads.length} audience reads)`)
        .toEqual({ status: 200, audienceReads: [memberRead], kv: [] });
    }, 600_000);
  }

  for (const host of HOSTS) {
    it(`host (${host}): R-P644 (5) — at 2,000 published audiences (about 1.2 MB, past P102's 1 MiB serving copy), the serving copy leaves the audiences member out and so is written, and a new machine's first decision still reads its documents in ONE wave (the head and the serving copy together), reading no audience`, async () => {
      const w = await world(host);
      await new KvAudienceStore(w.m.env, TENANT as TenantId).seed(Array.from({ length: 2000 }, (_, i) => atScale(i)));
      const committed = setRevision(w.m), copy = stored(w.m, `config-publication/v2/${TENANT}/serving.json`) as { set?: { revision?: number; refs?: Record<string, unknown> }; documents?: Record<string, unknown> } | null;
      expect(copy ? 'written' : 'no serving copy', `PRECONDITION (P102, E27): every commit writes the scope's serving copy, config-publication/v2/${TENANT}/serving.json (P102 CR3); P102 builds before P105`).toBe('written');
      const refs = Object.keys((stored(w.m, `config-publication/v2/${TENANT}/set/${committed}.json`) as { refs?: Record<string, unknown> } | null)?.refs ?? {});
      expect({ current: copy!.set?.revision === committed, members: Object.keys(copy!.documents ?? {}).sort() },
        `${host}: P105.AL1 — the serving copy of the set the 2,000 audiences committed holds every member but the audiences member`)
        .toEqual({ current: true, members: refs.filter(key => key !== `audiences:${TENANT}`).sort() });
      const s = await shopperOn(w.m);
      const meter = publicationReads(w.m);
      newIsolate(w);
      meter.arm();
      const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf('p105-first-decision') });
      meter.disarm();
      const waves = meter.waves();
      expect({ status: page.status, waves: waves.length, audienceRead: waves.flat().some(key => key.includes('audiences/')) },
        `${host}: P105.AL1 — the new machine's first decision reads its documents in one wave and no audience (${JSON.stringify(waves)})`)
        .toEqual({ status: 200, waves: 1, audienceRead: false });
    }, 300_000);
  }

  for (const host of HOSTS) {
    it(`host (${host}): the segment read (GET /realtime/segments/:userId, a caller of the same qualification) on an isolate that holds the unchanged publication makes no audience read, the clock ${STEP_MS / 1000} s on`, async () => {
      const w = await world(host);
      await new KvAudienceStore(w.m.env, TENANT as TenantId).seed(Array.from({ length: 50 }, (_, i) => atScale(i)));
      const s = await shopperOn(w.m);
      expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, `PRECONDITION (${host}): her view is accepted`).toBe(200);
      await settle(w.m, w.app);
      advanceClock(STEP_MS);
      const read = await measured(w, async () => {
        const sentAt = performance.now();
        const response = await w.app.fetch(new Request(`https://shop.invalid/realtime/segments/${s.subject}`, { headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability } }));
        const answeredAt = performance.now();
        return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown>, answeredAt, sentAt };
      }, COLD_BOUND_MS, 0);
      expect({ status: read.status, audienceReads: read.reads },
        `${host}: P105.AL1 — the segment read on a held publication makes no audience read (${read.reads.length}: ${read.reads.slice(0, 3).join(', ')})`)
        .toEqual({ status: 200, audienceReads: [] });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P105.AL2 — a write is seen on the next action everywhere, with no clock moved.
// ===========================================================================

describe('unit:P105.AL2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): through this isolate's operator door, with no clock moved, an audience published qualifies her on the next action, a rename and a pin read renamed and pinned on the next read, and a prune stops it qualifying on the next action; once the tenant is moved no action reads an audience from KV`, async () => {
      const w = await world(host);
      expect((await publishThrough(w, authored(VIP, 'al2_vip'))).status, `PRECONDITION (${host}): the tenant's first audience is published`).toBe(200);
      const s = await shopperOn(w.m);
      expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, `PRECONDITION (${host}): her view is accepted`).toBe(200);
      await settle(w.m, w.app);

      const luxe = authored(LUXE, 'al2_luxe');
      expect((await publishThrough(w, luxe)).status, `PRECONDITION (${host}): the operator publishes ${luxe.key}`).toBe(200);
      const afterPublish = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(segmentsOf(afterPublish.body) ?? [], `${host}: P105.AL2 — the next action qualifies her for ${luxe.key}, published through this isolate`).toContain(luxe.key);

      expect((await verb(w, luxe.key, 'rename', { name: 'Luxe browsers (renamed)' })).status, `PRECONDITION (${host}): the operator renames it`).toBe(200);
      expect((await listedThrough(w)).find(d => d.key === luxe.key)?.name, `${host}: P105.AL2 — the next read names it renamed`).toBe('Luxe browsers (renamed)');
      expect((await verb(w, luxe.key, 'pin', { pinned: true })).status, `PRECONDITION (${host}): the operator pins it`).toBe(200);
      expect((await listedThrough(w)).find(d => d.key === luxe.key)?.pinned, `${host}: P105.AL2 — the next read names it pinned`).toBe(true);
      const afterPin = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);

      expect((await verb(w, luxe.key, 'prune')).status, `PRECONDITION (${host}): the operator prunes it`).toBe(200);
      const afterPrune = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(stillQualifies(afterPrune, luxe.key), `${host}: P105.AL2 — the next action stops qualifying her for ${luxe.key}, pruned through this isolate: her answer names her segments, without it (${JSON.stringify(segmentsOf(afterPrune.body))})`)
        .toEqual({ segmentsNamed: true, qualifies: false });

      expect({ afterPublish: afterPublish.kv, afterPin: afterPin.kv, afterPrune: afterPrune.kv },
        `${host}: P105.AL2 — once the tenant is moved, no action reads an audience from KV`).toEqual({ afterPublish: [], afterPin: [], afterPrune: [] });
    }, 120_000);

    it(`host (${host}): through ANOTHER isolate's operator door (other binding objects over the same storage), with no clock moved, an audience published qualifies her on this isolate's next action, a rename and a pin are read renamed and pinned by this isolate's next action, and a prune stops it qualifying on the next action, with no audience read from KV; R-P644 (3): this isolate's operator list read names each change too, with no clock moved`, async () => {
      const w = await world(host);
      expect((await publishThrough(w, authored(VIP, 'al2_vip'))).status, `PRECONDITION (${host}): the tenant's first audience is published`).toBe(200);
      const s = await shopperOn(w.m);
      expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, `PRECONDITION (${host}): her view is accepted`).toBe(200);
      await settle(w.m, w.app);
      expect((await listedThrough(w)).map(d => d.key), `PRECONDITION (${host}): this isolate has read the published list`).toEqual(['al2_vip']);

      const other = elsewhere(w), luxe = authored(LUXE, 'al2_luxe');
      expect((await publishThrough(w, luxe, { app: other })).status, `PRECONDITION (${host}): another isolate publishes ${luxe.key}`).toBe(200);
      const listedAfterPublish = await listedReads(w);
      expect({ listed: listedAfterPublish.defs.some(d => d.key === luxe.key), kv: listedAfterPublish.kv },
        `${host}: P105.AL2 — R-P644 (3): this isolate's operator list read (GET /operator/audiences), with no clock moved, names ${luxe.key}, published by another isolate, read through the publication and from no KV`).toEqual({ listed: true, kv: [] });
      const afterPublish = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(segmentsOf(afterPublish.body) ?? [], `${host}: P105.AL2 — this isolate's next action qualifies her for ${luxe.key}, published by another isolate, with no clock moved`).toContain(luxe.key);

      for (const [action, body, field, value] of [['rename', { name: 'Luxe browsers (renamed elsewhere)' }, 'name', 'Luxe browsers (renamed elsewhere)'], ['pin', { pinned: true }, 'pinned', true]] as const) {
        expect((await verb(w, luxe.key, action, body, { app: other })).status, `PRECONDITION (${host}): another isolate's operator ${action}s it`).toBe(200);
        const next = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0), member = audiencesMember(w.m);
        const carried = member?.audiences.find(a => a.key === luxe.key) as Record<string, unknown> | undefined;
        expect({ readsTheChangedMember: next.reads.includes(`STORAGE.get config-publication/v1/${TENANT}/audiences/rev/${member?.revision}.json`), [field]: carried?.[field], kv: next.kv },
          `${host}: P105.AL2 — this isolate's next action reads the audiences as ${action === 'rename' ? 'renamed' : 'pinned'} elsewhere: it reads the member's revision that carries the change, from no KV (${next.reads.join(', ')})`)
          .toEqual({ readsTheChangedMember: true, [field]: value, kv: [] });
        const listed = await listedReads(w);
        expect({ [field]: (listed.defs.find(d => d.key === luxe.key) as Record<string, unknown> | undefined)?.[field], kv: listed.kv },
          `${host}: P105.AL2 — R-P644 (3): and this isolate's operator list read names it ${action === 'rename' ? 'renamed' : 'pinned'} elsewhere, from no KV`).toEqual({ [field]: value, kv: [] });
      }

      expect((await verb(w, luxe.key, 'prune', {}, { app: other })).status, `PRECONDITION (${host}): another isolate prunes it`).toBe(200);
      const afterPrune = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(stillQualifies(afterPrune, luxe.key), `${host}: P105.AL2 — this isolate's next action stops qualifying her for ${luxe.key}, pruned by another isolate: her answer names her segments, without it (${JSON.stringify(segmentsOf(afterPrune.body))})`)
        .toEqual({ segmentsNamed: true, qualifies: false });
      expect({ afterPublish: afterPublish.kv, afterPrune: afterPrune.kv }, `${host}: P105.AL2 — and no action read an audience from KV`).toEqual({ afterPublish: [], afterPrune: [] });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P105.AL3 — the writes, the bound, the unreadable publication.
// ===========================================================================

describe('unit:P105.AL3', () => {
  it('host (worker): each of publish, rename, pin, prune and seed is ONE set publication of the audiences member (the set revision moves by exactly one, the member says the change), the KV record written after the commit, a pruned key still resolvable', async () => {
    const w = await world('session');
    const one = authored(LUXE, 'al3_one'), two = authored(VIP, 'al3_two');
    const step = async (label: string, run: () => Promise<unknown>) => {
      const before = setRevision(w.m), from = w.trace.length;
      await run();
      const calls = w.trace.slice(from);
      return { label, moved: setRevision(w.m) - before, member: audiencesMember(w.m), calls };
    };
    const published = await step('publish', () => publishThrough(w, one));
    const renamed = await step('rename', () => verb(w, one.key, 'rename', { name: 'Renamed luxe' }));
    const pinned = await step('pin', () => verb(w, one.key, 'pin', { pinned: true }));
    const second = await step('publish', () => publishThrough(w, two));
    const pruned = await step('prune', () => verb(w, one.key, 'prune'));
    const seeded = await step('seed', () => new KvAudienceStore(w.m.env, TENANT as TenantId).seed([atScale(1), atScale(6)]));
    expect([published, renamed, pinned, second, pruned, seeded].map(s => [s.label, s.moved]),
      'P105.AL3 — each write moves the tenant\'s set by exactly one publication').toEqual([['publish', 1], ['rename', 1], ['pin', 1], ['publish', 1], ['prune', 1], ['seed', 1]]);
    expect(keysOf(published.member?.audiences), 'P105.AL3 — the publish: the member holds it').toEqual([one.key]);
    expect(renamed.member?.audiences.find(a => a.key === one.key)?.name, 'P105.AL3 — the rename: the member names it renamed').toBe('Renamed luxe');
    expect(pinned.member?.audiences.find(a => a.key === one.key)?.pinned, 'P105.AL3 — the pin: the member holds it pinned').toBe(true);
    expect(keysOf(pruned.member?.audiences), 'P105.AL3 — the prune: the member no longer holds it').toEqual([two.key]);
    expect(keysOf(seeded.member?.audiences), 'P105.AL3 — the seed: the member holds both seeded in the same publication').toEqual(keysOf([two, atScale(1), atScale(6)]));
    expect((seeded.member?.audiences ?? []).every(a => a.status === 'published'), 'P105.AL3 — every member entry is published').toBe(true);
    const commitAt = second.calls.reduce((last, c, i) => c.binding === 'STORAGE' && c.method === 'put' && c.key.endsWith('/head.json') ? i : last, -1);
    const recordAt = second.calls.findIndex(c => c.binding === 'CACHE' && c.method === 'put' && c.key === `audience:${two.key}`);
    expect({ committed: commitAt >= 0, recordAfterCommit: recordAt > commitAt }, 'P105.AL3 — the per-audience KV record is written after the head commit').toEqual({ committed: true, recordAfterCommit: true });
    const again = await verb(w, one.key, 'prune');
    expect([again.status, (again.body.audience as AudienceDef | undefined)?.status], 'P105.AL3 — a pruned key stays resolvable (operator.ts:484-488): pruning it again answers it archived').toEqual([200, 'archived']);
  }, 120_000);

  it('host (worker): two operator writes started together through two isolates (each its own store over its own bindings) both survive: the member holds both and both qualify her on the next action', async () => {
    const w = await world('session');
    await movedEmpty(w);
    const s = await shopperOn(w.m);
    expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, 'PRECONDITION: her view is accepted').toBe(200);
    await settle(w.m, w.app);
    const a = authored(LUXE, 'al3_together_a'), b = authored(LUXE, 'al3_together_b'), other = elsewhere(w);
    w.latency.set(20);
    const [first, second] = await Promise.all([publishThrough(w, a), publishThrough(w, b, { app: other })]);
    w.latency.set(0);
    expect({ statuses: [first.status, second.status], overlapped: first.sentAt < second.answeredAt && second.sentAt < first.answeredAt },
      'PRECONDITION: both writes were in flight together and both were answered').toEqual({ statuses: [200, 200], overlapped: true });
    expect(keysOf(audiencesMember(w.m)?.audiences), 'P105.AL3 — neither write is lost: the member holds both').toEqual([a.key, b.key]);
    const next = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
    expect(segmentsOf(next.body) ?? [], 'P105.AL3 — and both qualify her on the next action').toEqual(expect.arrayContaining([a.key, b.key]));
  }, 120_000);

  for (const host of HOSTS) {
    it(`host (${host}): the demo's first action on the default tenant (demo profile) seeds Coach's launch audiences and regenerates the catalogue audiences as one set publication per pass — the set moves by at most two, the member holds every launch audience and the regenerated catalogue audiences, and the action answers`, async () => {
      const w = await world(host, { demo: true });
      const before = setRevision(w.m);
      const s = await shopperOn(w.m);
      const first = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(first.status, `PRECONDITION (${host}): the demo's first action answers`).toBe(200);
      const member = audiencesMember(w.m), moved = setRevision(w.m) - before;
      expect({ seededAndRegenerated: moved >= 1, onePerPass: moved <= 2 },
        `${host}: P105.AL3 — the demo's seeding and regeneration are one publication per pass (the set moved by ${moved})`).toEqual({ seededAndRegenerated: true, onePerPass: true });
      expect(keysOf(member?.audiences), `${host}: P105.AL3 — the member holds every Coach launch audience`).toEqual(expect.arrayContaining(keysOf(SEED_AUDIENCES)));
      expect((member?.audiences ?? []).filter(a => a.source === 'catalog').length, `${host}: P105.AL3 — and the regenerated catalogue audiences`).toBeGreaterThan(0);
    }, 120_000);
  }

  it('logic: regenerateCatalogAudiences (src/reflex/audienceGenerator.ts) over Coach\'s catalogue is ONE publication per pass — the first pass publishing every generated audience, a pass whose catalogue lost a dimension archiving those audiences, an unchanged pass at most one', async () => {
    const w = await world('session');
    await movedEmpty(w);
    const store = new KvAudienceStore(w.m.env, TENANT as TenantId);
    const products = (catalog as unknown as { products: Array<Record<string, unknown>> }).products;
    const generated = generateAffinityAudiences(products, REFLEX_DOCUMENT as unknown as ReflexConfig);
    expect(generated.length, 'PRECONDITION: Coach\'s catalogue generates its affinity audiences').toBeGreaterThan(5);
    const pass = async (defs: AudienceDef[]) => { const before = setRevision(w.m); await regenerateCatalogAudiences(store, defs); return setRevision(w.m) - before; };
    const firstPass = await pass(generated);
    const kept = generated.filter(d => !/^line_/.test(d.key)), dropped = generated.filter(d => /^line_/.test(d.key));
    expect(dropped.length, 'PRECONDITION: the catalogue\'s line dimension generates audiences').toBeGreaterThan(0);
    const narrowed = await pass(kept);
    const unchanged = await pass(kept);
    expect({ firstPass, narrowed, unchangedAtMostOne: unchanged <= 1 }, 'P105.AL3 — each regeneration pass is one publication').toEqual({ firstPass: 1, narrowed: 1, unchangedAtMostOne: true });
    expect(keysOf(audiencesMember(w.m)?.audiences), 'P105.AL3 — the member holds exactly the audiences the last pass keeps').toEqual(keysOf(kept));
  }, 120_000);

  it('logic: an audiences member past 2 MiB (PUBLICATION_MAX_BYTES) is refused by the store 413 document_too_large naming the audiences member, and nothing changes (the set, the member, the KV record)', async () => {
    const w = await world('session');
    const store = new KvAudienceStore(w.m.env, TENANT as TenantId);
    const sample = Array.from({ length: 100 }, (_, i) => atScale(i)), perAudience = documentBytes({ version: 1, audiences: sample }) / sample.length;
    const fit = Math.floor((PUBLICATION_MAX_BYTES - 96 * 1024) / perAudience), defs = Array.from({ length: fit }, (_, i) => atScale(i));
    await store.seed(defs);
    const before = { revision: setRevision(w.m), members: audiencesMember(w.m)?.audiences.length };
    const over = { ...authored(LUXE, 'al3_over'), description: 'x'.repeat(160 * 1024) };
    const refused = await store.publish(over).then(() => null, (error: unknown) => error as { status?: number; code?: string; message?: string });
    expect({ status: refused?.status, code: refused?.code, namesTheMember: /audiences/.test(refused?.message ?? '') },
      `P105.AL3 — with ${fit} Coach-launch-shaped audiences published (${documentBytes({ version: 1, audiences: defs })} B), the store refuses the write that takes the member past 2 MiB, 413 document_too_large naming the audiences member (${refused?.message ?? 'it was accepted'})`)
      .toEqual({ status: 413, code: 'document_too_large', namesTheMember: true });
    expect({ fitWasTheMember: before.members === fit, revision: setRevision(w.m), members: audiencesMember(w.m)?.audiences.length, record: w.m.cache.data.has(`audience:${over.key}`) },
      `P105.AL3 — nothing changed: the set, the member (${before.members} before) and the KV record`).toEqual({ fitWasTheMember: true, revision: before.revision, members: fit, record: false });
  }, 300_000);

  for (const host of HOSTS) {
    it(`host (${host}): R-P644 (2) — the same write through the operator door (POST /operator/audiences/publish) is refused 413 by name: the answer names document_too_large and the audiences member, nothing changes (the set, the operator's list, the KV record), and her next action does not qualify it`, async () => {
      const w = await world(host);
      const store = new KvAudienceStore(w.m.env, TENANT as TenantId);
      const sample = Array.from({ length: 100 }, (_, i) => atScale(i)), perAudience = documentBytes({ version: 1, audiences: sample }) / sample.length;
      const fit = Math.floor((PUBLICATION_MAX_BYTES - 96 * 1024) / perAudience);
      await store.seed(Array.from({ length: fit }, (_, i) => atScale(i)));
      const revision = setRevision(w.m);
      const over = { ...authored(LUXE, 'al3_over'), description: 'x'.repeat(160 * 1024) };
      const answer = await publishThrough(w, over), text = JSON.stringify(answer.body);
      expect({ status: answer.status, namesTheRefusal: text.includes('document_too_large'), namesTheMember: /audiences/.test(text) },
        `${host}: P105.AL3 — the door answers the store's refusal 413 by name (${answer.status} ${text.slice(0, 300)})`).toEqual({ status: 413, namesTheRefusal: true, namesTheMember: true });
      expect({ revision: setRevision(w.m), listed: (await listedThrough(w)).some(d => d.key === over.key), record: w.m.cache.data.has(`audience:${over.key}`) },
        `${host}: P105.AL3 — and nothing changed`).toEqual({ revision, listed: false, record: false });
      const s = await shopperOn(w.m);
      const next = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect({ status: next.status, qualifies: (segmentsOf(next.body) ?? []).includes(over.key) }, `${host}: P105.AL3 — her next action does not qualify the refused audience`).toEqual({ status: 200, qualifies: false });
    }, 300_000);
  }

  // R-P696 (follow-up 3): the rename and pin doors (operator.ts, POST /operator/audiences/:key/rename and /pin)
  // answer the store's 413 by name as the publish door does (R-P644 (2)). A rename grows the member by at most its
  // 120-character name and 500-character description, a pin by `,"pinned":true` (14 bytes of the canonical member),
  // so the member is brought to within 14 bytes of what the store accepts, with the store's own refusal as the
  // measure (a refused write changes nothing, AL3's store leg): the bound is checked on the whole pending publication
  // (publication.ts publishSet, the head holding the set and the member's envelope), so no stored object's size says
  // it. Every write near the edge is a pin of an audience whose key has the same length (notes and index rows of
  // equal size): 50 pins and unpins of `b` fill the member's index rows (publication.ts LIMIT) with pins, a filler is
  // grown until a publish of it is refused, 50 more fill the rows with pins again, then helpers are pinned one by one
  // until one is refused. A pin of `b` (no growth) then fits and a pin of `a` (the helper's +14) does not.
  for (const host of HOSTS) {
    it(`host (${host}): R-P696 — at the 2 MiB bound, a rename and a pin through the operator door that would take the audiences member past it are each refused 413 by name (document_too_large, the audiences member) and nothing changes (the set, the member, the KV record); a pin that does not grow it is accepted`, async () => {
      const w = await world(host);
      const store = new KvAudienceStore(w.m.env, TENANT as TenantId);
      const sample = Array.from({ length: 100 }, (_, i) => atScale(i)), perAudience = documentBytes({ version: 1, audiences: sample }) / sample.length;
      await store.seed(Array.from({ length: Math.floor((PUBLICATION_MAX_BYTES - 96 * 1024) / perAudience) }, (_, i) => atScale(i)));
      const edge = (key: string, name: string): AudienceDef => ({ ...authored(VIP, key), name, description: '' });
      const a = edge('al3_edge_a00', 'Edge A'), b = edge('al3_edge_b00', 'Edge B');
      const helpers = Array.from({ length: 64 }, (_, i) => edge(`al3_edge_h${String(i).padStart(2, '0')}`, 'Edge helper'));
      await store.seed([a, b, ...helpers]);
      /** Whether the store accepts the write; a 413 is its refusal by size (nothing changed), anything else a failure. */
      const accepted = (write: Promise<unknown>) => write.then(() => true, (error: unknown) => {
        if ((error as { status?: number }).status === 413) return false;
        throw error;
      });
      const pinRows = async () => { for (let i = 0; i < 50; i++) await store.setPinned(b.key, i % 2 === 1); };
      await pinRows();
      let lo = 0, hi = 200_000;
      while (hi - lo > 64) {
        const mid = Math.floor((lo + hi) / 2);
        if (await accepted(store.publish({ ...edge('al3_edge_f00', 'Edge filler'), description: 'x'.repeat(mid) }))) lo = mid; else hi = mid;
      }
      await pinRows();
      let refusedHelper: string | null = null;
      for (const helper of helpers) if (!await accepted(store.setPinned(helper.key, true))) { refusedHelper = helper.key; break; }
      expect(refusedHelper ?? 'every helper pin accepted', `PRECONDITION (${host}): the audiences member is within one pin of the bound (a helper's pin refused by the store; filler ${lo} B)`).toMatch(/^al3_edge_h/);
      const control = await verb(w, b.key, 'pin', { pinned: true });
      expect(control.status, `PRECONDITION (${host}): CONTROL — a pin through the door that does not grow the member is accepted (${JSON.stringify(control.body).slice(0, 200)})`).toBe(200);

      const revision = setRevision(w.m), record = w.m.cache.data.get(`audience:${a.key}`);
      const refusal = (answer: Answer) => { const text = JSON.stringify(answer.body); return { status: answer.status, namesTheRefusal: text.includes('document_too_large'), namesTheMember: /audiences/.test(text) }; };
      const renamed = refusal(await verb(w, a.key, 'rename', { name: 'R'.repeat(120), description: 'D'.repeat(500) }));
      const pinned = refusal(await verb(w, a.key, 'pin', { pinned: true }));
      const entry = audiencesMember(w.m)?.audiences.find(d => d.key === a.key);
      expect({ rename: renamed, pin: pinned },
        `${host}: P105.AL3 (R-P696) — the rename and the pin doors answer the store's refusal 413 by name, as the publish door does`)
        .toEqual({ rename: { status: 413, namesTheRefusal: true, namesTheMember: true }, pin: { status: 413, namesTheRefusal: true, namesTheMember: true } });
      expect({ revision: setRevision(w.m), entry: { name: entry?.name, pinned: entry?.pinned ?? false }, record: w.m.cache.data.get(`audience:${a.key}`) },
        `${host}: P105.AL3 (R-P696) — and nothing changed: the set, the member's entry, the KV record`).toEqual({ revision, entry: { name: 'Edge A', pinned: false }, record });
    }, 300_000);
  }

  for (const host of HOSTS) {
    it(`host (${host}): a publication whose audiences member cannot be read fails qualification as an unreadable reflex document does (${host === 'session' ? 'the session host\'s action fails exactly as the action whose reflex document cannot be read' : 'the object host degrades to reflex-only: answered, no audience segment'}) and never falls back — not to KV, not to the list it held`, async () => {
      const w = await world(host);
      expect((await publishThrough(w, authored(LUXE, 'al3_luxe'))).status, `PRECONDITION (${host}): the operator publishes an audience she meets`).toBe(200);
      expect(audiencesMember(w.m)?.audiences.map(a => a.key), `PRECONDITION (${host}): the publish made the tenant's audiences member (P105.AL3's write)`).toEqual(['al3_luxe']);
      const s = await shopperOn(w.m);
      const first = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(segmentsOf(first.body) ?? [], `PRECONDITION (${host}): she qualifies for al3_luxe`).toContain('al3_luxe');

      // CONTROL: the action whose reflex document cannot be read (a new isolate, the reflex revision read failing).
      newIsolate(w);
      let restore = failReads(w, '/reflex/rev/');
      const reflexUnreadable = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      restore();
      expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, `PRECONDITION (${host}): with the reflex document readable again her action answers`).toBe(200);
      await settle(w.m, w.app);

      // Another isolate publishes; this isolate cannot read the member's new revision.
      expect((await publishThrough(w, authored(LUXE, 'al3_luxe_two'), { app: elsewhere(w) })).status, `PRECONDITION (${host}): another isolate publishes a second audience she meets`).toBe(200);
      restore = failReads(w, '/audiences/rev/');
      const unreadable = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      restore();
      if (host === 'session') {
        expect({ status: unreadable.status, error: unreadable.body.error },
          `session: P105.AL3 — the action fails as the action whose reflex document cannot be read fails (${reflexUnreadable.status} ${String(reflexUnreadable.body.error)}); got ${unreadable.status} ${JSON.stringify(unreadable.body).slice(0, 200)}`)
          .toEqual({ status: reflexUnreadable.status, error: reflexUnreadable.body.error });
        expect(reflexUnreadable.status, 'session: CONTROL — the action whose reflex document cannot be read is refused').toBeGreaterThanOrEqual(500);
      } else {
        expect({ status: unreadable.status, audienceSegments: (segmentsOf(unreadable.body) ?? ['no segments named']).filter(k => k.startsWith('al3_')) },
          `do: P105.AL3 — the object host degrades to reflex-only: the action answers and qualifies her for no audience (ShopperReflex.ts:1612-1616); got ${unreadable.status} ${JSON.stringify(segmentsOf(unreadable.body))}`)
          .toEqual({ status: 200, audienceSegments: [] });
      }
      expect(unreadable.kv, `${host}: P105.AL3 — and never falls back to KV`).toEqual([]);
    }, 120_000);
  }
});

/** Every R2 read whose key contains `pattern` fails (an unreadable object) until the returned function restores the binding. */
function failReads(w: World, pattern: string): () => void {
  const target = w.m.storage as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>, current = target.get!;
  Object.defineProperty(target, 'get', { configurable: true, writable: true, value: (key: unknown, ...rest: unknown[]) =>
    typeof key === 'string' && key.includes(pattern) ? Promise.reject(new Error('P105 lever: this publication object cannot be read')) : current.call(target, key, ...rest) });
  return () => { Object.defineProperty(target, 'get', { configurable: true, writable: true, value: current }); };
}

// ===========================================================================
// unit:P105.AL4 — the move.
// ===========================================================================

/** The legacy state of an unmoved tenant with 1,005 records: 995 published she never meets, 5 archived, and 5 published she meets, sorting after the first page. */
function legacyThousand(m: Mounted, tenant: string = TENANT): { published: AudienceDef[]; met: string[] } {
  const published: AudienceDef[] = [];
  for (let i = 0; i < 995; i++) published.push({ ...authored(VIP, `a${String(i).padStart(5, '0')}_${VIP}`) });
  const archived = Array.from({ length: 5 }, (_, i) => ({ ...authored(LUXE, `m${i}_archived_${LUXE}`), status: 'archived' as const }));
  const met = Array.from({ length: 5 }, (_, i) => authored(LUXE, `z${i}_${LUXE}`));
  for (const def of [...published, ...archived, ...met]) legacyRecord(m, tenant, def);
  return { published: [...published, ...met], met: met.map(d => d.key) };
}

/** KV audience calls, each held 2 ms, counted in waves (a wave starts when none is in flight) with the most in flight at once. */
function kvWaves(m: Mounted) {
  const log: Array<{ method: string }> = [];
  let inFlight = 0, waves = 0, maxGets = 0, getsInFlight = 0;
  for (const method of ['get', 'list'] as const) {
    const current = (m.cache as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method]!;
    Object.defineProperty(m.cache, method, { configurable: true, writable: true, value: async (...args: unknown[]) => {
      const first = args[0], key = typeof first === 'string' ? first : JSON.stringify(first ?? null);
      if (!key.includes('audience:')) return current.apply(m.cache, args);
      if (inFlight === 0) waves++;
      inFlight++; if (method === 'get') { getsInFlight++; maxGets = Math.max(maxGets, getsInFlight); }
      log.push({ method });
      try { await new Promise(resolve => setTimeout(resolve, 2)); return await current.apply(m.cache, args); }
      finally { inFlight--; if (method === 'get') getsInFlight--; }
    } });
  }
  return { reset: () => { log.length = 0; waves = 0; maxGets = 0; },
    read: () => ({ lists: log.filter(c => c.method === 'list').length, gets: log.filter(c => c.method === 'get').length, waves, maxGetsInFlight: maxGets }) };
}

describe('unit:P105.AL4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): an unmoved tenant (its set has no audiences member) with 1,005 KV records is read with every page of the list followed and every get issued at once (the list's two pages, then one wave of gets), 1,005 keys answering all 1,000 published; its first audience write creates the member from those records in the same publication, after which no action reads an audience from KV`, async () => {
      const w = await world(host);
      const legacy = legacyThousand(w.m);
      expect(audiencesMember(w.m), `PRECONDITION (${host}): the tenant's set has no audiences member`).toBeNull();
      const waves = kvWaves(w.m);
      const s = await shopperOn(w.m);
      waves.reset();
      const first = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), 60_000, 0);
      const shape = waves.read();
      expect({ lists: shape.lists, waves: shape.waves, everyGetAtOnce: shape.gets > 0 && shape.maxGetsInFlight === shape.gets },
        `${host}: P105.AL4 — the unmoved read follows every page and issues every get at once (${JSON.stringify(shape)})`).toEqual({ lists: 2, waves: 3, everyGetAtOnce: true });
      expect(segmentsOf(first.body) ?? [], `${host}: P105.AL4 — the published audiences on the list's second page qualify her`).toEqual(expect.arrayContaining(legacy.met));
      expect((await listedThrough(w)).length, `${host}: P105.AL4 — 1,005 keys answer all 1,000 published`).toBe(1000);

      const before = setRevision(w.m), added = authored(LUXE, 'zz_first_write');
      expect((await publishThrough(w, added)).status, `PRECONDITION (${host}): the operator publishes the tenant's first audience since the records`).toBe(200);
      expect({ publications: setRevision(w.m) - before, member: keysOf(audiencesMember(w.m)?.audiences) },
        `${host}: P105.AL4 — the first write creates the member from the records and itself, in one publication`).toEqual({ publications: 1, member: keysOf([...legacy.published, added]) });
      const next = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect(segmentsOf(next.body) ?? [], `${host}: P105.AL4 — the next action qualifies her for the new audience`).toContain(added.key);
      expect(next.kv, `${host}: P105.AL4 — and reads no audience from KV`).toEqual([]);
    }, 300_000);
  }

  it('host (session): the five-minute scheduled run (src/index.ts scheduled, cron */5, customer profile) creates the member for EVERY provisioned tenant from its KV records — every page, a tenant with none included — with no operator, one publication each, each tenant\'s own; after it no action reads an audience from KV', async () => {
    const w = await world('session', { tenants: [OTHER, EMPTY] });
    const coach = legacyThousand(w.m);
    const acme = [authored(LUXE, 'acme_luxe'), authored(VIP, 'acme_vip')];
    for (const def of acme) legacyRecord(w.m, OTHER, def);
    legacyRecord(w.m, OTHER, { ...authored(LUXE, 'acme_archived'), status: 'archived' });
    const before = { coach: setRevision(w.m), acme: setRevision(w.m, OTHER), globex: setRevision(w.m, EMPTY) };
    // R-P717: the move is metered and resumable (R-P713), so the run is repeated until every member exists, at most COST_MARKING_RUNS runs.
    for (let run = 0; run < COST_MARKING_RUNS && [TENANT, OTHER, EMPTY].some(tenant => audiencesMember(w.m, tenant) === null); run++) await fiveMinuteRun(w, { AUTH_MODE: 'enforced' });
    expect({ coach: setRevision(w.m) - before.coach, acme: setRevision(w.m, OTHER) - before.acme, globex: setRevision(w.m, EMPTY) - before.globex },
      'P105.AL4 — the run publishes once for each provisioned tenant').toEqual({ coach: 1, acme: 1, globex: 1 });
    expect({ coach: keysOf(audiencesMember(w.m)?.audiences), acme: keysOf(audiencesMember(w.m, OTHER)?.audiences), globex: audiencesMember(w.m, EMPTY)?.audiences ?? 'no member' },
      'P105.AL4 — each member is exactly that tenant\'s published records, every page of the list read; a tenant with none holds an empty member, so its request path lists no KV either')
      .toEqual({ coach: keysOf(coach.published), acme: keysOf(acme), globex: [] });
    const s = await shopperOn(w.m);
    const next = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
    expect(segmentsOf(next.body) ?? [], 'P105.AL4 — a moved tenant\'s audiences qualify her').toEqual(expect.arrayContaining(coach.met));
    expect(next.kv, 'P105.AL4 — and the action reads no audience from KV').toEqual([]);
  }, 300_000);

  for (const host of HOSTS) {
    it(`host (${host}): R-P644 (4), the deploy window — after the move, an earlier release's KV-only writes (a publish, a prune, a rename, each record as src/connectors/AudienceStore.ts wrote it at 2a90ecf0) are read by no action, and the next five-minute run reconciles them into the member in one publication; a run with nothing to reconcile publishes nothing`, async () => {
      const w = await world(host);
      const kept = authored(VIP, 'dw_kept'), pruned = authored(LUXE, 'dw_pruned'), renamed = authored(VIP, 'dw_renamed');
      for (const def of [kept, pruned, renamed]) expect((await publishThrough(w, def)).status, `PRECONDITION (${host}): the operator publishes ${def.key}`).toBe(200);
      expect(keysOf(audiencesMember(w.m)?.audiences), `PRECONDITION (${host}): the tenant is moved, its member holds the three`).toEqual(keysOf([kept, pruned, renamed]));
      const record = (key: string) => JSON.parse(w.m.cache.data.get(`audience:${key}`) ?? 'null') as AudienceDef;
      const added = authored(LUXE, 'dw_added_by_old_release');
      legacyRecord(w.m, TENANT, added);
      legacyRecord(w.m, TENANT, { ...record(pruned.key), status: 'archived' });
      legacyRecord(w.m, TENANT, { ...record(renamed.key), name: 'Renamed by the earlier release' });
      const s = await shopperOn(w.m);
      const before = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect({ pruned: stillQualifies(before, pruned.key), added: stillQualifies(before, added.key).qualifies, kv: before.kv },
        `${host}: P105.AL4 — before the run no action reads the earlier release's KV-only writes: the member still says what it said`).toEqual({ pruned: { segmentsNamed: true, qualifies: true }, added: false, kv: [] });
      const revision = setRevision(w.m);
      await fiveMinuteRun(w, { AUTH_MODE: 'enforced' });
      const member = audiencesMember(w.m);
      expect({ publications: setRevision(w.m) - revision, member: keysOf(member?.audiences), renamed: member?.audiences.find(a => a.key === renamed.key)?.name },
        `${host}: P105.AL4 — the next five-minute run reconciles the KV records written after the move into the member, in one publication`)
        .toEqual({ publications: 1, member: keysOf([kept, renamed, added]), renamed: 'Renamed by the earlier release' });
      const after = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect({ added: stillQualifies(after, added.key), pruned: stillQualifies(after, pruned.key).qualifies, kv: after.kv },
        `${host}: P105.AL4 — her next action qualifies the earlier release's publish and no longer its prune, from no KV`).toEqual({ added: { segmentsNamed: true, qualifies: true }, pruned: false, kv: [] });
      const settled = setRevision(w.m);
      await fiveMinuteRun(w, { AUTH_MODE: 'enforced' });
      expect(setRevision(w.m) - settled, `${host}: P105.AL4 — a run with nothing to reconcile publishes nothing`).toBe(0);
    }, 300_000);
  }

  // R-P696 (M2, S53/reviewer-p105/REPORT-1793d6d4.md; the reviewer's probe P3b, ported): the run adopts a KV record
  // only when it was written after the member's version of that audience, never because it differs. Each write here
  // is this release's own, through the operator's door; the run is the Worker's scheduled handler on another
  // isolate's bindings over the same data (R3), as a five-minute run on another machine is.
  for (const host of HOSTS) {
    it(`host (${host}): R-P696 (M2) — a five-minute run landing between a rename's commit and its KV put, then one between a pin's commit and its KV put, leaves both committed writes as they are: each answers 200, the member and the KV record name the audience renamed and pinned, now and after the next run, and the operator's list reads it so`, async () => {
      const w = await world(host);
      const x = authored(VIP, 'm2_race', 'Original name');
      expect((await publishThrough(w, x)).status, `PRECONDITION (${host}): the operator publishes ${x.key} (the tenant's first audience write moves it)`).toBe(200);
      const live = w.m.cache as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>, put = live.put!;
      const landed: Array<{ verb: string; committedBefore: boolean }> = [];
      let armed: { verb: string; from: number } | null = null;
      Object.defineProperty(w.m.cache, 'put', { configurable: true, writable: true, value: async (...args: unknown[]) => {
        if (armed && args[0] === `audience:${x.key}`) {
          const { verb: name, from } = armed; armed = null;
          landed.push({ verb: name, committedBefore: setRevision(w.m) > from });
          await fiveMinuteRunElsewhere(w);
        }
        return put.apply(w.m.cache, args);
      } });
      const state = () => {
        const entry = audiencesMember(w.m)?.audiences.find(a => a.key === x.key), record = JSON.parse(w.m.cache.data.get(`audience:${x.key}`) ?? 'null') as AudienceDef | null;
        return { member: { name: entry?.name ?? null, pinned: entry?.pinned ?? false }, kv: { name: record?.name ?? null, pinned: record?.pinned ?? false } };
      };
      armed = { verb: 'rename', from: setRevision(w.m) };
      const renamed = await verb(w, x.key, 'rename', { name: 'Renamed by operator' });
      const afterRename = { status: renamed.status, ...state() };
      armed = { verb: 'pin', from: setRevision(w.m) };
      const pinned = await verb(w, x.key, 'pin', { pinned: true });
      const afterPin = { status: pinned.status, ...state() };
      expect(landed, `PRECONDITION (${host}): a five-minute run landed inside each write, after its commit and before its KV put`)
        .toEqual([{ verb: 'rename', committedBefore: true }, { verb: 'pin', committedBefore: true }]);
      await fiveMinuteRunElsewhere(w);
      const listed = (await listedThrough(w)).find(d => d.key === x.key);
      const afterNextRun = { ...state(), listed: { name: listed?.name ?? null, pinned: listed?.pinned ?? false } };
      expect({ afterRename, afterPin, afterNextRun },
        `${host}: P105.AL4 (R-P696, M2) — the run never reverts a committed write: the rename, then the pin, stay in the member and the KV record, now and after the next run, and the operator's list reads them`)
        .toEqual({
          afterRename: { status: 200, member: { name: 'Renamed by operator', pinned: false }, kv: { name: 'Renamed by operator', pinned: false } },
          afterPin: { status: 200, member: { name: 'Renamed by operator', pinned: true }, kv: { name: 'Renamed by operator', pinned: true } },
          afterNextRun: { member: { name: 'Renamed by operator', pinned: true }, kv: { name: 'Renamed by operator', pinned: true }, listed: { name: 'Renamed by operator', pinned: true } },
        });
    }, 300_000);

    it(`host (${host}): R-P696 (M2) — a five-minute run reading a stale KV value (the record as it was before a committed rename, KV's propagation window) leaves the committed rename as it is: the member, the KV record and the operator's list name it renamed after that run and after the next`, async () => {
      const w = await world(host);
      const x = authored(VIP, 'm2_stale', 'Original name');
      expect((await publishThrough(w, x)).status, `PRECONDITION (${host}): the operator publishes ${x.key} (the tenant's first audience write moves it)`).toBe(200);
      const before = new Map([...w.m.cache.data].filter(([key]) => key.includes('audience:')));
      expect((JSON.parse(before.get(`audience:${x.key}`) ?? 'null') as AudienceDef | null)?.name, `PRECONDITION (${host}): the KV record says ${x.name}`).toBe('Original name');
      const renamed = await verb(w, x.key, 'rename', { name: 'Renamed by operator' });
      const state = async () => {
        const entry = audiencesMember(w.m)?.audiences.find(a => a.key === x.key), record = JSON.parse(w.m.cache.data.get(`audience:${x.key}`) ?? 'null') as AudienceDef | null;
        return { member: entry?.name ?? null, kv: record?.name ?? null, listed: (await listedThrough(w)).find(d => d.key === x.key)?.name ?? null };
      };
      const afterRename = { status: renamed.status, ...await state() };
      await fiveMinuteRunElsewhere(w, staleAudienceReads(w, before));
      const afterStaleRun = await state();
      await fiveMinuteRunElsewhere(w);
      const afterNextRun = await state();
      expect({ afterRename, afterStaleRun, afterNextRun },
        `${host}: P105.AL4 (R-P696, M2) — a run reading the record as it was before the rename never reverts it: the member, the KV record and the operator's list name it renamed after that run and after the next`)
        .toEqual({
          afterRename: { status: 200, member: 'Renamed by operator', kv: 'Renamed by operator', listed: 'Renamed by operator' },
          afterStaleRun: { member: 'Renamed by operator', kv: 'Renamed by operator', listed: 'Renamed by operator' },
          afterNextRun: { member: 'Renamed by operator', kv: 'Renamed by operator', listed: 'Renamed by operator' },
        });
    }, 300_000);
  }

  // R-P696 (follow-up 3): the move is a set publication, so an operator publication whose If-Match predates it is
  // refused 409 publication_conflict (the publication's own compare-and-swap, accepted by R-P644 (7)), and the
  // operator's retry with a fresh If-Match is accepted. The slots document, through the door operators use (kit 02).
  for (const host of HOSTS) {
    it(`host (${host}): R-P696 — an operator's slots publication whose If-Match predates the five-minute run's move answers 409 publication_conflict once, and its retry with the If-Match read after the move answers 200`, async () => {
      const w = await world(host);
      const path = `/content/slots?scope=${TENANT}`;
      const base = await operator(w, 'GET', path);
      expect(base.status, `PRECONDITION (${host}): the operator reads the slots document`).toBe(200);
      const put = async (read: Answer) => {
        const publication = read.body.publication as { revision: number; digest: string }, revision = read.body.revision as number;
        const response = await w.app.fetch(new Request('http://console.test' + path, { method: 'PUT', body: JSON.stringify({ document: base.body.document, note: 'P105 R-P696 409' }), headers: {
          'X-Tenant': TENANT, Authorization: `Bearer ${w.token}`, 'content-type': 'application/json',
          'If-Match': `"${revision}/${publication.revision}/${publication.digest}"`, 'Idempotency-Key': `${revision}:${crypto.randomUUID()}` } }));
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        await settle(w.m, w.app);
        return { status: response.status, namesConflict: JSON.stringify(body).includes('publication_conflict') };
      };
      const at = setRevision(w.m);
      await fiveMinuteRun(w, { AUTH_MODE: 'enforced' });
      expect({ moved: setRevision(w.m) - at, member: audiencesMember(w.m)?.audiences ?? 'no member' },
        `PRECONDITION (${host}): the five-minute run moved the tenant (one set publication creating its empty audiences member)`).toEqual({ moved: 1, member: [] });
      const stale = await put(base);
      const fresh = await operator(w, 'GET', path);
      const retry = await put(fresh);
      expect({ stale, retry: retry.status },
        `${host}: P105.AL4 (R-P696) — the write whose If-Match predates the move answers 409 publication_conflict once, and its retry answers 200`)
        .toEqual({ stale: { status: 409, namesConflict: true }, retry: 200 });
    }, 120_000);
  }

  it('host (do): the five-minute scheduled run on the demo profile moves the default tenant too; after it the request path lists no audience in KV', async () => {
    const w = await world('do', { demo: true });
    const coach = legacyThousand(w.m);
    const before = setRevision(w.m);
    // R-P717: the move is metered and resumable (R-P713), so the run is repeated until the member exists, at most COST_MARKING_RUNS runs.
    for (let run = 0; run < COST_MARKING_RUNS && audiencesMember(w.m) === null; run++) await fiveMinuteRun(w, {});
    expect({ publications: setRevision(w.m) - before, member: keysOf(audiencesMember(w.m)?.audiences) },
      'P105.AL4 — the run on the demo profile creates the default tenant\'s member from its records, every page').toEqual({ publications: 1, member: keysOf(coach.published) });
    const s = await shopperOn(w.m);
    const next = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
    expect(next.status, 'PRECONDITION: the demo action answers').toBe(200);
    expect(next.kv.filter(call => call.startsWith('CACHE.list')), 'P105.AL4 — the request path lists no audience in KV').toEqual([]);
  }, 300_000);

  // R-P699 (work order be4b070f, AL4's last sentence): the reconciliation's cost. A tenant moved by the run from an
  // earlier release's records (no metadata, as src/connectors/AudienceStore.ts wrote them at 2a90ecf0), the run
  // repeated until the store says the move's records are marked (every record listed with KV metadata, the R10 on
  // src/units/_parity.ts UnitKV), at most COST_MARKING_RUNS runs. Then one more run with no write since: the KV list
  // calls that name its records (one per 1,000 keys) and no get. Then an earlier release's KV-only rename (its read
  // record spread with the new name, put with no metadata, AudienceStore.ts rename at 2a90ecf0): the next run adopts
  // it and gets that record alone. In both runs every reconciliation call is counted in the run's meter
  // (`hourlyProbe`): what the run counted before the open hour's fold, beside the catch-up, equals the calls the
  // reconciliation was observed to make (`reconciliationCalls`). Counts only, never time.
  for (const host of HOSTS) {
    it(`host (${host}): R-P699 — at 10 and at 1,000 audiences, once the move's records are marked, a five-minute run with no write since makes one KV list per 1,000 keys and no KV get; an earlier release's KV-only rename is adopted by the next run, which gets that record alone; every reconciliation call is counted in the run's meter (RUN_BUDGET)`, async () => {
      const seen: Record<string, unknown> = {}, wanted: Record<string, unknown> = {};
      for (const n of COST_SIZES) {
        const w = await world(host);
        const defs = Array.from({ length: n }, (_, i) => atScale(i));
        for (const def of defs) legacyRecord(w.m, TENANT, def);
        expect(audiencesMember(w.m), `PRECONDITION (${host}, ${n}): the tenant's set has no audiences member`).toBeNull();
        const marked = () => defs.filter(d => w.m.cache.metadata.has(`audience:${d.key}`)).length;
        let runs = 0;
        do { await fiveMinuteRun(w, { AUTH_MODE: 'enforced' }); runs++; } while (runs < COST_MARKING_RUNS && marked() < n);
        expect(keysOf(audiencesMember(w.m)?.audiences), `PRECONDITION (${host}, ${n}): the five-minute run moved the tenant, its member holds the ${n} records`).toEqual(keysOf(defs));
        const probe = reconciliationCalls(w);
        const lists = Math.ceil(n / 1000);

        const steady = await probe.run(() => fiveMinuteRun(w, { AUTH_MODE: 'enforced' }));

        const target = defs[Math.floor(n / 2)]!, key = `audience:${target.key}`;
        const read = JSON.parse(w.m.cache.data.get(key) ?? 'null') as AudienceDef | null;
        expect(read?.key, `PRECONDITION (${host}, ${n}): the earlier release reads the record it renames`).toBe(target.key);
        await w.m.cache.put(key, JSON.stringify({ ...read, name: 'Renamed by the earlier release' }));
        const adopting = await probe.run(() => fiveMinuteRun(w, { AUTH_MODE: 'enforced' }));
        const member = audiencesMember(w.m)?.audiences.find(a => a.key === target.key)?.name ?? null;

        seen[`${n} audiences`] = {
          markedAfterRuns: marked(),
          steady: { kvLists: steady.kvLists, kvGets: steady.kvGets.length, meter: steady.meter },
          adopting: { member, kvLists: adopting.kvLists, kvGets: adopting.kvGets.length, getsOfTheRenamed: adopting.kvGets.filter(k => k === key).length, meter: adopting.meter },
        };
        wanted[`${n} audiences`] = {
          markedAfterRuns: n,
          steady: { kvLists: lists, kvGets: 0, meter: steady.observed },
          adopting: { member: 'Renamed by the earlier release', kvLists: lists, kvGets: 1, getsOfTheRenamed: 1, meter: adopting.observed },
        };
      }
      expect(seen, `${host}: P105.AL4 (R-P699) — once the move's records are marked (every record listed with metadata, within ${COST_MARKING_RUNS} runs), a run with no write since makes one KV list per 1,000 keys and no KV get, an earlier release's KV-only rename is adopted by the next run, which gets that record alone, and the run's meter (RUN_BUDGET less the open hour's fold budget and the catch-up's calls) counts every reconciliation call observed`)
        .toEqual(wanted);
    }, 600_000);
  }

  // R-P713 (B2; work order 671b0948, AL4's last sentence): a legacy tenant whose audiences cannot fit the member's
  // 2 MiB bound (800 records of about 3.6 KB, about 2.9 MB; the reviewer's probe D4, S53/reviewer-p105-r3). Every
  // five-minute run counts the move's calls in its meter and stays under RUN_BUDGET, so the folds keep a budget; the
  // refusal is stored by name (document_too_large) with the measured size, found in either store whatever its key;
  // with the records unchanged the next runs read none of them (never the move at full cost again); and the operator's
  // publish answers as base answered (200, the KV path: the record in KV, the tenant still unmoved, the operator's list
  // naming all 801), never 413. Counts only.
  for (const host of HOSTS) {
    it(`host (${host}): R-P713 (B2) — a legacy tenant over the member's 2 MiB bound (800 records of about 3.6 KB): every five-minute run meters the move under RUN_BUDGET, the refusal is stored by name with its measured size, the next runs read no record while the records are unchanged, and the operator's publish answers 200 on the KV path as base, never 413`, async () => {
      const w = await world(host);
      const defs = Array.from({ length: OVER_BOUND_RECORDS }, (_, i) => overBound(i));
      for (const def of defs) legacyRecord(w.m, TENANT, def);
      expect(documentBytes({ version: 1, audiences: defs }), `PRECONDITION (${host}): the records cannot fit the member's bound`).toBeGreaterThan(PUBLICATION_MAX_BYTES);
      const probe = reconciliationCalls(w);
      const rows: Array<{ run: number; meter: number; observed: number; underTheLimit: boolean }> = [];
      for (let run = 1; run <= COST_MARKING_RUNS && !storedRefusal(w.m).named; run++) {
        const got = await probe.run(() => fiveMinuteRun(w, { AUTH_MODE: 'enforced' }));
        rows.push({ run, meter: got.meter, observed: got.observed, underTheLimit: got.observed < RUN_BUDGET });
      }
      const refusal = storedRefusal(w.m);
      const after: Array<{ reconcilingKvGets: number; meter: number; observed: number }> = [];
      for (let run = 0; run < 2; run++) {
        const got = await probe.run(() => fiveMinuteRun(w, { AUTH_MODE: 'enforced' }));
        after.push({ reconcilingKvGets: got.reconcilingKvGets, meter: got.meter, observed: got.observed });
      }
      const added = authored(LUXE, 'b2_published_on_base_path');
      const published = await publishThrough(w, added);
      const listed = await operator(w, 'GET', '/operator/audiences');
      const listedKeys = ((listed.body.audiences ?? []) as AudienceDef[]).map(d => d.key);
      expect({
        runs: rows, refusal, member: audiencesMember(w.m) === null ? 'not moved' : 'moved', after,
        publish: { status: published.status, member: audiencesMember(w.m) === null ? 'not moved' : 'moved', kvRecord: w.m.cache.data.has(`audience:${added.key}`),
          listed: listed.status, listedCount: listedKeys.length, listsIt: listedKeys.includes(added.key) },
      }, `${host}: P105.AL4 (R-P713, B2) — the over-bound tenant: every run's move counted in its meter and under RUN_BUDGET (the folds keep a budget), the refusal stored by name with its size, no record read again while unchanged, the operator's publish 200 on base's KV path`)
        .toEqual({
          runs: rows.map(r => ({ run: r.run, meter: r.observed, observed: r.observed, underTheLimit: true })),
          refusal: { named: true, sizeOverTheBound: true }, member: 'not moved',
          after: after.map(r => ({ reconcilingKvGets: 0, meter: r.observed, observed: r.observed })),
          publish: { status: 200, member: 'not moved', kvRecord: true, listed: 200, listedCount: OVER_BOUND_RECORDS + 1, listsIt: true },
        });
    }, 900_000);
  }

  // R-P713 (B3; the reviewer's probe D3, S53/reviewer-p105-r3/tools/probe3.ts.txt, ported): the notes. A moved tenant
  // holding an earlier release's record (unmarked); this release's rename of it commits and then its KV put fails, so
  // KV keeps the earlier release's record; every following five-minute run leaves the committed rename in the member
  // and in the operator's list (the record the write superseded is noted, never adopted).
  for (const host of HOSTS) {
    it(`host (${host}): R-P713 (B3) — a committed rename over an earlier release's record whose KV put fails after the commit survives every following five-minute run: the member and the operator's list name it renamed after each of three runs`, async () => {
      const w = await world(host);
      const x = authored(VIP, 'b3_notes', 'Original name');
      legacyRecord(w.m, TENANT, x);
      expect((await publishThrough(w, authored(LUXE, 'b3_first_write'))).status, `PRECONDITION (${host}): the tenant's first audience write moves it`).toBe(200);
      expect(audiencesMember(w.m)?.audiences.find(a => a.key === x.key)?.name, `PRECONDITION (${host}): the move took the earlier release's record`).toBe('Original name');
      const live = w.m.cache as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>, put = live.put!;
      let failing = true;
      Object.defineProperty(w.m.cache, 'put', { configurable: true, writable: true, value: async (...args: unknown[]) => {
        if (failing && args[0] === `audience:${x.key}`) { failing = false; throw new Error('P105 R-P713 lever: the KV put after the commit fails'); }
        return put.apply(w.m.cache, args);
      } });
      await verb(w, x.key, 'rename', { name: 'Renamed by operator' });
      expect({ putFailed: !failing, member: audiencesMember(w.m)?.audiences.find(a => a.key === x.key)?.name ?? null, kv: (JSON.parse(w.m.cache.data.get(`audience:${x.key}`) ?? 'null') as AudienceDef | null)?.name ?? null },
        `PRECONDITION (${host}): the rename committed and its KV put failed, KV keeping the earlier release's record`).toEqual({ putFailed: true, member: 'Renamed by operator', kv: 'Original name' });
      const afterRuns: Array<{ member: string | null; listed: string | null }> = [];
      for (let run = 0; run < 3; run++) {
        await fiveMinuteRun(w, { AUTH_MODE: 'enforced' });
        afterRuns.push({ member: audiencesMember(w.m)?.audiences.find(a => a.key === x.key)?.name ?? null, listed: (await listedThrough(w)).find(d => d.key === x.key)?.name ?? null });
      }
      expect(afterRuns, `${host}: P105.AL4 (R-P713, B3) — the committed rename survives every following run (the superseded record noted, never adopted)`)
        .toEqual([0, 1, 2].map(() => ({ member: 'Renamed by operator', listed: 'Renamed by operator' })));
    }, 300_000);
  }

  // R-P713 (B4, and B2's 1,000-record case; the reviewer's probe D2): the cap. A legacy tenant of 1,000 records, whose
  // move and marking need more than one run's budget, is moved and marked by the five-minute runs, each stopping under
  // RUN_BUDGET with every call counted (so the folds keep a budget on every run, the move's own run included) and the
  // next run resuming, until the store says the move's records are marked (within COST_MARKING_RUNS runs).
  for (const host of HOSTS) {
    it(`host (${host}): R-P713 (B4) — a legacy tenant of 1,000 records whose move needs more than one run's budget: each five-minute run stops under RUN_BUDGET with every call in its meter (the folds keep a budget, the move's own run included) and the next resumes, until the member holds the 1,000 and every record is marked`, async () => {
      const w = await world(host);
      const defs = Array.from({ length: 1000 }, (_, i) => atScale(i));
      for (const def of defs) legacyRecord(w.m, TENANT, def);
      const marked = () => defs.filter(d => w.m.cache.metadata.has(`audience:${d.key}`)).length;
      const probe = reconciliationCalls(w);
      const rows: Array<{ run: number; meter: number; observed: number; underTheLimit: boolean }> = [];
      for (let run = 1; run <= COST_MARKING_RUNS && !(audiencesMember(w.m) !== null && marked() === defs.length); run++) {
        const got = await probe.run(() => fiveMinuteRun(w, { AUTH_MODE: 'enforced' }));
        rows.push({ run, meter: got.meter, observed: got.observed, underTheLimit: got.observed < RUN_BUDGET });
      }
      expect({ runs: rows, member: audiencesMember(w.m)?.audiences.length ?? 'not moved', marked: marked() },
        `${host}: P105.AL4 (R-P713, B4) — every run stops under RUN_BUDGET with every call counted, and the next resumes, until moved and marked within ${COST_MARKING_RUNS} runs`)
        .toEqual({ runs: rows.map(r => ({ run: r.run, meter: r.observed, observed: r.observed, underTheLimit: true })), member: defs.length, marked: defs.length });
    }, 900_000);
  }

  // R-P722 (B5; the round-4 review S53/reviewer-p105-r4/REPORT-70e2072d.md, its probe tools/probe-race-2.ts.txt
  // ported): no write answered by the store may be lost to a five-minute run's move in flight. An unmoved tenant just
  // under the member's bound (584 legacy records, 3,000 B under); the first run starts the move and does not finish it;
  // a publish adding about 6 KB (the operator route's own store, so the set no longer fits and the write keeps base's
  // KV path) lands between runs (the control) or INSIDE the next run, after the run read its progress and before it
  // publishes or writes progress (fired at the run's first read of an audience record), its key sorting before the
  // run's cursor or after it. After that run and after two more, the tenant is not moved (its audiences cannot fit,
  // AL4) and the operator's list reads all 585, the written audience among them.
  for (const host of HOSTS) {
    it(`host (${host}): R-P722 (B5) — a publish over the bound landing inside a five-minute run's move in flight (its key before the run's cursor, or after it), or between runs, is never lost: after that run and after two more the tenant is not moved and the operator's list reads the written audience among all 585`, async () => {
      const outcomes: Record<string, unknown> = {}, wanted: Record<string, unknown> = {};
      for (const variant of ['between runs', 'inside the run, before its cursor', 'inside the run, after its cursor'] as const) {
        const w = await world(host);
        const defs = nearBound();
        for (const def of defs) legacyRecord(w.m, TENANT, def);
        const added = { ...authored(LUXE, variant.endsWith('after its cursor') ? 'zz_b5_written_in_the_move' : 'a_b5_written_in_the_move'), description: 'z'.repeat(6000) };
        expect({ records: documentBytes({ version: 1, audiences: defs }) <= PUBLICATION_MAX_BYTES, withTheWrite: documentBytes({ version: 1, audiences: [...defs, added] }) > PUBLICATION_MAX_BYTES },
          `PRECONDITION (${host}, ${variant}): the records fit the member's bound and the write takes them past it`).toEqual({ records: true, withTheWrite: true });
        await fiveMinuteRun(w, { AUTH_MODE: 'enforced' });
        expect(audiencesMember(w.m), `PRECONDITION (${host}, ${variant}): the first run started the move and did not finish it`).toBeNull();
        let written = 'not yet', fired = false;
        const write = async () => {
          try { await new KvAudienceStore(w.m.env, TENANT as TenantId).publish(added); written = 'answered'; } catch (error) { written = String(error); }
        };
        if (variant === 'between runs') { await write(); fired = true; }
        const get = (w.m.cache as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>).get!;
        let armed = variant !== 'between runs';
        Object.defineProperty(w.m.cache, 'get', { configurable: true, writable: true, value: async (...args: unknown[]) => {
          if (armed && typeof args[0] === 'string' && args[0].includes('audience:')) { armed = false; await write(); fired = true; }
          return get.apply(w.m.cache, args);
        } });
        const state = async () => {
          const member = audiencesMember(w.m), listed = await listedThrough(w);
          return { member: member === null ? 'not moved' : member.audiences.some(a => a.key === added.key) ? 'moved, holding it' : 'moved without it',
            listsIt: listed.some(d => d.key === added.key), listed: listed.length };
        };
        await fiveMinuteRun(w, { AUTH_MODE: 'enforced' });
        armed = false;
        const afterThatRun = await state();
        await fiveMinuteRun(w, { AUTH_MODE: 'enforced' });
        await fiveMinuteRun(w, { AUTH_MODE: 'enforced' });
        const afterTwoMore = await state();
        outcomes[variant] = { fired, written, afterThatRun, afterTwoMore };
        const kept = { member: 'not moved', listsIt: true, listed: defs.length + 1 };
        wanted[variant] = { fired: true, written: 'answered', afterThatRun: kept, afterTwoMore: kept };
      }
      expect(outcomes, `${host}: P105.AL4 (R-P722, B5) — a publish answered during the move is never lost, whether it lands between runs or inside one, before or after the run's cursor: the tenant stays unmoved and the operator's list reads it, after that run and after two more`)
        .toEqual(wanted);
    }, 900_000);
  }

  // R-P722 (the round-4 review's follow-up 2): after a refused move, a change to the tenant's KV list brings the next run
  // to retry it. The B5 tenant (584 records just under the bound) refused by a publish of about 6 KB (the store's
  // refusal stored by name); one run with nothing changed; then the operator archives three legacy audiences (the store,
  // on base's KV path), which brings the set back under the bound; the next runs retry the move and create the member
  // holding exactly the published audiences.
  for (const host of HOSTS) {
    it(`host (${host}): R-P722 — after a refused move, a change to the tenant's KV list (three audiences archived, the set back under the bound) brings the next five-minute run to retry the move, and the runs create the member holding exactly the published audiences`, async () => {
      const w = await world(host);
      const defs = nearBound();
      for (const def of defs) legacyRecord(w.m, TENANT, def);
      const store = new KvAudienceStore(w.m.env, TENANT as TenantId);
      const added = { ...authored(LUXE, 'a_retry_over_the_bound'), description: 'z'.repeat(6000) };
      await store.publish(added);
      expect({ refusal: storedRefusal(w.m), member: audiencesMember(w.m) === null ? 'not moved' : 'moved' },
        `PRECONDITION (${host}): the publish took the set past the bound, the move refused by name`).toEqual({ refusal: { named: true, sizeOverTheBound: true }, member: 'not moved' });
      await fiveMinuteRun(w, { AUTH_MODE: 'enforced' });
      const archived = defs.slice(0, 3);
      for (const def of archived) await store.archive(def.key);
      const published = [...defs.slice(3), added];
      expect({ member: audiencesMember(w.m) === null ? 'not moved' : 'moved', fits: documentBytes({ version: 1, audiences: published }) < PUBLICATION_MAX_BYTES },
        `PRECONDITION (${host}): the archives kept base's KV path and bring the set back under the bound`).toEqual({ member: 'not moved', fits: true });
      const probe = reconciliationCalls(w);
      const next = await probe.run(() => fiveMinuteRun(w, { AUTH_MODE: 'enforced' }));
      for (let run = 1; run < COST_MARKING_RUNS && audiencesMember(w.m) === null; run++) await fiveMinuteRun(w, { AUTH_MODE: 'enforced' });
      expect({ nextRunRetries: next.reconcilingKvGets > 0, member: audiencesMember(w.m) === null ? 'not moved' : keysOf(audiencesMember(w.m)?.audiences) },
        `${host}: P105.AL4 (R-P722) — the change to the list brings the next run to retry the move (it reads the records again), and the runs create the member holding exactly the published audiences`)
        .toEqual({ nextRunRetries: true, member: keysOf(published) });
    }, 900_000);
  }
});

/**
 * R-P722 (B5): an unmoved tenant just under the member's bound, as the round-4 reviewer's probe built it: the
 * over-bound records (`overBound`) while they fit 4,000 B under the bound, the last one grown so the set is 3,000 B
 * under it (584 records).
 */
function nearBound(): AudienceDef[] {
  const defs: AudienceDef[] = [];
  for (let i = 0; ; i++) { const def = overBound(i); if (documentBytes({ version: 1, audiences: [...defs, def] }) > PUBLICATION_MAX_BYTES - 4000) break; defs.push(def); }
  const gap = PUBLICATION_MAX_BYTES - 3000 - documentBytes({ version: 1, audiences: defs }), last = defs[defs.length - 1]!;
  defs[defs.length - 1] = { ...last, description: (last.description ?? '') + 'y'.repeat(gap) };
  return defs;
}

/** R-P713 (B2): the over-bound legacy tenant, Coach's launch audiences in turn, each carrying a long description (about 3.6 KB a record). */
const OVER_BOUND_RECORDS = 800;
const overBound = (i: number): AudienceDef => {
  const def = atScale(i);
  return { ...def, description: `${def.description ?? def.name} `.repeat(Math.ceil(3000 / ((def.description ?? def.name).length + 1))).slice(0, 3000) };
};
/**
 * R-P713 (B2): a refusal of the move stored by name: any object or KV value (or its metadata) whose text names
 * document_too_large, with a number in it past the member's bound (the measured size). Read from the stores
 * directly, never through a binding call.
 */
function storedRefusal(m: Mounted): { named: boolean; sizeOverTheBound: boolean } {
  const texts = [...m.storage.objects.values(), ...[...m.storage.metadata.values()].map(v => JSON.stringify(v)),
    ...m.cache.data.values(), ...m.cache.metadata.values()].filter(t => t.includes('document_too_large'));
  return { named: texts.length > 0, sizeOverTheBound: texts.some(t => (t.match(/\d{7,}/g) ?? []).some(n => Number(n) > PUBLICATION_MAX_BYTES)) };
}

/** R-P699: the sizes of the cost leg, and the most five-minute runs the move's marking may take (RUN_BUDGET a run). */
const COST_SIZES = [10, 1000] as const;
const COST_MARKING_RUNS = 12;
/** A call the reconciliation made: src/connectors/AudienceStore.ts on its stack, its awaiting frames included, and not qualification's. */
const RECONCILIATION_FRAME = /connectors[\\/]AudienceStore\.[jt]s/;

/**
 * R-P699: one five-minute run's reconciliation, counted. Every KV and R2 call the run makes is recorded (the
 * outermost wrapper on the mounted bindings); `kvLists` and `kvGets` are the KV calls naming the tenant's audience
 * records, `observed` the calls the reconciliation made (RECONCILIATION_FRAME on the call's stack, the
 * qualification frame not: a decision's audience read is the request path's, AL1), and `meter` what the run
 * counted before the open hour's fold beside the catch-up (`hourlyProbe`).
 */
function reconciliationCalls(w: World) {
  const calls: Array<{ binding: string; method: string; key: string; reconciling: boolean }> = [];
  let armed = false;
  const targets: Array<[string, object, readonly string[]]> = [['CACHE', w.m.cache, ['get', 'list', 'put', 'delete']], ['STORAGE', w.m.storage, ['get', 'head', 'put', 'list', 'delete']]];
  for (const [binding, target, methods] of targets) {
    for (const method of methods) {
      const current = (target as Record<string, (...args: unknown[]) => Promise<unknown>>)[method];
      if (typeof current !== 'function') continue;
      Object.defineProperty(target, method, { configurable: true, writable: true, value: (...args: unknown[]) => {
        if (armed) {
          const limit = Error.stackTraceLimit;
          Error.stackTraceLimit = 200;
          const stack = new Error('P105 R-P699 trace').stack ?? '';
          Error.stackTraceLimit = limit;
          const first = args[0];
          calls.push({ binding, method, key: typeof first === 'string' ? first : JSON.stringify(first ?? null), reconciling: RECONCILIATION_FRAME.test(stack) && !QUALIFICATION_FRAME.test(stack) });
        }
        return current.apply(target, args);
      } });
    }
  }
  return {
    async run(five: () => Promise<void>) {
      calls.length = 0; hourlyProbe.catchUpCalls.length = 0; hourlyProbe.catchUpBudgets.length = 0; hourlyProbe.foldBudgets.length = 0;
      armed = true; hourlyProbe.armed = true;
      try { await five(); } finally { armed = false; hourlyProbe.armed = false; }
      expect({ folds: hourlyProbe.foldBudgets.length, catchUps: hourlyProbe.catchUpCalls.length },
        `PRECONDITION (${w.host}): the run handed the tenant's catch-up its storage and the open hour's fold its budget, once each`).toEqual({ folds: 1, catchUps: 1 });
      const kv = calls.filter(c => c.binding === 'CACHE' && c.key.includes('audience:'));
      // R-P713: the open hour's fold budget is what the catch-up left; where the catch-up spent all it was handed
      // (the fold's budget 0), what the run counted before the folds is read from the catch-up's own budget instead.
      const fold = hourlyProbe.foldBudgets[0]!, spent = hourlyProbe.catchUpCalls[0]!, handed = hourlyProbe.catchUpBudgets[0];
      return {
        kvLists: kv.filter(c => c.method === 'list').length,
        kvGets: kv.filter(c => c.method === 'get').map(c => c.key),
        reconcilingKvGets: kv.filter(c => c.method === 'get' && c.reconciling).length,
        observed: calls.filter(c => c.reconciling).length,
        meter: fold > 0 || handed === undefined ? RUN_BUDGET - fold - spent : RUN_BUDGET - handed,
      };
    },
  };
}

/** The worker's own scheduled handler (src/index.ts), cron every five minutes, in process, over the mounted bindings; every job awaited. */
async function fiveMinuteRun(w: World, extra: Record<string, unknown>): Promise<void> {
  const worker = (await import('@/index')).default as unknown as { scheduled: (event: unknown, env: Env, ctx: ExecutionContext) => Promise<void> };
  const jobs: Promise<unknown>[] = [];
  await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now(), noRetry() { /* never */ } }, { ...w.m.env, ...extra } as Env,
    { waitUntil: (p: Promise<unknown>) => { jobs.push(Promise.resolve(p)); }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  await Promise.allSettled(jobs);
  await settle(w.m, w.app);
  invalidatePublicationCache();
}

/**
 * R-P696 (M2): the same scheduled handler as another machine runs it (R3): its own binding objects over the same
 * data, so nothing this isolate holds is its own and nothing it holds is dropped; `cache` replaces its KV binding (a
 * stale reader). It can run inside a request in flight (the race), so it settles nothing of this isolate's.
 */
async function fiveMinuteRunElsewhere(w: World, cache?: object): Promise<void> {
  const worker = (await import('@/index')).default as unknown as { scheduled: (event: unknown, env: Env, ctx: ExecutionContext) => Promise<void> };
  const jobs: Promise<unknown>[] = [];
  const env = { ...w.m.env, AUTH_MODE: 'enforced', CACHE: cache ?? Object.create(w.m.env.CACHE as object), STORAGE: Object.create(w.m.env.STORAGE as object) } as Env;
  await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now(), noRetry() { /* never */ } }, env,
    { waitUntil: (p: Promise<unknown>) => { jobs.push(Promise.resolve(p)); }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  await Promise.allSettled(jobs);
}

/**
 * R-P696 (M2): a KV binding over the same data whose reads of the given audience records answer them as they were
 * (`snapshot`, key → stored text): KV's propagation window, as a reader elsewhere sees it. Every other read and every
 * write is the live binding's.
 */
function staleAudienceReads(w: World, snapshot: ReadonlyMap<string, string>): object {
  const live = w.m.env.CACHE as unknown as { get: (key: string, type?: unknown) => Promise<unknown> };
  const stale = Object.create(live as object) as object;
  Object.defineProperty(stale, 'get', { configurable: true, writable: true, value: async (key: string, type?: unknown) => {
    const held = snapshot.get(key);
    if (held === undefined) return live.get(key, type);
    const as = typeof type === 'object' && type !== null ? (type as { type?: unknown }).type : type;
    return as === 'json' ? JSON.parse(held) as unknown : as === 'stream' ? new Response(held).body : held;
  } });
  return stale;
}

// ===========================================================================
// unit:P105.AL5 — LOCK: the tenant boundary, the demo surfaces, the same segments, kit 02.
// ===========================================================================

describe('unit:P105.AL5', () => {
  for (const host of HOSTS) {
    it(`host (${host}): LOCK — a tenant qualifies only its own audiences: coach's shopper qualifies coach's audience and never ${OTHER}'s identical one, and each tenant's operator read lists only its own`, async () => {
      const w = await world(host, { tenants: [OTHER] });
      expect((await publishThrough(w, authored(LUXE, 'coach_luxe'))).status, `PRECONDITION (${host}): coach's operator publishes`).toBe(200);
      expect((await publishThrough(w, authored(LUXE, 'acme_luxe'), { tenant: OTHER })).status, `PRECONDITION (${host}): ${OTHER}'s operator publishes`).toBe(200);
      const s = await shopperOn(w.m);
      const first = await measured(w, () => actionWire(w.app, s, VIEW_TABBY_26), COLD_BOUND_MS, 0);
      expect({ coach: stillQualifies(first, 'coach_luxe'), acme: stillQualifies(first, 'acme_luxe').qualifies },
        `${host}: P105.AL5 — coach's shopper qualifies coach's audience and never ${OTHER}'s (${JSON.stringify(segmentsOf(first.body))})`).toEqual({ coach: { segmentsNamed: true, qualifies: true }, acme: false });
      expect({ coach: keysOf(await listedThrough(w)), acme: keysOf(await listedThrough(w, { tenant: OTHER })) },
        `${host}: P105.AL5 — each tenant's operator read lists its own`).toEqual({ coach: ['coach_luxe'], acme: ['acme_luxe'] });
    }, 120_000);
  }

  it('logic: LOCK — the default tenant\'s demo surfaces evaluate only their own audiences (SegmentProvider.ts:43-48): a brighthour context qualifies only the brighthour audience, a coach context only the untagged one, a context naming no surface both', async () => {
    const w = await world('session', { demo: true });
    const store = new KvAudienceStore(w.m.env, TENANT as TenantId);
    const coach = authored(LUXE, 'surface_luxe'), brighthour = { ...authored(LUXE, 'bh_surface_luxe'), surface: 'brighthour' };
    await store.publish(coach); await store.publish(brighthour);
    const provider = new MockSegmentProvider(store);
    const ctx = (surface?: string) => ({ userId: 'p105-visitor', attributes: { price_band_viewed: 'elevated' }, segments: [], ...(surface ? { surface } : {}) });
    expect({ brighthour: (await provider.fetchQualifiedSegments('p105-visitor', ctx('brighthour'))).sort(), coach: (await provider.fetchQualifiedSegments('p105-visitor', ctx('coach'))).sort(),
      none: (await provider.fetchQualifiedSegments('p105-visitor', ctx())).sort() }, 'P105.AL5 — each surface evaluates its own audiences')
      .toEqual({ brighthour: ['bh_surface_luxe'], coach: ['surface_luxe'], none: ['bh_surface_luxe', 'surface_luxe'] });
  }, 120_000);

  it('logic: LOCK — qualification answers the same segments as today on the same audiences and contexts: Coach\'s ten launch audiences, published, against a Tabby browser, a Brooklyn cart abandoner, a gifting loyal customer (cross-category), unknown attributes only, and every threshold missed by one', async () => {
    const w = await world('session');
    for (const def of SEED_AUDIENCES) expect((await publishThrough(w, authored(def.key, def.key, def.name))).status, `PRECONDITION: ${def.key} published`).toBe(200);
    const provider = new MockSegmentProvider(new KvAudienceStore(w.m.env, TENANT as TenantId));
    const qualify = async (attributes: Record<string, unknown>) => (await provider.fetchQualifiedSegments('p105-visitor', { userId: 'p105-visitor', attributes, segments: [] })).sort();
    expect({
      tabby: await qualify({ viewed_product_line: 'Tabby', product_views: 3, cart_adds: 0, purchases: 0, journey_stage: 'early', price_band_viewed: 'elevated' }),
      brooklynAbandoner: await qualify({ viewed_product_line: 'Brooklyn', product_views: 5, cart_adds: 1, purchases: 0, cart_abandoned: true, journey_stage: 'mid' }),
      giftingLoyal: await qualify({ gifter: true, average_order_value_usd: 650, loyalty_tier: 'gold', engagement_rank: 'vip', churn_risk_score: 0.7, product_views: 1, purchases: 2, journey_stage: 'late' }),
      unknownOnly: await qualify({ styleWorld: 'downtown', season: 'resort' }),
      missedByOne: await qualify({ loyalty_tier: 'silver', engagement_rank: 'vip', gifter: true, average_order_value_usd: 299, churn_risk_score: 0.59, product_views: 10, viewed_product_line: 'Brooklyn', cart_adds: 0, journey_stage: 'late' }),
    }, 'P105.AL5 — the segments each context qualifies for, derived from the ten conditions (src/data/insights.json)').toEqual({
      tabby: ['early_journey_cold_start', 'high_intent_tabby_browser', 'luxe_affinity'],
      brooklynAbandoner: ['brooklyn_browser', 'cart_abandoner', 'late_journey_ready_to_buy', 'mid_journey_considering'],
      giftingLoyal: ['high_aov_gifter', 'lapsed_reengagement', 'luxe_affinity', 'vip_loyalist'],
      unknownOnly: [],
      missedByOne: ['brooklyn_browser'],
    });
  }, 120_000);

  it('host (worker): LOCK — kit 02\'s kind list stays true (docs/kit/02-api-reference.md §4): the audiences member is not a /content/{kind}; GET /content/audiences is refused 404 in the kit\'s words', async () => {
    const w = await world('session');
    expect((await publishThrough(w, authored(LUXE, 'kit_luxe'))).status, 'PRECONDITION: an audience is published').toBe(200);
    const read = await operator(w, 'GET', `/content/audiences?scope=${TENANT}`);
    expect([read.status, read.body.error], 'P105.AL5 — kit 02: "Any other kind is refused 404"').toEqual([404, 'kind must be catalog, slots, learn, priors, vocabulary, import-sources or layouts']);
  }, 60_000);

  // R-P687 (5), R-P692 (S53/SPEC-BRIEF-P105-addendum.md): the render offer is minted and checked
  // against the publication's identity over every member but the audiences (publication.ts
  // renderIdentity on rem/p105-build 4c766850; renderOffer.ts redeemRenderOffer). Before P105 an
  // audience write touched no offer; a change to any other member refused it, which for the
  // content member realtime.sdkContract.test.ts pins ("W15 rejects … changed publication before
  // capture", :390 at 4c766850) with SessionAccessError's 401 (src/identity/sessionCapability.ts
  // SessionAccessError). This leg pins the audience write's acceptance and the slots, learn and
  // reflex members' refusals, every write through the operator's own doors, each member
  // republished as in force (a new revision of the same value) so only the binding can refuse.
  for (const host of HOSTS) {
    it(`host (${host}): R-P687 — the render offer is bound to every publication member but the audiences: audience writes between a render and its acknowledgement (an operator publish, which moves the tenant, and a rename) leave the acknowledgement accepted; a republish of the slots, the learn or the reflex document between a fresh render and its acknowledgement refuses it 401, as the content member's change does; a render after them all is acknowledged`, async () => {
      const w = await world(host);
      const s = await shopperOn(w.m);
      expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, `PRECONDITION (${host}): her view is accepted`).toBe(200);
      await settle(w.m, w.app);
      /** A product-page render that offers a decision; its acknowledgement, sent later, answers its status and its render receipt's status. */
      const render = async (label: string) => {
        const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(`p105-binding-${label}`) });
        const offered = page.decisions.find(d => d.renderOffer);
        expect(offered ? page.status : `no offered decision (${page.status})`, `PRECONDITION (${host}): the product page offers a decision to acknowledge (${label})`).toBe(200);
        return async () => {
          const wire = await ackWire(w.app, s, page, offered!);
          await settle(w.m, w.app);
          return { status: wire.status, render: (wire.body.render as { status?: unknown } | undefined)?.status ?? null };
        };
      };

      const audienceAck = await render('audiences'), before = setRevision(w.m);
      expect((await publishThrough(w, authored(LUXE, 'binding_luxe'))).status, `PRECONDITION (${host}): the operator publishes an audience`).toBe(200);
      expect((await verb(w, 'binding_luxe', 'rename', { name: 'Luxe browsers (binding)' })).status, `PRECONDITION (${host}): and renames it`).toBe(200);
      expect({ moved: setRevision(w.m) > before, member: keysOf(audiencesMember(w.m)?.audiences) },
        `PRECONDITION (${host}): the audience writes are set publications of the audiences member (set ${before} → ${setRevision(w.m)})`).toEqual({ moved: true, member: ['binding_luxe'] });
      const afterAudiences = await audienceAck();

      const refused = {} as Record<Republished, { status: number; render: unknown }>;
      for (const member of REPUBLISHED) {
        const ack = await render(member), at = setRevision(w.m);
        expect(await republish(w, member), `PRECONDITION (${host}): the operator republishes the ${member} document`).toBe(200);
        expect(setRevision(w.m) > at, `PRECONDITION (${host}): the ${member} republish is a set publication (set ${at} → ${setRevision(w.m)})`).toBe(true);
        refused[member] = await ack();
      }
      const fresh = await (await render('fresh'))();

      expect.soft(afterAudiences, `${host}: P105.AL5 (R-P687) — the audience writes leave the render offer good: its acknowledgement is accepted and durable`).toEqual({ status: 200, render: 'durable' });
      for (const member of REPUBLISHED) {
        expect.soft(refused[member].status, `${host}: P105.AL5 (R-P687) — the ${member} member republished between the render and its acknowledgement refuses the acknowledgement 401, as the content member's change does`).toBe(401);
      }
      expect.soft(fresh, `${host}: P105.AL5 (R-P687) — a render after every republish is acknowledged, accepted and durable`).toEqual({ status: 200, render: 'durable' });
    }, 120_000);
  }

  // R-P713 (B1; work order 671b0948, AL5's last sentence; the reviewer's probe S1, S53/reviewer-p105-r3/tools/probe-s1.ts.txt):
  // the synthetic monitor's run scope binds the identity over every member but audiences, so an audience write
  // committed while runSynthetic runs leaves the run as base leaves it. The base answer is the same run with no write
  // (measured at 157c07ea on both hosts with the write too: 'pending', its decision made). The write fires right after
  // the run's control object is put in its preparing phase, on the lift world (the demo's own audiences already in the
  // member, so the tenant is moved): (publish) a store's publish, the operator route's own store; (reconciliation)
  // moveAudiences, the function the five-minute run calls (src/index.ts), adopting an earlier release's KV-only publish
  // into the member (R-P717 (2): the whole run's folds disturb the synthetic run's observation at base too).
  for (const host of HOSTS) {
    it(`host (${host}): R-P713 (B1) — an audience write committed while the synthetic monitor runs (a store's publish, and the five-minute run's reconciliation adopting an earlier release's KV-only publish) leaves the synthetic run as base leaves it: its decision and its event made, never failed at consent`, async () => {
      const outcomes: Record<string, unknown> = {};
      for (const write of ['none', 'publish', 'reconciliation'] as const) {
        const { m } = await liftWorld(host);
        const key = write === 'publish' ? 'b1_published' : 'b1_earlier_release_publish';
        expect(audiencesMember(m)?.audiences.some(a => a.key === key) ?? false, `PRECONDITION (${host}, ${write}): the member does not hold ${key} before the synthetic run`).toBe(false);
        if (write === 'reconciliation') legacyRecord(m, TENANT, authored(LUXE, key));
        const settleSynthetic = await armSyntheticMonitor(m);
        const target = m.env.STORAGE as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>, put = target.put!;
        let fired = false, committedDuringRun = false;
        Object.defineProperty(target, 'put', { configurable: true, writable: true, value: async (...args: unknown[]) => {
          const out = await put.apply(target, args);
          if (write !== 'none' && !fired && typeof args[0] === 'string' && args[0].endsWith('/control.json') && String(args[1]).includes('"phase":"preparing"')) {
            fired = true;
            if (write === 'publish') await new KvAudienceStore(m.env, TENANT as TenantId).publish(authored(LUXE, key));
            else await moveAudiences(m.env, TENANT as TenantId);
            committedDuringRun = audiencesMember(m)?.audiences.some(a => a.key === key) ?? false;
          }
          return out;
        } });
        const { runSynthetic } = await import('@/ops/synthetic');
        const result = await runSynthetic(m.env, TENANT, host);
        await settleSynthetic();
        // R-P717 (3), under R-P695 (4): counted, never timed. The stages before observation are asserted; the run's later
        // state (the observation window's outcome under the harness's latency limits) is evidence only.
        console.log(`P105.AL5 B1 evidence (${host}, ${write}): ${JSON.stringify({ state: result.state, failedStage: result.failedStage ?? null })}`);
        outcomes[write] = { fired, committedDuringRun, decision: result.decision, event: result.event, failedAtConsent: result.failedStage === 'consent' };
      }
      const asBase = { decision: true, event: true, failedAtConsent: false };
      expect(outcomes, `${host}: P105.AL5 (R-P713, B1) — an audience write, the store's publish or the five-minute run's reconciliation, committed during the synthetic run leaves it as the run with no write: its decision and its event made, never failed at consent`)
        .toEqual({ none: { fired: false, committedDuringRun: false, ...asBase }, publish: { fired: true, committedDuringRun: true, ...asBase }, reconciliation: { fired: true, committedDuringRun: true, ...asBase } });
    }, 300_000);
  }
});

/**
 * The tenant's internal synthetic monitor armed over this harness, as src/units/P61/LEDGER.unit.test.ts
 * `armSyntheticMonitor` arms it (copied: a test file exports nothing): its telemetry descriptor with the isolated
 * destinations, their retention, the recovery queues, a region-trend binding, and the source queue delivering each
 * synthetic envelope to the worker's own synthetic consumer in its own invocation. Returns the settle.
 */
async function armSyntheticMonitor(m: Mounted): Promise<() => Promise<void>> {
  const [{ configuredOperationalDestinations, SYNTHETIC_BINDINGS }, { consumeSynthetic, SYNTHETIC_KIND }, { AsyncResource }] =
    await Promise.all([import('@/connectors/config'), import('@/ops/synthetic'), import('node:async_hooks')]);
  const env = m.env as unknown as Record<string, unknown>;
  const destinations = SYNTHETIC_BINDINGS.map(binding => ({ binding, purpose: 'isolated-synthetic-monitor', namespace: 'ops-synthetic-v1', accessPolicy: 'p61-local-only' }));
  env.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: { [TENANT]: { telemetry: { environment: 'test', schema: 'ops-v1', synthetic: {
    version: 1, enabled: true, lifetimeMs: 120_000, stageMs: 10_000, decisionMs: 200, eventMs: 300, thresholdSource: 'document-32-server-diagnostics', destinations } } } } });
  const retention = JSON.parse(m.env.RETENTION as string) as { tenants: Record<string, Record<string, unknown>> };
  for (const destination of await configuredOperationalDestinations(m.env, TENANT)) retention.tenants[TENANT]![destination.category] =
    { id: 'p61-synthetic', revision: 1, durationMs: 120_000, basis: 'occurred', renewal: 'new-record-only' };
  env.RETENTION = JSON.stringify(retention);
  env.LEDGER_RECOVERY_CONFIG = JSON.stringify({ version: 1, sourceQueue: 'p61-source', deadLetterQueue: 'p61-dlq' });
  env.REGION_TREND = { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ ok: true }) }) };
  const deliver = AsyncResource.bind((body: unknown) => consumeSynthetic(m.env, 'p61-source', body));
  const deliveries: Promise<unknown>[] = [], queue = m.env.EVENT_QUEUE!;
  const send = async (body: unknown) => {
    await queue.send(body);
    if ((body as { kind?: unknown } | null)?.kind === SYNTHETIC_KIND) deliveries.push(new Promise(resolve => setTimeout(resolve, 0)).then(() => deliver(body)).catch(() => undefined));
  };
  env.EVENT_QUEUE = { send, sendBatch: async (messages: Array<{ body: unknown }>) => { for (const message of messages) await send(message.body); } };
  return async () => { while (deliveries.length) await Promise.all(deliveries.splice(0)); await m.drain(); };
}

// ===========================================================================
// unit:P105.AL6 — P61.LO3's R-P115 leg with the old ten-second line crossed between its rounds.
// ===========================================================================

/** The delivery reviewer's deciding control (S41/reviewer-p97/REPORT-p61-lo3.md; DESIGN.md §6): 10.5 s of real time. */
const CROSSING_MS = 10_500;

/**
 * P61.LO3's R-P115 leg (src/units/P61/LEDGER.unit.test.ts, `countLatency` and its leg at
 * :454-464), copied as the control copied it (S52 scratch/tools/p61ctl.cjs): the
 * customer profile, every remote call 500 ms late, the count's own store calls
 * (`learningReadsKey(tenant)`) optionally free; each round a new shopper's Tabby view,
 * the lift cache dropped, the product-page snapshot and the pooled module's render
 * acknowledgement right after its answer. The one change: `crossingMs` of real time
 * between the counted round's view and its snapshot.
 */
async function countLatency(m: Mounted, crossingMs: number) {
  const { SHOPPER_HEADER: header } = await import('@/identity/sessionCapability');
  const keyOf = (await fanExports()).learningReadsKey as ((tenant: string) => string) | undefined;
  const countKey = typeof keyOf === 'function' ? keyOf(TENANT) : null;
  (m.env as unknown as Record<string, unknown>).DEPLOYMENT_PROFILE = 'customer';
  const latency = remoteLatency(m), app = appOf(m.env), counted = new Set<number>();
  let free = false, countCallsMade = 0;
  for (const method of ['get', 'put'] as const) {
    const store = m.cache as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const levered = store[method]!, unlevered = Object.getPrototypeOf(m.cache)[method] as (...args: unknown[]) => Promise<unknown>;
    Object.defineProperty(m.cache, method, { configurable: true, writable: true, value: (...args: unknown[]) => {
      if (countKey === null || args[0] !== countKey) return levered.apply(m.cache, args);
      countCallsMade++;
      if (free) return unlevered.apply(m.cache, args);
      counted.add(latency.calls.length);
      return levered.apply(m.cache, args);
    } });
  }
  const own = (from: number, until: number) => latency.calls.filter((call, index) => index >= from && call.at <= until && !counted.has(index)).length;
  return async (countFree: boolean) => {
    free = countFree;
    const callsBefore = countCallsMade;
    const shopper = await shopperOn(m);
    expect((await shopper.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
    if (!countFree) await new Promise(resolve => setTimeout(resolve, crossingMs));
    invalidateLiftCache();
    const pageInstance = pageInstanceOf('p105-al6-latency'), first = latency.calls.length;
    latency.set(PER_CALL_MS);
    const sentAt = performance.now();
    const response = await app.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
      headers: { 'X-Tenant': TENANT, [header]: shopper.grant.capability, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance }) }));
    const answeredAt = performance.now();
    const body = await response.json() as Record<string, unknown>;
    const page: Snapshot = { status: response.status, body, page: 'pdp', pageInstance, decisions: (body.decisions ?? []) as Decision[] };
    const pooled = page.decisions.find(d => d.contentId === POOLED && d.renderOffer);
    const ackFirst = latency.calls.length;
    const ack = pooled ? await ackWire(app, shopper, page, pooled) : null;
    latency.set(0);
    await settle(m, app);
    expect([response.status, ack?.status], `${m.host}: PRECONDITION — the snapshot and the pooled module's acknowledgement answer 200`).toEqual([200, 200]);
    return { snapshot: { ms: Math.round(answeredAt - sentAt), own: own(first, answeredAt) },
      ack: { ms: Math.round(ack!.answeredAt - ack!.sentAt), own: own(ackFirst, ack!.answeredAt) }, countCalls: countCallsMade - callsBefore };
  };
}

describe('unit:P105.AL6', () => {
  for (const host of HOSTS) {
    it(`host (${host}): P61.LO3's R-P115 leg passes with ${CROSSING_MS / 1000} s of real time between the counted round's view and its snapshot (the old ten-second line crossed): the counted snapshot and the render acknowledgement right after it make the same own remote calls as the free round's, each within ${MARGIN_MS} ms of its time`, async () => {
      const { m } = await liftWorld(host);
      const run = await countLatency(m, CROSSING_MS);
      const free = await run(true), counted = await run(false);
      expect({ free: free.countCalls > 0, counted: counted.countCalls > 0 }, `${host}: PRECONDITION — the count ran after both snapshots (its store calls: ${free.countCalls} free, ${counted.countCalls} at ${PER_CALL_MS} ms)`).toEqual({ free: true, counted: true });
      expect({ snapshot: counted.snapshot.own, ack: counted.ack.own }, `${host}: P105.AL6 — with the old ten-second line crossed, each answer makes the same own remote calls as the free round's (P61.LO3, R-P115)`)
        .toEqual({ snapshot: free.snapshot.own, ack: free.ack.own });
      expect({ snapshot: counted.snapshot.ms <= free.snapshot.ms + MARGIN_MS, ack: counted.ack.ms <= free.ack.ms + MARGIN_MS },
        `${host}: P105.AL6 — the snapshot answers in ${counted.snapshot.ms} ms (${free.snapshot.ms} ms free) and the acknowledgement right after it in ${counted.ack.ms} ms (${free.ack.ms} ms), each within ${MARGIN_MS} ms`)
        .toEqual({ snapshot: true, ack: true });
    }, 240_000);
  }
});

// ===========================================================================
// unit:P105.AL7 — the shopper override read removed from the visitor's path (R-P652).
// ===========================================================================

/** The five feature keys the engine reads variables for (FeatureVariableManager getDefaultFeatureKeys). */
const FEATURES = ['hero_module', 'plp_sort', 'complete_the_look', 'promo_banner', 'journey_message'];
/** Her override records, written through the store's own write (FeatureVariableManager.setUserOverride; no route writes one). */
async function overridesFor(w: World, s: Shopper, n: number): Promise<string[]> {
  const overrides = new FeatureVariableManager(w.m.env, TENANT as TenantId);
  for (let i = 0; i < n; i++) await overrides.setUserOverride({ userId: s.subject, featureKey: FEATURES[i % FEATURES.length]!, variableKey: `p105_var_${i}`, value: `v${i}` } as Parameters<FeatureVariableManager['setUserOverride']>[0]);
  return [...w.m.cache.data.keys()].filter(key => key.startsWith(`override:${s.subject}:`)).sort();
}
/** What one request caused, everything it set off settled: its status and body, her override reads (a KV read of `override:<her id>:`) and every KV list. */
interface OverrideTraffic { status: number; body: Record<string, unknown>; overrideReads: string[]; kvLists: string[] }
async function overrideTraffic(w: World, s: Shopper, request: () => Promise<{ status: number; body: Record<string, unknown> }>): Promise<OverrideTraffic> {
  const from = w.trace.length;
  const { status, body } = await request();
  await settle(w.m, w.app);
  const caused = w.trace.slice(from);
  return { status, body, overrideReads: caused.filter(c => c.binding === 'CACHE' && READS.has(c.method) && c.key.includes(`override:${s.subject}:`)).map(named),
    kvLists: caused.filter(c => c.binding === 'CACHE' && c.method === 'list').map(named) };
}
/** Her Tabby view (POST /realtime/action): an action that changes her segments builds her personalization (RealtimeSegmentEngine processEvent, step 6). */
const viewTraffic = (w: World, s: Shopper) => overrideTraffic(w, s, async () => { const wire = await actionWire(w.app, s, VIEW_TABBY_26); return { status: wire.status, body: wire.body }; });
/** `GET /realtime/personalization/:userId` (src/routes/realtime.ts:575). */
const personalizationRead = (w: World, s: Shopper) => overrideTraffic(w, s, async () => {
  const response = await w.app.fetch(new Request(`https://shop.invalid/realtime/personalization/${s.subject}`, { headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability } }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
});
/** An audience she meets from her first Tabby view (Coach's luxe_affinity, her elevated price band), so that view changes her segments. */
const AL7_AUDIENCE = 'p105_al7_luxe';

describe('unit:P105.AL7', () => {
  for (const host of HOSTS) for (const n of [0, 10, 100, 1000]) {
    it(`host (${host}): with ${n} override records for the shopper (written through FeatureVariableManager.setUserOverride, the store's own write; no route writes one), neither her view that changes her segments (POST /realtime/action, the action that builds her personalization) nor her personalization read (GET /realtime/personalization/:userId), at once and ${STEP_MS / 1000} s on (lane E4's ten-second copy crossed), makes an override read or lists KV`, async () => {
      const w = await world(host);
      expect((await publishThrough(w, authored(LUXE, AL7_AUDIENCE))).status, `PRECONDITION (${host}): the operator publishes an audience she meets on her first view`).toBe(200);
      const s = await shopperOn(w.m);
      expect((await overridesFor(w, s, n)).length, `PRECONDITION (${host}): her ${n} override records are stored`).toBe(n);
      const view = await viewTraffic(w, s);
      expect({ status: view.status, segments: segmentsOf(view.body) ?? [] }, `PRECONDITION (${host}): her view is accepted and changes her segments (${AL7_AUDIENCE}), so it builds her personalization`)
        .toMatchObject({ status: 200, segments: expect.arrayContaining([AL7_AUDIENCE]) });
      const first = await personalizationRead(w, s);
      advanceClock(STEP_MS);
      const later = await personalizationRead(w, s);
      const reads = { view: view.overrideReads, personalization: [...first.overrideReads, ...later.overrideReads] };
      const count = reads.view.length + reads.personalization.length, sample = [...reads.view, ...reads.personalization].slice(0, 3).join(', ');
      expect({ status: [first.status, later.status], overrideReads: reads, kvLists: { view: view.kvLists, personalization: [...first.kvLists, ...later.kvLists] } },
        `${host}: P105.AL7 — at ${n} overrides neither her view nor her personalization read makes an override read or a KV list (${count} override reads${count ? `: ${sample}${count > 3 ? ', …' : ''}` : ''})`)
        .toEqual({ status: [200, 200], overrideReads: { view: [], personalization: [] }, kvLists: { view: [], personalization: [] } });
    }, 300_000);
  }

  for (const host of HOSTS) {
    it(`host (${host}): LOCK — her override records that exist are still exported and erased with her other records, as today (POST /v1/:tenant/identity/export and /identity/erase; src/routes/identity.ts, src/identity/erase.ts)`, async () => {
      const w = await world(host);
      const s = await shopperOn(w.m);
      expect((await actionWire(w.app, s, VIEW_TABBY_26)).status, `PRECONDITION (${host}): her view is accepted`).toBe(200);
      await settle(w.m, w.app);
      const keys = await overridesFor(w, s, 3);
      expect(keys.length, `PRECONDITION (${host}): her three override records are stored`).toBe(3);
      const exported = await operator(w, 'POST', `/v1/${TENANT}/identity/export`, { visitorId: s.subject }), text = JSON.stringify(exported.body);
      expect({ status: exported.status, exported: keys.filter(key => text.includes(key)) }, `${host}: P105.AL7 — LOCK: the identity export answers each of her override records`).toEqual({ status: 200, exported: keys });
      const erased = await operator(w, 'POST', `/v1/${TENANT}/identity/erase`, { visitorId: s.subject });
      expect({ status: erased.status, left: keys.filter(key => w.m.cache.data.has(key)) }, `${host}: P105.AL7 — LOCK: her erasure removes each of her override records`).toEqual({ status: 200, left: [] });
    }, 120_000);
  }
});
