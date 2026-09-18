# edge-personalization SDK

One package, a shared core and two modules. Browser-first; the contract is transport-level JSON, so a
native client is a port of `host.ts`, not a rewrite.

| Part | What it does |
|---|---|
| **Core** | Server-issued shopper capability (endpoint/tenant-scoped storage, no cookie authority), browsing-session attribution, entry signals, authenticated fetch and WebSocket transport |
| **Emit** | Explicit API, declarative `data-*` attributes, dataLayer, and authenticated rendered admission after the renderer reports actual paint |
| **Listen** | First-paint hydration from the snapshot, per-slot subscriptions, and guaranteed graceful absence |

## Install

```html
<script src="/sdk/edge-personalization.js"></script>
<script>
  const client = EdgePersonalization.createClient({ tenant: 'coach', brand: 'coach' });
</script>
```

or, as a module:

```js
import { createClient } from '/sdk/edge-personalization.esm.js';
const client = createClient({ tenant: 'coach' });
```

## Ten lines that personalize a homepage

```js
const client = createClient({ tenant: 'coach', brand: 'coach' });

client.listen.subscribe('hero', (decisions) => {
  const d = decisions[0];
  if (!d) return renderDefaultHero();
  try {
    if (renderHero(d.customerContentId) !== true) return renderDefaultHero();
  } catch { return renderDefaultHero(); }
  void client.emit.rendered('hero', d.contentId, heroElement, d.decisionId);
});

void client.listen.refresh({ page: 'home' }); // supported coalesced refresh
client.connect();                           // optional updates; reconnect also refreshes
```

Here `renderHero` synchronously resolves your CMS ID and returns `true` only after the matching,
eligible asset has actually painted in `heroElement`. Missing, deleted or cross-category assets
return `false`; lookup/render failure returns `false` or throws. Each refusal restores your default
and sends no render acknowledgement or correlated outcome. A pending Promise is not success: an
asynchronous renderer must check that the receipt is still current before painting and acknowledge
only that completed paint. Keep `renderDefaultHero` independent of the failed CMS lookup.

On failure or the 1.5-second deadline (configurable), slot subscribers receive `[]` with the requested
page, `onDecisions` receives `null`, and `current()` becomes `null`. Capture from the previous delivery
is cancelled; default rendering does not create an impression. A later slot subscriber receives that
known absence too; subscribing before any delivery remains silent. A successful empty set remains a set.
The latest `hydrate()` or `apply()` supersedes older requests and timers. A timed-out request may still
apply its own late result if nothing newer has superseded it.

`listen.refresh({page})` permits one active snapshot and one coalesced pending latest intent; stale page/owner/consent responses cannot repaint. Acknowledged non-impression/non-dwell interactions and socket connection/reconnection refresh automatically. Route changes call `refresh({page})`. Optional publication polling is the third `createClient` argument, for example `createClient(config, undefined, {refreshMs:5000})` (off by default; clamp1s–5min). `hydrate` is a direct one-shot. No production `content_decisions` push is promised.

Customer snapshots are read-only offers: receiving or polling a choice creates no behavioral, ledger or learning exposure. Explicitly publish `slots.{slot}.measurementBasis: 'rendered-v1'` for new rendered measurement, with durable recovery and approved original ledger/online retention. Missing basis remains historical `served-v1`; switching a used slot requires compatible config/reset-generation handling, not relabeling or mixing old counters/priors.

A current tracked choice carries `decisionId` and opaque `renderOffer`. After actual paint, `await client.emit.rendered(slot, contentId, element, decisionId)` returns `{version:1, decisionId, eventId, pageInstance, status:'durable', source:'pending'|'recovered'}` or null. This ACK proves owner-durable source admission, not completed sinks or human visibility. On null, retry the same paint: the SDK retains its original envelope, ID and timestamp, with at most three attempts. Unchanged placement and asset retain the painted receipt across polls; changed asset/page/owner invalidates it.

`client.emit.contentClick(id, slot, {decisionId})`, dwell and supported custom/data-layer aliases wait for that exact ACK, with no uncorrelated fallback to a newer offer. Three-argument `rendered()` resolves only one matching current choice. Declarative attributes alone cannot mint an offer. Never log/export/store `renderOffer`; the transport strips it before ordinary behavior/debug/egress. Original item/slot/session/time and consent checks remain. Current report computation is version4; legacy1–3 remain historical, never pooled with incompatible bases.

Keep defaults in the initial HTML and restore them on `[]`; asynchronous client refresh can repaint defaults. For server-first paint use the delivered server-side source module `src/sdk/server.ts`, not a browser global or a claimed published npm artifact:

```js
import { createServerBridge, bootstrapJSON } from './src/sdk/server.ts';
const bridge = createServerBridge({ tenant: 'coach', origin: 'https://shop.example',
  endpoint: 'https://platform.example', sdkKey: '<site key>' });
// Mount your same-origin POST /shopper-broker handler as bridge.broker(request).
const { bootstrap, headers } = await bridge.snapshot(request, 'home');
headers.set('Content-Type', 'text/html; charset=utf-8');
// Your existing renderer maps customerContentId and supplies its own defaults.
return new Response(renderPage(bootstrap, bootstrap ? bootstrapJSON(bootstrap) : null), { headers });
```

Forward the helper's Set-Cookie, private/no-store and Vary:Cookie headers; never share-cache this HTML. The HttpOnly first-party cookie resolves the canonical current grant/consent before HTML. Render exactly one element per choice with `data-op-page-instance`, `data-op-slot`, `data-op-content`, `data-op-position` and `data-op-decision-id`. Embed only `bootstrapJSON(bootstrap)` inside an inert `application/json` script; never embed bearer, full receipts or profile. The host's `renderPage` must escape its own HTML attributes/content.

Create the browser client with `sessionBroker:'/shopper-broker'`, register the usual default/slot callbacks, then `await client.listen.adopt(parsedBootstrap, {page:'home'})`. Matching current grant/tenant/endpoint/page/deadline and complete DOM adopt without subscriber repaint and admit the rendered elements. On false, defaults are restored; call `refresh({page:'home'})`. Bare `apply(serverPayload)` is not authenticated SSR adoption. Real host SSR/browser/no-flash and latency acceptance remain open.

## The four capture paths

**Explicit API**, for commerce. The conversion event is the one that outcome learning cannot do without.

```js
client.emit.productView('SKU-123', { line: 'Drover', category: 'Outerwear', occasion: ['everyday'], price_usd: 395 });
client.emit.addToCart('SKU-123');
client.emit.purchase({ orderId: 'A1B2', value: 395, currency: 'USD', items: [{ productId: 'SKU-123', quantity: 1, price: 395 }] });
```

The attributes on a product event are the registry's source fields (by default `line`, `category`,
`subcategory`, `silhouette`, `occasion`, `price_usd`). Where the scope is set to score event-carried
attributes, they move affinity directly against your own catalog; a product the platform holds itself is
scored from that copy instead.

**Declarative**, for slot-level capture without code per slot:

```html
<section data-op-slot="story" data-op-content="cnt_8f3a" data-op-type="editorial">…</section>
<button data-op-track="add_to_cart" data-op-product="SKU-123">Add to bag</button>
```

```js
client.emit.declarative();   // content capture still requires a current offer and rendered ACK
```

**dataLayer adapter**, the cheap path wherever a tag layer already exists. GA4 event names are mapped by
default (`view_item`, `add_to_cart`, `add_to_wishlist`, `purchase`, `page_view`); override any of them.

```js
client.emit.dataLayer();                           // wraps window.dataLayer.push, replays what is already there
client.emit.dataLayer({ mapping: { my_event: (e) => ({ type: 'custom', data: { event: 'my_event', id: e.id } }) } });
```

**Renderer callback:** `rendered(slot, contentId, element, decisionId)` admits the exact painted choice, then observes dwell. Listen-only suppresses this admission; ordinary commerce/page events remain separate, but content outcomes cannot bypass the missing ACK.

## Signing in and out

The visitor id is anonymous until the site says who the person is. At login, call `identify` with the
account id; the edge links the browser's visitor id to the person and answers with the person's shopper
id, which the browser carries as its visitor id from then on. Every later event and decision is the
person's, and the realtime channel reconnects under the new id so pushes reach the right object.

```js
// after the site's own login succeeds
const r = await client.identify(account.id, {
  source: 'login',
  getAssertion: ({ tenant, visitorId, accountId }) => obtainBackendProof({ tenant, visitorId, accountId }),
});
if (r.ok) console.log('carrying', r.shopperId);

// at logout: detach, take a fresh anonymous id, reconnect under it
await client.logout();

client.on('identity', ({ visitorId, previous, reason }) => { /* 'identified' or 'logout' */ });
```

`assertion` is an HMAC the site's backend computes at login over the tenant, the visitor id, the account
id and `exp` (unix seconds, at most 24 hours ahead) with the site's identity secret; `signAssertion()` in
`src/identity/assertion.ts` is the reference. Every link requires configured backend proof in every mode;
the public site key alone is insufficient. `obtainBackendProof` above is the site's own authenticated
backend integration, not an SDK-provided endpoint. `getAssertion` may return `{ assertion, exp }` directly
or asynchronously; it takes precedence over static `{ assertion, exp }` options without falling back
if it fails. Static proof remains supported for a single attempt.

On 409, only a provider-backed call may detach and retry once, after successful transport/application
detach and a new proof for the fresh visitor. Static-proof 409 returns without detach or retry. A changed
visitor or local generation while awaiting proof or a response is rejected; callback errors return fixed error text.
`retried: true` means the second link request was sent. Logout rotates local visitor/profile authority
and browsing attribution; failed detach discards the old local grant. Local generation checks also
discard stale action/hydration/socket results and clear private decision caches at transition start.
These checks do not revoke copied unexpired grants, other tabs, or already admitted server effects.
The full contract is in
`docs/architecture/25-identity-stitching.md`.

## Listen-only mode

`createClient({ tenant, listenOnly: true })` keeps the SDK's own capture paths off, for a site that keeps
its existing analytics pipeline. The explicit API and the dataLayer adapter still send, because they are
that pipeline.

## What goes on the wire

The SDK first coalesces `POST /v1/{tenant}/identity/session`. The server generates anonymous subject
and profile-session IDs; old visitor cookies, profile mirrors and caller-selected IDs confer no authority.
`await client.core.ready()` makes the verified visitor available before obtaining static backend proof.
The bounded, non-JWT capability is stored per endpoint/tenant, sent as `X-Shopper-Session` together with
`X-Tenant`, and carried in the WebSocket subprotocol, never the URL. Page-hide delivery uses authenticated
keepalive fetch instead of headerless beacon. Missing signing configuration refuses the lane.

Socket URLs contain only `?tenant=...`; the independent site key travels as the bounded canonical
`sdk-key-v1.<base64url UTF-8>` subprotocol beside `shopper-session-v1` and the capability. These headers
remain sensitive. This transport change and locally disabled persistent logs do not erase historical logs.

`sessionId` on wire requests is the signed profile locator. `browsingSessionId` is separate, untrusted
attribution only: it retains the existing thirty-minute idle lifecycle and is shared by decisions and
outcomes. `client.sessionId` remains that browsing ID; `client.core.profileSessionId` is the profile ID.
Neither cookie IDs nor browsing IDs can select another profile. Bespoke legacy callers must migrate;
there is no open-mode bypass on these guarded routes. This is not full engine/customer isolation.

Every event is one JSON envelope to `POST /realtime/action`: `type`, the visitor id, the session id, the
payload, the source, entry signals read lazily while capture is permitted, and a timestamp. Event types the
platform does not name first-class would travel as `custom` with the real event named in the payload, and
none do today: content interactions and the conversion event have been first-class since CW3; the mapping is one table in `wire.ts`, and a contract test parses every
row through the server's own validator.

`listen.hydrate()` requests `POST /v1/{tenant}/decisions/snapshot`, with page/brand/channel/entry and
browsing attribution in JSON rather than the URL. Subject/profile identity comes only from the bearer.
The existing consent acknowledgment, expiry and stale-response fences still apply. The listener also accepts
`content_decisions` frames for compatibility, without promising a production sender; supported delivery is coalesced `listen.refresh`. Each decision carries your content id, ours, the slot, order, score and drivers.
Generic HTTP/socket updates reject finite timestamps older than this identity generation's high-water.
Equal-time distinct payloads still deliver; exact pre-callback JSON echoes at the high-water are retained
up to 32 entries and 65,536 UTF16 units, with FIFO eviction. Oversized/unserializable payloads bypass echo caching;
absent/nonfinite timestamps retain legacy delivery without resetting the high-water. Reconnect does not
reset it; identity transition does. Serialization differences or eviction can admit echoes, and clock
rollback can suppress legitimate updates: this is not a causal sequence or exactly-once guarantee.
Superseded update callbacks stop; `core.send()` returns `null` for rejected/superseded updates while
acknowledged `sent`/receipt events remain independent. Snapshot polls are read-only; only exact rendered acknowledgement admits the offered exposure.

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `tenant` | required | The scope decisions are made for |
| `brand` | tenant | Recorded on every decision |
| `endpoint` | page origin | Platform base URL |
| `sdkKey` | none | Sent on every request; enforced server-side |
| `source` | `sdk` | Names the caller on every event |
| `listenOnly` | false | See above |
| `heartbeatMs` | 25000 | Socket keepalive |
| `reconnectMs` | 3000 | Socket reconnect delay |
| `hydrateTimeoutMs` | 1500 | Graceful-absence deadline |
| `sessionBroker` | absent | Same-origin POST broker for server-first-paint grant continuity |
| `visitorIdKey` | `opt_visitor_id` | Storage key for the visitor id |

## Building

`npm run build:sdk` writes `public/sdk/edge-personalization.js` (script tag, global `EdgePersonalization`)
and `public/sdk/edge-personalization.esm.js` (module). Both run in `npm run dev` and `npm run deploy`.
Typecheck: `tsc -p src/sdk`. Tests run in Node against `memoryHost` with fakes; no browser is required.
# Withdrawal continuity

Tracking and personalization start OFF. Legacy booleans and cookie/body `true` do not authorize either purpose. Each explicit switch choice has its own server-issued 30-day deadline; bootstrap, browsing, retries, link/logout and partial updates do not renew omitted choices. Missing or expired authority is OFF, including before asynchronous callbacks or capture. Necessary identity and default-content requests remain available.

Logout, session reset and account linking carry the original scoped choice deadlines on both hosts. Replacement anonymous state contains no previous account profile. Failed logout and invalid saved-grant recovery retain only restrictions, scoped to endpoint and tenant. Each switch's browser refusal mirror has an independent expiry no later than its original deadline; no perpetual localStorage choice copy is written. Clearing or blocking all client storage across reloads cannot preserve a client marker.

Explicit cookie refusal and acknowledged session/action/snapshot refusal gate capture before payload, page-entry, dataLayer or DOM reads and before behavioral transport. Withdrawal clears dwell and impression state; refused events are dropped, never replayed after re-enable. Default hydration and necessary identity operations continue. Tracking-only measurement remains available when personalization refusal is acknowledged. Until a failed local personalization withdrawal is acknowledged through the existing preferences, session or false-hint snapshot response, events are temporarily dropped because the action endpoint cannot carry that refusal itself.

After `await client.core.ready()`, use `client.core.postJson('/realtime/session/preferences', { trackingConsent: false, personalizationEnabled: false })` for immediate local withdrawal. The exact current-SID legacy path is translated to this principal-only alias; stale or conflicting selectors are refused. The SDK adds current-grant/operation metadata and reuses a pending same-payload operation after a lost reply; only a current exact successful acknowledgment can enable requested true switches. A new explicit choice after an acknowledged operation gets a new operation ID. Missing fields, failures, stale responses and cookie true never enable. A corresponding old false cookie is expired on successful enable; if it remains false, capture stays restricted. Shared refusal is checked at use time, including before each private callback. Already-transmitted bytes cannot be recalled. Behavioral retention, broader privacy policy and live browser/customer acceptance remain separate.
