# OH: the home demo for LG, on the demo kit

**Governing document for the OH demo.** Opened 2026-10-02 by the lead on Simone's standing approval: she asked for a name recommendation and deferred; the recommendation was OH, read as "Optimized Home", and it is taken. The understanding and the ten use cases this demo shows are in [LG-Understanding-and-Use-Cases.md](LG-Understanding-and-Use-Cases.md); the chassis is the demo kit, [Demo-Kit-Design.md](../demo-kit/Demo-Kit-Design.md), proven on Vantage. Decisions are logged at the end; a lane that needs a decision not logged here stops and asks the lead, not the owner.

---

## 1. What OH is

A fictional home brand in LG's palette, selling LG's real products by their real names and images, on the content decision service. Three categories in the first build: **TVs with soundbars**, **laundry**, and **one kitchen path** (range → over-the-range microwave → dishwasher → kitchen package), about 500 products from the crawled taxonomy (`research/lg-taxonomy.json`). Monitors, laptops and the rest of the kitchen come later.

**Name and look.** OH. Wordmark "OH." in LG red (#A50034) on white; charcoal (#1D1D1B) text; grey (#6B6B6B) secondary; a light panel (#F5F5F5); the kit's director keeps its own dark palette. Inter for the page, JetBrains Mono for the machine panels. No LG mark, no "Life's Good".

**Worker and tenant.** Worker `edge-platform-oh`, queue `events-oh`, dev port 9120, tenant `oh`, session host, demo profile, its own D1 rows and durable objects, generated from `wrangler.toml` by `build-demo-worker-config.mjs`. Creating the worker, its queues, its tenant and its secrets is a one-time owner approval; everything before that is local.

**Honesty.** The visitor's region is always real, read from the request; the regional lean is synthetic and labelled "synthetic → warehouse" until LG's rows replace it; census is shown and never scored; price, financing and rebate eligibility never vary by geography or inferred income; nothing sits near a financing line; no recognition across devices without sign-in; attach is measured, never claimed; a retailer referral is not a sale. The lines of §6 of the understanding document apply to every piece of copy.

---

## 2. Surfaces and slots

| Surface | Decided slots | Off limits |
|---|---|---|
| Homepage `/oh/` | `hero` (take 1), `category-rail` (the order of the room tiles), `deals` (take 4), `for-you` (a product rail across rooms, through `/sort`), `continue` (the return hero, stage-gated) | header, service strip, footer |
| TV grid `/oh/tvs` | the product order through `/sort` with the regional prior; `grid-promo` (take 1) | filters, sort control |
| TV product page `/oh/p/<sku>` | `pdp-modules`: companions (soundbar matched to the series, a mount for the VESA pattern), protection, installation, the series comparison, where-to-buy; `pdp-offers` (take 2) | the buy box: price, sizes, Add to Cart, the financing line |
| Washer product page `/oh/p/<sku>` | `pdp-modules`: companions (the dryer in her fuel, the pedestal unless top-load, the stacking kit, the pair price), haul-away and installation, protection, where-to-buy; `pdp-offers` | the buy box |
| Range page (kitchen path) | `pdp-modules`: microwave, dishwasher, the package when cheaper | the buy box |
| Phone `/oh/m/` | the homepage's slots at phone width, plus the sign-in sheet | |

Where-to-buy carries two outcomes: **Best Buy pickup** (an OH order fulfilled by a partner) and **Find a Retailer** (a referral through a PriceSpider-shaped list), each recorded against the decision that earned it.

---

## 3. Dimensions

Sixteen, within the registry's 32: `category`, `subcategory`, `type` (French door, front-load, OLED, QNED), `series`, `panel`, `sizeBand`, `capacityTier`, `fuel`, `finish`, `priceTier` (category-relative: good, better, best, flagship), `room`, `feature`, `intent` (replace, remodel, new-home, upgrade; asserted or inferred), `contentType` (deal, compare, explainer, tool), `retailer`, `package`.

Decay for the walk, as Vantage compresses it: `contentType` and `retailer` 60 seconds; `priceTier`, `intent`, `feature` about 10 minutes; `type`, `series`, `sizeBand`, `capacityTier`, `fuel`, `finish`, `room` long (the published τ names 60 days; the demo's "three weeks later" beat is a labelled clock jump, as Vantage's exit beat is a timed re-ask). The regional allowlist (`learn.regional.dimensions`) is `category`, `type`, `sizeBand`, `priceTier`, `fuel`. Products stay out of the content catalog; their attributes travel on events and on `/sort`, as Vantage's phones do.

---

## 4. The walk: five acts, sixteen beats

| # | Act | The press | What moves | What the room sees |
|---|---|---|---|---|
| 1 | Arrival | a stranger lands from the search "lg tvs" (`utm_term`) in her real state | the regional prior leads the TV rail and the deals; the campaign term seeds TV | "North Carolina, from the request; your sales here lean OLED 65-inch; census shown, not scored"; Compare: the site's own page beside it |
| 2 | Arrival | the region contrast (asserted, labelled) | a different lean | the same page, a different state's sales |
| 3 | Two rooms | she opens two TVs, then a front-load washer | `room` and `type` rise; the category rail reorders; `for-you` balances rooms | the homepage that lg.com never changes, changing, with receipts |
| 4 | Two rooms | the fresh visitor beside her | Compare | her page against a stranger's, same region |
| 5 | The room completes | the washer page | companions: the dryer in her fuel, the pedestal, the stacking kit, the pair price | "goes with" shown as a merchandiser's rule |
| 6 | The room completes | she switches to a top-loader | the pedestal leaves, the card says why | a rule withdrawing itself |
| 7 | The room completes | the TV page | the soundbar for the series, the mount for the VESA pattern | the same engine, a different room |
| 8 | The room completes | the range page | microwave, dishwasher, the package price when lower | the kitchen path |
| 9 | Curation | a QNED page, with the OLED beside it; a size up from her viewing distance | tier and size-band | "price is the same for everyone"; nothing near financing |
| 10 | Curation | she enters a closet width | models that do not fit drop out | "hidden: 3 wider than your space" |
| 11 | Windows | an offer's window closes (a beat publish); a package with an out-of-stock member | the piece leaves every surface on the next decision | the defects lg.com shows today, fixed |
| 12 | Windows | a merchandiser pin on a launch series | the pin leads; the receipt shows what the engine would have chosen | the merchandiser outranks the engine, visibly |
| 13 | Three weeks later | the clock jump (labelled) | laundry interest faded faster than TV, by the dials; the continue hero | "pick up where you left off" |
| 14 | Three weeks later | the price that changed, the model that arrived | the shortlist's deltas | what changed while she was away |
| 15 | One person | the phone: a stranger, then sign-in (live, a fictional account; the worker mints the signed link) | the phone becomes the laptop's taste in one request | "linked at sign-in · consented · no device matching" |
| 16 | Best Buy counts | she presses Best Buy pickup on one page and Find a Retailer on another; the day report | two named outcomes, attach, attribution; "not yet significant" | the report LG does not have today |

Beats are data (`public/oh/beats.json`) on the kit's verbs; the escape hatch only where Vantage needed it (arrival, the clock jump).

---

## 5. Data

- **Products** `public/oh/products.json` from `research/lg-taxonomy.json`: the first-build categories, each row with SKU, name, URL, image, sale and list price, rating, review count, cart-or-retailer, and the attributes of §3 derived from the crawl's filter mapping (`categoryAttributes`); series from the name; `priceTier` category-relative by quartile; fuel, finish, capacity, size, panel where the crawl has them; a `fits` field (width, depth) where known. Companion relations in the same file: washer → dryers (by fuel, same series), pedestal (front-load only), stacking kit; TV → soundbars (by series tier), mounts (by VESA); range → OTR microwave, dishwasher, kitchen package.
- **Imagery** `public/oh/img/**` with `MANIFEST.json`: the taxonomy's image links (704 products have them, all on LG's media host); the rest fetched from the product pages; three encodings as Vantage's manifest records; provenance per file; within the 25 MB budget; every image reviewed through the manifest's gate.
- **Catalog pieces** `public/oh/catalog.json`: promotions (the gift card with purchase, pair and package savings, free wall mounting, the ThinQ warranty; each with its window), heroes per room, modules (companions, protection, installation, haul-away, series comparison, fit, where-to-buy), packages with `featuredProductIds`, the continue hero; prices are content, as in Vantage.
- **Regional vocabulary** for `seed-region`: per state, synthetic sales over `category`, `type`, `sizeBand`, `priceTier`, `fuel`, with the real regional fuel skew (gas cooking about 38% nationally, about 70% in California and New Jersey; dryers 80% electric); every state seeded.
- **Fictional sign-in accounts** by name only in the config; their secrets exist only on the worker.

---

## 6. Engine items (general, small, with tests)

1. **`complements`** on a piece (product ids it completes) and a slot rule that passes the composer's existing `prefer` hook, itemised on the receipt. Until it lands, companions gate on `ctx.anchor` as the framework map describes.
2. **Two named outcomes**: `partner_pickup` and `retailer_referral`, reward-bearing rows in the outcome contract, credited to the decision and counted in the day report beside orders and attach.
3. **The regional prior on `/sort`**, so the TV grid's product order leans with the state as the homepage already does.
4. **Google's auto-tagged click** (`gclid` without a UTM source) read as paid search by the channel classification, a W16 ruling recorded here as the demo's need; if the remediation track owns that ruling, the demo asserts the channel on the request and says so on the receipt.

Each is a lane on `src/**` with its tests, Vantage's suites held as the gate, Top Offers untouched.

---

## 7. Lanes

| Lane | Scope | Owns |
|---|---|---|
| **K4** | the scaffold from `demo.config.json` (the SE path), HOWTO, the `/new-demo` skill; proven by scaffolding OH | `scripts/demo-kit/**`, `public/oh/**` except the data lanes' files, `src/demos/oh.config.ts`, `src/routes/oh.ts`, `wrangler.oh.toml`, `docs/demo-kit/HOWTO.md`, `.claude/skills/new-demo/**` |
| **D1** | `products.json` with attributes and companions; `catalog.json` pieces; the regional vocabulary | `public/oh/products.json`, `public/oh/catalog.json`, `scripts/demo-kit/configs/oh/region.json`, `docs/lg/lanes/D1.md` |
| **D2** | imagery with the manifest | `public/oh/img/**`, `scripts/demo-kit/configs/oh/imagery.json`, `docs/lg/lanes/D2.md` |
| **E1** | the four engine items | `src/content/**`, `src/learn/**`, `src/reflex/**` as each item needs, with tests; never Top Offers' route |
| **P1** | homepage and TV grid renderers, facts, beats 1–4 and 11–14 | `public/oh/oh.js` (home and grid parts), `oh.css`, `index.html`, `beats.json` |
| **P2** | product pages: TV, washer, range; beats 5–10 | `public/oh/oh.js` (product parts), `product.html` |
| **P3** | phone, the live sign-in (demo route minting the assertion server-side, closed account list), where-to-buy outcomes, the report; beats 15–16 | `src/routes/oh.ts` sign-in route, `public/oh/m.html`, the where-to-buy module |
| **S1** | the two OH suites (request level and DOM) on the kit libraries | `scripts/rehearse-oh-*.mjs`, `scripts/demo-kit/configs/oh.json` |
| **R** | independent review before the first deploy | nothing |

Sequencing: K4, D1, D2 and E1 start now in parallel. P1, P2 and P3 start when K4's scaffold exists and D1's products are in; S1 alongside them. R before the deploy. The worker, queues, tenant and secrets are created on the owner's approval; deploy from a WSL worktree of the head; verify through the hosted suites; then the morning routine as Vantage's.

---

## 8. Decisions log

| Date | Decision | By |
|---|---|---|
| 2026-10-02 | The name is **OH**, "Optimized Home": the lead's recommendation, taken on Simone's standing approval after she deferred; OA remains hers to swap in | lead |
| 2026-10-02 | First build: TVs with soundbars, laundry, one kitchen path; about 500 products (Simone, 2026-10-01) | Simone |
| 2026-10-02 | The sign-in stitch is shown live: a fictional account named on the page, the assertion minted on the worker (Simone deferred; the lead chose live) | lead |
| 2026-10-02 | Worker `edge-platform-oh`, queue `events-oh`, tenant `oh`, dev port 9120; all cloud creation waits for the owner's one-time approval | lead |
| 2026-10-02 | Products stay out of the content catalog; attributes on events and `/sort`; companions as relations in the products file, served through `complements` once E1 lands, gated on `ctx.anchor` until then | lead |
| 2026-10-02 | Beats as data on the kit's verbs; the clock jump is a labelled beat as Vantage's exit re-ask is | lead |
| 2026-10-02 | D1 landed: `products.json` 602 rows (TVs 146 with variant sizes, soundbars 30, mounts 11, laundry 195, laundry sets 23, ranges 85, OTR microwaves 26, dishwashers 50, kitchen packages 26, 10 refrigerators as package members, 19 name-only parts so every companion resolves), 2,578 companion links all resolving; `catalog.json` 76 pieces, 53.7 KiB, accepted by the engine's own validator, copy checked against the honesty lines; `configs/oh/region.json` for all 51 regions with the fuel skew. Rulings on its gaps: D2's product-page pass also captures title, prices, call to action, dimensions and VESA into `public/oh/specs.json`, merged over the feed by sku on the page, so beat 10's fit and the mount companion work; K4 takes D1's four integration notes (vocabulary equality, all categories, slot piece types, the anchor instant) | lead |
| 2026-10-02 | E1 landed: `complements` on a piece with a slot rule through the composer's `prefer` hook, anchored on `ctx.anchor=<product id>`, fail closed, receipt "Completes what she committed to"; `partner_pickup` and `retailer_referral` as `REWARD_OF` rows on the `custom` reward, credited like a click, reported as named outcomes, never a purchase; the regional prior on `/sort` under the allowlist with a `regional` label; `gclid` without a UTM source classified as paid search, stopping at the classification because W16's entry contract still refuses `gclid`. 30 new tests; the full run adds no failure beyond the remediation baseline; Vantage's suites 115 and 292 on E1's rig. Rulings: the edits in `src/ledger/records.ts`, `src/routes/sort.ts` and `src/services/visit.ts` are accepted; the anchor family moves to `ctx.family` (D1 changes the gates, the pages send both); **Vantage's phones rail now leans by region on its next deploy, so Vantage's page must label it before that deploy (lane V1)**; for the remediation track: widen W16's entry contract to carry `gclid` (and whether `gbraid`/`wbraid` count), settle `gclid` with a declared medium and no source, and kit 03's piece field list needs `eligibleWhen` and `complements` | lead |

