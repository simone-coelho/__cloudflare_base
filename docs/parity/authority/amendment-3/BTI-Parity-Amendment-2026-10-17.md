# Parity programme, amendment 3: operator warnings, second batch (the owner's standing rule)

**For Simone, as contract authority, and for the active lead session.** Written 2026-10-17 by the lead session, from the owner's rule R-P78 and the delivery reviews of P41, P42 and P43 and the W08-C1 and live-rehearsal findings (`_evidence/parity-step3/AMENDMENTS.md`). The owner is told, not asked (R-P78): each item below would surprise an operator, so each becomes a ticket.

## 1. Why a third amendment

`tapestry-parity-operator-warnings` (amendment 2, P41 to P44) is frozen at four tickets; a change to its denominator would invalidate its receipts (amendment 1, section 1). The reviews of its own tickets named further surprises that sit outside their boundaries. They form a fourth programme, `tapestry-parity-operator-warnings-2`, five tickets in STRICT order P45 to P49, specified in one batch S7 on a lane cut from `rem/integration` after P44's receipt, built and reviewed one at a time under the same gate.

## 2. The five tickets, in the ticket file's form

### P45 · The console's lift grid shows a stale slot

- **Authority:** R-P78; P42's closure: `GET /v1/:tenant/lift/rows` carries the `stale` marker for a slot whose pooled publication was refused, but the console's lift grid (`public/console/views.js:131` reads lift/rows; nothing in that file reads `stale`) shows the old numbers with no warning, so an operator who works only in the console is not told (P42/reviewer/REPORT.md §11).
- **Done when:** on the console's lift grid, a slot whose lift/rows answer carries `stale` is marked stale beside its numbers, naming the faulty page and slot and the last successful publish from the marker's members, and loses the mark when the answer no longer carries it; a slot without the marker renders byte for byte as today; the grid makes no new request; kit 02 states it (replacing its sentence that the grid does not show the marker, kit 02 and 03 at P42's close).
- **Starts from:** `public/console/views.js:120-180` (the lift grid), the P42 unit file's marker shape (`src/units/P42/LEDGER.unit.test.ts:43-49`), kit 02's lift/rows row.
- **Allowed paths:** `public/console/views.js`, `public/console/*.css` if a style is needed, `docs/kit/02-api-reference.md`, `docs/kit/03-payload-schemas.md`.
- **Relates to:** P42 (receipted; its units are locks), W24.

### P46 · The console's dials screen shows a learn publication's advisory

- **Authority:** R-P78; P41's closure: `PUT /content/learn` and its validate door answer a `diagnostics` advisory when a conversion table omits the slot's own reward, but the console's dials screen (`public/console/views.js:440-480`) saves the document and renders no publication advisory, so an operator who publishes from the console is not told (P41/reviewer/REPORT.md §7).
- **Done when:** on the dials screen, a save or validate whose answer carries `diagnostics` renders each warning's slot, reward and consequence next to the result, and a rollback or check that carries none renders as today; the screen makes no new request; an answer without the member renders byte for byte as today; kit 02 states it.
- **Starts from:** `public/console/views.js:440-480`, the P41 unit file's envelope (`src/units/P41/LEDGER.unit.test.ts` header), `src/content/kinds.ts:1857` (`learnConversionDiagnostics`).
- **Allowed paths:** `public/console/views.js`, `public/console/*.css` if a style is needed, `docs/kit/02-api-reference.md`.
- **Relates to:** P41 (receipted; its units are locks), P16.

### P47 · An unreturned module's pin is not called a refusal

- **Authority:** R-P78; P43's closure: the `module_not_returned` entry rides the set's `pinDiagnostics`, so the governance counters (`src/content/service.ts:1050`) count it as a pin refusal, the ops monitor's tenant-level `refusedPinCount` (`src/ops/monitor.ts:703`) rises on every such page view, and the console's Slots screen labels it "pin refusal" (`public/console/views.js:340-353`) although kit 02 says it refuses nothing (P43/reviewer/REPORT.md §11).
- **Done when:** the governance record and the monitor count a `module_not_returned` entry apart from refusals (a separate count in the existing record shape; the refused count no longer rises for it); the Slots screen labels it in its own words (reserved, unserved: the module was not returned) with its module and layout slot; a page with refusals only counts and renders as today; the answer's `pinDiagnostics`, `refusedCount` and `omittedCount` keep P43's receipted shape unless the specifier rules that the answer's counts must also separate, in which case P43's kit sentences are corrected and P43's units stay green; kit 02 and 03 state it.
- **Starts from:** `src/content/service.ts:1040-1060`, `src/ops/monitor.ts:690-710`, `public/console/views.js:340-353`, the P43 unit file's entry shape.
- **Allowed paths:** `src/content/service.ts`, `src/ops/monitor.ts`, `src/content/decide.ts`, `src/routes/decisions.ts`, `public/console/views.js`, `docs/kit/02-api-reference.md`, `docs/kit/03-payload-schemas.md`.
- **Relates to:** P43 and P26 (receipted; their units are locks), W20 (governance), W36 (the monitor).

### P48 · A bootstrapped tenant's priors and proposals doors answer, not 503

- **Authority:** R-P78; the live rehearsal (R-P79, lanes L1 to L4) and the W08-C1 analysis: the demo bootstrap seeds four members (`src/routes/demoBootstrap.ts:46`: reflex, catalog, slots, learn) while the publication set has six (`scripts/init-local.mjs:131-139` and the W08-C1 door seed priors and proposals too), and a later publish of a non-optional member absent from the set is refused (`src/config/publication.ts:616-617`), so on every tenant bootstrapped through the demo door the priors and proposals doors answer 503 forever and the operator is not told why.
- **Done when:** a tenant bootstrapped through the demo door reads and publishes priors and proposals as an init-local tenant does (the specifier rules whether the door seeds the compiled empties for the two members when the caller does not supply them, keeping existing four-member callers working, or whether a repair publishes the missing members into an existing four-member set once, under the same operator authority; both leave "nothing discovered or inferred" true for the four supplied members); an already-bootstrapped four-member tenant has a named path to the same state; the priors and proposals reads of a tenant that still lacks them answer a refusal naming the missing member and the path, not a bare 503; kit 02 states it.
- **Starts from:** `src/routes/demoBootstrap.ts:40-120`, `src/config/publication.ts:600-640`, `scripts/demo-kit/lib/host.mjs` (the hosted seed's bootstrap call), `src/routes/content.ts` (the W08-C1 door as the six-member pattern).
- **Allowed paths:** `src/routes/demoBootstrap.ts`, `src/config/publication.ts` (the refusal's words only), `src/routes/content.ts`, `scripts/demo-kit/lib/host.mjs`, `docs/kit/02-api-reference.md`.
- **Relates to:** W08-C1 (merged 1f33f00c), P35, the acceptance rig (R-P79).

### P49 · A learn republish does not leave a bare "statistics recovery required"

- **Authority:** R-P78; the live rehearsal and P42's reading (e): after an authorized republish of the learn document that changes a slot's reward or basis, the placement's publications are refused by the configuration check with the text "statistics recovery required" and no more words until the statistics object transitions, so for a window the operator's publish and lift reads show a recovery refusal that names no cause and no end (P42/implementer/REPORT.md §6(e); `src/durable-objects/LearnStats.ts` publish path and its configuration check).
- **Done when:** on both hosts, after an authorized learn republish that changes the accumulation tuple, the operator's publish answer and the lift reads either succeed or answer a refusal that names the republish as the cause (the slot, the member that changed, the old and new values) and says what ends it (the generation transition, by whom or when); the refusal of every other cause keeps its text; a republish that changes nothing in the tuple is not refused; kit 02 and 03 state it.
- **Starts from:** `src/durable-objects/LearnStats.ts` (the configuration check before the pooled read; the generation transition; `publish()` at :1000), `src/learn/stats.ts`, `src/routes/decisions.ts` (the publish route's pass-through), P42's probe sources (`_evidence/parity-step3/P42/implementer/scripts/`).
- **Allowed paths:** `src/durable-objects/LearnStats.ts`, `src/learn/stats.ts`, `src/learn/fan.ts`, `src/routes/decisions.ts`, `docs/kit/02-api-reference.md`, `docs/kit/03-payload-schemas.md`.
- **Relates to:** P42 and P08 (receipted; their units are locks), W24, W25.

## 3. Decisions

One decision per ticket, D1, RESOLVED by the owner's rule of 2026-10-16 (R-P78): the product tells the operator; the representation is the specifier's to rule in the existing shapes and is judged by rem-reviewer in the specification review. No decision is open. P48's choice between seeding and repair is the specifier's, inside the four-member door's stated principle.

## 4. Order, gate and acceptance

STRICT order P45, P46, P47, P48, P49; one ACTIVE at a time; the same integration gate command as the first three programmes (the whole `src` suite serial, the ratchet against the 52-entry baseline, both typechecks, both bundle checks); each ticket's acceptance command runs `src/units/<P>` serially. Specification batch S7 on one lane cut from `rem/integration` after P44's receipt; per-ticket branches cut by plumbing (R-P4); each ticket built in its own lane and reviewed at the exact artifact commit before its receipt. Live acceptance of each ticket is one DEFERRED_LIVE row, pending the owner's batched acceptance as for the first three programmes. Nothing here changes a receipted ticket's criteria.
