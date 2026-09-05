# API Reference

Every route your integration, your merchandisers and your data science team can call. Request and
response shapes are the ones the platform enforces today. Field meanings are in the
[payload schemas](./03-payload-schemas.md).

## Conventions

- **Base URL.** The platform host we give you for staging; on production, a subdomain of your site routed to the platform.
- **Brand in the path.** Decision, learning and identity routes carry the brand: `/v1/{tenant}/…`. `tenant` is a short slug, `coach` for the launch brand. Event routes have no brand in the path; the platform derives it from the registered hostname the request came from.
- **Two credentials.** A **site key** identifies the site on the shopper-facing routes: header `X-SDK-Key: <key>` on requests, `?sdkKey=<key>` on the socket upgrade, where a header cannot be set. An **operator token** authorizes configuration and the analyst routes: header `Authorization: Bearer <token>`, issued by the platform's login. A verified operator token also passes the site-key gate, so operator tools need only the token.
- **Cross-origin.** Your registered origins are allow-listed; the browser sends credentials, and the platform answers preflights for them. Unregistered origins receive no permission.
- **Answers.** JSON. Success carries `ok: true` or `success: true`; a refusal carries `ok: false` and an `error` in words, with `details` when a body failed validation. Decisions and reads that must be fresh answer with `Cache-Control: no-store`.
- **Versioned documents.** Configuration is a set of documents per brand. Every write is a new revision with an author and a note; history is readable; a rollback writes an old revision forward as a new one. Reads are open, writes need the operator token.

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
| `type` | yes | One of `page_view`, `product_view`, `add_to_cart`, `wishlist_add`, `purchase`, `content_impression`, `content_click`, `content_dwell`, `video_complete`, `button_click`, `form_submit`, `email_open`, `custom` |
| `userId` | yes | The visitor id, or the shopper id after sign-in. The SDK fills it |
| `anonymousId` | no | A per-page-load id, kept for legacy capture |
| `sessionId` | no | The client's own session marker. The platform keeps its own session per visitor and uses that for attribution |
| `data` | yes | The event's payload, by type: see the [payload schemas](./03-payload-schemas.md#event-payloads-by-type) |
| `source` | yes | Names the caller |
| `entry` | no | How this page load arrived; captured once per load, sent with every event, used only when a new visit opens |
| `timestamp` | no | Client time in milliseconds; the platform records its own |

Response:

```json
{
  "success": true,
  "message": "Action processed and personalization updated",
  "update": { "type": "personalization_update", "userId": "vis-2f1c…", "data": { "segments": ["line_tabby_affinity"], "decisions": { "hero_module": { "enabled": true, "variationKey": "affinity_hero", "variables": {} } }, "affinity": { "dims": { "line": { "Tabby": 0.71 } } }, "journeyStage": "mid" } },
  "sessionId": "9cb1810f-…",
  "cookiesUpdated": true,
  "odp": { "receiptId": "r-…", "type": "product", "action": "detail" }
}
```

`update` is absent when nothing changed. `400` with `error: "Invalid action event format"` and
`details` names the offending field.

### `GET /realtime/ws?userId=<visitor id>&sdkKey=<key>`

The live channel; a WebSocket upgrade. Frames from the platform: `connected`, `heartbeat_response`,
`personalization_update`, `segment_update`, `audience_published`, `odp_receipt`, `content_decisions`.
The client sends `{"type":"heartbeat"}` on the SDK's interval. Frame bodies are in the
[payload schemas](./03-payload-schemas.md#socket-frames).

### `POST /realtime/session/reset`

Expires the platform's cookies for this browser and deletes its session. The SDK's `logout` uses the
identity route instead; this one is the erase.

## 2. Decisions

### `GET /v1/{tenant}/decisions/snapshot?page=home&visitorId=<id>[&brand=<brand>][&channel=<channel>]`

Every slot's decision for the page, in page order, and the record of each. Site key.

| Query | Meaning |
|---|---|
| `page` | The page's name in the slot document; default `home` |
| `visitorId` | Required. The visitor id, or the shopper id after sign-in |
| `brand` | Recorded on the decisions; defaults to the tenant |
| `channel` | The entry channel if the page knows it; recorded on the decision's cell |

```json
{
  "ok": true, "tenant": "coach", "brand": "coach", "page": "home",
  "visitor_id": "vis-2f1c…", "session_id": "9cb1810f-…", "identity_anchor": "session", "ts": 1788541396189,
  "arm": "personalized",
  "cell": { "channel": "direct", "visit_bucket": "1", "region": "US-NY", "affinity": "line:Tabby" },
  "versions": { "config": 15, "catalog": 4, "slots": 7, "learn": 19, "lift": 1788540535150, "prior": 6, "policy": 19 },
  "config_label": "reflex-demo-v1+r15",
  "regional": null,
  "decisions": [ { "contentId": "cnt_7cb1e039", "customerContentId": "CCH-001", "type": "campaign", "slot": "chero", "order": 1, "score": 0.455, "strategy": "affinity", "explain": { "drivers": [ { "dim": "line", "value": "Tabby", "a": 0.7286, "weight": 0.35 } ] } } ],
  "records": [ { "decision_id": "coach:mtn7da1g:vis-2f1c…:home:chero:0", "…": "the full record, see the payload schemas" } ],
  "sources": { "catalog": { "version": "coach-content+r4", "revision": 4, "pieces": 26 }, "slots": { "version": "slots-coach+r7", "revision": 7, "count": 4 }, "learn": { "version": "learn+r19", "revision": 19 }, "config": { "label": "reflex-demo-v1+r15", "revision": 15 }, "external": null, "state": "session", "consent": { "tracking": true, "personalization": true, "personalized": true } },
  "write": true
}
```

Every call writes the records to the decision ledger after the response; a call is a decision. The one
exception is consent: a shopper whose `trackingConsent` is off gets the site's defaults, `write` is
`false`, and nothing about the call is recorded anywhere; one whose `personalizationEnabled` is off gets
the defaults and is recorded as such. `sources.consent` says which.

## 3. Identity

All under `/v1/{tenant}/identity/`. The first two take the site key; the rest take the operator token.

| Route | Body | Answer |
|---|---|---|
| `POST link` | `{ visitorId, accountId, source?, exp?, assertion? }` | `{ ok, shopperId, visitorId, outcome: "linked" \| "already" \| "relinked", assurance, audiences, changes: { entered, exited }, carry }`. `carry` is the id the browser must carry from now on. `409` when `visitorId` is already a shopper id: log out first. `401` when the brand has a secret and the assertion is missing or wrong |
| `POST detach` | none | `{ ok, detached: true }`; expires this device's cookies, deletes nothing |
| `POST resolve` | `{ accountIds: [] }` | Account ids to shopper ids, for a warehouse join |
| `GET visitor/{visitorId}` | | The link from the browser's end, if any |
| `GET shopper/{shopperId}` | | The browsers on the person and the history applied; the account id is not on it |
| `POST events` | JSON `{ rows }` or `text/csv`, at most 1000 rows | Historical rows into the person's interests: `accountId \| shopperId \| visitorId`, `action`, `at`, and the product attributes the registry reads |

## 4. Content and configuration documents

Four documents per brand, each with the same seven routes. `kind` is `catalog`, `slots`, `learn` or
`priors`; `scope` is the brand.

| Route | Auth | Does |
|---|---|---|
| `GET /content/{kind}?scope=` | open | The document in force, with `source` (`stored` or `compiled-default`), `revision`, `actor`, `note`, `at` |
| `GET /content/{kind}/history?scope=` | open | Every revision: number, version label, actor, note, time |
| `GET /content/{kind}/revisions/{n}?scope=` | open | One past revision |
| `POST /content/{kind}/validate?scope=` | open | `{ document }` in, `{ valid, errors[] }` out: every error, not the first |
| `PUT /content/{kind}?scope=` | operator | `{ document, note }` in; `{ ok, revision, version, document }` out, or `422` with `errors[]` |
| `POST /content/{kind}/rollback/{n}?scope=` | operator | Writes revision `n` forward as a new revision |
| `PUT /content/priors?scope=&note=` with `Content-Type: text/csv` | operator | The priors document from the CSV a warehouse exports |

Two more for the catalog, the seam your content system connects to:

| Route | Body | Does |
|---|---|---|
| `POST /content/catalog/import?scope=&format=json\|csv&mode=replace\|merge&path=` | the records | A JSON array (or an object with the array at `path`), or CSV with the columns in the payload schemas; `merge` upserts by id, `replace` is the whole catalog |
| `POST /content/catalog/pull?scope=` | `{ url, path?, mode?, note? }` | The platform fetches your JSON feed over HTTPS and imports it |

The reflex configuration, the registry of dimensions and the engine's constants per brand, has the same
shape under `/config/reflex` (`GET`, `PUT`, `PATCH`, `history`, `revisions/{n}`, `validate`,
`rollback/{n}`). The tuning page and the learning console are clients of these routes; there is no
other way to change what the engine does.

## 5. Learning and transparency

Under `/v1/{tenant}/`. Operator token unless marked.

| Route | Does |
|---|---|
| `GET lift?slot=&brand=[&version=]` | The slot's lift snapshot in force, or an archived version: every item's estimate in every cell. Site key or token |
| `GET lift/history?slot=&brand=` | Every archived snapshot version for the slot |
| `GET lift/rows?slot=&brand=[&level=pooled\|cells][&item=][&q=][&sort=][&dir=][&limit=][&cursor=]` | The grid one page at a time, cut by the server: one pooled row per item, or one item's cells (`level=cells&item=`), filtered by `q` over the item id, your id, the title and the cell, sorted by any column, fifty a page up to five hundred. `total` counts what matched; `cursor` fetches the next page and is bound to the snapshot version, so a listing that outlives a publish answers 409 and starts again. Names and a merchandiser's freeze or reject ride each row. Site key or token |
| `GET brands` | The brands this stamp serves, the default first: the application's brand picker |
| `GET learn/slots?brand=[&q=][&evidence=1]` | Every slot on every page, grouped by page, with what is set on it (dimensions weighted, rules, reward, objective, trust, exploration, autonomy, controls) and how many pieces are eligible now; `q` narrows by slot or page name; `evidence=1` adds what each slot has learned so far. The picker and the overview of an operator application |
| `GET learn/exploring?slot=&brand=[&limit=][&cursor=]` | The pieces under the slot's observation floor, least observed first, one page at a time, with the slot's exploration mode, share and floor: what exploration serves on purpose |
| `GET learn/queue?brand=` | What needs a person, as counts: proposals pending, slots that have learned nothing yet, slots whose trust dial is above zero, pieces frozen or rejected, erasures still to be rewritten. The landing page of an operator application. Operator token |
| `GET visitors/{visitorId}/receipts[?limit=&cursor=]` | What this shopper was served, newest first, each with the sentences that say why: the interest matched, the region's trend, your model's term, the journey-stage, freshness, fatigue, merchandising and diversity rules, the learned lift and whether it was applied, a pin, the holdout arm, an explored pick. An erased shopper answers 410. Operator token |
| `GET visitors/{visitorId}/recent` | The visitor's ring of recent decisions, what attribution reads |
| `GET ledger/{decision_id}` and `GET ledger/{outcome_id}?stream=outcome` | One record from the ledger by id, no index needed; behind by the queue's lag during a peak |
| `GET ledger/batches?date=YYYY-MM-DD[&stream=decision\|outcome][&cursor=]` | The day's batch objects, so a warehouse job knows what to fetch with its own storage credentials. The partitions are the export |
| `GET ledger/erasures` | The visitors whose erasure is pending, each with the moment of erasure: a warehouse job drops their rows at or before that moment from what it loads, until the nightly rewrite has removed them from the objects themselves. `ledger/batches` says how many are pending |
| `POST ledger/erasures` `{ visitorId }` | The ledger half of an erasure: writes the tombstone every reader honours at once and empties the visitor's ring. The identity erase route calls the same function after erasing the profile. `POST ledger/erasures/rewrite` runs the nightly rewrite now |
| `GET replay/{decision_id}` | Decides again from the documents at the recorded revisions, the archived snapshot and the record's inputs, and compares field by field: `{ equal, diff[], used }` |
| `POST learn/report` `{ date, brand?, policies? }` and `GET learn/report?date=&brand=` | The day's ledger under the learning policy and any reporting policies side by side, the holdout arms, the realized exploration share. Aggregates only |
| `POST learn/cycle[?brand=]` | Runs the autonomy cycle now: proposals for slots in assisted mode, bounded moves for slots in autonomous mode |
| `GET learn/proposals` and `POST learn/proposals/{id}/apply\|reject` | The cycle's proposals with their evidence, and a person's decision on each |
| `POST learn/items/reset` `{ slot, item, brand? }` | Discards one item's evidence in one slot; the estimate restarts from the prior; recorded as a revision with a note |
| `POST learn/publish` `{ slot, brand? }` | Publishes the slot's lift snapshot now, as the object does within the minute on its own; for an operator who has just changed a dial |
| `POST models/reference` | The reference implementation of the model contract, for a data science team to see the shape. Site key |
| `GET trend?region=` (site key or token) and `POST trend/rollup` | The regional interest vector in force, and the roll-up the hourly job does, on demand |

## 6. Operators: sign-in and accounts

Under `/auth/`. A person signs in on the console with an email and a password; these are the routes
behind that, for an integration that needs a token of its own. There is no open registration: an admin
creates accounts.

| Route | Body | Answer |
|---|---|---|
| `POST login` | `{ email, password }` | `{ accessToken, refreshToken, user, mustChangePassword, expiresIn: 900 }`. The access token lasts fifteen minutes, the refresh token seven days; `401` for a wrong email or password, `403` for a disabled account |
| `POST refresh` | `{ refreshToken }` | A new access token. Each session has its own refresh token; a reset, a disable, a removal or a sign-out ends all of the account's sessions |
| `POST logout` | none, operator token | Ends the account's sessions |
| `GET me` | operator token | Who is signed in, and the account |
| `POST password` | `{ currentPassword, newPassword }`, operator token | Changes your own password. At least ten characters, not your email, not one character repeated. A person signed in on a temporary password must do this first |
| `GET users` | admin token | Every account: email, name, roles, state, last sign-in. Never a password or a hash |
| `POST users` | `{ email, name, roles? }`, admin token | Creates the account and answers with `temporaryPassword`, once. Roles are `operator` (default) and `admin` |
| `PATCH users/{id}` | `{ name?, roles?, disabled? }`, admin token | Renames, changes the role, disables or enables. An admin cannot disable their own account or take admin away from it |
| `POST users/{id}/reset` | admin token | A new `temporaryPassword`, once; the person's sessions end and they choose their own at the next sign-in |
| `DELETE users/{id}` | admin token | Removes the account and ends its sessions. Not your own |

Passwords are stored as PBKDF2 hashes; nothing in the platform can read one back.

## 7. Health

`GET /health` answers `200` with the state of each store when the platform is up.
