# Payload Schemas

Every record the platform accepts, writes or returns, field by field. Each symbol is defined the first
time it appears and nowhere else.

## Event payloads, by type

The `data` object of `POST /realtime/action`, by `type`.

| Type | Fields in `data` |
|---|---|
| `page_view` | `path` |
| `product_view`, `add_to_cart`, `wishlist_add` | `productId`, plus the registry's attributes when the brand scores them from the event: `line`, `category`, `subcategory`, `silhouette`, `occasion` (a list), `price_usd` |
| `purchase` | `orderId`, `value`, `currency`, `items[]` of `{ productId, quantity, price }` |
| `content_impression`, `content_click`, `video_complete` | `contentId` (ours), `slot`, and optionally `customerContentId` (yours) and `contentType` |
| `content_dwell` | the same, plus `ms`, milliseconds on screen |
| `custom` | `event`, the real name, plus anything |

## The decision

One item in `decisions[]` of the snapshot and of a `content_decisions` frame.

| Field | Meaning |
|---|---|
| `contentId` | Our id for the piece |
| `customerContentId` | Your id for the piece; what you render by |
| `type` | The piece's kind: `editorial`, `guide`, `film`, `lookbook`, `campaign`, or your own |
| `slot` | The slot on the page |
| `order` | Position across the whole page, in page order |
| `score` | The final score that ranked it |
| `strategy` | `affinity`: the shopper's interests decided. `default`: nothing was known, the catalog's order decided. `tenant-pinned`: a merchandiser pinned it |
| `explain.drivers[]` | `{ dim, value, a, weight }`: the dimension and value that contributed, the shopper's interest `a` in it (0 to 1), and the slot's weight for that dimension. Two more `dim` values can appear: `regional`, the population prior, and `external`, your model's term |
| `explain.note` | In words, when a rule rather than a score decided |

## The decision record

One per served position, written to the ledger after the response and returned in `records[]`.

| Field | Meaning |
|---|---|
| `decision_id` | `{tenant}:{time in base 36}:{visitor}:{page}:{slot}:{position}`. Sortable by time; the brand and the hour are derivable from the id alone |
| `tenant`, `brand` | Isolation keys |
| `visitor_id`, `session_id` | The first-party identifiers. `session_id` is the platform's session, the one attribution compares |
| `identity_anchor` | `visitor` when the state hung on the durable id, `session` when only a session was available, `none` when no state could be read |
| `ts` | Server time |
| `page`, `slot`, `position` | Where it was served, and the rank inside the slot |
| `item_id`, `customer_item_id` | What was served, both ids |
| `candidates[]` | `{ contentId, score }` for the top candidates considered |
| `cell` | The shopper's context: `channel`, `visit_bucket` (`1`, `2-3`, `4+`, `unknown`), `region`, `affinity` (the leading interest as `dim:value`, or null) |
| `arm` | `personalized`, or the holdout's `default` or `no_learning` |
| `explored` | True when exploration served it on purpose |
| `authority` | `engine`, `pin` or `default` |
| `versions` | `config`, `catalog`, `slots`, `learn`, `lift`, `prior`, `policy`: the revision of each input, 0 for a compiled default. What a replay reads back |
| `config_label` | The human-readable label of the configuration revision |
| `explain.score_base` | The score before learning: interests times weights, plus the population prior and your model's term when they applied |
| `explain.regional` | When the population prior applied: `region`, `level`, `lambda` (its share of the score), `version`, `events`, `contribution` |
| `explain.lift` | The learned term, defined below, or null when nothing has been learned for this item in this cell |
| `explain.score_final` | `score_base × lift^γ`. Equal to `score_base` while γ is 0 |
| `explain.exploration` | When `explored`: `mode`, `reason`, `bucket`, and `sample` for Thompson |
| `explain.control` | `reject` or `freeze` when a merchandiser's control applied to the item |
| `explain.external` | Your model's term: `kind`, `ref`, `version`, `weight`, `score`, `contribution`; or `status: "unavailable"` with `reason` |
| `explain.merchandising` | Season, promotion and margin: `boost`, `clamped`, `drivers[]` each with the delta it caused, and a sentence |
| `inputs` | The interest vector as scored, the regional shares and your model's scores when they applied: what makes a replay exact |

### The lift block, and every symbol in it

| Symbol | Meaning |
|---|---|
| `reward` | The outcome the slot learns against: `click`, `dwell`, `video_complete`, `wishlist`, `add_to_bag`, `purchase` or `custom` |
| `n` | Exposures of the item in the cell, decayed over the learning horizon |
| `s` | Successes on the reward, decayed the same way |
| `p₀` (`p0`) | The slot's own rate in that cell: the baseline |
| `n₀` (`n0`) | The strength of the prior in exposures: how many observations the baseline is worth when the item's estimate is shrunk toward it. An imported prior brings its own |
| `p̂` (`p_hat`) | The smoothed rate: `(s + n₀ × p₀) / (n + n₀)` |
| `lift` | `p̂ / p₀`, clamped to the configured range; 1 means no evidence either way |
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
| `merchandising` | no | `{ season, promotion, margin }`, each 0 to 1: the item's own signals for the multipliers |

## The slot document

`{ version, pages: { [page]: [ { slot, take, weights, pinnedPieceId?, merchandising? } ] } }`. `take` is
how many pieces the slot shows; `weights` is `{ dimension: weight }`, each 0 to 1, the slot's view of
which dimensions matter; `pinnedPieceId` outranks the engine; `merchandising` is `{ season, promotion,
margin, maxBoost, minBoost }`, the weight of each multiplier (−1 to 1) and the clamp on their product.

## The learn document

What the learning may do, per brand and per slot. Every field has a default; a document names only
what it changes.

| Field | Meaning | Default |
|---|---|---|
| `holdout.share`, `holdout.arms` | The share of visitors held out, by a stable hash, and which arms exist (`default`, `no_learning`) | 0.05, `default` |
| `regional.enabled`, `kBlend`, `minEvents` | The population prior on the base score | on, 1, 30 |
| `policy.scope`, `match`, `credit`, `windowsMs` | The attribution policy: `session` or `visitor`; `direct` or `any`; `last` or `first`; per reward, how long after a decision an outcome may still count | session, direct, last; click 30 min, add to bag 6 h, purchase 7 d |
| `stats.n0`, `tauLearnMs`, `liftMin`, `liftMax`, `nMin` | The estimator: prior strength, the decay horizon, the lift clamp, the evidence threshold per cell | 30, 21 days, 0.5, 2, 30 |
| `external.kind`, `ref`, `timeoutMs`, `fallback` | Your model: `service`, `table` or `workers_ai`; its reference; the budget in milliseconds; `omit` | off |
| `slots.{slot}.gamma` | The trust dial | 0 |
| `slots.{slot}.reward` | The reward the slot learns against | `click` |
| `slots.{slot}.exploration` | `{ mode: rotation \| thompson \| epsilon \| off, share, floor }` | off |
| `slots.{slot}.autonomy` | `{ mode: configured \| assisted \| autonomous, step, min, max, pinned, minN }` | configured |
| `slots.{slot}.items.{item}` | `{ mode: reject }` or `{ mode: freeze, lift }` | none |
| `slots.{slot}.external.weight` | How much the slot trusts your model, 0 to 1 | 0 |

## The priors document

Rows of `{ slot, item, cell, p_prior, n_equiv }`, or CSV with those five columns. `cell` is `*` for
everyone or `channel=…|visit=…` pairs in the ladder's order; `p_prior` is the rate your team estimated
elsewhere; `n_equiv` is how many observations it should be worth. The engine uses them as `p₀` and
`n₀` for that key until live evidence outweighs them, and every receipt names the prior document's
revision.

## The lift snapshot

`GET /v1/{tenant}/lift`. `{ tenant, brand, slot, reward, version, publishedAt, events, n0, nMin, liftMin,
liftMax, priorVersion, items, slotRates }`. `items` is item id → cell key → `{ level, key, n, s, p0, n0,
p_hat, lift, prior? }` with the symbols defined above; `slotRates` is cell key → the slot's own `{ n, s,
rate }`. `version` is the publish time in milliseconds and is what a decision's `versions.lift` names.

## The day report

`POST /v1/{tenant}/learn/report`. `{ tenant, brand, date, builtAt, counts: { decisions, outcomes,
visitors, truncated }, policies: [ { name, policy, role, credits } ], grids: { [slot]: { [policy]: a lift
snapshot built from that day alone } }, exploration: [ { slot, decisions, explored, realized, configured,
mode } ], holdout: { [slot]: [ { arm, decisions, credited, rate } ] } }`. Aggregates only; no visitor id
in it.

## Socket frames

| Frame | Body |
|---|---|
| `connected` | `{ connectionId, userId, timestamp }` |
| `personalization_update` | `{ userId, timestamp, data: { segments[], decisions{}, featureVariables{}, recommendations[], sortOrder[], journeyStage, affinity: { dims, audiences, changed[], odpConfirmed[] } } }` |
| `segment_update` | The same shape, on a membership change alone |
| `content_decisions` | A decision set: `{ page, arm, versions, config_label, decisions[], ts }` |
| `audience_published` | `{ userId, data: { timestamp, source, audienceWentLive: { key, name } } }` |
| `odp_receipt` | `{ userId, data: { receiptId, status, ts, source } }`: the customer data platform's answer to a forwarded event |
