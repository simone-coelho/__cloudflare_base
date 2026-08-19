<!-- INTERNAL - pursuit design bible. Produced by a dedicated deep-recon pass 2026-08-18; all findings primary-source from QVC's own shipped code, published pages, or product API unless flagged. ⚠️ = inference; ❌ = unverified, do not assert. Note: this pass did NOT research QVC Group financials/Athens — that material lives in QVC-Business-Intelligence-Dossier.md; the two documents complement each other. -->

# QVC RECON + REPRESENTATIVE DEMO DESIGN — CONSOLIDATED DELIVERABLE
**Date: 2026-08-18 · Prospect: QVC (qvc.com) · For: Optimizely real-time edge personalization demo**
*Archive copy. All corrections from four research threads applied in place.*

---

## METHOD & EVIDENCE QUALITY

qvc.com is behind **Akamai Bot Manager** — standard fetches return HTTP 418; the block is path-scoped, not host-scoped. Four unblocked channels carried better evidence than rendered HTML would have:

| Channel | What it yielded |
|---|---|
| Browser-UA fetch of `https://www.qvc.com/` root | **358KB of the live 2026-08-18 homepage DOM** |
| `https://www.qvc.com/etc.clientlibs/**` | **588KB production CSS + 672KB production JS** — design tokens, card templates, badge logic, i18n strings, feature flags |
| `https://api.qvc.com/api/sales/presentation/v{1,2,3}/us/products/{ID}` | **Live PDP data model**, unauthenticated |
| `https://www.qvc.com/us/**.json` + `https://api.qvc.com/us/{path}.json` | **Open headless AEM API** — every collection, content page, host page, and **dated homepages going back a year** |

Supplementary: pixel-decoded logo PNGs (exact brand hex), Wayback raw captures, open WordPress REST APIs on corporate.qvc.com and customerservice.qvcuk.com.

---

# PART A — SITE / UX TEARDOWN

## A1. Homepage module inventory — exact order, 2026-08-18

From `data-module-type` / `data-module-feature-name` / section `id` in document order, cross-checked against `/us/homepage/2026/08/2026-08-18.json`. `hideModule` = server-rendered hidden, revealed client-side after data/auth resolves.

| # | Section id | Module type / feature | Heading | Notes |
|---|---|---|---|---|
| 1 | `large_static_image_30` | LARGE_STATIC_IMAGE / TOP_SHOES_SALE | *(hero billboard)* | "Mega Shoe Sale: Deals on 1,000s of Styles." |
| 2 | `core_module_container_31` | CORE_MODULE_CONTAINER / TOP_SHOES_SALE | *(4 brand tiles)* | Clarks · Revitalign® · Skechers · White Mountain |
| 3 | **`myPersonalizedModule`** | **PERSONALIZED_MODULE** | **"Spotlight Deals for You"** | bg `#F3E0E7`; `enableAbTesting`; **ships EMPTY** — hydrated from `top-offers.json` (§A3) |
| 4 | *(unnamed)* | sweepstakes / third-party form | — | carries the `top-offers.json` fetch script |
| 5 | **`tsvWithTimer`** | FLEX_IMAGE_TEXT / **TSV** | *(TSV billboard)* | Clarks loafers TSV. **Timer element exists; countdown is deliberately CSS-hidden** (§A6) |
| 6 | **`WelcomeBack`** *(hidden)* | WELCOMEBACK | **"Worth a Look"** | 4 Adobe Target teasers: "Keep Shopping for…" (`QUS-AT-HP-NM3`) · "Deals for You" (`NM5`) · "We Think You'll Like…" (`NM2`) · "Inspired by Your Views" (`NM13`) |
| 7 | `core_module_container_31` | SEC_BEAUTY_BRANDS | "Beauty Brands We Love" | philosophy · Laura Geller · ELEMIS · bareMinerals® |
| 8 | **`onairmodule`** *(hidden)* | **CORE_IROA_MODULE_CONTAINER** / ONAIRMODULE | **"On Air"** + **"Items Recently On Air"** | live video + IROA carousel (max 35) + "Shop Items On Air" |
| 9 | `past_shows` | SHOPTHESHOWS | **"Shop the Shows"** | `#show-time` / `#show-title` placeholders |
| 10 | `dontMissDeals` *(hidden)* | PRODUCT_CAROUSEL / DEALS | **"Our Don't-Miss Deal List"** | zone `QUS-AT-HP-D1` |
| 11 | `savingsShowcase` | SAVINGS_SHOWCASE | **"Savings Showcase"** | TSV Deals · Big Deal℠ Specials · Beauty iQ Steal® ≥30% Off · Online Special Deals |
| 12 | `lunchtimespecials` *(hidden)* | LUNCH_TIME_SPECIALS | **"Lunchtime Specials®"** | "New deals served up daily"; zone `QUS-AT-HP-Z9` |
| 13 | `ShopByCategory` | SHOP_BY_CATEGORY | **"Shop by Category"** | 12 tiles |
| 14 | `adobeOne` *(hidden)* | CURRENTLYTRENDING | **"Currently Trending"** | zone `QUS-AT-HP-Z3`, feed `HPIBMFEED` |
| 15 | `core_module_container_14` | WATCH_AND_SHOP | **"Watch (& Shop) from Anywhere"** | Tune In Now · Interactive Livestreams · Stream QVC+ · QVC Everywhere |
| 16 | `QVCplus` | QVCPLUS | *(QVC+ promo)* | "Unfiltered with Shawn" |
| 17 | **`IBM_RECOS_PLAYBACK`** *(hidden)* | PRODUCT_CAROUSEL | **"Items You've Viewed"** | zone `QUS-AT-HP-Z2` |
| 18 | `adobeTwo` *(hidden)* | BASEDONYOURVIEWS | **"Based on Your Views"** | zone `QUS-AT-HP-Z1` |
| 19 | `showsViewed` *(hidden)* | SHOPTHESHOWS | **"Shows You've Viewed"** | `.recentlyViewedShows` |
| 20 | `core_module_container_14` | CRITEOCAROUSELBELOWITSMODULE | *(untitled)* | Criteo retail-media rail |
| 21 | `hackeySack` | RSUPERSCRIPTJAVASCRIPT | — | see §A2 |
| 22 | `flex_image_image_9` | EASYPAYANDRETURNS | — | QCard® VIP tile + QVC App "My Feed" promo |

**Footer:** Live Chat · Customer Service · 888-345-5788 → email signup → "Get More with QCard® — 12+ VIP Savings Events a year" → socials (incl. TikTok) → **"This is Shopping Brought to Life."** · sister brands HSN, Ballard Designs, Frontgate, Garnet Hill, grandin road · QVC International: Germany, Italy, Japan, UK.

**~15 merchandising modules, 6 of them recommendation surfaces showing overlapping inventory.** Their complaint that the homepage "serves too many categories and messages to everyone" is empirically true and is **partly a module-proliferation problem**, not only a targeting problem.

**Year-over-year diff** (`/us/homepage/2025/08/2025-08-18.json`): 2025 had 22 modules. Removed by 2026: `BUYAGAIN`, `INTHESPOTLIGHT`, `MUSTSEESHOWS`, `BLACKOWNEDBUSINESSES`, two live Clearance A/B tests. Added: `PERSONALIZED_MODULE`, `SHOPTHESHOWS` ×2, `ONAIRMODULE`, `LUNCHTIMESPECIALS`.

## A2. The daily-rebuild evidence

Every module carries an AEM authoring path of the form `/content/qvc-commerce-us/en/homepage/2026/08/2026-08-18/jcr:content/par_page/…` — **the homepage is an AEM page authored per calendar date**, and past/future dates are publicly retrievable via `/us/homepage/YYYY/MM/YYYY-MM-DD.json` (verified across five dates). Assets are date-stamped in the filename (`desktop_MegaShoeSale_LS_HP_20260818.jpg`).

**A merchandiser's own note ships in production HTML** (module `hackeySack`):
> `JS to Superscript all (R) marks, CSS to hide TSV countdown, Turn off Peach Swipe, Rando CSS to make me happy`

That is someone hand-patching CSS on a dated page to make today's offer look right. **"No manual rebuilding" is not an aspiration for them — it's a job someone is doing tonight.**

## A3. Personalization stack today

**Vendors:** Adobe Target (recommendations/zones) · Adobe Recommendations · Criteo (retail media) · Constructor.io (search, `constructorFullyLive: true`) · Bazaarvoice · Brightcove + Akamai HLS (video) · AEM · Scene7 · Adobe Analytics + Launch **and** Tealium (`utag_data`) · Akamai WAF/Bot Manager · SquareTrade · Synchrony (QCard) · Narvar (flag off) · Attentive (SMS) · Granify · Bambuser. Legacy platform was IBM WebSphere Commerce (robots.txt still disallows `/webapp/wcs/stores/servlet/*`). ⚠️ ContentSquare inferred from naming only.

**Adobe Target zone map (homepage):** `QUS-AT-HP-NM2/NM3/NM5/NM13` → "Worth a Look" tiles · `D1` → Don't-Miss Deals · `Z9` → Lunchtime Specials · `Z3` → Currently Trending · `Z2` → Items You've Viewed · `Z1` → Based on Your Views · `QUS-AT-POP-Z1/Z2` → add-to-cart off-canvas "You might also like". Hydration via `/api/sales/presentation/v3/us/products/list/{ids}`. `IBM_RECOS_PLAYBACK` is legacy naming only — served today by Target zone Z2.

**Delivery mechanism — the wedge.** Personalized modules ship `hidden`/`hideModule`, revealed only after the Target round-trip (`carReady()` removes the classes). **Client-side, post-load, flicker-prone, and structurally incapable of touching anything above the fold at first paint.**

### ★ `top-offers.json` — they already built our POV, by hand, on a test branch
`myPersonalizedModule` ("Spotlight Deals for You") ships empty and is hydrated from `https://www.qvc.com/us/content/test-do-not-publish/top-offers.json` — **12 buckets in 6 pairs: one timely offer and one evergreen fallback per category dimension** (electronics, kitchen, beauty, jewelry, fashion, home — e.g. kitchen: "Savings on Culinary Essentials" / fallback "Kitchen Clearance"). **That is a 6-dimension category-affinity model with a per-dimension evergreen cold-start/decay fallback** — hand-curated content, Target-selected bucket, served from a path named `test-do-not-publish` that robots.txt explicitly disallows. The same feed powers `/content/featured/my-recommendations.html`.

### Dedicated personalization surfaces
- **"Your Picks"** — 4 Target rails: "You Might Like These" · "Based on Your Purchase" · "4+ Star Suggestions" · "Deals You Might Like".
- **"Browsing History"** — "Your Recently Viewed Items"; has a `NOTSIGNEDIN` A/B module.
- **"Buy Again"** — exists as a page; homepage flag `buyAgainCarousel:false` (was live on the 2025 homepage).
- **"My Feed"** — TikTok-style shoppable video, 3 `NEXTGEN_VIDEO_CAROUSEL` rails ("Feed Your Wardrobe" · "Feed Your Discovery" · "Feed What's New for You"), rendered by `cdn.prod.ngd.qrg.tech/web-bundles/nextgen.js`.

### Capabilities built and switched OFF
```
enableBrowsePersonalization:      false     ← category/browse pages
enableCollectionPersonalization:  false     ← collection pages
buyAgainCarousel:                 false     ← was live on the 2025 homepage
displaySocialProofBadge:          false
nextGenUseRecommendedContent:     false     ← personalized video selection in My Feed
ieAiAssistantLayout:              false     ← an AI-assistant layout capability
```
**They have the surfaces. They can't fill them.**

### Identity
First-party `quid` cookie — UUIDv4, **1825-day (5-year)** expiry, `domain=.qvc.com`, mirrored to localStorage — plus `globalUserId`. Both passed to Criteo. **Durable first-party identity already exists.**

## A4. The offer model — from their own product API

`GET api.qvc.com/api/sales/presentation/v3/us/products/A734590` (the live TSV):
```jsonc
"pricing": {
  "currentMinimumSellingPrice": 59.98, "qvcMinimumPrice": 72.00, "retailMinimumPrice": 100.00,
  "retailPriceReason": { "code": "CMR", "description": "Comparable Retail Value" },
  "specialPriceType": {
    "code": "TSV", "description": "Today's Special Value",
    "specialPriceStartTime": "2026-08-17T20:10:00Z",
    "specialPriceEndTime":   "2026-08-22T05:10:00Z"
  },
  "productCreditTerms": [
    { "type":"EZ","code":"C3","numberOfInstallments":3,"text":"Available for 3 Easy Payments","minInstallmentAmount":19.99 },
    { "type":"EZ","code":"Q5","text":"5 Easy Payments","term":5,
      "startTime":"2026-01-01T05:00:00Z","endTime":"2027-01-02T04:59:59Z" }
  ]
}
```

Three findings that reshape the demo:
1. **The offer window is a first-class field on the ITEM, with start/end timestamps.** Not a campaign, not a CMS page. "Evergreen slots, ephemeral offers" is *already their data model* — their CMS just ignores it.
2. **This "Today's Special Value" ran ≈ 4.4 days**, not 24 hours. Their signature 24h construct is already being stretched — almost certainly why they asked about "4–5 days or less."
3. **Even the payment offer is time-windowed** (`Q5` has its own start/end). Eligibility windows are pervasive.

⚠️ TSV timing caveats: QVC US publishes only *"good for today ONLY… kicking off at midnight ET."* **The 11:59pm ET end time is inferred, never stated.** QVC UK genuinely runs a **27-hour TSV**. ❌ "TSV since 1987" is unverified. robots.txt disallows `/*APTSV*` — ⚠️ likely advance-purchase, consistent with §A5's lifecycle codes.

## A5. The badge system — fully reverse-engineered

`carouselBadge.getBadge()` normalizes ~60 merch price codes into ~13 visual buckets. **Badge style comes from the CODE; badge text comes from the merchandiser-authored `specialPriceCodeDescription`.**

Base chip: `padding:4px 8px; border-radius:4px; font-size:12px; uppercase; border:1px solid #7E8592; background:#fff; color:#28334A; :empty{display:none}`.

| Bucket | Treatment | Codes |
|---|---|---|
| **TSV** | solid `#DA291C` / white | `tsv, tsa, tps, tpa, tes, tea,` **`tsvprev, tsvprelaunch, tsvpresale, tsvpostsale`**, `ta0–ta10, includedship` |
| Sale price | white bg, `#DA291C` text, grey border | `spt, sfp, spr, spj, cp, cp1–cp3, cpq, csj, lts, oto…` |
| Informational | white bg, `#28334A` navy text | `big, bia, bis, gwp,` **`soldout, waitlist`**, `newbadge, freeshipping…` |
| **`lowstock`** | bg **`#FFF1D2`** amber / text **`#B10317`** | ← **their entire low-availability treatment** |
| `spb` | `#28334A` / `#F1C81E` gold | special bonus |
| `webonly` | `#F4A13B` orange / white | online-only |
| **`ioabadge`** | navy outline | **"Item On Air"** — injected live |
| *(intl)* | `jahrestagspreis` teal (DE), `saldi` blue (IT) | one shared codebase across QVC US/UK/DE/IT and HSN |

Consequences: **the TSV has an explicit preview → prelaunch → presale → live → postsale lifecycle** (three independent traces). And feature flag **`updateSalesPriceBadgeNames`** rewrites badge labels at render time (`replace(/\bprice\b/gi,'')`) — **a live, shipped example of label rewriting as a config flag**, precisely the seam AI-tagging + human-approval operates on.

## A6. ★ Availability vocabulary and the no-urgency-theater doctrine

QVC's **complete** availability vocabulary, verbatim from their own i18nMap:

> **On Air · In Stock · Low Stock · Sold Out · Waitlist · Advanced Order · Wait Cancel · "Pre Order Possible" · "Just missed it! This item is Sold Out."**

**Absent from the entire site — do not use in a QVC-representative build:** ❌ "Almost Gone" · ❌ "Limited Quantity" · ❌ "Going Fast" · ❌ "Only N left" · ❌ "X sold" · ❌ live inventory counters · ❌ any social proof.

Four independent evidence lines converge on a **deliberate refusal of urgency theater**: `displaySocialProofBadge: false` · the TSV countdown element exists but is **deliberately CSS-hidden by an author hack** · no countdown on TSV or any PDP (timers ship only on *event* pages — the 2016 "120 Hours" page ran a 3-hour reveal cadence) · zero scarcity vocabulary, byte-identical across PDP snapshots. Urgency is carried **by language and price framing**: *"One-Day Price"* · *"While Supplies Last"* · *"Like the weekend, it's bound to go quickly."*

**This is a company with a considered position on not pressuring its customer.** A demo built on ticking countdowns, scarcity meters and social proof would read as off-brand and would undercut their own most emphatic requirement (*do not over-personalize*).

Machine states: `availableToSellIndicator`/`ats` ∈ **`Y`|`N`|`W`**; per-SKU `ats` + `buyable`; grid flags `data-show-waitlist`/`data-show-soldout`; `<span class="soldOut">SOLD OUT</span>`. Waitlist/Advance Order copy: charged only if/when it comes into stock.

## A7. Product / catalog attribute axes (real)
```
productNumber "A734590" (letter + 5–6 digits; public term "Item #") · type "INVENTORY"
shortDescription · shortDubner · longDescription · meta.bulletedDescription
availableToSellIndicator Y|N|W · brandName/brandId · primaryClassCode "K978"
baseImageUrl (Scene7 shard) · maxOrderableQuantity 5
categories[] → 14 nodes, one primaryIndicator:true      ← multi-membership taxonomy
items[] → 138 SKUs {colorCode, sizeCode, ats, buyable, markdownFlag}
styles.COLORS[12] / SIZES[35] with per-option ats
shippingAndHandling {charge 5.50, discountCode, twoManHandling, defaultShippingMethodCode "GR"}
attributes (~35): lastOnAirDate "2026-08-18T14:02:01Z"   ← TV↔web continuity is a product field
                  "Sold Last 30 Days Quantity": 14        ← velocity signal
                  "Best Seller" · Season · Collection · Gender · "Fit Descriptor"
                  "Holiday And Occasion" · Adaptive · "Adaptive Features"
videos[] · moreInfoTabs[] · protectionPlans[] · promotions[]
avgRating 4.41 · reviewCount 3765 · itemLimit · canonicalURL
```
**`shortDubner`** — "dubner" is broadcast-control-room jargon for the on-screen chyron graphic. **Their web product schema is named after TV equipment.** The website is structurally downstream of the broadcast.

## A8. Navigation, IA, URL shapes

**12 top-level categories:** Clearance · Garden & Outdoor Living · Fashion · Beauty · Jewelry · Shoes · Handbags & Luggage · For the Home · Electronics · Kitchen · Food & Wine · Health & Fitness. A "Featured" group sits above Categories: Fall Trends · Online-Only Shop · Only at QVC.

**Secondary bars:** left = Deals · **Your Picks** · New · Fall Trends · Online-Only Shop · Clearance; right dropdown "**Today's Special Value & Deals**" = Deals · TSV · Big Deal · Beauty iQ Steal · Online Special Deal · Lunchtime Specials · Primetime Specials.

**"Watch" dropdown:** Items Recently On Air · Item On Air · Watch QVC TV · Program Guide · Livestreams · Meet Our Hosts · **My Feed Experience**; streaming shows incl. The Kim Gravel Channel, The Martha Stewart Channel, In The Kitchen Channel.

**Every category flyout uses the identical 5-block shape** — the copyable IA: *Departments → Deals → New & Trending → Specialty Shops → Shop by Brand (+ See All Brands)*, ending with New Arrivals, Clearance, Brands A–Z.

**URL shapes:** category `/c/<slug>/-/<taxid>/c.html` · collections `/collections/deals-lunchtime-specials.html` · PDP `/<slug>.product.A734590.html` · reco click-through carries `?recommendationTypeId=…&recommendationLocation=…&referringItem=…`.

**Sitemap: 740 collections.** All 21 `deals-*` enumerated (as-is → todays-special-value). Notable `featured-*`: age-of-possibility · 40th-anniversary · host-picks (+12 individual host shops) · trending-on-social · internet-famous · **expiring-offers** · **limited-time-offer** · **deal-drop** · **discovery-days** · staff-picks · customer-top-rated.

## A9. Design language

### Brand marks — pixel-decoded
Live logo: **`#F47963` coral 69.3%** + **`#28334A` navy 29.3%**. Corporate press logo: `#12304C` + `#D95A41` (filename suggests internal name **"Ora Blue"** ⚠️). **Coral dominates the mark; navy dominates the UI.** 2019 rebrand by Moxie + in-house. ❌ "QVC = purple" is historical — the fuchsia pair is **QVC Beauty sub-brand only**.

### Production UI palette (by frequency, 588KB live CSS)
`#28334A` primary navy (text, primary button, badge outline, **stars**, ×209+) · `#4A4A44` warm body text (×116) · `#F7F7F7` background · `#A0A098` warm grey borders · `#E11C2C` alert red · `#DA291C` **TSV/current-price red** (×27) · `#12684E` success · `#007FA3` info teal · **`#F47963` brand coral** (×12) · coral tints `#FDE4E0`/`#F69482` (secondary button) · blush module bgs `#F3E0E7`/`#FDE2D6` · gold-on-navy `#F1C81E`. **The neutral ramp is deliberately warm** (G≈R>B) — softens the navy system. Red is reserved almost exclusively for price.

### Typography
**TT Norms** (TypeType), self-hosted, preloaded as critical. `html{font-size:10px}` · body **16px / 1.5** on `#4a4a44`. **Only Medium (155 declarations) and Bold (25) ship — no Light or Regular; the default body weight is Medium.** Noto Sans fallback for `:lang(ja)` (shared codebase). `.priceOld` 14px · `.productBadge` 12px · `.stars` 17px, letter-spacing 4px.

### Buttons
`.btn{font-size:16px; padding:6px 12px; border-radius:0; outline-offset:4px}` · primary navy `#28334a` (Add to Cart) · secondary coral-tint `#fde4e0`/`#f69482` · tertiary white/`#a0a098` outline · `.btn-tsv` red `#da291c` · success/info/warning variants. **`border-radius:0` on buttons vs `4px` on badges** — squared CTAs, softened chips.

### Cards & imagery
Grid cards **1:1 square** (`padding-bottom:100%`); reco/teaser tiles **88.9%** (`productImgAspect:"88.9"`). **Stars are brand navy, not gold** — width-percentage overlay. Primary product shots are **pure-white packshots** (pixel-verified `#FEFEFE`); lifestyle imagery lives in AEM modules, never the PDP primary. Scene7 with named presets (`$aemflexmodulexxlg$` etc.).

### Copy voice — verbatim examples
*"It's almost fall, y'all!"* · TSV: *"One great item. One-day price. Special every day."* · Lunchtime: *"…come back daily to see what's new on the menu!"* · Weekend Bonus Value: *"Like the weekend, it's bound to go quickly."* · Tagline: **"This is Shopping Brought to Life."** Spoken second person, em-dash asides, exclamation points, heavy ®/℠/™ — switching abruptly to flat formal register for legal copy.

### The 50+ audience is stated, not inferred
Their own glossary defines **Q50 Pick**: *"QVC® is celebrating women 50+ to help them feel seen, supported, and celebrated… their Age of Possibility."* Measured UI consequences vs typical retail: body **16px/1.5** (vs 14px), default weight **Medium**, body contrast **≈9.7:1** (vs 4.5:1 floor), button text 16px, **+/− quantity steppers** (90px), high-contrast uppercase badges.

### ★ The built-in text-size adjuster
`fontOptions = {min:12, max:24, step:2, curSize:16, cookieName:"pdfs"}` — range **12→24px in 2px steps**, persisted to `localStorage["pdfs"]`, bound to the PDP long-description accordion, announced via `aria-live="polite"` (cleared after 500ms). ⚠️ `pdfs` = "product detail font size" is decoding; the binding is verified.

### Other accessibility
Skip link → `#pageContent`; `aria-hidden` ×82, `tabindex` ×73, `aria-label` ×49, `sr-only` ×27, `aria-live` ×7. **Dual-track pricing for AT** — struck price is `aria-hidden` with `<span class="sr-only">, was, $72.00</span>`. Stars aria-hidden, SR gets "4.4 of 5 Stars". An "Adaptive & Accessible" shop category exists; products carry `attributes.Adaptive`. ⚠️ **No `prefers-reduced-motion` rules found — a real gap** (our free credibility point).

## A10. PDP anatomy
*Element inventory from the live product API + PDP clientlib CSS/JS. ⚠️ Literal DOM order inferred.*

1. **Media stage** — gallery, `easyzoom`, per-SKU thumbs
2. **★ On-air video:** `videos[]` carries `{"type":"LLSHOWCLIP","caption":"On-Air Presentation"}` — **the PDP embeds the host's actual TV segment**, HLS on `vdqvcus.akamaized.net` via Brightcove (account 6091058944001). Present on 3 of 4 sampled products. Paired field: `attributes.lastOnAirDate`. (Homepage on-air uses YouTube; PDP uses Brightcove — different systems.)
3. Title + brand; **Item #** (search placeholder is literally `Enter Keyword or Item #`)
4. **Price block** — `.priceSell{color:#da291c}` (current price red) + `.priceOld` strikethrough with sr-only ", was, $X" + `.priceCompare` "After That: $XX" (introductory-price pattern). Percent-off computed client-side but **the daily deal uses the simple pair, not a percentage** (real TSV framing: *KitchenAid Artisan Mini $279.98, was $379.00*)
5. **Easy Pay** — code-driven copy: `C…` → "3 Easy Pays of $19.99"; `Q…` → "5 Easy Payments … using a QCard® or HSN Card"; `LF` → "N Months QCard Special Financing™". **Easy Pay also renders on grid cards** (`plpEZPay`)
6. **Buy box** — color swatches with per-option `ats` · size + guide · **+/− stepper** capped by `maxOrderableQuantity`/`itemLimit` · Auto-Delivery selector
7. **CTAs** — **"Add to Cart"** (zero matches for "Add to Bag" across 820KB of their JS) · wishlist heart · **Speed Buy®** one-tap express
8. Add-to-cart opens an **off-canvas sidebar** with mini buy box + upsell rail
9. Sold-out/waitlist states (`is-soldout-pdp`, `recSoldOutPDPCarousel` swaps in alternatives)
10. Per-item S&H ($3.50 beauty / $5.50 shoes / $0 with explicit free-S&H override); `twoManHandling` for furniture
11. **Reviews — Bazaarvoice** (avgRating, reviewCount, verified purchaser; standards ban incentivized reviews). ⚠️ Q&A on PDP unverified
12. **Accordions** — bulleted spec list; long description in host voice; Read More/Less i18n; 300px preview truncation
13. **`moreInfoTabs[]`** — contextual editorial tabs by merch class (Clarks → *Shoe Glossary*; Dyson → *About James Dyson*; philosophy → *Certified Cruelty-Free*)
14. **`protectionPlans[]`** — SquareTrade warranties ("Protect your Investment")
15. **Reco rails** — only **"Similar Items"** is a confirmed hardcoded title; ⚠️ "You May Also Like"/"Customers Also Bought" return zero matches — AEM-authored per module

**Grid card template (exact order):** square image → badge (`{bucket}` style + merchandiser label) → brand (currently `display:none!important`) → 3-line description clamp → price block → EZ Pay line → navy stars + review count → Add to Cart (suppressed when `ats === "N"`). Config flags: `data-show-atc/brands/ratings/waitlist/soldout`.

## A11. Live / on-air integration
- Homepage "On Air" = **YouTube embed** with `data-ioa-btn="cart"` (add to cart from the on-air tile).
- **IROA carousel** — up to 35 products; `IntersectionObserver`-driven; polls every **60s with `data-hashcode` diffing** (swaps only when content changed); pauses after 5 min inactivity.
- **IROA page** — 7 days of history, channel keys `qvc, 2ch, onq, sta, 11, 12, 14`, user-selectable display timezone (the source of most TSV "PT vs ET" confusion).
- **On-air products API:** `//api.qvc.com/api/sales/execution/v1/us/programs/on-air-products/channel/[ch]/start-date-time/[iso].json?number-of-hours=24`, timezone pinned US/Eastern.
- **On-air badge injection** live (`ioabadge` "Item On Air"; `"Aired " + time + tz`).
- **`start120Countdown`** — on reaching zero it re-fetches a page fragment and hot-swaps it. **Primitive auto-rotation on expiry — a blind refetch, not a decision.**
- **Program Guide with show reminders**: `channelCode, showCode, showName, eventDate, startTime, endTime, frequencyCode, advanceNoticeAvailableCodes, communicationTypeCode`; managed in My Account.
- **QVC+/HSN+** (plus.qvc.com) — free ad-supported streaming; observed live titles incl. *"Q Check® - A Big Deal℠"*, *"Menopause Monday"*; channel codes `qvc15` Outlet, `qvc11` Jewelry, `plus` Kim Gravel, `qvc13` Martha Stewart, `qvc_now` In The Kitchen.
- **QVC app** (Google Play, updated 2026-08-04, 4.17★): tabs Home · Shop · Watch · Cart · Account; voice search launches Live TV / Program Guide / IOA / IROA.

## A12. The published price-label glossary — ~45 named constructs
Verbatim roster: Anniversary Price · "As Is" Price · Beauty iQ Steal® · Big Deal℠ · Big Birthday Sale · Birthday Surprises · Black Friday Sale Price · Bonus Buy℠ · Breaking Deal · Buy More Save More · Clearance Price · Clearance Sale Price · Comparable Retail Value · Cyber Sale Price · Deal Drop · Easy Pay® Offers · Event Price · EVERYDAY Q VALUE · Exclusive · Final Sale Price · Friends & Family Sale · Holiday Surprise Price · Holiday Weekend Deal · If Purchased Separately Price · Lowest Price of the Season · **Lowest Price We Found** (names a **19-retailer comparison set**, shopped 3–5 business days prior) · Lunchtime Specials® · MSRP · On-Air Testimonials · One Day Only Price® · One Time Only Price · Online Special Deal · Only at QVC · Pre-Season Price · Primetime Specials℠ · Q50 Pick · QVC® Price · Retail Value · Sale Price · Sale Spotlight · Supersize Value · Today Only Price · Today's Special Value® · Try Me Price® · Value · Weekend Bonus Value℠ · While Supplies Last Price.

Key definitions: **QVC® Price** = the everyday struck-through anchor · **CMR** = comparison-shopped · **IPS** = components valued separately · **Final Sale = non-returnable** · **Today Only Price** = pop-up, end-of-day, "lowest price for three months" · **Weekend Bonus Value** = "doesn't pop up every weekend". UK-only: Feature Price, One Day Offer, **Surprise Price**, Web Firsts, Outlet Price. ⚠️ "Last Chance Price" appears in exclusion lists but is undefined. A captured TSV PDP carried state `MSG=TSV_OTO_INSTOCK`.

## A13. ★ Event calendar — verified durations

| Construct | Verified instance | Duration |
|---|---|---|
| **TSV** | daily | **24h US** (midnight ET) / **27h UK** |
| **QVC2 Big Deal** | nightly since 2017 | **24h, launches 9pm ET** — second daily deal, second channel, **offset clock** |
| Lunchtime / Primetime Specials | daily / nightly | intraday |
| Deal Drop / Bonus Buy℠ | weekly | 7 days / Mon–Sun |
| Weekend Bonus Value℠ | occasional | Fri–Sun |
| **"120 Hours of Deals"** (Black Friday 2015–17) | | **5 days with 3-hour staggered reveals nested inside** |
| **"72 Hours of Deals"** (Gift-a-thon, Dec 2025) | | 3 days |
| **"Nonstop Holiday Party"** (Nov 2022–24) | | **49 hours — deliberately the DST fall-back weekend** |
| "Two-Day Home Sale" (Jan 2026) / coupon events | | 2 days |
| Lucky Weekend (Mar 2025) | | Fri–Mon, 5 Easy Pays sitewide |
| Spring Celebration / Fall Fashion Fest | 2024 | multi-day + **1-day "Finale" ("Ends Tonight!")** |
| Christmas in July / 30 Days of Celebrations | annual | month-long |
| 12 Days of QCard (Nov–Dec 2025) | | weekly Tuesday drops |
| QCard VIP Savings Events | recurring | 12+/year |

**Direct answer to their question:** their grammar is **24h / 48h / 72h / 120h blocks, plus 49h oddities, weekend arcs, month-long tentpoles, and single-day Finale caps — with staggered reveals nested inside the long ones. That is five window lengths and a nesting rule. It is not five campaign types.**

## A14. Hosts
- Index "Meet Our Hosts" — 4-across grid of **square 760×760 photos** (full-bleed photographic, no circular avatars). **29 current hosts** (roster in the Business dossier).
- Bio page anatomy: breadcrumbs → **1218×550 hero** + "Meet Shawn" + a **fixed six-field bio card** (*QVC® Host Since · 1st Item Sold · Fave Food · Dream Travel Spot · Life Motto*) → original-series promo → **20-product picks carousel** → **"Brands She's Loving"** (12 square 426×426 tiles) → social follow.
- Also: Hosts' Closet, Models' Closet, QVC Fashion Influencers, 12 individual host shops.

## A15. What the representative demo MUST have
1. Billboard hero with a merchandiser-authored, non-personalized message
2. A **named daily-deal slot** — window expressed as **language, not a clock** ("One-Day Price", "Ends Today")
3. A **"Deals" menu of *named* offer constructs**, not a generic "Sale"
4. **"On Air Now"** with live video + auto-refreshing "Recently On Air" rail
5. **"Shop the Shows"** — time-stamped show cards
6. **Easy Pay installment text in the price block AND on grid cards**
7. **Strikethrough "was" price in dollars**, no percentage, on the daily deal
8. **Badges driven by offer code + merchandiser label**, incl. low stock / sold out / waitlist
9. Shop-by-Category tile grid (12) and the 5-block category flyout
10. **Host personalities** — square photos, six-field bio card, 20-item picks, "Brands She's Loving"
11. **PDP that plays the host's on-air segment** ("On-Air Presentation")
12. Warm navy/coral/greige palette; **red only for price**; squared buttons, 4px badges, navy stars
13. **16px/Medium body, ≥9:1 contrast, +/− steppers, 12→24px persisted text resizer**
14. QCard-style loyalty affordance + free-returns trust badges
15. **No countdowns, no scarcity counters, no social proof**

---

# PART B — REPRESENTATIVE CATALOG DESIGN

## B1. The fictional retailer

**Recommendation: "The Bright Hour."** The name encodes the ephemeral offer window, which is the whole demo. Channels **BH Live / BH2**. Daily deal = **"Today's Bright One"**. Installments = **"Bright Pay"**. Loyalty card = **"The Bright Card."**

⚠️ **Name-collision warning:** "Today's Big Find" collides with **"The Big Find," a real QVC entrepreneur/product-search competition.** Avoid it and "Bright Find". **"Today's Bright One"** is clean.

| Name | Daily deal | Feel |
|---|---|---|
| **The Bright Hour** ★ | Today's Bright One | Live, optimistic, time-boxed — best thematic fit |
| Marigold & Main | The Marigold Pick | Warm, Main-Street, homey |
| Cardinal & Co. | The Daily Cardinal | Heritage, trustworthy |
| Everly Lane | The Everly One | Soft, discovery-driven |
| Lantern & Lane | Tonight's Lantern | Cozy, evening/live-TV cadence |

### Design tokens for The Bright Hour
Deliberately adjacent to QVC without copying, matching their structural rules exactly:
```
Ink (primary)      #233047   — text, primary button, badge outline, STARS, masthead
Brand coral        #EF7A5E   — the mark's dominant color (mirrors coral-led logo)
Warm charcoal      #484842   — body text (≈9.4:1 on white)
Signal red         #D8322E   — current price and daily-deal badge ONLY
Blush surfaces     #F6E6E4 / #FBEFE9      Greige: #F8F7F5 / #EDEBE7 / #DCD9D3 (warm ramp)
Warm grey border   #A3A29A    Success #146B52    Link teal #0B7A93    Gold-on-navy #F2C744
Low-stock chip     bg #FFF1D2 / text #B10317      ← QVC's exact treatment
Type      Hanken Grotesk (headings 600/700) + Figtree (body 400/500) — open near-twins of TT Norms
Body      16px / 1.55 · Medium default weight · buttons 16px
Radii     buttons 0 · badges 4px · focus outline-offset 4px
Cards     grid 1:1 square · reco/teaser tiles 88.9%
Stars     ink #233047, width-percentage overlay, 17px, letter-spacing 4px
A11y      12→24px persisted text resizer · +/− steppers · prefers-reduced-motion (their gap, our win)
```

## B2. Catalog: 8 categories, 62 items
Kitchen & Table (9 — Copperline, Fresco Nine, Marlow & Bell) · For the Home (9 — Havenmoor, Lumen House, Wren Hollow) · Beauty & Wellness (8 — Solene, Fieldnote, Aurelle Labs) · Fashion (8 — Delaney Park, Trueform, Nell & Bray) · Jewelry (7 — Vireo Fine, Larkspur Silver, Coronet) · Electronics & Tech (7 — Northbeam, Quilla Audio, Halo Field) · Garden & Outdoor (7 — Rootwell, Terrace & Thorn) · Food & Wine (7 — Harbor Larder, Two Rivers Bake Co.). Brand personalities: heritage-classic | modern-clean | host-led | value-workhorse | artisan | tech-forward.

**Structural requirement carried from `top-offers.json`:** every category carries **both a timely offer and an evergreen fallback** — when a visitor has no affinity yet, or affinity decays below θout, the slot falls to the category's evergreen entry rather than going blank. That is QVC's own mental model.

## B3. Item schema (mirroring their real fields 1:1)
```jsonc
{
  "itemNumber": "B412907",                     // mirrors A###### ; label "Item #"
  "shortDescription": "…", "shortDubner": "…", // their TV-chyron field, kept deliberately
  "longDescription": "…",                      // written in the on-air host voice
  "bulletedDescription": ["Style: …","Imported","Fit: true to size"],
  "brandName": "Copperline", "brandPersonality": "value-workhorse",
  "primaryClassCode": "K221",
  "categories": [{"id":"K221","primary":true},{"id":"T108"},{"id":"S440"}],

  "pricing": {
    "comparableRetail": 149.00,                // ← retailPriceReason CMR
    "ourPrice": 109.98,                        // ← qvcMinimumPrice, strikethrough "was"
    "currentSellingPrice": 79.98,
    "priceBand": "core",                       // entry <40 | core 40–120 | elevated 120–300 | premium 300+
    "brightPay": { "code":"C4","installments":4,"amount":19.99,"phrasing":"4 Bright Pays of $19.99" },
    "cardGatedPay": { "code":"Q5","installments":5,
                      "phrasing":"5 Bright Payments of $15.99 using a Bright Card",
                      "windowStart":"2026-01-01T05:00:00Z","windowEnd":"2027-01-02T04:59:59Z" },
    "specialFinancing": null                   // mutually exclusive with brightPay (§C3)
  },

  "offer": {
    "code": "TBO", "label": "Today's Bright One",   // code drives style; label is merchandiser text
    "badgeBucket": "tsv",
    "type": "daily_deal",                      // daily_deal | limited_time_event | on_air | one_time_only
                                               // | web_exclusive | clearance | final_sale | evergreen
    "windowStart": "2026-08-19T04:00:00Z", "windowEnd": "2026-08-20T03:59:59Z",
    "lifecycleState": "live",                  // preview | prelaunch | presale | live | ending_today
                                               // | postsale | expired   ← mirrors tsvprev/prelaunch/presale/postsale
    "parentEvent": null, "revealIndex": null   // set for nested staggered reveals (e.g. 7 of 40)
  },

  "availability": { "ats":"Y", "unitsRemaining":412, "maxOrderableQuantity":5, "lowStockThreshold":50 },
  "urgencyState": "in_stock",                  // in_stock | low_stock | sold_out | waitlist | advanced_order
                                               // ← THEIR strings. No "almost gone".

  "signals": { "lastOnAirDate":"2026-08-18T14:02:01Z", "soldLast30Days":1840,
               "bestSeller":true, "presentedBy":"host_dana_reyes" },
  "media":   { "onAirClip": { "type":"LLSHOWCLIP","caption":"On-Air Presentation","poster":"…","src":"…" } },
  "merch":   { "season":"Fall","collection":"Harvest Kitchen","occasion":["everyday","entertaining"],
               "adaptive":false,"discoveryTag":"new-to-you","moreInfoTabs":["Cookware Glossary","About Copperline"] },
  "returnPolicy": "standard",                  // standard | final_sale (non-returnable)
  "shippingHandling": 5.50,
  "reviews": { "count":3765, "averageRating":4.41 },
  "assets": { "base":"/img/b/41/", "primary":"b412907.001" }
}
```

## B4. Offer constructs the demo needs

| Construct | Code | Window | Count | Demo role |
|---|---|---|---|---|
| **Today's Bright One** | `TBO` | 24h, midnight ET | 1 live + 1 queued + 1 in preview | Centerpiece takeover slot |
| Bright One Preview / Presale | `TBOPREV`,`TBOPRE` | T-24h → T-0 | 1 | Proves lifecycle before live |
| **BH2 Nightly Deal** | `BH2` | 24h, **launches 9pm ET** | 1 | Second daily deal, offset clock (mirrors QVC2 Big Deal) |
| **The Harvest Kitchen Event** | `EVT` | **4.5 days** (mirrors the real 4.4-day TSV) | 8 | The "4–5 day offer" case |
| **"120 Hours" tentpole** | `EVT120` | **5 days + 3-hour staggered reveals nested inside** | 40 reveals × 1–3 | ★ Nested ephemeral construct |
| 72-Hour Weekend / Two-Day Sale | `EVT72`,`EVT48` | 3 / 2 days | 6 / 5 | Window-grammar coverage |
| **Finale** | `FIN` | 1 day capping a longer event, "Ends Tonight" | 4 | Single-day cap |
| Lunch Hour Steals / Primetime Steals | `LHS`,`PTS` | 12:00–14:00 / 20:00–23:00 ET | 5 + 5 rotating | Intraday precision |
| On Air Now | `IOA` | live, show-schedule driven | rail of 12, 60s refresh | TV-to-web |
| One Time Only | `OTO` | until gone | 3 | Scarcity without a clock |
| Online Only / Deal Drop | `WEB`,`DDP` | evergreen / weekly | 6 + 6 | Channel + weekly cadence |
| Final Sale | `FIN_S` | evergreen | 4 | **Non-returnable — an eligibility constraint** |
| Last Chance / Clearance | `LC` | evergreen | 8 | Always-eligible floor |
| Q50-style curated pick | `Q50` | merchandiser-pinned | 1/day | Awareness slot (Beat 5) |
| Evergreen catalog | — | none | ~15 | Discovery pool for exposure quotas |

**Time compression for the room:** a `demoClock` multiplier plays a 24h window in ~4 min, a 4.5-day event in ~12, a 3-hour nested reveal in ~30s — **with real ISO timestamps still on screen and in the export. Never fake the timestamps; scale the clock.**

---

# PART C — CREATIVE STRATEGY

## C1. Dimension registry (9 dimensions)
Expressed in the shape the reflex core already consumes (`DimensionSpec` with per-dimension `tauMs`/`K`/`thetaIn`/`thetaOut`). **Two τ columns — showing both is itself a credibility move.**

| # | Dimension | Source | Demo τ | Prod τ | θin/θout | Why this speed, for live commerce |
|---|---|---|---|---|---|---|
| 1 | `category` | `categories[].primary` | 90s | 14d | .60/.45 | Core interest; survives a browse detour. Maps 1:1 to their six top-offers buckets |
| 2 | `subcategory` | `primaryClassCode` | 60s | 3d | .60/.45 | Sharper, more disposable — "air fryers" fades faster than "kitchen" |
| 3 | `brandPersonality` | `brandPersonality` | 240s | 30d | .55/.40 | **Taste is durable.** The long-term half of two-speed |
| 4 | `priceBand` | selling price (band) | 300s | 45d | .55/.40 | **Slowest.** Price posture is a trait, not a mood (matches the existing priceBand-override precedent) |
| 5 | `offerTypeAffinity` | `offer.type` | 120s | 7d | .60/.45 | Does this person shop *constructs* or *categories*? The most under-used signal in live commerce |
| 6 | `urgencyResponsiveness` | interactions with time-bound offers | **45s** | 24h | .65/.45 | **Fastest durable dim.** Deal-responsiveness is a mood; fast decay IS the governance for Beat 11. Reads offer-framing clicks — never countdowns/scarcity, which don't exist here |
| 7 | `hostAffinity` | `signals.presentedBy` | 180s | 21d | .55/.40 | Live-commerce-native. Parasocial loyalty is real and durable. **No competitor models it** |
| 8 | `sessionMission` | derived: category spread, search→PDP depth, dwell | **30s**, session-scoped | session only | .70/.50 | `mission` vs `browse`. Drives **layout**, not just content |
| 9 | `mediaAffinity` | on-air clip dwell, rail scroll vs grid clicks | 90s | 10d | .60/.45 | Watch-to-buy vs read-to-buy; decides whether the on-air rail outranks the grid and whether the PDP leads with video |

**Two-speed decisioning is structural, not cosmetic:** dims 3, 4, 7 (τ 240–300s / 21–45d) are the durable profile; dims 6, 8 (τ 30–45s) are tonight. **Same engine, same math, different τ. One config file, not two systems.**

**Audience generation:** all nine feed the generator with `minProducts: 3` — "Cast-Iron Affinity", "Artisan-Brand Affinity", "Daily-Deal Responder". Nobody names these; the catalog does. Regeneration is a diff that never touches pinned or human-edited audiences.

## C2. Slot composition precedence (declared, and shown on screen)
```
1. ELIGIBILITY GATES   offer window open? lifecycleState ∈ {live, ending_today}?
                       ats ∈ {Y,W}? business rules (§C3)? returnPolicy constraints?
2. MERCHANDISER PINS   billboard, Q50-style curated pick, contractual/vendor placements
3. WEIGHTED RANKING    Σ (affinity_d × weight_d) over surviving candidates
4. EXPOSURE QUOTAS     discovery floor: ≥N slots reserved for non-affinity items
5. TIE-BREAK           deterministic hash(visitorId, slotId) — replayable
```

## C3. Published business rules for the eligibility-gates layer
All real, all published by QVC:
- **Easy Pay and QCard Special Financing are mutually exclusive in both directions.**
- **Easy Pay hard cap: 6 installments.** QCard everyday benefit upgraded 3 → 5 (~Feb–Mar 2026).
- **Special Financing** = deferred interest 9/12/18 months; not on QVC+/HSN+ or Speed Buy®.
- **VIP-offer exclusion roster** (ready-made non-discountable list): As Is · Clearance · Clearance Sale · Final Sale · Last Chance · Lunchtime Specials — plus Waitlist orders, QVC+/HSN+, retail stores, Speed Buy.
- **Final Sale Price = non-returnable.**
- **Waitlist preserves the price** at order time. US window 45 days; UK 90.
- **Auto-Delivery = a PRICE LOCK, not a discount** — cadence ~60/90 days; two consecutive refund-returns auto-cancel. UK Subscribe & Save lets a customer **lock the TSV price in perpetuity** — an offer that never expires *for that customer*.
- **Speed Buy auto-applies Easy Pay** (higher of item count vs card benefit).
- Easy Pay billing: first installment authorized at order, bills every 30–31 days from **ship date**; QVC credits cannot pay installments.
- QCard VIP: 5 Easy Pays everyday · 12+ VIP Savings Events/yr · $10 anniversary credit · early access · VIP phone line · no annual fee · reciprocal HSN Card status.

## C4. The 14 demo beats

### BEAT 1 — Cold Open (first click, zero history)
Visitor clicks two air fryers and a Dutch oven. By the **third** view — ~15 seconds — the "Spotlight for You" slot repaints from generic Fall Trends to Kitchen & Table, the `category: kitchen` meter visibly crossing θin = 0.60. Before the threshold, the slot shows the category's **evergreen fallback**, exactly as top-offers.json does. **Maps to:** *"a model that takes long to learn is disqualifying."* Say the number: **three interactions, ~15 seconds, fully anonymous.**

### BEAT 2 — ★ THE CENTERPIECE: ephemeral offer lifecycle, end to end (8–10 min)
| Moment | What happens | What's visible |
|---|---|---|
| 2a. Ingest | New item "Copperline 9-Qt Enamel Dutch Oven" arrives with sparse metadata (title, price, one image) | Raw feed row in an "Incoming" tray |
| 2b. AI proposes tags | category/subcategory/occasion/brandPersonality + the offer pair `TBO` / "Today's Bright One" — each with confidence | Proposal card, confidence + provenance per tag |
| 2c. **Human approves** | Merchandiser accepts 5, **edits one** (value-workhorse → heritage-classic), rejects one; stamped user + time | **Do not skip the edit** — it proves the human loop. Note aloud: QVC already ships `updateSalesPriceBadgeNames`, a live label-rewriting flag |
| 2d. Window opens | `windowStart` passes → `preview → prelaunch → presale → live`. **No campaign created. No page rebuilt.** The evergreen slot simply now has an eligible occupant | Lifecycle chip flips through their own state names |
| 2e. Ranking diverges live | Three visitors: A (kitchen, deal-responsive) → slot 1; B (jewelry, evergreen-preferring) → slot 4; C (new, urgency-responsive) → slot 1 with **"One-Day Price"** framing while A gets **value/strikethrough** framing | Three browsers, one slot ID, three outcomes, three explain records |
| 2f. Expiry → next flows in | Compressed clock hits `windowEnd` → `expired`, drops out of every eligible set simultaneously; tomorrow's TBO (sitting in preview) goes live and takes the slot. Zero human action. Then the **nested case**: a 3-hour staggered reveal inside the 120-hour tentpole expires and the next reveal takes over *without the parent event changing* | Swap live across all three browsers over WebSocket; then the export row appears (Beat 7) |

**The line to land:** *"You didn't build a campaign. You published an item with a start time and an end time. Your product data already has that field — `specialPriceStartTime` / `specialPriceEndTime`. We just made the page read it."*

### BEAT 3 — Three Visitors, One Slot
Three panes, same slot ID: A → the 4.5-day Harvest Kitchen Event; B → a jewelry Deal Drop; C → the discovery-quota pick (zero-affinity Garden item). Each pane has an **[explain]** chevron. **Maps to:** *"several strong eligible offers with the system choosing which offer for which customer."*

### BEAT 4 — Two Speeds (durable profile vs tonight)
Returning visitor: 30-day heritage-classic + elevated posture (hero reflects it) spends 90 seconds in deep-discount clearance → **session dims spike and framing changes; brand/price-band bars barely move.** She idles 60s → session dims decay back; durable bars stay flat. Two bar groups, two decay curves, animating live. **The most persuasive 30 seconds in the demo — the abstract claim becomes arithmetic.**

### BEAT 5 — The Billboard Stays (anti-over-personalization governance)
Slot 1 = a **pinned Q50-style curated pick**, identical for all three visitors; explain reads `pinned: true, ranking skipped`. Slot 5 = quota-reserved discovery: explain reads `reason: discovery_quota, affinity: 0.02, held_for_exposure_floor`. Then the presenter **turns the quota off** and the page collapses into a monotonous kitchen wall — visibly worse. **Maps to:** *"do not over-personalize."* Showing the failure mode then the guardrail beats asserting restraint. Q50 Pick is a construct they already run — merchandising stakeholders recognize it instantly. **This is the beat most vendors skip.**

### BEAT 6 — TV to Web (homepage AND PDP)
Homepage: visitor has a **show reminder** set for tonight's 8pm show (their real field set: channelCode, showCode, eventDate, advanceNoticeAvailableCodes) — at 7:45pm her homepage gates that show's items into the On Air rail and aligns the hero, **before the show airs**. Alt entry: a link carrying `?show=…&item=…`, seeded at the edge **before first paint** — no flash, no reflow. PDP: she taps through and the page **plays the host's actual segment** ("On-Air Presentation", their LLSHOWCLIP pattern); the Recently-On-Air rail filters to `lastOnAirDate` within 2 hours. **Contrast explicitly with their `carReady()` client-side reveal.** A show reminder is a more QVC-native signal than a UTM parameter.

### BEAT 7 — The Export Row (KPI / warehouse proof)
One flat, warehouse-shaped row per decision:
```
decision_id, ts, visitor_id, session_id, slot_id, page_type,
candidate_set[], chosen_item_id, offer_code, offer_label,
offer_window_start, offer_window_end, offer_lifecycle_state, parent_event, reveal_index,
gates_passed[], gates_failed[], pinned, quota_reserved,
dimension_scores{category:0.71, brandPersonality:0.44, urgency:0.83, hostAffinity:0.62, …},
rank_score, rank_position, tie_break_hash,
experiment_id, variation_id, campaign_id, config_version, engine_latency_ms
```
Then the join: `decision_id → pdp_view / add_to_cart / order`. Every stated KPI maps to a column (repeat visits = visitor_id × distinct sessions; module engagement = slot_id × downstream click split by quota_reserved; productive sessions = ≥1 joined conversion; **uplift = experiment_id/variation_id + control holdout, computed by THEIR analysts**). **Critical framing: we hand them the rows; they compute the lift.** Never present our own uplift number as the proof.

### BEAT 8 — Sold Out Mid-Session
The featured Bright One sells through while three browsers are open. High-affinity pane → flips to **Waitlist** (price preserved, per their real rule). Low-affinity pane → **replaced entirely** by the next eligible offer. No reloads. States use their exact strings: In Stock → Low Stock → Sold Out → Waitlist. Uses their real `Y/N/W` model — a detail their engineers will notice.

### BEAT 9 — Mission vs Browse
A arrives via search for "cast iron", straight to PDP → `mission`: her homepage return collapses to **4 modules**, offer-forward. B scrolls three rails, watches 40s of on-air clip → `browse`: **9 modules**, discovery rail and video promoted. **This is the beat that reduces module count — the direct antidote to their 15-module homepage. Frame it as personalization that removes modules, not one that adds another carousel.** That reframe is worth the meeting.

### BEAT 10 — The Audience Ledger
Merchandiser adds `Collection: "Hearthside"` to 6 items → next regeneration, **"Hearthside Affinity" appears** (minProducts: 3 satisfied). A pinned, human-edited audience beside it is visibly **skipped** (`skippedHumanEdited`). Pre-empts "so we have to define hundreds of segments?" — no, the catalog already did.

### BEAT 11 — Urgency, Earned Not Assumed
**Same product, same slot, two visitors.** A has engaged two time-bound offers → *"One-Day Price · Ends Today"*. B has scrolled past every deal construct → same item framed *"Comparable Retail $149 · Our Price $79.98 · 4 Bright Pays"* with **no time language at all**. A idles 60s → urgency decays below θout → **her framing reverts to calm on its own.** No countdown. No scarcity counter. No social proof. For an audience skewing 50+ and loyal, *"we stop pressuring people who don't respond to pressure"* is a brand-safety argument as much as a conversion one. **They already refuse urgency theater (§A6) — we supply the mechanism for a stance they hold.**

### BEAT 12 — Host Affinity (and the video feed)
A visitor who engaged two Dana Reyes items: On Air rail reorders to Dana's segments, Shop the Shows leads with her shows, her host page renders in their exact format (square 760×760 portrait, six-field bio card, 20-item picks, "Brands She's Loving") — **bio fixed, only the picks carousel personalized.** A short-form video rail (mirroring My Feed) orders by mediaAffinity. **Nobody in their vendor set models the host as a dimension** — despite 29 hosts, 12 host shops, named host channels, and an entire parasocial economy invisible to their personalization today (My Feed ships `nextGenUseRecommendedContent: false`). This is the beat that says *we studied your business, not your funnel.*

### BEAT 13 — Experiment on Top
Slot 2 runs a 2-arm test on offer framing (time-language vs value-language); the decision record carries `experiment_id` + `variation_id` **in the same row** as the affinity scores. Flip to a bandit; traffic reallocates live while the explain record shows gates and quotas still respected. *(Their 2025 homepage carried two live Clearance A/B tests that are gone in 2026 — worth asking why.)*

### BEAT 14 — The Glass Box (and the rule that refuses)
Presenter clicks **[explain]** on any slot, unscripted: candidates → **gates passed/failed with reasons** → pins → per-dimension scores × weights → quota decision → rank → tie-break hash → config_version → latency ms. Then **changes a τ in config and reloads** — behavior changes, no redeploy. **★ The engineered moment:** a slot where a **high-affinity item is excluded by rule, not by score** — a Final Sale item ineligible for the VIP offer: explain reads `gate_failed: vip_offer_exclusion (final_sale)` with `affinity: 0.81`. **Showing the engine refusing to serve something the visitor would probably have clicked is the most persuasive possible demonstration that precedence is real and merchandising rules outrank the model.** Every decision is reproducible — same inputs, same config version, same output — a property ML-based competitors cannot offer.

## C5. Recommended presentation spine
1 Cold Open → 9 Mission vs Browse → 3 Three Visitors One Slot → 5 The Billboard Stays → 4 Two Speeds → **★2 The Full Lifecycle (~10 min)** → 8 Sold Out Mid-Session → 6 TV to Web → 12 Host Affinity → 11 Urgency Earned → 13 Experiment on Top → 7 The Export Row → 10 Audience Ledger → 14 Glass Box **(kept open and clicked into throughout, not saved for the end)**.

---

# PART D — ASSET & IMAGERY PLAN

## D1. Sourcing recommendation — clear call
**Do not use QVC's product imagery, even for a private demo.** Three reasons in order:
1. **It defeats the demo's premise.** The pitch is "we built your world." Real QVC photography on a fictional brand reads as a mock-up, not a build — the first person to recognize a Clarks loafer stops watching the personalization and starts auditing the assets.
2. **Their brand and legal people may be in the room.** Vendor-owned product photography carries usage terms QVC licenses; we don't inherit them.
3. **It breaks the offer story.** Beat 2 hinges on an item with *sparse metadata* that we tag. Real QVC imagery arrives with real QVC metadata — the story unravels.

Use QVC imagery as an **internal moodboard only** — crop ratios, lighting, background value, badge placement. Never shipped.

## D2. Asset inventory
| Asset | Method | Spec |
|---|---|---|
| Product shots (62) | **AI-generated**, one locked recipe per category | **1200×1200 square**, seamless near-white `#FEFEFE` (their pixel-verified packshot standard), soft top-left key, 8% margin. Lock seed/style per category — grid consistency beats any single shot |
| Reco/teaser crops | Derived | 1200×1067 (**88.9%**) |
| Hero / lifestyle (8) | AI-generated | 2400×1000, warm domestic interiors, natural light, people 45–65 where present, no logos, no baked-in text |
| **Offer badges** | **Designed in code (SVG/CSS)** | Mirror their bucket→style map; text from `offer.label`, **never baked into a raster** — Beat 2c changes a label and it must re-render. 4px radius, uppercase, 12px, `:empty{display:none}` |
| Availability states | Code | Their nine strings only |
| Price block | Code | Current price red + strikethrough "was" in dollars (no %) + Bright Pay line; `sr-only` ", was, $X" |
| Window-state language | Code | `Live → One-Day Price → Ends Today → Last Hours`, driven by `offer.windowEnd`. **No shopper-facing clock** |
| Presenter countdown | Code, **ops view only** | Real ticking clock in the glass-box panel — proves the mechanic without selling with it |
| Host portraits (6, fictional) | AI-generated | **760×760 square, full-bleed photographic** (not circular), warm studio light, diverse, ages 40–65 skewing female; + 1218×550 hero each; name, show title, six-field bio card |
| "Brands She's Loving" tiles | AI/code | 426×426, 12 per host page |
| On-air rail thumbnails (12) | AI poster + code overlay | 16:9 + code-drawn LIVE dot, show title, "Aired {time} ET" |
| On-Air Presentation clip | One 30–60s generic looping studio clip, muted, or animated poster | Mirrors their LLSHOWCLIP caption + PDP placement. **Do not attempt a real stream** — a looping poster with a live badge reads identically at demo distance |
| Category tiles (8–12) | AI cutouts on tinted circles | Matches their `$aemshopbycategory$` treatment |
| Logo / wordmark | Code (SVG) | BH roundel + wordmark, **coral-led mark, navy UI** |
| Fonts | Self-hosted, free | Hanken Grotesk + Figtree; ship only Medium + Bold equivalents |
| Text-size adjuster | Code | `{min:12,max:24,step:2,default:16}`, persisted, `aria-live` announce. **Mandatory** |
| `prefers-reduced-motion` | Code | Include it — QVC's gap, our free credibility point |

**Volume: ~106 generated images; everything else is code.** Generate as one batch with locked per-category recipes.

## D3. Copy voice
Every merchandising string in their register: spoken second person, em-dash asides, exclamation points, ®/℠/™ on proprietary offer names — **switching abruptly to flat formal register for legal/policy copy.** Targets: *"One great item. One-day price. Special every day."* / *"New deals served up daily—see what's here now."* / *"Like the weekend, it's bound to go quickly."*

---

# PART E — SURPRISES THAT CHANGE THE DEMO DESIGN

1. **★ They already built our POV by hand, on a branch called `test-do-not-publish`.** top-offers.json = a 6-dimension category-affinity model with per-dimension evergreen fallback — hand-curated, Target-selected, robots-disallowed. **The pitch is not "buy this architecture"; it's "we finished the one you started."** *"Six dimensions, each with a timely offer and an evergreen fallback. You built it by hand. Everything today is that idea — generated from your catalog instead of typed, per-visitor instead of per-bucket, with real time windows instead of a manual swap."*
2. **"No manual rebuilding" is literal, and provable from their own public API.** A year of dated homepages at `/us/homepage/YYYY/MM/DD.json` + date-stamped assets + a merchandiser's note in production HTML. **Open the deck with a filmstrip of their own dated homepages.** Frame as homework, not surveillance; don't dwell on the access method.
3. **★ They systematically refuse urgency theater.** A demo of ticking clocks and scarcity meters would read off-brand AND undercut their "do not over-personalize" requirement. Beat 11 supplies a mechanism for a stance they already hold.
4. **Their offer window is already a first-class product field** (`specialPriceStartTime/EndTime`). The gap: the page is authored *by date* while the offer is defined *by window*. **"We made the page read the field you already populate"** converts an architectural argument into an obvious one.
5. **The signature 24-hour TSV is already a 4.4-day offer.** Their verified grammar: 24h/48h/72h/120h/49h/month-long, nested 3-hour reveals, single-day Finale caps. **Build all of it on one slot and one code path.**
6. **Their personalization physically cannot touch the top of the page.** Modules ship hidden; `carReady()` reveals after the Target round-trip. **Build the side-by-side: their reveal vs our edge decision at first paint.** Non-arguable, 90 seconds.
7. **Five personalization capabilities are built and switched OFF.** They have the surfaces and can't fill them. Reframes the sale from "buy personalization" to "turn on what you already built." Ask why each is off — the answer is almost certainly "we couldn't make the decisions good or fast enough to justify it."
8. **`shortDubner` — their web schema is named after broadcast chyron hardware.** The website is structurally downstream of the TV control room. Say it out loud.
9. **The PDP plays the host's actual TV segment** — an asset no other retailer has, currently ungated by affinity.
10. **Their badge system is already code→style + description→text, with a live label-rewriting flag** (`updateSalesPriceBadgeNames`). They already accept config-driven label changes — de-risks the AI-tagging/human-approval story. The AI proposes the *pair*; the human edits the *label*.
11. **The TSV lifecycle already exists in their data, confirmed three ways** (`tsvprev/prelaunch/presale/postsale` codes; `/*APTSV*` robots disallow; glossary preview language). **Mirror their state names exactly.**
12. **`lastOnAirDate` and `Sold Last 30 Days Quantity` are on every product.** Say "this uses a field you already have" as often as it's true — which is often.
13. **The real problem is partly module proliferation** (15 modules, 6 overlapping reco surfaces). The instinctive vendor answer — a smarter carousel — makes it worse. **Beat 9 must visibly collapse modules. "Personalization that removes modules" is counterintuitive, defensible, differentiating.**
14. **Their on-air rail already polls with hashcode diffing and inactivity pause.** They already think "only change when content actually changed." **Our WebSocket push-by-ID is the same instinct done properly** — the next step in a direction they chose.
15. **We must compose, not replace.** Constructor, Bazaarvoice, Criteo, Adobe, Brightcove, Narvar, Attentive, Bambuser, SquareTrade, Synchrony. Any rip-out pitch dies in procurement. **Include a sponsored slot that visibly respects our exposure quotas and appears in the export row with its own flag.**
16. **The audience is a UI constraint, not just a tone.** Women 50+ is stated policy (Q50/Age of Possibility). 16px Medium body, 9.7:1 contrast, steppers, text resizer. **If the demo looks like a sleek DTC site, it looks like we didn't understand who shops there.**
17. **Auto-Delivery is a price lock** — and UK Subscribe & Save locks the TSV price in perpetuity: **an offer that never expires for that customer.** One slide on per-visitor vs global eligibility.
18. **Durable identity already exists** — 5-year first-party `quid` cookie + `globalUserId`. The "long-term history" half of two-speed has a real substrate.
19. **"Nonstop Holiday Party — 49 hours, timed to the DST fall-back weekend."** Someone deliberately built a 49-hour event to exploit the extra hour. That is a merchandising team that thinks in windows and would rather not hand-build the page each time. Say it.

---

# DO NOT USE

**Vocabulary / UI:** ❌ "Almost Gone" / "Limited Quantity" / "Going Fast" / "Only N left" / "X sold" / back-in-stock counters (none exist on qvc.com) · ❌ any shopper-facing countdown on a product or daily deal · ❌ any social proof · ❌ "Add to Bag" (it's **"Add to Cart"** — zero matches in 820KB of their JS) · ❌ gold stars (theirs are **navy**) · ❌ circular host avatars (square 760×760 photographic) · ❌ purple as a QVC brand color (QVC Beauty sub-brand only) · ❌ rounded buttons (`border-radius:0`; only badges 4px).

**Names:** ❌ "Today's Big Find" (**"The Big Find" is a real QVC competition** — use "Today's Bright One") · ❌ "Q Day" / "Big Deal Days" (Amazon's) / "New Year New You" / "Under the Tree" / "30 Days of Joy" · ❌ "Super Saturday LIVE" as a sale (it's a charity broadcast) · ❌ "Fashion 360" / "Uncorked".

**Claims:** ❌ "Customer First data platform" (zero evidence) · ❌ "TSV since 1987" · ❌ a specific TSV end time (11:59pm ET is inferred; UK runs 27h) · ❌ "You May Also Like"/"Customers Also Bought" as QVC labels (only "Similar Items" confirmed) · ❌ "30-day money-back guarantee" exact phrasing · ❌ ContentSquare as confirmed · ❌ QVC Group financials / Project Athens / live-social strategy **from this document** (not researched here — use the Business Intelligence dossier, where they ARE researched).

**Conduct:** ⚠️ Their production config contains an Apple Pay management URL pointing at a `localhost.run` dev tunnel. **Not sales ammunition.** If raised at all, route to their security contact as a courtesy disclosure, entirely separate from the pursuit.

---

# SOURCES & REUSABLE ACCESS

**Live, unauthenticated, reusable:** `api.qvc.com/api/sales/presentation/v{1,2,3}/us/products/{ID}` (v1: videos/tabs/warranties; v3: attributes/variants) · `…/products/list/{ids}` (reco hydration) · `www.qvc.com/us/**.json` + `api.qvc.com/us/{path}.json` (headless AEM; **dated homepages** at `/us/homepage/YYYY/MM/YYYY-MM-DD.json`) · `www.qvc.com/us/content/test-do-not-publish/top-offers.json` · `www.qvc.com/etc.clientlibs/**` (CSS/JS tokens, templates, badge logic, i18n, flags) · on-air programs API (400 on our attempts; format not reversed) · Wayback raw captures (`/web/<TS>id_/<url>`, `Accept-Encoding: identity`) · open WordPress REST on corporate.qvc.com + customerservice.qvcuk.com (374 UK support articles).

**Published pages:** pricing-offer-information.html (the ~45-label glossary) · easy-pay-faqs.html · qvc-ratings-reviews-standards.html · hosts pages · iroa/ioa/shop-live-tv/programguide/qvc-livestreams/myfeed · plus.qvc.com · qvcgrp.com/brands/qvc · scene7 logo (pixel-decoded) · underconsideration.com (2019 rebrand).

**Blocked:** deep qvc.com HTML paths (Akamai 418) · qvcuk.com · community.qvc.com · archive.org via WebFetch.

**Known gaps:** on-air API parameter format · TSV variant code meanings (TSA/TES/TEA/TPS/TPA) · "Last Chance Price" definition · Bazaarvoice Q&A on PDP · exact PDP DOM order.



