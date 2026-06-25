# Comprend POV — "Personalization Rethought: From Product-Led to Signal-Led"

> **Working brief for AI-agent conversation.** Extracted from partner deck (Comprend), 7 slides.
> Audience framing is Coach / Tapestry — slide 6 explicitly references *"Coach said no last time."*
> Deck subtitle: *how brands win the Gen Z customer they cannot otherwise reach.*

---

## The core idea in one line

Personalization should be driven by **real-time signals**, not stored **profiles / segments**. Opal watches what's happening in the world right now (a TikTok spiking, weather, an influencer placement), generates creative variants against that moment, and pushes them to market through experimentation — fast enough to catch a window that closes in ~30 minutes. Multi-armed bandits (MABs) do the live optimization so no human has to approve each bet.

---

## The three flagged slides (2, 3, 4)

### Slide 2 — The economic re-frame (the "why this matters" / business case)

**Headline:** *Cut the cost of converting demand. Spend the savings creating it.*

The argument: AI is collapsing the cost of lower-funnel (conversion) activity while scaling its reach; reinvest those savings into upper-funnel brand / preference, which compounds back into lower-funnel efficiency. Pitched as *the conversation CMOs across luxury and premium are having right now.*

The before/after economic model on the slide:

| | Awareness | Preference | Conversion |
|---|---|---|---|
| **Today** | 20% of spend | "small" | **80% of spend** |
| **The opportunity** | *scaled, signal-driven* — **100x reach** | (folded into Awareness) | **60% lower cost** |

Caption: *AI handles creative production (derivative content), variant generation, and decisioning at signal speed.*

### Slide 3 — The signals (the heart of the use case)

**Headline:** *Signals are the new primary input, not segments.*

**Thesis:** *Gen Z is not won with profile-based personalisation. They are won with real-time, signal-driven activation. The signals worth designing around already exist. Most retailers cannot yet act on them.*

The six signal types — the menu for the agents to react to:

1. **Weather** — Raining in New York? Serve raincoats, not swimsuits. The most basic real-time signal, and most retailers still can't do it.
2. **TikTok velocity** — Content breaking on TikTok creates a ~30-minute window to convert attention into traffic.
3. **Cultural trends** — Spotify trends, viral audio, what's rising in Gen Z culture right now, feeding creative and audience choices.
4. **Geographic mobility** — Movement between cities / contexts as a trigger, not a static home address.
5. **Store proximity & POS** — A customer walking into a store with their membership card on their phone is a personalization signal.
6. **Influencer triggers** — A single influencer placement can clear online inventory in 20 minutes. Detect it, amplify it, before it cools.

### Slide 4 — The proof point / urgency (why AI must decide, not humans)

**Big stat:** *30 minutes* — the window from a TikTok moment hitting to your ad being live before the moment is gone.

*What we have seen on the ground:* at one large global fashion brand, a single influencer placement cleared the **entire online inventory of a SKU in roughly 20 minutes.** No human team analyzes fast enough to amplify that in time. **The decisioning has to be delegated to AI, and the organization has to be willing to let small bets run without sign-off.**

> The last clause is the real ask — it's as much an operating-model change as a tech one.

---

## Supporting slides (context the agents will need)

### Slide 5 — Seven capabilities it takes, and where they live

*Optimizely is not the whole answer, but it is the core enabler.* The capability → home → owner table:

| Capability | Where it lives | Owner |
|---|---|---|
| Real-time signal layer | Partners + ODP for activation | **Partners** |
| Unified customer data platform | Optimizely Data Platform (ODP) | Optimizely |
| Generative creative at signal speed | **Opal AI** | Optimizely |
| Experimentation engine w/ hypothesis discipline | Web Experimentation | Optimizely |
| Personalised landing experiences | Personalization + Web Experimentation | Optimizely |
| Analytics that decompose what drove an outcome | Optimizely Analytics | Optimizely |
| Permission for AI to act on small bets | **Governance, not technology** | Partners |

**The tell:** the two things Optimizely *doesn't* own are (1) the signal-ingestion layer and (2) the governance / permission to let AI act. Those are partner / organizational, not platform.

### Slide 6 — The adoption path (the "staircase, not a leap")

Framed directly at winning Coach back: *Coach said no last time because the destination felt too far. The way back in is a sequence of confident, measurable steps.*

1. **Prove the hypothesis** — One Gen Z signal (TikTok velocity or weather), one landing surface. Opal generates variants, Web Experimentation serves and measures. Tight scope, fast result.
2. **Build foundation** — Add a second signal, expand to a second surface, connect ODP for proper audience activation. Begin building the signal-to-experience loop as standard.
3. **Scale to autonomy** — Introduce autonomous decisioning; AI runs the loop on low-risk variants without human approval. *Where velocity becomes a transformation story.*

---

## The signal-to-market loop, abstracted (for mocking)

The deck's mechanics as a pipeline the agents can design against:

```
DETECT  →  DECIDE  →  GENERATE  →  SERVE  →  OPTIMIZE  →  MEASURE  →  (loop)
```

- **Detect** — signal ingestion: TikTok / Spotify velocity, weather API, influencer monitoring, POS / geo
- **Decide** — Opal interprets the signal, picks the angle
- **Generate** — Opal produces derivative creative variants tuned to the moment
- **Serve** — Web Experimentation / Personalization pushes variants to a landing surface
- **Optimize** — MAB allocates traffic to winning variants live
- **Measure** — Analytics decomposes what drove the outcome

The whole cycle has to close **inside the window the signal is open (~20–30 min).**

---

## Open questions for the AI agents — where the demo gets interesting (and where to be careful)

A few things to flag before designing the mock, because the deck makes some claims that are *vision*, not *shipping today*:

- **Signal ingestion is explicitly a partner / non-Optimizely component** (slide 5 lists it under Partners). The "Opal monitors social media" framing is the part that doesn't exist out of the box — there's no native TikTok / Spotify-velocity listener in Opal. For the demo, this is the piece most clearly **mocked**: a synthetic "trending signal" feed standing in for a real social-listening integration. Consistent with the mock-the-data-not-the-capability approach — just be explicit that the *detect* stage is simulated.

- **The "Opal generates variants → MAB serves them" loop is the most demo-able piece** and maps cleanly onto the existing Pillar A/B work — Opal creating variants and experimentation measuring them is real. The thing to validate (still open from the Seth thread) is **MAB / CMAB exact support in the relevant Optimizely product** for the live-optimization step.

- **The autonomous "act without sign-off" step (slide 6, step 3) runs into the draft-only / human-publish governance constraint** already documented in the Coach brief. The deck wants AI acting on small bets without human approval; today's remote-MCP reality is draft-only with a human Publish click. Not necessarily a contradiction — frame the human approval as the governance beat for now and autonomy as the roadmap — but the agents should know step 3 is aspirational against current constraints.

- **The economic figures (100x reach, 60% lower cost, 80/20 spend split) are Comprend's framing, unsourced on the slides.** Fine as narrative; don't put them in front of Coach as Optimizely's numbers without knowing where they came from.

**The productive question to open with the agents:**

> Given that detection is mockable and generation + serving + optimization is largely real, what's the tightest end-to-end *"trending TikTok → Opal variant → MAB-optimized landing surface"* demo we can stand up that's honest about which stages are simulated?

This is a clean extension of the cold-start / synthetic-data work already scoped.
