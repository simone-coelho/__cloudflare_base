# Parity programme, amendment 2: operator warnings (the owner's standing rule)

**For Simone, as contract authority, and for the active lead session.** Written 2026-10-16 by the lead session, from the owner's ruling of the same day and the delivery reviews of P08, P15, P16 and P26 (`_evidence/parity-step3/AMENDMENTS.md`, closure lines and R-P78).

## 1. Why an amendment, and what the owner ruled

`tapestry-parity-build` (25 tickets) and `tapestry-parity-customer-answers` (5 tickets) are locally complete: every ticket carries a DELIVERY receipt on `rem/integration`. A change to a receipted ticket's criteria invalidates its receipt, and a change to a programme's denominator invalidates every receipt in it (amendment 1, section 1). So nothing is added to either programme and no receipted ticket is amended. The four behaviours below are carried by **a third programme** of new tickets, run under the same integration gate, in STRICT order, one ACTIVE at a time.

The owner's rule, given once in chat on 2026-10-16 and recorded as R-P78: **when a behaviour would surprise the visitor or the operator, the product tells them**, with a warning at publication, an advisory on the answer or a diagnostic on the record. The lead does not bring such points to the owner as questions; each becomes a ticket, specified and built under the method, and is reported. The decision of every ticket below is therefore RESOLVED by that rule; nothing is open.

## 2. The four tickets, in the ticket file's form

### P41 · A conversion table that omits the slot's own reward says so

- **Authority:** R-P78; P16's closure (reading d, the reviewer's observation): a table published without the slot's own reward is answered 200 with no advisory, and from then on every undeclared piece on that slot is credited `{event: <slot reward>, value: null}` and earns nothing (`src/content/kinds.ts:1703-1714` at 34f1c074; kit 02 :997-999, kit 03 :1143-1144).
- **Done when:** on both hosts, publishing or validating a learn document whose slot carries a `conversions` table that does not name the slot's own reward still succeeds, and the answer carries an advisory in the publication's existing advisory shape that names the slot, the omitted reward and the consequence (undeclared pieces on that slot earn nothing); a table that names the slot's reward carries no such advisory; the console shows the advisory where it shows publication advisories today, if such a surface exists for the learn document, else nothing; credits, records, receipts, replay and every P16 unit are unchanged; kit 02 and 03 state the advisory.
- **Starts from:** `src/content/kinds.ts:1633-1637, 1703-1714` (the table's validation); `src/routes/content.ts:434-460` (the advisory channels of a publication); `src/content/catalogDiagnostics.ts:20` (the advisory record shape); the P16 unit file's TABLE fixture.
- **Allowed paths:** `src/content/kinds.ts`, `src/routes/content.ts`, `src/content/catalogDiagnostics.ts`, `src/content/slotDiagnostics.ts`, `public/console/views.js`, `docs/kit/02-api-reference.md`, `docs/kit/03-payload-schemas.md`.
- **Relates to:** P16 (receipted; its units are locks here), W19 (the advisory channel).

### P42 · A pooled publication that fails closed names the faulty page, and the stale slot says it is stale

- **Authority:** R-P78; P08's closure (reading 1, probe R7): with a sibling page's `/pooled` door answering 500, the placement's `/publish` answers 503 "statistics recovery required" and the slot's snapshot stays at its last version for every module, pooled or not, until the next successful publish (`src/durable-objects/LearnStats.ts:129, 1146-1163` at cde6f02a).
- **Done when:** on both hosts, when a pooled publication fails because a sibling placement's statistics cannot be read, the publication's refusal names the faulty page and slot and the pooled modules it carries, and says the slot's snapshot stays at its last successful version; the slot's operator read surfaces (`GET /v1/:tenant/lift` and `/lift/rows`, `src/routes/decisions.ts:444, 741`) report the snapshot as stale, naming the failing placement and the last successful publish, until a later publish succeeds, after which the marker is gone; a slot whose publications succeed reads and publishes byte for byte as today; the recovery refusal of every other cause keeps today's text; kit 02 and 03 state it.
- **Starts from:** `src/durable-objects/LearnStats.ts:416-430` (the door), `:1146-1163` (the assembly), `:129` (the refusal); `src/learn/stats.ts` (the snapshot type); `src/routes/decisions.ts:444-760` (the lift reads); `src/learn/rows.ts` (the grid rows).
- **Allowed paths:** `src/durable-objects/LearnStats.ts`, `src/learn/stats.ts`, `src/learn/fan.ts`, `src/learn/rows.ts`, `src/routes/decisions.ts`, `docs/kit/02-api-reference.md`, `docs/kit/03-payload-schemas.md`.
- **Relates to:** P08 (receipted; its units are locks here), W26 (page-scoped names), W24.

### P43 · A pin inside an unshown module's inner slot is reported

- **Authority:** R-P78; P26's closure (further reading 3): P04 reserves every valid pin page-wide before any ranking, so a piece pinned inside an inner slot whose module the layout does not return is served nowhere on that page view, and because the inner slot is never decided its pin is not reported (`src/reflex/contentCompose.ts:403-470` at 5a69dacc; kit 02 states the reservation).
- **Done when:** on both hosts, when a layout does not return a module whose inner slot carries a pin, the page's pin diagnostics (the existing `pinDiagnostics` shape, `src/content/decide.ts:407, 1258`) carry an entry naming the inner slot, its module, the layout slot and the piece, with a reason that says the pin stayed reserved and unserved because the module was not returned; the served decisions, records, receipts, replay and the reservation itself are unchanged (the piece stays reserved, as ruled); a page without `inner` and a page whose every module is returned carry no such entry; kit 02 and 03 state it.
- **Starts from:** `src/reflex/contentCompose.ts:403-470, 823-881`; `src/content/decide.ts:1258-1340` (the diagnostics the answer carries); the P26 unit file's fixture (the user-generated module not returned).
- **Allowed paths:** `src/reflex/contentCompose.ts`, `src/content/decide.ts`, `src/content/types.ts`, `public/meridian/engine.bundle.js`, `docs/kit/02-api-reference.md`, `docs/kit/03-payload-schemas.md`.
- **Relates to:** P26 and P04 (receipted; their units are locks here), P15 (the composer).

### P44 · No false "ignored field" for `pooled` and `successEvent`

- **Authority:** R-P78; P08's and P16's closures: the W19 pieces-contract lock `src/units/W19/B3.unit.test.ts:461-462` pins `PIECE_FIELDS` (`src/content/kinds.ts:48`) to a frozen literal, so both validators keep the new members without listing them, and a direct publication declaring either answers 200 with an `ignored_field` advisory that is false; `FEED_FIELDS` derives from the same list (`src/content/import.ts:79`), so a feed import or pull drops both members. Ruled at P08's close as owed at W19's next touch; this is that touch.
- **Done when:** on both hosts, a direct publication declaring `pooled` or `successEvent` answers 200 with no `ignored_field` advisory for those members, an unknown field still gets the advisory (W19's contract kept), and a feed import or pull keeps both members on the piece; kit 03's piece table lists both; the W19 lock is corrected under R10 by the specifier, in the same form as R-P75 (derived from the validator's field list, so the contract keeps its meaning under any later ruled member), with every other W19 assertion unchanged.
- **Starts from:** `src/content/kinds.ts:48-50, 263-273` (the list and the advisory); `src/content/import.ts:79-120` (the feed fields); `src/units/W19/B3.unit.test.ts:461-490` (the lock).
- **Allowed paths:** `src/content/kinds.ts`, `src/content/import.ts`, `src/units/W19/B3.unit.test.ts` (the specifier's R10 correction only; the builder never edits a test), `docs/kit/02-api-reference.md`, `docs/kit/03-payload-schemas.md`.
- **Relates to:** W19 (receipted; its receipt stands, the correction is test-only, as R-P75), P08, P16.

## 3. Decisions

One decision per ticket, D1, RESOLVED by the owner's rule of 2026-10-16 (R-P78): the product tells the operator; the representation of the telling (the advisory record's fields, the stale marker's members, the diagnostic entry's reason word) is the specifier's to rule in the existing shapes and is judged by rem-reviewer in the specification review. No decision is open.

## 4. Order, gate and acceptance

STRICT order P41, P42, P43, P44; one ACTIVE at a time; the same integration gate command as the first two programmes (the whole `src` suite serial, the ratchet against the 52-entry baseline, both typechecks, both bundle checks); each ticket's acceptance command runs `src/units/<P>` serially. Specification batch S6 on one lane cut from `rem/integration` after this amendment is committed; per-ticket branches cut by plumbing (R-P4); each ticket built in its own lane and reviewed at the exact artifact commit before its receipt.

## 5. Deferred live acceptance

Each ticket carries LIVE1: deployed-runtime acceptance on both shopper hosts with the released artifact, in the batched live acceptance of the parity programmes (the deployment owner with the customer acceptance owner). P44 has no customer-facing surface; its LIVE1 is the kit reader's check of a direct publication on the deployed host.
