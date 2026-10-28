# Engine capability audit: hand-off for the board's audit team

28 October 2026. For the audit team comparing this engine with the affinity engine being updated elsewhere. Your job is to produce a list of deltas: what this engine does that the other one does not, or does differently. The goal is close parity, not 100% parity. This document tells you what the engine is, where its code and documentation live, and how to establish what it can do. It does not do the audit for you, and nothing here is a substitute for reading the code.

## 1. What this engine is

A real-time personalization and affinity engine that runs at the edge on Cloudflare Workers. For each page view it decides which content to show in each slot of a page, and it learns from what visitors do afterwards. In outline:

- **Visitor state.** Each visitor has a small stateful object at the edge, a Durable Object. It holds that visitor's affinity profile, built in real time from events: views, clicks, add-to-cart and purchases. It also holds their session and their consent.
- **Decisions.** A decision ranks the pieces eligible for each slot by the visitor's affinities and by what the engine has learned. It returns the ranked set, an explanation (the "receipt") and timing. A small head script lets a page paint the right content before first paint.
- **Learning.** Outcomes are credited back to the decisions that led to them. The engine learns a lift per piece, per audience cell (channel, visit, stage, region, leading interest) against a holdout group. A trust dial (γ) controls how far learned lift may move the order: final score = base score × lift^γ.
- **Content and configuration.** Catalogues, slots, layouts and learning settings are published as versioned documents with revisions, rollback and an audit trail.
- **Operator surfaces.** An authenticated operator API, a learning queue, warnings and advisories, a monitor and service credentials.

## 2. Which code to audit

- **Repository:** `https://github.com/simone-coelho/__cloudflare_base`. This hand-off is on the repository's default branch and on `rem/integration`, at `docs/audit/Engine-Capability-Audit-Handoff.md`.
- **The engine of record is the branch `rem/integration`.** Its head when this was written was `52f8dfea` (28 October 2026). Audit that branch.
- **Do not audit the engine from `feature/real-time-personalization`.** That branch carries the sales demos and an engine copy that split off weeks ago: 10 commits on its side against 1,899 on `rem/integration`. Some gaps that exist there are already fixed in the engine of record.
- Record the commit you audit. The engine changes daily.

## 3. Where things are (on `rem/integration`)

| Area | Path | What it holds |
|---|---|---|
| Decision path | `src/content/` (`service.ts`, `decide.ts`, `kinds.ts`, `types.ts`, `holdout.ts`), `src/routes/decisions.ts` | Ranking, slot assembly, the decision API, the holdout and experiment arms, the first-request path |
| Per-visitor state | `src/durable-objects/ShopperReflex.ts` | Affinity profile, events, session, consent, the visitor's decisions |
| Other edge state | `src/durable-objects/` (`LearnStats.ts`, `DecisionRing.ts`, `RegionTrend.ts`, `RateLimiter.ts`, `PersonalizationWebSocket.ts`) | Learning statistics, the recent-decision ring, regional trends, rate limits, live push |
| Real-time affinity | `src/reflex/`, `src/services/` | The reflex and real-time segment logic |
| Learning | `src/learn/` (`fan.ts`, `policy.ts`, `priors.ts`, `hourly.ts`, `report.ts`, `replay.ts`, `queue.ts`, `explore.ts`, `slotGovernance.ts`) | Outcome credit, lift, priors, hourly folds and day reports, replay, the operator queue |
| Ledger | `src/ledger/` | Decision and outcome records, recovery |
| Identity and consent | `src/identity/` | Sessions, sign-in stitching, consent purposes and retention |
| Publication and versioning | `src/config/` (`publication.ts`), `src/routes/content.ts` | Versioned documents, the catalogue and its loads, rollback |
| Browser and server SDK | `src/sdk/` | The SDK, the head script, event emission, identity |
| HTTP API | `src/routes/` | Every public and operator route |
| Auth and tenancy | `src/auth/`, `src/middleware/`, `src/tenancy/` | Operator and service credentials, roles, multi-tenancy |
| Integrations | `src/connectors/`, `src/agents/` | External data connectors and the assistant agents |
| Demo code | `src/demos/` | **Out of scope.** Sales demos, not engine |

## 4. How to find out what it can do

Use these four sources, in this order.

1. **The customer kit, `docs/kit/`.** These are the documents a customer integrates from: `00-README.md`, `01-integration-guide.md`, `02-api-reference.md`, `03-payload-schemas.md`, `04-staging-connection.md`. The API reference is the most complete single statement of external behaviour: every route, member, refusal and limit. Start here.

2. **The capability ledger, `docs/parity/`.** Each sub-folder is a programme of tickets. Each ticket is one capability with its observable behaviour written as criteria, its authority, the paths that implement it, and the test that proves it. Each programme's `receipts/` folder records whether the capability is done locally and whether it was walked live. To list and read them:

   ```
   node tools/closure-ledger/bin/closure-ledger.mjs status --program docs/parity/<programme>/program.json --receipts docs/parity/<programme>/receipts
   node tools/closure-ledger/bin/closure-ledger.mjs render <ticket-id> --program docs/parity/<programme>/program.json
   ```

   There are 15 programmes, about 90 tickets: `delivery-control` (the 25-ticket base build), `customer-answers`, `operator-warnings` (3 rounds), `acknowledgement`, `lift-witness`, `outcome-telling`, `order-memory`, `clock-and-budget`, `budget-default`, `activation` (17 tickets), `scale`, `hardening` and `first-paint`. A ticket whose receipt is absent is not built yet.

3. **The architecture documents, `docs/architecture/`.** Read these for design intent:
   - `01-system-overview.md`
   - `14-architecture-and-optimizely-capability-map.md`
   - `16-edge-affinity-reflex.md`
   - `18-content-affinity-engine.md`
   - `22-outcome-learning-design.md`
   - `25-identity-stitching.md`
   - `32-latency-numbers.md`
   - `35-audit-verification-and-source-of-truth.md`: an earlier independent audit and what it established.

   Where an architecture document and the code disagree, the code and the kit win.

4. **The tests, `src/units/`.** Each folder named for a ticket (for example `src/units/P93/`) holds the tests that define that capability. Each test is named `unit:<ticket>.<criterion>` and describes the behaviour in its title. These are the fastest way to see exactly what a capability does and does not do:

   ```
   npm install
   node node_modules/vitest/vitest.mjs run src/units/<ticket> --minWorkers=1 --maxWorkers=1
   ```

   The full suite is `npm test`. It has about 4,260 tests and takes 30–60 minutes.

## 5. What not to rely on

- **The top-level `docs/*.md` and `.docx` files.** Most are sales, demo, customer-facing or working notes. They describe intentions, proposals and talk tracks, not what the code does. Use them only as a pointer to where to look.
- **`docs/remediation/`.** These are the engineering team's governance and logs. They are useful for history, not for capabilities.
- **Any customer demo's gap document.** Those were written against the old demo branch's engine. Their verifications are available from the engineering lead on request; they are not part of this audit.

## 6. Known gaps and work in flight

Do not count these as capabilities of the engine of record. They are gaps or work in progress as of 28 October.

- **Money learning.** Slots that learn from revenue refuse every outcome that names a currency: no money policy can be published, and reports credit what live learning refused. Diagnosed as a defect; a fix is planned.
- **Day report at volume.** The batch fold's memory grows with traffic, so at production volume the day report can be refused or built incomplete. Diagnosed as a defect; a fix is being designed.
- **In flight in `docs/parity/hardening` and `docs/parity/first-paint`, and ticket P97 of `docs/parity/scale`:**
  - catalogue loads written as one storage object per load;
  - a new visitor's first answer that no longer waits for the visitor's record to be created;
  - the first answer's content read made faster;
  - the purge at scale;
  - two smaller fixes.

  Check each ticket's receipt before counting it.
- **Not built, raised by a prospective customer:**
  - candidates supplied with the request (today slots rank only catalogue pieces);
  - page context recorded on the receipt and used as a learning dimension;
  - per-slot attribution windows;
  - journey-level diagnostics.

## 7. Suggested way to work

1. Read the kit end to end. List the capability areas it describes.
2. For each area, find the tickets in `docs/parity/` that implement it, read their criteria, and open the code paths they name.
3. Where a behaviour matters for parity, run its unit tests and read their titles.
4. For each capability, record it in a table like this:

   | Capability | This engine: where (code, kit section, ticket) | Status here (built / partial / in flight / gap) | Other engine (yes / partial / no / different) | Notes | Priority for parity |
   |---|---|---|---|---|---|

5. Mark anything you could not establish as not established, with the reason, rather than guessing.

Questions about where something lives can go to the engineering lead. The audit's conclusions are yours.
