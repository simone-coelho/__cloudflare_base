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
| `content_impression` | Authenticated renderer admission: `contentId`, `slot`, `decisionId`, `renderOffer`, `page`, `pageInstance`, `position`; original event nonce/time are mandatory |
| `content_click`, `video_complete` | `contentId`, `slot`, original acknowledged `decisionId`; optional `customerContentId` and `contentType` |
| `content_dwell` | the same, plus `ms`, milliseconds on screen |
| `custom` | `event`, the real name, plus anything |

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
| `measurementBasis` | `served-v1` (also absent legacy metadata) or `rendered-v1`; incompatible counts are not pooled |
| `rendered` | Rendered-v1 only: `{version:1,eventId,at,pageInstance}` from the original durably admitted renderer signal, not proof of human visibility |
| `page`, `slot`, `position` | Where it was served, and the rank inside the slot |
| `item_id`, `customer_item_id` | What was served, both ids |
| `candidates[]` | `{ contentId, score }` for the top candidates considered |
| `cell` | The shopper's context: `channel`, `visit_bucket` (`1`, `2-3`, `4+`, `unknown`), `region`, `affinity` (the leading interest as `dim:value`, or null) |
| `arm` | `personalized`, or the holdout's `default` or `no_learning` |
| `explored` | True when exploration served it on purpose |
| `authority` | `engine`, `pin` or `default` |
| `versions` | `config`, `catalog`, `slots`, `learn`, `lift`, `prior`, `policy`: the revision of each input. Zero names an absent/compiled input; current absent slots yield no selections. What a replay reads back |
| `config_label` | The human-readable label of the configuration revision |
| `featured_product_ids` | The products the served piece features, when it names any: an outcome naming one of them credits this decision under the default policy, and a warehouse joins it to the product decision |
| `explain.score_base` | The score before learning: interests times weights, plus the population prior and your model's term when they applied |
| `explain.regional` | When the population prior applied: `region`, `level`, `lambda` (its share of the score), `version`, `events`, `contribution` |
| `explain.lift` | The learned term, defined below, or null when nothing has been learned for this item in this cell |
| `explain.score_final` | `score_base × lift^γ`. Equal to `score_base` while γ is 0 |
| `explain.exploration` | When `explored`: `mode`, `reason`, `bucket`; retained historical Thompson receipts can include `sample` (Thompson is no longer writable or live) |
| `explain.control` | `reject` or `freeze` when a merchandiser's control applied to the item |
| `explain.external` | Your model's term: `kind`, `ref`, `version`, `weight`, `score`, `contribution`; or `status: "unavailable"` with `reason` |
| `explain.merchandising` | Season, promotion and margin: `boost`, `clamped`, `drivers[]` each with the delta it caused, and a sentence |
| `explain.stage` | The slot's journey-stage rule on this piece: the shopper's stage, the piece's fit, the delta it caused, and a sentence |
| `explain.freshness` | The freshness bonus: `ageDays`, `decay`, `applied`, and a sentence |
| `explain.fatigue` | The fatigue penalty: `served` times inside `windowHours`, `applied`, and a sentence |
| `explain.diversity` | The slot's diversity rule touched this position: the pieces that yielded to it (`skipped`), or `relaxed` when it was served over the limit because nothing else was eligible |
| `inputs` | The interest vector as scored, the regional shares, your model's scores and the served counts the fatigue term read, when they applied: what makes a replay exact |

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

## The outcome record

One per reward-bearing event, written after the response.

| Field | Meaning |
|---|---|
| `outcome_id` | `{tenant}:{time in base 36}:{visitor}:{event}` |
| `type` | The reward type the event maps to |
| `event` | The wire event name, so a custom reward keeps its own |
| `item_id`, `slot` | The content id and slot the event named, when it did |
| `value`, `currency` | For a purchase |
| `margin` | The margin the event carried (`margin`, or the items' margins times quantity summed), for a slot that learns margin; null when none |
| `products` | The products the event named (`productId`, `sku`, or each of `items[].id`); a purchase credits the content that featured one of them |
| `session_id`, `visitor_id`, `brand`, `arm`, `ts` | As on the decision |

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
| `art`, `renderUrl` | no | Image, and a URL your page may render by |
| `merchandising` | no | `{ season, promotion, margin }`, each 0 to 1 including zero: the item's own signals for the multipliers. CSV uses a quoted JSON object, for example `"{""promotion"":1,""margin"":0}"` |
| `journeyStageFit` | no | The stages the piece is made for: `exploring`, `considering`, `deciding` (your `journey_stage_fit`; `explore`, `consider`, `decide` and `early`, `mid`, `late` also accepted). Absent fits every stage. A slot's `stage` rule demotes a piece outside the shopper's stage |
| `freshnessDate` | no | When the piece became current, ISO 8601 (your `freshness_date`). A slot's `freshness` rule ages from it; absent, from `window.from` |
| `featuredProductIds` | no | The products the piece features, in your product ids (your `featured_product_ids`). Carried and validated, never rewritten |
| `inStock` | no | Your catalog's stock flag. `false` removes the piece from every decision; absent means in stock. In a feed, `in_stock` or `ats` (Y/N, 0/1, true/false) is read the same way |

Import/pull `merge` is a partial upsert by `id`: omitted supported fields preserve the existing item,
including its customer ID, tags, lifecycle, stock and merchandising. Existing order is retained; new
IDs append. New items and `replace` imports require valid complete items; only there do omitted
customer IDs default to `id`, tags to `{}`, and lifecycle to `live`. Catalog PUT remains full replace.
CSV blank cells mean omitted, not cleared. Supplied canonical fields take precedence over aliases,
including malformed values: JSON nulls refuse except the supported `art: null`.

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

Current slot writes accept an absent marker or `governanceVersion: 1 | 2 | 3` and emit version 3; any other
explicit version refuses. `offLimits` is an optional boolean; true hands the slot to the site's own
default on every arm, without candidates, decisions or records. A dormant pin and all other settings
are retained. Re-enabling must pass active pin take/uniqueness/exclusion validation.
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
(ID/off-limits only), and `slot-gates-v2` (all controls). Other replay policy markers remain independent.
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
UTF-8 byte limit, including server metadata in the stored limit. No truncation occurs. Other envelope,
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

## The learn document

What the learning may do, per brand and per slot. Every field has a default; a document names only
what it changes.

| Field | Meaning | Default |
|---|---|---|
| `holdout.share`, `holdout.arms` | The share of visitors held out, by a stable hash, and which arms exist (`default`, `no_learning`) | 0.05, `default` |
| `regional.enabled`, `kBlend`, `minEvents` | The population prior on the base score | on, 1, 30 |
| `policy.scope`, `match`, `credit`, `windowsMs` | The attribution policy: `session` or `visitor`; `direct` or `any`; `last` or `first`; per reward, how long after a decision an outcome may still count | session, direct, last; click 30 min, add to bag 6 h, purchase 7 d |
| `stats.n0`, `tauLearnMs`, `liftMin`, `liftMax`, `nMin` | The estimator: prior strength, the decay horizon, the lift clamp, the evidence threshold per cell | 30, 21 days, 0.5, 2, 30 |
| `external.kind`, `ref`, `timeoutMs`, `fallback` | Retained historical configuration only: all service/table/workers_ai live scoring, including table lookup, is withdrawn and contributes no score. W14 enrichment/NL search are separately enabled workflows, not models in ordinary ranking | inactive |
| `slots.{slot}.gamma` | The trust dial; zero is not a learning-ingestion kill switch | 0 |
| `slots.{slot}.measurementBasis` | `served-v1` or `rendered-v1`; basis changes require compatible state/reset generation, never historical relabel | `served-v1` |
| `slots.{slot}.reward` | The reward the slot learns against | `click` |
| `slots.{slot}.objective` | `unit`, `revenue` or `margin`; unit credits are event weights, revenue uses value, margin uses supplied margin and currently falls back to value when absent | `unit` |
| `slots.{slot}.exploration` | `{ mode: rotation \| epsilon \| off, share, floor }`; new writes reject Thompson, retained settings are inactive | off |
| `slots.{slot}.autonomy` | `{ mode: configured \| assisted \| autonomous, step, min, max, pinned, minN }` | configured |
| `slots.{slot}.items.{item}` | `{ mode: reject }` or `{ mode: freeze, lift }` | none |
| `slots.{slot}.external.weight` | Historical-only scoring weight; does not re-enable withdrawn runtime scoring | inactive |

## The priors document

Rows of `{ slot, item, cell, p_prior, n_equiv, measurementBasis? }`, or corresponding CSV columns. Missing basis is served-v1; priors must match the configured denominator, never carry served pseudo-counts into rendered measurement. `cell` is `*` for
everyone or `channel=…|visit=…` pairs in the ladder's order; `p_prior` is the rate your team estimated
elsewhere in the selected objective unit; `n_equiv` is how many exposures it should be worth. The imported value supplies the smoothing target and strength, not a replacement for the slot's own `p0` lift denominator. Every receipt names the prior document's
revision.

## The lift snapshot

`GET /v1/{tenant}/lift`. `{ tenant, brand, slot, reward, objective, measurementBasis, version, publishedAt, events, n0, nMin, liftMin,
liftMax, priorVersion, items, slotRates }`. `items` is item id → cell key → `{ level, key, n, s, p0, n0,
p_hat, lift, prior? }` with the symbols defined above; `slotRates` is cell key → the slot's own `{ n, s,
rate }`. `version` is the publish time in milliseconds and is what a decision's `versions.lift` names.

## The day report

`POST /v1/{tenant}/learn/report`. `{ tenant, brand, date, builtAt, counts: { decisions, outcomes,
visitors, truncated }, policies: [ { name, policy, role, credits } ], grids: { [slot]: { [policy]: a lift
snapshot built from that day alone } }, exploration: [ { slot, decisions, explored, realized, configured,
mode } ], holdout: { [slot]: [ { arm, decisions, credited, rate } ] } }`. Aggregates only; no visitor id
in it. Current `computation.version` is4 with per-slot measurement basis; retained1–3 stay historical. Incompatible policy/basis/version counters cannot pool. Money objectives use configured value units (margin falls back to value), not currency conversion or probability.

## Socket frames

| Frame | Body |
|---|---|
| `connected` | `{ connectionId, userId, timestamp }` |
| `personalization_update` | `{ userId, timestamp, data: { segments[], decisions{}, featureVariables{}, recommendations[], sortOrder[], journeyStage, affinity: { dims, audiences, changed[], odpConfirmed[] } } }` |
| `segment_update` | The same shape, on a membership change alone |
| `content_decisions` | Client-compatible only, no production sender promised. A decision set: `{ page, arm, versions, config_label, decisions[], ts }` |
| `audience_published` | `{ userId, data: { timestamp, source, audienceWentLive: { key, name } } }` |
| `odp_receipt` | `{ userId, data: { receiptId, status, ts, source } }`: the customer data platform's answer to a forwarded event |
