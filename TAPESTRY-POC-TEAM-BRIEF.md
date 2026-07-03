## Cover note — paste this to the team

> Team — the Coach/Tapestry demo is wired and live. **Land directly here: https://edge-platform.expedge.workers.dev/storefront** (go straight to the `/storefront` path).
>
> Please read the brief below before tomorrow. It walks every weapon we're bringing into the room — top to bottom — what each one *is*, what it *maps to* in Tapestry's world, and what it *proves* against Dynamic Yield. The short version: **DY is one cog. Optimizely is the entire machine.** I want all of us telling that same story tomorrow.
>
> Fastest way to see it yourself: open the link, then on the right use the **Demo Director** — hit **Start ▶** and **Auto** to play the whole thing end to end. ~10 minutes.

---

# Tapestry / Coach POC — Team Brief
**For:** CEO · Account Executive · Customer Success Manager
**From:** Solutions Architecture
**Demo:** Mon 2026‑06‑29 · **Open it here → https://edge-platform.expedge.workers.dev/storefront**

---

## The one message I want every one of us carrying into the room

Anyone can capture events, process them, and hand a customer back a list of segments. That's commodity. That's **one cog** in a machine.

**Optimizely is the entire machine.** The value isn't the segment — it's the *expertise and the system that puts that segment to work*: how we read their first‑party data, turn it into audiences, wire those audiences into experiments, generate the experience, optimize it live, and measure it — **all unified, all in one platform, all at the edge.**

Dynamic Yield does one slice of that. We are the whole assembly line, plus the partnership and the know‑how to run it. **That is 100× the value of a point tool** — and it's the line I want us repeating tomorrow: *"DY is a feature. Optimizely is the platform."*

Everything in this brief is proof of that sentence.

---

## How to drive it (60 seconds)

1. **Open** `https://edge-platform.expedge.workers.dev/storefront` — land on the store directly.
2. **Right side — the Demo Director.** At the top: **Start ▶**, then **Next** to step through, or flip on **Auto** to autoplay the **entire** demo hands‑free. Every step posts a **Signal → Segment → Decision** card to the **Personalization Activity** panel, each with a **⤢ Compare before/now** slider so the room *sees* the change.
3. **Lower section — four tabs:**
   - **Opal** — the conversational layer. Ask it questions about the data, and tell it to *build audiences and launch experiments* in plain English. This is where "no developer, no ticket" comes alive.
   - **Capabilities** — a live **0/15** checklist. As the demo runs, each of the 15 personalization capabilities lights up. It's our scorecard on screen: *we cover all fifteen.*
   - **Engine** — the measurement view: the **A/B / MAB / CMAB** readouts (how traffic allocates, who's winning).
   - **Radar** — **Revenue Radar**, the operations brain: find the revenue leak → propose the fix → launch the experiment → watch it recover.

That's the whole cockpit. Now, the weapons — **top to bottom.**

---

# 1. Cold Start — our answer to Mastercard *(the one I want us to know cold)*

**This is our sharpest competitive moment, so I'm going deepest here.**

### The problem everyone has
A brand‑new visitor with no history lands on the site. Most personalization engines have nothing to say, so they show everyone the same generic grid. The first impression — the most valuable one — is wasted.

### What Dynamic Yield does
DY genuinely ships a cold‑start built on **Mastercard data** (their "geo / predictive" targeting). It rents **aggregated spend *averages* for the visitor's ZIP code** — "this neighborhood spends like *this*." It's real, and it sounds impressive in a pitch. **But:** it's *third‑party* data, it's a *neighborhood average*, it carries **no actual purchase intent**, it costs licensing money, and it never gets smarter — it's a rented guess about a postal code.

### What we do instead — and why it's better
We open the cold start on **what shoppers from that visitor's actual geography actually bought** — Tapestry's **own first‑party purchase history**, rolled up by location — **enriched with free public census income data** (U.S. Census ACS, by ZIP). So instead of *"this ZIP spends like this,"* we say:

> **"Shoppers like you, from right here, love *these* bags."** — built from *their own receipts*, with the income signal coming **free** from the census.

**Live in the room (from my real Winston‑Salem location), the store opens on "The Tabby leads near you"** — a hero + grid assembled from what Coach shoppers in the Winston‑Salem metro actually purchased (Tabby, Brooklyn, Pillow Tabby), with a provenance card citing the **real median household income, $65,903 (Census ACS 2024)**. Then we open the **"◑ DY vs us"** comparison for the punchline: *their third‑party ZIP average, side by side with our first‑party cohort.*

### Where the data comes from (the part to stress with Tapestry)
This is **Optimizely Analytics' home turf.** Tapestry already accumulates this — every time someone buys a Coach bag and registers, that's first‑party gold. We take *their* purchase data (from Optimizely Analytics / their warehouse), **enrich it with census + ZIP‑code income data**, and turn it into a confident first impression. **It fills exactly the gap Mastercard's data leaves** — real intent, their own customers, no licensing, and it compounds in value over time because it's *theirs*.

### The honesty model (this is what makes it credible, not a trick)
Three things are **real**: the **geolocation** (real edge detection of where the visitor is), the **query**, and the **mechanism**. The *only* thing swapped for the demo is the **data itself** — synthetic stand‑in today, Tapestry's real warehouse in production, via **one configuration flag, zero code change.** That's the line: *"Real identification, real query — we just pointed it at sample data for today. Point it at your warehouse and it's live."* People relate to that immediately.

We also **roll up gracefully** — ZIP → metro → region → national — based on how much first‑party data we have, and we **always show the grain we used** ("metro, N=320"). Honest about confidence, never overclaiming.

### The research behind it (so we can defend it)
- **Income is a strong, legitimate signal:** income correlates with socioeconomic status and home value at **r ≈ 0.82–0.98** in peer‑reviewed work — and census income is **public and free**.
- **First‑party beats third‑party, decisively:** studies (QME 2023) find third‑party audience segments perform **close to random**, while first‑party data outperforms both. DY's edge is third‑party; ours is first‑party. That's not a small difference.
- **Aggregate, not individual:** the Fed's *"Lost in Aggregation"* work shows a ZIP median can misstate an individual household by **35–75%** — which is *exactly why we treat geo as an opening prior we immediately replace the moment the shopper engages*, never as a verdict on a person.

### The guardrails (say these proactively — they build trust)
We **curate, never price or gate** by geography. We work at the level of **"shoppers like you, from here"** — **aggregate, never the individual**. We **never** use protected classes or a ZIP as a proxy for one, and we **never** tie geography to credit or financing. This is the responsible, defensible version of geo personalization — and it's a differentiator in its own right.

**What it proves:** *We turn Tapestry's own data + free public data into a better cold start than Mastercard's — cheaper, smarter, theirs, and it gets better over time.*

---

# 2. The TikTok Signal‑Led Moment — reacting to the world in real time

**The story:** a Coach Tabby starts going viral on TikTok. There's maybe a **~30‑minute window** before the moment cools. No human marketing team can design, build, launch, and optimize a campaign that fast. **We can — autonomously.** The demo runs a live countdown from 28:00 so the room feels the clock.

**The loop, live on screen:**
1. **DETECT** — a signal fires: *"Coach Tabby spiking on TikTok · +480% views/hr."* *(Honestly badged as a **simulated partner social‑listening layer** — that's the one mocked piece, and we say so.)*
2. **GENERATE** — **Opal writes the campaign copy**, and we **generate the hero image live (~8 seconds) from the real Tabby photo** — with an honest "generating…" status so it's never smoke and mirrors. The moment is assembled from **discrete, structured feature variables** (headline, sub‑copy, offer, image, CTA, theme…) — **exactly as a real experiment would be. No hand‑coded HTML.**
3. **SERVE** — the storefront does a full‑bleed **takeover**: *"As seen on TikTok — the Tabby everyone's talking about."*
4. **OPTIMIZE** — a **multi‑armed bandit** auto‑promotes the winning variant **inside the window**, with no manual ramp.
5. **MEASURE** — the loop closes in minutes, well inside the 28:00.

**What's real:** the hero image (AI‑generated), the copy (model‑written), the **real flag + bandit rule** in Optimizely, the feature variables. **Mocked:** only the TikTok signal itself (the partner layer — clearly labeled). **Illustrative:** the lift figures.

**The line:** *"Dynamic Yield reacts to the neighborhood. We react to what's happening in the world **right now** — detect, generate, serve, and optimize a moment in minutes, while it's still hot."*

---

# 3. Revenue Radar — find the money, fix it, prove it

**Revenue Radar is the operations brain** (its own tab, also drivable through Opal): **diagnose → fix → prove**, as one loop.

**The hero story:** Coach's **Gen‑Z checkout collapses ~44% at the payment step — ≈ $7,623 recoverable.** The "all‑customers average" *hides* it; the moment we segment to Gen‑Z, the leak turns red and the number jumps. The fix — a **pay‑over‑time (BNPL) offer** — is launched as a **real experiment** right from the Radar card, and the funnel visibly recovers. We can even simulate the leak swelling live to show the stakes.

**Why this matters to Tapestry — and the honest framing to carry:**
- The Radar is **fully functional**. What's synthetic today is the **data feeding the analysis** — and that data maps **directly to what Optimizely Analytics provides for Tapestry.** **We just swap the source.**
- Right now we're **emulating the signals and events**; in production, **Tapestry's own CDP / ODP substitutes that feed** — same machine, real data.
- The payoff is the chain: **Radar finds the leak → we create the audience → we launch the flag → it recovers.** That's diagnosis turning into action without a backlog. **That loop is the product.**

**The line:** *"This isn't a report you read next quarter. It finds the leak, builds the audience, launches the fix, and proves the recovery — in the room."*

---

# 4. All 15 capabilities — the full guided tour

We have implemented **all fifteen** personalization capabilities (the **Capabilities** tab tracks them live, 0/15). Here's what each one maps to and proves:

| # · Capability | What the room sees | What it proves |
|---|---|---|
| 1 · Customer profile (no sign‑in) | anonymous visitor → identity minted + welcome ribbon | we personalize from the *first* second, no login required |
| 2 · **Cold‑start data** | generic grid → confident, location‑aware edit | *(see §1 — the Mastercard‑beater)* |
| 3 · Real‑time updates | views a bag ×3 → hero reshapes **live, no reload** | personalization reacts *as it happens*, not on next visit |
| 4 · Recommendations | "best‑sellers, same for all" → *her* specific picks | one‑to‑one, not one‑to‑many |
| 5 · Sort rules (baseline) | standard rule‑based product order | the control we improve on |
| 6 · Personalized sort | same page **re‑ranks** → her favorites rise | merchandising that adapts to the shopper |
| 7 · Page structure | plain product page → **"Complete the Look" assembles** | the *layout itself* personalizes, not just content |
| 8 · Page content | generic hero → her hero (copy + image), same layout | content swaps to intent |
| 9 · Journey‑stage | adds to cart → "ready‑to‑buy" tone **+ fires the BNPL surface** | we act on buying intent we used to ignore |
| 10 · **Opal audience builder** | plain‑English prompt → **real audience published** | anyone can build a real audience by *typing* |
| 11 · **A/B testing** | email‑vs‑phone offer renders live + readout | classic experimentation, launched from a sentence |
| 12 · **MAB** | 4 hero creatives → traffic auto‑allocates to the winner | autonomous optimization, no manual ramp |
| 13 · **CMAB** | a different winning offer **per shopper context** | *the anti‑DY climax* — one experiment, a winner for each person |
| 14 · **AI Search** | "bags for a winter wedding" → real catalog rank **+ an AI‑generated styled image** | genuine language understanding over the real catalog *(see §6)* |
| 15 · **AI Style Concierge** | a styling question → on‑brand advice + real product picks | a personal stylist, in the storefront *(see §6)* |

**Buy‑signal:** the first add‑to‑cart automatically fires the **pay‑over‑time (BNPL)** surface — we *act* on intent, we don't just log it.

---

# 5. A/B, MAB, and CMAB — the experimentation rigor

These are capabilities 11–13, and they're the proof that this is **real experimentation, not a slideshow.**

- **A/B** — the classic. Two value exchanges in the same slot (15% off for email vs 10% off for text); Optimizely tells us which wins. **Built and launched from one sentence to Opal — no developer, no ticket.**
- **MAB (multi‑armed bandit)** — autonomy. Four creatives, and traffic **moves to the winner automatically** with no manual ramp. Perfect for a time‑boxed drop.
- **CMAB (contextual bandit)** — **the climax.** *One* experiment that serves a **different winning offer to each shopper context** — new visitor, Gen‑Z, mobile, returning. *"DY knows the neighborhood — a postal‑code average. We know the shopper, and we serve each their own winner, in real time, at the edge."*

**How we talk about it:** **we create the experiment, and we launch it.** When we do, it's **real** — the flag and the rule exist in Optimizely and you can open `app.optimizely.com` and *see them*. The full cycle runs. The **lift/readout numbers are illustrative for today**; the measurement is GA and runs on real traffic over time. *(No mirrors — see §7.)*

---

# 6. Beyond the brief — the art of the possible *(extras I built to show what's possible)*

These two weren't strictly required — **I went the extra mile** to show Tapestry the range of what we can do. They're real, working capabilities; I'm just flagging them as *"look what else is possible,"* not table stakes.

- **AI Style Concierge / Stylist.** A genuine personal stylist inside the store: ask it *"what should I carry to a winter wedding?"* or *"build me a capsule around the Tabby"* and it replies on‑brand and recommends **real catalog products**. It shows Tapestry that personalization isn't just ranking — it can be **advice, taste, and a relationship.**
- **AI image generation, injected into Search.** Search doesn't just return smart product results — for the **single product the search AI judges most relevant**, we **generate a styled image on the fly**: we take a background scene and **composite the real selected product into it**, producing fresh, on‑brand campaign imagery in seconds. The image is **AI‑generated, live, from the real product** — so the customer sees not just *"here are matches,"* but *"here's the hero shot for the one that fits you best."* This is the kind of novelty that makes a room lean in.

I built these to make one point to Tapestry: **we're not matching Dynamic Yield — we're showing them a different league.**

---

# 7. What's real vs. what's swappable — *there are no mirrors here*

I want the team certain on this, because it's our credibility:

- **This is all real and fully functional.** No mockups, no Figma prototype, no animation pretending to be software. Every experience the customer touches **works.**
- **The flags and experiments are launched for real** and are **visible in the Optimizely UI** — we can open the project and show them existing. We can run the **entire cycle**, live.
- **The only thing that's different from production is the data source.** Today some data is synthetic stand‑in; in production it points at **Tapestry's own data — their CDP/ODP, their warehouse, Optimizely Analytics — via configuration, not a rebuild.**
- **It all runs on the Cloudflare edge.** That means it's fast, it's global, and the **engineering maintenance burden is trivial.**

**The line:** *"Everything Tapestry will see is real and running at the edge. The only thing we'd change for production is pointing it at their data instead of ours."*

---

# 8. The intelligence layer — and what it means for Opal

Today the conversational intelligence runs on a **Gemini model** — **the same model class Opal runs on.** That's deliberate: it means everything here **translates to Opal natively and easily.** "Search and the concierge, powered by Opal" isn't a stretch — it's the same engine.

And this is the strategic heart of it: **what we've built makes Opal ~100× more capable.** We're giving Opal — or any model — the ability to **personalize with intelligence**: to read the data, build the audience, launch the experiment, generate the experience, and optimize it — **with virtually no UI.** Everything we've proven here — how we talk to the APIs, how we create audiences, how we analyze — **is exactly what needs to live inside Opal.**

---

# 9. The honest roadmap — and the ask to leadership

I want to be straight with the team about where this is and what we need.

**What it is:** a POC built in **~3 days.** The architecture is **solid** — but a POC is not an enterprise product. To make it production‑grade for Tapestry it needs the things that make software enterprise: **proper logging, observability, security hardening, validation, safeguards, resilience.** That's **weeks** of work, not an afternoon.

**What I'm confident we can promise:**
- **Something functional in a matter of weeks**, in partnership with Tapestry.
- **A complete, production platform in a matter of months** — *with the understanding that this is an ongoing collaboration of innovation.*
- A lot of what's here today is built on **assumptions** — how the style concierge should behave, how surge/curation logic should work. Those were *my* best guesses; **they need to become Tapestry's actual operating rules.** That takes discovery and iteration with them. Not months and years — but a real, ongoing partnership.

**Why this is bigger than one deal:** everything we've built here is **reusable across many customers** — this very codebase is already the base for several demos. What we deliver to Tapestry **upgrades what we can offer everyone.**

**The one thing I need leadership's help with:** the highest‑value move is getting these capabilities **integrated into Opal** — and that depends on a team whose priorities may not be aligned with ours. **I'm not asking anyone to *reprioritize* Opal.** I'm saying: **what we're proposing makes Opal better** — it gives Opal the exact skills and capabilities our customers are asking for *right now.* I need leadership to help us get the Opal team's partnership so this lands where it has the most leverage.

---

## The close — the line for tomorrow

> **Dynamic Yield is one cog. Optimizely is the entire machine.**
>
> Anyone can hand a customer a segment. We bring the expertise and the system to turn that segment into a personalized, optimized, measured experience — first‑party data, real‑time generation, autonomous experimentation, and the partnership to run it. **That's not a feature. That's a platform. And it's 100× the value.**

*Open it, play it with Auto, and let's go win tomorrow.*
**→ https://edge-platform.expedge.workers.dev/storefront**
