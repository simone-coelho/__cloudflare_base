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
| 2 | **1.12** Snowflake outbound event-level share; historical ingest via CSV/S3/REST; **identity stitching** across anonymous and recognised sessions | No implementing code for any of the three | Scheduled outbound export; an ingest path with a documented key; identity resolution that survives a cleared cookie | | Sequence against the pilot's analysis needs |
| 3 | **1.7** multi-brand provisioning with **hard data isolation** | No tenancy: shared bindings, no brand column on decision tables | Per-brand isolation at the binding and schema level, provable in a test | | Before the second brand, not after |
| 4 | **1.8** data science surfaces: explain export, **decision/outcome egress**, **priors import**, **debug endpoints** | Export exists demo-scoped and unauthenticated; egress, priors import and debug endpoints absent | Authenticated export at customer grain; a priors ingest; a documented debug surface | | With the DS working sessions |
| 5 | **1.6** explain records **persisted and exportable** | **PARTIAL.** The live defect under this row is FIXED 2026-09-02: `POST /decisions` dropped `body.sections`, so page-ordering receipts never reached D1 even though the client always sent them. Product, content and section receipts now persist in one batch. Persistence and export remain demo-scoped and unauthenticated | Authenticated export at customer grain, on the Tapestry-facing engine rather than the demo | | With the decision service |
| 6 | **1.5** season, promotion and margin as **tunable multipliers itemised in the explain record** | **PARTIAL 2026-09-02.** `src/reflex/merchandising.ts` is built and tested (24 cases): the three terms, tunable per placement, each itemised with the score delta it caused so the receipt reconciles, and the combined boost clamped so a multiplier tilts rather than overrides. **Not wired into the scoring path** — that file is the parallel session's active CW4 work | One-line integration in the content ranker, then the row closes | | With CW4 |
| 7 | ~~**1.2** the human verbs: **rename, pin, prune**~~ | ✅ **CLOSED 2026-09-02.** `POST /operator/audiences/:key/{rename,pin,prune}` on top of `KvAudienceStore.rename()` / `.setPinned()` / `.archive()`. The key never moves on a rename; nothing sets `generatorHash` by hand, because `hashDef()` covers name and description so the edit itself tells regeneration a human owns it; prune archives rather than deletes so past decisions stay explainable. Authenticated, unlike the older operator routes | Nothing. 8 tests, verified live | | ✅ Done |
| 8 | **1.3** content registered via **CMS/DAM API or JSON/CSV export**, with lifecycle windows | Schema and validation are real; the catalog is a bundled file; no ingest route; no render URL or publish/expire window on the record | An ingest endpoint and the two missing fields | | W2, already scheduled |
| 9 | **1.11** sorting feeds **from Salesforce Commerce Cloud or any other source** | Per-segment sorting and intent ranking exist; no feed adapter or re-rank endpoint | An endpoint that accepts a candidate set and returns it ordered | | With the pilot's PLP work, if taken |
| 10 | **2.3** delivered **API-first, decisions by content ID** | **Half closed 2026-09-02 (CW4):** a server-side decision service returns the §7 contract by content ID from `GET /v1/:tenant/decisions/snapshot`, tested and live on the dev server. **CW8 and CW10 closed 2026-09-02:** the customer SDK consumes it and the surface is key-gated in staging. Remaining: a stored catalog per scope (CW2) | CW2 | | W4 |
| 11 | ~~**"tested"** — the word covering all twelve~~ | ✅ **CLOSED 2026-09-02.** `npm test` runs 24 files / 477 cases in ~9s. The declared `vitest-environment-miniflare` was Miniflare v2 tooling, never installable against the wrangler 4 line this repo pins; nothing under test needs the Workers runtime, so the environment is `node`. Second cause: with no `exclude`, vitest collected `.claude/worktrees/` and reported 189 files / 3,701 cases with 20 failures from abandoned branches | CI wiring remains (`npm run ci` exists; no pipeline runs it) | | ✅ Done |
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
| B3 | **Pilot brand: Kate Spade or Coach** | Doc 1 §17 and the Implementation Plan say Kate Spade; the account team's framing says Coach | Theirs to settle with the customer. We state what Mandeep said and stop there |
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
