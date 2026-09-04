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
| ✅ KV-versioned config store + read/write API | CW0 | 1.5 | **Done 2026-09-02.** Store, validation, versioning, audit, rollback, `/config` API, wired into every decision path via `registry.resolveReflexConfig`. Unblocked: CW5, CW9, CW11, T2, T7, M5, M6. **Inheritance rule, decided and built 2026-09-04 (addendum 7):** a stored document is a snapshot of the defaults on the day it was written, so every scope authored before CW3 scored content at zero. Now **absent means inherit, explicit zero means off**: a weight the document does not mention is filled from the scope's compiled default at read time, for every reader (`readReflexConfigRevision` is the one seam, so the content service's direct read gets it too); the stored document is never rewritten; `inherited` names the filled keys on GET and every write. **Dimensions are never added silently**: a dimension the default has and the document lacks is named in `warnings` by GET, validate and every write, and the tuning page shows it as an amber panel with what to do. The tuning page also gained the four content rows with their own words, and marks an inherited weight as such under its value. Brighthour inherits from its own default. The by-hand coach revision 15 is now the general behaviour; no PUT per scope on staging. 8 tests; verified from a 1440×800 screenshot of a scope written without content weights or the `contentType` dimension |
| ✅ Tuning surface a business user can operate | CW9 | 2 | **Done 2026-09-02.** `/tuning.html`, linked from the operator console. Every symbol named in plain words, every number shown as its consequence, actions grouped by behaviour rather than event name, validation delegated to the same validator the write path runs. Row 1 closes |
| Decision + explain persistence at every grain | → CW19 | — | The dropped-`sections` defect is fixed, so product, content and section receipts all persist. The customer-grain authenticated surface is **not a separate item any more**: Phase 0 in Lane D owns it, because the ledgers it writes are the same ledgers stage two learns from |
| ✅ Season / promotion / margin as real weighted terms | — | 0.5 | **Built 2026-09-02**, `src/reflex/merchandising.ts`; **wired 2026-09-04** into the content decision by the outcome-learning session: weights on the slot strategy, signals on the piece, applied after affinity and their model and before the lift, every term itemised as its delta on the receipt. Ledger row 6 closed |
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
| ✅ Multi-tenancy across KV / D1 / DO / queues / R2 | CW1 | 5 | **Done 2026-09-03.** Foundation, stores, per-shopper objects, socket pushes, request resolution with an allow-list, D1 receipts, and the last raw sites classified and converted. Ledger row 3 closes. What is deliberately global is named in the close-out commit |
| Content catalog store + import adapter | CW2 | ✅ 2026-09-02 | `/content/{catalog,slots,learn}`: reads open, writes JWT, validated, versioned, rolled forward, same store as config. Import adapter takes a JSON or CSV export (replace or merge) and pulls a JSON URL as the CMS/DAM seam. Pieces carry the render URL and the publish/expire window §1.3 names, and the window gates eligibility at decision time. 15 tests. Live: the demo catalog imported through the seam into a scope, and the snapshot returned nine real decisions |
| Server-side content ranker + page assembler | CW4 | ✅ 2026-09-02 | `src/content/` decides at the edge and returns the §7 contract plus §3.1 records. The composer moved into the engine (`src/reflex/contentCompose.ts`); Meridian re-exports it. 23 tests. Live at `GET /v1/:tenant/decisions/snapshot` on the dev server, serving compiled defaults until a catalog document is stored for the scope (CW2) |
| Snapshot endpoint for first paint | CW4 | ✅ | The route above; `Cache-Control: no-store`, reads only, 400 on a bad tenant or missing visitor |
| SDK extraction, one package two modules | CW8 | ✅ 2026-09-02 | `src/sdk/`: shared core (identity, entry signals, socket, fetch, beacon), emit (explicit API, declarative `data-op-*`, dataLayer adapter with GA4 defaults, automatic impressions and dwell), listen (snapshot hydration with a graceful-absence deadline, per-slot subscriptions, `content_decisions` frames). Built to `public/sdk/` as script and module. 22 tests plus a contract test that parses every SDK envelope through the server's own action schema. Ran end to end in Node against the dev server. **Open by decision:** the demo storefront still carries its own copy of this transport; cutting it over is a rehearsal-gated change |
| Staging envs, SDK-key auth, operator auth, CORS allowlist | CW10 | ✅ 2026-09-02 (code) | `[env.staging]` declared in full with its own resources; `src/middleware/edgeAccess.ts` gates the SDK surface by key, operator writes by JWT, and CORS by allow-list, all behind `AUTH_MODE`, which stays `open` on the demo worker and is `enforced` in staging. 8 tests; verified live on a local staging instance. **Human step remaining:** `scripts/provision-staging.sh` creates the account resources, sets the secrets and seeds the operator login; `CORS_ORIGINS` takes the customer's lower-environment origins when they are known |

CW1 is the long pole. It is **not blocked**: the launch brand is Coach, settled by the customer (ledger B3),
and the tenancy foundation is already being built against it on the other track (`src/tenancy/`). Tenancy is
exactly what makes the brand a string; a second brand is the provisioning exercise §1.7 promises.

### Lane C — Registry completeness
*Closes: §1.1's dimension list and the acceptance bar's "chosen by the agreed dimension registry."*

| Item | CW | Days | Note |
|---|---|---|---|
| Regional trending: `RegionTrend` DO, KV publish, λ-blend | CW6 | ✅ 2026-09-02 | Ledger 19's design, built: `RegionTrend` object per tenant and region on the personal vector's decay invariant (24h horizon, 32 values per dimension, ε-prune), fan-in from both scoring hosts off the response path, coalesced publish to KV, region → country → everyone rollup on the hourly cron, and the blend as a prior in the decision service: λ = K/(K + Σ personal), ã = (1−λ)·a + λ·share, itemized as a `regional` driver and on every record. Population aggregates only; no visitor id ever reaches the object. Settings on the `learn` document. 8 new tests. **Proven live:** thirty views from ten strangers published the region's vector, a brand-new visitor in that region was decided at λ = 1 with the Drover piece and the regional driver at the full score, and after three views of her own λ fell to 0.29 |
| ✅ Visit boundaries + entry channel | CW7a | 1 | **Done 2026-09-02.** `src/services/visit.ts` (pure), wired through SessionManager, published as `visit_number`, `visit_bucket`, `entry_channel`, and captured by the client. Levels 1 and 2 of doc 22's pooling ladder are now real. 34 tests |
| ✅ vuid cutover | CW7b | 0.5 | **Done 2026-09-02.** The ODP vuid derives from the stable `opt_visitor_id` the client already persisted, not from the session. `OdpIdentity` replaced the bare `sessionId` parameter on four functions, which is how the compiler found all seven call sites. ⚠️ This orphans existing session-derived ODP profiles: the right trade before launch, the wrong one after |
| ✅ **Identity stitching + historical transactions** (ledger 20 row 2) | CW25 | 2 | **Done 2026-09-04 (server).** `src/identity/` (shopper id, assertion, link table, link, history), `src/reflex/identityMerge.ts` (the merge on the decay invariant and the backdated apply, both proven against `apply()` itself: a merge is exactly effA + effB at every later moment; a batch lands identically in any order), `SessionManager` (forward, absorb, import, the guard that only a browser's own record is ever folded), `ShopperReflex` (export / absorb / import / forward), `src/routes/identity.ts` (link, detach, resolve, visitor, shopper, events). 66 tests. **Proven live, 28 checks:** two devices sign in to one account and the person carries both devices' lines and the Tabby audience neither device had alone; the old visitor id still reads the person; a shopper id is refused a second account; history by account id builds a person before the first visit, the 2024 row is dust, and her first sign-in finds the Brooklyn audience waiting. **The design correction the first draft needed:** on a shared computer the `user:` key of a linked browser points at the PERSON, so the naive relink forwarded person A's session to person B; the guard now lives inside `absorbIntoShopper`, where no call site can skip it. Doc 25 has the rules and the client contract. **Open:** the SDK half (`identify` / `logout`, requested below) |
| ✅ Content telemetry, server half | CW3 | 1.5 | **Done 2026-09-03.** The SDK already emitted the four content events; nothing on the server could hear them, because every action resolver read `data.action`/`data.eventName` and never the SDK's `data.event`, so they (and SDK purchases) resolved to `custom` at weight zero. `actionOf()` reads all three conventions; `contentTouches()` scores content off the event's own attributes through the sanitizer; the default registry gains `contentType` and four weights with **impression at zero**. Proven through the real `apply()`: finishing videos builds video affinity, twelve impressions build nothing. 17 tests. **SDK half 2026-09-03:** the five rows in `src/sdk/wire.ts` flipped to the first-class types, no alias left in any payload, bundle rebuilt, contract test flipped with it. **Live on the session path 2026-09-03:** one finished video puts `contentType: video` on the hero receipt (a 0.5159 at weight 0.35, the hero a film piece); twelve impressions build nothing. **Config finding:** a stored reflex config is served exactly as stored, so a scope authored before CW3 has no `contentType` dimension and no content weights, and every content event weighs zero there; coach was at revision 14 and now carries them at the compiled defaults as revision 15 (resolved 2026-09-04: the resolver now fills unmentioned weights from the default and names missing dimensions; see CW0) |
| ✅ Purchase forwarding to ODP | — | 0.2 | **Done 2026-09-03.** The highest-weighted action fell through `default: return null`. Product-level when a known product is named, order-level otherwise; and via `actionOf()` it now hears the SDK's convention too, which the first cut did not |
| **Event-carried product attributes as touches, registry-bounded** | CW24 | ✅ 2026-09-02 | **Found 2026-09-02 while proving the CW2 chain.** Both reflex hosts derive a shopper's touches only from a product found in our own bundled catalog by id; the DO host drops unknown ids on purpose, which is right for the demos. A customer's site sends product events with the attributes flattened on the event, against *their* catalog, so on the product path those events score zero today, and the PS guide's event schema and the SDK's `productView(id, attrs)` both assume otherwise. Recommendation: score the attributes the event carries when the product is not in a catalog we hold, accepting only registry dimensions (and numeric sources for band dimensions), behind a per-scope setting that stays off for the demo surfaces. Same exposure as a real product view; nothing a shopper could not do by browsing. **Built:** `touchesForEvent` in the engine, both hosts call it, `eventAttributes` on the reflex config (validated, patchable, off by default). Proven live: three views of a product we do not hold moved four dimensions, and the hero decision changed to the Drover piece with its drivers on the receipt |

### Lane D — Governance and measurement
*Closes: §1.8, §2.4's roadmap, and the obligations we accepted in the customer document.*

| Item | CW | Days | Note |
|---|---|---|---|
| ~~Holdout mechanism~~ | → CW19 | — | Folded into Phase 0, where it belongs: assignment has to exist before the first decision is recorded, not after |
| ~~Priors import~~ | → CW23 | — | Folded into Phase 3 |
| ~~Authenticated export at customer grain~~ | → CW19 | — | Folded into Phase 0. The R2 partitions are the export |
| Per-slot autonomous weight mixing | CW5 | 1.5 | §1.4's autonomy note in v8 now states this in writing. Slot strategies are hardcoded constants with no `mode` switch |
| Stage-two design document | CW13 | ✅ | Written 2026-09-01 as `22-outcome-learning-design.md`. The build items below come from it |
| **Phase 0 · Record**: decision + outcome ledgers (queue → consumer → R2 batches named by id range; Analytics Engine points), holdout assignment. **No D1 on the ledger path** (doc 22 §18.10, accepted 2026-09-03). The shopper object's ring and long index move to Phase 1, where attribution needs them | CW19 | ✅ 2026-09-03 (code) | The only phase whose delay costs data that cannot be recovered. Also closes ledger 20 row 5 (persistence at every grain) and the Snowflake outbound share, since the R2 partitions *are* the share |
| **Phase 1 · Shadow**: online attribution in the visitor's ring object, LearnStats object with decayed counts at every pooling level, versioned lift snapshots to KV, γ = 0 | CW20 | ✅ 2026-09-03 (code) | `src/learn/` (policy, statistics, fan-in), `DecisionRing` and `LearnStats` objects, the composer's adjust hook, `lift` and `score_final` on every receipt, the per-slot dials on the `learn` document, `GET /v1/:tenant/lift` and the visitor's recent ring. Learning runs and shows in every explain record; nothing on the site changes until a person raises γ. **Proven live:** two items in one slot, the clicked one at lift 1.139 and the unclicked at 0.857; a warm visitor's receipt carried the full lift block at γ = 0 with her score untouched, and at γ = 1 the same lift moved it from 0.151 to 0.129, base × lift exactly. One design correction the worked example caught: the prior is the slot's rate in the cell, never an item's own coarser estimate, which would count the same events twice |
| **Phase 2 · Apply**: γ per slot, exploration policies, assisted autonomy job with bounds | CW21 | ✅ 2026-09-03 (code) | Exploration in three modes on the decision path, deterministic in its inputs, flagged and explained on the receipt (`src/learn/explore.ts`); reject and freeze per item; the cycle (`src/learn/autonomy.ts`, `cycle.ts`) builds the evidence from the published lift and the catalog's tags, writes a proposal in assisted mode or applies one bounded move in autonomous mode as a new revision of the slots document with the evidence in its note; proposals are their own versioned kind; a person applies or rejects through the route; daily cron and on demand. T7 defined and built |
| Learning console: lift grid, policy comparison, version history, freeze / reset / reject, the dials | CW22 | ✅ 2026-09-04 (code) | `/learning.html` + `learning.js`, one click from the tuning surface and the operator console, same visual system and operator token, a client of the routes and never a second path into KV. The lift grid (in force or any archived version; sort, filter, CSV; every symbol defined in the header), what is exploring (under-floor items, realized share against configured), the policy comparison (`src/learn/report.ts`, `POST /v1/:tenant/learn/report`: one day's R2 partitions, rings rebuilt, every outcome attributed under the learning policy and the reporting overlays, the grid under each side by side, the holdout arms, exploration realized; aggregates only, capped and says so), version history (learn revisions with diff and rollback, archived lift snapshots, prior revisions, proposals with apply/reject), item controls (freeze at current, reject, clear as versioned learn changes; reset discards the item's evidence in the stats object and records a learn revision with the note), and every dial per slot and global, validated by the same validator the write path runs. 4 report tests. Pooling order is not a dial: the ladder is fixed |
| **Holdout measurement** (ledger 20 row 12) | CW26 | 1 | **Proven live 2026-09-04, and three defects found** (`scripts/holdout-proof.mjs`, 10 of 12 checks on a half-and-half holdout with both arms over 60 visitors: every arm appears, assignment is sticky, the default arm decides with no personalization drivers, the day report counts every decision per arm). **What is mine:** `src/measure/holdout.ts`, pure, 18 tests: Wilson interval per arm, Newcombe interval for the difference, the decisions per arm needed to call a difference of the observed size at 80% power, pooling across days, and the sentence a person reads (the module's own output for 51 of 1,240 against 2 of 68: "personalized 4.1% of 1,240 decisions vs default 2.9% of 68: +1.2 points (+40% relative); the interval runs −6.1 points to +3.6 points, so not yet distinguishable from zero; a difference this size needs about 3,890 decisions on each arm to call, and the smaller arm has 68"). Every symbol defined in the file. **The three defects are in the outcome-learning lane and are requested below; the row does not close until the first is fixed** |
| **Phase 3 · Extend**: imported priors, external model hook (service / table / Workers AI), replay endpoint | CW23 | ✅ 2026-09-03 (code) | **Priors** (`src/learn/priors.ts`): a versioned document of pseudo-counts, `PUT /content/priors` as JSON rows or the CSV a warehouse exports; the snapshot builder uses a prior as the shrinkage target and strength for its key, a level with a prior counts toward the evidence threshold, the receipt carries `prior_v` and the prior beside n₀. **Their model** (`src/learn/external.ts`): one contract, three kinds (service binding or URL, KV table, Workers AI), a hard budget in parallel with the lift reads, w_ext per slot on the learn document, the term a named driver on the receipt, `unavailable` with the reason when the budget is missed; a reference implementation of the contract as a route. **Replay** (`src/learn/replay.ts`, `GET /v1/:tenant/replay/:id`): the record now carries the three document revisions and an inputs block, every published snapshot is archived by version, the replay decides again and compares field by field. **Export**: `GET /v1/:tenant/ledger/batches?date=` lists a day's partitions. Closes ledger 20 row 4. 9 tests |

---

## The ledger storage question, closed 2026-09-03

Raised as doc 22 §18.9, superseded by §18.10, answered in §3.3 and §3.4, and accepted by both sessions.
D1 is off the ledger path; the shopper object, R2 with an hour manifest, and Analytics Engine hold what it
held; the decision id carries the tenant and the timestamp so it resolves on its own. **Nothing about it
remains open.** The only outstanding items are actions, not questions: the two Phase 0 handovers.

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
- ✅ **Resolved 2026-09-03:** doc 22 §18.10 accepted (doc 24 addendum 2). D1 is off the ledger path;
  §§3.3, 10, 12.3 and 14 say so, and a new §3.4 carries his reconciliation: the decision id is assigned at
  decision time and carries its timestamp, the hour prefix derives from the id, and the consumer writes a
  per-hour manifest of batch id ranges. Point lookup is a manifest GET and a batch GET, no shared writer.
  The tenant is the first segment of the R2 key, so **a decision id resolves only together with its
  brand** — true for the console and replay, which are per-brand anyway; worth one line in the support
  runbook. Phase 0 is smaller for it: no schema, no pruning cron, no decisions migration.
- **Mine, regardless of that decision:** fence the `demo_events` per-action D1 write in `realtime.ts`
  behind a demo-only flag, and record that `receipts.capture()` is a demo path and not Phase 0's template.
- ~~Flagged for Phase 0, a sizing challenge:~~ doc 22 §18.9, now superseded by §18.10. §3.3's "D1 holds the last 30 days" breaks at
  roughly 83,000 personalized page views a day on its own 10 GB figure; at 1M/day the ceiling is reached in
  ~30 hours. Recoverable (R2 holds everything, the index can be rebuilt) so it is a decision, not a
  deadline. **The D1 half of CW1 is paused** behind it: making a schema multi-brand before deciding whether
  it should hold that data is the wrong order.
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
  `POST /realtime/action` accepts. Content interactions and the conversion event travelled as `custom`
  with the real event named in the payload until CW3 made them first-class on both sides (2026-09-03); the
  contract test in `src/routes/realtime.sdkContract.test.ts` fails the moment the two disagree, and now
  also asserts that no alias remains in the payload.
- **Everything DOM-shaped enters through `Host`.** `browserHost` binds the browser; `memoryHost` runs
  the same code in Node. That is what makes the tests possible without a browser and what makes a native
  client a port of one file.
- **Two follow-ups this seam names.** The storefront cutover (the demo consuming the SDK rather than its
  own transport copy) is the step that makes "one truth" literal and it needs a Coach rehearsal first.
  SDK-key enforcement on the server is CW10; the SDK already sends the key.
- **The cutover is built behind a switch (2026-09-04).** `?sdk=1` on the storefront URL, or
  `<meta name="edge-transport" content="sdk">`, routes identity, the action POST, the socket, the ODP
  receipts and the content decisions through `/sdk/edge-personalization.js`; the page's own transport
  copy stays the default until the stage rehearsal says otherwise, so nothing the audience sees changes
  until a person flips it. In SDK mode the page also hydrates the content decisions for `home` and shows
  them in the engine feed, without replacing the hero and story the demo paints today: swapping those
  for the decision service is the visible change the rehearsal exists to judge. The rehearsal is
  `scripts/rehearse-storefront.sh`: both transports driven through the same beats (load, open a product,
  add it to the bag) in a real headless browser via `/__shot?probe=`, compared field by field (identity
  minted and stored, socket connected, events sent, affinity built, hero painted; in SDK mode the SDK
  loaded, decisions hydrated, the first decision in the ledger). Scripted and repeatable, the Kickoff + 60
  bar applied to our own store.

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
  staging. B5 is settled (2026-09-04, Simone: probably a lower environment first, and it does not matter either way), so
  nothing gates it but the account.

---

## The CW2 seam (2026-09-02)

- **Three documents, one store, one line.** The catalog, the per-page slot strategies and the learning
  settings are written through `/content/:kind` exactly as the reflex config is written through
  `/config`: reads open, writes fail closed on a JWT regardless of `AUTH_MODE`, every write validated as
  a whole, versioned, attributed, and rolled forward. The tuning surface and the learning console
  (CW22) are clients of these routes, never a second path into KV.
- **The import adapter reshapes, the validator decides.** Any export shape the adapter recognises
  (the demo catalog's, a CMS's, the CSV columns) becomes a candidate piece; nothing reaches the store
  that `validateContentCatalog` would reject. A missing customer id falls back to the piece id on
  purpose; a missing type, title or slot list cannot.
- **The CMS/DAM seam is a URL the worker pulls**, http(s) only. Which URLs a tenant may name is a
  policy for CW1 to bind to the tenant, like the SDK keys.
- **The window is an eligibility gate.** Outside its publish window a live piece does not exist for the
  decision, however well it would have scored. That is the §1.5 order, gates before scoring, applied to
  lifecycle.
- **A caveat the smoke test found, worth knowing before the acceptance run.** In the default
  session-host mode a shopper's state rides the session cookie, so a decision request must carry it. A
  browser does and the SDK does (`credentials: include`); a bare curl does not and sees a cold
  shopper. The Durable Object host (`REFLEX_HOST = do`) keys state on the visitor id and is cookie-free.
  The staging definition should pick one deliberately.
- **`scripts/import-content.mjs`** is the manual adapter for the demo catalog: it pulls Meridian's
  eighteen pieces through the seam into a scope and writes a slot document whose names and weights match
  the catalog's vocabulary, so the full chain, SDK to decision, can be shown on the dev server today.

---

## The CW6 seam (2026-09-02)

- **The population never learns a name.** `RegionTrend` holds `(R, t)` per dimension value and an
  event count; no visitor id, session id or cookie reaches it. Its KV snapshot is what the decision path
  reads, through a 60-second isolate cache; the object is never on the request path.
- **Key layout.** Objects are named `{tenant}:{region}`; snapshots live at `trend:{tenant}:{region}`,
  with `trend:{tenant}:{country}` and `trend:{tenant}:*` written by the rollup (hourly cron over
  `TREND_ROLLUP_TENANTS`, or `POST /v1/:tenant/trend/rollup` on demand). `GET /v1/:tenant/trend` shows
  which level answered and why, so the console can explain a prior the way it explains a decision.
- **Fan-in survives the reply.** Both hosts register the region fetch with an execution context: the
  route hands its own to the session engine per call, and the shopper object uses its state's
  `waitUntil`. A fire-and-forget promise without one is dropped when the response goes out, which is
  how the first live run published nothing. Two other defects the live run found and the unit tests had
  not: the frame must carry the object's own name, since the object learns it from the first frame, and
  publishing must not depend on an in-memory flag an eviction would lose.
- **The blend is on the base score, as a prior, and it is itemized.** `λ = K/(K + Σ personal)`,
  `ã = (1−λ)·a + λ·share`; every decision the region influenced carries a `regional` driver whose
  `a × weight` is the region's share of the score, and the record carries the level, the event count and
  the snapshot version behind it. The holdout's default arm gets no prior, since defaults are its point.
- **Settings live on the `learn` document**: `regional.enabled`, `kBlend`, `minEvents` (the same
  30-event gate the geo cold start uses). The personal decay constants are untouched; the population's
  horizon is 24 hours by construction.
- **One demo-only seam.** Fan-in keys on the reflex *surface* (`coach`), while the content service keys
  on the *tenant*. They are the same string only when the catalog is imported under the surface's name,
  which is what the live proof did. CW1's tenancy binds the two properly.

---

## Scope and tenant, one seam (2026-09-03)

The content service reads its documents under a **scope** named in the path (`/v1/:tenant/...`) and
reads shopper state for the **brand** the tenancy middleware resolved from host, header or explicit
signal. They are two names on purpose until CW1 provisions tenants: the catalog can be imported under any
slug today, while shopper objects and sessions are already namespaced per brand and the default brand
keeps its bare keys. A visitor id beginning with the namespace marker is refused at the route, the same
guard the tenancy module applies underneath. When a tenant is provisioned, the two names are the same
string and the seam disappears without a code change.

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

## File ownership, one owner at a time (agreed 2026-09-03)

Proposed by the outcome-learning session after our one collision, which was two edits to the same file
in the same hour. Adopted. **A file has one owner at a time, named here before either track opens it.**
The other track reads it freely, and writes only by handing the file over in this table first.

| Owner | Files |
|---|---|
| **Delivery ledger session** | `src/measure/*`, `src/identity/*`, `src/reflex/identityMerge.ts`, `src/routes/identity.ts`, `src/durable-objects/ShopperReflex.ts` (from 2026-09-04, CW25), `src/tenancy/*`, `src/services/CDPService.ts`, `src/services/FeatureVariableManager.ts`, `src/services/experimentRun.ts`, `src/routes/cdp.ts`, `src/routes/experiment.ts`, `src/config/versionedStore.ts`, `src/reflex/configStore.ts`, `src/reflex/merchandising.ts`, `src/services/visit.ts`, `src/services/SessionManager.ts`, `src/connectors/AudienceStore.ts`, `src/routes/config.ts`, `src/routes/operator.ts`, `src/demos/meridian/receipts.ts`, `public/tuning.*`, `migrations/0009_*` onward for tenancy |
| **Outcome-learning session** | `src/content/*`, `src/reflex/contentCompose.ts`, `src/routes/decisions.ts`, **`src/sdk/*`, `scripts/build-sdk.mjs`, `public/sdk/*`** (CW8, landed 2026-09-02), the RegionTrend object and its fan-in, `touchesForEvent` in `src/reflex/core.ts`, the Phase 0 ledger writer and its migration, doc 22 above §18 |
| **Handover required before writing** | `src/index.ts`, `src/types/env.ts`, `src/routes/realtime.ts`, `src/services/RealtimeSegmentEngine.ts`, `src/services/odpLoop.ts`, `src/reflex/core.ts` outside `touchesForEvent`, `wrangler.toml` |

**Handovers granted 2026-09-03, for Phase 0**, at the outcome-learning session's request in doc 24 addendum 2:

| Handed to | Exactly what | Until |
|---|---|---|
| Outcome-learning session | The **queue consumer case** in `src/index.ts` (the `queue()` export and its dispatch), and nothing else in that file | Phase 0 lands |
| Outcome-learning session | The **outcome enqueue line** in `src/routes/realtime.ts`, adjacent to the existing `captureDemoEvent` call, and nothing else in that file | Phase 0 lands |

Each is one bounded edit. `wrangler.toml` needs nothing from either track for this: the consumer uses the
`ANALYTICS` and `STORAGE` bindings it already has.

| Handed to | Exactly what | Until |
|---|---|---|
| Delivery ledger session | The **`purchase` / `checkout` / `order_complete` case** in `mapActionToOdp`, `src/services/odpLoop.ts`, and nothing else in that file | Landed 2026-09-03 |
| Delivery ledger session | **CW3, five one-line edits:** the action-name resolver at `RealtimeSegmentEngine.ts` (two sites), `ShopperReflex.ts` (one), `odpLoop.ts` (one) becomes `actionOf(event)`; the `touches:` argument at the two reflex sites routes content actions through `contentTouches()`; `DEFAULT_REFLEX_CONFIG` in `core.ts` gains four content weights and a `contentType` dimension, outside `touchesForEvent`; `actionEventSchema` in `realtime.ts` names the four content types and `purchase`. Nothing else in any of those files | Landed 2026-09-03 |
| Delivery ledger session | **CW1 close-out:** in `RealtimeSegmentEngine.ts`, the audience-regeneration `MARKER` read/write in `ensureAudiencesSeeded`, the `profile:` cache in `getUserProfile`, and `sessionIdForUser` go through `TenantKV`; in `realtime.ts`, the two `SESSIONS.delete` lines in the session-reset route go through `TenantKV`. Nothing else in either file. `CDPService.ts`, `FeatureVariableManager.ts`, `experimentRun.ts`, `routes/cdp.ts` and `routes/experiment.ts` are unowned and are taken into the delivery-ledger row by this edit | Landed 2026-09-03 |
| Outcome-learning session | **Recorded after the fact, from addendum 9 (2026-09-04), one hunk each:** the first `[triggers]` section in `wrangler.toml` (hourly trend roll-up, 03:00 learning cycle); one case in the `scheduled` switch and one import in `src/index.ts`; the `proposals:config:` prefix in `src/config/versionedStore.ts`; one link line to `/learning.html` in each of `public/tuning.html` and `public/operator-console.html`; and in `src/middleware/edgeAccess.ts` (CW10, mine) the rule that a verified Bearer token passes `sdkKey()` when no site key is presented. All accepted; none should have gone in before a line here, and this line is the correction | Landed 2026-09-04 |
| Delivery ledger session | **Two optional fields in `src/types/env.ts`**, `IDENTITY_SALT` and `IDENTITY_SECRETS`, beside the CW10 vars, and nothing else in that file | CW25, 2026-09-04 |
| Delivery ledger session | **One mount line in `src/index.ts`**: `app.route('/v1', identityRoutes)` beside the decisions mount, so `/v1/:tenant/identity/*` sits under the same site-key gate, and nothing else in that file | CW25, 2026-09-04 |
| Delivery ledger session | **The `AUTH_MODE` line and its comment in top-level `[vars]` of `wrangler.toml`**, and nothing else in that file. The demo worker is `enforced` from 2026-09-03: the pages carry the site key `demo-site` in a `<meta>` and `public/edge-auth.js` attaches it; the presenter's token covers the writes; `deploy.sh` refuses the default deploy while the `SDK_KEYS` secret is missing. Rollback is that one line back to `open`. **Local dev needs `SDK_KEYS=*:demo-site` in `.dev.vars`** or every shopper call answers 401 — the shared checkout has it | Landed 2026-09-03 |
| **Requested of** the outcome-learning session | **R12-1, the one that matters: the learning policy's session scope credits nothing, online or batch.** A decision record's `session_id` is the SERVER session (`readShopper` → `getOrCreateSessionFromCookies`, a 30-day KV record); an outcome's `session_id` is `body.sessionId` from the action (`realtime.ts:116`), which the SDK sets to its own client-minted `mintSessionId()` and the storefront to `'s-' + Date.now()`. Two id spaces; `attribute()` (`policy.ts:64`) compares them; nothing ever matches, and `outcome.session_id === null` fails the same line when a client sends none. Proven: 22 outcomes on `holdout-proof3`, learning policy 0 credits, visitor-scope policy 22. Every Phase 1 and Phase 2 number produced under the default policy should be re-read in that light. **Fix, my recommendation:** carry the client's session id on the snapshot request (`?sessionId=` from the SDK's `listen`), write it as the decision's `session_id`, so both sides hold the client's session, which is also what "session" means in doc 22 §4.2 (the server record is 30 days long and would make session scope mean visitor scope). Until then: `DEFAULT_LEARN.policy.scope = 'visitor'` so learning is not blind. Your files: `service.ts`, `decisions.ts`, `sdk/listen.ts`, `kinds.ts` | Open |
| **Requested of** the outcome-learning session | **R12-2: the `no_learning` arm runs at the slot's γ, not 0.** Doc 22 §10 defines it as personalized with γ = 0, the arm that separates stage one from stage two. `service.ts:181` builds `gammaOf` from the slot alone and `decide.ts:81` nulls learning only for `default`; proven live: a `no_learning` receipt on `holdout-proof3` shows `gamma: 1`. Fix: `gammaOf = arm === 'no_learning' ? () => 0 : …`, and `exploreOf` null on that arm too. Same question for `fan.ts:42`, which feeds `no_learning` exposures and outcomes into the statistics: §10's absolute rule is that holdout outcomes never do | Open |
| **Requested of** the outcome-learning session | **R12-3: FNV-1a alone puts blocks of consecutive visitor ids on one arm.** The last byte of the input reaches the hash as `(h ^ byte) × prime`, so ids that differ only in their final character land 2²⁴ ≈ 0.4% of the range apart in a line. Measured with `armFor` as shipped: at share 0.5, **180 of 200** blocks of ten consecutive ids (`cust-100000…`) land entirely on one arm; random gives 0.4. UUID visitor ids are fine, which is why the demo never showed it; a customer whose ids are sequential (account numbers, an SFCC customer list) gets a holdout that is a time-block sample, not a random one. Fix, one finalizer in `bucketOf`: `fmix32(fnv1a(…))` with murmur3's `h ^= h>>>16; h = imul(h, 0x85ebca6b); h ^= h>>>13; h = imul(h, 0xc2b2ae35); h ^= h>>>16` — measured 0 of 200 blocks. It reassigns every visitor once, which is the salt-rotation case §10 already allows, and is right before launch and wrong after | Open |
| **Requested of** the outcome-learning session | **R12-4: the arm rows on the day report carry no uncertainty.** `compareArms()` in `src/measure/holdout.ts` takes the two `{ n, s }` you already compute per slot and returns the intervals, the verdict, the decisions still needed, and the sentence; `pooled()` sums days. One call per slot in `buildReport` (`default` vs `personalized`, and `no_learning` vs `personalized` when present), the result beside the arm rows, and the console shows the sentence. The module is mine; the call is yours | Open |
| **Requested of** the outcome-learning session | **CW25, the client half.** Two methods on the SDK client, your file: `identify(accountId, { assertion?, exp? })` posts to `/v1/:tenant/identity/link` with the current visitor id and, on `ok`, stores the returned `shopperId` as `opt_visitor_id` (localStorage and cookie, same format as `mintVisitorId`) and reconnects the socket under it; `logout()` posts `/realtime/session/reset`, mints a fresh anonymous id and reconnects. The contract, with the exact request and response shapes, is in `docs/architecture/25-identity-stitching.md` §4 | Landed 2026-09-04: `identify()` and `logout()` on the client (`src/sdk/identify.ts`), the socket reconnects under the new id, a 409 logs the previous person out and links once more with a fresh id, an `identity` event announces the change; 4 tests against the contract, and the contract proven against the routes in HEAD on the dev server: link answered with the shopper id and `outcome: linked`, a second link carrying the shopper id answered 409, detach answered `detached: true` |
| **Requested of** the outcome-learning session | **Row 6, the last line of Lane A.** `src/reflex/merchandising.ts` now exports `merchandisingAdjust(seam)`, a `ScoreAdjust`-shaped hook for `contentCompose.ts`, plus `merchandisingAdjustDetailed(seam)` for the receipt. The ask is one compose line in your adjust chain, alongside lift^γ, and one signature question: `ScoreAdjust` returns a bare number, so anything applied through it is **un-itemised** in the explain record, and §1.5 promises each multiplier is itemised. Either the hook grows to `{ score, drivers }` or the detailed variant is called beside it. Your file, your call; the factory is ready either way | Landed 2026-09-04: the detailed variant is called in the adjust chain and its drivers land on the receipt as `explain.merchandising`, plus one composer driver per term |

The third row is where the collision happened and where it will happen again if either of us is casual.
Nothing there is edited without a line in this table changing first.

**2026-09-04, the rule cut the other way.** The Phase 3 commit (`67e6e3d`) carried the CW25 rows this table had uncommitted at the time, because the doc was staged as a file. Nothing was lost and nothing was wrong; the lesson is only that *stage hunks, not files* applies to docs too, and to both of us.

**And one rule added 2026-09-03 after the second collision, which was mine.** I started CW8 from memory
of this plan and overwrote three files of the SDK the other session had already landed the day before.
The Write tool reported "updated" rather than "created" and I did not read it. Nothing was lost, because
his work was committed and mine never was. The rule: **before opening any work item, re-read this plan's
lane tables from disk, not from memory.** The other track may have finished it while you were elsewhere,
and a ✅ in a table you last read yesterday is the cheapest possible way to find out.

Two more rules that came out of the same exchange, both his:

- **Commit new modules before the code that imports them**, so a sweep by the other track can never leave
  `HEAD` importing a file that does not exist.
- **A `pkill` or `pgrep` pattern that appears in your own command line kills your own shell.** Find
  listeners by socket.

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

1. ~~Which brand is the first tenant.~~ **Answered: Coach, at the customer's request.** Mandeep changed the
   rules and asked for Coach first, having originally picked Kate Spade for lower business impact. The
   foundation is built against it (`src/tenancy/tenant.ts`), and Coach being the existing key space is what
   lets the default tenant stay unprefixed so nothing already stored is orphaned. Two customer-facing
   documents still say Kate Spade and need updating to match his ask: `Tapestry-Implementation-Plan.md`
   (lines 11, 40, 99) and Doc 1 §17.
2. ~~Approval to start the build.~~ **Answered: the build started 2026-09-01** on both tracks, after the
   document set went through v8. Nothing gates the queue now except the human steps named in each lane.

Neither blocks Lane A's first two items. The test harness and the config store can start immediately and
should.

*Opened 2026-09-01.*
