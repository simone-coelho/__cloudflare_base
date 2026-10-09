# LG real-time personalization demo: competitive and creative landscape

*Research note, 1 October 2026. Public pages only; US desktop (1440×900), anonymous, no sign-in, no forms, no consent banners accepted. Sources are listed at the end.*

## 0. Five findings that should shape the demo

1. **LG already runs Optimizely's stack.** lg.com/us loads Optimizely Web Experimentation (PER- and EXP- campaigns numbered into the 0090s, plus pages named for an A/A test), Product Recommendations (the homepage "Recommended for you") and Optimizely Data Platform (ODP). It also loads Coveo search, PriceSpider tracking, Attentive, iAdvize expert chat and about fifteen retargeting pixels. This is an expansion conversation with a team that already experiments seriously: agree the approach with the account team, and present every contrast as LG's next step, not a fault.
2. **LG has already built a census cold start by hand.** A tag in LG's public tag-manager container turns the geolocated ZIP into a census "persona" (urbanicity, *income tier*, life stage, language, household size, homeowner share and more). It keeps the persona for 30 days and passes it to Optimizely Web and ODP. Our cold start does this properly: LG's regional sales set the prior, census data describes need, and the decision is made before first paint, with a receipt.
3. **LG's homepage forgets what she looked at.** We viewed two TVs and a washer. Afterwards the hero and every module stayed put. Only "Recommended for you" changed: it went from seven OLEDs and a washer to eight top-load washers, the one we viewed plus seven substitutes. There was no TV, no dryer and no "continue where you left off".
4. **The partner channel is already on lg.com.** TV product pages offer pickup at the nearest Best Buy ("Estimated Ready in 2 hours") and a "Find a Retailer" button. A retailer outcome can be measured, so the engine can learn from it.
5. **Be precise about "weeks".**
   - TV research does run for weeks: 16 or more active days and 40 or more touchpoints.
   - Appliance purchases split in two. Distress replacements are decided within days (households go about 11 days without the appliance); planned upgrades and kitchen projects run longer, though no public figure exists.

   Put the weeks-later beat on the TV and the kitchen, not on the broken washer.

## 1. What vendors show consumer-electronics and appliance brands

| Vendor | Public CE/appliance proof | Wow beat | Data it assumes | What it never shows |
|---|---|---|---|---|
| Adobe (Target, Real-Time CDP, Journey Optimizer) | Samsung Europe on Real-Time CDP (40+ sources, GDPR, 2024 Experience Maker award). Target runs on whirlpool.com and dyson.com. A partner case for Whirlpool India targets "spec comparisons, dealer lookups, repeat product views" | A real-time profile activating audiences in every channel | Known, consented customer | An anonymous first visit built from the brand's own regional sales; retailer handoff as an outcome |
| Salesforce (Commerce, Personalization, Data 360, Agentforce) | GE Appliances: Agentforce service (25% of requests resolved without a human) and emails to owners. Fisher & Paykel: an adaptive site. Also Bose, Sonos and Philips. Personalization (formerly Evergage) runs on geappliances.com | An agent that troubleshoots, checks stock and closes the sale in one conversation | Registered owner or member | The anonymous researcher; partner outcomes |
| Dynamic Yield (Mastercard) | Elkjøp: affinity scores move preferred categories to the top of the navigation; 16 strategies | Navigation reordered by affinity | On-site affinity | The brand's sales as the prior; receipts |
| Bloomreach | Miele: automated journeys that cut service calls. HP Tronic/Datart: a welcome layer for first-time visitors (+136% new-customer conversion). The Clarity shopping agent | A conversational agent | Session data plus email | The partner channel; lift measured in the warehouse |
| Insider | Samsung: "+275% conversions in 20 days" on a launch. Push-notification cart recovery up 24% (Samsung Australia). Its Category Optimizer reorders categories for each visitor. Live on samsung.com/us | Categories reordered per visitor, plus push | Push opt-in | Explanations; retailer outcomes |
| Monetate (spun out of Kibo in 2022) | Runs on geappliances.com; its best-known public case is Office Depot | One-to-one recommendations | Session data | Whole-page composition |
| Coveo, Algolia, Constructor | Coveo powers lg.com search and has a Motorola Solutions case. We found no public CE-brand cases for Algolia or Constructor | Personalized search | Queries and clicks | Anything beyond search |
| Nosto | Robert Dyas (UK): brand-affinity recommendations, +30% conversion | Affinity recommendations | Session data | How a brand and its retailers share the sale |
| Crossing Minds | Team joined OpenAI in June 2025; "no longer accepting new clients" | — | — | Drop it |
| Optimizely | Electrolux, across 100+ European sites. LG US uses Web Experimentation, Recommendations and ODP: observed on the site, with no public case | Experimentation at scale | Mixed | The beats in §4 |
| Where-to-buy: PriceSpider; MikMak (bought ChannelAdvisor's where-to-buy business from Rithum in 2023); Pear; Commerce Connector | PriceSpider names Sony, Samsung, GE and LG as clients and runs on four of the brand sites we checked. It says 1,500+ retailers share cart data, including Amazon, Walmart, Target, Home Depot and Best Buy. Pear is CPG-first; Commerce Connector is Europe-first, with no US CE case found | A retailer list with live price and stock; closed-loop retailer carts | A click on the product page | The page that earned the click |

**What everyone already shows:**
- Recently viewed and "recommended for you"
- Affinity recommendations
- Abandonment email, SMS and push
- Known-customer journeys from a CDP
- A/B tests and bandits
- Merchandising rules
- Since 2025, a shopping agent

**What nobody shows:**
- An anonymous first page view built from the brand's own sell-through
- A receipt behind every decision
- Interest that decays separately for each product category over weeks
- A retailer handoff counted as a win
- Lift computed in the customer's warehouse, including partner outcomes

## 2. Observed behaviour (anonymous desktop, 1 October 2026)

### lg.com/us

**Homepage modules, top to bottom:**
1. Promo ticker; the header shows the geolocated ZIP.
2. Hero carousel: "Score a $200 NFL Shop eGift Card with select fan-favorite OLED TVs".
3. Service strip: free delivery, 14-day returns, coverage, haul-away, expert chat.
4. "Shop top appliances and electronics": a rail of 15 categories, TVs first.
5. "Discover LG Deals", tabbed: Top Deals, Kitchen, Laundry, TV & Audio, Laptops & Monitors, Vacuum & A/C.
6. "Shop with an LG Expert".
7. "Recommended for you": 8 products.
8. Appliances: reliability, kitchen, laundry, energy, reviews.
9. Home entertainment: TVs, audio, lifestyle screens, webOS, reviews.
10. Monitors and laptops.
11. "Benefits of shopping LG.com": MyLG Ownership, 5% Rewards when signed in, the Partner Best Price Guarantee, the Appreciation program.
12. Brand stories.
13. "For LG Owners".

**TV category page**
- Tabs: OLED evo, OLED, Micro RGB evo, QNED Mini LED, Lifestyle, 4K UHD.
- Filters, in order: Shipping to [ZIP], On-Sale, In-Stock, Exclusive MyLG Rewards; then screen size, type, price, offers, gaming, cinema, smart features, connectivity, rating, in-store pickup and a toggle for discontinued models.
- Sort: Best Match (the default), Customer Rating, New Arrivals, price in either direction.
- Layout: the grid is grouped by series, under a banner promoting members-only prices for signed-in visitors.
- Cards show size chips, delivery and pickup dates, Compare, and one of Add to Cart, Find a Retailer (on a prior-year model) or Notify Me.
- The washers page adds **width** bands (0–25", 26–28", 29–35").

**Product page modules, top to bottom:**
1. Price, Special Offers, Add to Cart.
2. Anchor links: Overview, Specifications, Features, Reviews, Q&A, Warranty, Similar Products.
3. Expert chat and key features.
4. Shipping to [ZIP] with a delivery date, and "Pick up as early as today" at a Best Buy store.
5. Size or colour selector, priced per variant.
6. Asurion protection plans.
7. Setup services: TV wall mounting by Angi; for laundry, installation, haul-away and Rinse laundry-service credits.
8. Related items:
   - 98" TV: soundbars
   - 55" TV: a VESA mount
   - Front-load washer: matching gas or electric dryers ("Laundry Bundle Save $100") and a 27" pedestal
   - Top-load washer: dryers only
9. Selection total, then Add to Cart or Find a Retailer.

**After browsing a 55" QNED, a 98" Nano and a top-load washer:** the homepage was unchanged except "Recommended for you", which became eight top-load washers led by the one we viewed. Optimizely's visitor profile recorded only `page_last_viewed_product_cat = "washers & dryers"`.

**Where-to-buy and local stock**
- ZIP detected automatically; every card shows a delivery date.
- Best Buy pickup names the store, its distance and its hours ("Estimated Ready in 2 hours").
- "Find a Retailer" opens with "Buy Directly From LG".
- PriceSpider's tracking script is loaded.

**Consideration devices**
- Compare
- Notify Me, which feeds ODP
- Members-only prices for signed-in visitors
- MyLG Rewards; Ownership subscriptions at $79.99 or $169.99 a year
- Expert chat
- Attentive, loaded but no overlay appeared
- 21 curated kitchen packages; laundry bundles

We saw no save or wishlist control on product pages, no price-drop alert and no fit tool. "Measure First, Order Right" is a static banner.

**Under the hood.** We read this in public client code; use it to shape the demo but don't quote list names to LG.
- Optimizely audiences built from ZIP lists, named for regional offers (free water filters; member pricing on an end-of-life dishwasher in one state).
- An audience of **retailer-headquarters ZIP codes**.
- An experiment on filter order for extra-large TVs.
- A reverse-IP company lookup for business visitors.

LG already personalizes by place and is alert to how its retailers see the site.

### Contrast sites

| Site | Homepage | Category page | Product page | After browsing | Where-to-buy / local | Consideration devices |
|---|---|---|---|---|---|---|
| samsung.com/us | Hero carousel including "Sign up · Unlock exclusive benefits"; "Recommended for you" from Samsung's own recommender | Filters: Deliver to, size, technology, price, offers. Sort: Recommended. Monthly financing on every card | S85H/S90H/S95H model ladder in the buy box. Delivery showed a New York ZIP, "Not Available" until changed. Soundbar bundles | Unchanged | PriceSpider page | Insider, Attentive, Wunderkind; "Make sure it fits" measuring guide |
| whirlpool.com | Geolocated ZIP; perks for signing in; "Shop This Kitchen" scenes | Filters: In Stock, Available Near You, Compact & Small Spaces. Sort: Best Seller. Dimensions on every card | "See it in your space" in 3D; "Ensure That The Product Fits Your Space"; "Frequently bought together" = hoses and paint, not the dryer | Unchanged | PriceSpider with a local store locator; Where To Buy on every card | Free haul-away when signed in; email modal |
| geappliances.com | Promos; Harvest Deals; Recommended For You | Pedestal and agitator filters; availability needs a ZIP; sort: Newest | "Complete Your Laundry Pair" with a gas/electric toggle and a pair price | Unchanged | Find a Store | Bodewell membership ($149 a year) |
| dyson.com | Hero; four products | "Help me choose" (Zoovu); a "Best for" needs filter; default sort price high to low | Model chooser | Product row switched to purifiers (one tile duplicated) | Direct only | Live video experts; Bluecore |
| bestbuy.com | NFL hero; sign-in prompt; best-sellers | Filters lead with "Pickup · Ready today" (default Minneapolis ZIP); depth, height, width; open-box. Sort: Best Selling. Sponsored tiles | Would not load in our automated browser | — | Pickup filter | Membership deals |
| homedepot.com | Geolocated store; "What customers are shopping in your neighborhood" | Width filter; "In Stock at Store Today"; sort: Top Sellers; "Find a Washer & Dryer That Fit Your Home"; first five tiles sponsored; "See Low Price in Cart" | "Make Sure It Fits Your Space"; "Pairs with" dryer SKUs; store stock; price match | **"Recently Viewed" took the neighbourhood module's place in slot 2** | Store stock on the product page | $5 off for email sign-up; Magic Apron assistant |
| sony.com/electronics | Not observed: blocked to both our browser and fetcher | | | | | |

## 3. The long consideration problem

**What brands do today**
- Off-site retargeting: LG alone loads Criteo, AdRoll, StackAdapt, The Trade Desk, Meta, TikTok and others.
- Email and SMS capture (Attentive, Wunderkind, Bluecore, Braze, SaleCycle, UpSellit).
- Sign-in incentives: LG member price, Whirlpool free haul-away, Samsung "exclusive benefits", Best Buy free shipping.
- Paid memberships (MyLG Ownership, Bodewell).
- Perks for registering through an app (ThinQ, SmartThings).
- Back-in-stock alerts.

On site, only Home Depot visibly resumed where we left off; LG and Dyson each swapped one carousel; Samsung, Whirlpool and GE changed nothing. None offered an anonymous visitor a price-drop alert or saved list.

**Evidence**
- **TVs:** Comscore for Walmart Connect (survey November 2020, published October 2021).
  - Converters research for at least 16 active days, across at least 40 touchpoints.
  - 44% are unsure of the brand before buying.
  - Of PC searches about TVs, about 20% happen 5–8 weeks before purchase, 31–35% 2–4 weeks before, and 45–49% in the purchase week.
- **Appliances:**
  - J.D. Power 2023: 56% research online before visiting a store, 75% of purchases happen on the first store visit, and 71% of purchases are in store.
  - OpenBrand, Q1 2026: 75.4% of purchases are in store, and LG leads unit share at 18.7%.
  - SquareTrade (surveys from 2021): 56% replaced a broken appliance, after 10.9 days without it on average.
- **Cross-device (dated):** Criteo found about 40% of US transactions crossed devices in Q4 2015, and that about 1 in 3 could be misattributed. We found no recent figure specific to CE.
- **No public numbers** exist for visits before an appliance purchase, or for the share of brand-site research that converts at a retailer. Where-to-buy vendors hold these privately per brand; LG's own PriceSpider and Best Buy pickup data could answer it, which is itself a reason for LG to lean in.

## 4. Candidate beats (twenty minutes)

1. **Her real place, LG's own sales: distinctive.**
   - Before first paint, an anonymous visitor from search sees the category rail and Deals tab lead with what LG sells best in her real state and what households in her ZIP need.
   - Receipt: "Region: [detected] · LG sell-through: laundry #1 · Census: 2.7 per home → 4.5+ cu ft".
   - Detection is real; the regional data is synthetic and labelled; every state is seeded.
   - Home Depot shows neighbourhood popularity, but nobody uses a brand's own sell-through as the prior.
2. **Two rooms, one page: partly shown.**
   - After a 65" QNED, a 65" OLED and a front-load washer, the homepage lifts TV & Audio and Laundry above Deals.
   - "Recommended for you" balances both rooms instead of showing eight washers.
   - Receipt: "TV 0.61 · laundry 0.39 · interest decays separately for each".
   - Insider and Dynamic Yield already reorder categories; nobody balances rooms with receipts.
3. **The room completes itself correctly: pairing is common, the rules are distinctive.**
   - A front-load washer gets the matching dryer and the 27" pedestal.
   - A top-loader loses the pedestal: "Pedestals fit front-load models only".
   - A TV gets its matching soundbar and a mount that fits its VESA pattern.
   - A range gets the over-the-range microwave, then the dishwasher, then the three-piece package price when that costs less.
4. **Premium as curation: distinctive.**
   - She dwells on OLED black levels and answers "evenings, 9 ft from the sofa".
   - A side-by-side card recommends the C-series at 77", states the price gap, and says "choose the QNED if your room is bright".
   - Receipt: those signals, plus "price is the same for everyone".
   - Samsung's model ladder shows the step up; nobody argues for the cheaper option.
5. **It fits, or it's hidden: the tool is common, using it to rank is distinctive.**
   - She enters a 27.5" closet width and three wider models leave every module.
   - Receipt: "Hidden: 3 models wider than your space".
6. **Three weeks later: distinctive for a brand site.**
   - Same browser, demo clock moved forward 21 days.
   - "Pick up where you left off" shows the OLED, the soundbar and what has changed: a real price change, Best Buy pickup available today.
   - Laundry interest has faded faster than TV interest; the receipt shows each rate.
7. **The phone, honestly: profile merging is common, the honesty is distinctive.**
   - On her phone she gets the regional cold start, because the engine doesn't know her.
   - She signs in to MyLG for the member price, and the CDP merges both profiles.
   - Receipt: "Linked at sign-in · consented · no device matching".
8. **Best Buy counts: distinctive.**
   - She picks up at her nearby Best Buy, or clicks Find a Retailer.
   - The engine records a partner outcome, stops pushing LG.com checkout, switches her to ownership content and ranks local pickup higher for similar shoppers nearby.
9. **The merchandiser outranks the engine, visibly: rules are common, the receipt is distinctive.**
   - The merchandiser pins the 2026 Wallpaper OLED launch in slot one, adds a kitchen-package rule and gives clearance stock extra weight.
   - Each receipt shows "Pinned · engine would have shown: 65" G6" and the rule that fired.
10. **Measurement as attribution: distinctive.**
    - A holdout group sees today's lg.com.
    - Lift in orders, Best Buy pickups and retailer clicks is computed in LG's own warehouse (LG is a public Databricks customer).
    - The result reads "not yet significant" until it is.

Suggested running order: 1, 2, 3, 4, 5, 8, 6, 7, 9, 10.

## 5. Five things not to say

1. **"Prices, discounts or financing set by place or inferred income."** LG's audiences already hold `census_income_tier`, and the rules are tightening:
   - New York's Algorithmic Pricing Disclosure Act (in force since 10 November 2025, upheld in district court, on appeal) requires the notice "THIS PRICE WAS SET BY AN ALGORITHM USING YOUR PERSONAL DATA".
   - The FTC proposed a personalized-pricing enforcement policy in August 2026.
   - California's Attorney General opened an investigation on 28 January 2026.
   - Steering credit offers by geography risks discouragement claims under ECOA (*Townstone*, 7th Circuit, 2024).

   Say instead: "The engine ranks content. Prices and eligibility are LG's, and the same for everyone."
2. **"Your rebate."** The federal HEAR appliance rebates are run state by state, applied at the point of sale and limited by income (up to 150% of area median), and only some states have launched them. ENERGY STAR is funded for FY2026 and is moving from EPA to DOE. Never infer eligibility from a ZIP or census data, and keep the EnergyGuide link on every tile the engine assembles.
3. **"Beat Best Buy."** No personal discounts and no steering away from partners. LG has a history of unilateral pricing policies on premium TVs. Home Depot shows "See Low Price in Cart", the usual sign of advertised-price rules. LG keeps an audience of retailer-headquarters ZIPs. In this demo a retailer sale is a win.
4. **"We know her without sign-in, or from her TV."** No probabilistic cross-device matching. Nothing that implies TV viewing data (automatic content recognition, ACR) or ThinQ appliance data shapes the site. Texas sued LG over ACR in December 2025, and LG settled on 11 May 2026 with affirmative-consent terms.
5. **A lift number.** LG's team runs A/A tests; quote no percentages. The holdout and LG's warehouse will decide.

## Caveats

- A parallel session browsed lg.com in the same browser profile, so the carousel's "before" state may reflect its activity; the "after" state was led by the washer we had just viewed.
- The browser pane was hidden, so scroll-loaded blocks (Similar Products, reviews) never rendered; product-page order comes from anchor links and server-rendered HTML.
- We omitted our test location, IP address and census values. An LG page wrote to the clipboard during one click; the app warned the user.

## Sources

Vendors: [Adobe–Samsung](https://business.adobe.com/blog/the-latest/samsung-proves-real-time-data-is-a-catalyst-for-better-customer-experiences) · [DWAO–Whirlpool](https://adobepartner.co/resources/case-studies/whirlpool-high-intent-personalization) · [LiveRamp–KitchenAid](https://liveramp.com/customer-stories/whirlpool-customer-story) · [Salesforce–GE Appliances](https://www.salesforce.com/customer-stories/ge-appliances/) · [Agentforce Commerce](https://www.salesforce.com/news/stories/agentforce-commerce-announcement/) · [Dynamic Yield–Elkjøp](https://www.dynamicyield.com/lesson/elkjop/) · [Bloomreach–Miele](https://www.bloomreach.com/en/case-studies/miele) · [Bloomreach–HP Tronic](https://www.bloomreach.com/en/case-studies/hp-tronic-wins-with-weblayers-and-bloomreach) · [Bloomreach Clarity](https://www.bloomreach.com/en/news/2025/bloomreach-delivers-consequential-impact-with-its-fast-growing-ai-shopping-agent-clarity/) · [Insider–Samsung](https://useinsider.com/case-studies/samsung/) · [Insider–Samsung AU](https://useinsider.com/case-studies/samsung-case-study-au/) · [Monetate spin-off](https://kibocommerce.com/press-events/kibo-spins-off-personalization-business-unit-under-the-monetate-brand/) · [Coveo–Motorola](https://www.coveo.com/en/resources/case-studies/motorola-solutions) · [Nosto–Robert Dyas](https://www.nosto.com/case-studies/robert-dyas/) · [Crossing Minds–OpenAI](https://siliconangle.com/2025/06/27/openai-hires-staff-shopify-backed-ai-startup-crossing-minds/) · [Optimizely–Electrolux](https://www.optimizely.com/insights/electrolux/) · [PriceSpider retailer data](https://www.pricespider.com/blog/retailer-traffic-from-brands/) · [MikMak–Rithum](https://www.rithum.com/press/rithum-sells-channeladvisors-shoppable-media-and-brand-analytics-product-lines-to-mikmak-acquisition-fuels-mikmaks-global-expansion-and-commerce-intelligence-innovation/) · [Pear](https://www.pearcommerce.com/)

LG: [Best Buy pickup](https://www.lg.com/us/promotions/store-pickup) · [MyLG Ownership](https://www.lg.com/us/mylg-ownership-program) · [LG FY2025 results](https://www.lg.com/global/newsroom/news/corporate/lg-electronics-releases-fourth-quarter-and-full-year-2025-financial-results/) · [Databricks–LG](https://www.databricks.com/customers/lg-electronics) · site observations on 1 October 2026: lg.com/us, samsung.com/us, whirlpool.com, geappliances.com, dyson.com, bestbuy.com, homedepot.com

Evidence: [Comscore/Walmart Connect TV journey](https://www.walmartconnect.com/content/dam/walmart-connect/documents/insight-articles/2021/tv-shopper-consumer-journey/TV%20Shopper%20Consumer%20Journey.pdf) · [J.D. Power 2023](https://resolve.jdpower.com/business/press-releases/2023-us-appliance-satisfaction-study) · [OpenBrand Q1 2026](https://openbrand.com/newsroom/blog/us-major-appliance-industry-market-share-trends-rankings-infographic) · [SquareTrade](https://www.squaretrade.com/press-release/major-appliance-blues-american-homeowners-have-spent-681-billion-repairing-or/) · [Criteo cross-device](https://risnews.com/forty-percent-purchases-are-cross-device-transactions) · [Criteo misattribution](https://criteo.investorroom.com/2017-02-28-Criteo-Research-Reveals-1-in-3-Online-Transactions-May-Be-Misattributed-by-Marketers-Not-Using-Cross-Device-Measurement)

Landmines: [NY APDA in force](https://www.jonesday.com/en/insights/2025/11/new-yorks-novel-algorithmic-pricing-disclosure-law-takes-effect) · [upheld](https://www.troutmanprivacy.com/2025/10/new-york-algorithmic-pricing-disclosure-act-upheld-as-constitutional/) · [appeal](https://www.mediapost.com/publications/article/412793/) · [FTC 2025 study](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-surveillance-pricing-study-indicates-wide-range-personal-data-used-set-individualized-consumer) · [FTC August 2026](https://fortune.com/2026/08/24/ftc-retailers-personalized-pricing-consumer-surveillance/) · [California sweep](https://www.reedsmith.com/articles/california-launches-investigative-sweep-on-surveillance-pricing-to-enforce-ccpa-compliance/) · [Townstone](https://www.goodwinlaw.com/en/insights/blogs/2024/07/seventh-circuit-revives-cfpbs-ecoa-action-alleging-discrimination-against-prospective-applicants-aga) · [HEAR](https://www.energystar.gov/partner-resources/state-and-tribal-rebate-programs/hear-program) · [ENERGY STAR funding](https://www.utilitydive.com/news/energy-star-gets-full-2026-funding-from-congress/811087/) · [move to DOE](https://www.dwmmag.com/2026/09/01/epa-doe-finalize-energy-star-program-transition-plan/) · [EnergyGuide online](https://www.ftc.gov/news-events/news/press-releases/2010/10/starting-2011-ftc-will-require-energyguide-labels-televisions) · [LG UPP](https://www.twice.com/news/lg-imposes-online-upp-restrictions-50354) · [Texas ACR suits](https://therecord.media/texas-sues-5-smart-tv-makers-over-acr-tech) · [LG settlement](https://www.texasattorneygeneral.gov/news/releases/attorney-general-ken-paxton-secures-major-agreement-lg-protect-texans-privacy-and-stop-data-being)
