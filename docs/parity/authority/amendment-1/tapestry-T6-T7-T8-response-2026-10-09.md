# Tapestry's answer to Phase 1 asks T6, T7 and T8 (dimensions, vocabulary, behaviours)

Received from Nitin Tyagi on 9 October 2026. Text extracted from `tapestry-T6-T7-T8-response-2026-10-09.docx` beside this file; table cells appear one per line. Customer material, internal.

TAPESTRY · BTIE · Phase 1 response
Heading1 T6 · The dimensions the engine scores on
How to read the use-case column: numbers refer to whitepaper sections; "(3)" is the Sarah journey in section 3, and "A.1 #n" is feature n in the appendix.
#
Dimension
What it measures
Whitepaper use case
How the engine uses it
Priority
User context: facts about the visit, known at or before the first click
1
Entry channel
How the shopper arrived and what brought them: channel, source platform, campaign, the collection or product in the ad, search keyword theme, landing page type.
Cross-channel awareness: ad creative, search keywords and influencer style inform the experience from the first page (3.2). Sarah arrives from an Instagram ad for Tabby (3). "Instagram visitors → contemporary styles" (1.1).
Sets the first paint and starting module order. The collection in the ad lifts that collection before any click. First rung of the learning ladder.
High
2
Visit number
First visit or a return: first, second–third, fourth and later.
Return visit recognition: "picks up where you left off" (3.2). Sarah's second and third visits (3).
With channel, forms the starting groups. First visits lean to inspiration and discovery; returning visits lean to continuity: recently viewed, complete the look.
High
3
Recency
Days since the last visit: same day, within 7 days, 8–30 days, 30+ days.
Recency-weighted signals: recent behavior dominates (4.2). Same-session or next-visit return (3).
A recent return picks up where the shopper left off; a long gap leans back toward discovery and new arrivals.
High
4
Location
Coarse region from IP. No precise geolocation.
Sarah: Northeast US, from IP (3). Population priors at page load (A.1 #3).
Regional starting point for a new visitor; seasonal relevance.
Medium
5
Device
Mobile, desktop or tablet.
"Instagram visitors on mobile in evening" (1.1). Priors from device + referrer + time (A.1 #3).
Part of the first-paint prior. Mobile and desktop shoppers engage with modules differently.
High
6
Time of day
Local day part: morning, afternoon, evening, night.
Sarah at 8pm local time (3). "Mobile in evening" rule (1.1).
Part of the first-paint prior, e.g. evening browsing leans to inspiration.
Low
User intent: inferred from the shopper's behavior as they browse
7
Journey stage
Where the shopper is in the buying journey, derived from behavior (A.1 #1). Stages and goals from whitepaper 3.4:
Exploring (inspire & engage): bouncing between categories, short dwell, no cart activity.
Considering (inform & validate): returning to the same products, reading reviews, checking the size guide, comparing.
Deciding (convert & reassure): adding to cart, checking shipping.
Post-purchase (delight & retain): after an order.
Journey stage detection is the foundation feature (A.1 #1). Journey stage × content matrix (3.4). Sarah moves from exploring to deciding (3).
Changes module order and content by stage: lookbooks and style stories for explorers, comparisons, reviews and size/fit for considerers, complete the look and a clean path to checkout for deciders, care and styling tips after purchase (3.4).
High
8
Gifting intent
Whether the shopper is buying for someone else.
Cart intelligence: detect gifting, default gift wrap (A.1 #18).
Gifting edits, gift messaging and wrap.
Low
User affinities: the shopper's learned taste, scored 0 to 1 against product and content tags
9
Category affinity
The shopper's interest in each category: bags, small leather goods, shoes, jewelry and so on.
Style understanding across all categories, not only "you viewed handbags" (3.2). Sarah's taste carries to shoes, accessories, ready-to-wear (3).
Decides which category tiles rise in the grid, and which categories recommendations draw from.
High
10
Product Type affinity
The shopper's interest in each product type: crossbody, tote, wallet, card case, sneaker and so on.
Sarah taps Handbags and crossbody and shoulder bags surface first (3). Adaptive navigation: Bags → Crossbody pre-expanded (A.1 #5).
Main taste signal on PDP. Leads "You may also like" and "Complete the look". Purchased sub-category is dampened afterwards (T8).
High
11
Collection affinity
The shopper's interest in each Coach line or collection.
The Tabby bag that brought Sarah in (3). Hero features the collection she came for.
Lifts modules and content featuring the same collection.
Medium
12
Shopper style
The shopper's interest in each style: classic, contemporary, minimalist, maximalist.
Aesthetic-based style understanding: minimalist, structured, contemporary (3.2). style_cluster in content metadata (3.6). Style-intelligent recs (A.1 #10).
Carries taste across categories, so a minimalist sees minimalist shoes and jewelry, not only more bags. Largest weight in the whitepaper content ranker (35%).
High
13
Color affinity
The shopper's interest in each color family.
Sarah: "black preference" (3).
Ranks products and imagery in preferred colors higher.
Medium
14
Material affinity
The shopper's interest in leather types, canvas, suede and so on.
Sarah views a black leather crossbody (3).
Refines recommendations within a sub-category.
Low
15
Price affinity
The shopper's interest in each price band: entry, core, aspirational.
Sarah: $400–500 range (3). Personalized sort by price comfort zone (3.2, A.1 #8).
Keeps featured products within the shopper's comfort zone.
High
16
Full-price vs sale affinity
How much the shopper engages with full-price versus sale products.
Sarah taps full-price, not Sale (3). A "sale shopper" may really be a full-price buyer (2). "Sale page entry → value messaging" (1.1).
Decides whether value messaging or sale content appears. Prevents treating every sale visitor as discount-led.
Medium
17
Occasion affinity
The shopper's interest in each occasion: everyday, work, evening, travel and so on.
Occasion signals for editorial and lookbooks (3.2). Copy emphasis: weekend brunch vs client meeting (A.1 #12).
Matches editorial and styling content to the occasion.
Medium
18
Size affinity
The shopper's preferred bag size, and their size in shoes and ready-to-wear.
"In your size" badges (A.1 #9). Size and fit intelligence (A.1 #14).
Size-aware badges, facets and recommendations.
Low
19
Gender affinity
Which assortment the shopper shops: women's, men's or unisex. Learned from behavior on products; we never infer the shopper's own gender.
Style understanding across categories (3.2). Cross-category recommendations (A.1 #10). Coach's men's and women's assortments.
Keeps recommendations, grids and content within the assortment the shopper browses, and shifts as they browse, for example when shopping men's gifts.
Medium
20
Content format affinity
The shopper's interest in each content format: video, on-model, editorial and so on.
content_format in metadata (3.6). On-body vs studio media first (A.1 #11). Video-first experience (A.1 #15).
Decides whether a module leads with video, on-model imagery or editorial.
Medium
21
Content theme affinity
The shopper's interest in each content theme: craftsmanship, styling, heritage and so on.
Lead with craftsmanship for craft-focused browsers, versatility for practical ones (A.1 #12). Inspiration mode (A.1 #7).
Chooses content inside modules by theme, not only format.
Low
Product rules: product facts that decide what can be shown (not scored)
22
Inventory
The product's stock status, from the real-time inventory feed: in stock, low stock, out of stock, back in stock, pre-order.
'In Your Size' and 'Low Stock' badges with real-time inventory (A.1 #9). In-stock alerts for deciders (3.4). Back-in-stock email (A.1 #22). Inventory filtering in the re-ranking layer (capability matrix).
Out-of-stock products are never featured in modules. Low stock is shown to deciders only, never as urgency for explorers (3.4). Back-in-stock items are surfaced to shoppers who viewed them.
High
23
Bestseller
Whether a product is a bestseller or trending, from recent sales: bestseller, trending, standard.
'Bestsellers' for speed shoppers (A.1 #8). Graceful degradation to popularity-based and trending recommendations (4.2). Popular-item fallback for cold start (capability matrix).
Fills modules when the shopper has too few signals, and is the fallback when there is no decision. Leads the sort for speed shoppers. Never overrides a shopper's own affinities once they exist.
Medium
Heading1 T7 · The attributes and their values
Attribute
Applies to
Values
Entry channel
Visitor
paid social · paid search (brand) · paid search (non-brand) · organic search · email · SMS · affiliate · referral · direct
Source platform
Visitor
Meta · TikTok · Pinterest · Snapchat · YouTube · Google · Bing · other
Landing page type
Visitor
homepage · category page · product page · editorial / campaign page
Visit number
Visitor
first · second–third · fourth and later
Recency
Visitor
same day · within 7 days · 8–30 days · 30+ days
Device
Visitor
mobile · desktop
Time of day
Visitor
morning · afternoon · evening · night (shopper's local time)
Journey stage
Visitor
exploring · considering · deciding · post-purchase (whitepaper 3.4; section 3.2 describes the same path as seeing → thinking → deciding)
Category
Product, content
bags · small leather goods · shoes · ready-to-wear · jewelry · accessories · watches · fragrance
Product Type
Product, content
Bags: tote · crossbody · shoulder bag · satchel · top-handle · hobo · bucket · belt bag · backpack · clutch · messenger / briefcase · travel bag / duffle
Small leather goods: wallet · card case · wristlet · pouch · tech case
Shoes: sneaker · boot · sandal · flat · loafer · heel · slide
Ready-to-wear: outerwear · jacket · knitwear · top · dress · bottoms
Jewelry: necklace · earrings · bracelet · ring
Accessories: bag charm · strap · belt · scarf · hat · sunglasses · key ring
Watches, fragrance: [TBD]
Collection / product line
Product, content
Tabby, Brooklyn, Teri etc
Style
Product, content
classic · contemporary · minimalist · maximalist (whitepaper 3.6 style_cluster). The shopper's score on these values is the Shopper style dimension.
Color
Product, content
black · brown / tan · neutral (cream, chalk, grey) · bright / seasonal color · metallic · print / pattern (including signature)
Material
Product
smooth leather · pebbled leather · glove tanned leather · signature canvas · suede · quilted · shearling · other
Price band
Product, content
entry · core · aspirational (whitepaper 3.6 price_tier)
Dollar range per band: [TBD: Merchandising]
Price status
Product
full price · sale
Inventory status
Product
in stock · low stock [TBD: threshold, e.g. 3 or fewer] · out of stock · back in stock · pre-order
By size or color variant where it applies, refreshed from the SFCC inventory feed [TBD: frequency]
Bestseller status
Product
bestseller · trending · standard
Bestseller: top [TBD: N] products by units sold in the last [TBD: 28] days, per category. Trending: fastest rise in views and sales over the last 7 days. Recalculated [TBD: daily].
Occasion
Product, content
everyday · work · evening · weekend · travel · special event (whitepaper 3.6 occasion_tags). Gifting is captured as gifting intent, not as an occasion.
Gender
Product, content
women · men · unisex (the assortment an item belongs to)
Size
Product
Bag size: mini · small · medium · large
Shoes and ready-to-wear: sizes from the product feed
Content format
Content
Format: hero image · carousel · video · creator video · editorial / story · lookbook · user-generated (whitepaper 3.6 content_format)
Imagery: on-model · studio / silo · detail / zoom · flat-lay (on-body vs studio, A.1 #11)
Content theme
Content
craftsmanship · styling · product detail · brand & heritage · trend · care · gifting
Journey-stage fit
Content
exploring · considering · deciding · post-purchase (one or more; whitepaper 3.6 journey_stage_fit)
Rules:
ListParagraph Fixed values only. No free-text tags. A value outside the list is rejected at load, and the rejection is reported.
ListParagraph Each value has an ID, a display name and accepted synonyms. For example, "night out" maps to occasion: evening.
ListParagraph Every sub-category belongs to exactly one category, so the two never disagree.
ListParagraph The values in SFCC and the content system map to this list through one mapping table. We do not rename values in the source systems.
ListParagraph Changes are versioned. Adding a new collection or value is a new revision, approved before use.
Heading1 T8 · The behaviors and what each is worth
Rank
Behavior
Weight
What counts
Whitepaper use case
1
Search
A search query that maps to a vocabulary value, e.g. "black crossbody".
Personalized search (A.1 #6). Stated intent.
2
Add to cart
Item added to the bag from PDP, quick view or a module.
Deciding signal: Sarah adds to cart on her third visit (3).
3
Product view
A full PDP view. Includes quick view.
Click 2 and 3 of Sarah's journey (3). The most frequent signal.
4
Repeat product view
Viewing the same product again, in the same or a later visit.
Sarah returns to the same two bags (3). Comparison intelligence: ≥3 PDP revisits (A.1 #16).
5
Purchase
Order completed, server-confirmed and deduplicated on order ID.
Moves the shopper to post-purchase (3.4) and shifts interest to complementary products. See the purchase rule below.
6
Video view
Video started and watched for at least 3 seconds.
Video-first experience: triggers include video watch % (A.1 #15). Interest in the product or story shown.
7
Video completion
75% of the video watched.
Video-first experience (A.1 #15).
8
Size guide / fit opened
Size guide or fit information opened on PDP.
Sarah checks the size guide (3). Size and fit intelligence (A.1 #14). A considering signal.
9
Reviews opened
Reviews expanded or read.
Sarah reads reviews (3). A considering signal.
10
Filter applied
A facet applied on a category page, e.g. color, price, sub-category. A sale filter or sale page raises price status: sale.
Adaptive facets: triggers are filter usage and price-band clicks (A.1 #9).
11
Content click / tap
A click or tap on a content piece.
Content ranking (3.3).
12
Save / wishlist
Item saved to wishlist or favorites.
A low-commitment action. Useful for inspiration mode and back-in-stock email (A.1 #7, #22).
13
Dwell
Past 20 seconds on a PDP, or 30 seconds on editorial.
Implicit signal: dwell time (4.2). Bandit reward: dwell >30s (3.5).
14
Content impression
At least 50% of the module in view for at least 1 second (IAB/MRC).
Essential: tracks what the shopper saw but did not engage with (4.3.1). It drives fatigue, negative signals and the denominator of every engagement rate and evidence floor (3.5, 3.6).
15
Remove from cart
Item removed from the bag.
Negative signal.
Purchase rule: A purchase strengthens affinity for the product's style, collection, color and price affinity, but dampens affinity for the sub-category just bought for [TBD: proposed 30 days], so a shopper who just bought a crossbody is shown a matching wallet, not another crossbody (the whitepaper's "a wallet that matches").