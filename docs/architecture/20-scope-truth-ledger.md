# 20 · The Scope Truth Ledger — every clause we have committed to, and what stands behind it

**INTERNAL. Never send this, quote it, or paraphrase it outside the delivery team.**

This exists because a customer-facing appendix now states that twelve capabilities are *"built, tested,
and active on signature"*, and an audit of this repository on 2026-08-31 found that a majority are not
yet true in code. The answers we give the account team are written forward and confidently — that is
correct, and it is not the problem this document solves. **The problem this document solves is
forgetting.** Every clause below is a commitment that has to become true, with an owner and a date, and
this ledger is the single place that tracks it.

The governance rule, stated once:

> **No clause leaves this ledger until working code and a passing test back it, and no new customer-facing
> clause is written that is not first entered here.** Anything a customer could hold us to lives on this
> list from the moment it is written down, not from the moment we start building it.

**How this list is worked: `21-tapestry-gap-closure-plan.md`** — four parallel lanes, keyed to the five
contract deadlines. This document stays the register of clauses; 21 is the operating plan.

Related: `19-tapestry-delivery-ledger.md` (the CW work items), `18-content-affinity-engine.md` (the
design), `docs/handover/03-tapestry-pending.md` (the promised-vs-built audit that preceded this).

---

## A · Clauses that need code before they are true

Ranked by exposure: how quickly a customer could discover the gap, and how much of the contract rests on it.

| # | Clause, as written to the customer | Status today | What has to exist | Owner | By |
|---|---|---|---|---|---|
| 1 | ~~**1.4** "weights, decay horizons and thresholds are versioned configuration, **effective immediately with no deployment**"~~ | ✅ **CLOSED 2026-09-02 (CW0 + CW9).** Store, validation, versioning, audit index and rollback behind `/config`, read per decision via `registry.resolveReflexConfig`, plus the surface a merchandiser operates at `/tuning.html` (linked from the operator console). A write re-stamps `config.version` with its revision so explain records stay honest across a tune. Every control names its symbol in plain words and shows the consequence: "interest halves about every 41.6 seconds". | Nothing. 39 store tests; UI verified cold at 1440×800 from screenshots per the standing acceptance rule | | ✅ Done |
| 2 | **1.12** Snowflake outbound event-level share; historical ingest via CSV/S3/REST; **identity stitching** across anonymous and recognised sessions | **Outbound share exists 2026-09-03 (Phase 0):** the R2 partitions *are* the event-level share; the warehouse reads `{tenant}/{date}/{hour}/`. Historical ingest for content exists (CW2's JSON, CSV and URL import); for transactions it does not. Identity: CW7b's durable vuid, no cross-device resolution yet | A transaction ingest path; cross-device resolution | | Sequence against the pilot's analysis needs |
| 3 | ~~**1.7** multi-brand provisioning with **hard data isolation**~~ | ✅ **CLOSED 2026-09-03 (CW1).** Every store holding per-brand data is scoped: audiences, sessions, profiles, feature overrides, experiments, the regeneration marker, per-shopper Durable Objects, socket pushes, and decision receipts in D1. A request resolves its brand from host or an allow-listed header; the default brand is unprefixed so nothing already stored moved; a key or visitor id that addresses another brand's namespace is refused. What is deliberately global, and why, is listed in the CW1 close-out commit. **Isolation is proven with pairs that cannot pass by accident** (non-default against non-default), which is how the last half-conversion was caught | A database per brand remains a stamp-provisioning decision, not a schema one (doc 22 §3.3). 60+ tests across `src/tenancy/` | | ✅ Done |
| 4 | **1.8** data science surfaces: explain export, **decision/outcome egress**, **priors import**, **debug endpoints** | Export exists demo-scoped and unauthenticated; egress, priors import and debug endpoints absent | Authenticated export at customer grain; a priors ingest; a documented debug surface | | With the DS working sessions |
| 5 | **1.6** explain records **persisted and exportable** | **Phase 0 landed 2026-09-03 (CW19):** every content decision the Tapestry-facing service serves and every reward-bearing outcome is written after the response as range-named NDJSON batches in R2 under the brand and hour, and comes back by id through an authenticated route with no index; Analytics Engine takes a point per record. The demo receipts (product, content, section, fixed 2026-09-02) stay demo-scoped. Remaining: product and section grains onto the same ledger; the shopper object's ring (Phase 1) | Product and section grains onto the ledger | | Phase 1 |
| 6 | **1.5** season, promotion and margin as **tunable multipliers itemised in the explain record** | **PARTIAL 2026-09-02.** `src/reflex/merchandising.ts` is built and tested (24 cases): the three terms, tunable per placement, each itemised with the score delta it caused so the receipt reconciles, and the combined boost clamped so a multiplier tilts rather than overrides. **Not wired into the scoring path** — that file is the parallel session's active CW4 work | One-line integration in the content ranker, then the row closes | | With CW4 |
| 7 | ~~**1.2** the human verbs: **rename, pin, prune**~~ | ✅ **CLOSED 2026-09-02.** `POST /operator/audiences/:key/{rename,pin,prune}` on top of `KvAudienceStore.rename()` / `.setPinned()` / `.archive()`. The key never moves on a rename; nothing sets `generatorHash` by hand, because `hashDef()` covers name and description so the edit itself tells regeneration a human owns it; prune archives rather than deletes so past decisions stay explainable. Authenticated, unlike the older operator routes | Nothing. 8 tests, verified live | | ✅ Done |
| 8 | ~~**1.3** content registered via **CMS/DAM API or JSON/CSV export**, with lifecycle windows~~ | ✅ **CLOSED 2026-09-02 (CW2, the outcome-learning session).** `/content/catalog` import adapter takes JSON or CSV, pulls a JSON URL as the CMS/DAM seam; pieces carry the render URL and the publish/expire window, and the window gates eligibility at decision time | Nothing. 15 tests | | ✅ Done |
| 9 | ~~**1.11** sorting feeds **from Salesforce Commerce Cloud or any other source**~~ | ✅ **CLOSED 2026-09-03.** `POST /sort`: a candidate set in with the attributes the registry reads, the same ids out in a per-shopper order, one receipt per item. Scores on the shopper's per-dimension affinity via `extractTouches`, so it is the same vector and arithmetic as content. Never drops a candidate; never adds one. **Affinity at zero reproduces the feed order exactly, as a test**, which is the parity sentence promised in three customer documents | Stored per-placement weights ride with CW5's slot-strategy kind; the dials travel on the request until then. 20 tests | | ✅ Done |
| 10 | **2.3** delivered **API-first, decisions by content ID** | **Half closed 2026-09-02 (CW4):** a server-side decision service returns the §7 contract by content ID from `GET /v1/:tenant/decisions/snapshot`, tested and live on the dev server. **Closed 2026-09-02:** decisions are made at the edge and returned by content ID (CW4), the customer SDK consumes them (CW8), the surface is key-gated in staging (CW10), and the catalog is stored per scope and imported through the seam (CW2). Shown end to end on the dev server | ✅ | | W4 |
| 11 | ~~**"tested"** — the word covering all twelve~~ | ✅ **CLOSED 2026-09-02.** `npm test` runs 24 files / 477 cases in ~9s. The declared `vitest-environment-miniflare` was Miniflare v2 tooling, never installable against the wrangler 4 line this repo pins; nothing under test needs the Workers runtime, so the environment is `node`. Second cause: with no `exclude`, vitest collected `.claude/worktrees/` and reported 189 files / 3,701 cases with 20 failures from abandoned branches | CI wiring remains (`npm run ci` exists; no pipeline runs it) | | ✅ Done |
| 13 | **1.1** profiling from **first-party signals** on the customer's site | **Found 2026-09-02:** the reflex scores only products it finds in our own catalog copy; a customer's flattened product attributes on the event are dropped, so on their site with their catalog, product events would not move affinity | **Closed 2026-09-02 (CW24):** `eventAttributes: event-when-unknown` per scope scores the registry attributes an event carries when no held catalog resolves the product; off by default, so the demo surfaces are unchanged. Shown live: a product we do not hold moved affinity and changed the decision | ✅ | | Before acceptance |
| 12 | **No holdout mechanism exists** | **Assignment exists 2026-09-02 (CW4):** deterministic, sticky, per-brand salt, arm on every decision record (`src/content/holdout.ts`). Reporting against it needs the ledger (CW19) | The ledger and the report | | Before launch — traffic that ran without one cannot be re-run |

### ~~A live defect, found in the same audit~~ — FIXED 2026-09-02

`src/demos/meridian/routes.ts` built the capture input **without `sections`**, so the page-ordering
receipts the client posts (meridian.js:3093) were silently dropped and never persisted; the same guard
rejected a sections-only post with a 400. `capture()` and `captureLayout()` were already correct, which is
why this read as a missing feature and was actually a dropped field. Normalization now lives in
`receipts.captureInputFrom()` so it is assertable, with 9 tests.

---

## B · Contradictions between documents the customer already holds

These are not build items. They are decisions someone has to make once, and then make consistent
everywhere. Each has already caused, or will cause, a question we cannot answer cleanly.

| # | The contradiction | Where it lives | Decision needed |
|---|---|---|---|
| B1 | **"Available on signature"** versus our own Implementation Plan, which schedules seven of the same twelve as work items with milestones | Scope appendix §1 vs `Tapestry-Implementation-Plan.md` | Whether §1 keeps that framing. Both documents are in the same buyer's hands |
| B2 | ~~Product grid sorting in or out of scope~~ **SETTLED: SFCC support is committed.** We told Mandeep and Nitin we would support their Salesforce Commerce Cloud feed. This is not an open question and must not be re-raised | `Tapestry-Product-Grid-Sorting-Answer.md` §138 is STALE (says "not in contracted scope") — superseded, do not quote | ✅ Decided. Remaining work is documentary: make the stale line consistent |
| B3 | ~~Pilot brand: Kate Spade or Coach~~ **SETTLED: COACH — the customer changed it.** Mandeep originally chose Kate Spade for lower business impact; he has since changed the rules and asked for Coach first. This is his decision, not a risk posture we took on his behalf | ~~Documents the customer already holds still said Kate Spade~~ **Updated 2026-09-02:** Implementation Plan (three places), Doc 1 §17 (twice), and the v8 launch-brand field, all now Coach | ✅ Decided and documented |
| B4 | **Who delivers the tuning UI**, when the acceptance bar requires weights live-tunable by a business user | Acceptance definition vs an AE draft that excluded the operator interface | Name the deliverer and the date, or the acceptance criterion has to change |
| B5 | **Production or lower environment** — no deliverable commits to production, while the customer's objective is production before the holiday | Implementation Plan milestones | Say which, in the appendix |
| B6 | **PS cost** — one document says implementation is included; a PS quote may exist | `Tapestry-Capability-Breakdown-v2.md` §11 vs the issued quote | Commercial. The two artefacts meet at contract time |
| B7 | **CMAB framing** — two early internal field briefs say "CMAB auto-optimizes which layout wins"; the customer-facing position says the opposite and calls that framing counter-productive with this buyer | `Coach-Component-Personalization-Field-Brief.md`, `Coach-Conversation-Guide.md` | Retire the superseded language so it stops travelling |
| B8 | **"First-party signals only"** versus the built cold start, which joins public census data into the opening decision | `Tapestry-Implementation-Plan.md` §7 vs `src/services/geo/cohort.ts` | Decide the wording. Public reference data is not purchased audience data, but it is not a first-party signal either |
| B9 | **Change control** — nothing says what happens when scope moves, and it has moved more than once | Missing entirely | Add a clause |
| B10 | **Programme naming** — three names for the same programme across documents | Several | One name, everywhere |

---

## C · Open surfaces with no authentication

Found during the same audit. Not customer commitments, but they are the kind of thing a security review
finds, and one is on the critical path to a security review we have already promised (D7).

- ~~`POST /realtime/action` — unauthenticated~~ **CW10 (2026-09-02):** SDK-key gated when `AUTH_MODE=enforced` (staging); open on the demo worker by design.
- `/cdp/*` — authentication optional on all but two routes; `identify` merges caller-supplied traits. Unchanged.
- ~~CORS reflects any origin with credentials.~~ **CW10:** allow-list when `CORS_ORIGINS` is set or mode is enforced; reflect-any survives only on the open demo worker with nothing configured.
- Decision export endpoints are unauthenticated and demo-scoped. Unchanged; Phase 0 owns the ledger export.
- Operator writes: **CW10** requires a JWT when enforced; open on the demo worker so the console keeps working.

---

## D · How this list is worked

1. **Nothing leaves the ledger on assertion.** A row closes when there is code, a passing test, and a
   named place the customer could see it work. Not when it is written, not when it is designed.
2. **Every new customer-facing clause enters here first.** If it is going in a document a customer could
   hold us to, it is a row before it is a sentence.
3. **The answers we give stay forward and confident.** This ledger is what makes that honest: we are
   answering about a system we are building on a schedule, and this is the schedule.
4. **Reviewed at every milestone**, and before any document goes to Mandeep, Nitin, procurement or legal.

*Opened 2026-08-31, from the audit of this repository against the Scope of Services appendix.*
