# LG buying journeys: TVs and major appliances

Research for a real-time personalization demo. Public pages only, 1 October 2026. **obs.** = seen on the live page that day. **[inf]** = our inference, not a sourced fact. Bracketed numbers are sources.

## 0. What matters for the demo

- **Real cross-sells are locked by fit or finish:** washer → matching dryer → pedestals or stacking kit; range → OTR microwave → dishwasher → refrigerator (one finish, so one brand); TV → matched soundbar → mount and installation. LG.com prices each as a bundle (obs.) [2][31–34]. TV → appliance is weak [inf].
- **Appliance demand has two speeds.** About 65% is replacement [21]; 46% research and buy within two weeks, 24% take a month or more [23]. The 3–6-week window fits planned buyers only, so the profile needs a fast-decaying urgency dimension [inf].
- **TV timing waits for deals.** 79% wait a month or more [16]. The 65" C6 fell $1,000 in seven months [1][2].
- **Review sites hand off to retailers** (RTINGS links to BestBuy.com, obs.) [6]. LG.com must win the decision and accept a retail close.
- **The plumbing exists:** a per-product cart-or-retailer call to action, ZIP-based delivery dates, Best Buy pickup, member pricing, PriceSpider tracking, Optimizely endpoints (obs.) [2][3][17][45].

## 1. The TV journey

**Sequence [inf]:** room and size → technology → series → features → price and timing → channel.

**Size.** RTINGS starts from SMPTE's 30° minimum and recommends ~40°. That puts a 65" at 6'6"–8'10", a 77" at 7'8"–10'5" and an 83" at 8'3"–11'3". Its calculator shows the *smallest* comfortable size, which nudges shoppers upward [6]. Sales of 97"+ sets rose tenfold in 2024 as prices halved [10]. LG offers up to $1,000 off big screens, with free delivery and installation (obs.) [4][11].

**LG's 2026 ladder**

| Tier | Facts |
|---|---|
| 4K UHD | entry [4] |
| QNED evo Mini LED | seven sub-series (QNED80–92); from $729.99 (55") to $12,999.99 (115"); LG.com pre-order 12 May [8] |
| Micro RGB evo | from $4,999.99; LG.com pre-order 22 April [9] |
| OLED B6 | entry OLED, α8 processor [4] |
| OLED evo C6 / C6H | best-seller; $1,399–$5,299 at launch; 165Hz, G-Sync, FreeSync. 77"/83" are the C6H (tandem panel); the 42" lacks Brightness Booster; a budget CS6 also exists [1][5] |
| OLED evo G6 | flagship; $2,499–$24,999; LG claims up to 3.9× the brightness of a regular OLED [1] |

**Bright rooms and gaming.** RTINGS rates the C6 best in the dark, with moderate glare handling [5]. The G6 is one of the few OLEDs it considers fit for bright rooms [7]. All four C6 HDMI ports are HDMI 2.1 [5].

**Attach.** The C6 page offers matching soundbars at $50–$200 off, a Sound Suite bundle saving $400, and a free mount with professional mounting (by Angi) until 4 October; the G-series includes a mount (obs.) [2][4][15]. Geek Squad charges $179.99 to mount ($269.99 with wire concealment), bracket extra [12].

**Anchoring and the model-year cycle.** LG.com took C6 and G6 pre-orders from 4 March, adding $1 Premium Care (4–13 March) and a free mount and installation; retail followed in March [1]. Last year's models clear meanwhile: Super Bowl 2026 deals were on the C5 [13]. The 65" C5 reached $1,299.99 at Best Buy in June 2026, against $2,699 at launch [14]. The 77" C5 sold for $1,999 (45% off) on Black Friday 2025 [15]. Few buyers ever pay the list-price anchor [inf].

**How buyers decide.** Of 840 TV buyers, 79% waited at least a month, 40% spent it saving or arranging finance, 51% looked in a store, 30% compared specs and 76% preferred to buy in a store (InfoScout, 2016) [16]. LG borrows authority with CNET and Consumer Reports badges (obs.) [3][11]. Wirecutter was unreachable for our tools.

**Price matching and open-box.** LG.com does not match prices [17]. Best Buy matches 19 named competitors (not LG.com) and its own price drops within the return window, except in Black Friday week and on bundles [18]. Retailer-specific model suffixes stop price matching [19]. LG's C6 comes as a PUA model (cart, Wi-Fi 5) and an AUA model (retailers only, Wi-Fi 6E) at the same list price (obs.) [2][3]. Best Buy's open-box TVs are up to 50% off [20], and LG.com outlet items have a 7-day full-refund window [17].

**TV journey signals [inf]** (the LG controls named are observed)

| Signal on LG.com | What it means → profile dimension |
|---|---|
| Arrives from RTINGS, CNET or a "best TV" search | evaluating → show scores and comparisons |
| Uses the distance tool; toggles sizes (42"–83" [2]) | sizing → size band (slow decay) |
| Opens the series chart (W6/G6/C6/B6 [3]) | narrowing → technology tier |
| Dwells on 165Hz or VRR | gamer → C6/G6, Xbox-controller offer [4] |
| Dwells on brightness or anti-glare | bright room → G6 or Mini LED [7] |
| Repeat SKU visits, price sort, opens offer terms | deal-watching → deal sensitivity (fast decay) |
| Clicks a soundbar or mount | ready to add accessories |
| Pickup or "Find a Store" [2]; "Find a Retailer" [3]; ZIP check | channel and urgency; a retailer hand-off is an assisted win |
| Opens expert chat [2] | high intent, unanswered question |

## 2. The appliance journey

**What triggers a purchase.** Whirlpool's CEO put pure replacement at ~65% of Q1 2025 demand, with discretionary demand weak for two years [21]. 76% of homeowners wait for a failure, and 13% planned to buy direct from a manufacturer [22]. In Google/Compete (2012), 39% bought because the old unit broke, 27% to upgrade and 17% after a remodel. 21% bought within a week, 25% in 1–2 weeks, 29% in 2–4 weeks and 24% after a month or more [23]. A breakdown meant 10.9 days without the appliance (2021) [24]. Choice drivers: price 85%, size 55%, brand 50%, reviews 47%, warranty 30%, financing 9% (YouGov, 2025–26) [25].

**Fit.** LG's Measure First guide covers the delivery path (gates at least 38" wide), door jambs, 2" off the width and 1" off the depth, and the 90° door swing [26]. Counter-depth versus standard depth is the main fork; LG adds Counter-Depth MAX with Zero Clearance (obs.) [31].

**Fuel.** Ranges are 59% electric, 31% gas, 5% dual-fuel and 4% propane. Dryers are 80% electric and 19% gas. 38% of homes cook with gas nationally, against about 70% in California and New Jersey [27]. LG charges $100 more for gas dryers and offers electric, gas and induction toggles in kitchen packages (obs.) [31][33]. Induction rebates are narrow: HEAR is state-run and means-tested, and in California single-family funds were reserved by February 2026, with cooktops and dryers claimable only by multifamily homes [28]. ENERGY STAR is funded for FY2026 [29].

**Finish.** Black stainless differs by maker, so Consumer Reports advises one brand per suite [30]: the lock-in behind suite cross-selling. LG's Black Steel washer costs $100 more than the White (obs.) [33].

**Delivery, installation, haul-away.** LG.com delivers free to the room of your choice. Paid White Glove adds installation, parts and haul-away, but excludes hardwiring, side venting, water-line extensions and propane conversion. LG contacts the buyer to schedule; delivery typically takes 7–10 business days [17]. Package tiles show a delivery date for a ZIP the site inferred (obs.) [31]. Home Depot delivers free from $998 ($39 below that); haul-away is extra and installation is priced by ZIP (offer 1–21 October, obs.) [35]. Costco's price includes delivery, hook-up, parts, haul-away and a 2-year warranty, though dishwashers and gas ranges may need a second contractor visit [36]. J.D. Power 2026: retailer satisfaction 706 (+23), 87% problem-free, Best Buy reportedly highest [37].

**Protection, rebates, financing.** LG Premium Care is administered by Asurion, with no deductible and food-loss cover [38]. From 1 January to 8 April 2026, LG gave a 2-year warranty on appliances bought at participating retailers and registered in ThinQ within 60 days [39]. Costco extends cover to 2 years [36]. Home Depot's card offers 6–24 months of deferred interest [40]. We found no financing offer on LG.com: the FAQ lists cards, PayPal, Apple Pay and Google Pay, and the old Klarna page redirects (obs.) [2][17]. Samsung, Whirlpool, KitchenAid, GE and Dyson all advertise financing from 0% APR (obs.) [43][55–58].

**Packages (evidence of pricing, not attach rates)**

- LG.com (obs.): washer–dryer pairs $100–$200 off; 4-piece laundry sets (adding a $659 SideKick pedestal washer and a $249 drawer) an extra $150–$250 until 3 November; range with OTR microwave, or wall oven with cooktop, $200 off; kitchen packages up to $500 off, online only [31–34].
- LG at retailers, 1 January–8 April 2026: 2 items $100, 3 $200, 4+ $300; LG STUDIO 4 for $600, 5+ for $800; two per category at most; vacuums count. Instant at Home Depot, Best Buy and Costco; elsewhere a Visa prepaid card after 8–10 weeks [41]. Memorial Day's bundle ran 9 April–16 June [42].
- Samsung counts TVs, audio and monitors with appliances: 2 items $100 up to 8 for $1,000, until 31 December (obs.) [43].
- Attach data is thin. Consumer Reports (2017) found more than half of shoppers buying both machines chose a matched pair [44]. We found no credible public attach rates for soundbars, mounts or pedestals: measure them in the demo rather than assert them.

**Appliance signals [inf]**

| Signal | Reading |
|---|---|
| One category; in-stock or fastest-delivery sort; early ZIP check | distress → availability first, mid-tier, haul-away |
| Several categories; finish and fuel toggles; packages; LG STUDIO; wall ovens | remodel → suite, finish match, next package tier |
| Kitchen and laundry together; no interest in haul-away | new home → full package |
| Depth filter; measuring guide; time on dimensions | fit anxiety → fit check, counter-depth upsell |
| ENERGY STAR, induction, heat-pump dryer | rebate-sensitive → rebates by ZIP |
| Returns over weeks | planned → keep the slow dimensions |
| Cold start | real edge geolocation → state fuel mix [27]; Census household size → capacity |

## 3. Direct-to-consumer versus retailer

**LG's hybrid today (obs.)** [2][3][11][17][45–49]
- Each product's data sets `ctaTypeCode` to CART or RETAIL. The C6 AUA offers only "Find a Retailer".
- LG.com orders can be collected at Best Buy in as little as 2 hours and returned there within 15 days.
- New models open as LG.com pre-orders with perks.
- Gated prices: a members-only price after sign-in; the MyLG Ownership Program (LG.com only, $79.99 or $169.99 a year) with 5% back in points; the Partner Store, 10% off (15% on LG STUDIO) after work-email or ID.me checks; group discounts (military, students); deals in chat. In 2025 a newsletter sign-up earned $100 off a new TV plus 10% in points [48].
- Price protection applies only during events (Memorial Day 4 May–3 June; Labor Day 13 August–7 September) and only to LG.com prices. It excludes codes, bundles, in-cart, member and outlet prices [49]. LG does not match prices [17].
- Registration: the ThinQ warranty offer collects the place of purchase and a receipt [39]. Basic MyLG accounts get a 2-year warranty when they register in ThinQ (obs.) [46].

**Why prices match across channels.** Samsung's appliance MAP policy covers every public ad, including in-cart prices. It exempts dealers' bona fide membership programmes, allows free-shipping and financing promotions, and limits gift-card bundles [50]. Samsung's Offer Program bars members from asking retailers to match its prices [51]. [inf] LG's gated prices and service-led offers follow the same logic: compete on everything except the headline price.

**Measuring a sale that closes at a retailer.** PriceSpider's where-to-buy tracking records clicks, the retailer, the product and the sale, using last-click attribution and data from retailers [52]. LG pages load PriceSpider's tracking script (obs.). Best Buy Ads and Home Depot's Orange Apron Media (with a clean room) attribute sales by SKU in a closed loop [53]. ThinQ registration, rebate claims (receipts, serial numbers [41]) and Premium Care sales recover the buyer's identity after a retail purchase. [inf] Demo KPIs: decision completed (cart, retailer hand-off or pickup), assisted retailer revenue, registration within 60 days, lift against a regional holdout.

**Peers (obs. unless noted)**

| Brand | What they do |
|---|---|
| Samsung [43][51] | cross-category bundles; Offer Programs (up to 30% off); warranty extension by claim for retailer buyers; Affirm; next-day delivery in some areas |
| Sony [54] | unreachable for us; third party: My Sony 5% back, free shipping; My Sony Care $179.99 a year |
| Whirlpool [55] | free delivery from $599; extra 10% in cart for verified groups; free haul-away when signed in |
| KitchenAid [56] | lower prices when signed in; the 2026 Color of the Year mixer is also at Williams-Sonoma |
| GE [57] | Bodewell ($149 a year, free delivery and installation); a rebate excluding Home Depot, Lowe's and Best Buy |
| Dyson [58] | colours and tools only on Dyson.com; gifts; 2- or 5-year warranty |

**LG.com plumbing (obs.):** the site shows a ZIP the visitor never entered, via an IP-geolocation API. It also calls Optimizely Web, api.zaius.com (Optimizely Data Platform's API [inf]), Coveo search, the Google Retail API, iAdvize and Sprinklr chat, and Attentive SMS.

## 4. Merchandising calendar (US)

| Window | TVs | Appliances | Offer life |
|---|---|---|---|
| January–Super Bowl (8 February) | prior-year OLED and big-screen deals [13][65] | LG Q1 bundle and warranty offers, 1 January–8 April [39][41] | TV 2–5 weeks [inf]; Q1 programmes 14 weeks |
| Presidents' Day (16 February) | — | holiday sales; LG price guarantee [49] | 1–3 weeks [inf] |
| March–May: launches, March Madness, Amazon spring sale | C6/G6 4 March, Micro RGB 22 April, QNED 12 May [1][8][9]; Best Buy matched Amazon on the C5 [61]; no LG March Madness evidence | — | launch perks ~10 days |
| Memorial Day (25 May) | OLED $1,000–$1,400 off [42] | bundles 9 April–16 June; guarantee 4 May–3 June [42][49] | 4–10 weeks |
| Prime Day (moved to 23–26 June); Best Buy Tech Fest | record-low C5 [14][59] | — | 4 days |
| 4 July | LG.com "Black Friday in July", 15–28 July 2024 [60] | discounts ~22%, against ~24% on Black Friday [66] | 2 weeks |
| Back to school | laptops up to 20% off; monitors (obs.) [11][34] | — | rolling [inf] |
| Labor Day (7 September) | — | guarantee 13 August–7 September [49] | 3.5 weeks |
| NFL kickoff and autumn | NFL Shop e-gift card until 4 October (obs.) [4] | laundry sets until 3 November; Home Depot 1–21 October; Samsung to 31 December [32][35][43] | 3–14 weeks |
| Prime Big Deal Days (6–7 October) | likely matched [inf] | — | 48 hours [59] |
| Black Friday (27 November) / Cyber Monday (30 November) | 2025: up to 45% off; guarantee 24 November–1 December [15] | 2025 bundles 5 November–3 December [15] | 1–4 weeks; Best Buy suspends price matching [18] |
| December–January | prior-year clearance [13] | limited-supply clearance (obs.) [11] | until sold out [inf] |

"Limited time" at LG is a "VALID THROUGH" or "Offer ends" date on a tile; we saw no countdowns (obs.) [4][34]. At Home Depot it is dated legal terms [35].

## 5. Levers

| Lever | LG today (obs.) | Retailer | Signal that makes it relevant [inf] |
|---|---|---|---|
| Instant savings | struck-through "$1,000 OFF" [2] | "up to 40% off", dated Special Buys [35] | repeat SKU visits; arrives in an event week |
| Bundle discount | pairs, sets and packages [31–34] | instant at checkout [41] | views a second category or a matching SKU |
| Member price | price after sign-in; Partner Store; points [31][47] | Costco member pricing [36] | returning visitor; hesitates at the cart |
| Financing | none found [2][17] | store card, 6–24 months [40] | high ticket; browses one tier down |
| Rebate | card or instant [41] | Home Depot Rebate Center [35] | ENERGY STAR or induction interest; ZIP where rebates are live |
| Delivery and installation | free delivery; free TV mounting to 4 October; Best Buy pickup [2][17][45] | free from $998; Costco all-in [35][36] | checks ZIP or date; 77"+; reads installation |
| Protection plan | Premium Care; ThinQ 2-year [38][39] | Costco 2-year [36] | reads reliability content or reviews |
| Accessory attach | soundbar, mount, pedestal, stacking kit [2][33] | Geek Squad $179.99+ [12] | views mounts or VESA; picks a front-loader |
| Package upgrade | 3 → 4 pieces [31][32] | tiers by item count [41] | cart one item short of the next tier |
| Premium tier or bigger size | series chart; big-screen savings [3][4] | XXL in stores [10] | distance over 9 ft; bright-room or gaming cues |
| Counter-depth or smart features | Counter-Depth MAX; ThinQ [31] | depth filters | uses a depth filter; is in remodel mode |

## 6. Complaints and what an explainable site could do

| Complaint | Evidence | Visible fix [inf] |
|---|---|---|
| Stock and delivery | 4-piece packages show items out of stock; Trustpilot 1.3/5 (3,866 global reviews, mostly service) [31][62] | lead with in-stock items for distress visitors and say why; replace the missing package item |
| Installation scheduling | White Glove exclusions; LG contacts buyers to schedule; Costco's second visit [17][36] | show what is included, excluded and next, before checkout |
| Spec confusion | C6 sizes differ; seven QNED tiers; PUA/AUA [3][5][8] | note on each size where the same name hides a different panel |
| Price changes | guarantees only during events; no price matching; anger at price drops [17][49][63] | show price history and the guarantee window for the item |
| Bundle rules | one transaction; void if anything is returned; package dates conflict (21 October vs 17–30 September); a warranty offer that expired in April is still shown (obs.) [31–33] | live eligibility ("one more item unlocks $X"); expire stale claims |
| Retailer price differences | prices differ; suffixes block matching [17][19] | an honest hand-off to Find a Retailer or Best Buy pickup |
| Trust in data use | Texas TV-tracking (ACR) settlement requiring opt-in, May 2026; Copilot tile backlash [64] | a "why this?" panel and a reset |

## Sources

1. LG Newsroom, Mar 2026. https://www.lg.com/us/newsroom/media-entertainment/lg-announces-pricing-and-availability-for-2026-flagship-tv-models
2. LG, C6 PUA (obs.). https://www.lg.com/us/tvs/lg-oled65c6pua-oled-4k-tv
3. LG, C6 AUA (obs.). https://www.lg.com/us/tvs/lg-oled65c6aua-oled-4k-tv
4. LG, TVs (obs.). https://www.lg.com/us/tvs
5. RTINGS, C6 review, Apr 2026. https://www.rtings.com/tv/reviews/lg/c6-oled-2026
6. RTINGS, size to distance, Jun 2026. https://www.rtings.com/tv/reviews/by-size/size-to-distance-relationship
7. RTINGS, bright-room TVs, Sep 2026. https://www.rtings.com/tv/reviews/best/bright-room
8. PR Newswire, QNED evo 2026. https://www.prnewswire.com/news-releases/lg-electronics-launches-2026-qned-evo-mini-led-tv-lineup-headlined-by-ultra-large-115-inch-model-302769112.html ; prices: https://www.ecoustics.com/products/lg-qned-evo-tvs-2026/
9. LG, Micro RGB evo, Apr 2026. https://www.lg.com/us/press-release/micro-rgb-evo-2026
10. AP via TechXplore, Nov 2024. https://techxplore.com/news/2024-11-tv-big-bed-holidays-approaching.html
11. LG homepage (obs.). https://www.lg.com/us/
12. Geek Squad pricing. https://www.bestbuy.com/site/tv-home-theater-services/tv-home-theater-service-pricing/pcmcat1757013463338.c?id=pcmcat1757013463338
13. Tom's Guide, Jan 2026. https://www.tomsguide.com/tvs/oled-tvs/surprise-get-the-lg-c5-oled-for-over-usd800-off-ahead-of-the-super-bowl
14. TechTimes, Jun 2026. https://www.techtimes.com/articles/318899/20260623/lg-c5-oled-reaches-record-low-best-buy-tech-fest-1299-before-prime-day.htm
15. LG, Black Friday 2025. https://www.lg.com/us/press-release/unwrap-unbeatable-black-friday-savings-on-lg-home-appliance-and-entertainment-favorites
16. InfoScout, 2016. https://irp.cdn-website.com/6cdfb444/files/uploaded/InfoScout_Whitepaper_TelevisionPathToPurchase_003.pdf
17. LG, order FAQ (obs.). https://www.lg.com/us/shop-lg/shop-faq
18. Best Buy, price match. https://www.bestbuy.com/site/help-topics/price-match-guarantee/pcmcat290300050002.c?id=pcmcat290300050002 ; https://www.bestbuy.com/site/price-match-guarantee/qualified-competitors/pcmcat1693426756861.c?id=pcmcat1693426756861
19. Yahoo Tech, Costco TV models. https://tech.yahoo.com/home-entertainment/tvs/articles/where-costcos-exclusive-tvs-actually-221700202.html
20. Best Buy, Outlet guide. https://www.bestbuy.com/site/buying-guides/outlet-buying-guide/pcmcat748300448284.c?id=pcmcat748300448284
21. Whirlpool Q1 2025 call. https://uk.investing.com/news/transcripts/earnings-call-transcript-whirlpool-q1-2025-misses-eps-stock-rises-93CH-4046117
22. AHS, 2025. https://www.ahs.com/home-matters/homebuyer-hub-resources-and-guides/appliance-purchase-statistics/
23. Google/Compete, 2012. https://www.thinkwithgoogle.com/_qs/documents/695/role-of-digital-in-the-large-appliance-shopper-path-to-purchase_research-studies.pdf
24. Allstate via TWICE. https://www.twice.com/retailing/research-68-1-billion-spent-by-american-homeowners-to-replace-or-repair-broken-household-appliances
25. YouGov via YourSource News. https://yoursourcenews.com/2026/09/what-were-they-thinking/
26. LG, Measure First. https://www.lg.com/us/support/products/documents/LG_Measure_First.pdf
27. NPGA (EIA RECS); EIA. https://www.npga.org/news-resources/2020-residential-energy-consumption-survey-recs/ ; https://www.eia.gov/todayinenergy/detail.php?id=53439
28. California Energy Commission. https://www.energy.ca.gov/programs-and-topics/programs/inflation-reduction-act-residential-energy-rebate-programs
29. Facilities Dive. https://www.facilitiesdive.com/news/energy-star-gets-full-2026-funding-from-congress/810999/
30. Consumer Reports, 2018. https://www.consumerreports.org/kitchen-appliances/the-appeal-of-black-stainless-appliances/
31. LG, kitchen packages (obs.). https://www.lg.com/us/kitchen-appliance-packages
32. LG, laundry sets (obs.). https://www.lg.com/us/laundry-appliance-sets
33. LG, WM6700HWA (obs.). https://www.lg.com/us/washers-dryers/lg-wm6700hwa-front-load-washer
34. LG, promotions (obs.). https://www.lg.com/us/promotions
35. Home Depot, appliances (obs.). https://www.homedepot.com/b/Appliances/N-5yc1vZbv1w
36. Costco. https://www.costco.com/f/-/appliance-advantage ; https://techsupport.costco.com/app/answers/detail/a_id/1001211/
37. J.D. Power 2026. https://yoursourcenews.com/2026/09/appliance-shoppers-pleased-with-their-experience-jd-power/ ; https://www.jdpower.com/business/press-releases/2026-u-s-appliance-satisfaction-study/
38. LG, Premium Care. https://www.lg.com/us/support/what-is-lg-premium-care
39. LG, ThinQ warranty offer 2026. https://dzrf1tezfwb3j.cloudfront.net/uploads/rebates/regional/PDFs/2025-12-29-16-41-52.pdf
40. CNBC Select. https://www.cnbc.com/select/home-depot-credit-card-review/
41. LG, Q1 2026 bundle rebate. https://www.us-appliance.com/content/rebate/LGQ12026_Rebate.pdf
42. LG, Memorial Day 2026. https://www.lg.com/us/press-release/lg-turns-up-the-savings-this-memorial-day-across-home-appliances-and-entertainment-products
43. Samsung, appliances (obs.). https://www.samsung.com/us/home-appliances/
44. Consumer Reports via Yahoo, 2017. https://finance.yahoo.com/news/matching-reliability-matching-washers-dryers-175042442.html
45. LG, store pickup. https://www.lg.com/us/promotions/store-pickup
46. LG, MyLG Ownership (obs.). https://www.lg.com/us/mylg-ownership-program
47. LG, Partner Store. https://www.lg.com/us/lg-partner-store
48. LG privacy notices (obs.). https://privacy.us.lg.com/policies
49. LG guarantees. https://www.lg.com/us/promotions/labor-day-price-guarantee ; search-indexed: https://www.lg.com/us/promotions/memorial-day-appliance-price-guarantee ; https://www.lg.com/us/promotions/presidents-day-price-guarantee
50. Samsung MAP, 2020. https://intercountyappliance.com/wp-content/uploads/2023/03/SAMSUNG-HA-MAP-POLICY.pdf
51. Samsung, Offer Programs (obs.). https://www.samsung.com/us/shop/offer-program/
52. PriceSpider. https://www.pricespider.com/blog/how-pricespiders-universal-tracking-suite-works/
53. Marketing Dive. https://www.marketingdive.com/news/home-depot-orange-apron-retail-media-network-infronts/711240/ ; The Drum: https://www.thedrum.com/news/best-buy-s-retail-media-vision-blends-stores-data-and-ai-at-scale
54. Coupons.com, Sony. https://www.coupons.com/coupon-codes/sony
55. Whirlpool (obs.). https://www.whirlpool.com/
56. KitchenAid (obs.). https://www.kitchenaid.com/ ; https://www.williams-sonoma.com/products/kitchenaid-artisan-stand-mixer-spearmint-coty/
57. GE Appliances (obs.). https://www.geappliances.com/ ; https://www.geappliances.com/bodewell-membership
58. Dyson (obs.). https://www.dyson.com/inside-dyson/direct-benefits
59. Digital Commerce 360. https://www.digitalcommerce360.com/article/everything-about-amazon-prime-day/
60. LG, Black Friday in July 2024. https://www.lg.com/us/press-release/lg-launches-black-friday-in-july-promotion
61. Tom's Guide. https://www.tomsguide.com/tvs/oled-tvs/best-buy-is-matching-amazons-big-spring-sale-with-this-epic-lg-c5-oled-tv-deal-usd1-300-off-the-price
62. Trustpilot (obs.). https://www.trustpilot.com/review/www.lg.com
63. JustAnswer. https://www.justanswer.com/software/pgf1b-purchased-lg-refrigerator-june-15.html
64. SecurePrivacy, Jul 2026. https://secureprivacy.ai/blog/samsung-lg-texas-acr-settlements-smart-tv-consent-ctv-publishers ; https://www.tomshardware.com/monitors/televisions/lg-says-microsoft-copilot-on-webos-tvs-is-a-browser-shortcut-not-a-built-in-app
65. Forbes Vetted, Jan 2026. https://www.forbes.com/sites/forbes-personal-shopper/2026/01/29/best-super-bowl-tv-deals/
66. CR/Gap Intelligence (indexed). https://www.consumerreports.org/money/discounts-rebates/when-to-get-the-best-deals-on-appliances-a7220664779/
