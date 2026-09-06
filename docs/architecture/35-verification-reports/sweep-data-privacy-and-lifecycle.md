# Independent sweep — data privacy and lifecycle

**Scope:** consent, erasure, retention, where personal data actually lives (KV, R2, D1, Durable Objects,
Analytics Engine, logs), identity stitching, exports and connectors.
**Repository:** `/mnt/c/Users/LAH/Documents/__Development/Optimizely/__cloudflare_base`, branch
`feature/real-time-personalization`, working tree read-only, another engineer's uncommitted work present.
**Date:** 2026-09-06. **Reviewer:** independent, third pass.

Everything named in `docs/architecture/33-adversarial-audit-brief.md` and in
`docs/architecture/34-independent-adversarial-audit.md` (F01–F35) is out of scope and is not repeated below.
Where a finding sits next to an existing one, the section "Why this is not F0x" says exactly what is different,
so the delivery team can tell a new defect from a restatement.

Scratch harnesses (not added to the repository, no tracked file touched):
`/tmp/audit-verify/sweep-data-privacy-and-lifecycle/{erasure-undo.ts, ae-pii.ts, log-pii.ts, d1-capture.ts}`,
each run from the repository root with `npx tsx`.

The customer's own words the sweep is judged against, `docs/architecture/tapestry_requirements.txt:217`:

> "Data minimization, consent management, and right-to-be-forgotten capabilities built into the architecture
> from day one. Compliance with GDPR, CCPA, and emerging regulations is a foundational requirement, not an
> afterthought."

`docs/architecture/26-btie-requirements-gap-review.md:64` grades that clause partial and opens two deltas for
it — D9 (erasure across the ledger) and D10 (consent enforcement), both since claimed built. **Data
minimisation, the third capability the clause names, was never given a delta or an owner.** The first three
findings below are what that gap costs.

---

## P1 · Erasure is undone by the browser on the next page view

**Severity: blocks launch. Size: S–M.**

### Evidence

`src/services/SessionManager.ts:566` `generateSessionCookies()` mirrors the shopper's profile into cookies:
`opt_user_id`, `opt_segments` (the audience list, joined), `opt_engagement_score`, `opt_last_update`,
`opt_anonymous_id`, plus the two consent flags. Every one is written with `httpOnly: false` (`:569`, the
comment reads "Need to be accessible to JavaScript for personalization"). They are emitted on the ordinary
event path, `src/routes/realtime.ts:209` and `:275`, from `RealtimeSegmentEngine.processActionEventWithSession`
(`src/services/RealtimeSegmentEngine.ts:1013`).

`src/services/RealtimeSegmentEngine.ts:886` reads those cookies back, and when no server-side record is found —
which is exactly the state an erasure leaves — the create branch at `:927`–`:932` **rebuilds the profile from
them**:

```ts
segments: cookies.segments ? cookies.segments.split(',').filter(Boolean) : userProfile.segments,
...
engagementScore: parseInt(cookies.engagementScore || '0') || calculateEngagementScore(userProfile.attributes),
lastSegmentUpdate: parseInt(cookies.lastUpdate || '0') || userProfile.lastUpdated
```

`POST /v1/:tenant/identity/erase` (`src/routes/identity.ts:175`–`:189`) sends no `Set-Cookie` at all. The
only route that clears them is `POST /identity/detach` (`src/routes/identity.ts:102`, using
`SessionManager.clearCookieHeaders()` at `:664`). So the erasure deletes the server's copy and leaves the
browser's.

### Reproduction

`/tmp/audit-verify/sweep-data-privacy-and-lifecycle/erasure-undo.ts` — the real `SessionManager` and
`RealtimeSegmentEngine` modules against an in-memory KV, performing exactly what `src/identity/erase.ts:48`
`eraseProfile()` performs on the session host (`resolveSessionIdByUserId` → `deleteSession` → `forgetVisitor`):

```
1. before erasure, keys: [ 'session:sess-1', 'user:vis-1' ]
2. cookies the platform set : opt_session_id=sess-1; opt_user_id=vis-1;
   opt_segments=high_value%2Ccart_abandoner%2Ctabby_intender; opt_engagement_score=87; ...
3. after erasure, keys      : []                      (receipt says: erased)
4. next page view → session : sess-1  isNew: true
   segments restored        : ["high_value","cart_abandoner","tabby_intender"]
   engagementScore restored : 87
   keys now                 : [ 'session:sess-1', 'user:vis-1' ]
RESTORED FROM THE BROWSER: true
```

### Consequence

Every erasure performed on the session host is reversible within one page view, and the reversal restores the
person's exact inferred audience list and engagement score — the profiling output, not merely an identifier.
Both stamps run the session host today (`wrangler.toml:231`, `:330`; audit 34 F14). The receipt has already
told the operator, and through them the data subject, that the person was erased. For a customer whose paper
calls right-to-be-forgotten foundational, this is the capability failing in its ordinary case, not in a corner
case: no redelivery, no race, no delay is required — just the shopper coming back.

A second consequence rides the same cookies. The platform's profiling output is published to the customer's own
page in a JavaScript-readable cookie that **nothing on the client reads** — a search of `public/` and `src/sdk/`
finds no reader of `opt_segments`, `opt_engagement_score` or `opt_user_id`; the only reader is the server
(`SessionManager.ts:646`–`:649`). Any third-party tag on a Coach page (advertising, chat, analytics) can read
the shopper's segment membership and engagement score, and every one of these cookies rides every request into
the customer's own CDN and web-server access logs.

### Remedy

1. On erasure, return the full `clearCookieHeaders()` set, and add an explicit instruction the SDK honours to
   drop `opt_visitor_id`/`opt_session` from `localStorage` and cookies (the SDK already rotates the visitor id
   on logout at `src/sdk/identify.ts:45`; erasure needs the same move plus a new id).
2. Stop treating cookie-borne `segments`, `engagementScore` and `lastUpdate` as profile inputs. The server's
   record is the authority; a cookie is at best a session pointer.
3. Mark every remaining cookie `httpOnly: true` except the ones the SDK genuinely reads, and re-verify that the
   SDK needs none of the profile fields.
4. Regression test: erase → same browser returns with the previous cookie jar → the profile must be empty and
   the receipt must remain true.

### Why this is not F04 or F06

F04 is about **logout** resurrecting the previous shopper through SDK session forwarding
(`src/sdk/identify.ts:45`, `RealtimeSegmentEngine.ts:886` accepting a supplied session,
`SessionManager.ts:324` following a forwarding record). F06's undo is a **server-side redelivery** of a queued
ledger message after the tombstone has been retired. Neither names the cookie mirror, neither names
`generateSessionCookies`, and neither observes that a deleted profile is restorable from the browser. Applying
F04's and F06's remedies exactly as written leaves this defect in place.

---

## P2 · Analytics Engine holds subject-level rows with IP, user agent, email and traits; nothing can erase them, and all three environments share one dataset

**Severity: blocks launch. Size: S–M.**

### Evidence

`src/routes/tracking.ts:33` (and the batch path at `:89`) writes one Analytics Engine data point per event whose
first blob is `JSON.stringify(enrichedEvent)` and whose index is `user.userId || user.anonymousId`. The enriched
event carries `getPageContext(c.req)` (`src/utils/context.ts:9`–`:26`), which is **the raw
`CF-Connecting-IP`, the User-Agent and the Referer**, and `user`, which per `src/types/events.ts:11`
`UserContextSchema` may carry `email` and arbitrary `traits`. `src/routes/pixel.ts:48` does the same for the
open-tracking pixel, indexed by `recipientId`.

Neither route is gated: `src/index.ts:85`–`:87` applies `sdkKey()` to `/realtime/*` and `/v1/:tenant/*` only,
and `src/routes/tracking.ts` and `src/routes/pixel.ts` contain no auth middleware of their own.

`src/identity/erase.ts:19`–`:20` states the opposite in a comment that the erasure receipt is built on:
"Analytics Engine holds aggregate points with no identifier worth erasing." The receipt's `notReached`
(`erase.ts:110`) lists ODP and nothing else.

Environment isolation: `wrangler.toml:126`, `:296` and `:391` each declare
`[[…analytics_engine_datasets]] binding = "ANALYTICS"` and **omit `dataset`**. Wrangler resolves the dataset as
`dataset ?? binding` — `node_modules/wrangler/wrangler-dist/cli.js:148647` — so development, staging and
production all write into one dataset named `ANALYTICS` in the same account, while every other binding in those
env blocks is redeclared against its own resource id.

### Reproduction

`/tmp/audit-verify/sweep-data-privacy-and-lifecycle/ae-pii.ts` — the real `trackingRoutes` module, one POST:

```
ANALYTICS points written: 1
  indexes : ["acct-7781"]
  blob[0] : {... "user":{"userId":"acct-7781","anonymousId":"vis-abc","email":"shopper@example.com",
             "traits":{"loyalty":"platinum"}},"page":{... "referrer":"https://mail.example/inbox/thread/9911",
             "userAgent":"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5)","ip":"203.0.113.44"}}
contains IP: true   contains user agent: true   contains referrer: true   contains email: true
```

### Consequence

Analytics Engine has no delete API. Rows written here can never be erased for a data subject, whatever the
erasure job does, and the erasure receipt asserts there is nothing there to erase. The rows are not
pseudonymous edge counters: they are an IP address, a device string, a referring URL, an email address and
free-form traits, indexed by the site's own account identifier. That is a direct failure of both the
data-minimisation and the right-to-be-forgotten halves of requirement §8.

Because the routes are ungated, any caller on the internet can also write rows into a customer's dataset under a
chosen account id, and a per-user `indexes` value defeats the dataset's own sampling design.

Because the dataset name is not distinguished per environment, demo traffic from `wrangler dev`, the staging
stamp the customer's lower environment connects to, and production all land in one dataset queried by one SQL
API token — contradicting brief 33 §4's "its own stores" for staging and production.

### Remedy

1. Stop writing payloads. Emit fixed, low-cardinality blobs (tenant, event name, outcome), index by tenant, and
   never place `ip`, `userAgent`, `referrer`, `email` or `traits` in a data point. The ledger's own points
   (`src/ledger/enqueue.ts:29`, `:41`) are the correct model and should be the only shape allowed.
2. Put `/track` and `/pixel` behind the same site-key gate as `/realtime/*`, or remove them from customer
   stamps entirely (they are the legacy demo pipeline; see the connector note below).
3. Add an explicit `dataset = "edge_platform_<environment>"` to all three `analytics_engine_datasets` blocks and
   confirm against the account's dataset list which dataset the deployed workers have been writing to.
4. Correct the comment at `erase.ts:19` and add Analytics Engine to `notReached` with the retention the account
   actually enforces, until item 1 makes the statement true again.

### Why this is not F06 or F01

F06 examined the decision and outcome points only and concluded, in terms, that there are no individual rows
there: "Reviewed decision/outcome Analytics Engine points omit visitor/session IDs; do not invent individual
rows there to erase." That conclusion is correct for `src/ledger/enqueue.ts` and wrong for the platform, and it
is the reason nobody has looked. F01 lists ungated routes (`cdp`, `sort`, `ai`, `aiScene`, `experiment`, the
agent router) but names neither `/track` nor `/pixel`, and draws an authentication conclusion, not a
retention/erasure one. No finding names the shared dataset.

---

## P3 · Every request writes identifiers into the log store, including requests where consent was refused

**Severity: blocks the pilot. Size: S.**

### Evidence

`src/index.ts:64` installs Hono's `logger()` on `'*'`. Hono's logger logs the path **and the query string** —
`node_modules/hono/dist/middleware/logger/index.js:33`, `const path = url.slice(url.indexOf("/", 8))` — twice
per request, on the way in and on the way out.

The shipped SDK's own decision call puts the identifiers in the query string:
`src/routes/decisions.ts:318`–`:321` reads `visitorId`, `sessionId`, `page`, `channel` from the query, and
`src/sdk/listen.test.ts:29` pins the URL the distributed SDK builds:
`…/v1/coach/decisions/snapshot?page=home&visitorId=…&sessionId=…&brand=coach&channel=paid%20social`.

`src/index.ts:275` logs whole queued message bodies — `console.log('Processing queued event:', event)` — which
for the `/track` and `/pixel` pipeline is the enriched event of P2, IP and email included
(`src/services/EventDispatcher.ts:150` enqueues it). `src/durable-objects/PersonalizationWebSocket.ts:146`,
`:150`, `:173` log `User ${userId} …`; `src/services/OptimizelyService.ts:279`, `:301`, `:325`, `:347`, `:412`
log `user ${userId}`.

`wrangler.toml:207`–`:209` sets `[observability] enabled = true, head_sampling_rate = 1`, so every line is
retained. There is no logger module in `src/utils/` and no redaction anywhere.

### Reproduction

`/tmp/audit-verify/sweep-data-privacy-and-lifecycle/log-pii.ts` — the real Hono logger, the SDK's real URL
shape, with consent refused in the cookie jar:

```
<-- GET /v1/coach/decisions/snapshot?page=home&visitorId=vis-9f2c1d84-…&sessionId=s-LT9Q4XB2&brand=coach&…
--> GET /v1/coach/decisions/snapshot?page=home&visitorId=vis-9f2c1d84-…&sessionId=s-LT9Q4XB2&brand=coach&… 200
lines containing the visitor id: 2 of 2
```

### Consequence

The log store is a per-visitor behavioural record — visitor id, session id, page, campaign channel, timestamp,
two lines per page view — and it is in no inventory: not in `EraseReceipt.notReached`, not in the ledger's
90-day rule, not in the kit, not in doc 22 §15. An erasure leaves it whole.

It also falsifies a sentence the customer has been given twice. `docs/kit/02-api-reference.md:104` and
`docs/kit/04-staging-connection.md:85` promise that a shopper who withholds consent gets the defaults "with
nothing written"; brief 33 §5.8 says "tracking off means nothing is written anywhere." The probe above refused
consent in the cookie header and the identifier was logged regardless, before any consent code runs.

Because the identifiers are in a URL rather than a body, they are also captured by anything in front of the
worker — the customer's CDN or WAF on a `personalize.brand.com` CNAME, and Cloudflare's own HTTP request
logging — where neither this platform's erasure job nor its retention constant has any reach.

### Remedy

1. Move `visitorId` and `sessionId` off the query string: accept them on a header (`X-Visitor-Id`) or make the
   snapshot a POST. This is an SDK and route change of a few lines and it removes the identifier from every log
   product at once.
2. Replace the blanket `logger()` with a request logger that emits method, route pattern, status and the request
   id — never the raw URL.
3. Delete `console.log('Processing queued event:', event)` and the `user ${userId}` lines, or route them through
   a redacting logger.
4. State the log retention in the kit next to the ledger's 90 days, and add logs to `notReached` until the
   identifiers are gone.

### Why this is not F10 or baseline item 22

F10 concerns release gates and what the monitor asserts. Baseline item 22 in audit 34's disposition table says
"Comprehensive redaction, retention, dashboard and runbook acceptance remains open" — a one-line status carried
forward from the August audit, with no evidence, no route, no consequence and no severity. Nothing in either
document identifies the URL as the leak, ties it to the shipped SDK's own call, or notices that the
consent-refusal promise in the customer kit is false for this reason.

---

## P4 · D1 is a personal-data store the erasure design never enumerated

**Severity: blocks the pilot. Size: M.**

### Evidence

`src/routes/realtime.ts:789` `captureDemoEvent()` inserts one row per action event into D1 `demo_events` with
`vuid` (the visitor id), `session_id`, `demo_run_id`, product, `path`, `label`/query, `dwell_ms` and
`raw_json` — "full payload (provenance incl. original source)", `:812`.

`demoEventCaptureEnabled()` at `src/routes/realtime.ts:778` returns true for any environment not literally named
`production`. `wrangler.toml:218` sets `ENVIRONMENT = "staging"` and declares no `DEMO_EVENT_CAPTURE`. Probe
`/tmp/audit-verify/sweep-data-privacy-and-lifecycle/d1-capture.ts`:

```
{"environment":"staging"}    → demo_events written to D1: true
{"environment":"production"} → demo_events written to D1: false
{"environment":"development"}→ demo_events written to D1: true
```

Staging is where the customer's lower environment connects (brief 33 §4).

The same database holds the profile mirror: `migrations/0001_d1_init.sql:147` `coach_odp_profiles` (`email`,
`first_name`, `last_name`, city, loyalty tier, lifetime value, predictions), `:213` `odp_events` — the comment at `:212` reads "ip = FULL ipv4" — and `:284` `odp_customers_authenticated` (`email`, `gender`, `job_title`,
CRM ids). `migrations/0002_demo_events.sql:87` joins `demo_events` into the `v_demo_profiles` view the chat and
audience surfaces read, so these rows are a profile, not a dead log.

`src/identity/erase.ts` contains **no reference to `env.DB`** (verified by grep: zero matches for `env.DB`,
`DEMO_EVENT`, `demo_events`). The receipt's `notReached` (`erase.ts:110`) names ODP only. The one delete that
exists — `src/routes/operator.ts:345`, `DELETE FROM demo_events WHERE source = 'demo' AND vuid = ?` — is the
demo-reset route and is never called by `eraseSubject`.

### Consequence

A subject erased through the documented API keeps a full, visitor-keyed behavioural history in D1: every product
view, search label, path and dwell, plus the raw client payload. The receipt says the opposite by omission —
it lists what could not be reached, and D1 is not on the list, so an operator answering a data-subject request
in writing will state something untrue. There is no retention rule on those rows either: nothing ages them out,
so the row count grows for the life of the stamp.

D1 is also the only store in the system whose schema carries names, email addresses and full IP addresses. It is
synthetic today; the §1.12 warehouse-mirror commitment is precisely the plan to fill it from the customer's
data.

### Remedy

1. Add D1 to `eraseSubject`: delete by `vuid` and by every linked visitor id, in the same transaction shape as
   the other stores, and report the result in `profiles`/`ledger`-style rows rather than silence.
2. Set `DEMO_EVENT_CAPTURE = "false"` explicitly in `[env.staging]` before the customer connects, and make the
   default deny rather than "any environment that is not named production".
3. Give `demo_events` a retention job (the 03:00 cron already exists) and state the window with the ledger's.
4. Until 1 lands, add D1 to `notReached` so the receipt stops asserting completeness it does not have.

### Why this is not F05, F06 or F11

F06 enumerates the stores erasure misses — the non-current reflex host, the legacy cached profile, the identity
link ordering, tombstone retirement, redelivery, the hourly `seen` map, `decisions.ts:270`, the rewrite cap —
and D1 is not among them; applying F06's remedy in full still leaves these rows. F05 cites the same capture call
but for **ordering against consent**, not for the row's lifecycle. F11 discusses D1 and the warehouse in terms
of scope closure (§1.12), not erasure or retention.

---

## P5 · No audit trail for privileged access to, or erasure of, an individual's data

**Severity: blocks the pilot. Size: S.**

### Evidence

`src/auth/store.ts:87` `audit()` writes `operator_audit`. Every caller is in `src/routes/auth.ts` —
`sign_in`, `sign_in_failed`, `sign_in_locked`, `sign_out`, `password_changed`, `account_created`,
`account_reset`, `account_removed`, `account_migrated`. That is the whole list.

Nothing is written when an operator token is used to:

| Route | What it exposes or does |
|---|---|
| `GET /v1/:tenant/visitors/:visitorId/receipts` (`decisions.ts:223`) | one named shopper's decision history with the reasons |
| `GET /v1/:tenant/visitors/:visitorId/recent` (`decisions.ts:270`) | the same, unfiltered |
| `GET /v1/:tenant/identity/visitor/:id`, `/identity/shopper/:id` (`identity.ts:120`, `:130`) | who this browser is; which browsers a person has |
| `POST /v1/:tenant/identity/resolve` (`identity.ts:108`) | account id → shopper id |
| `GET /v1/:tenant/ledger/batches`, `/ledger/:id` (`decisions.ts:355`, `:418`) | the raw export and single records |
| `POST /v1/:tenant/identity/erase` (`identity.ts:175`) | the erasure itself |

The erasure's actor is recorded only inside the pending tombstone. `src/ledger/erasure.ts:209`–`:213` builds the
`RetiredTombstone` from it and **drops `actor`**, then deletes the pending object at `:214`. After the nightly
rewrite there is no record anywhere of who ordered an erasure.

The retired record's `visitor_hash` is `visitorHash()` at `erasure.ts:68`, a 32-bit FNV-1a plus the id length,
carrying the comment "no way back to the id". It is not reversible, but it is trivially **confirmable**: anyone
with read access can test a candidate id in microseconds, and 32 bits collide long before a large brand's
erasure volume.

### Consequence

Brief 33 §5.10 offers "an audit table" as one of the controls behind operator accounts. It covers account
lifecycle only. A customer's security review will ask who read a named shopper's profile and who erased them;
today the honest answer is that nothing records it, and after 24 hours not even the erasure's actor survives.
Accountability is the one control that makes the others reviewable — without it, a leaked fifteen-minute token
(F02) or a mis-scoped operator (F03) leaves no trace to investigate, and a disputed erasure cannot be
reconstructed.

### Remedy

1. Write an `operator_audit` row for every route in the table above: actor, tenant, subject id (hashed with a
   keyed hash, not FNV), route, result, at. These are already authenticated, so the actor is in hand
   (`identity.ts:185` already extracts it for the tombstone).
2. Keep `actor` on the `RetiredTombstone`, and keep the retired records for the agreed accountability window.
3. Replace `visitorHash` with an HMAC under the identity salt, or say plainly in the comment that the value
   confirms membership and is therefore still subject-level.
4. Expose the audit as an operator-readable, paged surface; a table nobody can read is not a control.

### Why this is not F02 or F03

F02 is token semantics (refresh accepted as access, must-change-password not enforced). F03 is binding the
caller's authority to a tenant. Both are about **whether** a call is allowed; this is about whether an allowed
call leaves a trace. Neither names `operator_audit`'s coverage, and neither notices that the erasure actor is
destroyed by the rewrite.

---

## Checked and found clean

Stated so that the absence of a finding is itself evidence.

| Checked | Result |
|---|---|
| Ledger decision/outcome Analytics Engine points (`src/ledger/enqueue.ts:29`, `:41`) | Aggregate only — tenant, brand, page, slot, item, arm, cell values. No visitor or session id. Matches the design's claim; the P2 defect is elsewhere |
| Shopper id derivation (`src/identity/shopperId.ts:44`) | Salted with a secret, scoped by tenant, truncated to 128 bits, and `salted:false` is recorded on the link rather than hidden. Two brands cannot collide on one account id |
| `RegionTrend` (`src/durable-objects/RegionTrend.ts`, `IngestFrame`) | Carries tenant, region, touches, weight, timestamp. No visitor id, no session, as the header claims. The KV snapshot it publishes is counts |
| Lift snapshots and the day report (`src/learn/report.ts:151`, `src/learn/stats.ts`) | Aggregates. `report.ts:210` drops an erased visitor's rows at load |
| Tombstone honouring on read paths | Applied on `receipts` (`decisions.ts:237`), the point lookup (`:424`), replay (`:441`) and the export listing (`:360`–`:370`). `/recent` is the gap and F06 already names it |
| Erasure reachable from the identifier an operator actually has | `POST /identity/resolve` (`identity.ts:108`) turns an account id into a shopper id, so a data-subject request that arrives as an email address can be executed. No gap |
| Cookie transport attributes | `secure` defaults true (`SessionManager.ts:170`), `SameSite=Lax`, `Path=/`, and `opt_session_id` alone is `HttpOnly`. The transport is fine; the payload is the P1 problem |
| Durable Object retention | `ShopperReflex` has a real retention lifecycle — `REFLEX_RETENTION_DAYS`, default 30 (`ShopperReflex.ts:166`, `:792`) — and `MeridianReflex` a 7-day one. KV sessions carry a rolling 30-day `expirationTtl` |
| Operator credential storage (`migrations/0010_operator_accounts.sql`, `src/auth/store.ts:81`) | Sessions store a token hash, not a token; no IP or user-agent columns to retain |
| Third-party egress registry (`src/services/EventDispatcher.ts:47`, `src/services/CDPService.ts:59`) | Segment/Amplitude/Mixpanel destinations exist and would carry IP, email and traits with no consent gate and no tenant scope — but they load only from `WEBHOOK_ENDPOINTS`/`CDP_ENDPOINTS`, default to `enabled:false`, and `saveDestinations()` writes a KV key nothing reads. No runtime path adds a destination. Not a finding today; delete the seam or scope it per tenant before any customer stamp sets those vars |
| Consent default (`src/content/consent.ts:22`, "Absent means consenting") | A real opt-out default and wrong for an EU shopper — but F05's remedy already covers unknown/absent consent semantics, so it is not raised again here |
| R2 retention enforcement | `LEDGER_RETENTION_DAYS` is unset everywhere, the default 90 is a constant, and `src/ledger/erasure.ts:18` delegates deletion to a bucket lifecycle rule that no file in the repository configures — already covered by F06's closing sentence |

## Not verified, and what would close it

- **What is actually in the deployed Analytics Engine dataset.** I did not and could not query the account. The
  P2 defect is proven in source and in an isolated run; the volume already written to the shared `ANALYTICS`
  dataset by the staging and production workers needs an authorised SQL API query, and if `/track` or `/pixel`
  has taken live traffic, an assessment rather than a code fix.
- **Workers Logs retention on this account**, and whether Logpush is configured to a customer-visible
  destination. P3's remedy needs the number to write in the kit.
- **Whether `demo_events` on the staging stamp already holds rows from anyone real.** A `SELECT count(*)`
  against staging D1 would answer it; I ran no remote query.
- **The customer's lawful basis and their consent manager's behaviour**, which decide whether the opt-out
  default and the cookie mirror are tolerable at all.
