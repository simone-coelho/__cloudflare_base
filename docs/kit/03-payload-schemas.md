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
| `purchase` | `orderId`, `value`, `currency`, `items[]` of `{ productId, quantity, price }` |
| `content_impression` | Authenticated renderer admission: `contentId`, `slot`, `decisionId`, `renderOffer`, `page`, `pageInstance`, `position` (the page-wide order) and `slotPosition` (the position within the slot, from 0, which the SDK sends and admission then holds to the record's position; without it `position` is held to it); original event nonce/time are mandatory. On a marked module container it is the module's impression, once per page instance. A `content_impression` is **not a learning input today**: it carries no reward, so it produces no outcome record and credits nothing. What the learning loop counts is the slot's declared exposure unit — the served decision under `served-v1`, or the durably admitted render under `rendered-v1` — never a viewable impression |
| `content_click`, `video_complete` | `contentId`, `slot`, original acknowledged `decisionId`; optional `customerContentId` and `contentType`; from the SDK, `slotPosition`, the acknowledged placement's position within the slot, when its decision named one. A `content_click` is also a module engagement: a click inside a marked module container, or an interaction it declares in `data-op-engage`, named as `interaction` |
| `content_dwell` | the same, plus `ms`, milliseconds on screen |
| `custom` | `event`, the real name, plus anything |

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

One item in snapshot `decisions[]`; the set carries its original `pageInstance`. `content_decisions` is a client-compatible historical frame, not a production delivery promise.

| Field | Meaning |
|---|---|
| `contentId` | Our id for the piece |
| `decisionId`, `renderOffer` | Exact original receipt carrier and opaque authenticated offer when tracked/rendered-v1; receiving them proves no rendering or admission |
| `customerContentId` | Your id for the piece; what you render by |
| `type` | The piece's kind: `editorial`, `guide`, `film`, `lookbook`, `campaign`, or your own |
| `slot` | The slot on the page |
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
| `identity_anchor` | `visitor` when the state hung on the durable id, `session` when only a session was available, `none` when no state could be read |
| `ts` | Original server decision time; never rewritten to render/replay time |
| `experiment` | `{ id, saltVersion, arm, anchorGeneration, reason? }`: the experiment this record's arm belongs to, as the decision path answered it. `id` is `{tenant}:{brand}:{salt}`, so rotating the published salt starts a new experiment instead of re-randomising the running one; `saltVersion` counts the distinct salts this tenant has published up to the pinned revision, and is `null` where the published history the platform can read does not reach the first one. `anchorGeneration` is the generation of the shopper's persistent enrollment anchor. Written by the producer and delivered unchanged — never re-derived later from a then-current document. `arm` here is the ASSIGNMENT (`personalized`, `default`, `no_learning`, or `ineligible` for a shopper who never consented to personalization and so was never drawn), which is not the same field as the record's own `arm`, the experience served. `reason` says why an assignment is `ineligible` — `personalization_consent` when she has not consented to personalization, `anchor_unavailable` when her enrollment anchor could not be read at that moment — and is absent on a randomised assignment. Absent on records written before enrollment was persistent |
| `measurementBasis` | `served-v1` (also absent legacy metadata) or `rendered-v1`; incompatible counts are not pooled |
| `rendered` | Rendered-v1 only: `{version:1,eventId,at,pageInstance}` from the original durably admitted renderer signal, not proof of human visibility |
| `page`, `slot`, `position` | Where it was served, and the rank inside the slot |
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
| `explain.exploration` | When `explored`: `mode`, `reason`, `bucket`; retained historical Thompson receipts can include `sample` (Thompson is no longer writable or live) |
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
| `explain.signalFloor` | This position's slot was decided on context alone because the shopper was below its signal floor: `{ floor, signals }`, keys sorted, the floor in force (the slot's own, else the tenant's; a whole number or `never`) and the shopper's count of signals. Present on every record of such a slot and on no other, and compared by value in replay; the shopper's receipt carries the same block and says it in words ([the signal floor](#the-signal-floor)) |
| `explain.moduleRule` | A position pin or an off-limits mark of the layout slot placed this module: `{ position, rule }`, keys sorted, `rule` `pinned` (the module pinned at a position, served there) or `off_limits` (the off-limits module held at its baseline position), and `position` the position the rule set, counted from 1. Present only on such a record, whose authority is `pin`, and compared by value in replay; the shopper's receipt carries the same block as `moduleRule` and says the rule and the position in words ([position pins and off-limits modules](#position-pins-and-off-limits-modules)) |
| `explain.layoutReason` | The layout reason of the page's declared layout slot: `{ cause, slot, status }` (with `n` and `nMin` for the cause `no_level_reached_nmin`) when the served order is unchanged against the slot's baseline, or `{ moves, slot, status }` when it changed, each move `{ from, module, term, to }`; keys sorted. The same value on every record of the slot and on the decision set, present only on a declared layout slot's records, and compared by value in replay; the shopper's receipt carries it as `layoutReason` and says it in words ([the layout reason](#the-layout-reason)) |
| `inputs` | The interest vector as scored, the regional shares, the context prior's shares (`context_share`, keys sorted), your model's scores and the served counts the fatigue term read, when they applied: what makes a replay exact. Where a population prior applied and the page's declared layout slot ranked above the signal floor, `prior_lambda: { context?, regional? }` (keys sorted) states each prior's weight λ, so the layout reason replays exactly from any record of the page. `inputs.replay` is the page manifest the REST reference describes. `inputs.explorationRules` sits beside it, never inside it: `"recorded-draws-v1"` names the exploration rules the decision was made under — a draw inside the configured share is `explored` even where it agreed with the ranking's own leader, `candidates` is the top candidates by score before the explored piece moved with that piece beside them, and an item under a merchandiser `reject` or `freeze` is never explored. Every record whose decision had the learning layer carries it (without that layer no exploration rule runs). A record without it was written before those rules and replays under the rules it was written with; a present value this build does not implement refuses the replay |

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
| `level`, `level_words` | Which cell answered, from `everyone` to `channel, visit bucket, region and affinity cell`: the finest level with enough evidence |
| `γ` (`gamma`) | The trust dial per slot, 0 to 1: how much the lift moves the score |
| `prior` | `{ p, n }` when an imported prior was in force for the item |

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

## The outcome record

One per reward-bearing event, written after the response.

| Field | Meaning |
|---|---|
| `outcome_id` | `{tenant}:{time in base 36}:{visitor}:{event}` |
| `type` | The reward type the event maps to |
| `event` | The wire event name, so a custom reward keeps its own |
| `item_id`, `slot` | The content id and slot the event named, when it did |
| `position` | The position within `slot` the event named as `slotPosition` (a module engagement names its module's), a whole number from 0; absent when the event named none, and on every outcome recorded before it was carried, which reads as not stated, never as position 0 |
| `decision_id` | The acknowledged decision the event named (`decisionId`), when it did |
| `value`, `currency` | For a purchase |
| `margin` | The margin the event carried (`margin`, or the items' margins times quantity summed), for a slot that learns margin; null when none |
| `products` | The products the event named (`productId`, `sku`, or each of `items[].id`); a purchase credits the content that featured one of them |
| `session_id`, `visitor_id`, `brand`, `arm`, `ts` | As on the decision |
| `experiment` | `{ id, saltVersion, arm, anchorGeneration, reason? }`: the experiment this outcome's VISITOR is enrolled in, resolved from her persistent enrollment anchor when the outcome was recorded, so an outcome is attributable to her assignment whether or not a served piece matched it. The producer stamps the outcome with the visitor’s enrollment and her consent at the moment it is recorded, so an outcome recorded while personalization is off says `ineligible`; an outcome recorded on a path that does not stamp carries no block at all. `reason` says why: `personalization_consent`, or `anchor_unavailable` when her enrollment anchor could not be read at that moment. `saltVersion` is `null` where the published history the platform can read does not reach the first salt. Absent on records written before enrollment was persistent, and on a visitor whose enrollment could not be resolved |

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
| `eligibleWhen` | no | The piece's targeting rule, `{ regions?, context? }`, naming at least one of them. `regions` lists 1 to 64 region keys such as `US` or `US-WA` (stored upper case): a key matches the shopper's region exactly, and a country key also admits every region inside it (`US` admits `US-WA`, never the reverse). The shopper's region is the one the request asserts as `ctx.region`, else the edge's, and only under tracking consent. `context` maps 1 to 8 signal names (a letter, then letters, digits or `_`, 32 characters at most) to 1 to 32 accepted values of at most 64 characters; the request supplies a signal as `ctx.<name>=<value>` on the snapshot's query string. Fails closed: a piece whose rule the request cannot satisfy (no region known, a signal absent or with another value) does not exist for that decision, exactly as outside its window, and a piece without the field is unaffected. An unknown member, or a bound exceeded, refuses the publication. In CSV: a quoted JSON object, as `merchandising`, for example `"{""regions"":[""US-NY""]}"` |
| `art`, `renderUrl` | no | Image, and a URL your page may render by |
| `merchandising` | no | `{ season, promotion, margin }`, each 0 to 1 including zero: the item's own signals for the multipliers. CSV uses a quoted JSON object, for example `"{""promotion"":1,""margin"":0}"` |
| `journeyStageFit` | no | The stages the piece is made for: `exploring`, `considering`, `deciding` (your `journey_stage_fit`; `explore`, `consider`, `decide` and `early`, `mid`, `late` also accepted). Absent fits every stage. A slot's `stage` rule demotes a piece outside the shopper's stage |
| `freshnessDate` | no | When the piece became current, ISO 8601 (your `freshness_date`). A slot's `freshness` rule ages from it; absent, from `window.from` |
| `featuredProductIds` | no | The products the piece features, in your product ids (your `featured_product_ids`). Carried and validated, never rewritten. They link, attribute and recognize, and nothing more: the decision receipt names them, an outcome naming one credits the decision that served the piece, and a product event naming one is recognized. The piece inherits no attribute of a product it features — no tag, merchandising value, stock flag or affinity — and no ranking reads those products' attributes |
| `complements` | no | The products the piece completes, in your product ids, validated as `featuredProductIds` is (trimmed, de-duplicated, empty entries dropped; an empty list is none). A slot whose `complements: { weight }` rule (0 to 1) is in force adds that weight to the base score of a piece that completes the anchor product the request names as `ctx.anchor=<product id>` on the snapshot's query string, and the receipt names it as a `completes` driver. A request that names no anchor prefers nothing, and the holdout's default arm never does. In CSV: a `|` list, as `featuredProductIds` |
| `inStock` | no | Your catalog's stock flag. `false` removes the piece from every decision; absent means in stock. In a feed, `in_stock` or `ats` (Y/N, 0/1, true/false) is read the same way |

Import/pull `merge` is a partial upsert by `id`: omitted supported fields preserve the existing item,
including its customer ID, tags, lifecycle, stock and merchandising. Existing order is retained; new
IDs append. New items and `replace` imports require valid complete items; only there do omitted
customer IDs default to `id`, tags to `{}`, and lifecycle to `live`. Catalog PUT remains full replace.
CSV blank cells mean omitted, not cleared. Supplied canonical fields take precedence over aliases,
including malformed values: JSON nulls refuse except the supported `art: null`.

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

Nothing above is silently dropped. A field or CSV column the table does not list is not stored, and
the write answer names it as an `ignored_field` warning on the advisory `diagnostics` channel, with
`recordIndex`, that record's position in the request — not the position of the stored piece a merge
refreshed, which is a different number. The catalog document itself lists only its `pieces` and an
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
in-flight reads; publication is not an immediate-effect guarantee. No HTTP operation initializes a catalog.

Supplied proposals remain explicitly unverified. The separately configured `/generate` endpoint performs model generation; its verified witness describes the generation-time input/configuration/taxonomy and actual transport, not certification under today’s taxonomy. Human per-label review and current publication authority remain mandatory. Live model execution, customer sample calibration, UI handoff, cutover and approved data/retention policies remain separately evidenced acceptance.

## The slot document

`{ version, pages: { [page]: [ { slot, take, weights, pinnedPieceId?, merchandising?, stage?, freshness?, fatigue?, diversity? } ] } }`.
`take` is how many pieces the slot shows; `weights` is `{ dimension: weight }`, each 0 to 1, the slot's
view of which dimensions matter; `pinnedPieceId` outranks the engine; `merchandising` is `{ season,
promotion, margin, maxBoost, minBoost }`, the weight of each multiplier (−1 to 1) and the clamp on their
product. The four rules added on 2026-09-04, each off when absent and each itemised on the receipt:
`stage` is `{ outOfStage, inStage }`, a multiplier (0 to 1) on a piece made for another journey stage and
a bonus (0 to 1) for one made for the shopper's; `freshness` is `{ weight, halfLifeDays }`, a bonus of
`weight × 2^(−age / halfLifeDays)` from the piece's freshness date; `fatigue` is `{ weight, windowHours,
cap }`, a penalty of `weight × min(served, cap) / cap` for a piece this shopper was served inside the
window; `diversity` is `{ dimension, max }`, at most `max` pieces sharing one value of the dimension in
the slot, the piece over the limit yielding to the next and served only when nothing else is eligible.

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

#### The layout reason

```json
{ "cause": "no_level_reached_nmin", "n": 10, "nMin": 30, "slot": "pdp-modules", "status": "unchanged" }
{ "moves": [{ "from": 3, "module": "module.PDP.reco.2", "term": "affinity", "to": 1 },
  { "from": 4, "module": "module.PDP.editorial.1", "term": "affinity", "to": 2 }], "slot": "pdp-modules", "status": "changed" }
```

Every decision on the page's declared layout slot carries one reason, `layoutReason`, comparing the served
order with the slot's baseline: the merchandiser's fixed positions (prefix pins, modules pinned at a
position, off-limits modules at their baseline position) where their rules put them, and on every other
position the configured order for the shopper's context where one matches, else the modules the slot can
serve (after eligibility, its exclusions and what the page already served or reserved) in catalogue order.
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
`{ from, module, term, to }`, positions counted from 1 within the slot (`from` null for a module the
baseline does not hold), for every module served away from its baseline position, and its `term` is the
term that moved it: `affinity`, `seed`, `regional_prior`, `context_prior`, `completes`, `external`, `stage`,
`freshness`, `fatigue`, `merchandising`, `lift`, `blend`, `exploration` or `diversity`: `exploration` for a
module exploration placed, `diversity` for one the diversity rule made yield or placed by relaxing it, and
for any other the term that changed its place, the term by which it differs most from the modules it passed
(moved up) or that passed it (moved down) taken together, each term's difference averaged over those
modules and the largest in the direction it moved named, an exact tie going to the earlier term in the
engine's order `affinity`, `regional_prior`, `context_prior`, `completes`, `seed`, `external`, `stage`,
`freshness`, `fatigue`, `merchandising`, `lift`, `blend`. The modules compared are the slot's ranked
modules, never a fixed position nor a module exploration or the diversity rule placed, including for a
module moved up every module the baseline placed ahead of it that is not served; where no term separates
it from them by more than 0.0005, or there is none to compare, it names `exploration` or `diversity` when
it passed, or was passed by, a module that rule placed, else its own largest term in the direction it
moved, else the term of the first module that passed it or that it passed.

An off-limits declared layout slot writes one record, never into the shopper's decision ring, so it
carries no exposure, no receipt reads it and no outcome is credited to it: position 0, `item_id`
`"(off-limits)"`, `customer_item_id` empty, no candidates, authority `default`, `measurementBasis`
`served-v1`, the decision's own arm, cell and versions (lift and prior 0), and `explain.layoutReason` with
the cause `off_limits`. It goes to the ledger, and so rides the export, under the shopper's tracking
consent and only for a layout slot measured on `rendered-v1`, so every report and learning fold sets it
aside as a row recorded under another basis than its slot's; its replay decides the page again and
compares it. The reason rides every exported decision record unchanged, and a record written before it
replays without it.

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
re-evaluation and any other action weighted 0 is not; a weight applied elsewhere to what an action touched
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
| `slots.{slot}.exploration` | `{ mode: rotation \| epsilon \| off, share, floor }`; new writes reject Thompson, retained settings are inactive | off |
| `slots.{slot}.autonomy` | `{ mode: configured \| assisted \| autonomous, step, min, max, pinned, minN }` | configured |
| `slots.{slot}.items.{item}` | `{ mode: reject }` or `{ mode: freeze, lift }` | none |
| `slots.{slot}.blend` | `{ p }`, `p` from 0 to 1: the layout blend, set only on a page's declared layout slot. The slot's modules are then scored `R + (1 − p) × B + p × Q` ([the blend block](#the-blend-block)) instead of `base × lift^γ`. At `p` 0 the slot serves its configured order, else its catalogue order, term for term — only when the layout weights no shopper dimension and sets no stage, freshness, fatigue, merchandising or complements term; otherwise the behaviour term moves it. Publication refuses a `p` outside 0 to 1, any other member, and an opt-in on a slot that is not a page's declared layout slot; the document keeps the member exactly as published | absent (no blend); `p` 0 when the dial names none |
| `slots.{slot}.external.weight` | Historical-only scoring weight; does not re-enable withdrawn runtime scoring | inactive |
| `contextVocabulary` | The tenant's context vocabulary: `channels`, `rules`, `sourcePlatforms`, `landingPageTypes`, optionally `visitBuckets` and `ladder` ([below](#the-context-vocabulary)) | absent: the six channel words, today's classification, buckets `1`, `2-3`, `4+`, depth 5 |

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

## The priors document

Rows of `{ slot, item, cell, p_prior, n_equiv, measurementBasis? }`, or corresponding CSV columns, with the optional document member
`cellGrammar { name, version, order }`. Missing basis is served-v1; priors must match the configured denominator, never carry served pseudo-counts into rendered measurement. `cell` is `*` for
everyone or `k=v` pairs joined by `|` in the ladder's own order and as a PREFIX of it: `c=`, `v=`, `s=`, `r=`, `a=`
(channel, visit bucket, journey stage, region, affinity). A cell in another order, with a key the ladder
does not have, with a level skipped, or with a level past the end is refused by row, naming the expected
order, because it would name a cell no snapshot ever builds. The ladder order is versioned: `cellGrammar`
declares the grammar a file was exported under, anything but the current one is refused with the migration
named, and a document that declares nothing is read under the current grammar. A tenant whose published `contextVocabulary` changes the channel values, the visit-bucket cut or the ladder depth reads another `cellGrammar`: `ladder-cell` at a version derived from those three members (3 plus a 32-bit FNV-1a of the sorted channel ids, the cut and the depth) and the order cut at the depth, so a file exported under the previous vocabulary is refused naming `cellGrammar`, the grammar in force and the re-export, and a row on a cell finer than the depth is refused by row; a vocabulary that changes none of the three keeps `ladder-cell` version 2. `p_prior` is the rate your team estimated
elsewhere in the selected objective unit, and because it is a probability it is refused for a slot whose
objective is `revenue` or `margin`, naming the slot, its objective and the unit; `n_equiv` is how many exposures it should be worth. The imported value supplies the smoothing target and strength, not a replacement for the slot's own `p0` lift denominator. Every receipt names the prior document's
revision. A slot whose only evidence is an imported prior publishes a snapshot with `events: 0` and its
prior-derived rows; a slot with neither events nor priors publishes nothing.

## The lift snapshot

`GET /v1/{tenant}/lift`. `{ tenant, brand, slot, reward, objective, measurementBasis, tauLearnMs, version, publishedAt, events, n0, nMin, liftMin,
liftMax, priorVersion, items, slotRates, attributionContract, generation, restartedAt, exposuresSinceRestart, witness, completeness?,
rebuiltFrom? }` — the stored snapshot exactly as it was published, member for member. `items` is item id → cell key → `{ level, key, n, s, p0, n0,
p_hat, lift, liftReference, prior? }` with the symbols defined above; `liftReference` is `slot-rate` where the
slot has a rate in that cell and `none` where it has none, so a `lift` of 1 at `p0: 0` is read as "no
reference" and not as "measured, and equal to the slot"; it is absent on a snapshot archived before it was
named. `slotRates` is cell key → the slot's own `{ n, s,
rate }`. `version` is the publish time in milliseconds and is what a decision's `versions.lift` names.
`tauLearnMs` is the decay horizon, in milliseconds, the counts were decayed with; the serving path uses a
snapshot only when its `tauLearnMs`, `reward`, `objective`, `measurementBasis` and estimator dials are the
ones the tenant's published learn document names. `witness` is a digest of the statistics object's
committed identity — tenant, brand, slot, configuration, generation fence and projection — which the
serving path checks against the object itself, together with the published digest, before it trusts a
cached snapshot: a snapshot the object does not confirm as its current, healthy publication serves no lift.
A slot name the tenant's catalogue carries on more than one page has one snapshot per page, read with
`page=` (see the API reference); its `slot` member is still the slot name, the answer around it names the
`page`, and the page is part of the committed identity its `witness` digests.
`completeness`, on counters kept under the application's bounds (absent on counters from before those
bounds existed), is `{ depth, omittedItems, selection, reason }`: the finest ladder level still kept
(`depth`, 0 to 5), whether items past the item budget were folded into the slot's root instead of being
kept by name (`omittedItems`), how the kept items were chosen (`first-seen`, or `lexical-repair` after a
coarsening repair), and `reason` — `complete`, `coarse` when fine levels were dropped, or `item-capacity`
when items were folded. `rebuiltFrom` names the repair the counters stand on, and only on a slot that was
repaired (below).

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
| `personalization_update` | `{ userId, timestamp, data: { segments[], decisions{}, featureVariables{}, recommendations[], sortOrder[], journeyStage, affinity: { dims, audiences, changed[], odpConfirmed[] } } }`. `journeyStage` is one of `exploring`, `thinking`, `deciding`: the stage of the shopper's CURRENT VISIT, derived from the visit's own counters against the `journey` thresholds published on your reflex configuration document. It starts again at `exploring` in a new visit and after the purchase that reached `deciding`. With no `journey` block published the engine's compiled default decides (`thinking` at the third interaction of the visit, `deciding` at the first purchase), so the stage still moves and the pooled learning key still spreads across `s=early`, `s=mid` and `s=late` rather than collapsing onto `s=early`; `sources.journey` on a decision names that default and its `revision: 0`. |
| `segment_update` | The same shape, on a membership change alone |
| `content_decisions` | Client-compatible only, no production sender promised. A decision set: `{ page, arm, versions, config_label, decisions[], ts }` |
| `audience_published` | `{ userId, data: { timestamp, source, audienceWentLive: { key, name } } }` |
| `odp_receipt` | `{ userId, data: { receiptId, status, ts, source } }`: the customer data platform's answer to a forwarded event |
