# Behavioral Targeting and Intelligence: how it works, with every constant on a slider

**For pre-sales solutions engineers.** You explain the engine to a customer's technical team. This page is the companion to [How it works and where it runs](https://edge-platform-bti.expedge.workers.dev/how-it-works): it runs the engine's own arithmetic in your browser, so you, or the customer's engineers beside you, can move any constant and watch every number answer.

> **The engine keeps each visitor's interest per dimension value, scores every candidate in a slot with one published formula, and writes the arithmetic of each decision on a receipt a person can recompute.**

**What this page is.** Every number on this page is computed in your browser by the engine's arithmetic, on the published documents of an example brand, Wrenfield, a store that sells phones, plans and home internet. The constants are the engine's defaults: K = 1.8, an entry line at 0.60, an exit line under 0.45, and a memory τ of 14 days, which a brand sets for each dimension. The regional sales behind the first page are synthetic, made up for the example, and the page says so wherever they appear. Read it from the top down: each section says its idea in words and formulas first, and above every instrument a short paragraph says what you are looking at, what to try and what to watch for. Every group of controls and every instrument carries a circled question mark; hover over it, focus it or tap it to see what it is, the constant it sets, where that constant is published, and what moves when it changes.

## Most visitors are strangers, and the page still has to decide

Most of a site's visitors are strangers, and most buying happens before any profile exists. Tools built for known customers are blind in that window, so teams write rules to make up for it, and the rules go stale, multiply and fight. The engine decides for the stranger and the regular alike, from what each visitor is doing now.

## The engine is a personal stylist for every visitor

Think of a personal stylist for every visitor, at internet scale. It reads the room, watches without interrogating, rearranges the table and pivots when attention moves. Recommendations rank the past; the engine decides the page at the point in time, and the two work side by side. It is not a recommendations engine and does not replace one: it organizes the page by interest around whatever recommendations a brand runs, and a recommendations carousel is one of the modules it orders.

## What it does, and where this page shows it

- **The first page feels local before the first click.** A stranger's first page leans on what visitors in their region are interested in, from the brand's own regional sales, and steps back as the visitor's own interests grow. [Section 5](#a-stranger-is-scored-on-their-regions-lean-until-their-own-evidence-outweighs-it) shows it.
- **The first click changes the page.** With the visitor's consent, a first product view raises every dimension value it carries, and the next answer reflects it. [Section 3](#a-product-view-is-a-touch-on-every-dimension-the-item-carries) and [section 4](#nothing-is-set-per-product-everything-is-per-dimension-and-per-slot) show it.
- **Channels seed the visit.** How the visitor arrived, from an email, an ad, a social post, a partner's quiz or the campaign term on a link, lifts matching pieces on the first page. [Section 5](#a-stranger-is-scored-on-their-regions-lean-until-their-own-evidence-outweighs-it) shows it.
- **Interest fills and drains like a bucket.** For each dimension value, every action adds its weight and the level fades on that dimension's memory; a visitor enters an audience at one line and is released below a lower one, and saturation caps how much any one value can count. Nobody writes expiration rules, and the release is on the record. [Section 2](#interest-measures-how-much-evidence-there-is-and-how-fresh-it-is) and [section 6](#each-dimension-forgets-at-the-speed-the-brand-sets) show it.
- **The page reorganizes by interest.** The engine orders a page's sections and modules for each visitor, not only what goes inside a slot, and a recommendations carousel is one of the modules it orders. [Section 4](#nothing-is-set-per-product-everything-is-per-dimension-and-per-slot) and the slots document in [section 8](#three-published-documents-decide-everything-above) show it.
- **Merchandisers keep the wheel.** Gates remove what may not show, pins hold the sections the brand sells, and only then does ranking run; every override and every decision is written out as arithmetic on a receipt. [Section 4](#nothing-is-set-per-product-everything-is-per-dimension-and-per-slot) and [section 9](#every-decision-writes-its-own-arithmetic-down) show it.
- **Every constant is tuned in the open.** Marketers and data scientists change weights, memories, lines, seeds, pins and dials in published, versioned documents, in the console or through the API, in force without a release. [Section 8](#three-published-documents-decide-everything-above) shows it.
- **It learns from outcomes behind a dial the brand controls.** It records what works from the first day and changes nothing until the brand turns the dial. Holdouts measure its lift on the brand's own numbers. [Section 7](#learning-is-a-counted-multiplier-behind-a-dial-that-starts-at-zero) shows it.
- **Opal works with it.** Opal authors audiences and tests, explains results, tags content, and proposes and launches experiments and CMAB tests on signals. The engine calls no AI model to decide. Opal is where people ask and generative AI creates, and that is where credits apply.
- **It links with ODP and Feature Experimentation.** The audiences and interests the engine forms reach the brand's customer data in ODP, and a Feature Experimentation test or contextual bandit can run on any slot.
- **AI add-ons for shoppers are optional.** AI search, the style concierge and generated imagery are there for a brand that switches them on with its credits.
- **Identity carries across sign-in.** When a visitor signs in, their anonymous and known profiles merge, adding interests and overriding nothing.
- **It runs at the edge.** Each decision is made on Cloudflare's network, in the data center nearest the visitor, and the decisions land in the brand's own warehouse. We aim to make each decision within about 200 milliseconds at the edge; on average we see 50 to 250 milliseconds, and tens of milliseconds once the engine has seen the visitor.

## Each customer weighs the reasons differently

Customers choose the engine for these reasons, and each customer weighs them differently:

- They can control it.
- It decides at the point in time.
- It is performant at the edge.
- Every decision is explainable.
- It hooks to Opal.
- AI is theirs to use or not.
- It learns to the degree they govern.
- It links with ODP.
- It works alongside their recommendations.
- It honors the placements they sell.

## The unit of state is the dimension value, not the click

The engine does not remember products. For each visitor it keeps a small vector of graded interests, one coordinate per dimension value the visitor has touched (brand samsung, ecosystem android, price band core), each a number between 0 and 1. Products, promotions and page modules carry tags in the same dimensions, so a candidate's score is its tags dotted with the visitor's vector, weighted by the slot it competes in. Nothing is configured per product: an offer published a minute ago is scored the moment it carries tags, and one view of one phone moves every candidate that shares any of its values.

**What you are looking at:** one candidate's score, taken apart. Each row is one tag of the Galaxy S26 offer, with the visitor's interest in that tag's value (read from their vector), the deals slot's weight for the tag's dimension, and their product, a × w; the bottom line adds the rows into the candidate's score. **Try:** find a row that scores and one that does not, and see which of its two numbers is zero. **Watch for:** a tag scores only when the visitor has some interest in its value and the slot weighs its dimension; the values in the vector that this offer does not carry are listed under it, because they score other candidates.

The visitor's own vector after the worked example's fourth step (three Samsung views and a Pixel view), before the regional prior of section 5. The candidate is the Galaxy S26 offer as published; the weights are the deals slot's. Every number is computed on this page by the arithmetic the sections below explain.

**Why this unit.** Keyed on the dimension value, one Galaxy view raises every Android candidate, including one nobody has been shown yet, and the receipt can name the coordinate that did it. Nothing has to be learned per product before a view of one product says something about another.

Read quickly, the mechanism sounds like “the visitor clicked Samsung, so show Samsung”. The sections below show where the arithmetic goes further: interest is graded and fades (section 2); one click moves several coordinates (section 3); the slot weighs them (section 4); a stranger starts from a prior that gives way (section 5); and each dimension forgets at the speed the brand sets (section 6).

## Interest measures how much evidence there is, and how fresh it is

A flag records that something happened. A quantity records how much evidence there is and how old it is, which is what lets interest rise with repetition, fade with time, and release a visitor from an audience at a moment computed in advance. Each coordinate stores two numbers, the raw evidence R and the time of the last touch t. Nothing is faded in storage: every read computes the fading from the clock, so a replay of the same events gives the same answer.

`R(t) = R · e^(−Δt/τ)`

The evidence left now: what was stored, faded by a factor of e for every τ since the last touch. τ is the dimension's memory: 14 days by default, set by the brand for each dimension, and never more than 90 days.

`R ← R(t) + w`

A touch adds its action's weight to whatever is left. The brand's registry names every weight; in the example, a view or a page view adds 1, a search 1.5, a selector, filter or compare 2, a cart add or a started order 3, and a purchase 5. An action the registry does not name adds 0. A custom event is named by its `data.action`, `data.eventName` or `data.event`, so a selector sent as custom weighs 2.

`a = R(t) / (R(t) + K)`

Interest is the evidence over the evidence plus a constant. It is ½ when R = K, 1.8 by default, and never reaches 1, so more evidence always counts, by less each time.

`enter when a ≥ θ_in; leave when a < θ_out`

Two lines, not one, so a visitor sitting near a line does not flicker in and out of an audience on every read: they join at 0.60 (evidence R ≥ 2.7) and stay until they fall under 0.45 (R < 1.4727). Time alone can release them, never admit them. The engine refuses a registry whose exit line is not below its entry line.

`t* = t + τ · ln(R · (1 − θ_out) / (K · θ_out))`

The instant the visitor leaves if nothing else happens, solved in closed form, so it can be scheduled instead of polled.

**What you are looking at:** one coordinate of one visitor, for example brand samsung, on the engine's default constants. The sliders set K, the memory τ, the two audience lines and the weight of the next touch. The first chart shows interest against the number of touches, with no time between them; the second shows it against time as you press, on a clock you can run fast; under them are the readout and the three worked numbers. **Try:** press the touch button three times quickly, then stop and let the clock run. **Watch for:** the third press carrying the visitor over the entry line, the dashed projection fading once you stop, and `t*`, the instant they leave the audience, worked out in advance rather than found by polling.

## A product view is a touch on every dimension the item carries

The Galaxy S26 as the example's catalog lists it: brand samsung, ecosystem android, $899.99, category phones. The engine derives the price band from `price_usd` with the registry's own cuts, $400 and $900, so $899.99 is **core** and the same phone at 512 GB ($1,099.99) is **premium**. One view is therefore four touches, and each lands on a coordinate with its own memory.

**What you are looking at:** one product view, three ways. First, the event the site sends when the visitor views a phone, then the touches the engine takes from it; under them, a live visitor: a row of phone buttons, a meter for every coordinate they have, and their whole stored state as a table. **Try:** press the Galaxy S26, then the Pixel 11. **Watch for:** four meters moving on each press; ecosystem android, price band core and category phones taking a second touch from the Pixel while brand splits across two makers; and the table holding only two numbers per value, the evidence and the time of its last touch. This visitor carries on into sections 4 and 5.

The event the site sends when the visitor views a phone:

```
POST /realtime/action
{
  "type": "product_view",
  "data": {
    "productId": "galaxy-s26",
    "category": "phones",
    "brand": "samsung",
    "os": "android",
    "ecosystem": "android",
    "price_usd": 899.99,
    "view": "card"
  }
}

(the visitor's session and the landing link
 ride beside type and data)
```

The touches the engine extracts from it:

```
category    phones    ← category
brand       samsung   ← brand
ecosystem   android   ← ecosystem
priceBand   core      ← price_usd 899.99: 400 ≤ price < 900

os          no dimension reads it: ignored
productId   names the product on the answer
view        not a registry source
```

One touch per registry dimension whose source field is on the event: a string is one value, a list is several, and a number is banded. The `os` field rides beside `ecosystem` and is ignored, because no dimension names it as its source. The engine holds the brand's content, not its phone catalog, so it scores the attributes the event carries, bounded to the registry's dimensions (at most 8 values per list, 64 characters each) and to the values the brand's catalog names. Storage is not a dimension: the configured price rides the event, so the 512 GB step touches premium.

## Nothing is set per product; everything is per dimension and per slot

Every candidate in a slot is scored the same way: for each of its tags, the visitor's interest in that value times the slot's weight for that dimension, summed. The weights belong to the slot, so the same interest in samsung counts 0.2 in the homepage deals module and 1 in the phones list. Then the slot's rules take the top N: gates first, so only eligible pieces compete; pinned pieces next, never ranked; then the ranking, with a diversity cap under which a third piece of one brand yields its place to the next ranked piece. A pin is a required prefix: if the pinned piece is not eligible for the request, the whole slot serves nothing, so a pin needs care. Only slots are decided: the buy box is not a slot, and the engine is never asked about it. The same arithmetic orders a page's modules when they are the pieces of one slot, and reorders a product list that the commerce platform or a recommendations system supplies, removing nothing.

`score = Σ over the tags (d, v) of a[d][v] × w_slot[d]`

For each tag on the candidate: the visitor's interest in that value, times what this slot says that dimension is worth (0 to 1). Two values on one dimension both count; there is no per-tag weight, mean or normalization. A dimension the slot does not weigh contributes nothing; a value the visitor has no interest in contributes nothing.

**What you are looking at:** one slot scored in full, for the visitor from section 3. Choose the homepage deals module or the phones list. For deals, the controls set how it scores (as served, or the tag sum alone), the condition the page sends, the diversity cap, a pin and the slot's weights; the four containers show what it serves, and the table writes out every candidate's sum, term by term. **Try:** press a phone, lower the brand weight, set the cap to one per brand, or pin an upgrade offer under intent new. **Watch for:** a piece over the cap yielding its place to the next ranked piece, and an ineligible pin emptying the whole slot. The last button scores 10,000 synthetic candidates in your browser and counts the work; it times nothing.

## A stranger is scored on their region's lean until their own evidence outweighs it

A stranger's vector is empty, so every tag sum is zero and the slot would answer its catalog order. Instead of a second model for strangers, the engine blends a population prior into a copy of the visitor's vector before scoring, at a weight that falls as their own evidence grows. The population is the brand's own: its regional sales from its warehouse, and the regional interest its site's events build, which carries no visitor ids and has a memory of one day. In this example the sales are synthetic, made up for two example regions, Region A and Region B. The region is the visitor's real one, read from the request at the edge.

`λ = k / (k + Σa)`

How much the population speaks: 1 for a stranger, falling as the sum of all the visitor's own interests, on every dimension, grows. Here k is `kBlend`, 1 by default: Σa = 1 gives λ = 0.5, and Σa = 3 gives 0.25. A learn document without a `regional` block turns the prior off.

`ã = (1 − λ) · a + λ · share`

The visitor's blended interest in a value: their own, plus the region's share of that value, mixed by λ. The stored vector is never written to; the blend is a copy made for this decision.

`share = R_value / R_leader`

Within each dimension the region's leading value is 1 and the others are fractions of it: shares, not probabilities. Only the dimensions the brand names blend (here brand, ecosystem, price band and category); a dimension left out takes nothing from the region and keeps (1 − λ) of the visitor's own.

`region → country → everyone, at 30 events or more`

The finest level with enough evidence answers, so a region the brand has barely seen still opens on a real prior rather than a blank.

Seeds act on the arrival itself, before the visitor has shown any interest. The **campaign seed** reads `utm_term` from the landing link, which the page resends with every request, and adds 0.2 on the campaign tag, which only the launch offer and the launch hero carry: through the deals slot's campaign weight of 0.3 that is +0.06, and through the launch offer's promotion multiplier of 1.1 it lands on the receipt as +0.066. The **OS-family seed** reads only iOS or Android from the request and adds 1 on that ecosystem tag (× 0.15 = +0.15), halved while the visitor holds an interest in switching and withdrawn once they hold the other ecosystem. A laptop sends neither, so on a laptop no platform seed fires. Public census figures can explain a region's lean on screen, and they never enter a score.

**What you are looking at:** the prior at work on the same visitor. The controls set their region (its synthetic sales), whether they arrived from the campaign link, their device, the prior's strength, and their evidence, live from section 3 or set by hand. The chart shows how much the region speaks, λ, against the visitor's evidence, and a panel shows the region's shares; under them come the blended vector value by value, the seeds this arrival fires, a stranger's receipt for the launch offer, and the hinge: the launch offer and the Galaxy S26 offer across the visitor's steps. **Try:** switch Region A to Region B, turn the campaign link off, or set the evidence by hand. **Watch for:** λ falling from 1 as the evidence grows, the region's part of each blended value shrinking with it, and the line where the best Android offer overtakes the launch offer.

## Each dimension forgets at the speed the brand sets

τ is set per dimension, so one visitor carries memories of different lengths at once. The engine's default is 14 days on every dimension, and a brand may set any dimension's memory up to 90 days: a fleeting claim, such as a brand the visitor is comparing, on a short memory, and a lasting lean, such as the ecosystem their phones run on, on a long one. Stop pressing and the short claim withdraws while the long lean holds. When a brand claim is released, that brand's offers lose their brand term and keep their ecosystem term, so the release does not by itself reorder a slot where the ecosystem still carries them.

**What you are looking at:** one visitor with two memories on one clock: brand on a short memory a brand might set, and ecosystem on the engine's 14-day default. The two buttons view a Galaxy or a Pixel, each touching its brand and ecosystem android together; the chart shows the three interests over time with the two audience lines, and the meters show each claim and when it leaves. **Try:** press the Galaxy three times close together, then stop and let the clock run. **Watch for:** brand samsung falling under 0.45 and leaving while ecosystem android holds.

## One visitor, every term at every step

One example visit, from arrival to a return days later: a stranger lands from a paid social ad for the iPhone 18 Pro, looks at a Galaxy S26 card, opens its page, looks at the S26 Ultra, opens a Pixel 11 and goes home, then returns directly on a later visit. Each step recomputes the whole chain on the published documents: touches, fading, the visitor's vector, λ, the blended vector, the seeds, the multiplier, the sum and the take.

**What you are looking at:** the example visit, recomputed step by step. The step buttons choose the moment; the controls set the region, the arrival, the device and the days before the return. The first panel shows what the engine computes at that step; the second shows the receipt's drivers for container 1, the piece that leads. **Try:** step from 0 to 5, then slide the days before the return. **Watch for:** the launch offer leading at the landing and the Galaxy S26 offer leading at the hinge, and on the return, brand samsung released while ecosystem android still holds.

## Learning is a counted multiplier behind a dial that starts at zero

The second term is a count, not a model. For each piece in each context the engine keeps faded exposures n and successes s on the same lazy fading as the vector, with a 21-day memory. It pulls the piece's rate toward the slot's rate in that context, turns the ratio into a clamped multiplier, and raises it to the learning dial γ, from 0 to 1 per slot. It records what works from the first day and changes nothing until the brand turns the dial. Every slot's dial starts at 0: the lift is computed and recorded on the receipt and changes nothing, and until a context has a lift in force the receipt reads `lift: null`. A holdout keeps a stable share of visitors on the site's own defaults, so the lift is measured on the brand's own numbers. Exploration, which deliberately shows a less-tried piece, stays off unless the brand turns it on.

`p̂ = (s + n0 · p0) / (n + n0)`

The piece's rate in this context, pulled toward the slot's rate p0 with the strength of n0 = 30 observations, so a handful of lucky clicks cannot move it far.

`p0 = (s_slot + n0 · p0_parent) / (n_slot + n0)`

The slot's own rate in the context, pulled toward the next coarser context's rate the same way.

`lift = clamp(p̂ / p0, 0.5, 2)`

How this piece does against the slot in the same context, never more than double and never less than half.

`score = base × lift^γ`

At γ = 0 any lift to the power 0 is 1, so the learned term is computed, recorded and ignored. At γ = 1 it applies in full.

`everyone → channel → + visit → + journey stage → + region → + leading interest`

Six pooling levels from coarse to fine: the channel (direct, paid social, paid search, email, organic, referral), the visit band (first, second or third, fourth or later), the journey stage (early, mid, late), the region, and the visitor's leading interest above the entry line. The finest level where the piece has at least 30 exposures answers, so thin contexts borrow from wider ones instead of waiting.

**What you are looking at:** one piece in one context, with every input yours to set: its exposures and clicks, the slot's rate, the shrinkage strength, the learning dial γ and the score it multiplies. The readout gives the pooled rate, the lift, and the score before and after the dial; the chart shows the pooled rate moving toward the piece's own rate as exposures grow; the pooling levels show which of six contexts has enough exposures to answer. **Try:** give the piece many clicks on few exposures, then on many; then turn γ up from 0. **Watch for:** the lift staying between 0.5 and 2, and the score not moving at all while γ is 0, which is how every slot starts.

## Three published documents decide everything above

Every term on the receipt is arithmetic over the brand's published documents. The engine calls no AI model to decide. Opal is where people ask and generative AI creates, and that is where credits apply. Three documents decide everything above: the dimension registry, the slots document and the learn document, while the catalog holds the pieces and their tags. The brand's team changes them in the console or through the API. Every save is validated whole, stamped with a revision, attributed and kept, and a rollback writes an old body forward as a new revision, so the history is never rewritten. A change is in force without a release: at once where it is written, and everywhere within the documents' 30-second cache.

**What you are looking at:** the example brand's three documents, each line of JSON beside a note in words: the dimension registry, the slots document and the learn document. The first is shown expanded; the other two expand with a click. **Try:** find K and the two audience lines in the registry, the deals slot's weights in the slots document, and `kBlend` and `gamma` in the learn document. **Watch for:** every constant the instruments above take from these documents appearing here as one line, which its hint names by document and field; the phones list's dials, sent with each request, and the catalog's tags and rules, shown in section 4, are the exceptions. Nothing here is set per product.

## Every decision writes its own arithmetic down

Every served position writes one record, and every term it lists carries its contribution: the four strongest tag terms, the region's part and every adjustment, so a receipt like the one below can be recomputed by hand. The site's own answer carries the shorter drivers; the receipt adds the scores, the revisions of every document in force and what is needed to replay the decision. Below is an example record: the launch offer, served in container 1 to a stranger in Region A who arrived from the campaign link, with the visitor id and the nonce left out.

**What you are looking at:** the example record, with a note in words beside every field. Under it, the same decision is recomputed twice, from the record's own terms and from the documents on this page, and the record's ten candidates are set beside the page's. **Try:** follow the drivers, `score_base` and `score_final` down the record, then check them against the two recomputations. **Watch for:** how many candidates agree to the third decimal, in the same order; the count is computed, not typed.

## A customer provides attributes, a mapping, events and regional sales

**Per product: attributes.** **Per slot: weights and rules.** Nothing else is configured.

Per slot: the weights, the take, the journey-stage rule, the seeds, the merchandising weights, the diversity cap, pins, exclusions and the learning dials. Per piece of content: its tags, window, eligibility rule, merchandising signals and journey-stage fit.

**What you are looking at:** what a customer provides, each with what we use it for. The second carries two tables: one line per dimension, naming the feed field it reads and how, and a promotion feed's fields with what the engine does with each. **Try:** hold each line against your customer's product feed: which field would fill it, spelled the registry's way. **Watch for:** the last column of the second table; several fields decide eligibility or are only displayed, and are never scored.

1. **What we need: attributes in the registry's vocabulary.** Each product, offer and module carries values on the registered dimensions, exactly as the registry spells them: `brand: samsung`, not `Samsung Electronics`. On a dimension the brand's catalog names values on, a value outside them is simply not scored. The event's answer names the product ids the engine does not know; it does not flag an unknown attribute value. A content piece needs `id`, `customerContentId`, `type`, `title`, `tags` (dimension to a list of values) and `slotTypes`; a window, an eligibility rule (1 to 64 regions, 1 to 8 conditions), merchandising signals from 0 to 1, a journey-stage fit, featured products and a stock flag are optional. The offer book (terms, badges, calls to action) goes to the page, never to the engine. **What we use them for:** every attribute is a tag. A candidate's score is the visitor's interest in each of its tag values times the slot's weight for that dimension (section 4), so a piece is scored the moment it carries tags, with nothing set per product.
2. **What we need: the feed-to-dimension mapping.** One line per dimension: which field of the feed it reads and how; then a promotion feed's fields and what the engine does with each. Most are a field read as it stands; the price band is derived from the price with the registry's cuts; several fields are display only or eligibility, never scored. **What we use it for:** to turn each product's fields into the registry's values, so that an event and a candidate's tags name the same value the same way, and to keep the fields that decide (scored, or eligibility) apart from those the page only displays.
3. **What we need: events that carry the product id and its attributes.** A view, a compare, a selector, a cart add: each names the product (`productId`, `product_id` or `sku`) and carries the attributes the registry reads, so the engine never needs a copy of the catalog. **What we use them for:** each event becomes touches on the visitor's vector, weighted by its action (sections 2 and 3); the product id lets the engine use the attributes it holds for that product, and its answer names any id it does not know.
4. **What we need: regional sales from the brand's warehouse.** What the brand's customers in each region have bought, on the dimensions the prior blends. **What we use them for:** each region's starting lean, so a stranger's first page is local from the first day (section 5), labeled with its source.

## Everything on this page is an example, computed in your browser

- The arithmetic is the engine's own, step for step, on the engine's default constants and the example brand's published documents.
- The example brand, Wrenfield, its two regions and their regional sales are made up for this page; the phones are real products.
- The inputs you set on this page (exposures, clicks, weights, days) are yours, not measurements.
- The page holds no credential, stores nothing and sends nothing; every number is computed in your browser, and the page counts work and times nothing.

The companion piece, [How it works and where it runs](https://edge-platform-bti.expedge.workers.dev/how-it-works), tells the same mechanism in prose, with the architecture on Cloudflare, configuration, integration and privacy.

> **The engine keeps each visitor's interest per dimension value, scores every candidate in a slot with one published formula, and writes the arithmetic of each decision on a receipt a person can recompute.**
