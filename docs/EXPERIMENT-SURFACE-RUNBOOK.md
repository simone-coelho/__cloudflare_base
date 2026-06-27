# Experiment Surface — Presenter Runbook (exact script)

_What it is, what you say/click, and what you SEE — for A/B, MAB, and CMAB._

## What this is, in one breath
There's a **prominent banner/hero at the top of the store** (the "experiment surface"). You — or Opal — **launch an experiment**, and that banner **instantly becomes the experiment's variation**. You then **flip between variations live** in front of the room. It's the same banner block every time; only the content (image, headline, offer, button, email/phone field) changes.

## Can I only do email-vs-phone? No — there are 5, covering all 3 types
| Pick this | Type | What it tests | What the banner shows |
|---|---|---|---|
| **welcome_email_phone** | **A/B** | email-for-15% vs phone-for-10% | "15% off · email field · GET MY CODE" ⇄ "Save 10% by text · phone field · TEXT MY CODE" |
| **hero_creative_bandit** | **MAB** | 4 hero creatives, auto-optimized | Editorial ⇄ Best-seller ⇄ Free charm ⇄ Monogram |
| **context_welcome** | **CMAB** | a different offer per shopper-context | New-visitor 15% ⇄ Gen-Z drop ⇄ Mobile SMS ⇄ Returning "Edit" |
| **move_brooklyn** | **MAB** | sell a slow line with NO markdown | Craft story ⇄ "Quiet alternative to Tabby" ⇄ Scarcity |
| **bnpl_rogue** | **A/B** | pay-in-4 on the $595 Rogue | "$595" ⇄ "Pay in 4 · $148.75 ×4" |

## Is it automatic, or do I do something? — BOTH now
- **Hands-free on beats 11–13:** clicking **Next** to **beat 11 (A/B), 12 (MAB), or 13 (CMAB)** now **auto-launches the real experiment, renders the banner live on the store, AND shows the Engine readout** — no extra steps. (Beat 11 → email-vs-phone · 12 → hero-creative bandit · 13 → context-welcome.)
- **On-demand anytime:** **Opal** ("launch the email-vs-phone welcome test") creates the flag and the banner comes to life; or **⌘K → "Show experiment variation"** to flip to any A/B/MAB/CMAB arm (all 5 are always in the list).
- **Buy-signal (acts on intent we used to ignore):** the moment a shopper **adds to cart** (ready-to-buy), the store **auto-fires the Pay-over-time (BNPL) experiment surface** and logs a **"BUY SIGNAL · READY-TO-BUY → pay-over-time experiment"** card in the Activity panel. (Beat 9 adds to cart, so this fires naturally there too.)

The **Engine-tab readouts** are the *measurement* view; the **banner** is the *shopper* view — beats 11–13 now show both at once.

> If "they say in the demo: we want to create a flag" → you do the **Opal** path (below). That's exactly the create-a-real-flag moment.

## The script

### 1) A/B — lead with this (simplest, most relatable)
1. **Open the Opal tab**, type: *"Launch a welcome A/B test — email for 15% off vs phone for 10% off."*
   - (Reliable alternative: **⌘K → "Show experiment variation" → "Email · 15% off"**.)
2. **SEE:** the store lands on Home and the top hero becomes **"THE COACH LIST — 15% off your first Coach"** with an **email field + GET MY CODE**. A **real `a/b` flag** (`xsurf_welcome_email_phone`) now exists in Optimizely.
3. **⌘K → "Phone · 10% off."** **SEE:** the *same* banner becomes **"COACH TEXTS — Save 10% by text"** with a **phone field + TEXT MY CODE**.
4. **SAY:** *"Same slot, two value exchanges — Optimizely will tell us which one customers prefer and at what discount. We built and launched it from a sentence — no developer, no ticket."*

### 2) MAB — autonomy
1. Opal: *"Run a multi-armed bandit on the homepage hero with four creatives."* (or **⌘K → any "Hero creative bandit" variation**)
2. **SEE:** the hero shows the **Editorial** creative. **⌘K-flip** through **Best-seller → Free charm → Monogram** — four genuinely different heroes from one block.
3. **Go to the Engine tab** (or Next to beat 12): the **MAB readout** shows traffic **auto-allocating to the winner** over rounds.
4. **SAY:** *"Four ideas, zero meetings. The bandit moves traffic to the winner automatically — no manual ramp. Perfect for a time-boxed drop."*

### 3) CMAB — the anti-Dynamic-Yield climax
1. Opal: *"Launch a contextual bandit that personalizes the welcome offer by shopper context."* (or **⌘K → any "Context-aware welcome" variation**)
2. **SEE:** the banner shows the **new-visitor** offer. **⌘K-flip** to **"Gen-Z · the drop"** (slim banner), **"Mobile · SMS"**, **"Returning · the Edit"** (elegant card) — each context a different experience, same block.
3. **Engine tab** (or beat 13): the **per-context winners table** — Mobile Tabby-lover → Complete-the-Look, **Gen-Z-at-payment → BNPL**, etc.
4. **SAY:** *"One experiment, a different winning offer for each shopper. Dynamic Yield knows the neighborhood — a postal-code average. We know the shopper, and we serve each their own winner, in real time, at the edge."*

## Prove it's real (not a mockup)
After an Opal launch, open **app.optimizely.com → the project → the flag** (`xsurf_welcome_email_phone`, `xsurf_context_welcome`, …) → real variations + rule are right there.

## Your honesty line (say it; nothing in the UI says it)
*"The experiences and the events are real and live at the edge. The lift figures are illustrative for today — the measurement is GA and runs on real traffic over time."*

## 30-second warm-up (do this before you present)
So the real flags already exist (and Opal's first launch is instant), launch each once beforehand — ask Opal, or hit the launch endpoint once per scenario id (`welcome_email_phone`, `hero_creative_bandit`, `context_welcome`, `move_brooklyn`, `bnpl_rogue`). The ⌘K "Show experiment variation" list works regardless (it always has all five).

## Status
Hands-free beats (11/12/13) and the add-to-cart buy-signal trigger are **implemented + verified on prod**. The payment-stall trigger inside the Revenue Radar checkout is the other team's file — a coordination item, not done here.

## Signal-Led Moment (TikTok) — the encore (anti-DY climax)
After beat 15, click **"Show the Signal-Led Moment ▸"**. Three scenes:
1. **DETECT** — a signal toast: *"Coach Tabby spiking on TikTok · +480% views/hr · NY"*, and a live **window countdown** (28:00) starts. *Say:* "A bag is going viral right now — ~28 minutes before it cools; no human team reacts this fast." Honesty chip: **SIMULATED · partner social-listening layer, not Optimizely.**
2. **GENERATE** — Opal writes the copy and we generate the hero **live from the real Tabby photo** (~8s, with an honest "generating…" status so it never looks stuck). *Say:* "Model-written copy + an AI-generated scene of the *real* bag — delivered as **feature variables** over our module. No HTML."
3. **SERVE + OPTIMIZE** — the storefront does a full-bleed **takeover** ("As seen on TikTok — The Tabby everyone's talking about"); the **MAB** auto-promotes the winner inside the window; *"loop closed in m:ss of 28:00."* *Say:* "Dynamic Yield reacts to the neighborhood. We react to what's happening in the world **right now**."

**Real:** hero image (Gemini), copy (Opal), the flag + `multi_armed_bandit` rule (`xsurf_tiktok_tabby_moment`), the discrete feature variables. **Mocked:** only the TikTok signal (partner layer, badged). **Representative:** the lift figures (narrate; nothing in the UI claims measured). Your honesty line: *"The experience and the events are real and generated live at the edge; only the social-listening signal is simulated, and the lift is illustrative."* Full design + step list: `docs/architecture/12-signal-led-moment-build-brief.md`.
