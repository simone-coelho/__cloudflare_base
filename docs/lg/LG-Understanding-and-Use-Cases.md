# LG: what we learned, and what to show them

**Internal. For Simone.** Written 2026-10-01 from five research lanes run the same day: site reconnaissance and taxonomy, buying journeys, the data side and memory, the competitive landscape, and the engineering map of Vantage as the framework. The lane reports, with their sources and code citations, are in `docs/lg/research/`. "Observed" means seen on lg.com/us on 2026-10-01 as an anonymous visitor; prices and counts are as of that day. Inference is marked.

---

## 0. The understanding, in one paragraph

LG's US store is young, sits on a mature brand, and already runs our platform. Most visitors arrive anonymous and most of them to research; about three in four appliance purchases close in a store, and LG counts a Best Buy or Costco sale as a win. The site runs Optimizely Web Experimentation (27 campaigns in the configuration every browser downloads), Product Recommendations behind both of its recommendation carousels, and ODP segments inside its audiences. It geolocates every visitor's ZIP, and its tag manager turns that ZIP into a census persona, income tier included, which it pushes into ODP and Optimizely. It records the search keyword that brought her in a first-party cookie. And then it does nothing visible with any of it. The TVs page is identical with and without the fifteen ad parameters. After about 160 pages across TVs, refrigerators and laundry, the homepage's 22 modules kept their order; only the two recommendation carousels moved, and the homepage one swapped wholesale to what she had just browsed, in one session to eight washers with no TV and no dryer. For an anonymous visitor the site remembers almost nothing: favourites need a sign-in, compare is a cookie, there is no recently-viewed module. The opportunity is the layer they are missing: a decision engine at the edge that reads intent from the first request, including the ad that brought her; builds a taste profile across a 1,500-product catalog; completes the room rather than the product; remembers her across the weeks an appliance decision takes; hands the profile to their CDP when she signs in; treats the retailer hand-off as the outcome it is; and shows its reasoning on every card. **It is an expansion of what LG already runs on our platform, told as their next step, and the account team belongs in the room from the first conversation.**

---

## 1. What LG is, from the outside

### 1.1 The catalog

1,528 products across 183 listing pages. The full tree with filters, counts, attributes and product rows (name, SKU, image, prices, rating, call to action, Best Buy pickup flag) is `research/lg-taxonomy.json`.

| Area | Count | Inside it |
|---|---|---|
| TVs | 94 | OLED evo 17, OLED 24, QNED Mini LED 32 and QNED evo 7, UHD 25, 4K 11; by size from 50" and under (40) to 97" and over (10) |
| Soundbars, Sound Suite, projectors | 29, 13, 9 | |
| Refrigerators | 164 | French door 101, side-by-side 14, top freezer 11, bottom freezer 6; counter-depth is a filter, not a node |
| Dishwashers | 63 | top control 37, front control 7 |
| Cooking | 119 | ranges 93 (gas 31, electric 39, induction 13, dual fuel 3), microwaves 36 (over-the-range 24), wall ovens 17, cooktops 34 |
| Laundry | 195 | washers 75 (front load 21, top load 24, pedestal 9), dryers 111 (electric 57, gas 33), WashTower 15, washer-dryer combos 22 |
| Packages | 44 | kitchen packages 21, laundry sets 23 |
| Monitors, laptops | 204, 185 | UltraGear 73, gram 82 |
| Offers page | 46 | tabs per area; types: online exclusive, bundle, savings, limited time, shipping and installation, services and programmes |

Series names (C6, G6, QNED85) appear only in product names, never as filters. Fuel, width, depth type, capacity, colour and features are filters on appliances; size, type, gaming and cinema features on TVs. Every product is either sold by LG ("Add to Cart") or "Find a Retailer" only, the latter mostly last year's models.

### 1.2 How the site sells, observed

**The homepage** is 22 server-rendered modules: a pencil banner, the header with the visitor's ZIP, a 13-icon category nav, the hero carousel, a service strip (free delivery, 14-day returns, extended coverage, haul-away, expert chat), category cards, "Discover LG Deals", "Shop with an LG Expert", **"Recommended for you"** (the only personalised module: Optimizely Product Recommendations, eight items), showcase tabs, the benefits of buying on LG.com, brand stories and "For LG Owners". Everything else is CMS content scheduled by date, though Optimizely can change any module in the browser.

**The TVs page**, the ad's target: a hero (the NFL Shop gift card ending 4 October; a Consumer Reports reliability slide), promo mini-cards (up to $1,000 off big screens, a free Xbox controller, TV plus Sound Suite up to $400 off, Best Buy pickup, $200 off a matching soundbar), six type icons (the CMS defines four; an Optimizely campaign inserts two), the toolbar with the ZIP, "94 Results", sort and filters, a members banner, grouped carousels of three cards per type, then SEO copy.

**A product page** opens on a sticky buy bar: title, SKU, price block, the Affirm line, special offers, Add to Cart. Below it: tabs; the gallery beside a five-card offer carousel; key features; the delivery date for the ZIP next to **"pick up as early as today" at Best Buy**, which is an LG.com order fulfilled by Best Buy in about two hours (TVs, soundbars, monitors and some laundry; not refrigerators, ranges, dishwashers or packages); the size or colour selector with a price on each; protection (Premium Care by Asurion, $129.99 to $249.99 on the TV, $9.99 to $69.99 on the washer); setup (stand setup free, wall mounting by Angi free against a listed $164.99, appliance installation $29.99, haul-away $25); a rules-based rail (eight soundbars on the TV; on the washer **"Complete Your Laundry Room"** with the matching dryers and "Bundle to save $200", with the pedestal and stacking kit as accessories); "Review your selections"; specifications in 11 to 14 groups; features; reviews; Q&A; the owners' block; and a second personalised rail, **"You might also like"**, which turned cross-category after appliance browsing. A kitchen package page has a 3- or 4-piece selector, a fuel selector (induction, electric, gas at +$100) and its four products; the items' sale prices sum to $4,596 and the package sells for $4,096.

### 1.3 Offers, programmes and the partner channel

Every card shows a sale price, "$X OFF" and a struck list price. On top of that, observed: a gift card with purchase from rotating partners (NFL Shop $200 through 4 October; Sling, Uber Eats and Fanatics earlier in the year); pair and package savings (refrigerator plus dishwasher up to $200; washer plus dryer $150–$200; range plus over-the-range microwave, or wall oven plus cooktop, $200; TV plus soundbar up to $200 and plus Sound Suite up to $400; a 4-piece laundry set a further $150–$250; a kitchen package up to $500, online only); Buy More Save More on monitors; a free single-door refrigerator with a French door; the promo code WASH1000; outlet pricing; a washer trade-in; the ThinQ two-year warranty through 31 December for appliances registered in the app, retailer purchases included. LG also runs multi-item rebates through retailers (the January–April 2026 edition: 2, 3 or 4+ items earned $100, $200 or $300, LG STUDIO $600 or $800, instant at Home Depot, Best Buy and Costco). **Every offer carries a start and an end timestamp in LG's CMS**, shown as a dated "valid through", never a countdown. LG's price guarantee applies only during named sale events and only to LG.com prices, and LG does not match prices.

**Financing is Affirm**, on every cart-able product page ("0% APR or as low as $83/mo" on the C6); Klarna is gone from the site. Nothing we show goes near that line.

**Behind the sign-in**: member pricing on every product page, MyLG Rewards (100 points = $1, up to 5% back), the paid Ownership Program ($79.99 or $169.99 a year: two-year warranty, free installation, haul-away, 5% back) and ID.me-verified discounts of at least 10% for military, medical staff, teachers, students and first responders.

**The partner channel is on every product page.** "Find a Retailer" opens "Buy Directly From LG" first, then PriceSpider's online sellers (Best Buy, Costco and regional dealers for a TV; Lowe's, Home Depot and Wayfair for a refrigerator) and the nearest stores by distance (Best Buy, Costco, Sam's Club, BJ's, Walmart, Micro Center). For the current models LG sells itself the widget was empty: LG.com keeps the current line and lets retailers close the rest. A partner buyer becomes known to LG through product registration, which captures retailer, model, serial, price and date, and through the ThinQ warranty offer. An Optimizely audience even excludes visitors from retailer head-office ZIP codes from tests.

### 1.4 What they already run, from the page code

Optimizely Web Experimentation (one project: 27 campaigns, 31 experiments, 145 pages and 28 audiences in its public configuration, including a contextual bandit); Optimizely Product Recommendations behind "Recommended for you" and "You might also like"; ODP, with segments inside audiences such as an in-market big-screen TV audience and "LG owners, last 28 days"; Dynamic Customer Profiles; Statsig feature gates. Their tag manager reads the IP-derived ZIP, fetches a census persona file and keeps the result for 30 days: urbanicity, **income tier (affluent, middle, budget)**, median income, homeowner share, median age, college share, children, commute mode, life stage, language and household size. It goes to ODP and appears as `census_*` visitor attributes in Optimizely. Around it: Coveo search, Bazaarvoice, PriceSpider, EcoRebates, Affirm, Sprinklr and iAdvize chat, Attentive, Qualtrics, FullStory and Clarity, Transcend consent, the Google Retail API, Akamai, Datadog, Forter, Next.js on Contentstack. Not in the code: Adobe, Tealium, Segment, mParticle, Treasure Data (named as an LG customer in 2020, entity unspecified), Dynamic Yield, Bloomreach, Salesforce. LG Electronics also built a Databricks "Customer Index" for its Korean sales division.

**The ad click changes nothing visible.** The TVs page returned identical content with and without the fifteen parameters. The click is only recorded: Optimizely tags the visit as campaign traffic, a first-party cookie stores `source=google|medium=cpc|keywords=lg tvs`, and Google's cookies and a Floodlight tag keep the click id. The campaign name decodes as 2026, the TV business unit, always-on, brand keywords, paid search, Google, the generic group; the keyword is the bid term, not the exact query. What an engine can honestly take from the click: paid brand search, TV intent with no size, series or price yet, the region from the request, new or returning from cookies. What it cannot: the exact query, the budget, the household, the identity, the stage, or where she will buy.

### 1.5 What the site gets wrong today

Each is observed, and each is what a windowed, explainable page fixes: a kitchen package whose headline says 21 October and whose terms say 17–30 September; 4-piece packages with out-of-stock members; seven QNED tiers, and a C6 that is a different panel at 77" and 83"; a C6 that fell $1,000 in seven months; and product pages whose cached server data carried **other visitors' ad parameters** (Facebook click ids, UTM tags), a caching defect that also says where intent must be read: from the request at the edge, never from a cached page.

---

## 2. The shopper

**TVs** are bought after a long look: sixteen or more active research days and forty or more touchpoints, four in five buyers waiting a month or more, many saving or arranging payment. The decision ladder is size by room and viewing distance, then technology (OLED against QNED and Mini LED against UHD), then the series, with gaming refresh rates and bright-room brightness as the two forks that pick a series, and the soundbar, the mount and installation as the attach. The series lives only in the product name on LG.com, which is why the series chart matters. The real decision engines sit off-site (RTINGS, CNET, "best TV" searches) and the deal calendar matters (new models in spring, prior-year clearance, Prime days, Black Friday, the Super Bowl). Signals a brand site can read, all inference: arriving from a review site or a "best TV" search means evaluating; using the viewing-distance tool or switching sizes sets the size band, which should decay slowly; opening the series chart means settling a tier; reading refresh-rate specs means a gamer; reading brightness or anti-glare means a bright room; repeat visits to one model and opening offer terms mean deal sensitivity, which should decay fast; "find a retailer", store pickup or a ZIP check mean channel and urgency; opening expert chat means intent.

**Appliances** move at two speeds. About 65% of demand is replacement, and roughly half of buyers research and buy within two weeks (a distress replacement means eleven days without the machine); a quarter take a month or more. **The three-to-six-week window LG described fits the planned buyer: the remodel and the new home.** Four modes, each with signals: *distress* (one category, in-stock or fastest-delivery sorting, an early ZIP check); *remodel* (several categories, finish and fuel switches, package pages, wall ovens, LG STUDIO); *new home* (kitchen and laundry together, no interest in haul-away); *fit anxiety* (depth filters, the measuring guide). Finish locks a suite to one brand (black stainless differs maker to maker), fuel is regional (gas cooking about 38% nationally and about 70% in California and New Jersey; dryers 80% electric), and capacity follows the household.

**The room is the unit of cross-sell, not the product.** Washer → the matching dryer (gas or electric, $100 apart; heat pump as the third) → the pedestal or the SideKick → the stacking kit; a top-loader has no pedestal. Range → over-the-range microwave → dishwasher → refrigerator → the package price when it costs less. TV → the matched soundbar → a mount that fits the VESA pattern → installation → protection. TV-to-appliance cross-sell is weak and should not be forced. There are no credible public attach rates for any of it; **the demo measures attach, it never claims it.**

---

## 3. The four questions LG asked you, answered from the code

**How long does a profile last at the edge?** Four clocks, independent, three of them LG's to set:

| Clock | Today | What LG would publish |
|---|---|---|
| Interest decay, per dimension | 14 days shipped, 35 for price band, up to 90 | 60–90 days on type, configuration, size and price band; minutes on deal interest and content type. Worked: five touches read 0.74; after six weeks 0.12 at 14 days, 0.58 at 60, 0.64 at 90 |
| Profile retention | a tenant policy, counted from the first event; demo tenants use 30 days | 120–180 days, with their privacy owner |
| Anonymous return recognition | the session token lasts 24 hours; recognising a return needs a published *continuity* window (up to 90 days) | publish it, labelled, with the purpose stated |
| Consent | 30 days from each explicit choice, a constant in code | LG's banner is a notice with a single OK, opt-outs live on its off-site Privacy Center and the policy honours Global Privacy Control; our record carries that state rather than a second banner. Two small build items make the lifetime and the session host's 30-day idle expiry tenant settings |

So "she browsed ranges six weeks ago and comes back" is real on the same device with those three settings and a consent state on each visit. The honest sentence: *taste lasts as long as you decide; the moment lasts minutes; a return is recognised inside the window you publish, and never without consent.*

**Can we use their CDP?** Yes, in four ways today: history import per person (`POST /v1/:tenant/identity/events`, each row discounted by its age), profile attributes and audiences for eligibility (never for scoring), aggregate priors, and the scheduled export of decision, outcome and behaviour records to their warehouse under a pseudonym they can join (identity/resolve maps their account id to our shopper id). Live streaming both ways exists for ODP, which they run; a forwarder to any other CDP is a small build modelled on it.

**Laptop now, phone later, who is she?** Two anonymous people, two profiles, until a sign-in on either device sends the signed link; then one profile that keeps both histories, faded by each dimension's clock, and the phone's next page opens on the laptop's taste. No fingerprinting, by design, and we say so. "Sign in for member pricing" on every LG product page is the natural moment, and a linked profile keeps the earliest start date, so retention must be long enough to make the link worth it.

**Cold start from their own data.** Their regional sales by category, type, configuration, size band and price band become a regional lean at state grain; the census figure (income, home value, and if they want, heating fuel and housing type) is shown as the explanation and never scored; the lean gives way as her own evidence grows. "French door outsells side-by-side here" is exactly this. "At this income band" is their own sales by price band, not an inference about her.

---

## 4. Ten use cases

Each: the shopper's story, what the engine does, what is real today (R), configuration (C) or build (B), and the honesty line. Ordered as a demo would run them.

**1. Her real place and your own sales, before the first draw.** A stranger arrives from the Google search "lg tvs". The page already knows the state she is really in (the same request signal LG uses for the ZIP in its header), opens the category rail and the deals on what LG sells best there, leads the TV rail with the sizes and series that sell in that state, and the receipt says so: "North Carolina, from the request; your sales here lean OLED 65-inch; census shown, not scored". *Engine:* the regional prior with a per-dimension allowlist, the census read, the campaign-term seed from `utm_term=lg tvs`. *R, with LG's rows C.* Honesty: the location is always real; the lean is synthetic until their warehouse replaces it; price never moves. Nobody else starts from the brand's own sell-through.

**2. The search ad is a signal, not just a landing page.** LG already writes `keywords=lg tvs` into a first-party cookie on arrival, and the page ignores it. For us the click is the first evidence: "lg tvs" lifts TV pieces across the homepage; "lg oled 65 inch" would lift a size and a series; a brand-term click reads as paid search on the receipt. *Engine:* W16 seed rules on the campaign term; the channel on the cell. *R for the term; B for reading Google's auto-tagged clicks (`gclid` without a UTM source) as paid search, a ruling in the channel classification.* Honesty: the receipt shows the campaign's contribution, and her first click outscores it.

**3. Two rooms, one page.** She looks at two TVs and a washer. TV & Audio and Laundry move above the generic deals; "Recommended for you" balances both rooms instead of swapping wholesale to eight washers; the receipt shows one interest score per room. *Engine:* category and room dimensions, module ordering, diversity per slot. *R.* This is the exact test lg.com failed on 1 October, where 22 modules held their order after 160 pages and only the carousel moved.

**4. The room completes itself, with the rules visible.** She opens a front-load washer. Beside it: the matching dryer in her fuel, the pedestal, the stacking kit, and the pair price when it is lower. She switches to a top-loader: the pedestal leaves and the card says why. On a TV page: the soundbar that matches the series and a mount that fits the VESA pattern. On a range: the microwave, the dishwasher, the package price. LG's own washer page already has "Complete Your Laundry Room" as a fixed rule on one page; ours follows her across the homepage, the grid and the return visit, and shows the rule. *Engine:* a companions slot gated by the anchor family today; a `complements` relation with the composer's existing "completes it" hook, itemised on the receipt, as the clean build; packages as pieces with `featuredProductIds`, credited when any member sells. *R today through gating; B for the relation.* Honesty: "goes with" is a rule a merchandiser wrote, shown as one.

**5. Premium as curation, never pressure.** On a QNED page the engine shows the OLED beside it with the honest sentence ("for a bright room the QNED is the right choice; for a dark room this OLED is"), and a size up from the viewing distance she entered, with the price the same for everyone. *Engine:* tier and size-band dimensions, content pieces per comparison, `journeyStageFit`. *R.* Honesty: the receipt reads "price is the same for everyone"; nothing sits near the Affirm line.

**6. Fit as a ranking input.** She enters the width of her laundry closet or the depth of her counter opening. Models that do not fit drop out of the rail, and the page says "hidden: 3 models wider than your space". A distress shopper (one category, in-stock sort, an early ZIP check) sees in-stock and fastest delivery lead, with haul-away beside it. *Engine:* `eligibleWhen` on asserted context; sort and ranking by declared values; stock as a gate. *R.* Honesty: her declared measurements are hers, labelled declared, never inferred.

**7. The offer that expired leaves at midnight.** A promotion's window closes; it leaves every surface on the next decision and its successor takes the place; a kitchen package with an out-of-stock member never shows as complete. LG's CMS already timestamps every offer, so the windows map one to one; what changes is that every surface honours them on the next request. *Engine:* windows and stock gates on every piece (Top Offers' beat 6, exactly). *R.* This answers the defects their own pages show today.

**8. Three weeks later.** She returns (labelled as a new session in the same browser, the engine's clock real). The hero is "pick up where you left off": her shortlist, what changed (a price, a new model), and the receipt showing that her laundry interest faded faster than her TV interest because the dials say so. The site she left has no recently-viewed module at all. *Engine:* per-dimension decay, the continuity window, the stage rule on the hero. *C for the three settings; B for a cross-visit journey stage.* Honesty: "we remember you for the window you publish, with your consent, and we show you what we remember".

**9. The phone, and the sign-in that makes her one person.** On her phone she is a stranger with the regional opening; she signs in for member pricing and the page becomes the laptop's taste within one request; the receipt reads "linked at sign-in · consented · no device matching". The same link is where their CDP learns who she is. *Engine:* the signed link, the merge, `identify()`; a demo sign-in action for fictional accounts. *R for the link and merge; B for the demo action.* Honesty: never recognised across devices without sign-in.

**10. Best Buy counts, twice.** Two outcomes that LG's pages already offer and nothing measures together. She chooses Best Buy pickup: an LG.com order, fulfilled by a partner, credited to the decision that earned it. Or she presses "Find a Retailer" and clicks through PriceSpider to Costco: a partner referral, credited the same way, after which the engine stops pushing LG.com checkout for her and ranks local pickup higher for similar shoppers nearby. The day report shows LG.com shipped, LG.com picked up at Best Buy, partner referrals and attach side by side, labelled attribution; lift is theirs to compute against a holdout in their warehouse, and the report reads "not yet significant" until it is. *Engine:* a retailer click as a reward-bearing outcome (one row in the outcome contract), the holdout, the export; PriceSpider's own click events are the signal to read. *R for clicks credited to the decision; B for the named outcomes.* Honesty: a referral is not a sale; registration is how a sale finds its way back.

**Running through all ten: the merchandiser outranks the engine, visibly.** A launch pin for a new series, a rule that a kitchen package never shows incomplete, a weight on a clearance line, each shown with what the engine would otherwise have chosen.

---

## 5. The demo, proposed

**A fictional brand** on LG's schema and in LG's palette, no mark; the name is yours to choose. Real products by their real names and images, as Vantage did for phones; the taxonomy file already holds image links for about 700 of the 1,528 products, all on LG's own media host, and the product pages give the rest the same way.

**Surfaces:** the homepage (hero, the category rail's order, the deals module, a decided "recommended for you" rail across rooms, the continue hero); a category grid (TVs, through the product sort with the regional prior); two product pages (a TV and a front-load washer) with decided modules below an off-limits buy box: companions that complete the room, the package, protection and installation, and where-to-buy with both Best Buy pickup and a retailer referral as outcomes; a return visit; a phone with sign-in. Five acts, about sixteen beats, Vantage's director, before/now row, receipts and Compare.

**Scope for the first build:** TVs (94) with soundbars, laundry (195), and one kitchen path, range → over-the-range microwave → dishwasher → package (about 200); roughly 500 products, inside the catalog document's size cap. Monitors and laptops later, with the catalog split by category when the full 1,528 go in.

**What is reused.** Everything Vantage proved: its own worker on the session host, the tenant and four documents, beats as versioned publishes, the receipt action, the cold-start route and the all-states seed, the director and panels, the two suites, the morning routine. The engineering map recommends extracting this once into a demo kit (routes factory, cold-start factory, page kit, seed and rehearsal libraries) with Vantage as the proving consumer, so LG builds only its vertical layer and its beats.

**What is new engine work, all general and small:** a `complements` relation and the slot rule that uses the composer's existing hook; a retailer click and a partner pickup as named outcomes; the regional prior reaching the product sort; Google's auto-tagged clicks read as paid search; a tenant-settable regional horizon (today a 24-hour constant, hence the morning reseed); the continuity window and retention published for the tenant; a cross-visit journey stage; optionally a forwarder to a non-ODP CDP.

**What LG would provide, and why:** regional sales rows (region, period, category, type, configuration, size band, price band, units) so the cold start is their own sell-through; the catalog feed with per-category attributes and a series field, which their site today carries only in product names; the PriceSpider click events, so a referral is an outcome; a signed sign-in assertion from MyLG, so a link is theirs to vouch for; their CDP choice; consent state through Transcend.

---

## 6. Lines we hold in front of LG

- Price, rewards, financing and rebate eligibility never vary by geography or inferred income; the census explains, it never scores; nothing sits near the Affirm line.
- LG's own persona carries an income tier as a targeting attribute. We take it as explanation and availability only, and we should say early and plainly why that is the stronger position.
- No protected class and no proxy for one; housing and household tables are shown as aggregates, never used to infer a person.
- HEAR energy rebates are state-run and income-qualified: the shopper's own lookup, never a pre-qualification.
- TV viewing data (ACR) and ThinQ appliance data stay out of anything we show; Texas settled with LG over ACR in May 2026.
- No recognition across devices without sign-in; no lift number of ours, ever; attach is measured, not claimed.
- Retailer price parity and advertised-price rules are theirs; we compete on relevance and service, never on undercutting a partner.
- Every contrast with their site is framed as their next step on the platform they already run.

---

## 7. Decisions, as of 2026-10-01 evening

1. **The brand name.** Simone's steer: two letters, simple, in LG's palette, no mark, not a copy of theirs. The lead recommends **OH**, read as "Optimized Home", because it covers TVs, laundry and kitchen alike, reads as a word, and collides with no appliance or TV brand; **OA**, her own example, is the alternative. Her call.
2. **Category scope.** Agreed: TVs with soundbars, laundry, and one kitchen path (range → over-the-range microwave → dishwasher → package); about 500 products.
3. **The sign-in stitch is shown live.** A demo sign-in sheet names a fictional account; the worker mints the signed assertion server-side and the page becomes the laptop's taste within one request, receipt included. The secret lives on the worker, never on the page, and is created with the worker on her approval.
4. **The demo kit first.** Agreed: design in `docs/demo-kit/Demo-Kit-Design.md`; Vantage holds its suites as the gate; the LG data lanes start now, the LG page lanes once the kit holds Vantage.

---

## Research files

In `docs/lg/research/`: `lg-site-recon.md` and `lg-taxonomy.json` (the crawled tree, 1,528 product rows, page anatomy, offers, the partner channel, the stack, the ad-click decode; its "first view" was not a clean browser), `lg-buying-journeys.md` (cross-sell structure, journey signals, calendar, site defects), `lg-data-and-memory.md` (the four clocks, the CDP paths, LG's privacy posture), `lg-landscape.md` (what LG runs today, competitors, candidate beats, things not to say), `lg-framework-map.md` (Vantage as the chassis, engine gaps, memory settings).
