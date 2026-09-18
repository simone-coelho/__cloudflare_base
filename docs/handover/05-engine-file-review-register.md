# 05 · Engine file review register

**What this is.** The to-do list for making every file that moves to the engine repository readable by an engineer who did not write it. It goes with [the extraction plan](04-engine-extraction-plan.md). Files are grouped in the order they should be reviewed. Tier 1 is the decision path, which anyone joining has to understand first.

**Snapshot.** Generated 2026-09-14 from the working tree on `feature/real-time-personalization` (commit `f13d761` plus uncommitted remediation changes). The numbers come from an import trace, the TypeScript parser and text counts, not from reading and judging. They will drift as the code changes. Regenerate the register before Phase 3 starts on the extraction baseline commit.

**How to use it.**

1. Take the lowest open tier first. Within a tier, go top to bottom unless a file is blocked.
2. Claim a file by adding `owner: <name>` to its line. One owner per file at a time. Nobody edits a file someone else has claimed.
3. A file is done only when it meets the definition of done in [plan §7](04-engine-extraction-plan.md#7--what-done-means-for-one-file) and a second engineer has read it. Then tick the box.
4. Splitting a file is its own change, with no behavior changes in it. The tests must pass before and after.
5. This register does not track the defects in document 35. A file can be readable and still have open remediation findings. Those stay in `docs/remediation/tracker.json`.

**Totals across all tiers:** 155 files · 33,591 lines · 15 files over 500 lines · 46 functions of 80 or more lines · 28 files with no header comment · 434 of 963 exports have a comment · 625 internal work references · 32 outside names · 159 demo names.

## What each tag means

| Tag | Meaning |
|---|---|
| UNTANGLE | Engine code that imports demo code or demo data, or builds in a demo default. Plan Phase 1 fixes these before the cut. |
| SPLIT | Over 500 lines. Split by responsibility, or write the reason it stays whole in the header. |
| LOOK FOR A SPLIT | 300 to 500 lines and has a long function. Check whether it holds more than one responsibility. |
| SHORTEN | Functions of 80 or more lines, with their line counts. Split each one or record why it stays long. |
| ADD HEADER | No comment at the top of the file. |
| DOCUMENT | Exported functions, classes, types or constants with no comment directly above them. |
| REPLACE | Internal work references such as `CW10`, `W09.06`, `doc 22 §15`, `ledger 20 row 9` or `scope appendix`. They mean nothing outside this repository. Replace each with the reason it stands for. |
| REMOVE | Outside names: customers, prospects, people, competitors or events. Of the 32 found, 29 are customer or people names, 2 an event and 1 a competitor. |
| NEUTRALIZE | Demo names such as `coach`, `brighthour` or `meridian`. They may appear in test fixtures, never as a default or a type in engine code. |
| NO TEST | No test file imports this file. It may still be covered through a route test. Confirm, then add one or note where the coverage lives. |
| DECIDE | Not imported by the engine at runtime, or an optional integration. Keep, move or drop. Plan §4 lists the decision. |
| REWRITE / FIX / CHECK | Configuration or tooling with a specific known problem, described on the line. |

"Header: yes" only means a comment block exists at the top. Whether it explains the file is the reviewer's call.

## Tier 1 · The decision path

Read these to understand what the engine does. An event comes in, a shopper profile is scored, and content or product decisions go out.

**Tier totals:** 26 files · 9,248 lines · 7 over 500 lines · 16 functions of 80+ lines · no header 6 · exports with a comment 106/177 · internal work references 284 · outside names 15 · demo names 61.

- [ ] `src/reflex/core.ts` · 517 lines · longest function 91 lines · header: yes · exports documented 22/25 · tests importing it: 27
  - SPLIT: 517 lines; SHORTEN: apply (91); DOCUMENT 3 of 25 exports; REPLACE 16 internal work references; REMOVE 1 outside names
- [ ] `src/reflex/configStore.ts` · 518 lines · no function of 80+ lines · header: yes · exports documented 19/29 · tests importing it: 10
  - UNTANGLE: dynamic import of src/demos/brighthour/reflexConfig.ts; DEFAULT_SCOPE is coach; SPLIT: 518 lines; DOCUMENT 10 of 29 exports; REPLACE 6 internal work references; NEUTRALIZE 19 demo names
- [ ] `src/content/decide.ts` · 327 lines · longest function 255 lines · header: yes · exports documented 0/2 · tests importing it: 16
  - LOOK FOR A SPLIT: 327 lines; SHORTEN: decideContent (255); DOCUMENT 2 of 2 exports; REPLACE 24 internal work references
- [ ] `src/reflex/contentCompose.ts` · 340 lines · longest function 195 lines · header: yes · exports documented 8/17 · tests importing it: 3
  - LOOK FOR A SPLIT: 340 lines; SHORTEN: composeContentDetailed (195); DOCUMENT 9 of 17 exports; REPLACE 6 internal work references; NEUTRALIZE 1 demo names
- [ ] `src/content/service.ts` · 287 lines · longest function 138 lines · header: yes · exports documented 1/5 · tests importing it: 3
  - UNTANGLE: imports src/demos/registry.ts; SHORTEN: serveContentDecisions (138); DOCUMENT 4 of 5 exports; REPLACE 16 internal work references
- [ ] `src/routes/realtime.ts` · 875 lines · longest function 160 lines · header: none · exports documented 1/2 · tests importing it: 5
  - UNTANGLE: imports src/demos/registry.ts and src/services/demoEventCapture.ts; POST /realtime/demo/trigger and captureDemoEvent live here; SPLIT: 875 lines; SHORTEN: POST /action (160), POST /demo/trigger (99); ADD HEADER; DOCUMENT 1 of 2 exports; REPLACE 21 internal work references; NEUTRALIZE 2 demo names
- [ ] `src/services/RealtimeSegmentEngine.ts` · 1280 lines · longest function 237 lines · header: yes · exports documented 5/9 · tests importing it: 6
  - UNTANGLE: imports src/demos/registry.ts and src/data/seed-audiences.ts (bundled demo insights); SPLIT: 1280 lines; SHORTEN: processAction (237), getOrCreateSessionFromCookies (112), getPersonalizationConfig (109); DOCUMENT 4 of 9 exports; REPLACE 24 internal work references; REMOVE 1 outside names; NEUTRALIZE 11 demo names
- [ ] `src/services/SessionManager.ts` · 971 lines · longest function 139 lines · header: none · exports documented 1/5 · tests importing it: 9
  - UNTANGLE: session carries a demo surface field that defaults to coach; SPLIT: 971 lines; SHORTEN: createOrUpdateSession (139), absorbIntoShopper (89); ADD HEADER; DOCUMENT 4 of 5 exports; REPLACE 16 internal work references; REMOVE 1 outside names; NEUTRALIZE 2 demo names
- [ ] `src/durable-objects/ShopperReflex.ts` · 1490 lines · longest function 260 lines · header: yes · exports documented 3/4 · tests importing it: 6
  - UNTANGLE: imports src/demos/registry.ts; SPLIT: 1490 lines; SHORTEN: ingest (260), fetch (232), alarm (103) and 2 more; DOCUMENT 1 of 4 exports; REPLACE 40 internal work references; NEUTRALIZE 3 demo names
- [ ] `src/routes/decisions.ts` · 765 lines · no function of 80+ lines · header: yes · exports documented 0/1 · tests importing it: 6
  - SPLIT BY ROUTE GROUP: 30 routes under /v1/:tenant (shopper snapshot, learning, ledger and erasure, reports, trend and monitor); SPLIT: 765 lines; DOCUMENT 1 of 1 exports; REPLACE 49 internal work references
- [ ] `src/routes/sort.ts` · 199 lines · no function of 80+ lines · header: yes · exports documented 0/1 · tests importing it: 2
  - UNTANGLE: imports src/demos/registry.ts; surface type is coach | brighthour; DOCUMENT 1 of 1 exports; REPLACE 3 internal work references; NEUTRALIZE 2 demo names
- [ ] `src/reflex/sortCandidates.ts` · 151 lines · no function of 80+ lines · header: yes · exports documented 2/7 · tests importing it: 1
  - DOCUMENT 5 of 7 exports; REPLACE 2 internal work references; REMOVE 3 outside names
- [ ] `src/reflex/searchCandidates.ts` · 79 lines · no function of 80+ lines · header: none · exports documented 1/4 · tests importing it: 1
  - ADD HEADER; DOCUMENT 3 of 4 exports
- [ ] `src/reflex/merchandising.ts` · 206 lines · no function of 80+ lines · header: yes · exports documented 8/13 · tests importing it: 1
  - DOCUMENT 5 of 13 exports; REPLACE 3 internal work references
- [ ] `src/content/cell.ts` · 72 lines · no function of 80+ lines · header: yes · exports documented 3/5 · tests importing it: 2
  - DOCUMENT 2 of 5 exports; REPLACE 3 internal work references
- [ ] `src/content/slotConstraints.ts` · 54 lines · no function of 80+ lines · header: none · exports documented 2/5 · tests importing it: 0
  - ADD HEADER; DOCUMENT 3 of 5 exports; NO TEST imports this file
- [ ] `src/content/typeAffinity.ts` · 29 lines · no function of 80+ lines · header: yes · exports documented 2/3 · tests importing it: 3
  - DOCUMENT 1 of 3 exports
- [ ] `src/content/holdout.ts` · 47 lines · no function of 80+ lines · header: yes · exports documented 4/5 · tests importing it: 1
  - DOCUMENT 1 of 5 exports; REPLACE 1 internal work references
- [ ] `src/content/lifecycle.ts` · 34 lines · no function of 80+ lines · header: yes · exports documented 1/3 · tests importing it: 2
  - DOCUMENT 2 of 3 exports; REPLACE 3 internal work references
- [ ] `src/reflex/contentTelemetry.ts` · 116 lines · no function of 80+ lines · header: yes · exports documented 5/7 · tests importing it: 1
  - DOCUMENT 2 of 7 exports; REPLACE 3 internal work references
- [ ] `src/reflex/identityMerge.ts` · 129 lines · no function of 80+ lines · header: yes · exports documented 3/3 · tests importing it: 1
  - No findings from the measurements; still needs a reader review.
- [ ] `src/services/visit.ts` · 179 lines · no function of 80+ lines · header: yes · exports documented 8/10 · tests importing it: 2
  - DOCUMENT 2 of 10 exports; REPLACE 2 internal work references; REMOVE 2 outside names
- [ ] `src/services/JourneyStage.ts` · 93 lines · no function of 80+ lines · header: yes · exports documented 3/5 · tests importing it: 1
  - DOCUMENT 2 of 5 exports; REPLACE 3 internal work references; REMOVE 1 outside names
- [ ] `src/events/actionTypes.ts` · 39 lines · no function of 80+ lines · header: yes · exports documented 4/5 · tests importing it: 1
  - DOCUMENT 1 of 5 exports; REPLACE 1 internal work references; NEUTRALIZE 1 demo names
- [ ] `src/index.ts` · 299 lines · no function of 80+ lines · header: none · exports documented 0/1 · tests importing it: 0
  - UNTANGLE: mounts 15 demo or legacy route groups plus the Agents router, and exports OpalAgent and MeridianReflex; the engine needs its own entry; ADD HEADER; DOCUMENT 1 of 1 exports; REPLACE 21 internal work references; REMOVE 1 outside names; NEUTRALIZE 12 demo names
- [ ] `src/types/env.ts` · 152 lines · no function of 80+ lines · header: none · exports documented 0/1 · tests importing it: 36
  - UNTANGLE: declares demo bindings and secrets (BROWSER, OpalAgent, MERIDIAN_REFLEX, GEMINI_*, BRIGHTHOUR_*); ADD HEADER; DOCUMENT 1 of 1 exports; REPLACE 21 internal work references; REMOVE 5 outside names; NEUTRALIZE 8 demo names

## Tier 2 · Boundary: tenants, access, accounts, identity, consent

Every request passes through these before it reaches the decision path. They decide who is calling and which customer data they can touch.

**Tier totals:** 28 files · 4,420 lines · 1 over 500 lines · 6 functions of 80+ lines · no header 10 · exports with a comment 63/169 · internal work references 23 · outside names 3 · demo names 15.

- [ ] `src/tenancy/tenant.ts` · 267 lines · no function of 80+ lines · header: yes · exports documented 14/15 · tests importing it: 12
  - UNTANGLE: DEFAULT_TENANT is coach; the default tenant keeps unprefixed keys; DOCUMENT 1 of 15 exports; REPLACE 3 internal work references; REMOVE 2 outside names; NEUTRALIZE 10 demo names
- [ ] `src/tenancy/middleware.ts` · 110 lines · no function of 80+ lines · header: yes · exports documented 3/5 · tests importing it: 9
  - DOCUMENT 2 of 5 exports; REMOVE 1 outside names; NEUTRALIZE 2 demo names
- [ ] `src/tenancy/objects.ts` · 67 lines · no function of 80+ lines · header: yes · exports documented 4/4 · tests importing it: 4
  - No findings from the measurements; still needs a reader review.
- [ ] `src/tenancy/d1.ts` · 43 lines · no function of 80+ lines · header: yes · exports documented 2/3 · tests importing it: 1
  - DECIDE: not imported by the engine; tenant column only on a demo table; DOCUMENT 1 of 3 exports; NEUTRALIZE 2 demo names
- [ ] `src/middleware/edgeAccess.ts` · 162 lines · no function of 80+ lines · header: yes · exports documented 6/11 · tests importing it: 5
  - DOCUMENT 5 of 11 exports; REPLACE 1 internal work references; NEUTRALIZE 1 demo names
- [ ] `src/middleware/auth.ts` · 199 lines · longest function 113 lines · header: none · exports documented 0/5 · tests importing it: 3
  - SHORTEN: jwt (113); ADD HEADER; DOCUMENT 5 of 5 exports
- [ ] `src/middleware/operatorAuth.ts` · 41 lines · no function of 80+ lines · header: none · exports documented 2/2 · tests importing it: 0
  - ADD HEADER; NO TEST imports this file
- [ ] `src/middleware/error.ts` · 39 lines · no function of 80+ lines · header: none · exports documented 0/1 · tests importing it: 1
  - ADD HEADER; DOCUMENT 1 of 1 exports
- [ ] `src/middleware/request-id.ts` · 13 lines · no function of 80+ lines · header: none · exports documented 0/1 · tests importing it: 0
  - ADD HEADER; DOCUMENT 1 of 1 exports; NO TEST imports this file
- [ ] `src/middleware/rate-limiter.ts` · 42 lines · no function of 80+ lines · header: none · exports documented 0/1 · tests importing it: 0
  - DECIDE: not imported by any runtime file; ADD HEADER; DOCUMENT 1 of 1 exports; NO TEST imports this file
- [ ] `src/auth/store.ts` · 467 lines · longest function 126 lines · header: yes · exports documented 1/21 · tests importing it: 9
  - LOOK FOR A SPLIT: 467 lines; SHORTEN: d1Store (126); DOCUMENT 20 of 21 exports; REPLACE 1 internal work references
- [ ] `src/auth/accounts.ts` · 110 lines · no function of 80+ lines · header: yes · exports documented 7/15 · tests importing it: 4
  - DOCUMENT 8 of 15 exports; REPLACE 1 internal work references
- [ ] `src/auth/loginBudget.ts` · 79 lines · no function of 80+ lines · header: none · exports documented 2/10 · tests importing it: 0
  - ADD HEADER; DOCUMENT 8 of 10 exports; NO TEST imports this file
- [ ] `src/auth/subjectAudit.ts` · 179 lines · longest function 108 lines · header: none · exports documented 2/2 · tests importing it: 0
  - SHORTEN: auditedSubjectOperation (108); ADD HEADER; NO TEST imports this file
- [ ] `src/auth/signingConfig.mjs` · 22 lines · no function of 80+ lines · header: yes · tests importing it: 1
  - No findings from the measurements; still needs a reader review.
- [ ] `src/routes/auth.ts` · 245 lines · no function of 80+ lines · header: yes · exports documented 0/0 · tests importing it: 4
  - REPLACE 1 internal work references
- [ ] `src/identity/link.ts` · 296 lines · longest function 120 lines · header: yes · exports documented 1/4 · tests importing it: 2
  - UNTANGLE: imports src/demos/registry.ts; SHORTEN: linkVisitor (120); DOCUMENT 3 of 4 exports; REPLACE 1 internal work references
- [ ] `src/identity/history.ts` · 267 lines · longest function 119 lines · header: yes · exports documented 2/7 · tests importing it: 2
  - UNTANGLE: imports src/demos/registry.ts; SHORTEN: applyHistory (119); DOCUMENT 5 of 7 exports
- [ ] `src/identity/erase.ts` · 678 lines · longest function 163 lines · header: yes · exports documented 0/6 · tests importing it: 2
  - SPLIT: 678 lines; SHORTEN: eraseSubject (163); DOCUMENT 6 of 6 exports
- [ ] `src/identity/store.ts` · 182 lines · no function of 80+ lines · header: yes · exports documented 1/5 · tests importing it: 2
  - DOCUMENT 4 of 5 exports; REPLACE 6 internal work references
- [ ] `src/identity/assertion.ts` · 110 lines · no function of 80+ lines · header: yes · exports documented 3/8 · tests importing it: 3
  - DOCUMENT 5 of 8 exports
- [ ] `src/identity/sessionCapability.ts` · 124 lines · no function of 80+ lines · header: none · exports documented 2/14 · tests importing it: 10
  - ADD HEADER; DOCUMENT 12 of 14 exports
- [ ] `src/identity/shopperId.ts` · 54 lines · no function of 80+ lines · header: yes · exports documented 3/4 · tests importing it: 3
  - DOCUMENT 1 of 4 exports; REPLACE 1 internal work references
- [ ] `src/identity/consentContinuity.ts` · 43 lines · no function of 80+ lines · header: none · exports documented 2/3 · tests importing it: 0
  - ADD HEADER; DOCUMENT 1 of 3 exports; NO TEST imports this file
- [ ] `src/identity/profileEnrichment.ts` · 91 lines · no function of 80+ lines · header: yes · exports documented 0/11 · tests importing it: 1
  - DOCUMENT 11 of 11 exports
- [ ] `src/routes/identity.ts` · 299 lines · no function of 80+ lines · header: yes · exports documented 0/1 · tests importing it: 2
  - DOCUMENT 1 of 1 exports; REPLACE 6 internal work references
- [ ] `src/content/consent.ts` · 66 lines · no function of 80+ lines · header: yes · exports documented 6/9 · tests importing it: 2
  - DOCUMENT 3 of 9 exports; REPLACE 2 internal work references
- [ ] `src/durable-objects/RateLimiter.ts` · 125 lines · no function of 80+ lines · header: none · exports documented 0/1 · tests importing it: 2
  - Keep: used by src/auth/loginBudget.ts; ADD HEADER; DOCUMENT 1 of 1 exports

## Tier 3 · Configuration and catalog

How tuning, content catalogs and slot settings are validated, versioned and published.

**Tier totals:** 13 files · 3,278 lines · 1 over 500 lines · 3 functions of 80+ lines · no header 2 · exports with a comment 60/119 · internal work references 105 · outside names 3 · demo names 8.

- [ ] `src/config/versionedStore.ts` · 533 lines · no function of 80+ lines · header: yes · exports documented 15/24 · tests importing it: 13
  - SPLIT: 533 lines; DOCUMENT 9 of 24 exports; REPLACE 7 internal work references
- [ ] `src/config/publication.ts` · 364 lines · no function of 80+ lines · header: yes · exports documented 2/13 · tests importing it: 6
  - DOCUMENT 11 of 13 exports
- [ ] `src/config/input.ts` · 61 lines · no function of 80+ lines · header: yes · exports documented 3/8 · tests importing it: 2
  - DOCUMENT 5 of 8 exports
- [ ] `src/routes/config.ts` · 208 lines · no function of 80+ lines · header: yes · exports documented 0/2 · tests importing it: 5
  - DOCUMENT 2 of 2 exports; REPLACE 3 internal work references
- [ ] `src/routes/content.ts` · 322 lines · no function of 80+ lines · header: yes · exports documented 0/2 · tests importing it: 1
  - DOCUMENT 2 of 2 exports; REPLACE 6 internal work references
- [ ] `src/content/kinds.ts` · 489 lines · longest function 124 lines · header: yes · exports documented 4/10 · tests importing it: 16
  - LOOK FOR A SPLIT: 489 lines; SHORTEN: validateRetainedLearn (124), validateSlot (111), validatePiece (87); DOCUMENT 6 of 10 exports; REPLACE 2 internal work references; REMOVE 1 outside names
- [ ] `src/content/types.ts` · 350 lines · no function of 80+ lines · header: yes · exports documented 23/31 · tests importing it: 22
  - DOCUMENT 8 of 31 exports; REPLACE 63 internal work references; REMOVE 2 outside names
- [ ] `src/content/import.ts` · 217 lines · no function of 80+ lines · header: yes · exports documented 10/12 · tests importing it: 3
  - DOCUMENT 2 of 12 exports; REPLACE 1 internal work references
- [ ] `src/content/enrichment.ts` · 218 lines · no function of 80+ lines · header: yes · exports documented 0/9 · tests importing it: 1
  - DOCUMENT 9 of 9 exports
- [ ] `src/content/enrichmentPublication.ts` · 69 lines · no function of 80+ lines · header: yes · exports documented 0/1 · tests importing it: 0
  - DOCUMENT 1 of 1 exports; NO TEST imports this file
- [ ] `src/content/catalogDiagnostics.ts` · 49 lines · no function of 80+ lines · header: none · exports documented 1/2 · tests importing it: 1
  - ADD HEADER; DOCUMENT 1 of 2 exports
- [ ] `src/content/slotDiagnostics.ts` · 48 lines · no function of 80+ lines · header: none · exports documented 1/2 · tests importing it: 2
  - ADD HEADER; DOCUMENT 1 of 2 exports
- [ ] `src/services/CatalogService.ts` · 350 lines · no function of 80+ lines · header: yes · exports documented 1/3 · tests importing it: 3
  - UNTANGLE: bundles src/data/coach-catalog.json as the catalog; DOCUMENT 2 of 3 exports; REPLACE 23 internal work references; NEUTRALIZE 8 demo names

## Tier 4 · Learning, ledger and measurement

What was decided and what happened afterwards is recorded, folded into statistics and reported.

**Tier totals:** 28 files · 6,330 lines · 2 over 500 lines · 5 functions of 80+ lines · no header 1 · exports with a comment 152/361 · internal work references 79 · outside names 7 · demo names 0.

- [ ] `src/ledger/writer.ts` · 354 lines · longest function 176 lines · header: yes · exports documented 6/8 · tests importing it: 3
  - LOOK FOR A SPLIT: 354 lines; SHORTEN: persistDeliveries (176); DOCUMENT 2 of 8 exports
- [ ] `src/ledger/enqueue.ts` · 225 lines · no function of 80+ lines · header: yes · exports documented 3/8 · tests importing it: 2
  - DOCUMENT 5 of 8 exports; REPLACE 5 internal work references
- [ ] `src/ledger/consume.ts` · 71 lines · no function of 80+ lines · header: yes · exports documented 1/3 · tests importing it: 2
  - DOCUMENT 2 of 3 exports
- [ ] `src/ledger/delivery.ts` · 158 lines · no function of 80+ lines · header: yes · exports documented 4/24 · tests importing it: 2
  - DOCUMENT 20 of 24 exports
- [ ] `src/ledger/records.ts` · 230 lines · no function of 80+ lines · header: yes · exports documented 11/20 · tests importing it: 12
  - DOCUMENT 9 of 20 exports; REPLACE 12 internal work references
- [ ] `src/ledger/erasure.ts` · 457 lines · longest function 122 lines · header: yes · exports documented 10/22 · tests importing it: 8
  - LOOK FOR A SPLIT: 457 lines; SHORTEN: rewriteErasures (122); DOCUMENT 12 of 22 exports; REPLACE 2 internal work references
- [ ] `src/ledger/productSort.ts` · 66 lines · no function of 80+ lines · header: none · exports documented 2/3 · tests importing it: 2
  - ADD HEADER; DOCUMENT 1 of 3 exports
- [ ] `src/learn/hourly.ts` · 829 lines · longest function 138 lines · header: yes · exports documented 23/39 · tests importing it: 4
  - SPLIT: 829 lines; SHORTEN: foldShard (138); DOCUMENT 16 of 39 exports; REPLACE 6 internal work references
- [ ] `src/learn/report.ts` · 909 lines · longest function 101 lines · header: yes · exports documented 17/48 · tests importing it: 5
  - SPLIT: 909 lines; SHORTEN: buildReport (101); DOCUMENT 31 of 48 exports; REPLACE 15 internal work references
- [ ] `src/learn/fan.ts` · 303 lines · no function of 80+ lines · header: yes · exports documented 9/21 · tests importing it: 6
  - DOCUMENT 12 of 21 exports; REPLACE 6 internal work references
- [ ] `src/learn/replay.ts` · 240 lines · longest function 101 lines · header: yes · exports documented 1/6 · tests importing it: 3
  - SHORTEN: replayDecision (101); DOCUMENT 5 of 6 exports; REPLACE 2 internal work references
- [ ] `src/learn/stats.ts` · 188 lines · no function of 80+ lines · header: yes · exports documented 4/18 · tests importing it: 14
  - DOCUMENT 14 of 18 exports; REPLACE 9 internal work references
- [ ] `src/learn/policy.ts` · 120 lines · no function of 80+ lines · header: yes · exports documented 5/9 · tests importing it: 8
  - DOCUMENT 4 of 9 exports; REPLACE 7 internal work references
- [ ] `src/learn/explore.ts` · 122 lines · no function of 80+ lines · header: yes · exports documented 3/11 · tests importing it: 3
  - DOCUMENT 8 of 11 exports; REPLACE 1 internal work references
- [ ] `src/learn/autonomy.ts` · 105 lines · no function of 80+ lines · header: yes · exports documented 3/8 · tests importing it: 2
  - DOCUMENT 5 of 8 exports; REPLACE 1 internal work references
- [ ] `src/learn/priors.ts` · 77 lines · no function of 80+ lines · header: yes · exports documented 2/8 · tests importing it: 4
  - DOCUMENT 6 of 8 exports; REPLACE 3 internal work references
- [ ] `src/learn/rows.ts` · 197 lines · no function of 80+ lines · header: yes · exports documented 8/18 · tests importing it: 4
  - DOCUMENT 10 of 18 exports; REPLACE 1 internal work references
- [ ] `src/learn/receipts.ts` · 80 lines · no function of 80+ lines · header: yes · exports documented 1/3 · tests importing it: 2
  - DOCUMENT 2 of 3 exports; REPLACE 1 internal work references
- [ ] `src/learn/queue.ts` · 38 lines · no function of 80+ lines · header: yes · exports documented 0/2 · tests importing it: 2
  - DOCUMENT 2 of 2 exports; REPLACE 1 internal work references
- [ ] `src/learn/cycle.ts` · 49 lines · no function of 80+ lines · header: yes · exports documented 2/7 · tests importing it: 1
  - DOCUMENT 5 of 7 exports
- [ ] `src/learn/route.ts` · 38 lines · no function of 80+ lines · header: yes · exports documented 1/3 · tests importing it: 1
  - DOCUMENT 2 of 3 exports
- [ ] `src/learn/external.ts` · 136 lines · no function of 80+ lines · header: yes · exports documented 6/12 · tests importing it: 1
  - DOCUMENT 6 of 12 exports; REPLACE 1 internal work references; REMOVE 1 outside names
- [ ] `src/measure/window.ts` · 119 lines · no function of 80+ lines · header: yes · exports documented 1/6 · tests importing it: 3
  - DOCUMENT 5 of 6 exports
- [ ] `src/measure/holdout.ts` · 270 lines · no function of 80+ lines · header: yes · exports documented 10/17 · tests importing it: 1
  - DECIDE: not imported by any runtime file (src/content/holdout.ts is the live one); DOCUMENT 7 of 17 exports; REPLACE 1 internal work references; REMOVE 5 outside names
- [ ] `src/durable-objects/DecisionRing.ts` · 271 lines · no function of 80+ lines · header: yes · exports documented 1/2 · tests importing it: 5
  - DOCUMENT 1 of 2 exports; REPLACE 5 internal work references
- [ ] `src/durable-objects/LearnStats.ts` · 288 lines · no function of 80+ lines · header: yes · exports documented 1/2 · tests importing it: 3
  - DOCUMENT 1 of 2 exports
- [ ] `src/durable-objects/RegionTrend.ts` · 126 lines · no function of 80+ lines · header: yes · exports documented 0/1 · tests importing it: 2
  - DOCUMENT 1 of 1 exports
- [ ] `src/reflex/regionTrend.ts` · 264 lines · no function of 80+ lines · header: yes · exports documented 17/32 · tests importing it: 2
  - DOCUMENT 15 of 32 exports; REMOVE 1 outside names

## Tier 5 · Connectors, audiences and the operator API

The seams to outside systems (CDP, experimentation) and the audience tools an operator uses.

**Tier totals:** 15 files · 3,762 lines · 2 over 500 lines · 1 functions of 80+ lines · no header 2 · exports with a comment 32/62 · internal work references 57 · outside names 1 · demo names 22.

- [ ] `src/connectors/index.ts` · 65 lines · no function of 80+ lines · header: yes · exports documented 0/2 · tests importing it: 2
  - DOCUMENT 2 of 2 exports; REPLACE 1 internal work references
- [ ] `src/connectors/types.ts` · 88 lines · no function of 80+ lines · header: yes · exports documented 5/7 · tests importing it: 4
  - UNTANGLE: audience surface defaults to coach; DOCUMENT 2 of 7 exports; REPLACE 3 internal work references; NEUTRALIZE 1 demo names
- [ ] `src/connectors/DecisionProvider.ts` · 450 lines · longest function 87 lines · header: yes · exports documented 3/4 · tests importing it: 3
  - LOOK FOR A SPLIT: 450 lines; SHORTEN: decideFromSegments (87); DOCUMENT 1 of 4 exports; REPLACE 7 internal work references; NEUTRALIZE 2 demo names
- [ ] `src/connectors/SegmentProvider.ts` · 115 lines · no function of 80+ lines · header: yes · exports documented 2/3 · tests importing it: 1
  - UNTANGLE: audience surface defaults to coach; DOCUMENT 1 of 3 exports; REPLACE 1 internal work references; NEUTRALIZE 2 demo names
- [ ] `src/connectors/SignalProvider.ts` · 114 lines · no function of 80+ lines · header: yes · exports documented 3/4 · tests importing it: 0
  - UNTANGLE: bundles src/data/signals.json (mock feed); DOCUMENT 1 of 4 exports; REPLACE 2 internal work references; NEUTRALIZE 3 demo names; NO TEST imports this file
- [ ] `src/connectors/AudienceAuthoring.ts` · 214 lines · no function of 80+ lines · header: yes · exports documented 1/4 · tests importing it: 0
  - DOCUMENT 3 of 4 exports; REPLACE 6 internal work references; NEUTRALIZE 3 demo names; NO TEST imports this file
- [ ] `src/connectors/AudienceStore.ts` · 120 lines · no function of 80+ lines · header: yes · exports documented 0/2 · tests importing it: 4
  - DOCUMENT 2 of 2 exports; REPLACE 4 internal work references; NEUTRALIZE 3 demo names
- [ ] `src/connectors/evaluateCondition.ts` · 61 lines · no function of 80+ lines · header: yes · exports documented 1/1 · tests importing it: 0
  - NO TEST imports this file
- [ ] `src/reflex/audienceGenerator.ts` · 226 lines · no function of 80+ lines · header: yes · exports documented 3/6 · tests importing it: 2
  - DOCUMENT 3 of 6 exports; REPLACE 4 internal work references; REMOVE 1 outside names; NEUTRALIZE 4 demo names
- [ ] `src/services/odpLoop.ts` · 407 lines · no function of 80+ lines · header: yes · exports documented 14/16 · tests importing it: 2
  - DOCUMENT 2 of 16 exports; REPLACE 14 internal work references; NEUTRALIZE 2 demo names
- [ ] `src/services/OptimizelyService.ts` · 527 lines · no function of 80+ lines · header: yes · exports documented 0/4 · tests importing it: 3
  - DECIDE: live experimentation provider; keep only behind the connector seam; SPLIT: 527 lines; DOCUMENT 4 of 4 exports; REPLACE 4 internal work references
- [ ] `src/services/FeatureVariableManager.ts` · 431 lines · no function of 80+ lines · header: none · exports documented 0/5 · tests importing it: 3
  - DECIDE: reached only through RealtimeSegmentEngine; confirm it is still needed; ADD HEADER; DOCUMENT 5 of 5 exports; REPLACE 1 internal work references
- [ ] `src/routes/operator.ts` · 512 lines · no function of 80+ lines · header: yes · exports documented 0/1 · tests importing it: 1
  - UNTANGLE: /events/reset and /events/stats read the demo_events table; /insights serves bundled demo insights; SPLIT: 512 lines; DOCUMENT 1 of 1 exports; REPLACE 6 internal work references; NEUTRALIZE 2 demo names
- [ ] `src/routes/geo.ts` · 83 lines · no function of 80+ lines · header: yes · exports documented 0/0 · tests importing it: 0
  - UNTANGLE: GET /geo/cohort pulls src/services/geo/cohort.ts (demo cold start); REPLACE 3 internal work references; NO TEST imports this file
- [ ] `src/durable-objects/PersonalizationWebSocket.ts` · 349 lines · no function of 80+ lines · header: none · exports documented 0/3 · tests importing it: 1
  - Keep: the socket relay for the session host; ADD HEADER; DOCUMENT 3 of 3 exports; REPLACE 1 internal work references

## Tier 6 · Customer SDK and operator console

What a customer site and a merchandiser actually run in the browser.

**Tier totals:** 21 files · 4,092 lines · 2 over 500 lines · 14 functions of 80+ lines · no header 2 · exports with a comment 16/64 · internal work references 25 · outside names 0 · demo names 9.

- [ ] `src/sdk/index.ts` · 48 lines · no function of 80+ lines · header: yes · exports documented 0/2 · tests importing it: 0
  - DOCUMENT 2 of 2 exports; REPLACE 2 internal work references
- [ ] `src/sdk/browser.ts` · 14 lines · no function of 80+ lines · header: yes · exports documented 0/0 · tests importing it: 0
  - No findings from the measurements; still needs a reader review.
- [ ] `src/sdk/core.ts` · 624 lines · longest function 519 lines · header: yes · exports documented 0/6 · tests importing it: 7
  - NOTE: createCore is one factory function returning the client; judge and split by its inner functions; SPLIT: 624 lines; SHORTEN: createCore (519); DOCUMENT 6 of 6 exports; REPLACE 1 internal work references
- [ ] `src/sdk/emit.ts` · 190 lines · longest function 113 lines · header: yes · exports documented 1/8 · tests importing it: 2
  - NOTE: createEmit is a factory function; judge by its inner functions; SHORTEN: createEmit (113); DOCUMENT 7 of 8 exports
- [ ] `src/sdk/listen.ts` · 184 lines · longest function 139 lines · header: yes · exports documented 0/6 · tests importing it: 5
  - NOTE: createListen is a factory function; judge by its inner functions; SHORTEN: createListen (139); DOCUMENT 6 of 6 exports
- [ ] `src/sdk/identify.ts` · 113 lines · no function of 80+ lines · header: yes · exports documented 0/5 · tests importing it: 3
  - DOCUMENT 5 of 5 exports; REPLACE 2 internal work references
- [ ] `src/sdk/identity.ts` · 79 lines · no function of 80+ lines · header: yes · exports documented 6/11 · tests importing it: 2
  - DOCUMENT 5 of 11 exports; REPLACE 1 internal work references
- [ ] `src/sdk/host.ts` · 64 lines · no function of 80+ lines · header: yes · exports documented 0/1 · tests importing it: 0
  - DOCUMENT 1 of 1 exports; NO TEST imports this file
- [ ] `src/sdk/wire.ts` · 38 lines · no function of 80+ lines · header: yes · exports documented 1/3 · tests importing it: 1
  - DOCUMENT 2 of 3 exports; REPLACE 2 internal work references
- [ ] `src/sdk/types.ts` · 179 lines · no function of 80+ lines · header: yes · exports documented 7/16 · tests importing it: 4
  - DOCUMENT 9 of 16 exports; REPLACE 5 internal work references
- [ ] `src/sdk/memoryHost.ts` · 25 lines · no function of 80+ lines · header: yes · exports documented 0/1 · tests importing it: 3
  - DOCUMENT 1 of 1 exports
- [ ] `src/sdk/testHost.ts` · 64 lines · no function of 80+ lines · header: yes · exports documented 1/4 · tests importing it: 5
  - Test helper: move beside the tests; DOCUMENT 3 of 4 exports; NEUTRALIZE 2 demo names
- [ ] `src/sdk/version.ts` · 2 lines · no function of 80+ lines · header: none · exports documented 0/1 · tests importing it: 0
  - ADD HEADER; DOCUMENT 1 of 1 exports
- [ ] `public/console/index.html` · 275 lines · no function of 80+ lines · header: none · tests importing it: 0
  - ADD HEADER
- [ ] `public/console/shell.js` · 406 lines · longest function 385 lines · header: yes · tests importing it: 0
  - LOOK FOR A SPLIT: 406 lines; SHORTEN: (anonymous) (385); REPLACE 1 internal work references; NEUTRALIZE 7 demo names
- [ ] `public/console/views.js` · 576 lines · longest function 560 lines · header: yes · tests importing it: 0
  - SPLIT: 576 lines; SHORTEN: (anonymous) (560), render (94); REPLACE 4 internal work references
- [ ] `public/console/views-config.js` · 485 lines · longest function 468 lines · header: yes · tests importing it: 0
  - LOOK FOR A SPLIT: 485 lines; SHORTEN: (anonymous) (468), render (113); REPLACE 2 internal work references
- [ ] `public/console/views-measure.js` · 319 lines · longest function 306 lines · header: yes · tests importing it: 0
  - LOOK FOR A SPLIT: 319 lines; SHORTEN: (anonymous) (306), render (123); REPLACE 2 internal work references
- [ ] `public/console/views-accounts.js` · 163 lines · longest function 144 lines · header: yes · tests importing it: 0
  - SHORTEN: (anonymous) (144), render (83); REPLACE 1 internal work references
- [ ] `public/console/views-explore.js` · 148 lines · longest function 133 lines · header: yes · tests importing it: 0
  - SHORTEN: (anonymous) (133); REPLACE 2 internal work references
- [ ] `public/operator-session.js` · 96 lines · longest function 87 lines · header: yes · tests importing it: 0
  - SHORTEN: (anonymous) (87)

## Tier 7 · Operations: health, monitoring, scripts, schema

What it takes to build, deploy, check and operate one stamp.

**Tier totals:** 24 files · 2,461 lines · 0 over 500 lines · 1 functions of 80+ lines · no header 5 · exports with a comment 5/11 · internal work references 52 · outside names 3 · demo names 44.

- [ ] `src/ops/monitor.ts` · 117 lines · no function of 80+ lines · header: yes · exports documented 5/11 · tests importing it: 2
  - DOCUMENT 6 of 11 exports
- [ ] `src/routes/health.ts` · 81 lines · no function of 80+ lines · header: none · exports documented 0/0 · tests importing it: 2
  - ADD HEADER
- [ ] `wrangler.toml` · 407 lines · no function of 80+ lines · header: none · tests importing it: 0
  - REWRITE: committed resource ids for one Cloudflare account; demo bindings on every environment; every environment serves all of public/; ADD HEADER; REPLACE 23 internal work references; REMOVE 1 outside names; NEUTRALIZE 20 demo names
- [ ] `package.json` · 72 lines · no function of 80+ lines · header: n/a · tests importing it: 0
  - REWRITE: name, description, MIT license, optly scripts and demo dependencies; NEUTRALIZE 5 demo names
- [ ] `.github/workflows/ci.yml` · 45 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - REPLACE 1 internal work references
- [ ] `vitest.config.ts` · 48 lines · no function of 80+ lines · header: none · tests importing it: 0
  - FIX: collects node:test files under scripts/ that vitest cannot run; ADD HEADER
- [ ] `tsconfig.json` · 36 lines · no function of 80+ lines · header: n/a · tests importing it: 0
  - No findings from the measurements; still needs a reader review.
- [ ] `.eslintrc.json` · 26 lines · no function of 80+ lines · header: n/a · tests importing it: 0
  - CHECK: lint passes with 494 warnings against a cap of 503
- [ ] `migrations/0010_operator_accounts.sql` · 48 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - Keep: the only D1 tables the engine reads and writes (operator accounts, sessions, audit); REPLACE 1 internal work references
- [ ] `migrations/0011_operator_audit_tenant.sql` · 5 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - Keep: fold into the new repo's first migration
- [ ] `scripts/deploy.sh` · 82 lines · no function of 80+ lines · header: none · tests importing it: 0
  - REWRITE: builds the Meridian demo bundle before every deploy; ADD HEADER; REPLACE 7 internal work references; NEUTRALIZE 3 demo names
- [ ] `scripts/build-sdk.mjs` · 38 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - NEUTRALIZE 1 demo names
- [ ] `scripts/operator-seed.mjs` · 182 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - No findings from the measurements; still needs a reader review.
- [ ] `scripts/dev-token.mjs` · 17 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - No findings from the measurements; still needs a reader review.
- [ ] `scripts/console-operator.mjs` · 99 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - No findings from the measurements; still needs a reader review.
- [ ] `scripts/console-preview.sh` · 201 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - NEUTRALIZE 3 demo names
- [ ] `scripts/acceptance-run.mjs` · 238 lines · longest function 120 lines · header: yes · tests importing it: 0
  - SHORTEN: run (120); NEUTRALIZE 2 demo names
- [ ] `scripts/holdout-proof.mjs` · 147 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - REPLACE 13 internal work references; NEUTRALIZE 1 demo names
- [ ] `scripts/identity-proof.mjs` · 135 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - REPLACE 2 internal work references; NEUTRALIZE 1 demo names
- [ ] `scripts/latency.mjs` · 182 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - REPLACE 4 internal work references; NEUTRALIZE 3 demo names
- [ ] `scripts/load-test.mjs` · 121 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - NEUTRALIZE 1 demo names
- [ ] `scripts/verify-origin.sh` · 54 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - REPLACE 1 internal work references; NEUTRALIZE 2 demo names
- [ ] `scripts/import-content.mjs` · 45 lines · no function of 80+ lines · header: yes · tests importing it: 0
  - CHECK: described as the import adapter for the demo catalog; REMOVE 2 outside names; NEUTRALIZE 2 demo names
- [ ] `scripts/lib/tool-token.mjs` · 35 lines · no function of 80+ lines · header: none · tests importing it: 0
  - ADD HEADER

## Test files

The register lists source files. Tests move with them. From the import trace, 98 test files exist under `src/`:

- **71 import only engine code.** They move with the engine.
- **12 import only demo code.** They stay here.
- **15 import both** and need splitting, or their demo fixtures replaced, before they move: `src/config/versionedStore.test.ts`, `src/reflex/configStore.test.ts`, `src/reflex/odpLoop.test.ts`, `src/routes/demoEventCapture.test.ts`, `src/routes/realtime.sdkContract.test.ts`, `src/services/telemetry.boundary.test.ts`, `src/telemetry.boundary.test.ts`, `src/tenancy/d1.test.ts`, `src/tenancy/storeIsolation.test.ts`, and six under `src/demos/` that exercise engine modules.

The same rules apply to test files. Seven engine test files have 1,299 lines or more; `src/routes/realtime.sdkContract.test.ts` has 2,746 and `src/index.api-boundary.test.ts` has 1,849. 308 test titles carry a work-package ID instead of describing the behavior they check. The four `node:test` files under `scripts/` must run under `node --test`, not vitest.

## Left behind in this repository (source only)

The engine does not import any of this. It stays here with the demos and is not reviewed for the new repository.

| Area | Files | Lines |
|---|---:|---:|
| `other src/` | 5 | 576 |
| `src/agents/` | 5 | 493 |
| `src/console/ (test types)` | 1 | 9 |
| `src/data/` | 4 | 4,213 |
| `src/demos/ (registry)` | 1 | 225 |
| `src/demos/brighthour/` | 11 | 16,939 |
| `src/demos/meridian/` | 32 | 9,389 |
| `src/routes/ (demo and legacy)` | 14 | 2,817 |
| `src/services/ (demo and legacy)` | 12 | 2,147 |
| `src/services/funnel/ and geo/` | 5 | 1,251 |

`src/data/` is listed as left behind, but three engine files import it today (tangles 3 to 5 in the plan). It stays here once those are cut. `other src/` is `src/durable-objects/StateManager.ts`, `src/utils/context.ts`, `src/utils/pixel.ts`, `src/types/events.ts` and `src/sdk/tsconfig.json`. These are legacy or type-only imports: confirm each before dropping it. Public pages, images, demo scripts, demo migrations and seeds are counted in plan §2.
