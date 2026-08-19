# How the Bright Hour Engine Thinks — the one-page mental model

*Plain language, for the presenter. No code. Read once; the panel makes sense forever.*

## The machine in one sentence
Nine **dials** rise with the shopper's behavior and fall with time; **five steps** turn those dials into a page; and **human rules outrank all of it**.

## The nine dials (the affinity bars)
Each is a score from 0 to 1 for one aspect of this shopper: **category** (kitchen vs jewelry…), **subcategory**, **brand personality** (artisan vs value-workhorse…), **price band**, **offer-type** (does she chase daily deals or evergreen value?), **urgency-responsiveness** (does time-limited framing move her?), **host** (which presenter she follows), **session mission** (wandering vs on-a-mission), **media** (watches video vs reads).

- **Behavior raises them:** a view adds weight 1, a click 2, add-to-cart 3. The math saturates — early clicks move the dial a lot, later ones barely (score = R/(R+1.8)).
- **Time lowers them:** each dial decays on its own clock. Demo speed: category halves in ~90 seconds. Production speed: days-to-weeks. Slow dials (brand taste, price posture) outlive fast ones (urgency, mission) — that's the "two-speed" story.
- **Thresholds with a gap:** cross **0.60** → enter an audience (the chip appears). Must fall below **0.45** → exit. The gap prevents flickering. Audiences aren't hand-built — they're **generated from the catalog's own vocabulary** ("Kitchen & Table Affinity" exists because the catalog has a Kitchen & Table shelf).

## The cold start (before any behavior exists)
A brand-new visitor's first paint opens with the **geo cohort banner**: her real location (read at the edge, off the request itself — no client code), the real Census income for that area (cited with vintage), and what shoppers near her favor — **representative** first-party history, always labeled (in production: the customer's own warehouse). It is **a prior, not a profile** — and the moment her own category dial crosses 0.60, the banner yields with a toast: behavior beats geography, always. Red line: geography **curates**, never prices or gates. Grain is honest: metro when the local cohort is big enough, else state ("shoppers in North Carolina"), else national — with N suppressed when borrowed.

## The five steps (how every slot gets filled, every time)
1. **GATES** — remove what *cannot* show: offer window not open or expired · sold out · blocked by a business rule. Gates judge the **item**, never the shopper.
2. **PINS** — a merchandiser reserved the slot (the hero billboard). Pinned content skips ranking. **Humans outrank the engine.**
3. **RANK** — score the surviving items against this shopper's dials, per the slot's weights. This is the personalization.
4. **QUOTA** — reserve seats for items the shopper has shown **no** interest in. Deliberate discovery.
5. **TIE-BREAK** — a deterministic coin-flip, so identical inputs always produce the identical page. Replayable. Auditable.

## What every panel control actually does

| Control | Which step it touches | ON / default | OFF / other state |
|---|---|---|---|
| **Discovery quota** | Step 4 | "Something New to You" holds seats for zero-affinity items — the anti-echo-chamber guardrail (their "billboard value" requirement, made mechanical) | Ranking takes every seat → the page collapses toward what she already likes (show the disease, then the cure) |
| **Mode** | The session-mission dial, overridden | BROWSE: wandering → all 8 modules, discovery-rich | MISSION: came for something → page **removes** modules, collapses to 4. Personalization that removes clutter |
| **Cardholder offer** | A rule gate in Step 1 | The card-promotion exclusion rule is in force: Final Sale/Clearance items are **refused** from the promoted slot even at the highest score — `vip_offer_exclusion (final_sale)`, the glass-box moment | Rule lifted; previously refused items become rankable. Proves: **rules outrank the model** |
| **Advance clock** | Step 1's windows only | +24h flips the daily deal to its queued successor; +6h moves the event reveal | Never touches the dials — affinity decays in real time, honestly |
| **New Viewer** | Everything | Fresh anonymous shopper: dials at zero, story cleared, clock live | — |

## The words on screen, decoded
- **θin / θout** — the enter (0.60) / exit (0.45) thresholds on every bar.
- **τ (tau)** — that dial's decay speed ("90s demo / 14d prod" = halves in ~90 seconds in the demo, ~two weeks in production).
- **CROSSED θIN** — this dial just entered its audience; the chip below is the membership.
- **CHANGED / NEW PICK** — this slot/card is different since the last composition; the ring marks where.
- **quota_reserved** — this card holds a discovery seat; its low score is the point.
- **gate_failed: …** — the item was refused, and here is the named rule that refused it.
- **pinned** — a human reserved this; ranking never ran.
- **Experiment: value_language · sdk** — which arm of the real 50/50 framing experiment this visitor is in, bucketed by the real SDK.

## The three claims all of this exists to prove
1. **No training period** — dials move from the first click; the anonymous majority gets a personal page in ~15 seconds.
2. **Glass, not black box** — every score is arithmetic you can read; every refusal names its rule; every decision exports as a row.
3. **The business stays in charge** — pins, gates, and quotas outrank the model, visibly.
