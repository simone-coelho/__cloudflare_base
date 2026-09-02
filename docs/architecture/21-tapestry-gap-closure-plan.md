# 21 · Closing the Tapestry gaps — how we organize from here

**INTERNAL.** Supersedes nothing; it is the operating layer over `19-tapestry-delivery-ledger.md` (the CW
work items), `20-scope-truth-ledger.md` (the clauses), and `docs/handover/03-tapestry-pending.md` (the
promise-versus-code audit). Those three stay as evidence. This is how we work them.

Opened 2026-09-01, the day after Scope of Services v8 went to the account team.

---

## What changed, and why the old list no longer works

Until v8, the gaps were a list. They are now a **schedule**, because v8 attaches dates to them and two of
those dates are labelled *Contractual milestone*. The organizing problem is no longer knowing what is
missing. We know precisely, with file and line numbers. The problem is that the same truth is spread
across three documents using three numbering schemes (CW0–CW18, T1–T7 / C1–C6 / M1–M7 / L1–L4, and A1–A12),
none of which is keyed to the thing a customer can hold us to: **the clause number in the appendix.**

So the first act is not writing code. It is re-keying the work to the contract.

### The three deadlines, in the order they actually bite

| Deadline | What it covers | Why it is the hardest one |
|---|---|---|
| **Signature** | All twelve §1 capabilities. The section header reads *"Built, tested, and active on signature. This is what the platform does today."* | It has no project plan because it was never treated as a date. It could be days away, and it is the only deadline where the claim is present tense |
| **Kickoff + 45** (~22 Oct) | Integration kit: SDK, integration guide, API reference, staging origins connected and verified | Risk 9 in ledger 19: their November code freeze. This, not acceptance, is the real external hard line |
| **Kickoff + 60** (~6 Nov) | Acceptance in their lower environment, scripted and repeatable | The first time an outsider runs our software against their expectations |
| **Kickoff + 130** (~15 Jan 2027) | Content Personalization live in production | Contractual |
| **Kickoff + 265** (~30 May 2027) | Experience Personalization live in production | Contractual |

Dates assume the document's own reference Kickoff of 7 September 2026 and move with it.

**The uncomfortable arithmetic.** Ledger 19 sizes the scoped work at roughly 37 agent-days with a critical
path near 20.5; the stage-two design adds about 13.5 across CW19 to CW23, of which only Phase 0 (2.5)
is on the pre-launch critical path. From today to the integration kit is about seven weeks. That is achievable, but only if the
lanes below genuinely run in parallel, and only if we start. Everything in the CW queue except the Meridian
content prototype is unchanged since the 2026-07-24 audit.

---

## One board, keyed to the clause

Every open item gets re-entered once, against the appendix clause it makes true, with its CW number kept as
a cross-reference. Not a new document: `20-scope-truth-ledger.md` becomes that board, extended with a
**Deadline** column carrying one of the five values above.

The rule that makes it work is already written in ledger 20 and is not negotiable:

> A row closes when there is **code, a passing test, and a named place the customer could see it work.**
> Not when it is written, not when it is designed.

And its converse, which v8 just made urgent: **no new customer-facing clause is written that is not first a
row.** v8 itself created new rows. They are listed at the end of this document.

---

## Four lanes, run in parallel

The work splits cleanly by dependency and by who can do it without waiting. Each lane has one owner and
runs independently of the other three after the first item.

### Lane A — Truth at signature
*Closes: §1.4, §1.6, §1.5's multipliers, §1.2's human verbs, and the word "tested" in the §1 header.*

| Item | CW | Days | Note |
|---|---|---|---|
| ✅ Get the test suite executing | — | 0.1 | **Done 2026-09-02.** 24 files, 477 cases, ~9s. Not a missing dependency: the declared package is Miniflare v2 tooling that never installed against wrangler 4, and vitest was also collecting `.claude/worktrees/` |
| ✅ KV-versioned config store + read/write API | CW0 | 1.5 | **Done 2026-09-02.** Store, validation, versioning, audit, rollback, `/config` API, wired into every decision path via `registry.resolveReflexConfig`. Unblocked: CW5, CW9, CW11, T2, T7, M5, M6 |
| ✅ Tuning surface a business user can operate | CW9 | 2 | **Done 2026-09-02.** `/tuning.html`, linked from the operator console. Every symbol named in plain words, every number shown as its consequence, actions grouped by behaviour rather than event name, validation delegated to the same validator the write path runs. Row 1 closes |
| Decision + explain persistence at every grain | → CW19 | — | The dropped-`sections` defect is fixed, so product, content and section receipts all persist. The customer-grain authenticated surface is **not a separate item any more**: Phase 0 in Lane D owns it, because the ledgers it writes are the same ledgers stage two learns from |
| ◐ Season / promotion / margin as real weighted terms | — | 0.5 | **Built and tested 2026-09-02**, `src/reflex/merchandising.ts`. NOT wired: the scoring path is the parallel session's active CW4 file. One-line integration outstanding, then ledger row 6 closes |
| ✅ Rename / pin / prune endpoints | — | 0.5 | **Done 2026-09-02.** Three authenticated operator routes; ledger row 7 closed |

**Lane A is three items down as of 2026-09-02** (harness, CW0, CW9), plus the live defect under row 5.
The harness gated the evidentiary standard for everything else, and CW0 was the single highest-leverage
item in the programme. Lane A is now complete except for one line: the merchandising multipliers are built and tested but not yet
called from the content ranker, because that file is the other session's live CW4 work.

**The next thing to build is not in this lane.** See the sequencing note below.

### Lane B — The delivery surface
*Closes: §2.3 API-first delivery, and the Kickoff + 45 integration kit.*

| Item | CW | Days | Note |
|---|---|---|---|
| Multi-tenancy across KV / D1 / DO / queues / R2 | CW1 | 5 | §1.7 claims hard data isolation on signature. Nine `tenant` hits in the repo are all comments |
| Content catalog store + import adapter | CW2 | 2.5 | §1.3's ingest endpoint; the catalog is a bundled file today |
| Server-side content ranker + page assembler | CW4 | ✅ 2026-09-02 | `src/content/` decides at the edge and returns the §7 contract plus §3.1 records. The composer moved into the engine (`src/reflex/contentCompose.ts`); Meridian re-exports it. 23 tests. Live at `GET /v1/:tenant/decisions/snapshot` on the dev server, serving compiled defaults until a catalog document is stored for the scope (CW2) |
| Snapshot endpoint for first paint | CW4 | ✅ | The route above; `Cache-Control: no-store`, reads only, 400 on a bad tenant or missing visitor |
| SDK extraction, one package two modules | CW8 | ✅ 2026-09-02 | `src/sdk/`: shared core (identity, entry signals, socket, fetch, beacon), emit (explicit API, declarative `data-op-*`, dataLayer adapter with GA4 defaults, automatic impressions and dwell), listen (snapshot hydration with a graceful-absence deadline, per-slot subscriptions, `content_decisions` frames). Built to `public/sdk/` as script and module. 22 tests plus a contract test that parses every SDK envelope through the server's own action schema. Ran end to end in Node against the dev server. **Open by decision:** the demo storefront still carries its own copy of this transport; cutting it over is a rehearsal-gated change |
| Staging envs, SDK-key auth, operator auth, CORS allowlist | CW10 | ✅ 2026-09-02 (code) | `[env.staging]` declared in full with its own resources; `src/middleware/edgeAccess.ts` gates the SDK surface by key, operator writes by JWT, and CORS by allow-list, all behind `AUTH_MODE`, which stays `open` on the demo worker and is `enforced` in staging. 8 tests; verified live on a local staging instance. **Human step remaining:** `scripts/provision-staging.sh` creates the account resources, sets the secrets and seeds the operator login; `CORS_ORIGINS` takes the customer's lower-environment origins when they are known |

CW1 is the long pole and it is blocked on one answer: **which brand is the first tenant.** Scoping it wrong
is exactly the rework the risk register warns about.

### Lane C — Registry completeness
*Closes: §1.1's dimension list and the acceptance bar's "chosen by the agreed dimension registry."*

| Item | CW | Days | Note |
|---|---|---|---|
| Regional trending: `RegionTrend` DO, KV publish, λ-blend | CW6 | 3 | Mandeep's stated non-negotiable for v1, and the single dimension with the least code against the highest priority. Zero lines exist. The geo-cohort module is a reusable ingredient, **not** a substitute |
| ✅ Visit boundaries + entry channel | CW7a | 1 | **Done 2026-09-02.** `src/services/visit.ts` (pure), wired through SessionManager, published as `visit_number`, `visit_bucket`, `entry_channel`, and captured by the client. Levels 1 and 2 of doc 22's pooling ladder are now real. 34 tests |
| ✅ vuid cutover | CW7b | 0.5 | **Done 2026-09-02.** The ODP vuid derives from the stable `opt_visitor_id` the client already persisted, not from the session. `OdpIdentity` replaced the bare `sessionId` parameter on four functions, which is how the compiler found all seven call sites. ⚠️ This orphans existing session-derived ODP profiles: the right trade before launch, the wrong one after |
| Content telemetry, exposure-normalised | CW3 | 1.5 | Impression, click, dwell, video completion. Zero hits in the repo. Content-type affinity cannot be a learned dimension without it |
| Purchase forwarding to ODP | — | 0.2 | The highest-weighted action in the engine falls through a `default: return null` |

### Lane D — Governance and measurement
*Closes: §1.8, §2.4's roadmap, and the obligations we accepted in the customer document.*

| Item | CW | Days | Note |
|---|---|---|---|
| ~~Holdout mechanism~~ | → CW19 | — | Folded into Phase 0, where it belongs: assignment has to exist before the first decision is recorded, not after |
| ~~Priors import~~ | → CW23 | — | Folded into Phase 3 |
| ~~Authenticated export at customer grain~~ | → CW19 | — | Folded into Phase 0. The R2 partitions are the export |
| Per-slot autonomous weight mixing | CW5 | 1.5 | §1.4's autonomy note in v8 now states this in writing. Slot strategies are hardcoded constants with no `mode` switch |
| Stage-two design document | CW13 | ✅ | Written 2026-09-01 as `22-outcome-learning-design.md`. The build items below come from it |
| **Phase 0 · Record**: decision + outcome ledgers (queues, R2 partitions, D1 recent index), holdout assignment | CW19 | 2.5 | The only phase whose delay costs data that cannot be recovered. Also closes ledger 20 row 5 (persistence at every grain) and the Snowflake outbound share, since the R2 partitions *are* the share |
| **Phase 1 · Shadow**: online attribution in the shopper DO, LearnStats DO with decayed counts, versioned lift snapshots to KV, γ = 0 | CW20 | 3.5 | Learning runs and shows in every explain record; nothing on the site changes until a person raises γ |
| **Phase 2 · Apply**: γ per slot, exploration policies, assisted autonomy job with bounds | CW21 | 2 | Defines T7 precisely: proposals with evidence, then autonomous within bounds |
| Learning console: lift grid, policy comparison, version history, freeze / reset / reject, the dials | CW22 | 3 | The surface the data scientists and marketers will judge us on. Rides the tuning surface (CW9) |
| **Phase 3 · Extend**: imported priors, external model hook (service / table / Workers AI), replay endpoint | CW23 | 2.5 | Priors import closes ledger 20 row 4; the hook is the "bring your own model" answer to Nitin |

---

## Compatibility with the outcome-learning design, settled 2026-09-02

Doc 22 was written in parallel with CW0 and CW9 landing, so it specified versioned configuration four
times without naming a mechanism. Reconciled rather than left to collide, and recorded as **§18 of doc 22**:

- The config store is now **generic** (`src/config/versionedStore.ts`). A `DocumentKind` inherits
  versioning, attribution, audit, rollback, caching and failure-safety, so the §13 catalog adds kinds
  instead of a second store. Proven with a second kind that shares nothing with `ReflexConfig`.
- `resolveReflexConfigRevision` exposes the **revision integer** doc 22 records as `versions.config`, so the
  ledger writer never parses it back out of the display string.
- Flagged for Phase 0: the receipt schema carries one `config_version` and needs the four-version tuple,
  because once lift moves a score, config alone no longer identifies a decision.
- Flagged for Phase 2: rollback rolls **forward**. An autonomy job that rewinds a counter loses the evidence
  a person needs to promote or demote a slot.
- Flagged for Phase 1, and it moves work: §5.4's pooling ladder needs **channel** and **visit bucket**, and
  neither is real. Visit bucket is the dangerous one because it exists and is wrong. CW7 is now a Phase 1
  prerequisite.

---

## The CW4 seam, written before the code (2026-09-02)

CW4 is the server-side content decision service: the thing Section 2.3 of the appendix calls API-first
delivery, and the reason the ledger in doc 22 has something worth recording. It meets Phase 0 at exactly
one object, so that object is specified here first.

- **CW4 emits, CW19 persists.** `src/content/decide.ts` produces one `DecisionRecord` per served slot,
  field for field the §3.1 record in doc 22: ids, page, slot, position, item, the top-N candidates with
  base scores, the context cell, the holdout arm, `explored`, `authority`, the four version integers plus
  the human config label, and the explain. The route returns them beside the §7 delivery contract. Nothing
  in CW4 writes them anywhere; the ledger writer is Phase 0's and consumes this shape unchanged.
- **The composer moves into the engine.** The content ranking arithmetic that Meridian proved becomes
  `src/reflex/contentCompose.ts`, pure and stateless, and Meridian re-exports it. The isolation charter's
  allowlist widens from one pure module to two, by name, not by prefix: `configStore` stays out.
- **Three document kinds, no second store.** `content` (the catalog, the thinnest form of CW2), `slots`
  (per-page slot strategies: take, weights, pin), and `learn`, opened here with the holdout section only
  because assignment has to exist before the first recorded decision. Phase 1 extends `learn` in place
  with γ, exploration and autonomy per slot. Prefixes `content:config:` and `slots:config:` join the
  reserved list; `learn:config:` was already reserved.
- **The holdout arm is assigned at decision time**, deterministically from the visitor id and a per-brand
  salt, so it is sticky by construction and needs no storage. A `default` arm renders every slot's default
  and still emits records, with the arm on them.
- **Honest cells.** Region comes from request geolocation; the affinity cell from the leading interest
  above its entry threshold; channel and visit bucket are `unknown` until CW7 lands, and are recorded as
  such rather than guessed.
- **Two follow-ups this seam names rather than absorbs.** Meridian's `prefer` rule (a guide that completes
  the item in the bag) is a function today and needs a data form before it can live in the `slots`
  document. SDK-key authentication on the route is CW10.

Route: `GET /v1/:tenant/decisions/snapshot?page=home&visitorId=…`, mounted at the single seam in
`src/index.ts`.

---

## The CW8 seam (2026-09-02)

- **Identity is shared with the demo by default.** The SDK reads and writes the same `opt_visitor_id`
  in localStorage and cookie, in the same format, so a visitor the storefront knows is the same visitor
  to the SDK and to the shopper's own object.
- **The wire is the server's, not the SDK's.** `src/sdk/wire.ts` is one table from SDK event to the type
  `POST /realtime/action` accepts today. Content interactions and the conversion event travel as `custom`
  with the real event named in the payload until CW3 makes them first-class; the contract test in
  `src/routes/realtime.sdkContract.test.ts` fails the moment the two disagree.
- **Everything DOM-shaped enters through `Host`.** `browserHost` binds the browser; `memoryHost` runs
  the same code in Node. That is what makes the tests possible without a browser and what makes a native
  client a port of one file.
- **Two follow-ups this seam names.** The storefront cutover (the demo consuming the SDK rather than its
  own transport copy) is the step that makes "one truth" literal and it needs a Coach rehearsal first.
  SDK-key enforcement on the server is CW10; the SDK already sends the key.

---

## The CW10 seam (2026-09-02)

- **One switch, not a fork.** `AUTH_MODE` is read per request. `open` is byte-for-byte today's worker,
  verified live: CORS reflects, operator writes pass, the SDK surfaces answer without a key. `enforced`
  is the staging stamp. The shared demo worker never changes behavior until someone sets the variable.
- **CORS_ORIGINS is the exception to the switch.** Listing origins is itself the decision, so a
  configured allow-list applies in either mode. Same-origin and the local dev server are always allowed.
- **Keys are per tenant.** `SDK_KEYS` is a secret of the form `tenant:key[|key2],…`; a `*` tenant
  accepts the key anywhere. `/v1/:tenant/*` checks the key against the path's tenant; `/realtime/*`,
  which carries no tenant yet, accepts any registered key. CW1 binds tenant to key properly.
- **Operator tokens come from `/auth/login`**, whose users live in KV; the provisioning script seeds
  one. The config routes stay fail-closed regardless of mode, as CW0 built them.
- **Production is still name-only** and `deploy.sh` still refuses it. Declaring it is the same work as
  staging, gated on ledger B5 (production or lower environment).

---

## The one item whose delay cannot be bought back

Everything else on this list can be built late and still be built. **CW19, Phase 0 of the outcome-learning
design, cannot.** It writes the decision and outcome ledgers and assigns the holdout, and traffic that runs
before it exists is traffic whose decisions and outcomes were never recorded. That data cannot be
reconstructed afterwards at any price, which makes it the only genuinely irreversible deadline in the
programme, ahead of tenancy and ahead of the integration kit.

It also pays for three other rows on its own: ledger row 5 (persistence at every grain), row 12 (the
holdout), and §1.12's Snowflake outbound share, since the R2 partitions it writes *are* the share.

At 2.5 days, against a §2.4 roadmap we have now put in front of the customer in writing, it is the next
thing to build.

---

## What Meridian is, now that the demo is the product

Meridian proves the algorithm and it proves it well: two-level scoring, pins at any position, section
ordering, explain records, the decisions band. What it does not prove is any of Lane B. The ranking runs in
the visitor's browser over a catalog we ship to the page.

So Meridian's role from here is **the acceptance rehearsal**, not the deliverable. The Kickoff + 60 bar is a
scripted, repeatable run in their environment; Meridian is that same run against ours. Every capability we
close in Lane A and B should surface in Meridian, because that is the cheapest place to see it work with a
customer watching.

---

## Cadence

- **Weekly**, against the five deadline values, not against agent-day estimates. The question each week is
  "which clause became true," not "how many days did we burn."
- **Before any document goes** to Mandeep, Nitin, procurement or legal, the board is reviewed. This already
  caught v8's new commitments.
- **Nothing closes on assertion.** Code, a passing test, and a place to see it work.
- **The demo and the product share a branch discipline.** Ledger 19 risk 10 warns that demo churn
  destabilises the contract build; consider cutting the productization branch when CW1 starts.

---

## New rows created by v8, not yet in any ledger

Recording these now, because the governance rule says a clause is a row before it is a sentence.

1. **§1.12 third-party attribute files** through the CSV / S3 / REST pipelines, with a stable identifier and
   documented field meanings. The pipelines themselves are also unbuilt (ledger 20 row 2).
2. **§1.4 autonomy note**: per-slot weight mixing that adjusts itself from outcome statistics, *with every
   adjustment logged, reversible, and any weight pinnable*. That is three separate mechanisms, all absent.
3. **§2.4 stage two**, designed during this engagement and shown at M2.
4. **§1.11 present-tense re-ranking** plus the commerce integration pointed at dependency D4.
5. **§3.2 Experience acceptance**, which now requires page-module ordering to be demonstrable in their lower
   environment with live-tunable weights. Section ordering is real in Meridian and is not persisted, not
   tenant-aware, and not served from the edge.

---

## The two decisions that gate the start

Everything above is executable except for two things only Simone can settle.

1. **Which brand is the first tenant.** CW1 is five days and the first place the answer becomes structural.
   Our documents say Kate Spade; the account team's framing says Coach; Nitin writes coach.com.
2. **Approval to start the build.** Ledger 19's standing guardrail says no build phase begins until the
   document set is approved. The document set has now been through v8. That guardrail is currently the only
   thing holding the queue.

Neither blocks Lane A's first two items. The test harness and the config store can start immediately and
should.

*Opened 2026-09-01.*
