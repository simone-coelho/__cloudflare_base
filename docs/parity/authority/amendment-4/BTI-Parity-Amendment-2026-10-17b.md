# Parity programme, amendment 4: operator warnings, third batch (the owner's standing rule)

**For Simone, as contract authority, and for the active lead session.** Written 2026-10-17 (evening) by the lead session, from the owner's rule R-P78 and the delivery reviews of P45 to P49 (`_evidence/parity-step3/AMENDMENTS.md`, the P49 closure line). The owner is told, not asked: each item would surprise an operator, so each becomes a ticket.

## 1. Why a fourth amendment

`tapestry-parity-operator-warnings-2` (amendment 3, P45 to P49) is frozen and locally complete. Its reviews named six further surprises outside their boundaries. They form a fifth programme, `tapestry-parity-operator-warnings-3`, six tickets in STRICT order P50 to P55, specified in one batch S8 on a lane cut from `rem/integration` after this amendment is committed, built and reviewed one at a time under the same gate.

## 2. The six tickets, in the ticket file's form

### P50 · A generation transition that does not adopt the changed member says so, or is refused

- **Authority:** R-P78; P49's review (§10, 7.3, measured with a control at head and base): after a learn republish changes a slot's accumulation tuple, an operator's `POST /v1/:tenant/learn/generation` that does not adopt the changed member (a measurement-basis change, which no transition can move, `src/durable-objects/LearnStats.ts:808`; or a reward change whose body omits `reward`, `:805-806`) ends P49's refusal and publications answer 200, while the slot's exposures stop being counted (events stay at 0 after a visit); a transition naming the new reward counts them.
- **Done when:** on both hosts, a transition whose body does not adopt every changed member of the tuple is either refused with words naming the member it must adopt and how (the body's `reward`, `objective`, or a republish restoring the basis), or, where the specifier rules the transition may proceed, the answer and the lift reads carry a warning that the slot counts no exposure until the named member is adopted; a transition that adopts every changed member behaves byte for byte as today; P49's and P42's units unchanged; kit 02 and 03 state it.
- **Starts from:** `src/durable-objects/LearnStats.ts:790-870` (the transition), P49's `republished` member and words, `src/routes/decisions.ts` (the generation route, :1649 the 400 for a body naming only the slot), the P49 review's control scripts (`_evidence/parity-step3/P49/reviewer/scripts/`).
- **Allowed paths:** `src/durable-objects/LearnStats.ts`, `src/learn/stats.ts`, `src/learn/fan.ts`, `src/routes/decisions.ts`, `docs/kit/02-api-reference.md`, `docs/kit/03-payload-schemas.md`.
- **Relates to:** P49 and P42 (receipted; their units are locks), P08, W24.

### P51 · The console's lift grid shows the republish cause

- **Authority:** R-P78; P49's review (§11): `GET /v1/:tenant/lift/rows` carries `republished` after a refused publication, but the console's lift grid (`public/console/views.js:326-332`, P45's mark reads `stale` only) shows nothing of it.
- **Done when:** on the console's lift grid, a slot whose lift/rows answer carries `republished` is marked, in P45's idiom, naming the slot, each changed member with its old and new values and what ends it, beside or within P45's mark when both apply, and loses the mark when the answer no longer carries it; a slot without the member renders byte for byte as today; the grid makes no new request; kit 02 states it (its sentence that the grid does not show it is gone).
- **Starts from:** `public/console/views.js:320-345` (P45's mark), the P49 unit file's member shape, kit 02's lift/rows row.
- **Allowed paths:** `public/console/views.js`, `docs/kit/02-api-reference.md`, `docs/kit/03-payload-schemas.md`.
- **Relates to:** P45 and P49 (receipted; their units are locks).

### P52 · A stored conversion table that omits the slot's reward is told on the Dials screen before the first edit

- **Authority:** R-P78; P46's review (§11): no learn read carries P41's `diagnostics`, so an operator who opens the Dials screen on a stored omitting table is told nothing until the first edit or save (P41's design; P46 renders only the check's and the save's answers).
- **Done when:** on both hosts, the learn document's read (`GET /content/learn`) carries P41's envelope as an advisory member when the stored document has at least one warning and nothing otherwise, byte for byte today's answer in that case; the Dials screen renders it on open in P46's element idiom (valued for the read), and clears or replaces it as P46 rules for the check and the save; the publication, credits, records and replay unchanged; P41's, P46's and P16's units unchanged; kit 02 and 03 state it.
- **Starts from:** `src/routes/content.ts` (the learn read), `src/content/kinds.ts:1857` (`learnConversionDiagnostics`), `public/console/views.js` (P46's element), kit 02:1061-1063.
- **Allowed paths:** `src/routes/content.ts`, `src/content/kinds.ts`, `public/console/views.js`, `docs/kit/02-api-reference.md`, `docs/kit/03-payload-schemas.md`.
- **Relates to:** P41, P46, P16 (receipted; their units are locks).

### P53 · The Slots screen says how many unreturned pins it does not name

- **Authority:** R-P78; P47's review (§11): past the 10-name cap, the Slots screen names ten unreturned pins and draws no "more … not named" line (`public/console/views.js:391-400`; the refusals path has one at `:378`); the count line gives the total.
- **Done when:** the Slots screen draws the same "n more … not named" line for unreturned pins as for refusals when the block's `unreturnedPinCount` exceeds its named entries; a block within the cap renders byte for byte as today; P47's units unchanged; kit 02 states it.
- **Starts from:** `public/console/views.js:375-400`, the P47 unit file's block shape.
- **Allowed paths:** `public/console/views.js`, `docs/kit/02-api-reference.md`.
- **Relates to:** P47 (receipted; its units are locks), W20.

### P54 · A customer-profile tenant with a four-member set is given its path

- **Authority:** R-P78; P48's review (§11, measured on the real Worker on both hosts): a customer-profile tenant whose publication set has four members (producible only through a W38 retained adoption) is told by P48's words to take `POST /ops/demo-bootstrap/complete`, which on the customer profile answers 404; the W08-C1 door answers `already initialized`.
- **Done when:** on the customer profile, a stamp owner (the W08-C1 door's authority) can add the two compiled empties to a committed four-member set once, through the W08-C1 door or a sibling under the same authority, idempotent, writing nothing on any refusal; the words a four-member tenant's reads carry name the path that exists on that profile; a six-member tenant and the W08-C1 door's existing answers byte for byte as today; P48's and W08's units unchanged; kit 02 states it.
- **Starts from:** `src/routes/content.ts` (the W08-C1 door, :1037-1083), `src/config/publication.ts` (P48's `completePublicationSet` and `absent()`), `src/units/W08/C1.unit.test.ts`.
- **Allowed paths:** `src/routes/content.ts`, `src/config/publication.ts`, `src/customerBoundary.ts`, `docs/kit/02-api-reference.md`.
- **Relates to:** P48, W08-C1 (merged; their units are locks), D01 (creation only, no overwrite).

### P55 · After a transition whose own publication failed, the reads tell the truth

- **Authority:** R-P78; P49's review (§10, 7.2): when the generation transition's own publication fails on the pooled cause, the lift reads keep `republished` ("until an operator starts the new generation") after the operator has started it, while the publish answer names the pooled cause.
- **Done when:** on both hosts, once a transition for the slot is on record, the lift reads no longer say the transition is what ends the refusal: the specifier rules whether the transition supersedes P49's record with one put after its transaction, or whether the member's `endedBy` and words change to name what now ends it (the pooled fault, P42's marker); every other P49 and P42 behaviour unchanged; kit 02 and 03 state it.
- **Starts from:** `src/durable-objects/LearnStats.ts:845-860` (the transition's transaction), P49's record and `staleMarkerIn`-style lapse, P42's marker.
- **Allowed paths:** `src/durable-objects/LearnStats.ts`, `src/learn/stats.ts`, `src/learn/fan.ts`, `src/routes/decisions.ts`, `docs/kit/02-api-reference.md`, `docs/kit/03-payload-schemas.md`.
- **Relates to:** P49 and P42 (receipted; their units are locks).

## 3. Decisions

One decision per ticket, D1, RESOLVED by the owner's rule of 2026-10-16 (R-P78): the product tells the operator; the representation is the specifier's to rule in the existing shapes and is judged by rem-reviewer in the specification review. P50's choice between refusing and warning, P55's choice between superseding and renaming, are the specifier's inside fail-closed. No decision is open.

## 4. Order, gate and acceptance

STRICT order P50, P51, P52, P53, P54, P55; one ACTIVE at a time; the same integration gate command as the first four programmes; each ticket's acceptance command runs `src/units/<P>` serially. Specification batch S8 on one lane cut from `rem/integration` after this amendment is committed; per-ticket branches cut by plumbing (R-P4); each ticket built in its own lane and reviewed at the exact artifact commit before its receipt. Live acceptance of each ticket is one DEFERRED_LIVE row, pending the owner's batched acceptance. Nothing here changes a receipted ticket's criteria.
