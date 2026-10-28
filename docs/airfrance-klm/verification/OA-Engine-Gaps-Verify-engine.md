# Verification: the airline demo's engine gaps (OA-Engine-Gaps.md §1, §2, §4)

Read at two trees. **D** is the demo's feature branch at `4d882915` (worktree `oa-verify`, HEAD and a clean status checked). **I** is the shipped engine at `rem/integration` `ed7d6bbe`. The integration checkout moved to `c953c04e` while this ran; that is one commit with no change under `src/`. Every probe ran on git-archive copies of each sha, at `S47/engine/scratch/{oa-4d882915,int-ed7d6bbe}`. Tags used below: **REPRODUCED** (I ran it and saw it), **SOURCE-TRACED** (I followed the code path), **UNVERIFIED** (with the reason), **HYPOTHESIS**. The day estimates are engineering estimates and nothing more.

## For the owner: verdicts and remedies, ranked by customer impact

| # | Item | Verdict | Root cause, in one line | Remedy at the cause, in one line | Size |
|---|---|---|---|---|---|
| 1 | **Engine 18**: money slots refuse every outcome that states a currency | **ACCURATE** at D and I on the mechanism. **PARTLY** on the effect and the workaround: 7 of the 10 money slots learn nothing even from the synthetic history. | The money rule was built with a path to the visitor's ring but no way in: the learn document has no member for it and no producer reads one. Separately, the offline folds skip the rule, so the report credits what live learning refused. | Add a `money` member to the learn document. Both outcome producers (the direct one and the recovery one) read it. The one shared credit rule applies it online and offline alike. The SDK stops inventing `USD`. | 2–3 days |
| 2 | **Engine 20**: the day report goes over its 16 MiB size limit | **ACCURATE** on the symptom at D and I. **PARTLY** on the rest: the cause is wider than the day report, and the suggested fix (paging the report) would not help. | The batch fold works in a single request. That request holds a whole hour of the tenant's raw rows, plus every visitor's decisions for 48 hours, under fixed 16 MiB limits. The memory needed grows with traffic. | Rework the fold so each step has a fixed memory limit: deduplicate rows by digest while streaming each ledger object, and fold and commit one shard at a time. Paging the output changes nothing. | 8–15 days (design first) |
| 3 | **Engine 19**: no lift for up to a minute after new learning is published | **ACCURATE** at D. **ALREADY FIXED IN I** by P62 (`3657e892`) and P72 (`9a1c1c6e`). | At D, a cached lift copy that a newer publication has replaced is refused, not served. Publications come about every 30 s, the cache holds copies for 60 s, and the freshness check must answer within 50 ms. | No engine work: run the demo on I's engine. I serves the recent copy labelled `asOf`. | 0 engine days |
| 4 | Customer ask: **their diagnostics** (time to decide, abandonment, repeat dismissal, completion beside upgrades) | **ACCURATE** at D and I. Completion per arm already exists. | The fold counts outcomes per slot and per arm. Named outcomes are a closed list of two. It has no per-visitor journey measures. | Let the tenant declare its own named outcomes, and add per-arm journey measures to the hourly fold. | 5–8 days, after #2 |
| 5 | Feature 2: **candidates that arrive with the request** | **ACCURATE** at D and I | A content slot ranks only catalogue pieces. `POST /sort` accepts candidates from the request, but nothing learns from it. | A slot kind whose candidates and their tags come with the request. Lift is kept per candidate id and the record names the candidates. | 5–8 days |
| 6 | Customer ask: **judging the optional steps on the whole journey** | **ACCURATE** that the demo rewards each step on the add-on bought. **PARTLY** that the brief left it out: the brief guards the steps with the holdout on completed bookings. | Matching an outcome to a decision is a tenant-wide setting. Under `direct`, a booking can never credit the "no step" piece. | A per-slot journey credit, built on P33's per-slot attribution: completing the booking credits the step that was shown. | 2–4 days, after #1 |
| 7 | Feature 11: **a labelled synthetic warm start** | **ACCURATE** at D and I | Imported priors are the only seed. They are refused on money slots, and nothing writes or labels a synthetic tally. | A labelled warm-start import in each objective's own unit, named as such on the receipt. | 3–5 days, plus owner row W25.P1.01 (what a money prior means) |
| 8 | Feature 13: **learning broken down by page context** | **ACCURATE** at D and I | The learning cell is fixed: channel, visit, stage, region, interest. I lets the tenant set its depth, never add a dimension. | Add a declared, bucketed request-context dimension to the cell, the ladder, the statistics keys, the folds and replay. | 10–15 days |
| 9 | Feature 12: **page context on the receipt** | **ACCURATE** at D and I | Request context only gates eligibility. By design it is never written to the record. | Record which eligibility conditions admitted the piece on the decision's `explain`, under the tracking-consent gate. | 2–3 days |
| 10 | Feature 14: **an attribution window per slot** | **PARTLY** at D and I | Windows are set per reward type for the whole tenant, not per slot. But the doc's example is already met: the after-booking offers learn `add_to_bag`, whose window is 6 h. | An optional per-slot window override, applied online and offline. | 2–3 days (low priority) |
| 11 | Feature 15: **`utm_campaign` read on arrival** | **ACCURATE** at D. **ALREADY IN I** (P36, `88e39487`). | D's SDK reads `utm_medium`, `utm_source` and `utm_term` only. | No engine work: run on I. I reads the campaign, classifies a channel from it, and a seed rule can fire on that channel. | 0 |
| 12 | Customer ask: **the three extra hypotheses** | **ACCURATE**: they are not in the brief. They are content and page design, not engine gaps (HYPOTHESIS). | (none) | Demo or content design. No engine change identified. | 0 engine days |

**The headline.** Two real product defects stand at both trees and would hit any customer:

- **#1:** every revenue or margin slot fed by the SDK learns nothing. On top of that, the report credits revenue that live learning refused.
- **#2:** at production volume the report pipeline answers 413, or returns a day report marked incomplete with the busy hour left out.

One defect (#3) and one feature (#11) are already closed in rem/integration. The demo's 90-second talk gap hides #3 only on D's engine.

---

## 1. The three defects

### Engine 18: money slots and a stated currency

| Claim in the doc | Finding |
|---|---|
| A revenue or margin slot refuses any outcome that states a currency unless a policy is published | **ACCURATE**, D and I. `moneyRefusal` with no policy and a stated currency returns `money_policy_unset`: D `src/learn/fan.ts:125-136` (refusal at :135), I `src/learn/fan.ts:638-649` (:648). **REPRODUCED** at both through the production producer `outcomeToLearning`: a purchase and an `add_to_cart` stating EUR leave both money slots empty (`story: [], hero: []`). The control without a currency credits both (`['purchase']`, `['add_to_bag']`). Logs: `logs/probe-*.jsonl`, "E18 producer". |
| No policy can be published; nothing in `src/` passes one | **ACCURATE**, D and I. `validateLearnConfig` keeps only the members it knows, so a `money` member is accepted and dropped. **REPRODUCED** at both (`ok: true, keptMoney: false`); D `src/content/kinds.ts:682-694`. Neither producer passes one: D `src/learn/route.ts:87-88` and `src/ledger/recovery.ts:229`; I `route.ts:228-229`, `recovery.ts:303-304` (the prepare body carries none) and `recovery.ts:325` (passes `undefined` explicitly). SOURCE-TRACED. |
| The field is at `DecisionRing.ts:134` and used at :550 | **PARTLY**: :134 is the comment line and the field is at D :135. The use at D :550 is right. At I: field :142, use :626. SOURCE-TRACED. |
| Effect: none of the money slots learns from the room; "only the flight list learns live" | The first part is **ACCURATE**: D `public/oa/beats/open-learn.json` declares 10 revenue slots. The second is **PARTLY wrong**: `hero`, `destinations`, `continue` and `cabin-promo` are click-and-unit slots and learn live too (same file). SOURCE-TRACED. |
| Workaround: the history sends orders without a currency, "so those slots learn before the demo" | **PARTLY wrong.** Only the three purchase-reward money slots learn from the history: `recommended-fare`, `offer-format` and `fare-prompt`. The history's `add_to_cart` events carry `currency: 'EUR'` (D `scripts/seed-oa-history.mjs:366`, `:385`, and its header `:70-72`). So the seven `add_to_bag` money slots (`seat-step`, `bag-step`, `seat-reco`, `seat-image`, `next-offer`, `booking-offer`, `booking-seat-reco`) learn nothing even before the demo, and the dial cannot move them. **REPRODUCED** mechanism: an `add_to_bag`/revenue slot given an EUR `add_to_cart` gets `[]`. |
| Suggested fix: the tenant declares a currency and the outcome path passes it | **ACCURATE but incomplete.** See the root cause and remedy below. |
| Not stated in the doc, found here: the offline folds do not apply the rule | **REPRODUCED** at both: `foldRetainedDay` credits the same EUR purchase the ring refuses (`series: ['purchase']`). The folds weigh value with no currency check: D `fan.ts:658`, `hourly.ts:862`, `report.ts:1158`; I `policy.ts:142-149` (`successCreditOf` → `creditWeight` :109-113), `fan.ts:1417`, `hourly.ts:1351`, `report.ts:1431`. So the report and a rebuild credit revenue that live learning refused. |
| Not stated in the doc: the SDK invents a currency | The SDK's data-layer purchase sends `currency: x.currency ?? 'USD'`: D `src/sdk/emit.ts:79`, I `:121`. I's kit states the result: "in practice every revenue or margin slot refuses every such purchase today" (I `docs/kit/02-api-reference.md:1124-1135`). SOURCE-TRACED. |

**Boundary, stated.** INTENTIONAL BOUNDARY applies to the money policy's *values* only. I's LANE-LOG gives them to the owner row W24.P1.01 (R142, R190, R203). The same log records the refusal as standing "until W24.P1.01's values and the document read land" (R199). The way to publish was owed. It was never refused by a ruling.

**Root cause.** W24-B1/B2 (`06399ce7`, in both trees) built the money rule as a mechanism inside the ring only. It left out:

- the document member;
- the producer read;
- the shared credit rule that the offline folds use. P16 later made `successCreditOf` "ONE rule… online and every offline fold" (I `policy.ts:115-121`), but `moneyRefusal` sits outside it.

**Remedy, at the cause:**

1. **The document.** Add `money: { currency, nonpositive }` to the learn document. It is the existing `MoneyPolicy` shape (I `fan.ts:622-627`). Validate it in `src/content/kinds.ts` `validateRetainedLearn` (a malformed new document is refused naming the member; a retained one drops it, as P36 and P11 members do) and add it to the `LearnConfig` type in `src/content/types.ts`.
2. **The producers.** Pass `learn.money ?? null` to `fanOutcome` from `outcomeToLearning` (I `route.ts:228`) and carry it through `prepareOutcomeAdmission` (I `route.ts:129`), the recovery prepare body (I `recovery.ts:303`) and the admit call (I `:325`). The managed plan's digest then covers it.
3. **One rule.** Move `moneyRefusal` into the shared credit rule that the ring, `foldRetainedDay`, the hourly fold and the raw grids all use, so online and offline credit the same outcomes.
4. **The SDK.** `src/sdk/emit.ts` sends no currency when the data layer names none.
5. **The kit.** Update the paragraph in kit 02.

**Tests that would pin it:**

- the validator accepts a well-formed member, refuses a malformed new one, and drops it from a retained document;
- with an EUR policy, an EUR outcome is credited and a GBP one is refused naming `GBP`;
- `nonpositive: 'refuse'` and `nonpositive: 'credit'` each behave as named;
- the managed recovery path (`LEDGER_RECOVERY_ENABLED=true`) credits EUR;
- online and offline agree: the ring, `foldRetainedDay`, the hourly fold and the raw report refuse and credit the same outcomes;
- a data-layer purchase without a currency sends none.

The airline publishes EUR as its own value, so the platform invents nothing. **Does the workaround hide a customer defect?** Yes. Any customer with a revenue or margin slot fed by the SDK is hit.

### Engine 19: no lift while a cached copy is superseded

| Claim | Finding |
|---|---|
| A 60 s cache; a cache hit that is no longer current returns null | **ACCURATE at D.** D `src/content/service.ts:85` sets `LIFT_TTL_MS = 60_000`, and the hit at :97-98 returns null when `currentLiftWitness` fails. The witness requires the copy to be the statistics object's latest publication (D `fan.ts:20-23`) and to answer within 50 ms (D `fan.ts:25`). The statistics object publishes 30 s after writes (D `LearnStats.ts:23`, `:597-602`). Under steady traffic, a held copy is therefore superseded part-way through each 60 s hold. **REPRODUCED** at D: V1 served at t0; V2 published; null at t0+1 s and t0+30 s; V2 served at t0+61 s. |
| Same behaviour in I | **ALREADY FIXED IN I.** A superseded hit goes to `liftWitnessVerdict` (I `fan.ts:128-161`). A recent publication under the same witness, within `LIFT_RECENT_WINDOW_MS` (10 min, I `fan.ts:36`), is served with `asOf` (I `fan.ts:151-153`), and the budget is 600 ms (I `fan.ts:19`). **REPRODUCED** at I: at t0+1 s and t0+30 s, V1 is served with `asOf {latest: V2}`; at t0+61 s, V2. The fix landed as P62 `3657e892` (amendment 6, R-P110) and P72 `9a1c1c6e` (which reapplies `54f43549` after the revert `a49c1fc4`). Neither commit is in D (ancestry checked). I's own lock is `src/units/P62/LEDGER.unit.test.ts:399`. |
| Suggested fix: on a stale hit, read the new numbers | **Different from what I did, and not sufficient on its own.** The store is eventually consistent (I `fan.ts:70`), so a re-read can return the old copy. I serves the recent copy and names it. The store-lag figure that P62 used was not re-measured here (UNVERIFIED). |
| Effect on beat 7, the dial | At I, the dial changes only γ. γ is not in the witness: the witness basis is tenant, brand, slot, page, config, fence and projection (I `LearnStats.ts:198-201`), and `SlotLearnConfig` has no γ (I `fan.ts:1093`). So the dial does not invalidate a held copy. SOURCE-TRACED. At I, a counters reset or a generation transition still withholds a held copy until the hold expires (I `fan.ts:119-124`). That is intentional (R-P113). |

**Root cause at D.** The hit path treats "not the latest publication" as untrustworthy, and the publisher replaces copies every 30 s, more often than the 60 s hold. The 50 ms budget is a second cause of missing lift on a hosted worker. **Remedy.** It is already built in I. Run the demo on I's engine; the 90-second talk gap then becomes unnecessary. On D's engine, any customer would hit it.

### Engine 20: the day report over its size limit

| Claim | Finding |
|---|---|
| After 560 travellers the day report answers 413 `report_too_large`, 17,166,176 against 16,777,216 | **Mechanism REPRODUCED at D and I. The rig's figures are UNVERIFIED**: no rig was run, and the rig output naming the budget is not available. One UTC hour of 12,500 decision rows (17,342,410 B, about 1,387 B per row, 560 visitors): the hour fold and the day report are both refused with `report_budget_exceeded`, budget `rawBytes`, limit 16,777,216, observed 16,780,194. The route maps this to 413 (D `routes/decisions.ts:1242-1243`, I `:2048`), and the kit maps it to `report_too_large` (D `src/demos/kit/helpers.ts:118-131`, `actionRoutes.ts:376,384`). |
| The limit is at `src/learn/report.ts:28` (16 MiB) | **PARTLY.** Line :28 holds `objectBytes` and `rawBytes`. `aggregateBytes` and `windowBytes`, also 16 MiB, are at :30-31, at both trees. The rig went 388,960 B over the limit. That does not fit `rawBytes`, which trips at the first row over the limit (2,978 B over in my run; D `report.ts:199`, I `:201`). It fits a budget charged in large steps, such as `aggregateBytes`: HYPOTHESIS. |
| Not stated in the doc, found here: spreading the traffic over hours does not save it | **REPRODUCED** at D and I. I put the same 17 MB across two hours, about 8.7 MB each. Hour 12 folds. Hour 13 is refused at `aggregateBytes` (observed 25,377,516 at D, 25,451,546 at I), because the hour fold carries every visitor's decisions for a 48 h horizon (`hourly.ts` `DEFAULT_HORIZON_MS`, `RING_CAP = 200`; D :39-41, I :41-43) and caps the sum of all 64 shard bodies at 16 MiB (D `hourly.ts:1868`, `:1887-1888`; I `:2716`, `:2735-2736`). The day report is then still "built from the hour aggregates", with `coverage.status: "incomplete"` and hour 13 in `missingHours`. There is no error, and that hour's data is simply missing. A custom-policy (raw) day report is refused at `rawBytes`. |
| "Real airline traffic would pass this limit with far fewer than 560 travellers" | **PARTLY.** The limits apply per tenant-hour of raw rows and per tenant's 48 hours of folded decisions. At about 1.4 KB per row, more than about 12,000 decisions in an hour, or about 8,000 in 48 hours, already fails. Those thresholds are REPRODUCED. "Fewer than 560 travellers" depends on rows per traveller and is UNVERIFIED. Each record carries its slot's whole candidate list (D `content/decide.ts:542`), so request-supplied candidates (#5) would make rows larger. |
| Effect on OA: none on screen | **ACCURATE.** The page and the beats read no report (SOURCE-TRACED: OA's beat files publish documents only). |
| Suggested fix: page or split the day report | **INSUFFICIENT.** The read already pages (`limit`, `cursor`: D `decisions.ts:1289`, I `:2095`). The refusal is on the rows read in and the state carried, not on the output. |
| Not fixed in I | `REPORT_LIMITS` is identical (I `report.ts:27-31`). Amendment 12, the scale programme (P93–P97, I `docs/parity/scale/program.json`), has no report ticket. SOURCE-TRACED. |

**Root cause.** The batch attribution fold, and the raw day read, each run in one request. That request holds the whole tenant-hour of rows, deduplicated by keeping each full row (I `report.ts:179-201`). It also reads, folds and rewrites all 64 shards' 48-hour rings together under a two-phase plan. Both sit under fixed byte limits, so memory grows with traffic instead of with the aggregate.

**Remedy:**

1. Deduplicate by a digest of each logical row, streamed one ledger object at a time, never by holding the full rows.
2. Fold and commit each shard as its own bounded step. The split by visitor already exists (`shardOf`, D `hourly.ts:96`, I `:124`); the coordinator records each shard's completion.
3. Bound the rings per shard, and name what is evicted (carry-in eviction is already counted in coverage).
4. Make custom-policy raw reports an offline job, paged by object.
5. Publish the supported envelope in the kit.

**Tests:**

- an hour of 50,000 decisions folds with each step under its bound;
- a 48-hour horizon of 200,000 decisions folds with each step under its bound (checked by shape, not wall clock);
- the day report comes out complete;
- online and offline parity, and resuming a pending plan, are unchanged;
- a refused step names its shard.

This needs a design ruling before the build, because it changes the two-phase commit in `hourly.ts`. **Does the workaround hide a customer defect?** The demo has no workaround because it reads no report. A customer hits this in the first busy hour: the holdout comparison, the attribution report and `visitorOutcomes` become a 413 or quietly incomplete.

## 2. The six engine features

| Item | Claim checked (D / I) | Nearest existing capability | What a real implementation needs | Backlog? |
|---|---|---|---|---|
| 2: candidates that arrive with the request | **ACCURATE / ACCURATE.** `ServeRequest` has no candidates member (D `service.ts:39-81`, I `:46-105`). The record's candidates come from the catalogue (D `decide.ts:542`, I `:2113`). SOURCE-TRACED. | `POST /sort` takes up to 500 request candidates with attributes and returns a per-shopper order by affinity, but has no slot learning or lift (D and I `routes/sort.ts:39,46`). | A slot kind fed by request candidates (id, tags, `featuredProductIds`), validated against the vocabulary and scored by the slot's weights. Lift is kept per candidate id, with priors for unseen ids. The record carries what the catalogue cannot supply, which bears on #2 above. | Product backlog. 5–8 days. |
| 11: a labelled synthetic warm start | **ACCURATE / ACCURATE.** Nothing writes or labels a tally. Imported priors are probabilities and are refused on money slots (`priorUnitErrors`, D `learn/priors.ts:151-158`; the publish-time refusal of a retained money prior is at I `LearnStats.ts:1704-1710`). SOURCE-TRACED. | The prior import (W25). | A warm-start import in the objective's own unit, carrying its strength (`n0`) and labelled "synthetic", or "prior", on every receipt that uses it. What a money prior means is owner row W25.P1.01 (I LANE-LOG R148, R183). | Product backlog. 3–5 days. |
| 12: page context on the receipt | **ACCURATE / ACCURATE.** Request context gates eligibility only (D `service.ts:514-516`, I `:1030`). It is deliberately never "stored as evidence about the shopper" (D `service.ts:508-511`, an INTENTIONAL BOUNDARY on evidence). No member of `DecisionRecord` carries it (D and I `content/types.ts`). SOURCE-TRACED. | None. | Write the conditions of the piece's `eligibleWhen` that admitted it (name and value, not the whole context) to `explain`, under the tracking-consent gate and the record's retention. Compare it in replay, and show it on the receipt route and the kit panel. | Product backlog. 2–3 days. |
| 13: learning broken down by page context | **ACCURATE / ACCURATE.** The cell is channel, visit bucket, region, interest and stage (D `types.ts:383-391`). At I, P36 lets the tenant set the vocabulary and ladder depth, but "the order is c, v, s, r, a … and nothing else" (I `kinds.ts:1749`, `:1819-1830`). SOURCE-TRACED. | I's `contextPrior` (per channel and visit bucket, P07) and P36's vocabulary. | Declared, bucketed request-context dimensions (days out, party size) in the cell, ladder, statistics keys, folds, reports and replay, with cardinality caps. This needs a data-science design. | Product backlog. 10–15 days. |
| 14: an attribution window per slot | **PARTLY / PARTLY.** It is true that no window exists per slot: the window is chosen by outcome type (D `policy.ts:156`, I `:256`). The doc's reason is wrong: the brief asks for after-booking offers "within six hours of the showing" for `add_to_bag` (control checkout `docs/airfrance-klm/DEMO-BRIEF-OA.md:107`), and OA's `add_to_bag` window is already 6 h (D `open-learn.json:36`). I's P33 adds a per-slot policy (`module-tied`), but "the reward's window stay the brand-wide policy's" (I `types.ts:822`). | The per-reward window; P33's per-slot attribution. | `slots.<slot>.windowsMs` applied in the ring and in the folds, capped at the ring's reach, and named on the receipt. | Product backlog, low priority. 2–3 days. |
| 15: `utm_campaign` read on arrival | **ACCURATE at D** (D `sdk/identity.ts:72-87` reads medium, source and term). **ALREADY IN I.** The SDK reads `utm_campaign` (I `identity.ts:104-105`). A vocabulary rule may classify a channel by campaign (I `kinds.ts:1751`, `services/visit.ts:274`). An `entry_channel` seed then fires on it (I `decide.ts:1096-1100`). Landed in P36 `88e39487`. SOURCE-TRACED. | In I, it exists. | None for the engine. An explicit campaign seed signal, so that a campaign does not have to become a channel value in the cell, is optional (about 0.5 day). | Already in the product. 0 days. |

## 3. The customer asks

| Ask | Finding | Nearest capability (D / I) | Real implementation | Size |
|---|---|---|---|---|
| Judging the optional steps on the whole journey | The use-case file asks it (control checkout `docs/airfrance-klm/use-cases-2026-10-26.md:182`). It is **ACCURATE** that the demo rewards each step on the add-on (the step slots are `add_to_bag`/revenue, `open-learn.json`). It is **PARTLY** wrong that the brief left it out: the brief says the steps are "guarded by the holdout on completed bookings" (`DEMO-BRIEF-OA.md:38`). That guard is the tenant-wide 5% holdout, not a per-step judgement. | Orders per enrolled visitor, by arm (`visitorOutcomes`, D `report.ts:711`, I `:886`). A step slot could learn on `purchase` revenue, but under `direct` match a booking credits only pieces it names or features (D `policy.ts:172-177`), so the "no step" piece never earns. Switching to `any` changes the whole tenant. | A per-slot journey credit, on P33's per-slot attribution: completing the session's booking credits the step's decision, whichever piece was shown. Revenue in EUR needs #1 first. | 2–4 days, after #1 |
| The three hypotheses | **ACCURATE**: they are in the use-case file (:183-190) and not in the brief's beats. | (1) A stated priority can be sent as a tagged event, which feeds interests at once, as the history already does for seat-map exploration (D `seed-oa-history.mjs:375-378`). (2) A page-computed "comparing" signal can gate a help piece; it gates and never ranks. (3) The `continue` slot. Whether these are enough is a HYPOTHESIS. | Content and page design. | 0 engine days |
| Their diagnostics | **ACCURATE.** Time to decide, abandonment and repeat dismissal exist at neither tree. Completion per arm exists (`visitorOutcomes`). Named outcomes are a closed list (`partner_pickup`, `retailer_referral`: D `ledger/records.ts:207`, I `:264`), so a dismissal cannot be counted by name. `src/services/funnel` is a demo module fixed to Coach brands (D `funnel/contract.ts:16`). | Per-arm `visitorOutcomes`, named outcomes. | Named outcomes the tenant declares, plus per-arm measures built in the hourly fold: time from first decision to booking, visitors who decided and did not book within the window, repeat dismissal per visitor and item, and completion beside the upgrade credit. They can scale only once #2 above is fixed. | 5–8 days, after #2 |

## 4. Commands and logs

- Copies: `git -C /home/simonecoelho/rem/integration archive <sha> src package.json tsconfig.json vitest.config.ts | tar -x -C scratch/<copy>`, for `4d882915` and `ed7d6bbe`. `node_modules` are symlinks (D → `oa-verify/node_modules`, I → `rem/_deps/node_modules`; vitest 1.6.1 in both). `package.json` differs between the trees only in the lint script.
- Probe: `src/units/S47/probe.unit.test.ts` in each copy. It is the W24-B2 harness (`src/units/W24/B2.unit.test.ts:60-479`, byte-identical at both trees) followed by `scratch/probe-body.ts`. Only the controls are asserted.
- Run, serial, one at a time: `env -C <copy> node node_modules/vitest/vitest.mjs run --root <copy> --no-cache --no-file-parallelism --maxWorkers=1 --minWorkers=1 src/units/S47/probe.unit.test.ts -t "<filter>"`.
- Logs in `S47/engine/logs/`:
  - `vitest-oa-e18-e19.log` (3 passed) and `vitest-int-e18-e19.log` (3 passed);
  - `vitest-oa-e20.log` (exit 1: my control expected hour 13 to fold; its refusal became finding E20 above, and the assertion was removed);
  - `vitest-oa-e20-control.log` (1 passed) and `vitest-int-e20.log` (2 passed);
  - `vitest-oa-4d882915-e18-offline.log` and `vitest-int-ed7d6bbe-e18-offline.log` (1 passed each);
  - `probe-oa-4d882915.jsonl` (12 lines) and `probe-int-ed7d6bbe.jsonl` (11 lines), with every observation quoted above.

## 5. What could not be established

- **UNVERIFIED: the rig's own figures.** 560 travellers, about 18 minutes, 17,166,176 B, and "about half of each minute without lift" all come from the local rig, and the method excludes a rig run. The mechanisms were reproduced instead.
- **UNVERIFIED: the budget the rig's 413 named.** The script prints it (D `scripts/rehearse-oa-page.mjs:625`), but the doc does not quote it.
- **UNVERIFIED: per-traveller row volume** in real airline traffic.
- **UNVERIFIED: the store propagation figure** that P62 sized its window by.
- **Estimates only: every size in days.**

## OUT OF SCOPE, NOTICED

1. The control checkout showed uncommitted edits to `src/content/service.ts` and `src/learn/fan.ts` at session start (from the session's git status, not read). The doc's line numbers match committed `4d882915` regardless.
2. I's HANDOFF-2026-09-20 records that the owner said the W24–W29 owner rows are "already decided", but those decisions are not in the repository. W24.P1.01 (money) and W25.P1.01 (money priors) bear on #1 and #7.
3. Kit gap #10 in §3 of the doc (priors only on count slots) shares its root with Feature 11, the money-prior refusal.
4. On a hosted D worker, the lift witness's 50 ms budget is a second cause of missing lift that the doc does not name. It is fixed in I.
