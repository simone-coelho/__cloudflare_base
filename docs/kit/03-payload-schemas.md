# Payload Schemas

## Durable non-learning streams

Version1 `behavior` rows retain stable record/event identity, provided/request origin, signed tenant/visitor/session, original event/source/time, original source/destination retention and an explicit typed data projection. `ms` and `dwellMs` mean milliseconds and require finite nonnegative numeric values; malformed duration is not coerced. Arbitrary fields, URL/query, credentials and private profiles are excluded.

A `product-sort` row is a whole ranking receipt, bounded at1MiB without truncation. Dedicated search additionally retains exact catalog/configuration/interpretation commitments and structured constraints, not raw queries. Both streams use existing managed owner recovery/canonical claims; neither contributes learning exposures/credits or learning object budgets. Source durability, queue acceptance, canonical recovery, remote readback and a delivered HTTP response are distinct facts.

Every record the platform accepts, writes or returns, field by field. Each symbol is defined the first
time it appears and nowhere else.

## Event payloads, by type

The `data` object of `POST /realtime/action`, by `type`.

| Type | Fields in `data` |
|---|---|
| `page_view` | `path` |
| `product_view`, `add_to_cart`, `wishlist_add` | `productId`, plus the registry's attributes when the brand scores them from the event: `line`, `category`, `subcategory`, `silhouette`, `occasion` (a list), `price_usd` |
| `purchase` | `orderId`, `value`, `currency`, `items[]` of `{ productId, quantity, price }`. Unique per `orderId` for the shopper: a second purchase event naming an `orderId` the shopper's purchase already named is answered `dropped: "duplicate_order"` and writes no outcome, no credit and no interest; the same event delivered again (its `eventId`) is not a second purchase, and a purchase without an `orderId` is never deduplicated ([API reference](./02-api-reference.md#purchase-uniqueness-per-orderid)) |
| `content_impression` | Authenticated renderer admission: `contentId`, `slot`, `decisionId`, `renderOffer`, `page`, `pageInstance`, `position` (the page-wide order) and `slotPosition` (the position within the slot, from 0, which the SDK sends and admission then holds to the record's position; without it `position` is held to it); original event nonce/time are mandatory. On a marked module container it is the module's impression, once per page instance. A `content_impression` is **not a learning input today**: it carries no reward, so it produces no outcome record and credits nothing. What the learning loop counts is the slot's declared exposure unit — the served decision under `served-v1`, or the durably admitted render under `rendered-v1` — never a viewable impression. The acknowledgement answers at durable admission: `render` with `status: 'durable'` and `source: 'pending'` (its behaviour capture's receipt `pending` too), the ledger and learning effects following right after the answer in the shopper's own order, and `source: 'recovered'` on a later re-send of the same event once they ran ([API reference](./02-api-reference.md), the rendered-v1 acknowledgement under `POST /v1/{tenant}/decisions/snapshot`) |
| `content_viewable` | The viewable impression, sent by the SDK and never by the page: `contentId`, `slot`, `slotPosition`, `decisionId` (of the render acknowledgement), `page`, `pageInstance`, `position` (the page-wide order), `customerContentId`, `contentType`; one per piece per page instance, once the acknowledgement is held and the container has been at least half in view for one second without interruption. It weighs 0 whatever the registry says, builds no interest, is no signal and no interaction of the visit, carries no reward (no outcome record) and is never an exposure: no learning denominator changes |
| `content_click`, `video_complete`, `video_view` | `contentId`, `slot`, original acknowledged `decisionId`; optional `customerContentId` and `contentType`; from the SDK, `slotPosition`, the acknowledged placement's position within the slot, when its decision named one. A `content_click` is also a module engagement: a click inside a marked module container, or an interaction it declares in `data-op-engage`, named as `interaction` (the declared interactions `sizeguide:open` and `reviews:open` of a module that owns a size guide or reviews). A `video_view` is the video played for three seconds: a content action read off the piece's catalogue format (`tags.contentType`) as `video_complete` is, at the weight the registry publishes for it (`weights.video_view`, 1 in the shipped registry; a registry that names none weighs it 0, as every weight), and not a reward |
| `content_dwell` | the same, plus `ms`, milliseconds on screen; the SDK sends it only after the slot's minimum on screen, its own in `dwellMinMsBySlot` (for example 30000 on an editorial slot), else `dwellMinMs`, one second |
| `product_dwell` | `productId` and `dwellMs`, the milliseconds on the product page, sent once per product view past 20 seconds, plus the registry's attributes when the brand scores them from the event. `product_dwell` with its `dwellMs` feeds the visit's dwell counter (`category_dwell_ms`), counts as an interaction and weighs 0 unless the registry publishes a weight |
| `layout_exposure` | The per-view beacon of a cached layout, sent by the SDK (`client.listen.layoutExposure`) once per page view and only under tracking consent: `contextKey` (the `X-Context-Key` the cached layout was answered under), `page`, `slot`, `modules` (the module ids drawn, in drawn order, at most 50, each once) and `pageInstance`. It is answered by the route before either shopper host, so it builds no interest, is no signal and no interaction of the visit and writes no outcome record; it adds one exposure per drawn module to the learning of the context its key names, and nothing without tracking consent, with a key the engine did not issue or for a page view already counted ([the context-only layout switch](#the-context-only-layout-switch)) |
| `custom` | `event`, the real name, plus anything |

The event conventions, each a `custom` event weighing 0 until the tenant's registry publishes a weight for its
name, and built only from the source fields the registry names:

| `event` | Fields in `data` |
|---|---|
| `search` | The values the site's search resolved the query to, in the registry's source fields (`category`, `line`, …): `search` carries the resolved values only, never the query text |
| `filter_applied` | `dimension` and `value`, the facet's, with the value also in the registry's own source field. The sale filter and the sale page send `filter_applied` with `dimension: "priceStatus"`, `value: "sale"` and `priceStatus: "sale"`, raising `priceStatus` sale |
| `remove_from_cart` | `productId`, plus the registry's attributes when the brand scores them from the event; weighs 0, no signal for the signal floor. Under the tenant's `suppression` settings it suppresses, for the shopper, every registry value it carries for the action's window in `days` ([negative preference](#negative-preference-suppression-with-an-expiry)) |

`data.brand` is accepted on any of these and is the brand the shopper's page was served under — the
same value the decision request carried. A reward-bearing event that names it is measured in that
brand's statistics; one that names none is measured in the tenant's own brand, as before. Send it
wherever a tenant serves more than one brand, or a click on brand A's hero lands in brand B's numerator
while the exposure stays in A's denominator. The SDK sends it for you: a client configured with
`brand` puts that value on every action it sends, whatever the type, and a client configured without
one sends none, whatever a page or tag layer put on the event (a product's brand label travels as
`productBrand`). A correlated event whose `brand`
disagrees with the brand of the `decisionId` it names is refused, not pooled, and the refusal is
counted on the outcome receipt as `brandMismatched`. An event that names no `decisionId` is counted
there as well: `brandMismatched` adds each placement of another brand it would have been credited to
under the learning policy, in a slot its own brand credited nothing.

An attribute value the tenant's published catalogue does not name, on a dimension that catalogue does
name values for, builds no affinity — that value alone, whatever else the same event carries. A
dimension the catalogue tags nothing on constrains nothing. The answer's `signals` reports the result:
`recognized` when at least one value built affinity, and `unrecognized` listing every product the event
referred to that could not be placed, the top-level `productId`/`product_id`/`sku` and each `items[]`
product of an order, never an attribute value.

This holds at every door an interaction can arrive by, not only the live one: an explicitly buffered
action (`"processing": "buffered"`, which answers `signals` of its own), a content interaction and a
warehouse row posted to `POST /v1/{tenant}/identity/events` are all measured against the same published
catalogue by the same rule.

An import row the vocabulary left with nothing to build is reported in the answer's `skipped[]` under
its own coded reason, `out_of_vocabulary` — a different fact from `no registry attribute on the row`,
which is the row that carried nothing the registry names at all. The first is answered by publishing
the value, the second by sending a different column.

## The decision

One item in snapshot `decisions[]`; the set carries its original `pageInstance`. The engine also sends the open page view's set over the socket as a `content_decisions` frame whenever it differs from what the page view last received; the answer to the page's own request is never also sent.

| Field | Meaning |
|---|---|
| `contentId` | Our id for the piece |
| `decisionId`, `renderOffer` | Exact original receipt carrier and opaque authenticated offer when tracked/rendered-v1; receiving them proves no rendering or admission |
| `customerContentId` | Your id for the piece; what you render by |
| `type` | The piece's kind: `editorial`, `guide`, `film`, `lookbook`, `campaign`, or your own |
| `slot` | The slot on the page |
| `within` | On a decision of an inner content slot only: `{ module, slot }`, keys sorted, the page's declared layout slot and the module whose content the inner slot is ([inner content slots](#inner-content-slots)). Absent on every other decision |
| `order` | Position across the whole page, in page order |
| `score` | The final score that ranked it |
| `strategy` | `affinity`: the shopper's interests decided. `default`: nothing was known, the catalog's order decided. `tenant-pinned`: a merchandiser pinned it |
| `explain.drivers[]` | `{ dim, value, a, weight }`: the dimension and value that contributed, the shopper's interest `a` in it (0 to 1), and the slot's weight for that dimension. Two more `dim` values can appear: `regional`, the population prior, and `external`, your model's term |
| `explain.note` | In words, when a rule rather than a score decided |

## The decision record

One per admitted position, available through authenticated operator/ledger readback, not public snapshot `records[]`. Snapshot candidate receipts are not evidence of persistence or rendering. Rendered-v1 admission retains the original decision ID/time and adds its separate original render identity.

| Field | Meaning |
|---|---|
| `decision_id` | `{tenant}:{time in base 36}:{visitor}:{page}:{slot}:{position}`. Sortable by time; the brand and the hour are derivable from the id alone |
| `tenant`, `brand` | Isolation keys |
| `visitor_id`, `session_id` | The first-party identifiers. `session_id` is the platform's session, the one attribution compares |
| `customer_id` | Your identifier for the shopper that the decision request carried (`customerId`, passed with `setCustomerId`), beside `visitor_id`, under tracking consent; absent when the request carried none, and never compared by replay |
| `identity_anchor` | `visitor` when the state hung on the durable id, `session` when only a session was available, `none` when no state could be read |
| `ts` | Original server decision time; never rewritten to render/replay time |
| `experiment` | `{ id, saltVersion, arm, anchorGeneration, reason? }`: the experiment this record's arm belongs to, as the decision path answered it. `id` is `{tenant}:{brand}:{salt}`, so rotating the published salt starts a new experiment instead of re-randomising the running one; `saltVersion` counts the distinct salts this tenant has published up to the pinned revision, and is `null` where the published history the platform can read does not reach the first one. `anchorGeneration` is the generation of the shopper's persistent enrollment anchor. Written by the producer and delivered unchanged — never re-derived later from a then-current document. `arm` here is the ASSIGNMENT (`personalized`, `default`, `no_learning`, or `ineligible` for a shopper who never consented to personalization and so was never drawn), which is not the same field as the record's own `arm`, the experience served. `reason` says why an assignment is `ineligible` — `personalization_consent` when she has not consented to personalization, `anchor_unavailable` when her enrollment anchor could not be read at that moment — and is absent on a randomised assignment. Absent on records written before enrollment was persistent |
| `measurementBasis` | `served-v1` (also absent legacy metadata) or `rendered-v1`; incompatible counts are not pooled |
| `rendered` | Rendered-v1 only: `{version:1,eventId,at,pageInstance}` from the original durably admitted renderer signal, not proof of human visibility |
| `page`, `slot`, `position` | Where it was served, and the rank inside the slot |
| `within` | The record of an inner content slot names the module it sits in: `{ module, slot }`, keys sorted, the page's declared layout slot and the module whose content the slot is. Absent on every record of any other slot, compared by value in replay, and carried on the shopper's receipt as `within` with no new sentence ([inner content slots](#inner-content-slots)) |
| `item_id`, `customer_item_id` | What was served, both ids |
| `candidates[]` | `{ contentId, score }` for the top candidates considered |
| `cell` | The shopper's context: `channel`, `visit_bucket` (`1`, `2-3`, `4+`, `unknown`), `region`, `affinity` (the leading interest as `dim:value`, or null), `stage` (`early`, `mid`, `late`, `unknown`: the stored token the learning statistics pool on) |
| `journey` | The journey stage this decision was made in, in the reported vocabulary — `{ stage, version }` with `stage` one of `exploring`, `thinking`, `deciding` — where `version` names the published threshold revision that derived it, the compiled default configuration's own version at `revision: 0` when your tenant has published no `journey` block and the engine's compiled default decided, or null when a stored block could not be read and the engine fell closed to the first stage. Absent when the engine did not personalize. `cell.stage` carries the same stage in the persisted grammar (`exploring`→`early`, `thinking`→`mid`, `deciding`→`late`), which is what the learning key `s=` pools on. The shopper's own receipt carries the same block |
| `arm` | `personalized`, or the holdout's `default` or `no_learning` |
| `explored` | True when exploration served it on purpose |
| `authority` | `engine`, `pin` or `default` |
| `versions` | `config`, `catalog`, `slots`, `learn`, `lift`, `prior`, `policy`: the revision of each input. Zero names an absent/compiled input; current absent slots yield no selections. What a replay reads back |
| `config_label` | The human-readable label of the configuration revision |
| `featured_product_ids` | The products the served piece features, when it names any: an outcome naming one of them credits this decision under the default policy, and a warehouse joins it to the product decision |
| `explain.score_base` | The score before learning: interests times weights, plus the population prior and your model's term when they applied |
| `explain.regional` | When the population prior applied: `region`, `level`, `lambda` (its share of the score), `version`, `events`, `contribution` |
| `explain.contextPrior` | When the context prior contributed to this position: `{ channel, contribution, events, lambda, level, version, visitBucket }`, keys sorted — the shopper's entry channel and visit bucket, the level read (`channel_visit` for the pair, `channel` for the channel alone), `lambda` (its share of the score; 1 below the signal floor), the snapshot's `version` and `events`, and what it contributed. Compared by value in replay; the receipt says it in words ([the context prior](#the-context-prior)) |
| `explain.lift` | The learned term, defined below, or null when nothing has been learned for this item in this cell |
| `explain.score_final` | `score_base × lift^γ`. Equal to `score_base` while γ is 0. On a layout slot that opts into the layout blend, `R + (1 − p) × B + p × Q` instead (`explain.blend`) |
| `explain.exploration` | When `explored`: `mode`, `reason`, `bucket`; retained historical Thompson receipts can include `sample` (Thompson is no longer writable or live). On each of the two modules an adjacent swap exchanged it is `{ bucket, mode, positions, reason }` (keys sorted), `mode` `adjacent-swap` and `positions` the two adjacent positions swapped, counted from 1 within the slot ([adjacent swaps](#adjacent-swaps-and-position-effects)) |
| `explain.control` | `reject` or `freeze` when a merchandiser's control applied to the item |
| `explain.external` | Your model's term: `kind`, `ref`, `version`, `weight`, `score`, `contribution`; or `status: "unavailable"` with `reason` |
| `explain.merchandising` | Season, promotion and margin: `boost`, `clamped`, `drivers[]` each with the delta it caused, and a sentence |
| `explain.stage` | The slot's journey-stage rule on this piece: the shopper's stage, the piece's fit, the delta it caused, and a sentence |
| `explain.freshness` | The freshness bonus: `ageDays`, `decay`, `applied`, and a sentence |
| `explain.fatigue` | The fatigue penalty: `served` times inside `windowHours`, `applied`, and a sentence |
| `explain.diversity` | The slot's diversity rule touched this position: the pieces that yielded to it (`skipped`), or `relaxed` when it was served over the limit because nothing else was eligible |
| `explain.shortTake` | The pinned slot this position belongs to served what it could and still fell short of its `take`: `take`, `served`, `empty` and a sentence. Present on every record that slot wrote, pinned position or ranked, so the receipt says it; a slot whose pin was REFUSED writes no record at all, and the operator's per-slot `governance` counters on `GET /v1/{tenant}/learn/slots?evidence=1` are that occurrence's only home |
| `explain.configuredOrder` | This position was set by the layout slot's configured per-context order: `{ context: { channel, visitBuckets }, modules }` (with `device` in the context when the order names one, `{ channel, device, visitBuckets }`), the context the order was published for and the whole order as published, keys sorted. Present only on the positions the order set — a pinned position keeps authority `pin` and carries none — and compared by value in replay; the record's own `position` is the position it was served at, so a listed module that was not eligible at decision time shows as a later module served one place earlier. The shopper's receipt carries the same block and says it in words. On a slot that opts into the layout blend the order supplied the rank base `R` and the blend ranked its listed modules, and the block is carried beside `explain.blend` An off-limits module held at its place in the order (P04) carries it too, beside `explain.moduleRule` |
| `explain.blend` | The layout blend ranked this position: `{ B, Q, R, p }`, keys sorted, defined in [the blend block](#the-blend-block), so that `R + (1 − p) × B + p × Q` is `score_final`. Present on every position an opted-in layout slot's blend ranked, absent on a pinned position and on every other slot, and compared by value in replay; the shopper's receipt carries the same block as `blend` |
| `explain.band` | The record names the band this module was ranked in on a slot with position bands: `{ from, to }`, keys sorted, the positions that band covers, counted from 1 within the slot, its scores (`score_base`, `score_final`, the drivers and the seed rules' contributions) computed with that band's weights. Absent on a pinned or held position, on a position a configured order set and on every record of a slot without bands, and compared by value in replay; the shopper's receipt carries the same block as `band` ([position bands](#position-bands)) |
| `explain.signalFloor` | This position's slot was decided on context alone because the shopper was below its signal floor: `{ floor, signals }`, keys sorted, the floor in force (the slot's own, else the tenant's; a whole number or `never`) and the shopper's count of signals. Present on every record of such a slot and on no other, and compared by value in replay; the shopper's receipt carries the same block and says it in words ([the signal floor](#the-signal-floor)) |
| `explain.scope` | This position's slot is declared `scope: 'anchor'`: the anchor product (and variant) the request named and its candidates were limited to, `{ anchor, variant? }`, keys sorted, from `ctx.anchor` and `ctx.variant`. Present on every record of such a slot and on no other; the record's page-level inputs carry the same signals as `inputs.anchor` and `inputs.variant`, so the replay reproduces the candidates, and the shopper's receipt carries `scope` with one `why` sentence that names the anchor |
| `explain.moduleRule` | A position pin or an off-limits mark of the layout slot placed this module: `{ position, rule }`, keys sorted, `rule` `pinned` (the module pinned at a position, served there) or `off_limits` (the off-limits module held at its baseline position), and `position` the position the rule set, counted from 1. Present only on such a record, whose authority is `pin`, and compared by value in replay; the shopper's receipt carries the same block as `moduleRule` and says the rule and the position in words ([position pins and off-limits modules](#position-pins-and-off-limits-modules)) |
| `explain.layoutReason` | The layout reason of the page's declared layout slot: `{ cause, slot, status }` (with `n` and `nMin` for the cause `no_level_reached_nmin`) when the served order is unchanged against the slot's baseline, or `{ moves, slot, status }` when it changed, each move `{ from, module, term, to }`, with `withheld: [{ cause, module }]` when a module the baseline would have served was withheld before ranking (`cause` `nothing_to_show` or `eligibility_rule`); keys sorted. The same value on every record of the slot and on the decision set, present only on a declared layout slot's records, and compared by value in replay; the shopper's receipt carries it as `layoutReason` and says it in words ([the layout reason](#the-layout-reason)) |
| `explain.suppressions` | The suppressions in force on the shopper when this decision was made: `[{ action, dimension, expiresAt, value }]`, keys sorted, `expiresAt` in epoch milliseconds, sorted by dimension then value ([negative preference](#negative-preference-suppression-with-an-expiry)). A suppressed value contributed no interest term (`inputs` holds the interest vector as scored). Present on every record of a personalized decision made while one was in force, on each slot that read the shopper's interests (its pinned positions and a slot that weights none of the suppressed dimensions included), and only where a suppression was applied: absent on the holdout's `default` arm, for a shopper not personalized (personalization refused, or a record that cannot be read), on a slot decided below the signal floor and on the record of an off-limits layout slot; compared by value in replay, a record without it replaying as before; the receipt carries it as `suppressions` and names each value, its action and its expiry date in words |
| `explain.baselineOrder` | The baseline of the page's declared layout slot, a list of module ids cut at the slot's take: the merchandiser's fixed positions where their rules put them and, on every other position, the configured order for the shopper's context where one matches, else the modules the slot can serve in catalogue order, drawn before a module is withheld (the layout reason's baseline). The same value on every record of the slot, present beside `explain.shadowOrder` and `explain.shadowTerms` on every record of a declared layout slot decided on an arm that personalizes (never on the holdout's `default` arm, never on an off-limits layout slot's record), compared by value in replay, a record without it replaying as before ([the baseline and the shadow](#the-baseline-and-the-shadow)) |
| `explain.shadowOrder` | The order the slot would have served with every term applied and the learned term at full trust, γ 1, whatever γ serves (a merchandiser's frozen lift applied like a learned one), or on a slot that opts into the layout blend at its `shadowP`: ranked as the served order is, pins and off-limits modules fixed, withheld modules absent, with no exploration pick and no adjacent swap, cut at the take. Recording only: nothing served, counted or credited reads it |
| `explain.shadowTerms` | `{ module: [term] }`, keys sorted: for each module whose place in `shadowOrder` differs from its place in the baseline (less any withheld module, as the layout reason's moves compare), every term that would have moved it, in the layout reason's words and the engine's fixed order. A module of the baseline's take that the shadow pushes out of its take is named with the terms that moved it down, compared with the modules of the shadow's take that passed it; a module in neither take is not named; `{}` when no module moved |
| `explain.successEvent` | This position's slot publishes a conversion table (`slots.{slot}.conversions`): `{ event, value }`, keys sorted, the success event the module is credited for — its declared `successEvent`, else the slot's reward — and the table's value for it in the slot's currency, `value` null when the table does not value it, so an outcome of it credits nothing. Present on every record of such a slot, every arm, and on no other record; the decision's credit is read off it online and in every offline fold, and the shopper's receipt carries the same block as `successEvent` ([success events and conversion tables](#success-events-and-conversion-tables)) |
| `inputs` | The interest vector as scored, the regional shares, the context prior's shares (`context_share`, keys sorted), your model's scores and the served counts the fatigue term read, when they applied: what makes a replay exact. Where a population prior applied and the page's declared layout slot ranked above the signal floor, `prior_lambda: { context?, regional? }` (keys sorted) states each prior's weight λ, so the layout reason replays exactly from any record of the page. `nothing_to_show` is the page's report of the modules with nothing to show for this page view as the decision accepted it (each id once, sorted), written when the page sent one, and `eligibility_verdicts` each eligibility rule's verdict on the decision's cell, module to `true` or `false` (keys sorted), for every live module of the page that carries a rule; the replay withholds the recorded report again and evaluates each rule again on the recorded cell, with no new replay marker. `inputs.replay` is the page manifest the REST reference describes. `inputs.explorationRules` sits beside it, never inside it: `"recorded-draws-v1"` names the exploration rules the decision was made under — a draw inside the configured share is `explored` even where it agreed with the ranking's own leader, `candidates` is the top candidates by score before the explored piece moved with that piece beside them, and an item under a merchandiser `reject` or `freeze` is never explored. Every record whose decision had the learning layer carries it (without that layer no exploration rule runs). A record without it was written before those rules and replays under the rules it was written with; a present value this build does not implement refuses the replay |

### The lift block, and every symbol in it

| Symbol | Meaning |
|---|---|
| `reward` | The outcome the slot learns against: `click`, `dwell`, `video_complete`, `wishlist`, `add_to_bag`, `purchase` or `custom` |
| `measurementBasis`, `objective` | Declared served/rendered denominator and `unit`, `revenue` or `margin` credit units |
| `n` | Exposures of the declared basis, decayed over the learning horizon; not automatically human views |
| `s` | Attributed weighted credit, decayed the same way; units follow the slot objective |
| `p₀` (`p0`) | The slot's per-exposure baseline in that cell, in the selected objective unit; not necessarily a probability |
| `n₀` (`n0`) | The strength of the prior in exposures: how many observations the baseline is worth when the item's estimate is shrunk toward it. An imported prior brings its own |
| `p̂` (`p_hat`) | Smoothed per-exposure quantity `(s + n₀ × target) / (n + n₀)`, where target is imported prior `p` when applicable, otherwise slot `p0` |
| `lift` | Dimensionless relative rate `p̂ / p₀`, clamped; not causal incrementality, universally CTR, or evidence of visibility. Frozen values are labeled controls, not observations |
| `level`, `level_words` | Which cell answered, from `everyone` to `channel, visit bucket, region and affinity cell`: the finest level with enough evidence. On a pooled module's record, from `everyone` (every page's evidence) through `page` (level 1, this page's own) and `page and channel` to `page, channel, visit bucket, stage, region and affinity cell` (level 6) |
| `pooled` | `true` when the lift was read from the one record of a module the catalogue declares pooled; absent for every other module |
| `γ` (`gamma`) | The trust dial per slot, 0 to 1: how much the lift moves the score |
| `prior` | `{ p, n }` when an imported prior was in force for the item |
| `evidenceFloor` | `{ floor, lacking, n, page }`, keys sorted, when the page's evidence floor shrank the estimate: `p_hat` is then the estimate shrunk toward `p0` by `lacking`, F − n, exposures at the baseline rate, and `lift` follows from it ([evidence floors](#evidence-floors-evidencefloors)) |
| `asOf` | `{ latest, publishedAt, version }`, keys sorted, on a decision record whose lift was read from a snapshot that was no longer the statistics object's latest publication but one of its recent publications, recognised under the same witness within `LIFT_RECENT_WINDOW_MS` (ten minutes) of its own publication: that snapshot's `version` (the record's `versions.lift`) and `publishedAt`, and the `latest` version published. Absent when the snapshot was the latest; compared by value in replay |

On a layout slot that opts into the layout blend the lift block is kept beside `explain.blend`: its
`gamma` is the slot's dial, which the blend does not apply, and `applied` is `p × Q`, what the learned
term added to the score.

### The blend block

The layout blend scores a module of an opted-in layout slot
`R + (1 − p) × B + p × Q`.

| Symbol | Meaning |
|---|---|
| `R` | The rank base `(M − i) / M`: `M` modules in the slot's baseline and `i` this module's place among them, counted from 0, so the first module's `R` is 1. The baseline is the configured order for the shopper's context where one is served — its listed modules still eligible after eligibility, the slot's exclusions and what the page already served or reserved, in the order's sequence — else the modules the slot could serve after the same removals, in catalogue order. Three decimals |
| `B` | The behaviour score before the learned term: the interests matched times the slot's weights, with the arrival's seeds, the region's trend, the bonus for completing the request's anchor product and the journey-stage, freshness, fatigue and merchandising terms where the slot sets them. 0 for a shopper with no signal, and on a layout that weights no shopper dimension and sets none of those terms. Three decimals |
| `Q` | The learned lift at the finest level with enough evidence, or the lift a merchandiser froze, clamped to `liftMin` and `liftMax` of the learn document, minus one. 0 where no level answers, where a merchandiser rejected the lift, and on the holdout's `no_learning` arm. Three decimals |
| `p` | The slot's published `blend.p`, 0 to 1, exactly as published (0 when the dial names none). At 0 the learned term adds nothing; at 1 the behaviour term adds nothing |
| `shadowP` | The slot's published `blend.shadowP`, 0 to 1, 0.1 (10 percent) when the dial names none: the p at which the slot's shadow order (`explain.shadowOrder`) is ranked, never the served order's; `Q` there is the learned lift's whatever the arm. It is not written on `explain.blend` |

## The outcome record

One per reward-bearing event, written after the response.

| Field | Meaning |
|---|---|
| `outcome_id` | `{tenant}:{time in base 36}:{visitor}:{event}`, then `:n1:{eventId}` when the event carried its nonce, as every outcome the action route records does (`src/ledger/records.ts:411`); the time is the one the engine admitted the event at, the time in the id of the event's behaviour record. The answer to the action that recorded the outcome names this id as `outcome.recordId`, beside `behavior`, on both hosts, once the outcome is durably admitted; it is named on the answer and never added to the record (`src/routes/realtime.ts:393`, `:398`) |
| `type` | The reward type the event maps to |
| `event` | The wire event name, so a custom reward keeps its own |
| `item_id`, `slot` | The content id and slot the event named, when it did |
| `position` | The position within `slot` the event named as `slotPosition` (a module engagement names its module's), a whole number from 0; absent when the event named none, and on every outcome recorded before it was carried, which reads as not stated, never as position 0 |
| `decision_id` | The acknowledged decision the event named (`decisionId`), when it did |
| `value`, `currency` | For a purchase |
| `margin` | The margin the event carried (`margin`, or the items' margins times quantity summed), for a slot that learns margin; null when none |
| `products` | The products the event named (`productId`, `sku`, or each of `items[].id`); a purchase credits the content that featured one of them, except in a slot whose own attribution policy is `module-tied` ([where a page conversion lands](#where-a-page-conversion-lands)) |
| `session_id`, `visitor_id`, `brand`, `arm`, `ts` | As on the decision |
| `customer_id` | Your identifier for the shopper that the event carried (`customerId`), beside `visitor_id`, under tracking consent; absent when the event carried none |
| `experiment` | `{ id, saltVersion, arm, anchorGeneration, reason? }`: the experiment this outcome's VISITOR is enrolled in, resolved from her persistent enrollment anchor when the outcome was recorded, so an outcome is attributable to her assignment whether or not a served piece matched it. The producer stamps the outcome with the visitor’s enrollment and her consent at the moment it is recorded, so an outcome recorded while personalization is off says `ineligible`; an outcome recorded on a path that does not stamp carries no block at all. `reason` says why: `personalization_consent`, or `anchor_unavailable` when her enrollment anchor could not be read at that moment. `saltVersion` is `null` where the published history the platform can read does not reach the first salt. Absent on records written before enrollment was persistent, and on a visitor whose enrollment could not be resolved |

The outcome record is the admitted source and never changes after it is captured: how the outcome was
credited is itemised on the attribution record the visitor's ring derives when it credits it, never on
this record ([where a page conversion lands](#where-a-page-conversion-lands)).

## Before sign-in: the loaded hook, the carried identifier and the first request

The SDK core's `onLoaded(callback)` runs the callback once, when the client has loaded, or once at the next turn when it had already loaded; nothing it throws changes the client.

The page's `setCustomerId(id)` passes your identifier for the shopper before recognition, a hashed identifier of 1 to 128 letters, digits and `_ + / = . -`. While tracking is allowed it travels as `customerId` on the action envelope (`POST /realtime/action`) and on the decision request body (`POST /v1/{tenant}/decisions/snapshot`), and the records written from them carry it as `customer_id` beside `visitor_id` (the decision record and the outcome record above). The customerId is carried, never treated as proof: no state is keyed, linked, merged or selected by it, no session is issued from it, and under refused tracking nothing carrying it is written.

The browser's own object keeps the last value an anonymous browser carried under tracking consent, as one optional member of its existing grant record, written only when it is new or changed, and only to name it on that browser's link answer as `customerId`; a browser that carried none keeps its record as it was, and an erasure writes the browser a fresh record without it. The link answer's customerId is never proof: the link and the merge are the signed `accountId`'s, and the person's record gains nothing.

A decision request with no session is a new visitor's first request: its answer is the decision set with the session the engine issued as `session`, the member `POST /v1/{tenant}/identity/session` answers, and no other answer of the decision request carries a session.

| Member | Where | Meaning |
|---|---|---|
| `customerId` | action envelope, decision request body | Your identifier for the shopper, 1 to 128 letters, digits and `_ + / = . -`; carried beside the visitor's own and nothing more |
| `customer_id` | decision record, outcome record | The same value, written under tracking consent only |
| `session` | decision request answer | Only on a request that carried no session: `{ capability, tenant, subject, sessionId, kind, grantId, authorityEpoch, iat, exp, consent }`, the grant the session route issues |
| `customerId` | link answer (`POST /v1/{tenant}/identity/link`) | The identifier the browser carried before recognition, the last one its own object kept; absent when the browser carried none. Never the linked `accountId`, which alone decides the link and the merge |

## The content piece

One item of the content catalog. JSON, or a CSV row with the same names as columns.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Our id; stable across imports |
| `customerContentId` | yes | Your id |
| `type` | yes | Its kind |
| `title` | yes | |
| `subtitle`, `excerpt`, `runtime` | no | Copy, and a film's length |
| `tags` | yes | `{ dimension: [values] }` on the brand's registry, for example `{ "line": ["Tabby"], "occasion": ["evening"], "contentType": ["video"] }`. In CSV: `line:Tabby;occasion:evening|date-night` |
| `slotTypes` | yes | The slots the piece may fill |
| `lifecycle.status` | no | `live` (default), `draft`, `expired` |
| `window.from`, `window.to` | no | ISO date-times; outside them the piece does not exist for a decision |
| `eligibleWhen` | no | The module's eligibility rule by context, `{ regions?, context? }`, naming at least one of them. `regions` lists 1 to 64 region keys such as `US` or `US-WA` (stored upper case): a key matches the region of the decision's cell exactly, and a country key also admits every region inside it (`US` admits `US-WA`, never the reverse); that region is the one the edge reports, and only under tracking consent. `context` maps the engine's own signals to the values that admit the module: `entry_channel` (among the six channel words, or the tenant's own channel ids when it publishes a context vocabulary), `visit_bucket` (`1`, `2-3`, `4+`, or the names of the tenant's own visit-bucket cut) and `journey_stage` (`exploring`, `considering`, `deciding`), each a list of 1 to 32 values, every condition read off the decision's cell as the engine derived it and never off a value the page sends. Fails closed: an unknown value satisfies no rule, so a piece whose rule the cell cannot satisfy (no region known, an unknown channel, bucket or stage, or another value) does not exist for that decision, exactly as outside its window, and a piece without the field is unaffected. Publication refuses an unknown member, any other signal, a value outside its signal's words (the channel and bucket checked against the tenant's context vocabulary and cut in force on every catalogue write path) or a bound exceeded, naming the rule's path and the offending word; a retained catalogue whose rule names another signal stays readable, and that rule admits nothing. In CSV: a quoted JSON object, as `merchandising`, for example `"{""regions"":[""US-NY""]}"` |
| `art`, `renderUrl` | no | Image, and a URL your page may render by |
| `merchandising` | no | `{ season, promotion, margin }`, each 0 to 1 including zero: the item's own signals for the multipliers. CSV uses a quoted JSON object, for example `"{""promotion"":1,""margin"":0}"` |
| `journeyStageFit` | no | The stages the piece is made for: `exploring`, `considering`, `deciding` (your `journey_stage_fit`; `explore`, `consider`, `decide` and `early`, `mid`, `late` also accepted). Absent fits every stage. A slot's `stage` rule demotes a piece outside the shopper's stage |
| `freshnessDate` | no | When the piece became current, ISO 8601 (your `freshness_date`). A slot's `freshness` rule ages from it; absent, from `window.from` |
| `featuredProductIds` | no | The products the piece features, in your product ids (your `featured_product_ids`). Carried and validated, never rewritten. They link, attribute and recognize: the decision receipt names them, an outcome naming one credits the decision that served the piece, and a product event naming one is recognized. The piece inherits no attribute of a product it features — no tag, merchandising value, stock flag or affinity — and no ranking reads those products' attributes. On a content slot declared `scope: 'anchor'` they also decide what the slot may serve: a piece is a candidate there only when it names the anchor product the request names as `ctx.anchor` (a piece naming the product alone, for every variant; a piece naming a variant beside it, only when the request names that variant as `ctx.variant`), and a request that names no anchor decides the slot empty, so the page keeps its default |
| `complements` | no | The products the piece completes, in your product ids, validated as `featuredProductIds` is (trimmed, de-duplicated, empty entries dropped; an empty list is none). A slot whose `complements: { weight }` rule (0 to 1) is in force adds that weight to the base score of a piece that completes the anchor product the request names as `ctx.anchor` (`<product id>`), on the snapshot's query string or in its POST body (the browser SDK sends the page view's `productId`), and the receipt names it as a `completes` driver. A request that names no anchor prefers nothing, and the holdout's default arm never does. In CSV: a `|` list, as `featuredProductIds` |
| `inStock` | no | Your catalog's stock flag. `false` removes the piece from every decision; absent means in stock. In a feed, `in_stock` or `ats` (Y/N, 0/1, true/false) is read the same way |
| `purpose_later` | no | The module register's optional column: one sentence of what a module is for. Accepted and ignored on every JSON or CSV import and every pull until the semantic term exists: not stored, and not named as an `ignored_field`. A direct publication (`PUT /content/catalog`) or a validation keeps the catalogue's own field set and still names it as an `ignored_field` |
| `pooled` | no | `true` declares the module pooled, the catalogue's own per-module declaration: a pooled module accumulates one evidence record across every page and every slot it is served on, the page a ladder level directly after everyone in that record (`*`, then `p=<page>`, then that page with the ladder's own levels), and every decision on any of its pages reads its lift from that record ([the lift snapshot](#the-lift-snapshot)). Any other value is refused at publication naming `pieces[i].pooled`. Absent, the module is undeclared and keeps its page-scoped storage exactly as before: its evidence stays with its own placement, one record per page under a slot name a retained slots document carries on more than one page. A feed import or pull carries it as a direct publication does: in CSV a `pooled` cell `true` declares the module pooled, any other value is refused naming the record as `records[k] '<id>'` with its field `pooled`, and a blank cell declares nothing |
| `successEvent` | no | The module's own success event, one reward of the list: `click`, `dwell`, `video_complete`, `wishlist`, `add_to_bag`, `purchase` or `custom`. Absent by default, and absent the module is credited for its slot's reward. Read only in a slot whose learn dials publish a conversion table: there an outcome of this event credits the module's decision the table's value for it in the slot's currency, any other event credits it nothing, and a success event the table does not value credits nothing ([success events and conversion tables](#success-events-and-conversion-tables)). Any other value is refused at publication naming `pieces[i].successEvent`; a retained catalogue whose value is anything else reads as undeclared. A feed import or pull carries it as a direct publication does, in CSV as a `successEvent` column holding the reward word, a value it refuses named by its record as `records[k] '<id>'` |

With an approved [attribute vocabulary](#the-attribute-vocabulary) in effect, a tag on an attribute it governs is
stored as the vocabulary's ids, mapped from the words the feed sends; a value it does not list refuses the
publication, naming the item's `id` and the field `tags.<attribute>`.

Import/pull `merge` is a partial upsert by `id`: omitted supported fields preserve the existing item,
including its customer ID, tags, lifecycle, stock and merchandising. Existing order is retained; new
IDs append. New items and `replace` imports require valid complete items; only there do omitted
customer IDs default to `id`, tags to `{}`, and lifecycle to `live`. Catalog PUT remains full replace.
CSV blank cells mean omitted, not cleared. Supplied canonical fields take precedence over aliases,
including malformed values: JSON nulls refuse except the supported `art: null`.

`mode` is required on every import and pull: `merge`, `replace` or `full`; a load without one, or with another word,
is refused `400` naming the three, before anything is read or written (after the operator's authority and the
`import-sources` list below, before the preconditions). `full` replaces like `replace` and keeps every stored item the file leaves out, after the file's items in stored
order, with lifecycle `expired` (its records and receipts still resolve it; an expired item is eligible for no
decision), behind its guard `expire`, the number of items it expires: `428` without it, `409` naming the number when
it names another, and nothing is written either way. A load whose result equals the catalog in force writes no
revision and answers with `skipped` true (reason `unchanged`) and the revision in force. `dryRun=1` on the import checks the file under these
same rules over the revision its `If-Match` names, with no `Idempotency-Key`, and answers what the import would plus
`dryRun: true`, writing nothing; `POST /content/catalog/validate` stays the catalog document's own check.

A tenant may publish the optional document `import-sources`, `{ "addresses": [...] }`: 1 to 64 IPv4 or IPv6
addresses or CIDR ranges, written with `PUT /content/import-sources` like any content document (its first write
over revision 0). While it is published, the import, the pull and the dry run answer `403`, naming `import-sources`
and writing nothing, to a caller whose `CF-Connecting-IP` is outside it or absent; `X-Forwarded-For` is never read.
With none published, every caller is allowed.

**How big a catalog may be.** One stored configuration document is limited to 2 MiB of actual UTF-8
bytes, measured on its canonical form (keys sorted, no insignificant whitespace), and the catalog is
one such document per scope. Measured against the piece shape this repository's own shipped catalog
uses — about 671 canonical bytes for an average piece and 820 for its largest — that envelope holds
**up to 2,000 content pieces per scope** with room to spare: about 1.3 MiB at the shipped average
shape, and about 1.6 MiB even if every piece were as large as the largest shipped one.
`GET /content/catalog` answers the two numbers for your catalog as they stand, as
`envelope: { pieces, bytes, limitBytes }` beside the document (the other document kinds answer
`bytes` and `limitBytes` without `pieces`), and the console's History screen shows them on the
catalog card, so the ceiling is a number you watch rather than one you discover as a refused publish.
A write that would store a document over the ceiling is refused with `413` and
`code: "document_too_large"`; a request body over the 2 MiB input bound is refused before that, with
`413` and `code: "input_budget_exceeded"` naming the `budget`, the `limit` and the `observed`
size; either way nothing is stored. This is a measured application envelope, not a deployed-capacity,
latency or SLO commitment: a larger corpus is a conversation about sharding the catalog, not a number
to raise here.

**What serving a catalog of that size costs.** Measured, not estimated: the whole path one decision
set takes — the published catalog read from storage, parsed and validated, then the shopper, trend,
lift and compose stages — for one page of four slots and nine placements (a pinned merchandising slot,
a hero, two stories, five carousel positions) over three realistic catalogues built from this
repository's shipped catalogue shape, with its cross-category pieces and a dimension the registry does
not know: the shipped 26 pieces (17.5 KB of JSON), 500 pieces (346 KB) and 2,826 pieces (1.96 MB,
the largest such catalogue one 2 MiB publication admits). Each was measured alone and with 8 and 32
decisions in flight at once, cold (an isolate that has not yet read the publication) and warm.
Milliseconds, wall time per decision; *documents* is the read-and-validate stage and *compose* the
ranking stage, each at its median:

| Catalogue | In flight | Cold p50 / p95 | Cold documents | Warm p50 / p95 | Compose cold / warm |
|---|---|---|---|---|---|
| 26 pieces | 1 | 7 / 7 | 4 | 3 / 3 | 1 / 0 |
| 26 pieces | 8 | 31 / 43 | 29 | 3 / 5 | 0 / 0 |
| 26 pieces | 32 | 133 / 180 | 129 | 2 / 6 | 0 / 0 |
| 500 pieces | 1 | 22 / 22 | 14 | 3 / 3 | 3 / 1 |
| 500 pieces | 8 | 109 / 136 | 104 | 5 / 6 | 2 / 1 |
| 500 pieces | 32 | 431 / 566 | 425 | 4 / 5 | 1 / 1 |
| 2,826 pieces | 1 | 70 / 70 | 57 | 9 / 9 | 9 / 7 |
| 2,826 pieces | 8 | 441 / 575 | 426 | 11 / 12 | 10 / 9 |
| 2,826 pieces | 32 | 1,878 / 2,562 | 1,862 | 14 / 19 | 12 / 11 |

What the numbers say. Composing is cheap at every size (12 ms at the largest catalogue with 32 in
flight). A warm decision reads its documents from the 30-second publication cache and costs 2–19 ms
whatever the concurrency. The cost is the COLD document read: parsing and validating the whole
catalogue, about 57 ms at 2,826 pieces, and until the first of them has filled the publication cache
every decision that arrives cold reads and validates it for itself, so in one isolate 32 cold
decisions at once wait about 1.9 s. Concurrency never changes a decision: every concurrent decision
served exactly the slots, pieces and scores one decision alone served. No retrieval, sharding or
other change to what is ranked was built; the optimization this points at — one shared cold read per
isolate — changes no score or candidate, and whether the accepted workload needs it is part of that
workload's qualification. These are one local Node.js process (v22.15, a 12-core
Intel i7-14700K at a load of about 9) with storage in memory, measured on 2026-09-30: no R2, KV or
network latency and not a Workers isolate, so they state the platform's own work, never a deployed
latency, capacity or SLO. `node node_modules/vitest/vitest.mjs run src/units/W38 -t B5` repeats the
measurement and prints each row as a `W38.B5 measurement` line.

Supplied arrays, tags and merchandising replace that whole field; `merchandising: {}` clears its
signals. In a merge, a nonempty window replaces only its supplied bounds, preserving an omitted
expiry. Explicit JSON `window: {}` clears both bounds. CSV uses `status`, `windowFrom` and `windowTo`;
blank window cells cannot clear a gate. Explicit `lifecycle: {status: "live"}` changes lifecycle,
but remaining stock/window gates still apply. Unknown or invalid merchandising terms refuse the
whole publication; a JSON string is not a merchandising object (CSV alone decodes the quoted cell).

Current catalog validation refuses duplicate exact tag values; import deduplicates supplied tags.
Retained catalogs and pending receipts preserve their old values, without migration.
New writes, rollback and enrichment containing old duplicates refuse until the catalog is explicitly
corrected. Existing revision preconditions and exact-request retries still apply. This contract does
not normalize registry/case/type aliases, locale, empty-taxonomy policy or product-attribute inheritance.

Nothing above is silently dropped. A field or CSV column the table does not list (other than `purpose_later` on an import or a pull, accepted and ignored above) is not stored, and
the write answer names it as an `ignored_field` warning on the advisory `diagnostics` channel, with
`recordIndex`, that record's position in the request — not the position of the stored piece a merge
refreshed, which is a different number. On an import or a pull an error names the record it refuses as `records[k] '<id>'`: k is the record's position in the file sent, counted from 0 over every entry (an entry that is not a record included, the number `recordIndex` is), and the id is cut to 64 code units with `…` when cut (`records[k]` alone for a record with no id); a PUT and a validation keep addressing the document's own `pieces[i]`. Each warning of the four piece codes whose piece a record of the file wrote also carries `recordIndex`, `recordId` (the id, cut the same way) and `recordIdTruncated` beside the stored `pieceIndex`. The catalog document itself lists only its `pieces` and an
optional authored `version` label; a key beside those is named as `ignored_document_field`, which
carries no position because it belongs to no record. How the request carried the catalog is never
named: a PUT body's `document`, `note` and `publicationChanges`, and a feed export's records key
(`pieces`, `content`, `items`, `data`, or the key `?path=` names), are the envelope, not the catalog.
Two spellings of one tag value that differ only by case are named as `case_variant_value` with the
exact spellings, and neither is rewritten. A slot type no page of your slots document defines is
named as `unknown_slot_type`: the piece is stored whole, it is simply eligible for no slot you
publish. The channel also answers `counts`, the exact number of occurrences of each code present, so
the bounded 50-warning sample can never hide a whole class of defect, and the sample always shows at
least one warning of every code that occurred. A CSV header that matches a listed column only when
case is ignored — `Tags` for `tags` — is refused 422 naming both spellings, because reading it as an
unknown column would land every row with that field empty; the columns are read from the header
itself, so a header-only export and one whose data rows are all blank are refused with the same words
as one with rows. An unusable `journeyStageFit` word is refused naming the piece and the words the
feed sent, beside the accepted vocabulary. An accepted import or pull also answers `changed`: how
many stored pieces it created or altered, counted from the stored values, so re-importing what the
catalog returned answers `changed: 0`; `removed`, how many stored pieces it dropped, so a replace
that empties the catalog is never silent and a merge answers `removed: 0`; and `changedBasis`,
`stored` when both were measured against the stored base revision, or `unavailable` — with `changed`
and `removed` `null` — when that revision could not be read.

### Hard slot controls

```json
{
  "governanceVersion": 3,
  "pages": { "home": [
    { "slot": "hero", "take": 1, "weights": {}, "excludedPieceIds": ["cnt-example"],
      "allowedTypes": ["editorial"], "excludedTags": [{ "dimension": "category", "value": "example" }] },
    { "slot": "legal", "take": 1, "weights": {}, "offLimits": true }
  ] }
}
```

Current slot writes accept an absent marker or `governanceVersion: 1 | 2 | 3 | 4` and emit version 3, or
version 4 for a document marked 4 and for an unmarked one that declares a layout slot or carries
per-context orders ([the slot document](#the-slot-document)); any other explicit version refuses. `offLimits` is an optional boolean; true hands the slot to the site's own
default on every arm, without candidates, decisions or records; a declared layout slot marked off-limits
also writes one record naming why to the ledger, never to the shopper's ring ([the layout reason](#the-layout-reason)).
A dormant pin and all other settings are retained. Re-enabling must pass active pin take/uniqueness/exclusion validation.
`excludedPieceIds` is an optional JSON array of up to 1000 distinct exact internal catalog IDs,
each 1–1024 UTF-16 units: no trimming, case conversion, customer-ID alias or tag expression.
Absent/false/[] are neutral. Unknown IDs are harmless; explicit nulls and duplicates refuse.
Exclusions apply before pins and every ranking hook; diversity never relaxes them. An excluded
active pin is contradictory. Off-limits or excluded pins reserve nothing for other slots, and a
refused pin receives no arbitrary fill. No fallback asset or customer slot list is inferred.

`excludedTags` is an optional array of at most 1000 distinct `{dimension, value}` pairs, each with exactly
those two own keys and strings of 1–1024 UTF-16 units. Any matching pair excludes the piece; []/absence
is neutral. Matching is exact and case-sensitive, without trimming, regex, aliases or inferred registry
vocabulary. Explicit own catalog tag arrays match literally, even outside learning-input safety limits.
Only absent own `contentType` uses the existing safe rendering-kind fallback, identically on all arms.
`allowedTypes` is an optional array of 1–1000 distinct exact strings of 1–1024 UTF-16 units, compared to
rendering `piece.type`, never `tags.contentType`. Absence is unrestricted; [] and null are invalid API values.
These gates precede pins and all ranking hooks; diversity cannot relax them. Catalog-dependent tag/type
pin conflicts remain advisory at publication and are refused at runtime without reservation or fill.

Stored documents without the marker retain legacy parsing and ignore all formerly unknown controls;
stored version 1 validates ID/off-limits and ignores tag/type fields, even malformed ones. Stored version 2
validates tag/type controls and ignores formerly unknown `pinnedPieceIds`; version 3 validates prefixes too.
Receipts independently distinguish absent governance (all legacy), `slot-gates-v1`
(ID/off-limits only), and `slot-gates-v2` (all controls); a page that declares a layout slot adds
`layout: "declared-slot-v1"` beside them, a decision on which the layout slot served its configured
per-context order adds `orders: "configured-order-v1"`, and a decision on which a slot ranked its modules
by the layout blend adds `blend: "layout-blend-v1"`, and a decision on which a slot was decided below its
signal floor adds `signalFloor: "signal-floor-v1"` with the count it was decided with as `inputs.signals`.
A decision on which a position pin or an off-limits mark of the layout slot decided something adds
`moduleRules: "module-rules-v1"` ([position pins and off-limits modules](#position-pins-and-off-limits-modules)).
A decision made under a catalogue that retires the type fallback, where the fallback could have changed it, adds
`typeFallback: "type-fallback-retired-v1"` ([the module-type dimension](#the-module-type-dimension-registry-draft)).
Other replay policy markers remain independent.
Rules offers exact JSON-array editors and an off-limits switch. Its allowed-types editor accepts JSON null
to remove the field. Its unified pin editor accepts a JSON string (scalar), ordered array (prefix), or null
to remove both fields; changing form removes the other field. Take is never changed automatically.
`pinnedPieceIds` is a dense array of at most 50 distinct exact nonempty strings; whitespace and escapes
are preserved without a new length limit. [] is neutral. Supplying both pin fields refuses even with [].
An active prefix must fit total take; scalar pins still require take 1. Off-limits permits dormant
take/exclusion/page-ownership contradictions but not malformed or duplicate prefix members.
Every prefix pin must pass eligibility, hard gates and page ownership before any is reserved. One
failure refuses the entire slot, without shifted positions or ranked fill. Valid pins occupy the first
positions, seed the tail's soft diversity counts and cannot be displaced; ranking fills the remainder.
Stored absent/1/2 formats ignore the formerly unknown prefix, even malformed; no retained rewrite.
Current receipts use independent `replay.pins: "prefix-reserved-v2"`; `reserved-eligible-v1` and absence
retain prior policies. Pins have singleton candidates, zero lift/prior and no ranking terms. Ranked
records add `ranking_position` (0..49), independent of physical position; pins omit it. Mixed-slot
manifest rows retain tail dependencies, while replay reads only archives consumed by its ranked prefix.
Raw/hourly exploration counts the first ranked ordinal, never a prefix pin; exposure/credit rules do not change.
Malformed text blocks the whole draft across fields and slot selection. Validation and existing version/rollback
feedback. Caches, multi-document atomicity, mixed-binary rollout and customer rendering acceptance
remain separate: a saved revision is not proof every serving worker already observes its controls.

### Contextual seed rules

```json
{
  "pages": { "home": [
    { "slot": "hero", "take": 4, "weights": { "category": 0.5, "line": 0.3 }, "seeds": [
      { "signal": "entry_channel", "value": "paid_social", "tags": [{ "dimension": "category", "value": "Handbags" }], "weight": 0.6 },
      { "signal": "campaign_term", "value": "tabby handbag", "tags": [{ "dimension": "line", "value": "Tabby" }], "weight": 0.4 },
      { "signal": "referrer_network", "value": "instagram.com", "tags": [{ "dimension": "category", "value": "Small Leather Goods" }], "weight": 0.5 }
    ] }
  ] }
}
```

`seeds` is an optional per-slot array of at most 100 rules, read on every stored slot regardless of the
governance marker. A rule maps one arrival signal value to 1–50 canonical `{dimension, value}` tags with a
`weight` of 0..1. `signal` is `entry_channel`, `campaign_term` or `referrer_network`; `value` is 1–256
characters and must be one of the six channel words exactly, the campaign term verbatim, or a known
network's registrable domain exactly (`instagram.com`, never `instagram` or `l.instagram.com`). Every tag
dimension must be one the same slot weights. Anything else refuses the write, naming
`pages.<page>[<i>].seeds…`, and a stored rule set the current contract refuses is ignored WHOLE at decision
time, never partially applied, with `seedDiagnostics: [{ slot, reason: "invalid_rule_set" }]` on the
decision set. An empty array is the same as none.

A rule that fires adds `weight × the slot's weight for the tag's dimension` to the base score of every
eligible piece carrying that tag, before merchandising, so a piece no rule names gains exactly nothing and a
piece merchandised to exactly zero stays exactly zero: seeds are never a floor. The entry-channel signal
reads the shopper's established owned channel, the network signal matches the arrival's referrer host or a
host-shaped `utm_source` on the dot-boundary rule, and the campaign term matches `entry.utmTerm`
case-insensitively. Receipts carry `explain.contextual: { applied, drivers[] }` with the contribution
measured where it lands — in the final pre-lift base, after merchandising — and the rule-set version is the
`slots` revision already on `versions`. The learned lift applies after, on the seeded base, and records the
delta it actually caused in `explain.lift.applied`. Seeds are context, never learned evidence: they change
no statistic, and the default arm has none. Publication, revisions and rollback are the slots document's own.

On a tenant that publishes a context vocabulary ([the learn document's `contextVocabulary`](#the-context-vocabulary)),
an `entry_channel` rule names one of the tenant's channel ids exactly (for example `sms` or
`paid_search_brand`), and any other word, one of today's six included, is refused naming `entry_channel`; a
tenant without the settings keeps the six words exactly. Two more signals read the shopper's visit: `source_platform` names one of the tenant's source platform ids and `landing_page_type` one of its landing-page type ids, and a rule fires for a shopper whose visit records that value, at `weight × the slot's weight`, itemised on `explain.contextual` and the receipt's "Arrival context" sentence as every seed rule is. A tenant without the settings publishes neither and a rule naming either is refused.

Two signals need no setting at all ([device and recency](#device-and-recency)): `device` and `recency` are seed-signal keys
on every tenant. A `device` rule names `mobile` or `desktop` and fires for a snapshot request that reports that
device class (the client hint `Sec-CH-UA-Mobile`, else the user agent; a tablet counts as desktop); a request
reporting no device fires none. A `recency` rule names one of `same_day`, `within_7_days`, `8_to_30_days` or `30_and_more`
and fires for a shopper whose visit is in that bucket; a first visit has no recency and fires no recency rule.
Either fires at `weight × the slot's weight`, itemised on `explain.contextual` and on the receipt's "Arrival
context" sentence, the recency in words ("recency within 7 days"); any other value refuses the write naming the rule.

### Content format affinity

`type` remains the rendering kind. For a known `contentId`, both event hosts learn the held tenant
catalog's `tags.contentType`, not the event's rendering type: `type: "film"` with
`tags.contentType: ["video"]` therefore learns and ranks on `video`. No fixed alias dictionary is used.
When the own `contentType` tag is absent, a safe `type` supplies the format for future events and
non-default live decision input only; neither the catalog nor rendering metadata is rewritten.
Explicit empty or malformed tags never fall back to `type`.

Canonical values must be a whole list of 1–8 distinct, already-trimmed strings of 1–64 UTF-16 code
units, without control characters, angle brackets or `__proto__`, `prototype`, `constructor`.
Malformed held lists produce no new format touches; their explicit ranking tags remain unchanged.
A non-derived `contentType` registry key is required. Catalog tags already name the dimension, so
all valid members contribute regardless of that dimension's raw-event `source`/`multi` mapping.
Other registered wire dimensions keep their existing sanitizer behavior.

Lookup uses the authoritative tenant's current publication and existing 30-second cache, not the
served receipt's revision. Idless events and successful catalog misses retain sanitized wire
compatibility, not authenticated exposure provenance. Invalid supplied IDs refuse; catalog read or
initialization failure refuses before new affinity/population effects. Tracking refusal and disabled
Reflex do not read the catalog. Default-arm diversity/order and pin eligibility remain unchanged.
New receipts carry `inputs.replay.contentTypes: "catalog-tags-v1"`; absence retains historical
tags-only scoring independently of the exploration and pin markers. Old profiles and events are not
backfilled. Full registry vocabulary, locale, inheritance and customer feed acceptance remain separate.

### The module-type dimension (registry draft)

The module-type dimension, `moduleType`, is a registry draft: a tenant registers it on its registry document
as `{ "key": "moduleType", "source": "moduleType" }`, and a module carries its value as a tag,
`"tags": { "moduleType": ["complete-the-look"] }`.

The `moduleType` dimension is kept apart from content format: `contentType` stays the content format (video,
editorial, on-model imagery and the like), a `moduleType` value is never read as a `contentType` value, and a
module engagement never teaches a `moduleType` value as a content format.

The draft values of `moduleType` are `reviews`, `user-generated`, `material-story`, `craftsmanship-story`,
`recommendations`, `complete-the-look`, `category-grid`, `recently-viewed` and `editorial`.
They are a draft for the tenant's own data-science lead to settle, not a vocabulary the engine enforces: a
`moduleType` value outside them is stored, scored and taught like any other tag value, and nothing refuses it.
A module's required free-text `type` stays its kind; the engine neither derives `tags.moduleType` from it nor
requires the two to agree, and the catalogue diagnostics do not compare them.

When the registry in force registers `moduleType`, the catalogue diagnostics name what each of the two
dimensions is as `dimensionRoles: { "moduleType": "module_type", "contentType": "content_format" }` (the
`contentType` role only when that dimension is registered too), read from the registry in its own order; the
role follows the dimension key, whatever event attribute the dimension is sourced from, because catalogue
tags are keyed by the dimension. A registry without `moduleType` answers with no `dimensionRoles` at all.

The teaching weight is the registry document's `moduleEngagementWeight`, 0 by default: absent or 0, a module
engagement teaches exactly what a content click teaches (the event's own values and the piece's format, above).
Above 0 it is a number on the action weights' scale, at most 1000. A module engagement is a `content_click`
whose `contentId` names a module and whose `slot` is the page's declared layout slot (`page` names the page, the
module names the slot in its `slotTypes`), and at a weight w above 0 it also adds w to the shopper's interest on
the module's `moduleType` value and on each value of its other registered tags, its `contentType` tag included,
so one engagement with a module the shopper had no interest in reads w / (w + K) on each of them (with w = K,
0.5). The weight never makes the click a signal for the signal floor or keeps it from being one, and it never
reaches the population counts. A click on any other slot teaches as a content click.

The free-text type fallback (above) holds for a catalogue that does not retire it, and the catalogue
diagnostics name each piece it scores as `typeFallback: { "retired": false, "pieceIndexes": [...] }`: the
stored index of every piece with no own `contentType` tag and a usable `type` that names a slot of the tenant's
slots document that weighs `contentType`, excludes a `contentType` value or spreads over `contentType` (absent
when there is none, or when the slots document cannot be read). A catalogue document that declares
`"typeFallback": "retired"` beside its `pieces` retires it: a piece without its own `contentType` tag then has
no content format, so a layout weighting `contentType` scores nothing from its `type`, a `contentType`
exclusion no longer matches its `type`, and an engagement with it teaches no format; the diagnostics then
carry `typeFallback: { "retired": true, "pieceIndexes": [...] }`, the stored index of every piece without its
own `contentType` tag. Any other value of the marker refuses the publication with `422`, naming `typeFallback`.
`typeFallback` never enters `warnings`, `counts` or `warningCount`, which stay exactly as they were.
A decision made under the marker on which the fallback could have changed something (a piece whose format only
the fallback supplies names a slot of the page that reads the format) writes
`inputs.replay.typeFallback: "type-fallback-retired-v1"`; a replay of a record with it decides the page with
the fallback retired, a replay of a record without it decides with the fallback whatever its catalogue
revision declares, and the marker over a catalogue revision that does not retire the fallback refuses as
`invalid page replay manifest`.

## Supplied enrichment proposals and human review

Design-time routes under `/content/catalog/enrichment/proposals` capture supplied labels for review.
All modes require a canonical tenant identity, a provisioned operator grant and a typed access or service
Bearer credential. `X-Tenant` selects the tenant; existing registered-host/default resolution also applies.
Review and publication require a current access session whose current account has the `operator`
or `admin` role. An account session establishes account authority; it cannot attest who physically
used that credential. Optional `tenant` and `scope` query selectors must each occur once and match
the canonical tenant. Caller-supplied actor, timestamp, status and tenant fields at the top level of
the request body are rejected; the preserved sample may contain metadata with those names.

| Request | Payload or result |
|---|---|
| `POST /` | `{ sample: { pieces: [...] }, labels: [{ id, pieceId, dimension, value }], provenance: { source, model? } }`; returns `201` with `{ status: "pending", published: false, proposal, review: null }` |
| `GET /{id}` | `{ status: "pending" \| "reviewed", published: false, proposal, review }`; `review` is null only when no terminal review object exists |
| `POST /{id}/review` | `{ proposalDigest, dispositions: [{ labelId, action: "approve" \| "reject" } \| { labelId, action: "edit", dimension, value }] }`; exactly one explicit disposition for every label; returns `201` with the terminal review |
| `GET /{id}/export` | `{ schema: "content-enrichment-tag-additions/v1", published: false, proposal, review, additions: [{ labelId, pieceId, customerContentId, dimension, value, reviewDigest }] }`; only approved or edited labels enter `additions` |
| `POST /{id}/publish` | Exactly `{ proposalDigest, reviewDigest }`, with `If-Match: "N/P/H"` (document revision / whole-set revision / digest) and `Idempotency-Key: N:UUID`; returns `{ ok: true, schema: "content-enrichment-publication/v1", proposalId, proposalDigest, reviewDigest, operationId, revision, actor, at, note, document }` |

The sample requires 1–500 valid catalog pieces and the proposal 1–4000 labels with unique IDs and
existing sample `pieceId` references. Samples retain original tags, IDs, optional fields and unknown
JSON metadata; validation does not normalize or replace them. Labels add tags only. Label IDs are
at most 128 UTF-16 units, content/customer IDs and tag dimensions/values 256, declared source 1000,
and optional model 256. These bounded strings must be nonempty, without outer whitespace or ASCII
control characters. Prototype keys are rejected throughout JSON, including proposed dimension names;
nesting is limited to 16 levels. Each request and each stored envelope has a separate 2 MiB actual
UTF-8 byte limit, including server metadata in the stored limit. No truncation occurs. On all four
`POST` routes a request body over its limit is refused `413` with `code: "input_budget_exceeded"`,
`budget: "bytes"`, `limit` and `observed` — the refusal every other consuming route answers — counted
on the bytes actually delivered, before the body is parsed and before any storage or model call; the
platform stops reading at the limit. Other envelope,
label, provenance and disposition fields are rejected; arbitrary metadata belongs in `sample`.

The server generates a UUID, tenant, actor, timestamp and SHA-256 `digest` for each proposal. Its
`provenance: { declared: { source, model? }, verified: false }` is caller-declared; supplied URLs are
never fetched. The digest binds the canonical JSON proposal (sorted object keys, array order retained,
excluding `digest` itself), including the exact sample and proposed labels. The terminal review carries
its own digest, `proposalDigest`, server `reviewedBy`/`reviewedAt` and `reviewerType: "access"`.

Proposal and review objects are immutable conditional creates. The first terminal review wins;
later reviews, including identical retries, return `409`. Pending export or a stale proposal digest
also returns `409`; a missing proposal returns `404`, invalid input `400`/`422`, oversize `413`, and
unavailable/corrupt storage or an unconfirmed write `503`. An unconfirmed capture returns its
`proposalId` for authorized GET readback; this is not a successful capture acknowledgment. An
uncertain review uses its already-known proposal ID for readback. Responses are `no-store`.

Export is a distinct metadata patch with the original sample and review evidence. It is not a catalog
document and does not import, activate, rewrite eligibility/lifecycle/product linkage, or publish
content. The `published: false` field on capture/read/export means that operation does not publish;
those operations do not check publication history and do not establish that a proposal was never applied.

Explicit publication requires an already initialized catalog authority and the exact current revision
from catalog GET. Capture the sample pieces from that document: every approved or edited target must
match its complete current piece, including all metadata and array order, before any revision is reserved.
Missing or changed targets, extra raw sample fields absent from the catalog, mismatched evidence
digests, all-rejected reviews and applications with no new tags return `409`. Unrelated pieces and
catalog-level version changes do not invalidate the target sample; `If-Match` still fences the whole
catalog revision. Publication appends each new approved tag once, preserving existing tags, all
metadata, catalog ordering and other pieces. Drafts and ineligible content retain their lifecycle,
stock and windows. Taxonomy meaning and asset bytes behind URLs are not attested.

The server-generated revision note binds the proposal ID and both digests in the same immutable
publication receipt. Retry the exact request, headers and original actor to retrieve that receipt;
a late retry can return a retained revision older than the latest catalog. Publication does not
mutate the proposal or review or create a separate applied-status object. Catalog history and the
publication receipt supply publication evidence. Missing headers return `428`, invalid preconditions
`400`, and missing/corrupt/uninitialized authority or throttled/unconfirmed storage `503`. Pending
operations reserve the catalog until the existing catalog publication status/recovery workflow finishes
the exact retained intent; a currently granted operator or service may recover it without replacing
its original approval or actor. Serving snapshots can remain cached for up to 30 seconds, excluding
in-flight reads; publication is not an immediate-effect guarantee.

Supplied proposals remain explicitly unverified. The separately configured `/generate` endpoint performs model generation; its verified witness describes the generation-time input/configuration/taxonomy and actual transport, not certification under today’s taxonomy. Human per-label review and current publication authority remain mandatory. Live model execution, customer sample calibration, UI handoff, cutover and approved data/retention policies remain separately evidenced acceptance.

## The slot document

`{ version, pages: { [page]: [ { slot, take, weights, pinnedPieceId?, merchandising?, stage?, freshness?, fatigue?, diversity?, bands? } ] } }`.
`take` is how many pieces the slot shows; `weights` is `{ dimension: weight }`, each 0 to 1, the slot's
view of which dimensions matter; `pinnedPieceId` outranks the engine; `merchandising` is `{ season,
promotion, margin, maxBoost, minBoost }`, the weight of each multiplier (−1 to 1) and the clamp on their
product. The four rules added on 2026-09-04, each off when absent and each itemised on the receipt:
`stage` is `{ outOfStage, inStage }`, a multiplier (0 to 1) on a piece made for another journey stage and
a bonus (0 to 1) for one made for the shopper's; `freshness` is `{ weight, halfLifeDays }`, a bonus of
`weight × 2^(−age / halfLifeDays)` from the piece's freshness date; `fatigue` is `{ weight, windowHours,
cap }`, a penalty of `weight × min(served, cap) / cap` for a piece this shopper was served inside the
window; `diversity` is `{ dimension, max }`, at most `max` pieces sharing one value of the dimension in
the slot, the piece over the limit yielding to the next and served only when nothing else is eligible. `minimum` is `{ dimension, value, count, within }`, a guarantee enforced, never weighted: at least `count` items carrying the tag in the first `within` positions on every arm the engine ranks, all of them when fewer are eligible, a pinned item counting when it carries the tag and never moving (`count` from 1, `within` from `count` to the take; refused beside per-context `orders`). `pinnedTag` is `{ dimension, value, window: { from, to } }` on a content slot (governance 3 or later, never beside `pinnedPieceId` or `pinnedPieceIds`): in its window, `from` inclusive, `to` exclusive, the best-ranked eligible candidate carrying the tag leads the slot; outside the window, or with no candidate carrying it (`pinDiagnostics` names it `unmet_tag_pin`, refusing nothing), the slot decides as without it.

### Position bands

```json
{ "slot": "pdp-modules", "take": 5, "weights": { "line": 1, "category": 0.5, "occasion": 0.5 },
  "bands": [
    { "from": 1, "to": 2, "weights": { "category": 1, "occasion": 0.25 } },
    { "from": 3, "to": 5, "weights": { "line": 1 } }
  ] }
```

One slot can run one strategy on some of its positions and another on the rest: a slot may carry position
bands, `bands: [{ from, to, weights }]`, where `from` and `to` are positions counted from 1 within the slot
and `weights` is the band's own `{ dimension: weight }`, each 0 to 1, as the slot's `weights`. A band
overrides only the slot's dimension weights and carries nothing else: no take, pin, exclusion, rule or dial
of its own. The bands are contiguous, do not overlap and together cover positions 1 to `take`, listed from
position 1, each starting where the one before it ends. Publication refuses anything else naming
`pages.{page}[i].bands` (an overlap, a gap, a first band that does not start at 1, a last band that ends
before or beyond the take, an empty list, or a band with any member but `from`, `to` and `weights`), and
reads the member under every governance version.

In a band the band's weights replace the slot's wherever the slot's weights are read for a position of
the band: in the tag sum Σ a·w (the shopper's interests and the population priors blended into them) and
as the slot weight a seed rule's contribution is scaled by, `rule.weight × the band's weight for the tag's
dimension`, so a seed rule on a dimension the band does not weight contributes nothing in that band. Seed
rules are still checked against the slot's own `weights` at publication, never against a band's. Every
other term — the seed rule's own weight, their model, the journey stage, freshness, fatigue, merchandising
and the learned lift — is computed exactly as without bands, in the same order, and a record explains only
the terms of the scoring that ranked its position: a merchandising block, which multiplies a base above
0, only where the band that ranked the position gave the module such a base. Positions are filled in
order: the pinned prefix (and, on a declared layout slot, a position pin or a held off-limits module)
keeps its position, and every other position is ranked from the modules still eligible — after the slot's
exclusions, eligibility, the page's reservations and every module already served on the page — with the
weights of the band that covers it, so the bands give one de-duplicated result, with no module twice in
the slot or on the page. The diversity rule is applied position by position: a module that would put a
value over the limit yields, the next module still eligible under the weights of the band covering the
position takes it, and the module that yielded stays eligible for the later positions, ranked there under
their bands' weights (relaxed only when every module left is over the limit). An exploration pick is
applied to the banded ranking (each position ranked with its band's weights, before the diversity rule)
and the adjacent swap to the served result, never re-ranked by the bands: on a decision an exploration
pick moved, the diversity rule acts on that order as on a slot without bands. Under the layout blend the
bands act on the behaviour term `B` only, a configured order served exactly is served as published and its
positions are ranked without the bands, and the shadow order ranks with the same bands.

The record of each position a band ranked carries `explain.band: { from, to }`, keys sorted, naming the
band it was ranked in, and its receipt carries the same block as `band`; a pinned or held position, a
position a configured order set and every record of a slot without bands carry none. A banded decision
replays exactly from the slots revision its record names, `explain.band` compared by value, with no new
replay marker; a slot without bands decides, records and replays exactly as before.

### The layout slot

```json
{
  "governanceVersion": 4,
  "pages": { "pdp": [
    { "slot": "pdp-modules", "take": 4, "layout": true, "weights": { "line": 1, "category": 0.5 },
      "excludedPieceIds": ["module.PDP.reviews.1"] },
    { "slot": "pdp-recent", "take": 1, "weights": {}, "pinnedPieceIds": ["module.PDP.recent.1"] }
  ] }
}
```

`layout` (governance version 4) declares the page's layout slot: `true` on at most one slot per page, a
second declaration refused naming `pages.{page}.{slot}`, and refused naming `pages.{page}[i].layout` in a
document marked 1, 2 or 3. Its `take` is the layout's K positions (1 to 50) over the modules that name the
slot in their `slotTypes`: content pieces registered with their `id`, their kind as `type` and their
journey stages as `journeyStageFit`, the catalogue refusing a module without an `id` or a `type` by name.
Each decision returns up to K of them in rank order, after eligibility, the slot's exclusions and
page-wide de-duplication (a module another slot of the page already serves is not repeated); with no
signal they are the first K eligible in catalogue order, and fewer eligible modules than K return only
those, never a filler. The list the layout slot returns is the layout's sequence, position by position
in `order`. A module that is not returned is not drawn, and its container stays hidden. Every drawn
module is acknowledged by its own `content_impression` render acknowledgement, carrying the module's
`decisionId` and `renderOffer`, and a module that was not drawn is never acknowledged.

Each module container on the page is marked with `data-op-content` (the module id) and `data-op-slot` (the
layout slot), and may declare its interactions in `data-op-engage` (DOM event types, space separated). Every
decision carries `slotPosition`, the module's position within the slot, beside `order`. The module's impression
is its render acknowledgement, sent once per page instance with `position` and `slotPosition`; each engagement
(a click inside the container or a declared interaction) is a `content_click` with `contentId`, `slot`, the
acknowledged `decisionId` and `slotPosition`, credited as the slot's click reward, and its outcome
record keeps `item_id`, `slot`, `position` (within the slot) and `decision_id`.

Measure the layout slot on `rendered-v1` in the learn document (`slots.{slot}.measurementBasis`): the
acknowledgement of a drawn module is its one exposure, however often it is retried, and a module returned
and not drawn, or not returned, is none. On `served-v1` the slot is served without a render offer and
never captured as an exposure, and the decision set names the mismatch as
`layoutDiagnostics: [{ measurementBasis: "served-v1", reason: "measurement_basis", slot }]`, a
host-internal member that no public answer carries. A slot without `layout`, and every document marked
1, 2 or 3, decides and replays exactly as before; the receipts of a page that declares a layout slot
carry the page-manifest marker `inputs.replay.layout: "declared-slot-v1"`.

#### Per-context orders

```json
{ "slot": "pdp-modules", "take": 4, "layout": true, "weights": { "line": 1 },
  "excludedPieceIds": ["module.PDP.reviews.1"],
  "orders": [
    { "context": { "channel": "paid_social", "visitBuckets": ["1"] },
      "modules": ["module.PDP.editorial.1", "module.PDP.grid.1", "module.PDP.ugc.1", "module.PDP.reco.1"] },
    { "context": { "channel": "any", "visitBuckets": ["1"] },
      "modules": ["module.PDP.ugc.1", "module.PDP.grid.1"] }
  ] }
```

`orders` (governance version 4) sets a module order per context on the page's declared layout slot, and
on no other slot. Each order is exactly `{ context, modules }`. `context` is exactly `{ channel,
visitBuckets }`: `channel` is one of the six channel words `direct`, `paid_social`, `paid_search`,
`email`, `organic`, `referral`, or `any`; `visitBuckets` is a non-empty list of distinct visit buckets
`1`, `2-3`, `4+`, or `any`. A context's specificity is the number of its two parts that are not `any`
(0 to 2). A context may also name a device class, `{ channel, device, visitBuckets }` with `device` `mobile` or
`desktop` (a tablet counts as desktop), beside or, with `any`, instead of the channel and the visit buckets: a named
device is one more part of its specificity (so 0 to 3), a context naming a device matches only a shopper whose
snapshot request reports that device, and a context naming none matches every device, so an order published
without one keeps its meaning and its replay marker ([device and recency](#device-and-recency)). A shopper matches a context when the shopper's channel is its channel or it names `any`, and
the shopper's visit bucket is in its list or it names `any`; a shopper whose channel or visit bucket is unknown matches no
context, not even one that names `any`. Of the contexts a shopper matches, the most specific decides, and
publication refuses two contexts that match one shopper with equal specificity, so there is never a tie
to break (in the example, a paid-social shopper on a first visit is served the first order, any other
shopper on a first visit the second, and every later visit the slot's own decision). `modules` lists 1 to
`take` distinct module ids, each a piece of the published catalogue that names the slot in its
`slotTypes`, none excluded from the slot or pinned by another slot of the page, and the slot's pinned
modules first, each at its pinned position.

The hiding rule: a shopper in an order's context is served exactly its modules, in its order; a module
the order does not list is not returned in that context, is offered for no render acknowledgement and is
never counted as an exposure, so an order shorter than `take` fills only the positions it lists. A
listed module that is not eligible when the decision is made is passed over and never replaced. On a
slot that opts into the layout blend (`slots.{slot}.blend` in the learn document) the order supplies the
blend's rank base instead of being served exactly: its listed modules are ranked by
`R + (1 − p) × B + p × Q`, which at `p` 0 on a layout that weights no shopper dimension serves the order
itself, and a module it does not list stays hidden. The
order is never served on the holdout's `default` arm, to a shopper without personalization consent, or
on a decision on which the slot's exploration picks; those shoppers, and every shopper no context
matches, receive the slot's own decision. A slot without `orders`, and every stored document marked
1, 2 or 3, decides and replays exactly as before.

#### Position pins and off-limits modules

```json
{ "slot": "pdp-modules", "take": 4, "layout": true, "weights": { "line": 1 },
  "excludedPieceIds": ["module.PDP.reviews.1"],
  "positionPins": [{ "pieceId": "module.PDP.ugc.1", "position": 3 }],
  "offLimitsPieceIds": ["module.PDP.reco.1"] }
```

`positionPins` (governance version 4) pins modules at positions of the page's declared layout slot, and
of no other slot: each pin is exactly `{ pieceId, position }`, `position` a whole number from 1 to the
slot's `take`, after any prefix pins (`pinnedPieceIds`), one module per position and each module pinned
once. A module pinned at a position is reserved page-wide before any slot ranks and is served at exactly
that position on every arm, never scored and never explored, while the other positions are ranked around
it; prefix pins serve exactly as before, and an order keeps every pinned module at its position.
`offLimitsPieceIds` (governance version 4) marks modules off-limits on the same slot: an off-limits module
keeps its baseline position — its place, counted from 1, in the configured order for the shopper's
context where one matches, else among the modules the slot can serve (after eligibility, its exclusions and
what the page already served or reserved, its own pins included) in catalogue order — on every arm, and no
term and no exploration moves it while the others are ranked around it. An off-limits module whose
baseline position lies beyond the take, or on a pinned position, is not served, and one the slot cannot
serve holds nothing; a module is never both pinned and off-limits. A module pinned at a position that is
missing, ineligible or excluded refuses the whole slot (decision D1), exactly as a refused prefix pin
does: nothing is served from it, no record is written, and the decision's `pinDiagnostics` names the
module, its position (`position`, counted from 1) and the reason. In the example a shopper whose own
ranking would put the recommendations module last sees it second, its baseline position, and the
user-generated module third, its pinned position, with the shopper's ranking on the first and fourth.

The record of a module either rule placed carries `explain.moduleRule: { position, rule }` with authority
`pin`, and its receipt says the rule and the position in words. A decision on which a position pin or an
off-limits mark decided something writes `inputs.replay.moduleRules: "module-rules-v1"`, and its replay
re-applies both rules and compares the record exactly; every other decision, every slot without either
member, and every stored document marked 1, 2 or 3 decides and replays exactly as before.

#### Adjacent swaps and position effects

```json
{ "slots": { "pdp-modules": { "measurementBasis": "rendered-v1", "reward": "click",
  "exploration": { "mode": "adjacent-swap", "share": 0.05, "floor": 50 }, "positionNormalization": true } } }
```

The exploration mode `adjacent-swap` in the learn document is set only on a page's declared layout
slot, with a share from 0 to 1: on that share of the slot's decisions, read from the decision's own
exploration bucket (the shopper, the slot and the hour), exactly one pair of adjacent positions of the
slot's ranked order swaps places, the pair chosen from the same bucket among the pairs neither of whose
positions a pin or an off-limits module holds (and none that would carry an item carrying the slot's `minimum` tag out of its first `within` positions, nor one touching a module under a merchandiser's reject
or freeze), so the same shopper in the same hour is swapped the same pair; outside the share, at a share
of 0, and where no pair is free, the slot is served exactly as without the mode. A decision served the
configured order for the shopper's context is served that order exactly and never swapped, with no
exploration member and the order's layout reason. `floor` is required as for every mode and unused by
this one. Each of the two swapped records carries
`explain.exploration: { bucket, mode, positions, reason }` with `explored` true, its receipt says it was
swapped and between which positions, and a replay swaps the same pair with no new replay marker. The
slot's statistics count, per adjacent pair (k, k + 1), the swapped decisions (`pairs`) and the clicks
credited to the module served at k and at k + 1 on them, and publish each position's effect as a click
ratio on the slot's snapshot, `positionEffects: [{ position, effect, pairs }]`: position 1's effect is 1,
and position k + 1's is position k's times the clicks at k + 1 over the clicks at k on the decisions
that swapped (k, k + 1), at three decimals, null where the swaps cannot reach it yet; `pairs` is the
swapped decisions behind each position. The switch `positionNormalization` is off by default: absent or
`false`, every credit is exactly as before. With it `true` the credit of an engagement with the module
served at a position is divided by that position's effect, in the live statistics and in the hourly
recomputation alike (the folded hours, the open hour and the day summed from them), under the position
policy the slot's statistics last published at or before the engagement (their history is kept beside the
slot's snapshot archive, as `positions.json`), whatever the learn document's dials say when the
recomputation runs; only an engagement with a module of a declared layout slot, whose record carries the
layout reason, is weighed, on both paths alike, and a day built from the raw ledger because no hour of it
was folded credits as counted. The number of credited outcomes never changes, only what each is worth. Publication refuses the mode and the switch
on a slot that is not a page's declared layout slot, an adjacent-swap share outside 0 to 1 and a switch
that is not `true` or `false`, each naming the dial.

#### Nothing to show and eligibility rules

```json
{ "page": "pdp", "pageInstance": "original-page-nonce", "nothingToShow": "[\"module.PDP.reviews.1\"]" }
{ "id": "module.PDP.reco.2", "eligibleWhen": { "regions": ["US"], "context": { "entry_channel": ["paid_social"], "journey_stage": ["considering", "deciding"] } } }
```

The decision request may carry the page's report of the modules that have nothing to show for this page
view, `nothingToShow`: a JSON array of module ids sent as one string field, like `entry` (the SDK takes it
as `nothingToShow: string[]` beside `page` and sends nothing when the list is empty). A module named in
`nothingToShow` is withheld before ranking, so it is not returned, not recorded and never counted as an
exposure, and the slot fills its take from the remaining ranked modules; the report can only withhold,
never add. When a module's rule and the page's report would both withhold it, the rule is read first, so
its cause is `eligibility_rule` and the report withholds only a module its rule admits. A module's
eligibility rule, `eligibleWhen` on its catalogue piece, admits it by region, entry
channel (`entry_channel`), visit bucket (`visit_bucket`) and journey stage (`journey_stage`), as
[the content piece](#the-content-piece) describes, evaluated on the decision's cell and never on a value
the page sends. An unknown value satisfies no rule, so the rule fails closed, and a module without a rule
is unaffected. A module withheld either way is ineligible for that decision: a pin of it is refused and an
off-limits mark of it holds nothing in what is served. On a tenant that publishes a context vocabulary, a
rule names that tenant's own channel ids and the names of its visit-bucket cut, which its cell carries, and
every catalogue write path checks them against the vocabulary and cut in force. Every record of the page carries the report and each rule's verdict
on its inputs (`inputs.nothing_to_show`, `inputs.eligibility_verdicts`), and a module withheld from a
position the baseline would have served it on is named in the layout reason's `withheld` list.

#### The layout reason

```json
{ "cause": "no_level_reached_nmin", "n": 10, "nMin": 30, "slot": "pdp-modules", "status": "unchanged" }
{ "moves": [{ "from": 3, "module": "module.PDP.reco.2", "term": "affinity", "to": 1 },
  { "from": 4, "module": "module.PDP.editorial.1", "term": "affinity", "to": 2 }], "slot": "pdp-modules", "status": "changed" }
{ "moves": [], "slot": "pdp-modules", "status": "changed",
  "withheld": [{ "cause": "eligibility_rule", "module": "module.PDP.reco.1" }, { "cause": "nothing_to_show", "module": "module.PDP.reco.2" }] }
```

Every decision on the page's declared layout slot carries one reason, `layoutReason`, comparing the served
order with the slot's baseline: the merchandiser's fixed positions (prefix pins, modules pinned at a
position, off-limits modules at their baseline position) where their rules put them, and on every other
position the configured order for the shopper's context where one matches, else the modules the slot can
serve (after eligibility, its exclusions and what the page already served or reserved, and before a module
is withheld for nothing to show or by its eligibility rule) in catalogue order.
A `layoutReason` is either `status` `unchanged` with exactly one `cause`, or `status` `changed` with its
`moves`, keys sorted in both, and it is the same value on the decision set, on every record of the slot
(`explain.layoutReason`) and on every receipt of the slot (`layoutReason`). The cause of an unchanged
layout is the first of these that holds, in this order: `pinned` (pins, with any off-limits modules, hold
every position), `off_limits` (the slot is off-limits, or off-limits modules hold every position),
`holdout_or_consent` (the holdout's `default` arm, the arm of a shopper without personalization consent
too), `below_signal_floor` (decided on context alone), `blend_or_trust_zero` (the blend's `p` at 0 on an
opted-in slot, a configured order served exactly on a slot that does not opt in, or γ at 0),
`no_level_reached_nmin` (no ladder level reached nMin for any module the slot ranked, with `n`, the most
evidence any of them holds at any level of the shopper's cell, and `nMin`), `zero_base` (no ranked module
had a base score above 0), `catalogue_order_ties` (a served module's score tied another's) and
`nothing_else_eligible` (the slot could rank at most one module, or its ranking placed every module where
the baseline does); a later release may add causes. Each of the moves of a changed layout is
`{ from, module, term, to }`, positions counted from 1 within the slot (a module the baseline places
past the take keeps its place in that order, so `from` can exceed the take; `from` is null for a module
the baseline does not hold), for every module served away from its baseline position, and its `term`
is the term that moved it: `affinity`, `seed`, `regional_prior`, `context_prior`, `completes`, `external`, `stage`,
`freshness`, `fatigue`, `merchandising`, `lift`, `blend`, `exploration` or `diversity`: `exploration` for a
module exploration itself placed, `diversity` for one the diversity rule itself made yield or placed by
relaxing it, and for any other the term that changed its place, the term by which it differs most from the modules it passed
(moved up) or that passed it (moved down) taken together, each term's difference averaged over those
modules and the largest in the direction it moved named, an exact tie going to the earlier term in the
engine's order `affinity`, `regional_prior`, `context_prior`, `completes`, `seed`, `external`, `stage`,
`freshness`, `fatigue`, `merchandising`, `lift`, `blend`. The modules compared are the slot's ranked
modules other than a fixed position, a module that exploration or the diversity rule placed or displaced
being compared like any other, including for a module moved up every module the baseline placed ahead of
it that is not served; only where no term separates it from them by more than 0.0005, or there is none to
compare, does a rule name it: `exploration` or `diversity` when one of them was placed or displaced by that
rule, else its own largest term in the direction it moved, else the term of the first module that passed
it or that it passed. A changed layout from which a module the baseline would have served on one of its
positions was withheld before ranking names each such module, in baseline order, in
`withheld: [{ cause, module }]` (keys sorted): `nothing_to_show` when the page reported it has nothing to
show for this page view, `eligibility_rule` when its eligibility rule is not satisfied by the decision's
cell ([nothing to show and eligibility rules](#nothing-to-show-and-eligibility-rules)). Its `moves` then
compare the served order with the baseline less the withheld modules, so a module that only took a
withheld module's place is not called moved; the receipt names each withheld module with its own cause
before the moves. A layout whose withheld modules lay beyond the positions the baseline fills is unchanged by
them. That baseline is drawn before the withholding: an off-limits module is held at its place whether or
not it was withheld (the decision then states `inputs.replay.moduleRules`, which the replay reads), and a pin
of another slot refused only because its module was withheld still reserves that module.

An off-limits declared layout slot writes one record, never into the shopper's decision ring, so it
carries no exposure, no receipt reads it and no outcome is credited to it: position 0, `item_id`
`"(off-limits)"`, `customer_item_id` empty, no candidates, authority `default`, `measurementBasis`
`served-v1`, the decision's own arm, cell and versions (lift and prior 0), and `explain.layoutReason` with
the cause `off_limits`. It goes to the ledger, and so rides the export, under the shopper's tracking
consent and only for a layout slot measured on `rendered-v1`, so every report and learning fold sets it
aside as a row recorded under another basis than its slot's; its replay decides the page again and
compares it. The reason rides every exported decision record unchanged, and a record written before it
replays without it.

#### Inner content slots

```json
{
  "governanceVersion": 4,
  "pages": { "pdp": [
    { "slot": "pdp-hero", "take": 1, "weights": { "line": 1 } },
    { "slot": "pdp-modules", "take": 4, "layout": true, "weights": { "line": 1, "category": 0.5 },
      "inner": { "module.PDP.reco.2": "pdp-ctl-items", "module.PDP.editorial.1": "pdp-story-items" } },
    { "slot": "pdp-footer", "take": 1, "weights": { "line": 1 } },
    { "slot": "pdp-story-items", "take": 1, "weights": { "line": 1 } },
    { "slot": "pdp-ctl-items", "take": 2, "weights": { "line": 1 }, "excludedTags": [{ "dimension": "line", "value": "Willow" }] }
  ] }
}
```

`inner` (governance version 4) on the page's declared layout slot maps each module id to the name of its inner
content slot, the slot that holds that module's own content: `{ [moduleId]: innerSlotName }`, kept exactly as
authored, an empty object carrying nothing. An inner slot is an ordinary slot of the same page and carries the full
slot set (`take`, `weights`, `pinnedPieceIds`, `excludedPieceIds`, `excludedTags`, `allowedTypes`, `bands`,
`diversity`, seed rules, merchandising, the stage, freshness and fatigue rules, a numeric `signalFloor`), listed
anywhere on the page; `layout`, `orders`, `positionPins`, `offLimitsPieceIds`, `contextOnly` and the `never` floor
stay the layout slot's own. Publication refuses, naming `pages.{page}[i].inner` (and the module,
`pages.{page}[i].inner['…']`, for a value or a key): `inner` on a slot that is not the declared layout slot; a
value naming no slot of the page; a value naming a layout slot, the layout slot itself included; one inner slot
named for two modules; a value that is not a slot name or a key that is not a module id (1 to 1024 characters);
`inner` in a document marked 1, 2 or 3; and, at `PUT /content/slots` against the catalogue published with it or
else the one in force, a key naming a module the catalogue does not define as a candidate of the layout slot (no
item with that id, or one whose `slotTypes` does not name the layout slot).

One decision decides the layout slot and the inner content slot of every module it returned, in the same page
decision: the page's slots in document order, except that each inner slot is decided directly after the layout
slot, in the order the layout returned its modules (after its pins, off-limits modules, configured order,
withheld modules, exploration pick and adjacent swap), never where the document lists it. A module that is not
returned has its inner slot undecided: no decision, no `within`, no record, no row in the page manifest and no
short-take entry are written for it, and a pin its own gates refused is left out, as it reserved nothing. A pin it
kept reserved stays reserved page-wide, as every valid pin is, so its piece is served nowhere on that page view, and
the decision's `pinDiagnostics` names it, after any refused pin, as
`{ pinIndex, pinnedPieceId, reason: "module_not_returned", slot, within: { module, slot } }`, keys sorted: the inner
slot, the piece, its place in the slot's `pinnedPieceIds` (`pinIndex`, absent for a scalar `pinnedPieceId`), and in
`within` the module that was not returned and the layout slot; the entry refuses nothing, is counted in the
snapshot's `refusedCount` as every entry is, and changes no decision, record, receipt, page manifest or replay.
The operator surfaces count a `module_not_returned` entry apart from refusals: the operator slots page's
`governance` block counts it in `unreturnedPinCount` and names it in `unreturnedPins` (each
`{ count, pinnedPieceId, within: { module, slot } }`, keys sorted), never in `refusedPinCount` or `refusedPins`, and
the monitor's `governance` carries the tenant's `unreturnedPinCount` beside a `refusedPinCount` that counts refusals
only. The console's Slots screen labels such a pin in its own words, "<n> pin(s) reserved, unserved: the module was
not returned", with one line per pin naming its piece, how often, the module and the layout slot.
De-duplication spans the layout, every inner slot and every
other slot of the page, so no piece is served twice on the page and an inner slot decided earlier in the layout's
order takes a piece before a later one or any slot after the layout. Each inner decision carries
`within: { module, slot }`, keys sorted, naming the layout slot and the module, on the snapshot's decision, on
its record and on its receipt.

In the example, after three views of one handbag line the layout returns `module.PDP.reco.2`,
`module.PDP.editorial.1` and two more modules: `pdp-ctl-items` is decided first (the hero's piece already served,
it takes the next two items), then `pdp-story-items` (an item `pdp-ctl-items` took is not repeated), then
`pdp-footer`, which yields every piece served above it. An inner slot listed for a module the layout did not
return is not decided and none of its pieces is served or recorded. The page's records are one receipt set: one
`ts`, one manifest on every record (`inputs.replay.slots` naming the slots decided, in document order), each
record replaying equal; a page whose layout slot names no inner slot decides in document order exactly as before.

### The baseline and the shadow

```json
{ "baselineOrder": ["module.PDP.grid.1", "module.PDP.reco.1", "module.PDP.reco.2", "module.PDP.editorial.1"],
  "shadowOrder": ["module.PDP.editorial.1", "module.PDP.reco.2", "module.PDP.grid.1", "module.PDP.reco.1"],
  "shadowTerms": { "module.PDP.editorial.1": ["affinity", "lift"], "module.PDP.grid.1": ["affinity", "lift"],
    "module.PDP.reco.1": ["affinity", "lift"], "module.PDP.reco.2": ["affinity"] } }
```

Every record of the page's declared layout slot decided on an arm that personalizes carries the slot's
baseline, `explain.baselineOrder` (the layout reason's baseline: the configured order for the shopper's
context where one matches, else the modules the slot can serve in catalogue order, with the fixed
positions where their rules put them, drawn before a module is withheld), and its shadow,
`explain.shadowOrder`: the order the engine would have served with every term applied and the learned term
at full trust, γ 1, whatever γ serves the page, ranked as the served order is, with the pins and off-limits
modules fixed, the withheld modules absent, no exploration pick and no adjacent swap. Both are cut at the
slot's take. On a slot that opts into the layout blend the shadow is ranked at the dial's `shadowP`, 0.1
when the dial names none, while the served order is ranked at the served `p`.
`explain.shadowTerms` names, for each module whose place in the shadow differs from its place in the
baseline less any withheld module, every term that would have moved it: the terms of the layout reason's
vocabulary by which it differs, averaged over the modules it passed (moved up) or that passed it (moved
down), by more than 0.0005 in the direction it moved, in the engine's fixed order, with the layout
reason's own rules where no term separates it. A module of the baseline's take that the shadow pushes out
of its take has moved down too and is named with the terms by which the modules of the shadow's take that
passed it lead it, while a module in neither take is not named: with a take of 2 the slot above would have
the baseline [grid.1, reco.1] and the shadow [editorial.1, reco.2], and its terms would name all four
modules, grid.1 and reco.1 among them. In the example above the trust dial serves γ 0, so the
shopper's interests order the page reco.2, editorial.1, grid.1, reco.1, while at full trust editorial.1's
frozen lift of 2 would have led it. The three members change nothing served, counted or credited, appear
on no route answer, ride every exported decision record, are compared by value in replay, and a record
written without them replays without them.

### The signal floor

```json
{
  "governanceVersion": 4,
  "signalFloor": 3,
  "pages": { "pdp": [
    { "slot": "pdp-modules", "take": 4, "layout": true, "weights": { "line": 1 }, "signalFloor": "never" },
    { "slot": "pdp-story", "take": 2, "weights": { "line": 1 }, "signalFloor": 0 }
  ] }
}
```

`signalFloor` on the slot document is the tenant's signal floor N, a whole number of 0 or more; absent
means 0. A slot's own `signalFloor` overrides it: a whole number of 0 or more, or `never` on the page's
declared layout slot only. A signal is one action whose behaviour weight is above zero: the action's own
weight in the tenant's registry (`weights`), so a product view, a wishlist or cart add, a purchase or a
content click is a signal, and a page view, a render acknowledgement (`content_impression`), a time-only
re-evaluation and any other action weighted 0 is not, nor ever is the viewable impression (`content_viewable`); a weight applied elsewhere to what an action touched
never makes it a signal or stops it being one. The count lives on the shopper's persisted state, written
only once a signal is recorded, so a shopper with no signals carries exactly the state they carried before
and a returning shopper's earlier visits count; a browser linked to a person adds its count to the
person's.

While the shopper's count of signals is at most a slot's floor, the slot is decided on context alone: the
arrival's seed rules at their published weight, the configured order for the shopper's context, the
population prior at full weight, the learned lift from ladder levels 0 to 2 only, and the slot's pins,
exclusions, eligibility, freshness and merchandising; none of the shopper's interests, the journey-stage
rule, fatigue, ladder levels 3 to 5 or visitor-hashed exploration applies. The response to the (N + 1)th
signal is the first personalized one. A floor of 0 is off and is the default, so a tenant that publishes
none decides exactly as before. A `signalFloor` of `never` on the page's declared layout slot keeps the
layout context-only for every shopper while the page's content slots personalize (in the example, the
story slot's own floor of 0 personalizes it from the first signal, while any other slot of the page would
wait for the tenant's 3).

Publication refuses, naming the floor, `never` on any other slot (`pages.{page}[i].signalFloor`), `never`
as the tenant floor (`signalFloor`), and any floor that is not a whole number of 0 or more. The floor is
read under every governance version and does not by itself change the version a write is stamped with.
Every record of a context-only slot carries `explain.signalFloor: { floor, signals }`, keys sorted, and the
shopper's receipt says that the shopper is below the signal floor, with both numbers.

### The context-only layout switch

```json
{
  "governanceVersion": 4,
  "pages": { "pdp": [
    { "slot": "pdp-modules", "take": 4, "layout": true, "weights": { "line": 1 }, "contextOnly": { "enabled": true, "region": true } }
  ] }
}
```

`contextOnly` on the page's declared layout slot switches that slot to context-only; it is off by default (absent,
or `enabled: false`, decides the slot exactly as before), and `region: true` admits the shopper's region into the
context. It is a version-4 member, kept exactly as authored, and publication refuses it on any other slot
(`pages.{page}[i].contextOnly`, naming the slot). The context is the page, the entry channel and visit bucket the
decision's cell records, the device class the request reports (`mobile` or `desktop`; none when it reports
neither) and, where admitted, the region. On an arm that personalizes the slot is scored on that context alone: its
population priors at full weight (the context prior, and the regional prior only where the region is admitted), the
seed rules on `entry_channel` and `device`, the per-context order for the context (one naming a device serves that
device only), the learned lift from ladder levels 0 to 2, exploration hashed on the context and the hour, and every
module's eligibility rule read on the context, never the shopper's interests, journey stage, fatigue, memberships
or another seed rule. Every shopper of one context is therefore served the identical order within the hour. The
switch decides the slot, so the signal floor never holds a switched slot; on the holdout's `default` arm, and for a
shopper without consent, the slot is the default variant.

The answer's `X-Context-Key` header is a non-identifying key: `{page}|c={channel}|v={visit bucket}`, then
`|d={device}` when the request reported a device class, `|r={region}` when the region is admitted (`none` when
unknown) and `|arm=no_learning` on the holdout's no-learning arm, each value percent-encoded, then `|k=` and the
engine's seal, 32 lowercase hexadecimal digits; the default variant's key is `{page}|default|k={seal}`. It holds no
visitor, session or decision identifier and no user agent, and every shopper of one context gets the same key. The
seal lets the engine tell a key it issued from one it did not; it is derived from the deployment's signing
configuration, so an answer carries no key where none is configured.

A page drawn from a cached layout reports what it drew with one `layout_exposure` per page view
([event payloads](#event-payloads-by-type)): each drawn module is one exposure in the context's learning, at its
channel and visit bucket (the device is no learning level), on a slot measured on `rendered-v1`. A decision on
which the switched slot was decided for its context carries `inputs.context_only: { device?, region? }`, the device
class and the admitted region it was decided with (keys sorted, each only when there was one), so its replay
decides the slot in the same context.

## The learn document

What the learning may do, per brand and per slot. Every field has a default; a document names only
what it changes.

| Field | Meaning | Default |
|---|---|---|
| `holdout.share`, `holdout.arms` | The share of visitors held out, by a stable hash, and which arms exist (`default`, `no_learning`) | 0.05, `default` |
| `regional.enabled`, `kBlend`, `minEvents` | The population prior on the base score | on, 1, 30 |
| `contextPrior.enabled`, `kBlend`, `minEvents` | The context prior: the population of the shopper's entry channel and visit bucket, on the base score beside the regional prior, with its own K (`kBlend`), in the regional block's grammar, an optional `dimensions` list included ([the context prior](#the-context-prior)) | absent (off) |
| `policy.scope`, `match`, `credit`, `windowsMs` | The attribution policy: `session` or `visitor`; `direct` or `any`; `last` or `first`; per reward, how long after a decision an outcome may still count | session, direct, last; click 30 min, add to bag 6 h, purchase 7 d |
| `stats.n0`, `tauLearnMs`, `liftMin`, `liftMax`, `nMin` | The estimator: prior strength, the decay horizon, the lift clamp, the evidence threshold per cell | 30, 21 days, 0.5, 2, 30 |
| `external.kind`, `ref`, `timeoutMs`, `fallback` | Retained historical configuration only: all service/table/workers_ai live scoring, including table lookup, is withdrawn and contributes no score. The deployment setting `EXTERNAL_MODEL_POLICY` decides this, and `off` is its only deployed state (absent or any other value is also `off`); a weighted receipt names the withdrawn term with `status: "unavailable"` and `reason: "external scoring disabled by deployment policy"`. Every publication of a learn document that names `external` is refused, naming `external`: a new document, an edit (even one that keeps the stored term unchanged), a related-set write that carries one and `POST learn/items/reset`, which republishes the current document, answer 422, and a rollback to a revision that names one answers 404 with the same error. The refusal changes nothing: no revision is recorded, the stored document is served as before and a reset discards no evidence. The operator removes `external` in the console first (in the Dials view, under "Their own model, for every slot", set "Where it lives" to none and save); a document stored before this rule still reads and is served. No offline external table is published or offered. W14 enrichment/NL search are separately enabled workflows, not models in ordinary ranking | inactive |
| `slots.{slot}.gamma` | The trust dial; zero is not a learning-ingestion kill switch | 0 |
| `slots.{slot}.measurementBasis` | `served-v1` or `rendered-v1`; basis changes require compatible state/reset generation, never historical relabel | `served-v1` |
| `slots.{slot}.reward` | The reward the slot learns against | `click` |
| `slots.{slot}.objective` | `unit`, `revenue` or `margin`; unit credits are event weights, revenue uses value, margin uses the supplied margin and NEVER falls back to value — an outcome with no margin is worth nothing to margin learning, because a margin series weighed with a revenue number is two units in one counter | `unit` |
| `slots.{slot}.exploration` | `{ mode: rotation \| epsilon \| adjacent-swap \| off, share, floor }`; new writes reject Thompson, retained settings are inactive; `adjacent-swap`, on a page's declared layout slot only, swaps one pair of adjacent positions on `share` of the slot's decisions ([adjacent swaps](#adjacent-swaps-and-position-effects)) | off |
| `slots.{slot}.positionNormalization` | `true` or `false`, on a page's declared layout slot only, off by default: `true` divides the credit of an engagement at a position by that position's effect from `positionEffects`, live and in the hourly recomputation alike ([adjacent swaps](#adjacent-swaps-and-position-effects)) | absent (off) |
| `slots.{slot}.attribution` | The slot's own attribution policy, absent by default: absent, the slot is credited under the brand-wide `policy` exactly as before; `module-tied`, the only per-slot policy, credits a decision of the slot only for an outcome that carries that decision's `decisionId` or the module's identifier as `contentId`, so a buy-box conversion, which names no module, credits no decision of the slot ([where a page conversion lands](#where-a-page-conversion-lands)). Publication refuses any other value with an error naming `attribution` and writes no revision; a stored document naming another value still reads, with the member dropped. When a slot names it, the attribution record the visitor's ring derives when it credits an outcome (its credit receipt) itemises the policy and the decisions it credited | absent (the brand-wide policy) |
| `slots.{slot}.conversions` | The slot's conversion table, `{ <reward>: <value> }`: each reward it names converted into the slot's own currency at a finite value above zero. With it every record of the slot names its module's success event and the value applied, an outcome of a module's declared success event credits its decision the table's value for it, and a module without a declaration is credited for the slot's reward at the table's value for it, each times the objective's weight and kept in the counter of the slot's reward ([success events and conversion tables](#success-events-and-conversion-tables)). Publication refuses anything but an object naming at least one reward of the list, each with a finite value above zero, with an error naming `conversions`; a stored document's refused table reads as absent. A table that does not name the slot's own reward is published as written, and the success answer of the PUT or the validate door carries the `conversions_omit_slot_reward` warning in its `diagnostics` advisory | absent (the slot's reward and objective) |
| `slots.{slot}.autonomy` | `{ mode: configured \| assisted \| autonomous, step, min, max, pinned, minN }` | configured |
| `slots.{slot}.items.{item}` | `{ mode: reject }` or `{ mode: freeze, lift }` | none |
| `slots.{slot}.blend` | `{ p, shadowP }`, `p` from 0 to 1: the layout blend, set only on a page's declared layout slot. The slot's modules are then scored `R + (1 − p) × B + p × Q` ([the blend block](#the-blend-block)) instead of `base × lift^γ`. At `p` 0 the slot serves its configured order, else its catalogue order, term for term — only when the layout weights no shopper dimension and sets no stage, freshness, fatigue, merchandising or complements term; otherwise the behaviour term moves it. `shadowP`, from 0 to 1 and 0.1 when the dial names none, is the p the slot's shadow order is ranked at ([the baseline and the shadow](#the-baseline-and-the-shadow)); it changes nothing served. Publication refuses a `p` outside 0 to 1, a `shadowP` outside 0 to 1 with an error naming `shadowP`, any other member, and an opt-in on a slot that is not a page's declared layout slot; the document keeps the members exactly as published | absent (no blend); `p` 0 and `shadowP` 0.1 when the dial names none |
| `slots.{slot}.external.weight` | Historical-only scoring weight; does not re-enable withdrawn runtime scoring | inactive |
| `evidenceFloors` | The evidence floor per page type: page key of the slots document → F, a whole number of 1 or more. Below its page's floor an estimate on n exposures is shrunk toward the baseline by the F − n it lacks and applied ([evidence floors](#evidence-floors-evidencefloors)) | absent: no page has a floor |
| `contextVocabulary` | The tenant's context vocabulary: `channels`, `rules`, `sourcePlatforms`, `landingPageTypes`, optionally `visitBuckets` and `ladder` ([below](#the-context-vocabulary)) | absent: the six channel words, today's classification, buckets `1`, `2-3`, `4+`, depth 5 |

### The performance percentage

The console's Dials screen shows and edits each slot's performance percentage `P`, a number from 0 to
100, beside its trust dial, and the Slots screen shows it in the slot's row. It is the tuning screen's
form of a dial this document already stores, never a second stored value: the learn document has no
percentage member, and the screen saves it as the one dial it stands for.

| Slot | The percentage is | Saving `P` writes | A stored dial shows as |
|---|---|---|---|
| A content slot, or a layout slot that does not opt into the layout blend | the trust dial, γ × 100 | `slots.{slot}.gamma` = P / 100, nothing else | γ × 100: γ 0.35 as 35 |
| A page's declared layout slot that opts into the layout blend (`slots.{slot}.blend`) | the blend weight, p × 100 | `slots.{slot}.blend.p` = P / 100, with the blend's `shadowP` and the slot's γ kept as they were | p × 100: p 0.6 as 60 |

On a content slot γ = P / 100, and on a layout slot in the blend p = P / 100. The quotient is read as
decimals, so 33.3 percent saves 0.333. A dial the document does not name reads 0, as the decision reads
it, so a slot with no dials shows 0 percent and nothing is written until the percentage is edited. A
percentage outside 0 to 100, or text that is not a number, is refused on the screen and nothing is sent.
Saving a percentage sends every other member of the document, and every other slot, exactly as it was
read. At 0 percent a slot decides exactly as it does with its dial at 0, every slot's default, so 0
percent reproduces today's decisions term for term.

### Where a page conversion lands

```json
{ "policy": { "scope": "session", "match": "any", "credit": "last" },
  "slots": { "pdp-modules": { "measurementBasis": "rendered-v1", "reward": "add_to_bag", "attribution": "module-tied" } } }
```

A slot's learn dials may carry `attribution: "module-tied"`, the slot's own attribution policy, absent by
default; absent, the slot is credited under the brand-wide `policy` exactly as before, online and in the
offline recomputation. `module-tied` is the only per-slot policy. It replaces the brand-wide `match` for
that slot's decisions alone: the scope, the credit rule and the reward's window stay the brand-wide
policy's, the slot's own `reward` still decides which outcomes it learns from, and every other slot on
the page is credited under its own policy, so one outcome on a page with a module-tied layout slot and a
content slot under the brand-wide policy credits each slot by its own rule.

Under `module-tied` an add to bag or purchase originates inside a module when it carries the module's
`decisionId`, or the module's identifier as `contentId` (and, when it names a `slot`, that slot's own
name); it then credits that module's decision once. A buy-box add to bag or purchase that names only the
product credits no decision of a module-tied slot, not even the decision of a module that features the
product: an identifier carried as a product (`productId`, `product_id`, `sku` or `items[]`) names no
module. An event may also carry the page view's `pageInstance`, but the outcome record keeps no page view,
so the page view is not compared: of several decisions of the named module inside the shopper's scope and
the reward's window, the credit rule picks one (the most recent under `last`).

The itemisation lives on the attribution record the visitor's ring derives when it credits the outcome:
its credit receipt carries `attribution: [{ slot, policy, credited }]`, one entry per slot whose learn
dials name their own policy, sorted by slot, `policy` the slot's policy and `credited` the decision
identifiers it credited, `[]` when it credited none, the same decisions its credit effects carry. It is
written for every outcome, one that credits nothing included, and is absent when no slot names a policy
of its own, so such a tenant's receipts, credit effects, outcome records and ledger messages stay exactly
as they were. The stored outcome record never carries it, and the statistics object never sees the
setting: the slot configuration it is sent stays exactly `reward`, `stats`, `objective` and
`measurementBasis`. The receipt is kept with the ring's credit plan and returned on the ring's answer to
the learning fan-out; no public route answers it. The offline recomputation (`POST
/v1/{tenant}/learn/generation` with `rebuildFrom`) folds the retained day under the same per-slot rule,
so a module-tied slot rebuilt from the ledger holds the counters online credit gave it; so do the hourly
fold and the day report under their `learning` policy, while the reporting presets stay brand-wide.

### Success events and conversion tables

```json
{ "pieces": [ { "id": "story.bag", "customerContentId": "S-BAG", "type": "editorial", "title": "Carry it",
    "tags": { "line": ["classic"] }, "slotTypes": ["home-stories"], "successEvent": "add_to_bag" } ] }
```

```json
{ "slots": { "home-stories": { "reward": "click", "conversions": { "click": 1, "add_to_bag": 5 } } } }
```

A piece's `successEvent` is optional and absent by default: one reward of the list (`click`, `dwell`,
`video_complete`, `wishlist`, `add_to_bag`, `purchase`, `custom`) that counts as the module's success,
and absent the module is credited for its slot's reward. A slot's `conversions` table converts each
reward it names into the slot's own currency at a finite value above zero; it too is absent by default,
and without it the slot's `reward` and `objective` credit every module exactly as before, a declared
success event included, with no new member on any record, receipt, credit or manifest. With a table, an
outcome of a module's declared success event credits that module's decision the table's value for the
event, and a module that declares none is credited for the slot's reward at the table's value for the
slot's reward: in the example an add to bag on `story.bag` credits it 5 and a click on an undeclared
story credits that story 1, exactly today's click. A success event the table does not value credits
nothing (a module declaring `purchase` above earns nothing for a purchase), and neither does any event
other than the module's success event: a click on `story.bag` credits its decision nothing, and the
outcome receipt names the slot `reward` in `refusedBySlot`. A table that does not value the slot's own
reward credits nothing to a module that declares no success event. Each value is multiplied by what the
slot's objective weighs the outcome — 1 under `unit`, its value under `revenue`, its margin under
`margin`, the money refusals unchanged — and kept in the counter of the slot's own reward, the slot's
currency, so the lifts of modules with different success events are measured in one currency and rank
them in one slot. On a declared layout slot that normalises positions the position effect then divides
the credit, live and in the hourly fold alike. The slot's attribution policy decides which decision is
credited (`module-tied` included), and among one slot's decisions an outcome matches only those it is the
success of, before the credit rule picks one. `custom` stands for every outcome of the custom reward (a
partner pickup, a retailer referral) whatever its own name. An event that is no reward (a page view,
`content_viewable`, `video_view`, `product_dwell`) is no outcome and credits nothing whatever the table
says, an outcome the objective weighs zero stays zero, and a product-type weight scales the shopper's
interest update, never this credit.

Every decision record of a slot with a table carries `explain.successEvent: { event, value }` (keys
sorted): the module's declared event, else the slot's reward, and the table's value for it, `value: null`
when the table does not value it. Every arm carries it; the shopper's receipt carries the same block as
`successEvent` and adds no sentence. A decision's credit is read off its record, by one rule online in
the visitor's ring and in every offline fold, the offline recomputation (`rebuildFrom` on `POST
/v1/{tenant}/learn/generation`) and the hourly fold included, so a declaration or a table changed after a
decision changes nothing that decision earns, and the next decision names the new one. Publication
refuses with `422` a `successEvent` outside the list, naming `pieces[i].successEvent`, and a `conversions`
member that is not an object, is empty, names a key outside the reward list or values a reward with
anything but a finite number above zero, naming `conversions`; a retained document's refused member reads
as absent. A direct publication that declares `successEvent` keeps it on the stored piece with no
`ignored_field` advisory for it, and a feed import or pull carries it the same way. Limits: a table on a
slot no page carries is accepted and changes nothing (the learn validator does not read the slots document); adding,
changing or removing a table starts no new accumulation generation, so earlier credits stay at the values
they were credited with; the replay does not compare `explain.successEvent`, and a replayed record omits
it, which changes no score; the raw-day report built from the ledger counts a declared success event only
where it is the slot's own reward, unweighted by the table.

A table that does not name the slot's own reward, `{ "add_to_bag": 5 }` alone on a slot whose reward is
`click`, is still published, and the publication tells the operator: the success answers of `PUT
/content/learn` and `POST /content/learn/validate` carry, beside their other members, the advisory
`diagnostics` member of schema `learn-conversion-diagnostics/v1`, in the envelope of the catalogue's and
the pin channel's advisories, with one `conversions_omit_slot_reward` warning per such slot naming the
`slot`, the omitted `reward` and the consequence `undeclared_pieces_earn_nothing`: every module on that
slot which declares no success event earns nothing, because its record names the slot's reward with
`value: null`.

```json
{ "diagnostics": { "advisory": true, "omittedWarningCount": 0, "schema": "learn-conversion-diagnostics/v1", "status": "available",
    "warningCount": 1, "warnings": [ { "code": "conversions_omit_slot_reward", "consequence": "undeclared_pieces_earn_nothing",
      "reward": "click", "slot": "home-stories" } ] } }
```

The member and each warning are written with their keys sorted. The member is present only when at least
one table omits its slot's reward: a document without a table, or whose every table names its slot's
reward, is answered byte for byte as before. Beside those two success answers, the current read `GET
/content/learn` carries the same `diagnostics` member, as its last member, when the learn document in
force (the stored document, or the compiled default when none is stored) has such a table, computed on
that read and never stored, so a retained document stored with such a table is told to whoever reads it.
The console's Dials screen shows that advisory on open, before the first edit, in the note it uses for
its check and its save (`data-learn-advisory="read"`); the first edit drops it, and the check's and then
the save's note replace it. The learn history and revision reads and the lift reads never carry it. The warning
refuses nothing and changes nothing: the document is published or validated with
the same status and members, and the credits, records, receipts and replays are the ones described above.
A slot's reward is its `reward` dial, `click` when the dial is absent, and a table names it only by that
key, `custom` included. Warnings are listed one per slot in slot-name order, the order the published
document keeps its slots in, so the validate door lists them exactly as the PUT of the same document will;
at most 50 are listed, `warningCount` counts them all and `omittedWarningCount` is the rest. A table on a
slot no page carries is warned like any other, since the learn publication does not read the slots
document and the table omits the slot's reward the moment a page carries the slot. The answers of a
rollback, and of a learn document published as a `publicationChanges` member of another document's
request, carry no advisory; the next read of the document in force does.

### The context vocabulary

```json
{
  "contextVocabulary": {
    "channels": [
      { "id": "paid_social", "name": "Paid social" }, { "id": "paid_search_brand", "name": "Paid search (brand)" },
      { "id": "paid_search_nonbrand", "name": "Paid search (non-brand)" }, { "id": "organic", "name": "Organic search" },
      { "id": "email", "name": "Email" }, { "id": "sms", "name": "SMS" }, { "id": "affiliate", "name": "Affiliate" },
      { "id": "referral", "name": "Referral" }, { "id": "direct", "name": "Direct" }
    ],
    "rules": [
      { "channel": "sms", "utmMedium": ["sms"] },
      { "channel": "email", "utmMedium": ["email", "newsletter"] },
      { "channel": "affiliate", "utmMedium": ["affiliate"] },
      { "channel": "paid_social", "utmMedium": ["paid_social", "cpc"], "utmSource": ["facebook", "instagram", "tiktok"] },
      { "channel": "paid_search_brand", "utmMedium": ["cpc", "ppc"], "utmCampaign": ["brand"] },
      { "channel": "paid_search_nonbrand", "utmMedium": ["cpc", "ppc"] },
      { "channel": "organic", "untagged": true, "referrer": ["google.com", "bing.com"] },
      { "channel": "referral", "untagged": true, "referrer": "external" },
      { "channel": "direct", "untagged": true, "referrer": "none" }
    ],
    "sourcePlatforms": [{ "id": "meta", "name": "Meta", "networks": ["facebook.com", "instagram.com"] }],
    "landingPageTypes": [{ "id": "homepage", "name": "Homepage" }, { "id": "product", "name": "Product page" }],
    "visitBuckets": [1, 2, 4],
    "ladder": { "order": ["c", "v", "s", "r", "a"], "depth": 5 }
  }
}
```

`contextVocabulary` is an optional member of the learn document whose `channels` are the tenant's channel values,
published, stamped and versioned with the learn document's own revision (`PUT /content/learn`), so a change
takes effect with no deployment. The example names nine channel values: `paid_social`, `paid_search_brand`, `paid_search_nonbrand`, `organic`, `email`, `sms`, `affiliate`, `referral` and `direct`.

| Member | Meaning |
|---|---|
| `channels` | `{ id, name }` values. An id is lower case letters, digits and underscores, starting with a letter, at most 64 characters, never `unknown` or `any`, and listed once |
| `rules` | The published mapping, read in order: a rule names a `channel` of the vocabulary and at least one condition, every one of which must hold: `utmMedium` (mediums), `utmSource` (sources, matched whole or as a token of a token-form source split on `_`, `-` and white space), `utmCampaign` (tokens of the campaign, split the same way: the brand split), `referrer` (`none`: a page view whose referrer is empty or the site's own host; `external`: a referrer host that is not the site's own; or a list of registrable domains, dot-boundary), `untagged: true` (no utm_medium, utm_source or utm_campaign declared). The first rule that holds classifies the arrival; when none holds it records as unknown (`null` on the visit, `unknown` on the cell), never a guess |
| `sourcePlatforms` | `{ id, name, networks }`: the platform whose `networks` hold the referrer's host, or the network a token-form `utm_source` names (`facebook_ads` names facebook.com), is the visit's source platform |
| `landingPageTypes` | `{ id, name }`: the `data.pageType` of the visit's first event naming one of these ids is the visit's landing-page type, kept for the visit |
| `visitBuckets` | Optional. Lower bounds, whole numbers strictly ascending from 1: `[1, 2, 3, 6]` names the buckets `1`, `2`, `3-5`, `6+`. Omitted: `[1, 2, 4]`, today's `1`, `2-3`, `4+` |
| `ladder` | Optional. `{ order, depth }`: the order is exactly `c`, `v`, `s`, `r`, `a`; the depth, 1 to 5, is how many levels below everyone a learned lift is read from. Omitted: depth 5 |

Every member is validated as the document is published, and any error refuses it whole with 422 naming
`contextVocabulary`, the member and the offending value; a refused document writes no revision. The source
platform and the landing-page type are recorded on the visit and are the seed-signal keys `source_platform` and
`landing_page_type` ([contextual seed rules](#contextual-seed-rules)); they are context attributes, not
learning-cell levels. The cell carries the tenant's channel id and the bucket of its cut, the learning counts
it there, and a per-context order names the tenant's channel ids and the buckets of its cut. The arrival
contract carries `utmCampaign` (256 characters, like `utmSource`), sent only when the landing URL has
`utm_campaign` and never stored. A change of the channel values (as a set), the cut or the depth in `contextVocabulary` changes `cellGrammar`: see [the priors document](#the-priors-document).

### The context prior

```json
{ "contextPrior": { "enabled": true, "kBlend": 4, "minEvents": 30 } }
```

The context prior lets the arrival's context shape a first decision: the learn document's `contextPrior` block,
with `enabled`, its own `kBlend` and `minEvents`, publishes a population prior per entry channel and visit
bucket beside the regional prior. Scored events fan into population shares per tenant, entry channel
(`direct`, `paid_social`, `paid_search`, `email`, `organic`, `referral`) and visit bucket (`1`, `2-3`, `4+`),
kept by the same population-trend objects the regional prior uses and holding no visitor or session
identifier; an event whose entry channel is unknown, or from a shopper who refused tracking, counts nothing
there, and the hourly roll-up sums each channel's visit buckets into the channel alone. A decision reads the
shares of the shopper's entry channel and visit bucket when that pair has at least `minEvents` events, else the
shares of the channel alone over every visit bucket, and never everyone's, so the regional prior's population is
not counted twice. Its weight is λ = kBlend / (kBlend + Σ personal affinity), so a first-time visitor's λ is 1.
With the regional prior also on, the shopper's own interests keep (1 − λ of the region) × (1 − λ of the
context) of their weight and each prior adds its own λ × share, so neither erases the other.

The prior is off when the block is absent or `enabled` is false, so a learn document without it decides exactly
as before. It never applies on the holdout's `default` arm, without personalization consent, or for a shopper
whose entry channel is unknown, and a population snapshot that cannot be read is no prior. Below the signal floor
it is a context term at full weight beside the regional prior; a configured order is served exactly; on a layout
slot that opts into the layout blend it is part of the behaviour term `B`. Every record of a decision under it
carries `inputs.context_share`, the shares it used (keys sorted), and every position it contributed to carries
`explain.contextPrior`; a record without the shares replays as before. The shopper's receipt itemises it in
words, such as "Population prior, paid social, first visit: what visitors arriving this way engage with
contributed 1.5 (the prior's share of the score: 1)." for the channel and visit bucket, while a receipt read
from the channel alone names the channel and every visit and claims no visit of its own.

### Evidence floors (`evidenceFloors`)

```json
{ "evidenceFloors": { "pdp": 300, "home": 50 } }
```

The learn document's `evidenceFloors` publishes an evidence floor per page type: each key is a page key of the
slots document and each value that page's floor F, a whole number of 1 or more. Publication refuses with `422`
anything else naming `evidenceFloors.<page>` (zero, a fraction, a negative number, a number written as text,
`null`), and an `evidenceFloors` that is not an object or names a page that is not a slug. A document without
`evidenceFloors` keeps none, and reads back exactly as it was written; a page it names no floor for decides
exactly as before.

The ladder answers as before, the finest level reaching `nMin`, and a piece with no such level gets no lift.
Where the decision's page has a floor F and that level holds n exposures with n below F, the estimate is shrunk
toward the baseline p₀ (the slot's rate in that cell, the lift's own reference) by the F − n exposures it lacks,
at the baseline rate: `p_hat` becomes `(n × p̂ + (F − n) × p₀) / F` and `lift` that over p₀, clamped as
before, and the lift is applied, never skipped for being below the floor. With n at or above F the estimate is
applied as before. n is the observed exposures `n` of the lift block; an imported prior's strength does not
count toward F.

| Member | Where | Meaning |
|---|---|---|
| `explain.lift.evidenceFloor` | The decision record, on a lift the page's floor shrank | `{ floor, lacking, n, page }`, keys sorted: the page's floor F, the exposures n the answering level held and `lacking`, F − n; absent wherever no floor applied, and compared by value in replay, which reads the floor of the learn revision the record names |
| `evidenceFloor` | The shopper's receipt | The same block as the record's, exactly; `lift_terms` carries the shrunk estimate, and `why` adds no sentence |
| `evidenceFloor` | `GET learn/exploring` and `GET lift` | `{ floor, page }`, keys sorted: the configured evidence floor of the page the slot is on |
| `to_evidence_floor` | Each `GET learn/exploring` row | Its exposures to the configured evidence floor: F − n at level everyone, never below 0, beside `to_floor`, which counts against the exploration floor |
| `toEvidenceFloor` | `GET lift` | `{ item: F − n }` for every item of the snapshot at level everyone, never below 0: each item's exposures-to-floor against the configured evidence floor |

None of these members appears for a page without a floor, so a learn document without `evidenceFloors` produces
exactly the records, receipts, replays, route answers and rows it produced before.

## The priors document

Rows of `{ slot, item, cell, p_prior, n_equiv, measurementBasis? }`, or corresponding CSV columns, with the optional document member
`cellGrammar { name, version, order }`. Missing basis is served-v1; priors must match the configured denominator, never carry served pseudo-counts into rendered measurement. `cell` is `*` for
everyone or `k=v` pairs joined by `|` in the ladder's own order and as a PREFIX of it: `c=`, `v=`, `s=`, `r=`, `a=`
(channel, visit bucket, journey stage, region, affinity). A cell in another order, with a key the ladder
does not have, with a level skipped, or with a level past the end is refused by row, naming the expected
order, because it would name a cell no snapshot ever builds. The ladder order is versioned: `cellGrammar`
declares the grammar a file was exported under, anything but the current one is refused with the migration
named, and a document that declares nothing is read under the current grammar. A tenant whose published `contextVocabulary` changes the channel values, the visit-bucket cut or the ladder depth reads another `cellGrammar`: `ladder-cell` at a version derived from those three members (3 plus a 32-bit FNV-1a of the sorted channel ids, the cut and the depth) and the order cut at the depth, so a file exported under the previous vocabulary is refused naming `cellGrammar`, the grammar in force and the re-export, and a row on a cell finer than the depth is refused by row; a vocabulary that changes none of the three keeps `ladder-cell` version 3.
The cell grammar is version 3: its order is version 2's, so every cell of an undeclared module names the same
level, and a cell of a module the catalogue declares `pooled` is written in the pooled order, its page first —
`*` or a prefix of `p=`, `c=`, `v=`, `s=`, `r=`, `a=`, such as `p=pdp|c=email` — the page being that record's
level directly after everyone. A file declaring version 2 is refused with the migration named, and a document
already stored under version 2 keeps being read and applied as it was. `p_prior` is the rate your team estimated
elsewhere in the selected objective unit, and because it is a probability it is refused for a slot whose
objective is `revenue` or `margin`, naming the slot, its objective and the unit; `n_equiv` is how many exposures it should be worth. The imported value supplies the smoothing target and strength, not a replacement for the slot's own `p0` lift denominator. Every receipt names the prior document's
revision. A slot whose only evidence is an imported prior publishes a snapshot with `events: 0` and its
prior-derived rows; a slot with neither events nor priors publishes nothing.

## The attribute vocabulary

```json
{
  "version": "attributes-spring",
  "attributes": {
    "category": { "values": [
      { "id": "bags", "name": "Bags", "synonyms": ["handbags"] },
      { "id": "small_leather_goods", "name": "Small leather goods", "synonyms": ["slg"] }
    ] },
    "productType": { "values": [
      { "id": "crossbody", "name": "Crossbody", "synonyms": ["cross-body"], "parent": "bags" },
      { "id": "wallet", "name": "Wallet", "parent": "small_leather_goods" }
    ] },
    "color": { "values": [{ "id": "brown_tan", "name": "Brown / tan", "synonyms": ["cognac", "tan", "brown"] }] },
    "occasion": { "values": [{ "id": "evening", "name": "Evening", "synonyms": ["night out"] }] }
  }
}
```

The document of kind `vocabulary`, published with `PUT /content/vocabulary` as a versioned revision and stored
exactly as written (its `version` is not stamped). Each value is `{ id, name, synonyms?, parent? }`: synonyms are optional on any value, and a parent is required on every `productType` value.

| Member | Meaning |
|---|---|
| `version` | Optional label, 1 to 256 characters |
| `attributes` | 1 to 64 attributes, each keyed by the registry dimension and catalogue tag key it governs (1 to 64 characters, trimmed, none of `:`, `;`, `|`) |
| `attributes.<attribute>.values` | 1 to 1000 values |
| `id` | Lower-case letters and digits, words joined by single underscores, at most 64 characters, listed once per attribute: what the catalogue stores and what interest is built under |
| `name` | The display name, 1 to 256 characters, kept exactly as written |
| `synonyms` | Optional. Up to 50 words the source systems send for the value, each 1 to 64 characters with no leading or trailing space; each belongs to one value of its attribute and is never another value's id |
| `parent` | The parent category of a `productType` value: exactly one id, one of the `category` ids when the document lists `category`. Optional on any other attribute, an id when present |

**The mapping table.** An attribute's ids and synonyms are its one mapping table: an id maps to itself and a synonym to its value's id, matched exactly (letter case included); nothing else maps, a display name included. The catalogue publications and the event ingest on both hosts read the same table, so data arriving already mapped passes unchanged.

**The approval.** A stored revision governs nothing until the tenant's operator approves it: `POST /content/vocabulary/approve/{n}` (authored like every write) puts revision `n` in effect, and `GET /content/vocabulary` then answers `revision` (the latest stored) and `effectiveRevision` (the revision in effect; 0 while none is). The approval is published as its own member of the configuration set, `{ revision, document }`, carrying the approved revision whole, so a later revision blocks nothing until it is approved in turn.

**In effect.** An attribute the vocabulary lists is governed: a catalogue tag on it is stored as ids or refused naming the piece's `id` and `tags.<attribute>`, and an event value on it builds interest under its id, or none when it maps to nothing. A tenant with no approval in effect is governed by nothing here.

**The rejection report.** `GET /content/vocabulary/rejections` answers the values the ingest refused under the revision in effect:

```json
{ "scope": "<tenant>", "kind": "vocabulary", "effectiveRevision": 1, "since": 1760280000000,
  "rejections": { "color": { "chartreuse": 3 } }, "omitted": 0 }
```

`rejections` holds, per governed attribute, each refused value and the number of events that carried it, counted from `since`, the first refusal under that revision, over at most 30 days; `since` is null and `rejections` empty when nothing was refused or no revision is in effect. `omitted` counts refusals past 64 attributes or 256 values of one attribute. It is a per-tenant count, with no shopper, session or event identifier.

## The lift snapshot

`GET /v1/{tenant}/lift`. `{ tenant, brand, slot, reward, objective, measurementBasis, tauLearnMs, version, publishedAt, events, n0, nMin, liftMin,
liftMax, priorVersion, items, slotRates, attributionContract, generation, restartedAt, exposuresSinceRestart, witness, completeness?,
rebuiltFrom?, positionEffects? }` — the stored snapshot exactly as it was published, member for member. `items` is item id → cell key → `{ level, key, n, s, p0, n0,
p_hat, lift, liftReference, prior? }` with the symbols defined above. For a module the catalogue declares
`pooled`, its entry is the module's one pooled record, the same counts in the snapshot of every placement that
serves it: keys `*`, `p=<page>` and that page with the ladder's own levels, levels 0 to 6, each `p0` the reading slot's
own rate in the cell the key stands on; an undeclared module's entry is its own placement's evidence, exactly as
before. `liftReference` is `slot-rate` where the
slot has a rate in that cell and `none` where it has none, so a `lift` of 1 at `p0: 0` is read as "no
reference" and not as "measured, and equal to the slot"; it is absent on a snapshot archived before it was
named. `slotRates` is cell key → the slot's own `{ n, s,
rate }`. `version` is the publish time in milliseconds and is what a decision's `versions.lift` names.
The slot's statistics object publishes a new version within 30 seconds of new evidence (its alarm) and at once
on `POST /v1/{tenant}/learn/publish`. An alarm that finds nothing changed since the slot's last successful
publication publishes nothing: the snapshot, its `version` and `publishedAt`, its archive and the object's
record of it stay exactly as that publication left them, so a copy an edge location holds stays the latest
(`src/durable-objects/LearnStats.ts:741`, `:1365-1366`). Nothing changed means that the slot's own counted
evidence (an exposure or a credit), its configuration, generation fence and repair basis, the tenant's
published documents (its learn, prior, catalogue and slots documents among them, taken as the tenant's
publication set in force, by its revision: any document republished, even unchanged, is a change) and the
pooled counters the slot reads from a pooled module's other placements are what that publication was built
from (`:1420-1436`), recorded with the publication before its copy is written (`:1392-1394`); the counts
decaying with time alone is not a change, so a snapshot keeps its counts as of its `publishedAt` until
something changes. The alarm still publishes with nothing changed while the stale marker or the republish
member below is in force, and that publication clears it as before, and when the copy the serving key holds
is not the last publication, as after a publication whose write of the copy failed (`:1449-1459`). Removing
expired learning-effect markers changes no snapshot and is not a change.
The same alarm keeps the statistics object warm for the decisions that read it: after a witness call it answers,
an exposure write or a credit write, the alarm is due at most 5 seconds ahead (`WARM_HEARTBEAT_MS`) and each
alarm re-arms it so until 10 minutes after the last of them (`WARM_TAIL_MS`). A heartbeat re-arms and performs
nothing else unless a publication is due: no snapshot, no publication check, no key-value read, no publication
and no key written. A publication is due only 30 seconds after new evidence, a clean-up of a shopper's learning effects that retires their markers, a stats repair (`coarsen` or the explicit `reset`, a repeat of one included), a republication of the tenant's
documents (which a heartbeat with nothing else pending sees in the publication head the configuration cache
holds, reading the head and its set at most once every 30 seconds) or a refused or failed publication (its
retry), never earlier unless the object restarted in between, and that alarm publishes only a change, as above (across a restart, a write still pending is published by the restarted object's first alarm, below, up to 30 seconds before it was due and never lost: 14 seconds after the write where measured). It costs up to 720 alarm invocations per
object-hour inside the tail, and the object stays resident for the tail after each touch or restart; after it the heartbeats stop and the
alarm left is the next marker's expiry, if any. An object started again knows neither its last touch nor a
pending change's age: its first alarm runs the routine publication once, which publishes only a change, and,
unless that alarm is a learning-effect marker's expiry, resumes the heartbeat as a touch would, so the tail may
extend by up to 600 seconds after each restart and an object that keeps restarting less than ten minutes apart
stays warm.
`tauLearnMs` is the decay horizon, in milliseconds, the counts were decayed with; the serving path uses a
snapshot only when its `tauLearnMs`, `reward`, `objective`, `measurementBasis` and estimator dials are the
ones the tenant's published learn document names. `witness` is a digest of the statistics object's
committed identity — tenant, brand, slot, configuration, generation fence and projection — which the
serving path checks against the object itself, together with the published digest, before it trusts a
cached snapshot: a snapshot the object does not confirm, healthy and under its current witness, as its latest
publication or one of its recent ones (within ten minutes of that snapshot's `publishedAt`; the record then
carries `explain.lift.asOf`) serves no lift.
The decision record of such a refusal carries `explain.lift: null` and `versions.lift: 0` and does not say
why; the decision's answer does, per learning slot, in `sources.lift` (`served`, `none`, `incompatible`,
`late`, `superseded`, `unrecognized`, `unhealthy` or `failed`, with its milliseconds), and the monitor
counts each outcome for the tenant as `learningReads` (the API reference, the snapshot answer and the
monitor).
The witness read and the shopper's ring read each wait at most their budget, reported in `sources.budgets`:
600 ms each by default (`LIFT_WITNESS_BUDGET_MS`, `RING_READ_BUDGET_MS`), one edge round trip to a warm
statistics object, measured on the platform at a largest 478 ms inside a warm tail, with a buffer, since the budget
bounds the wait, not the read; a deployment may override either with a whole number of milliseconds below 5 000,
and any other value is refused, the 600 ms default kept and the variable named in `sources.budgets.refused`.
A slot name the tenant's catalogue carries on more than one page has one snapshot per page, read with
`page=` (see the API reference); its `slot` member is still the slot name, the answer around it names the
`page`, and the page is part of the committed identity its `witness` digests.
`completeness`, on counters kept under the application's bounds (absent on counters from before those
bounds existed), is `{ depth, omittedItems, selection, reason }`: the finest ladder level still kept
(`depth`, 0 to 5), whether items past the item budget were folded into the slot's root instead of being
kept by name (`omittedItems`), how the kept items were chosen (`first-seen`, or `lexical-repair` after a
coarsening repair), and `reason` — `complete`, `coarse` when fine levels were dropped, or `item-capacity`
when items were folded. `rebuiltFrom` names the repair the counters stand on, and only on a slot that was
repaired (below). `positionEffects`, only on a slot whose adjacent swaps have been counted, is
`[{ position, effect, pairs }]`: each position's effect estimated from the swaps as a click ratio
([adjacent swaps](#adjacent-swaps-and-position-effects)).

**The stale marker (`stale`).** Beside the snapshot, never inside it, `GET /v1/{tenant}/lift` and
`GET /v1/{tenant}/lift/rows` answer one more member, `stale`, last, and only while the slot's snapshot in
force is stale because its publication was refused for the pooled cause: a pooled module's record is read from
every placement the module is served on at publication, and a pooled publication refused because another
placement's statistics cannot be read answers `503` `{ ok: false, error, stale }`, naming that placement's
page and slot and the pooled modules the refused slot reads from it, at the statistics object and at
`POST /v1/{tenant}/learn/publish` alike. The stale marker is
`{ lastPublished: { publishedAt, version }, modules, placement: { page, slot } }`, keys sorted:
`lastPublished` the `version` and `publishedAt` of the snapshot in force, `null` on a slot that has never
published; `modules` the pooled modules the refused slot reads from the faulty placement, sorted, one to 256
of them; `placement` the page and slot whose statistics could not be read. The refusal never publishes part of
a pooled record: the slot's snapshot stays at its last successful version, member for member as it was
published, so `lastPublished` names the very snapshot the lift read answers. The stale marker is carried until
a later publication of the slot succeeds, and after it succeeds `GET /v1/{tenant}/lift` and
`GET /v1/{tenant}/lift/rows` answer exactly their usual members again; a slot that was never refused this way
never carries it, and its answers, snapshot and storage are exactly as before. The `error` begins
`statistics recovery required:` and names the page, the slot, each pooled module and the version the snapshot
stays at (or, with no earlier publication, that the slot stays unpublished); a refusal after a learn republish
names its own cause (`republished`, below), and a recovery refusal of any other cause keeps its text exactly,
`statistics recovery required` at the object and `statistics acknowledgement unavailable` at
`POST learn/publish`, and carries no `stale`. When several
placements cannot be read at once, the first in page order, then slot order, is named, and the next once that
one answers. The console's lift grid marks a slot whose `GET /v1/{tenant}/lift/rows` answer carries `stale`:
one note above the grid's table names the faulty `placement` (its page and slot), the pooled `modules` and the
last successful publication from `lastPublished` (its version and time, or that the slot has none yet), and the
mark is gone once a read no longer carries the marker.

**The republish member (`republished`).** A slot's statistics accumulate under one tuple, the slot's `reward`,
`objective` and `measurementBasis` and the learn document's `stats` block, and a learn document republished with
another value for any of them, which no generation transition accounts for, has every publication of the slot
refused, with the snapshot in force left as it was. That refusal answers `503` `{ ok: false, error, republished }`
at the statistics object and at `POST /v1/{tenant}/learn/publish` alike, and from it until the slot's next
successful publication `GET /v1/{tenant}/lift` (the snapshot in force) and `GET /v1/{tenant}/lift/rows` answer one
more member, `republished`, last. The member is
`{ changed: [{ member, new, old }], endedBy: "generation_transition", page?, slot }`, keys sorted: `changed` lists
each member of the tuple whose value in the republished learn document (`new`) differs from the one the slot's
statistics accumulate under (`old`), sorted by `member`, one to eight of them, named `measurementBasis`,
`objective`, `reward`, `stats.liftMax`, `stats.liftMin`, `stats.n0`, `stats.nMin` or `stats.tauLearnMs`, the
words of a dial as strings and the `stats` values as numbers; `endedBy` is `generation_transition`; `slot` names the
refused slot and `page`, only on a page-scoped placement, its page. The `error` begins
`statistics recovery required:`, names the slot, each changed member with its old and new values and the version
the slot's statistics stay at (or, with no earlier publication, that the slot stays unpublished), and says what
ends it. `republished` is carried until a publication of the slot succeeds, which happens after an operator starts
the new generation with `POST /v1/{tenant}/learn/generation` (its own publication) or after the learn document is
republished with the old values; the reads then answer exactly their usual members again. A generation transition
whose own publication does not succeed (`publicationOutcome` `unknown`) ends `republished` as well, since it adopted
every changed member: both reads no longer carry `republished` from its answer on, the record superseded under its
own key, and the snapshot in force stays the last successful one. When the transition's publication failed on a
pooled fault, the reads then carry `stale` alone until a publication of the slot succeeds, the same marker the next
refused `POST /v1/{tenant}/learn/publish` answers in `{ ok: false, error, stale }`. A republish that changes
nothing in the tuple is not refused, and a slot whose tuple never changed never carries `republished`. The
console's lift grid marks a slot whose `GET /v1/{tenant}/lift/rows` answer carries `republished`: one note, right
after the `stale` note when both apply, names the `slot` (and `page`), each `changed` member with its `old` and
`new` values and what ends it (a new generation that adopts every changed member, a `measurementBasis` only by a
republish with the old basis, or the learn document republished with the old values), and the mark is gone once
a read no longer carries the member.

**The transition's refusal member (`notAdopted`).** A generation transition (`POST /v1/{tenant}/learn/generation`)
that does not adopt a member of the slot's tuple that a learn republish changed, the slot's `reward`, `objective`
or `measurementBasis`, is refused: it answers `409` `{ ok: false, error, notAdopted, operationId }` and writes
nothing, and `republished` stays as it was. The member `notAdopted` is `{ changed: [{ member, new, old }], page?, slot }`,
keys sorted: `changed` lists, sorted by `member`, each member not adopted, one to three of them, named
`measurementBasis`, `objective` or `reward`, `old` the value the slot's statistics count under and `new` the
learn document's, both as words; `slot` names the refused slot and `page`, only on a page-scoped placement, its
page. The `error` begins `generation transition refused:`, names the slot, each member with its old and new
values, and says how to adopt it: a `reward` or an `objective` by naming its new value in the body of the
transition (or by republishing the learn document with the old value), and a `measurementBasis`, which no
transition moves, by republishing the learn document with the old measurement basis. A transition that adopts
every changed member, or on a slot whose tuple did not change, answers its usual members.

**What `slot-rate` compares against, and what it does not prove.** The `slot-rate` reference is the
slot's own rate in that cell, and that rate includes the item's own exposures and successes: the item
is part of the mixture it is being divided by, so the more of a slot's traffic one piece takes, the
closer its own reference moves to its own rate. Read `lift` accordingly. A lift near one is not proof
that ranking has collapsed, and it is not proof that the piece is average — it is equally consistent
with a piece that dominates the slot it is measured in, and with a slot whose pieces genuinely
perform alike. This is an open model-validation question, not a defect with a proved repair: no
validation of `liftReference` against an agreed objective is claimed here, and the platform mandates
no leave-one-out or held-out reference in its place, because comparing the alternatives under the
clamps, the shrinkage, the context ladder and the single-item case is an evaluation your data-science
owners make. What the platform commits to is naming the reference on every row, so nothing about it
has to be assumed.

`slotRates` is the mass of the evidence the platform still HOLDS — the retained items plus the bucket of
items capacity omitted — so an item whose evidence was discarded leaves no denominator counting exposures
it can no longer be credited for. For a slot that has only ever been counted into, that is the same
number as the running slot total it replaced.

`generation`, `restartedAt` and `exposuresSinceRestart` name the ACCUMULATION generation these counters
belong to. `generation` is a string over the accumulation half only — schema, objective, reward and the
decay horizon — with the restart moment appended once the counters have actually been restarted; it is
not the numeric recovery generation of the statistics object's own fence. Changing an estimator or
presentation dial (`n0`, `nMin`, `liftMin`, `liftMax`) keeps the counters and keeps this name, because it
reinterprets nothing. Changing what a counter MEANS cannot happen on an ordinary write at all: the
statistics object answers 409 `statistics configuration incompatible` and stores nothing, and the one
authorized way past it is `POST /v1/{tenant}/learn/generation`, which starts a fresh generation instead of
reinterpreting or silently keeping what was counted before. `restartedAt` is when the generation started —
the moment of that transition, or the counters' own earliest evidence for a generation never restarted —
and `exposuresSinceRestart` is what it has counted since. Absent on a snapshot archived before they existed.

`rebuiltFrom` is present only on a slot whose counters were started again by a repair, and names that
repair: `{ basis, operationId, at, generation, date? }`. `basis` is `explicit-reset` when a tenant admin
discarded damaged counters with `intent:reset` on `POST /v1/{tenant}/learn/recovery`, and
`ledger-rebuild` when an operator folded them again from one retained day with `rebuildFrom` on
`POST /v1/{tenant}/learn/generation`; `date` is that day, and only a `ledger-rebuild` carries it.
`operationId` is the audited operation that did it, `at` its moment in milliseconds, and `generation`
the numeric recovery generation of the statistics object it moved to — not the string `generation`
above. A snapshot that names a basis holds only what was admitted since that repair (for a
`ledger-rebuild`, that day's fold and what was admitted since), never the tenant's whole history. The
basis stays with the object: a later wholesale reset of its counters keeps it unchanged, because what is
counted afterwards still stands on that repair, and only a later explicit reset or ledger rebuild
replaces it with its own. A generation transition without `rebuildFrom` discards the counters and names
no basis; that snapshot says when learning restarted through `restartedAt` instead. A slot that was never
repaired carries no `rebuiltFrom`.

`attributionContract` is the one named, versioned attribution contract every path that reports
attribution now carries — this snapshot, the day report and the window report — so two numbers can be
read against each other or seen not to be comparable:
`{ name: "attribution", version, history: { scope, match, credit }, windowsMs, appliedWindowsMs }`.
`windowsMs` is per reward what YOUR PUBLISHED learn document asks for. `appliedWindowsMs` is per reward
the horizon the path that produced these numbers could actually read, and is never larger: the online
snapshot applies the visitor's ring horizon of seven days, a day report built from the hour aggregates
applies the least `horizonMs` of the hours it summed (48 hours by default), and a day report
recomputed from the day's records applies the one day it read. The two maps differ on purpose — a
seven-day purchase window against a 48-hour batch horizon is a credit the engine learns from and the
batch report cannot show — and stating both is how that difference is visible rather than hidden
behind one label. A report stored under an earlier `version` is read as such and is never pooled with
a later one: the window reports `mixed_basis` for every slot instead of adding the two together.
Absent on an archive or a report written before the contract existed.

## The day report

`POST /v1/{tenant}/learn/report`. `{ tenant, brand, date, builtAt, counts: { decisions, outcomes,
visitors, truncated, duplicates?, conflicts? }, attributionContract, policies: [ { name, policy, role, credits } ], grids: { [slot]: { [policy]: a lift
snapshot built from that day alone } }, exploration: [ { slot, decisions, explored, realized, configured,
mode, configuredMode?, unsupported? } ], holdout: { [slot]: [ { arm, decisions, credited, rate } ] }, armVisitors, allocation,
visitorOutcomes, provenance }`.

`provenance` is `{ version: 1, status, policies }`: the identity of the policies that produced the stored
day. `policies` is the ordered list of policy names its numbers were computed under — `learning` and the
preset overlays for a canonical day. `status` is `canonical` where a canonical writer published it,
`repaired` where the repair-or-declare path replaced a day a custom overlay had overwritten with the day
the canonical writer computes from the retained sources, and `declared` where that path found such a day
with its sources gone and kept it with the numbers it held, `policies` then naming the overlay that
produced them. GET answers `provenance: null` for a day that records none — one written before the member
existed — and such a day is unknown, never taken for a canonical one. A response-only overlay result from
`POST` with `policies` carries no `provenance`, because it is never stored.

A canonical day is stored only by a conditional write. Before a writer reads any source — the date's
hour aggregates, or the ledger it falls back to — it notes the stored day's R2 etag, or that none is
stored; its put succeeds only if that is still so. A day another writer stored after the note therefore
stands, and the refused writer stores nothing: the `POST` without `policies` still answers 200
`{ ok: true, report }` with the day it computed, which is not stored, while `GET` answers the day that
stands; the nightly job resolves with the day it computed and logs its usual counts line, with
nothing recording the refusal; the five-minute job reports the date in `reports.failed` with the error
`day report superseded by a concurrent publication` and checks the date again on its next run. A
refused write can leave in place a day computed from an earlier read of the sources until the date is
published again.

An `exploration` row states the mode the engine RAN. Where the slot's retained document names a mode
the engine will not run (Thompson is withdrawn), `mode` is `off`, `configured` is `null`, and
`configuredMode` with `unsupported: true` name the stored setting — the same two members
`GET learn/exploring` answers with, so no reader sees a configured share for a policy that cannot
explore. A supported mode carries neither member. `explored` counts every decision the rule made,
including one whose draw agreed with the ranking's own leader.

`armVisitors` is `{ version, basis: "distinct_visitors", arms: [ { arm, visitors } ] }`: the per-arm
DENOMINATORS in distinct visitors, which the decision counts are not. Its `arm` is the experimental
ASSIGNMENT wherever the day's records carry one, so an `ineligible` row stands on its own and is never
pooled into `default`, and a record written before the provenance block existed is read by the arm it
was served under. It is `null` on a day written before the field existed — never zero, and never
re-derived from the decision counts the day does hold. `allocation` is
`{ version, source: "published", share, arms }`, the allocation the day was served under, so sample
sufficiency is computable on your side under your own protocol. `visitorOutcomes` is
`{ version, basis: "enrolled_visitors", arms: [ { arm, visitors, byType } ] }`: distinct visitors on each
assignment with at least one outcome of each reward type, counted by the assignment the visitor held
when the outcome happened and not by whether a served piece matched — two purchases by one visitor are
one purchasing visitor, and one purchase is counted on exactly one row. The window report carries an
`armVisitors` on the `visitor_days` basis (the per-day distinct counts summed), `null` when any pooled
day predates it, and the same `attributionContract`, whose `appliedWindowsMs` is the least any pooled
day applied. The window report carries `allocation`, the published allocation every pooled day agrees on, `null` when a pooled day carries none or two disagree; two pooled days with different allocations are a mixed basis, reported as the reason `mixed_allocation` with its days and no pooled arms. A pooled day whose `provenance.status` is `declared` is withheld the same way, with the reason `declared_day` and status `unknown` (`mixed` where a mixed reason also applies): its numbers are an overlay's and are never pooled as canonical.
Each compatible slot also carries `computation`, the recorded basis it pooled under: `{ version, profile, learning,
reward, objective, tauLearnMs, measurementBasis }`, and `null` where the slot is not compatible.
No report of ours states a business target, a lift or a standing.

`coverage.unassignedHours` is `number[] | null` and names the source limitation behind those two
`null`s on a day summed from hour aggregates: `[]` when every built hour can say the experimental
assignment, the hours that cannot, and `null` when the stored report does not record the member at
all. An hour folded before this release carries no assignment: that day's rows are grouped by the arm
SERVED, as they always were, and its `armVisitors` and `visitorOutcomes` are `null` rather than a
number the source cannot support. An outcome whose visitor had no decision that day at or before it,
nor later in its hour, is counted under the visitor's first decision of the day, and that decision may
be in a later hour: the fold remembers the outcome, and once a fold has carried the visitor into the
day the outcome counts under the assignment of her earliest decision — never under the outcome's own
`experiment` stamp — for as long as it precedes that decision, so the day answers `visitorOutcomes`
exactly as the day computed from its records does, and an outcome whose visitor has no decision that
day is counted on no row by either. Every fold of an hour decides that hour's outcomes afresh and
replaces what an earlier fold of it decided, so an earlier decision that reaches the ledger late
moves an outcome to its row and never leaves it on two. Each hour aggregate counts an outcome only
through the hour that decides its row — the outcome's own hour, or for a remembered outcome the hour
of the visitor's earliest decision — so an earlier hour folded again between a placement and the
fold that moves it never keeps the old row, whatever order the hours are folded in. An hour whose
aggregate was written before an earlier hour of its date was last folded is named until the job
folds it again, because that fold may have moved or decided a row it counts. An hour is also named while an outcome it
remembered can no longer be placed from memory — a later fold found a decision of the visitor's at or
before it, as when an earlier hour is folded out of order — until that hour is folded again. An hour IS named when it holds an outcome whose visitor did
have a decision that day at or before it that the fold's attribution ring no longer holds — the ring
cap or the horizon evicted it — or whose earliest decision of the day the fold cannot date, because
the assignment she held when the outcome happened cannot then be known: that day keeps its rows and
`armVisitors` and answers `visitorOutcomes: null` rather than count the outcome on a row she may not
have held. An hour folded before this release remembered no outcome and is still named for every
outcome it could not place.

`coverage` says the same kind of thing about the HOURS a day was summed from, and every member below
is additive and optional: a report written before this release carries none of them and is still read
as recorded. The top-level `coverage.maturity` still reads `unknown`, and it is the LEGACY field about
outcome maturity, kept so a report already written before this release still reads; it is not a
statement that the platform cannot say what an hour is.

`refoldHorizonMs` is the published re-fold horizon the day was built under, measured from each hour's
own END. `maturities` is `[ { hour, maturity } ]` per built hour: `open` while the hour is inside that
horizon and its ledger prefix is still re-checked, `final` past it, and `repaired` where the hour's
aggregate was WRITTEN after it became final — a rebuild asked for at a higher object cap, a re-fold
because an earlier hour was folded after it, or a first fold that reached the hour late. A final hour
is folded again only for those two reasons, never for a late row. An hour is in exactly one of the three, so a repair can never quietly
replace numbers you have already read as final. `lateAfterMaturity` is `[ { hour, objects } ]`: ledger
objects that reached an hour's prefix after that hour was final. They are counted and named and applied
nowhere, and the rows stay in the ledger — this is a declaration about what the numbers include, not an
age cutoff that discards late data. `carryInHours` is `[ { hour, evicted, unplaced } ]`: the outcomes of
each built hour whose earlier decisions the fold could not reach — `evicted` where the visitor's
attribution ring held its full capacity at the moment the outcome was attributed and nothing was
credited, so a decision the cap or the horizon removed may be the one that would have been, and
`unplaced` where no decision of the visitor's own date could be found for the outcome when its hour
was folded — a later hour's fold may still place it on her first decision of the day, or it is one of
the outcomes `coverage.unassignedHours` names. Neither is a claim that a credit was owed; a day with
any `unplaced` reports `status: "incomplete"`, because that hour's own fold could not complete the
visitor-level count and only a later hour, or nothing, completes it. `objectScan` is `[ { hour, objects, read } ]`: how many
ledger objects each built hour holds and how many the fold really OPENED, so the object-scan cap is
visible where an hour hit it and the hours beside it report what they really read. `recoveryFromMs` is
the migration bound — the earliest hour a repair can still put into the batch rings, because a
version-1 shard state remembers only a high-water mark and recovery therefore begins at the first
version-2 fold and no further back; `0` where no shard imposes one.

`counts.conflicts` is `{ decisions, outcomes }`, rows excluded because two genuinely different rows
share one logical id and an operator surface has already filed that conflict. It is now carried on a
day built from the hour aggregates as well as on one recomputed from the day's records, and it is
omitted — never published as a zero — when there is no collision, exactly as `counts.duplicates` is.

Ledger rows are delivered AT LEAST ONCE. `decision_id` and `outcome_id` are the dedup keys, on every
read here and in your own warehouse: the same logical row may reach the partition more than once, and
every read above yields it once. `counts.duplicates` is `{ decisions, outcomes }` — the copies the read
dropped, so the rate is a number instead of a silence. An outcome minted before the per-event nonce
existed carries a timestamp-derived id that two genuinely distinct events can share; such legacy rows
are OUTSIDE the redelivery guarantee and are never deduplicated, online or on a read. Two genuinely
DIFFERENT rows under one logical id are never merged, and this collision contract is the same on every
surface. The online statistics credit EACH of two different records under one stable `outcome_id`:
only the same record redelivered is credited once, and a delivery whose record digest cannot be
computed is recognised by its id alone, so it can lose a credit it cannot tell apart and never grants
one twice. The ledger read refuses the day of the brand the collision touches, and only that brand's
day — another brand of the same tenant is still answered — and names the collision
(`{ ok: false, code: "report_row_conflict", conflict: { stream, id } }`, HTTP 409), files it for
recovery in your tenant's own scope, and reads again on the next call with that row excluded and
counted in `counts.conflicts`, in the same `{ decisions, outcomes }` vocabulary as `counts.duplicates`. Where
both records were credited online, the online store then holds more credits than that day for the
brand and slot, by design: once the difference exceeds its threshold, the scheduled reconciliation on
`/v1/{tenant}/monitor` shows the pair as a disagreement carrying `conflicts: { decisions, outcomes }`,
the day's `counts.conflicts` copied onto the row. The credits of the filed records are the designed
outcome, not a lost credit. `conflicts` proves only that a collision is on record for the brand's day:
it is the brand's count for the day, not the slot's, and it rides every row of the brand whose online
side exceeds its ledger side, so it cannot tell the collision from a credit the ledger lost on the same
brand and day, including on a row whose whole difference is a lost credit. It is never a reason to
dismiss a difference: the collision accounts only for the credits of the rows filed as conflicts, and
no other part of the difference is explained by it. A row without `conflicts` names no collision.

Aggregates only; no visitor id
in it. Current `computation.version` is4 with per-slot measurement basis; retained1–3 stay historical. Incompatible policy/basis/version counters cannot pool. Money objectives use configured value units (margin uses the supplied margin only), not currency conversion or probability.

## Device and recency

Two parts of a shopper's arrival are first-paint context on both shopper hosts, read with no setting:

| Member | Values | Read from |
|---|---|---|
| `device` | `mobile`, `desktop` | The request's client hint `Sec-CH-UA-Mobile` when present (`?1` mobile, `?0` desktop), else its user agent: a phone (an iPhone, an Android user agent carrying `Mobile`) is mobile, a tablet (an iPad, an Android user agent without `Mobile`) counts as desktop, and so does every other browser. A request carrying neither the hint nor a browser's user agent has no device, never a guess; the user agent itself is never kept |
| `recency` | `same_day`, `within_7_days`, `8_to_30_days`, `30_and_more` | The whole days from the start of the shopper's stored last visit to the moment the visit opens: under 1, 1 to 7, 8 to fewer than 30, 30 or more. A first visit has no recency. A shopper record on the session host expires 30 days after its last write, so a return after 30 days or more there is a first visit |

The event that opens a visit records both on the visit, each only when there is one, inside the shopper's
existing record (`metadata.device` and `metadata.recency` on the session host, `device` and `recency` on the
shopper object's pipeline record), and keeps them for the visit; no other event and no read changes them.
`GET /realtime/reflex` answers them as `arrival: { device?, recency? }` beside `visit`: the device and the
recency the visit records, a member only when there is one, `{}` when there is neither, and for a visit that would
open now the recency its stored last visit gives it. `arrival` is null exactly where `visit` is, and `visit` keeps
its shape. As seed-signal keys `device` and `recency` are read by a decision from the snapshot request's own device
and the visit's recency ([contextual seed rules](#contextual-seed-rules)); as a term of a per-context order's
context, `device` sits beside `channel` and `visitBuckets` ([per-context orders](#per-context-orders)). The decision
cell, its grammar and the learning ladder do not change: neither is a learning-cell level.

## Gate dimensions

The reflex registry document (`PUT /config/reflex`) carries the optional member `gateDimensions`: tag dimensions
registered as gates, such as `locale` (a record's market and language) and `journeyStage` (`post_purchase`, content
made for after an order). A gate is known to the catalogue, so a tag on it raises no `unknown_dimension`, and it is
never learned: no event, content engagement or module engagement builds an interest on it, and its values never count
as registered tags for `no_nonempty_registered_tags`. It gates as any tag does (a slot's `excludedTags`, an approved
vocabulary). Publication refuses with `422`, naming `gateDimensions`, a list that is not 1 to 64 distinct keys of 1 to
64 characters (no surrounding space, none of `:` `;` `|`), or a key the registry's `dimensions` also learn: a dimension
is learned or a gate, never both. A `PATCH` replaces the list whole. The demo's starting registry registers
`journeyStage` and `locale`; a stored registry carries only the gates it names.

## Negative preference: suppression with an expiry

The reflex registry document (`PUT /config/reflex`) carries the optional member `suppression`
([negative preference](./02-api-reference.md#negative-preference-suppression-with-an-expiry)):

```json
{ "suppression": { "actions": { "remove_from_cart": { "days": 30 } }, "purchase": { "days": 30 } } }
```

| Member | Meaning |
|---|---|
| `suppression.actions` | `{ <action>: { days? } }`: each named action (`remove_from_cart`, sent as `custom` with `data.event`) suppresses, for the shopper, every registry value it carries for its window in `days`, counted from the action. It weighs what the registry weighs it (0 for `remove_from_cart` unless a weight is published), so it builds no interest and is no signal for the signal floor |
| `suppression.purchase` | `{ days? }`: present, the purchase rule is active. A purchase (`purchase`, `checkout`, `order_complete`) strengthens every value it carries at the purchase weight as before, its `style`, `collection`, `color` and `priceBand` among them, and suppresses the value it carries on the dimension keyed `productType` for its window; a second purchase of one `orderId` is dropped before the rule |
| `days` | A positive whole number of days, at most 36500; absent, the default of 30 days for the suppression. Anything else (0, a negative, a fraction, text) refuses the write with `422`, naming `suppression` and `days` |

While a suppression is in force the suppressed value contributes no interest term to the content decision
(the stored interest is not changed, the piece stays eligible, the seed rules, the population priors, the
anchor's `complements` bonus and configured orders apply as before), and at its `expiresAt` it lapses. The
shopper's reflex state holds them as `suppressions: [{ action, dimension, expiresAt, value }]`, written only when
one is recorded; per dimension and value the later `expiresAt` stands with its action, on a second action and
across an identity link alike (on an equal expiry the signed-in shopper's own is kept). Every record of a slot
that read the shopper's interests while one was in force carries `explain.suppressions: [{ action, dimension, expiresAt, value }]`
and its receipt `suppressions` with a `why` sentence naming each value, its action and its expiry date; both are
compared in replay. A tenant without the member decides exactly as before.

The buffered door (`"processing": "buffered"`) and the history import (`POST /v1/{tenant}/identity/events`) count a
window from the event's own time, not its arrival: a buffered or imported purchase under the purchase rule suppresses
the bought `productType` until `expiresAt` = its own time plus the purchase window, a buffered `remove_from_cart`
records one suppression per registry value it carries the same way (weight 0, no interest, no signal), and an event
older than its window suppresses nothing. Every other weight-0 buffered action is dropped as before, and the import
skips weight-0 rows, so an imported `remove_from_cart` records nothing.

## Action weights per product type

The reflex registry document (`PUT /config/reflex`) carries the optional member `productTypeWeights`, an
action's weight per product type on one dimension the registry declares
([product-type weights](./02-api-reference.md#action-weights-per-product-type-producttypeweights)):

```json
{ "productTypeWeights": { "dimension": "category", "weights": { "add_to_cart": { "Handbags": 8, "Accessories": 1 } } } }
```

| Member | Meaning |
|---|---|
| `productTypeWeights.dimension` | The key of one dimension the registry declares, not a derived band. An event's product type is the value it carries on that dimension's source field, as written (not slugged or case-folded), admitted as every event attribute is; a held catalogue product's own value is not read |
| `productTypeWeights.weights` | `{ <action>: { <product type>: <weight> } }`: each product-type weight is a number from 0 to 1000, the points an event of that action on that product type adds to every interest it touches in place of the action's own weight |

An event on another product type, or with no value on the dimension, adds the action's own weight, exactly as
before. Publication refuses with `422`, naming `productTypeWeights`, a product-type weight outside 0 to 1000 or
written as text, a `dimension` the registry does not declare or that is a derived band, any other member, and an
action or product type no event can carry (the API reference lists them). The population trend the event feeds
(its regional and arrival-context counts) keeps the action's own weight, and the signal floor reads the action's
own weight, so a product-type weight scales the shopper's interest update and nothing else.

The interest update an event returns on both hosts, and the socket frame that carries it, itemise the weight it
applied as `affinity.applied: { action, dimension, productType, weight }`:

| Member | Meaning |
|---|---|
| `action` | The event's action |
| `dimension` | `productTypeWeights.dimension` |
| `productType` | The value the event carries on that dimension, or null when it carries none |
| `weight` | The weight the event added to each interest it touched: the product-type weight, or the action's own |

`affinity.applied` is present only while the registry declares `productTypeWeights`; a registry without the
member answers, pushes and stores exactly what it did before. The shopper's stored reflex state is unchanged in
shape: it holds the accumulated interest, never the weight that built it.

## The account identifier format and the identifier change

The reflex registry document (`PUT /config/reflex`) carries the optional member `accountIdFormat`, the forms the
tenant's account identifier takes ([identifier changes](./02-api-reference.md#account-identifier-format-and-identifier-changes)):

```json
{ "accountIdFormat": { "firstLanding": "^fl1\\.[0-9a-f]{32}$", "hashedEmail": "^[0-9a-f]{64}$" } }
```

| Member | Meaning |
|---|---|
| `accountIdFormat.firstLanding` | The source of a regular expression, anchored with `^` and `$`, for the identifier the site assigns at a shopper's first landing |
| `accountIdFormat.hashedEmail` | The same for the identifier the site derives from the shopper's e-mail address (a hash of it) |

At least one form is declared and no other member is admitted. Publication refuses with `422`, naming
`accountIdFormat`, a value that is not an object, one that declares no form, an unknown form, a pattern that does
not compile and a pattern not anchored at both ends. With a format declared, a link whose own `accountId` matches
none of the declared forms whole is refused with `400`, naming `accountIdFormat`; a tenant without the member links
any identifier exactly as before.

The link body (`POST /v1/{tenant}/identity/link`) may carry the identifier-change statement:

| Member | Meaning |
|---|---|
| `accountChange.from` | The earlier account identifier, 1 to 200 characters on one line, never the link's own `accountId` |
| `accountChange.exp` | Unix seconds the statement expires: in the future and at most 24 hours ahead |
| `accountChange.statement` | HMAC-SHA256, base64url, keyed by the tenant's identity secret, over `<tenant>\naccount-change\n<from>\n<to>\n<exp>`, `to` being the link's own `accountId` |

The site's backend signs the accountChange statement over both identifiers, from and to, and the two accounts'
profiles merge only when it verifies: the earlier account's profile is added to the later account's, never
overriding either, each history decayed by its age so recent behaviour outranks both. A statement that is missing,
names another pair, is signed with a secret the tenant does not hold, has expired or expires more than 24 hours
ahead is refused with `401`, naming the account change, and merges nothing. The later account's identity record
keeps `mergedAccounts`, the shopper ids of the accounts merged into it (salted ids only, written only when a change
merges, at most 50, erased with the person), so a statement presented again merges nothing more; an identifier
change stores no account identifier, and the hydrate and the decision records carry nothing new.

## The ODP writes and the second identifier

The tenant's ODP connector configuration (`TENANT_CONNECTORS`, its `odp` object) may name one more ODP identifier
field ([API reference](./02-api-reference.md#the-second-odp-identifier-odpsecondidentifier)):

```json
{ "odp": { "apiHost": "https://…", "publicKeyRef": "CONNECTOR_SECRET_…", "identityNamespace": "…",
  "actions": { … }, "audiences": { … }, "profile": { … }, "secondIdentifier": "hashed_customer_id" } }
```

| Member | Meaning |
|---|---|
| `odp.secondIdentifier` | Optional. An identifier field your ODP already defines: a letter, then up to 95 letters, digits and underscores; never `vuid`, never one of the `odp.profile` fields. Any other value makes the connector configuration invalid |
| `odpIdentifier` (the person's identity record) | Kept only while the setting is configured at a verified sign-in and under the person's tracking consent: the link's own `accountId`. Erased with the record, and never answered by the operator reads, the export or the link answer |

`secondIdentifier` is written beside the vuid only when the setting is configured and the person's record holds
the hashed account identifier of the person's verified sign-in. The engine's ODP writes then take these shapes,
from both hosts; the event is sent under tracking consent and the profile upsert under personalization consent:

```json
POST /v3/events
{ "type": "<type>", "action": "<action>", "data": { "<mapped field>": "<value>" },
  "identifiers": { "vuid": "<vuid>", "<secondIdentifier>": "<account identifier>" } }

POST /v3/profiles
[ { "attributes": { "vuid": "<vuid>", "<secondIdentifier>": "<account identifier>", "<profile field>": "<value>" } } ]
```

Without the setting, or for a shopper whose record holds no account identifier, every write is exactly what it
was: `identifiers: { vuid }` on an event and `attributes: { vuid, …the profile fields in their order }` on a
profile upsert. The audience read (`POST /v3/graphql`, `customer(vuid)`) is the same with or without the setting.
The engine creates nothing in ODP: no field, segment or audience, and no endpoint beyond these three. The
page-side path writes nothing to ODP at all: the page passes the engine's segments and interest values (an
update's `segments` and `affinity.dims`) to the experimentation user context as attributes
([Integration guide](./01-integration-guide.md#your-experiments-and-the-engines-audiences-the-second-odp-identifier)).

## The interest hydrate's restoration provenance

`GET /realtime/reflex` answers `affinity: { dims, audiences, odpConfirmed[], restoration? }` on both
hosts. `restoration` is the outcome of the latest restoration attempt from your ODP profile recorded
on the interests a signed-in shopper holds, described in the API reference (Identity, "Interest
restoration from ODP"). Every sign-in makes one attempt, at her first event under personalization
after it; until then `restoration` is absent or still the outcome of an earlier sign-in's attempt:

| Member | Meaning |
|---|---|
| `source` | Always `"odp"` |
| `status` | `restored`: her mapped interests were restored, merged into the interests she already held. `cold`: nothing was restored, and what she holds is unchanged |
| `observedAt` | With `restored`: ODP's `last_modified_at` for the profile, in epoch milliseconds. The restored interests decay from this instant |
| `reason` | With `cold`: `cold` (no interest recorded), `missing` (no profile), `malformed` (a mapped value or the observation time is unusable), `unavailable` (a read failed; retried once in each later visit), `erased` (she has been erased: nothing is restored from ODP and her profile is not read, whatever its timestamp) or `expired` (older than your profile retention) |

The provider's own attribute values are never echoed. Labels (`{ dimension }`, `{ journey: true }`
and ODP audiences) never appear in `dims` because of a restoration.

## Socket frames

| Frame | Body |
|---|---|
| `connected` | `{ connectionId, userId, timestamp }` |
| `personalization_update` | `{ userId, timestamp, data: { segments[], decisions{}, featureVariables{}, recommendations[], sortOrder[], journeyStage, affinity: { dims, audiences, changed[], odpConfirmed[], applied? } } }`. `applied` itemises the action, the product type and the weight the event applied, only while the registry declares `productTypeWeights` (Action weights per product type, above). `journeyStage` is one of `exploring`, `thinking`, `deciding`: the stage of the shopper's CURRENT VISIT, derived from the visit's own counters against the `journey` thresholds published on your reflex configuration document. It starts again at `exploring` in a new visit and after the purchase that reached `deciding`. With no `journey` block published the engine's compiled default decides (`thinking` at the third interaction of the visit, `deciding` at the first purchase), so the stage still moves and the pooled learning key still spreads across `s=early`, `s=mid` and `s=late` rather than collapsing onto `s=early`; `sources.journey` on a decision names that default and its `revision: 0`. |
| `segment_update` | The same shape, on a membership change alone |
| `content_decisions` | Sent by the engine for the open page view whenever its decisions differ from what the page view last received (never the answer to the page's own request; never without personalization consent). A decision set exactly as the snapshot route answers it: `{ page, pageInstance, arm, versions, config_label, decisions[], ts }` |
| `audience_published` | `{ userId, data: { timestamp, source, audienceWentLive: { key, name } } }` |
| `odp_receipt` | `{ userId, data: { receiptId, status, ts, source } }`: the customer data platform's answer to a forwarded event |
