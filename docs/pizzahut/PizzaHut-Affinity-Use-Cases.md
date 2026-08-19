# Pizza Hut — Affinity Engine Use Cases (The Creative Deck)

**Status:** INTERNAL · 2026-08-11 · Grounded in site recon of pizzahut.com (direct fetches bot-blocked; facts triangulated from Pizza Hut's own indexed pages, press releases, and trade coverage — third-party menu prices flagged for verification before any showing).

---

## 0a. The demo brand (DECIDED 2026-08-11): a fictional Italian pizzeria

The demo surface is **not a Pizza Hut clone**. It's our own fictional Italian-American pizzeria — working name **"Forno Amico"** (alternates: Trattoria Rossa, Casa di Pizza) — with an Italian-accented menu that keeps the story intact: **pepperoni stays front and center** (the habit centerpiece), alongside Margherita, Diavola (the heat axis), Quattro Formaggi (the cheese-lover analog), wings, pasta, cannoli/tiramisù, and a family box (the occasion-scale axis). Why this is stronger than a clone: zero trade-dress questions; reusable for every future restaurant prospect; and the narrative writes itself — *the neighborhood pizzeria is the place that knows your usual; we made the website behave like that place.* Food photography sources from Pizza Hut's public product imagery for the private demo (provenance internal), with AI-generated fillers labeled as such. In the room, we show the bridge to their world: hand the generator *their* catalog and the audiences mint themselves in *their* grammar — "Pepperoni Lover's Regulars."

Everything below about Pizza Hut's site, grammar, and merchandising remains the intelligence about **the customer we're speaking to** — it shapes the beats and the talk track, not the demo's chrome.

## 0. The brand we're speaking to

- **Naming grammar:** the possessive "Lover's" franchise (Meat Lover's, Pepperoni Lover's, Veggie Lover's, $7 Deal Lover's) and "Hut" as a prefix device (Hut Crust, Hut Rewards, My Hut Box, Hut Originals, "Back to the Hut"). Our catalog-generated audiences will read native on day one: **"Pepperoni Lover's Regulars"** is exactly what the generator mints from their own taxonomy.
- **Tone:** cheeky superlatives and stunts (a "Hut Crust Connoisseur" hired at a $31,415.92 salary; "Hot Crust" to the tune of Hot Stuff). 2026 platform: **"Feed Good Times"** (Tom Brady); prior line "No One OutPizzas the Hut."
- **Merch style:** price-anchored heroes with big numerals ("$10 Hut Crust Deal," "2 or more for $7 each," "$5 til 5PM"), day-of-week channel-locked deals (Wing Wednesday BOGO carryout-only, Personal Pan Tuesdays), nostalgia as a standing lever (Hut Originals, Throwback Value Menu, BOOK IT! alive and well).
- **Flow reality:** localization is the front door (delivery vs carryout + address unlocks local pricing/deals); Deals is first-class top nav; guest checkout exists; reorder/favorites/"Most Popular items" exist **only behind login**.
- **The white space:** no public evidence of any anonymous, first-session, on-site personalization. Their analytics team already feeds weather into recommendations upstream and has said "there are limitations when you use an off-the-shelf platform" — context signals will read as validation, not novelty.

## 1. The demo catalog schema (menu as taxonomy)

| Category | Examples | Attribute axes |
|---|---|---|
| Pizza — recipes | Pepperoni Lover's, Meat Lover's, Supreme, Veggie Lover's, Ultimate Cheese Lover's, Buffalo Chicken, Hawaiian | recipe · dietary lean (meat/veggie/cheese) · spice · size · crust |
| Pizza — build-your-own | 1-topping M/L | size (Personal Pan 6" / M 12" / L 14") · crust (Original Pan, Hand Tossed, Thin 'N Crispy, Stuffed +$, Tavern-style, GF) · toppings |
| Melts | Pepperoni Lover's Melt, Buffalo Chicken, Meat Lover's, Cheeseburger | flavor · dip · solo format |
| Crafted Flatzz | Pepperoni Duo, Nashville Hot Chicken, Chicken Bacon Ranch | flavor · spice · daypart-priced ("$5 til 5") |
| Wings | boneless 8/16/24/48 · bone-in 6–36 | flavor (9+: Honey BBQ → Burnin' Hot) · heat · count · dips |
| Pasta | Tuscani Meaty Marinara, Chicken Alfredo | sauce · protein · serves 1 vs family |
| Sides / Desserts / Drinks | Breadsticks, Cheese Sticks, Fries · brownie/cookie/cinnamon sticks · Pepsi 20oz/2L | shareable count · size |
| Bundles | Big Dinner Box $24.99 · Triple Treat Box · My Hut Box from $6.99 | occasion scale (solo → family) · upgrade slots |
| Deal constructs | $7 Deal Lover's (mix-and-match, 2+ items) · $10 Hut Crust Deal · Throwback Value Menu · day-of-week carryout deals | basket-builder mechanics · channel-locked · day-of-week |

Item schema for the demo catalog: `category / recipe-flavor / dietary-lean / spice / crust / size / serves / daypart-fit / deal-membership / channel-eligibility / price (representative)`.

## 2. The dimension registry (proposed 8)

| # | Dimension | Reads | Decay | Why |
|---|---|---|---|---|
| 1 | `category` | pizza/melts/flatzz/wings/pasta/dessert engagement | Medium | Broadest ranking signal; feeds rails + Wander deltas |
| 2 | `recipe_flavor` | named recipes + topping metadata (meat/veggie + spice derived as traits of the same vector) | **Slow** | **The habit detector** — "your usual" must survive weeks between orders |
| 3 | `crust` | builder crust picks, crust LP visits | **Slow** | Brand-validated loyalty axis (the Hut Crust campaign platform) |
| 4 | `occasion_scale` | solo ↔ family ↔ party: quantities, box views, pizza-calculator use, 2-liter/dessert adds | **Fast** | Tonight's occasion says nothing about Friday's — must reset fast |
| 5 | `daypart_pattern` | learned lunch/dinner/late-night session propensity (clock = context, pattern = dimension) | Slow | Lunch is their stated #1 growth gap |
| 6 | `fulfillment_mode` | delivery vs carryout/curbside choices, mode-locked deal clicks | Slow | Habitual + direct franchise P&L (carryout steering) |
| 7 | `deal_orientation` | deals-page dwell, mix-and-match engagement, value-menu views | Medium | Behavior-only price sensitivity; medium so one bargain hunt doesn't brand anyone forever |
| 8 | `novelty_index` | new-badge clicks, never-seen-category dwell, LTO engagement vs repeat ratio | **Fast** | The habit-break trigger; must spike and fade in days |

**External context (clock, day-of-week, sports calendar, weather) enters as session-scoped gates, not stored dimensions** — modulating composition, never pricing, never keyed to geography.

## 3. The twelve beats

**1. Your Usual, One Tap** *(centerpiece — their stated insight, live)*
Dimensions: `recipe_flavor` (slow) + `crust` (slow). Signals: repeated views/configures/carts of the same recipe+crust under the anonymous first-party ID; order completion saturates.
Beat: session 1 = generic hero. By the second or third pepperoni interaction the instrument shows `recipe:pepperoni` crossing θ_in and the hero flips: **"Your usual? Large Pepperoni, Original Pan. Start it."** One tap → prefilled cart. No login, ever.
Why: they built 3-tap reorder for accounts; this is the same economics for the anonymous majority — fewer steps on a weekly purchase.

**2. Wander Mode** *(centerpiece #2 — "…unless things change")*
Dimensions: `novelty_index` (fast) vs habit strength; category deltas. Signals: a known "usual" visitor dwells on Melts/Flatzz, opens Deals, configures never-bought items.
Beat: exploration overtakes habit → hero swaps to a guided tour: "Trying something new? Start with a Melt — crispy, dippable, not for sharing," with an adjacency rail (pepperoni → Pepperoni Lover's Melt → Pepperoni Duo Flatzz). Inspector shows the deterministic rule that fired.
Why: their new platforms (Melts, Flatzz) carry the media spend; steering an *active explorer* raises trial without interrupting loyalists.

**3. The Lapsed Regular** *(decay EXIT — nobody else demos this)*
Dimension: `recipe_flavor` with time decay. Beat: time-warp advances 6 weeks; inspector shows pepperoni 0.84 → 0.31; visitor **exits** "Pepperoni Lover's Regulars"; hero deliberately stops saying "your usual" (stale = creepy) and reverts to a win-back value hero ($10 Hut Crust Deal). One order re-enters.
Why: lapse is the churn that matters in QSR, and decay-as-feature is the honest answer to "how do you avoid haunting people with old data."

**4. Lunch Reflex** *(daypart)*
Dimensions: `daypart_pattern` (learned) + session clock (context). Beat: same visitor, same URL — 11:45am renders "Crafted Flatzz. $5 til 5." solo-lunch framing; 7:10pm renders Big Dinner Box. Side-by-side.
Why: CEO on record — two-thirds of pizza sells after 4pm; lunch is the stated opportunity, and "$5 til 5" proves dayparted merchandising is already brand-approved.

**5. Family Night Autopilot** *(party size)*
Dimension: `occasion_scale` (fast). Signals: 2+ pizzas in cart, box views, pizza-calculator, 2-liter, dessert-for-the-table.
Beat: visitor prices two mediums → slot recomposes to Big Dinner Box "feeds the whole crew for $24.99" + upgrade rail. Inspector shows the `serves ≥ 4` gate.
Why: boxes are their highest-ticket constructs; DIY-basket → box is pure AOV.

**6. Game Day Radar** *(occasion + sports context)*
Dimensions: `occasion_scale` + wings affinity + sports-calendar context flag. Beat: flagged game day + wings-leaning visitor → "Game plan: 24 wings, 2 flavors, 2 pizzas" hero, wings rail to slot 1; same visitor on a non-game day → normal layout. Both states shown.
Why: their marketing is sports-saturated (Brady, Super Bowl Big New Yorker). Context gates *content emphasis only* — no price/availability change; inside the fairness line.

**7. Crust Loyalist**
Dimension: `crust` (slow). Beat: a pan-crust regular gets crust-forward creative ("Your crust. Golden, crispy, yours."); a hand-tossed regular gets "Your crust got an upgrade — new Garlic-Parm finisher." Stuffed Crust upsell chip appears only for crust-indulgent profiles (+$ margin).
Why: they spent a campaign platform claiming crust is identity; we merchandise to it.

**8. Heat Seeker**
Dimension: spice lean (trait derived across categories). Beat: wing-flavor chips re-rank hot-first for a heat-leaning session; after hot wings, the Flatzz rail leads Nashville Hot. Mild profile sees Honey BBQ first. Same page, two visitors, live.
Why: flavor-level re-ranking kills choice friction on the highest-SKU category, and demos per-dimension explainability crisply.

**9. Deal-Lover's Lane** *(behavior-only deal orientation)*
Dimension: `deal_orientation` (medium). Beat: deal-oriented visitor gets a deal-anchored hero + pinned deal rail; full-price visitor gets premium merch (Stuffed Crust, Big New Yorker) with deals one click away, never hidden. Bonus: a $7 mix-and-match basket with only ONE eligible item triggers "add one more $7 pick to unlock" — deterministic basket completion, pure incremental units.
Why: standard QSR practice done clean — the inspector proves the audience is behavior-only; never geography, never a protected class.

**10. Carryout Regular / Rainy Flip** *(order mode + weather context)*
Dimensions: `fulfillment_mode` (slow) + weather context gate. Beat: carryout regular lands with Carryout pre-emphasized + carryout-locked deals surfaced; storm-flagged session flips creative to "stay in, we'll drive." Mode affinity persists; weather is per-session.
Why: carryout steering is franchise P&L (no aggregator fees), and their own analytics already uses weather — we do it deterministically, explainably.

**11. Solo Hut Box Nudge**
Dimensions: `occasion_scale` (solo end) + Melts/Flatzz affinity. Beat: solo-pattern visitor's meal-deal slot flips to My Hut Box "Full Melt + side + drink, from $6.99 — all yours, no sharing" in the brand's own voice; dessert attach swaps to single-serve.
Why: Melts/Flatzz were built for the solo diner; the box lifts a $5 ticket to $7–9.

**12. The Protected Hero** *(governance — the closer)*
All dimensions; this beat shows composition. Marketing pins the "$10 Hut Crust Deal" into slot 2 for everyone; the Cheeseburger Melt intro is eligibility-gated to novelty-high visitors; slot 1 stays owned by each visitor's strongest dimension. Flip three profiles: slot 2 identical (pin), slot 1 differs (affinity), the Melt appears only where gated.
Why: gates → pins → weighted rank with the explain record open is the anti-black-box argument in one screen — and the argument a lean, PE-owned team can actually operate.

## 4. The demo arc (suggested 12-minute run)

1. Cold open: anonymous first visit, geo-aware market greeting (real edge geolocation) → generic hero.
2. Build the habit live: three pepperoni interactions → instrument bars fill → **Your Usual** flips (beat 1).
3. Show the machinery: audience chips light ("Pepperoni Lover's Regulars"), explain record opened (beat 12's inspector, early).
4. Break the habit: browse Melts + Deals → **Wander Mode** (beat 2).
5. Time-warp: six weeks → **Lapsed Regular** exit + win-back hero (beat 3).
6. Context flip: clock to 11:45am → **Lunch Reflex** (beat 4); optionally Game Day toggle (beat 6).
7. Governance closer: pins + gates over three profiles (beat 12), then the experimentation chapter — launch a live bandit on the hero from the operator surface.
8. Close on the economics: every beat named in ticket/AOV/conversion terms; "you built this for the signed-in minority — this was all anonymous."

## 5. Asset shopping list

| Asset | Qty | Source |
|---|---|---|
| Hero food shots per category (pan cheese-pull, pepperoni close-up, Melt held, Flatzz on board, glossy wings ×3 sauces, Tuscani, desserts) | ~14 | AI-generatable (watch pepperoni-curl/cheese-pull artifacts; generate 2x, crop; human-eye QA) |
| Crust close-up trio (Hand-Tossed garlic-parm, Tavern cross-section, Thin 'N Crispy snap) | 3 | AI-generatable (macro crumb renders well) |
| Occasion spreads (family table w/ box, game-day coffee table, solo desk lunch) | 3 | AI-generatable — keep hands/faces out of frame |
| Deal banner tiles (big price numeral + short possessive name, PH merch grammar) | 5–6 | Built in code/design — never generate text inside images |
| Demo brand identity (fictional pizzeria: logo, wordmark, palette, menu typography) | 1 set | Designed by us — full creative freedom, no third-party trade dress anywhere |
| Food photography | ~20 | Pizza Hut public product imagery (private demo, provenance internal) + AI-generated fillers, labeled |
| Context garnish (rain window overlay, scoreboard motif) | 2 | AI-generatable |
| Affinity instrument / inspector UI | — | Our product surface, built in code |

## 6. The AI chapter — Menu Search & the Table Concierge (in scope, 2026-08-11)

The retail demo's natural-language search and style concierge, re-tailored to a table mindset. Both are grounded in the menu catalog and read the live affinity vector, and both respect the house separation: **AI converses and composes language; the deterministic engine ranks and decides; the demo shows them as visibly distinct layers** (the concierge cites the same explain records the inspector shows).

**Menu Search (natural language over the menu):**
- "Something spicy but not heavy" → Diavola thin-crust, hot wings, Nashville-style flatbread — ranked by the session's heat/category affinities.
- "Gluten-free for one kid, the rest of us eat everything" → GF personal pizza + a family box for the table, dietary gates applied as *eligibility*, not suggestions.
- "What can I get for under $10 for lunch?" → daypart + price-band gated results, solo formats first for a lunch-pattern visitor.

**Table Concierge (the "I'm having X, what do I do?" widget):**
- "Feeding six for game night, keep it around $50" → a real, priced, one-tap order composed from the menu (2 large pizzas + 24 wings in two flavors + 2-liter + dessert), party-size gate on, wings-forward if the session leans wings.
- "Date night, we like white wine" → pairing-mode answer: lighter pizzas (Margherita, Quattro Formaggi), antipasti, tiramisù for two — occasion-scale set to two, premium lean respected.
- "It's my usual Friday but I want to try something new" → the concierge *narrates* what Wander Mode already detected: adjacency suggestions anchored on the habit ("you're a pepperoni regular — the Diavola is one step spicier; the pepperoni flatbread is the same flavor in a solo format").
- Every concierge answer ends in an actionable cart, and every recommendation can show its receipt — which dimension, which weight, which gate.

**Demo placement:** search in the header (where a menu site would have it), concierge as a floating "Ask the kitchen" widget. Both get a beat in the demo arc between the habit chapter and the governance closer.
