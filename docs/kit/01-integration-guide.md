# Integration Guide

## Current signed tag/debug handoff

Bootstrap with `POST /v1/{tenant}/identity/session`; use its signed capability, subject and session, not caller-invented IDs. Send the site key, tenant and `X-Shopper-Session`. Record an explicit consent choice using the original choice ID, expected consent revision and signed grant fields. Cookies can refuse consent, never grant it.

Use this reusable tag-plan as the handoff checklist. Assign each named owner and replace “integration pending” only with a retained site-specific observation; these rows do not claim customer installation.

| Page type | Event / required facts | Method | Accountable owner | Status / acceptance |
|---|---|---|---|---|
| All / route change | `page_view`, real page type | SDK `send` after signed bootstrap and explicit consent | Customer tag owner | Integration pending; one event per real navigation |
| Product detail | `product_view`, real product ID | SDK `send` | Commerce feed + tag owners | Integration pending; IDs match catalog |
| Category / search | Product interaction, product ID/action | SDK `send` | Customer search/tag owner | Integration pending; preserve original event identity on retry |
| Content-bearing pages | `content_impression` / `content_click`, returned content/decision ID and slot | SDK content lifecycle helpers or `send` | Customer rendering owner | Integration pending; observe real rendering/action, not ranking alone |
| Content-bearing pages | `content_dwell`, finite nonnegative `ms` in milliseconds (`dwellMs` compatible) | SDK content observation, teardown on navigation | Customer rendering owner | Integration pending; exact duration retained |
| Order confirmation | `purchase`, order, currency, finite value/margin and actual items | SDK `send` from confirmed business event | Commerce / analytics owners | Integration pending; business units and duplicate-order semantics signed off |
| Login / logout / consent UI | Current signed capability and explicit choice/link operation | SDK identity/consent lifecycle | Identity + privacy owners | Integration pending; discard stale replies and rehydrate on generation change |

Load optional `/sdk/debug.js` after the SDK and call `EdgePersonalizationDebug.attach(client, {enabled:true, element:document.querySelector('#debug'), limit:50})`. Keep the returned handle and call `dispose()` on component/route teardown. It retains only bounded dispatch/response counts, closed transport states and latency: no IDs, tokens, raw events, URLs, queries or private affinity. It performs no network/persistence and does not turn a dispatch into a consumption receipt.

Generic NL search uses dedicated `/search`, not supplied-candidate `/sort`. Real feed IDs, stock, price/currency, gift eligibility and entitlement remain hard constraints. Ordinary serving is model-free. Product Rec entitlement and SFCC D4/rendering remain accountable commercial/customer evidence. Optional no-additional-cost widgets/templates are handed over when available; no January widget construction is implied.

External models are off by deployment. The Worker setting `EXTERNAL_MODEL_POLICY` is `off` in every environment `wrangler.toml` declares, and `off` is its only deployed state: it is the only value this build implements, an absent, empty or any other value is read as `off`, and a customer stamp, whose variables the stamp workflow sets from a fixed list, deploys it absent, which is `off`. No value, and nothing in a published document, turns a model on. With it off, a content decision, a product sort and a replay call no model URL, service binding or Workers AI and read no `ext:` key. A learn document stored before this rule that names a model (`external`) is still served, with that term withdrawn: a weighted receipt names the withdrawn term with `status: "unavailable"` and `reason: "external scoring disabled by deployment policy"`. Every publication of a learn document that names one is refused with 422 naming `external` — an edit and `POST learn/items/reset`, which republishes the current document, included; a rollback answers 404 with the same error — and the refusal changes nothing: the operator removes the term in the console first (the [payload schemas](./03-payload-schemas.md#the-learn-document) list every such write). No offline external table is published: the platform has no route or job that publishes a model's score table, and nothing reads one. `POST /v1/{tenant}/models/reference`, the reference implementation of the model contract, answers an operator token of the tenant only, and no decision calls it.

This is the document your front-end engineers integrate from. It assumes a page that renders its own
content by id and a tag layer or an event stream you already own. Everything here runs against the
platform as it stands today; the request shapes are in the [API reference](./02-api-reference.md).

## 1. What the integration is

Three things move between your page and the platform.

- **Events go up.** What the shopper did: viewed a product, added to bag, bought, saw a piece of content, clicked it. One JSON request per event.
- **Decisions come down.** For each slot on a page, which of your content items to show, in order, with the reason. Supported coalesced snapshot refresh after acknowledged interactions and reconnect, with optional publication polling.
- **Identity stays first-party.** The server issues the signed session, subject and session ID; the SDK stores and presents that capability. Account linking requires the supported authenticated identity flow, not a caller-invented replacement ID.

The page never waits on us. If a decision has not arrived within a deadline you set, your default renders, and a late decision is applied when it lands.

## 2. Install

One script, served from the platform host we give you. No dependencies.

```html
<script src="https://<platform-host>/sdk/edge-personalization.js"></script>
<script>
  const client = EdgePersonalization.createClient({
    tenant: 'coach',                       // the brand scope decisions are made for
    brand: 'coach',                        // recorded on every decision, sent as data.brand on every event
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

**Pinning a release.** Each release is also served under a path that names its version. The file at a
versioned path never changes, so the platform serves it with
`Cache-Control: public, max-age=31536000, immutable` and a browser keeps it for a year without asking
again:

```html
<script src="https://<platform-host>/sdk/0.2.0/edge-personalization.js"></script>
```

```js
import { createClient } from 'https://<platform-host>/sdk/0.2.0/edge-personalization.esm.js';
```

The unversioned paths above always serve the release the host runs and are revalidated on every load,
so a fix reaches your pages with no change on your side. A host serves the versioned path of the release
it runs and no earlier one: after an upgrade the previous version's path answers 404. Pin a version only
where your page's URL changes in the same release window as the host; everywhere else use the
unversioned path.

**As a package, in your own build.** The kit includes the SDK as the package `edge-personalization`
(the directory `packages/sdk`): the same ES module and script-tag build, with TypeScript declarations.
It is not on a package registry yet; publication, and the name or scope it is published under, is a
release step agreed with you. Until then install it from the delivered directory
(`npm install <path to packages/sdk>`), and import it by name:

```js
import { createClient } from 'edge-personalization';

const client = createClient({
  tenant: 'coach',                       // the brand scope decisions are made for
  brand: 'coach',                        // recorded on every decision, sent as data.brand on every event
  endpoint: 'https://<platform-host>',   // omit when the platform is on your own hostname
  sdkKey: '<your site key>',             // identifies the site; not a secret
  source: 'coach-web',                   // names your integration on every event
});
```

`ClientConfig`, `Client`, `ContentDecision` and the other types in this guide are exported from the same
name. `import 'edge-personalization/iife'` loads the script-tag build for its `EdgePersonalization`
global instead. The package's `version` is the SDK version (`client.VERSION`), the one in the versioned
paths above.

**Where the platform lives matters for cookies.** The platform keeps its own first-party cookies on
its host, and it does not depend on them: the visitor id travels in every request, so the integration
works when the platform is on a different host from your page. The preferred production topology is
still a subdomain of your site routed to the platform, so every call is first-party; then `endpoint` is
that subdomain and nothing else changes.

## 3. The ten lines that personalize a page

```js
client.listen.subscribe('hero', (decisions) => {
  const d = decisions[0];
  if (!d) return renderDefaultHero();
  try {
    if (renderHero(d.customerContentId) !== true) return renderDefaultHero();
  } catch { return renderDefaultHero(); }
  void client.emit.rendered('hero', d.contentId, heroElement, d.decisionId);
});

void client.listen.refresh({ page: 'home' });  // paints the first answer; defaults stand at the deadline
client.connect();                              // optional updates; opened during the first answer, one refresh after it
```

The first line asks for the page view's first answer and paints it when it arrives; if nothing has
arrived by the deadline the defaults stand, and a later answer still paints. The second line opens the
optional live channel. Opening it while that first answer is in flight does not cancel the answer: the
answer is painted and acknowledged first, then the page refreshes exactly once.

Here `renderHero` synchronously resolves your CMS ID and returns `true` only after the matching,
eligible asset has actually painted in `heroElement`. Missing, deleted or cross-category assets
return `false`; lookup/render failure returns `false` or throws. Each refusal restores your default
and sends no render acknowledgement or correlated outcome. A pending Promise is not success: an
asynchronous renderer must check that the receipt is still current before painting and acknowledge
only that completed paint. Keep `renderDefaultHero` independent of the failed CMS lookup.

`decisions` is the list for that slot, in order. Each item carries your `customerContentId`, our
`contentId`, the `slot`, the `order` on the page, the `score`, the `strategy` (`affinity` when the
shopper's interests decided, `default` when nothing was known yet, `tenant-pinned` when your
merchandiser pinned it) and `explain.drivers`, the interests that produced it. Render by your id; keep
ours for the events you send back.

Customer snapshots are read-only offers: receiving or polling a choice creates no behavioral, ledger or learning exposure. Explicitly publish `slots.{slot}.measurementBasis: 'rendered-v1'` for new rendered measurement, with durable recovery and approved original ledger/online retention. Missing basis remains historical `served-v1`; switching a used slot requires compatible config/reset-generation handling, not relabeling or mixing old counters/priors.

A current tracked choice carries `decisionId` and opaque `renderOffer`. After actual paint, `await client.emit.rendered(slot, contentId, element, decisionId)` returns `{version:1, decisionId, eventId, pageInstance, status:'durable', source:'pending'|'recovered'}` or null. This ACK proves owner-durable source admission, not completed sinks or human visibility. On null, retry the same paint: the SDK retains its original envelope, ID and timestamp, with at most three attempts. A painted receipt is keyed by slot, position within the slot (`slotPosition`, from 0, as the delivered list orders the slot) and item. An unchanged placement and asset keep the painted receipt across polls even when the page-wide `order` shifts, so a change in one slot's selection never repaints or re-receipts another slot; the same item at another position within its slot is a new placement, repainted with the receipt of the answer that moved it; a changed asset, page or owner invalidates the receipt.

`client.emit.contentClick(id, slot, {decisionId})`, dwell and supported custom/data-layer aliases wait for that exact ACK, with no uncorrelated fallback to a newer offer. Three-argument `rendered()` resolves only one matching current choice. Declarative attributes alone cannot mint an offer. Never log/export/store `renderOffer`; the transport strips it before ordinary behavior/debug/egress. Original item/slot/session/time and consent checks remain. Current report computation is version4; legacy1–3 remain historical, never pooled with incompatible bases.

`listen.refresh({page})` permits one active snapshot and one coalesced pending latest intent; stale page/owner/consent responses cannot repaint. While the socket is connected the engine sends the page view's decision set as a `content_decisions` frame whenever it changes from what the page view last received (after an admitted action, a buffered delivery or a publication change), and nothing is asked again; the page's own request is answered in its response and never also sent, and an unchanged set is not sent. Without a connected socket an acknowledged non-impression/non-dwell interaction refreshes over HTTPS, and a page view's first list is always its `POST` snapshot request. While the first snapshot of a page view is in flight such an interaction does not cancel it: its answer is painted, then exactly one refresh follows, however many of them arrived; during any later snapshot they coalesce as the page's own `refresh()` calls do. Route changes call `refresh({page})`. Optional publication polling is the third `createClient` argument, for example `createClient(config, undefined, {refreshMs:5000})` (off by default; clamp1s–5min). `hydrate` is a direct one-shot.

**The first decision on the first request.** A new visitor's first decision set arrives on one call: when the browser holds no session of its own, no return-recognition proof and no return in flight, the first `hydrate` (or `refresh`) sends the decision request without a session, and the engine issues the session with that answer, as `session`, so no separate round trip to `/identity/session` comes first. The session it issues is the one `POST /v1/{tenant}/identity/session` would have issued that browser, with the same consent default, and the SDK keeps and uses it exactly as it keeps that route's. That one request carries only the page, its page instance, the brand and the refusals the browser already holds: the browsing session, the channel, the arrival (`entry`) and `customerId` are sent from the next request on, once the shopper's consent choice allows tracking. A browser that already holds a session or a recognition proof, and a client configured with a `sessionBroker`, take the session route first as before, and the SDK falls back to the session route, then the decision request, when an answer carries no session. On the server, `bridge.snapshot(request, page)` serves a new visitor (no session cookie and no recognition-proof cookie) from that one call to the engine and sets the shopper's session cookie from the answer; the session never enters the bootstrap, and an answer without a session falls back to the session call, then the decision request, as before.

On snapshot failure, or at the 1.5-second deadline (`hydrateTimeoutMs`) when nothing has arrived, every
slot subscriber receives `[]` with the requested page, `onDecisions` receives `null`, and `current()`
becomes `null`. The deadline is a hard ceiling measured from the page view's first snapshot request: no
re-ask restarts it, so by then the page has the decisions or `[]`. A later answer still paints, and a
re-ask after the first paint leaves the page as it is until its own answer arrives; its failure restores
the defaults. Existing dwell capture is cancelled; restoring defaults does not create an impression. Late slot subscribers
receive known absence too; a subscription before any delivery stays silent. A successful empty set
remains a set, with `[]` for each slot. Measured on the acceptance pair (both shopper hosts), by release
c6d33c73 (lane L15) and 92a7132e (lane L17): a new visitor's first answer, through the first request, took
0.3–2.7 s, and 10 of 24 passed 1.5 s; the first answer of a page view that already holds a session took
about 0.45 s typically; the session route alone (`POST /v1/{tenant}/identity/session`) took about 1.3 s
typically and up to 3.1 s from a browser. The hosted stamps are not yet measured for this. At the deadline
every subscriber has the page's defaults, and the engine's late answer then paints when it arrives. A
returning browser takes the session route first, inside the same deadline. A cross-origin page also pays
the browser's preflight before its calls (up to 1.4 s measured), which a page served through your server
bridge (`bridge.snapshot`) avoids.

**Holding a layout for the page view.** `const release = client.listen.hold('layout')` holds that slot as it
was last delivered, for the page view in progress. A later answer of the same page view (after an
acknowledged interaction, a reconnect or a poll) does not repaint it: its subscribers are not called with
another list, a late subscriber receives the held one, and its painted receipts stay valid, so `rendered`
and the clicks, dwell and other correlated outcomes of a held module carry the `decisionId` it was painted
and acknowledged with, although the newer answer moved or dropped the module. Every other slot keeps
following the answers. Calling `release()` ends the hold, and so does a new page view (another page, or a
new page instance); a release does not repaint by itself: the next answer the page receives repaints the
slot (call `refresh()` to ask for one at once). A hold never holds back known absence: a consent refusal,
an identity change or a failed answer still restores the defaults. Made before the first `refresh` or
`hydrate`, or after an identity change, a hold holds nothing. A new page view begins with a `hydrate` or `refresh` that names another page, another channel or another product (`productId`, your product identifier, the value your product events carry; a `refresh` that names no `productId` after one that named one counts as another product, as a missing channel does): it has its own page instance, deadline, holds and receipts. A cached layout's report for another product is reported under its own page instance. A variant switch of the same product (`variantId` changed, `productId` the same) and a re-ask (`refresh()`, or the SDK's own after an acknowledged event) do not begin one. The SDK sends `productId` as the decision request's `ctx.anchor`, and `variantId` beside it as `ctx.variant`, each trimmed and only when it is 1 to 64 characters after trimming: a `productId` outside that bound sends neither, and the page view is served as one without an anchor; a `variantId` outside it is dropped alone.

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

Forward every one of the helper's Set-Cookie headers, and its private/no-store and Vary:Cookie headers; never share-cache this HTML. The broker and the snapshot helper can set two cookies: the session cookie and, when your tenant publishes broker-mode return recognition, `__Host-opt-continuity-<tenant>`, which carries the recognition proof and is relayed back to us only on a return the SDK names an operation for. The HttpOnly first-party cookie resolves the canonical current grant/consent before HTML. Render exactly one element per choice with `data-op-page-instance`, `data-op-slot`, `data-op-content`, `data-op-position` and `data-op-decision-id`. Embed only `bootstrapJSON(bootstrap)` inside an inert `application/json` script; never embed bearer, full receipts or profile. The host's `renderPage` must escape its own HTML attributes/content.

Create the browser client with `sessionBroker:'/shopper-broker'`, register the usual default/slot callbacks, then `await client.listen.adopt(parsedBootstrap, {page:'home'})`. Matching current grant/tenant/endpoint/page/deadline and complete DOM adopt without subscriber repaint and admit the rendered elements. On false, defaults are restored; call `refresh({page:'home'})`. Bare `apply(serverPayload)` is not authenticated SSR adoption. Real host SSR/browser/no-flash and latency acceptance remain open.

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
const detach = client.emit.declarative();   // authenticated offer + rendered ACK still required
```

**Your data layer**, the cheapest path where a tag layer exists. GA4 event names are mapped by default
(`page_view`, `view_item`, `add_to_cart`, `add_to_wishlist`, `purchase`); override or add any of them.
A GA4 item's `item_brand` is the product's brand label and is sent as `productBrand`, never as
`data.brand`: that member is the brand the page was served under, and only the client's `brand` option
sets it (see the configuration reference).

```js
const release = client.emit.dataLayer();   // wraps window.dataLayer.push and replays what is already there
client.emit.dataLayer({ mapping: { my_event: (e) => ({ type: 'custom', data: { event: 'my_event', id: e.id } }) } });
```

**Binding and unbinding.** Both calls return a detach function, and the SDK owns what it put on your page
until you run it. Binding the same document twice — a route re-render, React StrictMode's double-invoked
effect — joins the attachment already live, so the element keeps one listener and one observation and the
first call's options stand; the page's elements come back when the last detach function has run. Detach
removes listeners with `removeEventListener` and disconnects observers rather than muting them, so a node
your framework reuses is left clean. A node re-rendered in place does not need rebinding: what it reports
is read from its attributes when the shopper acts, so a changed `data-op-slot` or `data-op-content` reports
the piece the node now shows (the served receipt in `data-op-decision-id` is read once, when the SDK binds).
The tag layer is the page's: `push` is wrapped once however many clients capture from it, each live client
sees a push once, and your own `push` function comes back only when the last attachment is released, so
releasing one never removes another's. A consent tool or tag manager that wraps `push` after the SDK did
and calls through to what it found keeps working and sees each push once; one push is still exactly one
event for each live client, and the last release hands back the chain you put on the page. `client.destroy()`
releases whatever the client still holds — its listeners, its observations, its declarative scans and its
tag-layer capture — so `destroy()` before the detach functions and the detach functions before `destroy()`
both leave the page with no live listener, wrapper, observer or pending callback and nothing reaching the
platform afterwards, even if you kept none of the detach functions.
After a sign-in or a switch to another tenant, the element carries one listener again and later events
carry only the new identity.

**Renderer callback:** call `rendered(slot, contentId, element, decisionId)` only after paint. Content clicks and dwell await that receipt; ordinary commerce events are separate.

**Listen-only.** `listenOnly:true` disables rendered admission and declarative capture. Explicit commerce/page/data-layer events remain available; the current SDK does not bypass the missing render ACK for content outcomes.

**Thresholds and event conventions.** Each threshold below is either the platform's or one your page sets, and
each event travels exactly as written here.

- **The viewable impression, `content_viewable`.** The SDK measures it and your page never sends it. Once a
  piece's render acknowledgement is held, a container reported at least half in view for one second without
  interruption sends one `content_viewable` per piece per page instance, carrying `contentId`, `slot`,
  `slotPosition`, `decisionId`, `page`, `pageInstance` and `position` (the page-wide order). The second is
  continuous: leaving view, a detach, `destroy()`, a consent refusal or a new identity generation cancels it, and
  with the declarative capture the next time in view starts a new second; a container in view for less than a second
  at a time, or never half in view, sends none. A piece acknowledged through `rendered(slot, contentId, element)` is
  measured only while the SDK observes that element, until it first leaves view: a second time in view sends none
  there, so mark module containers for the declarative capture. It weighs 0 whatever your registry says, builds no interest and counts no exposure, so
  what a slot learns from is unchanged. A renderer that measures visibility itself reports it with
  `client.listen.visible(slot, contentId, inView, decisionId)`; `client.emit.track('content_viewable')` sends nothing.
- **The video view, `video_view`.** Call `client.emit.videoView(contentId, slot)` when your player has played
  three seconds of the painted piece, beside `client.emit.videoComplete(contentId, slot)` at its end. It waits for
  the piece's render acknowledgement, as a click does, and builds interest in the piece's format as your catalogue
  names it (`tags.contentType`), at the weight your registry publishes for it (`weights.video_view`, 1 in the shipped
  registry); a registry that names no `video_view` weight weighs it 0, as it weighs every action it does not name.
- **A dwell minimum per slot, `dwellMinMsBySlot`.** A dwell is sent when a piece leaves view after its minimum on
  screen, one second by default (`dwellMinMs`). `client.emit.declarative({ dwellMinMsBySlot: { 'pdp-editorial': 30000 } })`
  holds a named slot to its own minimum (here 30 seconds on editorial) while every other slot keeps one second;
  `createClient(config, host, { dwellMinMsBySlot })` does the same for `rendered()` with an element.
- **The product dwell, `product_dwell`.** Once per product view, when the shopper has stayed on the product page
  past 20 seconds, send `client.emit.track('product_dwell', { productId: 'SKU-123', dwellMs: 21000 })`. Its `dwellMs`
  feeds the visit's dwell counter your journey thresholds read (`category_dwell_ms`); it is captured at weight 0.
- **A purchase is unique per `orderId`.** A second purchase naming an `orderId` this shopper's purchase already named is answered `200` with `dropped: "duplicate_order"` and writes no outcome, no credit and no interest.
  The same event sent again (the same `eventId`) is not a second purchase, and a purchase without an `orderId` is
  never deduplicated.
- **Search, `search`.** Send `client.emit.custom('search', { category: 'Handbags', line: 'Tabby' })` with what your
  search resolved the query to, in your registry's source fields: the resolved values only, never the query text.
- **Filters, `filter_applied`.** Send `client.emit.custom('filter_applied', { dimension: 'category', value: 'Handbags', category: 'Handbags' })`:
  the facet's dimension and value, with the value also in the registry's own source field. The sale filter and the sale page both send `filter_applied` with `dimension: 'priceStatus'`, `value: 'sale'` and `priceStatus: 'sale'`, raising `priceStatus` sale.
- **Removing from the bag, `remove_from_cart`.** Send `client.emit.custom('remove_from_cart', { productId: 'SKU-123' })`;
  it is captured at weight 0 until the negative-signal release (P39) gives it a meaning.
- **Their registry values.** The shipped registry weighs `video_view` 1 and `content_viewable` 0, and names no
  weight for `search`, `filter_applied`, `remove_from_cart` or `product_dwell`, so each of those is captured at
  weight 0 until your registry publishes one (`weights.search`, `weights.filter_applied`). An event's own values,
  such as a search's resolved `category` or the sale filter's `priceStatus`, build interest only where your
  registry names that source field as a dimension and scores event attributes (`eventAttributes: "event-when-unknown"`).

### Before sign-in: the loaded hook and your identifier for the shopper

```js
client.core.onLoaded(() => {
  // runs once, when the client has loaded
});
client.core.setCustomerId(hashedId);   // your hashed identifier for this shopper, before sign-in
```

`client.core.onLoaded(callback)` runs `callback` once, when the client has loaded (its first session is in hand), or once at the next turn when the client had already loaded; a callback that throws changes nothing of the client, and registering one never starts a call.

`client.core.setCustomerId(id)` passes your own identifier for the shopper before recognition: a hashed identifier, such as a SHA-256 digest of the e-mail address, of 1 to 128 letters, digits and `_ + / = . -`, so a raw e-mail address is refused. While tracking is allowed, every event the SDK sends and every decision request it makes then carries it as `customerId`, beside the engine's own visitor identifier, and the decision and outcome records written from them carry it as `customer_id` beside `visitor_id`. The `customerId` is carried, never treated as proof of identity: it links nothing, merges nothing, issues no recognised session and selects no other shopper's state, even when an account is linked under the same value. Signing in still takes `identify()` with your backend's signed assertion, below; the link's answer then names, as `customerId`, the identifier this browser carried before it (absent when it carried none), while the link itself is the signed account's. Any other value clears the identifier, as does a logout; the SDK holds it in memory for the page and never stores it.

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
`{ accountId, exp, assertion }` on the page after login. Linking requires the configured backend signature; there is no unsigned/site-assured customer fallback. The customer identity/SSO handoff remains required; supported refresh and conditional same-grant SSR are locally implemented; customer browser acceptance remains open.

If the browser still carries the previous person's id, the platform refuses with409. Static `{exp, assertion}` proof is never reused for another visitor and does not trigger retry. To support one safe retry, supply `getAssertion: async ({tenant, visitorId, accountId}) => …` that obtains fresh backend-signed `{exp, assertion}` for those exact values. Only after a successful detach does the SDK call that provider again for the new visitor and retry once; the result then says `retried:true`.

### The account identifier's format, and a change of identifier

Your account identifier may take a fixed form: an identifier your site assigns at a shopper's first
landing, and later one derived from the shopper's e-mail address (a hash of it) once it is known.
Declare those forms as `accountIdFormat` on the reflex document with `PUT /config/reflex`, no deployment:
`{ "firstLanding": "^…$", "hashedEmail": "^…$" }`, at least one of the two, each the source of a regular
expression anchored with `^` and `$` that a whole identifier must match ([API reference](./02-api-reference.md#account-identifier-format-and-identifier-changes)).
A link whose account identifier matches none of the declared forms is refused with `400`, naming
`accountIdFormat`, and nothing is linked or merged; a tenant that declares no format links any
identifier exactly as before.

When the shopper's identifier changes from one form to the other, your backend signs an `accountChange`
statement over both identifiers, and the page passes it to identify() with the link's own proof:

```js
const r = await client.identify(hashedEmailId, { source: 'login', getAssertion,
  accountChange: { from: firstLandingId, exp, statement } });
```

`statement` is an HMAC-SHA256, base64url without padding, with the same identity secret, over five lines
joined by a newline, where `to` is the account identifier you pass to identify():

```
<tenant>\naccount-change\n<from>\n<to>\n<exp>
```

`exp` is a unix time in seconds, at most 24 hours ahead. The two accounts' profiles merge only on an
`accountChange` statement that verifies, and the merge never overrides either profile: both histories
are kept and added, each decayed by its age, so what the shopper does now still outranks both. A
statement that is missing, names another pair of identifiers, is signed with a secret the tenant does
not hold, has expired or expires more than 24 hours ahead is refused with `401`, naming the account
change, and nothing is linked or merged. The earlier account's profile is merged once: the SDK sends
`accountChange` unchanged on every link request of the call, the retry after a `409` and a detach
included, and the same statement presented again merges nothing more while the sign-in itself is
accepted. The earlier account keeps its own profile.

### Your experiments and the engine's audiences: the second ODP identifier

An experiment on your experimentation platform can target the audiences the engine builds in two ways.
Neither path creates anything in ODP: the engine never creates an ODP field, segment or audience on your
behalf, so your ODP owner defines the identifier field and builds any segment on the engine's fields.

**The page-side path** needs no setting. On the page, pass the engine's segments and interest values to
your experimentation user context as attributes, and build the experiment's audience on those attributes.
Every engine update carries them (`client.on('update', …)`): `segments` lists the segments the shopper
qualifies for, and `affinity.dims` holds the interest values, one number in `[0, 1)` per dimension and
value. Updates arrive only while the shopper allows personalization, so the attributes follow that choice.

```js
// `user` is your experimentation SDK's user context for this visitor; each attribute name is one your
// experimentation project defines before an audience can use it.
client.on('update', (u) => {
  if (Array.isArray(u.segments)) user.setAttribute('edge_segments', u.segments.join(','));
  for (const [dimension, values] of Object.entries(u.affinity?.dims ?? {})) {
    for (const [value, score] of Object.entries(values)) user.setAttribute(`edge_${dimension}_${value}`, score);
  }
});
```

**The second ODP identifier** lets a segment built in ODP on the engine's fields reach your experiments
through an identifier your experimentation platform resolves. Your ODP connector configuration
(`TENANT_CONNECTORS`, the tenant's `odp` object) names that identifier field as `secondIdentifier`, with
no page change. Where your ODP connector configuration names `secondIdentifier`, the engine writes the
shopper's hashed account identifier into that field beside its own vuid only when the shopper has signed
in through the verified link above and the person's record holds the link's account identifier. That is
the `accountId` your backend signed, so link with your hashed account identifier (declaring its form as
`accountIdFormat` keeps any other form out); an earlier identifier an `accountChange` names, and the
`customerId` a page carried before sign-in, are never written to ODP. The person's record keeps it only
under the shopper's tracking consent, from a sign-in made while the setting is configured; a person who
signed in before you configured it gets it at the next sign-in, and an erasure removes it. Every other
write is exactly as before ([API reference](./02-api-reference.md#the-second-odp-identifier-odpsecondidentifier)).

## 6. The live channel

`client.connect()` opens a socket under the visitor id. What arrives:

| Frame | When | What to do |
|---|---|---|
| `personalization_update` | after a shopper's own action, and when the platform re-evaluates | `client.on('update', (u) => …)`: segments, module decisions, the interest vector |
| `content_decisions` | the engine sends the open page view's decision set whenever it changes from what the page view last received (after an admitted action, a buffered delivery or a publication change); never the answer to the page's own request, never an unchanged set | applied through `listen` like the first snapshot, under the page view's holds; your slot subscribers fire again |
| `audience_published` | a merchandiser published an audience the shopper qualifies for | `client.on('audience', …)` |
| `odp_receipt` | the customer data platform acknowledged an event | `client.on('receipt', (r, { via }) => …)` |

A shopper's own action is answered in the request's response and echoed on the socket; the SDK applies
generic updates through the same freshness guard on both transports. Finite timestamps below the current
identity generation's high-water are rejected; equal-time distinct payloads still deliver. Exact
pre-callback JSON echoes at the high-water are remembered up to 32 entries / 65,536 UTF16 units, with FIFO eviction;
oversized/unserializable payloads bypass echo caching. Missing/nonfinite timestamps keep legacy delivery
without resetting the high-water. Identity transition resets it; reconnect does not. Key serialization,
eviction and bypass can admit echoes; clock rollback can suppress valid updates, so this is neither a
causal sequence nor exactly-once delivery. Superseded update listeners stop, and `core.send()` returns
`null` for rejected/superseded updates without undoing independent sent/receipt acknowledgments.
With a connected socket the engine sends `content_decisions` whenever the open page view's decisions change, and the SDK asks nothing again on an acknowledged interaction or a reconnect; a set naming another page view is not drawn. The page's first list, a refresh the page calls, and every page without a connected socket are asked over HTTPS (`POST` snapshot); snapshots alone create no exposure.

## 7. Content: what the engine chooses from

The engine chooses among your content items, tagged on the same dimensions your products carry. Items
arrive through the content catalog, a versioned document per brand, from a JSON feed we pull or a CSV
you export, in the shape in the [payload schemas](./03-payload-schemas.md#the-content-piece). Each
item names the slots it may fill, the tags it carries, its lifecycle and, optionally, a publish window
and season, promotion and margin signals. Your merchandiser's slot document names the slots on each page
and the weight of each dimension in each slot, and can pin an item to a slot. Both documents are
versioned: every change has an author and a note, and a rollback is a new revision.

Tag values are free text until your brand approves an attribute vocabulary: a versioned list of the values
each attribute may take, each an id with your display name and the words your source systems send for it
(`PUT /content/vocabulary`, then approved on the console's Vocabulary screen or with
`POST /content/vocabulary/approve/{n}`; [API reference](./02-api-reference.md#the-attribute-vocabulary-contentvocabulary),
[schema](./03-payload-schemas.md#the-attribute-vocabulary)). From the approval on, a feed or an event may keep
sending its own words: each is mapped through the vocabulary's mapping table to the value's id, an id passes
unchanged, and a value the vocabulary does not list refuses the catalogue publication (naming the item and the
tag) or, on an event, builds no interest and is counted in your rejection report
(`GET /content/vocabulary/rejections`). Send ids where you can; list every other spelling as a synonym.

### A page's layout: modules in one declared slot

A page's modules (a category grid, recommendations, a styling story, reviews and the like) are content
items too: each is registered in the content catalog with its own `id`, its kind as `type` and the
journey stages it is made for as `journeyStageFit`, and names the layout slot in its `slotTypes`. Your
merchandiser declares the page's layout as one slot of the slot document, marked `layout: true` in a
document marked `governanceVersion: 4`, at most one per page. Its `take` is the number of positions K
(1 to 50), and the registered modules that name the slot are its M candidates, M at least K. Each
decision returns up to K module ids for that slot, in rank order, with eligibility (lifecycle, publish
window, stock), the slot's exclusions and page-wide de-duplication applied; with nothing known about the
shopper yet, they are the first K eligible modules in catalogue order. When fewer than K modules are
eligible, the slot returns only those, never a filler.

The list the layout slot returns is the layout's sequence: draw the modules in that order, one container
per position. A module that is not returned is not drawn, and its container stays hidden. Every drawn
module is acknowledged with `client.emit.rendered(slot, contentId, element, decisionId)` once it has
actually painted, exactly as section 3 describes for any slot, and a module that failed to paint is not
acknowledged. This contract is about a decision that answered: when the snapshot fails or misses its
deadline, the subscriber receives `[]` and your page's own default layout stands, as for every slot.

Measure the layout slot on `rendered-v1`: publish `slots.{slot}.measurementBasis: 'rendered-v1'` for it in
the learn document, so a module that was drawn and acknowledged is one exposure, however often its
acknowledgement is retried, and a module that was returned but never drawn, or not returned, is none. A
layout slot left on `served-v1` is still served, but carries no render offer and is never counted as an
exposure; the engine's decision set names that mismatch internally (`layoutDiagnostics`), and the
snapshot answer does not carry it.

### Modules with nothing to show, and eligibility rules

Only your page knows when a module has nothing to show for this page view (a recently-viewed rail on a
first visit, a reviews block for a product without reviews), so the page says so when it asks for the
page's decisions:

```js
void client.listen.refresh({ page: 'pdp', nothingToShow: ['module.PDP.reviews.1'] });
```

The SDK sends the ids on the decision request as one JSON-encoded string field, `nothingToShow`, and sends
nothing when the list is empty. A module named in `nothingToShow` is withheld before ranking, so it is not
returned, not recorded and never counted as an exposure, and the slot fills its positions from the
remaining ranked modules. The report can only withhold, never add: an id naming a module that is not
eligible, excluded by the slot or not registered changes nothing.

A module may also carry its own eligibility rule in the catalogue, `eligibleWhen`, by region (a region key
such as `US-NY`, or a country such as `US`, which admits every region inside it), entry channel
(`entry_channel`, among the six channel words, or your own channel ids when your tenant publishes a context
vocabulary), visit bucket (`visit_bucket`: `1`, `2-3` or `4+`, or the names of your own visit-bucket cut) and
journey stage (`journey_stage`: `exploring`, `considering` or `deciding`), and every condition it names
must hold ([schema](./03-payload-schemas.md#the-content-piece)). The engine evaluates the rule on its own
reading of the decision (the region the edge reports, the visit's entry channel, its visit bucket and the
shopper's journey stage), never on a value your page sends. The rule fails closed: an unknown value
satisfies no rule, so a module whose rule names a region is withheld while the shopper's region is
unknown, and a module without a rule is unaffected. Publication refuses a rule that names any other
signal, or a value outside its signal's words, naming the rule and the word. On the layout slot, a module
withheld from a position the layout would otherwise have filled is named in the layout reason with its
cause, `nothing_to_show` or `eligibility_rule`; a pinned module that is withheld refuses its pin, as an
expired one does.

### Module impressions and engagements

Mark each module container the way the declarative capture marks any piece, `data-op-content` with the module id
and `data-op-slot` with the layout slot, on the element that holds the module, and bind the page once with
`client.emit.declarative()`. A container may also declare the interactions that count as using the module, as
DOM event types, space separated, in `data-op-engage`:

```html
<section data-op-slot="pdp-modules" data-op-content="module.PDP.reviews.1" data-op-engage="swipe reviews-open">…</section>
```

- **The impression.** A marked module container sends one impression per module per page instance, when it is
  first on screen. That impression is the module's render acknowledgement, the `content_impression` this guide
  describes in section 3, never a second event: a repeated visibility, a re-subscribe, a redelivered decision
  set, or your own `rendered()` call over the same container sends no other.
- **The engagement.** A click anywhere inside the container is one engagement, and so is each interaction the
  container declares in `data-op-engage`, each time it happens: your own code dispatches the event (bubbling) on
  the container or inside it, as a carousel dispatches `swipe`. `click` needs no declaration, and an interaction
  the container does not declare sends nothing. An engagement is a `content_click`, the slot's click reward: it
  carries the module id as `contentId`, the `slot`, the `decisionId` of the module's render acknowledgement and
  the position within the slot as `slotPosition`, and for a declared interaction its name as `interaction`. It waits for that acknowledgement, so a module that was never drawn and acknowledged is
  never engaged and never credited.
- **The position within the slot.** Every decision the snapshot returns carries `slotPosition`, the module's
  position within its slot (what its decision record calls `position`), beside its page-wide `order`; the
  acknowledgement carries both (`position` is the page-wide order), every engagement carries `slotPosition`, and
  the outcome record of an engagement keeps the module id, the slot, the position within the slot and the
  decision. The SDK carries `slotPosition` exactly as the decision names it and never computes one: a decision
  adopted from the server-rendered bootstrap names none, and its acknowledgement is admitted on `position` as
  before.
- **The viewable impression.** Once its impression is acknowledged, a module container at least half in view for
  one second without interruption sends one `content_viewable` per page instance (section 4, thresholds), carrying
  the module id, the slot, `slotPosition` and the decision of its acknowledgement; less than a second at a time
  sends none. It weighs 0, builds no interest and is never an exposure: the slot's exposures are its
  acknowledgements, as above.
- **Declared interactions of the module that owns them.** A size guide or a reviews panel opened inside a module is
  that module's engagement: declare `data-op-engage="sizeguide:open reviews:open"` on its container and dispatch the
  event, bubbling, from inside it when the shopper opens one (`new Event('sizeguide:open', { bubbles: true })`, or
  `reviews:open`). Each is one `content_click` naming `interaction: "sizeguide:open"` or `"reviews:open"`.
- **Consent.** Without the shopper's tracking consent, and in `listenOnly` mode, a marked container sends none of them.

### A cached layout: one answer per context

Where your front end caches a page's layout, your merchandiser can switch the page's declared layout slot to
context-only with `contextOnly: { enabled: true }` on that slot of the slot document (a `governanceVersion: 4`
member), which is off by default: absent, or `enabled: false`, the slot is decided exactly as before. Adding
`region: true` admits the shopper's region into the context. Publication refuses the switch on any slot but the
page's declared layout slot, naming `contextOnly` and the slot
([schema](./03-payload-schemas.md#the-context-only-layout-switch)).

A context-only slot is decided for its context and never for the shopper: the page, the entry channel, the visit
bucket, the device class the request reports (`mobile` or `desktop`, none when the request reports neither) and,
where admitted, the region. The shopper's interests, journey stage and fatigue play no part, nor does a seed rule
on a signal outside the context (only `entry_channel` and `device` rules fire), and a module's eligibility rule is
read on the context alone. Its learned lift answers from the channel and visit bucket or coarser, and its
exploration is drawn from the context and the hour, so every shopper of one context, decided within the same hour,
receives the identical order. A per-context order that names a device serves that device's shoppers, and one that
names none serves every device. The regional population prior applies only where the region is admitted, as for a
shopper with no interest. A shopper on the holdout's default arm, or without consent, receives the slot's default
variant.

Every answer for such a page carries the `X-Context-Key` response header, a non-identifying context key built from
the page, the channel, the visit bucket, the device and, where admitted, the region, or naming the page's default
variant, with a seal the engine adds; it never holds a visitor, session or decision identifier, or the user agent.
Every shopper of one context gets the same key. The decision response itself stays `Cache-Control: no-store`: the
caching is your front end's, keyed on that header.

A page drawn from your cache tells the engine what it drew, so learning counts the exposure: call
`client.listen.layoutExposure({ contextKey, page, slot, modules })` once per page view, with the key the cached
layout was answered under and the module ids drawn, in drawn order. The SDK sends it as the `layout_exposure`
action only under the shopper's tracking consent, once per page view and slot, and asks for no decisions because
of it. The engine adds one exposure per drawn module to that context's learning (its channel and visit bucket; the
device is no learning level), and adds nothing for a beacon sent without tracking consent, with a key it did not
issue, or repeated for the same page view. Only a layout slot measured on `rendered-v1` counts it.

A carousel the head script ordered before paint (below) is counted the same way: call
`client.listen.carouselExposure({ tableVersion, context, page, slot, images, arm })` once per page view, with the
values the head script wrote on the root element (`data-op-table`, `data-op-context` and `data-op-arm`), the page,
the carousel slot and the image ids in painted order. The SDK sends it as the `carousel_exposure` action only under
the shopper's tracking consent, once per page view and slot, and asks for no decisions because of it. The engine
adds one exposure per painted image to that context's learning when the table version is the one in force, the
context is one that version carries and its own assignment of the shopper is an arm that learns (the page's `arm` is
reported, never trusted); it adds nothing otherwise. A page cached from the table's stable address before a
publication carries a version no longer in force for up to a minute, and its beacons count nothing (`stale_table`).
A click or an add to bag on a painted image is credited only through the engine's own decision for that image on
that page view (the decision set the SDK takes after paint), as a cached layout's module is.

### The carousel before paint: the context table and the head script

On a page with a declared layout slot, your server render can paint the carousel in the shopper's context before
the first frame, with no request on the shopper's time. Publish the carousel's shot orders
([schema](./03-payload-schemas.md#shot-orders)); fetch the page's context table, `GET /v1/{tenant}/context-table/{page}`
with your site key (public for a minute; [the reference](./02-api-reference.md), section 2); and write, in the head
before your stylesheets:

1. `<script type="application/json" id="op-context-table">` holding the table exactly as it was answered;
2. `<script type="application/json" id="op-images">` holding the carousel's images in your server's order, each
   `{ "id", "tags", "src", "srcset", "sizes" }`, its `tags` carrying `contentType` and every dimension the table's
   `brandRules` name;
3. the head script, `edge-head.js` (from the SDK package, or the pinned `/sdk/{version}/edge-head.js` your deploy
   serves), inline and verbatim; its content-security-policy source is in `edge-head.js.csp` beside it in the package.

Set `data-op-consent="personalization"` on the root element when your consent tool holds the shopper's
personalization choice. It is a hint for the first page: the SDK keeps the engine's own record of the choice for the
script from then on, and the SDK's refusal cookies always win. The script derives the arrival's channel and visit
bucket with the engine's own classifier, the device from the user agent, and the arm (a brand-new browser's is
drawn here, and the SDK's first decision request asks the engine to mint the new visitor into it), takes the
table's row for that context and writes on the root element `data-op-context` (`<channel>|<visitBucket>|<device>`,
or `default`), `data-op-arm` and `data-op-table`, and one custom property per image: `--op-pdp-carousel-1`,
`--op-pdp-carousel-2` and so on, generally `--op-{slot}-{n}`, n the image's place in your list and the value its
painted place. Order the carousel with them (`order: var(--op-pdp-carousel-3)` on the third image's element). It
also adds one `<link rel="preload" as="image" fetchpriority="high">` for the image that leads, before your first
stylesheet. It hides nothing, fetches nothing, sends nothing and writes no cookie; its state is first-party storage
under `opt_head`, the visit kept only under tracking consent. It paints the default row, your server order within
the brand rules, for the holdout's default class, without a recorded personalization choice, for an arrival or a
device it cannot classify, for a table naming another classifier version, and once after the experiment's salt
changes. The engine's own first decision for a shopper whose choice is recorded orders the carousel by the same
row, so the page and the SDK's answer agree; the arm agrees on the direct path, where the first decision request
issues the session, while a page on the session route or a session broker gets the engine's own draw.

### Content inside a module: inner content slots

A module can hold content of its own: a complete-the-look module shows the items that complete the look, a
styling story shows one story. Each such content area is an ordinary slot of the same page in the slot document,
with its own `take`, weights, pins, exclusions, bands and every other slot rule, and the page's declared layout
slot names which module's content each one is with `inner`, an object of module id to slot name
(`"inner": { "module.PDP.reco.2": "pdp-ctl-items", "module.PDP.editorial.1": "pdp-story-items" }`, a
`governanceVersion: 4` member; [schema](./03-payload-schemas.md#inner-content-slots)).

One decision request decides the layout and, in the same page decision, the inner content slot of every module
the layout returned: each inner slot is decided directly after the layout slot, in the order the layout returned
its modules (after its pinned and off-limits modules, the modules withheld by your page's report or their
eligibility rules, and the adjacent swap), whatever order the slot document lists the inner slots in. A module
that is not returned has its inner slot left undecided: no decision is returned for it, no record is written and
its subscriber receives `[]`, so its container and its content stay hidden. An inner slot whose module was returned
but that has nothing left to serve returns no decision either, while the module itself stays returned; drawing
the module without its content, or reporting it in `nothingToShow` on the next request, is your page's choice.

De-duplication is page-wide across the layout, every inner slot and every other slot of the page: no piece is
served twice on the page, so an item the hero already shows is not repeated inside a module, an inner slot
decided earlier in the layout's order takes an item before a later one, and a slot further down the page yields
to them both.

Each decision of an inner slot carries `within: { "module": "module.PDP.reco.2", "slot": "pdp-modules" }`, the
layout slot and the module it sits in, beside its own `slot`. Subscribe to an inner slot by its name, as to any
slot (`client.listen.subscribe('pdp-ctl-items', …)`), and draw its items inside the container of the module that
`within.module` names. The SDK treats an inner slot like any other slot: its first paint, a hold, its painted
receipts (keyed by its own slot, `slotPosition` and item) and its render acknowledgements are its own.

Mark each drawn inner item with `data-op-content` (the item) and `data-op-slot` (the inner slot), or acknowledge it
with `client.emit.rendered(innerSlot, contentId, element, decisionId)`: its impressions and engagements are the
inner slot's own, credited to the inner slot's statistics, never to the module's position in the layout. A click on
an inner item that sits inside the module's marked container also reaches that container, so it is one engagement
of the item and one of the module, each credited to its own slot.

The page's decisions, layout and inner slots alike, are one receipt set: one decision time, one page manifest
naming every slot decided, and every record replays exactly. Publication refuses, naming
`pages.{page}[i].inner`, an `inner` on a slot that is not the page's declared layout slot, a value naming no slot of
the page or naming the layout slot itself, one inner slot named for two modules, and (at `PUT /content/slots`,
against the published catalogue) a module the catalogue does not define for the layout slot: no item has that id,
or the item does not name the layout slot in its `slotTypes`. On a context-only layout slot (above) the module order is one per context, while its inner slots are
ordinary slots decided for the shopper: `X-Context-Key` names the layout's context alone, so cache the module order,
never an inner slot's items. The carousel's shot order is published per context beside it (the context table,
above): shot types, never items. A page whose layout slot names no inner slot is decided exactly as before, in the
order the slot document lists its slots.

## 8. What to test before the freeze

On a separately authorized staging origin, complete these before M5 with the agreed20–30 real assets. Local DOM/native and synthetic script evidence is not customer browser/SFCC, latency or business acceptance.

1. **A cold page.** A fresh browser, the page loads, every slot renders your default or the platform's default lead within the deadline you set.
2. **Decisions by id.** `refresh` resolves; each slot's `customerContentId` exists in your CMS; actual DOM paints before the exact render ACK.
3. **Events.** Product view, add to bag and a purchase each return HTTP 200 with `success: true`.
4. **The loop without reload.** One to three acknowledged interactions trigger refresh; inspect actual IDs/DOM/render ACK and click or dwell on the original painted receipt. Publish an operator change and refresh again. Exercise missing/unknown/deleted CMS IDs, cross-category feed failure, stale page/identity/consent and reconnect; defaults must remain usable.
5. **Sign-in.** `identify` returns `ok: true` and a shopper id; the socket reconnects; events after it carry the shopper id. `logout` returns a fresh anonymous id.
6. **Graceful absence.** Block the platform host in the browser's network tools: the page renders defaults and nothing waits.
7. **The connection check.** `scripts/verify-origin.sh` from inside your network prints PASS on every line.

## 9. Configuration reference

| Option | Default | Meaning |
|---|---|---|
| `tenant` | required | The brand scope decisions are made for |
| `brand` | tenant | Recorded on every decision, and sent as `data.brand` on every action the client sends, whatever its type, so an outcome is measured in the brand its exposure was counted in. `data.brand` is the SDK's own member: a `brand` a page, a mapping or a tag layer puts on an event is never sent under that name. A client configured without one sends none on any event, and the platform measures the tenant's own brand |
| `endpoint` | page origin | Platform base URL |
| `sdkKey` | none | Sent on every request; enforced on staging and production |
| `source` | `sdk` | Names the caller on every event |
| `listenOnly` | false | Section 4 |
| `sessionBroker` | absent | Same-origin POST broker for the server-first-paint path |
| `heartbeatMs` | 25000 | Socket keepalive |
| `reconnectMs` | 3000 | Socket reconnect delay |
| `hydrateTimeoutMs` | 1500 | The page view's first-decision deadline, after which defaults stand: measured from its first snapshot request, never restarted by a re-ask; another page, channel or product (`productId`) is a new page view with its own deadline, a variant switch (`variantId`) is not. Measured on the acceptance pair: a new visitor's first answer 0.3–2.7 s, the first answer of a page view holding a session about 0.45 s typically; the hosted stamps are not yet measured (section 3, the deadline paragraph) |
| `visitorIdKey` | `opt_visitor_id` | Storage key for the visitor id |
