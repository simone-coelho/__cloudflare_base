# API Reference — WebSocket Protocol (as-built)

**Status:** verified against code 2026-07-08. This document replaces a long-broken link in the 2025 reference — it now exists with real content.

## Connection

```
GET /realtime/ws?userId=<anonId>   (Upgrade: websocket; 426 otherwise)
```

Routes to the shopper's **`PersonalizationWebSocket` Durable Object** (`idFromName(userId)` — one object per shopper id; all of a shopper's tabs share it). On connect the server sends a `connected` frame. The storefront reconnects on close after 3 s.

**Note:** behavioral events are *not* sent over this socket today — they POST to `/realtime/action`; the socket is the push channel. (The planned per-shopper `ShopperReflex` DO will add socket ingestion; see doc 16 §6.)

## Client → server

| Message | Effect |
|---|---|
| `{"type":"heartbeat"}` | → `{"type":"heartbeat_response","timestamp"}` |
| `{"type":"subscribe"\|"unsubscribe", ...}` | accepted, currently no-op |

## Server → client — the `PersonalizationUpdate` envelope

```json
{
  "type": "personalization_update",
  "userId": "v-…",
  "timestamp": 1751900000000,
  "serverTimestamp": 1751900000123,
  "data": {
    "segments": ["line_tabby_affinity", "luxe_affinity"],
    "decisions": { "hero_module": { "enabled": true, "variationKey": "affinity_hero", "variables": { } } },
    "featureVariables": { },
    "recommendations": [ ],
    "sortOrder": ["COA-CH857", "…"],
    "journeyStage": "mid",
    "affinity": {
      "dims": { "line": { "tabby": 0.62 }, "silhouette": { "tote": 0.18 } },
      "audiences": ["line_tabby_affinity"],
      "changed": [ { "audience": "line_tabby_affinity", "transition": "enter", "score": { "before": 0.52, "after": 0.62, "threshold": 0.6 } } ],
      "odpConfirmed": ["line_tabby_affinity"]
    }
  }
}
```

**`type` union:** `segment_update` · `personalization_update` · `feature_flag_update` · `audience_published` (operator publish → qualifying shoppers) · **`odp_receipt`** (ODP event-delivery confirmation `{receiptId, status, ts}` — upgrades the storefront's dispatch row to a confirmed ✓).

**Delivery model:** a shopper's own action is answered **synchronously** in the `POST /realtime/action` response *and* may be echoed on the socket when state changed; operator publishes and ODP receipts arrive **only** via the socket. Updates are emitted on change, not on every event.

## Related

[REST endpoints](./01-rest-endpoints.md) · client implementation `public/storefront.js` (`connectWebSocket`, `handleWsMessage`) · server `src/durable-objects/PersonalizationWebSocket.ts`.
