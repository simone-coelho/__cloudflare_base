# S5a · Verification of doc 34 §5 "Requirement and scope traceability"

Scope of this verification: `docs/architecture/34-independent-adversarial-audit.md` lines 462–502 —
the "Actual twelve signature capabilities" table and the "Disposition of every doc 20 working row"
table. (The D1–D13 table at 503–519 is outside this assignment.)

Repository: `/mnt/c/Users/LAH/Documents/__Development/Optimizely/__cloudflare_base`,
branch `feature/real-time-personalization`.

**HEAD is `c10ccff7303d06492e4acdf932fc70273d7159ac` — the exact commit the audit names.**
`git diff --stat c10ccff HEAD` is empty, so no line numbers have drifted; the working tree carries only
`public/meridian/engine.bundle.js` (modified) plus untracked docs. Every line number the audit cites in
the findings behind this section resolved within ±2 lines. Nothing was edited, deployed, or called over
the network; scratch harnesses live under `/tmp/audit-verify/S5a/`.

**Overall: accurate.** Every disposition in the section holds at HEAD. Nothing in the section is
materially wrong. The corrections below are precision items, and the additions are facts the section
should have carried — including one defect (NaN in the customer-facing holdout sentence) that no
finding in doc 34 records.

---

## 1 · The accepted view of the v8 scope draft

`python-docx` is not installed. Text was extracted from
`docs/opticon/Tapestry_Scope_of_Services_v8_tracked.docx` with
`/tmp/audit-verify/S5a/docx_text.py`: `word/document.xml` parsed with ElementTree, every `w:del`
subtree pruned before reading (`w:delText` excluded), `w:ins` runs kept. Output:
`/tmp/audit-verify/S5a/v8_accepted.txt` (133 lines). Tracked changes dumped separately with
`/tmp/audit-verify/S5a/tracked.py` (6 deletions, ~45 insertions, all authored "Optimizely Delivery").

The accepted-view summary reads: *"Twelve capabilities activate immediately — real-time behavioral
profiling of anonymous visitors, self-building audiences, the content catalog and enrichment pipeline,
the dimension registry and tuning surface, merchandising governance, explain records, multi-brand
provisioning, data science surfaces, product recommendations, AI search, custom product sort, and
Snowflake integration with historical data ingestion."*

Section 1 clause headings, accepted view, against the audit's capability column:

| Clause | Accepted-view heading | Audit's capability label | Match |
|---|---|---|---|
| 1.1 | Real-Time Behavioral Profiling | First-party profiling | yes |
| 1.2 | Self-Building Audiences | Self-building audiences; rename/pin/prune | yes ("renames, pins, or prunes anything the engine proposes") |
| 1.3 | Content Catalog & Enrichment | Content catalog and AI enrichment | yes |
| 1.4 | Dimension Registry & Tuning | Dimensions, hot tuning, per-slot weights/autonomy | yes (the inserted autonomy note covers per-slot weight mixing, logging, reversibility, pinning) |
| 1.5 | Governance & Merchandising Authority | Governance, merchandising, overrides | yes |
| 1.6 | Explain Records | Every decision persisted/exportable | yes ("Persisted and exportable") |
| 1.7 | Multi-Brand Provisioning | Multi-brand hard isolation | yes ("hard data isolation between brands") |
| 1.8 | Data Science Surfaces | DS exports, priors, debug, scheduled egress | yes ("Scheduled exports run autonomously") |
| 1.9 | Product Recommendations | Product Recommendations entitlement | yes ("part of the existing platform entitlement") |
| 1.10 | AI Search | AI Search on customer catalog/live affinity | yes ("over your own catalog … blended with that shopper's live affinity") |
| 1.11 | Custom Product Sort | Custom sorting, including SFCC | yes, with the nuance in §4 below |
| 1.12 | Snowflake Integration & Historical Data | Scheduled Snowflake share and historical enrichment | yes |

The audit's list of the actual twelve is correct, and its framing ("clause numbering below is the
accepted-view text") is the right one: three of the six tracked deletions change what the clauses mean.

Two deletions matter to this section:

* **§1.1.** Deleted: *"Scoring happens at the network edge in milliseconds using first-party signals
  only. No fingerprinting, nothing acquired from outside Tapestry."* Inserted: *"…with no fingerprinting
  and no purchased audience data on the decision path. This describes what the in-session profile is
  built from rather than a limit of the architecture: historical, warehouse, and third-party data enter
  the platform under 1.12…"*
* **§1.11.** Deleted: *"This capability **will be enhanced** to support sorting on feeds originating from
  Salesforce Commerce Cloud or any other source…"* Inserted: *"Connecting a specific commerce source,
  **including a Salesforce Commerce Cloud feed or any other source, is a joint integration performed
  during the integration window in Section 3.1 against dependency D4**; the feed must return a candidate
  set carrying the attributes the engine scores against."*

The §1.11 insertion is exactly why the audit's "SFCC is committed, not a reopened scope choice" is right,
and it also bounds the commitment: SFCC connection is scheduled joint work against D4 (product feed
access, Kickoff + 14 days), not a signature-available capability.

---

## 2 · Framing statements in the section

| Statement | Result | Evidence |
|---|---|---|
| Clause numbering is the accepted-view v8 text; the twelve listed are the actual twelve | holds | §1 above |
| "The current table labels rows 1–13, placing 13 before 12, despite its 'twelve capabilities' summary" | holds | doc 20 §A rows run 1,2,3,4,5,6,7,8,9,10,11,**13**,**12** — thirteen rows, 13 before 12 |
| "Assurance rows such as testing/holdout do not replace missing scope clauses" | holds | doc 20 §A cites only **1.1–1.8, 1.11, 1.12 and 2.3**: `grep -o "\*\*1\.[0-9]*\*\*\|\*\*2\.[0-9]*\*\*"` returns exactly those eleven, once each. No row cites 1.9 or 1.10; no row mentions "recommendations" or "AI search" anywhere in the file |

So of the twelve signature clauses, **ten have a ledger row; 1.9 (Product Recommendations) and 1.10
(AI Search) have none**, and one row (10) tracks §2.3, a Section 2 clause, while two more (11 "tested",
12 holdout) track no clause at all.

---

## 3 · Reproductions

All harnesses are under `/tmp/audit-verify/S5a/`, run with `npx tsx` from the repository root.

### R1 · Config concurrency (row 1, capability 1.4 — F15) — reproduced

`r1-config-concurrency.ts` drives the real `write`/`patch`/`read` from `src/config/versionedStore.ts`
against an in-memory KV, on the real `LEARN_KIND` validator.

```
seed ok= true rev 1
A -> revision 2
B -> revision 2
CURRENT hero = {"gamma":0,"exploration":{"mode":"epsilon","share":0.1,"floor":0}} version= learn+r2
REVISION 2 actor= op-B hero= {"gamma":0,"exploration":{"mode":"epsilon","share":0.1,"floor":0}}
INDEX = r2 by op-B | r1 by seed
KEYS = learn:config:coach:rev:1 | learn:config:coach:current | learn:config:coach:index | learn:config:coach:rev:2
```

Two concurrent operator patches both return "revision 2", both write the same supposedly immutable key
`learn:config:coach:rev:2`, and operator A's γ=0.5 is lost (γ stays 0, ε becomes 0.1) — identical to the
audit's probe. Cause is structural: `write()` at `src/config/versionedStore.ts:233` reads the current
revision and increments locally, then puts revision (`:245`) and current (`:246`) with no
expected-revision precondition. **Beyond the audit:** the audit index (`:254`) keeps a single `r2` entry,
so nothing anywhere records that two different bodies were published as revision 2 — rollback and the
receipt trail cannot detect the collision after the fact.

### R2 · Holdout denominator and inference (row 12, F07) — reproduced

`r12-holdout-rate.ts` calls the real `buildReport` from `src/learn/report.ts` with one personalized
decision and three clicks on the served item:

```
holdout rows = [{"arm":"personalized","decisions":1,"credited":3,"rate":3}]
credits = learning:3
wilson(3,1) = {"p":1,"lo":0.2065,"hi":1}
```

Rate 3 (300%) in the arms table (`report.ts:129`, `credited / decisions`), while the interval helper
clamps successes to trials (`holdout.ts:136`) and reads it as 100%.

**New defect, not in doc 34:** `neededPerArm` (`src/measure/holdout.ts:165`) does *not* clamp. With the
same counts, `pBar = 1.5` makes `sqrt(2·pBar·(1−pBar))` a square root of a negative number, so it returns
`NaN`; `JSON.stringify` renders that as `null` in the API, and the human sentence
(doc 22 §10, "the sentence a person reads") prints:

> "…a difference this size needs about **NaN** decisions on each arm to call, and the smaller arm has 1."

Verified independently in `r12b-needed.ts`: `neededPerArm raw = NaN, isNaN = true, JSON = {"n":null}`.

### R3 · Long-window truncation (rows 4 and 12, F25) — reproduced

`r4-window.ts`, against the real `datesBetween`/`windowReport` in `src/measure/window.ts`:

```
MAX_WINDOW_DAYS = 92 requested days = 181 returned = 92 first = 2026-01-01 last = 2026-04-02
report label from/to = 2026-01-01 2026-06-30
days counted = 0 missing listed = 92 unaccounted dates = 89
```

Confirms the audit. **Sharper than the audit states:** the 89 dates past the cap appear in neither
`days` nor `missing`, so the truncation is invisible in the response body as well as in the label —
a consumer cannot compute coverage from the report itself.

### R4 · Page-wide pin duplication (capability 1.5, F28) — reproduced

`r5-pin-duplicate.ts`, against the real `composeContentDetailed`:

```
hero: campaign-a (affinity) | story: campaign-a (tenant-pinned)
duplicate on the page = true
pin served into a slot its slotTypes do not list = true
```

`src/reflex/contentCompose.ts:125` composes slots sequentially and the pin branch (`:127`) neither
reserves later pins before ranking nor checks `slotTypes`.

### R5 · Feed normalization (rows 6 and 8, capability 1.3/1.5, F27) — reproduced

`r6-import.ts` / `r6b-tags.ts`, against the real `normalizePiece` and `validateContentCatalog`:

```
merchandising survives import = false -> undefined
normalized tags (duplicate kept?) = {"styleWorld":["minimalist"]}
stage words from the PS guide: explore -> null | consider -> null | decide -> null
direct PUT keeps merchandising = {"season":0.9,"promotion":0.5,"margin":0.3}
after import, catalog merchandising = [ 'pieces[0].journeyStageFit: non-empty array of exploring | considering | deciding (early | mid | late also accepted)' ]
direct PUT ok = true tags = {"styleWorld":["minimalist","minimalist"],"notARegistryDimension":["whatever"]}
```

* `normalizePiece` (`src/content/import.ts:54`) rebuilds a piece with no `merchandising` key at all
  (`grep -n merchandising src/content/import.ts` → no match), while direct validation supports it
  (`src/content/kinds.ts:74`). A routine feed refresh silently strips season/promotion/margin.
* **Stronger than the audit says:** a feed carrying A.3.6's own stage words —
  `docs/PS-Implementation-Delivery-Guide.md:111` promises "Their words are accepted as written" for
  `journey_stage_fit: [explore, consider]` — does not merely lose the field. `stageWordOf`
  (`kinds.ts:25`) returns null for `explore`/`consider`/`decide`, and the **whole piece is rejected**
  by catalog validation. The customer's documented vocabulary fails the import outright.
* Duplicate and unknown-dimension tags validate on the direct PUT path (import dedupes duplicates,
  so the audit's duplicate claim is a property of the validator, not of import).

### R6 · Ledger duplication on redelivery (capability 1.6, rows 4/5, F16) — reproduced

`r5b-ledger-dup.ts`, real `consumeLedger` against a fake R2:

```
first  = {"written":1,"objects":1,"skipped":0,"ok":true}
second = {"written":1,"objects":1,"skipped":0,"ok":true}
objects now = 2 t/2026-09-05/12/outcome/…-mtq4qtzw-egpx2h.ndjson | …-mtq4qtzx-cya9qr.ndjson
rows for one outcome = 2
```

`src/ledger/consume.ts:22` mints a fresh random `batchId` per consumption, so an at-least-once
redelivery lands as a second object and a second row.

### R7 · Autonomy applies a stale proposal over a pin (capability 1.4, F24) — reproduced

`r14-autonomy.ts`, real `applyProposal`:

```
current weight 0.9, pinned dimension, stale proposal to 0.15 -> {"styleWorld":0.15}
```

`src/learn/autonomy.ts:102` clamps only to min/max. `decideProposal` (`src/learn/cycle.ts:82`) re-reads
the autonomy config but never re-checks `cfg.pinned`, the proposal's age, or the current value, so an
operator approving an old proposal overwrites a later pin. In `runCycle`, the proposals document is
written with `status:'applied'` (`cycle.ts:72`) before the slots write (`:75`), so a failed slots write
leaves a false applied receipt.

### R8 · Test count (row 11) — reproduced, with a caveat

Two full runs of `npx vitest run`:

* Run 1: `Test Files 1 failed | 91 passed (92)`, `Tests 2 failed | 1090 passed (1092)`, exit 1. The two
  failures are `src/demos/brighthour/composer.test.ts` — both "Test timed out in 15000ms" under a
  223 s loaded run.
* Run 2: `Test Files 92 passed (92)`, `Tests 1092 passed (1092)`, exit 0 (107 s).
* That file alone: `Tests 73 passed (73)` in 14.9 s.

So **1,092 is exactly right and the suite is green**, but it is not deterministically green on a loaded
machine: that file's tests sit within a whisker of the default 15 s timeout.

---

## 4 · Disposition-by-disposition

### The twelve capabilities

| Clause | Result | What was checked |
|---|---|---|
| 1.1 | holds | `src/content/service.ts:77`/`:158` carry no visit number or entry channel (`visitNumber: shopper.isNewSession === true ? 1 : null`); reflex config resolves through `src/demos/registry.ts` whose `resolveSurface` documents "Absence is ALWAYS coach"; profiling itself is real |
| 1.2 | holds | Verbs exist at `src/routes/operator.ts:431/453/481` behind `jwt({required:true})` with no tenant membership; `ensureSeeded` → `ensureAudiencesSeeded` runs generation + hash compare per engine instance (`RealtimeSegmentEngine.ts:410, 805, 960, 963`), i.e. on the first event of every isolate — "remove per-event regeneration from the hot path" is fair |
| 1.3 | holds | R5. The only propose/approve workflow is the demo Offer Desk, `src/routes/liveOps.ts` ("No auth: this is a demo surface"), keyed under `bh:offerdesk:`. No generic enrichment approval exists |
| 1.4 | holds | R1, R7; plus F26 verified: `public/console/views-config.js:340` ships `inStage: 1.2` with `min:1,max:3` while `src/content/kinds.ts:176` accepts 0..1, and `src/content/decide.ts:137` **adds** `inStage` (`base += rule.inStage`) while the form calls it a multiplier |
| 1.5 | holds | R4; window/stock gates are real (`decide.ts:78` `isEligibleAt`); merchandising terms are itemized on the receipt when supplied directly (`decide.ts:216`, `:271`, `types.ts:285`) |
| 1.6 | holds | R6; only `src/routes/decisions.ts:343` enqueues decisions (`enqueueDecisions`), so the content grain alone reaches R2 |
| 1.7 | holds | `src/middleware/edgeAccess.ts` verifies the site key against `c.req.param('tenant')`, while `src/tenancy/middleware.ts:74` resolves the brand from the `X-Tenant` header or host — the verified key owner is never bound into that context |
| 1.8 | holds | Priors/lift/replay/snapshot routes exist (`src/routes/content.ts:38`, `src/routes/decisions.ts:251/318/434`); `validatePriors` (`src/learn/priors.ts:22`) checks shape only — no slot, item or registry-membership existence check (F20) |
| 1.9 | holds | Non-code claim, correctly labelled. `grep -rni "product recommendations\|entitlement" src/` returns only two comment lines in `src/reflex/sortCandidates.ts`. Nothing in the repository establishes a separate entitlement |
| 1.10 | holds | `src/services/CatalogIntent.ts:8` statically imports `@/data/coach-catalog.json`; `CATEGORIES` is Coach's three; `src/routes/ai.ts:31` prompts "luxury-handbag … on-brand for Coach" |
| 1.11 | holds | Ranker is real and stable at zero affinity (`sortCandidates.ts:146` explicit comparator). No site-key gate on `sortRoutes.post('/')`; `affinityFor` reads personalized state with no consent gate; `sessionId` is parsed by the schema (`:37`) and dropped at destructuring (`:88`); no SFCC/commerce adapter exists anywhere in `src/` |
| 1.12 | holds | R2 partitions exist; `applyHistory` (`src/identity/history.ts:105`) resolves `resolveSurface(null)` → Coach for every tenant, and skips any row whose action has no weight or carries no registry attribute. **No scheduled destination share exists at all**: `[triggers] crons` are the 5-minute monitor, the hourly trend rollup, and 03:00 autonomy + day report + erasure rewrite; `grep -rni snowflake src/` matches only a test fixture string |

### Every doc 20 row

| Row | Result | What was checked |
|---|---|---|
| 1 · Immediate config | holds | R1 |
| 2 · Snowflake/history/identity | holds | 1.12 above; identity routes exist (`src/routes/identity.ts:55/146/175`) but no cron performs an export |
| 3 · Hard isolation | holds | 1.7 above; `src/demos/registry.ts` is a second, surface-keyed registry with a Coach default |
| 4 · DS surfaces | holds | R3, R6; priors shape-only validation |
| 5 · All decision grains | holds | Only the content path enqueues. `/sort` persists **nothing** — no ledger call, no D1 write; the product/section receipts are the Meridian demo's D1 tables (`src/demos/meridian/receipts.ts`) |
| 6 · Merchandising | holds | R5 |
| 7 · Rename/pin/prune | holds | `audienceWrites = jwt({required:true})`, tenant from the request context, no membership model |
| 8 · CMS/DAM import | holds | R5, plus §1.3's absent approval/publication workflow |
| 9 · External/SFCC sort | holds | 1.11 above |
| 10 · API-first SDK delivery | holds | `content_decisions` appears only in docs, `src/sdk/core.ts:226`, `src/sdk/types.ts:123` and the two built bundles — **no server-side sender exists**. Servers push `personalization_update` (`ShopperReflex.ts:750`, `RealtimeSegmentEngine.ts:582`). The demo re-hydrates itself (`public/storefront.js:273` → `_scheduleRehydrate` at `:354`); the kit snippet (`docs/kit/01-integration-guide.md:49–57`) does not |
| 11 · Tested | holds-with-drift | R8: 1,092 exact, green on a clean run, 2 timeouts under load. `.github/workflows/ci.yml` exists (typecheck + test on push/PR), so doc 20's "no pipeline runs it" is the stale text; `npx eslint src --ext .ts` exits **2** ("couldn't find the config @typescript-eslint/recommended" — `.eslintrc.json` omits the `plugin:` prefix) and `scripts/deploy.sh:15` runs `npm run lint` as a gate |
| 13 · Customer first-party attributes | holds | `eventAttributes: 'event-when-unknown'` is real (`src/reflex/core.ts:329`, `src/durable-objects/ShopperReflex.ts:471`), but it is a field of the reflex config, which is read per **demo surface** (`readReflexConfigRevision(env, surface)`), so an arbitrary brand resolves Coach's registry |
| 12 · Holdout | holds | R2; `armFor` hashes the current visitor id and `service.ts:168` defaults the salt to the brand name, so identify/logout moves the arm; `decide.ts:69` gives the default arm `NO_SIGNAL` with pins still applied — catalog order, not the customer's production rules; `armUnder` (`src/content/consent.ts:46`) maps consent-refusing traffic into the same `'default'` arm |

---

## 5 · Corrections

Nothing in the section is materially wrong. Two items need qualifying rather than correcting:

1. **Row 11's "1,092 tests pass now" should carry its condition.** The count is exact and a clean run is
   green, but `npm test` exited 1 on my first full run with two 15 s timeouts in
   `src/demos/brighthour/composer.test.ts` (green in isolation and on a second full run). Stated flatly,
   it will be read as a deterministic gate; it is not one on a loaded machine.
2. **"Disposition of every doc 20 working row" disposes only Section A.** Doc 20 also carries B1–B10
   (contradictions) and Section C (five unauthenticated-surface items). Several bear directly on the
   audit's verdict — B1 ("available on signature" versus the Implementation Plan's milestones) and C's
   `/cdp/*` and unauthenticated decision-export bullets are the representational and F01 risks. If
   "working row" means Section A only, say so in the heading.

## 6 · Additions

Facts the section should have carried, in the order they matter:

1. **The holdout sentence prints "about NaN decisions on each arm."** Unclamped credits make
   `neededPerArm` (`src/measure/holdout.ts:165`) take the square root of a negative number; JSON renders
   the NaN as `null` and the human sentence renders it as the string `NaN`. This is a customer-visible
   artefact of the same denominator defect and appears in no doc 34 finding.
2. **The long-window report hides its own truncation.** 89 of 181 requested dates appear in neither
   `days` nor `missing`, so coverage cannot be recomputed from the response — stronger than "returns the
   original requested end date".
3. **A feed using the customer's documented stage words is rejected, not degraded.**
   `journey_stage_fit: [explore, consider]`, which `docs/PS-Implementation-Delivery-Guide.md:111`
   promises is "accepted as written", fails `validateContentCatalog` outright.
4. **`/sort` persists nothing at all.** Row 5's caution is right but understated: the product grain has
   no persistence path, not merely a demo-scoped one, and doc 20 row 9's "one receipt per item" describes
   the response body only.
5. **The concurrent config write is invisible afterwards.** The revision index keeps one `r2` entry, so
   no audit trail records that two bodies were published as the same immutable revision.
6. **Doc 20 has no row for §1.9 or §1.10 at all**, and its row 10 tracks §2.3 (a Section 2 clause). Ten
   of twelve signature clauses have a row. Naming the two absentees in the disposition table would make
   F11's point concrete where a reader looks for it.
7. **Doc 20 row 9's "Never drops a candidate" is absolute and slightly false.**
   `sortCandidates` drops blank and duplicate ids and counts them in `dropped`
   (`src/reflex/sortCandidates.ts:125`). Defensible behaviour, wrong sentence — worth naming since the
   audit accepts the ranker.
8. **v8 materially narrowed §1.1's first-party claim** (deleted "first-party signals only … nothing
   acquired from outside Tapestry"; inserted the paragraph routing historical/warehouse/third-party data
   in under 1.12). That retires doc 20's B8 contradiction and changes what "prove agreed signals" means
   in the 1.1 cell.
9. **§1.11's SFCC commitment is bounded by the accepted text**: a joint integration during the Section
   3.1 integration window against dependency D4, not a signature-available adapter. Quoting that keeps
   "SFCC is committed" from being read as "SFCC is delivered".
10. **No cron performs any export.** The three crons are the monitor, the trend rollup, and the 03:00
    autonomy/day-report/erasure batch. "Scheduled sharing" is unimplemented rather than partially
    implemented, which is a cleaner statement of rows 2 and 1.12 than "not scheduled sharing".
