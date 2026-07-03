# Live Affinity Demo — AE Self-Run Script (5 minutes)

**URL:** `https://edge-platform.expedge.workers.dev/storefront`
**What you're about to see:** the store watching a shopper's behavior, building **live affinity scores that decay in real time**, moving the shopper **in and out of audiences automatically** (the Dynamic Yield mechanic), and reacting **instantly** — banner, hero, offers with real countdowns. Every decision is transparent: you can watch the scores and thresholds live.

---

## Setup (30 seconds)

1. Go to the URL in any browser. If you (or anyone) have used the demo in this browser before, click **👤 New shopper** — it's at the top of the sidebar's **AFFINITY** tab (and in the demo controls). It wipes the session and reloads you as a brand-new shopper. *(A fresh incognito window works too.)*
2. You'll land on a cold-start page — a welcome ribbon on top, a "Demo Director" sidebar on the right, a "Personalization Activity" card bottom-right. Ignore all of it for now.
3. **The one pace rule:** when the script says "click products," click **briskly — one every 5–8 seconds**. The demo's memory fades fast on purpose (so you can watch it fade); slow clicking and it forgets you between clicks.

> Several people can run this at the same time — every browser is its own isolated shopper.

---

## Sequence 1 — Watch yourself become an audience (~45 seconds)

1. From the home grid, **click any Tabby bag** (opens the product page).
2. On that product page, **click a Tabby from the recommendations** below.
3. **Click one more Tabby.** The instant the third click lands:
   - **A banner slides in at the very top:** *"DECIDED LIVE — You keep coming back to the Tabby — SEE YOUR TABBY EDIT."*
   - **The sidebar's AFFINITY tab opens itself**, with a badge (≈8): live bars for line / category / silhouette / occasion / price, green **audience chips** ("Tabby Affinity," "Handbags Affinity"…), and a timestamped log of every entry.
4. **Click "SEE YOUR TABBY EDIT"** in the banner → the homepage hero now reads *"FOR YOUR TABBY AFFINITY · DECIDED LIVE · 0.61"* and the grid is re-ranked Tabby-first.

**What just happened:** three views built your affinity past the entry threshold (the green tick on each bar at 0.60). You *entered* auto-generated behavioral audiences — the names come straight from the catalog — and the store reacted in the same breath, with the cause and the live score written on the hero itself.

## Sequence 2 — One action, instant intent (~15 seconds)

5. On any product page, **Add to cart.** The cart opens *and* the top banner flips to:
   *"WHITE GLOVE — We're holding your bag — [product] is set aside, with complimentary express delivery if you complete within **15:00**"* — with a **genuinely ticking countdown**.

**What just happened:** an add-to-cart is a heavier signal than a view (weight 3 vs 1) — one action flipped you to ready-to-buy, and the store responded with a white-glove hold. The countdown is real; when it hits zero the offer visibly retires and says why. *(While an offer is ticking it owns the banner — other moments wait their turn.)*

## Sequence 3 — Walk away and watch it forget you (~60 seconds)

6. **Stop. Touch nothing.** Keep the AFFINITY tab in view.
7. The bars **drain in real time** — the numbers tick down every second.
8. After ~45 seconds the scores fall under the exit line (0.45): chips clear, ⊖ exits hit the log, and the banner turns **bordeaux**: *"Your session affinity faded below the line — the edit returned to neutral."* The hero reverts.

**What just happened:** the signature of this engine — shoppers don't just enter audiences, they **fall back out** when their behavior moves on. And nothing silently disappears: even endings are announced, with the reason.

## Sequence 4 (optional) — Change your mind, watch it follow (~30 seconds)

9. **👤 New shopper**, then run Sequence 1 again (3 Tabby clicks) — then **click 3 Brooklyn or tote pieces** briskly.
10. Brooklyn crosses in while Tabby drains: new banner, hero pivots to Brooklyn, and in the AFFINITY tab you literally watch one bar sink while the other rises.

## Sequence 5 (optional, subtle) — It reads patterns, not just products

11. **Click 👤 New shopper first** (AFFINITY tab) — this beat needs a truly clean shopper; if you already browsed Tabby, "Elevated" is already lit and won't re-enter.
12. **VIEW these three, in any order** — click into each product page, then back (within ~15 seconds each is fine). **Do NOT add to cart** (adding is a stronger signal and triggers the bag-hold instead, which outranks the perk):
    - **Tabby Shoulder Bag 26** ($475)
    - **Brooklyn Shoulder Bag 39** ($495)
    - **Rogue Bag 25** ($595)
13. No single line accumulates — but the **price pattern** does: *"Elevated Affinity"* enters alone → *"Complimentary monogramming — on us … within 15:00."* In the AFFINITY tab, notice the *elevated* bar **drains slower** than the line bars — price posture is tuned to fade slower than product interest.
    **The line to say out loud:** *"It noticed her price posture, not any product."*

---

## Talking points (if you're showing someone)

- *"These audiences created themselves — the names come from the catalog. Nobody configured 'Tabby Affinity.'"*
- *"She moves in **and out** by behavior alone — watch the bars decay. That's the Dynamic Yield mechanic, running on our edge, on first-party data."*
- *"Everything is glass: the score, the threshold, the timestamped log. Ask 'why is she in this audience?' and the screen answers."*
- *"Offers are honest — real countdowns that expire, and the store tells you why something ended."*

## If something looks off

- **Bars hover just under the line / no entry** → you clicked too slowly. Three brisk clicks (5–8s apart).
- **Weird leftover state** (offers firing oddly, old audiences) → you're carrying an old session. Click **👤 New shopper** (AFFINITY tab) — instant clean slate.
- **Note:** decay is deliberately fast (seconds) so you can *see* it live; in production this is a tuning knob (minutes–hours).
- Anything else — screenshot it and send it to Simone.
