# Synthetic Coach NA Data — shaped to Optimizely ODP's schema

This directory holds the **synthetic Coach North America behavioural dataset** that
powers the Tapestry/Coach real-time personalization demo. It is the payload the
**mock connectors** return in place of live Optimizely calls.

> **Architecture principle — REAL SEAMS, MOCKED CALLS.**
> Every integration point is a real interface named after the actual Optimizely
> product (ODP `fetchQualifiedSegments`, Opal's ODP audience tools, Optimizely
> flag/variation decisions). In `CONNECTOR_MODE=mock` (the default) those calls
> return the data in this folder, shaped to ODP's schema. Swapping mock → live
> (`CONNECTOR_MODE=live`) is a config change, not a reshape. See
> [`docs/architecture/05-demo-build-spec.md`](../../docs/architecture/05-demo-build-spec.md).

All product IDs in this data are **real Coach catalog IDs** from
[`data/coach-catalog.json`](../coach-catalog.json). No live external dependency
exists; nothing here calls a network.

---

## Files

| File | Pretty? | Size¹ | What it is | Consumed by |
|---|---|---|---|---|
| `customers.json` | yes | ~7.8 MB | ODP-style customer profiles: identifiers + profile attributes + insight fields + the persisted segment keys each profile qualifies for. | `MockSegmentProvider` (qualification), `MockDecisionProvider` (attribute-keyed decisions), storefront "anonymous shopper" seeding. |
| `events.json` | minified | ~51 MB | ODP-style behavioural event stream (`page_view`, `product_view`, `add_to_cart`, `purchase`, `email_open`) referencing real catalog product IDs. | Evidence / replay / analytics. **Not required at request time** by the mock connectors — they read the pre-computed snapshots on the profile. Use it to drive a scripted "live session" replay or to recompute insights. |
| `insights.json` | yes | ~35 KB | Pre-aggregated **insight / audience views** (ODP-shaped condition trees + evidence) plus global funnel/catalog aggregates. | `MockAudienceAuthoring.suggestAudiences` (the Opal mock serves these as "suggested" audiences), `src/data/seed-audiences.ts` (boot seed), operator console. |

¹ Sizes are for the default run (seed `20260625`, 3,200 customers). `events.json` is
the only large file; it is written **minified** on purpose. The runtime mock path
only needs `customers.json` + `insights.json`.

---

## How to (re)generate — deterministic

```bash
# default: seed=20260625, customers=3200, out=data/synthetic
node scripts/generate-synthetic-data.mjs

# explicit seed / size / output dir
node scripts/generate-synthetic-data.mjs 42
node scripts/generate-synthetic-data.mjs --seed=20260625 --customers=3500 --out=data/synthetic
```

The generator uses a seeded **Mulberry32 PRNG** and a fixed epoch
(`EPOCH_NOW = 2026-06-25T17:00:00Z`). There are **no** `Math.random`, `Date.now`,
or `crypto.randomUUID` calls in the data path — re-running with the same seed
produces **byte-identical** output (verified). A different seed yields a different
but statistically equivalent dataset.

---

## Current dataset (seed `20260625`)

- **Customers:** 3,200 (≈2,059 known / resolved identity, ≈1,141 anonymous-only)
- **Events:** ~120,000
  - `product_view` ~50,660 · `page_view` ~28,888 · `add_to_cart` ~24,101 · `email_open` ~9,099 · `purchase` ~7,293
- **Funnel:** product_view → add_to_cart ≈ **47.6%**; add_to_cart → purchase ≈ **30.3%**
- **Total synthetic revenue:** ~$3.29M USD
- **Line skew:** Tabby dominates (~23.4k product views vs. ~6.2k for the next line, Essential), matching the brief's Tabby-hero positioning. Pillow Tabby + Brooklyn follow.
- **Price-band skew:** `core` (150–399) is the bulk, then `elevated` (≥400), then `entry` (<150) — a realistic luxury-handbag distribution.
- **Seasonality:** a gentle upward trend toward "now" with a promo-week bump (day-offset 40–47) drives daily event volume (`insights.aggregates.daily_event_volume`).

(Exact counts print at the end of every generator run and live in each file's `_meta`.)

---

## ODP schema mapping

### 1. Identifiers (ODP identity graph) — `customers[].identifiers`

ODP keys a profile by a set of identifiers. We populate the ones the demo's
identity story needs:

| Field | ODP meaning | Notes |
|---|---|---|
| `vuid` | ODP **visitor id** — anonymous device id (`vuid_<32 hex>`) | Always present. This is the id an anonymous shopper carries before sign-in; it is the `userId` passed to `fetchQualifiedSegments`. |
| `customer_id` | ODP **customer id** — resolved on sign-in | `null` for anonymous-only profiles. |
| `email` | ODP **email** identifier | `null` for anonymous-only profiles. |
| `fs_user_id` | example cross-system id | `null` for anonymous-only; shows the identity graph can hold >1 key. |

Events carry the same identifiers: every event has `identifiers.vuid`; events that
occur **after** the profile's sign-in moment additionally carry `customer_id` +
`email` (modelling ODP identity stitching).

### 2. Profile attributes (ODP profile, snake_case) — `customers[].attributes`

ODP profile attributes are snake_case key/values. Three groups:

**(a) Demographic / marketing / lifetime (static aggregates ODP holds on the profile)**
`first_name`, `last_name`, `country`, `region`, `city`, `locale`, `timezone`,
`preferred_device`, `acquisition_channel`, `email_subscriber`, `sms_subscriber`,
`loyalty_member`, `loyalty_tier` (`member|silver|gold|platinum`), `first_seen_ts`,
`last_seen_ts`, `session_count`, `lifetime_orders`, `lifetime_value_usd`,
`average_order_value_usd`, `favorite_line`, `preferred_category`,
`preferred_price_band`, `gifter`.

**(b) Real-time session signals — the engine's qualification attributes**
These names match **exactly** the attributes the connector layer evaluates audience
condition-trees against (`docs/architecture/05-demo-build-spec.md` §2.2, and
`src/connectors/types.ts` → `QualificationContext.attributes`). They reflect the
profile's **current (last) session snapshot** — what a live edge engine actually
sees in-session:

| Attribute | Type | Meaning |
|---|---|---|
| `viewed_product_line` | string\|null | Most-viewed line **this session** (e.g. `Tabby`, `Brooklyn`). |
| `product_views` | int | PDP views **this session**. |
| `page_views` | int | All page views (lifetime; home/category/PDP). |
| `category_dwell_ms` | int | Dwell on product content **this session**. |
| `cart_adds` | int | Add-to-cart count **this session**. |
| `wishlist_adds` | int | Wishlist adds. |
| `purchases` | int | Purchases **this session**. |
| `price_band_viewed` | `entry`\|`core`\|`elevated` | Dominant viewed price band **this session**. |
| `journey_stage` | `early`\|`mid`\|`late` | Derived from this session's funnel depth (mirrors `JourneyStage.deriveStage`). |
| `cart_abandoned` | bool | Added to cart (this or a prior session) and left without buying. Distinguishes *returning abandoners* from *active-cart* shoppers. |
| `sessions_since_cart` | int | Recency of the abandoned cart. |
| `email_opens` | int | Email opens (lifetime). |

Lifetime browse totals are kept **separately** so they don't shadow the live-session
signals: `lifetime_product_views`, `lifetime_cart_adds`, `lifetime_purchases`.

**(c) ODP insight-style static predictions** (synthetic; ODP would compute these)

| Attribute | Type | Meaning |
|---|---|---|
| `order_likelihood` | 0..1 | Propensity to order; correlated with funnel depth, abandonment, lifetime orders, persona. |
| `engagement_rank` | `low`\|`medium`\|`high`\|`vip` | Bucketed engagement. |
| `churn_risk_score` | 0..1 | Higher for lapsed / low-engagement profiles. |
| `predicted_ltv_usd` | int | Predicted lifetime value. |

> `persona` is also present on each profile — a synthetic label (e.g.
> `tabby_enthusiast`, `window_shopper`, `gifter`) used to drive realistic
> distributions. It is **not** a real ODP field; treat it as demo metadata.

### 3. Persisted segments — `customers[].segments`

The segment keys the profile's current snapshot already qualifies for. These mirror
the insight `conditions` 1:1 (see below), so a profile loaded from `customers.json`
is immediately consistent with what `MockSegmentProvider.fetchQualifiedSegments`
recomputes live.

### 4. `_rollup` (QA / evidence only)

Denormalised per-customer rollup: `viewed_product_ids`, `added_product_ids`,
`purchased_product_ids`, `viewed_line_counts`, `revenue_usd`, `is_known`. Used by
the generator to compute insight evidence and handy for QA. Not part of the ODP
schema — connectors ignore it.

### 5. Events (ODP event shape) — `events[]`

```jsonc
{
  "event_id": "evt_00032814",
  "type": "product",          // ODP collection/namespace: pageview|product|cart|order|email
  "action": "product_view",   // verb: page_view|product_view|add_to_cart|purchase|email_open
  "timestamp": 1774798046426, // epoch ms (UTC). ISO derivable downstream.
  "identifiers": { "vuid": "vuid_…", "customer_id": "…", "email": "…" },
  "session_id": "sess_000861_1",
  "data": {
    "product_id": "COA-CCX14",        // REAL catalog id
    "product_name": "…", "line": "Tabby", "category": "Handbags",
    "subcategory": "Shoulder Bags", "price_usd": 695,
    "price_band": "elevated", "currency": "USD",
    "dwell_ms": 16116, "device": "mobile", "channel": "paid_social",
    "page_type": "pdp"
    // add_to_cart adds: quantity, cart_value_usd
    // purchase  adds: order_id, order_total_usd, item_count, line_items[], is_gift
    // email_open data: campaign_id, campaign_name
  }
}
```

Events are time-sorted across the trailing 90 days. The funnel
`page_view → product_view → add_to_cart → purchase` is generated per session with
persona-driven drop-off.

---

## Pre-aggregated insight / audience views — `insights.json`

`insights.insights[]` is the heart of the **Opal audience-suggestion mock**. Each
entry is a believable, data-grounded audience the merchandiser could ask Opal to
create. The shape is built to drop straight into the connector layer:

```jsonc
{
  "key": "high_intent_tabby_browser",
  "name": "High-Intent Tabby Browsers (no add-to-cart)",
  "description": "…",
  "nl_prompt": "high-intent Tabby browsers who haven't added to cart",
  "evaluation": "realtime",
  "recommended_module": "complete_the_look",
  "anchor_line": "Tabby",
  // ODP-shaped AudienceCondition tree — runtime-evaluable by MockSegmentProvider:
  "conditions": ["and",
    { "attribute": "viewed_product_line", "operator": "eq",  "value": "Tabby" },
    { "attribute": "product_views",       "operator": "gte", "value": 3 },
    { "attribute": "cart_adds",           "operator": "eq",  "value": 0 }
  ],
  // pre-computed EVIDENCE for the Opal review card:
  "stats": { "audience_size": 114, "audience_pct_of_base": 3.6,
             "avg_product_views": 4.5, "avg_order_likelihood": 0.259,
             "avg_order_value_usd": 320, "known_identity_pct": 60.5 },
  "top_products": [ { "product_id": "COA-CY201", "name": "…", "viewers": 33 }, … ],
  "complete_the_look": [ { "product_id": "COA-CCZ00", "name": "Tabby Bag Charm" }, … ],
  "sample_vuids": [ "vuid_…", … ]
}
```

The `conditions` tree uses the **same attribute names + `['and'|'or'|'not', …]`
shape** as `AudienceCondition` in `src/connectors/types.ts`. The `predicate` used to
compute the evidence lives only in the generator; **at runtime the connector
evaluates `conditions` itself** against the live `QualificationContext`.

### Available audiences / insights (seed `20260625`)

| key | nl_prompt (what a merchandiser would say to Opal) | size | % base | module |
|---|---|---:|---:|---|
| `high_intent_tabby_browser` | "high-intent Tabby browsers who haven't added to cart" | 114 | 3.6% | `complete_the_look` |
| `early_journey_cold_start` | "brand-new anonymous shoppers just landing" | 700 | 21.9% | `curated_grid` |
| `mid_journey_considering` | "shoppers actively comparing products mid-journey" | 132 | 4.1% | `social_proof` |
| `late_journey_ready_to_buy` | "shoppers with items in their cart right now" | 786 | 24.6% | `checkout_nudge` |
| `cart_abandoner` | "people who added to cart but abandoned without buying" | 1,106 | 34.6% | `cart_recovery` |
| `high_aov_gifter` | "high-AOV gifters shopping for presents" | 279 | 8.7% | `gift_edit` |
| `luxe_affinity` | "customers who love our most premium pieces" | 999 | 31.2% | `premium_hero` |
| `vip_loyalist` | "our most loyal VIP customers" | 302 | 9.4% | `vip_early_access` |
| `brooklyn_browser` | "shoppers interested in the Brooklyn collection" | 249 | 7.8% | `line_spotlight` |
| `lapsed_reengagement` | "lapsed customers who just came back" | 140 | 4.4% | `winback_offer` |

> `late_journey_ready_to_buy` (active cart this session) and `cart_abandoner`
> (`cart_abandoned` flag) are deliberately **distinct cuts** driven by different
> attributes, so the demo can show both a checkout-nudge and a recovery flow.

`insights.aggregates` additionally carries global context for dashboards / the
operator console: `event_counts_by_action`, `funnel`, `total_revenue_usd`,
`views_by_line`, `views_by_price_band`, `top_products` (top 15), and
`daily_event_volume`.

---

## How the mock connectors consume this data

```
                     ┌────────────────────── insights.json ──────────────────────┐
                     │  insights[] (ODP condition trees + evidence)               │
                     │  aggregates (funnel, views_by_line, top_products, …)       │
                     └───────────────┬───────────────────────────┬───────────────┘
                                     │ suggestAudiences()         │ seed at boot
                                     ▼                            ▼
   merchandiser ──prompt──▶  MockAudienceAuthoring ──publish──▶  AudienceStore  ◀── seed-audiences.ts
        (Opal mock)          (returns matching insight            (shared)
                              as a 'suggested' AudienceDef)            │ listPublished()
                                                                      ▼
   anon shopper ──event──▶  RealtimeSegmentEngine ──▶ MockSegmentProvider.fetchQualifiedSegments()
                                     │                      evaluates each AudienceDef.conditions
                                     │                      against the live QualificationContext
                                     │                      (attributes seeded from customers.json)
                                     ▼
                            MockDecisionProvider.decideAll()  ── keys modules off qualified segments
                                     │                            (segment → recommended_module)
                                     ▼
                            personalization_update broadcast → storefront restructures live
```

1. **`MockAudienceAuthoring.suggestAudiences(nlPrompt)`** matches the prompt to one
   (or more) `insights[]` entry and returns it as a `status:'suggested'`
   `AudienceDef` — `conditions` map directly, `stats`/`top_products` feed the Opal
   review card. On Publish, `createAudience()` writes it (with
   `evaluation:'realtime'`, `status:'published'`) into the shared `AudienceStore`.
2. **`MockSegmentProvider.fetchQualifiedSegments(vuid, ctx)`** lists published
   audiences from that same store and evaluates each `conditions` tree against
   `ctx.attributes`. Because attributes come from `customers.json` (and accrue live
   as events fire), the moment Publish is clicked the next event qualifies matching
   shoppers — no redeploy. This is the Hero Moment 3 wedge.
3. **`MockDecisionProvider`** maps each qualified segment to its
   `recommended_module` (the `module` field in the decision `variables`), driving
   which personalization module renders.
4. **Cold start / anonymous shopper:** seed a storefront session from any
   `customers.json` profile where `identifiers.customer_id === null` to demo the
   signed-out, in-session specialization path.

### Swapping to live (no reshape)

`customers.json` profiles map onto ODP profiles; `events.json` maps onto ODP event
ingestion; `insights.json` condition trees map onto ODP real-time audience
definitions Opal authors. Setting `CONNECTOR_MODE=live` (and supplying ODP/Opal/FX
credentials) is the only change required — the live adapters consume the identical
shapes.

---

## Field-name contract (do not drift)

These attribute names are a **contract** shared with `src/connectors/types.ts`,
`RealtimeSegmentEngine`, `JourneyStage`, and `src/data/seed-audiences.ts`. If you
add an audience condition over a new attribute, add that attribute to
`customers[].attributes` here (and to the engine's `updateAttributesWithEvent`) so
mock and live stay interchangeable.
