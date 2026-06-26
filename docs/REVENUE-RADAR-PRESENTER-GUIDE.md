# Revenue Radar — Presenter's Guide

**How to demo it, how to walk the customer through it, and exactly what to ask Opal.** This is the *Revenue Radar* half (the funnel diagnose→fix→prove loop + the conversational queries). The A/B/MAB/CMAB Engine-tab work has its own guide.

**Demo URL:** `https://edge-platform.expedge.workers.dev/storefront` → open the **Demo Director** sidebar (right edge) → **Radar** tab (the funnel) and **Opal** tab (the chat).

---

## A. What we currently have (capabilities)

1. **A live funnel chart** — checkout funnel for **3 brands** (Coach, Kate Spade, Stuart Weitzman) × **4 generational cohorts** (Gen-Z, Millennial, Gen-X, Boomer), with anomaly-scored leaks and a recoverable-dollar figure.
2. **One-click fix → a REAL experiment** — the Launch button creates a live Optimizely experiment and the funnel recovers on screen.
3. **A real checkout** with an **in-session BNPL save** that appears at the payment step after you launch the fix.
4. **Live motion** — buttons that make the funnel swell and recover on stage (so it feels alive, not a slide).
5. **The anti-DY contrast** — the "Neighborhood vs Shopper" card.
6. **A self-driving "▶ Play story"** that runs the whole arc hands-free.
7. **Opal (the AI chat)** — ask in plain English: it **diagnoses the funnel**, **queries the real customer base**, and **creates real audiences / flags / banners**.
8. **One-click "↺ Reset demo"** to return to a pristine baseline (and Restart auto-cleans too).

---

## B. The hero walkthrough (≈90 seconds — what to click + what to SAY)

> Goal: prove **diagnose → decide → activate → prove**, in one conversation, no engineer, no analyst.

1. **Radar tab, Coach, All cohorts.** *"Here's Coach's checkout funnel. Overall it looks healthy — nothing screams."*
2. **Click the Gen-Z pill.** The payment step lights up red: **44% drop, $7,623, "gen_z 1.5× the drop."** *"But filter to the audience you actually care about — Gen-Z — and the truth appears. The average was hiding a 44% collapse at payment."*
3. **Click "◑ DY vs us."** *"This is the difference. Dynamic Yield, with their Mastercard data, sees a zip code — 'people here spend ~$420.' We see THIS shopper: three Tabby views, a $575 bag in the cart, a 40-second freeze at payment. They personalize a postal code; we personalize a person."*
4. **Click "Simulate drop-off."** The leak swells live to **$61.7k**. *"And it's not one shopper — it's happening at scale right now."*
5. **On the BNPL card, click "⚡ Launch experiment."** *"One click — no developer, no analyst."* → green box: **"Experiment live — 563864 · +48% lift · 96% conf,"** funnel recovers. *"That's a real Optimizely experiment — I can open it in the platform. And the funnel's already recovering."*
6. **Go to the storefront, add a Tabby, click Checkout → Payment.** The **"Pay in 4 with Tabby"** save is there. *"And here's the fix, live for that shopper, in-session — the page reshaped itself."*
7. **Kicker:** *"Diagnose, decide, activate, measure — one conversation, no engineer, no analyst, live at the edge, across all three brands. That's a personalization tool versus an optimization platform."*

**Or:** hit **▶ Play story** and narrate over it; **or** do the whole thing conversationally in **Opal** (next).

---

## C. The Opal query catalog (vetted — these actually work)

Opal is the conversational UI. Type these in the **Opal** tab. Three things it does, with ~30 example asks:

### C1 · Diagnose the funnel (Revenue Radar) — triggers `diagnoseFunnel`
*Use checkout/funnel/revenue language so it picks the funnel tool.*
1. "Where are we losing the most checkout revenue for Gen-Z?" ✅ *(verified)*
2. "Diagnose the Coach checkout funnel."
3. "Which brand has the worst checkout drop-off?"
4. "Where do Kate Spade shoppers abandon checkout?"
5. "What's our biggest revenue leak on Stuart Weitzman?"
6. "How much checkout revenue can we recover on Coach for Gen-Z?"
7. "What should we do about the Gen-Z payment-step drop-off?"
8. "Find the checkout funnel leak for Millennials on Coach."
→ Returns the leak, the recoverable $, the cohort skew, and a recommended fix (audience + remedy).

### C2 · Ask about the real customer base — triggers `queryData` (live SQL on 3,200 profiles)
9. "How many high-intent Tabby browsers do we have, and their average order value?" ✅ *(verified: 145 · $394)*
10. "How many shoppers abandoned their cart?"
11. "What's the average 90-day order value of our luxe collectors?"
12. "How many loyalty members do we have, broken down by tier?"
13. "Which product line gets viewed the most?"
14. "How many shoppers viewed Tabby but never added it to cart?"
15. "Who are our highest-value customers — top spenders in the last 90 days?"
16. "What's the churn-risk breakdown across personas?"
17. "How many gift shoppers do we have?"
18. "What share of visitors are window-shoppers vs high-intent browsers?"
19. "Average order value by persona?"
20. "How many shoppers are in the 'ready-to-buy' journey stage right now?"
21. "How many Gen-Z / young shoppers are browsing Tabby?"
→ Returns a plain-English answer + a card with the actual SQL it ran (great for technical audiences).

### C3 · Create a real audience / flag / banner — triggers `createOptimizelyAudience` / `createFlag` / `targetMessageToAudience`
*These create REAL Optimizely entities (writes are ON). Say "create / build / launch / target / show a message to…"*
22. "Create an audience of Gen-Z BNPL hesitators."
23. "Build an audience of high-AOV cart abandoners."
24. "Create a Luxe Collectors audience and launch complete-the-look to them."
25. "Target Tabby viewers with a banner that says 'Complete your Tabby look — 15% off today.'"
26. "Make an audience of high-intent browsers who haven't purchased, and set their banner to 'Your edit is waiting.'"
27. "Create an audience for loyal repeat buyers and show them an early-access message."
→ Opal creates the audience/flag and tells you it's live; you can **preview that audience** on the storefront to watch the banner render. *(Idempotent — reuses by name across runs.)*

### C4 · Launch an experiment (A/B / MAB / CMAB)
28. "Launch an A/B test for the BNPL fix on Gen-Z hesitators."
29. "Run a multi-armed bandit on the checkout experience."
30. "Create a contextual bandit for the payment step."
→ Creates a **real** Optimizely experiment. *(This is the A/B+CMAB workstream — see their guide for the full repertoire.)*

**Phrasing tips:** funnel words ("checkout / drop-off / losing revenue / leak") → the funnel tool. Counting/averages → the data tool. "Create / build / launch / target" → the creation tools. If it answers in prose without a tool card, rephrase to be explicit.

---

## D. The "max wow" moments (where to slow down)

1. **The Gen-Z reveal** — clicking the cohort and watching the hidden leak appear. *("The average lies; the cohort tells the truth.")*
2. **Neighborhood vs Shopper** — the single most quotable anti-DY line.
3. **The funnel reacting live** — Simulate drop-off → swell → Launch → recover. Nobody's slide deck moves.
4. **The real experiment ID** — open Optimizely and show `563864`. *"Not a mockup."*
5. **The in-session BNPL save** — checkout reshaping itself for the segment.
6. **Opal doing it conversationally** — ask a question, get a fix + a real audience, no SQL, no dev.

---

## E. Did we follow the event spec you gave us? — Yes.

The funnel uses the exact **GA4 checkout events** from the analytics use-case:
`add_to_cart → view_cart → begin_checkout → add_shipping_info → add_payment_info → purchase` (+ the `view_cart_empty` signal for the cart-persistence story). The real checkout emits these into our event store; the funnel is computed from them (plus the tuned baseline). The recommended segments (Empty-Cart Viewers, Shipping-Stage Droppers, High-AOV/Gen-Z BNPL Hesitators) map straight to the use-case.

---

## F. Presenter tips & safety

- **Reset:** the **↺ Reset demo** button (Radar tab) returns everything to the clean baseline — Coach·Gen-Z = **$7,623 / 44.3%**. Your **↻ Restart** also auto-cleans. No commands needed.
- **What's real vs representative (your shield):** *"The traffic numbers are representative — our owned dataset, so it's stable. The audience, the experiment, and the personalization are real Optimizely objects — here's the experiment in the platform."* Never call the numbers Tapestry's real traffic.
- **The BNPL save only shows AFTER you Launch** (or after ▶ Play story). Before that, the payment step is a plain card form — that's the intentional "before."
- **If Opal answers without using a tool:** rephrase to be explicit (see the phrasing tips).
- **Brand selector** = the parent-level story (Coach + Kate Spade + Stuart Weitzman, each with its own leak).
- **Full detail:** `docs/REVENUE-RADAR-EXPLAINER.md` (how it works) · `docs/REVENUE-RADAR-TDD.md` (build log).
