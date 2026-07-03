# Demo Presenter Runbook — the full narration script

_Read this top to bottom and you can narrate the **entire** demo, even if you've never given it. For each step: **Do** (what you click), **See** (what appears), **Say** (script-safe narration). Keep moving — the whole thing is ~10–12 minutes._

**Demo URL → https://edge-platform.expedge.workers.dev/storefront**

---

## 0 · Before you start (2 minutes)
- **Open the store** at the URL above (land directly on `/storefront`).
- **Warm up the experiments** so they're instant and already visible in Optimizely: ask Opal to launch each once, or hit the launch endpoint for the 5 scenario ids (`welcome_email_phone`, `hero_creative_bandit`, `context_welcome`, `move_brooklyn`, `bnpl_rogue`). The ⌘K "Show experiment variation" list works regardless.
- **Live writes:** if you'll create audiences/flags live, confirm `OPTIMIZELY_WRITE_ENABLED='true'` + token is set. Without it, **experiments still render** (surface + readout); audiences/flags render nothing.
- **Reset** between runs: Demo Director **Restart** / Radar **↺**.
- **Multi-presenter safe:** every browser is its own isolated session — Demo Director, Opal chat, the geo-cohort, and the WebSocket are all per-session. The whole team can run the demo at once, from different cities, with **no crossover**.

## 1 · The cockpit — say this in one breath
> "This is Coach's storefront, running live at the edge. On the right is the **Demo Director** — I'll hit **Start** then **Next** (or **Auto** to play it hands-free). Every step logs a **Signal → Segment → Decision** card in the **Activity** panel, each with a **⤢ Compare** slider so you see before-and-after. Down here are four tabs: **Opal** (talk to it — build audiences and launch experiments in plain English), **Capabilities** (our 15-point scorecard, lighting up as we go), **Engine** (the measurement readouts), and **Radar** (the revenue-operations brain)."

---

## 2 · THE OPEN — Cold start that beats Mastercard *(our sharpest moment — slow down here)*
- **Do:** load the store — the cold start fires automatically from your **real** location. Demoing from outside the Triad? It still works: **every US state** shows its own real census. Force a city via ⌘K → **"Preview as location"** (Winston-Salem / New York / San Francisco / Austin / Philadelphia / Chicago) **or** a bookmarkable link — **`/storefront?cohort=NY`** (state code) or **`?cohort=austin`** (city slug).
- **Presenter-agnostic (no risk if you're not in WS):** from Winston-Salem you get the metro cohort (N=320, real NC receipts, `$65,903`). From anywhere else you get that state's **real ACS 2024 income** + a representative cohort — the card honestly reads *"representative cohort · your {State} customers' own history in production."* Either way it lands.
- **See:** the store opens on **"The Tabby leads near you"** — a hero + grid built from what Coach shoppers *in this metro* actually bought (Tabby / Brooklyn / Pillow Tabby), plus a provenance card citing **real median income $65,903 (Census ACS 2024)**.
- **Say:** *"Cold start, no profile — but we're not guessing. Dynamic Yield rents Mastercard's neighborhood spend AVERAGE by ZIP — third-party, no purchase intent. We open on what shoppers like you, from right here, actually bought — your own receipts — and the income signal is free from the census."*
- **Then:** Radar tab → the **"◑ DY vs us"** modal. *Say:* *"Their third-party ZIP average, side by side with our first-party cohort. And this is a real operation — real geolocation, a real query; only the data is swapped: sample today, your warehouse in production, one flag, no code change."*
- **Honest / fair (carry it):** *"We curate, never price or gate by geography; always aggregate — 'shoppers like you, from here,' never the individual. It's the opening prior — the moment they engage, it sharpens into a live persona."*

---

## 3 · The 15 capabilities — top to bottom
_Hit **Next** to walk each one (or **Auto**). Each posts an Activity card + a Compare slider._

**1 · Customer profile (no sign-in)** — **See:** anonymous visitor → identity minted (Engine) + welcome ribbon. **Say:** "We personalize from the first second — no login, no cookie wall."

**2 · Cold-start data** — *(the opener above; if Auto lands it here, deliver the §2 lines).*

**3 · Real-time updates** — **See:** she views the Tabby ×3 → the hero reshapes **live, no reload**. **Say:** "It reacts *as it happens* — not on her next visit."

**4 · Recommendations** — **See:** "best-sellers, same for all" → *her* specific picks. **Say:** "One-to-one, not one-to-many."

**5 · Sort rules — baseline** *(the control)* — **See:** standard rule-based product order. **Say:** "This is the 'before' — the order everyone gets. Watch what happens next."

**6 · Personalized sort** — **See:** the same page **re-ranks** — her favorites rise. **Say:** "Merchandising that rearranges itself for the shopper."

**7 · Page structure** — **See:** a plain product page → a **"Complete the Look"** module assembles. **Say:** "The *layout itself* personalizes — not just the words."

**8 · Page content** — **See:** generic hero → her hero (copy + image), same layout. **Say:** "Same slot, her content."

**9 · Journey-stage** — **See:** she adds the bag → "ready-to-buy" tone, **and the buy-signal fires the Pay-over-time (BNPL) surface** + an Activity card. **Say:** "The moment she's ready to buy, we act on it — that's a signal most sites ignore."

**10 · Opal audience builder** — **Do:** Opal: *"Build an audience of Gen-Z mobile shoppers who viewed the Tabby."* **See:** a **real audience published**; the banner can go live. **Say:** "A real audience — built by *typing a sentence.* No SQL, no developer, no ticket."

**11 · A/B test** — **Do:** Next auto-launches it (or Opal: *"Launch a welcome A/B — email for 15% vs phone for 10%."*). **See:** the top surface becomes the variation (email field + GET MY CODE); ⌘K flips to the phone variant; a **real `a/b` flag** (`xsurf_welcome_email_phone`) now exists. **Say:** "Same slot, two value exchanges — Optimizely tells us which wins, and at what discount. Built and launched from a sentence."

**12 · MAB** — **Do:** Next (or Opal: *"Run a bandit on the hero with four creatives."*). **See:** Editorial → Best-seller → Free-charm → Monogram; the Engine shows traffic auto-allocating. **Say:** "Four ideas, zero meetings — the bandit moves traffic to the winner automatically. Perfect for a time-boxed drop."

**13 · CMAB — the anti-DY climax** — **Do:** Next (or Opal: *"Launch a contextual bandit that personalizes the welcome offer by context."*). **See:** a different winning offer per context (new-visitor / Gen-Z / mobile / returning); the Engine shows per-context winners. **Say:** "One experiment, a different winner for *each* shopper. Dynamic Yield knows the neighborhood — a postal-code average. We know the shopper, and we serve each their own winner, live, at the edge."

**14 · AI Search** — **Do:** search *"bags for a winter wedding."* **See:** a ranked grid of **real catalog** products **+ an AI-generated styled image** for the top pick. **Say:** "There's no 'wedding' tag in the catalog — the model *understands* the words and maps them onto real products. And for the best match, it generates a styled hero shot on the fly from the real bag." *(Art-of-the-possible extra.)*

**15 · AI Style Concierge** — **Do:** ask *"What should I carry to a winter wedding?"* **See:** an on-brand reply + a styled look + **real catalog picks**. **Say:** "A personal stylist inside the store — advice and taste, grounded to real products it can't invent." *(Art-of-the-possible extra.)*

→ The **Capabilities** tab now reads **15/15.**

---

## 4 · Revenue Radar — find the money, fix it, prove it
- **Do:** Radar tab → click **Coach → Gen-Z** pill.
- **See:** the headline jumps to **$7,623 recoverable / 44.3% drop**; the payment step turns red (the "all-average hid it" reveal).
- **Say:** "Across all customers this checkout looked fine. Segment to Gen-Z and it collapses 44% at the payment step — about $7,600 walking out the door."
- **Do:** **⚡ Launch experiment** on the BNPL (pay-over-time) card. *(Optional: **Simulate drop-off** to swell the leak live; **▶ Play story** for the narrated arc.)*
- **See:** "Experiment live · +48% lift · 96% conf"; the funnel recovers.
- **Say:** "It found the leak, built the fix, launched a real experiment, and proved the recovery — in the room. Not a report you read next quarter."
- **Honesty:** "The Radar is fully functional. The data feeding it is sample data today — it maps directly to **Optimizely Analytics** for Tapestry; we just swap the source. Right now we emulate the signals and events; in production your **CDP/ODP** feeds it."

## 5 · The Engine tab — the measurement view
> "This is the measurement side. For the A/B you see conversion per variation; for the MAB, traffic auto-allocating to the winner over rounds; for the CMAB, the per-context winners table — Mobile Tabby-lover → Complete-the-Look, Gen-Z-at-payment → BNPL. The experiences are real and live; the lift figures are illustrative for today — measurement is GA and runs on real traffic over time."

## 6 · The encore — TikTok Signal-Led Moment *(reacting to the world in real time)*
After beat 15, click **"Show the Signal-Led Moment ▸"**. Three scenes:
1. **DETECT** — toast: *"Coach Tabby spiking on TikTok · +480% views/hr · NY"*; a **28:00 window** counts down. *Say:* "A bag's going viral right now — ~28 minutes before it cools; no human team reacts this fast." *(Honesty chip on screen: SIMULATED · partner social-listening layer.)*
2. **GENERATE** — Opal writes the copy; we generate the hero **live from the real Tabby photo** (~8s, with an honest "generating…" status so it never looks stuck). *Say:* "Model-written copy + an AI scene of the *real* bag — delivered as **feature variables,** not hand-coded HTML."
3. **SERVE + OPTIMIZE** — a full-bleed **takeover** ("As seen on TikTok"); the **MAB** auto-promotes the winner inside the window. *Say:* "Dynamic Yield reacts to the neighborhood. We react to what's happening in the world **right now** — and we closed the loop in minutes."

---

## 7 · Honesty lines (drop these naturally — nothing in the UI says them)
- **Experiments:** *"The experiences and events are real and live at the edge — these are real flags you can open in Optimizely. The lift figures are illustrative for today; measurement is GA over real traffic."*
- **Cold start:** *"Real geolocation, real query — only the data is swapped: sample now, your warehouse in production."*
- **Radar:** *"Fully functional; the data maps to Optimizely Analytics / your CDP — we just swap the source."*
- **TikTok moment:** *"Everything's real and generated live; only the social-listening signal is simulated, and the lift is illustrative."*

---

## Reference

### The 5 experiment scenarios (all 3 types)
| Pick | Type | Tests | Surface shows |
|---|---|---|---|
| `welcome_email_phone` | **A/B** | email-for-15% vs phone-for-10% | email field + GET MY CODE ⇄ phone field + TEXT MY CODE |
| `hero_creative_bandit` | **MAB** | 4 hero creatives, auto-optimized | Editorial ⇄ Best-seller ⇄ Free charm ⇄ Monogram |
| `context_welcome` | **CMAB** | a different offer per shopper-context | New-visitor ⇄ Gen-Z drop ⇄ Mobile SMS ⇄ Returning "Edit" |
| `move_brooklyn` | **MAB** | sell a slow line with NO markdown | Craft story ⇄ "Quiet alt to Tabby" ⇄ Scarcity |
| `bnpl_rogue` | **A/B** | pay-in-4 on the $595 Rogue | "$595" ⇄ "Pay in 4 · $148.75 ×4" |

_Beats 11→`welcome_email_phone`, 12→`hero_creative_bandit`, 13→`context_welcome` auto-launch on **Next**. `move_brooklyn` and `bnpl_rogue` are reachable via Opal/⌘K; `bnpl_rogue` is the add-to-cart buy-signal scenario._

### On-demand anytime
- **Opal** ("launch the email-vs-phone welcome test") creates the flag and the surface comes to life.
- **⌘K → "Show experiment variation"** flips to any A/B/MAB/CMAB arm (all 5 are always in the list).

### Prove it's real (not a mockup)
After an Opal launch, open **app.optimizely.com → the project → the flag** (`xsurf_welcome_email_phone`, `xsurf_context_welcome`, the TikTok moment `xsurf_tiktok_tabby_moment`, …) → real variations + rule, right there.

### Gotchas
1. **Write-gate:** writes off → audiences/flags/banners render nothing; **experiments still render** the surface + readout. (So experiments demo even with writes off.)
2. **Datafile lag (~20–30s):** a new flag is live in FX instantly, but the storefront SDK serves it after the datafile regenerates; the surface pre-renders the creative meanwhile — don't expect an on-the-dot flip.
3. **CMAB** may be created as a **draft** (`enabled:false`) pending review — expected; the rule is real and pullable in the UI.
4. **Fallback:** a rejected typed rule falls back to a targeted-delivery rule (`fellBack:true`) — check before claiming "A/B is live."
5. **Reset** between runs (Director Restart / Radar ↺) clears the surface, buy-signal, and funnel sim.

### Status / confirm before the room
Hands-free beats (11/12/13), the add-to-cart buy-signal, the Signal-Led Moment, and the Geo-Cohort Cold Start are **implemented and verified on the demo worker** (the URL above). **Confirm:** the payment-stall trigger inside the Radar checkout is the other team's file — a coordination item, verify it before relying on it. Full specs: cold start → `docs/architecture/13-geo-cohort-coldstart-prd-tdd.md`; moment → `docs/architecture/12-signal-led-moment-build-brief.md`; capability map → `DEMO-MASTER-PLAYBOOK.md`.
