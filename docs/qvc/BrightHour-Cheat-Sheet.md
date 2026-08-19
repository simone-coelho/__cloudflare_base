# The Bright Hour — Presenter Card

**URL:** `edge-platform.expedge.workers.dev/live` · Panel: **▶ Play full arc** (top, always visible) · **⏸ Pause anytime** — rings and story stay frozen on screen.
**Before the room:** New Viewer → run the arc once → New Viewer again. Open `/live/ops` in a second tab. Second browser window (incognito) ready.
**Rhythm:** every beat announces first ("Next — …"), then the cursor clicks, then "Landed — …" with the numbers. Read the STORY tab's top entry aloud whenever in doubt — it is written to be spoken.

| # | Beat | The machine does | You say |
|---|------|------------------|---------|
| 1 | **Anonymous Stranger** | Resets to a cold visitor, then the cursor clicks **3 kitchen products**. Bars fill; category crosses **0.60**; Spotlight module swaps (ringed, coral). | "No login, no history. Three clicks, fifteen seconds — watch the category bar cross the threshold. No model training. It's deterministic — arithmetic, not a black box." |
| 2 | **Governance & quota** | Flips **Discovery quota OFF** → the discovery rail collapses to more-of-the-same → flips it **back ON** → reserved picks return. | "Your worry is over-personalization. This slot is *reserved* for discovery — and when I turn the guardrail off, look how the page collapses. Rules outrank the algorithm." |
| 3 | **Second Shopper** | Caption prompts you — **you open the incognito window** at the same URL. | "Same page, same moment, different person — different offers. Several eligible offers; the system picks per shopper." |
| 4 | **A New Offer Is Born** ★ | Offer Desk: a raw feed row (name + price, nothing else) → **real AI call proposes tags** (~16s — talk over it) → approves **with one human edit** (construct → Today's Bright One; Occasion rejected) → the item **lands on the sales floor**. | "Watch the confidences — the model even catches the vendor's mislabel. A human approves and *edits*. No campaign built, no page rebuilt: the item carries a start time and an end time, and the page reads it." |
| 5 | **Time Passes** | Presses **+24h**. The daily deal's window closes; the **queued successor takes the slot** automatically. | "Nobody rebuilt this page. The offer expired; the next one flowed in. That's the manual rebuild you do every morning — gone." |
| 6 | **Sold Out Mid-Session** | **Sells out the featured item.** *This* window (interested shopper) keeps it — **Waitlist, price held**. The incognito window gets the replacement. | "Sold out — but this shopper wanted it, so she keeps it at her price on the waitlist. The fresh visitor never sees a dead slot. Same event, two right answers." |
| 7 | **The Glass Box** | Opens the explain panel on a **refused** item: highest score on the page, excluded by rule — `vip_offer_exclusion (final_sale)`. | "The engine refusing a click it would have won — because your merchandising rule outranks the model. Every decision has this receipt." |
| 8 | **Experiment on Top** | Highlights the **Experiment line** (arm · sdk) and the offer framing it controls. | "A real 50/50 experiment, running in our real product right now — and its ID rides on every decision row." |
| 9 | **The Receipts** | Opens the **export**: one warehouse-shaped row per decision — gates, scores, offer window, experiment IDs. | "This lands in *your* warehouse. We hand you the rows — your team computes the lift. Your KPIs are columns." |

**Machine time ~7 min · with your narration 12–15.**

## If something goes sideways
- **New Viewer** = total reset (state, story, clock). Safe at any moment.
- **⏭ Skip** past a slow beat; **⏹ Stop** → drive by hand (every manual click gets the same camera + story).
- Beat 4's model call is slow by design (~16s): *"it's reading the item — a real call, not a canned response."*
- Beat 6 needs Beat 4 done first (the successor must exist). The arc orders this correctly on its own.
- Don't idly scroll before Beat 1 — scrolling feeds real impressions.
- Network dies: add `?mock=1` to the URL — offline presenting mode.

## The three sentences that carry the meeting
1. "You don't have a recommendations problem — you have a **decisioning-under-expiry** problem."
2. "**No training period.** The first-ever visitor gets a personal page in three clicks — that's your 90% anonymous majority."
3. "Everything explains itself, and everything exports. **We hand you the rows; you compute the lift.**"
