# The Bright Hour — Presenter Card

**URL:** `edge-platform.expedge.workers.dev/live` · Panel: **▶ Play full arc** (top, always visible) · **⏸ Pause anytime** — rings and story stay frozen on screen.
**Before the room:** New Viewer → run the arc once → New Viewer again. Open `/live/ops` in a second tab. Second browser window (incognito) ready.
**Rhythm:** every beat announces first ("Next — …"), then the cursor clicks, then "Landed — …" with the numbers. Read the STORY tab's top entry aloud whenever in doubt — it is written to be spoken.

| # | Beat | The machine does | You say |
|---|------|------------------|---------|
| 1 | **Anonymous Stranger** | Resets to a cold visitor. **First: the geo banner** (real location, real census) — and the Spotlight shows **3–4 tiles** with the coral eyebrow **"FIRST VISIT — picked for your area"**. Then 3 clicks; category crosses **0.60**; the tiles **re-rank**, the eyebrow **flips to "PICKED FOR YOU — leaning Kitchen & Table"**, and the geo banner yields. | **When the geo banner is framed:** "Before her first click the page already opens usefully — geography as a prior, from the edge and the public census." **When you see the coral eyebrow:** "Read that label — it is computed, not copywritten. First visit: her area. Watch it change." **After click 3 / the eyebrow flips:** "Fifteen seconds of behavior just replaced the neighborhood — and the label says so itself. No model training." |
| 2 | **Governance & quota** | Flips **Discovery quota OFF** → the discovery rail collapses to more-of-the-same → flips it **back ON** → reserved picks return. | "Your worry is over-personalization. This slot is *reserved* for discovery — and when I turn the guardrail off, look how the page collapses. Rules outrank the algorithm." |
| 3 | **Second Shopper** | Caption prompts you — **you open the incognito window** at the same URL. **Point at the two Spotlight eyebrows:** yours reads "leaning Kitchen & Table", theirs reads "FIRST VISIT — picked for your area". | **With both windows visible:** "Same slot, same second: for me it is kitchen, for a fresh visitor it is her neighborhood — for someone else it would be wine or a lawnmower. Several eligible offers, the system picks, three to four shown — and each window's label tells you *why* it got what it got." |
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

## Today's audience note (their words: "content recs / dynamically serving banners")
- Say **"content"** early and often: *"every offer here is a **content item** in a **content catalog** — an ID, creative, metadata, a start and an end time. The engine decides which content each visitor sees in each slot."*
- The Spotlight slot IS their ask: several eligible offers, system picks, **3–4 shown instead of one**. Point at the count note: *"4 of 12 eligible — chosen for this shopper."*
- The insider line (use once, on the Spotlight): *"You've already built a hand-authored version of this exact module on your homepage — a personalized offers section fed by a manually curated file. This is that idea running as a system instead of a spreadsheet."*

## The three sentences that carry the meeting
1. "You don't have a recommendations problem — you have a **decisioning-under-expiry** problem."
2. "**No training period.** The first-ever visitor gets a personal page in three clicks — that's your 90% anonymous majority."
3. "Everything explains itself, and everything exports. **We hand you the rows; you compute the lift.**"
