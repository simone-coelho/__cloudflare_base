# Independent sweep — learning and statistics

**Lens:** the statistics ladder, attribution, holdout and measurement, exploration, autonomy, priors,
replay, the hourly fold and reports, numerical behaviour, reproducibility from the ledger.

**Checkout audited:** `feature/real-time-personalization` at `c10ccff7303d06492e4acdf932fc70273d7159ac`
— the same commit `docs/architecture/34-independent-adversarial-audit.md` names. The working tree
carried only `public/meridian/engine.bundle.js`, two deleted cache sidecars and two untracked
documents; no `src/` file was uncommitted, so everything below is against the audited source.

**Out of scope by instruction:** anything named in `33-adversarial-audit-brief.md` or in findings
F01–F35 of doc 34. Every finding below carries a sentence saying why it is not one of those.

**Method.** Source reading of `src/learn/`, `src/measure/`, `src/ledger/`, `src/content/`,
`src/durable-objects/`, `src/reflex/contentCompose.ts`, `src/index.ts` `scheduled`, `wrangler.toml`
and `src/routes/decisions.ts`, plus seven executable probes against the repository's own compiled
modules. The probes live in `/tmp/audit-verify/sweep-learning-and-statistics/` and were run with

```
npx vitest run --root <repo> --dir /tmp/audit-verify/sweep-learning-and-statistics
```

They are counterexamples produced by the actual functions with synthetic inputs; they are not
estimates of real-world incidence, and no network host, staging stamp or deploy was touched.

| Probe | File | What it exercises |
|---|---|---|
| p1 | `p1-zero-base.test.ts` | `decideContent` with a learned lift and a shopper with no signal |
| p2 | `p2-prior-level.test.ts` | `liftFor` + `receiptOf` with an imported root prior |
| p2b | `p2b-prior-inert.test.ts` | the lift's denominator at a cold slot |
| p3 | `p3-selfref.test.ts` | measured lift as a function of the item's serving share |
| p4 | `p4-report-cost.test.ts` | `buildReport` wall time against record count |
| p5 | `p5-two-paths.test.ts` | `buildReport` vs `buildHour` + `reportFromHours` on one day |
| p6 | `p6-overwrite.test.ts` | `runDayReport` with custom policies, and `windowReport` after it |
| p7 | `p7-clean.test.ts` | the eight things I checked and found sound |

---

## Findings, most consequential first

### L1 · A reporting overlay silently overwrites the canonical day report, and the incrementality series with it

**Severity: blocks launch. Size: S.**

**Evidence.** `POST /v1/:tenant/learn/report` accepts a `policies` array
(`src/routes/decisions.ts:539-548`) and calls `runDayReport(..., policies, ...)` at `:556`.
`src/learn/hourly.ts:486` takes the hour-aggregate branch **only** when `reporting === null`; with
custom policies it falls through to `runReport`, and `src/learn/report.ts:221` writes the result to
`reportKey(tenant, brand, date)` — the same R2 object the five-minute fold writes at
`hourly.ts:491`, and the only thing `src/measure/window.ts:62` reads.

Probe p6, one day with 340 decisions and one heavy visitor:

```
canonical source: aggregates  holdout: [{"arm":"default","decisions":40,"credited":2,"rate":0.05},
                                        {"arm":"personalized","decisions":300,"credited":8,"rate":0.027}]
after the overlay: ledger     holdout: [{"arm":"default","decisions":40,"credited":2,"rate":0.05},
                                        {"arm":"personalized","decisions":300,"credited":9,"rate":0.03}]
window verdict before: ... −2.3 points (−47% relative) ... needs about 1,062 decisions on each arm ...
window verdict after:  ... −2.0 points (−40% relative) ... needs about 1,506 decisions on each arm ...
```

The stored `hours` block also degrades from `{source:'aggregates', built:[…], missing:[…]}` to
`{source:'ledger', built:[], missing:[]}`, so the completeness metadata the window report would need
in order to warn is destroyed at the same time.

**Consequence.** A request documented as "run any number of reporting policies over the same day's
records ... without changing what is served" permanently rewrites the customer's measurement record.
Any operator token can do it; there is no undo and no version history for reports. The scheduled
jobs rebuild only *yesterday* (`src/index.ts:225`) and `catchUp` rebuilds a date only when it folded
a new hour for it (`hourly.ts:454`), so a rewritten report for any older date stays rewritten. Every
`GET /learn/report` and every `GET /learn/report/window` over a range containing that date then reads
the substituted numbers — including the pre-set-target verdict sentence the customer's acceptance is
written against. At a pilot where a data scientist is expected to try attribution overlays, this
fires on the first day of use.

**Remedy.** Persist under `reportKey` only when `reporting === null`; return custom-policy reports in
the response body alone. If overlay results must be stored, key them by a policy-set fingerprint
(`reports/{tenant}/{brand}/{date}/{fingerprint}.json`) and leave the canonical key to the fold. Add a
regression test that a custom-policy POST leaves the stored object byte-identical. Consider making
stored reports immutable-versioned, as configuration documents already are.

**Why this is not in 33 or 34.** F25 is about the 92-day window truncation and the power arithmetic,
F17 about late data and unfolded hours; neither examines who may write `reportKey`, and doc 33 §6
lists no report-integrity item.

---

### L2 · The learned lift is a multiplier on a base score that is zero for a shopper with no matching affinity

**Severity: blocks the pilot. Size: M.**

**Evidence.** A piece's base score is `Σ over its tags of affinity[dim][value] × slotWeight`, starting
at zero and adding only where the shopper's affinity is positive
(`src/reflex/contentCompose.ts:134-142`). The learning layer's last act is
`return base * Math.pow(look.lift, gamma)` (`src/content/decide.ts:170`). `0 × anything^γ = 0`.

Probe p1, one slot, two pieces, full trust (γ = 1), a lift table where `winner` has lift > 1.5 and
`loser` < 0.75:

* warm shopper (`occasion:evening → 0.8`): serves **winner**, `score_base > 0` — learning works;
* cold shopper (`dims: {}`): `score_base = 0`, `score_final = 0`, serves **loser** — catalogue order.
  The record still carries `explain.lift.gamma = 1`, so the receipt reads "applied at trust 1";
* second case: a piece with lift 2.0 but no tag overlap loses to a piece with lift 0.5 and an
  affinity of 0.05, because 0 × 2 < 0.05 × 0.5.

**Consequence.** Learning cannot influence what a shopper sees on her first interaction, nor on any
request where her affinity does not overlap the slot's weighted dimensions — which is the customer's
own three-click scenario at click one, and every returning shopper whose taste has moved. Worse, the
learning layer can only re-rank *within* the taste the deterministic scorer already found; it can
never surface a piece that performs well in a cell but carries tags the shopper has not touched,
which is the discovery the pooling ladder exists to do. The regional blend, freshness and the stage
bonus can lift the base off zero for some slots, so the effect is configuration-dependent rather than
total — which is worse for acceptance, because the same slot behaves differently for two shoppers and
nothing on the receipt says why.

**Remedy.** Give the learned term a base it can act on: either make it additive on a normalised scale
(`score = Σa·w + γ·λ·log lift`), or give each eligible candidate a small slot-level floor before the
multiply so lift orders candidates when affinity is silent, or apply the lift to the candidate set's
rank rather than its score. Whichever is chosen, add a test asserting that with γ = 1 and no affinity
signal the served order follows the lift table, and say in the receipt when the lift was computed but
could not act.

**Why this is not in 33 or 34.** F13 observes that a learning-cell field at γ = 0 is not a seeded
context effect, and F30 concerns the external model hook; no finding observes that the learned term's
own arithmetic annihilates at zero base. Doc 33 §5.1 states the estimator's constants but not how the
result is combined.

---

### L3 · The lift's reference is the slot rate the item is inside, so a winner's measured lift decays toward 1 as it wins

**Severity: blocks the pilot when learned lift is enabled. Size: S–M.**

**Evidence.** `recordExposure` and `recordSuccess` add every event to the item's counter *and* to the
slot's counter at the same key (`src/learn/stats.ts:61-62`, `:71-72`), and the lift is
`p_hat / p0slot` (`:159`), where `p0slot` is that same slot rate. The item is therefore inside its own
denominator, in proportion to its share of the slot.

Probe p3, item A held at a true rate of 0.10 throughout, item B at 0.02, 20,000 exposures:

```
A serves 10% of the slot → measured lift 2.00   (clamped)
A serves 30%             → 2.00
A serves 50%             → 1.665
A serves 70%             → 1.315
A serves 90%             → 1.087
A serves 98%             → 1.020
```

**Consequence.** Three things follow. First, the number a merchandiser reads on the console grid as
"this piece performs 2× the slot" is a function of the serving policy, not of the content; it is not
an effect size and it is not comparable across slots (a two-piece slot and a thirty-piece slot cannot
produce the same lift for the same quality) or across time. Second, because `lift^γ` multiplies the
score, the engine erodes its own boost as it converges: the more it serves the winner, the closer the
winner's applied multiplier gets to 1 and the more the ranking reverts to the base score — a negative
feedback loop with no documented steady state. Third, the autonomy cycle inherits it:
`src/learn/autonomy.ts:62` weights its evidence by `st.lift * st.n` at the root level, so dimensions
carried by heavily-served items look *flat* and dimensions carried by rarely-served items look
*separating*, and the proposal raises the latter. The clamp at `liftMax = 2` hides how far the
distortion goes at the low-share end.

**Remedy.** Use a leave-one-out reference: subtract the item's own decayed `n` and `s` from the slot
totals before forming `p₀`, so the comparison is against the rest of the slot. It is arithmetic the
existing counters already support, it stays recomputable from the ledger, and it makes the number
comparable. Until then, rename it on the console and in doc 22 to what it is — a within-slot share —
and stop feeding the raw value to the autonomy evidence.

**Why this is not in 33 or 34.** Doc 33 §7 asks the question ("Does shrinkage toward the slot's rate
bias toward incumbents?") and doc 34 never answers it; F18 covers arrival order and three-decimal
rounding, F24 covers stale proposals and sparse outliers.

---

### L4 · Imported priors cannot move a cold slot, and the receipt attributes their estimate to evidence that does not exist

**Severity: blocks the pilot if imported priors are part of the data-science acceptance. Size: S–M.**

**Evidence.** Three lines interact.

1. `src/learn/stats.ts:159` — `const lift = p0slot > 0 ? Math.min(...) : 1;`. On a slot with no
   successes anywhere, `p0slot` is 0 and every item's lift is exactly 1.
2. `:133-139` — `priorFor` walks the parent chain, so a prior written at `*` applies at every key.
3. `:185` — `liftFor` counts `st.prior.n` toward `nMin`, so the deepest key that exists answers.

Probe p2b, a slot with two items and 60 exposures each, priors `p=0.90, n_equiv=500` and
`p=0.01, n_equiv=500`:

```
p_hat strong 0.899, p_hat weak 0.010   → the estimates honour the priors
p0 = 0                                 → lift strong 1, lift weak 1   (no ranking effect at all)
after ONE success anywhere in the slot → lift strong 2 (clamped), lift weak 1.116
```

Probe p2, one live exposure of a new piece with a root prior of `p=0.4, n_equiv=200`:

```
liftFor → level 5, "channel, visit bucket, stage, region and affinity cell", n = 1, s = 0
receipt → "Learned lift 1 from channel, visit bucket, stage, region and affinity cell
           (1 shown, 0 succeeded), applied at trust 1."
```

**Consequence.** The import exists so a warehouse can seed a piece that has no live evidence. At the
moment it is needed — a new slot, new content, no successes yet — it produces lift 1 for every item
regardless of the prior, so the ranking is unchanged; then a single unrelated success flips the strong
item to the clamp. Separately, the receipt and the operator row report the estimate as coming from
the finest pooling level on one live exposure, name a level of context the number does not contain,
show "0 succeeded" beside a non-neutral lift, and never mention the prior — although
`LiftApplied.prior` is carried on the record and doc 22 §8 says every receipt names the prior
document's revision. A data scientist checking the import cannot tell a seeded estimate from a
learned one, and a merchandiser reads a self-contradictory sentence.

**Remedy.** Form the lift against a reference that is defined at cold start (a slot-level prior, or
the parent key's rate with the same shrinkage the item gets) instead of returning 1 on a zero
denominator. Report the level at which the *evidence* stands, not the deepest key that passed the
gate — or add a `source: 'prior' | 'live' | 'mixed'` field and print it. Put `p_prior`, `n_equiv` and
the prior revision into the receipt sentence.

**Why this is not in 33 or 34.** F20 is the `lastIndexOf('|')` key split and the probability/money
unit mismatch — a prior landing on the wrong item. This is a different failure: the prior lands
correctly, is computed correctly, and still cannot act, and what it produces is misreported.

---

### L5 · The two recomputations of one day disagree, so "recompute every number from the ledger" has no single answer

**Severity: blocks the pilot for learning and measurement acceptance. Size: M.**

**Evidence.** Three attribution readers with three different bounds:

| Path | Ring bound | Where |
|---|---|---|
| online | 200 entries, 7 days | `src/durable-objects/DecisionRing.ts:14-15` |
| the fold | 200 entries, 48 hours | `src/learn/hourly.ts:35`, `:37`, `foldShard:256` |
| the records | **no cap, no horizon** | `src/learn/report.ts:75-84` `ringsOf` |

Probe p5, one day, one heavy visitor with 260 hero decisions whose click names the piece served
first, plus 20 ordinary visitors:

```
straight from the records: first-piece successes = 0.975   credits = 6   holdout rate 0.021
from the hour aggregates:  first-piece successes = 0       credits = 5   holdout rate 0.018
```

**Consequence.** `GET /learn/report` (fold) and `POST /learn/report` (records) publish different
numbers for the same settled, complete day; the online lift table is a third answer. Doc 22 promises
the customer's data scientists can recompute the lift table from the ledger — following the NDJSON
they will reproduce the uncapped `buildReport` answer, which is not what the platform published. The
gap widens with session length, so it lands hardest on exactly the engaged shoppers the customer
cares about, and nothing in the report says which bound applied. Combined with L1 the two answers can
also swap places in the same stored file.

**Remedy.** One attribution reader with one cap and one horizon, taken from configuration, used by
the object, the fold and the records path alike; stamp the bound onto every report and every lift
snapshot so a mismatch is legible. Add a test that folds a day and rebuilds it from records and
asserts the grids and holdout rows are equal.

**Why this is not in 33 or 34.** F17 names the fold's 200-entry ring and the 48-hour horizon as too
short for the seven-day policy, and names late data. It does not observe that `buildReport` applies
no cap at all, nor that the platform's two published reports for one *complete* day differ.

---

### L6 · The day report from records is quadratic, and the overlay route will exceed the Worker CPU limit well before its own record cap

**Severity: blocks the pilot for the reporting-overlay capability. Size: S.**

**Evidence.** `src/learn/report.ts:113` — `const d = i.decisions.find((x) => x.decision_id === c.decision_id);`
— a linear scan of every decision, inside the loop over every outcome's credits, inside the loop over
every policy. `presetPolicies` gives five policies by default (`:63-72`). The exposure pass at `:102`
is also repeated per policy although it does not depend on the policy. `REPORT_CAP = 50_000` per
stream (`:183`); `wrangler.toml` sets no `[limits] cpu_ms`, so the default Worker CPU ceiling applies.

Probe p4, five policies, one outcome per five decisions, Node 22 on this machine, two runs:

```
 2,000 decisions,   400 outcomes →    74 ms   /    74 ms
 5,000 decisions, 1,000 outcomes →   185 ms   /   165 ms
10,000 decisions, 2,000 outcomes →   555 ms   /   515 ms
20,000 decisions, 4,000 outcomes → 2,011 ms   / 1,216 ms
```

Growth is superlinear and consistent with the O(policies × credits × decisions) scan: each doubling
of the day costs between 2.4× and 3.6× the time, against the 2× a linear builder would cost. The
20,000-record point is the noisiest because it is where garbage collection starts to matter; the
shape, not the absolute number, is the measurement.

**Consequence.** Extrapolating the same shape, a day at the code's own cap (50,000 decisions, 10,000
outcomes) is on the order of ten seconds of CPU and both streams at cap on the order of a minute, on
a machine faster than a Worker isolate. `REPORT_MAX_OBJECTS = 800` guards the *object* count, not the record count, and the
ledger now writes few large objects by design (doc 31), so the guard does not bind: 800 objects can
hold far more than 20,000 records. The failure is a CPU-limit termination with no partial answer, on
the one route doc 22 §4.2 sells to the customer's data scientists. The same builder is also the
fallback for any day with no hour aggregates, so a fold outage plus one report request produces it.

**Remedy.** Build `new Map(decisions.map(d => [d.decision_id, d]))` once outside the policy loop;
hoist the exposure pass out of the policy loop (exposures are policy-independent); bound the request
by record count as well as object count and say so in the 413. All three are small and local.

**Why this is not in 33 or 34.** Doc 34 §3's performance work covers the decision path, catalog scale
(F32) and Durable Object storage (F08); no finding measures the report builder, and doc 33 §6 lists
only the object-count limit under worker limits.

---

## Smaller observations, not raised as findings

These are real but conditional or minor. They are recorded so they are not lost.

* **The scheduled day report hard-codes `brand: tenant`** (`src/index.ts:225`,
  `src/learn/hourly.ts:455`). Today a brand *is* a tenant (`src/routes/decisions.ts:107`), so this is
  consistent. If a stamp ever serves a brand id that differs from its tenant id — the content service
  already accepts `?brand=` and stamps it on every record (`src/content/service.ts:130`) — the fold
  would build a report for a brand with no records and the window report would show every day
  missing. Worth a guard when the multi-brand work in F31 lands.
* **`report.ts:143` excludes only `arm !== 'default'` from the exploration denominator**, so
  `no_learning` decisions — which never explore, `decide.ts:88` — dilute the realized share against
  the configured one. The dilution is the size of that arm.
* **Exploration's rotation floor is read at the root level only** (`explore.ts:50`,
  `observationsOf` reads `items[item]['*'].n`) while the evidence gate `nMin` applies at whatever
  level answers. Decay keeps items cycling back under the floor, so this self-corrects; it means
  rotation is "hold every item near 50 root impressions", not a continuing budget, which is worth
  stating in doc 22 §7.
* **Erasure never touches the learning counters.** `eraseVisitorLedger` writes the tombstone and
  resets the visitor's ring (`src/ledger/erasure.ts`), the fold drops her from the shard rings
  (`hourly.ts:233-239`), and the `LearnStats` aggregates keep her contribution. That is defensible —
  they hold no identifiers — but it is a policy decision that should be written down, and F06 already
  owns erasure completeness.

---

## Checked and found clean

Each was executed, not merely read. Probe p7 unless noted.

1. **Wilson score interval** (`measure/holdout.ts:134`) — correct at the textbook value
   (2/50 → 0.011–0.135), correct degenerate case at n = 0, clamps negative `s` and `s > n`.
2. **Newcombe's hybrid score interval** (`:150`) — method 10 built the right way round
   (56/70 vs 48/80 → 0.20, 0.052–0.334), bounds bracket the point estimate.
3. **The confidence quantiles** (`zFor`, `:109`) — exact to 1e-6 at 0.90, 0.95, 0.99, and Acklam's
   approximation correct on the interpolated branch (0.80 → 1.28155).
4. **The holdout hash** (`content/holdout.ts`) — realizes 5.0% over 200,000 ids (measured 0.0499),
   sticky, and the `mix32` finalizer does break up sequential ids: 50% sign flips between adjacent
   ids over 20,000 trials, so the block-sample failure recorded in the file's own comment is fixed.
5. **`mergeStats` / `mergeEntry`** (`hourly.ts:143-166`) — order-independent and exactly
   decay-preserving: two exposures one time constant apart merge to `1 + e⁻¹` in either order. This
   is the correct treatment F18 asks for, already present on the merge path.
6. **The pooling ladder's key algebra** (`stats.ts:33`, `:167`, `:168`) — the six keys nest, every
   key's `parentKey` is its predecessor, the chain terminates at `*`, and `depth` returns 0–5.
7. **Attribution's four axes** (`policy.ts:74`) — session scope, the per-reward window, the
   before-the-outcome constraint and one credit per slot all behave as specified on a mixed ring
   (out-of-window, out-of-session and after-the-fact decisions correctly excluded; hero and rail
   credited once each).
8. **The slot rate's shrinkage toward its parent** (`stats.ts:115-124`) — a cell with one event stays
   within 0.02 of its parent's rate rather than jumping to 0 or 1; the recursion terminates at the
   root and `pooled` sums correctly.

Also read and found nothing new to report: `learn/replay.ts` (its gap is F22),
`learn/cycle.ts` / `learn/autonomy.ts` (F24, plus the evidence coupling noted in L3),
`learn/queue.ts`, `learn/rows.ts`, `learn/receipts.ts` (its gap is in L4),
`ledger/writer.ts` / `consume.ts` / `enqueue.ts` (F16), `ledger/erasure.ts` (F06),
`durable-objects/RegionTrend.ts`, `content/cell.ts`, `content/holdout.ts`,
`src/index.ts` `scheduled`, and `wrangler.toml`'s cron and binding blocks.

## Not verified

* Nothing was run against staging or production; no authenticated call, no deploy, no load test.
* The probes use synthetic records. They prove the functions behave this way; they do not estimate
  how often each case arises in the customer's traffic.
* The CPU extrapolation in L6 is from Node timings on this machine, not from a Worker; the shape
  (quadratic) is measured, the absolute Worker numbers are not.
* Whether the customer's data scientists would accept the remedies in L3 and L4 is a conversation,
  not a code question.
