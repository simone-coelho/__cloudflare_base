# The Bright Hour — catalog + dimension registry

Data and tuning for the QVC-representative live-shopping demo (route `/live`).
Design bible: `docs/qvc/QVC-Site-Recon-Demo-Design.md` (Parts B, C, D3 and the
DO-NOT-USE list). Decisions: `docs/qvc/QVC-Demo-Design-Brief.md`.

The retailer is **fictional**. The *schema* is QVC's, mirrored 1:1 from their own
published product fields, because the whole posture is "this uses a field you
already have". No real QVC or vendor product data is present anywhere here.

## What lives in this directory

| File | Owner | What it is |
|---|---|---|
| `catalog.data.json` | data | 77 items, 2 named events, `_meta`. The single source of truth for the catalog. |
| `types.ts` | data | The item / offer / window schema, plus the materialized shape the loader produces. |
| `reflexConfig.ts` | data | `BRIGHTHOUR_REFLEX_CONFIG` — the nine dimensions of recon §C1, in both demo-τ and prod-τ form. |
| `README.md` | data | This contract. |
| `demoClock.ts` | clock | Compressed demo time + ET calendar math + `materializeWindow()`. |
| `catalog.ts` | loader | Materializes offsets into real instants and emits `Product`-shaped items. |
| `offerLifecycle.ts` | lifecycle | Derives `lifecycleState`, reveal windows, and the eligibility gates. |

### What never lives here

- **No page/UI code.** The storefront is a separate surface; this directory is data + tuning only.
- **No absolute timestamps in the data file.** Every instant is stored as an offset (below).
- **No derived state.** `offer.lifecycleState` is `null` in the file, always. It is computed at read time from `(window, now, config)`. Anything that can be derived is derived.
- **No cross-surface coupling.** The coach demo must not import from here; the surface split lives in `src/demos/registry.ts`.
- **No banned vocabulary.** See "Voice" below — it is validated, not merely intended.

## The window-offset convention

The one deliberate change from the recon's §B3 item schema. Offer windows are
stored as **offsets from a demo epoch**, never as fixed timestamps:

```jsonc
"offer": {
  "window": { "startOffsetHours": -8, "durationHours": 24 },  // live now, ends in 16h
  "lifecycleState": null                                       // DERIVED, never stored
}
```

- **Epoch** = midnight ET of demo day zero (`catalog.ts: getEpochMs()`; pinnable via `BRIGHTHOUR_EPOCH_MS` for a rehearsed replay).
- **Negative `startOffsetHours`** = the offer is already running when the demo opens.
- **`window: null`** = always-on. Evergreen, clearance, final sale, web exclusive and one-time-only items are gated by availability and business rules, never by a clock.
- The loader materializes real ISO instants. **Scale the clock; never fake the stamps.**

Because the epoch is a real instant, the same committed file stages a live hour,
a queued offer and an offer in preview on **any day a presenter opens the demo**.

### Nested reveals

`EVT120` items carry `parentEvent: "EVT120_FALL"` + `revealIndex: 0..11` and **no
window of their own**. The lifecycle engine derives reveal *i* as
`[parentStart + i·cadence, +cadence)`, clamped into the parent window. The parent
is defined once in the top-level `events` array:

```jsonc
{ "id": "EVT120_FALL", "window": { "startOffsetHours": 12, "durationHours": 120 },
  "revealCadenceHours": 3, "revealCount": 12 }
```

The loader converts `revealCadenceHours` to the `revealCadenceMs` the lifecycle
engine reads. `FIN` (finale) items also carry `parentEvent: "EVT120_FALL"` but
*with* a window of their own (`+108h`, 24h) — a single-day cap on a five-day
event, which is exactly how QVC's Finale construct behaves.

### The second offset field

`signals.lastOnAirDate` is `null` in the file for the same reason; the stored
form is **`signals.lastOnAirOffsetHours`** (negative = already aired). The loader
materializes the ISO date. Beat 6 filters "aired within 2 hours", which a frozen
timestamp could never satisfy.

## Field mirroring (the reflex contract)

`core.extractTouches()` reads `product[spec.source]` — **flat keys only, no path
support, no nested traversal**. Every dimension source therefore exists as a
**top-level** key on each item. Mirrors are *generated*, never hand-typed, and
every one is asserted equal to its nested source at build time.

| Dimension | `source` (flat) | Mirrors | Why not the nested path |
|---|---|---|---|
| `category` | `category` | `categories[]` primary node's `name` | Arrays of objects can't be a source at all |
| `subcategory` | `subcategory` | the label 1:1 with `primaryClassCode` | See the deviation note below |
| `brandPersonality` | `brandPersonality` | — (already top-level in §B3) | — |
| `priceBand` | `price_usd` | `pricing.currentSellingPrice` | Nested; also the field `CatalogService` indexes |
| `offerTypeAffinity` | `offerType` | `offer.type` | Nested |
| `urgencyResponsiveness` | `urgencyCue` | derived from `offer.type` | Not a stored field anywhere |
| `hostAffinity` | `presentedBy` | `signals.presentedBy` | Nested |
| `sessionMission` | `sessionMission` | **nothing** — host-injected | Behavioural, not catalog |
| `mediaAffinity` | `mediaFormat` | `'video'` when `media.onAirClip` is present | Nested |

Every source above resolves on the **raw JSON item**, before `catalog.ts` runs.
That is deliberate: the audience generator can score the data file directly, and
a loader change can never silently unhook a dimension. `catalog.ts` additionally
flattens nested objects as `parent_child` (`offer.type` → `offer_type`), so the
aliases exist too — but nothing depends on them.

### Loader-shaped mirrors

`catalog.ts` emits a `CatalogService.Product`-shaped floor and **drops any item
without `id`**, so the file also carries:

| Field | Equals | For |
|---|---|---|
| `id` | `itemNumber` | loader contract (items without it are dropped) |
| `name` | `shortDescription` | `Product.name` |
| `brand` | `brandName` | mapped onto `Product.line` (brand-similarity is the dominant kernel weight) |
| `occasion` | `merch.occasion` | the similarity kernel's Jaccard term |
| `colors`, `material`, `silhouette`, `size` | authored | similarity kernel |
| `image_url`, `product_url` | derived from `assets` | storefront |
| `categoryIds`, `categoryNames` | `categories[]` | multi-membership survives the loader's flatten (arrays of *objects* do not) |

`urgencyCue` maps the offer construct onto the posture the demo governs:
`time_bound` (daily deals + events), `until_gone` (one-time-only), `standing`
(evergreen, web, clearance, final sale). Beat 11 personalizes framing **only**
for visitors whose `urgencyResponsiveness → time_bound` affinity is above θin,
and it decays in ~45 seconds. No countdowns, no counters — a posture, not a clock.

## Counts

**77 items · 8 categories · 42 subcategories · 22 brands · 4 hosts · 16 offer constructs · 2 named events**

| Category | Items | Timely | Evergreen |
|---|---|---|---|
| Kitchen & Table | 12 | 8 | 2 |
| For the Home | 11 | 7 | 1 |
| Beauty & Wellness | 10 | 6 | 1 |
| Fashion | 10 | 6 | 2 |
| Jewelry | 8 | 4 | 1 |
| Electronics & Tech | 8 | 4 | 1 |
| Garden & Outdoor | 9 | 5 | 2 |
| Food & Wine | 9 | 8 | 1 |

**Every category carries both a timely offer and an evergreen fallback** — the
structural rule lifted from their own `top-offers.json`. When a visitor has no
affinity yet, or affinity decays below θout, the slot falls to the category's
evergreen entry rather than going blank.

| Construct | Code | Count | Window |
|---|---|---|---|
| Today's Bright One℠ | `TBO` | 3 | 1 live (−8h/24h), 1 queued (+16h/24h), 1 in preview (+40h/24h); all `presaleEligible` |
| BH2 Nightly Deal℠ | `BH2` | 1 | +21h/24h — the 9pm ET offset clock |
| The Harvest Kitchen Event | `EVT` | 8 | −12h/108h (4.5 days) |
| 120 Bright Hours℠ | `EVT120` | 12 | none — `revealIndex` 0..11 off `EVT120_FALL`, 3h cadence |
| The 72-Hour Weekend℠ | `EVT72` | 4 | −18h/72h |
| The Two-Day Sale | `EVT48` | 4 | +6h/48h |
| Finale — Ends Tonight | `FIN` | 3 | +108h/24h, `parentEvent: EVT120_FALL` |
| Lunch Hour Steals® | `LHS` | 4 | 12:00–14:00 ET, staggered one per day (+12/+36/+60/+84) |
| Primetime Steals℠ | `PTS` | 4 | 20:00–23:00 ET, staggered one per day (+20/+44/+68/+92) |
| One Time Only Price | `OTO` | 3 | none — until gone, gated by availability |
| Online Special Deal | `WEB` | 5 | none |
| Deal Drop℠ | `DDP` | 5 | −48h/168h (weekly) |
| Final Sale Price | `FIN_S` | 4 | none — `returnPolicy: final_sale` |
| Clearance Price | `LC` | 6 | none |
| The Bright Fifty Pick℠ | `BF50` | 1 | none — `pinned: true` (the Q50-style curated pick, Beat 5) |
| Everyday Bright Value | `EBV` | 10 | none — `offer.type: evergreen`, the fallback pool |

Other distributions:

- **Price bands** (cuts 40 / 120 / 300): entry 31 · core 31 · elevated 11 · premium 4. Range $9.90–$379.98, median $49.98.
- **Brand personalities**: artisan 18 · value-workhorse 17 · modern-clean 13 · heritage-classic 13 · tech-forward 9 · host-led 7.
- **Availability**: in_stock 68 · low_stock 4 · sold_out 2 · waitlist 2 · advanced_order 1. (`ats` Y/N/W throughout; waitlist is `W`.)
- **Hosts**: Dana Reyes 15 · Priya Anand 11 · Marcus Hale 10 · Evelyn Cross 9 (45 hosted items; each host spans more than one category so Beat 12 can cross them).
- **On-air clips**: 34 items (44%).
- **Payments**: 43 Bright Pay · 10 card-gated · 3 special financing (all with `brightPay: null` — the two are mutually exclusive in both directions, §C3).

## Voice, and what is forbidden

Merchandising copy follows recon §D3: spoken second person, em-dash asides,
exclamation points, ℠/® on proprietary offer names, switching to a flat formal
register for policy copy ("Final sale — not returnable").

The recon's DO-NOT-USE vocabulary is **enforced, not merely intended**: "Almost
Gone", "Limited Quantity", "Going Fast", "Only N left", quantity counters, any
social proof, "Add to Bag", "Today's Big Find". `soldLast30Days` exists as an
internal velocity attribute (it is a real field of theirs) and must **never** be
rendered. There are no shopper-facing countdowns anywhere; the only ticking
clock in the build belongs in the presenter's ops panel.

Two names are reserved and deliberately absent from the data:

- **`Hearthside`** — Beat 10 has a merchandiser add this collection to 6 items live, so the generator can be seen minting "Hearthside Affinity". It must not pre-exist.
- **`Diamonique`** and other real QVC marks — our simulated stone is **Brightstone℠**.

## Editing the data file

The JSON is generated with every derived field computed, so hand edits must keep
these invariants true (they are the build's assertion list):

1. `itemNumber` matches `^B\d{6}$` and equals `id`; unique.
2. `comparableRetail > ourPrice >= currentSellingPrice`, with `ourPrice > currentSellingPrice` on every non-evergreen item.
3. `pricing.priceBand` agrees with the cuts in `reflexConfig.ts`.
4. `brightPay` and `specialFinancing` never coexist; Bright Pay never exceeds 6 installments.
5. `offer.lifecycleState` is `null`. Always.
6. `EVT120` items have `parentEvent` + integer `revealIndex` and `window: null`.
7. `urgencyState` ∈ the five strings; `ats` agrees (`sold_out`→N, `waitlist`→W); `low_stock` implies `unitsRemaining < lowStockThreshold`.
8. Every flat mirror equals its nested source (`offerType`/`offer.type`, `presentedBy`/`signals.presentedBy`, `price_usd`/`pricing.currentSellingPrice`, `category`/primary `categories[]` entry, `mediaFormat`/`media.onAirClip`, `occasion`/`merch.occasion`).
9. Every category keeps ≥1 timely offer and ≥1 `offer.type: evergreen` item.
10. No banned vocabulary in any shopper-facing string.

## Deviations from the brief, and why

- **77 items, not ~72.** The per-construct counts in the brief sum to 67 timely items on their own; with the 8-category evergreen floor the minimum consistent catalog is 75. Construct coverage is load-bearing for the beats, so the counts were kept exactly and the evergreen pool was set to 10 (rather than ~15) — 77 total.
- **`subcategory` scores a label, not the raw class code.** The brief names `primaryClassCode` as the source. The code is kept on every item (and is 1:1 with the label), but the *scored* value is the shopper-facing label, because the audience generator names audiences from catalog values: "Cookware & Dutch Ovens Affinity" is a Beat 10 asset, "K221 Affinity" is not.
- **Two additional offer fields**: `presaleEligible` (mirrors their `tsvpresale` / `*APTSV*` construct; set on the three TBO items) and `pinned` (precedence layer 2 in §C2, set on the Bright Fifty pick). Both are read by `offerLifecycle.ts`.
- **`signals.lastOnAirOffsetHours`** added for the reason given above.
- **`cardGatedPay.window`** uses the same offset shape rather than ISO literals, so nothing in the file goes stale.

## Verification

```bash
node -e "const c=require('./src/demos/brighthour/catalog.data.json'); console.log(c.items.length, c.events.length)"
npx tsc --noEmit          # types.ts + reflexConfig.ts are strict-clean
grep -riE "almost gone|limited quantity|going fast|only [0-9]+ left|add to bag" src/demos/brighthour/catalog.data.json   # must return nothing
```
