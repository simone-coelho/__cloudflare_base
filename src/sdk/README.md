# edge-personalization SDK

One package, a shared core and two modules. Browser-first; the contract is transport-level JSON, so a
native client is a port of `host.ts`, not a rewrite.

| Part | What it does |
|---|---|
| **Core** | First-party visitor identity (localStorage, cookie fallback, no fingerprinting), session boundaries, the entry signals, the WebSocket and the fetch transport, key auth |
| **Emit** | Four capture paths: explicit API, declarative `data-*` attributes, a dataLayer adapter, and automatic impressions for what the platform delivered |
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
  if (!d) return renderDefaultHero();          // nothing for this slot: your default, no waiting
  renderHero(d.customerContentId);             // your own content id
  client.emit.rendered('hero', d.contentId, heroElement);   // impression now, dwell while on screen
});

client.listen.hydrate({ page: 'home' });       // one request, every slot's decision, in page order
client.connect();                              // optional: live updates as the shopper acts
```

If the snapshot has not arrived within 1.5 seconds (configurable), `onDecisions` receives `null` and
your defaults stand. A late snapshot is still applied when it lands. The page never waits on us.

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
client.emit.declarative();   // impression when half on screen, dwell on leaving, click
```

**dataLayer adapter**, the cheap path wherever a tag layer already exists. GA4 event names are mapped by
default (`view_item`, `add_to_cart`, `add_to_wishlist`, `purchase`, `page_view`); override any of them.

```js
client.emit.dataLayer();                           // wraps window.dataLayer.push, replays what is already there
client.emit.dataLayer({ mapping: { my_event: (e) => ({ type: 'custom', data: { event: 'my_event', id: e.id } }) } });
```

**Automatic**, for what the platform delivered: `client.emit.rendered(slot, contentId, element)` sends the
impression once and measures dwell while the element is on screen.

## Listen-only mode

`createClient({ tenant, listenOnly: true })` keeps the SDK's own capture paths off, for a site that keeps
its existing analytics pipeline. The explicit API and the dataLayer adapter still send, because they are
that pipeline.

## What goes on the wire

Every event is one JSON envelope to `POST /realtime/action`: `type`, the visitor id, the session id, the
payload, the source, the entry signals captured once per page load, and a timestamp. Event types the
platform does not name first-class would travel as `custom` with the real event named in the payload, and
none do today: content interactions and the conversion event have been first-class since CW3; the mapping is one table in `wire.ts`, and a contract test parses every
row through the server's own validator.

Decisions arrive from `GET /v1/{tenant}/decisions/snapshot` at first paint and as `content_decisions`
frames over the socket. Each decision carries your content id, ours, the slot, the order, the score and
the drivers that produced it.

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
| `visitorIdKey` | `opt_visitor_id` | Storage key for the visitor id |

## Building

`npm run build:sdk` writes `public/sdk/edge-personalization.js` (script tag, global `EdgePersonalization`)
and `public/sdk/edge-personalization.esm.js` (module). Both run in `npm run dev` and `npm run deploy`.
Typecheck: `tsc -p src/sdk`. Tests run in Node against `memoryHost` with fakes; no browser is required.
