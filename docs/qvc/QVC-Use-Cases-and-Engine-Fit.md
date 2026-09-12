# QVC: what they are asking for, and whether the engine does it

Internal. 2026-09-11. From the reconnect call transcript (Jon Kee, Simone, Zach for Optimizely; Kevin
Gallagher, Dustin Frey, Garrett Holl, Jamie Simpson, Claire Potosky for QVC) and Jamie Simpson's written
answers to Jon's five questions. Read with the earlier package in this folder: the Demo Design Brief's
thesis (decisioning under expiry, not recommendations) is exactly what this call confirmed.

Every "does the engine do it" answer below was checked against the code at HEAD, not against what was
said on the call. Where the audit verified this week (docs/architecture/35) found a defect on the path, it
is named.

---

## 1 · What QVC is trying to accomplish

One sentence: **on the homepage, fill a four-container module with the four best offers for this
customer from a pool of about fifty, where every offer lives two to four days, expires on a CMS schedule,
carries category, subcategory and brand, and is judged on clicks into the module.**

That is the whole primary ask, in Jamie's words: containers fully interchangeable; select the four
strongest in the context of the customer's profile and behavior; optimize toward offer clicks and module
engagement with conversion and spend downstream; the CMS stays the source of truth for content and
publishing windows; metadata per offer is category, subcategory, brand.

Why it is hard for them today, in Dustin's and Garrett's words: their current tool cannot take metadata,
it brute-forces every combination of offers and picks a winner, and because an offer lives two to four
days it never accumulates a track record, so every offer starts cold and the test ends before it learns.
Kevin's version: fifty offers into four slots is a huge number of arrangements; can you learn the best
order for whom?

The secondary asks, all from the transcript:

| # | Ask | Who |
|---|---|---|
| 2 | The TSV (Today's Special Value), a price-code offer of the day, sometimes several across categories: reinforce it while it is live, or let the shopper drift | Kevin |
| 3 | Long-term versus in-the-moment: a loyal customer is "a beauty customer over time" but is in electronics right now; which wins, and what does the homepage show next session | Kevin, Dustin |
| 4 | Scale: a very large catalog; configure by category and attributes, never per product; who maintains it | Kevin, Dustin |
| 5 | Cold start for ephemeral content: a new offer with no history should start with context, not from zero; can you enrich our assets with metadata | Garrett |
| 6 | Category, collection and new-product pages, not only the homepage | Kevin |
| 7 | Merchandiser control: pinned content, event weekends (fashion, clearance) with bulk changes | Kevin |
| 8 | Static content until a customer has viewed five or more pages in their lifetime, then personalize | Jamie |
| 9 | Pass QVC's own customer identifier to stitch sessions | Dustin |
| 10 | Location as an attribute; weather as an external signal | Jon's summary |
| 11 | "Final Day" and "Final Hours" creative as the offer approaches expiry | Jon's summary |
| 12 | A lead metric of engagement and click-through, with conversion and add-to-cart per session as the value bridge | Garrett |

The one signal they have today: a `uattr` cookie holding category affinities, computed from the category
pages visited in the session. They want to expand it with us.

### 1a · Garrett's written use case (received 2026-09-11) and the visual

Garrett's note restates the module as their number one use case and adds, line by line:

| His line | What it changes |
|---|---|
| "Our CMS is the source of content. Content could be headless or headful. We would likely handle the rendering with our own components" | Confirms decisions by content id, rendered by them. Headful (the CMS returns markup) still works: we return ids, their component fetches the markup. The SDK is optional if their component calls the snapshot server-side |
| "Personalize between 20+ pieces of content" and "let's say there are 50 pieces on any given day" | A pool of 20 to 50 live pieces at once. Far inside every limit |
| "Based on category affinity, past purchases, customer type, products recently viewed, etc" | Four signal families. Category affinity and recently viewed products are the vector's native inputs. Past purchases are the historical-transactions ingest, which exists (weighted, timestamped rows) but resolves the wrong registry today (F11, F31). Customer type is a trait from their side: it needs a seeded attribute on identify or a registry dimension fed by their data, which is the contextual-seeds feature below, not a new idea |
| "Do you have options for location? What about weather forecast? It's snowing in the Pacific Northwest, we might want to display relevant content to those customers" | Location is in every decision's context today (region from the edge), used for learning and for the regional prior. Weather as he frames it is a targeting rule, not an affinity: show this content to these customers when this is true. A piece has eligibility by window, stock, slot type and journey stage, but no eligibility by region or by an external condition. That is the feature: `eligibleWhen: { regions, context }` on the piece, with the page or a scheduled job supplying the condition. S to M |
| "Content has varying start and end dates. Content should not be presented if it's not within the active window. A few hours to a few days, usually not longer than a week" | Exactly `window.from/to` and `isEligibleAt`. Hours-long windows raise one thing: the day report's batch attribution reaches back 48 hours and the online ring seven days, so a purchase after a two-hour offer is credited online but not in the batch report past two days (F17). For a click-judged module this does not matter |
| "Swap out creative towards the end of the promotion window with new creative, Final Hours or Final Day" | Keep the piece id and change the creative behind it (`renderUrl` or their markup), and the offer keeps everything it learned. A new id restarts learning for the last hours, which is the worst moment to restart. An urgency term can also lift it for shoppers already interested. Say: same id, new creative |

The visual, "Our Best Promotions For You" over four cards and "20 Available Promotions" beneath, shows
the pool's cards carrying promotion types as badges: Best Seller, Limited Time, Clearance, Featured
Value, Just Reduced, Easy Pay event. That is a fourth dimension beyond category, subcategory and brand,
and a valuable one: shoppers who respond to clearance and shoppers who respond to easy-pay are different
audiences, and the badge is free metadata. Add `offerType` to the registry from day one.

Every card is image, title and one call to action, and the four are the same shape as the twenty. The
module is one slot, `take: 4`, with the whole pool as candidates. Nothing about it needs a second slot.

---

## 2 · Fit, requirement by requirement

Verdicts: **fits** (configuration only), **fits with a fix** (the capability exists and doc 35 names a
defect on it), **needs a feature** (a bounded addition), **not this engine** (say so).

| Requirement | What the engine does today | Verdict |
|---|---|---|
| Four interchangeable containers filled from a pool | One slot with `take: 4` returns four distinct pieces, ranked. Page-level dedupe. The offer pool is a content catalog of pieces with tags | **Fits** |
| Offers live two to four days, CMS owns the windows | Every piece carries `lifecycle.status` and `window.from/to`; `isEligibleAt` excludes expired and not-yet-active pieces on the decision path. The feed import takes the windows from the CMS | **Fits with a fix**: the feed normalizer drops `merchandising` and resurrects expired pieces on a merge refresh (F27). One day |
| Metadata: category, subcategory, brand | These are dimensions in the registry; pieces carry them as tags; the shopper's affinity vector is per dimension value. This is the engine's native shape | **Fits** |
| Choose by the customer's profile and behavior | The decayed per-dimension affinity vector, entry and exit thresholds, action weights, all dials. A category page view is a `page_view` event with attributes, so their `uattr` signal becomes our vector directly | **Fits** |
| Optimize toward offer clicks | The slot's reward is `click`; learned lift per offer per context cell; attribution direct, last touch, thirty minutes | **Fits with fixes**: direct attribution ignores the slot (F21), and position is not in the learning cell, so in a four-container module rank 1 looks like the better offer (a 3.8x spread measured). Position stratification is the real gap. S then M |
| Conversion and spend downstream | Purchase reward with a seven-day window; revenue and margin objectives | **Fits**, with the objective and refund caveats of F19 |
| No brute force over combinations | The engine never arranges; it scores each offer for this shopper and takes the top four. Fifty offers is fifty scores, not fifty-choose-four orderings. This is the sentence that did not land on the call | **Fits** |
| Ephemeral content starts warm, not cold | Attribute scoring needs no history: a new offer tagged electronics/brand X is scored on day one from the shopper's affinity to those attributes. Learned lift pools upward through six levels, so a new offer inherits its category's context. Imported priors can seed it from similar past offers | **Fits with a fix**: priors below the root level are broken (F20), and exploration ships off so new content never earns exposures (doc 35 new item 25). Both S |
| Static content until five lifetime pages | Not a dial today. The default arm and the slot's default handoff exist; the SDK paints the page's own default on absence; the entry threshold K delays any audience until evidence accrues. A lifetime page count exists in session metadata but does not reach the content contract (F13) | **Needs a feature**: an evidence gate on the slot, `personalizeAfter: { pages: 5 }`, serving the default arm until met. S, after F13's plumbing |
| Long-term versus the moment | One decayed accumulator per dimension value with one horizon (`tauMs`) and one convincing point (`K`). Tune the horizon long and the moment is slow; tune it short and the beauty customer is forgotten by lunch | **Needs a feature**: a second accumulator per dimension with a long horizon, blended with the short one by a dial, so "beauty over time, electronics right now" is two numbers the merchandiser can weigh. M |
| Next session on the homepage | Shopper state persists thirty days on the session host; recognized shoppers stitch on sign-in; the entry channel and visit number are computed | **Fits with a fix**: visit number and channel do not reach the decision (F13); ODP re-seeds audience membership, not the vector, so the call's "we pull the previous history from ODP" is not what the code does (doc 35 new item 16). Say "thirty days at the edge, longer with your identifier" |
| The TSV | A piece with a `promotion` merchandising weight during its window, or a pin, or a `tsv` tag with a slot weight. Several TSVs across categories are several pieces; the shopper's category affinity picks the relevant one | **Fits with the F27 fix** (the feed must carry merchandising) |
| Pinned merchandiser content | `pinnedPieceId` per slot | **Fits with a fix**: a later pin can duplicate an earlier ranked choice and a pin bypasses slot-type eligibility (F28). Four lines |
| Event weekends, bulk changes | Versioned configuration with history and rollback; a CSV or JSON feed replaces the catalog | **Fits with a fix**: two operators publishing 28 seconds apart collide (F15). One day |
| Scale of the catalog | The offer pool is fifty to hundreds of pieces; that is far inside the store's limit (about 24,700 realistic pieces per scope, F32). Their product catalog never needs to be loaded for this use case: product views for products we do not hold still move affinity when the event carries attributes (`eventAttributes: event-when-unknown`) | **Fits**, and the message is "we hold your offers, not your catalog" |
| Category, collection and new-product pages | Slots are per page; `/sort` re-ranks a candidate list the page supplies, capped at 500, candidate-preserving | **Fits** |
| Their identifier | `identify()` with a backend-signed assertion | **Fits with a fix**: the assertion is optional until `IDENTITY_SECRETS` is provisioned (F04). Provision it |
| Location | The region is in every decision's context cell today | **Fits** |
| Weather, and "show this content to these customers when" | No eligibility by region or external condition on a piece, and no context input for a signal the page knows and the platform does not | **Needs a feature**, two halves: `eligibleWhen` on the piece (regions, conditions) for the targeting rule Garrett describes, and contextual seeds on the request (`context: { weather: 'snow' }`) for affinity. S to M |
| Customer type, past purchases | Historical transactions ingest exists (weighted, timestamped rows) but resolves the wrong registry (F11, F31); customer type has no input today | **Fits with a fix** for purchases; customer type rides the contextual-seeds feature as a seeded attribute on identify. S |
| Offer type as a signal (the badges in the visual) | Any tag is a dimension; nothing to build | **Fits**: add `offerType` to the registry |
| Final Day / Final Hours creative | The CMS can publish a second piece with the closing window, or swap the creative behind the same id. The engine has no urgency term | **Fits as the CMS pattern**; optionally a feature: an `urgency` term, weight times a function of time remaining, the mirror of freshness. S |
| Explain every choice | Every decision carries a receipt: drivers, the level of evidence, the lift; replay by decision id | **Fits with a fix** for replay on multi-slot pages (F22). For a single four-take slot the receipt is complete today |
| Engagement as lead metric, incrementality as the bridge | The day report per slot; a holdout arm | **Fits for attribution**, **not yet for incrementality**: the holdout comparison is not a valid test of business lift (F07). Say "we report attribution now; a proper control design is the measurement workstream" |
| AI enrichment of their content | Done as a services step for our first customer with computer vision; no product workflow exists (F11) | **Not the engine**: a services offer, honestly priced |
| Auto-created bandits, winners declared, TikTok trend to test | Not this engine. That path was the Signal-Led Moment demo on Optimizely Experimentation. The content engine's Thompson mode ignores its budget (F23) and autonomy applies stale proposals (F24); both should be withdrawn from the surface until repaired | **Not this engine today**. Do not repeat the claim |

Net: the primary use case is the engine's home ground. Of the twenty-two rows, sixteen fit or fit with a
fix already on the doc 35 list, four need bounded features (the evidence gate, two-horizon memory,
eligibility rules with contextual seeds, urgency), two are honest no's (enrichment is services, bandit
automation is not this product).

---

## 3 · The features this customer would justify

All four are additive terms or dials in the shape the engine already has. None is a model.

1. **Evidence gate.** A per-slot rule `personalizeAfter: { pages: N, events: M }`. Until the shopper's
   lifetime count clears it, the slot serves the default arm and the receipt says why. Depends on the
   visit and page counters reaching the content contract (F13, one day). S.
2. **Two-horizon memory.** A second decayed accumulator per dimension value with its own `tauMs`
   (weeks), beside the existing one (minutes to hours), and a slot dial `memory: { long: 0.3, moment: 0.7 }`
   for the blend. The receipt shows both numbers. Answers Kevin's push and pull with two dials a
   merchandiser can read. M, because the reflex state schema changes and the object host must carry it.
3. **Eligibility rules and contextual seeds.** Two halves of one feature. `eligibleWhen` on the piece:
   regions and named conditions under which it may be served at all, evaluated beside the window and the
   stock flag, for "snowing in the Pacific Northwest, show this". And attributes the page or their backend
   passes on the request or on identify (weather, device, campaign, customer type), scored as a seeded
   touch the way entry channel is meant to be, so they shape affinity rather than only gate it. S to M.
4. **Urgency.** A term on the piece, `weight × f(time remaining in window)`, the mirror of freshness,
   so an offer in its last hours can rise for shoppers who have shown interest. S. Or leave it to the
   CMS swap, which Jon already offered.

And the doc 35 fixes this use case stands on, in the order they bite: F27 (feed drops merchandising,
resurrects expired), F21 plus position in the cell (four-slot module learning), F20 (priors), exploration
on by default for new content, F28 (pins), F13 (visit and channel), F15 (concurrent publish), F04
(identity secrets provisioned).

---

## 4 · What was said on the call that the product does not do today

For the next call, and for the follow-up material. These are not accusations; they are the places
where the description ran ahead of the code, and the audit this week measured each.

- "Less than 200 milliseconds." A first-time shopper's decision is 235 ms inside the worker at the
  median; a returning shopper's is about 12 ms. Say "tens of milliseconds for a shopper we know, under
  300 for one we have never seen" until the path is fixed.
- "We keep 7 days locally, then pull the previous history from ODP and merge it." Shopper state lives
  thirty days at the edge; ODP restores audience labels, not the interest vector. Say "thirty days at
  the edge, and your identifier stitches sessions beyond that".
- "The engine auto-creates a CMAB or multi-armed bandit, learns, declares the winner and rolls it out";
  "a TikTok trend sends a signal and creates the offers and the test." That was the Signal-Led Moment
  demo on Optimizely Experimentation, not this engine. The content engine's exploration is rotation and
  epsilon; its Thompson mode and its autonomy are defective and should not be shown.
- "No limit" on offers. True at fifty and at hundreds; the store's real limit is about 24,700
  realistic pieces per scope, which the offer pool never approaches. Their product catalog is not loaded
  at all for this use case.
- "Every decision can be replayed." True for a single slot; a multi-slot page replays wrongly today
  (F22). The four-container module is one slot, so this one is safe to show.
- The first customer and its brand were named on the call, twice. Do not name them again to QVC.

---

## 5 · The walkthrough Garrett asked for

Garrett's written use case (§1a) is the four-container homepage module, "Our Best Promotions For You",
over a pool of twenty to fifty. The walkthrough should be in their vocabulary and their shape, not ours:

1. **Their module, their pool.** A page with one module of four containers and a pool of fifty offers
   from a feed: id, title, image, category, subcategory, brand, live-from, live-to. Two are TSVs with a
   promotion flag. Nothing else on the page personalizes.
2. **The static start.** A brand-new visitor sees QVC's four defined defaults. The receipt says
   "no evidence yet, the default set" (the evidence gate, if built; else the entry threshold).
3. **Five category pages.** Kitchen, kitchen, electronics, kitchen, beauty. Show the vector filling
   and decaying, with the entry threshold, in the console's words. Then the module: three kitchen offers
   and one electronics, ranked, and the receipt naming the affinity that put each there.
4. **An offer expires at noon.** The clock passes its window; the next request drops it and the fifth
   offer takes its place. No test ended, no winner declared, nothing configured.
5. **A new offer arrives with no history.** Tagged kitchen, brand X. It appears for the kitchen
   shopper at once, scored on its attributes; the receipt says "scored on attributes, no outcomes yet".
   With exploration on, it earns exposures; the lift table shows it learning against its category.
6. **Return tomorrow on the homepage.** The same visitor lands cold on the homepage; the module
   reflects yesterday (long horizon) with today's first click able to move it (short horizon). If the
   two-horizon dial is built, show both numbers; if not, show the single horizon honestly and say the
   dial is coming.
7. **The TSV.** Flip the promotion weight and watch it rise for shoppers whose category matches, and
   not for the others.
8. **The lead metric.** The day report for the module: clicks per offer per context, the attribution
   grid, and the words "attribution, not incrementality" said out loud.

Do not show Thompson, autonomy, the multi-slot replay, or the console's stage form until doc 35's items
close.

---

## 6 · Crawl, walk, run, in Kevin's terms

**Crawl, the pilot.** One module, one page. QVC provides: the offer feed with the three metadata
fields and the windows; category page views as events (their `uattr` logic, sent to us); their
customer identifier for signed-in visitors; the four static defaults; the five-page rule as a number.
We provide: the slot, the registry (category, subcategory, brand, plus price band if they tag it),
the SDK on the page with the module rendered by their component from our four ids, receipts, the day
report. Learning in shadow, exploration on. This is a configuration exercise plus the fixes named above.

**Walk.** The TSV as a promotion weight; location; the two-horizon memory; the evidence gate; the
value-bridge rewards (add to cart, purchase); category and collection pages through `/sort`.

**Run.** Learned lift on for the module; a proper control design with their analytics team; weather
and campaign as contextual seeds; more modules.

---

## 7 · Questions to put to QVC before the next call

1. What "module engagement" counts: a click on any container, or a click on the offer through to its
   page, or both, and whether an impression must be viewable.
2. Whether the module renders client-side from ids (our default) or server-side (then the snapshot
   is a server call and the SDK is not involved).
3. The size of the live pool at any moment, and how many offers enter and leave per day.
4. Whether "Final Day" is a separate creative id in the CMS or the same offer with a flag.
5. The exact semantics of `uattr`: which pages, what weights, what decay, so the first registry
   reproduces what they trust today before improving on it.
6. Whether the five-page rule is per lifetime (needs their identifier or a durable cookie) or per session.
7. What their analytics team would accept as a control for the module, since the incumbent's
   brute-force test is what they are used to.
