# Lane log — remediation W16–W41

Dated, append-only. The lead writes it; agents read it. Newest entries at the bottom of each section.

## Authority

| Date | Authority | State |
|---|---|---|
| 2026-09-16 | Local implementation W02–W41 in order after independent review; live acceptance batched at the end (user). | Standing, reused. |
| 2026-09-18 | Lead transferred to Claude Fable 5.1; the delegated-agent method (METHOD.md) is ordered by the user. | Standing. |
| 2026-09-18 | Local commits on the integration branch and lane branches are part of the method (checkpoints `7b01c14`, `7260f02`, method commit below). Nothing was pushed. | Lead ruling under the method mandate; reported to the user. |
| 2026-09-18 | Push, pull request and auto-merge to `origin` (GitHub `simone-coelho/__cloudflare_base`). | **NOT GRANTED.** Requested from the user. Batches stop at "ready to push". |
| standing | Deploy, cloud/resource mutation, credentials, customer data, seed/provision scripts, external messages. | Never inferred. |

## Baseline (measured on `7b01c14`, 2026-09-18)

- `vitest run src` (parallel workers): 1616 passed, 238 failed in 29 of 98 files. 224 failures outside `src/demos`. Largest: `routes/realtime.sdkContract` 72, `routes/identity` 22, `index.api-boundary` 13, `reflex/shopperReflex` 12, `services/SessionManager.visit` 10, `services/SessionManager.identity` 9. Dominant messages: "Configuration publication authority unavailable" (21), "Authored document and publication-set preconditions plus Idempotency-Key are required" (23), 500/401/428/503 where 200 expected (43), "Retention policy or retained-data authority unavailable" (5). Serial confirmation pending (lane L2).
- App typecheck: green with `--incremental false --composite false` (17 s at 4 GB); red in plain composite mode (TS6307, `src/identity/material.mjs` not in `tsconfig.json` include). SDK typecheck green.
- Remote `origin/feature/real-time-personalization` is 86 commits behind local; CI last ran red on 2026-09-04 and has never seen the remediation work.
- The old board check ran for over 20 minutes on `/mnt/c` without output and was abandoned; it is frozen history.

## Rulings

| ID | Date | Ruling |
|---|---|---|
| R1 | 2026-09-18 | METHOD.md is the law. `tracker.json`, `evidence/**`, the old RESUME history, document 36 and `board.mjs` are frozen at `7260f02`: retained, not updated, not a backlog. Document 35 is unchanged. |
| R2 | 2026-09-18 | Roles run on Claude Opus at xhigh effort (`.claude/agents/rem-*.md`); Fable 5.1 is the escalation for a unit whose second build fails. Replaces the gpt-6-astra requirement. |
| R3 | 2026-09-18 | The red baseline becomes a ratchet: `baseline-failures.json` is derived at the checkpoint; the gate refuses any failure outside it and the list may only shrink. Every entry is owed work under its owning W. |
| R4 | 2026-09-18 | Unit IDs `W16.C2.01`; tests `describe('unit:<id>')` in `src/units/<W>/<batch>.unit.test.ts`; legs `logic`/`host`/`native`/`sdk` as METHOD §3; shared Miniflare setup in `src/units/_native.ts`. |
| R5 | 2026-09-18 | The typecheck gate is the no-composite command in METHOD §7. The composite-mode TS6307 is a tools-lane unit (`TOOLS.01`); CI must run the same commands as the gate. |
| R6 | 2026-09-18 | Builder checkouts under `/home/simonecoelho/rem/<lane>` with `node_modules` symlinked to `_deps`; evidence under `/home/simonecoelho/rem/_evidence/<batch>/<role>/`, mirrored by the lead to `C:\Users\LAH\Documents\Remediation-Evidence\cloudflare_base\`. |
| R7 | 2026-09-18 | W16 is decomposed by admitted criterion: batch 1 = C2 visit/channel (9 units). C3–C8 follow in order. W16.01's K1–K10 checks are superseded by units plus the gate; its 59 owned paths are the granted scope for W16 implementers. C10 (live) stays open. |
| R8 | 2026-09-18 | The twelve stale `.claude/worktrees/agent-*` worktrees from August are pre-existing user material: untouched. |
| R10 | 2026-09-18 | BASE batches update stale tests to the remedy contract and are measured by the shrinking residual, not by units. In a BASE batch a specifier may change setup and fixtures freely; an assertion may change only with a comment on the line above citing the witness (document 35 clause, settled decision, or the product line that defines the contract). The reviewer FAILs any assertion change without a cited witness and any change that weakens a guard, grants a legacy permission, re-admits a KV fallback or lowers an entropy check. A test the specifier believes reveals a real product regression stays RED and is named with the unit to declare. |
| R11 | 2026-09-18 | Product regressions found in the W01–W15 area are units named `<W>.BASE.<nn>` under the owning W, with the existing red test as their specification unless the reviewer finds it dishonest. |
| R12 | 2026-09-18 | Agents cannot write report files; the final message is the report and the lead saves it into the evidence directory. Briefs no longer ask for REPORT.md. |
| R13 | 2026-09-18 | Entry-channel precedence: the shopper's established owned entry channel wins over a request-supplied channel, which is only a fallback when no owned entry exists (HANDOFF-2026-09-18 §5 C2; unit W16.C2.05). The older W35.02 visit-context case in `realtime.sdkContract.test.ts` asserting the opposite is updated to this contract under R10 by the BASE-1a specifier. |
| R14 | 2026-09-18 | An entry whose `siteHost` is empty or not a valid hostname carries no page-view evidence and classifies as unknown, never `direct`; `direct` requires a present valid `siteHost` with an empty or same-site referrer. The SDK's all-empty placeholder is unknown. Folded into unit W16.C2.04. |
| R15 | 2026-09-18 | A commit's `Co-Authored-By` trailer names the model that authored it: each agent uses the attribution line its own harness supplies (Opus agents attribute Opus); the lead's own commits attribute Fable 5.1. METHOD §7 and the role files are corrected accordingly. |
| R16 | 2026-09-18 | Until push authority exists, after the reviewer's PASS and the lead's validation the lead merges the lane branch into the local integration branch with `git merge --no-ff` and records the merge sha; when authority arrives the integration branch is pushed and later batches flow through pull requests. |
| R17 | 2026-09-18 | `node scripts/build-sdk.mjs --check` is red at base `5b0b0ae`: the shipped `public/sdk` bundles predate the W16 draft edit to `src/sdk/core.ts`. This is a named residual owned by the W16-B1 implementer (`public/sdk` is in W16's scope). Until regenerated, a reviewer records that gate step as "red at base, unchanged by this batch" for any batch that leaves `src/sdk` and `public/sdk` untouched; it does not fail such a batch. |
| R18 | 2026-09-18 | `entrySessionId` is a public read-only observable on the SDK `Core` interface naming the browsing session that produced the cached entry signals; it is exposed in the regenerated `public/sdk` bundles and documented in `docs/kit/02-api-reference.md` if that file lists Core members. A getter that returns the current session id does not satisfy it. |
| R19 | 2026-09-18 | Host legs drive the mounted route production serves (`decisionRoutes` at `/v1/:tenant/decisions/snapshot` behind `requireShopper`, mounted from `src/index.ts`) and assert what that route exposes. Where a ruled outcome's observable is not exposed by any public route, the unit keeps its in-process leg named `host-internal`, and the row's `residual` names the missing public observable for the whole-W review; a unit is never satisfied by a helper alone when a public route exists. |
| R20 | 2026-09-18 | The SDK-visible snapshot (`GET /realtime/reflex` hydrate) carries `visit: { visitNumber, entryChannel }` (the `projectVisit` shape) on both hosts. The Durable Object's internal `projection=content` shape `{ visitCount, lastVisitAt, entryChannel, lastSeen }` stays internal and never crosses the SDK boundary. |
| R21 | 2026-09-18 | A specification branch may fail the app typecheck only on the ruled missing members or exports the specifier's report names (one line each); the build branch must clear them, and the gate's typecheck applies in full to every build. A widening cast to hide a ruled-but-absent member is not used. |
| R9 | 2026-09-18 | Project role files under `.claude/agents/` are discovered only at session start. In the session that created them, lanes are dispatched through the general-purpose agent on Opus with the role file as the mandatory first read; the `rem-*` types became available later in the same session (from 19:10) and are used from then on. The dependency symlink `node_modules` is excluded via `.git/info/exclude` so every worktree reports a clean porcelain status. |

## Lanes

| Lane | Batch | Role / agent | Checkout · branch · base | State |
|---|---|---|---|---|
| L0 | TOOLS-1 score tool, ratchet, CI wiring, tsconfig include | rem-implementer (general-purpose/Opus, role file first) | `/home/simonecoelho/rem/tools` · `rem/tools-score` · `5b0b0ae` | **built `6f1a028` 19:29**: 6/6 tool tests, plain tsc green, SCORE.md `Units 0/0 · W closed 0/26 · suite 1616/1854 · residual 238 in 29 files · typecheck GREEN`; residuals 1–6 in its REPORT.md; TOOL review next |
| L5 | W16-B1 specification pass | rem-reviewer SPECIFICATION | `/home/simonecoelho/rem/triage` · detached at `84f07c7` | first pass done 19:46 (8 HONEST, C2.08 FAÇADE, 8 corrections); **second pass on `c98cb02` dispatched 20:08** |
| L6 | TOOLS-1 tool review with negative controls | rem-reviewer TOOL | `/home/simonecoelho/rem/review-tools` · detached at `6f1a028` | **done 19:50**: TOOLS.01/.02/.03/.06 PASS, TOOLS.04/.05 FAIL; six holes (length-based ratchet growth, unbounded id matcher, stale gate report path, empty report not fail-closed, silent drop of id-less rows, tool tests never run); implementer reworking, second review to follow |
| L1 | W16-B1 (C2 visit/channel, 9 units) | rem-specifier (general-purpose/Opus, role file first) | `/home/simonecoelho/rem/spec` · `rem/w16-c2-spec` · `5b0b0ae` | **spec `f1072cc` → R14 `84f07c7` → corrections 1–8 `c98cb02` 20:05** (integration merged at `9c2b65e`): 15 tests, 10 RED, public-route legs added under R19; one ruled TS2339 on `Core.entrySessionId` (R21); second specification pass (L5) running |
| L2 | BASE triage of the 238 baseline failures | rem-reviewer TRIAGE (general-purpose/Opus, role file first) | `/home/simonecoelho/rem/triage` · detached at `5b0b0ae` | **done 19:11**; report at `_evidence/BASE/triage/REPORT.md` |
| L3 | BASE-2 stale consent/retention/identity fixtures (groups C, D-part, F; 43 failures, 6 files) | rem-specifier | `/home/simonecoelho/rem/base2` · `rem/base-2-consent-fixtures` · `7a83faa` | dispatched 2026-09-18 19:13 (`rem-specifier` type) |
| L4 | BASE-1a stale publication/precondition fixtures in `realtime.sdkContract.test.ts` (groups A, B, J-part; 72 failures, 1 file) | rem-specifier | `/home/simonecoelho/rem/base1a` · `rem/base-1a-sdkcontract` · `7a83faa` | dispatched 2026-09-18 19:13 (`rem-specifier` type) |

## Batches

### TOOLS-1 — score tool, ratchet, CI wiring
Units: `TOOLS.01` tsconfig include so plain `tsc --noEmit` is green; `TOOLS.02` `scripts/remediation/score.mjs --from <vitest.json>` derives SCORE.md; `TOOLS.03` `--check` refuses a hand-edited SCORE.md; `TOOLS.04` `--check-ratchet` refuses a failure outside `baseline-failures.json` and refuses a grown list; `TOOLS.05` a unit with zero tests is never green; `TOOLS.06` CI runs the gate commands and the score check. Tool units are proven by `scripts/remediation/score.test.mjs` (node:test) and the reviewer's negative controls, not by product tests.

### W16-B1 — C2 visit and entry channel (witness: document 35 §5 W16; HANDOFF-2026-09-18 §5 C2; `src/services/visit.ts` vocabulary; F13)
| Unit | Ruled outcome | Legs |
|---|---|---|
| W16.C2.01 | An ordinary search referrer (`https://www.google.com/search?q=…`, and each host family in `SEARCH_HOSTS`: bing, duckduckgo, yahoo, ecosia, baidu, yandex, brave, startpage) with no UTM classifies as `organic`. | logic |
| W16.C2.02 | A lookalike host (`google.com.evil.example`, `notgoogle.com`, `evilgoogle.co`) never classifies as search or social: host matching is exact or dot-boundary suffix, never substring or prefix. | logic |
| W16.C2.03 | A social source with a paid medium (`utm_source=facebook|instagram|meta|tiktok|pinterest`, `utm_medium=cpc|ppc|paid|paid_social|cpm`) classifies as `paid_social` before any paid-search rule. | logic |
| W16.C2.04 | Absent referrer, absent UTM and an unrecognized `utm_medium` never invent `direct`: the entry stays unknown (`entryChannelOf` null / no entry recorded) and no first visit is fabricated; `direct` only when the referrer is empty or same-site on a real page view. | logic, host |
| W16.C2.05 | An established owned visit entry channel wins over a request-supplied fallback channel on the content decision path (`src/content/service.ts`), on both hosts. | host |
| W16.C2.06 | Read-time idle rollover: after `VISIT_GAP_MS` of inactivity the next read yields the next visit number and a freshly classified entry channel; within the gap both are unchanged. Both hosts agree. | logic, host |
| W16.C2.07 | Visit number and entry channel are identical for the same event sequence through the SessionManager path and the ShopperReflex path, and appear identically in the SDK-visible projection. | host |
| W16.C2.08 | SDK: the cached entry is cleared on consent transition, identity-generation change and browsing-session rollover before entry signals are recomputed; `entrySessionId` names the session that produced the entry. | sdk |
| W16.C2.09 | Vocabulary validation: `validEntry`/`entryChannelOf` reject values outside the six-value channel vocabulary and hosts that are not valid hostnames; oversize query strings beyond `ENTRY_QUERY_LIMIT` are refused, not truncated into a wrong channel. | logic |

### BASE — the baseline residual
Triage (L2, 2026-09-18) measured the 29 failing files serially on `5b0b0ae`: 238 of 786 tests fail, identical to the parallel set; **zero flaky**. Groups by shared cause (full table in `_evidence/BASE/triage/REPORT.md`):

| Group | Cause (remedy the stale tests predate) | Count | Owning W | Honest fix |
|---|---|---|---|---|
| A | Publication authority is the only configuration authority; fixtures lack a published head or use an R2 double that violates the put/get contract | 96 | W11 (demo files also W37) | test fixtures seed a publication head |
| C | Consent fail-closed; legacy preferences grant nothing | 35 | W05 | test fixtures establish explicit consent |
| B | Configuration writes need `If-Match` + `Idempotency-Key` preconditions | 29 | W11 | test calls carry the preconditions |
| E | Shopper routes are owner-dispatched; fixtures lack the `SHOPPER_REFLEX` binding or drive a sub-router off the real path | 18 | W04 + W35 | tests bind the namespace and drive the mounted app |
| F | Identity material required at readiness | 6 | W02 | fixture supplies synthetic safe material |
| D | Retention policy registry required before a first record | 5 | W06 | fixture supplies the registry |
| G | The three W16 draft edits (search-host prefix tokens, paid_social cell key) | 3 | W16 | product fix, already W16.C2.01–.03 |
| I | Stale DO/socket doubles lack `transaction` and `close` | 3 | W35 | doubles updated |
| H | Console heading "Exposures" replaced "Shown" | 2 | W26 | tests updated to the exposure unit |
| J | Residue not yet attributed; contains one candidate REAL fail-open regression (`index.api-boundary.test.ts:2004`, W01.04: `/track/event` answers 200 where 503 is required) | 41 | mixed; the regression is W09 with W01 | read per clause; the regression is a product unit `W09.BASE.01` once isolated |

Plan: BASE-2 (L3) and BASE-1a (L4) run now in disjoint files. BASE-1b (shopperReflex.*, routes/identity, routes/sort, auth.refresh-boundary, routeEscape, api-boundary B-part, brands: groups A/B/E/I/D-part) and BASE-1c (brighthour, learn, console, telemetry, freshFatigue, regionTrend: groups A/H/J-learn) follow when L3/L4 return. `W09.BASE.01` is briefed to an implementer once the score tool exists so the ratchet can be run.

## Commits

| Sha | What |
|---|---|
| `7b01c14` | Checkpoint: worktree exactly as found (product, docs, scripts). |
| `7260f02` | Frozen evidence and tracker. |
| `5b0b0ae` | Method takeover: METHOD.md, agents, AGENTS.md, LANE-LOG.md, RESUME.md. |
