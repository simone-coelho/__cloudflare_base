# 34 · Independent adversarial architecture and delivery audit

Internal delivery-team document. 2026-09-06. Do not circulate externally without review.

Historical audit evidence. The [reconciled source of truth in document 35](35-audit-verification-and-source-of-truth.md) now governs current findings, factual qualifications, requirement dispositions, remediation dependencies and acceptance gates. This original report is preserved below; read its measurements and proposed remedies with document 35's corrections, not as a competing current plan.

Audited checkout: `feature/real-time-personalization`, `c10ccff7303d06492e4acdf932fc70273d7159ac`. Brief 33 names `5280ad1`; this audit includes the subsequent CW39 session-naming correction in `53fd3ae`. The deployment versions stated in the brief were not independently attested against this checkout.

Verdict: **retain the reusable deterministic scoring core, but do not accept the current implementation as customer-pilot-ready, enterprise-isolated, or evidence of incremental business lift.** Tapestry/Coach is a customer configuration and launch implementation, not the product's identity. A synthetic demonstration can continue in an isolated demo environment; that is not customer acceptance.

## 1 · Findings, most consequential first

Severity uses the brief's four labels. **Blocks launch** covers live-data safety, production reliability, and representations that the full contracted capability is delivered; these safety issues also precede any pilot with real customer data. **Blocks the pilot** covers the promised customer integration or a feature claimed in that pilot. Optional learning/model/autonomy features may remain disabled, but their capabilities must then be reported as undelivered. **Fix before the next customer** is the minimum portability gate, not permission to leave a Tapestry-wide commitment false. **Improvement** does not independently prevent a constrained pilot.

Sizes are engineering estimates, not delivery commitments: S = roughly 1–3 engineer-days; M = roughly 1–2 engineer-weeks; L = multiple engineer-weeks/cross-component work. They include targeted verification but exclude customer approvals, feed preparation, procurement, and broader rollout. Overlapping findings share work and must not be added as independent estimates.

### F01 · Public/demo surfaces remain inside the customer security boundary

Severity: **blocks launch**. Size: M for containment; L for complete deployable separation.

Evidence: `src/index.ts:85` gates `/realtime/*` and `/v1/:tenant/*`, not all shopper or integration routes. `src/routes/cdp.ts:29` uses optional JWT authentication; profile reads and identify/track/forward handlers follow at lines 31, 65, 84, and 110. `src/routes/sort.ts:81` has no site-key gate. `src/index.ts:185` calls `routeAgentRequest` before the application's authentication middleware. `src/agents/OpalAgent.ts:108` supplies no corresponding authentication boundary; its reporting tool in `src/agents/tools.ts:26` relies on lexical SQL restrictions rather than a least-privilege data interface. The installed agent router discovers Durable Object bindings; there is no application-level allowlist of public agent bindings. Public AI/scene/experiment routes are also mounted (`src/routes/ai.ts:16`, `src/routes/aiScene.ts:37`, `src/routes/experiment.ts:25`).

Consequence: “enforced” authentication is not an environment-wide guarantee. Local isolated route probes confirmed caller-selected CDP profile reads/writes without an operator session. A defensive tool probe showed the SQL policy could pass a protected-table request to the database adapter; no real account data was read. Some public operations can incur external AI cost or activation work when connectors are configured. General agent-binding exposure is a source/installed-dependency finding, not a remotely demonstrated compromise.

Remedy: ship an explicit customer route/binding allowlist; authenticate before agent dispatch; omit demo agents, generation/activation routes, and demo database access from customer stamps. Replace free-form reporting SQL with fixed, scoped reporting views/API operations and least-privilege storage. Gate all shopper ingress consistently and rate-limit by route, scope, and workload; CORS and a browser-distributed site key do not authenticate an individual shopper. Verify every mounted route and WebSocket upgrade in enforced mode with negative authorization tests. The example staging key reported in doc 32 §7 must be replaced before customer connection; that historical report was not revalidated with credentialed calls here.

### F02 · Refresh tokens bypass the advertised fifteen-minute access boundary

Severity: **blocks launch**. Size: M.

Evidence: `src/routes/auth.ts:37` and `:43` mint access and seven-day refresh tokens with the same signing key, issuer, and audience. `src/middleware/auth.ts:49` validates those properties but does not require an access-token type or consult refresh-session revocation. `src/routes/auth.ts:85` issues unrestricted access tokens even when `must_change_password` is true; the restriction is reported to the client, not enforced across privileged routes.

Consequence: an isolated application probe accepted a revoked refresh token on a protected API with HTTP 200 while `/auth/refresh` rejected it with 401. This is not a claim that every admin-only endpoint accepts a token without roles; the many routes requiring only an authenticated JWT are enough to invalidate the stated lifetime/revocation boundary. A stolen session may retain broad data/configuration access beyond fifteen minutes. Temporary-password onboarding similarly depends on client cooperation.

Remedy: separate typed access/refresh validation, require intended claims and an algorithm allowlist, and enforce session/account revocation where the privilege model requires it. Use a restricted password-change state until onboarding completes. Add tests for refresh-as-access, disabled accounts, logout, password resets, role changes, expired sessions, and temporary-password restrictions. Password and refresh-token hashing at rest are useful existing controls; the primary demonstrated defect is token/authorization semantics, not a demonstrated password-hash break.

### F03 · Tenant selection is not bound to caller authority end to end

Severity: **blocks launch**. Size: M–L.

Evidence: `src/middleware/edgeAccess.ts:122` checks a key against the URL's `tenant` parameter, which `/realtime/*` lacks. `src/tenancy/middleware.ts:83` separately resolves the tenant from header/host signals. The key gate does not bind its verified owner into that context. `src/sdk/core.ts:126` supplies the SDK key without consistently carrying the configured brand into generic action routes; its socket construction at `:213` has the same integration gap. Operator account/token shapes (`src/auth/store.ts:9`, `src/routes/auth.ts:39`) have no tenant-membership model, while sensitive configuration and identity routes commonly require only `jwt({required:true})` (`src/routes/config.ts:123`, `src/routes/identity.ts:175`).

Consequence: a local middleware probe using a brand-A key and a provisioned brand-B header reached brand B. Conversely, the normal SDK can fall back to Coach on a shared hostname for a non-default brand. Any operator token is not equivalent to authority over every customer's configuration, exports, or erasures. Correct KV prefixes and namespace-escape rejection do not fix these ingress authorization defects.

Remedy: resolve one canonical customer/brand context, authorize the key or operator against that exact context, and pass it immutably to every store and connector. Reject conflicting header/path/host/SDK identities. Add scoped operator memberships and privileges for read/export/configuration/identity/erase; keep platform-administrator authority explicit. Test non-default versus non-default brands through HTTP, SDK, WebSocket, background jobs, and connectors, not only key helper functions.

### F04 · Account proof can be optional, and logout can resurrect the previous shopper

Severity: **blocks launch**. Size: M.

Evidence: `src/identity/assertion.ts:98` permits site-assured linking when identity signing secrets are absent, including an otherwise enforced environment. `scripts/provision-stamp.sh:46` creates an identity salt, not backend identity-verification secrets. `src/sdk/identify.ts:45` changes the visitor on logout, but the SDK session persists; `src/services/RealtimeSegmentEngine.ts:886` accepts the supplied session and `src/services/SessionManager.ts:324` follows its forwarding record without establishing ownership by the new visitor. At `src/sdk/identify.ts:55`, a 409 retry changes the visitor but reuses an assertion bound to the previous visitor.

Consequence: a public site key cannot prove ownership of an account identifier. In an isolated actual-module probe, a new anonymous visitor carrying the old SDK session after logout resolved to the previous shopper and a synthetic private profile marker. This breaks the account boundary on shared devices. The signed-identify retry also fails for legitimate visitor-bound assertions.

Remedy: require backend-signed account assertions for customer identity linkage and fail readiness when verification material is missing. Rotate the browsing session on logout/account switch, validate session ownership server-side, and define forwarding only for authorized identity transitions. Obtain a fresh assertion through a callback or return a typed retry requirement. Verify anonymous → sign-in → sign-out → different account, multiple tabs/devices, blocked cookies, and delayed requests from the old identity.

### F05 · Consent is not a single enforced decision across capture, scoring, and egress

Severity: **blocks launch**. Size: M–L.

Evidence: `src/routes/sort.ts:75` obtains personalized state without applying the content service's consent decision. `src/routes/realtime.ts:112` captures before later consent handling when demo capture is enabled; `:778` defaults that capture off in production and on in staging. Outcome handling at `src/routes/realtime.ts:123` uses request cookies rather than uniformly resolving persisted refusal. Regional fan-in and ODP work in `src/services/RealtimeSegmentEngine.ts:468`, `:495`, and `src/services/odpLoop.ts:370` are not all guarded by the same consent boundary. `src/content/service.ts:107` and `:120` return `CONSENTING` on state-read failure; the object-host read does not apply the passed cookie refusal.

Consequence: tracking/personalization refusal is honored in some paths but not globally. Blocked cross-site cookies, a host failure, or the sort/connector path can change behavior. The statement “tracking off means nothing is written anywhere” is stronger than the implementation. Necessary consent-state storage must itself be explicitly distinguished from behavioral tracking; pseudonymous visitor/session IDs and purchase histories remain subject-level data.

Remedy: resolve consent once before identity creation, behavioral capture, state mutation, learning, ledger/analytics writes, and external egress. Carry it through both hosts and all routes; define unknown/error behavior according to the customer's agreed policy, with no behavioral write when required permission cannot be established. Initialize SDK consent before automatic activity. Test all four switch combinations, withdrawal during a session, blocked cookies, restart/read failure, sort, ODP, prior contribution, and queue processing. The two-switch product model can be retained; its enforcement cannot remain route-specific.

### F06 · Erasure is incomplete and can be undone by a delayed delivery

Severity: **blocks launch**. Size: M–L.

Evidence: `src/identity/erase.ts:48` deletes only the current `REFLEX_HOST`; the legacy cached profile read at `src/services/RealtimeSegmentEngine.ts:617` and written at `:642` is not covered. Identity links are removed at `src/identity/erase.ts:85` before downstream deletion at `:99`, and the reverse visitor list is capped (`src/identity/store.ts:120`, `:144`). `src/ledger/erasure.ts:92` reads only pending tombstones; `:208` retires them and `:214` removes the active predicate. `src/ledger/consume.ts:17` and `src/ledger/writer.ts:53` do not suppress erased historical deliveries. Hourly erasure removes rings but not the corresponding `seen` identity map (`src/learn/hourly.ts:233`, `:241`); recent-record access at `src/routes/decisions.ts:270` lacks the same tombstone filter. The rewrite checks its object cap between days, not between objects (`src/ledger/erasure.ts:175`).

Consequence: the deletion receipt can list IDs as erased while some stages failed and discovery links are already gone. In a local replay, erasure plus the subsequent completed rewrite retired the tombstone; redelivering the old decision restored a visible row. A busy day's rewrite can exceed its intended work budget. Ninety days in a constant is not evidence every bound store/export has an enforced retention lifecycle.

Remedy: create a durable erasure job that first snapshots every linked subject/store, then checkpoints each deletion without discarding retry information. Cover both hosts, all caches/rings/indexes, connectors, raw exports, and subject-level aggregate state. Keep an appropriately protected erasure watermark for the full permitted replay/backfill horizon and consult it at ingestion and all reads; reject pre-erasure backfills unless explicitly reconciled. Checkpoint per object, not just per day. Publish incomplete/failed status honestly until destination receipts reconcile. ODP is already listed as `notReached` in the receipt; complete that external workflow rather than implying the platform performed it. Reviewed decision/outcome Analytics Engine points omit visitor/session IDs; do not invent individual rows there to erase, but verify the actual schema, retention, and small-cell disclosure policy.

### F07 · The holdout report is not a valid test of customer incrementality

Severity: **blocks launch** of an incrementality claim; the same gate precedes any pilot claiming scientific acceptance. Size: L.

Evidence: the customer requires a persistent 5–10% control against existing production segment rules (`tapestry_requirements.txt`, §6, including line 366). `src/content/service.ts:168` hashes the current visitor ID; identify/logout change that ID. `src/content/decide.ts:69` clears affinity for default traffic. Unpinned default selections use catalog order subject to eligibility, deduplication, and configured diversity (`src/reflex/contentCompose.ts:117`), not a production-segment baseline; configured pins remain active. Consent-driven default traffic is represented in the same arm field (`src/content/service.ts:168`, `:242`). `src/learn/report.ts:106` credits attributable slot rewards; `:129` divides by content-item decisions; `:136` applies a Bernoulli comparison. `src/measure/holdout.ts:134` clamps successes to trials.

Consequence: an actual-function probe with one decision and three clicks reported rate 3 (300%), while the interval helper treated it as 100%. Randomization is by visitor but analysis treats correlated content decisions as independent trials; treatment can also change browsing depth and thus the denominator. Attribution removes unlinked business outcomes, and clicks are not visitor conversion, revenue per visitor, profit, or returns. Default-arm traffic can mix randomized controls with consent-ineligible visitors. A comparison to catalog order does not establish improvement over the customer's current rules. Differing randomization and analysis units require explicit variance treatment; this is a well-established experimental-design concern, not a request for a more sophisticated ranking model. [Microsoft experimentation research](https://www.microsoft.com/en-us/research/articles/why-tenant-randomized-a-b-test-is-challenging-and-tenant-pairing-may-not-work/)

Remedy: separate immutable experiment enrollment from experience eligibility and learning attribution. Establish a persistent assignment anchor and an explicit anonymous-to-recognized merge policy; preserve the assignment/salt throughout the agreed experiment. Implement/accept the actual production control and record its exposures. Collect all eligible visitor-level business outcomes independently of content matching. Pre-register unit, metric, window, maturity, target, allocation, and stopping rules; use visitor-level or cluster-aware inference and a suitable revenue/returns estimator. Exclude or separately stratify consent-ineligible traffic. Keep attribution reports, but label them attribution. An evolving treatment policy and exploration do not inherently invalidate a properly randomized permanent holdout; their cost belongs in the treatment's measured result.

### F08 · Learning storage reaches a real runtime limit despite passing the suite

Severity: **blocks launch** of enabled learning at unbounded cardinality. Size: M–L.

Evidence: `src/durable-objects/LearnStats.ts:101` stores the entire growing item/cell map in one `storage.put('learn', ...)`; `src/learn/stats.ts:57` and `:67` add cells without pruning. The configured Durable Objects are SQLite-backed (`wrangler.toml:121`). An isolated local Miniflare/workerd run of the actual `LearnStats` class, using SQLite-backed storage and synthetic exposures, returned HTTP 500 with `SQLITE_TOOBIG` at 15,000 distinct affinity cells for one slot/item. The serialized state was 2,618,613 bytes. Cloudflare documents a 2 MB combined key/value limit for this storage API. [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)

Consequence: switching to SQLite-backed objects does not make a single stored value unbounded. Failure depends on item/cell cardinality, not just shopper count; decay does not delete old map keys. `DecisionRing` also stores its full receipts and a ninety-day, count-unbounded ID index as one value (`src/durable-objects/DecisionRing.ts:64`, `:69`). Its risk is source-confirmed, not the object exercised by this storage-limit probe.

Remedy: store counters and indexes as bounded rows/chunks; implement time/cardinality retention and migration. Put ceilings on context cardinality and snapshot size, and surface degraded learning explicitly. Load-test hot slots, not only many shopper objects. One stats object per tenant/brand/slot also creates a throughput concentration: every personalized page fans exposures there (`src/learn/fan.ts:79`). Batch and, where measured necessary, shard ingestion with a deterministic reduction. Verify storage recovery after failure, duplicate delivery, eviction, and a realistic lifetime of accumulated cells.

### F09 · Re-provisioning silently rotates identity, authentication, and all site keys

Severity: **blocks launch**. Size: M.

Evidence: `scripts/provision-stamp.sh:8` says a rerun continues past existing resources; lines 47–50 generate a fresh site key, JWT secret, and `IDENTITY_SALT` every time. The SDK key map is replaced with the specified tenant's entry. `src/identity/shopperId.ts:48` derives shopper IDs using the salt. Resource creation failures are broadly swallowed at script lines 23–40.

Consequence: the advertised recovery path can invalidate integrations and operator tokens, orphan recognized shopper identities/history, and remove previously configured tenants' keys. With multiple brands it is not an idempotent provisioning operation. A separate holdout salt does not repair identity discontinuity caused by the shopper salt changing.

Remedy: separate create/reconcile from explicit, reviewed secret rotation. Maintain a customer/environment manifest and verify existing resource IDs; stop on unexplained errors. Preserve stable identity material with a recovery/versioning plan, merge site-key entries rather than replacing them, and treat identity rotation as a data migration. Add dry-run/diff and an idempotency test proving a second run changes no resources, secrets, identities, or existing keys. Do not run this script against a customer environment to discover whether it is safe.

Separate credential-hygiene evidence: `.claude/worktrees/agent-a96c30a326d3da233/.cursor/mcp.json:14` is still tracked and contains a nonempty credential-shaped value. Its value was not printed in this report or tested against a service. The current root file being ignored does not untrack historical copies. Require owner-confirmed revocation/rotation evidence for previously committed material, then remove obsolete tracked snapshots through a separately reviewed cleanup; no live compromise is asserted.

### F10 · Release gates and monitoring do not enforce the advertised operating envelope

Severity: **blocks launch**. Size: M–L.

Evidence: `npm run lint` currently exits 2 before checking source because `.eslintrc.json` extends `@typescript-eslint/recommended` without the plugin prefix. `scripts/deploy.sh` therefore cannot pass its stated gate; the brief describes bypass deployment. `.github/workflows/ci.yml` tests/types on push/PR, not an attested build/promotion chain. `src/ops/monitor.ts:26` accepts decision latency up to 1,500 ms, versus the interim 200 ms target. Its synthetic check accepts zero decisions (`:70`), does not complete the event → ledger → learning loop, and its cookie refusal is not honored uniformly by the object-host reader (F05). Scheduled work uses different tenant lists: `src/index.ts:213` and `:240` default trend/autonomy work to Coach, while other work discovers provisioned tenants.

Consequence: “monitor green” can mean stores answered and an empty fallback was returned, not that personalization or outcome learning works. A healthy object-host deployment may also fail the monitor's consent assertion. Customers can be omitted from jobs; shared cron and queues create noisy-neighbor/lag risks. A clean worktree alone does not prove the deployed Worker and served SDK match tested source. The brief's six lint errors/hundreds of warnings were not reproduced because lint never reached analysis.

Remedy: repair lint configuration and use a documented blocking baseline; build once, test the actual Worker/SDK artifact, and promote that artifact through staging/canary/production. Test migrations forward and recovery/rollback with compatible state and pinned SDK versions. Add tenant-scoped synthetics for emitted event, committed state revision, rendered decision, durable ledger, learning lag, and deletion completion; distinguish unavailable/degraded/empty from healthy. Alert on error budgets, missing records, duplicate rates, queue age/dead letters, fold completeness, hot-object saturation, and privacy failures. Use one provisioned-customer registry for scheduled work, bounded jobs with checkpoints, and a tested 03:00 runbook with named owners and recovery procedures.

### F11 · The “twelve capabilities closed” register omits parts of the actual scope

Severity: **blocks launch** representations that every signature capability is active. Size: L across missing workflows; external entitlements require non-code verification.

Evidence: accepted-view text of repository draft `docs/opticon/Tapestry_Scope_of_Services_v8_tracked.docx`—excluding tracked deletions—contains §1.3 AI label proposal/approval, §1.9 separate Product Recommendations entitlement, §1.10 customer-catalog AI Search with live affinity, and §1.12 scheduled Snowflake sharing plus historical/customer/third-party attributes and audiences. Doc 20 closes §1.3 on import tests and §1.12 on R2 partitions. The generic enrichment/review workflow was not found; related OfferDesk functionality is demo-specific (`src/routes/liveOps.ts:11`). AI Search imports Coach catalog/categories (`src/services/CatalogIntent.ts:8`, `:24`) and a Coach/luxury-handbag prompt (`src/routes/ai.ts:31`). History ingest requires weighted timestamped actions and resolves Coach configuration (`src/identity/history.ts:41`, `:105`, `:122`).

Consequence: a catalog import is not AI enrichment approval; raw object partitions are not proof of a scheduled destination share; action history is not typed CRM attribute/precomputed-audience ingestion; a demo search route is not arbitrary customer catalog/profile integration. A separate product entitlement cannot be inferred from this engine's recommendation demo. This is an audit of repository commitments, not a legal conclusion about an executed agreement that was not supplied.

Remedy: restore the exact twelve clauses and their sub-capabilities to the requirement register, assign owners and acceptance evidence, and reopen the unsupported closures. Demonstrate enrichment review/publish, customer-catalog search/live state, typed historical enrichment, and scheduled warehouse destination readback with retries/watermarks/reconciliation. Customer-owned ingestion is acceptable if ownership and a working scheduled pipeline are established. Verify Product Recommendations entitlement separately. Product and section decision grains remain explicitly open in doc 20 row 5: scheduling later experience composition does not by itself waive present product-sort persistence language.

### F12 · The documented SDK integration never repaints after the promised interactions

Severity: **blocks the pilot**. Size: M.

Evidence: `docs/kit/01-integration-guide.md:49` subscribes, then hydrates once at `:56` and connects at `:57`. `src/sdk/listen.ts:68` listens to `decisions`; `src/sdk/core.ts:225` distinguishes `content_decisions` from generic `personalization_update`. No production sender of `content_decisions` was found. The demo adds its own hydration on generic updates (`public/storefront.js:273`, `:354`); the kit's SDK example does not. Production calls to `serveContentDecisions` are the snapshot route and monitor, not an event-driven content push.

Consequence: an in-memory run of the actual bundled SDK using a test host, an initial snapshot, three awaited product events, and a production-shaped generic update produced three events, one paint, one snapshot request, and the original hero. The server's affinity can change while the customer's content stays unchanged. A demo with private orchestration is not proof the distributed SDK meets the three-interaction experience.

Remedy: make page-scoped refresh/subscription a supported SDK contract or implement genuine content-decision push. Coalesce bursts, wait for authoritative state, and discard stale responses. Test the exact published snippet through event → decision → rendered IDs, including reconnects, concurrent events, and account transitions. Do not merely add another explicit snapshot to the acceptance script and call the SDK gap closed.

### F13 · Visit/channel context and customer journey/memory behavior are not implemented as claimed

Severity: **blocks the pilot** for the agreed dimensions and return-visit scenarios. Size: M plus customer calibration.

Evidence: `src/content/service.ts:77` omits visit number and entry channel from `ShopperRead`; `:158` uses only an optional request channel and `isNewSession ? 1 : null`. Persisted metadata exists in `src/services/SessionManager.ts:214` and legacy personalization attributes in `RealtimeSegmentEngine.ts:688`, but does not reach this content contract. The kit does not supply a channel on ordinary hydration (`src/sdk/listen.ts:75`). `src/services/JourneyStage.ts:42`/`:75` moves two product views into the middle stage, and `:70` maps purchase to late with no post-purchase stage. Default decay in `src/reflex/core.ts:201` uses accelerated demo-scale horizons.

Consequence: ordinary content requests cannot distinguish the advertised second/fourth visits, and campaign context is lost. A learning-cell field alone does not implement an immediate seeded context effect at learning weight γ=0. Two brief exploratory views can be labeled considering, contrary to the customer's exploring example. Configurability does not substantiate days/weeks of return memory without a production registry and calibration.

Remedy: carry authoritative visit/channel metadata into decisions on both hosts and specify its seeded scoring effect separately from learned pooling. Agree stage transitions, ambiguous behavior, purchase/post-purchase handling, and production decay horizons. Verify paid/direct, first/return/frequent, three-interaction taste, and days/weeks return scenarios with learning shadowed and enabled. Keep the heuristic explainable; do not present it as a validated journey classifier until customer examples pass.

### F14 · KV is still the authority for rapid shopper updates; CW39 fixes naming, not consistency

Severity: **blocks the pilot** for real-time correctness and latency. Size: L for a safe authoritative-host transition.

Evidence: `src/services/SessionManager.ts:200`, `:222`, and `:294` read, merge, and write full sessions/user pointers without compare-and-swap. Concurrent snapshots/events can overwrite state read earlier. `RealtimeSegmentEngine` performs configuration/audience work per instance (`:307`, `:363`, `:375`), multiple session writes during an action (`:535`, `:554`), another read (`:572`), and awaited downstream work through `:606`. `processActionEventWithSession` at `:1003` does not thread the client's action session through the same corrected naming seam; sort accepts `sessionId` but discards it (`src/routes/sort.ts:37`, `:86`). Both stamps still select the session host (`wrangler.toml:231`, `:330`).

Consequence: matching session IDs does not serialize state changes or provide read-after-write consistency across isolates. Moving a write to `waitUntil` reduces response time but cannot establish the state revision used by the next decision. Rapid views/impressions and parallel routes can lose contributions or observe inconsistent profiles. KV documents last-write-wins behavior, eventual visibility, and one write per key per second; this is a structural mismatch for an authoritative hot session, not merely a slow API call. [KV write behavior](https://developers.cloudflare.com/kv/api/write-key-value-pairs/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/)

Remedy: make one transactional shopper authority own identity/session, consent, ordered signal updates, and state revision; a Durable Object is a good fit if measured and accepted. Return a committed revision with the event acknowledgment, and make dependent decisions/pushes reference that revision. Keep durable logging/exports off the render path with reliable delivery (F16), not the authoritative state commit. Share cached immutable config/catalogs and move regeneration/connector enrichment out of each event. Prove SDK, identity, consent, sort, fatigue, migration, erasure, and rollback parity before changing `REFLEX_HOST`. The object host is the preferred target shape, not already-qualified production software.

### F15 · “Immutable, immediately effective configuration” is neither atomic nor conflict-safe

Severity: **blocks the pilot** for trustworthy tuning/rollback. Size: M–L.

Evidence: `src/config/versionedStore.ts:233` reads the current revision and increments locally, `:245` writes that revision key, `:246` writes current, and `:254` updates a separate index. Patch at `:264` merges a separately read value. The isolate cache has a thirty-second TTL and invalidation only affects the writer's isolate. Content configuration/catalog/slots/learning documents are fetched separately (`src/content/service.ts:136`).

Consequence: a local actual-module concurrency test seeded γ=0 and ε=0, then concurrently patched γ to 0.5 and ε to 0.1. Both writes returned revision 2, overwrote the same supposedly immutable revision, and persisted γ=0, ε=0.1. This happens even with strongly visible in-memory KV; distributed eventual visibility makes it worse. A decision can also mix independently activated document versions. Revision labels cease to prove what was served or rolled back.

Remedy: serialize publication per scope through a transactional coordinator with expected-revision preconditions; reject stale writes. Store immutable content-addressed/versioned bodies and atomically activate a manifest referencing the compatible configuration/catalog/slots/learning set. Publish a defined propagation bound and last-good behavior; “no deploy” is supportable, global instantaneous visibility is not a KV guarantee. Test concurrent operators/autonomy, partial publication, cache propagation, rollback, and reproducibility of old receipts.

### F16 · Ledger and online learning can duplicate, lose, or disagree about the same event

Severity: **blocks the pilot** for learning, export, or explainability acceptance. Size: M–L.

Evidence: `src/ledger/consume.ts:22` generates a new batch ID on each consumption; `src/ledger/writer.ts:60` consequently addresses a different object on redelivery. Reports do not deduplicate those rows. `src/durable-objects/DecisionRing.ts:69` appends duplicates and `:82` recredits outcomes. `src/durable-objects/LearnStats.ts:40`/`:50` have no event deduplication; `src/learn/fan.ts:81` even discards decision IDs from exposure payloads. Fan-out errors are swallowed at `:84`; ledger and live learning are independent deliveries.

Consequence: consuming an identical outcome message twice in the local actual-module harness yielded two objects/two rows. Retry, network loss, or a failure between stores can bias learning and reports differently. Queues provides at-least-once delivery, so handling duplicates is application work, not an exceptional failure mode. [Cloudflare delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)

Remedy: stable event/decision-set/outcome IDs, idempotent storage and credit-pair application, and a transactional outbox or durable ingestion log from which downstream state is derived/reconciled. Preserve IDs through every fan-in; record/retry unsuccessful destinations instead of silently treating them as complete. Test redelivery, partial batch writes, process termination, out-of-order arrival, and one destination failing while the other succeeds. R2 remains a good durable export substrate; its object naming does not provide end-to-end exactly-once effects.

### F17 · Hourly folding loses late data and cannot honestly represent the seven-day policy

Severity: **blocks the pilot** for report/attribution acceptance. Size: L.

Evidence: `src/learn/hourly.ts:435` treats an existing hour object as completed after a five-minute grace, without a delivery watermark. The fold appends the hour's decisions at `:243`, trims the ring at `:256`, then attributes outcomes at `:260`. Catch-up can continue past a failed hour (`:446`), uses a limited lookback, and does not automatically correct an already-written truncated hour. Doc 31 §3 explicitly limits batch rings to two days, while the online policy permits seven days.

Consequence: a local fold at 13:05 followed by a late 12:00-hour outcome at 13:06 and catch-up at 13:10 left no pending repair and no counted outcome. A reduced-ring-size counterexample also showed an early decision evicted before its same-hour click was processed; the production 200-record cap changes the volume threshold, not the defect. Late outcomes, failed hours, and truncation yield incomplete reports that can appear final. A two-day retained ring cannot implement a seven-day attribution policy. An online ring of 200 content-item receipts is also only about 7–10 full 20–30-item pages, not a guaranteed seven days of history.

Remedy: process event time in order with stable IDs, checkpointed contiguous progress, delivery/maturity watermarks, and explicit late-data corrections or rebuilds. Never mark a truncated/failed hour final; propagate partial and pending status into day/window reports. Size attribution storage for the promised window and actual page volume, or obtain an explicit shorter-window acceptance. A database/indexed state store may be the practical solution, but “a million decisions requires a database” is not a mathematical law; demonstrate the volume, retention, joins, and recovery cost that justify the choice.

### F18 · Decayed statistics depend on delivery order and round away rare-event rates

Severity: **blocks the pilot** when learned lift is enabled. Size: S–M.

Evidence: `src/learn/stats.ts:51` decays an existing counter at the incoming timestamp, then moves the counter's time to that timestamp. `src/reflex/core.ts:234` clamps negative elapsed time. In an actual-function test, two exposures one learning time constant apart produced 1.368 effective exposures in chronological order and 0.736 in reverse order at the same final evaluation time. `src/learn/stats.ts:122` rounds slot baseline rates to three decimals before using them in subsequent computations.

Consequence: queue reordering/backfill changes learned truth, and low purchase or other rare-reward rates can round to zero and alter smoothing/lift. A customer's data scientist cannot reproduce online results from an event-time replay without also reproducing accidental arrival order and internal rounding.

Remedy: keep each counter at a monotonic reference time; discount late contributions to that time rather than moving the clock backward. Preserve full precision internally and round only for presentation. Property-test all permutations, historical backfill, near-zero rates, and numerical decay invariants. This correction does not require a new model architecture.

### F19 · Changing an objective or attribution policy relabels incompatible historical evidence

Severity: **blocks the pilot** for configurable learning objectives. Size: M–L.

Evidence: `src/durable-objects/LearnStats.ts:93` accepts each caller's latest configuration while retaining the same counters; `:97` simply replaces the configuration. `src/learn/route.ts:31` resolves the current learning policy. Existing sufficient statistics do not preserve the original objective/decay/policy generations necessary to reinterpret old events. A local sequence of a unit-valued purchase followed by a revenue-valued 400 purchase yielded a revenue-labeled total of 401.

Consequence: changing from conversion counts to money mixes units; changing decay cannot recover information already discounted under the previous horizon; changing attribution applies new rules to future events without the promised historical recomputation. Revenue is not profit, and even margin requires agreed currency, refunds, costs, and feed semantics.

Remedy: version statistics by objective, policy, horizon, and input schema; either retain separate sufficient statistics with compatible units or rebuild a new generation from immutable events before atomic promotion. Expose reset/backfill/maturity status. Verify config changes midstream, currency/returns corrections, old-event retries, and comparison of old/new generations. Keep financial-objective language at the level actually supported by customer feeds and accepted definitions.

### F20 · Contextual cold-start priors can be attached to a nonexistent item

Severity: **blocks the pilot** if contextual priors are included in DS acceptance. Size: S–M.

Evidence: `src/learn/stats.ts:142` splits a compound item/cell key at its last `|`, although cell keys themselves contain that character (`:35`). A prior for item `a` and cell `c=direct|v=1` was indexed as item `a|c=direct`; lookup for the real cold item returned null. Root-level `*` priors do not expose this case. `src/learn/priors.ts:38` constrains the prior mean to a probability interval even when money-valued objectives are available.

Consequence: the DS import can validate and version successfully while failing precisely for the context-specific, no-live-evidence cold start it is intended to support. Probability priors cannot silently stand for revenue-per-exposure priors.

Remedy: use structured/nested keys or an unambiguous encoding, validate the canonical cell grammar, and type priors by objective/unit. Test every ladder depth, cold and warm items, separator-bearing identifiers, multiple prior strengths, and invalid objective combinations. Equivalent exposure weighting is a defensible mechanism once the correct item/cell/unit is addressed.

### F21 · Direct attribution ignores the supplied slot and confuses served with seen

Severity: **blocks the pilot** for trustworthy learning on rails/carousels. Size: M.

Evidence: outcomes carry a slot (`src/ledger/records.ts:142`), but direct matching in `src/learn/policy.ts:74` does not constrain it and `:93` can credit one matching decision in each slot. A local hero/rail example credited both placements for a click that named only hero. Position is present in receipts but absent from the learning cell/pooling key (`src/content/types.ts:190`, `src/learn/stats.ts:33`), despite doc 22 §5.5. `src/sdk/listen.ts:120` records rendered impressions immediately; the server records exposures when decisions are served.

Consequence: “direct” does not consistently mean the clicked placement. Below-the-fold or unrendered choices count as exposures; position/visibility effects can be mistaken for content quality. The ring's count cap further shortens attribution/fatigue history for active shoppers (F17). None of these choices is automatically wrong for a clearly named diagnostic, but they do not support the stated exposure/response interpretation.

Remedy: use decision ID, slot, and position for direct interaction credit; define a separate, explicit policy for downstream product purchases and multi-placement credit. Distinguish served, rendered, viewable impression, click, and conversion records. Either stratify/control for position and exposure opportunity or constrain the experiment to a comparable placement. Test the same item in multiple slots, multiple products per creative, hidden rails, rapid rerenders, delayed purchases, and no matching exposure. Document whether fatigue is page-wide or slot-specific.

### F22 · Replay lacks the complete page state needed to reproduce coupled decisions

Severity: **blocks the pilot** for the “recompute every number” promise. Size: M.

Evidence: `src/learn/replay.ts:72` retrieves the requested slot's lift; `:89` reruns the whole page, while `:94` supplies only that slot's snapshot. Page deduplication couples earlier/later slot choices. A local two-slot example served hero B/rail A, but replaying rail without hero's learned state produced hero A/rail B. `src/durable-objects/LearnStats.ts:112` publishes the serving KV snapshot before the best-effort R2 archive at `:114`.

Consequence: a valid target-slot receipt can replay differently because another slot's historic choice is missing. A serving snapshot may have no durable archive at all. Separate config revisions are also not immutable under concurrency (F15), and independent ledger/learning paths disagree (F16).

Remedy: persist a decision-set ID and the complete activation manifest, per-slot lift/prior versions, state/context time, stochastic seed/policy, and page-wide exclusions/choices needed for replay. Durably archive dependencies before making their manifest serveable. Test every selected item from a multi-slot page, learning/exploration/merchandising combinations, missing archives, partial writes, and historical rollback. Deterministic replay proves what a policy selected; it does not reveal the reward an unserved alternative would have earned. Causal offline evaluation needs appropriate randomized logging, support/propensities, and an agreed estimator. [Primary offline-evaluation research](https://arxiv.org/abs/1003.5956)

### F23 · Thompson mode ignores the exploration budget and uses the wrong reward model for money

Severity: **blocks the pilot** if Thompson exploration is offered/enabled. Size: M.

Evidence: `src/learn/explore.ts:87` enters Thompson sampling before the share gate at `:102`, uses only root `*` counters (`:92`), and constructs a Beta draw from `s + 1` and `max(0, n - s) + 1` (`:94`). It returns a whole sampled ranking (`:96`), not just a budgeted first-position alternate. In a 100-visitor synthetic probe with share zero, the chosen leader changed for 50 visitors.

Consequence: “configured share of first-position decisions explores” is false in this mode. Contextual estimates and imported priors are bypassed. A Bernoulli success/failure interpretation is invalid for arbitrary revenue/margin or repeated rewards exceeding exposures; clipping failures does not fix the model. A deterministic seed makes a draw replayable, not scientifically calibrated.

Remedy: either implement budgeted Thompson exploration within the documented eligible first-position policy, or explicitly expose a separate full-ranking Thompson policy with its own accepted contract. Use a reward-appropriate model, the intended context/prior, and logged selection probabilities/support. Reject unsupported objective/mode combinations. Test share zero/one, pins, constraints, all positions, and cold/sparse/value-valued evidence. Keep unsupported exploration off during pilot acceptance.

### F24 · Autonomy applies stale proposals and treats noisy association as evidence to increase a weight

Severity: **blocks the pilot** if assisted/autonomous tuning is represented as safe. Size: M for controls; L for validated optimization.

Evidence: `src/learn/cycle.ts:89` loads current configuration but applies an old absolute proposal target at `:93`. `src/learn/autonomy.ts:102` checks only min/max, not proposal age, expected version, current pin/mode, or maximum change from the current value. A local proposal from 0.10 to 0.15 overwrote a current pinned value of 0.90 with 0.15. At cycle line 72, proposals can be recorded as applied before the slot write succeeds. The evidence gate at `autonomy.ts:84` uses total slot exposures, and a positive spread triggers only an increase (`:87`, `:90`); one observation versus 9,999 and a tiny lift difference produced a proposal in a local test.

Consequence: an operator approval can override later governance, exceed the intended step relative to current state, or leave a false applied receipt. Differences among content tags do not demonstrate that increasing a scoring coefficient causes better outcomes; selection bias and sparse outliers can drive repeated ratcheting to the maximum.

Remedy: apply proposals with expected-revision checks and revalidate current mode, pins, step, age, evidence, and bounds. Atomically couple successful configuration change to its receipt. Require adequate evidence per comparison, uncertainty, harm guards, reversible trials, and a rollback policy; initially keep recommendations human-reviewed and clearly heuristic. Demonstrate beneficial coefficient changes through controlled perturbation/holdout evaluation before offering autonomous optimization.

### F25 · Long-window reports silently truncate and overstate statistical readiness

Severity: **blocks the pilot** for monthly/quarterly/biannual measurement acceptance. Size: M, in addition to F07/F17.

Evidence: `src/measure/window.ts:44` stops after 92 dates, but `:85` returns the original requested end date. A January 1–June 30 request therefore reads only through April 2 while retaining June 30 in its label. `:63` checks report existence, not all source-hour completeness flags. `src/measure/holdout.ts:165` estimates samples using equal arms, fixed 95% confidence, and the observed effect; `:190` divides an absolute-difference interval by a point estimate of the control rate. The route at `src/routes/decisions.ts:576` does not expose a complete versioned metric/target protocol.

Consequence: a six-month claim can describe three months of incomplete data. “Decisions still needed” is not a reliable plan for a 5% control, selected 90/99% confidence, visitor clustering, or a pre-specified business target. Scaling an absolute interval by an uncertain denominator is not a full relative-effect interval. Retention of ninety days also needs reconciliation with six-month-plus measurement.

Remedy: reject oversized requests explicitly or paginate/aggregate the entire requested period; return actual coverage, missing/truncated hours, maturity, and versions. Retain privacy-appropriate experiment sufficient statistics for the agreed windows, without assuming raw personal events must all live forever. Pre-specify target effects and use allocation-aware power/uncertainty calculations suitable for the chosen metric. Separate CVR, RPV, profit, and returns targets. Suppress definitive target verdicts when completeness or assumptions fail.

### F26 · The merchandiser's acceptance control is missing, and a shipped stage form is invalid

Severity: **blocks the pilot**. Size: M overall; S for the invalid form.

Evidence: `docs/architecture/19-tapestry-delivery-ledger.md:17` requires 20–30 homepage images personalized on agreed dimensions with weight configurability. `public/console/views-config.js:333` edits take/displays pin information but lacks the needed per-slot dimension-weight editor; `public/console/views.js:320` and `:392` expose learning dials, not those business weights. `views-config.js:340` creates `inStage: 1.2` and labels it a multiplier from 1 to 3 at `:342`; `src/content/kinds.ts:176` accepts only 0–1, and `src/content/decide.ts:137` adds the value rather than multiplying.

Consequence: the actual validator rejects the shipped default. Public staging JavaScript contains that same value. A merchandiser cannot perform the stated core tuning acceptance through the provided console without raw/API work; even a manually valid stage value is described with the wrong arithmetic. Passing component tests and prior screenshots did not catch the form-to-API contract failure.

Remedy: deliver per-slot dimension weights, pins, and exclusions with production-schema validation, readback, visible versions, and understandable units. Separate business scoring, learned-lift trust, exploration, and autonomy controls. Run each real form submission against the actual validator and verify resulting decisions. Authenticated visual usability/accessibility was not exercised in this audit; a static GET is not a completed console walkthrough.

### F27 · Feed normalization drops merchandising and disagrees with the published metadata contract

Severity: **blocks the pilot** for feed-driven merchandising/schema acceptance. Size: M.

Evidence: `src/content/import.ts:54` reconstructs pieces without `merchandising`, although direct validation supports it (`src/content/kinds.ts:74`). The pull/import routes use that normalizer (`src/routes/content.ts:127`). The PS guide at `:113` says `explore/consider/decide` is accepted; `src/content/kinds.ts:25` accepts different stage words, with no import translation. Tag validation at `:43` checks shape, not active-registry membership or duplicate values. The scorer sums supplied tag values (`src/reflex/contentCompose.ts:142`). Featured product IDs reach receipts (`src/content/decide.ts:265`) but do not implement D5's product-attribute inheritance.

Consequence: actual-function probes showed import strips merchandising, the documented stage words fail validation, and duplicate/misspelled tags validate. A routine feed refresh can silently remove business boosts; malformed taxonomy can suppress or inflate scores. Brand/locale/slot-eligibility language in the customer schema is not automatically satisfied by `slotTypes` and geographic affinity.

Remedy: one canonical schema/normalizer for JSON, CSV, pull, and direct PUT; preserve all supported fields, translate agreed aliases, reject unknown registry dimensions, and deduplicate tags. Validate customer/brand/locale/market eligibility independently from affinity. Implement product-attribute inheritance or explicitly narrow that part of D5 to linkage/attribution with customer agreement. Verify round-trip preservation and negative cases using real CMS/SFCC metadata samples.

### F28 · Later pins can duplicate earlier selections; absolute governance is underspecified

Severity: **blocks the pilot** for page governance. Size: S for deduplication; M for the full constraint contract.

Evidence: `src/reflex/contentCompose.ts:125` composes slots sequentially; the pin branch at `:127` does not reserve later pins or check the used set, and bypasses normal slot-type matching. In an actual-function probe, hero ranked a campaign and story pinned that same campaign, yielding a duplicate page. `src/content/kinds.ts:140` has no complete off-limits/exclusion/default-handoff policy, while `docs/PS-Implementation-Delivery-Guide.md:101` promises those business controls.

Consequence: page-wide uniqueness and pin/placement constraints can conflict without a defined resolution. Inventory exclusion does work when `inStock:false` is supplied; it is not proof of a live stock integration. Diversity is deliberately relaxed to fill holes, so it is a soft preference, not an absolute guardrail.

Remedy: validate/reserve all page pins before ranking, reject contradictory pins, and define precedence among eligibility, inventory, lifecycle, exclusions, diversity, and default handoff. Preserve the North Star's no-arbitrary-fill behavior when no valid candidate exists. Test expired/missing pins, wrong placement, contradictory pins, stock changes, off-limits slots, and empty eligible sets. Describe soft diversity honestly in the operator UI and contract.

### F29 · Engineering proofs do not execute the actual customer acceptance or settle the schedule

Severity: **blocks the pilot**. Size: M for the acceptance pack, excluding remediation above.

Evidence: `scripts/acceptance-run.mjs:63` makes ten synthetic pieces; `:115` and `:159` call explicit HTTP snapshots. It does not use the shipped SDK in a browser to show 20–30 customer assets and operator weight changes. Doc 21 at `:343` correctly distinguishes engineering proof from customer acceptance. The PS guide at `:95` requires a tag-plan template and at `:97` a live event-validation overlay; a generic delivered workflow was not found. The asynchronous hydrate/repaint sample is not a no-flash rendering strategy. The Implementation Plan still promises an SSO-backed baseline (`:74`) while doc 30 explicitly says SSO is not built.

Consequence: “acceptance passed” would overstate what the existing script demonstrates. Mid-October SDK/docs, end-October lower-environment API, November freeze, and January's one Coach page are the relevant delivery dependencies (doc 19, lines 15 and 112). Older September milestone wording and a relative example placing +60 on November 6 do not resolve the freeze. Coach-first and committed external/SFCC sorting are settled; do not reopen those decisions as a way to reduce work.

Remedy: execute the exact customer kit with actual 20–30-asset content and agreed shopper scenarios: cold/third interaction/return visit/channel, business weight edit and rendered consequence, pin/default/inventory behavior, consent, identity, reconnect, both-host parity, and recorded IDs/timings. Agree initial rendering/handoff to avoid flashes and provide tagging validation. Separate observable delivery acceptance from the scientific experiment and commercial entitlements. Rebaseline owners/dependencies against the actual kickoff and freeze; do not invent a revenue guarantee or treat a kickoff assumption as an agreed date.

### F30 · The no-runtime-model North Star is conditional, not an invariant

Severity: **blocks the pilot** if live external scoring is enabled under the unchanged promise. Size: S to disable/enforce; M for an offline score publication seam.

Evidence: `src/content/service.ts:195` invokes external scoring during a decision when configured; `src/learn/external.ts:73` supports HTTP/Workers AI calls. Candidates include the whole catalog (`service.ts:201`). Repository v8 scope §2.4 says no model runs on the decision path “at any stage”; the PS guide at `:20` promises zero live AI credits. Doc 22's external hook and portions of the customer solution document allow hosted-model scoring, creating a real contradiction.

Consequence: the default deterministic mode honors the intended shape, but an enabled optional hook can add inference, third-party egress, cost, and availability dependencies. A timeout/fallback does not make the model absent; a `Promise.race` timeout also does not itself cancel upstream work. This conflict is distinct from D8's question of whether embeddings are required at all.

Remedy: keep customer render paths on precomputed, versioned scores published through the same immutable activation process. Alternatively explicitly amend the optional-mode contract, data permissions, economics, and SLOs before enabling live scoring. Send only eligible bounded candidates and cancel cancellable work on deadline. Keep the deterministic scorer as the mandatory fallback; validate that “off” truly performs no model calls or model-credit consumption.

### F31 · The reusable content service and the event engine still use different customer registries

Severity: **fix before the next customer**; also prevents claiming full Tapestry multi-brand closure. Size: L.

Evidence: `src/demos/registry.ts:27` admits only Coach/Brighthour surfaces, `:68` defaults unrecognized surfaces to Coach, and `:153` resolves configuration by demo surface. Content decisions instead read the requested tenant's registry (`src/content/service.ts:140`). History hardwires default surface (`src/identity/history.ts:105`); sort resolves demo scope (`src/routes/sort.ts:70`, `:90`). `src/services/odpLoop.ts:95` derives connector identity without tenant in that derivation and `:331` uses Coach-specific attributes. Shopper object regional/seed paths also contain demo scope (`src/durable-objects/ShopperReflex.ts:555`, `:1084`).

Consequence: adding a tenant namespace does not make that customer usable. Its content registry may differ from the event/history/sort/ODP/prior registry that builds the shopper vector. A ten-brand deployment can silently use Coach dimensions, catalog assumptions, identity scope, or jobs. The raw account ID not being stored is good, but connector identity scope must still prevent unintended cross-brand linkage.

Remedy: a canonical customer/brand configuration owns taxonomy, product/content providers, event schema, journey/decay settings, identity policy, consent, connectors, experiments, and exports. Pass it through every path; demo surfaces become explicit fixtures/adapters with no silent production fallback. Prove portability with two non-default brands whose dimensions, product IDs, connector destinations, and catalog sources deliberately overlap or differ. Keep one shared engine codebase; do not fork it into a Coach engine and another customer engine.

### F32 · Whole-catalog KV documents and repeated full sorts do not support arbitrary catalog scale

Severity: **fix before the next customer**; earlier if the agreed content corpus is large. Size: M–L.

Evidence: `src/config/versionedStore.ts:243` duplicates the document under `value` and `config` for compatibility. `src/reflex/contentCompose.ts:116` filters/maps/sorts the live corpus per slot; `src/content/decide.ts:78` also builds full-catalog structures. In a local synthetic test, 100,000 content pieces produced a 37.42 MiB stored envelope; 300,000 produced 113.52 MiB. Both exceed KV's 25 MiB value limit. [KV limits](https://developers.cloudflare.com/kv/platform/limits/) The ranker-only 300,000-piece run took 502.1 ms locally; this is not a Worker benchmark. The Worker isolate memory limit is 128 MB, making whole-catalog expansion/cache accumulation a further design risk. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/)

Consequence: a per-scope “single catalog document” has a hard size boundary independent of latency tuning. Server-side console paging does not reduce what the decision worker parses/ranks. A customer's 300,000 products are not automatically 300,000 content pieces: `/sort` correctly caps candidates at 500 (`src/routes/sort.ts:33`), so this result must not be misrepresented as failure of that bounded endpoint.

Remedy: maintain immutable catalog shards and slot/locale/eligibility indexes, bound candidate sets and in-isolate caches, and use top-k selection rather than full ordering when only a few winners are needed. Product retrieval remains upstream, followed by candidate-preserving edge reranking; add semantic/ANN retrieval only when requirements and quality tests justify it. Measure the real metadata byte size, eligible candidates per slot, simultaneous tenant working sets, and refresh overlap before setting a supported envelope.

### F33 · The provisioned topology does not establish the promised per-customer stamp boundary

Severity: **fix before the next customer**; resolve before accepting Tapestry's topology. Size: M–L.

Evidence: brief 33 §4 defines one Worker per environment serving every tenant of that environment, without making the customer boundary explicit. `docs/architecture/19-tapestry-delivery-ledger.md:107` and `docs/PS-Implementation-Delivery-Guide.md:24`/`:168` prescribe a stamp per customer, with brand scopes inside it, independent stores/secrets/domain, and release pinning. The brief alone does not prove all customers intentionally share a Worker; the ambiguity matters because provisioning currently takes an environment plus one tenant key, not a complete customer/environment topology. `src/tenancy/objects.ts:53` obtains objects without a customer jurisdiction policy; a region field in a learning cell is not a data-residency control.

Consequence: if these environment stamps are shared across customers, they couple release cadence, secrets, operator blast radius, hot learning slots, cron, storage quotas, and demo availability. Five customer regions are not addressed just by naming five geography cells. Durable Object location hints are best-effort placement; jurisdiction controls restrict object storage/execution, not every part of the global request/connector/logging path. [Durable Object data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)

Remedy: keep shared code but default to the already-recorded per-customer, per-environment deployment contract, with per-brand namespaces and quotas. If shared SaaS is desired, explicitly agree a different isolation/release/control-plane model and demonstrate it; do not silently substitute it. Define regional shopper home, permitted stores/processing/exports/logs, jurisdiction bindings, failover, and connector destinations according to each customer's requirements. Do not automatically replicate raw identity/state across all regions. Legal/data-residency obligations were not supplied and are not inferred here.

### F34 · SDK lifecycle and high-cardinality measurement UI need hardening

Severity: **fix before the next customer**. Size: M.

Evidence: `src/sdk/emit.ts:109` installs anonymous click listeners, while cleanup at `:121` removes observers but not those listeners. `public/console/views-measure.js:110` iterates all slots/comparisons and `:159` flattens item × policy data without server paging, despite doc 28's enterprise-cardinality goal. The repository's current console has useful navigation and paged surfaces elsewhere; not every surface has the same bounds.

Consequence: repeated SPA mounting can duplicate captured events and bias learning. Large measurement reports can still overwhelm the browser even when catalog/lift endpoints page. A working small demo does not establish responsiveness for hundreds of slots and many policies.

Remedy: register removable listener functions, make capture attach/detach idempotent, and test SPA remount/unmount. Page/filter/stream heavy measurement views server-side against immutable versions and cap browser work. Run usability/performance cases at the promised item/slot/policy cardinality, including role restrictions, keyboard operation, and narrow screens.

### F35 · Baseline repository/setup debt remains and obscures safe handoff

Severity: **improvement**, except the security/release consequences already gated by F09/F10. Size: S–M.

Evidence: the earlier 34-item readiness audit is not wholly closed. Tracked abandoned-worktree files, cache database/sidecars, backup documents/assets, and `.npmrc.bak` remain. README at `:267` still references a nonexistent `wrangler.toml.example`; seed instructions refer to missing filenames (`wrangler.toml:132`). `migrations/seed/seed_011_geo.sql:32` contains unscoped geo-table deletes; this audit did not execute them. Test harness, CI, SDK packaging, auth primitives, and operator APIs have materially improved since the baseline.

Consequence: a services engineer cannot treat every checked-in setup/seed command as an approved customer operation. Old copies complicate searches, secret hygiene, and provenance; stale “closed” documentation makes review harder. Ignoring a directory does not remove already tracked content.

Remedy: a separately reviewed repository cleanup, verified fresh-clone setup, tenant-safe seed fixtures, generated command/API documentation, and an explicit baseline disposition register. Preserve user changes and historical material until their owner approves removal. Do not confuse test-count growth or excluding abandoned worktrees from test collection with removing them from source control.

## 2 · Architecture fitness, answered plainly

### Tapestry

**Conditionally the right foundation for the agreed first content page; not yet a delivered implementation of the full BTIE vision or even the documented pilot.** Keep bounded per-shopper, per-dimension affinity; explainable recency arithmetic; content IDs rather than page markup; configurable slot strategies; deterministic default scoring; candidate-preserving external-feed sorting; and separate population outcome estimates. These choices can support 20–30 personalized assets, transparent business tuning, and fast within-session adaptation without an embedding service on the render path. Change the authority/consistency model, SDK update contract, consent/identity boundaries, learning persistence, experimental measurement, and operator workflow before acceptance. Readable vectors and pooled counts can be a sensible co-designed alternative to some requested models, but do not literally deliver the paper's embedding-first, similar-user matching, learned journey classifier, or Phase 1 historical prototype evaluation. Those substitutions need explicit customer agreement and outcome evidence. The January Coach page is not the May 2027 experience-composition tier, and neither date silently closes current multi-brand, data-sharing, product-sort, or other signature commitments.

### The next customer

**Keep the engine, not the demo platform's deployment assumptions.** A reusable implementation needs customer/brand configuration and adapters through every ingress/state/connector path, explicit per-customer deployment and regional policy, bounded indexed catalog candidates, authoritative shopper state, partitioned learning statistics, reliable replayable ingestion, scoped operator access, and independently deployable demo/generative tooling. Ten brands × five regions × 300,000 products is a workload definition to size, not a reason by itself to demand GPUs, a vector database, or a Coach-specific fork. A bounded reranker over externally retrieved products can remain very small; an enormous content corpus needs indexed/sharded retrieval before scoring. The current mix of per-tenant content configuration and demo-scoped event/history/search logic fails the portability test. Prove a second, intentionally different customer's schema and privacy policy in isolation before presenting the platform as arbitrary-customer-ready.

## 3 · Performance guidance and supported capacity

### What the existing measurements actually establish

These are the team's recorded staging results in docs 31/32, not new authenticated load runs by this audit. Preserve caller wall time versus Worker time, population, date, and host; do not substitute one for another.

| Scenario | Recorded result | Audit interpretation |
|---|---|---|
| Fresh snapshot after CW37, doc 32 §5 | P50 wall 285.3 ms; Worker 235 ms | The observed median Worker time already exceeds the 200 ms P95 target. No updated P95/P99 proof is supplied. |
| Fresh action after CW37 | P50 wall 1,731 ms | Far above the interim 300 ms event target; the user-visible interaction loop remains slow even if scoring rounds to zero. |
| Fresh sort after CW37 | P50 wall 464.4 ms | Sort still creates/reads state through a different seam and ignores its accepted client session ID. |
| Returning snapshot, doc 32 §1 | P50 wall 35.2 ms / Worker 5 ms; wall P99 365.1 ms | Useful warm-path result, not proof of a consistent cold path or browser paint SLO. Doc 31 separately reports roughly 12 ms Worker time for a cached shopper. |
| Object host, doc 31 run 2 | Decision P50 192 ms, P95 665 ms, P99 795 ms; content clicks refused in that run | Better median, but not target-compliant. CW38 later fixes ingest; no fresh full acceptance/tail result establishes readiness after that fix. |
| Load scope, doc 31 | 40 new shoppers/s for 60–120 seconds, Atlanta edge | Useful short load characterization. It does not establish millions of concurrent users, multi-region tails, lifetime cell growth, or long queue recovery. |

The latency script makes forty measured calls after five warmups (`scripts/latency.mjs:129`). At that sample count, nearest-rank P99 is the maximum observation; it is a noisy sample, not evidence of a stable service P99. “New shopper” does not mean “cold isolate,” since the warmup deliberately warms code/document caches. Its snapshot/action/sort payloads at lines 103/108/113 omit the SDK browsing session; sort has only 24 IDs and no representative customer attributes. The script does not measure the actual SDK event-to-render contract. Rounded `decide: 0 ms` means below that timer's resolution on that data, not zero cost at any catalog size.

### The targets are different contracts, not interchangeable numbers

The customer's §5.1 names sub-10 ms signal processing and millions of concurrent users. Section 5.3 names low-latency feature serving and Phase 2's <100 ms P99 infrastructure. The team's <200 ms server P95 snapshot / <300 ms event targets are reasonable **interim pilot engineering gates**, but are weaker and differently scoped. Define whether each number measures CPU scoring, server request, committed event, feature read, or browser interaction-to-paint; obtain agreement rather than silently replacing the customer number.

Make the primary experience test: after the third accepted relevant interaction, the next displayed decision reflects at least that committed shopper revision, within an agreed browser deadline, without an invalid intermediate state. Report accuracy/freshness as well as latency. If the page waits on three routes, test their actual dependency graph; serial calls accumulate delay, while parallel calls still need a common state/config version. Do not add three independently measured P95 values and call the sum an end-to-end P95.

Recommended request shape:

```text
event → validate identity/consent/schema → commit shopper revision → acknowledge
                                              │
                                              ├→ page decisions / push → SDK renders newest revision
                                              └→ durable outbox → ledger / learning / exports
```

Use a page-scoped response or parallel bounded snapshot/sort reads against the same authoritative state when the frontend needs both. Do not wait for ODP calls, catalog-derived audience regeneration, warehouse writes, or the population-learning fold before acknowledging a committed shopper event. Equally, do not acknowledge an uncommitted update and rely on KV propagation to make the next decision correct.

As an initial **engineering allocation to validate**, reserve single-digit milliseconds of CPU for request validation and at most about 10 ms of CPU for bounded scoring/composition; aim to keep cached immutable-document/lift work within roughly 20 ms and the authoritative state operation within roughly 60 ms at P95 in the selected home region. Leave explicit budget for serialization, contention, cache misses, and the network. These are design hypotheses, not measured promises or a substitute for the customer's P99. If regional placement makes the state budget unattainable, change the topology/contract rather than declaring the warm arithmetic fast enough.

Priorities, in order:

1. Fix session authority, shared client identity, and SDK rendering correctness before optimizing misleading benchmarks (F04/F12/F14).
2. Resolve catalogs/configuration once per version; generate audiences at publication/provisioning, not before every event; cache immutable data with bounded working sets. Overlap independent reads, not dependent state transitions.
3. Qualify the object-host path with cold and warm customer journeys; migrate with parity, retained consent/identity, and rollback. Do not flip one global host variable merely because one median is smaller.
4. Keep eligibility/indexed retrieval and top-k composition bounded; load only the slots/candidates actually needed. Keep external inference off, or measure its separate explicitly accepted policy.
5. Use reliable asynchronous ingestion, batching, and partitioning; budget queue lag and publish lag separately from shopper freshness. Today's 30-second stats publishing alarm is not “instant population learning.”

### Synthetic local scale check

The audit compiled the actual pure content composer in memory and ran it in Node with ten disjoint slots, one selected piece per slot, and synthetic style/color metadata. The stored-size column includes the real versioned store's `value`/`config` duplication. Runs were single local measurements with explicit garbage collection before sampling; they are diagnostics, not Cloudflare capacity certifications. The heap delta is observed local allocation, not retained isolate memory.

| Content pieces | Composer time | Serialized stored envelope | Local heap delta |
|---|---:|---:|---:|
| 100 | 0.8 ms | 0.04 MiB | 0.5 MiB |
| 10,000 | 12.2 ms | 3.68 MiB | 14.4 MiB |
| 100,000 | 150.9 ms | 37.42 MiB | 129.3 MiB |
| 300,000 | 502.1 ms | 113.52 MiB | 300.1 MiB |

Do not derive a universal item-count limit from this sample; metadata sizes and eligible-slot overlap change it. The byte-limit violations are decisive for these payloads; the local timing/heap values identify work to bound. Separately, F08 is an actual local workerd storage failure, not a projected Node-memory failure.

For traffic sizing, define decision sets/second, slots and pieces/set, events/second, repeat rates, active shopper objects, item × context cells, retention, regions, burst factor, and connector fan-out. “A million decisions/day” could mean about 11.6 item decisions/second, not a million pages or concurrent shoppers. Each hot slot object sees roughly that slot's personalized decision-set rate, plus rewards; Cloudflare's documented soft per-object request limit is workload-dependent, not an unlimited aggregation service. [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/) Model monthly costs for DO requests/duration/storage, KV reads/writes, queue messages, R2 requests/bytes, logs, and optional AI with the actual workload and current account prices; this audit did not obtain a priced customer traffic model.

The hour's 600-object application cap is not “600 simultaneous connections,” nor proof every job fits platform limits. Report folding, erasure, and per-tenant cron loops have different operation/memory/duration envelopes. Enforce bounded concurrency, per-job checkpoints, per-tenant quotas, and backpressure using the deployed account's actual limits. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/)

### Required performance qualification

Run the actual released SDK in a browser against an authorized production-like lower environment, with a real tagged customer corpus. Separate first-ever visitor, new session/returning visitor, cold isolate/object, and warm-cache populations. Include rapid views/impressions, parallel snapshot+sort, consent/identity transitions, 20–30 rendered assets, mobile networks, permitted regions, and external scoring off/on if offered. Measure server P50/P95/P99, wall/paint latency, errors, wrong/stale decisions, dropped/duplicate events, state/learning/ledger lag, and recovery after injected dependency failure. Use sustained and burst runs long enough to expose hotspots, growth, retry storms, and queue drainage; publish sample counts and confidence around tail estimates. Keep error/timeout requests in the report instead of quoting percentiles only for successful calls. No customer SLO is passed by this audit.

## 4 · Judgment on all thirteen deliberate architecture decisions

| Brief §5 decision | Judgment | What must change or be agreed |
|---|---|---|
| 1. Decayed counts, shrinkage, clamped lift | Keep as an explainable baseline; a learned statistical estimator need not be a remotely served model. | Fix counter semantics, units, priors, persistence. A 21-day horizon, n₀=30, and n-min=30 are tunable hypotheses, not confidence guarantees or evidence of 48–72-hour convergence. |
| 2. Six-level pooling ladder | Defensible hierarchical backoff, not proven optimal. | Forcing channel/visit before stage fragments evidence; compare alternative groupings on actual data. Correct missing visit/channel input first. Exposure-weighted slot priors reflect past selection and position, so explore new items and calibrate shrinkage rather than assuming unbiased discovery. |
| 3. Attribution as a configurable policy | Keep separate from causal measurement. | Honor explicit slot/decision identity, distinguish visibility, define multi-placement purchase credit and units, align storage to the policy window, and recompute versioned generations when policies change. |
| 4. Sticky holdout and confidence | Keep persistent randomization; replace the present business-effect report. | Stable enrollment, true production control, all eligible visitor outcomes, appropriate inference/targets and six-month completeness (F07/F25). Adaptation alone does not make randomized control invalid. |
| 5. Exploration and autonomy | Keep guarded exploration and assisted, reversible proposals; do not enable current unrestricted modes. | Thompson budget/reward defects and stale/autonomous proposal safety must close; show real evidence that changing weights helps, not merely that tags correlate with observed lift. |
| 6. NDJSON ledger on object storage | Keep as durable export/replay substrate. | Add idempotent processing, reliable live/batch reconciliation, event-time corrections, bounded indexed attribution state, erasure watermarks, and destination acceptance. Immutability is an application protocol, especially with erasure rewrites. |
| 7. Two shopper hosts | A migration/test option, not two indefinitely equal production authorities. | Prefer a transactional shopper-object target after complete parity/latency acceptance. Retain a tested rollback/migration plan; host selection cannot bypass identity/consent/erase invariants. |
| 8. Two consent switches | Keep the product semantics if customer-approved. | Enforce once across every route/write/connector and both hosts, including unknown/error states; distinguish essential preference storage from tracking. |
| 9. Tombstone plus rewrite | Reasonable object-storage deletion pattern, incomplete here. | Preserve replay suppression, discover all identities/stores before deletion, checkpoint safely, reconcile external destinations and retained aggregates. |
| 10. Local operator accounts in D1 | Acceptable for an explicitly approved limited pilot, not an SSO claim. | Fix token-type/revocation, tenant privileges and onboarding restrictions. Benchmark password-check cost/abuse controls; have the customer decide SSO/MFA/federation and invitation requirements before access acceptance. |
| 11. Single operator application, paged lists | Keep one coherent console. | Implement the business-user weight/pin workflow, correct units/schema, page heavy measurement views, and verify authenticated enterprise usability. |
| 12. Multi-tenancy within a stamp | Keep logical brand scopes inside an explicit customer boundary. | Bind authority to scope; remove Coach fallbacks; define operator, connector, job, region, release, and quota boundaries. Prefix tests alone are insufficient. |
| 13. Demo shares the Worker | Do not carry this coupling into customer deployables. | Share engine packages/contracts/fixtures, not public demo routes, agents, D1 tables, AI jobs, keys, or release availability with the customer data plane. |

The North Star survives as **small, explainable decisions from bounded state and immutable published inputs**. It does not survive as claims of arbitrary catalog size, eventual KV as immediate authority, best-effort delivery as complete explainability, or attribution counts as incrementality. Neither a vector database nor a deep model fixes these defects.

## 5 · Requirement and scope traceability

### Actual twelve signature capabilities, not the ledger's assurance rows

Clause numbering below is the accepted-view text of the repository's tracked v8 scope draft. It is not proof of executed commercial terms. Each “partial” status requires the named remedy/evidence; absence of authenticated/customer acceptance is not represented as code absence.

| Scope clause | Capability | Audit status / closure evidence needed |
|---|---|---|
| 1.1 | First-party profiling | Implemented foundation, partial integration: F03–F05/F12–F14/F31. Prove agreed signals, same shopper, same registry, and rendered change. |
| 1.2 | Self-building audiences; rename/pin/prune | Generation and operator verbs implemented. Customer/brand authority and authenticated workflow remain to prove; remove per-event regeneration from the hot path. |
| 1.3 | Content catalog and AI enrichment | Import/lifecycle exist; metadata corruption F27. Generic proposed-label approval/publication absent; demo OfferDesk is not the customer workflow (F11). |
| 1.4 | Dimensions, hot tuning, per-slot weights/autonomy | Versioned APIs exist; conflict/atomicity, business UI, context and autonomy defects prevent closure (F13/F15/F24/F26). |
| 1.5 | Governance, merchandising, overrides | Window/stock gates and multipliers exist. Feed round-trip, pin uniqueness, explicit priority/exclusion/off-limits semantics remain (F27/F28). |
| 1.6 | Every decision persisted/exportable | Content path exists with reliability/replay defects (F16/F22). Product/section grains remain open in doc 20 row 5; scope/date for each grain must be explicit. |
| 1.7 | Multi-brand hard isolation | Namespace primitives exist; ingress/operator/connector/registry/topology gaps prevent closure (F03/F31/F33). |
| 1.8 | DS exports, priors, debug, scheduled egress | Substantial APIs and receipts exist; contextual priors, replay, retention/reconciliation and destination evidence incomplete (F06/F16–F22/F25). |
| 1.9 | Product Recommendations entitlement | Separate Optimizely entitlement/provisioning unverified; not established by this engine's demo code. |
| 1.10 | AI Search on customer catalog/live affinity | Coach-specific demo exists, not generic customer catalog/live-shopper integration (F11/F31). |
| 1.11 | Custom sorting, including SFCC | Candidate-preserving bounded ranker is real. Authentication, consent, registry/session propagation and actual feed adapter/parity need acceptance (F01/F05/F14/F31). SFCC is committed, not a reopened scope choice. |
| 1.12 | Scheduled Snowflake share and historical enrichment | R2 partitions and weighted timestamped history exist. Scheduled destination readback, customer/third-party attribute and audience inputs, brand scope, and deletion reconciliation are not delivered by those components alone (F06/F11/F31). |

### Disposition of every doc 20 working row

The current table labels rows 1–13, placing 13 before 12, despite its “twelve capabilities” summary. Assurance rows such as testing/holdout do not replace missing scope clauses.

| Doc 20 row | Audit disposition |
|---|---|
| 1 · Immediate config | Reopen: concurrent writes overwrite immutable revisions; propagation and UI completeness not established (F15/F26). |
| 2 · Snowflake/history/identity | Reopen broad closure: exports/history are real components, not scheduled sharing or complete enrichment; identity/privacy defects remain (F04/F06/F11). |
| 3 · Hard isolation | Reopen: correct namespaces do not establish caller/connector/registry isolation (F03/F31). |
| 4 · DS surfaces | Partial: APIs exist, but contextual priors/replay/report reliability fail adversarial cases (F16–F22/F25). |
| 5 · All decision grains | Remains open as the ledger admits; content reliability also needs repair. Do not mark current product-sort persistence delivered from demo receipts. |
| 6 · Merchandising | Partial: direct scoring exists; normal import loses its signals (F27). |
| 7 · Rename/pin/prune | Code-backed verbs accepted as implemented; customer authorization and actual operator walkthrough still required. |
| 8 · CMS/DAM import | Partial: normalizer/schema defects; original scope also includes enrichment/approval, not represented by this row (F11/F27). |
| 9 · External/SFCC sort | Ranker accepted as implemented; reopen end-to-end integration/security closure (F01/F05/F14/F31). |
| 10 · API-first SDK delivery | Headless snapshot exists; SDK live update not delivered by the documented integration (F12). |
| 11 · Tested | Test harness closure accepted: 1,092 tests pass now. Reject the inference that this proves all twelve capabilities or the Workers runtime. CI/lint/deploy text is partly stale (F10). |
| 13 · Customer first-party attributes | Event-when-unknown scoring is real. Arbitrary-brand registry and actual kit rendering remain incomplete (F12/F31). |
| 12 · Holdout | Assignment/report components exist; reopen permanence, baseline, denominator, inference, and coverage claims (F07/F25). |

### D1–D13, including decisions to build nothing

| Delta in doc 26 | Independent conclusion |
|---|---|
| D1 · Journey-native content | Partial: stage metadata/context/term exist; customer aliases, classifier semantics, post-purchase behavior, and operator form fail or remain incomplete (F13/F26/F27). |
| D2 · Freshness/fatigue | Terms exist. Served-versus-seen semantics and finite ring history/replay prevent the full promise (F17/F21/F22). |
| D3 · Profit/value | Value-weighted rewards exist; configuration can mix units, and revenue/margin alone is not an agreed profit objective (F19). |
| D4 · Confidence/targets/windows | Reopen: controls/interval routines do not repair the wrong experimental unit/control or incomplete time coverage (F07/F25). |
| D5 · Schema alignment | Partial: import drops merchandising, stage aliases fail, featured products link to attribution rather than inherit their attributes (F27). |
| D6 · Scroll/hover | Not in shipped generic capture. May remain optional only with explicit pilot exclusion; do not describe full implicit-signal fusion as delivered. |
| D7 · Anonymous cross-device | Deliberately absent. Deterministic recognized linkage is useful but different; no fingerprinting is a defensible privacy boundary requiring acknowledged scope substitution. F04 still blocks the implemented recognized flow. |
| D8 · Embeddings/lookalikes/vector store | Readable affinity and pooled priors are sensible alternatives, not learned semantic embeddings or nearest-neighbor lookalikes. No automatic need for a vector database, but the paper explicitly names Phase 1 mechanisms and offline evaluation. Obtain approval of the substitution and a valid comparative quality experiment; do not close on “same outcome” without evidence. |
| D9 · RTBF | Reopen: host/cache/discovery/retry/tombstone gaps (F06). |
| D10 · Consent | Reopen: route/host/connector enforcement is inconsistent (F05). |
| D11 · Diversity/inventory | Partial: supplied stock flag exclusion works; live inventory feed unverified, diversity soft, later pins violate uniqueness (F28). |
| D12 · Latency | Open: fresh median already exceeds interim budget; neither customer P99 nor third-interaction-to-paint has passed (§3). |
| D13 · Later DRL/NLG/multiobjective/foundation/unified platform | A legitimate staged roadmap boundary, not a January build mandate. The optional future is not delivered by demo NLG, an external hook, or a ledger seam. Do not use D13 to defer present §1.9 product entitlement or other signature capabilities. |

### Customer §3: each experience outcome and objective group

| Source clause/outcome | Assessment and required acceptance |
|---|---|
| §3 pre-click context / collective intelligence | Population/geo priors exist, but ordinary channel/visit context is lost; illustrative learned percentages are not measured results. Verify first-page creative/channel/device/time scenarios and name unsupported features (F13/D8). |
| §3 click 1 / sparse signal response | Affinity arithmetic can react to one weighted tagged event. It does not learn arbitrary multi-event patterns merely by summing tags; test real customer event schemas/registry (F31). |
| §3 click 2 / aesthetic across categories | Shared tagged dimensions can transfer taste across categories. Semantic embedding retrieval/lookalikes are not implemented equivalents (D8); taxonomy/content completeness and product retrieval are prerequisites. |
| §3 click 3 / intent detection and continuing journey | SDK fails the live-render loop; current stage heuristic differs from the short-dwell exploring example and lacks calibrated confidence/post-purchase (F12/F13). |
| §3.1 individualized components instead of segment rules | Headless content scoring is a real foundation. Page/module-order experience composition is a separate later tier; demo layout code is not generic customer orchestration. |
| §3.2 time to relevance | No exact-kit third-interaction rendered acceptance; F12/F14/F29. |
| §3.2 journey awareness | Partial heuristic with mapping/UI defects; F13/F26/F27. |
| §3.2 style understanding | Supported by readable shared dimensions given correct taxonomy; customer calibration and cross-category evidence not supplied. |
| §3.2 content matching | Individual candidate scoring exists; governance, learned statistics, and scale envelope must be fixed/accepted. |
| §3.2 product discovery / price comfort | Bounded product sorting and price posture exist; actual external/SFCC candidate attributes, session continuity, and production parity unverified. |
| §3.2 return memory | Durable IDs/state exist, but identity/session correctness and days/weeks calibration remain (F04/F13/F14). |
| §3.2 cross-channel awareness | Captured UTMs/referrers are not proof of creative-level/search-keyword/influencer continuity or immediate scoring effect. Define inputs, attribution identity, and accepted scenarios. |
| §3.2 cross-device without login | Deliberate non-delivery; recognized deterministic linkage is not anonymous matching. Agree the privacy/scope boundary rather than implementing fingerprinting implicitly. |
| §3.3 profit initially | Agree profit versus leadership-selected metric and required cost/margin/refund feeds; fix learning units and causal measurement (F07/F19). |
| §3.3 later margin, returns, LTV, brand equity | Valid roadmap objectives. Current scalar rewards/multipliers are not multiobjective constrained optimization, LTV prediction, or return-risk modeling. |
| §3.4 business results | CVR/LTV/acquisition/AOV/bounce/email expectations are hypotheses/targets, not observed engine outcomes or an inferred revenue warranty. Establish feeds and experiments for each claimed result. |

### Customer §5: principles, capabilities, and phase exit criteria

| Source clause | Assessment and acceptance gate |
|---|---|
| §5.1 sub-10 ms signals; sparse relevance; millions concurrent | Bounded arithmetic is promising. Whole request/paint, cold state, hot-slot throughput and multi-region scale are not proven (§3). |
| §5.2 principle 1 · One visitor/profile | Implemented deterministic linkage with F03/F04/F06/F14 defects; no anonymous identity graph. |
| Principle 2 · Learn immediately | Shopper update path exists but does not produce the documented live content paint; population snapshots publish on a separate cadence. |
| Principle 3 · Recency weighting | Implemented; production horizons need calibration, and outcome counters need order-invariance repair (F13/F18). |
| Principle 4 · Multimodal/calibrated signals | Click/commerce/dwell/video supported; scroll/hover absent from shipped generic capture, viewport semantics incomplete, customer signal weights unvalidated. |
| Principle 5 · Similar-user cold start | Context/population priors are not similar-user nearest-neighbor transfer; explicit D8 substitution/evaluation needed. |
| Principle 6 · Explore/exploit | Mechanisms exist, but share/reward/context defects prevent broad closure (F23); do not promise every session explores if using a fractional share. |
| Principle 7 · Graceful degradation | Defaults exist. Define customer fallback/handoff so no-valid-candidate results do not create empty UI, while preserving no arbitrary engine fill and hard eligibility. Test timeout/no-flash/state failure. |
| Principle 8 · Governance/privacy | Material controls exist; F01–F06/F28 prevent closure. Brand equity/no-clickbait/discount policies also need approved content/rule governance, not just a stock flag. |
| Principle 9 · Embedding-first | Intentional architectural substitution, not fulfilled literally. Needs customer-approved co-design and measurable acceptance (D8). |
| §5.2.1 recognized versus anonymous optimization | Recognized deterministic profile merge exists with defects. Anonymous fingerprint/probabilistic continuity deliberately absent; DRL remains future. |
| §5.3 recommendation types | Product reranking, content selection, and page structure must remain distinct contracts. Keep existing product recommendation entitlement/vendor where agreed; May composition is not January content selection. |
| §5.3.1 event streaming / impressions | Ingestion exists; reliability, viewport exposure, SDK delivery, and lag gates remain (F12/F16/F21). |
| Unified profile / feature serving | Substantial state implementation, not a proven low-latency, consent-correct, arbitrary-brand feature authority (F03–F05/F13/F14/F31). |
| User/content embeddings / vector database | Not built as requested mechanisms. A readable-vector alternative may be acceptable; demonstrate quality and retrieval scale, do not infer acceptance. |
| Journey classifier / content ranking | Explainable heuristic stage and deterministic scorer plus learned lift exist; not calibrated classification or a historical-data ML proof of lift. |
| Experience orchestration | Later design/tier; generic customer module selection/order/layout not established by Meridian demo code. |
| Contextual bandit | Context cells/exploration exist; Thompson currently uses root statistics. Correct mechanics and evaluate time-to-signal on actual traffic; 48–72 hours cannot be guaranteed from n-min alone. |
| DRL / NLG / multiple objectives | Explicitly later under phased agreement; no claim of generic delivery from demo features. |
| Causal measurement / policy layer | F07/F25 and F01–F06/F28 reopen these foundations. |
| §5.3.2 reference frameworks | Listed tools are reference options, not a mandate to deploy every named vendor. Compare architecture against outcomes/mechanisms explicitly accepted; no need to introduce Kubernetes/GPU infrastructure solely because it appears in the paper. |
| §5.3.3 Phase 1 architecture/data/infra plan | Documents and component tests exist; production failure modes, costs, event validation, and customer workloads need acceptance. |
| Phase 1 historical ranking POC versus segment rules | Not demonstrated by current tests or holdout proof. Agree accepted alternative model/mechanism and valid offline/online evaluation against actual production control (F07/F22/D8). |
| Phase 1 content readiness | Customer must commit sufficient variants/tags. The paper's 40+ photos/page, 15 PDP variations, and 20+ See/Think pieces/product are broader readiness ambitions than the first-page 20–30-image demo acceptance; record which content delivery applies when. |
| Phase 1 measurement/budget/team exit | Valid experiment design, content commitment, approved budget and staffed plan remain external acceptance dependencies; a repository cannot prove those approvals. |
| Phase 1 five MVP capabilities | Streaming/profile implemented partially; semantic embeddings absent; ranking is alternative mechanism; contextual exploration defective. Do not mark all five literally complete. |
| Phase 2 rollout/features/monitoring | Homepage/PLP/PDP/overlays, all-brand rollout, style/price models, drift/retraining, DRL/NLG pilots and secondary objectives are not all delivered now. Trace to separate accepted milestones; validate <100 ms P99 and measured effects when claimed. |
| Phase 3 unified platform and exit decision | Future, conditional on Phase 2 results, vendor comparison, economics, team and appetite. Do not force an in-house product engine, full DRL/NLG, or cross-channel optimization into the January launch. |

### Customer §6: measurement, flywheel, and reporting

| Source clause | Assessment and acceptance gate |
|---|---|
| §6.1 adaptive/non-stationary policy | Measure cumulative randomized policy impact across fixed windows, including exploration cost. Adaptation does not invalidate all ordinary randomized experiments; naive point-in-time attribution is the actual concern. |
| §6.2 Predict | Version targets and pre-test content before spending. No validated predicted impact/business-case model is delivered by sample-size text. |
| §6.2 Optimize | Lift/rotation/proposal controls exist; incomplete data and noisy/stale autonomy can recommend harm (F16–F25). Establish convergence/drift/quality/harm triggers. |
| §6.2 Learn | Controlled experiments with true production baseline and all visitor outcomes, plus an analysis/review process; current slot-attribution comparisons are insufficient (F07). |
| §6.3 methodology / ≥90% significance | Support correctly scoped interval/stopping choices with pre-set targets, not just a confidence selector. Distinguish statistical confidence from business value and causality. |
| §6.4.1 5–10% permanent control, persistent ID, 6+ months | Hash exists but assignment can change at identity transitions; consent defaults contaminate arm labels; data horizon and provisioning stability fail (F07/F09/F25). Fingerprinting is deliberately excluded and must be acknowledged. |
| §6.4.1 existing production experience | Not equivalent to catalog-order default. Supply/validate segment-rule control parity and control exposure capture (F07). |
| §6.4.2 CVR +10/+40/+60%; RPV +10/+25/+40%; returns thresholds | Values are pre-set customer targets, not results. Create distinct approved metric definitions, allocation-aware power, denominators, return/cost feeds, and target versions. Current report cannot substantiate these outcomes. |
| §6.4.3 monthly, quarterly, biannual / YoY and MoM | Date routing exists; 92-day truncation, missing/immature hours, retention, repeat-user clustering and comparison baselines need repair. Calendar labels are not complete comparable cohorts. |
| §6.5 IABI | Receipts and human-readable text support analysis. A real deliverable needs specific insight, action, predicted impact with uncertainty, owner, and subsequent measured result. Autonomy's association-based increase and “needs N decisions” do not constitute that causal/business-impact workflow. |

Appendix implications also traced: A.3's stage/metadata/product inheritance (F13/F27); cold-content exploration/500+ impressions and per-audience Thompson (F20/F23); impression visibility and repeat avoidance (F17/F21); 50–100+ pieces/variants, validation/retirement and enrichment operations (F11/F27/F29); and A.4's absolute policy/brand safeguards (F05/F28). Lifecycle expiration is implemented; performance-driven retirement and customer-reviewed content policy are not established merely by having publish/expire fields.

## 6 · Delivery gates and ownership

Do not reopen Coach-first, committed SFCC/external-feed sorting, or the previously settled lower-environment-versus-production wording as avoidance mechanisms. Also do not force all later-phase mechanisms into the first page. The useful distinction is safety, observable delivery, scientific validation, commercial provisioning, and explicitly staged future scope.

| Gate | Required evidence | Suggested accountable owners |
|---|---|---|
| Before any real customer data or account access | Enforced route/agent allowlist, scoped authorization, token/identity/logout fixes, end-to-end consent and erasure, stable provisioning/secrets, reviewed deployment boundary. F01–F06/F09/F10/F33. | Platform/security lead; customer privacy/identity owners for policy and connector acceptance. |
| Integratable SDK/docs, approximately mid-October per doc 19 | Exact kit works in a browser; three-interaction repaint; shared session/revision across events/sort/snapshot; real schema and operator weights; fallback/no-flash/tagging validation. F12–F15/F26–F29. | SDK/platform and PS integration leads; named customer frontend/content owners. |
| Customer lower environment, end October before freeze | Signed 20–30-asset scenario pack; actual CMS/SFCC/identity connections; customer configuration instead of demo defaults; negative privacy/isolation cases; API/artifact version and performance qualification. | Delivery owner plus customer capability owner; feed/identity/platform leads. |
| Before enabling learned lift, bandit, or autonomy, or claiming lift | Correct/idempotent/durable data, storage bounds, validated attribution/replay/priors/objectives, mature complete reporting, persistent production control and agreed inference. F07/F08/F16–F25. | Learning/data engineering and customer DS/measurement leads. |
| November freeze readiness and January Coach page | Rehearsed artifact promotion, migrations, rollback, on-call alerts/runbook; no unresolved safety gate; customer acceptance and commercial entitlements/share obligations closed or explicitly amended. | Release/SRE lead; delivery/commercial owners for non-code evidence. |
| Before additional brands/customers | Two non-default-brand adversarial qualification; generic taxonomy/connector/import/search/history paths; customer stamps/region policy/quotas; catalog/stats and console cardinality tests. F03/F11/F31–F34. | Core-platform owner, not a Coach-specific implementation fork. |
| May 2027 experience tier and later BTIE phases | Separate module/order/layout contract and decision grains, model/DS strategy, content readiness, experiments, and milestone acceptance. | Experience-platform/product leads with customer sign-off. |

If learning is held in shadow, disable unsupported exploration/autonomous changes too and make the UI/status ledger reflect that restriction. A safe, fast deterministic first-page pilot would be valuable; it would not establish the paper's learned optimization or incremental lift. Nothing in this report warrants a fixed completion date without staffing, dependency, and customer-data estimates. Use the sizes to sequence shared remediation work, then estimate the actual critical path once owners accept it.

## 7 · Verification performed and evidence strength

This was a lead audit with three parallel reviewers, all `gpt-6-astra` at extra-high reasoning, covering requirements/product, learning/measurement, and security/privacy/tenancy. Findings were consolidated and the corresponding specialists re-read their sections for overstatement/reference errors. Their work complements, not replaces, the lead's source inspection, concurrency/scale/runtime probes, and verification.

| Check | Result | What it does and does not prove |
|---|---|---|
| `npx vitest run` | 92 test files, **1,092 tests passed**, about 49.34 s | Current checkout passes its suite. Brief's 1,089 count predates the three added CW39 tests. The configured suite uses Node/stubbed bindings, not distributed deployed stores. |
| Root TypeScript check | Passed using `npx tsc --noEmit --tsBuildInfoFile` with a temporary output path | Types compile without modifying tracked build metadata. An initial `--incremental false` attempt was rejected because composite projects require incremental support; the corrected check passed. |
| SDK TypeScript check | `npx tsc -p src/sdk --noEmit` passed | SDK types compile; does not demonstrate the browser update contract. |
| `npm run lint` | Failed before source analysis, exit 2 | Missing `plugin:` in ESLint extends; no fresh source-warning/error inventory was obtained. |
| Versioned config concurrent patch | Both returned revision 2; one patch lost | Actual compiled module with a deterministic in-memory KV fake. Proves application conflict defect even without eventual consistency. |
| Learning storage | Actual local workerd SQLite-backed DO returned `SQLITE_TOOBIG` at 2,618,613-byte synthetic state | Real local runtime constraint. Not a production traffic/load run or a universal cell-count capacity. |
| Catalog scaling | Four actual-composer synthetic sizes in §3 | Measured local time/bytes/heap diagnostics. KV byte limits are independently documented; Node time/heap must not be labeled Worker SLOs. |
| SDK integration | Three awaited events, one paint/snapshot, original hero | Actual bundled SDK with test host and production-shaped update. Browser layout/network behavior was not executed. |
| Form/import/governance | Stage default rejected; merchandising stripped; aliases rejected; malformed/repeated tags accepted; pin duplicated | Actual validator/normalizer/composer functions, synthetic inputs. Feed/customer UX acceptance still needed. |
| Learning/report adversarial cases | Duplicate rows, stale/late-hour loss, order-dependent decay, mixed units, misplaced priors, double-placement credit, replay mismatch, zero-share Thompson changes, stale/noisy autonomy, truncated window | Actual implementation in isolated local harnesses. They are counterexamples to universal claims, not estimates of real-world incidence. |
| Authorization/identity cases | Revoked refresh accepted as API bearer; cross-brand key/header mismatch; unauthenticated CDP behavior; logout session resurrection | Isolated actual modules/middleware with synthetic records and stub bindings. No customer records or live credentials were used. |
| Public staging assets | Console/static JavaScript/SDK available; invalid stage default present in served JS | Read-only public GETs. Not an authenticated console walkthrough, deployment attestation, or an authorized load/acceptance run. |
| Reference check | All explicit file:line citations checked for file existence and line bounds; specialist corrections incorporated | Existence checking is not semantic proof; source and function probes provide the substantive evidence. |

The temporary audit harnesses were not added as permanent regression suites. The report records their methods, inputs/counterexamples, and outcomes; remediation should turn each into a reproducible committed regression test, especially Workers-runtime, concurrency, retry/erasure, and exact-kit integration cases. No install, remote seed, authenticated acceptance/load test, secret rotation, deployment, or production mutation was performed for this audit.

Workspace preservation: the pre-existing modification to `public/meridian/engine.bundle.js` and untracked `docs/Affinity-Outcome-Learning-Design.html` were left untouched. The only deliverable added by this audit is this report. The untracked design document is not treated as an authoritative replacement for the supplied memo or as deployed implementation evidence.

### Earlier 34-item audit: what was and was not remedied

This is a disposition check of `docs/handover/00-readiness-summary.md` and `01-code-audit.md`, not a claim that every old demo/document link was re-audited in depth. Numbers below preserve the original list's numbering.

| Baseline items | Current disposition |
|---|---|
| 1 · Previously committed credential | Current root ignore improved; a tracked stale-worktree copy remains. Rotation/revocation unverified. F09. |
| 2 · Committed worktree | Ignore added, but 96 stale tracked snapshot files remain. F35; do not remove without a separately reviewed cleanup. |
| 3 · Cache DB/sidecars | Tracked cache database and sidecar material remains, including the old snapshot copy. |
| 4 · Ignore/template MCP configuration | Root ignore present; historical tracked copy not thereby removed. Safe template completeness not independently certified. |
| 5 · Test harness | Remedied: suite runs and passes. Its Node environment does not qualify Workers storage semantics. |
| 6 · ESLint extends | Still broken; directly reproduced. |
| 7 · Dead seed references | Still present in wrangler/seed guidance. |
| 8 · Unscoped geo seed deletes | Still present; not executed. Requires tenant/demo-safe seed policy. |
| 9 · Committed JWT dev placeholder | Secret-binding/provisioning approach now exists; no live secret inventory or rotation attestation was performed. |
| 10 · Shared-repo/customer-document push manifest | Not executed by this audit; customer/internal documents remain. Publication/redaction is a separate owner-authorized action. |
| 11 · Duplicate/backup files | Named backup/duplicate artifacts remain; not deleted. |
| 12 · CI | Added for types/tests. Release/lint/artifact-promotion gate still incomplete. |
| 13 · Reference dumps | Low-priority owner decision; a fresh unreferenced-file census was not performed. |
| 14 · README onboarding | Still references missing `wrangler.toml.example`; fresh-clone operator/customer onboarding not accepted. |
| 15 · `.dev.vars.example` | Not present as a tracked handoff deliverable. No private environment file was used as a public template. |
| 16 · `docs/DEMOS.md` | Not present as the tracked baseline-requested deliverable; no blanket claim that every newer demo guide is absent. |
| 17 · Presenter/reset runsheet | Complete current presenter/reset behavior not requalified; outside the customer-engine acceptance proof. |
| 18 · Documentation index links | Old 23/29 broken-link count not repeated as a current fact; full current link crawl not done. |
| 19 · `docs/VERIFICATION-HARNESS.md` | Not present as the tracked baseline-requested deliverable; customer production screenshot route absence is intentional. |
| 20 · Build/deploy drift | SDK/Meridian build wiring improved. Lint prevents the advertised deploy path; island/rehearsal drift still merits cleanup. |
| 21 · Monolith/module boundaries | SDK extracted, but the demo retains orchestration the SDK lacks (F12). Full demo refactoring not audited as a launch prerequisite. |
| 22 · Structured logging | Request IDs/logger/monitor records improved. Comprehensive redaction, retention, dashboard and runbook acceptance remains open. |
| 23 · Route/object tests | Substantial test expansion. Actual-runtime and adversarial gaps demonstrated here remain. |
| 24 · Document open auth/CORS | Enforced-mode controls added; residual routes and authorization boundary still fail (F01–F03). |
| 25 · Built-v1 mislabeling | APIs now exist, unlike baseline; broad closure still unsupported by integration/scientific/operational evidence. |
| 26 · Versioned config | Built, but not atomic/conflict-safe (F15). |
| 27 · Regional trending | Built; scope/consent/job propagation needs repair and real-customer calibration. |
| 28 · Multi-tenancy | Primitives built; end-to-end authority and customer neutrality not closed (F03/F31/F33). |
| 29 · Content API/catalog/telemetry | Built; SDK rendering, import, governance and ledger reliability remain (F12/F16/F27/F28). |
| 30 · Visit/channel/stable identity | Ingestion/state improvements real, but content path drops context and identity transitions remain unsafe (F04/F13). |
| 31 · Environments/auth/CORS | Separate environment bindings and gates built; complete route coverage and isolation not delivered. |
| 32 · Tuning UI | Exists in part; customer per-slot dimension workflow missing and stage form invalid (F26). |
| 33 · SDK | Packaged and typed; documented live-update flow incomplete (F12). |
| 34 · Measurement/holdout | Designed and implemented in part; invalid unit/control/permanence/coverage prevents causal acceptance (F07/F25). |

## 8 · Not verified, and the evidence needed to close it

- **Executed contract and approved substitutions:** executed scope/version precedence; customer agreement on readable vectors versus embeddings/lookalikes, anonymous identity limits, omitted implicit signals, objective semantics, scope timing, SSO, and the actual kickoff/freeze plan. Repository drafts cannot establish these decisions.
- **Deployed provenance and configuration:** authorized Cloudflare deployment/version and binding manifest tied to the tested Worker/SDK artifact; effective auth/consent/key settings; live secrets held only by their owners; customer/brand host mapping; no request to disclose secret values is necessary. Public static GETs do not establish these facts.
- **Real customer integration:** CMS/DAM and SFCC sample feeds, taxonomy/tag plan, 20–30 launch assets plus agreed variants, current production segment rules/control resolver, identity backend assertions, consent manager behavior, warehouse destination and ownership, and Product Recommendations entitlement/provisioning.
- **Authenticated operator experience:** appropriate scoped test accounts and a browser walkthrough covering the actual merchandiser tasks, accessibility, errors, concurrency, and enterprise cardinality. Browser automation was unavailable during this audit; no claim of full visual/interactive console acceptance is made.
- **Scientific/business evidence:** historical data with provenance and appropriate logging support; agreed experimental unit, eligibility, assignment persistence, objectives/targets, allocation, maturity and stopping rules; CVR/RPV/margin/returns feeds; production baseline parity; customer DS review and a valid experiment. Replay and unit tests alone cannot prove lift.
- **Scale/SLO/cost:** customer traffic and content working-set distributions, regions, peak/burst behavior, actual account limits/pricing, authenticated representative browser/load results, cold/warm tail samples, queue/learning/erasure lag, and failure recovery. No “millions concurrent,” sub-10 ms full signal path, <100 ms P99, or positive business impact is certified here.
- **Operational/privacy completion:** secret revocation receipts for previously committed material; tested non-rotating reconcile/restore; migration/rollback drills; alert delivery/on-call ownership; configured R2 and other store retention; completed cross-host/connector/warehouse deletion and late-backfill suppression; customer-approved regional processing and data-minimization policy. No legal-compliance certification is inferred.

Bottom line: the team has made substantial, useful progress since the baseline, but has repeatedly closed **components** as though they were **customer capabilities**. The next work should be safe authoritative state, a functioning customer SDK/operator journey, truthful scoped delivery, and trustworthy learning/measurement—not a rewrite into a more elaborate model stack and not another layer of optimistic closure documentation.
