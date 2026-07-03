# Coach — Monday Demo & Customer Doc (Field Brief)

**Audience:** Account Executive, Customer Success, Solutions/Sales Engineering
**From:** Simone
**Share alongside:** [Real-Time Behavioral Personalization on Optimizely — Architecture Overview](./Coach-Realtime-Behavioral-Personalization-Architecture.md) — the customer-facing architecture doc for Coach's engineering lead.

---

Team — three things: the doc we're sharing with Coach, what I'm building for Monday's demo, and how it fits together with the ODP demo. Short version of each. 👇

## 1) The customer doc (attached)

It tells Coach: the real-time personalization foundation you've seen **already exists** — our edge runtime + ODP + Feature Experimentation. ODP is the durable, **first-party** behavioral memory. The one thing a Dynamic Yield–style experience adds on top is an **instant, in-session reflex** — and that's a layer we **designed on top of ODP and are already building**. It gives them the affinity-audience capability they're benchmarking against DY, plus what DY can't offer: their own first-party data (not a Mastercard-owned graph), full transparency and governance, and a headless-native, server-side architecture (no snippet injection). It's deliberately framed as *refining an advanced plan with them* — not building from scratch — because that's the truth.

## 2) What I'm building for Monday (the demo)

The behavioral affinity engine, live on our Coach storefront. What the room sees — three beats:

1. **Affinity builds.** A shopper browses Tabby bags → her "Tabby" affinity bar **fills in real time on screen** → she crosses the threshold → the **"Tabby Affinity" audience lights up** → the hero **swaps instantly**.
2. **Affinity shifts.** She wanders to totes → Tote affinity rises while Tabby **visibly decays** → she **exits Tabby Affinity and enters Tote Affinity**, live → the content changes again.
3. **Affinity fades.** She goes idle → scores decay → she **drops out** of the audience → content reverts. Nobody maintained a list — the behavior did everything.

That is exactly the DY capability Mandeep asked about — audiences that build themselves, that shoppers move in and out of — except: it reacts in **milliseconds**; every audience is a **transparent rule generated from Coach's own catalog** (that's where names like "Tote Affinity" come from — the catalog, not magic); and every event **feeds their ODP**. No black box, no AI in the render path — deterministic scoring, which is what DY actually is under the hood.

**Status: I'm building this right now.** It's an extension of the engine we already have — most of the plumbing exists — not a from-scratch build. **Ready by Monday.**

## 3) How it fits with the ODP demo — one story, two speeds

The ODP team shows the **memory**; I show the **reflex**. Same story, two acts:

- **Act 1 — ODP (their demo): the foundation exists today.** Behavioral signals → unified first-party profile → dynamic affinity audiences updating in near-real-time (~90 seconds) → personalized content. This directly answers Mandeep's stated goal for Monday: *prove the behavioral personalization foundation exists today.*
- **Act 2 — the edge reflex (my demo): the layer on top.** The same shopper story, but the reaction is **in-session and instant**, shoppers visibly move in *and out*, and every event flows **into that same ODP profile**.

**The handoff line:** *"What you just watched ODP do in about a minute — now watch it happen in milliseconds, inside the session, feeding the same profile."*

Why this works: the two demos don't compete — **Act 2 makes Act 1 stronger.** ODP's ~90-second refresh stops being a "versus DY" latency question and becomes what it really is: the durable memory cadence — with the edge covering the instant part. That combination is the thing DY cannot do on data Coach actually owns.

**Coordination asks (small but important):**
- Use the **same audience names in both demos** (e.g., "Tote Affinity") so it reads as one system, not two products.
- Sequence: **ODP first, reflex second** — foundation, then the beyond-DY moment.
- Shared vocabulary: **"ODP is the memory; the edge is the reflex."** One system, two speeds.
- The AI page/module-reordering topic stays a **brief roadmap conversation** (Mandeep's own framing) — don't let it eat demo time.

## 4) The extra mile (proposed to the ODP team)

If the ODP team gets me **API access to the ODP demo account by EOD Friday**, the two acts become **one live system**: my storefront forwards every behavioral event into *their* ODP in real time — so Mandeep watches my screen react in milliseconds, and ~a minute later **their ODP screen shows the same shopper qualifying into the same-named segment**, fed by live traffic from the room. Encore: a returning session **seeds from the real ODP profile** — the full cycle, both directions, live.

**Zero added risk by design:** the ODP connection is additive in the engine. If access doesn't land in time, I mock that seam, the reflex demo runs standalone, the ODP demo stands on its own — nothing breaks. If it lands, the Dynamic Yield conversation ends in that room.

Questions, or want a walkthrough before Monday — grab me.
