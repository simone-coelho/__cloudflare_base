# S5b · Independent verification of doc 34 §5 traceability
## "Requirement and scope traceability: D1 to D13 and the customer paper sections 3, 5 and 6"

**Audited artifact:** `docs/architecture/34-independent-adversarial-audit.md`, lines 503–591
**Source documents:** `docs/architecture/26-btie-requirements-gap-review.md` (D1–D13);
`docs/architecture/tapestry_requirements.txt` §3 (lines 111–175), §5 (196–341), §6 (342–403);
brief `docs/architecture/33-adversarial-audit-brief.md`
**Repository HEAD at verification:** `c10ccff7303d06492e4acdf932fc70273d7159ac` — the *same commit the audit names*.
Line drift is therefore nil; all 35 line citations I spot-checked resolve to the cited construct (table at §6 below).
**Scratch harnesses:** `/tmp/audit-verify/S5b/p1.ts` … `p6.ts`, run with `npx tsx` from the repository root.
**Overall verdict: accurate.** Every disposition in the section holds at HEAD. Six factual claims I could
reproduce reproduced *to the digit*. I found no row that is wrong. I found four places where the section
understates what the code does, and three where it is less precise than the evidence allows.

---

## 1 · What I reproduced locally

Six of the section's underlying probes were re-run from scratch against the actual modules. All six
reproduce, three of them to the exact figure the audit reports.

| # | Claim | Method | Outcome |
|---|---|---|---|
| R1 | D5/F27: the customer's own A.3.6 stage words fail validation | `validateContentCatalog` with `journeyStageFit: ['explore','consider']` | **Rejected.** `stageWordOf('explore') === null`; error: *"non-empty array of exploring \| considering \| deciding (early \| mid \| late also accepted)"*. `docs/PS-Implementation-Delivery-Guide.md:113` says *"Their words are accepted as written"*; `tapestry_requirements.txt:563` writes them as `[explore, consider] or [decide]` |
| R2 | D5/F27: import drops merchandising | `normalizePiece` with `merchandising: {margin:0.8, promotion:0.5}` | Output has **no `merchandising` key**; the same object through `validateContentCatalog` directly **keeps** it. A feed refresh silently removes every business boost |
| R3 | D1/F26: the console's shipped stage form is invalid | `validateSlotCatalog` with the console's own default `{outOfStage:0.5, inStage:1.2}` (`public/console/views-config.js:340`) | **`ok:false` — "stage.inStage: outOfStage \| inStage, number 0..1"**. `inStage:0.2` passes. Confirmed `decide.ts:137` does `base += rule.inStage ?? 0` while the form labels it *"A multiplier on its score. Above 1 favours it"* with `min:1, max:3` |
| R4 | D11/F28: a later pin duplicates an earlier ranked selection | `decideContent` on a two-slot page, hero ranks `campaign`, story pins `campaign` | **`hero=campaign(affinity) story=campaign(tenant-pinned)` — 1 unique id across 2 decisions.** Also confirmed the pin branch bypasses `slotTypes` matching entirely |
| R5 | Principle 3/F18: decayed counters depend on delivery order | two exposures one `tauLearnMs` (21 d) apart, chronological vs reversed, evaluated at the same instant | **1.368 vs 0.736** — the audit's exact figures. `slotRates` rounded to 3 dp before feeding child shrinkage |
| R6 | Contextual-bandit row/F23: Thompson ignores the share gate | 100 synthetic visitors, `cfg.share = 0` | **Thompson returned picks and changed the leader for 8–36 of 100** depending on evidence density; `epsilon` and `rotation` returned 0/100 (correctly gated). Every pick carried a whole `ranking`, not a first-position alternate. The audit's specific "50 for 100" is setup-dependent; the structural claim is exact |
| R7 | D8/§5 embeddings: replay of a coupled page | serve hero+rail with hero's snapshot, replay rail with only rail's | **served `hero=B rail=A`; replay produced `hero=A rail=B`** — the audit's exact example |
| R8 | D3/F19: objective change mixes units | unit-valued purchase then revenue-valued 400 into the same counters | **`s = 401`, `objective:"revenue"`, `p_hat = 200.5`** — the audit's exact figure |
| R9 | D4/F25: 92-day truncation | `datesBetween('2026-01-01','2026-06-30')`, then `windowReport` | **92 days, last = 2026-04-02; report label `to: "2026-06-30"`.** *And*: 2026-04-03…06-30 appear in **neither** `days` **nor** `missing` |
| R10 | D4/F07: successes exceed trials | `compareArms({n:1,s:0},{n:1,s:3})` | `wilson(3,1)` clamps to `p:1` — a rate of 300% is reported as 100% |
| R11 | Cold-start priors/F20 | `indexPriors` for item `a`, cell `c=direct\|v=1` | Indexed as item **`a|c=direct`** at level key `v=1`; `snapshot.items['a']` is **null** |
| R12 | Health baseline | `npx vitest run src/content src/learn src/measure` | **24 files, 158 tests, all pass** — every defect above coexists with a green suite |

---

## 2 · D1–D13, row by row

### D1 · Journey-native content — audit: "Partial: stage metadata/context/term exist; customer aliases, classifier semantics, post-purchase behavior, and operator form fail or remain incomplete" · **HOLDS**

*Built, verified:* `Cell.stage` (`src/content/types.ts:197`) is the 4th rung of the pooling ladder
(`levelKeys`, `src/learn/stats.ts:33`; `LEVEL_WORDS[3] = 'channel, visit bucket and journey stage'`);
`journeyStageFit` on the piece (`kinds.ts:85`); a per-slot `StageRule` applied at `decide.ts:132–139`,
itemised as a `stage` driver and a receipt sentence. Correctly off on the `default` arm and off when the
stage is `unknown` (probe B2: both scores 0 on the default arm).

*Fails, verified:*
- **Customer aliases** — R1. `explore`/`consider`/`decide` rejected; no import translation
  (`import.ts:78` `normalizeList` passes the raw strings straight through).
- **Classifier semantics** — `MID_VIEWS = 2` (`JourneyStage.ts:42`): two PDP views ⇒ `mid` (considering).
  The customer's own Click-3 worked example is a shopper on her *second* crossbody who is *exploring*
  "with 89% confidence" (`tapestry_requirements.txt:124`). The engine would label her considering.
- **Post-purchase** — `purchases > 0 ⇒ 'late'` (`JourneyStage.ts:70`); there is no fourth state and no
  demotion after an order.
- **Confidence** — the customer's §3 quotes 89%/78%/94% confidences. `stageFromCounters` returns a bare
  label. No calibrated probability exists anywhere in `src/`.
- **Operator form** — R3.

### D2 · Freshness / fatigue — audit: "Terms exist. Served-versus-seen semantics and finite ring history/replay prevent the full promise" · **HOLDS**

*Built, verified:* both terms in `decide.ts:109–158`, itemised (probe C: `new` = 1 + 0.4 freshness − 0.3
fatigue = 1.1; `old` = 1.0), captured on `DecisionInputs.served` (`decide.ts:242`) so replay reproduces them.

*Limits, verified:*
- **Served ≠ seen.** `servedCounts` (`src/learn/fan.ts:50–60`) counts *decision records*. The SDK's
  `emit.rendered` records a rendered impression separately (`sdk/listen.ts`); nothing reconciles them.
  A below-the-fold rail decision fatigues a piece the shopper never saw.
- **Fatigue is page-wide, not slot-specific** — `servedCounts` iterates the whole ring
  (`for (const e of ring)`), never filtering `e.slot === s.slot`, yet keys the result by slot. The console
  copy ("her own ring of recent decisions") does not say which. The audit's F21 asks for exactly this to be
  documented; it is currently page-wide.
- **Finite ring** — `RING_MAX = 200`, `RING_MAX_AGE_MS = 7 d` (`DecisionRing.ts:14–15`). At a 20–30-item
  page that is 7–10 pages, not seven days.
- **Replay** — R7.

### D3 · Profit / value — audit: "Value-weighted rewards exist; configuration can mix units, and revenue/margin alone is not an agreed profit objective" · **HOLDS**

*Built, verified:* `creditWeight(objective, outcome)` (`policy.ts:63`); per-slot `objective: unit|revenue|margin`
validated at `kinds.ts:323–326`, which correctly *rejects* a value objective on a reward that carries no
value ("needs a reward that carries a value (purchase or add_to_bag)"); threaded through
`report.ts:116`, `hourly.ts:273`, `stats.ts:111`, and named on the receipt (`receipts.ts:65`).

*Defect, verified:* R8. `LearnStats.load` does `existing.config = cfg` (`LearnStats.ts:97`) while retaining
`stats` — the counters carry no objective generation. **Revenue is not profit**: nothing in `src/` reads a
cost, margin feed, refund or currency (`grep -rn "rpv\|returnRate\|margin feed"` → the only `margin` is a
merchandising multiplier 0..1 and an outcome field the customer would have to populate).

### D4 · Confidence / targets / windows — audit: "Reopen: controls/interval routines do not repair the wrong experimental unit/control or incomplete time coverage" · **HOLDS**

*Built, verified (doc 26 marks these ✅ 2026-09-05, correctly):* `confidence` at 0.90/0.95/0.99
(`holdout.ts:110`, route `decisions.ts:575`); `TAPESTRY_TARGETS = {minimum:0.10, target:0.40, stretch:0.60}` —
the customer's §6.4.2 CVR row exactly — read on the interval's low end (`readTargets`); the verdict at the
other everyday level always beside it (`alsoAt`); `GET /:tenant/learn/report/window?from=&to=` pooling day
reports and naming missing days.

*Unrepaired, verified:* R9 (92-day cap with the requested end date retained, and the truncated tail listed
nowhere); R10 (successes clamped to trials); `neededPerArm` hard-codes `Z95`/`Z80_POWER` and equal arms —
identical output at 90% and 99% (probe C: 3,826 in all three cases) and blind to the 5% allocation;
`readTargets` divides an absolute Newcombe interval by a *point* control rate (`holdout.ts:190`);
`armFor(r.visitorId, …)` (`service.ts:168`) rehashes the *current* id so sign-in/logout re-randomizes;
`armUnder(consent, arm)` puts consent-refusing traffic in the **same `default` arm field** as the
randomized control; the denominator is content-item decisions, not visitors (`report.ts:129`).

### D5 · Schema alignment — audit: "Partial: import drops merchandising, stage aliases fail, featured products link to attribution rather than inherit their attributes" · **HOLDS, all three**

R2, R1, and probe D: `featuredProductIds` reaches `DecisionRecord.featured_product_ids` (`decide.ts:265`)
and the ring (`fan.ts:63`), where `policy.ts:82` uses it to credit a story for a purchase of a featured bag.
A piece with `featuredProductIds:['SKU1']` and no tags scores **0 with 0 drivers** — no product attribute
is inherited. Doc 26's D5 asked for "content inherits product affinity **and** links to the product
decision"; only the second half shipped. `PS-Implementation-Delivery-Guide.md:115` is honest about this
("Carried on the piece and the receipt… Links content to product decisions") — the mismatch is with doc 26,
not with the guide. Also verified: tag validation (`kinds.ts:43–47`) checks shape only — a misspelled
dimension `styleWrld` and triplicated values `['minimal','minimal','minimal']` both validate.

### D6 · Scroll / hover — audit: "Not in shipped generic capture" · **HOLDS**

`grep -rn "scroll\|hover" src/sdk/*.ts` returns exactly one hit, in a test
(`emit.test.ts:39`), where a `scroll_depth` dataLayer push is asserted to be **ignored** (4 pushes, 3 posts).
Automatic capture is impression (`IntersectionObserver`, `host.ts:15`), dwell (`pagehide`/`visibilitychange`,
`host.ts:56–57`) and click (`emit.ts:109`). No scroll or hover listener exists.

### D7 · Anonymous cross-device — audit: "Deliberately absent… a defensible privacy boundary requiring acknowledged scope substitution" · **HOLDS**

`grep -rn "fingerprint" src/` returns two hits, both comments stating the *absence*
(`sdk/identity.ts:2` "First-party identity, no fingerprinting"; `demos/meridian/coldstart.ts:15`). The
customer asks for it twice — §5.2.1 "Device fingerprint + behavior pattern matching" (line 224) and
A.1 #2. The audit's framing ("acknowledged scope substitution", not a gap) is the right one.

### D8 · Embeddings / lookalikes / vector store — audit: "sensible alternatives, not learned semantic embeddings or nearest-neighbor lookalikes… obtain approval of the substitution and a valid comparative quality experiment" · **HOLDS**

No embedding, no cosine, no kNN, no `Vectorize` binding anywhere (`grep -rn "cosine\|nearest\|knn\|Vectorize\|embedding" src/` → one unrelated comment). The alternatives are real and located:
the readable vector (`reflex/core.ts`), pooled priors (`learn/priors.ts`), the six-level ladder
(`stats.ts:33`), the external hook (`learn/external.ts`, kinds `table`/`service`/`workers_ai`).
The audit's "no automatic need for a vector database" is a fair judgment. Two of its qualifiers are
independently confirmed: the paper *does* name Phase-1 mechanisms literally (line 295 "User & Content
Embeddings", line 296 Vector Database "<75ms similarity") and *does* require offline evaluation
(line 285 "offline evaluation vs segment rules"); and F20 (R11) shows the substituted cold-start mechanism
is itself defective at the context depth it exists to serve.

### D9 · RTBF — audit: "Reopen: host/cache/discovery/retry/tombstone gaps" · **HOLDS**

Verified at HEAD: `eraseProfile` (`identity/erase.ts:48`) branches on `env.REFLEX_HOST` and touches **only
the current host**; identity links are removed at step 1 (`erase.ts:84`) *before* profile and ledger
deletion at step 2/3 (`:96–102`), so a failure after the link is gone strands data with no discovery path;
the rewrite's object cap is checked in the **outer day loop** (`erasure.ts:175`) while `objects_opened++`
happens in the inner object loop; a completed rewrite **retires and deletes** the tombstone
(`erasure.ts:208–214`), so redelivery of an old decision is no longer filtered.
**Addition:** `DEFAULT_RETENTION_DAYS = 90` (`erasure.ts:56`) is consumed by *exactly one* caller —
`rewriteErasures`'s search window (`index.ts:231`). There is **no job anywhere that deletes ledger objects
past retention.** "Ninety days" is a search bound, not a retention lifecycle. This is stronger than F06 states.

### D10 · Consent — audit: "Reopen: route/host/connector enforcement is inconsistent" · **HOLDS**

`src/content/consent.ts` is a clean two-switch model and `serveContentDecisions` honours it well
(`armUnder`, `write: consent.tracking`, `fanDecisions` gated). The inconsistencies are real and verified:
`POST /sort` reads the shopper's affinity dims (`sort.ts:74–78`) with **no consent check of any kind**;
the object-host branch of `readShopper` (`service.ts:101–108`) ignores the `cookieHeader` it was handed;
**both** catch branches return `CONSENTING` on read failure (`service.ts:107`, `:120`) — consent fails *open*.

### D11 · Diversity / inventory — audit: "Partial: supplied stock flag exclusion works; live inventory feed unverified, diversity soft, later pins violate uniqueness" · **HOLDS, all four**

`isEligibleAt` = `isLiveAt(p, now) && p.inStock !== false` (`lifecycle.ts:32`) — exclusion works on a
*supplied* flag; `stockOf` (`import.ts:33`) accepts eleven spellings but nothing polls a stock service.
Diversity yields then back-fills, marked `relaxed: true` (`contentCompose.ts:200–203`) — a soft preference,
correctly described. Pins: R4.

### D12 · Latency — audit: "Open: fresh median already exceeds interim budget; neither customer P99 nor third-interaction-to-paint has passed" · **HOLDS, with a correction of emphasis**

Doc 32 §5: after CW37 the fresh-shopper snapshot is **235 ms inside the worker at P50** against the stated
interim target of "a decision under 200 ms at P95 on the server" (doc 32 §3). The median already exceeds a
P95 budget. The customer's own numbers are further away: §5.1 asks sub-10 ms signal capture — `POST /realtime/action`
is 1,731 ms P50 fresh, 641 ms warm; §5.3.3 Phase 2 asks <100 ms P99 — the warm snapshot P99 is 365.1 ms.
Third-interaction-to-paint cannot have passed because no server sends a `content_decisions` frame (see §3).
*See correction C2: D12's actual deliverable — measure and publish P50/P99 — was met.*

### D13 · Later DRL / NLG / multi-objective / foundation model / unified platform — audit: "A legitimate staged roadmap boundary, not a January build mandate… Do not use D13 to defer present §1.9 product entitlement or other signature capabilities" · **HOLDS**

The paper's own staging supports it (line 302 Phase 2 "6-12 months", line 320 Phase 3 "12+ months",
line 329 "Phase 3 is not automatic"). The audit's guard is well placed: nothing named in D13 is on the
January path, and D13's cited adjacencies (Opal `/ai/scene`, the ledger, `learn/external.ts`) are seams,
not deliveries.

---

## 3 · Customer §3 — the rows I could check in code

| Row | Verdict | Evidence at HEAD |
|---|---|---|
| §3 pre-click context / collective intelligence | **Holds** | `ShopperRead` (`service.ts:77–86`) carries affinity, sessionId, isNewSession, state, stage, consent — **no visit number, no entry channel**. `SessionManager` persists both (`visitCount` `:214`, `entryChannel` `:218`) and `RealtimeSegmentEngine:702` exposes `entry_channel` — neither reaches the content contract. The cell gets `channel: r.channel` (a caller hint) and `visitNumber: isNewSession ? 1 : null` (`service.ts:159–163`), so a returning visitor's bucket is `'unknown'`. The 73%/62%/2.3× figures are marked "*Assumed Numbers" in the paper itself (line 130) |
| §3 click 1 / sparse signal response | **Holds** | One weighted tagged event does move the vector (`reflex/core.ts` weights, `content_click: 1`). "Does not learn arbitrary multi-event patterns merely by summing tags" is correct: scoring is `Σ a(dim,value) × w(dim)` (`contentCompose.ts:140–145`) — no interaction terms |
| §3 click 2 / aesthetic across categories | **Holds** | Shared registry dimensions do transfer taste; no embedding retrieval exists (D8) |
| §3 click 3 / intent and continuing journey | **Holds** | Two defects, both verified: no production sender of `content_decisions` exists (only `personalization_update` from `ShopperReflex.ts:750` and `RealtimeSegmentEngine.ts:582`), so the documented SDK loop cannot repaint; and `MID_VIEWS = 2` contradicts the paper's own exploring example |
| §3.1 individualized components vs segment rules | **Holds** | Headless scoring is real and generic. No generic module/section ordering exists in `src/` (`grep -rn "sectionOrder\|moduleOrder"` → nothing); it lives in `src/demos/meridian/` and `public/meridian/engine.bundle.js` |
| §3.2 time to relevance | **Holds** | Same `content_decisions` gap |
| §3.2 journey awareness | **Holds** | D1 |
| §3.2 style understanding | **Holds** | Correct given taxonomy; R1/R2 are the taxonomy prerequisites |
| §3.2 content matching | **Holds** | Individual candidate scoring exists; F32's catalog-scale envelope is the qualifier |
| §3.2 product discovery / price comfort | **Holds** | `/sort` is a candidate-preserving reranker capped at 500 (`sort.ts:33`), with a documented parity proof at `affinity: 0`. "Price comfort" is only the derived `priceBand` dimension (`core.ts:170`, cuts 150/400). **Session continuity fails outright**: `sessionId` is in the body schema (`sort.ts:37`) and never destructured or used (`:66`) |
| §3.2 return memory | **Holds, and understates** | Every decay horizon configured in the repo is demo-scale: `tauMs: 60_000` default (`core.ts:202`, comment "Demo cadence"), `priceBand` 150 s, Brighthour 90 s. There is no days/weeks configuration anywhere to calibrate *from* |
| §3.2 cross-channel awareness | **Holds** | `classifyEntryChannel` yields six coarse buckets (`SessionManager.ts:123`) — no creative id, no search keyword, no influencer; and it does not reach the decision (row 1) |
| §3.2 cross-device without login | **Holds** | D7 |
| §3.3 profit initially | **Holds** | D3 |
| §3.3 later margin/returns/LTV/brand equity | **Holds** | Scalar `creditWeight`; no Pareto/scalarization, no LTV model, no return-risk model |
| §3.4 business results | **Holds** | The paper's own table is headed "Expected Impact"; nothing in `src/` computes CVR, LTV, acquisition, AOV, bounce or email CTR |

---

## 4 · Customer §5 — the rows I could check in code

| Row | Verdict | Evidence at HEAD |
|---|---|---|
| §5.1 sub-10 ms / sparse / millions concurrent | **Holds** | Doc 32: `decide` rounds to 0 ms; the *request* does not (D12) |
| Principle 1 · one visitor one profile | **Holds** | Deterministic linkage in `src/identity/`; no anonymous graph |
| Principle 2 · learn immediately | **Holds** | The reflex updates in-request, but the snapshot the *decision* reads publishes on a 30 s coalesced alarm (`LearnStats.ts:16` `PUBLISH_DELAY_MS = 30_000`), the region trend hourly (`index.ts` `0 * * * *`), autonomy daily (`0 3 * * *`). "Population snapshots publish on a separate cadence" is exactly right |
| Principle 3 · recency weighting | **Holds** | Implemented (`s·e^(−Δt/τ)`); horizons demo-scale; R5 order-dependence and 3-dp rounding confirmed |
| Principle 4 · multimodal / calibrated | **Holds** | `content_impression: 0`, `content_dwell: 0.5`, `content_click: 1`, `video_complete: 2` (`core.ts:190–197`); scroll/hover absent (D6); "customer signal weights unvalidated" — every weight in the repo is a demo default |
| Principle 5 · similar-user cold start | **Holds** | Region/channel priors and the pooling ladder, not nearest-neighbour. R11 shows the contextual prior path is broken at the depth it exists for |
| Principle 6 · explore/exploit | **Holds** | Three modes exist; R6 confirms "do not promise every session explores if using a fractional share" is not just advice — in Thompson mode the share is not applied at all |
| Principle 7 · graceful degradation | **Holds** | Every failure resolves to a default; a slot with no eligible candidate emits **no decision**, and the kit's contract is that the customer's default renders. That is the right design *and* the audit's point: the customer must accept the handoff |
| Principle 8 · governance / privacy | **Holds** | Pins, clamped multipliers, lifecycle, `inStock`, consent, erasure exist. F05/F06/F28 verified above. "Brand equity / no-clickbait / discount policies need approved content/rule governance, not just a stock flag" is correct: `kinds.ts:140` has no off-limits or exclusion vocabulary |
| Principle 9 · embedding-first | **Holds** | D8 |
| §5.2.1 recognized vs anonymous | **Holds** | D7 + F04 |
| §5.3 three recommendation types | **Holds** | `/sort` (product), `/v1/:tenant/decisions/snapshot` (content), nothing generic for experience |
| §5.3.1 event streaming / impressions | **Holds** | Ingestion real; viewport exposure ≠ server exposure (D2); SDK delivery gap (§3 click 3) |
| Unified profile / feature serving | **Holds** | Two hosts, KV authority (`wrangler.toml:231`,`:330` both `session`); F31's registry split confirmed — `sort.ts:70,:90` resolve a *demo* surface, content resolves the *tenant* registry (`service.ts:140`) |
| User/content embeddings / vector DB | **Holds** | D8 |
| Journey classifier / content ranking | **Holds** | Rule-based and explainable; no calibrated classification; no historical-data lift proof |
| Experience orchestration | **Holds** | No generic implementation in `src/` |
| Contextual bandit | **Holds** | Cells exist; `explore.ts:92` reads only root `*` counters; 48–72 h is a customer sentence (line 297), and `nMin: 30` is a count threshold, not a time guarantee |
| DRL / NLG / multiple objectives | **Holds** | D13 |
| Causal measurement / policy layer | **Holds** | D4/D10/D11 |
| §5.3.2 reference frameworks | **Holds** | The paper says it itself: "either can get us where we need to go" (line 278) |
| §5.3.3 Phase 1 plan rows | **Holds** | Documents and component tests exist (R12); the exit criteria are external |
| Phase 1 historical ranking POC vs segment rules | **Holds** | No offline evaluation on historical data exists; the holdout compares against catalog order, not the customer's ~8–10 segment buckets (paper line 103) |
| Phase 1 content readiness | **Holds** | 40+ photos/page, 15 PDP variations, 20+ See/Think pieces (lines 180–182) vs doc 19's 20–30 first-page assets — the audit is right to say record which applies when |
| Phase 1 five MVP capabilities | **Holds** | Matches doc 26's own honest "3 built, 1 built differently, 1 by design" |
| Phase 2 / Phase 3 | **Holds** | Roadmap boundaries |

---

## 5 · Customer §6 — the rows I could check in code

| Row | Verdict | Evidence at HEAD |
|---|---|---|
| §6.1 adaptive / non-stationary | **Holds** | This is the section's best independent contribution: it *disagrees* with the customer's framing on the merits ("Adaptation does not invalidate all ordinary randomized experiments; naive point-in-time attribution is the actual concern") while conceding the practical remedy. Correct, and consistent with F07's remedy |
| §6.2 Predict | **Holds** | Nothing in `src/` computes a predicted impact or business case; `neededPerArm` is the only forward-looking number and it is a sample size |
| §6.2 Optimize | **Holds** | `autonomy.ts:84` gates on total slot exposures; `:87–90` fires only on `spread > 0` and only ever *increases*; `applyProposal` clamps min/max only — no age, expected revision, pin/mode or step-from-current check |
| §6.2 Learn | **Holds** | R10 and the visitor/decision unit mismatch |
| §6.3 methodology / ≥90% significance | **Holds** | The selector exists and is correctly scoped to 90/95/99; `neededPerArm` ignores it entirely (probe C) |
| §6.4.1 5–10% permanent, persistent ID, 6+ months | **Holds** | `holdout.share: 0.05` default (`kinds.ts:378`); `salt: learn.holdout.salt \|\| brand`; `mix32` finalizer correctly added after a documented block-sampling bug. But the hash input is the *current* visitor id, consent traffic shares the arm label, and the 92-day cap plus 90-day retention cannot reach six months |
| §6.4.1 existing production experience | **Holds** | The `default` arm serves `NO_SIGNAL` (`decide.ts:69`) with pins still applied (`decide.ts:67–68`, deliberate and documented) — i.e. catalog order under eligibility, not the customer's segment rules |
| §6.4.2 CVR/RPV/returns thresholds | **Holds, and understates** | Only the CVR triple is implemented (`TAPESTRY_TARGETS`), and it is applied to a **per-slot content-reward rate**, not visitor conversion. `grep -rn "rpv\|revenuePerVisitor\|returnRate\|return_rate" src/` returns **nothing** |
| §6.4.3 monthly / quarterly / biannual, YoY and MoM | **Holds** | R9. Also: no YoY or MoM comparison exists — the route takes one `from`/`to` pair with no comparison period |
| §6.5 IABI | **Holds** | `compareArms` writes an insight and an action-shaped sentence. `grep -rn "business impact\|businessImpact\|incremental revenue" src/` returns **nothing** — the third leg is absent, exactly as the row says |

---

## 6 · Line-citation drift check

HEAD is the audited commit, so no drift was expected and none was found. Thirty-five citations resolved to
the cited construct. Two are off by one line in a way that changes nothing: `reflex/core.ts:201` is the
comment above `tauMs: 60_000` on `:202`; `ledger/erasure.ts:175` is the `for (const day of days)` whose next
line is the cap check. `content/service.ts:158` is `cellFor({`, whose arguments on `:159–163` are the cited
behavior.

---

## 7 · Corrections

**C1 — the section names no code-level *strengths* in D1–D5, which weakens its own credibility.**
Every "Partial" row lists only what fails. The section should record that D1's stage rule correctly
suppresses itself on the `default` arm and on `stage: 'unknown'` (never guessing — probe B2), that D3's
validator correctly *rejects* a value objective on a valueless reward (`kinds.ts:325`), that D11's
`stockOf` accepts eleven feed spellings, and that `/sort`'s `affinity: 0` parity proof is a real
customer-facing commitment kept in code. An adversarial audit that concedes nothing is easier to dismiss.

**C2 — D12's row conflates the delta with the target.** Doc 26's D12 asks for one thing: *"Measure on
staging the week it exists; publish P50/P99 for action, snapshot, sort. Until then, quote no number."*
That was delivered — `scripts/latency.mjs`, doc 32, three routes, two populations, P50/P95/P99, nearest-rank,
no interpolation. Reading "Open" as "the delta was not built" is wrong. The row should read: *measurement
delivered and honest; the budgets it revealed are unmet.*

**C3 — "later pins violate uniqueness" (D11) is narrower than the defect.** The pin branch
(`contentCompose.ts:127`) also **bypasses `slotTypes` matching entirely** — probe A2 pinned a `rail`-only
piece into `hero` and it served. F28 says pins "bypass normal slot-type matching" but the D11 row does not
carry that forward, and it is the more consequential half: a merchandiser can place a piece in a placement
its own metadata forbids.

---

## 8 · Additions — what the section should have said and did not

**A1 — the 92-day truncation is worse than "silently truncate."** R9: days 93+ appear in **neither**
`days` **nor** `missing`. A reader of the window report for Jan 1–Jun 30 sees `to: "2026-06-30"`, 92 days
pooled or listed missing, and **no signal at all** that 89 days were never looked at. The `missing` array
is precisely the field a reader would trust to tell them; it lies by omission. `src/measure/window.test.ts:21`
asserts the cap holds and never asserts the label.

**A2 — "ninety days" is not a retention policy; it is a search bound.** `DEFAULT_RETENTION_DAYS = 90`
(`erasure.ts:56`) has exactly one consumer: how far back `rewriteErasures` looks for a tombstoned visitor's
rows (`index.ts:231`). **No job deletes ledger objects.** F06 gestures at this ("Ninety days in a constant is
not evidence…"); the D9 row should state it plainly, because it also decides §6.4.1's six-month question in
the opposite direction from the audit's assumption — raw events are not *aged out* at 90 days, they are
retained indefinitely and merely unsearchable for erasure past that window.

**A3 — fatigue is page-wide, and the section should say which.** `servedCounts` never filters by slot.
F21's remedy asks the team to "document whether fatigue is page-wide or slot-specific"; the answer is
already determinate in the code and belongs in the D2 row, because it changes what a merchandiser's
`windowHours`/`cap` dials mean.

**A4 — the whole defect set coexists with a green suite.** R12: 24 files, 158 tests, all passing in
`src/content`, `src/learn`, `src/measure` at HEAD, while R1–R11 all reproduce. Two tests actively skirt the
defects: `src/content/stage.test.ts:23` uses a *valid* `inStage: 0.1`, never the console's shipped `1.2`;
`src/measure/window.test.ts:21` asserts the cap length and never the report's label. F26 makes this point
for the console form alone; it generalizes, and it is the single most useful thing to tell the delivery team
about how these defects survived.

**A5 — only one of the customer's three §6.4.2 target families exists.** `TAPESTRY_TARGETS` implements the
CVR row. RPV (+10/+25/+40) and Return Rate Delta (<+5% / no change / −5%) have **no representation in the
codebase at all** — not a metric, not a field, not a feed. The §6.4.2 row says "Create distinct approved
metric definitions"; it should say two of the three metric families do not exist yet.

**A6 — the D8 substitution has a live defect, not merely an unproven equivalence.** The section argues D8
on approval and evaluation grounds. R11 shows the substituted cold-start mechanism — imported contextual
priors — is *broken at every ladder depth below the root*, because `stats.ts:142` splits `item|cell` at the
last `|` while cell keys contain `|`. A "readable vector plus pooled priors" alternative cannot be evaluated
against embeddings until it works. This strengthens D8's "do not close on 'same outcome' without evidence"
from a governance point into an engineering blocker.
