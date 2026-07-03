# Team message — DY parity build (for Teams channel)

*Paste-ready. Suggested attachments listed at the bottom.*

---

**Team — an update on Coach, and why this couldn't wait.** (Yes, I'm technically on vacation. I refuse to lose to Dynamic Yield. I will not lose to this company.)

**Where we stand after the meeting.** After Zach, Christian and I met, a few things became evident — and I want to be clear this is my read of the room:

- **Mandeep is critical** to getting our product in. Engineering is the gatekeeper on this deal.
- He came in **leaning toward Dynamic Yield** — that preference was visible.
- But the overall story we presented **captivated him** — to the point that he's willing to work with us in the partnership, **as long as we commit in writing to deliver on that vision**.

To earn that commitment, we have to prove we can do what Dynamic Yield does. And DY had one genuine advantage — the one piece we were missing: a **real-time behavioral layer**. The thing that watches what a shopper does *in the moment*, automatically builds behavioral affinity audiences ("Tabby Affinity," "Tote Affinity"), and lets shoppers **flow in and out of them as their behavior changes** — interest that *expires* when you walk away, actions that *weigh* differently (an add-to-cart says more than a glance).

**So I built it. It's live in our demo engine today.**

What's now running:

- **Live affinity scoring on every dimension of the catalog** — product lines, styles, occasions, price posture — updated on every click and **decaying in real time**. Walk away, and the store honestly forgets you. That's the exact DY mechanic (their "expiration and weighting" logic), now ours.
- **Audiences that create themselves** — nobody configured "Tabby Affinity." The catalog writes the audiences, behavior fills them, and shoppers enter **and exit** automatically. This was one of the specific gaps in our story — closed.
- **Weighted actions** — a view builds interest slowly, a wishlist twice as fast, an add-to-cart instantly.
- **Fully transparent** — where DY is a black box, every score, threshold, entry and exit here is visible and explainable on screen. That matters enormously to an engineering-led buyer like Mandeep.

**An engine means nothing if you can't see it — so I made it visual, and it's already wired into the demo:**

- A **live affinity panel** (its own tab): bars filling and draining in real time, audience chips lighting up and fading out, a timestamped log of every transition.
- The storefront **reacts in the same breath**: enter "Tabby Affinity" and the top banner announces it, the hero re-centers on the Tabby, the grid re-ranks. Let your interest fade and everything **visibly reverts — with the reason named on screen**.
- **White-glove moments with honest countdowns**: add to cart and the store holds your bag for 15 minutes (really ticking, really expires); browse three expensive bags from *different* lines and it notices your **price posture** — complimentary monogramming, on the clock.
- A **"New shopper" button** so anyone can reset and run it again in seconds.

**Try it yourselves.** The attached self-run script takes about 5 minutes and assumes no technical background. I'm also attaching the design document, the **algorithm and the mathematical explanation** of how the scoring and decay work, and the architecture note on how this **builds on top of ODP without touching ODP's role as the memory**.

**The one piece left: linking it to live ODP.** The design is already built for it. Everything this engine serves — the segments, the audiences, the catalog signals — becomes an **extension of ODP's data**, not a replacement:

- Personalization is served from the **edge engine** — instant, in-session.
- Every event is **forwarded into ODP**, which remains the system of record at its own cadence (~90 seconds, sometimes more — and that's fine; that's the memory's job).
- Our layer **enriches** ODP. ODP stays the governed, first-party backbone.

Once that link is live: **on this capability — real-time behavioral affinity audiences — we are at 100% parity with Dynamic Yield.** Everything they offer here, except the one thing we'd never want: their Mastercard data. Ours runs entirely on **Coach's own first-party data**.

We didn't just close the gap — we closed it with something more transparent than what DY sells, sitting on top of the platform Coach already owns. Now let's get that commitment in writing.

— Simone

---

**Suggested attachments:**
- `Coach-Affinity-Demo-AE-Script.md` — the 5-minute self-run script (start here)
- `Edge-Affinity-Reflex-Technical-Design.md` — the engineering design: the algorithm, the math (decay, weighting, thresholds), the audience generator
- `Coach-Realtime-Behavioral-Personalization-Architecture.md` — how the layer builds on ODP as the memory (the customer-facing architecture)
- `Coach-Component-Personalization-Field-Brief.md` — background: the pattern and why we're positioned to win
