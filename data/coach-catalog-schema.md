# Coach Catalog Schema

Schema for `data/coach-catalog.json` — the Coach North America (USD) product catalog
used by the Tapestry/Coach real-time personalization demo. Downstream agents
(synthetic-behavior generation, RealtimeSegmentEngine, recommendations,
"complete-the-look", personalized sort) should target the field names and types below.

This is a **synthetic catalog shaped to be ODP-friendly**, consistent with the demo's
"real seams, mocked calls" principle: real Coach product identity, no live external
dependency.

---

## File shape

```jsonc
{
  "_meta": { ... },          // catalog-level metadata (object)
  "products": [ Product ]    // array of Product objects
}
```

### `_meta` (object)

| Field | Type | Notes |
|---|---|---|
| `brand` | string | Always `"Coach"`. |
| `parent_company` | string | `"Tapestry, Inc."` |
| `region` | string | `"North America"`. |
| `currency` | string | `"USD"`. |
| `generated_for` | string | Human description of catalog purpose. |
| `product_count` | number | Count of items in `products`. |
| `data_provenance_note` | string | Summary of scraped vs constructed data. |

---

## `Product` object

Each element of `products` has the following fields. Required fields are always present.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Stable catalog id. Format `COA-<style_code>` (e.g. `COA-CH857`). Unique across the catalog — use as the primary key for recs/events. |
| `style_code` | string | yes | Coach style/SKU code (e.g. `CH857`, `CU068`, `4416`). Real Coach codes where scraped. |
| `name` | string | yes | Product display name (e.g. `"Tabby Shoulder Bag 26"`). |
| `line` | string | yes | Product line / collection (e.g. `Tabby`, `Pillow Tabby`, `Brooklyn`, `Lana`, `Mollie`, `Rogue`, `Kira`, `Nolita`, `Essential`, `Signature`, `Novelty`). The brief's hero lines (`Tabby`, `Brooklyn`) are well represented. |
| `category` | string | yes | Top-level category. One of: `Handbags`, `Small Leather Goods`, `Accessories`. |
| `subcategory` | string | yes | Finer category (see enum below). |
| `price_usd` | number (integer) | yes | Price in US dollars (integer; whole-dollar Coach pricing). |
| `currency` | string | yes | Always `"USD"`. |
| `colors` | string[] | yes | Available colorways, e.g. `["Black","Chalk","Deep Berry"]`. Always >= 1 entry. `colors[0]` is the lead/default colorway (also used to derive `image_url`). |
| `material` | string | yes | Primary material/fabrication (e.g. `"Polished pebble leather"`, `"Signature coated canvas"`, `"Quilted nappa leather"`). |
| `silhouette` | string | yes | Bag/good silhouette (see enum below). Useful for "complete-the-look" and sort. |
| `size` | string | yes | Size label including Coach's numeric size where applicable (e.g. `"26 (medium)"`, `"Slim"`, `"39 (large)"`). |
| `occasion` | string[] | yes | Occasion tags for journey/intent targeting (see enum below). Always >= 1 entry. |
| `image_url` | string (URL) | yes | Product image URL on the Coach Scene7 CDN host. **Constructed** asset path (see provenance). |
| `product_url` | string (URL) | yes | Canonical `coach.com` product page URL. Real where scraped. |
| `region` | string | yes | `"North America"`. |
| `in_stock` | boolean | yes | Availability flag (all `true` in this synthetic set; downstream may flip for OOS scenarios). |
| `data_provenance` | object | yes | Per-field provenance map (see below). |

### `data_provenance` (object)

Maps individual product fields to `"scraped"` or `"constructed"`:

| Key | Type | Meaning |
|---|---|---|
| `name` | `"scraped"` \| `"constructed"` | `scraped` = confirmed real Coach product name. |
| `price_usd` | `"scraped"` \| `"constructed"` | `scraped` = price confirmed from coach.com search results; `constructed` = realistic price within a confirmed Coach price band. |
| `colors` | `"scraped"` \| `"constructed"` | Colorways are `constructed` (realistic Coach colorways) unless noted; coach.com 403 blocks reliable per-SKU swatch scraping. |
| `material` | `"scraped"` \| `"constructed"` | `scraped` = material confirmed from product description text. |
| `style_code` | `"scraped"` \| `"constructed"` | `scraped` = real Coach style code seen in a coach.com URL. |
| `product_url` | `"scraped"` \| `"constructed"` | `scraped` = real coach.com URL returned in search; `constructed` = plausible coach.com URL following Coach's URL pattern. |
| `image_url` | always `"constructed"` | Host is real (`coach.scene7.com/is/image/Coach`); exact asset filename is constructed (Scene7 paths are not reliably scrapable behind the 403). |
| `subcategory` | always `"constructed"` | Our taxonomy. |
| `silhouette` | always `"constructed"` | Our taxonomy. |
| `size` | always `"constructed"` | Derived from name + typical Coach sizing. |
| `occasion` | always `"constructed"` | Our taxonomy for intent targeting. |

---

## Enumerations

### `category`
`Handbags` · `Small Leather Goods` · `Accessories`

### `subcategory`
- Handbags: `Shoulder Bags`, `Crossbody Bags`, `Totes & Carryalls`, `Top-Handle Bags`
- Small Leather Goods: `Wallets`, `Card Cases`, `Wristlets`
- Accessories: `Bag Charms`, `Bag Straps`, `Keychains`

### `silhouette`
`shoulder` · `crossbody` · `tote` · `hobo` · `top-handle` · `slim wallet` · `zip wallet` ·
`billfold` · `zip-around wallet` · `chain wallet` · `card case` · `card holder` · `wristlet` ·
`bag charm` · `strap` · `coin case`

### `occasion`
`everyday` · `work` · `evening` · `date-night` · `special-occasion` · `travel` ·
`festival` · `winter` · `gift`

---

## Conventions & notes for downstream agents

- **Primary key:** use `id` (`COA-<style_code>`). It is unique even when two distinct SKUs
  share a display `name` (e.g. two `Tabby Shoulder Bag 26` SKUs in different leathers).
- **Price is an integer** in whole USD. Treat `price_usd` as the sort/decision value.
- **Lead color / image:** `colors[0]` is the default colorway and is encoded into
  `image_url`. Do not assume the image resolves to a live asset — it is a representative
  CDN URL.
- **Targeting tags:** `line`, `silhouette`, `occasion[]`, and `subcategory` are the
  intended levers for segment qualification, personalized sort, and complete-the-look
  pairing (e.g. pair a `Handbags`/`Tabby` shoulder bag with a matching `Accessories`/`Bag Charms`
  `Tabby` charm and a `Small Leather Goods` wallet in an overlapping colorway).
- **Provenance honesty:** when surfacing data in the demo, treat anything marked
  `constructed` as representative, not verified live pricing — consistent with the
  North Star brief's "real vs representative" framing.
- All `product_url` and `image_url` hosts are Coach-owned. No non-Coach brands appear in
  this catalog.
