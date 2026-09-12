# QVC "Top Offers": what to build so the demo hits the spot

Internal. 2026-09-11. The build plan behind the fit analysis in `QVC-Use-Cases-and-Engine-Fit.md`.
Target: the regroup next week. Everything here was checked against the code; sizes are engineer-days.

---

## 1 · The principle

The demo is the engine. The four containers must be filled by the content decision service the
customers get, not by a page-side rule or the Bright Hour's own composer. Every press on stage produces
a receipt a QVC engineer could read, and the same slot, catalog and dials would run on their site. That
is the difference between this and what they have, and it is the thing that did not land on the call.

What we already have, and reuse:

| Asset | Where | Reused for |
|---|---|---|
| The content decision service: slots with `take`, pins, windows, stock, stage, freshness, fatigue, merchandising, diversity; receipts; the ledger; the lift table; the day report | `src/content/*`, `src/learn/*` | The module itself |
| The Bright Hour demo: a live-shopping retailer with offers on windows, a compressed clock, an Offer Desk, about a hundred generated images, a nine-dimension registry | `public/live/`, `src/demos/brighthour/` | The offers, the images, the vocabulary, the clock idea. Its composer is not used |
| The SDK: hydrate, declarative capture, slot subscribers | `src/sdk/` | The page |
| The operator console: slot dials, the lift grid, the day report, history and rollback | `public/console/` | The "you tune it" beat and the measurement beat |

---

## 2 · The demo page

A standalone page, `public/top-offers/`, built to look like their FPO visual and nothing else on our
site: "Our Best Promotions For You" over four cards, and "N Available Promotions" beneath showing the
whole pool with each card's window, badge and live state. One director bar along the bottom, in the
Meridian stage rules: nothing changes without a press, and each press is one beat.

| Beat | Press | What the engine does | What the audience sees |
|---|---|---|---|
| 1 | New visitor | Evidence gate not met: the default arm, QVC's four defined defaults | Four static cards; the receipt says "no evidence yet, the defined defaults" |
| 2 | Browse kitchen, three times | Three category page views move the affinity vector; the entry threshold is crossed | The vector filling on a side panel; the module still static until the gate clears |
| 3 | Browse electronics, then beauty | The fifth lifetime page clears the gate; the slot personalizes | Three kitchen offers and one electronics; the receipt names the affinity behind each card |
| 4 | Advance the clock two hours | An offer's window ends; the next decision drops it | The expired card greys out in the pool; the fifth-ranked offer takes its container. No test ended, nothing configured |
| 5 | A new offer arrives | A kitchen offer with no history is scored on its attributes at once; exploration gives it exposures | It appears for the kitchen shopper; the receipt says "scored on attributes, no outcomes yet" |
| 6 | Final Hours | The seed swaps the creative behind the same content id | The card's image and title change, the id and its learning do not; the pool shows the same offer with its new creative |
| 7 | Snow in Seattle | The context carries `weather: snow`, the region is Washington; a piece eligible only under that rule becomes eligible | A winter offer enters the four for this shopper and not for the one in Florida |
| 8 | The TSV | The promotion weight on the slot rises | The TSV piece rises for shoppers whose category matches, not for others |
| 9 | Return tomorrow | The long-horizon dimension remembers kitchen; the short one is empty | The module reflects yesterday; one click today moves it |
| 10 | Why these four | The receipt and the lift grid | Every card's drivers, level of evidence and lift, in words |
| 11 | What it learned | The day report for the slot | Clicks per offer per context, the attribution grid, said as attribution |

Beats 4, 6 and 7 are the ones their current tool cannot do, and beat 3 is the one that answers Kevin's
"how do we start".

---

## 3 · Engine work, in the order the beats need it

| # | Work | Beats | Size | Notes |
|---|---|---|---|---|
| E1 | The feed normalizer keeps `merchandising`, does not resurrect expired pieces on a merge, accepts the customer's stage words, dedupes tags (doc 35 F27) | 4, 6, 8 | 0.5 | Half a day; needed for any seed refresh |
| E2 | Pin reservation before ranking (F28) | 8 | 0.25 | Four lines; a pinned TSV must not duplicate |
| E3 | `eligibleWhen` on the piece: `{ regions?: string[]; context?: Record<string, string[]> }`, evaluated in `isEligibleAt` beside the window and the stock flag; `context` accepted on the snapshot request and carried on the decision's inputs | 7 | 1 | The targeting rule Garrett described. Region already comes from the edge |
| E4 | Contextual seeds: the same `context` values scored as a seeded touch on dimensions the registry declares (`weather`, `customerType`), the way entry channel is meant to be | 7, and customer type | 0.5 | Rides E3 |
| E5 | A clock override for demos: `at=` on the snapshot request, honoured only when AUTH_MODE is open, ignored on customer stamps | 4, 6 | 0.25 | Or seed windows relative to the reset time and wait; the override makes "advance two hours" one press |
| E6 | The evidence gate: slot rule `personalizeAfter: { pages: N }`, default arm until met, said on the receipt. Depends on the lifetime page count reaching the content contract (F13) | 1, 3 | 1.5 | F13's plumbing is a day on its own and is on the remediation list anyway |
| E7 | Two-horizon memory | 9 | 0.5 or M | First try configuration: register the category source twice, `category` with a horizon of weeks and `categoryNow` with minutes, and weight both on the slot. Verify one source can feed two dimensions; if not, the schema change is M and beat 9 shows the single horizon honestly |
| E8 | Exploration on by default for the tenant, and the priors fix (F20) so a new offer can be seeded from its category | 5 | 0.5 | Exploration is configuration; the priors fix is six lines |
| E9 | The console's stage form default and readback (F26) | 10 | 0.5 | Before anyone from QVC touches the console |
| E10 | Urgency term: `weight × f(time remaining)` on the slot, the mirror of freshness | 6 | 0.5 | Optional; beat 6 works without it as the CMS-swap pattern |

Total engine work for the demo: about 6 days, of which E1, E2, E8 and E9 are already on the doc 35
remediation list and would be done regardless. Not required for the demo, and not to be shown: Thompson
sampling, autonomy, multi-slot replay.

---

## 4 · Demo work

| # | Work | Size |
|---|---|---|
| D1 | The offer pool: 30 pieces converted from the Bright Hour catalog into content pieces for scope `brighthour`: id, title, image (`renderUrl` from `public/live/img`), tags `category`, `subcategory`, `brand`, `offerType` (the badges: bestSeller, limitedTime, clearance, featuredValue, justReduced, easyPay), `window.from/to` relative to the reset time (a few hours to a week), two TSVs with `merchandising.promotion`, one winter piece with `eligibleWhen: { regions: ['US-WA','US-OR'], context: { weather: ['snow'] } }`, four defaults pinned for the default arm | 1 |
| D2 | The registry for scope `brighthour`: the four dimensions plus `weather` and `customerType`, action weights for category page view, product view, click; the slot `top-offers` with `take: 4`, `personalizeAfter: { pages: 5 }`, the promotion weight, exploration on | 0.5 |
| D3 | The page: the FPO layout, four containers from the SDK's slot subscriber, the pool grid with live state and windows, a side panel showing the vector and the receipt in words, the director bar with the eleven beats, a Seattle and a Florida visitor | 2 |
| D4 | The seed and reset script: writes D1 and D2 against a base, resets windows relative to now, performs the Final Hours swap and the new-offer arrival on command | 0.5 |
| D5 | The headless rehearsal: every beat driven through `/__shot`, asserting the rendered four and the receipt text, so the walkthrough instructions are exact (the verified-instructions rule) | 1 |
| D6 | Coach and Tapestry appear nowhere on the page, in the seed, or in the receipts | 0 |

Total demo work: about 5 days. Two tracks in parallel, engine and demo, land it inside the week.

---

## 5 · What to say next week, and what not to

Say: we score each offer for this shopper and take the top four, there are no combinations to test;
a new offer is scored on day one from its metadata; windows are honoured on every decision; the same id
keeps its learning through a creative swap; weather and region are a rule on the piece; every card
carries a receipt; the report is attribution and we say so.

Do not say: under 200 milliseconds (say tens for a known shopper, under 300 for a stranger); the
profile re-seeds from the CDP (say thirty days at the edge and your identifier beyond); the engine
creates bandits and declares winners; anything about the first customer.

---

## 6 · Open before the build starts

1. Whether one registry source can feed two dimensions with different horizons (E7). Ten minutes to check.
2. The tenant for the demo page: `brighthour` as its own scope, with its own catalog and slots, so nothing
   touches the Coach demo or the customer stamps.
3. Who takes the engine items and who takes the page, given the two tracks and the doc 35 gate-one work
   also in flight.
