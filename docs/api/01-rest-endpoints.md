# API Reference — REST Endpoints (as-built)

**Status:** verified against code 2026-07-08 (every route confirmed mounted in `src/index.ts`). Supersedes the 2025 reference (preserved as [legacy-01-rest-endpoints-2025.md](./legacy-01-rest-endpoints-2025.md), which documented ~15 of the current ~75 endpoints and 3 endpoints that never existed).
**Companion:** [02-websocket-protocol.md](./02-websocket-protocol.md).
**Customer surface (2026-09-04):** the routes a customer integration uses, with exact request and response shapes, are in the integration kit, [docs/kit/02-api-reference.md](../kit/02-api-reference.md); this page stays the internal as-built inventory. Since 2026-07-08 the platform gained: the content documents (`/content/{catalog|slots|learn|priors}` with history, validate, rollback, import and pull), the decision service and the learning routes (`/v1/:tenant/decisions/snapshot`, `lift`, `lift/history`, `ledger/:id`, `ledger/batches` (one `date=`, or a `from=`/`to=` window of at most 184 inclusive days, each entry naming its `date`), `ledger/erasures` (list, write, rewrite), `replay/:id`, `learn/report`, `learn/cycle`, `learn/proposals`, `learn/items/reset`, `models/reference`, `trend`, `visitors/:id/recent`), identity stitching (`/v1/:tenant/identity/*`), the versioned reflex configuration (`/config/reflex`), site-key and operator-token gates (`AUTH_MODE`), and the SDK at `/sdk/edge-personalization.js`. The kit documents all of them. As built, an accepted `POST /content/catalog/import` or `/content/catalog/pull` answers `{ok, scope, mode, received, imported, pieces, changed, removed, changedBasis, revision, publication, version, diagnostics}`: `changed` and `removed` are the stored pieces the write created or altered and the stored pieces it dropped, measured against the base revision `changedBasis` names (`stored`, or `unavailable` with both counts `null` when that revision cannot be read). `diagnostics` is the shared advisory `catalog-registry-diagnostics/v1` channel — `{schema, advisory, status, catalogRevision, registry, slots, warningCount, omittedWarningCount, counts, warnings}` — whose codes are `unknown_dimension`, `no_nonempty_registered_tags`, `case_variant_value`, `unknown_slot_type` (all keyed by the stored `pieceIndex`), `ignored_field` (keyed by the request's `recordIndex`) and `ignored_document_field` (no position). A decision set additionally carries `constraintDiagnostics` when a slot's published hard controls refused a piece it could otherwise have served. The kit states the bounds and the privacy rule.

## Conventions

- **Base URL:** the worker origin (dev: `http://localhost:9100`).
- **Auth, honestly stated:** most endpoints are **open** (demo trust model). JWT (HS256, 15-min access / 7-day refresh) is required only on `/api/*`, `/auth/me`, `/auth/logout`, `/optimizely/experiments`, `/optimizely/features`, and `/cdp/destinations`.
- **Rate limiting:** only `/api/*` (100 req/min per IP, via the RateLimiter DO). Nothing else is rate-limited.
- **Env gates:** `GEMINI_API_KEY` (AI endpoints degrade/503 without it) · `OPTIMIZELY_WRITE_ENABLED` + `OPTIMIZELY_API_TOKEN` (FX writes return `created:false`/"stubbed" when off) · ODP creds (`ODP_API_HOST`+`ODP_PUBLIC_KEY` — the ODP loop silently no-ops without them) · `OPTIMIZELY_WEBHOOK_SECRET` (datafile webhook HMAC) · `DECISION_SOURCE`, `CONNECTOR_MODE`, `REFLEX_ENABLED`.
- **Honesty convention:** simulated payloads self-label (`simulated`, `_meta`, `dataSource` fields).
- **Measurement reads (W21 C1.05, F25 §5.1):** `GET /v1/:tenant/learn/report` and `GET /v1/:tenant/learn/report/window` carry the same gate as the build `POST` beside them (`operatorJwt()`), so they answer 401 without an operator credential in **every** `AUTH_MODE`, including the open demo default. They previously rode `operatorWrites()`, which returns `next()` in open mode, and so delivered per-arm counts, intervals and target standing to any caller who could view source on the storefront. The credential is the one the build POST already accepts; no account session is required.
- **Window exports (W21 C1.07, F12):** `GET /v1/:tenant/ledger/batches?from=&to=` is swept under the prefixes its days share — one per calendar year the window touches, plus a bounded number of pages each — rather than one listing per day, and its object budget holds for the request as a whole. A truncated answer names exactly the days the sweep reached. The single-`date=` listing, its `cursor` and its reconciliation `counts` are unchanged.
- **Where the window sweep starts (W21 C1.09):** each of those listings begins at the window's first day (`startAfter: <tenant>/<from>` on its first page), so objects the tenant wrote earlier in the same calendar year are never paged through and cannot consume the page budget. A tenant with more earlier objects than the budget is still answered its own days; the truncation rule, the page budget and the single-`date=` path are unchanged.
- **Dispatch order:** `/agents/*` is handled by the Agents SDK **before** Hono — it bypasses Hono middleware.

## Real-time personalization — `/realtime`

| Method & path | Purpose |
|---|---|
| `GET /realtime/ws?userId=` | WebSocket upgrade → per-shopper `PersonalizationWebSocket` DO (see [protocol](./02-websocket-protocol.md)) |
| `POST /realtime/action` | **The behavioral ingest.** Body `{type, userId, anonymousId?, sessionId?, data, source?, timestamp?}`; types: `product_view, add_to_cart, wishlist_add, page_view, button_click, email_open, form_submit, custom`. Runs the reflex, qualifies audiences (local ∪ reflex ∪ ODP), decides modules, captures to D1, **forwards the fact to ODP** off-path. Returns `{success, update?{data{segments, decisions, featureVariables, recommendations, sortOrder, journeyStage, affinity}}, signals?{recognized,unrecognized[]}, sessionId, cookiesUpdated, odp?{receiptId,type,action,product_id}}` + `Set-Cookie`. `signals` is the input diagnostic both hosts answer with, measured against the catalogue the tenant publishes: on a dimension that catalogue names values for, a value it does not name builds no affinity whatever else the event carries, while a dimension it names nothing on constrains nothing; `recognized` is true when at least one value built affinity; `unrecognized` names every product the event referred to that could not be placed — the top-level `productId`/`product_id`/`sku` and each `items[]` product — and never an attribute value |
| `GET /realtime/personalization/:userId` | Cookie-session-aware personalization snapshot |
| `GET /realtime/reflex` | **Affinity snapshot** for the instrument: `{ok, now, config{version,tauMs,K,thetaIn,thetaOut,dims}, affinity{dims, audiences, changed, odpConfirmed}\|null, visit{visitNumber, entryChannel}\|null, consent}` (fresh-computed; scores decay at read). `visit` is the shopper's visit projection — `visitNumber` and `entryChannel`, either of which is `null` while unknown — and the whole field is `null` without personalization consent; the object host answers the identical shape. The Durable Object's internal projection shape is not this field and never crosses the SDK boundary |
| `POST /realtime/session/reset` | "New shopper" — expires `opt_*` cookies + deletes the KV session |
| `POST /realtime/session/:sessionId/preferences` | `{trackingConsent?, personalizationEnabled?, cookieConsent?}` |
| `GET /realtime/session/:sessionId/analytics` | session analytics |
| `GET/POST /realtime/segments/:userId` | read / manually assign (`{segment, source?}`) |
| `GET /realtime/health` | engine + WS DO check |

Cookies: `opt_session_id` (HttpOnly), `opt_user_id`, `opt_segments`, `opt_engagement_score`.

Owned content snapshots (`GET /v1/:tenant/decisions/snapshot`) accept optional `entry`, a single JSON query object with string fields `utmMedium` (128 characters), `utmSource` (256), `referrer` (host only, 253), and `siteHost` (253); the JSON query is at most 4096 characters. SDK hydration supplies these observations after tracking consent, without referrer paths/query strings. Live actions accept the same fields, with the existing URL-or-host referrer bounded to 2048 characters. `siteHost` must be a hostname, in the `hostname[:port]` form a page reports as `location.host`: an internationalized name is accepted and compared in the ASCII form URL parsing produces, a trailing root label is ignored, and the port is not part of the site's identity for the same-site comparison. A URL, a path, a query or free text is not a hostname and is refused, in both the query and the live-action forms; the host-only `referrer` follows the same rule. Invalid entry input refuses before host effects. Missing entry, no supplied string fields, or observed empty strings carry no page-view evidence, so the entry stays unknown, never direct. Explicit `channel` accepts the six values `direct`, `paid_social`, `paid_search`, `email`, `organic`, `referral` (case/whitespace normalized); unsupported values are ignored, falling back to valid stored/current entry or unknown. The classifier identifies a network by an explicit per-network list of registrable domains, including the country-code and multi-label markets each network is registered in, matched exactly or on a dot boundary — never by a generic suffix rule, so a lookalike that merely contains or prefixes a network's name stays `referral`. A `utm_source` that contains a dot is a host and is judged only by that rule; a token-form source names its network in a token split on `_`, `-` or whitespace, or by a listed alias. A medium that declares paid search names that cell; a bare `paid` or `cpm` medium classifies by the recognized network in its source (search → `paid_search`, social → `paid_social`) and with no recognized network belongs to neither paid cell.

Both hosts retain a known entry during same-visit navigation. Only accepted live actions persist visit count/start/channel; content reads project the existing 30-minute idle boundary without writing activity or extending lifetime. Unknown cold/legacy counts remain unknown until an observed live event. An idle return without entry does not inherit the previous visit's channel. Stored context requires both consent switches; request-only context follows tracking consent. Owned legacy personalization reads also avoid session creation and cookie refresh. These fields make context evidence available, not gamma-zero channel influence, calibrated journey/memory behavior, or a production-host cutover.

W20 G1 — a refused pin is not silent. The snapshot answer (`GET`/`POST /v1/:tenant/decisions/snapshot`) additionally carries `pinDiagnostics`, from the array the decision set already holds: one entry per pin the governance refused, `{slot, pinnedPieceId, pinIndex?, reason, ownerSlot?}`. `pinIndex` is the refused position inside a `pinnedPieceIds` prefix and is absent for a legacy scalar `pinnedPieceId`; `reason` is the refusal the composer recorded — `invalid_take`, `missing_or_ineligible`, `slot_type`, `duplicate_pin`, `off_limits`, `excluded`, `excluded_tag`, `type_not_allowed` — and `ownerSlot` names the slot that already holds the piece, on any refusal reason and not only `duplicate_pin`, because the engine attaches it whenever another slot already owns the piece. A refused required pin refuses its whole slot, so it has no decision and no ledger row; this member is the only place the answer names it. It is absent when nothing was refused, both hosts answer the same array, and it changes no ranking, eligibility or persisted record.

W20 G2 — that member is bounded, and the operator has counters of their own. The answer carries at most 50 entries, in page and slot order, with `refusedCount` (every refusal on the page) and `omittedCount` (how many the sample left out) beside them; the bound is applied before the answer's size guard, so no operator-authored slot document can turn a served snapshot into a 503. The served snapshot is the shopper's surface and stays a per-page fact. What happened over time belongs to the operator: `GET /v1/:tenant/learn/slots?evidence=1` adds `governance` to each slot entry, under the same flag and the same 200-slot budget as `evidence` — `{since, scope, refusedPinCount, refusedPins:[{pinnedPieceId, reason, count}], shortTakeCount, shortTakePositions}`, counting distinct occurrences on both hosts and both arms since the horizon `since` states (30 days, after which the counts restart), with zero reported as zero rather than omitted, and the `refusedPins` detail bounded per slot while the counts stay whole. `scope` states the scope those counts are kept at and always reads `"tenant"`: one counter document per tenant, counted across all of the tenant's brands, while the `evidence` beside it is kept per brand — so a `brand=` page reads its tenant's counts on the row beside that brand's own learning evidence. `POST`/`GET /v1/:tenant/monitor` answers the same two counts summed for the tenant, as `governance: {since, scope, refusedPinCount, shortTakeCount}`; it is read from those counters and never from the monitor's own probe, whose compose of the tenant's page is excluded where the counters are written. Two things guarantee that exclusion and both are part of this contract: the probe composes unsigned with tracking refused and declares `selfCheck` — no shopper granted it anything, its own cookie header withholds tracking consent, and the counters are skipped for any compose that declares the flag — so either guarantor alone already keeps the probe out of a tenant's counts, and neither can be removed without contradicting this reference. `shortTakeCount` counts the times a pinned slot served what it could and still fell short of its `take`, with `shortTakePositions` the positions left empty across them. Where that slot served something it also wrote records, so `explain.shortTake = {take, served, empty, sentence}` rides each of them and `GET /v1/:tenant/visitors/:visitorId/receipts` reads the sentence out on `why`. A slot whose pin was refused wrote no record at all, so it has no receipt and these counters are its only home. The counters hold slot names, the merchandiser's pinned piece ids, refusal reasons and counts — configuration, never shopper state — are written fire and forget after the answer, never read on the decision path, and are a best-effort diagnostic rather than an accounting ledger.

`POST`/`GET /v1/{tenant}/monitor` also answers two members of its own about the tenant's evidence, both
read on the scheduled run and never on a decision path.

`evidenceLoss` is `{ since, producerFailed, consumerSkipped, fanOutRejected, retriesExhausted }`: the
four ways a row of evidence is lost, in one vocabulary — the producer could not hand it to the queue,
the consumer could not place it, its fan-out post to a statistics object was attempted and refused, or
its retries were exhausted and it was captured to the dead-letter quarantine. `since` is the horizon
the counts start at (30 days, after which they restart). A tenant that lost nothing reads zero on
every path, never an absent member; the member is absent only on a record written before it existed
and on a run whose counter store could not be read, so no result states a zero it did not observe.
These are a FLOOR, not an accounting ledger: the read-modify-write is last-write-wins, so concurrent
drops may collapse into one increment. Three things are deliberately NOT counted, because counting
them would be worse than not: a batch that failed as a whole (it is retried whole, and counting it
would multiply one drop by the retry count), a producer refusal whose cause is that the tenant's own
configuration could not be read (there is nothing to attribute the count to), and the platform's own
synthetic monitoring probe, which is excluded where every one of these counters is written.

`reconciliation` is `{ since, compared, disagreements: [ { brand, slot, online, ledger, difference,
threshold } ] }`: the scheduled comparison of the two stores that hold the same credits by two
different roads — each slot's statistics object, which counted them online as they happened, and the
day report, which counted them from the ledger. It reads the NEWEST day this tenant has published,
and only that day; `since` is that day's start and `compared` is how many (brand, slot) pairs the run
really compared, so a clean result is never an empty one. `online` is the slot's credited mass at its
own decay, rounded; `ledger` is the credits the published day counted for that slot's personalized
arm. A pair is named only when `difference` exceeds `threshold`, a stated relative tolerance of five
per cent of the larger of the two: zero at unit scale, which is where one lost or doubled credit
shows, and wide enough at volume to absorb the two stores reading their own clocks. Absent on a
legacy record and on a run that could not read one of the two sinks.

`GET /v1/{tenant}/ledger/batches?date=` reconciles the day's export partition with the day the platform
published, on the same answer: `counts` is `{ rows: { decisions, outcomes }, distinct: { decisions,
outcomes }, report: { decisions, outcomes }, agrees }`. `rows` is what the listed objects physically
hold, line by line — ledger rows are at-least-once, so this can exceed what any read counts. `distinct`
applies the same dedup every read applies, on `decision_id` and `outcome_id`, and then the pending
erasures this answer already tells you to apply. `report` is the day report published for that brand
(`?brand=`, defaulting to the tenant). `agrees` is true only when the two were observed to match, so a
warehouse loading the partition and an operator reading the report cannot disagree in silence. The
member is carried only by a listing that can see the whole day: a `from=`/`to=` window lists several
days, a `cursor=` page lists part of one, a `stream=` filter hides the other stream, and a truncated
listing has already stopped short — none of those carries it. It opens only the objects it has just
listed and reads the report by its own key; it lists nothing a second time.

Ledger rows are delivered AT LEAST ONCE, and `decision_id` / `outcome_id` are the dedup keys — in every
read this platform performs and in your own warehouse job. The same logical row can reach the R2
partition more than once (a queue redelivery, a retried partial batch), and every read above yields it
exactly once, counting the copies it dropped as `counts.duplicates`. An outcome minted before the
per-event nonce existed carries a timestamp-derived id that two genuinely distinct events can share;
those legacy rows are OUTSIDE the redelivery guarantee and are never deduplicated, online or on a
read. Two genuinely DIFFERENT rows under one logical id are never merged: the read refuses the day
with `{ ok: false, code: "report_row_conflict", conflict: { stream, id } }` (HTTP 409), files the
conflicting row for recovery in the tenant's own scope where the ledger-recovery surface lists it, and
reads the day again on the next call with that row excluded and counted as `counts.conflicts`, in the
same `{ decisions, outcomes }` vocabulary as `counts.duplicates`.

Caller-managed buffered browser/app actions use HTTP `POST /realtime/action` with top-level `processing: "buffered"`, a stable `eventId`, an explicit nonnegative integer millisecond `timestamp` no later than server evaluation time, and original `browsingSessionId` (1–128 characters without surrounding whitespace, or explicit `null` when unknown). Numeric zero is valid; there is no maximum event age. The signed session still identifies the existing owned profile. Absent `processing` keeps live behavior; buffered WebSocket actions are refused. This adds no SDK offline queue or emitted bundle behavior.

Buffered processing applies current configured interest weights with occurrence-time decay and re-evaluates local memberships, without fresh visits, counters, last activity, profile cookies, ODP activity, demo capture or receipt-geolocation regional counts. Interest needs registry-resolvable top-level product/event attributes or canonical content touches; `items[]` alone does not invent basket/quantity interest weighting. Tracking refusal prevents measurement; personalization refusal permits eligible measurement only. Missing/corrupt/forwarded profiles, unavailable erasure barriers and unsafe persistence refuse or explicitly drop; observed erased events do not resurrect state. Existing absolute Session expiry/metadata and DO last-seen/retention deadline are preserved; an earlier audience-exit alarm may be scheduled.

The buffered response identifies `processing`, `interestApplied`, optional `dropped`, resolved `consent`, `cookiesUpdated: false` and, once the action has been placed, the same `signals{recognized,unrecognized[]}` the live answer carries: a buffered delivery is measured against the catalogue the tenant publishes exactly as a live one is, so a value that catalogue does not name on a dimension it does name builds no affinity and every product reference that could not be placed is named. Historical import rows and content interactions are measured against the same published vocabulary through the same rule. Eligible reward outcomes retain original timestamp, nonce, browsing session (including unknown `null`) and decision reference into the existing ledger/online path. This acknowledges eligible submission, not durable delivery, historical credit or completed-report repair. Current config/retained rings are not original-policy or experiment-lifecycle reconstruction, and a stable nonce does not make repeated personal accumulation idempotent. No new history/retention, atomic KV write or concurrent erasure fence is supplied.

## AI — `/ai`, `/ai/scene` (Gemini)

| Method & path | Purpose |
|---|---|
| `POST /ai/search` | `{query, limit?, affinity?}` → `{ok, intent, productIds[], hero, tookMs, source:'gemini'\|'fallback'}` — intent parse + deterministic catalog rank; also yields the Edit-hero copy/scene context |
| `POST /ai/concierge` | `{messages[], affinity?, avoidIds?}` → **plain-text stream** ending `PICKS: <id>,…` (grounded to real catalog ids) |
| `POST /ai/scene` | `{productId, sceneId?, type?, sceneContext, aspect?, sync?}` → `{ok, status:'ready'\|'queued', url, cached?}` — async via Queue → Gemini image → R2 |
| `GET /ai/scene/:productId/:sceneId` | serve the cached JPEG (404 until generated) |

## Optimizely — `/optimizely`, `/webhook`

| Method & path | Purpose |
|---|---|
| `POST /optimizely/decisions` | Owned shopper `{userId, userAttributes?, experiments?, features?, consent?}` → decisions + segments, or explicit inert defaults |
| `POST /optimizely/preview` | fresh no-store `decide()`; supports forced `variationKey` — the storefront's preview path |
| `GET /optimizely/banner-rules` | live `personalized_banner` cascade (`[]` without FX token) |
| `POST /optimizely/track` | Owned shopper `{userId, eventKey, userAttributes?, eventTags?, consent?}`; tracking refusal explicitly skips delivery |
| `GET /optimizely/datafile` | current datafile |
| `GET /optimizely/experiments` · `GET /optimizely/features` | **JWT required** |
| `POST /webhook/optimizely-datafile` | datafile-change webhook; HMAC `X-Hub-Signature` verified when `OPTIMIZELY_WEBHOOK_SECRET` set → refreshes the KV datafile cache |
| `POST /webhook/optimizely` · `/webhook/segment` · `/webhook/custom` | generic inbound webhooks; synchronous delivery receipts follow the Eventing contract below |

Only the shopper `/optimizely/track` and `/decisions` calls require the current `X-Shopper-Session` capability and matching `X-Tenant`; body `userId` must equal its canonical subject. Obtain/reuse that owned session through the SDK or `/v1/:tenant/identity/session` (including that endpoint's existing site-key gate). Optional JWT validation remains, but JWT/site keys alone do not establish shopper ownership. Optional strict boolean `consent:{tracking?,personalization?}` and false cookies can only restrict durable owned consent, never enable it; enabling uses owned session preferences. Invalid ownership/state or failed refusal persistence fails closed before Optimizely initialization.

W16 C6 — anonymous return continuity. `POST /v1/:tenant/identity/session` additionally answers `continuity`: `{enabled:false,reason:"unpublished"|"incomplete"|"consent"|"unavailable"}` or `{enabled:true,mode,purpose,generation,expiresAt,revision,proof?}`. It is DISABLED unless the tenant publishes a complete `continuity:{mode:"direct"|"broker",windowMs,purpose,retentionApproved:true}` block on the versioned reflex document (`REFLEX_KIND`, `reflexScopeForTenant`, one publication set, `revision` is that document's revision); the validator admits the block and rejects unknown members, and an incomplete block leaves continuity off without failing the whole document. Nothing in this platform publishes a mode, a window or a covered purpose: activation is the tenant's, and the retention approval a continuity credential needs is per purpose (a 30-day session consent record authorizes none). `expiresAt` is the chain's original fixed expiry and never moves; `proof` appears only in direct mode, and broker mode carries the long proof solely in the `opt_shopper_continuity` cookie (`HttpOnly; Secure; SameSite=Lax; Path=/`). A return presents `{continuity:{proof,operationId}}` (or the cookie plus `{continuity:{operationId}}`), normally with NO `X-Shopper-Session` (see the `unavailable` retry below): the owner object consumes the descriptor atomically, rotates the generation, and answers a fresh bounded capability on the shopper's existing browsing session inside the existing authority epoch — the expired capability is never extended. One exact retry of a lost answer is honoured once from one deterministic successor receipt; a second retry, a replay, a tampered/unknown/foreign proof, a cross-transport or cross-revision proof, a browser-side refusal hint, and a descriptor past its own expiry are all a cold shopper. Detach, session reset, link and erase retire the descriptor; a withdrawn choice makes it cold; the object's alarm removes it at its original expiry. `unavailable` is the answer when the shopper's own object could not be reached or answered something the route cannot read as its acknowledgment: a failure of the CALL, never a decision about her, so it is never reported as `consent`. The route still answers 200 on a PROVISIONAL anonymous session, the presented proof is not consumed and the chain does not rotate, and the caller keeps the proof and its `operationId` and presents the SAME consume on its next call (the SDK clears what it holds only on `consent`, `unpublished` and `incomplete`). That retry is the one case where a return may carry `X-Shopper-Session`: the consume is completed beside a capability ONLY when the session that capability names is itself anonymous, so a presented proof can never take over an identified shopper's session, and the provisional subject's state is never merged into the recognized one. The `continuity` block is ABSENT from the answer for an identified shopper: this is anonymous return recognition and there is none to report for a signed-in subject. WHOEVER HOLDS THE PROOF IS RECOGNIZED AS ITS SUBJECT: it is a bearer credential, bound to the tenant, the transport, the covered purpose, the revision, the generation and its own fixed expiry and to nothing about the device presenting it, so anyone who obtains it is answered as the shopper it names until it is spent, expires or is retired; protect it exactly as a session credential (never logged, never in a URL, never copied between devices) and retire it with detach, session reset, link or erase. The object persists only `{generation,digest,expiresAt,…}` under the exact key `continuity` — never the raw proof or its signature.

Tracking refusal returns `success:true,status:"skipped",tracked:false,reason:"tracking_refused",consent` with no metric delivery. Tracking true with personalization false still permits metrics. Decisions require both switches: refusal returns `status:"default",personalized:false,reason,consent`, requested experiment keys as `null`, requested feature keys as `{enabled:false,variables:{}}`, and `segments:[]`, without SDK evaluation or cache/egress effects. Keep site defaults; this is not an experiment control assignment. Allowed response shapes stay unchanged. Request-snapshot enforcement is not transactional revocation.

Storefront experiment metrics use its current SDK capture/owned transport lane. Legacy copy mode reports `owned_metric_unavailable` and keeps its separate engine action without experiment/creative tags; this is temporary unauthorized-path containment, not accepted metric/preview attribution parity or permanent integration removal. Provider webhooks and presenter preview/datafile/banner routes remain separate and unchanged; this contract does not authorize their sender-to-subject mapping or resolve their remaining consent/access scope.

## Operator — `/operator` (two-call governance: suggest → publish)

| Method & path | Purpose |
|---|---|
| `POST /operator/audiences/suggest` | `{nlPrompt}` → drafted audience (nothing goes live) |
| `POST /operator/audiences/publish` | `{audience}` → publish + WS-notify qualifying connected shoppers → `{audienceId, notifiedUsers}` |
| `GET /operator/audiences` | published audiences (seeded + catalog-generated + Opal-created) |
| `GET /operator/insights` | synthetic ODP aggregate views |
| `POST /operator/events/reset` | `{scope:'all'\|'run'\|'session'\|'vuid', value?}` — wipes **only** `demo_events` |
| `GET /operator/events/stats` | demo-event counts |

## Experimentation — `/experiment`, `/funnel`

| Method & path | Purpose |
|---|---|
| `POST /experiment/launch` | launch a scenario (A/B · MAB · CMAB); real FX rule when writes enabled, simulated readout otherwise |
| `GET /experiment/cmab/decide` | contextual decide (query params = context attributes) |
| `GET /experiment/cmab/matrix` · `GET /experiment/scenarios` · `GET /experiment/:key/readout` · `GET /experiment/` | CMAB matrix, scenario presets, readouts, list |
| `GET /funnel?brand=&cohort=` · `GET /funnel/diagnose` | funnel metrics + diagnosis |
| `POST /funnel/event` | checkout-stage events → D1 (never blocks checkout) |
| `POST /funnel/audience` | create a **real** FX audience — gated by `OPTIMIZELY_WRITE_ENABLED` |
| `POST /funnel/sim/tick` · `/burst` · `/reset` | **demo/presenter traffic simulator — internal** |

## Signals & geo — `/signals`, `/geo`

| Method & path | Purpose |
|---|---|
| `GET /signals/next` | next social signal — fixture + **real** edge-geo overlay; self-labels `simulated:true` |
| `POST /signals/ingest` | partner-feed seam (501 + NotWired in live mode until a feed is contracted) |
| `GET /geo` | edge geolocation (country/region/city/zip/season…) |
| `GET /geo/cohort?zip=&region=…` | geo-cohort cold start (params = labeled QA override); curation only, never pricing |

## Eventing — `/track`, `/pixel`, `/cdp`

`POST /track/event` and `POST /track/batch` require `X-Shopper-Session` and the matching tenant. Every supplied `user.userId`, `user.anonymousId`, `recipientId` and `context.sessionId` must match the capability's canonical subject/session; a batch is validated completely before dispatch. Required event `timestamp` is occurrence time in epoch milliseconds: a nonnegative safe integer within JavaScript's Date range, including zero. Invalid time rejects the whole request before owned state or consent changes. Valid occurrence time and `eventId` are preserved through synchronous dispatch and the single-event response. Delayed and repeated submissions are allowed without an age/skew cutoff or implicit deduplication; validation does not establish timestamp authenticity or downstream lifecycle eligibility. Optional strict boolean `consent:{tracking?,personalization?}` on the event, batch or each batch event can only restrict stored consent (as can false cookies). Any false hint restricts the whole same-owner batch. Tracking refusal is persisted when necessary and returns `dispatched:false`, `reason:"tracking_refused"` and skipped status/results; no event is collected or sent. Personalization refusal alone permits tracking. Client email/traits/properties remain assertions, not verified account identity or downstream merge authorization.

Allowed tracking and the three generic event webhooks dispatch synchronously to enabled `WEBHOOK_ENDPOINTS`. HTTP 200 with `success:true` requires at least one destination and an HTTP acknowledgement from every destination; success response fields remain compatible. Missing, disabled or invalid destination configuration returns HTTP 503, `success:false` and `delivery:{status:"unconfigured",attempted:0,acknowledged:0}`. HTTP 502 reports `partial` when some destinations acknowledge or `unconfirmed` when none acknowledge; an unexpected dispatch failure uses `unconfirmed` with null counts. Failures include `eventId`, fixed `error:"Event delivery not confirmed"` and the receipt; tracking single-event failures also retain occurrence `timestamp`. Counts describe destination attempts and HTTP acknowledgements, not durable processing. A failed acknowledgement does not prove that no destination processed the event.

Tracking batches keep input order, continue after member delivery failures and report `processed` as members attempted. Successful members retain `{eventId,status:"success"}`; failed members carry `status:"error"`, the fixed error and delivery receipt. Any failed member makes top-level `success:false` and HTTP 502, or HTTP 503 if every attempted member is unconfigured. All-success and empty batches return HTTP 200. Request validation, owned-session errors, stored refusal and the enforced customer-surface withdrawal retain their existing behavior. No generic event/retry queue messages are produced and no automatic retry is scheduled; resubmission can duplicate already processed effects. This does not provide durable recovery, tenant-isolated global destination configuration or decision/outcome ledger acceptance. Previously queued envelopes and their historical loss remain separate work.

`GET`/`HEAD /pixel/track/:pixelId` temporarily serve an inert 1×1 GIF with no decoding or collection. `POST /pixel/generate` retains its URL/`htmlTag` fields but reports `trackingEnabled:false` and a reason. This is local fail-closed containment, not accepted email-open measurement or permanent feature removal; no credentials belong in pixel URLs. Generated identifier URLs, hosting logs and historic records remain separate privacy work. `/cdp/*` remains the separate mock CDP identify/track/forward surface (`GET /cdp/destinations` JWT).

## Opal chat — `/agents/*`

`/agents/opal-agent/:sessionName` — Cloudflare Agents SDK WebSocket protocol to the per-session `OpalAgent` DO (SQLite-backed, Gemini). Tools (server-side): `queryData` (allow-listed read-only D1, LIMIT 200), `createOptimizelyAudience`, `createFlag`, `targetMessageToAudience`, `launchExperiment`, `diagnoseFunnel`, `geoCohort` — write tools return `status:'stubbed'` unless `OPTIMIZELY_WRITE_ENABLED`.

## Auth & platform (mostly internal)

`POST /auth/login|register|refresh|logout` · `GET /auth/me` — demo JWT.
The obsolete generic `/api` and `/api/*` infrastructure routes are removed and return 404, including with an operator or admin token.

**Internal / exclude from partner docs:** `/health*` · `GET /api-info` (self-description — currently stale, flagged for code fix) · `/realtime/connections*` · `POST /realtime/demo/trigger` (bank-demo scenarios) · `/funnel/sim/*` · **`GET /__shot`** (Browser Rendering screenshot verification) · Durable Object internal endpoints (`/broadcast`, `/connections` on the WS DO; StateManager `/get|/set|…`; RateLimiter POST).
