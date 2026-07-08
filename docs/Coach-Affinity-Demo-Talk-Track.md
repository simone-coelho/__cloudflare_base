# Affinity Demo — Talk Track (customer session)

*Simone's in-room card. Glance, don't read. Companion: [Technical Design](./Edge-Affinity-Reflex-Technical-Design.md) · [ODP Wiring Spec](./Coach-ODP-Wiring-Spec.md).*

---

## The opening frame (say this before the first click)

> "You asked whether we can do what Dynamic Yield does with behavioral affinity — audiences that build themselves, that people move in and out of, that decay. That's what I'm going to show you, live. Everything you'll see runs on two layers: **ODP, which is the product today and holds the memory** — the events, the profile, the real-time segments, the persistence — and **an edge layer we've built on top of it** that makes the experience react in **milliseconds**, in-session. ODP is the memory; the edge is the reflex."

---

## The responsibility split (the one picture to leave in his head)

| | **ODP — the memory** | **Edge — the reflex** |
|---|---|---|
| Status | **GA product, today** | **Live in beta — running on our edge right now** |
| Owns | Event ingestion · unified first-party profile · **real-time segments** · persistence · predictive ML | Instant per-event affinity scoring · **decay** · catalog-generated audiences · in/out membership · instant content swap |
| Data flow | **Real time** — the event stream lands with our edge provider immediately | < 50 ms — decay, scoring, and membership computed on that stream |
| Data | The durable record — **raw facts** land here | Derived, in-session scores — computed at the edge, never sent as truth |

> "ODP owns the facts, the profile, and the audiences. The edge owns the decay and the scoring. The event stream between them is real time."

---

## Beat-by-beat lines (what to say at each click)

1. **Cold open** — "Anonymous shopper, zero history. Watch what the behavior alone does."
2. **First views** — "Every click is a raw event — a *fact*. It lands in ODP as the durable record. At the edge, the same fact is scored instantly."
3. **Bars rise / threshold crossed** — "Three views and she's entered **Tabby Affinity**. Nobody built that audience — it was **generated from your catalog**; the name is your product data plus the word 'Affinity'. Thirty-seven of these exist right now, generated, governed, editable."
4. **Content swaps** — "Membership changed, content changed. Milliseconds. In-session."
5. **The shift** — "Now watch her drift to totes: Tabby **decays** while Tote rises — she moves **out** of one audience and **into** another purely by behavior. That's the decaying-audience behavior you asked about."
6. **Idle decay-out** — "She walks away; her score fades; she exits — at a mathematically exact moment, not a nightly batch. Nobody maintained a list."
7. **The ODP tie-off** — "And everything you just watched also landed in ODP — same facts, durable profile, segments qualifying there under ODP's own rules. The edge made it instant; ODP made it permanent."

---

## The hard questions (his likely asks, your answers)

**"Where's the UI? What UI does this need?"**
> "Three surfaces. The **audiences live in ODP** — you manage them in the segment UI that exists today. The **engine is configuration-driven** — every weight, decay constant, and threshold is a named, versioned number; that's the no-black-box commitment kept: nothing is hidden inside a model. And the **merchandiser tuning surface** — sliders for weights and decay per dimension, audience review — is being specified right now, which is honestly one reason I wanted this session: we'd rather define those requirements with you than in a vacuum. What you saw on screen — the live instrument — is the first cut of that surface."

*(If pressed: per-dimension weights and decay are already supported in the engine's config model — the UI is the remaining skin, not a missing capability.)*

**"Is this ready to deploy?"**
> "Two answers for the two layers, deliberately. Everything on the **ODP side is GA product today** — nothing to wait for. The **edge layer is running live** — what you just watched isn't a video, it's deployed on our edge right now — and it's in **beta validation**. The math is finished and tested; what remains is productization: packaging, the tuning UI, per-tenant onboarding. So: deployable **now in a partnership motion**, boxed product after that hardening. You'd be coming in at the **end** of the build — shaping the last mile, not waiting on the first."

**"How is this not a black box?"**
> "Every audience is a rule you can read — *affinity ≥ 0.6*, that's the whole definition. Every membership change carries an **explain record**: the event, the score before and after, the threshold that fired. And we can **replay** any shopper's timeline and show exactly why every transition happened. Ask Dynamic Yield for that."

**"Where do the weights and decay settings live? Is any of this persistent?"**
> "Three homes. The **configuration** — weights, decay, thresholds — is versioned and stored; tuning is a config change, not a redeploy. The **audiences** persist as ODP real-time segments — ODP is the durable home. And the **behavior itself** persists on the ODP profile as raw events; optionally we write the live scores onto the profile as attributes too, so you can see the edge's view right on the ODP record."

**"What about latency between ODP and the edge?" (or: "isn't ODP ~90 seconds?")**
> "That number belongs to one specific implementation — the segment-qualification path, where ODP recomputes segment membership on its own cycle. Our integration doesn't sit on that path: we ride **ODP's immediate event stream** — the events land with us in real time — and the **edge computes the decay and scoring on that stream instantly**. We still read ODP's segments as durable seeds at session start, where a refresh cycle is perfectly fine — that's memory, not experience."

**"Is this Dynamic Yield parity?"**
> "On behavioral affinity — build, decay, move in and out, personalize — what you watched is the same class of computation DY runs; that's what affinity scoring *is*. I won't claim parity across their whole suite. What I'll claim: this capability, on **your first-party data**, inside **your ODP**, fully **transparent** — with Optimizely's experimentation and the rest of the platform around it. And theirs is owned by Mastercard."

**"What exists vs. what's being added?" (the honest ledger)**
> - **In ODP today (GA):** event ingestion, unified profile, real-time segments, persistence, predictive insights, the segment UI.
> - **At the edge, live in beta:** the affinity engine — scoring, decay, catalog-generated audiences, instant swap, explain records.
> - **Being finalized (with you, ideally):** the tuning UI for weights/decay, per-tenant packaging, and the ODP wiring in your environment.

---

## ⭐ The CMAB question — "Can we use these affinity audiences with your CMAB tests?"

**The headline answer:**
> "Yes — and better than you're imagining. The audiences sync to ODP for durable targeting. But for CMAB we do something stronger: the edge passes the live affinity **scores** directly into the decision as **context attributes**, at decide time, where they're freshest. The bandit then learns which experience wins for which affinity profile — automatically. **ODP holds the memory; the edge supplies the context; CMAB does the learning.**"

**The distinction to draw — affinity plays two roles in a CMAB test:**

| Role | What affinity does | How |
|---|---|---|
| **Gate** (targeting) | *Who enters* the test — "run this CMAB only for Handbags-Affinity shoppers" | audience **membership** (boolean) |
| **Context** (the C in CMAB) | *What the bandit learns on* — "editorial hero wins for high-Tabby; utility hero wins for high-Tote" | the numeric **scores** (0–1), passed as registered attributes |

> "**Memberships gate; scores teach.**"

**Mechanics, in one line:** our CMAB rules already personalize on registered context attributes (device, persona, journey stage today) — the affinity scores plug into **exactly that socket**; we curate the ~5–10 most meaningful features rather than dumping all 37 (bandits learn faster on focused context).

**Where does the decision happen?**
> "At the edge — `decide()` runs in our edge worker with the fresh vector passed in at that moment. ODP is **not in the decision path** — facts go to ODP, context goes to the decision. Routing the decision through ODP would add a loop for zero benefit; the edge already holds the freshest truth."

**If he pushes on timing/consistency (edge vs. ODP segment agreement):**
> "The edge is the leading indicator, so for **in-session** experiments we gate on the same attributes we pass at decide time; **ODP-segment targeting** is for durable, cross-session campaigns. The CMAB decision always uses the context we hand it in that instant — nothing waits on a sync."

**Guardrails for this answer:**
- The CMAB arm is served by Optimizely's decision service at decide time (cached per shopper) — **don't** claim it's pure local datafile math. **Do** say: "one cached call from the edge — and we pre-fetch on threshold-cross, so the swap stays instant."
- The learning loop needs **identity consistency** — decide() and the conversion event under the same shopper id (our stable-id work covers this).
- The separation still holds, extended: **raw facts → ODP** (its ML untouched) · **context attributes → CMAB** at decide time (its learning loop is FX events) · edge parameters travel to neither.

---

## Sound bites (drop these verbatim)

- "**ODP is the memory; the edge is the reflex.**"
- "**We send ODP facts, not opinions** — retune the edge hourly and ODP's models receive identical bytes."
- "Three views in, she's a Tabby shopper. Forty seconds idle, she isn't. **Nobody maintained a list.**"
- "**Glass, not a black box** — every audience is a rule you can read; every change explains itself."
- "The ODP side is product today. The edge is live in beta. **You're arriving at the end of the build, not the beginning.**"
- "**Memberships gate; scores teach.** ODP holds the memory; the edge supplies the context; CMAB does the learning."

## Guardrails (don't say)

- ❌ Don't quote "90 seconds" as ODP's speed — that figure belongs **only to the segment-qualification path**. Our integration rides ODP's **immediate event stream**. If latency comes up: *"events flow in real time; decay and scoring are computed at the edge."* Split the layers by **responsibility** (ODP = facts · profile · audiences · stream; edge = decay · scoring), never by speed.
- ❌ "We'll build a UI" — say the tuning UI is **being specified** and you want their requirements in it.
- ❌ "Full Dynamic Yield parity" — claim the affinity capability + the platform, not the suite.
- ❌ "AI/ML picks the audiences" — it's **deterministic**; ODP's predictive insights are the ML layer, separate and untouched by edge parameters.
- ❌ Don't over-promise dates — "beta validation, productization underway, partner on the last mile."
