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
| R9 | 2026-09-18 | Project role files under `.claude/agents/` are discovered only at session start. In the session that created them, lanes are dispatched through the general-purpose agent on Opus with the role file as the mandatory first read; from the next session the `rem-*` types are used directly. The dependency symlink `node_modules` is excluded via `.git/info/exclude` so every worktree reports a clean porcelain status. |

## Lanes

| Lane | Batch | Role / agent | Checkout · branch · base | State |
|---|---|---|---|---|
| L0 | TOOLS-1 score tool, ratchet, CI wiring, tsconfig include | rem-implementer (general-purpose/Opus, role file first) | `/home/simonecoelho/rem/tools` · `rem/tools-score` · `5b0b0ae` | dispatched 2026-09-18 18:50 |
| L1 | W16-B1 (C2 visit/channel, 9 units) | rem-specifier (general-purpose/Opus, role file first) | `/home/simonecoelho/rem/spec` · `rem/w16-c2-spec` · `5b0b0ae` | dispatched 2026-09-18 18:50 |
| L2 | BASE triage of the 238 baseline failures | rem-reviewer TRIAGE (general-purpose/Opus, role file first) | `/home/simonecoelho/rem/triage` · detached at `5b0b0ae` | dispatched 2026-09-18 18:50 |

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
Triage first (L2). Then units under the owning W, named from the triage, smallest cluster first.

## Commits

| Sha | What |
|---|---|
| `7b01c14` | Checkpoint: worktree exactly as found (product, docs, scripts). |
| `7260f02` | Frozen evidence and tracker. |
| `5b0b0ae` | Method takeover: METHOD.md, agents, AGENTS.md, LANE-LOG.md, RESUME.md. |
