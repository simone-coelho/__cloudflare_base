# API Reference

## Disabled-by-default generation, search and warehouse connectors

Exact purpose-specific `TENANT_CONNECTORS`, referenced `CONNECTOR_SECRET_*` bindings and destination-specific `RETENTION` are mandatory. Approval identifiers describe desired controls, not evidence of customer approval/provisioning. There is no global Google fallback.

Catalog search requires an explicit `priceSource` mapping to the feed's actual numeric price field and an approved currency. Numeric bounds and gift eligibility are checked against that feed contract; price bands, model guesses and display strings do not substitute for price/currency authority.

`POST /content/catalog/enrichment/proposals/generate` accepts `{catalogRevision,registryRevision,configurationDigest,pieceIds}` under current operator authority. The real model adapter uses only configured actual persisted `title/excerpt/subtitle/type/tags` and explicitly allowed bounded images. Every selected piece needs approved content; IDs alone are refused before egress. Immutable provenance records actual invocation/configuration/input/output/sample/taxonomy commitments. It is generation-time evidence, not certification under today's taxonomy. Every label still requires explicit human review and existing recoverable whole-set publication.

`POST /search` accepts `{query,limit?,consent?}` with site key, tenant and signed shopper capability; actual public request bytes are capped at8192. It returns a complete commerce-grounded deterministic ranking plus durable product-sort receipt, or explicit unsupported/incomplete failure. Configured taxonomy, inclusions/exclusions, numeric minor-unit price bounds/currency and gift meaning are interpreted; the model never supplies product IDs or private affinity. Provider waits occur outside the owner serializer. Current grant, consent, erasure, configuration, original destination retention and deadline gate each new egress and finalization. Raw queries are not persisted/logged.

The fixed commerce endpoint exchanges `commerce-query/v1` / `commerce-candidates/v1`: tenant, mapping revision, stable feed revision/as-of, completion/cursor and real candidates with ID, stock, entitlement, currency/minor-unit price, gift eligibility and configured attributes. Actual aggregate bytes, pages and candidates are bounded; partial retrieval is not complete.

Scheduled Snowflake SQL API push requires explicit account/origin/user/key-pair reference/database/schema/warehouse/role, identity namespace, mapping revision, cadence/start boundary and original destination lifetime. Protected secret material is exactly `{privateKey,publicKeyFingerprint}` (PKCS8 RSA PEM and matching SHA256 SPKI fingerprint), never embedded in the tenant descriptor or evidence. Receiver SQL is `scripts/sql/snowflake-warehouse-v1.sql`, not a D1 migration and never auto-applied. Installation, enforced Hybrid Table locking/concurrency, grants and real provider execution remain live evidence.

CAS progress binds source revision, chunk, stable operation/digest, separate APPLY/READ identities, async handles and actual current row/hash/count readback. Bounded full rescans cover late older-hour arrivals, source revisions and missing objects; no original lifetime is renewed. Retained destination/mapping generations continue deletion and expiry maintenance after current upload removal; missing old credentials remain visibly pending. Current-table deletion does not attest Snowflake Time Travel, Fail-safe, clones or backup deletion.

The local operating limit is100 retained warehouse generations per tenant, atomically reserved before new-generation egress. Capacity refusal is reported explicitly; it never deletes an old mapping or disables service of admitted generations. Interrupted reservations are retryable with the same descriptor. One scheduled invocation selects a fair tenant and generation, with a shared30-second/4096-operation warehouse allowance; source windows are continuation work units, not row eligibility limits. The existing16MiB source envelope and complete1MiB product-sort record remain supported. Continuation custody uses a purpose-separated MAC under the existing stable `IDENTITY_SALT`; it does not authorize salt rotation. These bounds are not deployed capacity or SLO acceptance.

Every route your integration, your merchandisers and your data science team can call. Request and
response shapes are the ones the platform enforces today. Field meanings are in the
[payload schemas](./03-payload-schemas.md).

## Conventions

- **Base URL.** The platform host we give you for staging; on production, a subdomain of your site routed to the platform.
- **Brand in the path.** Decision, learning and identity routes carry the brand: `/v1/{tenant}/…`. `tenant` is a short slug, `coach` for the launch brand. Event routes have no brand in the path; the platform derives it from the registered hostname the request came from.
- **Site, shopper and operator credentials.** Shopper HTTP requests carry `X-SDK-Key`, canonical tenant and the server-issued `X-Shopper-Session` capability. Browser sockets use the SDK subprotocols `shopper-session-v1`, the capability and `sdk-key-v1.<base64url-site-key>`; credentials and subject/session IDs do not belong in the URL. Operator routes use `Authorization: Bearer <token>` plus current tenant membership. An operator token is not a shopper capability.
- **Cross-origin.** Your registered origins are allow-listed; the browser sends credentials, and the platform answers preflights for them. Unregistered origins receive no permission.
- **Answers.** JSON. Success carries `ok: true` or `success: true`; a refusal carries `ok: false` and an `error` in words, with `details` when a body failed validation. Decisions and reads that must be fresh answer with `Cache-Control: no-store`.
- **Versioned documents.** Configuration is a set of documents per brand. Every write is a new revision with an author and a note; a rollback writes an old revision forward as a new one. Reads, history, validation and writes all require an operator access token and answer with `Cache-Control: no-store`. Current credential-bound tenant membership is enforced independently of authentication; global stamp-owner authority does not itself grant tenant product access.

### Explicit retention configuration and erasure reconciliation

`RETENTION` is a JSON object with exactly `version: 1` and `tenants`. Each tenant must already exist in `TENANTS`; its category map contains only `profile`, `identity`, `ledger`, `online`, `hourly`, `recovery`, `quarantine`, the optional `configuration` setting for configuration revisions, a configured destination's `external.odp.<digest>`, `external.fx.<digest>`, `external.tracking.<digest>`, `external.model.<digest>`, `external.catalog.<digest>` or `external.warehouse.<digest>` key, or the separately configured operational `telemetry.analytics.<digest>`, `telemetry.monitor.<digest>` and `telemetry.alert.<digest>` categories described below. Each policy has exactly `id`, positive integer `revision`, positive integer `durationMs`, `basis: "occurred" | "admitted"`, and `renewal: "new-record-only"`. There are no default periods. Operators must supply separately approved values; an absent, malformed, changed or expired authority denies that category's new capture/use. Monitor readiness reports unavailable policy without exposing configuration contents. `configuration` is the one category no capture requires and monitor readiness does not ask for: it is the retention setting for the tenant's catalog, slots, learning, Reflex, prior and proposal revisions, a tenant without it (or with a registry that cannot be read) keeps every revision, and where it is set a configuration publication purges only the revisions older than it that are neither current, previous nor named by a stored decision record ([Content and configuration documents](#4-content-and-configuration-documents)).

Destination digests are SHA-256 of UTF-8 JSON with recursively sorted object keys: the selected non-secret ODP/FX connector configuration, or `{name,type,url}` for each enabled tracking destination (URL normalized with `new URL(url).href`). A secret value is never part of the retained descriptor. Each destination needs its own policy; a generic tracking policy is not accepted. Optional behavioral Analytics Engine emission is held pending an explicitly supported destination policy; this does not authorize or attest historical dataset cleanup.

Trusted producers retain the original policy identity, birth and deadline through copies, queues, retries, links and imports. Ordinary reads/updates do not renew them. A read that moves a shopper's journey stage on its own — the visit whose counters produced the previous stage ended between the last event and this read — sends an idempotent profile upsert to a configured customer data platform destination, carrying only that destination's configured profile mapping with the stage in the published `early | mid | late` grammar, and repeats it on each such read until the next event writes; it forwards no behavioral event, produces no outcome, exposure or regional count, and renews no retained lifetime. Expiry cleans eligible tagged behavioral copies through existing owner alarms, bounded R2 rewrites and hourly cleanup; it does not reset grants, renew necessary consent, delete recovery/security barriers or enroll untagged historical data in a new lifetime. The explicit-choice30-day necessary record is separate. Configured periods and local progress are not deployed physical-retention or historical-coverage proof.

Operator `POST /v1/{tenant}/identity/erase` returns `complete:false`, bounded local progress and a `reconciliation` reference containing the original `at` and `erasureId`. Reuse the same selector with `reconcile:{at,erasureId,read:true}` to read frozen non-secret obligations and paginated scope keys; a scope read adds its returned scope digest. Attestation uses `reconcile:{at,erasureId,scope?,obligationId,configurationDigest,claim,evidence,digest}`. `claim` is `operator_completed`, `provider_acknowledged` or `independently_verified`; all caller submissions remain `operator_attested`, never independent provider verification. Evidence is a bounded reference plus SHA-256, not customer payload. Wrong generation/configuration conflicts; exact duplicate attestations are idempotent. Obligations survive local compaction and later configuration removal. Unknown historical aliases, datasets/logs and tenantless D1 remain explicitly unresolved; no provider call or external deletion is performed by reconciliation. Successful reconciliation reads and attestations return HTTP202 because verification remains pending; the correlated audit result retains that same status, not HTTP200 completion.

## 1. Events

### `POST /realtime/action`

One event. Site key.

```json
{
  "type": "product_view",
  "userId": "vis-2f1c…",
  "anonymousId": "v-K3M9Q2X7A",
  "sessionId": "s-LT4B2",
  "data": { "productId": "SKU-123", "line": "Tabby", "category": "Handbags", "occasion": ["everyday"], "price_usd": 395 },
  "source": "coach-web",
  "entry": { "utmMedium": "paid_social", "utmSource": "tiktok", "referrer": "https://www.tiktok.com/", "siteHost": "www.coach.com" },
  "timestamp": 1788541396756
}
```

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | One of `page_view`, `product_view`, `add_to_cart`, `wishlist_add`, `purchase`, `content_impression`, `content_click`, `content_dwell`, `video_complete`, `content_viewable`, `video_view`, `product_dwell`, `button_click`, `form_submit`, `email_open`, `custom` |
| `userId` | yes | The visitor id, or the shopper id after sign-in. The SDK fills it |
| `anonymousId` | no | A per-page-load id, kept for legacy capture |
| `sessionId` | no | When supplied, must exactly match the session ID in the signed shopper capability; callers cannot select another session |
| `data` | yes | The event's payload, by type: see the [payload schemas](./03-payload-schemas.md#event-payloads-by-type) |
| `source` | yes | Names the caller |
| `eventId` | no | Logical event nonce:1–128 ASCII letters/digits/`_`/`-`. When supplied, an explicit timestamp is required; invalid values are refused, never downgraded |
| `entry` | no | How this page load arrived: optional `utmMedium` (128), `utmSource` (256), `utmTerm` (256), `utmCampaign` (256), `referrer` (2048) and `siteHost` (253) strings, captured once per load, sent with every event, used only when a new visit opens. Anything longer, or any other key, is refused rather than trimmed. `siteHost` is a hostname in the `hostname[:port]` form, never a URL, a path or free text. `utmTerm` is the campaign's search keyword: it may seed contextual content rules for the slots that publish them, it never changes the classified entry channel, and it is never stored on the shopper record, the decision cell or a connector payload. `utmCampaign` is the campaign name: the SDK sends it only when the landing URL carries `utm_campaign`, only a tenant's published `utmCampaign` classification rule reads it ([the context vocabulary](#the-context-vocabulary-contextvocabulary)), and it is never stored |
| `timestamp` | no | Nonnegative safe integer milliseconds representable as a Date; zero is valid with `eventId`. Without a nonce, absent/zero uses server time. The engine still uses its own processing clock, and bounds the admitted time by it: a time after the engine's present is admitted at the present (a buffered delivery with such a time is refused), and a render acknowledgement's time before its decision's engine time is admitted at the decision's time (the render acknowledgement, below); any other time is admitted as given |
| `customerId` | no | Your identifier for the shopper that the page passed with `setCustomerId`, 1 to 128 letters, digits and `_ + / = . -`: written as `customer_id` beside `visitor_id` on the outcome the event records under tracking consent, and taken off the event before anything else reads it; the customerId is never proof of identity and links, merges and selects nothing |

The SDK core exposes the arrival it captured as read-only observables. `core.entry` is the cached entry for this page load, and `core.entrySessionId` names the browsing session that produced the cached entry signals — empty while tracking is not allowed, and deliberately not the current browsing session: after an idle rollover it still names the session the cached entry belongs to, until the next entry read recomputes from the current document. Reading either never rolls a session over, recomputes the entry or writes anything. The cached entry is cleared, before any recomputation, on a consent transition, an identity-generation change and a browsing-session rollover.

The SDK core also offers `core.onLoaded(callback)` and `core.setCustomerId(id)` (`client.core` on a client). `onLoaded` runs its callback once, when the client has loaded (its first session is in hand), or once at the next turn when it had already loaded; a callback that throws changes nothing of the client. `setCustomerId` carries your hashed identifier for the shopper, passed before recognition, on every action and every decision request while tracking is allowed, as `customerId`; the customerId is not proof of identity, and any other value, or a logout, clears it.

The SDK mints one `eventId` per tracking-approved envelope from its opaque Host token plus a nonwrapping core-local sequence; existing non-UUID fallbacks remain supported, without a cryptographic/global uniqueness guarantee. Keep the original nonce, timestamp, subject and scope together when retaining an envelope; a new `send` is a new event. Reward records retain `event_id` and `event_id_source` (`provided`, or `request` for a consent-approved legacy request fallback). The latter cannot identify repeated HTTP requests. Content service requests similarly supply `request_id` to the pure decision and exact replay. New IDs append `:n1:<nonce>` after the historical tail, preserving tenant/time/visitor lookup and erasure prefixes; old absent-nonce records retain their IDs. Invalid explicit identity/time and inconsistent replay carriers are refused. Neither identity adds sink deduplication, retries, payload-conflict detection or business-order uniqueness; transport `delivery_id` remains separate. A purchase's uniqueness per order is its own rule, keyed on `data.orderId` ([below](#purchase-uniqueness-per-orderid)). No nonce is minted on tracking-refused SDK envelopes or service/outcome emission.

Response:

```json
{
  "success": true,
  "message": "Action processed and personalization updated",
  "update": { "type": "personalization_update", "userId": "vis-2f1c…", "data": { "segments": ["line_tabby_affinity"], "decisions": { "hero_module": { "enabled": true, "variationKey": "affinity_hero", "variables": {} } }, "affinity": { "dims": { "line": { "Tabby": 0.71 } } }, "journeyStage": "thinking" } },
  "signals": { "recognized": true, "unrecognized": [] },
  "sessionId": "9cb1810f-…",
  "cookiesUpdated": true,
  "odp": { "receiptId": "r-…", "type": "product", "action": "detail" }
}
```

`update` is absent when nothing changed. `400` with `error: "Invalid action event format"` and
`details` names the offending field. When the registry document declares product-type weights
(`productTypeWeights`, below), `update.data.affinity.applied` itemises the action, the product type and the
weight the event applied: `{ "action": "add_to_cart", "dimension": "category", "productType": "Handbags", "weight": 8 }`. A tracked action whose outcome is recorded (a reward-bearing event such as an `add_to_cart` or a `content_click`, under tracking consent) answers, on both hosts, `outcome: { recordId }` beside `behavior`: `recordId` is the `outcome_id` of the [outcome record](./03-payload-schemas.md#the-outcome-record), `{tenant}:{time in base 36}:{visitor}:{event}:n1:{eventId}`, built from the time the engine admitted the event at, which is the time the id in `behavior.recordId` carries, so an event sent with a client time ahead of the engine's clock is named at the engine's present, never at the client's (`src/routes/realtime.ts:186-187`, `:408`, `:413`, `src/ledger/records.ts:411`). The answer names it only once the outcome is durably admitted: with durable recovery on, its own admission, which the shopper's owner completes before it answers (`src/learn/route.ts:152`, `src/routes/realtime.ts:387`); without it, the producer's hand-off to the queue (`:404`); so naming it adds no remote call and no wait to the answer, and the operator reads the record under it (`GET /v1/{tenant}/ledger/{recordId}?stream=outcome`) once its effects, which run after the answer, have written it. A dropped event, an event whose tracking is refused and an event that carries no reward (a `page_view`, for one) record no outcome, and their answers carry no `outcome` member. With durable recovery on, an outcome whose learning preparation fails before its durable admission (its learn document could not be read, for one) is not recorded: the answer is still `200` with `behavior` and carries no `outcome` member, and the failure is logged as `learning_incomplete` and counted once in the tenant's `evidenceLoss.producerFailed` (below), a count made after the owner has answered, so it adds nothing before the answer (`src/learn/route.ts:176`, `src/routes/realtime.ts:361`). With durable recovery on, that outcome also survives a reset of the shopper's object between the behaviour capture's durable admission and the outcome's own: the outcome's admission is prepared, its learn document read included, before the behaviour capture is admitted, and the behaviour capture's admission carries it in the same transaction, leaving the behaviour operation's id, digests and replay as they were (`src/routes/realtime.ts:282`, `:310-313`, `src/ledger/recovery.ts:65`, `:208`). The action then answers with the typed answer a reset gives (`401 {ok:false, error:'Shopper session unavailable'}`, or a `500` whose `message` or `details` names the reset), never a `200` without its `outcome` member, and the alarm, at most 30 seconds later, writes the behaviour record and then the outcome record the answer would have named, unless it decides again, from the behaviour record, that the engine drops the event (an unknown product, a second purchase of an order, a buffered delivery for a shopper with no profile record on the object host or no session record on the session host to apply it to: then it writes no outcome record) (`src/durable-objects/ShopperReflex.ts:1988`, `:4069`, `src/ledger/recovery.ts:380`); it does not read the learn document again, and such an outcome is never counted in `producerFailed`. Before it writes a purchase's outcome, the alarm records the purchase's order as purchased, exactly as the engine records the order of a purchase it processes (in the shopper object's own record on the object host, in the shopper's session record on the session host), so a later purchase of the same `orderId` under a new `eventId` (a confirmation page reloaded, a late retry) is answered `200` with `dropped: "duplicate_order"` and records no second outcome, as [purchase uniqueness](#purchase-uniqueness-per-orderid) describes, while the same event delivered again with its own `eventId` is still not a second purchase; the outcome record the alarm writes is the one the answer would have named, nothing added to it (`src/ledger/recovery.ts:397`, `src/durable-objects/ShopperReflex.ts:4122`). As on the buffered door, the order is recorded only where the shopper already has a record to hold it: a profile on the object host, a session record on the session host. When the engine answers that the event records no outcome (dropped, tracking refused, a failed action), the outcome its behaviour capture carried is withdrawn before the answer (`src/routes/realtime.ts:444`, `:461`, `:556`). A refusal of that outcome's own durable admission is never counted lost and leaves the outcome its behaviour capture carried for the alarm to write: one the admission raises inside the store fails the action, as before, and one raised before it is answered `200` with `behavior` and no `outcome` member, since nothing is admitted yet (`src/learn/route.ts:157`, `src/durable-objects/ShopperReflex.ts:1988`).

`signals` is the input diagnostic, on both hosts, and it is measured against the catalogue your tenant
publishes: the values your published content catalogue tags carry, dimension by dimension, plus the
ids and attributes of any product catalogue the tenant holds.

Each value the event carries answers for itself. On a dimension your catalogue names values for, a
value it does not name builds no affinity, whatever else the same event carries; on a dimension your
catalogue names nothing on it is authority over nothing, so every value there stands. An event whose
every value is refused builds nothing at all and the served order stays the catalogue's, and a tenant
that publishes no catalogue data refuses nothing.

`recognized` is true when at least one value on the event built affinity, so an event we can place in
part is reported for what it is rather than refused whole. `unrecognized` names **every product this
event referred to that we could not place — the `productId`/`product_id`/`sku` on the event and each
`items[]` product of an order — whatever else on the event was placed**, and nothing else: it never
names an attribute value, only a product. So an operator reading one answer can tell which product
went unrecognized rather than only that something did.

Release note: the object host's `dropped: "unknown_product"` answer now also fires for an event whose
product we do not hold and whose every attribute value your catalogue refuses, not only for an event
that carried an unknown id and no attributes at all; it carries the same `signals` naming the id.

Release note (both hosts): the session host now answers that drop too, by the same rule, so while
Reflex is enabled the two hosts answer one event the same way. (With Reflex disabled neither host
reads your catalogue: the session host drops nothing and answers no `signals`, and the object host
still drops an unknown product whose event carries nothing it would score.) A dropped event is answered `{ success: true, dropped:
"unknown_product", signals, sessionId, cookiesUpdated: false, consent, … }` and changes nothing: no
counter, visit, affinity, regional count, outcome, provider forward or cookie.

Release note (journey stage on the ODP profile): the `journey_stage` attribute written to your ODP
profile is the **persisted** token (`early | mid | late`) on both hosts and on every path — the event
path and the read-time stage projection. Until now the session host's event path wrote the reported
word (`exploring | thinking | deciding`) instead, which no mirrored audience condition matches; that
is corrected. The stored stage, the decision cell, the learning ladder key and this attribute are now
one derivation: the stage the engine reports for the CURRENT VISIT, carried into the persisted
grammar. **Owner-visible consequence:** the purchase event itself is sent as the `late` token — the
truthful input at the moment she buys — and the first projection after the post-purchase reset carries
`early`, so an audience keyed on `late` (for example `late_journey_ready_to_buy`) no longer keeps a
shopper after she has bought and started a new visit. The reported word the SDK paints is unchanged.

The same change reaches the **local** `journey_stage` audience attribute your own published conditions
are evaluated against: it was the cumulative rule over her whole history, and it is now the same
per-visit derivation as the stored stage and the ODP token. A condition on `journey_stage == "late"`
therefore matches during the visit she buys in and stops matching on her next visit, instead of
matching forever afterwards. One derivation now stands behind every place that name appears; nothing
here changes the persisted tokens themselves, which stay `early | mid | late`.

A legacy record — one written before the stored stage existed, so it carries no stage — adopts as
`early`, the persisted token of the journey's first stage (`exploring`), until her next event derives
her stage for the current visit. The same floor is where a record born this visit starts, and it is
what a shopper who refused personalization is reported at: none of them is placed further along a
journey the engine has not counted.

The same vocabulary and the same `signals` apply to every door an interaction can arrive by, not only
the live one: an explicitly buffered action (`"processing": "buffered"`) is answered with `signals` of
its own, and a content interaction and a historical import row are measured against the same published
catalogue. A value your catalogue does not name on a dimension it does name builds no affinity
whichever door it came in by.

### Purchase uniqueness per `orderId`

A purchase is unique per `orderId` for the shopper, on both hosts and at both doors (live and buffered). A second
purchase event naming an `orderId` the shopper's purchase already named is answered `200` and changes nothing:

```json
{ "success": true, "message": "Action ignored: duplicate order", "dropped": "duplicate_order", "sessionId": "9cb1810f-…", "cookiesUpdated": false, "consent": { "tracking": true, "personalization": true } }
```

A second purchase with the same `orderId` writes no outcome, no credit and no interest, and moves no counter, visit, regional count or provider forward; the answer reports it as `dropped: "duplicate_order"`.
The rule runs after the event is admitted (its schema and its behaviour record) and after the shopper object's rate
limit, so a refused `429` is still a `429`, inside the shopper's own owner. The same event delivered again, the same
`eventId`, is not a second purchase: it is processed as it always was and its outcome record keeps its `outcome_id`.
The order is `data.orderId`, a non-empty string once trimmed or a number; a purchase without an `orderId` is never
deduplicated. The shopper's state remembers the last 64 orders as SHA-256 digests, never the order ids themselves,
for as long as the shopper's profile is kept; an order is remembered when its purchase is recorded on the live door,
and on the buffered door whenever the delivery writes the shopper's state, whether or not it applies interest (the
kit's own purchase payload places no value and still uses its order). Two stated limits: a buffered purchase from a
shopper who refused personalization writes no state, so its order is not remembered and the same order delivered
again is recorded again; and a sign-in that merges two profiles merges their interest, not their remembered orders.

### Content and product events: the viewable impression, the video view, the dwell

- **`content_viewable`, the viewable impression.** The SDK sends it, never your page: one per piece per page
  instance, once the piece's render acknowledgement is held and the container has been reported at least half in
  view for one second without interruption (a one-second timer, cancelled when the piece leaves view, on a detach,
  `destroy()`, a consent refusal or a new identity generation). The declarative capture measures every time in view;
  a piece acknowledged through `rendered(slot, contentId, element)` is measured only while the SDK observes that
  element, until it first leaves view, so a second time in view sends none there. `data` carries `contentId`, `slot`,
  `slotPosition`, `decisionId`, `page`, `pageInstance` and `position`, with `customerContentId` and `contentType`.
  Both hosts accept it and weigh it 0 whatever the registry says: it builds no interest, counts as no signal,
  reaches no regional or context population, is not an interaction of the visit, writes no outcome record and is
  never an exposure, so no learning denominator changes. Whether a layout learns on a viewable basis is a separate,
  later measurement decision.
- **`video_view`, the video view.** A content action: `client.emit.videoView(contentId, slot, attrs?)`, sent when
  the player has played three seconds, beside `videoComplete`. It waits for the piece's render acknowledgement and
  builds interest in the piece's format as the catalogue names it (`tags.contentType`), exactly as `video_complete`
  does, at the weight the tenant's registry publishes for it (`weights.video_view`, 1 in the shipped registry); a
  registry that names no `video_view` weight weighs it 0, as it weighs every action it does not name. It is not a learning reward: it
  writes no outcome record.
- **`dwellMinMsBySlot`, the dwell minimum per slot.** `client.emit.declarative({ dwellMinMs, dwellMinMsBySlot })`
  and `createClient(config, host, { dwellMinMs, dwellMinMsBySlot })`: a slot named in `dwellMinMsBySlot` sends a
  `content_dwell` only after its own minimum on screen (`{ "pdp-editorial": 30000 }`, 30 seconds on editorial);
  every other slot keeps `dwellMinMs`, one second unless configured.
- **`product_dwell`, the product dwell.** Sent by your page once per product view past 20 seconds on the product
  page, `data` `{ productId, dwellMs }` (plus the registry's attributes when the brand scores them from the event): `product_dwell` is accepted on both hosts and its `dwellMs` feeds the visit's dwell counter.
  That counter is `category_dwell_ms`, which a published journey threshold reads; the event counts as an
  interaction of the visit and weighs 0 unless the registry publishes a weight. As for any product event, one naming
  a product the tenant does not hold, whose every value the catalogue refuses, is dropped as `unknown_product`.

### The cached layout's exposure beacon (`layout_exposure`)

A page drawn from a cached layout (the context-only layout switch, **A context-only layout slot and its key** in
section 2) sends one `layout_exposure` per page view through the SDK's
`client.listen.layoutExposure({ contextKey, page, slot, modules })`, under the shopper's tracking consent only.
`data` carries `contextKey` (the `X-Context-Key` the cached layout was answered under), `page`, `slot`, `modules`
(the module ids drawn, in drawn order, at most 50 and each once) and `pageInstance` (the page view), with
`data.brand` as every action carries it. The route answers it itself, before either shopper host: it changes
nothing about the shopper (no interest, journey counter, visit, signal or outcome record) and only counts
exposures. One exposure per drawn module is added, after the answer, to the learning of the context the key names,
at its channel and visit bucket and the coarser levels (the device is no learning level), when every condition
holds: the shopper's tracking consent; a key the engine issued for this tenant and brand, naming this page; a
context of an arm that learns (a key of the default variant or of the holdout's no-learning arm counts nothing);
the page's declared layout slot switched to context-only as the key says, named as `slot`; that slot measured on
`rendered-v1`; modules of the published catalogue that name the slot, no more than its `take`; and a retention
policy in force for online learning. The answer is `{ "success": true, "exposure": "admitted", "modules": n }`, or
`{ "success": true, "exposure": "ignored", "reason": … }` with `reason` one of `tracking_refused`,
`key_not_issued`, `not_learning`, `not_context_only`, `not_measured`, `unknown_module` or `unavailable`; a beacon
whose `data` is not of this shape answers `400` `Invalid layout exposure`. A repeat for the same page view adds
nothing, whatever modules it names.

### The carousel's exposure beacon (`carousel_exposure`)

A page whose carousel the head script ordered before paint (**The context table and the head script** in section 2)
sends one `carousel_exposure` per page view through the SDK's
`client.listen.carouselExposure({ tableVersion, context, page, slot, images, arm })`, under the shopper's tracking
consent only. `data` carries `tableVersion` (the context table's version the head script applied, `data-op-table`),
`context` (the context it applied, `data-op-context`: `<channel>|<visitBucket>|<device>`, or `default`), `page`,
`slot` (the carousel slot), `images` (the image ids in painted order, at most 50 and each once), `arm` (the class the
page painted, `data-op-arm`: `personalized`, `default` or `no_learning`), `pageInstance` (the page view) and, where
the page view names a product, `product` (its `productId`), with `data.brand` as every action carries it. The route
answers it itself, before either shopper host: it changes nothing
about the shopper and only counts exposures. One exposure per painted image is added, after the answer, to the
carousel's learning in the context's channel and visit bucket and the coarser levels (the device is no learning
level; a `default` context is recorded as an unknown context is, at the root and the unknown channel), when every
condition holds: the shopper's tracking consent; the table version in force for the page, whose carousel slot is
`slot`; a context that version carries; the carousel measured on `rendered-v1`; images of the published catalogue
that name the slot, no more than its `take`; the engine's own assignment of the shopper, as its decision draws it
(the shopper's personalization consent and enrollment anchor, and the salt in force), an arm that learns, never the page's
claim, and an anchor it cannot read counts nothing; and a retention policy in force for online learning. Only the
version in force is admitted: a page cached from the table's stable address before a publication sends a replaced
version for up to a minute (its `max-age`), and those beacons answer `stale_table` and count nothing. The answer is
`{ "success": true, "exposure": "admitted", "images": n, "armClaimed": … }`, or
`{ "success": true, "exposure": "ignored", "reason": …, "armClaimed": … }` with `reason` one of `tracking_refused`,
`stale_table`, `not_carousel`, `unknown_context`, `not_measured`, `product_required`, `unknown_image`, `not_learning` or
`unavailable`; on a catalog in parts whose product slots include the carousel, the images are read from the part
of the beacon's `product`, and a beacon naming none answers `product_required`;
`armClaimed` is the page's `arm` as sent. A claim whose class differs from the engine's (`personalized` against the
holdout's `default`, or the reverse) is counted for your operators as `arm_draw` `mismatch` on
`GET /v1/{tenant}/learn/queue`. A beacon whose `data` is not of this shape answers `400` `Invalid carousel exposure`.
A repeat for the same page view adds nothing. A click or an add to bag on a painted image is credited only through
the engine's own decision for that image on that page view, as a cached layout's module is: a painted carousel with
no decision behind it credits nothing.

### Event conventions

These travel as `custom` events (`client.emit.custom(name, data)`, `data.event` the name), each built only from what
the tenant's registry names, and each weighs 0 until the registry publishes a weight for its name.

- **`search`**: the values the site's search resolved the query to, in the registry's source fields (for example
  `category`, `line`): `search` carries the resolved values only, never the query text.
- **`filter_applied`**: the facet's `dimension` and `value`, with the value also in the registry's own source field
  (`{ "dimension": "category", "value": "Handbags", "category": "Handbags" }`). The sale filter and the sale page both send `filter_applied` with `dimension` `priceStatus`, `value` `sale` and `priceStatus: "sale"`, raising `priceStatus` sale.
- **`remove_from_cart`**: `{ productId }`, plus the registry's attributes when the brand scores them from the event; it weighs 0 and is no signal for the signal floor. Under the tenant's `suppression` settings it suppresses, for the shopper, every registry value it carries for the action's window in `days` ([negative preference](#negative-preference-suppression-with-an-expiry)); without them it changes nothing.
- **Declared interactions.** A size guide or reviews panel opened inside a module is that module's engagement:
  `data-op-engage="sizeguide:open reviews:open"` on the container, and each `sizeguide:open` or `reviews:open` event
  dispatched (bubbling) inside it is one `content_click` naming its `interaction`.

An event's own values build interest only where the registry names the source field as a dimension and scores
event attributes (`eventAttributes: "event-when-unknown"`).

### `GET /realtime/ws?tenant=<tenant>`

The live channel; a WebSocket upgrade. Subject/profile routing derives from the verified capability on both hosts. The SDK sends `shopper-session-v1`, the capability, and `sdk-key-v1.<canonical base64url UTF-8 site key>` as subprotocols (key at most512 UTF-8 bytes). The site key remains an independent tenant gate. Duplicate, malformed or conflicting selectors refuse before owner effects. Legacy selectors remain guarded; headers/protocols still require sensitive-data handling, and no historical-log deletion is implied. Frames from the platform: `connected`, `heartbeat_response`,
`personalization_update`, `segment_update`, `audience_published`, `odp_receipt`, `content_decisions`. The engine sends `content_decisions`, the open page view's decision set exactly as its decision request would be answered, whenever the set differs from what the page view last received by either channel (after an admitted action, a buffered delivery, or a publication change at the latest at the socket's next heartbeat; a socket's open decides nothing), its offered items or, on a carousel page, its `shotOrder` (the shopper's own shot order, so a change in that order alone is sent); never the answer to the page's own request, never without the shopper's personalization consent at the time it is sent. The open page view is the latest decision request's, kept under the shopper's own object until the shopper's last socket closes or the shopper logs out, so a push follows the object's restart. With several tabs open, the newest tab's page view takes the pushes. A page left open past its session grant's lifetime receives pushes again once its next request renews it. A page view whose decision request ran with tracking withheld (a new visitor's first request, before the shopper's choice, among them) is not kept, so its page receives pushes only after it asks again under the shopper's choice. A profile retention expiry, which runs at the shopper's object's own alarm, is not pushed: it reaches an open page at its next request, which a page without a live connection makes after each action. Servers, a page's first list before the connection is up and a refresh the page calls use the HTTPS snapshot request (`POST`).
The client sends `{"type":"heartbeat"}` on the SDK's interval. Frame bodies are in the
[payload schemas](./03-payload-schemas.md#socket-frames).

### `POST /realtime/session/reset`

Expires the platform's cookies for this browser and deletes its session. The SDK's `logout` uses the
identity route instead; this one is the erase.

### Which session a shopper call acts on

Every shopper event route acts on the session its signed shopper capability carries: a `userId` the
call names must be the capability's subject and a `sessionId` its session, and the SDK keeps that one
session across the event, decision and sort calls of a fresh page and of a returning one. A successful event answers from the result of
its own write, without reading the record back. `POST /sort` reads the shopper's state without
creating any and writes no shopper state other than a consent restriction; its product-sort ledger
record is still written. The item-to-item catalogue graph is built at most once per isolate and reused
across events, decisions and sorts.

This is containment only (W36), not a fix: it does not make the session record's read-modify-write in
KV atomic, so the KV race and the shopper-profile authority finding (F14) stay open until W35 passes.
W35 makes the per-shopper object the local shopper authority; it is delivered locally and not accepted
on the deployed hosts, and the shipped configuration keeps `REFLEX_HOST = "session"`.

## 2. Decisions

### `POST /sort/intent`

Filters and ranks a supplied product candidate page using the tenant's configured dimensions and the signed shopper's existing live affinity. Send canonical `X-Tenant` and `X-Shopper-Session` capability; `userId` and optional `sessionId` must match that capability. This is the supplied-candidate structured-intent leg. Dedicated `POST /search` performs configured generic NL interpretation and real catalog retrieval; it preserves hard feed constraints and then uses the same deterministic ranking. Provider activation and customer acceptance remain open.

```json
{
  "userId": "<capability subject>",
  "candidates": [{ "id": "SKU-123", "inStock": true, "material": "linen" }],
  "intent": { "filters": [{ "dimension": "material", "values": ["linen", "cotton"] }] },
  "limit": 9
}
```

Use the tenant registry's exact dimension keys and source attributes; the example requires a `material` dimension reading `material`. Filters require every dimension to match and allow any listed value within one dimension, with trimmed case-insensitive exact value matching. Unknown or duplicate dimensions are rejected. A configured derived price band uses that registry's numeric source and cuts; there is no separate numeric-price, currency or gift policy here. Only explicit `inStock: true` is eligible. Availability and attributes are commerce-feed assertions, not an inventory or catalog-ownership check. The first trimmed ID wins before filtering; a later duplicate cannot restore an excluded item. No matches returns an empty result without relaxing filters.

The strict body accepts only `userId`, optional `sessionId`, `surface`, `consent`, `weights`, `limit`, and required `candidates`/`intent`. IDs are nonempty trimmed strings up to 200 characters; every candidate requires boolean `inStock`, with flat string/finite-number/boolean/null/string-array attributes. Maximums: 500 candidates, 16 filters, 8 values per filter, 64 characters per dimension, 128 per value, and 256 KiB of actual UTF-8 JSON. `limit` is an integer from 1 to 500, default 9, applied after ranking. Optional `weights.affinity` and `weights.dims` values must be finite numbers from 0 to 10; zero affinity preserves eligible feed order. Caller-supplied affinity or query fields are rejected.

Success includes `source: "structured-intent"`, `tenant`, `configVersion`, `order`, and `items` with `id`, original zero-based `feedRank`, result `rank`, `score` and affinity `drivers`. `inputCount = dropped + filteredCount + eligibleCount`: `dropped` counts duplicate IDs, `filteredCount` counts unique first records rejected by stock or filters, and `eligibleCount` is before the limit; `order.length` is the returned count. Stored, cookie or body refusal removes private affinity influence and drivers. Ranking creates no behavioral profile or visit; necessary refusal preferences may be persisted. Responses are `no-store`; invalid input/filter is 400, ownership refusal 401, oversized body 413, and configuration/internal unavailability 503. Customer/SFCC acceptance remains separate. `POST /sort` retains its candidate-preserving ranking behavior.

Both product-sort endpoints require owner-durable admission before a tracked success. The response is `persistence: {status: "durable", recordId, receipt}`: `durable` proves the original source transaction, not queue consumption, remote warehouse acceptance or browser rendering. Receipt `source.state` distinguishes pending/recovered/suppressed/expired, with separate queue, canonical ledger and (for content only) learning receipts. Tracking refusal records nothing; failed durable admission returns503. The whole product-sort receipt remains bounded at1MiB without truncation; an oversized queue body uses the existing canonical fallback and owner recovery, retaining its original identity and expiry.

Use the explicit `stream=product-sort` or `stream=behavior` selector for audited operator read/list. Default batch listing still selects only decision/outcome. Non-learning records never enter exposure/credit counters or learning object budgets. Original retention, erasure cutoff and positional managed-delivery claims apply to all four streams. A source may be durable even if the HTTP response times out.


### `POST /v1/{tenant}/decisions/snapshot`

Every slot's offered decision for the page, in page order; private records are not returned. Site key plus current shopper capability. JSON carries optional string fields `page`, `pageInstance`, `brand`, `channel`, `browsingSessionId`, `customerId`, JSON-encoded `entry`, JSON-encoded `nothingToShow`, restrictive `trackingConsent`/`personalizationEnabled` (`"false"`/`"true"`), and the page's context signals `ctx.<name>` as the GET's query string carries them (`ctx.anchor` and `ctx.variant`: a product page's product and its variant). A context signal's name is a letter followed by at most 31 letters, digits or underscores; its value is 1 to 64 characters after trimming, and at most 64 as sent (characters are UTF-16 code units, so an emoji counts two; on the GET form, "as sent" is the decoded parameter value: a `+` is a space and a percent-encoded character counts once, as `é` does whether sent as `é` or `%C3%A9`); a request carries at most 8 of them. A signal outside those bounds is answered `400` (`Invalid context signal name`, `Invalid context signal value`, `Too many context signals`), and on a new visitor's first request `401`, writing nothing. Subject and profile SID derive only from the bearer; identity fields, query fields and duplicate JSON keys are refused. Snapshot responses retain the existing consent acknowledgment/expiry protocol. Guarded legacy GET remains for compatibility but is not used by the SDK.

**A new visitor's first request.** A POST that carries no shopper session at all (no `X-Shopper-Session`) is a new visitor's one call, and the first decision set is served on that first request with the session issued beside it, with no separate round trip for the session. The request is checked as every decision request is before anything is written: the site key at the edge, the tenant, the body's size and time limit, the key allow-list (no identity field, no query field) and the body's fields; any failure is `401` and writes nothing. Then the session is issued, the same grant with the same consent default as `POST /v1/{tenant}/identity/session` gives a browser with no capability (the cookies' and the body's own `"false"` hints can only restrict), and the request is answered under it as any decision request is, decided on a blank copy of the new visitor's record (the visitor id was minted a moment earlier, so that record is empty by construction): the same code and every check of the record's own object, with nothing contacted, created or written before the answer, so the first answer does not wait on creating the visitor's record. The issued session is added as `session`, in the shape the session route answers (`{ capability, tenant, subject, sessionId, kind, grantId, authorityEpoch, iat, exp, consent }`). The record itself is created right after the answer, or by the visitor's next request if that creation is lost, and every later request is answered by it; were the blank copy to need to write anything, the first answer is decided on the record itself, as every later one is, under the same session. A request that carries a session never gets `session`: a valid one is answered as before, and a forged, expired or foreign one is refused `401` as before. A GET without a session is refused `401`. The first request's answer names its own time: its `Server-Timing` header and its `sources.timings` carry the forwarded decision's five stages (`documents`, `shopper`, `trend`, `lift`, `decide`: the stages of the forwarded decision, on the blank copy of the new visitor's record) and, beside them, the first request's own entries, in whole milliseconds: `session` (the session's issue, its activation on the blank copy of the new visitor's record and its verification), `forward` (the forwarded decision's round trip less its five stages), `arm` (only when the page drew a class: the class's mint and its outcome) and `total` (the first request's whole time), which the other entries add up to but for the request's own reading of its body; it is the only `total` on the first request's served answer. The same entries are in the body because a cross-origin page cannot read the header. Beside them, the body's `sources.sessionParts` is a diagnostic of the `session` entry, in whole milliseconds and never in the header: `mint` (the visitor id's issue and signing), `activate` (the activation's round trip), `verify` (the session's verification) and `object` (the activation's own parts as the object that ran it timed them: `queue`, `grant`, `consent`, `restrict` on the session host, `alarm`, `commit` and `op`, its whole time there). A page view that already holds a session carries the five stages alone in `sources.timings`. Every other answer, that page view and a refused first request among them, carries in its `Server-Timing` header the platform's own `total`, the entry with `desc="Total Response Time"`: the platform's whole time for that answer.

| Body context | Meaning |
|---|---|
| `page` | The page's name in the slot document; default `home` |
| `pageInstance` | Original page nonce, required for authenticated render offers; retain it through that paint and its ACK |
| `brand` | Recorded on the decisions; defaults to the tenant |
| `channel` | The entry channel if the page knows it; recorded on the decision's cell |
| `nothingToShow` | The modules that have nothing to show for this page view: a JSON array of module ids sent as one string (at most 64 ids, each at most 256 characters, the field at most 4096 characters), each withheld before ranking, so it is not returned, not recorded and never counted as an exposure; a malformed report answers `400` `Invalid nothing-to-show report` (see **Nothing to show and the eligibility rule** below) |
| `customerId` | Your identifier for the shopper that the page passed with `setCustomerId`, 1 to 128 letters, digits and `_ + / = . -`; any other value is refused `401`. Written as `customer_id` beside `visitor_id` on this request's decision records under tracking consent, and read by nothing that decides: the customerId is never proof, selects no state and issues no session |

```json
{
  "ok": true, "tenant": "coach", "brand": "coach", "page": "home", "pageInstance": "original-page-nonce",
  "ts": 1788541396189,
  "arm": "personalized", "experiment": { "id": "<tenant>:<brand>:<salt>", "saltVersion": 1, "arm": "personalized", "anchorGeneration": 1 },
  "versions": { "config": 15, "catalog": 4, "slots": 7, "learn": 19, "lift": 1788540535150, "prior": 6, "policy": 19 },
  "config_label": "reflex-demo-v1+r15",
  "decisions": [ { "contentId": "cnt_7cb1e039", "customerContentId": "CCH-001", "type": "campaign", "slot": "chero", "order": 0, "slotPosition": 0, "decisionId": "<original decision carrier>", "renderOffer": "<opaque ro1 offer>",
    "score": 0.455, "strategy": "affinity", "explain": { "drivers": [ { "dim": "line", "value": "Tabby", "a": 0.7286, "weight": 0.35 } ] } } ],
  "pinDiagnostics": [ { "slot": "chero", "pinnedPieceId": "cnt_9ab2f10c", "pinIndex": 1, "reason": "missing_or_ineligible" } ], "refusedCount": 1, "omittedCount": 0,
  "sources": { "catalog": { "version": "coach-content+r4", "revision": 4, "pieces": 26 }, "slots": { "version": "slots-coach+r7", "revision": 7, "count": 4 }, "learn": { "version": "learn+r19", "revision": 19 }, "config": { "label": "reflex-demo-v1+r15", "revision": 15 }, "journey": { "version": "reflex-demo-v1+r15", "revision": 15, "reason": null }, "external": null, "state": "session",
    "consent": { "tracking": true, "personalization": true, "instruction": { "version": 1, "tenant": "<tenant>", "subject": "<subject>", "revision": "<choice id>", "operation": { "id": "<choice id>", "grant": "{\"grantId\":\"<grant id>\",\"authorityEpoch\":\"<authority epoch>\",\"iat\":1788541300,\"exp\":1788544900}", "expected": null, "tracking": true, "personalization": true },
      "tracking": { "value": true, "chosenAt": 1788541310000, "expiresAt": 1791133310000 }, "personalization": { "value": true, "chosenAt": 1788541310000, "expiresAt": 1791133310000 } }, "personalized": true }, "timings": { "documents": 4, "shopper": 6, "trend": 0, "lift": 3, "decide": 2 },
    "lift": { "chero": { "ms": 3, "outcome": "served" } }, "ring": { "ms": 2, "outcome": "read" }, "budgets": { "lift": 600, "ring": 600 } }
}
```

A snapshot poll from a shopper who refuses tracking is read-only: no ledger/learning exposure or behavioral admission solely for requesting a choice. Necessary identity/consent/refusal authority work is separate. Its `200` answer shows the refusal in the members `scripts/verify-origin.sh` checks: `arm` is `"default"` (tracking- or personalization-refused choices use defaults), no decision carries a `renderOffer` (tracking-refused choices contain no render offer), and `sources.consent` names that state, with `tracking` and `personalization` both `false` after an explicit refusal of both. The answer has no `write` member: whether a request is recorded is internal to the platform, and the sample above carries none either. A consenting shopper's poll that carries `pageInstance` is not captured when it is served either: its rendered-v1 decisions are offered for the rendered acknowledgement, which alone admits the exposure, except on the platform's own synthetic operation (src/routes/decisions.ts:1362; src/content/service.ts:1131, :1133, :1232); the record of an off-limits layout slot measured on rendered-v1 is still written to the ledger after the answer, with no exposure (service.ts:1162-1167). The sample is a signed, consenting shopper's answer: `experiment` appears because the request is signed (src/routes/decisions.ts:1417), `pinDiagnostics` with `refusedCount` and `omittedCount` because a pin was refused (:1385-1386), and `pageInstance` because the request sent one (:1388). `sources.consent.instruction` is the shopper's recorded choice as the platform holds it, sent with a refusal as with consent (src/content/service.ts:1260): `version`, `tenant`, `subject`, `revision`, the `operation` that made the choice and each purpose's `{ value, chosenAt, expiresAt }` (src/content/consent.ts:20-24, built at :110-112). It is present once the shopper has made an explicit choice (none is held before, consent.ts:140); `operation` is dropped once the session grant that made the choice has expired (:63-66), and a purpose's entry once its 30-day choice has expired (:60); once both choices have expired the whole `instruction` is gone (:61). Two members appear only under conditions the sample does not meet: `records`, only on the platform's own synthetic operation (src/routes/decisions.ts:1437), and `sources.record: "unreadable"`, only when the shopper's stored record cannot be read out under the retention policy in force (src/content/service.ts:1259). On a page whose context table names a carousel the answer also carries `shotOrder`, the shopper's own shot order: the carousel's published shot values (`contentType`) the shopper's own interest ranks above 0, most interest first, ties by the context's row, at most 16; `null` on the `default` arm, below the signal floor, for a carousel that weighs no `contentType`, or with no such interest; absent on every other page. The SDK keeps it for the head script's next paint (`opt_head`).

**Why a learned lift or a fatigue term was or was not applied.** Every answer names how each read of what
the platform learned ended, in two members of `sources`, and the budgets both reads ran under, in a third;
nothing else of the answer and no member of `decisions[]` changes with them, the decision record changes only
by `explain.lift.asOf` (below), and the record's replay is unchanged.
`sources.lift` has one member per learning slot whose learned lift the decision read, keyed by slot name
(keys sorted): every active slot of the page on an arm that personalizes. Each is `{ ms, outcome }`, and
`outcome` is the first of these that applies: `none` (no lift is published for the placement), `incompatible`
(the published lift is not measured as the learn document in force measures the slot: its reward, basis,
objective or estimator dials differ), `failed` (the lift could not be read, or the statistics object could
not be asked or did not answer as itself), `late` (the statistics object did not confirm the lift within the
witness's budget), `unhealthy` (the statistics object's state is not healthy), `served` (the lift was
applied: the record names its `versions.lift`), `superseded` (the statistics object has published a later
version since that lift, and the lift is outside the recent-publication window below, or is one of its recent
publications under a configuration or generation it no longer holds) and `unrecognized` (any other lift: a
version or a content the statistics object never published, and its latest publication once its configuration
or generation has changed since, by a reset or a generation transition). A lift that is no longer
the statistics object's latest publication is still applied when the object recognises it among its recent
publications: the same version and content, published no more than `LIFT_RECENT_WINDOW_MS` (ten minutes,
src/learn/fan.ts) before the decision reads it, counted from its own publication, under the configuration,
generation and projection the object holds now, in a healthy state. An edge location may hold a copy for up to
a minute, and the store may take most of another to carry the next publication, while the object republishes
whenever new evidence arrives. Such a decision's record carries `explain.lift.asOf: { latest, publishedAt,
version }`, keys sorted: the copy's own `version` (its `versions.lift`) and `publishedAt`, and the `latest`
version the object had published (the payload schemas); a record decided with the latest copy carries no
`asOf`, exactly as before, and replay compares it by value. A lift older than the window is reported
`superseded` by its version alone, since its content cannot be checked against a publication the object no
longer keeps. Every outcome
but `served` leaves the decision unlifted, its record carrying `explain.lift: null` and `versions.lift: 0`,
exactly as before. A decision on the default arm reads no lift and answers `"lift": {}`. `sources.ring` is
`{ ms, outcome }` for the read of the shopper's recent decisions that the fatigue term is computed from:
`read` (it answered within its budget, an empty history included), `late` (it did not, and no fatigue term
applied), `failed` (it could not be read, and no fatigue term applied) or `skipped` with `ms: 0` (the
decision read none: no slot of the page applies a fatigue dial, or the arm is the default's). `ms` is the
read's own time, in whole milliseconds, from its start to its outcome; a `late` read reports at least the
budget it waited. `sources.budgets` is `{ lift, ring }`, those budgets in milliseconds: by default
`LIFT_WITNESS_BUDGET_MS` and `RING_READ_BUDGET_MS`, 600 ms each (src/learn/fan.ts): one edge round trip to a
warm Durable Object, which for the statistics object was measured on the platform at a largest 478 ms inside a
warm tail, with a buffer; the budget bounds the wait for the read, not the read, so a read inside it answers as soon
as it is done. A deployment may set either as an environment
variable of the same name: the decimal text of a whole number of milliseconds above 0 and below 5 000 (the
SDK's own deadline) is admitted; any other value is refused, the default stays in force, and
`sources.budgets.refused` names the refused variables, sorted (absent when none was refused). The ring read
and the witness call are aborted when their budget runs out, so neither holds the answer past it; the lift's
key-value snapshot read, which comes before the witness call, is under no budget today, so a slow key-value
read can hold the answer past the budget (about 2.5 s once on the acceptance pair). The `lift` entry of
`timings` is the stage both reads run in together. The same outcomes
are counted for the tenant by the platform's own monitor, as `learningReads` (section 7, and the monitor's
members below).

**The statistics object stays warm.** A placement's statistics object keeps itself resident for the decisions
that read it, so the witness read above finds it awake: after a touch (a witness call it answers, an exposure
write or a credit write) its one alarm is due no more than `WARM_HEARTBEAT_MS` (5 seconds) ahead, and every
alarm re-arms it so, until `WARM_TAIL_MS` (10 minutes) after the last touch (src/durable-objects/LearnStats.ts).
A heartbeat re-arms the alarm and performs nothing else unless a publication is due: it builds no snapshot,
runs no publication check, reads no key-value entry, publishes nothing and writes no key. A publication is due
only 30 seconds after an exposure or credit write, a clean-up of a shopper's learning effects that retires their markers, a stats repair (`coarsen` or the explicit `reset`, a repeat of one included), a republication of the tenant's documents, or a refused or
failed publication (its retry); to see a republication, a heartbeat with nothing else pending looks at the
tenant's publication head as the configuration cache holds it, which reads the head and its set from the
configuration store at most once every 30 seconds. The same alarm removes each learning-effect marker at its
expiry (the statistics publisher, below). The cost is up to 720 alarm invocations per statistics object per
hour inside the tail, and the object resident for the tail after each touch or restart; after the tail the heartbeats
stop and only those alarms remain. The bound is the platform's eviction
of an idle object (observed after about 13 to 17 seconds), not a contract: the first decision after a quiet
spell longer than the tail may still find the object asleep, and its lift read can then be `late`, named in
`sources.lift`. An object started again (after a deployment, or by the platform inside a tail) knows neither
its last touch nor the age of a pending change: its first alarm runs the routine publication once, which
publishes only a change, and, unless that alarm is a learning-effect marker's expiry, resumes the heartbeat
as a touch would, so the tail may extend by up to 600 seconds after each restart and an object that keeps
restarting less than ten minutes apart stays warm; a reader arriving after the object was evicted and before
its next alarm still finds it asleep. The shopper's ring object is not kept warm, so a cold ring read can be `late` in
`sources.ring`. The heartbeat leaves the budgets as they are: 600 ms each by default.

**A declared layout slot.** A slot the slot document declares with `layout: true` (under
`governanceVersion: 4`, at most one per page) is the page's layout: its `decisions` are up to `take`
module ids in rank order, after eligibility, the slot's exclusions and page-wide de-duplication, and
never a filler when fewer modules are eligible. The list the layout slot returns is the layout's
sequence, in `order`. A module that is not returned is not drawn, and its container stays hidden. Every
drawn module is acknowledged with its own render acknowledgement (a `content_impression` carrying its
`decisionId` and `renderOffer`), and only a drawn module is. On a layout slot measured on `rendered-v1`
that acknowledgement is the module's one exposure, however often it is retried, while a module returned
and not drawn, or not returned, adds none. A layout slot whose learn document leaves it on `served-v1`
is answered without a `renderOffer` and is never captured as an exposure at serve time, not even by the
platform's own trusted synthetic monitor; the decision set names the mismatch as
`layoutDiagnostics: [{measurementBasis, reason: "measurement_basis", slot}]`, which is host-internal and
not a member of this answer.

**Inner content slots: the content inside each module.** Where the page's declared layout slot names inner
content slots (`inner`, [below](#inner-content-slots-inner)), the same answer decides the layout and the inner
content slot of every module the layout returned, in one page decision: in `decisions`, the inner slots' decisions
follow the layout's directly, in the order the layout returned its modules, and `order` runs on across them before
the slots after the layout. Each decision of an inner slot carries `within: { module, slot }`, keys sorted: the
layout slot and the module whose content it is, beside its own `slot` and `slotPosition`. A module that is not
returned has its inner slot undecided: the answer carries no decision and no `within` for it, and no record is
written. A pin of that inner slot still stays reserved page-wide, so its piece is served nowhere on that page view,
and the answer's `pinDiagnostics` names it with reason `module_not_returned` and `within: { module, slot }`, the
module that was not returned and the layout slot ([below](#inner-content-slots-inner)). No piece is served twice on the page: de-duplication spans the layout, every inner
slot and every other slot. The answer's top-level members are unchanged, and a page whose layout slot names no
inner content slot is answered exactly as before.

**The position within the slot, and module events.** Every decision carries `slotPosition`, its position
within its slot (what its decision record calls `position`, from 0), beside `order`, its page-wide order; a
page whose slot is not its first numbers the two differently. A module container is marked as any piece is,
with `data-op-content` naming the module and `data-op-slot` its layout slot, and may declare the interactions
that count as using it in `data-op-engage` (DOM event types, space separated). Its impression is its render
acknowledgement, one per module per page instance, carrying `position` and `slotPosition`; a click inside the
container, and each interaction it declares, is one engagement: a `content_click` carrying `contentId`, `slot`,
the acknowledged `decisionId`, `slotPosition` and, for a declared interaction, `interaction`,
credited as the slot's click reward only to a decision whose render was admitted.

**Receipts by position within the slot, and a held layout (browser SDK).** The SDK keys each painted
receipt by `slot`, `slotPosition` and module. A newer answer that changes one slot's selection shifts the
page-wide `order` of the slots after it but leaves their receipts and their subscribers untouched; the same
module at another `slotPosition` within its slot is a new placement, repainted and acknowledged with the
receipt of the answer that moved it. A page may hold a slot for the page view with
`client.listen.hold(slot)`: until the function it returns is called, or a new page view begins, a later
answer of that page view leaves the held slot as it was painted, and the render acknowledgements and
engagements of its modules keep the `decisionId` each was painted and acknowledged with, although the newer
answer moved or dropped the module. A release does not repaint by itself; the next answer repaints the
slot. A hold never holds back known absence (a consent refusal, an identity change, a failed answer). A new page view begins with a `hydrate` or `refresh` that names another page, another channel or another product (`productId`, your product identifier, the value your product events carry; a `refresh` that names no `productId` after one that named one counts as another product, as a missing channel does): it has its own page instance, deadline, holds and receipts. A cached layout's report for another product is reported under its own page instance. A variant switch of the same product (`variantId` changed, `productId` the same) and a re-ask (`refresh()`, or the SDK's own after an acknowledged event) do not begin one. The SDK sends `productId` as the decision request's `ctx.anchor`, and `variantId` beside it as `ctx.variant`, each trimmed and only when it is 1 to 64 characters after trimming: a `productId` outside that bound sends neither, and the page view is served as one without an anchor; a `variantId` outside it is dropped alone.

**A configured order per context.** A merchandiser can publish, on the page's declared layout slot, a
module order per context (`orders`, governance version 4; [the layout slot](./03-payload-schemas.md#the-layout-slot)),
in the console's Slot rules screen or with `PUT /content/slots`, with no deployment. A context is one
entry channel — one of the six channel words `direct`, `paid_social`, `paid_search`, `email`, `organic`,
`referral` — or `any`, with one or more visit buckets (`1`, `2-3`, `4+`) or `any`; its specificity is the
number of those two parts that are not `any`, and the most specific context that matches the shopper
decides. A shopper whose channel or visit bucket is unknown matches no context, not even one that names
`any`. A context may also name a device class, `device` `mobile` or `desktop` (a tablet counts as desktop),
beside or, with `any`, instead of the channel and the visit buckets: a named device is one more part of its
specificity, a context naming no device matches every device, and a shopper whose request reports no
device matches no context that names one ([device and recency](#device-and-recency-device-recency)). The next snapshot for a shopper in that context returns the order's modules exactly, position by
position, in `order`: an order may list fewer modules than the slot's `take`, and a module it does not
list is hidden in that context — not returned, never offered for a render acknowledgement and never
counted as an exposure. On a layout slot that does not opt into the layout blend (below) the order is
served exactly and never re-ranked; it is never served on the
holdout's `default` arm, to a shopper without
personalization consent, or on a decision on which the slot's exploration picks, and each of those, like
every shopper in another context, receives the slot's own decision unchanged. A pinned module keeps its
pinned position and its `pin` authority under the order; a listed module that is not eligible at decision
time (outside its window, expired, out of stock, no longer in the catalogue, refused by a slot gate, or
served elsewhere on the page) is passed over and never replaced, so the order is served without it and
the slot never falls back to its own ranking for that shopper. A position the order set keeps the
`score`, `strategy` and drivers its own ranking arithmetic computed, and its `explain.note` says that the
configured order placed it. Where the tenant has published approved layouts for the page
([the approved layouts](#the-approved-layouts-layouts)), an order is published only as one of the page's
approved layouts for its device: `PUT /content/slots`, its validate, a slots rollback and a slots member of
`publicationChanges` refuse any other order with `422`, each error naming the page, the order's context and its
modules, and nothing is written.

**Pins at a position and off-limits modules.** On the page's declared layout slot a merchandiser can pin
a module at any position, `positionPins: [{ pieceId, position }]` with `position` counted from 1 to the
slot's `take`, after any prefix pins, and mark modules off-limits, `offLimitsPieceIds: [pieceId]`
(governance version 4; [the layout slot](./03-payload-schemas.md#position-pins-and-off-limits-modules)),
in the console's Slot rules screen or with `PUT /content/slots`, with no deployment. A module pinned at a
position is reserved page-wide before any slot of the page ranks, as a prefix pin is, and is returned at
exactly that position on every arm — the holdout's `default` arm, a decision under a configured order and
a slot decided on context alone below the signal floor included — with authority `pin`; it is never scored
and never explored, the other positions are ranked around it, and prefix pins serve exactly as before.
An off-limits module (`offLimitsPieceIds`) holds its baseline position on every arm, and the other modules
are ranked around it: the baseline order is the configured order for the shopper's context where one
matches (its modules the slot can still serve, in the order's sequence), else the modules the slot can
serve — after eligibility, its exclusions and what the page already served or reserved, its own pins
included — in catalogue order, and a module's baseline position is its place in that order, counted from 1.
An off-limits module is never scored, and no term (the interests matched, the population and context
priors, the layout blend, freshness, fatigue, merchandising) and no exploration moves it; one whose
baseline position lies beyond the take, or on a pinned position, is not served, and one the slot cannot
serve holds nothing. Under decision D1 a module pinned at a position that is missing, ineligible (expired,
outside its window, out of stock) or excluded (by id, tag or type) refuses the whole slot, exactly as a
refused prefix pin does: nothing is served from it, no record is written, and `pinDiagnostics` names the
module, its position and the reason, while the rest of the page is served. When fewer modules can be
ranked than the positions before a pinned or held module, the layout has no holes: that module follows
the last one served, and its record still names the position its rule set. The record of a module either
rule placed carries `explain.moduleRule: { position, rule }`, `rule` `pinned` or `off_limits` and
`position` counted from 1, and its receipt says the rule and the position in words.

**The layout blend.** A page's declared layout slot can opt into the behaviour-and-performance blend on
its learn dials, `slots.{slot}.blend: { p, shadowP }` in the learn document
([the learn document](./03-payload-schemas.md#the-learn-document)), with `p` from 0 to 1 and 0 when the
dial names none. Each module the slot could serve is then scored `R + (1 − p) × B + p × Q` instead of
`base × lift^γ`. `R = (M − i) / M` is the module's rank base over the slot's baseline of `M` modules,
with `i` counted from 0, so the first module's `R` is 1: the baseline is the configured order for the
shopper's context where one is served (its listed modules that are still eligible, in the order's
sequence), else the modules the slot could serve — after eligibility, the slot's exclusions and what the
page already served or reserved — in catalogue order. `B` is the module's behaviour score before the
learned term: the interests matched times the slot's weights, with the arrival's seeds, the region's
trend, the bonus for completing the request's anchor product and the journey-stage, freshness, fatigue
and merchandising terms wherever the slot sets them. `Q`
is its learned lift at the finest level with enough evidence — or the lift a merchandiser froze —
clamped to the learn document's `liftMin` and `liftMax` (0.5 and 2 by default), minus one; it is 0 where
no level answers, where a merchandiser rejected the lift, and on the holdout's `no_learning` arm. γ is
not applied on an opted-in slot. At `p` 0 an opted-in slot serves its configured order, else its
catalogue order, term for term, and every shopper term on its receipt is 0 — a promise that holds only
when the layout weights no shopper dimension and sets no stage, freshness, fatigue, merchandising or
complements term, because otherwise a module's behaviour score `B` is not 0 and moves it. Above 0, a module with no
behaviour score is moved by its learned performance, and a lift beyond the clamps moves it no further
than the clamped lift does. Under a configured order the blend ranks only the order's listed modules: an
unlisted module stays hidden, and a listed module that is not eligible at decision time is passed over,
never replaced, and not counted in `M`. The blend is never applied on the holdout's `default` arm, which
serves the site's own defaults; a pinned module keeps its position and its `pin` authority and is never
blended; on a decision on which the slot's exploration picks, the slot serves its own blended ranking over
its catalogue order with that pick, as it does without the blend. Content slots, and layout slots that do
not opt in, keep `base × lift^γ` exactly as before. A position the blend ranked carries
`explain.blend: { B, Q, R, p }` on its record (keys sorted, `R`, `B` and `Q` at three decimals) and
`blend` on its receipt, and its `score` is `R + (1 − p) × B + p × Q`; its `strategy` is `default` where
neither `B` nor `p × Q` moved it and `affinity` otherwise, its `explain.note` says that the blend ranked
it, and under a configured order it keeps `explain.configuredOrder` beside the blend. The dial's
`shadowP`, from 0 to 1 and 0.1 (10 percent) when the dial names none, is the p at which the slot's shadow
order is ranked (see **The baseline and the shadow** below); it changes nothing served, and publication
refuses a `shadowP` outside 0 to 1 with an error naming `shadowP`.

**The performance percentage.** The console's Dials screen reads and edits each slot's performance
percentage `P`, a number from 0 to 100 that is the tuning screen's form of a dial the learn document
already stores, never a second stored value: the learn document has no percentage member, and a save from
the screen is an ordinary `PUT /content/learn` ([the performance percentage](./03-payload-schemas.md#the-performance-percentage)).
On a slot outside the layout blend (every content slot, and a layout slot that does not opt in) the
percentage is the trust dial: saving `P` writes `slots.{slot}.gamma` = P / 100, so 35 percent saves γ
0.35, and the screen shows a stored γ as γ × 100. On a page's declared layout slot that opts into the
blend the percentage is the blend weight instead: saving `P` writes `slots.{slot}.blend.p` = P / 100,
keeps the blend's `shadowP` and leaves γ exactly as it was, and the screen shows a stored `blend.p` as
p × 100 (p 0.6 as 60). The quotient is read as decimals, so 33.3 percent saves 0.333. A percentage
outside 0 to 100, or text that is not a number, is refused on the screen before anything is sent, and the
save stays disabled until it is corrected. Saving a percentage sends the document exactly as it was read
with that one dial changed, and the decision reads γ and `p` as it always has: at 0 percent a slot decides
exactly as it does with its dial at 0, every slot's default, so 0 percent reproduces today's decisions
term for term, and a saved revision is in force without a deployment, within the documented read bound.
The console's Slots screen shows each slot's percentage beside its trust dial, read from the learn
document in force, and a dash where that document cannot be read.

**Adjacent swaps and position effects.** A page's declared layout slot can explore by swapping
neighbouring modules: its exploration dial in the learn document is
`slots.{slot}.exploration: { mode: 'adjacent-swap', share, floor }`, with the adjacent-swap `share` from 0 to 1
([adjacent swaps and position effects](./03-payload-schemas.md#adjacent-swaps-and-position-effects)), set in the console's Dials screen or
with `PUT /content/learn`, with no deployment. A decision whose exploration bucket (a hash of the shopper,
the slot and the hour, the bucket every exploration mode reads) falls under the share is served the slot's
ranked order with exactly one pair of adjacent positions swapped; outside the share, at a share of 0, and
where no pair is free, it is served exactly as without the mode. The pair is chosen from that same bucket among the adjacent pairs
neither of whose positions a pin (a prefix pin or a module pinned at a position) or an off-limits module
holds, a pair touching a module under a merchandiser's reject or freeze left out as well, so the same
shopper in the same hour is swapped the same pair and a pinned or off-limits module never moves. A
decision served the configured order for the shopper's context is served that order exactly and never
swapped: it carries no exploration member, and its layout reason is the order's (unchanged,
`blend_or_trust_zero`).
Like every exploration mode it belongs to the learning layer: it never applies on the holdout's `default`
or `no_learning` arm, nor below the signal floor. Each of the two swapped records carries
`explain.exploration: { bucket, mode, positions, reason }` (keys sorted, `mode` `adjacent-swap`,
`positions` the two positions counted from 1 within the slot) with `explored` true, its receipt says it was
swapped and between which positions, the layout reason names `exploration` for a swapped module that
moved, and a replay swaps the same pair, with no new replay marker. From the swaps the slot's statistics
estimate each position's effect as a click ratio, published as `positionEffects: [{ position, effect, pairs }]`
on the slot's snapshot (`GET /v1/{tenant}/lift?slot=`): position 1's effect is 1, and position k + 1's is
position k's times the clicks at k + 1 over the clicks at k, both counted on the decisions that swapped
(k, k + 1); `pairs` is the number of swapped decisions behind it, and an effect the swaps cannot reach yet
is null. The estimate counts the clicks credited to the slot, so a slot that learns another reward has no
estimate beyond position 1. The switch `slots.{slot}.positionNormalization` on the same slot's dials is off
by default (absent or `false`), and with it off every credit is exactly as before. With it `true`, the
credit of an engagement with the module served at a position is divided by that position's effect, in the
slot's live statistics and in the hourly recomputation alike (the folded hours, the open hour and the day
summed from them), under the position policy the slot's statistics published at or before the engagement,
whatever the learn document's dials say when the recomputation runs. Only an engagement with a module of a
page's declared layout slot (a record carrying the layout reason) is weighed, on both paths alike: a
decision made while the slot was not declared, or recorded before layout reasons existed, is credited as
counted, and so is any engagement in a day the report has to build from the raw ledger because no hour of
it was folded. The switch and the estimate take effect from the slot's
next statistics publication (within 30 seconds of new evidence, or at once on
`POST /v1/{tenant}/learn/publish`), and a position without a positive effect is credited as counted. Only
the amount of a credit changes, never whether it is counted. Turn the switch on only once the data science
has confirmed the position-effect estimate. Publication refuses the mode, and the switch, on a slot that is
not a page's declared layout slot, and a share outside 0 to 1, each naming the mode; a learn document
without the mode decides and replays exactly as before.

**The signal floor.** A tenant can keep a shopper on context-only decisions until the shopper has shown
enough behaviour of their own: `signalFloor` on the slots document is the tenant's floor N, a whole number
of 0 or more, and a slot's own `signalFloor` overrides it ([the signal floor](./03-payload-schemas.md#the-signal-floor)).
A signal is one action whose behaviour weight is above zero, read from the action's own weight in the
tenant's registry (`weights`): a product view, a wishlist or cart add, a purchase or a content click is a
signal, and a page view, a render acknowledgement (`content_impression`), a time-only re-evaluation and any
other action weighted 0 are not. The count is kept on the shopper's persisted state on either shopper host,
so a returning shopper's earlier visits count, and a browser linked to a person adds its count to the
person's. While the shopper's count is at most a slot's floor, the slot is decided on context alone: the
arrival's seed rules at their published weight (never dampened by the shopper's own interests), the
configured order for the shopper's context, the population prior at full weight (λ 1), the learned lift
from levels 0 to 2 of the ladder only (everyone, channel, channel and visit bucket), and the slot's pins,
exclusions, eligibility, freshness and merchandising; none of the shopper's interests, the journey-stage
rule, fatigue, ladder levels 3 to 5 or visitor-hashed exploration applies, and the slot's records claim no
journey stage. The response to the (N + 1)th signal is therefore the first personalized one. A floor of 0,
the default of every tenant that publishes none, holds nobody below it and decides exactly as before, and
no floor applies on the holdout's `default` arm, which personalizes nothing. A `signalFloor` of `never` on
the page's declared layout slot keeps that slot context-only for every shopper, so a page's layout can be
one answer per context while its content slots personalize. On a layout slot that opts into the layout
blend, a context-only decision's `B` holds the context terms alone (0 where none applies) and its `Q` comes
from ladder levels 0 to 2. Every record of a context-only slot carries `explain.signalFloor: { floor,
signals }` (keys sorted), and its receipt says that the shopper is below the signal floor, with the
shopper's count of signals and the floor in force.

**A context-only layout slot and its key.** A page's declared layout slot switched to context-only
(`contextOnly: { enabled: true }` on the slot, off by default; `region: true` admits the region;
[the context-only layout switch](./03-payload-schemas.md#the-context-only-layout-switch)) is decided for its
context: the page, the entry channel and visit bucket the cell records, the device class the request reports (none
when it reports none) and, where admitted, the region. On an arm that personalizes it is scored on its context's
population priors at full weight (the context prior, and the regional prior only where the region is admitted), the
seed rules on `entry_channel` and `device` alone, the per-context order for its context (one naming a device serves
only that device), the learned lift from ladder levels 0 to 2, exploration hashed on the context and the hour
instead of the visitor, and its pins, exclusions, freshness and merchandising, with every module's eligibility rule
read on the context alone; none of the shopper's interests, journey stage, fatigue, memberships, anchor preference
or other seed rules applies, so every shopper of one context is served the identical order within the hour, and the
slot's records claim no journey stage. The switch decides the slot: the signal floor never holds a switched slot.
On the holdout's `default` arm, and for a shopper without consent, the slot is the default variant. Every answer
for such a page carries the response header `X-Context-Key`, a non-identifying key built from the page, the channel,
the visit bucket, the device where one was read and the region where admitted (`pdp|c=paid_social|v=1|d=mobile`,
then `|k=` and a seal of 32 hexadecimal digits), or `pdp|default|k=…` for the default variant, with `|arm=no_learning`
added on the holdout's no-learning arm; it holds no visitor, session or decision identifier and no user agent, and
every shopper of one context gets the same key. It is a header, never a member of the answer, which stays
`Cache-Control: no-store`, and a new visitor's first request carries it too. A page drawn from a cache under that
key reports its exposures with the `layout_exposure` beacon (section 1), and a carousel the head script ordered
before paint reports its painted images with the `carousel_exposure` beacon (section 1).

**The context table and the head script.** A page with a declared layout slot has a context table, a
shopper-free document your server render inlines so the page paints the shopper's context before its first frame
([the integration guide](./01-integration-guide.md), section 7). `GET /v1/{tenant}/context-table/{page}` answers it
with `Cache-Control: public, max-age=60`; `GET /v1/{tenant}/context-table/{page}/{version}` answers the same bytes
with `Cache-Control: public, max-age=31536000, immutable` while that version is the one in force, and `404` once it
is not (a cache keeps what it holds until it expires: the stable address is the one to fetch). Both are `GET` reads
behind the site key like every `/v1` read on a customer deployment; they need no session, set no cookie and name no
shopper. A page without a declared layout slot, or one the slots document does not name, answers `404`. The table
is computed on read from the slots and learn documents in force, so a publication that changes one of its inputs
moves its `version` and one that leaves them as they were leaves it byte for byte; `version` is the SHA-256, in
hexadecimal, of the document's canonical JSON (keys sorted, no white space) without `version`. Its members:
`version`; `page`; `layoutSlot`, the declared layout slot; `carouselSlot`, the slot that carries
[shot orders](./03-payload-schemas.md#shot-orders), or `null`; `classifierVersion`, the version of the arrival
classifier the head script must carry; `holdout`, the holdout's `share`, `arms` and `saltVersion` (counted as the
experiment counts it); `default`, the default row; `rows`, one per cell of the tenant's terms (each of the six
channel words, or each channel id of a published [context vocabulary](#the-context-vocabulary-contextvocabulary),
with each visit bucket of its cut), each with `layout`, the module order of the per-context order the decision
resolves for that cell, and `shotOrder`, the carousel's shot order resolved by the same rule, both per device as
`{ mobile, desktop }` and `null` where nothing matches (the page keeps its server order); and `brandRules`, the
carousel's `minimum` and `pinnedTag` as published. A tenant that publishes a context vocabulary also has
`channelVocabulary: { revision, channels, rules, visitBuckets }`, which the head script classifies by. The default
row is `null` throughout. The table carries shot types per context, never items. The head script, `edge-head.js`,
ships beside the SDK's bundles: in the SDK package, at `/sdk/edge-head.js` and, long-lived and immutable, at
`/sdk/{version}/edge-head.js`. Where the SDK has kept the shopper's own shot order (`opt_head.shots`, from the
answers and the pushes, under tracking and personalization), the head script ranks it first, ahead of the row's other
values, with or without a row: only under the row's own gate (personalization, the `personalized` class, the salt
unchanged), only when it names the visitor this browser carries (`opt_visitor_id`) and for 30 days from its
decision; the pin and the minimum apply after it, and a refusal drops it. It is built from the engine's own classifier by `node scripts/build-sdk.mjs`, and
`node scripts/build-sdk.mjs --check` fails on any byte of it that differs. Your server render inlines it verbatim, so
its content-security-policy source is `'sha256-…'` of exactly those bytes: the SHA-256 of the file, in base64, which
the build writes beside each copy as `edge-head.js.csp` (the whole source, `sha256-` and the digest). Build your
policy from that file at deploy time, never from a hash copied by hand: a new release changes it.

**The context prior.** A tenant can let the arrival's context shape a first decision through a population
prior per context, beside the regional prior: `contextPrior: { enabled, kBlend, minEvents }` in the learn
document turns it on with its own `kBlend` (its K) and `minEvents`, in the regional block's grammar
([the context prior](./03-payload-schemas.md#the-context-prior)). Scored events, on either shopper host, fan
into population shares per tenant, entry channel and visit bucket (`1`, `2-3`, `4+`) through the same
population-trend objects the regional prior uses, which hold no visitor or session identifier; an event whose
entry channel is unknown, or from a shopper who refused tracking, counts nothing there, and the hourly roll-up
(on demand, `POST /v1/{tenant}/trend/rollup`) sums each channel's visit buckets into the channel alone. Only
the six channel words (`direct`, `paid_social`, `paid_search`, `email`, `organic`, `referral`) and today's
three visit buckets (`1`, `2-3`, `4+`) have a context population. On a tenant that publishes a context
vocabulary, an event counts under the channel its visit records, read by that vocabulary's rules, so an
arrival the vocabulary leaves unknown counts nowhere, the `direct` population holds direct arrivals alone,
and a channel of the vocabulary outside the six words (such as `sms`, `affiliate`, `paid_search_brand` or
`paid_search_nonbrand`) has no population and gets no context prior. A bucket of a published cut
(`visitBuckets`) outside the three, such as `3-5`, has no population of its own: the visit's events count in
today's bucket for its visit number, and a decision in that bucket reads the shares of the channel alone.
A decision reads the shares of the shopper's entry channel and visit bucket when that pair has at least
`minEvents` events, else the shares of the channel alone over every visit bucket, never everyone's, so the
regional prior's population is not counted twice. Its weight is λ = kBlend / (kBlend + Σ personal affinity),
so a first-time visitor's λ is 1 and it fades as the shopper's own interests grow; with the regional prior also
on, the shopper's interests keep (1 − λ of the region) × (1 − λ of the context) of their weight and each prior
adds its own λ × share, so neither erases the other. It is off when the block is absent or `enabled` is false,
so a learn document without it decides exactly as before, and it never applies on the holdout's `default` arm,
without personalization consent, or for a shopper whose entry channel is unknown; a population snapshot that
cannot be read is no prior. Below the signal floor it is a context term at full weight beside the regional
prior's; a configured order is served exactly; on a layout slot that opts into the layout blend it is part of
the behaviour term `B`. Every record of a decision under it carries `inputs.context_share`, the shares it used
(keys sorted), and every position it contributed to carries `explain.contextPrior: { channel, contribution,
events, lambda, level, version, visitBucket }` (keys sorted, `level` `channel_visit` or `channel`), compared by
value in replay; a record without the shares was decided without the prior and replays as before, and no new
replay marker is written.

**The layout reason.** Every decision on a page's declared layout slot says whether the served order
changed against the slot's baseline, and why. The baseline is the merchandiser's fixed positions — prefix
pins, modules pinned at a position and off-limits modules held at their place — where their rules put them,
and on every other position the configured order for the shopper's context where one matches, else the
modules the slot can serve (after eligibility, its exclusions and what the page already served or
reserved, and before a module is withheld for nothing to show or by its eligibility rule) in catalogue
order. The reason, `layoutReason`, is either `{ cause, slot, status: "unchanged" }`
with exactly one cause or `{ moves, slot, status: "changed" }` (with `withheld` when a module was withheld), keys sorted, and it is the same value on the
decision set, on every record of the slot (`explain.layoutReason`, compared by value in replay) and on
every receipt of the slot (`layoutReason`), whose last sentence says it in words. An unchanged layout names
the first of these causes that holds, in this order: `pinned` (pins, with any off-limits modules, hold
every position of the take), `off_limits` (the slot is off-limits, or off-limits modules hold every
position), `holdout_or_consent` (the holdout's `default` arm, which is also the arm of a shopper without
personalization consent and of a shopper whose stored record is unreadable), `below_signal_floor`
(the slot was decided on context alone), `blend_or_trust_zero`
(the learned term is held at zero: the layout blend's `p` at 0 on a slot that opts in, a configured order
served exactly on a slot that does not, or the trust dial γ at 0), `no_level_reached_nmin` (no level of
the learned ladder reached nMin for any module the slot ranked; the reason then carries `n`, the most
evidence any of them holds at any level of the shopper's cell, and `nMin`, the evidence a level needs),
`zero_base` (no module the slot ranked had a base score above 0), `catalogue_order_ties` (a served
module's score tied another module's, so catalogue order broke the tie) and `nothing_else_eligible` (the
slot could rank at most one module, or its ranking placed every module exactly where the baseline does).
Later releases may add causes, so read a cause this reference does not name as one it does not describe
yet. A changed layout's `moves` lists each module served at a position other than its baseline position
as `{ from, module, term, to }` (keys sorted, positions counted from 1 within the slot, a module the
baseline places past the take keeping its place in that order so that `from` can exceed the take, and
`from` null for a module the baseline does not hold), and its `term` names what moved it: `affinity`
(the shopper's own interests), `seed`, `regional_prior`, `context_prior`, `completes`, `external`, `stage`, `freshness`,
`fatigue`, `merchandising`, `lift`, `blend` (the layout blend's learned term `p × Q`), `exploration` or
`diversity`. A module that exploration itself placed names `exploration`, and one the diversity rule
itself made yield, or placed by relaxing it, names `diversity`. Any other moved module names the term
that changed its place: the term by which it differs most from the modules it passed, if it moved up, or from the modules that
passed it, if it moved down, those modules taken together, so each term's difference is averaged over all
of them and the term with the largest difference in the direction the module moved is named, an exact tie
going to the earlier term in the engine's fixed order (`affinity`, `regional_prior`, `context_prior`,
`completes`, `seed`, `external`, `stage`, `freshness`, `fatigue`, `merchandising`, `lift`, `blend`). The
modules compared are the slot's ranked modules other than a fixed position, a module that exploration
or the diversity rule placed or displaced being compared like any other, and for a module moved up they
include every module the baseline placed ahead of it that is not served. Only where no term separates it
from them by more than 0.0005, or there is none to compare, does a rule name it: `exploration` or
`diversity` when one of them was placed or displaced by that rule, else the term that contributed most to
its own score in the direction it moved, else the term of the first module that passed it or that it
passed. A changed layout from which a module the baseline would have served on one of its positions was
withheld before ranking names each such module, in baseline order, as
`withheld: [{ cause, module }]` (keys sorted): `cause` is `nothing_to_show` when the page reported it has
nothing to show for this page view and `eligibility_rule` when its eligibility rule is not satisfied by the
decision's cell; its `moves` then compare the served order with the baseline less the withheld modules,
so a module that only took a withheld module's place is not called moved, and the receipt names each
withheld module with its own cause before the moves. That baseline is drawn before the withholding: an
off-limits module is held at its place whether or not it was withheld, so a withheld off-limits module the
mark would have held on one of the positions is named (and the decision states the module-rules marker
`inputs.replay.moduleRules`, which the replay reads), and a pin of another slot refused only because its
module was withheld still reserves that module, so a layout that served what it would have served without
the report is unchanged. On a declared
layout slot a receipt says "No interest signal yet for this shopper" only when the interest vector the page
was scored on holds no interest at all; a shopper whose interests reached none of a module's weighted tags
reads "No interest on the dimensions this layout weights matched this module" instead, and a receipt of
any other slot reads as before. An off-limits declared layout slot writes one record naming the
`off_limits` cause to the ledger, and so to the export, never to the shopper's decision ring: it carries no
exposure, no receipt reads it and no outcome is credited to it. That record holds position 0 with
`item_id` `"(off-limits)"`, no candidates, authority `default`, `measurementBasis` `served-v1`, the
decision's own arm and cell, and the same `explain.layoutReason`; it is written only under the shopper's
tracking consent and for a layout slot measured on `rendered-v1`, so every report and learning fold sets
it aside as a row recorded under another basis than its slot's, and its replay decides the page again. A
layout slot that a refused pin refuses whole writes no record and has no reason. Where a population prior
applied and the layout slot ranked above the signal floor, every record of the page carries
`inputs.prior_lambda: { context?, regional? }`, each prior's weight λ, so the reason's `regional_prior`
and `context_prior` terms replay exactly; a record written before the reason replays without it.

**The baseline and the shadow.** Every record of a page's declared layout slot decided on an arm that
personalizes carries, beside what was served, `explain.baselineOrder`, `explain.shadowOrder` and
`explain.shadowTerms`, the same value on every record of the slot, each order a list of module ids cut at
the slot's take. `baselineOrder` is the slot's baseline as the layout reason defines it: the
merchandiser's fixed positions where their rules put them and, on every other position, the configured
order for the shopper's context where one matches, else the modules the slot can serve in catalogue order,
drawn before a module is withheld, so a withheld module keeps its place in it. `shadowOrder` is the order
the engine would have served with every term applied and the learned term at full trust, γ 1, whatever γ
serves the page, a merchandiser's frozen lift applied through γ like a learned one: the slot ranked as its
served order is ranked, its pins and off-limits modules where their rules put them, its withheld modules
absent and a configured order the slot does not blend served as it is, with no exploration pick and no
adjacent swap. On a slot that opts into the layout blend the shadow order is ranked by
`R + (1 − p) × B + p × Q` at the dial's `shadowP` (0.1 when the dial names none), with `Q` from the learned
lift whatever the arm, while the served order is ranked at the served `p`. `shadowTerms` is
`{ module: [term] }`, keys sorted, for each module whose place in the shadow order differs from its place
in the baseline less any withheld module (as the layout reason's moves compare), a module of the baseline's
take that the shadow pushes out of its take included as one moved down past the take and a module outside
both takes left out, naming every term that would have moved it in the layout reason's words: each term by
which it differs, by more than 0.0005 in the direction it moved, from the modules it passed if it moved up
or from the modules that passed it if it moved down (for a module pushed out, the modules of the shadow's
take that passed it), those modules taken together so that each term's difference is averaged over them,
in the engine's fixed order; `diversity` for a module the diversity rule itself made yield or placed by relaxing
it; and where no term separates it, the rule that placed or displaced one of those modules, else its own
largest term in that direction, else the terms of the first module that passed it or that it passed. The
terms are `{}` when the shadow keeps every module at its baseline place. Recording the shadow changes
nothing served, counted or credited: the route's per-decision answer carries none of the three members,
and every exposure and credit is the served order's. The holdout's `default` arm, which reads neither the
shopper's interests nor the learned lift, records none, and neither does the record of an off-limits layout
slot. The three members are compared by value in replay, and a record written without them replays
without them, with no new replay marker.

**Nothing to show and the eligibility rule.** Only
the page knows when a module has nothing to show for this page view, so it says so on the decision
request: `nothingToShow`, a JSON array of module ids sent as one string field like `entry` (the SDK's
`hydrate` and `refresh` take it as `nothingToShow: string[]` beside `page`). A module named in
`nothingToShow` is withheld before ranking on every arm: it is not returned, not recorded and never
counted as an exposure on either measurement basis, and the slot fills its take from the remaining
ranked modules (under a configured order, the order's remaining listed modules, an unlisted module never
filling in). The report can only withhold, never add: an id naming a module that is already withheld,
excluded by the slot or not registered changes nothing. When a module's rule and the page's report would both withhold it, the rule is read
first, so the module is withheld by its rule (cause `eligibility_rule`) and the report withholds only a
module its rule admits. A module's own eligibility rule, `eligibleWhen`
on the catalogue piece, admits it by region (`regions`: region keys such as `US-NY`, or a country such as
`US`, which admits every region inside it), entry channel (`context.entry_channel`, among the six channel
words, or the tenant's own channel ids when it publishes a context vocabulary), visit bucket
(`context.visit_bucket`: `1`, `2-3` or `4+`, or the names of the tenant's own visit-bucket cut) and journey
stage (`context.journey_stage`: `exploring`, `considering` or `deciding`), every condition it names having to
hold. The engine evaluates the rule on the decision's cell as it derived it (the region the edge reports and
the visit's established entry channel, under the shopper's tracking consent, and the visit bucket and the
shopper's journey stage, for a shopper the engine personalizes), never on a value the page sends, so an arrival a later request asserts cannot
relabel the visit and a `ctx.` signal on the query string or in the body gates no module, with one exception: a content slot declared `scope: 'anchor'` serves only the pieces whose `featuredProductIds` name the request's `ctx.anchor` (and its `ctx.variant`). The rule fails closed: an
unknown value satisfies no rule, so a module whose rule names a channel, a region, a bucket or a stage
the cell holds as unknown is withheld, and a module without a rule is unaffected. A module withheld by its
rule or the report is ineligible for that decision exactly as an expired one is: a pin of it is refused
(`missing_or_ineligible`, and a refused pin refuses its whole slot), and an off-limits mark of it holds
nothing in what is served (the layout reason still names it, above). Publication refuses with `422`, naming
the rule's path and the offending word, a rule that names any other signal or a value outside its signal's
words. A rule's entry channel and visit bucket are checked against the tenant's context vocabulary and
visit-bucket cut in force (the learn document published in the same request, else the one in force; one
that cannot be read refuses with `503`) on every catalogue write path: the `PUT`, the dry run
`POST /content/catalog/validate`, a catalogue sent in `publicationChanges`, and
`POST /content/catalog/import` with its CSV form and the pull. So a tenant that publishes a context
vocabulary names its own channel ids (`sms`) and the names of its cut (`3-5`, `6+`) and is refused a bucket
its cut does not hold (`2-3` under the cut 1, 2, 3, 6), while a tenant without the settings names the six
channel words and `1`, `2-3`, `4+`, refused and admitted exactly as before. A retained catalogue
whose rule names another signal stays readable, and that rule admits nothing. Every record of the page
carries the report as the decision accepted it, `inputs.nothing_to_show` (each id once, sorted), when the
page sent one, and each rule's verdict on the cell, `inputs.eligibility_verdicts` (module to `true` or
`false`, keys sorted), for every live module of the page that carries a rule; the replay withholds the
recorded report again and evaluates each rule again on the recorded cell, so it is exact, and no new
replay marker is written (an off-limits mark naming a withheld module states the existing module-rules
marker, above). A catalogue without rules, and a request without the report, decide and
replay exactly as before.

**An unreadable record.** Her stored record can exist and still not be readable: the retained-data
authority it was born under is no longer the one in force (for example, you published the next
revision of your profile retention policy). `POST /v1/{tenant}/decisions/snapshot` then still
answers `200` with the site's default decision: every slot in your catalogue's own order, with no
affinity, journey stage or visit from that record. The answer carries `sources.record: "unreadable"`
(a member present only on such an answer) and `sources.consent.personalized: false`, and each
receipt's note says why. That tells it apart from a refusal, whose `experiment.reason` names her
choice (`personalization_consent`), and from an expired session, which is refused with `401` and
no decision at all. Her experimental assignment is unchanged, because it depends only on her
anchor and the published salt. The experience served is `default`. Nothing of the record is read,
projected or renewed, and the poll stays read-only, as it is for every shopper.

`pinDiagnostics` names the pins the slot governance refused for this page, so a dead pin is visible to the caller instead of silently falling back to the site's own default. Each entry is `{slot, pinnedPieceId, pinIndex?, reason, ownerSlot?}`: `pinIndex` is the refused position inside the slot's `pinnedPieceIds` prefix and is absent for a legacy scalar `pinnedPieceId`; `reason` is one of `invalid_take`, `missing_or_ineligible`, `slot_type`, `duplicate_pin`, `off_limits`, `excluded`, `excluded_tag`, `type_not_allowed`, or `module_not_returned` (below); `ownerSlot` names the slot that already holds the piece, on any refusal reason and not only `duplicate_pin` — the engine attaches it whenever another slot already owns the piece, whichever gate then decided the refusal. A refused required pin refuses its whole slot — no shifted position, no ranked replacement — so the slot carries no decision and no ledger row, and this member is the only place the answer names the refusal. The member is absent when nothing was refused and no pin was left reserved by an undecided inner slot; it reports configuration, never shopper state, and it changes no ranking, eligibility or stored record. A refused pin at a position (`positionPins`, on a declared layout slot) carries `position`, the position it was pinned at, counted from 1, in place of `pinIndex`, which stays on prefix pins alone. An entry with reason `module_not_returned` refuses nothing: it names a pin of an inner content slot whose module the declared layout slot did not return on this page view, which stayed reserved page-wide so its piece is served nowhere on that page view, and it alone carries `within: { module, slot }`, keys sorted, naming the module and the layout slot; such entries follow the refusals and are counted in `refusedCount` as every entry is ([inner content slots](#inner-content-slots-inner)).

The member is BOUNDED, because the number of pins on a page is operator-authored: the array carries at most the first 50 entries in page and slot order, and `refusedCount` and `omittedCount` sit beside it — the same count/omitted-count pattern the advisory pin channel (`slot-pin-diagnostics/v1`) already publishes for its own 50-entry sample. All three appear together, and only when there is an entry: a refusal, or a `module_not_returned` entry. `refusedCount` counts every entry on the page, so a document whose slots refuse thousands of pins is still served with the whole total named: the bound is applied before the answer's own size guard, and a published slot document can never turn a served snapshot into a 503.

The snapshot answer is the shopper's surface and names one page load. What a tenant's slots refused over time is an operator fact, and the operator surfaces carry it. `GET /v1/{tenant}/learn/slots?evidence=1` adds `governance` to every slot entry, under the same flag as `evidence`: `{status, since, scope, refusedPinCount, refusedPins: [{pinnedPieceId, reason, count}], shortTakeCount, shortTakePositions, unreturnedPinCount, unreturnedPins: [{count, pinnedPieceId, within: {module, slot}}]}`. Every entry carries it, the entries past the 200-slot budget included: that budget bounds the per-slot `evidence` reads, while the block comes from one read of one counter document. `status` says whether that read was made: `available` beside the counts it answered, or `unavailable` when the counter store could not be read, and then every block says so with `since`, every count, `refusedPins` and `unreturnedPins` all `null` — an outage is named, never reported as a zero nobody observed. The counts are distinct occurrences since `since` — a second identical page view counts again — on both hosts and both arms, in the runtime refusal vocabulary above; `since` is the horizon those counts start at, 30 days, after which they restart, and it is never later than the page load that produced them. A slot that refused nothing and filled every position reports zeros, never an omitted block. `scope` is the scope the counts are kept at and always reads `"tenant"`: there is one counter document per tenant, counted across all of the tenant's brands, while the `evidence` beside it is kept per brand — so both brands of a tenant read the same counts on the row beside their own brand's learning evidence, and no other tenant's refusals are ever among them. `refusedPins` is a bounded sample of the distinct pins named per slot; the counts beside it stay whole, so a pathological document loses detail, never a count. A `module_not_returned` entry (above) refuses nothing, so the block counts it apart from refusals, as `unreturnedPinCount`, and never in `refusedPinCount` or `refusedPins`: `unreturnedPinCount` is the occurrences since `since` of a pin of the slot left reserved and unserved because the layout slot did not return its module, counted per page view as a refusal is, and `unreturnedPins` names the distinct such pins, bounded as `refusedPins` is, each `{count, pinnedPieceId, within: {module, slot}}`, keys sorted, `within` naming the module that was not returned and the layout slot. A slot with none reads `unreturnedPinCount: 0` and `unreturnedPins: []`, and a page view whose pins are only refused counts exactly as before. The console's Slots screen shows such a pin in its own words, never as a refusal: a line "<n> pin(s) reserved, unserved: the module was not returned", then one line per named pin giving its piece, how often, the module and the layout slot ("<piece>: 1 time, reserved, unserved: <module> was not returned by <layout slot>"), while a block with none renders as before. Past the pins it names, the Slots screen says how many more unreturned pins it does not name, as it does for refusals: right after the last named pin, one line "<n> more pin(s) reserved, unserved, not named", where <n> is `unreturnedPinCount` minus the sum of the named pins' counts, drawn only when that difference is above zero, so a block whose named pins account for every occurrence renders as before. The counter document counts at most 200 distinct slots per tenant within one horizon: an occurrence on a further slot is not counted, and that slot reads zero until the horizon restarts. `POST`/`GET /v1/{tenant}/monitor` answers the same two counts summed over the tenant's slots, as `governance: {since, scope, refusedPinCount, shortTakeCount}`, from the same counters — never from the monitor's own synthetic probe, whose compose of the tenant's page is excluded where the counters are written. The monitor's `refusedPinCount` counts refusals only, and its `governance` carries `unreturnedPinCount` after those members, the tenant's total of pins left reserved and unserved because their module was not returned, once the tenant's counter document has counted one within its horizon; a tenant whose pages only refuse answers the four members as before. Two things guarantee that exclusion and both are part of this contract: the probe composes unsigned with tracking refused and declares `selfCheck` — no shopper granted it anything, its own cookie header withholds tracking consent, and the counters are skipped for any compose that declares the flag — so either guarantor alone already keeps the probe out of a tenant's counts, and neither can be removed without contradicting this reference. `shortTakeCount` counts the times a pinned slot served what it could and still fell short of its `take`, and `shortTakePositions` the positions left empty across them; a slot whose pin was refused serves nothing at all and is counted as a refusal instead. These counters hold slot names, the merchandiser's own pinned piece ids, refusal reasons and counts — configuration, never shopper state. They are written fire and forget after the answer is decided, are never read on a decision path, are skipped entirely when the shopper withheld tracking consent, and are a best-effort diagnostic rather than an accounting ledger: concurrent page loads may collapse to one increment; the counts are a floor, never an overcount, and nothing outside them depends on their value.

`POST`/`GET /v1/{tenant}/monitor` also answers two members of its own about the tenant's evidence, both
read on the scheduled run and never on a decision path.

`evidenceLoss` is `{ since, producerFailed, consumerSkipped, fanOutRejected, retriesExhausted }`: the
four ways a row of evidence is lost, in one vocabulary — the producer could not hand it to the queue (with durable recovery on, an outcome whose learning preparation failed before its durable admission: [the action answer](#post-realtimeaction)),
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
threshold, conflicts? } ] }`: the scheduled comparison of the two stores that hold the same credits by two
different roads — each slot's statistics object, which counted them online as they happened, and the
day report, which counted them from the ledger. It reads the NEWEST day this tenant has published,
and only that day; `since` is that day's start and `compared` is how many (brand, slot) pairs the run
really compared, so a clean result is never an empty one. `online` is the slot's credited mass at its
own decay, rounded; `ledger` is the credits the published day counted for that slot's personalized
arm. A pair is named only when `difference` exceeds `threshold`, a stated relative tolerance of five
per cent of the larger of the two: zero at unit scale, which is where one lost or doubled credit
shows, and wide enough at volume to absorb the two stores reading their own clocks. A row also
carries `conflicts: { decisions, outcomes }` when its `online` exceeds its `ledger` and the brand's
published day excluded rows under the collision contract below; the member is that day's
`counts.conflicts`, copied. It proves only that a collision is on record for the brand's day, and the
outcome collision is one known cause of `online` exceeding `ledger`. It is the brand's count for the
whole day, not this slot's: it cannot say which slot the excluded rows touched, and it cannot tell the
collision from a credit the ledger lost on the same brand and day, so it rides every such row of the
brand, including a row whose whole difference is a lost credit. It is never a reason to dismiss a
difference: the collision accounts only for the credits of the rows the ledger-recovery surface lists
as filed conflicts, and no other part of the difference is explained by it. A row without `conflicts`
names no collision. `reconciliation` is absent on a legacy record and on a run that could not read one
of the two sinks.

`POST`/`GET /v1/{tenant}/monitor` also answers `stoppedSlots`: `{ priorVersion, total, slots: [ { brand,
slot, scope, reason, objective, priorRows } ] }`, the slots whose statistics publication the tenant's own
prior document stops (the paragraph on imported priors below says when that happens). It is derived on
every run, never stamped: the rule by which a statistics object refuses to publish — a probability prior
row for a slot whose objective is `revenue` or `margin` — is applied to the tenant's published learn and
prior documents, read from one publication pin, and no statistics object is asked. `reason` is always
`prior_unit_incompatible`, `objective` is the unit the slot learns in and `priorRows` is how many rows of
the prior document name it. `brand` is the tenant's own brand and `scope` always reads `"tenant"`: the
documents are the tenant's, so a slot they stop is stopped in every brand of the tenant that serves it.
`priorVersion` is the revision of the prior document the run read, `0` when the tenant publishes none;
`total` counts every stopped slot and `slots` lists at most the first 64 in slot order, so a tenant with
no stopped slot reads `total: 0` and an empty list. The member is absent on a record written before it
existed and on a run that could not read the two documents, so no result states a clean slate it did not
observe. Like `reconciliation`, it rides the run and the kept result an operator reads back; it does not
by itself fail a check or send an alert. A slot leaves the list once its prior document is re-exported
without the offending rows and imported again.

`POST`/`GET /v1/{tenant}/monitor` also answers `learningReads`: `{ since, scope, lift: { served, none,
incompatible, late, superseded, unrecognized, unhealthy, failed }, ring: { read, late, failed, skipped } }`,
how the tenant's own decisions' reads of what the platform learned ended since `since`: one count in `lift`
per learning slot a decision read, one in `ring` per decision, in the vocabulary each answer's
`sources.lift` and `sources.ring` name them in (the snapshot answer above). Every outcome is present and
zero reads as zero. A decision is counted exactly when the slot-governance counters would count it: under
the shopper's tracking consent, outside the platform's synthetic operations and never for the monitor's own
compose, so the monitor's probe decisions are never among the counts and a shopper who withheld tracking is
never counted. `scope` always reads `"tenant"`: one counter document per tenant, across all of its brands.
`since` is the horizon the counts start at (30 days, after which they restart). The counts are written after
each counted decision is answered, never before: for a shopper's decision, once the shopper's own object
has answered and outside it, so neither the answer nor the shopper's next request waits on them. They are never read on a decision
path, and a write that fails changes nothing served; they are a floor, never an overcount: concurrent decisions may collapse
into one increment. The member is absent on a record
written before it existed and on a run whose counter store could not be read, so no result states a zero it
did not observe; a kept result answers it rebuilt member by member, and one whose kept `since` or counts are
not non-negative whole numbers answers without it.

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
read. Two genuinely DIFFERENT rows under one logical id are never merged, and this collision
contract is the same on every surface. Online, the statistics credit EACH of two different records
under one stable `outcome_id`: the credited journal tells records apart by the id and a digest of the
whole record, so only the same record redelivered is credited once, and a delivery whose digest cannot
be computed is recognised by its id alone — it can lose a credit it cannot tell apart, never grant one
twice. On the ledger, the read refuses the day of the brand the collision touches, and only that
brand's day — another brand of the same tenant is still answered — with
`{ ok: false, code: "report_row_conflict", conflict: { stream, id } }` (HTTP 409), files the
conflicting row for recovery in the tenant's own scope where the ledger-recovery surface lists it, and
reads the day again on the next call with that row excluded and counted as `counts.conflicts`, in the
same `{ decisions, outcomes }` vocabulary as `counts.duplicates`. Where the online statistics credited
both records, the two stores therefore disagree by design on that brand and slot: once the difference
exceeds its threshold, the scheduled `reconciliation` on `/v1/{tenant}/monitor` shows the pair as a
disagreement, `online` above `ledger`, carrying `conflicts`. The credits of the filed records are the
designed outcome, not a lost credit; `conflicts` does not show that they are the whole difference, and
it rides the brand's other rows as well (see `reconciliation` above).

A position a configured per-context order set carries `configuredOrder: { context, modules }` on its receipt, exactly as the record carries it, and its `why` says in words that the configured order placed it, for which context and at which place in the order; a pinned position under an order keeps its pin sentence and carries none. A slot that served its configured order is not reported as a short take: the order says how many positions it fills.

A position the context prior contributed to says so on its receipt in words, with the shopper's entry channel and visit: the receipt line reads "Population prior, paid social, first visit: what visitors arriving this way engage with contributed 1.5 (the prior's share of the score: 1)." where the channel and visit bucket answered, and names the channel and every visit, claiming no visit of its own, where the channel alone answered.

A position of a slot decided below the signal floor carries `signalFloor: { floor, signals }` on its receipt, exactly as the record carries it, and its `why` says, before any term, that the shopper is below the signal floor, with the shopper's count of signals and the floor in force, and that no term that reads the individual shopper applied.

A position of a slot declared `scope: 'anchor'` carries `scope: { anchor, variant? }` on its receipt, exactly as the record's `explain.scope` carries it, and one `why` sentence names the anchor product its candidates were limited to. A position decided while a suppression was in force on the shopper carries `suppressions: [{ action, dimension, expiresAt, value }]` on its receipt, exactly as the record's `explain.suppressions` carries it (keys sorted, `expiresAt` in epoch milliseconds, sorted by dimension then value), and one `why` sentence names each value, the action that recorded it and the date it lapses (UTC): "Suppressed for this shopper, so the shopper's own interest in it was not scored: productType tote by remove_from_cart until 2026-11-11." The decision replays equal; a record without a suppression replays as before ([negative preference](#negative-preference-suppression-with-an-expiry)).

A position the layout blend ranked carries `blend: { B, Q, R, p }` on its receipt, exactly as the record carries it, and its `why` reads out each term — where the rank base `R` came from (under a configured order, the module's place among the modules the merchandiser ordered, counted over the whole order, which the receipt's `configuredOrder` still carries), what the shopper's behaviour contributed to `B`, the learned lift behind `Q` — and the sum at `p`; it never says that the ranking did not place the position.

Where a pinned slot fell short and still served something, it also wrote records, so the shortfall is on the receipt as well: `explain.shortTake = {take, served, empty, sentence}` rides every record that slot wrote, pinned position or ranked, and `GET /v1/{tenant}/visitors/{visitorId}/receipts` reads its sentence onto `why` exactly as it reads out stage, freshness, fatigue, merchandising and diversity. A refused slot writes no record, so it has no receipt and the counters above are its only home.

With explicit `rendered-v1` slot measurement and approved original retention/recovery, actual rendering sends a signed `content_impression` with original `eventId` and `timestamp`, and data `page, pageInstance, position, contentId, slot, decisionId, renderOffer`, plus `slotPosition` from the SDK. The separate exact response is `render:{version:1,decisionId,eventId,pageInstance,status:'durable',source:'pending'|'recovered'}`. It answers at durable admission: once the render's source admission and the behaviour capture of the same request are committed and the shopper object's recovery alarm is armed, the first answer is `status:'durable'` with `source:'pending'`, and the same request's `behavior.receipt.source.state` is `'pending'` too (`src/ledger/recovery.ts:211-213`, `src/content/renderOffer.ts:120`, `src/routes/realtime.ts:312`). The queue send, the ledger write and the learning fan-out of both then follow right after the answer, in order, inside the shopper's own serializer, ahead of any later request from the same shopper, so a click sent right after the acknowledgement is attributed to its decision (`src/ledger/recovery.ts:259-268`, `src/identity/sessionAuthority.ts:878-885`); were they to fail, the alarm armed at admission resumes them at most 30 seconds later (`src/ledger/recovery.ts:143-146`, `src/durable-objects/ShopperReflex.ts:1983`). A later re-send of the same original envelope, once they ran, answers `source:'recovered'` with every other member the same, and leaves one ledger row and one counted exposure. That holds whatever the engine's clock did to the first delivery: the same `eventId` and `pageInstance` for the same decision is the same render, admitted at the time its first delivery was admitted at (a client time ahead of the engine is admitted at the engine's present, `src/routes/realtime.ts:186-187`), read from the decision's stored admission in the shopper's own object, so the re-send's receipt, its `behavior.recordId` and its one ledger row are the first delivery's (`src/ledger/recovery.ts:486-492`, `src/content/renderOffer.ts:114-119`, `src/routes/realtime.ts:250-253`). An acknowledgement whose `timestamp` is earlier than the decision's own engine time (the time its `decisionId` carries), as a device whose clock runs behind the engine's sends it, is never refused for that: its first delivery is admitted at the decision's time, which is then its `rendered.at`, the time of its behaviour record and the time a re-send keeps; this is the lower bound that matches the engine's present above (`redeemRenderOffer` in `src/content/renderOffer.ts`), so the impression is kept and counted. A click or dwell sent by a device whose clock lags the engine's by more than the time from the decision to that engagement still earns no credit: the engagement's own time is bounded only from above (a time after the engine's present is admitted at the present, an earlier one as given), and the learning policy credits an engagement to an exposure only when the engagement's time is at or after the exposure's (`rendered.at`), so such an engagement falls before its own exposure; this residual is on the amendment list. An acknowledgement that names an already-acknowledged decision under another `eventId` is a conflict: it answers HTTP 409 `{ok:false, error:'Render acknowledgement conflict: this decision was already acknowledged with another event id'}`, and nothing of it is admitted, captured or counted (`src/content/renderOffer.ts:115`, `src/identity/sessionAuthority.ts:385-387`, `:766-769`, `src/durable-objects/ShopperReflex.ts:575`). An admission that fails still fails the acknowledgement, with no `render`: the answer is the route's own `500 {error:'Failed to process action event', details}`, which the owner does not replace with another error once the route has answered (`src/routes/realtime.ts:567-570`, `src/identity/sessionAuthority.ts:581-599`). An update/HTTP success alone is not this ACK; pending source admission does not certify every sink. The SDK waits `ACK_DEADLINE_MS` (5 s) for this answer and cuts the request there (`src/sdk/core.ts:21`, `:958`); an acknowledgement it cut, it sends once more by itself at once, the same original envelope byte for byte (the same `eventId`, time, offer and page instance), which the engine answers as the same render (above), and it never sends a third request by itself; an acknowledgement answered within the deadline, whatever its status (`pending`, `recovered`, the 409 conflict or an error), is not re-sent (`src/sdk/core.ts:984-995`). A later `rendered()` for a placement still unacknowledged sends that same envelope again, at most three such attempts per placement, each with the same one retry after a cut (`src/sdk/listen.ts:581`, `:589-591`). An integration that retries by itself retries the same original envelope, not a new ID/time. The sealed offer is bounded by original grant/consent/ledger/online expiry and current publication; it is never a persistent profile token. Correlated clicks, the dwell and the viewable impression follow that exact ACK, the retry's included: a retry answered `pending` or `recovered` arms the placement as a first answer does, and a placement whose retry is cut too sends none of them (`src/sdk/listen.ts:594`, `:601-602`, `:261`, `:635`). Admission holds the acknowledgement to the record's position within its slot: to `slotPosition` when the acknowledgement carries it (its `position` is then the page-wide order, accepted beside it), and to `position` when it does not, exactly as before. See [the rendered integration](./01-integration-guide.md#3-the-ten-lines-that-personalize-a-page).

The ledger producer sends JSON object envelopes with additive `version:1`, retaining complete records in independently readable chunks compatible with the existing consumer. Each body is at most120000 UTF-8 bytes; a batch contains at most100 messages and240000 body bytes, reserving platform headroom. An oversized individual record or serialization failure refuses the whole invocation before queue submission; nothing is trimmed. The internal helper receipt counts records and finalized messages as queue-acknowledged, acceptance-unknown, or not attempted. Failed preflight has `prepared:false`, zero planned messages and all records not attempted. A rejected queue group stops delivery: earlier acknowledgements remain, that group's acceptance is unknown, and the tail is not attempted. Missing queue capability is not attempted. One fixed-code/count-only failure diagnostic is emitted even when callers ignore the receipt; Optional behavioral Analytics points remain held closed until a separate destination policy is supported and admitted; this does not block configured canonical ledger delivery. Queue acceptance is not R2 persistence, client delivery, retry, recovery or completeness assurance. The durable recovery protocol below is distinct from queue acceptance; deployed performance remains separate proof.

With exact `LEDGER_RECOVERY_ENABLED=true`, the current content-decision and outcome callers durably admit one immutable operation under the original subject owner before ledger or learning effects. It freezes logical IDs, delivery UUIDs, complete records, configuration, attribution and original authority/retention; retries do not refresh grants, consent or lifetimes. Admission is bounded to64 retained operations and8MiB per payload; exceeding a limit refuses, never trims or evicts needed retry protection. Original queue/body limits remain; the canonical fallback retains the same managed identities. Queue acceptance is separate from canonical `newlyStored`, `alreadyPresent`, `suppressed`, `unknown` and `notAttempted` counts. Source recovery and destination effects are separate, not added as unique-event totals. An ambiguous write is not rollback. Readers, erasure and retained generation fences remain active independently of the producer flag.

Managed NDJSON preserves every original field and adds reserved `_ledger_delivery: {id, ordinal}` provenance. Reusing one delivery UUID with conflicting content/partition refuses; distinct delivery UUIDs are not collapsed merely because logical IDs match. Metadata-only identity commitments and immutable destination claims live under `ledger-delivery/identities/` and `ledger-delivery/claims/`, outside canonical tenant/date scans; they are not a raw-data outbox or an approved retention lifecycle. New deliveries retain grouped tenant/hour/stream objects, bounded by100 delivery parts and16MiB. Conditional append retries at most three precondition conflicts, re-reading the object and current rewrite/tombstone barriers each time; thrown storage errors are terminal. Managed erasure preserves metadata and uses conditional replacement, including an empty body instead of deleting an emptied managed object. A conflicting body or precondition failure leaves its durable intent pending for recovery, without automatic rebase or guessed removal credit; exact after-state reconciliation handles a lost acknowledgement.

Capture and cutoff publication use the existing exact-subject owner order, including whole-envelope cohorts. A batch prepares its immutable grouped claims once before raw writes; preparation is not capture acknowledgement. Version-2 partition claims commit original ordinals and exact row hashes, allowing authenticated survivor replay without retaining erased rows or rebuilding a filtered original envelope. Temporary proof outages retain original identity/ordinal evidence; only matching existing claims can authorize replay. Version-1 claims remain immutable; unprovable subsets refuse. Rewrite journals retain exact intents and once-only counters. This is bounded local recovery, not a global store transaction or deployed completeness guarantee. Historical unreceipted work, approved policy values, physical provider lifecycle and live activation remain separate gates.

The consumer validates each complete ledger envelope before grouped persistence; an invalid row rejects its whole envelope without blocking valid siblings. Unversioned and `version:1` legacy messages without a delivery ID remain supported. Other explicit versions, malformed/empty sets, invalid explicit delivery IDs and caller-supplied reserved provenance are rejected, never partially filtered. Ordered per-envelope `ack`/`retry` dispositions control acknowledgement; missing or malformed proof retries. A managed delivery acknowledges only definite storage, prior presence or erasure suppression. Conflicting identities retry while healthy cohorts continue. Legacy partial writes remain a lower bound and may duplicate; unreceipted history is not automatically safe to replay. Unknown nonledger messages retry instead of being silently acknowledged.

The configured DLQ consumer acknowledges only durable bounded quarantine capture or an authorized recorded terminal disposition. Cases retain exact wire bytes and authenticated source/ownership metadata. Unknown-owner retention/disposal must be explicitly configured; absent policy prevents intake activation even when producers are disabled. Recognizable rows never outlive their original deadlines. Owner alarms strip all locally expired raw work before remote maintenance; frozen credit attribution and effects keep the earliest compatible selected-decision/outcome lifetime. Expiry, erasure and consent retirement retain bounded cross-object cleanup references until marker disposal is acknowledged. Quarantine scans isolate unreadable or invalid cases, continue valid cases, and retry unresolved proof on scan wrap; a subject erasure stays incomplete until an entire pass is resolved. Invalid evidence is not deletion authority. Learning counters are not erased by marker cleanup; hash-only retry barriers prevent retired work from reapplying.

`GET /operator/ledger-recovery?scope=tenant|unassigned&after=<opaque-case-id>` lists count-only cases; `GET /operator/ledger-recovery/{id}?scope=…` reads status. `POST /operator/ledger-recovery/{id}/redrive` accepts exactly `{scope,digest,revision}`; `/resolve` additionally requires `disposition: "irrecoverable"|"disposal_pending"`. No caller key/body/tenant override is accepted. Current human account-session authority and admitted/result audit are mandatory: tenant administrators only access proven tenant cases; current stamp owners handle unassigned cases. Stale digest/revision, expired authority or audit failure refuses; a result-audit failure can follow an effect and is not rollback. `recovered`, `suppressed_erased`, `expired_unrecovered`, `irrecoverable` and `disposal_pending` remain distinct; unknown loss counts stay unknown. Classifying loss does not authorize early payload deletion.

Ledger point lookup and replay reconcile every observed range candidate before returning a record or not-found. Exact full-payload decision and validated nonce-outcome retries coalesce; only valid top-level delivery metadata is excluded from comparison. Conflicting payloads, repeated nonce-free legacy outcomes, invalid product receipts, missing/malformed candidate inputs or broken pagination refuse with503 on enforced operator routes. Queries allow at most800 unique candidate objects,16MiB per object and in total, and1,000,000 listing/row/comparison work units; key/cursor strings are capped at2048 UTF-8 bytes and charged as listing work. Native bodies are read with bounded fatal-UTF-8 decoding; text-only adapters check actual bytes after materialization. These reads make no ledger writes and retain authorization, audit and erasure checks. They depend on truthful range names and the returned inventory, without snapshot isolation, detection of unlisted data, historical repair or end-to-end delivery/completeness assurance.

Online learning checks count-conserving application receipts through the ring-to-statistics cascade. Managed exposures carry decision/destination identity; credits also bind outcome identity. Effect markers and counters commit atomically, conflicting payloads refuse, and retained immutable attribution resumes only missing effects. Original event time (including zero), weights, configuration and whole/item reset generations are preserved. Receipts distinguish newly applied, already applied, suppressed, skipped and unknown effects; alarm acknowledgement does not prove publication. Legacy non-idempotent writes are not automatically retried. Downstream waits stay outside the ring read lock, but the actual subject owner drains pending private I/O. No receipt substitutes for deployed sink-count reconciliation or customer acceptance.

Each current online decision fan-out detaches its records and scope before asynchronous reads, validates supplied identity/provenance, and filters physical erased rows before reconciling surviving decision IDs. Exact full-wire-JSON copies coalesce before slot/arm grouping and destination caps; object key order is irrelevant, while nested fields and array order participate. Only valid top-level `_ledger_delivery` metadata is excluded. A surviving same-ID conflict refuses the entire call before configuration callbacks or either destination starts. Current decision `LearningReceipt` v1 adds `coalesced`, including zero: `received` counts physical inputs, `cutoffSkipped` physical erased rows, and `coalesced` surviving repeated copies after complete reconciliation. Ring/statistics receipts count only their actual inputs; coalescing does not mean delivery. Absence on older decision receipts is unknown, and the field is not applicable to outcomes. Admission allows1000 physical rows,16MiB combined serialized UTF-8 record payloads and1,000,000 row/comparison work units; duplicates consume these physical budgets. One row can materialize before its serialized-byte check. These are conservative application limits, not native-memory/CPU or SLO claims.

Online outcome fan-out and direct ring admission reject malformed supplied nonce/source, inconsistent nonce-bearing IDs/rewards and invalid reserved provenance before credit effects. Truly absent nonce fields retain legacy attribution. This change persists no identity metadata: separate fan-out or outcome calls still repeat statistics increments, and a retained ring collision can still coexist with independent statistics acceptance. Durable deduplication needs an approved privacy/retention/erasure contract for any linkable token and an accumulation/recovery transition. No historical repair, new exposure denominator, generation transition, global erasure fence or complete delivery guarantee is supplied.

Direct attribution now requires an exact, case-sensitive slot match when an outcome names a nonblank slot, for every reward including featured-product purchases. A named miss receives no credit in another slot. Missing/null/blank slots and the SDK's literal `unknown` retain broad legacy matching; `match:any` remains intentionally broad. The shared rule applies to online credits, hourly reconstruction and raw-record reports without changing scope, windows or first/last selection. A real slot named `unknown` remains ambiguous. The named-slot guard alone does not add correlated decision/page/brand/position identity, change global-item fatigue or served/rendered/viewable units, or provide SDK/dedup acceptance; see the optional exact decision selector in [the integration guide](01-integration-guide.md). Existing counters, snapshots and stored reports are not repaired; new recomputation can differ under the unchanged policy label.

An outcome carries the brand its action named (`data.brand`), and only the tenant's own brand when the
action named none, so a click and the exposure it answers land in one statistics object. A correlated
outcome whose brand disagrees with the brand of the decision it names is refused as before and is now
COUNTED: the outcome receipt carries `brandMismatched` beside `attributed`, so that refusal is no longer
indistinguishable from "nothing matched". The same count covers an outcome that names no `decisionId`:
`brandMismatched` also counts each placement of another brand of the tenant that such an outcome would
have been credited to under the learning policy — same session or visitor, same piece or featured
product, same named slot, inside the reward's window — in a slot its own brand credited nothing. A click
under the placement's own brand counts zero, and so does another brand's click on a piece no placement
served. The SDK sends `data.brand` on every action when the client is configured with a `brand`. The shopper's receipt (`GET
/v1/{tenant}/visitors/{visitorId}/receipts`) carries `brand` beside `page`, `slot` and `position`, the
brand the decision was served under and never the tenant id. A day report's `policies[]` rows carry
`legacyCredits` beside `credits`: how many of that policy's credits came from an outcome that named
neither a placement nor a decision, and were therefore spread by the legacy rule over every placement of
the item — still credited, and now visible as the guess it is. `legacyCredits` is absent on day reports
retained before it existed. None of this adds a new exposure unit, repairs a historical counter or
snapshot, or corrects any estimate for position or placement.

A shopper's receipt carries `lift_terms` wherever the decision recorded a learned lift — whether or not
the trust dial let it move the score — and never otherwise: `{ p0, p_hat, lift, n, n0, prior?,
prior_version, shown }`. `p0` is the slot's own rate in the shopper's cell — the baseline the lift is
measured against — `p_hat` is the item's shrunk estimate in that cell, and `lift` is the lift the decision
recorded: `p_hat / p0` clamped (1 where the slot has no rate to compare against), or the value a
merchandiser froze it at. All three are the exact numbers the decision recorded: internal rates are exact
down the whole ladder and are never rounded. `shown` is `{ p0, p_hat, lift }` as the strings the receipt prints
them as, and it is the only rounded member: three significant figures at every magnitude rather than three
decimals, so a rare baseline keeps its figures (`0.00199`, never `0.002`) and the printed terms do not
contradict the printed lift. `n`, `n0`, `prior` and `prior_version` are the observed exposures, the
shrinkage strength and the imported prior, described with the cold priors below.

The outcome receipt also carries `outsideWindow`: how many of the visitor's ring decisions the outcome
matched in every other way — same scope and, under the default `direct` match, the served item or a
product the piece features, served before it — and could not be credited to because more time had passed
than the reward's own attribution window allows (`policy.windowsMs` of the published learn document; by
default 30 minutes for a click, six hours for an add-to-bag, seven days for a purchase). It is a count,
not a flag: zero when nothing matched at all, because a miss by item or session is not a miss by time.
Eligibility follows that window and nothing else: no outcome is refused for its age, and a late delivery
of an outcome whose decision is still inside the window is credited exactly as an on-time one. For a
purchase under the default policy the window equals the ring's reach: the visitor's ring keeps a served
decision for seven days, the same seven days as the purchase window, and a decision older than that
leaves her ring the next time a decision is recorded for her. A purchase too late to count therefore
usually finds its decision already gone and reads as nothing matched (`outsideWindow: 0`), not as outside
the window; it is counted in `outsideWindow` only while her ring still holds that older decision.
`outsideWindow` is chiefly the measure of the shorter windows, and of a purchase window a tenant
publishes shorter than seven days.

The outcome receipt also names what REFUSED the outcome. Each slot the visitor's ring would have credited
decides for itself, under its own published `slots.{slot}.reward` and `slots.{slot}.objective`: a slot
that learns against another reward than the outcome's own takes nothing from it, and a slot whose
objective is `revenue` or `margin` takes nothing from an outcome it cannot weigh without a money policy
(next paragraph). `refusedBySlot` maps each slot that refused the outcome to the rule that refused it,
`reward` or `money`, and `refused` is the number of its entries; both are absent when no slot refused,
and the one never travels without the other. `attributed` counts only the credits of the slots that took
the outcome, so a refusal is never read as a credit, and under `match: any` a purchase that happened in a
click-learning slot still credits the purchase-learning slot the policy reaches while the click-learning
slot is named `reward`. `notCredited` says in one word why an outcome that NO slot took went uncredited —
`money` when any slot refused it for money, otherwise `reward` — and is absent whenever at least one slot
was credited. A slot refused for both its reward and money is named `money`, because the money decision
is made first, before the reward one. That name is the coarser of the two and never a missing credit:
publishing a money policy alone would still leave such a slot refusing the outcome for its reward. A reply
from the visitor's ring that carries `refused` without `refusedBySlot`, or a count that differs from the
map's entries, is refused as malformed — the learning receipt is not ok, its ring destination counts as
unknown and it carries no outcome receipt — so a partially deployed or faulty ring can never report a
refusal nobody named. The operator's `learning_incomplete` diagnostic line, written for a learning
receipt that is not complete, carries `refused` beside `attributed`, `eligible` and `weightSkipped`, and
`refusedBySlot` whenever the receipt carries one; with nothing refused the line stays wholly numeric.

Money is weighed only under a money policy the tenant publishes, and none can be published yet: which
currency a slot's counters are in, how another currency converts, and what a refund or any other value at
or below zero means for the objective are the customer's to decide, and the platform invents none of
them. Until a money policy is published, a slot whose objective is `revenue` or `margin` refuses, by the
name `money_policy_unset`, every outcome that declares a currency (any currency, since none is declared
for its counters) and every outcome whose value — for `margin`, whose margin — is zero or negative, such
as a refund. The outcome receipt names that slot `money` in `refusedBySlot` and carries `money` as
`{ code?, reason: "money_policy_unset" }`, where `code` is the currency the outcome declared. A purchase
the SDK reads from the page's data layer always carries a currency (`USD` when the data layer names
none), so in practice every revenue or margin slot refuses every such purchase today and learns nothing
from it until the policy is published: nothing is silently converted, added, dropped or subtracted. An
outcome with neither a currency nor a nonpositive amount is still weighed by its value or margin as
before. A `unit` slot is never asked: it counts the event whatever currency or value came with it.

A slot's learn dials may name the slot's own attribution policy, `slots.{slot}.attribution:
"module-tied"`, absent by default; absent, the slot is credited under the brand-wide `policy` exactly as
before, online and in the offline recomputation. Under `module-tied`, the only per-slot policy, an add to
bag or purchase credits a decision of the slot once, and only when it originated inside the module: it
carries the module's `decisionId`, or the module's identifier as `contentId`; a buy-box conversion, which
names no module, credits no decision of a module-tied slot, while every other slot on the page is
credited under its own policy. The scope, the credit rule and the reward's window stay the brand-wide
policy's, and the slot's own `reward` still decides which outcomes it learns from. The outcome receipt the
visitor's ring derives when it credits the outcome is the attribution record that itemises how it was
credited: `attribution: [{ slot, policy, credited }]`, one entry per slot whose dials name their own
policy, sorted by slot, with `credited` the decision identifiers it credited, or `[]` when it credited
none, the same decisions as its credit effects. It is written for every outcome, one that credits nothing
included, and is absent when no slot names a policy of its own; the stored outcome record is the admitted
source and is never changed to carry it. The receipt is kept with the ring's credit plan and returned on
the ring's answer to the learning fan-out; no public route answers it. Publication — `PUT
/content/learn`, a learn document published as a `publicationChanges` member, and `POST
/content/learn/validate` alike — refuses any other value with `422`, naming `attribution` in `errors[]`
and writing no revision; a stored document naming another value still reads, with the member dropped.
The offline recomputation, `rebuildFrom` on `POST /v1/{tenant}/learn/generation`, folds the retained day
under the same per-slot rule, so a module-tied slot rebuilt from the ledger holds the counters online
credit gave it ([where a page conversion lands](03-payload-schemas.md#where-a-page-conversion-lands)).

A module may declare its own success event and a slot may convert every success into its own currency.
A catalogue piece may carry `successEvent`, one reward of the list (`click`, `dwell`, `video_complete`,
`wishlist`, `add_to_bag`, `purchase`, `custom`); `successEvent` is absent by default, and absent the
module is credited for its slot's reward exactly as before. A slot's learn dials may publish a conversion
table, `slots.{slot}.conversions: { <reward>: <value> }`; `conversions` converts each reward it names into
the slot's currency at a finite value above zero, and is absent by default. Without a table nothing
changes: the slot's `reward` and `objective` credit every module as before, a declared success event
included, and no record, receipt, credit, replay or manifest changes. With a table, an outcome of a
module's declared success event credits that module's decision the table's value for the event, and a
module that declares none is credited for the slot's reward at the table's value for the slot's reward (so
a table valuing the slot's reward at 1 credits such a module exactly as today, and one valuing it at 3
credits each of its successes 3). A success event the table does not value credits nothing, and neither
does any other event: a click on a module whose success event is `add_to_bag` credits its decision
nothing, the outcome receipt naming the slot `reward` in `refusedBySlot`, and a table that does not value
the slot's own reward credits nothing to a module that declares no success event. The value is multiplied
by what the slot's objective weighs the outcome (1 under `unit`, the outcome's value under `revenue`, its
margin under `margin`, with the money refusals above unchanged) and kept in the counter of the slot's own
reward, which is the slot's currency, so modules with different success events are compared on lifts in
one currency and ranked in one slot; on a layout slot that normalises positions, the position effect then
divides it, live and in the hourly fold alike. The slot's attribution policy still decides which decision
is credited (a module-tied slot only for an outcome that originated inside the module), and among the
decisions of one slot an outcome matches only the decisions it is the success of, before the credit rule
picks one. `custom` stands for every outcome of the custom reward, a partner pickup or a retailer
referral, whatever its own name. An event that is no reward (a page view, `content_viewable`,
`video_view`, `product_dwell`) is no outcome and credits nothing whatever a table says, and an outcome
the objective weighs zero stays zero under any table. A product-type weight (action weights per product
type) scales only the shopper's interest update and never this credit.

Every decision record of a slot with a table carries `explain.successEvent: { event, value }`, keys
sorted: the module's declared success event, else the slot's reward, and the table's value for it, `value:
null` when the table does not value it; every arm carries it, and the shopper's receipt carries the same
block as `successEvent`, with no new sentence. The credit of a decision is read off its record, online in
the visitor's ring and in every offline fold — the offline recomputation (`rebuildFrom` on `POST
/v1/{tenant}/learn/generation`) and the hourly fold alike — so a declaration or a table changed after a
decision changes nothing that decision earns, and the next decision names the new one. Publication —
`PUT /content/catalog`, `PUT /content/learn`, a `publicationChanges` member and `POST
/content/{kind}/validate` alike — refuses with `422` a `successEvent` outside the list, naming `pieces[i].successEvent` in `errors[]`, and
a table that is not an object, is empty, names a key outside the reward list or values a reward with
anything but a finite number above zero, naming `conversions`; a stored document's member the current
contract refuses reads as absent. A direct publication (`PUT /content/catalog`) that declares `successEvent`
keeps it on the stored piece with no `ignored_field` advisory for it, `POST /content/catalog/validate`
answers the same advisories, and a feed import or pull carries it the same way (in CSV, a `successEvent`
column holding the reward word), refused by the same name outside the list. Limits: the learn validator
does not read the slots document, so a table on a slot no page carries is accepted and changes nothing; adding, changing or
removing a table does not start a new accumulation generation, so what the slot counted before stays at
the values it was credited with; the replay does not compare `explain.successEvent` and a replayed record
omits it, which changes no score; and the day report built from the ledger's raw day (`POST
/v1/{tenant}/learn/report` on a day with no folded hours) counts a declared success event only where it
is the slot's own reward, unweighted by the table
([success events and conversion tables](03-payload-schemas.md#success-events-and-conversion-tables)).

A table that does not name the slot's own reward is still accepted, and the publication tells the
operator so: the warning is advice and refuses nothing. Such a table is published as written, and the
success answers of `PUT /content/learn` and of `POST /content/learn/validate` carry the advisory member
`diagnostics` in the envelope the catalogue's and the pin channel's advisories use, `{ advisory: true,
omittedWarningCount, schema: "learn-conversion-diagnostics/v1", status: "available", warningCount,
warnings }`, keys sorted, with one warning per slot whose table omits the slot's own reward, `{ code:
"conversions_omit_slot_reward", consequence: "undeclared_pieces_earn_nothing", reward, slot }`, keys
sorted, where `slot` names the slot, `reward` the slot's reward the table omits, and the consequence
says that every module on that slot which declares no success event earns nothing from then on (its
record names `{ event: <the slot's reward>, value: null }`, so its outcomes credit nothing). The member is
given only when at least one table omits its slot's reward: a document without a table, or whose every
table names its slot's reward, is answered byte for byte as before, with no `diagnostics` member. The
current read `GET /content/learn` carries the same `diagnostics` member, as its last member after its
other members, when the learn document in force (the stored document, or the compiled default when none
is stored) has at least one such table, computed on that read from that document and never stored, so a
document stored with such a table before the advisory existed, or put back by a rollback, is told to
whoever reads it; a document without such a table is read byte for byte as before, with no
`diagnostics` member. The learn history and revision reads (`GET /content/learn/history` and `GET
/content/learn/revisions/{n}`) and the lift reads never carry it. The document is published or
validated with the same status and members as without the warning, and its credits, records, receipts
and replays are the ones above. A slot's reward is its `reward` dial, `click` when the dial is absent, and
a table names it only by that key, `custom` included. Warnings are listed one per slot in slot-name order,
the order the published document keeps its slots in, so the validate door lists them exactly as the PUT of
the same document will; at most 50 are listed, `warningCount` counts them all and `omittedWarningCount` is
the rest. A table on a slot no page carries is told like any other, because the learn publication does
not read the slots document and such a table omits its reward the moment a page carries the slot. Limits:
the answers of a rollback (`POST /content/learn/rollback/{n}`) and of a learn document published as a
`publicationChanges` member of another document's request carry no advisory; the next read of the
document in force does.

The console's Dials screen shows this advisory beside the result of its check (the validate door, asked
shortly after an edit) and of its save (the `PUT`): when that answer carries `diagnostics`, one note above the
"Reading revision" line lists each warning, naming the slot, the slot's reward its conversion table omits
and the consequence, that undeclared pieces on that slot earn nothing, and says how many more there are
when `omittedWarningCount` is not zero. The Dials screen also shows the stored document's advisory on
open, before the first edit: entering the screen reads `GET /content/learn`, as it always has, and when
that read carries `diagnostics` the same note, valued for the read (`data-learn-advisory="read"`, where
the check's is `check` and the save's `save`), lists each warning of the document in force. The first
edit drops the read's note and the check's answer replaces it (with nothing when that answer carries no
`diagnostics`), the save's answer replaces the check's, a discard clears it, and entering the screen
again draws the read's anew; at most one such note is on screen at a time. The screen makes no request it
did not make before; an answer without the member leaves the screen exactly as it was, so a document
without a warning opens the screen as before; the read's note lasts until the first edit, a discard or
the next entry, the check's while the draft it checked is on screen and the save's until the draft
changes or the screen is entered again. The screen has no control for conversion tables, so a save
republishes a stored table as it is and is told about it the same way. A rollback, made from the History
screen, carries no advisory and shows none; the Dials screen entered after it shows the read's.

Learning ingestion has conservative application budgets independent of gamma:256KiB/1000 rows per statistics request;256-code-unit components and2048-byte ordered keys;512KiB,256 item identities and4096 counters per learning value. The total640KiB budget also counts effect/retirement markers, reset fences, publication identity and repair receipt. Ring state remains1MiB/200 records/4096 index entries; its4MiB total includes at most64 immutable credit plans and cleanup debts. Needed retry/privacy witnesses are never evicted to admit work. Invalid input or witness capacity refuses the entire batch, without a partial counter commit.

New statistics monotonically drop complete fine levels from both item and slot maps when cardinality/bytes saturate. Retained ancestor counts are used directly, never sums of overlapping levels. After256 item identities, additional items contribute to a root-only anonymous overflow aggregate; their own estimates are unavailable/neutral, not zero. The admitted population is first-seen (explicit repair uses lexical selection), so selection bias remains; coarser pooling loses within-cell distinctions. Snapshot `completeness` exposes depth, item omission and reason. No finer partial estimates are recreated. W23 original-time weighting and W24 configuration compatibility remain unchanged.

Serving requires a scope/configuration/projection/generation witness and exact committed publication digest from the statistics owner, including on KV/isolate-cache hits. Missing, stale, unhealthy or unverified evidence falls back to base/neutral. The statistics owner answers the serving path on a light witness door (`/witness`) from a verdict it keeps for its committed state, never re-reading or digesting that state, and recognises, beside its latest publication, its recent publications within ten minutes of their own publication under the same witness (`explain.lift.asOf`); its `/health` stays the operators'. The witness budget, 200 ms by default and overridable per deployment (`LIFT_WITNESS_BUDGET_MS`, see `sources.budgets` above), bounds this optional read. That budget is the round trip to the statistics owner alone: the snapshot's own digest is computed before it starts, once per snapshot the isolate holds, so a snapshot at the statistics owner's caps is served as surely as a small one. An isolate holds at most 256 snapshots and at most 8 MiB of snapshot text, evicting the oldest first; an evicted snapshot is read from KV again. This is not a customer latency guarantee. Reset and repair fence earlier publication and prepared effects; publication failure after a committed mutation is not rollback. Immutable archive-before-KV publication remains.

Recovery is explicit and current-human tenant-admin audited. `POST /v1/:tenant/learn/recovery` accepts `operation:status`, `kind:stats`, exact `brand`/`slot` (and `page` for a page-scoped placement, see Placements below), or `kind:ring` with exact `visitorId`; no query selectors. `operation:repair` additionally requires the returned `digest`/`generation`, a32-lowercase-hex `operationId`, and `intent:coarsen` or `intent:reset` (stats) or `compact` (ring). `operation:status` answers the object's `state` — `empty`, `healthy`, or `recovery-required` for counters that fail validation or carry a reference time after the engine's present — with the `digest` and `generation` a repair must name. Stats `coarsen` validates up to8MiB/65536 counters, retains root mass and all retry witnesses, and commits a bounded coarse replacement conditionally. Stats `reset` is the explicit reset for counters no merge can make honest: under the same digest/generation precondition and the same two audit phases, it discards that one slot's counters, its exposure journal and any accumulation transition on record without first requiring the damaged state to validate, advances the object's generation so nothing prepared against the old one can land, and answers `{ok, recovered, reset: true, digest, generation}`; the slot's next snapshot names the reset in `rebuiltFrom` (`basis: "explicit-reset"`, see the lift snapshot in the payload schemas), and no other slot, brand or tenant is touched. Ring repair only removes proven expiry/exact duplicates and reconstructs missing index entries from retained full records; conflicts, unsupported oversized live history and unknown provenance remain held. Commit ambiguity is resolved by exact readback; exact receipt retry resumes scheduling, not the repair transaction. No raw overwrite or tenant remapping is offered, and a reset only ever discards: it restores no earlier history, and what the slot counts afterwards is counted from the reset on. Actual customer-history repair, policy values, deployed capacity and SLO acceptance require separate authority.

Statistics exposures and credits require an explicit valid slot configuration (missing/invalid:400). A changed reward, objective (absent means `unit`) or `tauLearnMs` refuses with409 and `applied:false` before either item or slot counters, storage or alarms change. Estimator-only `n0`, `nMin` and lift clamps remain editable without discarding counts. Current outcome producers explicitly carry the resolved document's default configuration for unconfigured slots; the ring never infers one from stored history or silently replaces a malformed override. New snapshots publish `tauLearnMs`; live serving checks owner, reward, objective, horizon and estimator settings on fresh reads and cache hits. Missing legacy horizon or mismatch omits learned evidence without erasing the cached snapshot or overriding an explicit operator-frozen lift. Archived pure replay is unchanged. This is forward containment, not proof of clean legacy history or atomic configuration rollout. Reward filtering, the explicit reset and the authorized generation transition, with its rebuild from one retained day, are now contracts of their own — the outcome receipt's `refusedBySlot` above, `intent:reset` on `POST /v1/{tenant}/learn/recovery` and `POST /v1/{tenant}/learn/generation` — and none of them rewrites what was counted before it. A money policy cannot be published yet, so money outcomes are refused rather than reconciled, and history counted under an earlier money or attribution policy is not reconciled either; old binaries and historical aggregates remain separate work.

The upgraded statistics publisher freezes estimates/time, creates the R2 archive without overwriting a retained key, validates its acknowledgement, then awaits live KV publication. Same-millisecond/reset/restart collisions try at most eight positive safe-integer versions; only a definite collision advances, while missing, failed or malformed acknowledgements stop. Final serialized bytes remain within the snapshot budget. Publication failure schedules another attempt in 30 seconds and still fails; scheduling failure also fails. The object's own alarm publishes only a change: when the slot's counted evidence (an exposure or a credit), configuration, generation fence and repair basis, the tenant's published documents (its learn, prior, catalogue and slots documents among them, by the revision of its publication set in force) and the pooled counters it reads are what the last successful publication was built from, as that publication recorded before writing its copy, the serving key holds that publication's copy, and no `stale` or `republished` member is in force for it, the alarm allocates, archives and publishes nothing, and still writes its `learn` state when one of the slot's learning-effect markers has passed its expiry, removing those past it, so a copy is superseded only by a change; a marker in force or a copy whose write failed has the next alarm publish as before, and the operator's publish, an item reset and the generation transition publish as before (`src/durable-objects/LearnStats.ts:1365-1366`, `:1420-1436`, `:1449-1459`; the payload schemas, the lift snapshot). The object's one alarm also removes each learning-effect marker at its expiry and keeps the object warm (the keep-warm heartbeat, above), so the failure sets it to the earliest of the 30-second retry, the earliest pending effect expiry and the heartbeat while the object is in its tail, never moving an earlier alarm later: a failed publication never pushes an effect's removal later than it is due, and no alarm runs a publication before one is due. State/prior/snapshot refusals retain their existing behavior. Operator publish/reset requires coherent downstream success; failures return503 and reset does not append a successful revision. KV or item-reset may already have committed, so failure is not rollback. Ambiguous archive writes may leave orphan versions. This does not establish globally chronological/idempotent version identity, retention/history repair or mixed-version rollout. Old unconditional publishers and externally removed/corrupt archives remain separate work; no extra decision hot-path read is added.

New decision inputs include `replay: {version:1, exploration:'supported-only', learning, candidateLimit, slots:[{slot,lift,prior}]}`: the ordered full page's effective learning presence, candidate limit, snapshot identities and live exploration policy. Thompson is rejected by new configuration writes and suppressed on live decisions, including retained documents; only a trusted historical replay of an absent policy marker preserves the old seeded sampler. A present unknown/malformed marker refuses, never selects legacy behavior. Pins/default-arm slots name zero dependencies. Replay validates this manifest and required archive owner/version/prior/consumed structure, then runs the ranked prefix through the target; a genuine catalog pin runs alone without unused archives. On a page whose declared layout slot names inner content slots, `slots` names every slot of the page in document order except an inner slot the layout did not return the module of, which was not decided, and the ranked prefix is taken in the order the page was decided in, each inner slot directly after its layout slot ([inner content slots](#inner-content-slots-inner)). Gamma zero still requires any snapshots used for raw receipts or exploration. Returned records retain detached full-page inputs; `used.lift/prior` describes the consumed target snapshot, while the manifest can name later archives that were not read. Comparison includes authority and exploration metadata. Absent legacy personalized multi-slot manifests refuse; default/pin and qualified single-slot compatibility cannot recover arbitrary old pure-call candidate limits or ambiguous zero-lift exploration/controls. Repeated page metadata counts toward existing full-record queue budgets. This is deterministic forward replay, not cryptographic receipt integrity, repaired archives, complete retention/rollout/resource assurance or validation of an exploration model. Older readers may reject the new marker; no mixed-version rollout is proved. Beside the manifest, never inside it, every new record whose decision had the learning layer carries `inputs.explorationRules: 'recorded-draws-v1'`, the exploration rules it was decided under (a draw inside the share is recorded as `explored` even where it agreed with the leader, the recorded support is the pre-reorder top by score with the explored piece beside it, and a controlled item is never drawn). The replay chooses its exploration rules from that member alone, never from whichever rules happen to reproduce the record: absent, the record was written before those rules and replays under the ones it was written with (a rotation or epsilon draw that agreed with the leader unflagged, a controlled item drawable, the support cut after the move), so it never replays as an `item` difference; present with any other value, the replay refuses with `invalid exploration rules marker` before any archive is read. This axis is independent of the Thompson marker, as the pin, content-type and governance markers are of each other.

Exploration is off by default: a learn document with no exploration block explores nothing, and the compiled default states the same. Both operator editors require explicit replacement of dormant Thompson settings before saving; operator exploration/slot summaries, the learning console's exploring panel and the day report's `exploration` row all report effective off while identifying the retained setting (`configuredMode`, `unsupported`), and publish no configured share for it. A decision the exploration rule made is recorded as `explored` even where the draw agreed with the ranking's own leader, so the realized share can be compared with the configured one; the recorded candidate support is the slot's top candidates by score before that pick was moved to the front, with the explored piece recorded beside them, and the served ranking is unchanged by that record. An item under a merchandiser `reject` or `freeze` is not chosen by a supported exploration mode, because both modes select on the learned evidence the control removed from its treatment. The supported modes are reward-free and model no unit reward; an evaluated exploration and its contract remain an open owner decision, not a delivered capability. Reset-item refuses an unwritable current learn document before contacting the statistics object. After acknowledged reset it re-reads current settings before recording a revision; a revision failure returns503 with `resetCompleted:true` and `revisionOutcome:'unknown'`, not success or rollback. This is not a transactional configuration/reset protocol or a customer-policy amendment.

Replay requires nonnegative safe-integer `catalog`, `slots`, `learn`, `lift` and `prior` identities before dependency reads; malformed tuples cannot silently select defaults. Missing pre-Phase3 document identities retain their explicit refusal. Integer zero remains the compiled/default or absent-dependency convention. A positive configuration dependency must return an envelope bearing exactly its requested revision before its value is used. These failures retain the authenticated route's `ok:false` result, no-store and audited-read behavior, without implying a scoring mismatch. This cannot detect a different valid body overwritten under the same revision or pin the historical compiled defaults/reader code; immutable slots/learn publication, old data repair, retention and rollout remain separate work.

A lift dependency the store could not return is now reported apart from one that is absent: a failed archive read or a body that will not parse answers `lift dependency <slot>/<version> could not be read`, while a genuinely missing object keeps `lift dependency <slot>/<version> is not in the archive`. The underlying transport failure is never disclosed. A manifest whose `version` is a nonnegative safe integer above the one this build implements is refused as a rollout event by name — `page replay manifest version <n> is not supported` — while every other malformed `version` (a string, a fraction, a negative, zero, an object, or past the safe-integer range) keeps `invalid page replay manifest`, so nothing arbitrary a record carries is interpolated into an operator sentence. A later version does not excuse damage this build can recognize: every recorded dependency identity is a nonnegative safe integer whatever version carries it, so a manifest in which any slot row carries a `lift` or `prior` that is not one (a negative, a fraction, a non-finite number, one past the safe-integer range, a string, `null`, a boolean, an object or an array) is damaged whatever version it claims, and is refused as `invalid page replay manifest` before any archive is read. Only a later-version manifest whose recorded identities are all nonnegative safe integers is refused as the rollout event. Every replay answer also carries `classification`, derived from `diff` alone: `equal` (no difference), `item` (`item_id` differs), `candidates-only` (the candidate list is the only difference, so the served item is right), `explanation` (some other compared field differs) and `not-replayable` (`ok:false`, with the `reason`). This is triage vocabulary for an operator, not a new authority, a repaired archive or a claim about why a difference exists.

Snapshots contain only their named identity fields and estimates, not raw statistics/configuration. Prior documents are gated at4096 rows/256KiB before indexing/building; selected keys allow at most six components/2048 bytes, and actual item/key/ancestor expansion shares the256-item/4096-counter limits. Output is capped at2MiB before response/publication. This gate follows the existing configuration read/validation, so it is not a bound on raw KV parsing/import allocation. These are application budgets tested with synthetic bounded storage, not native provider-limit or sustained-capacity proof. Historical oversized-object reconstruction, old KV snapshots/completeness policy, vocabulary/estimator/generation policy and full W10 remain separate work.

Imported priors now preserve item and cell as separate identities through duplicate detection, lookup, publication and capacity counting. Multi-component cells materialize under the real item at each current ladder level; a finer prior overrides its ancestor. Raw snapshot/decision `n` and `s` remain observed counts, while `n0`, `prior: {p,n}` and the prior revision identify imported strength. A cold item can therefore receive a prior-derived ranking term in an eventful slot with positive reference and base scores. The prior document and snapshot formats are unchanged, but old readers can reject newly accepted delimiter-collision pairs. This does not repair old snapshots. Prior strength is not observed exposure or causal lift.

Cold priors are now a complete path from the warehouse to the shopper. The cell grammar is the ladder grammar and is versioned: a cell is `*` or a prefix of `c=`, `v=`, `s=`, `r=`, `a=`, and the wrong order, an unknown key, a skipped level or a level past the ladder is refused by row at the import door, in JSON and in CSV alike, naming the expected order, instead of being accepted as a prior that reaches nothing. A document may declare `cellGrammar {name, version, order}`; declaring anything but the current grammar is refused with the migration named, and declaring nothing means the current one, so existing documents and warehouse CSVs import unchanged. A slot whose only evidence is an imported prior now publishes its snapshot, so a cold item is ranked on the prior the day it is imported rather than on the day the slot first records an event; a slot with neither events nor priors still publishes nothing. A probability prior for a slot whose objective is `revenue` or `margin` is refused at import and at publication, naming the row, the slot, the objective and the unit — what a money prior should look like is an open owner decision and none is invented. A prior document retained from before the import door refused such rows still holds them, and a `revenue` or `margin` slot it names stops publishing until the prior document is re-exported without them and imported again: its statistics object still records the slot's exposures, the shopper keeps being served the slot's last published snapshot, and nothing the slot learns meanwhile reaches serving. The stop is never silent: every monitor run — the scheduled one every five minutes and `POST /v1/{tenant}/monitor` — and the kept result `GET /v1/{tenant}/monitor` reads back name each slot so stopped in `stoppedSlots`, described above with the monitor's other members. Every lift row now says what its lift was measured against in `liftReference`: `slot-rate`, or `none` where the slot has no rate in that cell, so a lift of one that means "nothing to compare against" is no longer read as "measured, and equal to the slot". Receipts carry `lift_terms` with observed `n` beside prior strength `n0`, the prior itself and `prior_version`, and the learned-lift sentence names the prior and its strength only where the decision actually used one. Operator counts of what a slot has learned, and the exploration list, count catalogue items only, so a prior for an item the catalogue does not carry is never offered as something to serve next. Day reports state `gridPriors {applied, priorVersion}`, derived from what their grids were really built with. A day report an operator builds with `POST /v1/{tenant}/learn/report` from the day's ledger records — a day with no folded hours, or any request with custom `policies` — is built with the tenant's published prior document, the grids shrinking toward each imported prior at its strength as the live table does, and declares `applied: true` with that document's revision when any slot's grid used it, each grid's own `priorVersion` saying which did; a slot whose objective is `revenue` or `margin` is built without it, because its publication refuses it. The day summed from folded hours declares `applied: false`, because an hour aggregate carries no prior revision, and so does the nightly job's day report, which is built without the prior document: reconciling either against the live table is still the reader's arithmetic, now with the difference declared rather than silent.

Decision-ring append/outcome requests are bounded at1MiB of actual UTF-8 JSON, with1000 append records and2048-byte decision/outcome/index IDs. The full stored ring-plus-index candidate is limited to1MiB and4096 index entries, preserving the existing200-record/7-day ring and90-day index age rules without new eviction or projection. Capacity overflow refuses the whole ring append before saving with413 and `applied:false`; this is ring-local, not rollback of concurrently accepted statistics exposures. Existing fan-out reports incomplete without retry. Malformed/oversized saved state returns503 without history or credits; explicit reset remains reachable and ambiguous save/reset acknowledgements force reload. Full decision records remain available, but rich payloads can reach the byte cap before200 records. These are synthetic-tested application budgets, not native-limit, sustained-capacity, complete-history or recovery guarantees.

Upgraded ring append receipts use `version:2`, conserving `received = accepted + duplicates + cutoffSkipped`. After fresh subject/erasure checks, exact repeats of a unique retained full record or an earlier input add no ring/index row, before state-cap admission. Every JSON field participates: object key order is irrelevant, array order and values are exact. `accepted` counts new unique inputs before existing age/depth retention, not resulting depth or statistics processing. Changed same-ID payloads, ambiguous retained full-record IDs and index-only collisions refuse the entire append with409, fixed `ring decision collision` and `applied:false`. Unrelated historical duplicates are not repaired. A full record without an index entry still proves a repeat; an index alone cannot. Deduplication is limited to retained evidence, with no guarantee after existing pruning/reset removes it. Current fan-out validates/surfaces v2 and reads v1 as legacy acceptance without invented duplicate counts. Older v1-only callers see v2 as an unknown acknowledgement and must not retry. Repeated full fan-out still repeats independent statistics exposure/credit writes: this is ring-only containment, not a new exposure unit, history repair, durable reconciliation or exactly-once pipeline.

New learning updates keep each counter at its latest event timestamp and discount late contributions to that reference, without re-aging existing evidence. Snapshot counts, rates and lifts retain JavaScript numeric precision through serialization, evidence thresholds and raw decision explanations; human-readable sentences may round for presentation. Shrinkage, prior strength, clamps, true-zero-reference fallback and gamma-zero behavior are unchanged. Repeated inputs still add; this is not idempotency. Old rounded snapshots/reports and supplied replay snapshots are not repaired, and damaged historical counters are never repaired silently: a tenant admin resets them explicitly (`intent:reset` on `learn/recovery`) or an operator rebuilds them from one retained day (`rebuildFrom` on `learn/generation`), and the snapshot names which in `rebuiltFrom`. Lateness/future-time policy, generations and trustworthy reconstruction remain separate work. More precise numeric JSON can reach existing byte budgets earlier.

## 3. Identity

All under `/v1/{tenant}/identity/`. The first two take the site key; the rest take the operator token.

| Route | Body | Answer |
|---|---|---|
| `POST link` | `{ visitorId, accountId, source?, exp?, assertion?, accountChange? }` | `{ ok, shopperId, visitorId, outcome: "linked" \| "already" \| "relinked", assurance, audiences, changes: { entered, exited }, carry }`. `carry` is the id the browser must carry from now on. `customerId`, when present, is the identifier this browser carried before recognition (`setCustomerId`), as its own object kept it under tracking consent; it is absent when the browser carried none, it never names the linked `accountId`, and the link is the signed `accountId`'s alone. `409` when `visitorId` is already a shopper id: log out first. `401` when the brand has a secret and the assertion is missing or wrong. `400` when `accountId` is outside the tenant's declared `accountIdFormat` or `accountChange` is malformed, and `401` when its statement is missing, expired, more than 24 hours ahead or does not verify ([identifier changes](#account-identifier-format-and-identifier-changes)) |
| `POST detach` | none | `{ ok, detached: true }`; expires this device's cookies, deletes nothing |
| `POST resolve` | `{ accountIds: [] }` | Account ids to shopper ids, for a warehouse join |
| `GET visitor/{visitorId}` | | The link from the browser's end, if any |
| `GET shopper/{shopperId}` | | The browsers on the person and the history applied; the account id is not on it |
| `POST events` | JSON `{ rows }` or `text/csv`, each at most 1 MiB of actual streamed UTF-8 bytes and 1000 data rows | Historical actions or versioned typed profile snapshots; existing `accountId \| shopperId \| visitorId` resolution |
| `POST export` | `{ visitorId?, shopperId?, cursor? }`, the erase route's selector (at least one id) | The per-shopper export (the right of access). Its subject is the erasure's: a browser resolves to its person, and the person to every browser linked to her — the browsers her record lists, and every other browser whose current identity link at the tenant names her, found by the same scan of the tenant's identity links the erasure makes. `{ ok, tenant, subject, identity: { links, shopper }, objects, sessions, cache, decisions: { receipts, recent, records }, ledger: { decision, outcome, product-sort, behavior }, complete, next, limits }` — her links and person record, each of her shopper objects' `affinity`, `consent` and `pipeline` as stored, her session records and her profile copies and overrides, her receipts, ring and receipted ledger records as the operator reads answer them, and every row of hers in the tenant's ledger partition. The tenant's identity links, its session records and its ledger partition have no per-shopper index, so the export is a sequence of bounded calls. The first call (no `cursor`) answers her person record and everything held under every id her record lists or the selector names. Every call then continues three scans in order — the identity links, then the session records, then the ledger partition — and answers, in that same call, every browser its slice of the link scan finds linked to her (with everything held under it), and every session record and ledger row of hers its slices read. Whether an id is hers is decided again by every call: listed on her record or named by the selector, or its current link names her. One call visits at most 256 link and session keys together, reads at most 256 more identity links to decide whether a session's or ledger row's owner is hers, answers what is held under at most 64 ids, and opens at most 800 ledger objects (16 MiB); a scan stops at the key, record or row where a bound is reached and the next call resumes there. `complete:false` with a `next` cursor means send the same selector with `cursor: next` to continue; `complete:true` ends the export. The cursor carries only where each scan resumes (a listing position and the last key read, or a ledger object and row), never a list of browsers, so it stays the same size however many browsers she has; a cursor can only move where the scans resume, since every id is still decided by the call, and a cursor the export cannot read is refused (`400`). Pages may repeat a record (a session named by her pointer and found again by the scan). An erased or hidden row is never answered, the account id is on none of it, and `limits` names what it does not export (learning attribution state and counts; external and historical stores). `404` when a first call finds nothing of hers and nothing is left to scan (a continuation is always a page); the erase route's `400`/`401`/`403` refusals; audited as the erase is |

Both hosts answer a sign-in and everything after it the same way:

- A shopper who chose tracking only (personalization off) and then signs in is admitted with her
  signed-in session on every route. Her browser's profile is not carried to the person under that
  refusal, so the person holds nothing of her until her first tracked event, which starts the
  person's record; tracking-only measurement stays permitted and both switches are still required
  for personalization.
- The session a browser held before it signed in can still withdraw consent: a choice that only
  turns switches off is accepted from that session, and the refusal reaches the person on the next
  retry of the sign-in and through the refusal cookie on that browser. Any other choice from it is
  refused `401`; the person's own session makes her choices.
- A sign-in that fails before the person accepts it leaves the browser's profile where it was. The
  retried sign-in completes that same transfer or is refused `401`; it never starts another one. If
  the person's record was reset in between, the transfer can never be accepted, and the browser's
  own session gets its profile back on its next request: it browses as before, nothing of it was
  merged into the person, and signing in again starts a fresh link that carries her whole profile.

### Account identifier format and identifier changes

The account identifier's format is a tenant setting: the reflex document (`PUT /config/reflex`) carries
the optional member `accountIdFormat: { firstLanding?, hashedEmail? }`, published with the rest of it and
with no deployment ([schema](./03-payload-schemas.md#the-account-identifier-format-and-the-identifier-change)).
Each form is the source of a regular expression that begins with `^` and ends with `$`, and at least one
form is declared. Publication refuses with `422`, naming `accountIdFormat`, a value that is not an object,
an object that declares no form, a member other than `firstLanding` and `hashedEmail`, a pattern that does
not compile and a pattern not anchored at both ends; the revision in force keeps deciding.

- **The link.** With a format declared, a link whose own `accountId` matches none of the declared forms
  whole is refused with `400` (`accountId is outside the account identifier format this tenant declares
  (accountIdFormat)`), after the assertion is verified and before anything is linked or merged, so the
  browser stays anonymous. The format applies to the link's `accountId` only. A tenant that declares no
  format links any account identifier exactly as before, term for term.
- **The change statement.** When a shopper's account identifier changes from one form to the other, the
  link to the new identifier may carry `accountChange: { from, exp, statement }`: `from` is the earlier
  account identifier and `statement` the HMAC-SHA256, base64url, that your backend signs with the
  tenant's identity secret over both identifiers, `<tenant>\naccount-change\n<from>\n<to>\n<exp>`, where
  `to` is the link's own `accountId` (the `account-change` line keeps it apart from a link assertion).
  `exp` is unix seconds, in the future and at most 24 hours ahead, as for the assertion.
- **The refusals.** A change statement that is missing (`account change statement required`), names
  another pair of identifiers or is signed with a secret the tenant does not hold (`account change
  statement does not verify`), has expired (`account change statement expired`) or expires more than 24
  hours ahead (`account change exp too far ahead`) is refused with `401`; an `accountChange` that is not
  `{ from, exp, statement }`, whose `from` is blank, longer than 200 characters or spans lines, or whose
  `from` is the link's own `accountId` is refused with `400`. Each refusal merges nothing: no profile
  changes and the browser stays anonymous.
- **The merge.** On a statement that verifies, the browser is linked to the new account as any link is,
  and then, in that account's own object on either host, the earlier account's profile is merged into
  it as a browser's profile is on a link. An identifier change merges the two accounts' profiles only on
  that signed statement and never overrides either: the decayed evidence of both is added at its later
  touch, counters add and memberships are re-evaluated, so recent behaviour outranks both histories. The
  earlier account keeps its own profile. Nothing merges when either account's consent does not cover
  personalization or the earlier account holds no profile.
- **Once.** The earlier account's profile is merged once. The new account's identity record remembers
  the shopper ids of the accounts merged into it (`mergedAccounts`, salted shopper ids only, never an
  account identifier; written only when a change merges; at most 50; erased with the person), so the
  same statement presented again, or any later one naming the pair, merges nothing more; a change back
  to an account that already holds this one merges nothing either. The SDK sends `accountChange`
  unchanged on every link request of an identify() call, its retry after a `409` and a detach included,
  and the retried sign-in is accepted as the link it is. The answer has the same members as any link,
  with `audiences` and `changes` taken after the merge; a link without `accountChange` answers exactly as
  before.
- **A refused merge.** When the new account's own validation refuses the profile the merge would make
  (for example more enrichment sources between the two accounts than one profile holds, `at most8
  sources`), nothing merges and nothing is remembered, and the link is answered `400` with `error:
  "Validation error"` and the refusal's issues in `details`, on both hosts, in process and on the Workers
  runtime alike. The account's object answers the refusal typed (`src/durable-objects/ShopperReflex.ts:3442-3444`
  and `:3421`, through `:326-333`, before the commit at `:3409`); the link reads that answer only at
  `400` in its exact shape (`src/identity/link.ts:200-201`, `src/identity/sessionAuthority.ts:409-413`;
  no message is parsed) and raises it as the validation error the route answers
  (`src/middleware/error.ts:19-27`). The browser's link itself has completed before the merge is asked
  (`src/identity/link.ts:111`): the same sign-in retried with that `accountChange` is answered the same
  `400`, and without it as the link it is. The shopper object's absorb door, which no route calls,
  answers its merge's refusal in the same typed shape (`ShopperReflex.ts:3663-3665`, `:3670`), as the
  link's own merge does (P58, `:3222-3223`, `:3262`).

### Interest restoration from ODP

When your connector registry configures `odp` for your tenant, ODP is also the memory the edge
re-seeds from. Once per sign-in, at a signed-in (recognized) shopper's first event under
personalization after it, her ODP profile is read and her interests are merged into what she already
holds, before that event is applied, identically on both hosts. Nothing is read at the sign-in
itself, at a consent choice or on a read.

- **What is read.** Her profile, by the vuid your `identityNamespace` gives her shopper id, from your
  `apiHost` with your key: `customer(vuid) { vuid last_modified_at <attributes> }`. Only your own
  configuration is used; the platform's stamp-global demo ODP settings never restore anyone.
- **What is restored.** Each `odp.profile` attribute mapped as `{ dimension, value }` on a dimension
  your reflex registry defines, with a value your published catalogue admits, is a recorded affinity
  `a` (a number in `[0, 1)`, the value `upsertOdpProfile` writes). It is restored as the interest that
  affinity was at ODP's `last_modified_at` (epoch seconds), so it decays from that observation by your
  published `tauMs`, never from the moment it was restored. A `{ dimension }` label, a
  `{ journey: true }` label and ODP audiences are never restored as interests.
- **Merged, never overwritten.** Every interest she built before or since signing in, including what
  she built anonymously in the session she signed in from, keeps its value. A restored interest is
  added where she has none; where she already holds the same `dimension`/`value`, the stronger of the
  two at that moment stays.
- **When.** One attempt per sign-in, whatever her choice at the moment she signs in: it is made at her
  first event under personalization after the sign-in and recorded against that sign-in. Every later
  sign-in gets its own attempt, also one made under tracking only that keeps her record as it was; a
  consent choice is not a sign-in, so withdrawing personalization and granting it again within one
  sign-in makes no second attempt. An attempt that could not read (`unavailable`) is made again once in
  each later visit of the same sign-in until it gets an answer; every other answer stands until her
  next sign-in.
- **When it is not.** Only under her personalization choice current at that event. Never after her
  erasure: once an erasure barrier exists for her shopper id her profile is not read and nothing is
  restored from ODP, whatever its `last_modified_at` says, because that timestamp covers the whole
  profile, any writer moves it, and the platform's erasure leaves her ODP profile to your operator.
  Never an observation older than your `profile` retention policy.
- **What she is told.** `GET /realtime/reflex` answers the outcome as `affinity.restoration`:
  `{ source: "odp", status: "restored", observedAt }` (epoch milliseconds), or
  `{ source: "odp", status: "cold", reason }` where `reason` is `cold` (her profile records no
  interest), `missing` (ODP has no profile for her), `malformed` (a mapped value or the observation
  time is not usable), `unavailable` (ODP, her erasure barrier, the catalogue or your retention policy
  could not be read), `erased` (she has been erased, so nothing is restored from ODP and her profile
  is not read) or `expired` (older than your profile retention). It is the outcome of the latest
  attempt recorded on the interests she holds: between a sign-in and that sign-in's attempt it is
  absent, or still the outcome of an earlier sign-in's attempt, and it is absent when no attempt has
  ever been recorded on them.
- **A failed read never blocks.** The read is capped at 1500 ms like the audience read. An error
  status, a network failure, a timeout or an unreadable answer leaves her with what she holds and
  `reason: "unavailable"`, and the event and every decision are served exactly as they would be for a
  shopper ODP knows nothing about.

### The second ODP identifier (`odp.secondIdentifier`)

Your ODP connector configuration (`TENANT_CONNECTORS`, the tenant's `odp` object) may name
`secondIdentifier`: an identifier field your ODP already defines, such as the one your experimentation
platform resolves a visitor by, so that a segment built in ODP on the engine's fields can target an
experiment. A tenant without the member is written exactly as before, term for term.

- **The setting.** `secondIdentifier` is the name of one ODP identifier field: a letter, then up to 95
  letters, digits and underscores. It may not be `vuid` and may not name one of your `odp.profile`
  fields, so it can replace neither. Any other value (a number, an empty string, another name) makes the
  connector configuration invalid, and it is refused with the rest of it, as any invalid member is: the
  tenant's connectors are unavailable (`Tenant connector unavailable`) until the configuration is
  corrected.
- **What the person's record keeps.** At a verified sign-in (`POST link` with your backend's signed
  assertion) made while the setting is configured, the person's own identity record keeps the link's own
  `accountId`, the one your backend signed and the person's shopper id is derived from, which is your
  hashed account identifier when you link with one (declare its form as `accountIdFormat` to refuse any
  other). Never an earlier identifier an `accountChange` names, and never the `customerId` a page carried
  before sign-in. It is kept only under the person's tracking consent: a sign-in under refused tracking
  keeps nothing and removes an identifier kept before. A sign-in made while the setting is absent keeps
  nothing, so a person who signed in before you configured it gets it at the next sign-in; a value kept
  while the setting was configured stays on the record, unused, if you remove the setting, and is read
  again only while the setting is configured.
- **What is written.** `secondIdentifier` is written only when the setting is configured and the
  person's record holds the hashed account identifier; a shopper who never signed in, or signed in
  without the setting, is written with the vuid alone. With both, every event the engine forwards to
  `/v3/events` carries `identifiers: { vuid, <secondIdentifier>: <account identifier> }` and every profile
  upsert to `/v3/profiles` carries `attributes: { vuid, <secondIdentifier>: <account identifier>, …your
  odp.profile fields in their order }`, identically from both hosts
  ([shapes](./03-payload-schemas.md#the-odp-writes-and-the-second-identifier)). The audience read on
  `/v3/graphql` is unchanged.
- **Retention.** Naming `secondIdentifier` changes your ODP connector configuration, so its destination
  digest and its `external.odp.<digest>` retention category change, as with any change of that
  configuration ([retention](#explicit-retention-configuration-and-erasure-reconciliation)). A profile
  carries the authority of the destination categories that had a policy when it was born, so provide the
  new category's policy before you name the setting: a profile born before that policy existed sends
  nothing more to ODP once the setting is named, while one born after it is written as described here.
- **Consent, erasure, tenants.** The identifier rides only on the writes your shopper's consent already
  allows: events under tracking consent, profile upserts under personalization consent. The operator's
  erasure of the person removes it from the person's record (the person's object and its
  `identity:shopper:` projection), so no later write carries it, whatever the person does next; a later
  sign-in made while the setting is configured keeps it again. Only the tenant that configured the setting
  writes it; another tenant's setting changes nothing for yours.
- **Nothing is created.** The engine creates nothing in ODP: it calls only the event, profile and audience
  endpoints it calls without the setting, and creates no field, segment or audience, so your ODP owner
  defines the identifier field and builds any segment on the engine's fields.
- **Never answered.** The kept identifier is on no answer: the operator's visitor and shopper reads and the
  export leave it out, and the link answer's `customerId` is only ever the identifier the browser carried
  before sign-in, never the kept account identifier.
- **The page-side path.** Without any setting, the page can pass the engine's segments and interest values
  to the experimentation user context as attributes ([Integration guide](./01-integration-guide.md#your-experiments-and-the-engines-audiences-the-second-odp-identifier)),
  so an experiment targets them directly; that path writes nothing to ODP.

### Experiment enrollment across a link

A shopper who has consented to personalization is enrolled once, against a persistent enrollment
anchor and the published salt of the experiment named in the learn document, and every decision
record kept for her carries `experiment: { id, saltVersion, arm, anchorGeneration }` — `id` is
`{tenant}:{brand}:{salt}`, so rotating the salt starts a NEW experiment rather than silently
re-randomising the running one. The arm is read back from that anchor on every decision; it is
never re-drawn from whichever id the browser happens to be carrying.

`saltVersion` is 1 for the first salt and one more at each change of salt published up to the pinned learn
revision, so a salt that returns counts again; it is not the revision of the document that carries the salt,
so an unrelated edit does not mint a second version of a running experiment. `saltVersion` is exact on any learn history the platform still stores, however long, and `null` only where that stored history cannot establish it — never a smaller number.
Each learn publication carries the count from the learn revision before it; where that revision carries
none, the publication counts over the whole stored learn history once, and a revision the store cannot
produce leaves the count `null`. Decisions, outcomes and the context table read the count the learn
revision in force carries and never count it themselves. `id` carries the salt itself, so a join
on the experiment is unaffected either way.
The annotation is computed when your operator publishes the learn document. A learn document published before this release carries no salt-version annotation, so decisions and outcomes under it read `saltVersion: null` until that tenant next publishes its learn document. `id` is unaffected and still names the salt, so the records of a running experiment join either way.

**Across an identity link the enrollment recorded first wins; the arm is never re-drawn from the new id.**
The anchor of a recognised shopper is the first browser linked to her, so signing in, signing in on
a second device, or returning months later on a new browser all keep the arm she was first enrolled
in. `anchorGeneration` is that anchor's generation; recognition does not replace an anchor.

`arm` is the experience served; `experiment.arm` is the experimental assignment, and `ineligible` is never control.
A shopper who has not consented to personalization is served exactly what the control arm is served,
and her decision records, her outcome records and her snapshot answer say `experiment.arm:
"ineligible"` — she was never drawn, so no comparison may count her as a randomised control. If she
later turns personalization on, she is enrolled from that moment against the same anchor.

`experiment.reason` says why an assignment is `ineligible`: `personalization_consent` when she has not
consented to personalization, and `anchor_unavailable` when her persistent enrollment anchor could not
be read at that moment. An anchor we cannot read is never an invitation to draw a new arm from the id
her browser happens to be carrying: she is served the site's own defaults, the assignment says
`ineligible` with that reason, and the occurrence is counted for your operators on
`GET /v1/{tenant}/learn/queue` as `enrollment_anchor_unavailable`.
`enrollment_anchor_unavailable` is a lower bound: concurrent anchor failures can collapse into one increment, so read it as a floor and never as an exact count.

**A brand-new browser's arm before paint.** The head script (the context table, section 2) knows the arm before
the page's first frame. A browser the engine already knows computes it with the engine's own function, from its
stored visitor identifier and the salt the last answer's `experiment.id` names. A brand-new browser draws it:
`default` with probability `share` × (the number of `default` entries in `arms`) ÷ (the number of `arms`), the
engine's own split of the holdout, else `personalized`. The member `arm` rides the SDK's first decision request
on the direct path (no session yet, no broker) as the JSON text of
`{ "class": "default" | "personalized", "tableVersion": "<the context table's version>" }`, and the engine draws
the new visitor identifier again until its arm is in that class (every arm but `default` is `personalized`), at
most min(4096, ⌈ln 10⁻⁶ ÷ ln(1 − p)⌉) draws, p the class's probability, and once where p is 0 or 1; the arm
stays a function of the identifier and the salt, so every later decision agrees. The answer says what became of
it as `armRequest`, `{ class, honoured, reason? }`: honoured, or not with `reason` `capped` (not met within the cap,
the identifier keeping the arm it drew), `mismatch` (a share of 0 or 1 that cannot meet the class),
`republished` (a learn publication between the draw and the decision moved the identifier out of it) or `ignored`
(a request that already carries a session, whose arm never changes and whose answer is as without the member). A
malformed member is refused `400 'Invalid arm member'` on every path, a new browser's first request included, before
anything is issued or written. Each reason is counted for your operators on `GET /v1/{tenant}/learn/queue` as
`arm_draw`, `{ capped, ignored, mismatch, republished }`, an exact count of every reason over thirty days that names
no visitor; a draw is counted after its answer and never holds it, a draw whose record cannot reach the counter
(the learn statistics binding missing or the counter's object failing) is not counted, and a draw whose record
has no answer within two seconds may not be counted (the counter's object may have applied it before the wait
ended); the count restarts at the release that introduced this counter, so no earlier draw is in it. If the count cannot be read within two seconds,
the queue answers it as zeros rather than waiting. Two cases are told and not counted: a page on the session route or a
session broker gets the engine's own draw, so its head script can paint another class than its first answer's
until the SDK keeps that answer's experiment; and a recognised shopper's arm is the shopper's enrollment anchor's (above),
which a head script on another browser cannot see.

The canonical nightly report groups by the experimental assignment on every path: `ineligible` is its own row, never part of `default`, and a day summed from hours folded before this release answers `armVisitors: null` and names those hours in `coverage.unassignedHours`.
The day report built on demand from the day's records groups by the assignment.

Historical import requires an existing owned profile and live explicit tracking and personalization choices; legacy preference booleans do not authorize import. It cannot grant consent. Multiple supplied identifiers must resolve to the same subject. Missing state or consent and refused consent are reported by original row index in `skipped`, without changing profile or history counts; corrupt state and failed writes fail the request, which may follow earlier successful subject groups. Original times remain subject to erasure cutoffs and current owner-serialized import/adoption/publication barriers; independent external stores are not one global transaction.

### Return recognition (anonymous continuity)

`POST /v1/{tenant}/identity/session` — the call the SDK already makes on every page load — also answers one `continuity` block, and the answer is always explicit:

| Answer | Meaning |
|---|---|
| `{ enabled: false, reason: "unpublished" }` | This tenant has published no continuity block. Nothing recognizes a returning browser, and a return after the capability expires is a brand-new anonymous shopper |
| `{ enabled: false, reason: "incomplete" }` | A block is published but is not a configuration: a transport outside `direct`/`broker`, a window that is not a finite positive number of milliseconds, no covered purpose, or `retentionApproved` that is not exactly `true` |
| `{ enabled: false, reason: "consent" }` | Continuity is configured, and this shopper has made no current explicit choice. Both switches must be on |
| `{ enabled: false, reason: "unavailable" }` | We could not reach this shopper's own object, or could not read what it answered. Nothing was decided about her and nothing was consumed |
| `{ enabled: true, mode, purpose, generation, expiresAt, revision, proof? }` | The recognition descriptor her browser should carry |

`unavailable` is a failure of the CALL and never a statement about the shopper, which is why it is
not reported as `consent`. The request is still answered `200` on a **provisional** anonymous session,
the presented proof was **not** consumed and her chain did not rotate, and a caller holding a proof
must **keep** it together with its `operationId` and present the same consume again on the next page
load — the SDK does exactly that. Only `consent`, `unpublished` and `incomplete` are decisions, and a
caller clears what it holds on those. A proof we genuinely cannot place stays the cold-shopper
`consent` answer.

Because that provisional session leaves the browser holding a capability, the retry is the one case
where a return **may** carry `X-Shopper-Session`: we complete the consume beside a capability only
when the session that capability names is itself anonymous. A presented proof never takes over a
session that belongs to an identified shopper, and nothing of the provisional subject is merged into
the recognized one. Once she is recognized, the provisional subject is retired: it holds no state of
its own afterwards — not the taste browsed on it, not the choice made on it, not its session record —
and its capability reads nothing. The retired object keeps only the operation id of the return that
retired it, until the provisional capability would have expired, so that if the recognizing answer
is lost, its exact retry (the same capability, proof and `operationId`) is still answered as that
return: once, from the one receipt, with the same subject, generation, grant and successor proof. A
second retry is a cold shopper, and any other request on the retired capability is refused `401`.
A choice made on the provisional session that refuses tracking or personalization outranks the
return: that consume is not attempted, and she stays on the session she refused on.

The `continuity` block is **absent altogether** from the answer for a shopper who is signed in.
Return recognition here is anonymous recognition: the descriptor is bound to an anonymous browser
subject, so for an identified shopper there is no anonymous return to report and we report none. An
absent block is not a decision and changes nothing a caller holds.

There is **no shipped default**: the mode, the window and the covered purpose are published by the tenant on the versioned reflex document (`continuity: { mode, windowMs, purpose, retentionApproved }`), the same coherent publication set the weights, the decay horizon and the journey ladder ride, so `revision` names the document revision the descriptor is bound to. An incomplete block never becomes a configuration and never blocks the rest of the document.

`expiresAt` is the descriptor's original fixed expiry — issue time plus `windowMs`. It never moves: not on rotation, not on browsing, not on renewal. `generation` is `1` for the first descriptor of a chain and one more per return. `proof` is present **only** in `direct` mode; in `broker` mode the long proof leaves only as the `opt_shopper_continuity` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`) on the answer to your broker, and the body carries none. The shipped broker (`createServerBridge(...).broker`, `src/sdk/server.ts`) keeps that proof in the shopper's browser as its own first-party `__Host-opt-continuity-<tenant>` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, the engine's `Max-Age`), never readable by script, and clears it when the engine decides the proof it relayed will not recognize anyone.

A return presents the proof on the same route, normally with **no** `X-Shopper-Session` header (the one exception is the `unavailable` retry above): `{ continuity: { proof, operationId } }` in direct mode, or the cookie plus `{ continuity: { operationId } }` in broker mode. Through the shipped broker the SDK sends the operation id in the `X-Continuity-Operation` header (the body it sends the broker stays `{ consent? }`), and the broker relays the proof as the `opt_shopper_continuity` cookie with `{ continuity: { operationId } }` to this route, only when the browser holds a proof and the SDK named an operation. `operationId` is a UUID the caller keeps beside the proof: the exact retry of a lost answer is honoured once from one deterministic successor receipt, with the same subject, the same generation, the same grant and the same successor proof. A second retry, a different operation on a consumed proof, a tampered or unknown proof, another tenant's proof, another transport's proof, a proof issued under a previous configuration revision, and a proof past its own fixed expiry are all a **cold shopper**: a brand-new anonymous subject served the catalogue's own order. The expired capability is never extended; recognition answers a new bounded capability on the shopper's existing browsing session.

Logout (`detach`), session reset, link and erase each retire the descriptor, a withdrawn choice makes a descriptor issued before it cold, and the owner object holds only the digest, the generation and the fixed expiry — never the proof. The SDK keeps a direct-mode proof in its own tenant-scoped store under `opt_shopper_continuity:<endpoint>:<tenant>` and presents it on a cold start; in broker mode it holds no proof and sends none. In both modes it keeps the operation id of a return whose answer it has not seen under `opt_shopper_continuity:<endpoint>:<tenant>:operation`. In broker mode the shipped broker passes the engine's `continuity` statement on to the browser without any proof, and the SDK remembers only that the broker holds a descriptor (`opt_shopper_continuity:<endpoint>:<tenant>:broker`), so it names an operation only for a return there is a proof for. A return whose answer was lost is presented again on the next load as the same consume, answered once from the one receipt: with no capability when the lost request carried none, and beside the provisional capability when it was the retry of an outage (`unavailable`). That retry is not treated as unknown consent, and it claims no consent of its own: it carries no consent hint, and its answer carries the current explicit choice her own object holds (there is no recognition without one), or, for a cold shopper, no choice at all. A refusal the shopper made is restored from its own marker and still turns the return away, and a load interrupted in the middle of a sign-in or logout still falls back to unknown consent.

**Whoever holds a recognition proof is recognized as its subject.** The proof is a bearer credential:
it is bound to the tenant, the transport, the covered purpose, the configuration revision, the
generation and its own fixed expiry, and to nothing about the device or the browser that presents it.
Anyone who obtains it — from storage, from a log, from a shared machine — is answered as the shopper it
names, until it is spent, expires or is retired. Protect it exactly as you protect a session
credential: never log it, never put it in a URL, never copy it between devices, and retire it
(`detach`, session reset, link, erase) when the browser should stop being that shopper.

Activation is a tenant decision. Nothing in the platform publishes a mode, a window or a covered purpose, and the retention approval a continuity credential needs is per purpose: a 30-day session consent record authorizes none.

### Explicit consent

Both switches are OFF until explicitly chosen. `POST /realtime/session/preferences` derives the session from the current shopper capability; the legacy `POST /realtime/session/:sessionId/preferences` remains exact-current-SID guarded. Both accept optional `trackingConsent` / `personalizationEnabled` booleans plus `choice: { id, expectedRevision, grantId, iat, exp }`. The SDK supplies this metadata; direct clients obtain the current revision from `consent.instruction` (`null` if absent) and grant fields from their session descriptor. `id` is a stable 1–96 character alphanumeric/underscore/hyphen operation ID. Retry the exact operation and payload after a lost response; changed or stale operations conflict (409). Invalid choice metadata is400. A valid cold owner may choose without creating behavioral state.

The acknowledgment includes scoped `consent.instruction` with independent `{ value, chosenAt, expiresAt }` switches. Server time sets each explicit choice's deadline to30days; omitted switches retain their original deadline. Ordinary reads, bootstrap, browsing, linking, logout, retries and projection do not renew it. Expired/missing/legacy-default authority is OFF; missing cookies/body hints are neutral to valid server authority, while false hints can only restrict it. Choice-copy cleanup does not change behavioral retention, owner grants or erasure witnesses. Tracking-only measurement remains permitted; both switches are required for personalization. Current-grant self-access to already-stored historical analytics remains available without new behavioral writes, retention refresh or provider effects.

In enforced mode, validated JSON/CSV imports also require acknowledged audit admission before identity/config/erasure reads or import effects, and an acknowledged result before the normal report is released. The tenant-admin audit view records each input ordinal and behavioral/profile kind with individually keyed supplied account/shopper/visitor references; it never records raw rows, traits, source names, audiences or caller-bearing skip messages. Successful results separately record actual visitor/shopper target applied counts and skipped ordinals with fixed reason codes, not an applied-row-to-target mapping. Five-input chunks support all1000 rows in at most200 admission records; result chunks contain at most10 aggregate/skip members. Each detail is bounded at2048 UTF-8 bytes; import-only phases allow200 records/1MiB, while older operations retain100 records/512KiB. Each complete phase uses one acknowledged atomic audit statement, not a transaction with profile stores. Post-entry exceptions, malformed receipts or result-acknowledgement failure yield sanitized503 with correlated `requestId`, `outcome:outcome_unknown`, `operationMayHaveApplied:true` and audit status; earlier effects may remain, with no rollback, applied-zero or safe-retry claim. Open/demo retains its existing unaudited responses and errors.

JSON also accepts `{ kind: "profile", version: 1, source: "crm", visitorId: "…", at: "2026-09-01T00:00:00Z", fields: { tier: { type: "string", meaning: "Declared loyalty tier", value: "gold" } }, audiences: { vip: "Provider-defined VIP membership" } }`. Each row is a complete replacement for one source: omitted fields/memberships are withdrawn. Types are `string`, finite `number`, `boolean`, and `string-set`; no coercion or invented event weights. Keys use1–64 ASCII letters/digits/underscore/hyphen excluding prototype names; values are at most256 characters, meanings512, string sets32 elements, fields/audiences32 each. A profile holds at most8 sources and64KiB serialized enrichment. Future snapshots refuse; older rows skip; identical equal-time retries skip without writes; conflicting equal-time payloads fail. Empty maps withdraw values/memberships but retain the source/time replay watermark, not full privacy erasure. Link merges sources with the same ordering/conflict/bounds rules; local erasure removes the co-located snapshots. Only applied behavioral rows increment historical-event counts.

Typed CSV is profile-only per file; JSON can still mix profile and behavioral rows. Required headings are `kind,version,source,at,fields,audiences` plus at least one of `account_id,shopper_id,visitor_id`. Existing camel-case identifier and `time`/`timestamp` aliases are accepted; headings are trimmed and case-insensitive. Every row explicitly supplies `profile,1`, a source, time, identifier and JSON-object cells for fields and audiences. Empty maps are `{}`, never blank cells. For example:

```csv
kind,version,source,at,visitor_id,fields,audiences
profile,1,crm,2026-09-01T00:00:00Z,visitor-123,"{""tier"":{""type"":""string"",""meaning"":""Declared loyalty tier"",""value"":""gold""}}","{""vip"":""Provider-defined VIP membership""}"
```

CSV supports quoted commas, doubled quotes, embedded quoted newlines and CRLF/LF/CR record delimiters. Only truly empty records are ignored; delimiter-only, quoted-empty or whitespace-only records are data. Each data record must match the header width. Empty, prototype-named, duplicate normalized/aliased headings, malformed quoting and unknown typed columns refuse. Any `kind`, `version`, `fields` or `audiences` heading declares typed intent: missing or invalid typed metadata never falls back to behavioral import. Legacy CSV retains its action/time/product columns and numeric conversion; a `source` column alone remains a product attribute. Invalid UTF-8, CSV syntax or row/schema input returns400; actual byte or data-row overflow returns413, before import effects. CSV uses the same typed values, meanings, replacement, replay and consent/identity/erasure rules as JSON; quoted JSON values are not coerced or inferred.

Published local audience rules can target `external.crm.tier`; precomputed membership is `external.crm.vip`. Existing consent-safe segment and personalization reads qualify current typed-plus-live inputs, including after replacement; live events and object alarms preserve these memberships. Values and provenance remain separate from behavioral counters, numerical affinity and decision-provider attributes. This delivers local typed segmentation, not numerical content/product score mapping, S3 adapters, scheduled warehouse sharing, purchased-data rights approval, transactional replay/erasure or customer acceptance. Field meanings and usage rights must be established by the data owner.

## 4. Content and configuration documents

Four documents per brand, each with the same seven routes. `kind` is `catalog`, `slots`, `learn` or
`priors`; `scope` is the brand. A fifth, optional document, the attribute vocabulary (`kind` `vocabulary`),
has the same routes and an approval of its own ([below](#the-attribute-vocabulary-contentvocabulary)). Two more
optional documents have the same routes: the import-sources list (`kind` `import-sources`) and the approved
layouts (`kind` `layouts`, [below](#the-approved-layouts-layouts)). Any other `kind` is refused `404`:
`kind must be catalog, slots, learn, priors, vocabulary, import-sources or layouts`.

| Route | Auth | Does |
|---|---|---|
| `GET /content/{kind}?scope=` | operator | The explicitly published document, with `source: stored`, `revision`, `publication`, `actor`, `note`, `at`, and `envelope: { pieces?, products?, bytes, limitBytes }`: the document's canonical UTF-8 size and the 2 MiB ceiling it is stored under, with the piece count (the shared pieces and every part's records) on the catalog only and, for a catalog in parts, the number of products its sharded index names (the document carries the index's shard pointers, never the whole product list); on the catalog, `&shard=<hex2>` answers one index shard instead (`shard`, `digest`, `document: { shard, products }`, `envelope`; empty for a shard the index does not list, `400` for anything but two lowercase hexadecimal digits; on a catalog stored in parts before this release, every shard answers empty until its first PUT, import, pull or rollback converts it, while `&product=` and the product page serve it from the one-level form), and `&product=<productId>` answers that product's part through its shard (`product`, `digest`, `document: { product, pieces }`, `envelope`), `404` naming a product the index does not hold, `503` `part_unavailable` for a part or shard the store no longer holds (see the payload schemas, The catalog in parts) |
| `GET /content/{kind}/history?scope=` | operator | Latest 50 revision summaries: number, version label, actor, note, time |
| `GET /content/{kind}/revisions/{n}?scope=` | operator | One past revision |
| `POST /content/{kind}/validate?scope=` | operator | `{ document }` in, `{ valid, errors[] }` out: every error, not the first |
| `PUT /content/{kind}?scope=` | operator | `{ document, note }` in; `{ ok, revision, version, document }` out, or `422` with `errors[]`. On a catalog in parts the document carries its `index` exactly as read (any other shard pointer refused `422` naming the shard) and removes products only by `removeProducts: ["<productId>", …]`: at most 10,000 names in one request (10,001 refused `422` naming the limit), and removing N products reads their N parts in that one request |
| `POST /content/{kind}/rollback/{n}?scope=` | operator | Writes revision `n` forward as a new revision. On a catalog in parts it first checks the index shards it brings back that the revision in force does not name and the parts inside them that differ: `410` `part_missing` naming one the store no longer holds, `413` `rollback_too_large` with the count past 900 checks |
| `PUT /content/priors?scope=&note=` with `Content-Type: text/csv` | operator | The priors document from the CSV a warehouse exports |

Slots current GET, successful validation, PUT and rollback add `pinDiagnostics: {schema: 'slot-pin-diagnostics/v1', advisory: true, status, slotsRevision, catalog: {source, revision}, checkedAt, warningCount, omittedWarningCount, warnings}`. A candidate has null `slotsRevision`; a successful write diagnoses its exact returned document, without rereading slots. An authorized explicit document with no pins is `not_required` with catalog `not_read`, null catalog revision/time and zero counts; it is not checked-catalog assurance. Legacy GET fallback, missing/corrupt/uninitialized catalog or optional-read failure reports `unavailable` with null counts/list/catalog revision/time. New catalog reads require typed canonical-tenant catalog authority in every auth mode and exact equality with the slot document scope; unbound legacy selectors report unavailable without catalog I/O, preserving the original slot operation.

Available pin feedback names the strict uncached committed catalog revision and observation time. At most50 samples use zero-based `pageIndex`/`slotIndex` and `reason: missing_piece | slot_type | currently_ineligible | off_limits | excluded | type_not_allowed | excluded_tag`; total/omitted counts include all warning occurrences, and no pin IDs or page/slot names are echoed. Hard off-limits/exclusion/type gates apply in addition to lifecycle, publish window, stock and slot-type eligibility, before pins and ranking. These warnings do not block scheduled, draft, missing or temporarily unavailable pins or rewrite documents. The existing Rules screen shows current/draft checks and the original save response; History retains the original rollback response summary with a Rules link. Catalog and slots remain independent: a later catalog change can invalidate a pin, runtime refusal/reservation remains authoritative, and feedback is neither an atomic activation guarantee nor persisted receipt metadata.

The slots current GET also adds `constraintDiagnostics: {schema: 'slot-constraint-diagnostics/v1', advisory: true, status, slotsRevision, catalog: {source, revision}, checkedAt, warningCount, omittedWarningCount, warnings: [{page, slot, contentId, reason, dimension?, value?}]}`: the operator's home for the refusals a decision set's own `constraintDiagnostics` names one page load at a time (below), read for the whole stored document. Each page is decided as serving decides it — the strict uncached committed catalog revision, eligibility at `checkedAt`, the page's pin reservations and its compiled hard controls — so only a slot that ranks contributes (not off-limits, with ranked positions left after its pins, and with no refused pinned prefix), and only a piece that slot could otherwise have served is named (live, inside its window, in stock, and naming the slot in its `slotTypes`). Every refused eligible piece is counted; at most 50 are named, in page order, then slot order, then catalogue order, and `omittedWarningCount` is the rest; an excluded-tag refusal names the published pair that matched. Unlike the pin channel it names pages, slots and piece ids, because those are what a merchandiser acts on. A document that publishes no hard control is `not_required` with zero counts and catalog `not_read`; a legacy GET fallback, an unbound selector or a catalog that cannot be read is `unavailable` with null counts, list, catalog revision and time, never a zero nobody checked. It is advice, never serving authority: the runtime decision stays authoritative, and a later catalog change or the passage of a publish window can change the answer.

Learn successful validation and PUT add `diagnostics: {advisory: true, omittedWarningCount, schema: 'learn-conversion-diagnostics/v1', status: 'available', warningCount, warnings: [{code: 'conversions_omit_slot_reward', consequence: 'undeclared_pieces_earn_nothing', reward, slot}]}`, keys sorted, only when a slot's `conversions` table does not name that slot's own reward: one warning per such slot in slot-name order (the order the published document keeps, the same on both doors), at most 50 listed, `warningCount` all of them and `omittedWarningCount` the rest. The document is still published or validated exactly as without it; the member is computed from the answer's own document with no read, a document that warns nothing answers byte for byte as before; the current `GET /content/learn` carries the same member as its last member when the stored learn document in force (or the compiled default) has such a table, computed on the read and never stored, and the console's Dials screen shows it on open, while the history, revisions and rollback never carry it ([success events and conversion tables](03-payload-schemas.md#success-events-and-conversion-tables)).

Current slot validation/publication accepts absent/1/2/3/4 markers and emits `governanceVersion: 3`, or `4` for a
document marked 4 and for an unmarked document that declares a layout slot or carries per-context orders (below), with optional per-slot
`offLimits`, exact `excludedPieceIds`, OR `excludedTags` pairs and `allowedTypes` controls ([schema](./03-payload-schemas.md#hard-slot-controls)). A content slot declared `scope: 'anchor'` (a carousel of the product's own images, say) serves only the pieces whose `featuredProductIds` name the anchor product the request names as `ctx.anchor`: a piece naming that product alone is a candidate for every variant, and a piece naming a variant beside it only when the request names that variant as `ctx.variant`; a piece of another product, or of no product, never is, on any arm. A request that names no anchor, or an anchor no piece names, decides the slot empty (`[]`), so the page keeps its default. The scope only withholds: it adds and boosts nothing. The browser SDK sends the page view's `productId` as `ctx.anchor` and its `variantId` as `ctx.variant`, on the query string or in the body, each only when it is 1 to 64 characters after trimming; each record of the slot names the scope (`explain.scope`).
Off-limits slots return no engine candidates, decisions or records on any arm, including pinned
slots; their pin and ranking settings remain dormant. The one exception is a page's declared layout slot
marked off-limits, which writes a single record naming why to the ledger and the export, never to the
shopper's decision ring and never on the answer ([the layout reason](./03-payload-schemas.md#the-layout-reason)). Excluded IDs cannot reach scoring, exploration
or diversity, and an active excluded pin is rejected at publication. No arbitrary replacement is
chosen. A decision set whose published hard controls refused a piece the slot could otherwise have served carries advisory `constraintDiagnostics: {warningCount, omittedWarningCount, warnings: [{slot, contentId, reason: off_limits | excluded | type_not_allowed | excluded_tag, dimension?, value?}]}`, in the same bounded-sample idiom the catalog and pin channels use: every refused eligible piece is counted, at most50 are named in slot order then catalogue order, `omittedWarningCount` is the difference, and an excluded-tag refusal names the published pair that matched rather than leaving a merchandiser to guess which of up to 1000 pairs applied. A slot that refuses nobody, a slot the composer never ranks and a retained receipt replayed before these controls existed carry no such member at all, so a slot that comes back short says which control emptied it instead of reading as a thin catalog. It is advice, never serving authority, and is never carried on a stored record; the operator reads the same refusals for the whole stored document on the slots current GET (above). Exact rendering types match `piece.type`, not affinity tags. Tag matching is literal for explicit own tags;
only absent own `contentType` uses the existing safe rendering-type fallback, equally on every arm, unless the
catalogue declares `"typeFallback": "retired"`, under which only the own tag matches ([the module-type dimension](#the-module-type-dimension-and-module-engagement-teaching-moduleengagementweight)).
Rules edits these controls and exact JSON-string/ordered-array/null pins through existing validate/save/readback and History rollback, and on a declared layout slot the per-context orders (`layout.orders`, a JSON array; `[]` or null clears) the same way;
it never changes take automatically. On a declared layout slot it also edits the modules pinned at a position (`governance.positionPins`) and the off-limits modules (`governance.offLimitsPieceIds`), each a JSON array that `[]` or null clears, and writes either member only when the operator authors it. Catalog-dependent tag/type pin conflicts warn at publication and refuse at runtime.
Missing or unreadable service slot configuration now yields no selections (`sources.slots` is
`{version:null,revision:0,count:0}`), not compiled slots; the authoring API still offers defaults for
explicit publication. Related documents can use one coherent revision-set activation; serving retains the bounded cache described below, so this is not immediate
activation or a customer-default rendering guarantee.

New receipts independently carry `inputs.replay.governance: "slot-gates-v2"`; `slot-gates-v1` keeps only ID/off-limits
gates, and absence retains old selection, including compiled zero-version slot replay. Unknown explicit markers refuse. Off-limits
manifest rows keep page order with zero lift/prior and require no archives. Old unversioned stored
documents ignore all formerly unknown hard-control fields; stored version 1 validates ID/off-limits and ignores tag/type fields;
stored version 2 validates tag/type controls but ignores formerly unknown prefixes; version 3 validates prefixes too.
Historical bytes are never migrated or rewritten.

Version 4 adds one member, the layout declaration: `layout: true` on one slot of a page (the snapshot's
"A declared layout slot" above says what it returns and how it is measured). It is refused by name
(`pages.{page}[i].layout`) in a document marked 1, 2 or 3, and a second declaration on the same page is
refused naming the page and the slot (`pages.{page}.{slot}`); its `take` keeps the 1–50 bound of every
slot. Otherwise version 4 reads exactly as version 3, a stored document marked earlier ignores the member,
and versions above 4 refuse. A page that declares a layout slot writes
`inputs.replay.layout: "declared-slot-v1"` on every receipt of that page, beside the other markers and independent of them; a
page that declares none writes exactly the markers it wrote before. A replay of a record without the
marker decides the page without the declaration; a present marker with another value, or over a page
revision that declares no layout slot, refuses as `invalid page replay manifest`.

Version 4 also carries the layout slot's per-context `orders`: `[{ context: { channel, visitBuckets }, modules }]`
(the snapshot's "A configured order per context" above says what a shopper is served). Publication —
`PUT /content/slots`, a slots document published as a `publicationChanges` member of any `PUT /content/{kind}` (its kind matched in any case, a refusal of an order against the catalogue prefixed with `publicationChanges[i]` while a structural refusal of the member names its own path, the whole request refused and no member written), and `POST /content/slots/validate` alike — refuses with `422`, naming the order and
the offending value in `errors[]` and writing no revision, an order that names a module no piece of the
published catalogue registers for the slot (a piece with that `id` whose `slotTypes` names the slot), a
module the slot's excluded tags or allowed types refuse, a module the slot excludes by id or another slot
of the page pins, or one module twice; a context outside the six channel words, `any` and the visit
buckets (`unknown` is not a context word), or naming a `device` other than `mobile` or `desktop`; two orders for one context; two contexts that match one shopper
with equal specificity; an order on a slot that is not the page's declared layout slot or that is
off-limits; an order that does not keep the slot's pinned modules at their positions; and an order of no
module or of more than `take` modules. A write marked 1, 2 or 3 that carries `orders` is refused naming
`pages.{page}[i].orders`; an unmarked write that carries them is read under version 4. The catalogue an
order is checked against is the one published in the same request (the primary document or a `publicationChanges` member of the catalogue kind, in any case of the word) or else the one
in force; when it cannot be read the write is refused with `503` rather than published unchecked. A later
catalogue change is not refused: the decision then serves the order without the module it lost. A
decision on which a configured order was served writes `inputs.replay.orders: "configured-order-v1"`
beside the other markers, and every other decision writes exactly the markers it wrote before; a replay
of a record without it decides the page without its orders, and a present marker with another value, or
over a page revision whose layout slot carries no orders, refuses as `invalid page replay manifest`. The
record of every position the order set carries `explain.configuredOrder: { context, modules }`, the
context it was published for and the whole order, compared by value in replay.

Version 4 also carries the layout slot's `positionPins: [{ pieceId, position }]` and `offLimitsPieceIds`
(the snapshot's "Pins at a position and off-limits modules" above says what a shopper is served).
Publication — `PUT /content/slots` and `POST /content/slots/validate` alike — refuses with `422`, naming
`positionPins` or `offLimitsPieceIds` and the module in `errors[]` and writing no revision: a position
outside 1 to `take`, or within the slot's prefix pins; two modules pinned at one position; one module pinned
twice, by two position pins or by a position pin and a prefix pin; a module both pinned and off-limits; a
position pin the slot excludes by id or another slot of the page pins; a pin or mark that is not exactly
`{ pieceId, position }` or a module id; either member on a slot that is not the page's declared layout slot,
or position pins on a slot pinned whole by `pinnedPieceId`; and a configured order that does not list every
module pinned at a position at that position. A write marked 1, 2 or 3 that carries either member is
refused naming it; an unmarked write that carries them is read under version 4. A module pinned at a
position that the catalogue does not register, or that its tags or type refuse, is not refused at
publication: the decision refuses the slot for it (decision D1). A decision on which a position pin or an
off-limits mark decided something — a module pinned at a position placed, a slot refused for one, or an
off-limits module the slot could have ranked held or withheld — writes
`inputs.replay.moduleRules: "module-rules-v1"` beside the other markers, and every other decision writes
exactly the markers it wrote before; a decision on which the configured order supplied an off-limits
module's baseline position while the slot's exploration picked writes the orders marker as well. A replay
of a record without the marker decides the page without its position pins and off-limits marks, and a
present marker with another value, without the layout marker, outside the current pin policy, or over a
page revision whose layout slot carries neither, refuses as `invalid page replay manifest`. A pinned or
held module's record has authority `pin`, no `ranking_position`, zero lift and prior versions and a
single candidate; a ranked position's `ranking_position` counts only the ranked positions before it. The
record's `explain.moduleRule` is compared by value in replay, so a decision under position pins and
off-limits marks replays exactly; a retained document with prefix pins decides and replays as before.

The learn document's layout-blend opt-in, `slots.{slot}.blend` (the snapshot's "The layout blend" above
says what it serves), is `{ p }` and nothing else, `p` a number from 0 to 1. Publication —
`PUT /content/learn`, a learn document published as a `publicationChanges` member of any
`PUT /content/{kind}` (its kind matched in any case, the whole request refused and no member written),
and `POST /content/learn/validate` alike — refuses with `422`, naming the blend in `errors[]` and writing
no revision, a `p` outside 0 to 1 or any other member (the dial's own path, `slots.{slot}.blend`), and an
opt-in on a slot that is not a page's declared layout slot in the slots document the same request
publishes (the primary document or a `publicationChanges` member of the slots kind, in any case of the
word) or else the one in force (a refusal of a related member prefixed with `publicationChanges[i]`).
When that slots document cannot be read the write is refused with `503` rather than published unchecked.
A later slots change is not refused: the decision applies the blend only on a slot that declares the
layout, and decides any other slot exactly as before. A stored learn document whose blend the current
contract refuses still reads, with the blend dropped. A decision on which a slot ranked its modules by
the blend writes `inputs.replay.blend: "layout-blend-v1"` beside the other markers (a blended decision
under a configured order writes the orders marker too, and replays both), and every other decision
writes exactly the markers it wrote before; a replay of a record without it decides the page without the
blend, and a present marker with another value, without the layout marker, on a decision without the
learning layer, or over a learn revision in which no declared layout slot of the page opts in, refuses
as `invalid page replay manifest`. The record's `explain.blend` is compared by value in replay.

The slots document's `signalFloor` (the tenant's floor) and a slot's own `signalFloor` (the snapshot's
"The signal floor" above says what a shopper below it is served) are read under every governance version
and do not by themselves change the version a write is stamped with: an unmarked write that carries a floor
and declares no layout slot is stamped 3, and a document marked 4 carries a floor with or without a layout
slot. Publication — `PUT /content/slots`, a slots document published as a `publicationChanges` member, and
`POST /content/slots/validate` alike — refuses with `422`, naming the floor in `errors[]` and writing no
revision, a `signalFloor` of `never` on any slot but the page's declared layout slot
(`pages.{page}[i].signalFloor`), `never` as the tenant floor (`signalFloor`), and any floor that is not a
whole number of 0 or more (a fraction, a negative number, a number written as text). A decision on which a
slot was decided below its signal floor writes `inputs.replay.signalFloor: "signal-floor-v1"` beside the
other markers and the count it was decided with as `inputs.signals`, and every other decision writes exactly
what it wrote before; a replay of a record without the marker decides the page with no floor, and a present
marker with another value, on the holdout's `default` arm, without a whole count, or over a slots revision
whose floors hold no slot of the page below that count, refuses as `invalid page replay manifest`. The
record's `explain.signalFloor` is compared by value in replay.

The context-only switch (`contextOnly: { enabled, region? }`, a version-4 member kept exactly as authored) is set
only on a page's declared layout slot: publication refuses it on any other slot with `422`, naming
`pages.{page}[i].contextOnly` and the slot in `errors[]` and writing no revision; a value that is not
`{ enabled: boolean, region?: boolean }` is refused the same way, and a write marked 1, 2 or 3 that carries it is
refused naming the version (an unmarked write that carries it is read under version 4). A decision on which a
switched slot was decided for its context writes `inputs.context_only` (the device class and the admitted region
it was decided with, keys sorted, each only when there was one) beside the page's other inputs, and every other
decision writes exactly what it wrote before; a replay decides the slot in the same context, hashing exploration on
the same key, and refuses as `invalid context-only inputs` a record whose page revision and arm and whose inputs
disagree.

`pinnedPieceIds` pins a required ordered prefix (up to 50 distinct exact nonempty IDs, [] neutral),
followed by ranking up to total take. It is mutually exclusive with scalar `pinnedPieceId`, even with [].
Scalar pins keep take 1; no editor changes take automatically. One missing, ineligible, forbidden or
conflicted prefix pin refuses the whole slot and releases all its reservations; positions never compact
around a failed pin and no replacement asset is selected. Positional advisory samples add zero-based
`pinIndex`; the existing 50-sample/count/authority bounds still apply. `/learn/slots` adds ordered
`pinnedPieceIds` and `rankedCapacity`, while preserving scalar `pinned`; mixed slots still need tail evidence.
New receipts independently mark `pins: "prefix-reserved-v2"`; old pin markers keep their exact semantics.
Only ranked current records add zero-based `ranking_position`; pins retain singleton candidates and zero
lift/prior. Replay validates physical pin identity and the ranked ordinal, reserving all page pins but
running only required earlier ranking. Raw/hourly exploration counts the first ranked opportunity.
Compatible readers/UI/report workers must precede controlled format-3 publication. Earlier versioned
readers reject format 3 and may retain cached earlier revisions; this is not rollout or immediate-effect assurance.
Deploy compatible readers/workers/UI before publishing controls: pre-governance readers can ignore them,
whereas version-1 readers reject stored version 2; either can retain older cached revisions.
Binary rollback after governed publication needs explicit operator configuration restoration or withdrawal first.

A tag pin, `pinnedTag: { dimension, value, window: { from, to } }` on a content slot (governance 3 or later), pins
the item carrying a tag instead of an item identifier, for a window, `from` inclusive, `to` exclusive (both
ends required, ISO 8601, `from` before `to`; the piece window's own comparison, by the decision's clock), the
best-ranked eligible candidate carrying the tag (after an anchor scope narrows the candidates, so a carousel shared
by every product page leads with each page's own item) leads the slot on every arm, authority `pin`, never ranked
nor explored, its record and receipt naming the pin (`explain.pinnedTag`); the other positions rank as without it,
and before and after the window the slot decides exactly as without it. It is mutually exclusive with
`pinnedPieceId` and `pinnedPieceIds`, refused by name beside either. A tag pin in its window that no eligible
candidate satisfies refuses nothing: the slot decides as without it and `pinDiagnostics` names it as
`{ pinnedTag: { dimension, value }, reason: 'unmet_tag_pin', slot }` (counted with the entries beside it, as
`module_not_returned` is); an item pin that is missing, ineligible or excluded still refuses the whole slot.

A slot's `minimum: { dimension, value, count, within }` is a guarantee, enforced and never weighted: on every arm
the engine ranks (the holdout's default arm included), after the slot's pins and its ranking (bands, exploration
and the diversity rule included), at least `count` items carrying the tag stand in the first `within` positions
whenever that many are eligible, and all of them when fewer are. The best-ranked items carrying it come into those
positions, the lowest-ranked items there not carrying it leave and follow at once, before the rest of the take; a
pinned item (a prefix pin, a tag pin's item, a position pin, a held off-limits module) counts when it carries the
tag and never moves. Each decision the rule moved, in or down, names it on its record and receipt
(`explain.minimum`, with `from`, the position it held without the rule). `count` is an integer from 1 and `within`
an integer from `count` to the slot's take; a malformed rule, and a rule beside per-context `orders` (a slot
serving an order is not ranked), is refused by name. With a tag pin on the same slot the pin takes position 1 and
the guarantee counts it.

Two more for the catalog, both requiring the operator token, the seam your content system connects to:

| Route | Body | Does |
|---|---|---|
| `POST /content/catalog/import?scope=&format=json\|csv&mode=merge\|replace\|full&expire=&dryRun=1&path=` | the records | A JSON array (or an object with the array at `path`), or CSV with the columns in the payload schemas; `merge` upserts by id, `replace` is the whole catalog; an error names the record it refuses as `records[k] '<id>'`, k its position in the file sent (counted from 0 over every entry, an entry that is not a record included) and the id cut to 64 code units with `…` after it when cut (`records[k]` alone for a record with no id); `mode` is required: a load without one, or with another word, is refused 400 naming `merge`, `replace` and `full`, before anything is read or written. `full` replaces the catalog and keeps every stored item the file leaves out, after the file's items in stored order, with lifecycle `expired`; it requires `expire=<n>`, the number of stored items the file leaves out (an item already expired included) (`428` without it, `409` naming the number when `n` is another, nothing written). A load whose result equals the catalog in force writes no revision and answers `skipped: true, reason: 'unchanged'` with the revision in force, `changed: 0`, `removed: 0` and its diagnostics. `dryRun=1` checks the file under the import's own rules (aliases, the merge, the vocabulary in effect) over the revision its `If-Match` names, with no `Idempotency-Key`, and answers what the import would plus `dryRun: true`, writing nothing. On a catalog in parts a load is also refused `422` with `code: "record_moved"` (a record the id index lists under another product the load does not carry, naming both products), `"id_in_part"` (a shared piece whose id a part record holds) or `"id_shared"` (a part record whose id a shared piece holds), each naming the id and the product; `413` with `code: "id_index_too_large"` when one of its id shards would pass 2 MiB, naming the shard; and `503` with `code: "part_unavailable"` when a product it names has a part the store no longer holds; `413` with `code: "index_shard_too_large"` when one of its index shards would pass 2 MiB, naming the shard and its number of products. The pull answers the same, and a PUT and `POST /content/{kind}/validate` of the catalog answer the `422` refusals (see the payload schemas, The catalog in parts). With an `import-sources` list published, a caller outside it is refused `403` (see the payload schemas) |
| `POST /content/catalog/pull?scope=` | `{ url, path?, mode, expire?, note? }` | The platform fetches your JSON feed over HTTPS and imports it; `mode` (`merge`, `replace` or `full`) is required as on the import, and `expire` goes with `full`, refused and skipped the same way; nothing is fetched when the mode is missing. The URL is `https:` (`http:` only on localhost, 127.0.0.1 or [::1], the loopback hosts), refused 400 otherwise; redirects are not followed (a 3xx answer is 502: `pull failed: source answered 301; redirects are not followed`, nothing written); and with the tenant's `import-sources` naming `hosts`, a URL whose host (with its port when it names one) is not listed is refused 403, before the preconditions and before anything is fetched |

An accepted import or pull answers `received` (records the request carried), `imported` (records that reshaped into candidate pieces), `pieces` (the stored catalog's size) and `changed`: how many stored pieces this operation created or altered, measured against the catalog it was published over rather than against the feed's row count, so a refresh that carries the catalog back unchanged answers `changed: 0`. A piece the operation removed is neither created nor altered and is not counted there: it is counted in `removed`, how many stored pieces this operation dropped, so a replace that leaves one of three answers `changed: 0, removed: 2` instead of saying nothing about the two that are gone, and a merge, which upserts by id and drops none, answers `removed: 0`. `changedBasis` says what both counts were measured against: `stored` when the base revision was read, or `unavailable` when it could not be — and then `changed` and `removed` are `null`, because a base nobody can read would otherwise be treated as an empty catalog and report every stored piece as created and every removal as none. CSV column names are matched exactly: a header that matches a documented column only when case is ignored (`Tags` for `tags`) is refused 422 naming the column the feed sent and the spelling the contract publishes, rather than read as an unknown column that would land every row with that field empty. The columns checked are the feed's own parsed header, so a header-only export, and one whose data rows are all blank, are refused with exactly the same words as an export with rows rather than reported as carrying no record. A column the contract does not list at all is imported and named in `diagnostics` below.

All configuration operations (content, slots, learning, Reflex, priors and retained proposals) require a typed access/service operator credential granted to the canonical tenant resolved at ingress (for example through `X-Tenant`) in every auth mode. Optional `scope`/`tenant` selectors must match it exactly and appear once. Reads use one explicitly initialized conditional-R2 revision set; there is no compiled-default, legacy-KV, empty-prior or missing-history fallback. Initialization is a library capability requiring approved supplied baselines and quiesced old writers. `initializePublicationSet` accepts all declared members in one intent. A member supplied as retained historical bytes (`retainedValue`) is read exactly as the retired store's own reader read it — `value` where the stored revision has one, otherwise `config` — so a Reflex revision stored with only `config` and a revision stored with `value` beside a duplicated `config` are both adopted as stored, and read back as the same revision written today; nothing is merged or rewritten. Existing catalog-v1 adoption requires the exact validated retained head digest and preserves immutable original envelopes, numeric IDs, operation receipts, history floor and index. Unsettled old pending work is held for authorized pre-cutover resolution; no live initialization, old-data migration or writer cutover is implied. Versions below that baseline report `legacy_history_unavailable`.

`POST /content/publication/initialize` creates a provisioned tenant's first configuration publication set, on every deployment profile. Its caller is a stamp owner in a personal session with a membership on the ingress tenant; anyone else is refused 401 or 403. No document is accepted: send no body (or `{}`); anything else is refused 400. It writes the six compiled defaults (an empty catalog, the default slots, learn settings and Reflex configuration, empty priors and proposals) at revision 1, attributed to the caller, and answers `state: "initialized"` with the set revision as `publication`. It is idempotent: a tenant with a committed set is answered `already initialized` with that set's revision and nothing is written; an initialization a failure interrupted is finished by the same call (`initialization finished`) with its original attribution; any other pending initialization is refused 409 and left as it is. Each set it writes is an operator audit row `publication_initialized`.

`POST /ops/demo-bootstrap?scope=` creates a demo tenant's first set on the demo profile, in development only, with the operator credential granted to the tenant: the four documents its caller supplies (`reflex`, `catalog`, `slots` and `learn`, each at revision 1 as supplied) and, beside them in the same initialization, `priors` and `proposals` as their compiled empties (no imported prior, no proposal) at revision 1, so the answer's `members` names all six and the tenant reads and publishes priors and proposals as a tenant initialized with the six compiled defaults does. A body that carries a `priors` or `proposals` document is refused 422 and nothing is written; publish priors through `PUT /content/priors` once the set exists. A tenant bootstrapped before the door seeded six holds a set of four members, and its priors and proposals reads (`GET /content/priors`, `GET /v1/{tenant}/learn/proposals`), like a priors publish, are refused with today's status and words followed by the missing member and the path: `Configuration publication authority unavailable: priors is not in this tenant's publication set; add it with POST /ops/demo-bootstrap/complete, which adds its compiled empty once and changes no other member`. `POST /ops/demo-bootstrap/complete?scope=` is that path, for a tenant bootstrapped with four members: on the customer profile it answers 404 and outside development 403, both before the credential, then it takes the operator credential (401 without one) and the tenant's grant (403 without it), and it adds the compiled empties of the two members the set lacks at revision 1 in one set publication that changes no other member, answering `{ added, members, ok, publication, scope }` with `added` naming the members it added. Taken again, or on a set that already has both, it answers `added: []` and writes nothing; a scope with no set is refused 503 `publication_uninitialized` and nothing is written (the door then creates it, with six). The hosted seed (`scripts/demo-kit/host.mjs`, its seed step) takes the path once for its tenant, right after the seed and before the redeploy, with the seed's operator token in the environment of the call.

`POST /content/publication/complete` is the customer profile's path for a tenant whose committed set has four members (`reflex`, `catalog`, `slots` and `learn`, the set a demo bootstrap made before it seeded six, which reaches a customer deployment only through a retained adoption) and so lacks `priors` and `proposals`. It is mounted on every profile beside the initialization door above and takes that door's authority in its order: a stamp owner in a personal session with a membership on the ingress tenant (401 without a credential, 403 for anyone else), and no document (anything but no body or `{}` is refused 400). On the customer profile, a stamp owner with a membership calls `POST /content/publication/complete` once to add `priors` and `proposals`, the compiled empties (no imported prior, no proposal), to a four-member set at revision 1, in one set publication that changes no other member, and is answered `{ added, ok, publication, state: "completed" }` with `added` naming the members added and `publication` the new set revision; that completion is one operator audit row `publication_initialized` with the state `completed`. Taken again, or on a set that already has both, it answers `added: []` and `state: "already complete"` with the committed set's revision and writes nothing; a tenant with no set is refused 503 `publication_uninitialized` and nothing is written (the initialization door then creates it, with six). On the customer profile, the reads of a four-member tenant's priors and proposals (`GET /content/priors`, `GET /v1/{tenant}/learn/proposals`), like a priors publish, are refused with today's status and words and name `POST /content/publication/complete`: `Configuration publication authority unavailable: priors is not in this tenant's publication set; add it with POST /content/publication/complete, which adds its compiled empty once and changes no other member`; on the demo profile they name `POST /ops/demo-bootstrap/complete`, as above.

Configuration PUT/PATCH, import, pull, rollback and item reset require `If-Match: "N/S/H"` from the actually loaded draft: document revision N, coherent set revision S and its 64-character lowercase SHA-256 digest H. Also retain `Idempotency-Key: N:UUID` (canonical decimal N and lowercase UUID) and the exact body before sending. Do not fetch a fresh base during Save or silently retry a conflict with a new identity. Read responses expose `publication:{revision,digest}`; Reflex exposes both effective `config` and immutable `authored` values. The old `"N"` form resolves only already-committed catalog-v1 receipts; it cannot authorize a new write. Missing headers return 428, invalid input 400/422, stale/conflicting operations 409 and unavailable/corrupt/unconfirmed storage 503. Each immutable member, set, head, catalog part and catalog index shard is limited to 2 MiB UTF-8 each; version labels to 4096 characters including the new revision suffix. Immutable historical bodies remain individually addressable after they leave the latest-50 index, unless the tenant sets the `configuration` retention category ([Conventions](#explicit-retention-configuration-and-erasure-reconciliation)). Then each configuration publication, after its own set commits, purges the bodies of the tenant's revisions that are older than the setting — counted from when the next revision replaced them — and are neither the current nor the previous revision of their kind nor named by a stored decision record (its catalog, slots, learning and Reflex revisions, and the prior revision its lift snapshot was built with). A purged revision keeps its history row and answers `410` with `code: "revision_purged"` on read and on rollback. The purge reads only the ledger hours in which a decision could have been served that revision, examines a bounded number of revisions per publication, keeps every revision it cannot show unnamed, and can never fail or delay into failure the publication it follows. A tenant without the setting purges nothing. A learn revision builds its salt count from the one before it where that one carries an exact count. Where the current learn revision carries none (a learn document published before this release, or a count that could not be finished), the purge keeps every learn revision, so the next learn publication can count over the whole stored history. So a purge never turns an exact `saltVersion` into an unknown. Rollback writes the historical value forward as a new revision.

`GET /content/catalog/publication?kind=catalog|slots|learn|reflex|priors&memberScope=` discovers committed revision, historical floor and any pending operation's ID/base/original actor/digest. The same headers optionally inspect a particular operation. After a failed or ambiguous publication, `POST /content/catalog/publication/recover` with its original headers finishes that retained intent, preserving its attribution; another currently granted operator can recover it. It accepts no replacement body and never refetches a feed. Pending intent has no expiry; other writers conflict until it finishes. `publicationChanges:[{kind,document}]` on a document PUT publishes up to five additional same-tenant members in the same activation; no secondary member becomes visible early. Missing members or inconsistent retained intent fail closed before recovery writes. Repeating an identical ordinary write returns its retained receipt; pull rejects pending/stale bases before fetching, so use status/recover after an uncertain pull.

All configuration administration bypasses the serving cache. One serving operation pins the same committed set for its catalog, slots, learning and Reflex dependencies; statistics pin matching learning/prior authority. Serving snapshots are immutable, keyed by bucket and tenant, and expire within 30 seconds of the read's start; an already in-flight read may finish later. The cache is bounded to 32 bucket/scope entries and 8 MiB including retained member bodies; mutation and recovery invalidate in-flight admissions. A verified cached set can serve until expiry to a read by the same storage handle, and failures never refresh it or substitute empty/default configuration. A new shopper operation reads behind a storage handle of its own, so it reads and validates the publication head once and refuses with `503` when it cannot read it; a set the head names that this isolate already holds for the same bucket is reused with the member documents already read under it, and a set committed elsewhere is served from that operation on. R2's same-key write rate limit can leave reservation/finalization pending and return 503; status/recovery is required, with no rapid-publication or deployed latency guarantee. This coherent local publication protocol does not establish a deployed propagation SLO or customer immediate-effect acceptance. Actual initialization, legacy-writer cutover and live acceptance remain separately authorized.

Current catalog GET, successful catalog validation, PUT, import/pull, rollback, recovery and human-approved enrichment publication also return `diagnostics` with `schema: 'catalog-registry-diagnostics/v1'`, `advisory: true`, `status`, `catalogRevision` (null for a validation candidate), current `registry: {scope, source, revision, version}` and `slots: {source, revision, version}`. `slots` names the slot-type vocabulary the pieces were compared against: the tenant's own published slots document, else the compiled fallback the engine would decide from, else `unavailable` when that document cannot be read — and then no `unknown_slot_type` warning is raised at all, because an outage must never invent one. A slots outage costs the channel only its slot-type advice and never turns the registry's own answer into one. This diagnoses the exact response/committed catalog against an uncached tenant registry read, not a second catalog read. Missing configuration (including demo scopes), corrupt/oversized data or a read failure yields `status: 'unavailable'`, registry source `unavailable`, null registry revision/version, and null warning counts/list. Optional diagnostics cannot turn an already committed publication into a failure.

Available diagnostics contain `warningCount`, `omittedWarningCount`, `counts` and at most50 `warnings`. `counts` is the exact number of occurrences of every code present, keyed by code, with no key for a code that did not occur: the sample is bounded and these are not, so an operator learns how much of each defect the catalog and the request carried even where the cap cannot show it. `unknown_dimension` means an exact tag key is absent from the registry, from its learned `dimensions` and from its `gateDimensions` alike (a gate dimension is known to the catalogue and never learned); `no_nonempty_registered_tags` means a piece has no nonblank value on a registered key. Only an absent own `contentType` tag can count the shared safe render-type fallback when a non-derived `contentType` dimension is configured; explicit empty tags do not fall back. `case_variant_value` means two or more spellings of one value on one dimension differ only by case (`{code, pieceIndex, dimensionIndex, dimension, dimensionTruncated, values, valuesTruncated}`): they are two values to every scorer, so one of them is taxonomy the feed cannot see. `values` echoes the exact spellings, sorted, at most20 of them and each at most64 code units, because naming the defect without naming the spellings would not let a content team fix the row; nothing is rewritten and both spellings stay stored. `unknown_slot_type` means a piece names a slot type no page of the tenant's own slots document defines (`{code, pieceIndex, slotType, slotTypeTruncated?}`): the piece is stored whole and refused by nothing, it is simply eligible for no slot this tenant publishes, so nothing will ever serve it. `ignored_field` means the request carried a field (JSON) or column (CSV) the published contract does not list (`{code, recordIndex, field, fieldTruncated}`), so it reached no stored piece; `recordIndex` is the record's position in the REQUEST, which on a merge is not the position of the stored piece it refreshed. On an import or a pull, each warning of the four piece codes (`unknown_dimension`, `case_variant_value`, `no_nonempty_registered_tags`, `unknown_slot_type`) whose piece a record of the file sent wrote also names that record: `recordIndex`, its position in the file sent (counted from 0 over every entry, an entry that is not a record included: the number `ignored_field` carries), `recordId`, its id cut to 64 code units, and `recordIdTruncated`; `pieceIndex` stays the stored position, and a stored piece a merge did not carry names no record. `ignored_document_field` means the submitted catalog DOCUMENT itself carried a key beside its `pieces` and its optional authored `version` (`{code, field, fieldTruncated}`), so it reached no stored document; it belongs to no record and therefore carries no position at all. How a request carries its catalog is never named: a PUT body's own `document`, `note` and `publicationChanges`, and a feed export's records key (`pieces`, `content`, `items`, `data`, or the key `?path=` names), are the envelope, not fields of the catalog. These two are the request-derived codes: import, pull, catalog validation and catalog PUT answer them for what that write carried, and a read never carries them, because a current GET, rollback, recovery and enrichment publication diagnose the stored catalog alone. The field set a record is read against is the feed adapter's accepted spellings on import and pull, and the catalog validator's own closed field set on a direct PUT or validation, which is never routed through the feed normalizer. Warnings computed from the stored catalog use zero-based `pieceIndex` and, for unknown keys, `dimensionIndex`, a maximum64-code-unit `dimension` display and `dimensionTruncated` flag; a request-derived warning uses `recordIndex` instead, and the two are never spelled the same way because they are not the same number. Counts include all warning occurrences beyond the sample limit, and the bounded sample is the first occurrences in the order they happened except that a code the cap would hide entirely is given one slot, taken from the most-represented code in the sample, so no whole class of defect can disappear behind the bound; IDs are not echoed on a PUT, a validation or a read (an import's and a pull's piece warnings name their record, as above), and tag values only as the bounded `case_variant_value` spellings above. When the registry in force registers `moduleType`, available diagnostics also carry `dimensionRoles`, the role of each role-bearing registered dimension in the registry's order (`{ "moduleType": "module_type", "contentType": "content_format" }`, the content-format role only when `contentType` is registered), so a module-type tag and a content-format tag are named as different things; a registry without `moduleType` carries no such member. They also carry `typeFallback: { retired, pieceIndexes }`, beside the warnings and never among them, so `warnings`, `counts` and `warningCount` are what they were: under the catalogue's `"typeFallback": "retired"` marker `retired: true` and the stored index of every piece without its own `contentType` tag; without it `retired: false` and the stored index of every piece the fallback scores (no own `contentType` tag, a usable `type`, and a slot type naming a slot of the tenant's slots document that weighs `contentType`, excludes a `contentType` value or spreads over `contentType`), the member absent when the fallback scores no piece or the slots document cannot be read. This is dimension membership/nonblank/case-collision and unlisted-field feedback, not value vocabulary, case/locale normalization, learning readiness or proof that an item cannot rank. Catalogs remain accepted under their existing schema. Historical reads and noncatalog responses are unchanged. Diagnostics are not persisted in receipts, may change on an idempotent retry as the current registry changes, and are not activation approval, an atomic catalog/registry snapshot or a serving-cache attestation.

Item reset first retains the exact authored learning-publication intent, then rechecks current human account/session/membership before the destructive object continuation. `resetCompleted:true` with `publicationOutcome:'unknown'` means deletion committed but publication is unconfirmed, not a safe new Reset. Keep the same identity and use its publication-only exact retry; it cannot delete subsequently accumulated state again. Console, learning and Meridian retain bounded pending intents across same-tab reload. Local persistence failure keeps the original identity; only an explicit original-status `publication_conflict` permits confirmed discard/re-authoring. Unknown outcomes are never discarded automatically. Withdrawn autonomous proposal application remains withdrawn.

The reflex configuration, the registry of dimensions and the engine's constants per brand, has the same
shape under `/config/reflex` (`GET`, `PUT`, `PATCH`, `history`, `revisions/{n}`, `validate`,
`rollback/{n}`); every route requires the operator access token, including merged-patch validation. `PUT` and `validate` take `{ config, note }`, or the bare document as callers written before that envelope send it; both forms validate and publish exactly the same revision. The tuning page and the learning console are clients of these routes; there is no
other way to change what the engine does.

That document also carries the optional `journey` block, the thresholds the reported journey stage is
derived from: `{ "stages": [ { "stage": "thinking", "anyOf": { "interactions": 3 } }, { "stage": "deciding",
"anyOf": { "purchases": 1 } } ] }`. The stages are named in the order `exploring` → `thinking` → `deciding`;
the first stage is the floor a shopper starts in and carries no threshold of its own. A rule is met when ANY
named counter of the CURRENT VISIT reaches its whole-number threshold; the counters are `interactions`,
`product_views`, `purchases`, `cart_adds`, `wishlist_adds` and `category_dwell_ms`. The block is validated
with the rest of the document, so an invalid set is refused at publication and the last published revision
keeps deciding. Publish no block at all and the engine's own compiled default decides — `thinking` at the
third interaction, `deciding` at the first purchase — reported at `sources.journey.revision: 0` with
`sources.journey.version` naming the compiled default CONFIGURATION the set travels with, never your own
document's version, and `sources.journey.reason` saying so, so you can always tell the engine's default
from one of your revisions. The version a decision and a receipt name is otherwise this document's own
revision identity, because the thresholds are part of it. A block that was stored but can no longer be read
is never silently replaced by the default: the engine falls closed to the first stage, claims no version and
says so on `reason`.

### Negative preference: suppression with an expiry

That document also carries the optional `suppression` settings, published with `PUT /config/reflex` like the rest
of it, with no deployment ([schema](./03-payload-schemas.md#negative-preference-suppression-with-an-expiry)).
Negative preference is a suppression of a value for one shopper, with an expiry; it is never a negative weight.

```json
"suppression": { "actions": { "remove_from_cart": { "days": 30 } }, "purchase": { "days": 30 } }
```

- **The named actions.** Each action named under `actions` (`remove_from_cart`, the SDK's custom event: `client.emit.custom('remove_from_cart', data)`, `data.event` the name) suppresses, for that shopper, every registry value it carries for the action's window in `days`, counted from the action; the values are the ones the registry places, so a value your approved vocabulary governs is suppressed as its mapped id. The action weighs what the registry weighs it, 0 when the registry names no weight for it, so `remove_from_cart` builds no interest and is no signal for the signal floor.
- **The purchase rule.** `purchase`, when present, makes the rule active: a purchase (`purchase`, `checkout` or `order_complete`) strengthens every value it carries at the purchase weight as before, its `style`, `collection`, `color` and `priceBand` among them, and suppresses the value it carries on the registry dimension keyed `productType` for the purchase window. A second purchase of one `orderId` is dropped before the rule runs, so it neither strengthens nor suppresses twice. A registry with no `productType` dimension suppresses nothing on a purchase.
- **The windows.** Each window is a positive whole number of days; a window that names no `days` takes the default of 30 days for the suppression, so `{ "actions": { "remove_from_cart": {} }, "purchase": {} }` suppresses for 30 days each. A window of 0, a negative one, a fraction, one written as text or one over 36500 days refuses the write with `422`, naming `suppression` and `days` (`suppression.actions.remove_from_cart.days must be a positive whole number of days, at most 36500 (got 0)`); so does a member other than `actions` and `purchase`, a window that is not `{ days? }`, and an action name that is empty, a reserved key, padded with spaces, longer than 120 characters or `tick`, the engine's own re-evaluation. The action weights stay bounded 0 to 1000 as before.
- **What a suppression does.** While it is in force the suppressed value contributes no interest term to the content decision: the shopper's own interest in it is left out of the interest the page is scored on and of the learning cell's leading interest, before the population priors are blended in. The stored interest is not changed (`GET /realtime/reflex` still answers it), the piece stays eligible, and every context term applies as before: the arrival's seed rules, the population priors, the bonus for completing the request's anchor product (the matching piece is still served first on the page of the product it completes) and configured orders. At its expiry it lapses and the shopper's own interest decides again.
- **One value, two suppressions.** The later expiry stands, with the action that recorded it. An identity link carries every suppression in force on the anonymous shopper to the signed-in shopper unchanged, by the same rule; on an equal expiry the signed-in shopper's own is kept, so a link never shortens a suppression.
- **Where it lives.** Inside the shopper's existing reflex state on both hosts, written only when one is recorded and dropped once every one has lapsed; at most 64 per shopper, the earliest to lapse dropped first. A tenant without the settings records none and decides term for term as before, replay included. Every record of a decision made while one is in force carries `explain.suppressions`, and its receipt says so (receipts, below).
- **The buffered door and the history import.** A purchase delivered through the buffered door (`"processing": "buffered"`) on either host, or imported with `POST /v1/{tenant}/identity/events`, strengthens what it carries from its own time as before and, under the purchase rule, suppresses the bought `productType` for the purchase window counted from the event's own time, not from its arrival, so a purchase older than its window suppresses nothing; a second purchase of one `orderId` is still dropped before the rule. A buffered `remove_from_cart` records its suppressions the same way, each expiring the action's window after the event's own time, still at weight 0 (no interest and no signal; the answer says `interestApplied: false`); one older than its window records nothing, and every other weight-0 buffered action is dropped as before. The import skips weight-0 rows, so an imported `remove_from_cart` records nothing.
- **Stated limits.** The product sort, search, the interest hydrate and audience memberships read the stored interest.

### The module-type dimension and module engagement teaching (`moduleEngagementWeight`)

The registry document also carries the optional `moduleEngagementWeight`, published with `PUT /config/reflex`
like the rest of it, with no deployment ([schema](./03-payload-schemas.md#the-module-type-dimension-registry-draft)).
Absent, it reads as 0, the shipped state: a module engagement teaches exactly what a content click teaches.
Present, it is a finite number from 0 to 1000, on the action weights' scale; anything else refuses the write
with `422`, naming `moduleEngagementWeight`.

- **What it teaches.** Above 0, a module engagement — a `content_click` whose `contentId` names a module of the
  catalogue and whose `slot` the event's `page` declares as its layout slot, a slot the module names in its
  `slotTypes` — also adds the weight to the shopper's interest on each value of the module's own tags on a
  registered, non-derived dimension: its `moduleType` value (when the registry registers the module-type
  dimension, `{ "key": "moduleType", "source": "moduleType" }`) and its other tags, `contentType` among them.
  The free-text `type` is never one of them. What the click itself teaches is unchanged, at the click's own weight.
- **What it does not do.** It scales the shopper's interest update only: the click is a signal for the signal
  floor exactly when its own weight in the registry is above 0, whatever the module-engagement weight, the
  population counts receive what the click itself teaches and nothing more, and an action that builds no
  interest (its own weight 0) teaches no module tags either. A `content_click` on any other slot, and a click
  through the buffered door (`"processing": "buffered"`), teaches as a content click.
- **Reads.** Above 0, a module engagement reads the catalogue and the slots document in force (the current
  publication, through the same cache as the content format lookup); a read that fails refuses the event before
  any interest is applied, as the catalogue lookup already does. At 0 nothing is read.

The catalogue document's optional marker `"typeFallback": "retired"`, beside its `pieces`, retires the free-text
type fallback for that catalogue: a piece without its own `contentType` tag then takes no content format from
its `type`, in ranking, in a slot's `contentType` exclusion (the published order check and the slots document's
constraint diagnostics included) and in what an engagement teaches. Without the marker the fallback holds exactly as before. Any other value refuses the
publication with `422`, naming `typeFallback`. Publish the marker with the catalogue `PUT`; an import or pull
writes the catalogue it assembles without it. The catalogue diagnostics (above) name the fallback in
`typeFallback` and the module-type role in `dimensionRoles`, and a decision the retirement could have changed records `inputs.replay.typeFallback: "type-fallback-retired-v1"`,
which its replay reads.

### Action weights per product type (`productTypeWeights`)

The registry document also carries the optional `productTypeWeights: { dimension, weights }`, published with
`PUT /config/reflex` like the rest of it (or saved from the console's interests screen), with no deployment
([schema](./03-payload-schemas.md#action-weights-per-product-type)). Absent, the shipped state, every event
weighs what its action weighs, exactly as before, and nothing new appears on the update, the socket frame or
any stored record.

```json
"productTypeWeights": { "dimension": "category", "weights": { "add_to_cart": { "Handbags": 8, "Accessories": 1 } } }
```

- **The product type.** `dimension` is the key of one dimension of the same registry, a dimension the event
  itself carries (not a derived band). An event's product type is the value it carries on that dimension's
  source field, as written: not slugged or case-folded (`handbags` is not `Handbags`), admitted as every event
  attribute is (trimmed, cut to 64 characters, none when it carries control characters or angle brackets), an
  array read as its first entry. It is read from the event even
  when the engine holds the product in its catalogue, and from the value the event sent even when an approved
  vocabulary maps it to an id for placement.
- **The weight.** `weights` maps an action name to the product types it counts differently on, each with the
  points it adds in place of the action's own. An event of that action whose product type has a weight adds that
  weight to every interest it touches, the content touches of a content event included. An event of another
  product type, or with no value on the dimension, counts by the action's own weight. A product-type weight of 0
  adds nothing to the shopper's interests; an action the registry weighs 0 (or does not weigh) adds its
  product-type weight where one is set.
- **Validation.** Each product-type weight is a number from 0 to 1000, on the action weights' scale; a weight
  outside 0 to 1000 or written as text, a `dimension` this registry does not declare or that is a derived band,
  a member other than `dimension` and `weights`, an action name that is empty, a reserved key, padded or longer
  than 120 characters, `tick` or `content_viewable`, and a product type that is empty, padded, longer than 64
  characters or carries control characters or angle brackets refuse the write with `422`, naming
  `productTypeWeights` (`productTypeWeights.weights.add_to_cart.Handbags must be at most 1000 (got 1001)`).
  A `PATCH /config/reflex` replaces the whole block, so send it as it should stand.
- **What it does not do.** It scales the shopper's interest update only. Whether an event is a signal for the
  signal floor reads the action's own weight, so a product-type weight neither makes a weight-0 action a signal
  nor turns a weighted one into none. The population trend an event feeds (the regional and arrival-context
  counts) keeps the action's own weight. A module engagement's own tags keep the module-engagement weight, taught
  when the click's own weight is above 0.
- **Itemised.** The interest update the action answer returns on both hosts (and the socket frame that carries
  it) itemises the weight in `affinity.applied: { action, dimension, productType, weight }`: the event's action,
  the dimension, the product type (null when the event carries none) and the weight it applied. It is present
  only while the registry declares product-type weights.
- **Stated limits.** A delivery through the buffered door (`"processing": "buffered"`) and a history import
  (`POST /v1/{tenant}/identity/events`) count by the action's own weight.

### Position bands (`bands`)

A slot strategy may carry position bands, `bands: [{ from, to, weights }]`, so that positions 1 to 2 of
one slot run one strategy and positions 3 to 5 another
(`"bands": [{ "from": 1, "to": 2, "weights": { "category": 1 } }, { "from": 3, "to": 5, "weights": { "line": 1 } }]`
on a slot of `take` 5); positions are counted from 1 within the slot, and each band's `weights` are
`{ dimension: weight }`, each 0 to 1, as the slot's own `weights`. A band overrides only the slot's
dimension weights: its weights replace the slot's wherever the composition reads them for a position of
the band, the tag sum Σ a·w and the slot weight a seed rule's contribution is scaled by, so a seed rule
whose dimension a band does not weight adds nothing in that band, while the seed rule's own weight,
freshness, fatigue, the journey stage, merchandising, the learned lift and every other rule of the slot
(its take, pins, exclusions and eligibility) apply unchanged in every band, and a position's record and
receipt explain only the terms of the scoring that ranked it: merchandising, which multiplies a base above
0, is explained on a position only where the band that ranked it gave the module such a base. The bands are contiguous, do
not overlap and together cover positions 1 to `take`, listed from position 1. Publication —
`PUT /content/slots` and `POST /content/slots/validate` alike — refuses with `422`, naming
`pages.{page}[i].bands` in `errors[]` and writing no revision, bands that overlap, leave a gap, start after
position 1, or end before or beyond the slot's `take` (so a change of `take` moves the bands with it), an
empty list, and a band carrying anything but `from`, `to` and `weights` (a take, a pin or any other
setting); seed rules are still checked against the slot's own `weights`, so publication never refuses a
seed rule because a band does not weight its dimension.

Positions are filled in order: a position the pinned prefix holds, and on a declared layout slot a module
pinned at a position or an off-limits module held at its place, stays its rule's, and every other
position is filled by ranking the modules still eligible (after the slot's exclusions, eligibility, the
page's reservations and every module already served on the page) with the weights of the band that
covers it, so the bands return one de-duplicated result, never twice the same module in the slot or on
the page. Under the layout blend the bands act on the behaviour term `B` only (`R` and `Q` as without
them). The slot's diversity rule is applied position by position: when the first module of a position's
ranking would put a value over the limit it yields, the next module still eligible under the weights of
the band covering that position takes the position (named in its record's `explain.diversity`), and the
module that yielded stays eligible for the later positions, ranked there under their bands' weights;
when every module left is over the limit, the first of them fills the position, relaxed. An exploration
pick is applied to the banded ranking (each position ranked with its band's weights, before the diversity
rule) and the adjacent swap to the served result, and neither is ever re-ranked by the bands: on a
decision an exploration pick moved, the other modules keep the banded ranking's order and the diversity
rule acts on that order as on a slot without bands. A configured per-context order is served exactly as
published, its positions ranked without the bands; the shadow order ranks with the same bands.

The record of each position a band ranked carries `explain.band: { from, to }`, keys sorted, naming the
band it was ranked in, and the shopper's receipt carries the same block as `band`, with no new sentence
in `why`; a pinned or held position, a position a configured order set and every record of a slot
without bands carry none. A banded decision replays exactly: the replay reads the slots revision the
record names (`versions.slots`), whose bands decide again, and compares `explain.band` by value, with no
replay marker; a slot without bands decides, records and replays exactly as before, with exactly the
page-manifest markers it wrote before.

### Inner content slots (`inner`)

A module's own content (the items of a complete-the-look module, the story of a styling module) is an ordinary
slot of the same page, carrying everything a slot may carry (`take`, `weights`, pins, exclusions, bands, the
diversity rule, seed rules and the rest), and the page's declared layout slot names which module's content each
such slot is: `inner: { [moduleId]: innerSlotName }`, a governance version 4 member
(`"inner": { "module.PDP.reco.2": "pdp-ctl-items", "module.PDP.editorial.1": "pdp-story-items" }`;
[the schema](./03-payload-schemas.md#inner-content-slots)). Publication — `PUT /content/slots`, a slots
`publicationChanges` member, and `POST /content/slots/validate` alike — refuses with `422`, naming
`pages.{page}[i].inner` in `errors[]` and writing no revision: `inner` on a slot that is not the page's declared
layout slot; a value naming no slot of the same page; a value naming a layout slot, the layout slot itself
included; one inner slot named for two modules; and, checked against the catalogue the same request publishes or
else the one in force, as an order's modules are, a key naming a module the catalogue does not define as a
candidate of that layout slot (no item has the id, or the item does not name the layout slot in its `slotTypes`),
the module named in the error (`pages.{page}[i].inner['module…']: … is not a module of slot …`). A catalogue that
cannot be read answers `503` rather than publishing an unchecked `inner`. A document marked 1, 2 or 3 carrying
`inner` is refused by name; an unmarked write carrying it is read under version 4.

The decision: the page's slots are decided in document order, except that an inner slot is decided only directly
after its layout slot, in the order the layout returned its modules, and only when its module was returned. That
order is the one the layout served: after its prefix and position pins, its off-limits modules, a configured
per-context order, the modules withheld by the page's `nothingToShow` report or their eligibility rules, an
exploration pick and the adjacent swap (applied before any slot after the layout is decided), never the shadow
order (**The baseline and the shadow**, above), which is recorded only. A module that is not
returned (withheld, ineligible, excluded, or ranked beyond the take) has its inner slot undecided: it serves and
records nothing, adds no row to the page manifest and names no short take or constraint, and of its pins only those
it kept reserved are named (below), a pin its own gates refused being left out as it reserved nothing. An inner slot
whose module was returned but that has nothing eligible left after de-duplication serves nothing and writes no
record, and the module stays returned. A pin of an inner slot is reserved page-wide before any slot ranks, as every
pin is, whether or not its module is then returned, so a piece pinned in an undecided inner slot is served nowhere
on that page view. Each such pin is named in the answer's `pinDiagnostics`, after any refused pin, as
`{ pinIndex, pinnedPieceId, reason: "module_not_returned", slot, within: { module, slot } }`, keys sorted: the inner
slot, the piece, its place in the slot's `pinnedPieceIds` (`pinIndex`, absent for a scalar `pinnedPieceId`), and in
`within` the module that was not returned and the layout slot; the pin stays reserved and its piece served nowhere on
that page view, the entry is counted in `refusedCount` as every entry is, and it changes no decision, record,
receipt, page manifest or replay. De-duplication is page-wide across the layout, every inner slot and every other slot: no piece
twice on the page.

Every decision of an inner slot carries `within: { module, slot }`, keys sorted, the layout slot and the module it
sits in: in the snapshot answer, on its decision record (`within`, compared by value in replay) and on the shopper's
receipt (`within`, a member, with no new `why` sentence). An inner slot is an ordinary slot in everything else: its
own learn dials, measurement basis, statistics, exploration, signal floor (a number; `never` and the context-only
switch are set on the layout slot alone), position bands, the layout blend excluded (a layout slot's own), and its
records' `explain` members, each as the [decision record](./03-payload-schemas.md#the-decision-record) defines it.
Its render acknowledgements and engagements credit the inner slot's own statistics object, under the page-scoped
name where a retained slots document carries that slot name on more than one page, never the module's
layout position. On a context-only layout slot the inner slots are decided for the shopper, as any slot of the page
is, and `X-Context-Key` names the layout's context alone. The carousel's shot order is published per context beside
the module order (`shotOrder` in each row of the context table, section 2): shot types, never items, which stay
decided for the shopper.

The page's decisions, layout and inner slots alike, are one receipt set: one composition, one `ts`, and one page
manifest (`inputs.replay`) on every record naming, in document order, every slot that was decided, an undecided
inner slot naming none. A record replays exactly: the replay reads the slots revision the record names
(`versions.slots`), re-executes the page in the order it was decided (each inner slot directly after its layout
slot), and compares `within` by value, with no replay marker, since no revision written before inner content slots
existed carries one. A page whose layout slot names no inner content slot decides, records and replays exactly as
before, with the same members and markers.

### Evidence floors per page type (`evidenceFloors`)

A page type is a page key of the slots document, and each page key can carry an evidence floor: the learn
document's `evidenceFloors` maps a page key to its floor F, a whole number of 1 or more, published with
`PUT /content/learn` like every other dial (`"evidenceFloors": { "pdp": 300, "home": 50 }`). Publication refuses
with `422`, naming `evidenceFloors.<page>` in `errors[]` and writing no revision, a floor that is not a whole
number of 1 or more (zero, a fraction, a negative number, a number written as text, `null`), and refuses an
`evidenceFloors` that is not an object or names a page that is not a slug. A page without a floor, and a
document without `evidenceFloors`, decide exactly as before; a retained learn document whose floors the
current contract refuses keeps reading with the member dropped.

The learned ladder answers as it always has: the finest level reaching `nMin` answers, and a piece with no
such level gets no lift. Where the decision's page has a floor F and the answering level holds n exposures
with n below F, its estimate p̂ is shrunk toward the baseline — p₀, the slot's rate in that cell and the
lift's own reference — by the F − n exposures it lacks, at the baseline rate, `p_F = (n × p̂ + (F − n) × p₀) / F`,
and the lift `p_F / p₀`, clamped by `liftMin` and `liftMax` as before, is applied, never skipped for being below
the floor. An estimate with n at or above its page's floor is applied as before. n is the observed exposures
of the answering level, the `n` its record states: an imported prior's strength is not an exposure and does
not count toward the floor. A lift a merchandiser froze is applied as frozen, and the holdout's `default` arm
reads no lift at all.

The record of a decision under a floor carries `explain.lift.evidenceFloor: { floor, lacking, n, page }`, keys
sorted, where `lacking` is F − n, beside `explain.lift.p_hat`, the shrunk estimate, and `lift`, the lift that
follows from it; the shopper's receipt carries the same block as `evidenceFloor` and its `lift_terms` the
shrunk estimate, with no new sentence in `why`. The block is absent wherever no floor applied. A decision
under a floor replays exactly: the replay reads the learn revision the record names (`versions.learn`) and
applies that revision's floor for the record's page, `explain.lift` is compared by value, and no replay
marker is written.

Exposures-to-floor are reported against the configured floor: `GET learn/exploring` answers
`evidenceFloor: { floor, page }` for the page the slot is on and gives each row `to_evidence_floor`, the
exposures it still lacks of the configured evidence floor (F − n at level everyone, never below 0), beside
`to_floor`, which still counts against the exploration floor; `GET lift` answers `evidenceFloor: { floor, page }`
and `toEvidenceFloor: { item: F − n }` for every item of the snapshot at level everyone. The console's What is
exploring screen shows the page's evidence floor and each piece's exposures to it. A page without a floor
carries none of these members, and every answer for it is exactly as before.

### Pooled modules (`pooled`)

A module that appears on more than one page can pool its evidence once, as an explicit, declared policy: the
catalogue declares it per module, with `"pooled": true` on the piece, published with `PUT /content/catalog`.
A pooled module accumulates one evidence record across every page and every slot it is served on. Its
exposures and credits reach each placement's statistics object exactly as before, and every placement that
serves it publishes that one record in its own snapshot under the module's id, so `GET /v1/{tenant}/lift`
answers the same record for either placement (`snapshot.items[module]`). In the pooled record the page is a
ladder level directly after everyone: its keys are `*` (everyone: every page's evidence), then `p=<page>` (that
page's own evidence), then that page with the ladder's own levels (`p=<page>|c=…`, `p=<page>|c=…|v=…`, and so on
to the affinity cell), levels 0 to 6. A decision on the module, on any of its pages, reads its lift from that
record on its own page's ladder, and the finest level reaching `nMin` answers: a page whose own evidence reaches
it answers at its page levels, and a page whose own evidence does not answers at everyone, where every page's
evidence is pooled. The record says so: `explain.lift.level_words` names the page level `page` (and `page and
channel`, `page, channel and visit bucket` and so on below it), `explain.lift.pooled` is `true`, and the
shopper's receipt says whose evidence the count is. The lift is measured against the rate of the slot that
reads the record, in that cell, as every lift is; the evidence floor of the decision's page shrinks the estimate
of whichever level answers, the page level included; below the signal floor and on a context-only layout slot
the context levels keep the page between everyone and the channel. A pooled decision replays exactly, from the
archived snapshot that holds the record, and no replay marker is written.

An undeclared module keeps its page-scoped storage exactly as before: its evidence stays with its own
placement, and a slot name a retained slots document carries on more than one page keeps one statistics object,
snapshot and archive per page (`slot@page`), never a pooled record. A pooled module served under such a
retained name still pools: one record for both pages. Records pool only among placements whose counters mean the
same thing (the same reward, objective, measurement basis and decay horizon in the learn document); a placement
whose dials differ keeps its evidence out of the record. Publication refuses any value of `pooled` other than
`true` with `422`, naming `pieces[i].pooled` in `errors[]`, and the catalogue in force stays in force; a retained
catalogue whose `pooled` is anything else reads as undeclared. A catalogue without a pooled module publishes,
decides, records and replays exactly as before. A direct publication (`PUT /content/catalog`) that declares
`pooled` keeps it on the stored piece with no `ignored_field` advisory for it, `POST /content/catalog/validate`
answers the same advisories, and a feed import or pull carries it the same way, so a catalogue refreshed from a
feed declares its pooled modules (in CSV, a `pooled` cell `true`; any other value is refused naming the record as
`records[k] '<id>'` with its field `pooled`, and a blank cell declares nothing). Limits: a snapshot reads the record from every placement when it is published: a placement whose own
evidence has not moved since another page's did serves the record as it last published it. A day report's
grids, from folded hours or from a day's ledger records, are still built per slot from that slot's own
evidence, so a pooled module's row there is its own placement's and not the pooled record.

**When a pooled publication fails closed (`stale`).** A placement reads each pooled module's record from every
other placement the module is served on when it publishes, so a pooled publication refused because another
placement's statistics cannot be read answers `503` `{ ok: false, error, stale }`, naming that placement's page and
slot and the pooled modules the refused slot reads from it. Fail closed stays: no partial pooled record is ever
published, and the slot's snapshot stays at its last successful version, for every module, pooled or not, until a
publication succeeds. The `error` reads, for example,
`statistics recovery required: this pooled publication was refused because the statistics of page home, slot home-modules could not be read for the pooled module module.complete-the-look.1; the slot's snapshot stays at version 1760000000000, its last successful publication, until a publication succeeds`,
and `POST /v1/{tenant}/learn/publish` answers the same `503` with the same `error` and `stale`. The marker `stale`
is `{ lastPublished: { publishedAt, version }, modules, placement: { page, slot } }`, keys sorted: `lastPublished`
the snapshot in force that the refusal leaves in force (its `version` and `publishedAt`), `modules` the pooled
modules the refused slot reads from the faulty placement, sorted (a pooled module whose other placements answered
is not named), and `placement` the page and slot whose statistics could not be read. Until a later publication of
the slot succeeds, through `POST learn/publish` or the object's own publication, which follows its next recorded
event within the minute, `GET /v1/{tenant}/lift` and `GET /v1/{tenant}/lift/rows` for that slot carry the same
marker as their last member, `stale`, beside their usual members and with the snapshot unchanged; after a
publication succeeds neither carries it. A slot that has never published successfully carries
`lastPublished: null`, and its refusal says the slot stays unpublished until a publication succeeds. When the
statistics of several placements cannot be read at once, the refusal and the marker name the first of them in page
order, then slot order, and once that one answers the next refused publication names the next. A publication
refused after a learn republish names its own cause (`republished`, below). A recovery refusal of any other cause
keeps its text, `503` `statistics recovery required` at the object and `statistics acknowledgement unavailable` at
`POST learn/publish`, with no `stale` member, and leaves a marker already recorded as it was; a marker ends only
when a publication succeeds. The marker is recorded beside the
snapshot, never inside it, so the snapshot, its archive and what every decision reads are exactly as published, and
a slot whose publications succeed publishes, stores and reads exactly as before; neither the five-minute monitor
nor the hourly job reads it. The console's lift grid marks a slot whose `GET /v1/{tenant}/lift/rows` answer
carries `stale`: one note in the card that holds the grid, above its table, says the numbers are stale and names
the faulty placement's page and slot, the pooled modules the slot reads from it and the last successful
publication, its version and time (on a slot that has never published, the note stands beside the "Nothing
published for this slot yet" message and says the slot has no successful publication yet), and the grid makes no
request it did not make before. The lift grid's mark lasts only while the answer carries the marker: after a
publication of the slot succeeds the next read carries no `stale`, the mark is gone and the screen is exactly
that of a slot never refused.

**When a learn republish changes a slot's accumulation (`republished`).** A slot's statistics accumulate under
one tuple: the slot's `reward`, `objective` and `measurementBasis` and the learn document's `stats` block (`n0`,
`tauLearnMs`, `liftMin`, `liftMax`, `nMin`). When the learn document is republished with another value for any of
them and no generation transition accounts for it, fail closed stays: every publication of the slot is refused,
nothing is published, and the slot's snapshot stays at its last successful version. The refusal names the
republish as its cause: the statistics object and `POST /v1/{tenant}/learn/publish` answer `503`
`{ ok: false, error, republished }`. The member `republished` is
`{ changed: [{ member, new, old }], endedBy: "generation_transition", slot }`, keys sorted, with `page` beside
`slot` for a page-scoped placement: `changed` lists, sorted by `member`, each member of the tuple whose value in the
republished learn document (`new`) differs from the one the slot's statistics accumulate under (`old`), named
`measurementBasis`, `objective`, `reward`, `stats.liftMax`, `stats.liftMin`, `stats.n0`, `stats.nMin` or
`stats.tauLearnMs`, and a republish that changes two of them lists both. The `error` reads, for example,
`statistics recovery required: the learn document republished for slot hero changed reward from click to add_to_bag; the slot's statistics stay at version 1760000000000 until an operator starts the new generation with POST /v1/{tenant}/learn/generation (or the document is republished with the old value)`;
a slot that has no successful publication yet is told that it stays unpublished instead. From the first refused
publication until the slot's next successful one, `GET /v1/{tenant}/lift` (the snapshot in force, never a
`version=` read) and `GET /v1/{tenant}/lift/rows` for that slot carry the same `republished` as their last member,
beside their usual members and with the snapshot unchanged. `republished` ends when a publication of the slot
succeeds: after an operator starts the new generation with `POST /v1/{tenant}/learn/generation`, whose own
publication succeeds, or after the learn document is republished with the old values; the reads then carry their
usual members only. A generation transition whose own publication does not succeed (its answer's
`publicationOutcome` is `unknown`) ends `republished` too, because the transition adopted every changed member:
from its answer on, `GET /v1/{tenant}/lift` and `GET /v1/{tenant}/lift/rows` for that slot no longer carry
`republished`, the record behind it superseded in place under its own key, and the snapshot in force stays the last
successful one. When the transition's publication failed on a pooled fault, the reads then carry `stale` alone,
naming the faulty page and slot and the last successful publication, until a publication of the slot succeeds,
exactly as the next `POST /v1/{tenant}/learn/publish` answers `503` `{ ok: false, error, stale }`; when it failed
for another cause, the reads carry their usual members (and a `stale` marker already recorded, as it was). A
transition whose own publication is itself refused for a further learn republish leaves the `republished` that
refusal names. A republish that changes nothing in the tuple, such as the trust dial `gamma`, is not refused,
and a slot whose tuple did not change publishes and reads exactly as before. When a publication meets both this
cause and a pooled fault, the configuration check runs first and the refusal names the republish, and a `stale`
marker already recorded stays as it was. Like the marker, `republished` is recorded beside the snapshot, never
inside it, and only a refused publication writes it. The console's lift grid marks a slot whose
`GET /v1/{tenant}/lift/rows` answer carries `republished`: one note in the card that holds the grid, above its table
and right after the `stale` note when both apply (on a slot that has never published, beside the "Nothing published
for this slot yet" message), names the slot (and its page on a page-scoped placement) and each changed member with
its old and new values, in the order served, and says what ends it: a new generation started with
`POST /v1/{tenant}/learn/generation` whose body names the slot and each changed `reward` or `objective` with its new
value (a changed `stats` value the transition takes from the document, its body then naming the slot's own
`reward`), or the learn document republished with the old values; a changed `measurementBasis`, which no generation
transition moves, ends only with the learn document republished with the old basis, so for it the note offers a
transition only after that republish; the grid makes no request it did not make before. The lift grid's republish
mark lasts only while the answer carries `republished`: after a publication of the slot succeeds the next read
carries no `republished`, the mark is gone and the screen is exactly that of a slot never refused.

**When a generation transition does not adopt the changed member (`notAdopted`).** After a learn republish
changes the slot's `reward`, `objective` or `measurementBasis`, a generation transition whose new accumulation
would not take the document's value for that member would start a slot that counts no exposure, so
`POST /v1/{tenant}/learn/generation` refuses it instead: it answers `409` `{ ok: false, error, notAdopted, operationId }`
and writes nothing, so the slot keeps its counters, its generation, its snapshot and its archive, a publication of
the slot is still refused with `republished`, and fail closed stays. The member `notAdopted` is
`{ changed: [{ member, new, old }], slot }`, keys sorted, with `page` beside `slot` for a page-scoped placement:
`changed` lists, sorted by `member`, each member the transition does not adopt, `old` the value the slot's
statistics count under and `new` the learn document's. The `error` names the slot, each such member with its old
and new values, and how to adopt it: a changed `reward` or `objective` is adopted by naming its new value as that
member of the body of `POST /v1/{tenant}/learn/generation` (or by republishing the learn document with the old
value), and a changed `measurementBasis`, which no transition moves, only by republishing the learn document with
the old basis. For example
`generation transition refused: the learn document republished for slot hero changed reward from click to add_to_bag and this transition does not adopt it, so the slot would count no exposure; name reward add_to_bag in the body of POST /v1/{tenant}/learn/generation (or republish the learn document with reward click)`.
A member counts as changed when the learn document's value differs from the one the slot's statistics count
under; the one exception is a slot moved ahead of its document with this route (the ORDER in its row below) whose
own value has not changed in any learn document republished since that move. With no earlier transition on record
for the slot, or a learn history that cannot be read back, any difference counts. A transition that adopts every
changed member, one on a slot whose tuple did not change, and one after a republish of the `stats` block alone,
which every transition takes from the document, answer exactly as before.

The cell grammar is version 3 (`cellGrammar { "name": "ladder-cell", "version": 3, "order": ["c", "v", "s", "r", "a"] }`).
Its order is unchanged, so every cell of an undeclared module names the level it named under version 2, and a
pooled module's cell is written in the pooled order, its page first: `*` or a prefix of `p=`, `c=`, `v=`, `s=`,
`r=`, `a=`, such as `p=pdp` or `p=pdp|c=email`. A priors file declaring version 2 is refused by
`PUT /content/priors` and `POST /content/priors/validate` naming `cellGrammar` and the migration (re-export it
declaring version 3), while a priors document already stored under version 2 keeps being read and applied
exactly as it was; stored snapshots and archives carry no grammar version and are not touched. A tenant whose
context vocabulary derives another grammar writes a pooled module's cell the same way, the page first and then
its own order. A prior cell is read under the ladder of the record it names, so a pooled module's cell in the
ladder's own order, or an undeclared module's cell naming a page, reaches no level of that module's record.

### The context vocabulary (`contextVocabulary`)

A tenant's entry channels, the published mapping that classifies an arrival into them, its source platforms,
its landing-page types, its visit buckets and its ladder depth are one versioned setting: the learn document's
member `contextVocabulary`, published with `PUT /content/learn` like every other dial, with no deployment
([schema](./03-payload-schemas.md#the-context-vocabulary)). A tenant that publishes none keeps today's six words
(`direct`, `paid_social`, `paid_search`, `email`, `organic`, `referral`), today's classification, the visit
buckets `1`, `2-3`, `4+` and the full ladder, exactly. A vocabulary with nine channel values names, for example,
`paid_social`, `paid_search_brand`, `paid_search_nonbrand`, `organic`, `email`, `sms`, `affiliate`, `referral` and `direct`.

- The document: `contextVocabulary` holds `channels` (`{ id, name }`), `rules`, `sourcePlatforms`
  (`{ id, name, networks }`), `landingPageTypes` (`{ id, name }`), and optionally `visitBuckets` (lower bounds,
  whole numbers strictly ascending from 1; omitted, `[1, 2, 4]`) and `ladder` (`{ order, depth }`, the order
  exactly `c`, `v`, `s`, `r`, `a` and the depth 1 to 5; omitted, depth 5). An id is lower case letters, digits
  and underscores, starting with a letter, at most 64 characters, and never `unknown` or `any`.
- The mapping: each of the `rules` names a `channel` and at least one condition, `utmMedium`, `utmSource`, `utmCampaign`, `referrer` or `untagged`.
  `utmSource` matches whole or as a token of a token-form source; `utmCampaign` matches a token of the campaign,
  so `brand` splits `brand_spring` from `nonbrand_spring`; `referrer` is `none` (a page view whose referrer is
  empty or the site's own host), `external` or registrable domains; `untagged` means no utm_medium, utm_source or
  utm_campaign is declared. The rules are read in order and the first that holds classifies the arrival; when
  none holds the arrival records as unknown, never a guess.
- Refusals: a channel id outside the id grammar, a duplicate id, a rule naming a channel the vocabulary does not
  list, a ladder order other than today's, a depth outside 1 to 5 or a cut that is not whole numbers strictly
  ascending from 1 answers 422 naming `contextVocabulary`, the member and the offending value, and writes no
  revision.
- Where a channel is named: a seed rule's `entry_channel` and a per-context order's `channel` admit exactly the
  tenant's channel ids, and an order's `visitBuckets` exactly the names of its cut (`[1, 2, 3, 6]` names `1`, `2`,
  `3-5`, `6+`) or `any`; any other word is refused as before. The page's own `channel` (the snapshot's `channel`,
  `HydrateOptions.channel`) is admitted only as one of the tenant's channel ids; any other word is ignored.
- Visit attributes and seed keys: the visit records its source platform (the platform whose `networks` hold the
  referrer's host, or the network a token-form `utm_source` names) and its landing-page type (the `data.pageType`
  of the visit's first event naming one of the tenant's types, kept for the visit), and the seed signals
  `source_platform` and `landing_page_type` read them; a fired rule is itemised on `explain.contextual` and on the
  receipt as every seed rule is. They are context attributes, never learning-cell levels.
- The cell and the learning: a decision's cell carries the tenant's channel id and the bucket of its cut, and the
  statistics count it under that cell; a learned lift is read from the finest consulted level, never beyond the
  published depth (the counts at finer levels are kept).
- The grammar bump: when `contextVocabulary` changes the channel values (as a set), the cut or the depth, `cellGrammar` changes with it:
  `ladder-cell` at a version derived from those three members, its order today's order cut at the depth.
  A priors file exported under the previous vocabulary is then refused by
  `PUT /content/priors` and `POST /content/priors/validate` naming `cellGrammar`, the grammar in force and the re-export,
  and so is one published as a `publicationChanges` member of any `PUT /content/{kind}` (its kind matched in any
  case, the refusal prefixed with `publicationChanges[i]`, the whole request refused and no member written). The
  grammar in force is the one the learn document published in the same request derives (the primary document or a
  `publicationChanges` member of the learn kind, in any case of the word), or else the learn document in force; a
  file declaring nothing is read under the current grammar. A vocabulary that changes none of the three keeps
  `ladder-cell` version 3 ([pooled modules](#pooled-modules-pooled)), the default grammar.
- What is stored: a tenant without the settings stores no new member; a visit classified under a vocabulary
  stores the channel id, the source platform and the landing-page type it records, with the learn revision that
  classified it, inside the shopper's existing record.

### Device and recency (`device`, `recency`)

Two more parts of a shopper's arrival are read on both shopper hosts as first-paint context, with no setting
to publish and nothing to deploy:

- The device class: `mobile` or `desktop`, read at the edge from the request's client hint `Sec-CH-UA-Mobile`
  when present (`?1` mobile, `?0` desktop), else from its user agent. A phone is mobile (an iPhone, or an
  Android user agent carrying the `Mobile` token); a tablet counts as desktop (an iPad, an Android user agent
  without `Mobile`), and so does every other browser. A request carrying neither the hint nor a browser's user
  agent (a server-side caller, a script) has no device, never a guess. Only the class is kept, never the user agent.
- The recency bucket: the whole days from the start of the shopper's stored last visit to the moment the visit
  opens, one of `same_day`, `within_7_days`, `8_to_30_days` or `30_and_more` — same day under one full day,
  within 7 days from 1 to 7 full days, 8 to 30 days from 8 to fewer than 30 full days, 30 and more from 30 full days.
  A first visit has no recency: there is no stored last visit to measure it from. On the session host a shopper's
  record expires 30 days after its last write, so a return after 30 days or more opens a first visit there.
- What is recorded: the event that opens a visit (`POST /realtime/action`) records on the visit the device its
  own request reports and the visit's recency bucket, each only when there is one, inside the shopper's existing
  record, and both are kept for that visit: a later event of the same visit changes neither, and a read writes nothing.
- The hydrate: `GET /realtime/reflex` answers `arrival: { device?, recency? }` beside `visit`, the device and the
  recency the visit records (each member only when there is one, `{}` when there is neither; for a visit that
  would open now, the recency its stored last visit gives it and no device yet). `arrival` is null exactly where
  `visit` is, on both hosts, and `visit` itself is unchanged.
- Seed-signal keys: `device` (`mobile` or `desktop`) and `recency` (one of the four bucket ids) are seed signals a
  slot's seed rule may name; any other value refuses the write naming the rule. A decision reads the device from
  the snapshot request itself and the recency from the shopper's visit, so both apply at first paint; a rule fires
  at `weight × the slot's weight` like every seed rule, itemised on `explain.contextual` and on the receipt's
  "Arrival context" sentence with the device named and the recency in words ("recency within 7 days").
- The device term of a per-context order: an order's context may name `device` beside `channel` and `visitBuckets`
  (`{ channel, device, visitBuckets }`), or instead of them with `any`; a named device is one more part of the
  context's specificity, the most specific match wins and two contexts that match one shopper with equal
  specificity are refused at publication, as before. A context naming no device matches every device, so an order
  published without one keeps its meaning and writes `inputs.replay.orders: "configured-order-v1"` as before. The
  record's and the receipt's `configuredOrder.context` carry the device as published, and the receipt's sentence
  names it ("any channel, any visit, on mobile").
- What does not change: the learning cell keeps its five keys, its grammar (`ladder-cell` version 3) and its six
  ladder keys, and the context prior's populations stay keyed on the entry channel and the visit bucket, so a
  priors file exported before imports as it did; device and recency are first-paint context, never learning-cell
  levels. A tenant that publishes no device context and no device or recency rule decides exactly as before,
  replay included; device and recency live on the visit inside the shopper's existing record, never under a
  storage key of their own, and a visit with neither stores exactly what it stored before. A replay
  passes no device and no recency to the decision, so a decision that a device or recency rule, or a device
  context, moved does not replay equal: the replay gap request-context seeds already have.

### The attribute vocabulary (`/content/vocabulary`)

A tenant's product and content attribute values (category, product type with its parent category, colour,
occasion, and any other attribute its registry scores or its catalogue tags) can be governed by one published,
versioned vocabulary: the document `vocabulary`, written with `PUT /content/vocabulary` and read with the routes
every content document has (history, revisions, validate, rollback), with no deployment
([schema](./03-payload-schemas.md#the-attribute-vocabulary)). A tenant that publishes none, or approves none,
keeps today's free text exactly: the catalogue validator, the import and the ingest on both shopper hosts decide
as before, term for term.

- The document: `{ version?, attributes: { <attribute>: { values: [{ id, name, synonyms?, parent? }] } } }`, each attribute keyed by the registry dimension and catalogue tag key it governs; every `productType` value names exactly one `parent` (one of the `category` ids when the document lists `category`), and `synonyms` are the words the source systems send for the value.
- Refusals: `PUT /content/vocabulary` and `POST /content/vocabulary/validate` refuse with 422, writing no revision, each error naming the attribute, the value and the offending id or word: an id outside the grammar (lower-case letters and digits, words joined by single underscores, at most 64 characters, so none of `:`, `;`, `|`), a duplicate id, a `productType` value naming no parent or more than one, a synonym that maps to two values (a synonym of two values, or a synonym that is another value's id), and a member outside the schema. A revision is stored as authored: the display names keep the tenant's wording.
- The mapping table: an attribute's ids and synonyms are its one mapping table, an id mapping to itself and a synonym to its value's id. Matching is exact, letter case included, so every spelling a source sends is listed as a synonym; a display name is not a source word.
- The approval: a stored revision governs nothing until the tenant's operator approves it. `POST /content/vocabulary/approve/{n}?scope=` (operator; `If-Match` naming the vocabulary revision and the set read, and an `Idempotency-Key`, as every authored write) puts revision `n` in effect; an unknown revision answers 404 and a stale `If-Match` 409. Any stored revision may be approved, an earlier one included; a later revision blocks nothing and changes nothing until it is approved in turn. The console's Vocabulary screen approves the latest stored revision and says which revision is in effect.
- The read: `GET /content/vocabulary?scope=` answers `revision` (the latest stored, 0 when none is), `effectiveRevision` (the approved revision in effect, 0 when none is), `approval: { revision, actor, note, at }` or null, `source` (`stored` or `absent`), `publication`, and `document` (the latest stored, or null). The first `PUT` names `If-Match: "0/{set revision}/{set digest}"`: no revision is stored yet.
- The catalogue, in effect: `PUT /content/catalog`, `POST /content/catalog/import`, `POST /content/catalog/pull`, `POST /content/catalog/validate`, a catalogue rollback and a catalogue member of `publicationChanges` store a governed tag's values as their ids, each once, mapped through the table; a piece already carrying ids is stored unchanged. A value that maps to nothing refuses the whole publication with 422, each error naming the piece's id, the field `tags.<attribute>` and the value, and nothing is written. A tag on an attribute the vocabulary does not list stays free text. An approval rewrites and refuses nothing already stored: the catalogue's next publication is held to it.
- The ingest, in effect: on both shopper hosts an event's values on a governed attribute are mapped through the same table before the live and the buffered doors place them, so a synonym builds interest under its value's id and an id under itself. A value that maps to nothing builds no interest and is counted in the tenant's rejection report; the action is still recorded and answered as before, and an event naming a product the tenant does not hold, whose every value maps to nothing, is still dropped as `unknown_product`. On a governed attribute the vocabulary's ids, not the catalogue's own tags, are what an event value may build, so a value no published piece carries yet builds when the vocabulary lists it. A held product's attributes and a content piece's own tags on a governed attribute are mapped the same way; a band label the registry derives must itself be one of the ids.
- The rejection report: `GET /content/vocabulary/rejections?scope=` (operator) answers `{ effectiveRevision, since, rejections: { <attribute>: { <value>: count } }, omitted }`, per governed attribute each value the ingest refused under the revision in effect and how many events carried it, counted from the first refusal under that revision for at most 30 days (a new approval starts a new report; `omitted` counts refusals past 64 attributes or 256 values of one attribute). It names no shopper, session or event; it is a per-tenant diagnostic count kept in the operator cache, best effort under concurrent writes, written beside the event's other work so it can never fail an event. A report that cannot be read answers 503, never an empty report.
- What does not change: nothing is written into a shopper's own record; decisions, their records, receipts and replays read interest and catalogue tags exactly as before, which under a vocabulary in effect carry the ids.

### The approved layouts (`layouts`)

A tenant can publish, per page, the module orders a merchandiser may set on the page's declared layout slot: the
optional document `layouts`, written with `PUT /content/layouts` and read with the routes every content document
has (history, revisions, validate, rollback, and as a member of `publicationChanges`), with no deployment
([schema](./03-payload-schemas.md#approved-layouts)). The first publication set of a tenant
(`POST /content/publication/initialize`) never creates it.
- The document: `{ version?: 1, pages: { <page>: { any?, mobile?, desktop?: [{ modules: [<module id>, …] }] } } }`: per page (the page's name in the slots document), per device key, the approved layouts, each one's `modules` an ordered list of 1 to 50 distinct module ids; a page listing only `any` approves the same layouts for every device.
- Refusals: `PUT /content/layouts` and `POST /content/layouts/validate` refuse with 422, writing no revision, each error naming the page, the device and the layout's index: a device key other than `any`, `mobile` or `desktop`, an empty list, a module id repeated within a layout, two identical layouts under one device, and a member outside the schema; a top-level member outside the schema (or a `version` other than 1) is refused naming that member instead. The catalogue is not read at this publication: the slots publication checks an order's modules against it, as before.
- The read: `GET /content/layouts?scope=` answers `revision` (0 when none is stored), `publication`, `source` (`stored` or `absent`), `actor`, `note`, `at` and `document` (null when none is stored). The first `PUT` names `If-Match: "0/{set revision}/{set digest}"`: no revision is stored yet.
- The rule: at the slots document's publication (`PUT /content/slots`, its validate, a slots rollback, a slots member of `publicationChanges`), each per-context order (`orders`) on a page the document names must list, as a sequence, one of the page's approved layouts for the order's device: a context naming `mobile` or `desktop` matches that device's layouts and the page's `any` layouts, and a context naming no device the `any` layouts alone. The layouts read are the ones in the publication set the slots document is published over, or those the same request publishes. Any other order refuses the whole publication with `422`, each error naming the page, the order's context and its modules, and nothing is written; an approved order publishes exactly as before.
- What does not change: a page the document does not name, and a tenant that never published one, keep every order as before. A layouts publication that drops a layout a published order uses is accepted: that order stays in force until the slots document is next published, and the slots validate reports it. The carousel's shot orders (`shotOrders`) are outside the rule.

## 5. Learning and transparency

Under `/v1/{tenant}/`. Operator token unless marked.

With `AUTH_MODE=enforced`, diagnostic reads (lift, rows, history, slots, exploration, day/window reports and brand discovery) require an operator token explicitly granted the selected tenant; a site key alone is insufficient. Open/unset mode retains the existing demo read policy.

Enforced-mode recent/receipt, ledger-by-ID, replay, batch-list and erasure-list reads (including HEAD) require acknowledged D1 audit admission before data access and a correlated result before response release. Result status records the handler's HTTP status, not client delivery or completed erasure. Missing audit storage/schema/key or failed acknowledgement returns sanitized, no-store 503. These reads require local migration `0011_operator_audit_tenant.sql` and explicit nonblank `IDENTITY_SALT`; deployment is a separate step. Audit rows retain the authenticated actor, tenant, fixed operation/route, server time/request ID and keyed, tenant-separated selector references; validated by-ID/replay subjects also receive a keyed result reference. Actor IDs over 200 or record selectors over 2048 characters are refused, never truncated. References remain subject-related, not anonymous. No raw subject/record IDs, paths, queries, bodies or emails are logged in this schema. Tenant-wide listings do not audit each constituent or subsequent external downloads. Open/demo reads remain unaudited; other identity/mutation operations, historical completeness, retention and key-lifecycle policy remain separate work.

Identity visitor/shopper GETs (including HEAD), identity resolve/erase/export, ledger erase and ledger rewrite also require acknowledged audit admission/result in enforced mode. The export (`identity_export`) is a read by POST: it writes the entries the erase writes for the same selector — the same selector kind and keyed references and, when a person was resolved, her subject reference — named for the export, with a `read` result; a refused export writes what a refused erase writes and releases nothing. They add minimized `subject_operation` v2 records to the same tenant-admin audit view; existing v1 read records remain readable. Resolve validates the entire ≤1MiB request with1–1000 nonblank accounts of normalized length≤200, retaining original response keys and trimmed identity semantics without filtering/truncation. Every account ordinal has a keyed account reference and, on success, its actual mapped shopper reference. Ten-member chunks stay≤2048 UTF-8 bytes each and the whole phase≤512KiB; one atomic D1 statement per phase means two audit write queries even for1000 accounts. Audit actor is the current caller, not a previous erasure job's retained actor. Identity `local_complete` still has `complete:false`; ledger ring failures/unbound hosts and rewrite `more`/`remaining` counters are recorded as returned, never full deletion. After an erasure command enters its mutation callback, a thrown/invalid receipt or failed result acknowledgement yields sanitized503 with server `requestId`, `outcome:outcome_unknown`, `operationMayHaveApplied:true` and `auditStatus` (`recorded`, or `unconfirmed` when acknowledgement failed). This does not imply rollback or safe automatic replay. Admission refusal starts no target operation. External downloads, per-subject proof of bulk rewrites, retention/key lifecycle and full erasure remain separate; valid open/demo operations remain unaudited.

**Placements (`page=`).** A slot's learning identity is its brand and its slot name. A slot name that the tenant's
catalogue carries on more than one page — only a catalogue retained from before the rule that refuses it for any new
write can — is learned per PAGE: each page's placement is its own statistics object, its own published snapshot and
its own archive, and serving, the operator reads below, the monitor's comparison and the recovery record's cleanup
all follow that page's object; nothing pools the pages. For such a slot every route below that reads, publishes,
resets or restarts one slot's statistics takes `page=` (the decision request's own member name; `page` in a POST
body), and requires it: asked without it, or with a page the catalogue does not carry the slot on, the route answers
400 with `pages`, the pages it is carried on. `learn/recovery` addresses one object exactly, as it always has: with
`page`, that page's object; without it, the page-less object — for such a slot, the one its pages pooled into before
they were learned apart. `GET learn/slots` marks such a row `pageScoped: true`, and its `evidence` is that row's own page's. A
cursor is bound to the page it was cut for. Every route below that names one slot's statistics takes a catalogue slot
name — a slug, never a name carrying `@` — and refuses anything else with 400, so a placement is only ever addressed
by its slot and its page. A slot name carried on one page keeps its page-less identity, is read without `page=`, and
keeps every statistic already learned under it. Where the catalogue itself cannot be read, a learning write that
needs it is refused and named (`code: "config"` on the learning receipt); it is never written under a guessed
identity. The owner's recovery retries it only when `LEDGER_RECOVERY_ENABLED` is `"true"`; otherwise it is refused,
named in the `learning_incomplete` log and not retried. The monitor compares the ledger with the online
counts per brand and slot name, summing a page-scoped name's page objects.

| Route | Does |
|---|---|
| `GET audit[?limit=1..100&before=id]` | Minimized tenant subject-read/operation audit entries in descending ID order, default 50; returned `before` is the next keyset cursor or null. Requires both an explicit tenant grant and the existing admin role in every mode; no-store. Its own read has one admission/result pair. Legacy global rows retain null tenant and are excluded, not assigned an inferred tenant; the legacy global audit view excludes these subject-read/operation rows |
| `GET lift?slot=&brand=[&page=][&version=]` | The slot's lift snapshot in force, or an archived version: every item's estimate in every cell, and on a layout slot that swaps adjacent pairs `positionEffects`, each position's effect estimated from the swaps as a click ratio with the swapped decisions behind it ([adjacent swaps](./03-payload-schemas.md#adjacent-swaps-and-position-effects)). Where the slot's page has a configured evidence floor, beside the snapshot `evidenceFloor: { floor, page }` and `toEvidenceFloor`, each item's exposures to that floor at level everyone ([evidence floors](#evidence-floors-per-page-type-evidencefloors)). Beside the snapshot in force, `stale` while a pooled publication refused on another placement's fault leaves it stale, and `republished` while a learn republish that changed the slot's accumulation keeps its publications refused ([pooled modules](#pooled-modules-pooled)). `page=` as below. Operator token |
| `GET lift/history?slot=&brand=[&page=]` | Every archived snapshot version for the slot; `page=` as below |
| `GET lift/rows?slot=&brand=[&page=][&level=pooled\|cells][&item=][&q=][&sort=][&dir=][&limit=][&cursor=]` | The grid one page at a time, cut by the server: one pooled row per item, or one item's cells (`level=cells&item=`), filtered by `q` over the item id, your id, the title and the cell, sorted by any column, fifty a page up to five hundred. `total` counts what matched; `cursor` fetches the next page and is bound to the snapshot version, so a listing that outlives a publish answers 409 and starts again. Names and a merchandiser's freeze or reject ride each row. `stale` as on `GET lift`; the console's lift grid marks the slot from it. `republished` as on `GET lift`; the console's lift grid marks the slot from it too, after the `stale` note. Operator token |
| `GET brands` | In enforced mode, only the operator's explicitly granted brands in manifest order, preserving each brand's original default flag: the application's brand picker |
| `GET learn/slots?brand=[&q=][&evidence=1]` | Every slot on every page, grouped by page, with what is set on it (dimensions weighted, rules, reward, objective, trust, exploration — the mode the engine runs, and where the learn document keeps a mode it will not run, `configuredMode` with `unsupported: true` naming that retained setting, as `learn/exploring` and the day report's row do, with `configuredExploration` repeating it under its earlier name — autonomy, controls) and how many pieces are eligible now; `q` narrows by slot or page name; `evidence=1` adds what each slot has learned so far, for the first 200 slots, and on every slot its `governance` counters (refused pins and short takes since their horizon, zero reported as zero, `status: "unavailable"` with null counts when the counter store cannot be read, `scope: "tenant"` — one counter document per tenant, covering every brand of it). The picker and the overview of an operator application |
| `GET learn/exploring?slot=&brand=[&page=][&limit=][&cursor=]` | The pieces under the slot's observation floor, least observed first, one page at a time, with the slot's exploration mode, share and floor: what exploration serves on purpose. `share` is the share a runnable policy reserves; a dial that cannot explore — `off`, whatever share it stores, a retained withdrawn mode (named by `configuredMode` and `unsupported`) or a slot with no exploration block — answers `0`, as the day report's row answers `configured: null`. Where the slot's page has a configured evidence floor, the answer names it, `evidenceFloor: { floor, page }`, and each row carries `to_evidence_floor`, its exposures to that floor ([evidence floors](#evidence-floors-per-page-type-evidencefloors)) |
| `GET learn/queue?brand=` | What needs a person, as counts: proposals pending, slots that have learned nothing yet, slots whose trust dial is above zero, pieces frozen or rejected, erasures still to be rewritten. The landing page of an operator application. The answer also carries `autonomy: { mutationAvailable: false, proposalStatusesVerified: false }`: autonomy mutation is withdrawn, so `proposals_pending` is a historical count of stored `proposed` statuses and not work an operator can act on today, and the statuses it excludes are stored records, not verified applications. Operator token |
| `GET visitors/{visitorId}/receipts[?limit=&cursor=]` | What this shopper was served, newest first, each with the sentences that say why: the interest matched, the region's trend, your model's term, the journey-stage, freshness, fatigue, merchandising and diversity rules, a pinned slot that could not fill its take, the learned lift and whether it was applied, the layout blend's rank base, behaviour and performance terms and their sum, a pin, the holdout arm, an explored pick. Suppresses records at or before the retained erasure cutoff; later records remain visible. Valid empty history returns 200; unavailable or invalid history/projection returns 503, never empty success. Operator token; no-store |
| `GET visitors/{visitorId}/recent` | The visitor's ring of recent decisions, what attribution reads. Suppresses records at or before the retained erasure cutoff; later records remain visible. Valid empty history returns 200; unavailable or invalid history returns 503. Operator token; no-store |
| `GET ledger/{decision_id}`, `GET ledger/{outcome_id}?stream=outcome`, and `GET ledger/{record_id}?stream=product-sort` | One record from the ledger by id, no index needed; consumer/source/readback stages are separate; behavior and complete product-sort records use durable owner admission and managed queue/R2 recovery. An outcome is delivered beside the provenance of the decisions it credits, and where the outcome itself carries no block and exactly one credited decision does, `record.experiment` on this answer may be carried from the credited decision’s stored block, so it is not always byte-identical to the stored ledger line. The block is copied as it was stored and never re-derived from today's published salt |
| `GET ledger/batches?date=YYYY-MM-DD[&stream=decision\|outcome\|product-sort][&cursor=]`, or `?from=YYYY-MM-DD&to=YYYY-MM-DD` | The batch objects of one day, or of a window of at most 184 inclusive UTC days, so a warehouse job knows what to fetch with its own storage credentials: the comparison is computed on your side, from the arm-tagged records these objects hold. Each entry names the `date` it belongs to. The object budget holds for the request as a whole, not between days. A window answers the days it read (`days`) and sets `truncated` when it stopped at the object budget, at its listing budget, or mid-day; `cursor` continues a single `date` only. Product-sort objects require the explicit selector; apply erasure cutoffs when loading. The export states no lift |
| `GET ledger/erasures` | The visitors whose erasure is pending, each with the moment of erasure: a warehouse job drops their rows at or before that moment from what it loads, until the nightly rewrite has removed them from the objects themselves. `ledger/batches` says how many are pending |
| `POST ledger/erasures` `{ visitorId }` | The ledger half of an erasure: writes the tombstone every reader honours at once and empties the visitor's ring. The identity erase route calls the same function after erasing the profile. `POST ledger/erasures/rewrite` runs the nightly rewrite now |
| `GET replay/{decision_id}` | Validates recorded page dependencies, loads required prefix archives (none for a genuine pin), and compares the target including authority/exploration: `{ equal, classification, diff[], used }`; unavailable or inconsistent dependencies fail explicitly, an archive that could not be read is named apart from one that is absent, and a manifest version this build does not implement is refused by version. `classification` is `equal`, `item`, `candidates-only`, `explanation` or `not-replayable`, derived from `diff` alone |
| `POST learn/report` `{ date, brand?, policies? }` and `GET learn/report?date=&brand=` | Raw attribution diagnostics from available hour aggregates, or budgeted day-ledger reads for custom policies/fallback. Explicit `policies` arrays, including empty or preset-equivalent arrays, return response-only results and never save the canonical day. Omit `policies` for ordinary canonical publication. A canonical publication notes the stored day's object (its R2 etag, or its absence) with one listing of the day's key before it reads any source, the hour aggregates or the ledger, and its put is conditional on that note: if any other write reached the day after the note, the put is refused and the stored day stands, so a publication whose sources were read before another day was stored never replaces it. There is no read of the day at write time and no comparison of build times. A refused POST still answers 200 `{ ok: true, report }` with the day it computed, which is not stored; GET answers the day that stands. A refused write can leave in place a day computed from an earlier read of the sources, until the next publication of the date. The canonical day records `provenance` `{ version: 1, status, policies }` — the policy names its numbers were computed under and whether it was published `canonical`, `repaired` or `declared`; GET answers `provenance: null` for a day that records none, which is unknown and never read as canonical. POST bodies are limited to64KiB; raw-report budgets below return explicit413 rather than a truncated success. GET reads the stored canonical day, not a guarantee of current or settled coverage. Additive `coverage` reports source limitations; legacy `hours` and counts remain compatible. Aggregation does not establish any-size capacity or complete history. No visitor id in the result. Both the build and the read require an operator token in every deployment mode: the reads carry the same gate as the build beside them. The answer carries `armVisitors` (per-arm distinct visitors, `null` on a day written before the field existed), `allocation` (the published share and arms the day was served under) and `visitorOutcomes` (per-arm enrolled visitors by outcome type, counted by enrollment and not by content match) |
| `GET learn/report/window?from=&to=&brand=` | Pools bounded stored day diagnostics over at most 184 inclusive UTC days (the longest six consecutive full calendar months) only where recorded slot computation bases agree. Requested endpoints are preserved; 185 days refuse before storage I/O. Unknown or mixed contributors withhold pooled arms with reasons/dates; a declared day (`provenance.status: "declared"`) withholds them with the reason `declared_day`; found days, source counts and normalized coverage remain visible. Only genuinely missing reports enter `missing`; oversized inputs return413 and corrupt/unavailable inputs503. No experimental compatibility, inference or maturity claim. The answer carries `armVisitors` on the `visitor_days` basis (the per-day distinct counts summed), `null` when any pooled day predates the field, `allocation` (the published allocation every pooled day agrees on, `null` on a disagreement or on a day that records none) and, per slot, the `computation` it pooled under. A period longer than 184 days is read as consecutive windows — two 184-day readings cover a year — and pooled on your side; the platform refuses a longer range with its maximum named and never shortens the period you asked for. Requires an operator token in every deployment mode |
| `POST learn/cycle[?brand=]` | Unavailable: valid authenticated requests return 503. Automatic and on-demand proposal generation/application are withdrawn pending W29 safeguards |
| `GET learn/proposals` | Read-only historical records, explicitly unverified; retained statuses are not proof of successful application and the returned history is not guaranteed complete |
| `POST learn/proposals/{id}/apply\|reject` | Unavailable: valid authenticated requests return 503 without proposal/configuration access or mutation |
| `POST learn/items/reset` `{ slot, item, brand?, page? }` | Discards one item's evidence in one slot (one placement, with `page` as below); the estimate restarts from the prior; recorded as a revision with a note. The revision republishes the tenant's learn document, so while that document names an `external` model the reset is refused with 422 naming `external` and changes nothing: no evidence is discarded and no revision is recorded. Remove `external` in the console first (in the Dials view, under "Their own model, for every slot", set "Where it lives" to none and save), then reset |
| `POST learn/recovery` | Current-human admin audited exact-target status/conditional coarse or proof-only repair, or the explicit statistics reset (`intent:reset`); see the bounded recovery contract above. Service credentials and arbitrary state replacement are refused |
| `POST learn/publish` `{ slot, brand?, page? }` | Publishes the slot's (placement's) lift snapshot now, as the object does within the minute on its own; for an operator who has just changed a dial. A publication refused because another placement's pooled statistics cannot be read answers `503` `{ ok: false, error, stale }` naming that placement ([pooled modules](#pooled-modules-pooled)); a publication refused after a learn republish that changed the slot's accumulation answers `503` `{ ok: false, error, republished }` naming the slot, each changed member with its old and new values and what ends it (the same section); every other refusal answers `503` `statistics acknowledgement unavailable` |
| `POST learn/generation` `{ slot, brand?, page?, reward?, objective?, rebuildFrom? }` | Moves one slot (one placement, with `page` as below) to a new ACCUMULATION generation, the only authorized way past the 409 an accumulation change meets on an ordinary write. Answers `{ok, tenant, brand, slot, operationId, generation, restartedAt, archivedVersion, publicationOutcome, rebuiltFrom?}`. It archives the superseded published version under its own version (an archive already retained is never overwritten), discards the slot's counters — or, with `rebuildFrom:YYYY-MM-DD`, folds them again from that one retained day and answers `rebuiltFrom:{date, decisions, outcomes}` — advances the object's generation so nothing prepared against the old one can land, and publishes the fresh generation at once so no cache goes on serving the one it superseded. A rebuild admits the retained day's evidence AT the restart, not at the original event times, and the snapshot says so through `rebuiltFrom` and `restartedAt`; a day the reader cannot read whole is refused rather than folded in part. The estimator dials are never moved here: they stay the published document's. ORDER, and it matters: move the generation with this route FIRST, then publish the tenant's matching learn document — the one whose `slots.{slot}.reward` and `slots.{slot}.objective` name the accumulation this route has just started; until that document is published the slot serves no lift and ordinary exposure writes meet 409 `statistics configuration incompatible`, because the object has moved past the accumulation the document still names, and a shopper is ranked on base scores alone meanwhile. A transition that does not adopt a member of the slot's tuple that a learn republish changed is refused `409` `{ ok: false, error, notAdopted, operationId }` and writes nothing (the `notAdopted` paragraph, after `republished` above). Operator token in every deployment mode; an optional 32-lowercase-hex `Idempotency-Key` names the operation. Who may authorize this in production, and on what evidence, is an open owner decision and this route names no production approver |
| `POST models/reference` | The reference implementation of the model contract, for a data science team to see the shape. Operator token, the gate of `POST learn/cycle`: no credential, a site key, a shopper session or a malformed token is refused exactly as that route refuses it, and where `AUTH_MODE` is `enforced` (staging and production) so is an operator without the tenant's grant. No decision calls it: the deployment's `EXTERNAL_MODEL_POLICY` is `off` |
| `GET trend?region=` (site key or token) and `POST trend/rollup` | The regional interest vector in force, and the roll-up the hourly job does, on demand: regions into their countries and everyone, and the context prior's channel-and-visit-bucket shares into each channel alone |

Report `coverage.version:1` preserves known missing/truncated hours, visitor uncertainty, hours whose persisted ring progress was not advanced, each built hour's horizon (including zero or unknown), and `unassignedHours` — the built hours that cannot say the experimental assignment (`[]` when every built hour can, `null` when the stored report does not record the member). An hour is named when it was folded before the aggregates carried the assignment; a day with such an hour is grouped by the arm served and answers `armVisitors: null` and `visitorOutcomes: null`. An outcome whose visitor had no decision that day at or before it, nor later in that hour, no longer names its hour: the day counts such an outcome under the visitor's first decision of the day, so the fold remembers it — `assignments.deferredOutcomes` counts those on the hour — and once a fold has carried her into the day it counts under the assignment of her earliest decision, never the outcome's own experiment stamp, for as long as it precedes that decision — an earlier decision of hers folded later moves it rather than adding it to a second row — while one whose visitor has no decision that day is counted nowhere, both exactly as the raw day counts them. Every fold of an hour decides that hour's outcomes afresh and replaces what an earlier fold of it decided, so a re-fold that finds an earlier decision of hers (a row that reached the ledger late) moves the outcome and never leaves it on two rows. Each hour aggregate counts an outcome only through the hour that decides its row — the outcome's own hour, or for a remembered outcome the hour of the visitor's earliest decision — so an earlier hour folded again between a placement and the fold that moves it never keeps the old row, whatever order the hours are folded in. An hour whose aggregate was written before an earlier hour of its date was last folded is named until the job folds it again, because that fold may have moved or decided a row it counts. An hour is also named while an outcome it remembered can no longer be placed from memory — a later fold found a decision of hers at or before it, as when an earlier hour is folded out of order — until that hour is folded again (`assignments.strandedHours` on the hour aggregate). An hour is named when it holds an outcome whose visitor did have a decision that day at or before it that the fold's attribution ring no longer holds (the ring cap or the horizon evicted it), or whose earliest decision of the day the fold cannot date, because the assignment she held then cannot be known; a day with such an hour keeps its arm rows and `armVisitors` and answers `visitorOutcomes: null` rather than count the outcome on a row she may not have held. An hour folded before this release remembered nothing and is still named for every outcome it could not place. It never divides a total it does not hold, and never answers a count that omits an outcome. Unadvanced progress does not mean every displayed credit is wrong. `minHorizonMs` is null when contributing horizons or sources are missing/unknown; legacy `hours.horizonMs` describes the old last-hour value, never a minimum. Stored legacy or malformed metadata cannot establish coverage; known warnings survive read-time normalization without rewriting reports. Both operator views show these limits before empty results. Status is only `incomplete` or `unknown`: neither age nor an empty warning list establishes delivery completeness, compatible policies or experimental readiness. The top-level `coverage.maturity` still reads `unknown` on every report, and it is now the LEGACY field — the statement about outcome maturity kept so a report already written before this release still reads — not a statement that the platform cannot say what an hour is. What an hour is, is said per hour beside it. A day summed from hour aggregates carries `refoldHorizonMs`, the published re-fold horizon it was built under, measured from each hour's own end, and `maturities`, one `{hour, maturity}` row per built hour: `open` inside that horizon and still re-checked against its ledger, `final` past it, and `repaired` where the hour's aggregate was written after it became final — a rebuild asked for at a higher object cap, a re-fold because an earlier hour was folded after it, or a first fold that reached the hour late — so a repair can never quietly replace numbers already read as final. A final hour is folded again only for those two reasons, never for a late row, which is counted and not applied. `lateAfterMaturity` is `{hour, objects}` for ledger objects that reached a final hour after it was final: they are counted and named here and applied nowhere, and the rows stay in the ledger, which is a declaration about what these numbers include and not an age cutoff that discards data. `carryInHours` is `{hour, evicted, unplaced}` per built hour — the outcomes whose earlier decisions the fold could not reach, `evicted` where the visitor's attribution ring was full when the outcome was attributed and nothing was credited, `unplaced` where no decision of the visitor's own date could be found for it when its hour was folded — a later hour's fold may still place it on her first decision of the day, or it is one of the outcomes `unassignedHours` names; neither is a claim that a credit was owed, and a day with any `unplaced` reports `status: incomplete`, because that hour's own fold could not complete the visitor-level count. `objectScan` is `{hour, objects, read}` per built hour: how many ledger objects the hour holds and how many the fold really opened, which is where the object-scan cap becomes visible instead of implied. `recoveryFromMs` is the migration bound — the earliest hour a repair can still put into the batch rings, because a version-1 shard state remembers only a high-water mark, so recovery begins at the first version-2 fold and no further back; `0` where no shard imposes one. `counts.conflicts` now appears on a day built from the aggregates as well as on one recomputed from the records: rows excluded because two genuinely different rows share one logical id and an operator has already filed the conflict, omitted when there is none. Every one of these members is additive and optional: a report written before this release carries none of them and is still read as recorded. Direct ledger reports cannot establish carry-in history. This bounded JSON/view contract does not change CSV exports, repair history or certify external consumers.

New raw reports and hour aggregates record bounded `computation.version:3`: effective attribution policies/windows, per-slot reward/objective/decay tau, raw-day versus hourly-ring horizon/cap profile and the unweighted credited-outcome/item-decision unit. Carry-in-only credited slots are included even where the old arm projection has no denominator row. Day construction refuses unknown/mixed hourly bases or changed accumulator configuration before canonical replacement; estimator-only changes remain possible. Legacy saved days remain readable with unknown computation. Ambiguous duplicate-label custom reports preserve their existing response-only counts/grids but carry unknown computation. Valid basis survives full/paged diagnostics and the same-object summary. Windows expose per-slot `compatibility` status/reasons/dates and return no pooled arms for unknown, mixed or unrepresented contributions; this is withholding, not a zero result. The modern view shows these warnings. Equality establishes only recorded computation, not common served control/allocation/enrollment, metric/target versions, monetary outcomes or experimental compatibility. Objective/tau describe grids; arm credits remain unweighted repeated counts. There is no historical restamping/rebuild or policy choice. Older strict summary readers may reject the additive field; reader-first rollout requires separate qualification. Existing coverage, maturity, storage budgets and publication/history limitations remain. Version3 identifies current-input logical deduplication after version2 exact-reference attribution. Stored versions1/2 keep their labels and counts; mixed versions cannot be pooled.

Raw/hourly readers compare complete logical records by tenant, stream and primary ID before distinct-row and ring caps. Exact decisions and validated nonce-bearing outcome retries count once; a changed payload or repeated nonce-free outcome ID refuses the report. Unique legacy outcomes remain supported. Only validated top-level `_ledger_delivery` transport provenance is excluded from equality. Optional `counts.duplicates:{decisions,outcomes}` records admitted repeats for the requested brand after erasure filtering and survives saved summaries; absence in an old report is unknown. This does not establish unique business orders or page views, online statistics idempotency, or complete delivery. Relevant ambiguous compact carry-in, including a forward input overlapping retained identity, refuses without repairing history; an already-folded-hour replay remains supported. Hourly builds now validate all loaded shards and stage their complete numeric aggregate before any write, so a later retained-shard failure causes zero writes. Hourly full-record comparison refuses above16MiB per object/combined physical UTF-8 text or1,000,000 admission work units. Retained-ID comparison across shards also has16MiB UTF-8 ID bytes and1,000,000 visited entries per build, with2048 bytes per relevant ID, checked before ring-cap projection. Loaded and staged shard bodies each have a separate combined16MiB bound; the aggregate, complete coordinator and every possible partial-write mixture must fit the same bound. Physical object/byte/work caps still count duplicate traffic; these conservative application limits are not a supported customer envelope or deployed capacity proof.

Strict raw-day reports and hourly folds refuse a selected, listed object that is unavailable; hourly malformed JSON also refuses before any shard, hour aggregate or canonical report write. Hourly raw and aggregate-inventory listings reject missing or repeated continuation cursors and bound page/key visits by the existing1,000,000 work ceiling. Valid pagination, empty hours and explicit physical-cap truncation remain supported. Before shard progress, the existing shard-zero object conditionally stores the exact prepared aggregate, original publication condition and before/after shard fingerprints. Restarted retries preserve its credits, counters, `builtAt` and `ringsFolded`, including carry-in evicted by partial progress. Complete selected raw bytes, observed inventory/cap, effective fold configuration and sorted visitor/erasure-cutoff pairs must match; unrelated erasure rewrite progress does not invalidate that basis. Unknown or changed state refuses before further recovery writes. Every mutation uses an ETag/absence condition; uncertain acknowledgement permits only bounded exact-byte readback. Changed shards and aggregates retain a unique technical `generation` marker to prevent stale writers reusing older ETags; this is separate from computation-policy versions. No additional visitor history or storage namespace is introduced. These fingerprints bind observed inputs, not an atomic snapshot across raw objects and erasure stores. Changed pending input/configuration/erasure requires separate recovery; it is not a rule declaring delayed events invalid. Completed explicit same/older-hour recomputation retains its existing surviving-history and erasure-cleanup limits. No new event-age cutoff, historical reconstruction, dependent-hour repair or old-binary coordination is promised; retain compatible readers/writers until pending checkpoints drain. General non-strict `loadDay` callers retain legacy missing-object/malformed-line skipping.

The five-minute catch-up first checks shard zero for an interrupted transaction, including one whose aggregate already exists or whose hour has left the lookback. It recovers that transaction under the same hour/budget limits before newer hours; unresolved work stops newer folds, and `maxHours:0` performs no fold recovery writes. Pending counts include that debt once, alongside missing hours. It then takes the closed hours of its lookback in time order, a missing hour and a re-fold of a built one alike, so a later hour is never folded against the state an earlier hour's re-fold is about to change. Added recovery/storage calls count against the fold budget, which admits a started fold rather than proving a per-invocation capacity limit. Pre-transaction failures retain bounded skip behavior and do not reconstruct lost carry-in. Catch-up also retries missing or stale canonical day publication after successful hours, even when no new hour is folded. A tenant may serve more than one brand and there is no brand registry: the date's day is published for every brand its hour aggregates carry, each built from that brand's rows only, and the tenant's own day is written last and only once every other brand's day of that date was written, so the saved summary checked below is the tenant's own day, and a date whose other brand's day failed or was superseded is published again, whole, by the next run. The nightly job likewise builds yesterday's day for every brand the tenant's own records carry — its hour aggregates, else its decision and outcome rows — each brand on its own, inside the tenant's one scheduled job, and the tenant's own day last: it reads each other brand's day back after its write and writes the tenant's own day only when every one of them is stored as it built it. Where one is not, the own day is withheld, so the next five-minute run finds the date without its saved own day and publishes it again, whole. It checks the newest three aggregate-backed dates in its lookback, oldest first, and reports published/failed/deferred date counts separately from pending hours. A recovered date outside that lookback is explicitly deferred. A saved aggregate summary skips publication only when its built-hour set matches the complete date inventory and, for every already-built hour the run probed, its `coverage.lateAfterMaturity` names exactly the late objects that hour's aggregate now carries; read failures never permit replacement. So a late row that reaches a final hour past the re-fold horizon — counted onto the hour by the run that sees it and applied nowhere — republishes its date on that run, or on the next run that probes the hour if that publication fails, although no hour of the date is built again. Retries use current aggregates without raw fallback or refolding, and a true no-op changes no stored bytes. Matching hour membership and late-object counts do not detect other changed aggregate contents, configuration/erasure freshness or newly closed missing hours. Deferred dates and historical reconstruction remain separate recovery work. Day publication is fenced by a note taken before the date's hour aggregates are read: the etag of the saved object whose summary the run read, or, for a date the run folded, one listing of the day's key after its folds and before it lists the date's aggregates. The put is conditional on that note, so a day another writer stored after the note stands. Such a date is reported failed with `day report superseded by a concurrent publication`, nothing is written, and the next run checks the date again; a note that cannot be taken is reported as `day report publication failed`. The POST without `policies` and the nightly job take the same note, once, before they list the date's aggregates, and the same note conditions their write when the date falls back to the ledger. A refused nightly job resolves with the day it computed and logs its usual counts line for it; nothing it records says the day was not stored — except that where another brand's day of the date was not stored, the tenant's own day is withheld, not built, and logged as a failed day report. Ordinary report requests retain best-effort persistence; a returned computation does not prove a saved write.

Raw reports admit at most50,000 distinct decisions and50,000 distinct outcomes,6 policies including learning (the existing4 presets plus1 custom fit),800 raw ledger objects,16MiB per object and combined raw UTF-8 text,1,000,000 estimated work units,16,384 projected item/slot/ancestor cells across policies, and8MiB final report JSON. Work includes ring construction/sorting, policy/outcome filtering/sorting and featured-product cross-products; listing traversal is also bounded. Consumed components are limited to256 UTF-8 bytes and generated keys to2048 bytes; invalid shapes or inherited object-property names return400. Capacity refusal returns no-store413 with `code:report_budget_exceeded`, `budget`, `limit` and `observed`, before any partial raw publication; object refusals retain `objects`/`max`. General capped loader callers retain their separate truncation contract. Native object size and actual stream bytes are checked; text-only adapters can check actual bytes only after materialization. These are application safety budgets, not proved Worker CPU/memory, supported customer traffic or scientific policy limits.

Aggregate-to-day construction separately admits at most24 distinct canonical hours,16MiB combined aggregate JSON,6 policy names,1,000,000 estimated merge/admission work units,16,384 projected cells and8MiB report JSON before publication. Saved day reads admit8MiB per object; windows admit16MiB combined input and16,384 consumed/pooled rows or cells. Day/window GET responses are capped at8MiB including their response envelope. Required owner/shape failures and unavailable storage return sanitized no-store503; only an actual absent object is missing. These guards preserve accepted counts and conservative legacy coverage without rewriting stored objects. Legacy fallbacks or cardinality can refuse even below184 days; the date cap is not a native capacity guarantee. Hour-fold/shard ingestion, configuration/tombstone loads, policy compatibility, model acceptance, full long-window measurement and native capacity remain separate work.

New canonical raw/hourly publications store a leading reserved `_summary` version1 in the same JSON object and the same single put as all original report fields. The summary's first line ends with comma+LF and is limited to64KiB UTF-8 including framing; the complete canonical object remains limited to8MiB. Explicit custom/empty/preset arrays remain response-only and do not acquire this storage-summary limit. The frame did not change the public POST/day GET report shapes. Window reads request the first64KiB and validate only the summary, preserving raw arm counts and normalized coverage without parsing grids. All received bytes, including chunk tails, count toward the window budget. This does not verify unread grid/tail integrity. Legacy objects use a verified complete small read or a separate bounded full read as the sole version, charging prefix plus fallback bytes; a disappeared or corrupt fallback is unavailable, not missing. Older writers can restore the coherent but slower legacy format. There is no sidecar, dual-write consistency protocol or migration. Local range/byte evidence is not deployed Worker capacity, policy compatibility or scientific/customer acceptance.

Day GET optionally accepts `slot`, `limit` (1–500, default50) and an opaque `cursor`. It returns `{ok,report,page}`: grids contain only that slot's sorted cross-policy item page and pooled `'*'` cells/slot rates, while counts, policies and coverage describe the same saved report. Missing pooled evidence stays absent. `page` carries `slot,revision,total,offset,limit,next,previous`; cursors bind the full saved content SHA-256 and exact tenant/brand/date/slot/limit. Invalid or mismatched queries return400; changed content returns409 and requires a first-page reload. Paging parameters require a slot. Each page still reads and validates the bounded full saved object server-side; this is response/DOM containment, not storage-read or CPU/SLO improvement.

Both comparison views use paged canonical GETs. Ordinary unpaged GET retains the full diagnostic shape; optional `revision=<64 lowercase hex>` requires that exact saved content or returns409. The legacy CSV action explicitly requests this full revision-matched report, including every policy/item/cell for the selected slot, never just the visible page. Custom POST results remain response-only: the legacy view retains the full custom result for local slot/page navigation and complete CSV, without canonical fetches replacing it. Date/brand/user changes clear that local context. Modern canonical builds reload the latest saved first page and distinguish it from the POST candidate: existing write acknowledgements do not prove those objects equal. Paging does not certify old writers or strengthen canonical write acknowledgements.

Canonical day identity and repair. Every canonical writer — the POST without `policies`, the nightly job and the five-minute job — records `provenance: { version: 1, status: "canonical", policies }` on the day and in its `_summary` frame; `policies` lists, in order, the learning policy and the preset overlays the numbers were computed under. A day written before the member existed reads `provenance: null`. A historical day is affected when a custom overlay replaced it before overlays became response-only: its recorded reporting policies are not exactly the presets of its own learning policy, by name and effective definition. `repairCanonicalDay(r2, ids, learn, now)` in `src/learn/hourly.ts` is the local repair-or-declare path for one day. An unaffected day, recorded or historical in either stored format, is read and never written. An affected day whose sources are retained is replaced by exactly the day the canonical writer computes from them now: the sum of the date's hour aggregates where it has any, the day's ledger rows otherwise, recorded `status: "repaired"`. An affected day for which that rebuild finds no row of its brand — none in the date's hour aggregates, or in its ledger where the date has no aggregate — where it counted some, is declared: it stays readable with the numbers it held, its `provenance` is `status: "declared"` with the overlay policy names that produced them, and windows withhold it with the reason `declared_day`. A later pass repairs a declared day if its sources return and otherwise leaves it byte-identical. Every repair write goes through the canonical writers' own conditional write, on the object the verdict was made on, so a canonical day published meanwhile is never replaced; the repair then judges the day once more from a fresh read, and if it changed again it rejects with nothing written. A rebuild the canonical writer itself refuses writes nothing. No route or job runs the repair: repair applies only to days actually affected, and a fresh stamp is not blocked on it. Inventory and repair or declaration of deployed days is a separate authorized operation.

W29 availability: stored `assisted`/`autonomous` configuration is retained but dormant; neither a stored mode nor an old client enables automation. The slots index's `autonomy` field describes stored configuration, and `learn/queue.proposals_pending` counts historical `proposed` statuses, not actionable work. Both consoles withdraw autonomy editing and proposal decisions. Safe autonomy remains an unmet delivery obligation, not a waived requirement.

## 6. Operators: sign-in and accounts

Under `/auth/`. Password, dual and password-absent OIDC account modes use the existing local operator session lifecycle. There is no open registration or JIT identity creation: an authorized owner provisions accounts, exact federation links and tenant memberships.

| Route | Body | Answer |
|---|---|---|
| `POST login` | `{ email, password }`, at most 4 KiB of streamed body bytes | `{ accessToken, refreshToken, user, mustChangePassword, expiresIn: 900 }`. Password access lasts at most fifteen minutes, refresh seven days; OIDC lifetimes are additionally bounded by configured provider/authentication deadlines; `401` for invalid credentials, `403` for a disabled account, `413` for an oversized body, `429` when the current login budget is exhausted, `503` when signing configuration or login admission is unavailable |
| `POST refresh` | `{ refreshToken }` | A new access token. Each session has its own refresh token; a reset, a role change, a disable, a removal or a sign-out ends all of the account's sessions |
| `POST logout` | none, operator token | Ends the account's sessions |
| `GET me` | operator token | Who is signed in, and the account |
| `POST password` | `{ currentPassword, newPassword }`, human access token | Changes your password, ends all prior sessions and returns `{ ok, user, accessToken, refreshToken, mustChangePassword: false, expiresIn: 900 }`. Replace both stored tokens. At least ten characters, not your email, not one character repeated |
| `GET users` | admin token | Every account: email, name, roles, state, last sign-in. Never a password or a hash |
| `POST users` | `{ email, name, roles? }`, admin token | Creates the account and answers with `temporaryPassword`, once. Roles are `operator` (default) and `admin` |
| `PATCH users/{id}` | `{ name?, roles?, disabled? }`, admin token | Renames, changes the role, disables or enables. An admin cannot disable their own account or take admin away from it |
| `POST users/{id}/reset` | admin token | A new `temporaryPassword`, once; the person's sessions end and they choose their own at the next sign-in |
| `DELETE users/{id}` | admin token | Removes the account and ends its sessions. Not your own |
| `GET audit?limit=` | admin token | Who did what, newest first: successful sign-ins, migrations, sign-outs, passwords changed, accounts created, reset, disabled, enabled, changed, removed. Historical failed-sign-in and lockout rows remain readable; anonymous login attempts no longer append audit rows |

OIDC is disabled when `OPERATOR_OIDC` is absent or the tenant has `enabled:false`. Its version1 tenant registry requires explicit exact `issuer, authorizationEndpoint, tokenEndpoint, jwksUri, origin, clientId, clientSecretRef, algorithms, transactionMs, sessionMs, reauthMs, timeoutMs` when enabled. Algorithms are RS256/ES256; material is referenced by protected `OPERATOR_OIDC_SECRET_*`, never supplied by a shopper or discovered from input. Provider registration, identity links/modes/memberships, lifetimes/deprovision policy and activation remain owner-approved live work.

`POST /auth/oidc/start {email}` returns an authorization URL and same-browser HttpOnly transaction cookie. Email selects an existing linked local identity, never authorizes linking. `GET /auth/oidc/callback/:tenant` validates code/PKCE/nonce/exact issuer and redirects without credentials to console completion; same-origin `POST /auth/oidc/complete {}` consumes once. IdP email/groups confer no roles; current selected-tenant membership alone grants product access. Owner-only `GET/PUT/DELETE /auth/users/:id/federation` manages the explicit link; PUT requires `{mode:'oidc'|'dual',issuer,subject,disabled,expectedRevision}`. The existing account-create endpoint still issues a temporary password; explicit OIDC provisioning removes its hash. Password-only cannot use OIDC; OIDC-only has no ordinary password fallback/reset. Exact stamp-owner recovery deliberately changes mode and revokes sessions. Logout is local, not IdP-wide deprovision. The transaction cookie does not replace current browser token storage.

Human access tokens carry `type: access` and a `sid` bound to an existing refresh session. Every authenticated use checks that session and the current active account, roles and permissions. Temporary-password sessions can only use `me`, `logout` and `password`; refresh preserves this restriction. Those three selfservice routes require a human access session. Auth responses use `Cache-Control: no-store`.

Sign-in, password replacement and account changes conditionally commit against the current account state. A concurrent account or session change returns `409` without new credentials; sign in again and retry with the current state. Password replacement installs its session and revokes the previous sessions atomically. Role or enabled-state changes end existing sessions and require a new sign-in. An existing account is never overwritten by legacy migration. Migration creates the account before committing the first session, so a failed session commit can leave a recoverable D1 account. Removal atomically deletes the account and its sessions and retains the actor-bearing removal audit. That retained record blocks legacy import by account ID or email, including an import already in flight, even if best-effort KV cleanup fails. An authorized admin can explicitly recreate a removed email with a new account ID and temporary password; this preserves the old removal barrier and requires normal password-change onboarding. Protection depends on retaining removal audit records and cannot reconstruct missing historical records. A lost response or failure of another audit write after a successful commit does not undo that commit.

Every login mode requires admission before reading credentials or account stores: at most 100 admitted requests per stamp and 10 per source in each fixed 60-second window. `429` includes `Retry-After` in seconds and `X-RateLimit-Reset` as Unix milliseconds. Denied attempts do not extend that window. Only Cloudflare's `CF-Connecting-IP` selects a source; missing or invalid values share one budget. Its purpose-separated HMAC digest expires with the window; raw addresses, emails and tenant selectors are not stored in this limiter. This assumes trusted Cloudflare ingress. Shared networks and stamp-wide exhaustion can temporarily prevent login, but an attacker no longer locks an account by its email. Existing refresh, logout and password recovery remain outside the login budget. Unknown accounts perform a dummy password derivation and are always rejected; no constant-time or deployed capacity guarantee is implied.

Customer identity is shared across tenants; tenant membership is not ownership of that identity. `GET /auth/authority` reports the current tenant role and separate stamp-owner status. Only a current, non-temporary human session whose account ID is explicitly named in the JSON `STAMP_OWNER_SUBJECTS` allowlist may use global `/auth/users` and `/auth/audit` administration. Owner configuration does not grant product access to any tenant. Global mutations recheck the acting human account/session inside the native transaction; membership changes never reset shared passwords or revoke global sessions.

`GET /auth/memberships` lists only the selected tenant, at most100 records with `next`; continue with `?after=<next>`. Tenant administrators or stamp owners add an existing account using `POST {accountId,role}`. `PATCH /auth/memberships/{id}` accepts only `role`, `disabled`, or explicit `regrant:true`; PATCH and DELETE require `If-Match: "<revision>"`. Removal retains a generation tombstone. Regrant must name its current revision, so delayed creates cannot restore removed access. Tenant administrators cannot create/reset/delete/disable/rename shared identities. The Accounts view separates memberships from owner-only shared-account controls. Existing demo account administration remains separate.

Customer machine credentials are independently registered in D1, not human sessions. A stamp owner uses `POST /auth/service-credentials` in the selected tenant with `{id:<new UUID>,subject,role,expiresAt:<safe integer Unix seconds>,replaces?:<active credential UUID>}`; `role` is `operator`, `admin` or `catalog-import`. The bearer is returned only after registration; only its SHA-256 hash is retained. Every use requires the exact registered ID/hash/subject/expiry and current unrevoked tenant authority. Replacement registers the new credential and revokes the old atomically; DELETE by ID revokes individually. A replacement may change the role: registering a `catalog-import` credential whose `replaces` names a job's `operator` credential narrows that job to the catalogue import. A `catalog-import` credential is admitted on its own tenant, exactly as an operator credential, to eight routes only: `GET /content/catalog`, `GET /content/catalog/history`, `GET /content/catalog/revisions/{n}`, `GET /content/catalog/publication` (kind `catalog`, the default), `POST /content/catalog/validate`, `POST /content/catalog/import`, `POST /content/catalog/pull` and `POST /content/catalog/publication/recover` (kind `catalog`, the default). Every other operator route, `PUT /content/catalog` and the catalogue rollback included, answers it `403` with `code: catalog_credential` before its handler runs: it loads and reads the catalogue, and never publishes slots, learning, priors or a catalogue document directly nor rolls one back. GET lists metadata without hashes/tokens, at most100 entries with `next`/`after` continuation, including revoked history. Human logout does not revoke machines. For a lost/uncertain issuance response, reconcile the supplied ID and explicitly revoke/replace it; do not assume a returned error rolled back a commit. Existing unregistered customer machine tokens must be explicitly replaced; there is no static-grant fallback. The shared tool helper accepts issued `--token`/`OPERATOR_TOKEN` unchanged and permits offline minting only with explicit `DEPLOYMENT_PROFILE=demo`. Unknown token types remain refused; non-enforced demo legacy compatibility is not customer authority.

Apply additive migrations 0012, 0013 and 0014 only under separate operational authority, in that order, after0010/0011. They do not infer memberships, owners or machine credentials; 0014 only admits the `catalog-import` role for machine credentials and keeps every registered credential as it is. Bootstrap owners and assign memberships deliberately before customer cutover. If the last owner cannot sign in, trusted stamp maintenance may invoke the existing operator-seed tool's explicit `--recover --operator-id --expected-revision --operation-id` mode against an exactly matched configured target/owner and protected password stdin. Its one INSERT atomically checks the existing identity/revision, installs a temporary password, revokes sessions and audits recovery; it never recreates a deleted identity or changes roles/memberships. Exact operation/target/password retry reports historical completion without repeating effects; changed payload conflicts, and later disable/delete/password changes remain intact. Ambiguous outcomes require same-operation reconciliation, not an automatic new operation. Password/hash/token values are not printed; privileged hash-bearing SQL still crosses child-process/query interfaces and requires controlled retention. Actual schema/authority migration, credential handoff, signing-key rotation and deployed recovery remain separately authorized live work. Single-key rotation invalidates old human/machine tokens; legitimate humans sign in again and owners explicitly register replacement machine credentials. No overlap/keyring policy is introduced.

Accounts, sessions and the audit live in the platform's database (D1), with thirty days of point-in-time restore. Passwords are stored as PBKDF2 hashes and refresh tokens as their SHA-256; nothing in the platform can read either back.

## 7. Health and the platform's own monitor

`GET /health/live` reports process liveness; `GET /health/ready` checks signing configuration only.
Neither probes stores or writes telemetry. In exact `AUTH_MODE=enforced`, the shared-resource
`/health` probe is unavailable; other modes retain substantive store probes. Its optional Analytics output is held because a stamp-level probe has no configured tenant authority; binding presence is not successful capture.

Every five minutes the platform checks itself, per tenant, from inside the worker: the two KV stores, the
object store, the database, a statistics object, and a real decision served to a synthetic visitor who
withholds tracking, so no shopper capture occurs. Returned and retained diagnostics use fixed check codes and bounded numbers, never caught errors or arbitrary details. Optional result storage, Analytics and alert egress each require their own exact operational destination policy; necessary cooldown/recovery metadata remains separate.

| Route | Answer |
|---|---|
| `GET /v1/{tenant}/monitor` | safe last self-check under current original retention authority; untagged historical records expose only safe status metadata, no raw diagnostics. A kept result that carries the tenant's `governance` counters answers with them, as `{since, scope, refusedPinCount, shortTakeCount}` with `scope: "tenant"` — the scope the counters are kept at, stated by the projection and never read from the store; one written before they existed carries none, and one whose kept `since` or counts are not non-negative whole numbers answers without the member, never with a clamped count. A kept monitor result that carries `unreturnedPinCount` answers it after those members under the same rule, and one without it keeps its former shape, with `refusedPinCount` counting refusals only. A kept result that carries `stoppedSlots` answers it rebuilt row by row, `scope` and `reason` stated by the projection. A kept result that carries `learningReads` answers it rebuilt member by member, every outcome of the vocabulary with its count and `scope` stated by the projection. Operator token; no-store |
| `POST /v1/{tenant}/monitor` | runs a check now and answers with it, including `governance: {since, scope, refusedPinCount, shortTakeCount, unreturnedPinCount}` for the tenant (`refusedPinCount` counting refusals only, and `unreturnedPinCount` the pins left reserved and unserved because their module was not returned, present once the tenant's counters have counted one), read from the slot-governance counters and never from the probe's own compose, and `stoppedSlots: {priorVersion, total, slots}`, the slots the tenant's own prior document stops publishing, derived from its published learn and prior documents, and `learningReads: {since, scope, lift, ring}`, how the tenant's own decisions' lift and ring reads ended, counted where the decisions are served and never for the probe's own compose. Operator token |

When a check fails, or a refused-default decision takes longer than the 200 ms diagnostic threshold, the platform posts an alert to the
webhook configured as the worker secret `ALERT_WEBHOOK_URL`: any URL that accepts a JSON post (a chat
channel's incoming webhook, an on-call tool). The post carries `text` (one sentence), `environment`,
`tenant`, `at`, `problems` and `checks`. One alert per half hour per tenant while the problem lasts; a
recovery is retried until HTTP delivery succeeds. Missing or expired policy holds optional sinks, retaining a minimal pending-recovery marker. Missing secret reports no-webhook; redirects are refused. HTTP success is not proof of paging or provider retention.

Operational policy is configured in the existing tenant connector entry as `telemetry:{environment,schema:"ops-v1",analytics?,monitor?,alert?}`. Environment must match the stamp's canonical development/staging/production/test value. Analytics has `{binding:"ANALYTICS",dataset,accessPolicy}`; monitor has `{binding:"CACHE",namespace:"monitor",accessPolicy}`; alert has `{binding:"ALERT_WEBHOOK_URL",destination,urlSha256,accessPolicy}`. Names/references are non-secret; alert URL is pinned by SHA-256, never retained verbatim. Each exact descriptor (including tenant/environment/schema) has a separate `RETENTION` key `telemetry.analytics.<digest>`, `telemetry.monitor.<digest>` or `telemetry.alert.<digest>`, using the same sorted-JSON SHA-256 and explicit policy fields above. No default periods or inferred approval exist. These categories never join behavioral `external.*` copy lifetimes.

The operational AE point is `blobs:["ops-v1",environment,tenant,"monitor","ok"|"problem",alertStatus]`, bounded numeric health/latency values, and canonical tenant index. `alertStatus` is the same closed delivery code returned by the monitor. A separate closed-code log reports result/recovery persistence failures even when KV is unavailable. Behavioral ledger AE helpers remain inert; canonical ledger capture is independent. Frozen erasure-generation obligations retain these configured non-secret descriptors without inventing subject IDs or historical coverage. Generic unowned event-webhooks remain fail-closed; configured destinations alone do not authorize delivery.

Personalized continuity requires a separately approved optional `telemetry.synthetic` descriptor; the CACHE-only monitor descriptor does not authorize it. Its exact fields are `version:1`, `enabled:true`, `lifetimeMs` (1–300 seconds), `stageMs` (1–30000 ms and no longer than the lifetime), `decisionMs` (1–200 ms), `eventMs` (1–300 ms), `thresholdSource:"document-32-server-diagnostics"`, and `destinations`. Every existing CACHE, SESSIONS, STORAGE, EVENT_QUEUE, SHOPPER_REFLEX, DECISION_RING, LEARN_STATS, REGION_TREND and PERSONALIZATION_WEBSOCKET binding requires one descriptor `{binding,purpose:"isolated-synthetic-monitor",namespace:"ops-synthetic-v1",accessPolicy}` and its own exact `telemetry.monitor.<digest>` policy. These ranges are implementation ceilings; no configured duration, activation, access approval or live threshold acceptance is inferred.

The monitor tests both shopper hosts for each configured tenant, compares required product schema objects and migration history, and keeps producer acknowledgement, actual correlated source consumption, ledger capture and learning effects separate. Synthetic grants use fixed physical object slots and bounded data namespaces; actual customer state and measurement remain outside them. Missing approval/configuration, empty decisions, unavailable consumers and incomplete stages cannot report complete continuity. Cold local samples and five-minute diagnostics do not establish personalized P95/P99, customer SLOs or on-call receipt. Live resources, retention/activation, destination receipt and on-call acceptance remain separate requirements.

The local Wrangler manifest declares distinct desired environment dataset names and disables persistent/invocation logs. This is not provisioning or deployed attestation. Account/script/version/binding/dataset access and retention readback, active-version coverage, historical dataset/log disposition, customer/provider obligations and authorized deployment remain open; future minimization never erases historical data.
