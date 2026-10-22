# BTI parity amendment 7 — the outcome is told and survives a reset; every refusal crosses the object boundary typed (2026-10-20)

Opened by the remediation lead under the owner's standing rule of 2026-10-16 (R-P78) on the analysis `_evidence/baseline-52/outcome-k3/ANALYSIS.md` (OUT-K3, 2026-10-19), the P58 delivery review's residual (`_evidence/parity-step3/P58/reviewer/REPORT.md`, finding 2) and the P60 delivery review (`P60/reviewer/REPORT.md`, request count). Three tickets, P64–P66, in strict order; an independent programme beside amendments 5 and 6.

## 1. The findings

(a) A tracked action that produces an outcome answers 200 with the behaviour record named (`behavior.recordId`) but **never names its outcome record**; a failure before the outcome's durable admission is swallowed into a `learning_incomplete` log line, and the monitor's lost-evidence counter (`producerFailed`) is incremented only on the path without durable recovery, so an operator cannot see that an accepted event produced no outcome. Four live reads of the first acceptance round were misdiagnosed for lack of that member (R-P119).

(b) A Durable Object reset between the behaviour capture's durable admission and the outcome's durable admission **loses the outcome for good**: the client receives a 500, the SDK does not resend an ordinary action, and the alarm later completes the behaviour record only (reproduced at 39ebf0d2 and at the amendment-5 head on both hosts, OUT-K3 §2 case b1).

(c) Two more identity merges still cross the object boundary untyped natively: the account-change merge (`handleAccountChange`, `applyAccountChange`) and the absorb merge (`handleAbsorb`); P58 typed only the oversized link merge (R-P106). A client error on those paths still reaches the shopper as an untyped 500 on the deployed runtime.

## 2. Requirements

**P64 — the outcome is told.** On both shopper hosts, the answer to a tracked action that emits an outcome names it: `outcome: { recordId }` beside `behavior`, built from the same engine time the behaviour record carries; a dropped event, a tracking-refused event and an action without a reward carry no `outcome` member; a failure before the outcome's durable admission counts once in the monitor's lost-evidence counter (`producerFailed`) for the tenant and is still logged; the clamp (`realtime.ts:183-184`), the `outcome_id` format (`records.ts:411`), the `behavior` member, the status codes and amendment 5's answer-at-admission (no new wait on the answer path) do not change; kit 02 and 03 state the member.

**P65 — the outcome survives a reset.** On both hosts, once a tracked action's behaviour capture is durably admitted, its outcome is durably admitted in the same transaction or by a mechanism that a reset between the two cannot defeat (an outcome whose admission fails after the behaviour's is written by the alarm, or the behaviour's admission is not committed without the outcome's); a reset injected between the two admissions therefore leaves, after the alarm, exactly one behaviour record and one outcome record with the unit's content; the client's answer in that case is the typed answer the route gives today for a reset (not a silent 200 without an outcome); W06's digests, the idempotent replay and amendment 5's answer-at-admission unchanged.

**P66 — every merge refusal crosses typed.** On both hosts and natively (workerd), a validation refusal raised in the account object during the account-change merge or the absorb merge reaches the shopper as the route's own `400 Validation error` with the same issues, never an untyped 500, through the same typed shape P58 introduced (`validationRefusal` / `validationRefusalOf`, `link.ts`'s typed read); no message string is parsed; the oversized link merge's behaviour (P58) unchanged.

## 3. Acceptance

Each ticket: RED units on both hosts in `src/units/P6x/LEDGER.unit.test.ts` (P66 with native legs through `src/units/_native.ts` as P58's BA4), reviewed honest; the build reviewed on its exact sha; one official gate per round; the stamps redeployed; the live rows follow the parity programmes' rule.
