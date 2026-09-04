# Integration Guide

This is the document your front-end engineers integrate from. It assumes a page that renders its own
content by id and a tag layer or an event stream you already own. Everything here runs against the
platform as it stands today; the request shapes are in the [API reference](./02-api-reference.md).

## 1. What the integration is

Three things move between your page and the platform.

- **Events go up.** What the shopper did: viewed a product, added to bag, bought, saw a piece of content, clicked it. One JSON request per event.
- **Decisions come down.** For each slot on a page, which of your content items to show, in order, with the reason. One request at first paint, then live updates over a socket if you want them.
- **Identity stays first-party.** A visitor id the SDK mints and keeps in your site's storage. At sign-in your page tells us the account; from then on the browser carries the person's id.

The page never waits on us. If a decision has not arrived within a deadline you set, your default renders, and a late decision is applied when it lands.

## 2. Install

One script, served from the platform host we give you. No dependencies.

```html
<script src="https://<platform-host>/sdk/edge-personalization.js"></script>
<script>
  const client = EdgePersonalization.createClient({
    tenant: 'coach',                       // the brand scope decisions are made for
    brand: 'coach',                        // recorded on every decision
    endpoint: 'https://<platform-host>',   // omit when the platform is on your own hostname
    sdkKey: '<your site key>',             // identifies the site; not a secret
    source: 'coach-web',                   // names your integration on every event
  });
</script>
```

As a module:

```js
import { createClient } from 'https://<platform-host>/sdk/edge-personalization.esm.js';
```

**Where the platform lives matters for cookies.** The platform keeps its own first-party cookies on
its host, and it does not depend on them: the visitor id travels in every request, so the integration
works when the platform is on a different host from your page. The preferred production topology is
still a subdomain of your site routed to the platform, so every call is first-party; then `endpoint` is
that subdomain and nothing else changes.

## 3. The ten lines that personalize a page

```js
client.listen.subscribe('hero', (decisions) => {
  const d = decisions[0];
  if (!d) return renderDefaultHero();                     // nothing for this slot: your default, no waiting
  renderHero(d.customerContentId);                        // your own content id, looked up in your CMS
  client.emit.rendered('hero', d.contentId, heroElement); // impression now, dwell while on screen
});

client.listen.hydrate({ page: 'home' });                  // one request, every slot's decision, in page order
client.connect();                                         // optional: live updates as the shopper acts
```

`decisions` is the list for that slot, in order. Each item carries your `customerContentId`, our
`contentId`, the `slot`, the `order` on the page, the `score`, the `strategy` (`affinity` when the
shopper's interests decided, `default` when nothing was known yet, `tenant-pinned` when your
merchandiser pinned it) and `explain.drivers`, the interests that produced it. Render by your id; keep
ours for the events you send back.

If the snapshot has not arrived within 1.5 seconds (`hydrateTimeoutMs`), `onDecisions` receives
`null` and your defaults stand.

```js
client.listen.onDecisions((set) => { if (!set) showDefaults(); });
```

## 4. Sending events: four ways, pick per page

**Explicit calls**, for commerce. The conversion event is the one outcome learning cannot do without.

```js
client.emit.productView('SKU-123', { line: 'Tabby', category: 'Handbags', occasion: ['everyday'], price_usd: 395 });
client.emit.addToCart('SKU-123');
client.emit.wishlistAdd('SKU-123');
client.emit.purchase({ orderId: 'A1B2', value: 395, currency: 'USD', items: [{ productId: 'SKU-123', quantity: 1, price: 395 }] });
```

The attributes on a product event are the registry's source fields for your brand, agreed in the first
working session (by default `line`, `category`, `subcategory`, `silhouette`, `occasion`, `price_usd`). A
product the platform already holds from your feed is scored from that copy; attributes on the event are
used where the brand's registry says so.

**Declarative attributes**, for slot-level capture without code per slot:

```html
<section data-op-slot="story" data-op-content="cnt_8f3a" data-op-type="editorial">…</section>
<button data-op-track="add_to_cart" data-op-product="SKU-123">Add to bag</button>
```

```js
client.emit.declarative();   // impression when half on screen, dwell on leaving, click
```

**Your data layer**, the cheapest path where a tag layer exists. GA4 event names are mapped by default
(`page_view`, `view_item`, `add_to_cart`, `add_to_wishlist`, `purchase`); override or add any of them.

```js
client.emit.dataLayer();   // wraps window.dataLayer.push and replays what is already there
client.emit.dataLayer({ mapping: { my_event: (e) => ({ type: 'custom', data: { event: 'my_event', id: e.id } }) } });
```

**Automatic**, for what the platform delivered: `client.emit.rendered(slot, contentId, element)` sends
the impression once and measures dwell while the element is on screen. A click on a served piece is
`client.emit.contentClick(contentId, slot)`; it is the reward the slot learns against by default.

**Listen-only.** `createClient({ tenant, listenOnly: true })` keeps the automatic and declarative paths
off for a site that keeps its own analytics pipeline. The explicit calls and the data layer adapter
still send, because they are that pipeline.

## 5. Sign-in and sign-out

The visitor id is anonymous until your page says who the person is.

```js
// after your own login succeeds
const r = await client.identify(account.id, { source: 'login', exp, assertion });
if (r.ok) console.log('carrying', r.shopperId);

// at logout: detach, take a fresh anonymous id, reconnect under it
await client.logout();

client.on('identity', ({ visitorId, previous, reason }) => { /* reason is 'identified' or 'logout' */ });
```

On success the browser carries the person's shopper id as its visitor id from then on, every later
event and decision is the person's, and the live channel reconnects under the new id.

`assertion` is how your backend proves the sign-in happened. At login it computes an HMAC-SHA256, with
the brand's identity secret we exchange with you, over this exact string, four lines joined by a
newline:

```
<tenant>\n<visitorId>\n<accountId>\n<exp>
```

`exp` is a unix time in seconds, at most 24 hours ahead; the result is base64url without padding. Put
`{ accountId, exp, assertion }` on the page after login. Until your brand has a secret, the page may
call `identify(accountId)` bare and the link is recorded as site-assured rather than verified.

If the browser still carries the previous person's id, the platform refuses with 409 and the SDK logs
that person out and links once more with a fresh id; the result says `retried: true`.

## 6. The live channel

`client.connect()` opens a socket under the visitor id. What arrives:

| Frame | When | What to do |
|---|---|---|
| `personalization_update` | after a shopper's own action, and when the platform re-evaluates | `client.on('update', (u) => …)`: segments, module decisions, the interest vector |
| `content_decisions` | when the platform re-decides a page | applied through `listen` like the first snapshot; your slot subscribers fire again |
| `audience_published` | a merchandiser published an audience the shopper qualifies for | `client.on('audience', …)` |
| `odp_receipt` | the customer data platform acknowledged an event | `client.on('receipt', (r, { via }) => …)` |

A shopper's own action is answered in the request's response and echoed on the socket; the SDK applies
it once. The socket is optional; the snapshot at first paint and the response to each event are enough
for a page that does not want a live channel.

## 7. Content: what the engine chooses from

The engine chooses among your content items, tagged on the same dimensions your products carry. Items
arrive through the content catalog, a versioned document per brand, from a JSON feed we pull or a CSV
you export, in the shape in the [payload schemas](./03-payload-schemas.md#the-content-piece). Each
item names the slots it may fill, the tags it carries, its lifecycle and, optionally, a publish window
and season, promotion and margin signals. Your merchandiser's slot document names the slots on each page
and the weight of each dimension in each slot, and can pin an item to a slot. Both documents are
versioned: every change has an author and a note, and a rollback is a new revision.

## 8. What to test before the freeze

Run these on your staging origin, against the platform staging host, before M5.

1. **A cold page.** A fresh browser, the page loads, every slot renders your default or the platform's default lead within the deadline you set.
2. **Decisions by id.** `hydrate` resolves; each slot's `customerContentId` exists in your CMS; the page renders it.
3. **Events.** Product view, add to bag and a purchase each return HTTP 200 with `success: true`.
4. **The loop.** View a product, reload the page: the hero follows the interest. Click the served hero: within about forty seconds the click shows as a success on that item in the learning console.
5. **Sign-in.** `identify` returns `ok: true` and a shopper id; the socket reconnects; events after it carry the shopper id. `logout` returns a fresh anonymous id.
6. **Graceful absence.** Block the platform host in the browser's network tools: the page renders defaults and nothing waits.
7. **The connection check.** `scripts/verify-origin.sh` from inside your network prints PASS on every line.

## 9. Configuration reference

| Option | Default | Meaning |
|---|---|---|
| `tenant` | required | The brand scope decisions are made for |
| `brand` | tenant | Recorded on every decision |
| `endpoint` | page origin | Platform base URL |
| `sdkKey` | none | Sent on every request; enforced on staging and production |
| `source` | `sdk` | Names the caller on every event |
| `listenOnly` | false | Section 4 |
| `heartbeatMs` | 25000 | Socket keepalive |
| `reconnectMs` | 3000 | Socket reconnect delay |
| `hydrateTimeoutMs` | 1500 | The deadline after which defaults stand |
| `visitorIdKey` | `opt_visitor_id` | Storage key for the visitor id |
