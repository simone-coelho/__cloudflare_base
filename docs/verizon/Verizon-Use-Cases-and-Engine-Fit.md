# Verizon: what a carrier's digital shop is trying to do, and whether the engine does it

Internal. 2026-09-30, lane L3 of the Vantage build. It follows the shape of `docs/qvc/QVC-Use-Cases-and-Engine-Fit.md`: their words first, then each ask checked against the code.

**Their words.** Verizon has not briefed us on this demo. So "their words" are the public shop, read the way a buyer meets it. The sources are:

- the buying-journey brief (session scratchpad `research-telco-buying.md`: verizon.com seen anonymously on 2026-09-30, 40 sources). Its parts (a), (b) and (d) are used here and marked as such.
- the data brief (`research-telco-data.md`, the same day).
- the verizon.com pages captured that day. The lead's captures are `vz-*.txt` in the same scratchpad; lane L3's grid and phone-page reads are under `scratchpad/l3/vz/`.

**The code.** Every "what the engine does" answer was checked at HEAD `2c74ab9` with `git show HEAD:<file>`, not against the working tree. Lanes L1 and L4 have uncommitted changes in `src/content/*.ts`, `src/routes/*.ts` and `src/index.ts`, and none of them is counted here. Where the demo depends on one of those changes, the row says so.

---

## 1 · What a carrier's digital shop is trying to accomplish

In one sentence: **work out who the visitor is (new, add a line, upgrade or bring your own), lead with the one eligible offer that fits her, lock the phone's configuration, and lift the plan without losing the offer's eligibility. Then attach protection, accessories, more lines and home internet, while price, financing and credit stay in the carrier's own systems.**

### The steps, and the job at each one (a)

| # | Step on verizon.com | The job, in the brief's words (a) | Beat |
|---|---|---|---|
| 1 | Homepage for a stranger | "choose a path: switch, BYOD or buy" | 1, 2 |
| 2 | Intent gate (new or existing; ZIP) | "classify the visitor as NSE (new), AAL (add a line), EUP (upgrade) or BYOD. Every price depends on it." | 10 |
| 3 | Phone grid (136 phones) | "pick a phone, anchored on the monthly price and the biggest badge" | 3 (the `/sort` rail) |
| 4 | Phone page | "lock the configuration and promo, and nudge storage up" | 6, 7 |
| 5 | Trade-in | "capture the trade that unlocks the offer and anchors 36 months" | 6, 10 |
| 6 | Plan | "move up a tier without losing eligibility" | 8, 10 |
| 7 | Perks | "raise account value" | 8 |
| 8 | Protection | "attach protection" | 10 |
| 9 | Accessories and connected devices | "a bigger basket and more lines" | 9 |
| 10 | Cart closers (gift cards, save-the-sale, payoff by chat) | not a page job: offer mechanics | not shown (§3) |
| 11 | Checkout (soft credit check, porting, AutoPay) | not a page job: credit and billing | off limits (§3) |

### What Verizon already decides per visitor (b)

The brief splits Verizon's offer book from its per-visitor decisions. **Site-wide rules** are the amounts, eligibility, dates, plan and perk prices, AutoPay rules, trade-in values and fees. **Per-visitor decisions** are:

- which intent's price to show
- which eligible offer leads
- the default storage and plan
- the persona bundle
- protection and accessory nudges
- the home bundle, when the address qualifies
- which switch incentive to offer
- when a cart closer fires, and how much it offers
- the prepaid downsell
- local offers and pickup stock

The brief also reads Verizon's public payload. It finds personalisation switches for signed-in and prospect grids, Pega and Adobe segments, Evolv and 15gifts. Its conclusion: "A demo must show coherence across screens, not badge swaps." The lead ruled from the same brief that we never say Verizon does not personalise today (design §12).

### Eight things shoppers find annoying (d)

The brief names eight, each with a demo fix. This table adds what the engine can honestly carry.

| # | What annoys shoppers (d) | The brief's demo fix (d) | What the engine does | Beat |
|---|---|---|---|---|
| 1 | Upgraders get less than new lines | Show a signed-in upgrader their best eligible offer, and why | Ranks only the offers eligible for the asserted intent. Offers labelled for another intent fail closed. The receipt explains the choice. The amounts come from their offer book | 10 |
| 2 | Prices and locks keep moving | A 36-month total that includes fees and perks | Not the engine: that is a price calculation. The page paints it from content, and the engine decides only which module carries it | 7 (storage maths as content) |
| 3 | Trade-in surprises | An estimate that re-prices as the plan changes | Not the engine: that is their trade-in API. The engine decides whether the trade-in module leads | 6 |
| 4 | Credit handcuffs | A panel beside every badge saying what ends the credit | Content. Each promotion carries its stop clause in the catalog (L1's `catalog.json`, "what ends the credit"), and the receipt names the piece | 10 |
| 5 | Stacked conditions | A price that updates as each condition is ticked | Pricing is not the engine. What it does do: the asserted intent removes the offers the visitor cannot get | 10 |
| 6 | Offers disagree between pages | One offer decision on every surface | One visitor vector, one versioned catalog, and dedupe within a page. The phone page explains the offer the homepage led with | 6 |
| 7 | Pushed to chat or a store | Finish in the flow, or hand off with the cart intact | Not the engine | — |
| 8 | Upgrade add-ons keep billing | Show the break-even point up front | Content, not a decision | — |

The demo builds its case on rows 1, 4, 5 and 6: decisions the engine makes, with a receipt. Rows 2, 3, 7 and 8 are real problems that belong to pricing, trade-in and service systems. We say so, and nobody on stage suggests we solve them.

---

## 2 · Fit, requirement by requirement

The verdicts:

- **Fits:** configuration of what exists at HEAD.
- **Fits, demo change:** needs a bounded change made for this demo, named in the row.
- **Not the engine:** said out loud on stage.

| Requirement | What the engine does at HEAD | Verdict | Beat |
|---|---|---|---|
| Four containers filled from a pool of offers | One slot, `take` 1..50 (`src/content/kinds.ts:300`). A piece scores Σ over its tags of affinity × the slot's weight for that dimension (`src/reflex/contentCompose.ts:5-8`). No piece appears twice on a page (`contentCompose.ts:11-13`, `:252`) | Fits | 1, 3, 4 |
| Offers that live weeks, days or hours | `lifecycle.status` and `window.from/to` exclude a piece before scoring (`src/content/lifecycle.ts:29-35`, `:71-73`; called at `src/content/decide.ts:171`) | Fits | 11 |
| A new offer with no history (the Black Friday switcher offer) | Scored on its tags from the first request. The tag sum needs no outcome history (`contentCompose.ts:5-8`). Learned lift runs in shadow at γ = 0 | Fits | 12 |
| Merchandiser pins | `pinnedPieceId`, or `pinnedPieceIds` as an ordered prefix with ranking filling the rest (`kinds.ts:308-314`, `src/content/types.ts:82-83`) | Fits | 13 |
| Brand balance in the four | `diversity: { dimension, max }`, applied at the take (`kinds.ts:390-395`, `decide.ts:160-161`) | Fits | 3, 4 |
| A promotion weight for the launch | The `season`, `promotion` and `margin` terms, itemised on the receipt (`src/reflex/merchandising.ts:33`, `decide.ts:190-192`, `:497`) | Fits | 1, 4 |
| Answer the ad the visitor came from | W16 seed rules on the slot: `entry_channel`, `campaign_term`, `referrer_network` (`kinds.ts:243`, `:266`). `campaign_term` matches the `utm_term` the SDK captures on landing (`src/sdk/identity.ts:72-87`, `decide.ts:218-255`), and seeds never fire on the default arm (`decide.ts:223-226`) | Fits | 1 |
| Behaviour outgrows the campaign (the hinge) | Arithmetic. The seed is a per-arrival contribution, while her own touches accumulate `a = R/(R+K)` with K = 1.8, entering at 0.60 and leaving at 0.45 (`src/reflex/core.ts:260-262`) | Fits. The seed weight is tuned by measurement (L4) | 4 |
| The region's lean on the first paint | A regional prior, off unless the learn document enables it (`src/content/service.ts:430`). It is blended by λ into a copy of her vector for the edge region (`service.ts:431-441`, `src/reflex/regionTrend.ts:194-227`) | Fits for the edge region. **Demo change:** the second rehearsed region needs L4's demo-profile override, because an asserted region only gates and moves no affinity (`service.ts:474-493`) | 1, 2 |
| Census income as context | Not scored anywhere at HEAD. The demo shows it on the cold-start panel only (design §5) | By design: shown, not scored | 1, 2 |
| Home internet only where the address qualifies | `eligibleWhen: { regions, context }` on the piece, failing closed. A region key matches exactly, or by country (`lifecycle.ts:37-63`, `kinds.ts:125-157`). The caller asserts conditions as `ctx.<name>` on the snapshot (`src/routes/decisions.ts:567-575`) | Fits at region grain. An address check becomes an asserted `ctx` condition | 1, 14 |
| Intent: new, add a line, upgrade, bring your own | Two paths. Behaviour moves the `intent` dimension. The toggle asserts `ctx.intent`, which gates intent-labelled offers (failing closed) and never touches a price (`decisions.ts:567-575`, `lifecycle.ts:55-61`) | Fits | 9, 10 |
| The phone-page module order | The modules are pieces in one slot, `take` 6. With no signal, the order is the catalog's own (`contentCompose.ts:149-150`), and that is the template baseline | Fits | 6–10 |
| Nudge storage up | `priceBand` is derived from `price_usd` on every event, so a storage step that crosses a cut moves the band. The storage module rises on compare | Fits (registry configuration, L1) | 7 |
| The buy box is off limits | `offLimits: true` is "Hard handoff to the site's own default on every arm; pin/settings stay dormant" (`types.ts:84-85`, validated at `kinds.ts:318`). Off-limits slots are dropped before any decision (`service.ts:425`) and refused to pins (`contentCompose.ts:209`) | Fits | 6 |
| The phone grid per visitor | `POST /sort` re-ranks a candidate list the page supplies, at most 500 (`src/routes/sort.ts:38`, `:45`). At zero affinity it keeps the site's order | Fits | 3 |
| Explain every choice | The ledger record carries drivers, score, regional share, lift, the seed (`contextual`), merchandising, stage, freshness, fatigue and diversity (`decide.ts:484-505`). Operators read it (`decisions.ts:389`); the page reads one through L1's credential-free receipt action (design §4) | Fits. The receipt action is L1's | all |
| Merchandiser beats as real publishes | Versioned documents with history and rollback (`src/routes/content.ts:393`). A demo route with a closed beat list and a 60-second operator token, on the demo profile only (`src/routes/topOffers.ts:46`, `:55`, `:86`), which L1 forks as `vantage.ts` | Fits | 11–15 |
| Clicks per promotion and per module | The day report (`decisions.ts:1147-1223`) | Fits for attribution. Lift is theirs, measured against their holdout | 15 |
| A holdout assigned by account | Hash-sticky arms with a salt. The code itself warns that sequential ids would give a block sample (`src/content/holdout.ts:25`, `:71-72`) | Fits. The holdout is 0 on stage and shown as a setting (design §4) | 15 |
| The page changes on its own as interest fades | The closed-form alarm exists only on the object host (`REFLEX_HOST=do`). L4's spike decides whether beat 5 exists | Spike | 5 |
| Cart closers, idle timers, save-the-sale amounts | No trigger on idleness and no amounts | Not the engine | — |
| Price, discount, financing, credit, trade-in value | Never decided. They are catalog content, and the buy box is an off-limits slot | Not the engine, on purpose | 6, 10 |

Net: every per-visitor decision in (b) that is about *which content leads* fits today. It fits as configuration of shipped code, plus one bounded demo change (L4's region override) and L1's receipt action. The decisions about *amounts and timing*, meaning price, credit, trade-in value and cart closers, are deliberately not the engine's. Saying so is part of the pitch.

---

## 3 · Where the engine does it differently, said plainly

- **Weights are configuration, and the shipped ones are a retailer's.** The default registry weighs `product_view` 1, `add_to_cart` 3 and `purchase` 5, and has no `page_view`, `select` or `compare` weight (`core.ts:221-246`; an unlisted action weighs 0 at `core.ts:574`). L2's event contract needs `page_view: 1`, `select: 2` and `compare: 2` (`docs/verizon/lanes/L2.md`). L1 publishes those on the reflex document.
- **The default price bands are not a phone's.** The shipped `priceBand` cuts are 150 and 400, labelled entry, core and elevated (`core.ts:214`). Phones need cuts of 400 and 900, labelled entry, core and premium, on full retail (the data brief; `phones.json`). That is configuration too.
- **The memory horizon is fourteen days** (`core.ts:259`). The unprompted-exit beat needs a demo horizon on its dimensions, published as configuration.
- **Region is learned from the edge; an asserted region only gates.** The override that lets one laptop show two regions exists on the demo profile only, and the receipt names it as asserted (L4).
- **Asserted intent gates.** It never moves affinity or a price. At HEAD the ledger does not record the asserted context: `inputs` carries affinity, replay, regional share, external scores and served counts (`decide.ts:447-465`). So the page labels an asserted intent itself. Recording the asserted `ctx` on the record is a small addition, of the same kind as the region override L4 is asked to name on the receipt.
- **"Ends tonight" is new creative on the same content id**, not an urgency term: `promo-iphone-18-pro-launch-final.jpg` carries the same promotion, with the badge painted by the page. The id keeps everything it has learned.
- **Coherence across screens comes from one vector and one catalog, not a stored "offer of record".** When the phone page cites the homepage's promotion, the page is reading the homepage decision.
- **There is no evidence gate**, by the lead's ruling: a stranger is served from the first paint on population-level priors.
- **Measurement is attribution, not incrementality.** Conversion, revenue per account and churn are theirs to read against a holdout (design §9, beat 15).

---

## 4 · Not to say

- "Under 200 milliseconds." Say tens of milliseconds for a known shopper, and about 235 at the median for a stranger.
- A lift or revenue number of ours, or a bandit that "declares a winner".
- "Verizon does not personalise today." The brief shows it does (Pega, Adobe segments, Evolv, 15gifts).
- Anything implying we vary price, discount, financing, credit or eligibility by where someone lives or what a neighbourhood earns.
- "No limit" on offers, or any other customer's name.

---

## 5 · Questions to put to Verizon

1. Where the intent classification (NSE, AAL, EUP, BYOD) lives today, and whether it can be passed as a context signal on each request.
2. Which system holds the offer book: amounts, eligibility, dates, stop clauses. Our pieces would reference its offer ids.
3. Whether the home-internet serviceability check can assert a condition per request (`ctx.homeEligible`), rather than relying on region grain.
4. Which surfaces are already decided by Pega or Adobe, so the first module we take is one nobody else owns.
5. What counts as engagement for a four-container deals module, and whether a holdout can be assigned per account so that one account's lines never split.
