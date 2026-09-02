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
| Tuning surface a business user can operate | CW9 | 2 | **Next.** The store is in place and the API is its contract; this is the UI on top. The §3.2 acceptance definition says *weights live-tunable by your team*, and an authenticated HTTP call is not that |
| Decision + explain persistence at every grain | CW11 | 2.5 | Product decisions persist for the Meridian demo only; content and section decisions are not persisted at all |
| Season / promotion / margin as real weighted terms | — | 0.5 | §1.5 itemises them in the explain record; they do not exist as terms |
| Rename / pin / prune endpoints | — | 0.5 | §1.2 promises the verbs; generation and pin-survival are real, the endpoints are not |

**Both landed 2026-09-02.** The harness gated the evidentiary standard for everything else, and CW0 was the
single highest-leverage item in the programme. Lane A continues at CW9; Lanes B, C and D are unblocked and
unstarted.

### Lane B — The delivery surface
*Closes: §2.3 API-first delivery, and the Kickoff + 45 integration kit.*

| Item | CW | Days | Note |
|---|---|---|---|
| Multi-tenancy across KV / D1 / DO / queues / R2 | CW1 | 5 | §1.7 claims hard data isolation on signature. Nine `tenant` hits in the repo are all comments |
| Content catalog store + import adapter | CW2 | 2.5 | §1.3's ingest endpoint; the catalog is a bundled file today |
| Server-side content ranker + page assembler | CW4 | 2.5 | The math is real and proven in Meridian, but it runs **in the browser**, ranking a full catalog shipped to the client. That is the opposite of decisions-by-ID over the wire |
| Snapshot endpoint for first paint | CW4 | — | Included above; no flash of default content |
| SDK extraction, one package two modules | CW8 | 2.5 | `storefront.js` is one 4,192-line class, unchanged in five weeks |
| Staging envs, SDK-key auth, operator auth, CORS allowlist | CW10 | 3 | The literal blocker to "consumable by their lower environments." Both env stanzas are empty; CORS reflects any origin with credentials; operator routes are mounted with no auth |

CW1 is the long pole and it is blocked on one answer: **which brand is the first tenant.** Scoping it wrong
is exactly the rework the risk register warns about.

### Lane C — Registry completeness
*Closes: §1.1's dimension list and the acceptance bar's "chosen by the agreed dimension registry."*

| Item | CW | Days | Note |
|---|---|---|---|
| Regional trending: `RegionTrend` DO, KV publish, λ-blend | CW6 | 3 | Mandeep's stated non-negotiable for v1, and the single dimension with the least code against the highest priority. Zero lines exist. The geo-cohort module is a reusable ingredient, **not** a substitute |
| Visit boundaries, entry channel, vuid cutover | CW7 | 1.5 | Three correctness bugs undercutting three registry dimensions at once. `sessionCount` increments on every update, not per visit |
| Content telemetry, exposure-normalised | CW3 | 1.5 | Impression, click, dwell, video completion. Zero hits in the repo. Content-type affinity cannot be a learned dimension without it |
| Purchase forwarding to ODP | — | 0.2 | The highest-weighted action in the engine falls through a `default: return null` |

### Lane D — Governance and measurement
*Closes: §1.8, §2.4's roadmap, and the obligations we accepted in the customer document.*

| Item | CW | Days | Note |
|---|---|---|---|
| Holdout mechanism | — | 1 | No `holdout` anywhere in the repo. Traffic that runs without one cannot be re-run |
| Priors import | CW11 | — | §1.8 promises it; nothing accepts an externally derived prior |
| Authenticated export at customer grain | CW11 | — | Export exists demo-scoped and unauthenticated |
| Per-slot autonomous weight mixing | CW5 | 1.5 | §1.4's autonomy note in v8 now states this in writing. Slot strategies are hardcoded constants with no `mode` switch |
| Stage-two design document | CW13 | ✅ | Written 2026-09-01 as `22-outcome-learning-design.md`. The build items below come from it |
| **Phase 0 · Record**: decision + outcome ledgers (queues, R2 partitions, D1 recent index), holdout assignment | CW19 | 2.5 | The only phase whose delay costs data that cannot be recovered. Also closes ledger 20 row 5 (persistence at every grain) and the Snowflake outbound share, since the R2 partitions *are* the share |
| **Phase 1 · Shadow**: online attribution in the shopper DO, LearnStats DO with decayed counts, versioned lift snapshots to KV, γ = 0 | CW20 | 3.5 | Learning runs and shows in every explain record; nothing on the site changes until a person raises γ |
| **Phase 2 · Apply**: γ per slot, exploration policies, assisted autonomy job with bounds | CW21 | 2 | Defines T7 precisely: proposals with evidence, then autonomous within bounds |
| Learning console: lift grid, policy comparison, version history, freeze / reset / reject, the dials | CW22 | 3 | The surface the data scientists and marketers will judge us on. Rides the tuning surface (CW9) |
| **Phase 3 · Extend**: imported priors, external model hook (service / table / Workers AI), replay endpoint | CW23 | 2.5 | Priors import closes ledger 20 row 4; the hook is the "bring your own model" answer to Nitin |

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
