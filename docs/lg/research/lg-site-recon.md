# LG US site recon: lg.com/us (seen 2026-10-01)

Anonymous desktop visitor (1440×900), US. Public pages only: no sign-in, no cart, no form submitted. The machine-readable tree, filters, counts and 1,528 product rows are in `lg-taxonomy.json` (same folder). "Fact from code" means read from the page's own scripts or server-rendered data; it is not a claim about how LG uses it. Prices, offers and counts are as seen on 2026-10-01. Offer copy is paraphrased with exact values (quoting limit); every claim carries its URL.

State caveat: the shared browser already held LG cookies from earlier lanes, so "first view" means not signed in, with some prior browsing.

## 0. The five facts that matter most for the demo

1. **LG already runs Optimizely end to end (fact from code).** Web Experimentation project 6686257430921216 (27 campaigns, 31 experiments, 145 pages, 28 audiences in the public config); Product Recommendations (`productrecs.episerver.net`, `window.recs`) behind the homepage "Recommended for you" and PDP "You might also like"; ODP segments inside audiences ("In Market Audience - XXL TV Audience", "LG Owners - Last 28 Days"); Dynamic Customer Profiles, ZIP list attributes (`ms_retailer_hq_zip_codes`), a contextual-bandit (CMAB) campaign, and Statsig feature gates. A demo lands on top of this stack.
2. **A ZIP-level census persona already exists (fact from code).** GTM-PS5PMNM reads the IP-derived `LG5_ZipCode`, fetches `/us/census/personas/<first digit>.json`, and writes `lgcmp` (cookie, 30 days) and `_persona_data`. The fields are urbanicity, income tier (affluent/middle/budget), median income, homeowner %, median age, college %, kids %, commute mode, life stage (college-town … retirement), language (english/bilingual-spanish/multilingual), internet %, household size, ZIP type and a proxy flag. They go to ODP (`zaius.customer`) and show up as Optimizely visitor attributes (`census_*`).
3. **The ad click changes nothing visible.** /us/tvs returned identical server data with and without the 15 ad parameters. The click is only recorded: Optimizely `source_type: "campaign"`, first-party cookie `vtsrc=isCampaign=true|source=google|campaign=auto-tagged|medium=cpc|keywords=lg tvs`, Google `_gcl_aw/_gcl_dc/_gcl_gs` cookies, and a Floodlight hit (DC-8531376) carrying the gclid. Separately, the server data of several PDPs contained **other visitors'** query strings (utm_*, fb_*, fbclid, gad_source, dclid, srsltid) although our requests carried none. That suggests the HTML is cached without the query in the key, so intent must be read from `location` on the client and never from the SSR payload.
4. **The partner channel is built into every product page.** Each product is either CART (sold by LG, `sellingPartyType: "1p"`) or RETAIL (Find a Retailer only). Every PDP carries a PriceSpider where-to-buy widget with FIND ONLINE and FIND NEARBY lists. LG.com orders can be picked up at Best Buy (`bopisWarehouses: ["BP_BB"]`, "Est. In-Store Pickup" on cards). The ThinQ two-year warranty extension also covers appliances bought at select retailers once registered in the app, which is LG's route to identify partner-channel buyers.
5. **The offer grammar is dense and time-boxed.** Every card shows sale price + "$X OFF" + a struck MSRP. On top of that: gift card with purchase from rotating partners (NFL Shop $200 through 10/4/26; earlier in 2026 Sling, Uber Eats/DoorDash, Fanatics), pair and package savings, Buy More Save More, a BOGO fridge, promo codes, outlet pricing, $9.99 Premium Care, free installation, $25 haul-away, Affirm financing and member pricing behind sign-in. Every offer has start and end timestamps in the CMS.

## 1. Navigation and category tree

Header: Shop ▾ | Parts & Accessories ▾ | Support | Business (→ solutions.lg.com/us) | ZIP chip | search | account | cart. The Shop mega-menu (Contentstack entry "B2C > Header") has seven tabs. "Parts & Accessories" repeats the Accessories & Filters tab; the Optimizely campaign "EXP 0062 | GNB | Move Parts & Accessories Up on the GNB" promotes it to the header (fact from code). Numbers are the rendered "N Results".

**Offers.** Home Appliances: Top Appliance Deals (118), Best Sellers (91), Kitchen Deals (16 offers), Kitchen Packages (21), Laundry Deals (17), Laundry Sets (23), Rebates (legacy page). TV & HT: Best Sellers (14), Soundbar Bundles (15), TV Sale Deals (25), All Deals (9), Audio Deals (3). Monitors & Laptops: Best Sellers (13), Deals (7); All Deals /us/promotions (46). Discount Programs (military, medical, students/teachers, first responders, government → /us/appreciation-program; partner employees → /us/lg-partner-store); MyLG Ownership Program; Rewards.

**Appliances.**
- Refrigerators (164): French Door (101), Side-by-Side (14), Top Freezer (11), Bottom Freezer (6), Specialty (9), Accessories (116), Offers (12).
- Dishwashers (63): Front Control (7), Top Control (37), Accessories (52), Offers (9).
- Cooking (119):
  - Ranges (93); chips: Gas 31, Electric 39, Induction 13, Dual Fuel 3.
  - Microwaves (36): Countertop 10, Over-the-Range 24, Built-in 2.
  - Wall Ovens (17): Single 7, Double 8, Combination 4.
  - Cooktops (34): Gas 14, Electric 17, Induction 9.
  - Range Hoods (6), Accessories (92), Offers (11).
- Laundry (195):
  - Washers (75): Front Load 21, Top Load 24, Pedestal 9.
  - Dryers (111): Gas 33, Electric 57.
  - WashTowers (15), Washer-Dryer Combos (22), Accessories (133), Offers (17).
- Appliance Packages: Kitchen Packages (21), Laundry Sets (23). LG Brands: LG SIGNATURE (collection of 26), SKS (external).
- Vacuums (11): Stick (11), Accessories (23).
- Air Care: Air Purifiers (9), Dehumidifiers (2), Accessories (14).
- Heating & Cooling (79): Window (46), Portable (19), In-Wall (14), Residential HVAC (content page).
- Styler Steam Closets (9). Explore items are content pages (gift guides: Kitchen 13, Cleaning 4).

Counter-depth is a filter value, not a node (Depth Type: Built-in / Counter Depth / Standard Depth). Pedestals sit under Laundry Accessories and the Pedestal Washers chip.

**TV & Home Theater.**
- TVs (94): OLED evo (17), OLED (24), QNED evo Mini LED (7), QNED Mini LED (32), UHD (25), 4K (11), Accessories (62), Offers (7).
- Menu items that link straight to a product page: Wallpaper TV, Micro RGB evo, Gallery TV with Frame, True Wireless TV.
- By size: 97"+ (10), 83–86" (22), 70–77" (33), 65" (30), 55" (20), 50" and smaller (40).
- Lifestyle Screens (11): StanbyME (6), Smart Monitor Swing (product page).
- Projectors (9). Sound Suite (13). Soundbars (29): Dolby Atmos (10), Home Theater (8). Entertainment/Explore are content pages.

Series appear only in product names, never as facets. 2026: OLED evo W6, G6, C6/C6H, OLED B6, Micro RGB evo MRGB95, QNED evo QNED84B/QNED8MB, QNED75B/7SB/74B, Nano NU85/NU70, FHD/HD LB70/LB65. Still listed: 2025 G5/C5/B5, UA77 and UT75. "8K" appears only in SEO copy.

**Monitors & Laptops.** Monitors (204): UltraGear OLED (28), UltraGear evo (4), UltraGear (73), UltraFine (14), Smart (23), UltraWide (27), FHD & QHD (34), Accessories (64). Laptops (185): gram Pro (41), gram Pro 2-in-1 (11), gram (82), gram Book (13), Copilot+ (12); by size 17" (18), 16" (23), 15.6" (10), 14" (9). The menu's facet links (AI processor, OLED, Touchscreen) still rendered 185, so the parameter did not narrow the count. Accessories: Gaming (15), Logitech (31), Microsoft Xbox (4).

**Audio.** Speakers (20): Sound Suite 3, Subwoofers 7, xboom 7, Portable 9, Party 3. Earbuds (3). **Accessories & Filters**: water filters (11), per-category accessories, filter finder. **LG SIGNATURE**: discover page + collection.

**Common filters.** Toggles On-Sale and In-Stock; TVs and QNED add "Exclusive MyLG Rewards". Facets Get it Fast → In-Store Pickup, Offers (promo tags), Price ranges, Rating (5 / 4 & Up / 3 & Up). Sort: Best Match, Customer Rating, New Arrivals, Price Low–High, Price High–Low. The underlying CMS facet fields include `ec_size`, `ec_final_price`, `ec_promotions_list`, `ec_is_membership_price` and `ec_zip_ndd_flag`.

## 2. Product attributes by category

**Listing card** (every grid): badges (Top Deal, Best Seller, New, LG Online Exclusive, gift-card or bundle tag), heart, image, TV size chips, name, SKU, stars + review count, sale price, "$X OFF", struck list price, Estimated Delivery and Est. In-Store Pickup dates (ZIP), 2–3 bullets, Compare, CTA (Add to Cart / Find a Retailer / Notify Me); appliance cards add the ThinQ warranty line.

| Category (sample PDP) | Rendered filters | PDP spec groups | Price seen |
|---|---|---|---|
| TV (OLED65C6PUA) | Get it Fast, Offers, Types, Price, Screen Size, Smart TV Features, Connectivity, True Cinema, Ultra Gaming, Rating | Picture (Panel), Picture (Processing), Gaming, Smart TV, Audio, Connectivity, Power, Dimensions/Weights, Accessories, General, Warranty | $1,699.99, $1,000 OFF, $2,699.99; sizes 42–83" each priced |
| Refrigerator (LF25Z6211S) | Get it Fast, Offers, Types, Width, Brand, Depth Type, Price, Height, Capacity, Colors, Features, Rating | Capacity, Convenience, Cooling, Dimensions/Clearances, Energy, Freezer, Materials, Refrigerator, Summary, ThinQ, Water & Ice, Warranty | $2,199, $1,400 OFF, $3,599 |
| Range (LSGL6335X) | Get it Fast, Offers, Brand, Types, Range Type, Oven Type, Fuel Type, Features, Cabinet Width, Price, Colors, Rating | Accessories, Appearance, Capacity, Cooktop, Controls, Dimensions, Features, Oven Features, Power, Summary, ThinQ, Warranty | $1,599, $900 OFF, $2,499 |
| Washer (WM6500HWA) | Get it Fast, Offers, Collection/Lines, Category, Washer Type, Features, Capacity, Price, Width, Colors, Rating | Capacity, Summary, Energy, Programs, Fabric Care, Convenience, ThinQ, Motor, Materials, Certification, Power, Options, Dimensions, Warranty | White $1,199 / Black Steel $1,249 |
| Dryer (DLEX4000B) | as washer plus Special Pricing, Dryer Category, Vent Type | Dryer Programs, Capacity, Energy … | $949, $350 OFF |
| Dishwasher (LDNTH753S) | Get it Fast, Offers, Brand, Type, Price, Handle Design, Operating Sound Level, Colors, Feature, Rating | Capacity, Dimensions, Features, Warranty, Power, Racks & Baskets, Style, ThinQ | $849, $550 OFF |
| Soundbar (S70TY) | Get it Fast, Product Types, Audio Experience, Offers, Channel, LG Synergy, Subwoofer, Rear Speaker, Works With, Connectivity, Rating | Audio Format, Connectivity, Convenience, Dimensions, Accessories, Types, Highlights, Sound Modes, Warranty, Rear Speaker | $349.99, $50 OFF |
| Monitor (27G64NA-B) | Get it Fast, Offers, Size, Resolution, Refresh Rate, Display Type, Price, Stand Ergonomics, Features, Rating | Picture Quality, Special Features, Input/Output, Stand, Power, Dimensions, Accessories, Warranty | $249.99, $150 OFF |

Specs that are also filters: TV size and Dolby/Filmmaker/gaming/voice/port features; fridge capacity, width, height, depth type, colour, features (ENERGY STAR, Craft Ice, ADA, Sabbath, ThinQ); range fuel/type/width/convection; washer capacity/type/TurboWash; monitor size/resolution/refresh/panel. Dimensions, certifications and the Energy Guide PDF are PDP-only. The JSON maps each spec term to its filter.

**Prices** show sale, discount and MSRP; "Sign In for Member Pricing" for anonymous visitors; Ownership-member points (about 5% of price); the Affirm as-low-as line. No price-match claim on PDPs; the Appreciation Program promises at least 10% below LG.com sale prices.

## 3. Page anatomy (top to bottom)

**Homepage** /us/: Contentstack "OBS > Page > Home", updated 2026-09-16, 22 server-rendered components.
1. Pencil banner (rotating; supports a countdown and a coupon).
2. Header.
3. Category mini-nav (13 icons).
4. Hero carousel: NFL Shop with OLED, appliance clearance, monitor Buy More Save More, and more.
5. RTB strip: Free Delivery, 14 Day Return, Extended Coverage, Haul Away, Chat with an Expert.
6. "Shop top appliances and electronics" category cards.
7. "Discover LG Deals" tabbed promo bento.
8. "Shop with an LG Expert" chat breaker.
9. **"Recommended for you"**: Optimizely recs carousel `homeWidget`, 8 items. **Personalised.**
10. Showcase tabs: appliances, home entertainment, monitors/laptops.
11. "Benefits of shopping LG.com" bento (Ownership Program, 5% Rewards, Partner Store); brand bento; "For LG Owners"; footer.

Overlays: chat, Qualtrics feedback, Transcend notice. Everything except module 9 is static CMS, though Optimizely can change any module client-side.

**TVs landing (the ad target)** /us/tvs:
1. Pencil banner.
2. Header with the ZIP chip.
3. Breadcrumb, H1, and the "Get Expert Help + Offers" pill (opens Sprinklr chat).
4. Hero, two CMS slides: the NFL Shop offer ending 10/4/26, and a Consumer Reports reliability slide.
5. Promo mini-cards: up to $1,000 off big screens, free Xbox controller, up to $400 TV + Sound Suite, Best Buy pickup, $200 off a matching soundbar.
6. Type icons: OLED evo, OLED, Micro RGB evo, QNED Mini LED, Lifestyle, 4K UHD. The CMS defines four; "PER 0094 | PLP | TV Multicat | Insert 2 Nav Icons" inserts the other two (fact from code).
7. Toolbar: Shipping to ZIP, "94 Results", Sort, Filters with quick filters (Offers, Types, Price, Screen Size, True Cinema, Rating).
8. Docked filter drawer.
9. Members banner: sign-in price, plus 5% back with the Ownership Program.
10. Grouped carousels: OLED evo, OLED, QNED, 4K UHD, three cards each plus "Shop All".
11. SEO copy.
12. Footer.

**Category grid** /us/french-door-refrigerators (101 results): breadcrumb, H1, expert pill → hero carousel (five slides) → scheduled promo mini-cards (CMS "mini guide") → RTB strip → toolbar (ZIP, count, sort) → filter drawer → 12 cards + Load More → mid/bottom mini-guides → SEO copy, footer.

**TV PDP** /us/tvs/lg-oled65c6pua-oled-4k-tv:
1. Pencil banner, header, breadcrumb.
2. Sticky buy bar: title, SKU, price block, Affirm line, Special Offers, Add to Cart.
3. Tabs: Overview, Specifications, Features, Reviews, Q&A, Limited Warranty & Support, Similar Products.
4. Gallery (promo tag, heart, thumbnails, 3D) beside a five-card offer carousel: $100 NFL Shop eGift (claim within 30 days, through 10/4/26); free wall mounting + mount; Sound Suite bundle save $400; matching soundbar up to $200 off; expert chat.
5. Key features.
6. Delivery date for the ZIP (Oct 7), next to "Pick up as early as today / Find a Store" (Best Buy).
7. Size selector, 83" to 42", each with its price.
8. Add LG Premium Care by Asurion: 1, 2 or 3 years at $129.99, $179.99 or $249.99.
9. Add TV Setup: stand setup free; Angi wall mounting free (was $164.99).
10. Rinse laundry service, $200 in credits free.
11. Related Products: eight soundbars, rules-based.
12. Related Accessories.
13. Review your selections (total and savings), then Add to Cart or Find a Retailer.
14. Promo banners.
15. Specifications (11 groups; Energy Guide; Print).
16. Features (14 blocks).
17. Reviews: Bazaarvoice, 4.54 from 192.
18. Q&A: Bazaarvoice.
19. For owners: warranty, register, manuals, help, repair.
20. **You might also like**: Optimizely recs, cross-category. After appliance browsing it showed washers, a WashCombo and a fridge. **Personalised.**
21. SEO description with eight FAQs, footnotes, footer.

**Washer PDP** /us/washers-dryers/lg-wm6500hwa-front-load-washer, same frame:
1. Offer carousel: extra $200 with an eligible dryer; extra $150–$250 for a 4-piece set.
2. Key features.
3. Delivery date, plus Best Buy pickup.
4. Colour selector: White $1,199, Black Steel $1,249.
5. Add Expert Care: MyLG Ownership pro $79.99/yr or pro care $169.99/yr.
6. Premium Care: $9.99, $39.99 or $69.99 (normally $64.99, $94.99, $124.99).
7. Professional Installation $29.99 (free for pro members).
8. Haul Away $25 (was $50), or Move Rooms $25.
9. Rinse, $100 in credits.
10. "Complete Your Laundry Room": matching dryers, "Bundle to Save $200".
11. Accessories: pedestal, stacking kit.
12. Review your selections.
13. Specs (14 groups), Features, Reviews, Q&A, For owners, You might also like.

Template variants: WM6700HWA offers "Trade-In with Free Haul Away" (instant credit); French door LF25Z6211S has free installation (was $24.99), a "Kitchen Pair save $100" dishwasher, and reasons to buy (free room-of-choice delivery, next day in some areas; free 14-day returns).

**Kitchen package** /us/kitchen-appliance-packages/lg-lf24z6530s-lsil6332fe-mvem1825f-adfd5448at:
1. Composite SKU; $4,096 ($3,450 OFF, $7,546 MSRP); tabs without Q&A/Warranty; offers (service plans $9.99–$69.99 per model, two-year warranty).
2. Four key-feature lines; delivery.
3. Selectors: 3-piece $3,997 / 4-piece $4,096; Range Fuel Type Induction, Electric or Gas (+$100).
4. "4 Products in this Package" (each rated, priced, linked); Add to Cart. No add-on services.

The items' sale prices sum to $4,596, so the package takes $500 more off.

**What is personalised, ZIP-driven or static:**
- Personalised: homepage recs, PDP "You might also like", and Optimizely changes (nav icons, filter order, audience pop-ups).
- ZIP-driven: delivery and pickup dates, "Get it Fast", PriceSpider lists.
- Everything else is CMS content scheduled by start and end dates.

## 4. Offers and promotions

**The Offers page** /us/promotions (46 offers):
- Tabs: All, Kitchen, Laundry, TV & Home Theater, Monitors & Laptops, Vacuums & Air Care, Audio, Accessories & Filters, Appliances.
- Offer Types facet: Online Exclusives, Bundles, Savings, Limited Time Offers, Shipping & Installation Offers, Services & LG Programs. Also Category and Rating facets.

**Mechanics seen:**
- **Instant savings:** 30–50% on appliances, up to 41% on refrigerators, up to 35% on UltraGear.
- **Gift card with purchase:** claimed within 30 days.
- **Pairs and bundles:** fridge + dishwasher up to $200; washer + dryer $150–$200; range + OTR, hood + cooktop, wall oven + cooktop $200 each; TV + soundbar up to $200; TV + Sound Suite up to $400; 4-piece laundry $150–$250; kitchen package up to $500.
- **Buy More Save More** on monitors, including 10% on two with a code.
- **Free items:** Xbox controller, mouse, Styler hangers, Rinse credits, a free single-door fridge with a French door.
- **Promo code** WASH1000 (extra $100).
- **Best Buy pickup:** monitors 5% off.
- **Outlet pricing:** new, not refurbished, limited returns.
- **Warranty:** ThinQ two years through 12/31/26 (up to $185 value); SIGNATURE three years.
- **Service, installation and trade-in:** Premium Care from $9.99, free or reduced installation, $25 haul-away, trade-in on the washer.
- **Rebates:** an EcoRebates widget (fact from code).

Not seen: a price-match claim, refurbished goods, or mail-in rebates.

**Three examples** (all seen 2026-10-01):
1. **NFL Shop eGift Card.** Up to $200 with eligible OLED/QNED TVs, claimed within 30 days of purchase, ends 10/4/26. https://www.lg.com/us/promotions/nfl-shop-tv-reward-offer
2. **Refrigerator + dishwasher pair.** Online exclusive, up to an extra $200, ends 10/21/26; the fridge PDP labels LDNTH753S "Kitchen Pair save $100". https://www.lg.com/us/promotions/refrigerator-dishwasher-bundle-deal
3. **WM6700HWA washer.** $400 off plus an extra $100 with code WASH1000; the PDP offers trade-in with free haul-away. https://www.lg.com/us/washers-dryers/lg-wm6700hwa-front-load-washer

The financing line on the C6 PDP reads "0% APR or as low as $83/mo with Affirm".

## 5. Where to buy and the partner channel

- **Vendor: PriceSpider** (fact from code: `cdn.pricespider.com/1/1540/…`, widget 2.24.0, meta `ps-key`, the locate/omni/wtbevents endpoints, Mapbox maps). It sits inside the "Find a Retailer" modal, below a first block "Buy Directly From LG" (price, stock, Add to Cart).
- **FIND ONLINE, OLED77G5WUA** (2025 G5, a RETAIL product, LG out of stock): Best Buy, Costco, Paulson's, Pieratt's, ABC Warehouse, Jeff Lynch Appliance & TV, RC Willey, all in stock.
- **FIND ONLINE, LRSWS2806S fridge** (RETAIL): Lowe's (See Website), Home Depot (out of stock), Wayfair, US Appliance, Homewise, Electronic Express.
- **FIND NEARBY:** ~18–20 stores by distance from the IP location ("Call for Stock", hours, directions): Best Buy, Costco, Sam's Club, BJ's, Walmart, Micro Center for the TV; independents and a buying-group member for the fridge. For current models LG sells (C6, LF25Z6211S) the widget was empty, leaving only "Buy Directly From LG".
- **State flags (server data):** `ctaTypeCode` CART|RETAIL, `wtbFlag`, `hasRetailer`, `sellingPartyType`, `bopis`; grids show Find a Retailer on RETAIL products (mostly 2025 and older).
- **Best Buy pickup of LG.com orders** (/us/collections/store-pickup → /us/promotions/store-pickup), ready in about two hours. Eligible: the C6 TV, the S70TY soundbar, the 39GX950B monitor, the WM6500HWA washer, the DLEX4000B dryer, and a WashTower. Not eligible: fridges, ranges, dishwashers, packages.
- **Partner-buyer identity:** product registration and the ThinQ warranty extension (retailer purchases count). There is also an Optimizely audience "MS | Exclude Visitors from Retailer HQ ZIP Codes" (fact from code).
- **Affiliate:** the CJ tag (`www.mczbf.com/tags/11984`), plus an audience that excludes `source=cj-affiliate-*` traffic.

## 6. Account, membership and memory

**Account menu** (fact from code):
- Signed out: Sign In / Sign Up, Register a Product, Order Look Up.
- Signed in: MyLG, Orders, Favorites, Manage Subscriptions, Rewards, Register a Product, Sign out.

**Programmes:**
- **Rewards** (/us/mylg-membership-rewards): 100 points = $1; purchases earn automatically; up to 20% back in member-exclusive rewards.
- **Ownership Program** (/us/mylg-ownership-program, LG.com only, auto-renewing): pro $79.99/yr (two-year warranty, free installation with 50% off complex, free haul-away, VIP helpline, 5% back, 20% off parts, automated accessory delivery); pro care $169.99/yr adds in-home maintenance and 30% off repairs.
- **Appreciation Program:** ID.me verification for medical staff, military and veterans, first responders, teachers, students and government. Shopping happens in the gated LG Store / Partner Store, with free installation and at least 10% below LG.com sale prices.

**Registration and ThinQ promise:** account: 20% welcome coupon on parts, up to 5% back, new-customer offers, warranties and manuals; registration: best Premium Care price, proof of ownership, repair requests; ThinQ app: control, Care alerts, UP feature upgrades, the two-year warranty.

**Anonymous memory:** favourites require sign-in (the heart opens a sign-in prompt); Compare writes cookies `LG5_CompareCart`/`LG5_CompareCartSKU` and a tray; `LG5_ZipCode` (IP-derived), `LG5_WAREHOUSE_ID`, `LG5_NDD_FLAG`; `LG_cart=n` (GTM reads `LG5_CartID`); localStorage `searchHistory`, `zRVP` (stayed `{}`); `sessionStorage.lastCategory`. No recently-viewed module; recommendations shift with browsing.

**Consent:** Transcend airgap, US regime; purposes (Advertising, Analytics, Functional, Marketing, SaleOfInfo) default "Auto"; GPC not set. A notice-only "Privacy Notice" with a single OK (no reject) appeared on later pages; the footer "Do Not Sell or Share" link goes off-site to privacy.us.lg.com/policies. I did not press OK or submit the off-site form; Google hits carried gcs=G111 (granted by default).

## 7. Technology visible in code (facts from code, not claims of use)

- **Front end:** Next.js micro-frontends (/us/new-home, /us/plp, /us/pdp, /us/collection, /us/promotion, /us/campaign), MUI, Contentstack, the media.us.lg.com DAM. Infrastructure and monitoring: Akamai, Datadog RUM, Forter.
- **Tag management:** GTM-PS5PMNM, GTM-WGG5JTD, GTM-5HVXG67, GTM-K6PCLCJ. Server-side tagging at measurement.us.lg.com (GA4 G-M2Q44NKVLK, G-BG7QZF12H8) and a Stape gateway.
- **Experimentation and personalisation:** Optimizely Web, Product Recommendations, ODP, Statsig; Outfindo appears only in a QA-cookie test.
- **Other site vendors:**

  | Function | Vendor |
  |---|---|
  | Search | Coveo (search v2, analytics, `coveo_visitorId`) |
  | Reviews | Bazaarvoice |
  | Where to buy | PriceSpider |
  | Financing | Affirm |
  | Rebates | EcoRebates |
  | Chat | Sprinklr (the expert pill) and iAdvize (GTM hands off to Sprinklr) |
  | SMS | Attentive (first-party ddjpc.lg.com) |
  | Surveys | Qualtrics |
  | Session replay | FullStory, Clarity |
  | Accessibility | AudioEye |
  | Consent | Transcend |
  | IP geolocation | Abstract API |

- **Ads and attribution:** Google Ads (four AW- IDs), Floodlight DC-8531376, AdSense on PDPs; Meta, TikTok, Pinterest, Snap, Reddit, X, LinkedIn, Quora, Bing, Criteo, AdRoll, The Trade Desk, StackAdapt, RTB House, Amazon, Xandr, Audiohook, CJ; a first-party `rbj3smbh.lg.com/assets/wxyz.rb.js` (naming matches Rockerbox; unverified).
- **Absent:** Adobe, Tealium, Segment, mParticle, Treasure Data, Dynamic Yield, Monetate, Bloomreach, Salesforce Interactions, Klarna.

## 8. The ad-click context

| Parameter | Meaning | Stable / per-click | Legitimate intent signal? |
|---|---|---|---|
| g_acctid=955-567-4384 | LG's Google Ads customer ID | stable | no |
| g_campaign / g_campaignid / gad_campaignid=22840640151 | campaign | stable | yes (TV brand search) |
| g_adgroupid | ad group | stable | coarse |
| g_adid | the creative clicked | stable | yes (which message) |
| g_adtype=search | search ad | stable | yes |
| g_keyword / utm_term = "lg tvs" | bid keyword matched (not the exact query) | per keyword | strongest |
| g_keywordid=kwd-37411006 | keyword criterion | stable | via lookup |
| g_network=g | Google Search (not partners/display) | stable | yes |
| gclsrc=aw.ds | click ID via Google Ads + Search Ads 360 | stable | no (plumbing) |
| gad_source=1 | Google-added ad-click flag | per click | no |
| gbraid | aggregated iOS app-to-web click ID | per click | no (attribution) |
| gclid | unique click ID | per click | no; never personalise on it |

**Campaign name `lg_2026_ms_tv_aon_brand_sem_google_general`:** 2026 flight year; `ms` = the TV/IT business unit (the code pairs MS with HS, Home appliance Solution; most likely Media Entertainment Solution); `tv` category; `aon` always-on; `brand` brand-keyword campaign; `sem` paid search; `google` engine; `general` a generic brand-TV group (vs series/model groups).

Cached PDP data shows the same naming on Meta: `lg_2026_ms_tv_aon_sales_paid-social_meta_dpa`.

**What an engine can honestly infer:** paid Google brand search for "lg tvs", category intent for TVs with no size, series or price yet, a desktop browser, region from IP, new or returning from cookies, and that LG counts the visit as campaign traffic. **What it cannot infer:** the exact query, budget, size, household, identity, purchase stage, or whether the visitor will buy from LG or a retailer.

## 9. First view versus after browsing, and financing

**Unchanged after about 160 pages:** the homepage's 22 server modules and order; the /us/tvs hero, mini-cards, carousels and lead products (OLED77G6WUA, OLED77C6HUP, OLED77G5WUA…); PDP module order, offers and prices.

**Changed:**
- **Homepage "Recommended for you"** (`homeWidget`): first led with the 27G64NA-B monitor (earlier history), later with LF25Z6211S, LRSXC2306S, WT8205CL and WM6700HWA (the fridges and laundry I browsed). The curated `homeStaticWidget` stayed the same (OLED65C6PUA first).
- **"HPT-60 | XXL Filter Order - TV's"**: active on the ad-landing view (ODP XXL TV audience), where it sorted screen sizes largest-first. It was inactive on the next /us/tvs view (ascending).
- **"[1XP] PER 0050 | In-Cart Pricing"**: activated on the homepage after browsing.
- **PDP "You might also like"**: pulled cross-category items from the browsing.

**Financing: Affirm only.** Every CART PDP fetched (packages included) carries `bnpl: [{type: "affirm"}]`; the C6 renders the as-low-as line. No Klarna anywhere: no script, no global, no mention in 188 listing pages, 19 PDPs or programme pages. Programme pages also list Google Pay, Apple Pay and PayPal.
