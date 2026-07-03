# ODP `recent_events` + Profile Upsert — Reference (from Lancelot, ODP PM, 2026-07-03)

*Verbatim-technical digest of the ODP team's live-verified examples against the Coach RTS Demo
account (scope 11023, `https://api.zaius.com/v3`). This is the contract for the instant-seed
and score-upsert build. Companion to [Coach-ODP-Wiring-Spec.md](./Coach-ODP-Wiring-Spec.md).*

## Part 1 — `recent_events`: real-time segment check in ONE call (~85–200ms P99, nothing persisted)

Inject events **inline** into the audiences query and get membership back immediately —
no ingestion wait, no RTS refresh cycle, works even on a fresh never-seen vuid:

```graphql
query {
  customer(vuid: "633efdd240ef4d699c5474f123422b6d") {
    audiences(
      subset: ["line_tabby_affinity", "late_journey_ready_to_buy", ...],
      recent_events: [
        { idempotence_id: "<uuid>", type: "product", action: "detail",
          product_id: "6931", product_line: "Tabby", ts: 1783083996 },
        { idempotence_id: "<uuid>", type: "product", action: "add_to_cart",
          product_id: "6931", ts: 1783084026 }
      ]
    ) { edges { node { name state } } }
  }
}
```

**Contract details (all live-verified by the ODP team):**
- Event fields are **FLAT on the event object** (`product_line` at top level — NOT nested under
  `data` like the REST `/v3/events` shape). `action` field name matches REST.
- `ts` is **epoch SECONDS**, and must be within the segment windows (`max_age_seconds: 3600`) —
  stale timestamps silently fail to qualify.
- Each event needs an `idempotence_id` (uuid).
- Response contains **only qualifying segments** — absence = not a member.
- Nothing is persisted: pair with the normal `/v3/events` forward for the durable memory.

## Part 2 — Profile attribute upsert → read-back (persisted; our Wiring Spec §4 scores)

The ODP team created the §4 custom customer attributes — the edge's live affinity scores can
be upserted onto the ODP profile and queried back **by vuid**:

```
POST /v3/profiles   (public key)
[{ "attributes": { "vuid": "<32hex>", "line_affinity_tabby": 0.82,
   "silhouette_affinity_tote": 0.45, "occasion_affinity_evening": 0.67,
   "dominant_line": "Tabby", "journey_stage": "ready_to_buy" } }]
→ 202
```
```graphql
query { customer(vuid: "<32hex>") {
  vuid line_affinity_tabby silhouette_affinity_tote occasion_affinity_evening
  dominant_line journey_stage last_modified_at } }
→ returns the values (as strings)
```
Note: the vuid must have been established by ≥1 event first (`/v3/events`).
**This supersedes the earlier handoff caveat** ("can't query customer attributes in vuid
context") — attribute upsert + GraphQL read-back demonstrably works on a pure vuid.

## Traps + auth (their notes)

- **vuid is stored dash-stripped and the query resolver does NOT normalize** — always use the
  dashless 32-hex form everywhere or hit `INVALID_IDENTIFIER_EXCEPTION`. (Our SHA-256-derived
  vuids are already dashless ✓.)
- **Public key** (prefix before the dot) = data in (`/v3/events`, `/v3/profiles`);
  **private key** (full `xxx.yyy`) = GraphQL reads. Server-side we hold the private key, which
  works for both.

## What this changes in our build (queued)

1. **Instant seed**: keep the `/v3/events` forward (durable memory) + add a `recent_events`
   read — the "· ODP" chip badges can confirm on the SAME action (~100–200ms), not on the
   2-minute refresh. Needs a small per-session ring buffer of the last ~10 mapped events
   (flat shape, ts seconds).
2. **Score upsert (§4)**: on membership changes (throttled), upsert the reflex's live scores →
   the ODP profile literally carries the edge's affinity numbers. The joint-demo beat and the
   strongest "productize this natively" exhibit.
3. Latency talk-track correction: event-path P99 ~85ms (ODP-internal) / ~200ms transatlantic;
   durable profile ~10s; never say "~90s" again.
