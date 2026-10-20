# BTI parity amendment 9 — the acknowledgement admitted at the decision's time; the witness budget sized for the edge; the object host's buffered re-decision (2026-10-20)

Opened by the remediation lead under the owner's standing rule of 2026-10-16 (R-P78) on lane L9's live findings (`_evidence/parity-step3/live/lanes/L9/REPORT.md`), the analysis `_evidence/baseline-52/ack-401/ANALYSIS.md` (ACK-401, R-P171) and the P67 build's finding (R-P170). Three tickets, P69–P71, in strict order; an independent programme beside amendments 5–8.

## 1. The findings

(a) **A lagging device clock loses every acknowledgement.** `src/content/renderOffer.ts:102` refuses a render acknowledgement whose client timestamp is earlier than the decision's engine time, with no tolerance, since the 2026-09-18 checkpoint. The route bounds client time only from above (`src/routes/realtime.ts:186-187`). A visitor whose device clock lags the engine's by more than the decision-to-acknowledgement time (hundreds of milliseconds) loses the viewable impression, the dwell and the click credit of every rendered-v1 placement, silently: the answer is the generic `401 Shopper session unavailable`, no log line names the cause, the SDK never re-sends an answered acknowledgement and later attempts carry the same timestamp. Reproduced locally at every release since the first (20/20 refused with the client 150 ms behind); on the hosted pair the walker machine's own clock lag produced 374 refusals of 1,828 first acknowledgements on 2026-10-20.

(b) **The witness budget does not fit the edge.** Amendment 6's P62 set the lift witness and ring read budgets to 200 ms. On the hosted pair a cold witness read takes 202–467 ms, so the lift is withheld as `late` on most cold reads (lane L9: 0 of 18 rows; the §2 probe served 15 of 24 readers at 20 s and 3 of 24 at 75 s). With P62's bounded override set to 600 ms on the pair's fourth release the lift is served (lane L10's measurement fixes the number).

(c) **The object host's buffered `profile_missing` re-decision never fires.** P65's alarm re-decides a carried outcome's drop before writing it; on the object host `ShopperReflex.ts:4029` tests `this.affinity === undefined` while `load()` sets `null`, so a buffered-door event with no profile, reset between its admissions, gets an outcome the engine would have dropped.

## 2. The tickets

**P69 — the acknowledgement is admitted at the decision's time.** On both hosts, a render acknowledgement whose client timestamp is earlier than the decision's engine time is admitted with `admitted.at` (and the behaviour record's time) equal to the decision's time, never refused for that reason; a client clock ahead of the engine is still clamped to the engine's present (W23); a re-send keeps the first admission's time (P57); `rendered.at >= ts` holds on every ledger row; no new remote call before the answer; the other refusals of P56 AA4 (unknown decision, another shopper's decision, outside the window) unchanged; kit 02 :933 says it. The specification updates P56 AA4's ":434 a time before the decision is refused" variant (test-only, R10).

**P70 — the witness and ring budgets fit the edge.** The defaults of `LIFT_WITNESS_BUDGET_MS` and `RING_READ_BUDGET_MS` are set from the hosted measurement (lane L10's cold-read distribution under the 600 ms override: at least the measured p99 of a cold witness read on both hosts, rounded up to the next 100 ms), the bounded override and its ceiling unchanged, `sources.budgets` reporting the new defaults; the kit states the number and where it comes from; every unit of P62 that derives from the constant (and the R10 lines ccc9294c) follows the constant.

**P71 — the object host's buffered re-decision fires.** On the object host a buffered-door event with no profile, reset between the behaviour capture's admission and the outcome's, gets NO outcome record after the alarm (the re-decision reads the loaded `null` as "no profile"); the session host unchanged; P65's other legs unchanged.

## 3. Acceptance

Each ticket: RED units on both hosts in `src/units/P6x/LEDGER.unit.test.ts` / `src/units/P7x/LEDGER.unit.test.ts`, reviewed honest; the build reviewed on its exact sha; one official gate per round; the stamps redeployed; the live rows follow the parity programmes' rule (P69 and P70 re-walked on the acceptance pair's fifth release with the walker's clock measured against the engine's).
