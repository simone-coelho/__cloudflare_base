# Edge Personalization — Go-To-Market & Delivery Playbook

**Audience:** INTERNAL ONLY — executives, leadership, sales, sales enablement, onboarding, CSM, marketing.
**What this is:** the shared foundation for how we propose, prioritize, price-think, and deliver the edge personalization offering, customer by customer. **What this is not:** a decree. Pricing, packaging, and positioning decisions belong to the sales, marketing, and pricing teams — this document exists to give everyone the context and the pieces to make those decisions intelligently. Nothing here is written in stone except the honesty rules (§8) and the customer commitments already made (§5).
**Companion (numbers):** `docs/Edge-Unit-Economics.md` — the cost model and margin-floor guidance (published separately).

---

## 1. What we built, in plain words

We built a personalization engine that runs at the **edge** — in the server closest to the shopper — and reacts to behavior **while it happens**. As a shopper browses, the engine scores what they're showing interest in (a product line, a silhouette, an occasion, a price level). Scores **rise with engagement and fade with time**, so shoppers naturally flow *into and out of* interest-based audiences — nobody maintains lists, and nobody writes rules per audience. When a shopper crosses into an audience, the experience responds **immediately**: a different hero image, a different sort order, a relevant offer.

Underneath it sits **Optimizely Data Platform (ODP)** as the durable memory: every behavioral fact lands on the customer profile in real time, the audiences live there as real segments, and the whole Optimizely platform (personalization campaigns, experimentation, CMAB) can act on them. The division of labor in one line — the one every customer conversation uses: **ODP is the memory; the edge is the reflex.**

Three properties make it sellable against the competition (chiefly Dynamic Yield): it's **instant** (milliseconds, in-session), it's **transparent** (every score is an equation you can check, every decision explains itself, every weight is tunable — a glass box where competitors are black boxes), and it's **first-party** (the customer's data, in the customer's ODP — not a third party's data graph).

*The best full explainer to read next: `docs/ASOS-Edge-Personalization-Overview.md` — written for an audience that has never seen the product, and useful for exactly that reason internally too.*

## 2. The offering ladder — the frame for everything

We sell and deliver this as a **ladder**. Each rung is valuable alone, each builds on the one below, and each is separately scopeable — how the rungs are bundled and priced is the pricing team's call; the ladder just makes the pieces legible.

| Rung | What the customer gets | Status | What the customer provides |
|---|---|---|---|
| **1 · Foundation** | Live behavioral affinity at the edge: auto-generated audiences from their catalog, real-time in/out membership, instant experience response, the full ODP loop, the on-screen instrument, platform activation (campaigns + CMAB) | **Live today** — deployable in ~1–2 weeks | Catalog access, ODP instance, a target storefront/environment |
| **2 · Content personalization (S1)** | Their CMS content registered in a **content catalog** (their IDs, tagged metadata) and matched to each shopper's live behavior — "recommend content the way we recommend products," pushed to their front end by ID | **In build** — the engine exists; catalog + telemetry + SDK are the work | Content sample, CMS/DAM API access, a front-end workshop (the push contract), slot choices |
| **3 · Outcome learning (S2)** | The system learns **what works**: which content converts, for which kind of shopper, from which channel — and serves proven winners (aggregation + CMAB with content as the arms) | **Designed** — requires rung 2's data accumulating first | The success metric to optimize; live traffic |
| **4 · Experience personalization** | The page's **layout itself** assembled per shopper — modules by ID, ordered per individual, under governed brand rules | **Architected** (design complete) — the long lane | Slot/module taxonomy, layout rules, governance sign-off |

Two rules of the ladder worth internalizing: **rungs cannot be skipped** (each produces the data the next needs — rung 3 literally cannot exist before rung 2 has telemetry), and **rung 1 is always the land** — it's live, it demos spectacularly, and it deploys in weeks.

## 3. The repeatable delivery motion (per customer)

1. **Qualify** (sales): is the customer headless or headless-leaning? Do they have (or will they buy) ODP? Do they own a content/product catalog with real taxonomy? Are they asking Dynamic-Yield-shaped questions (affinity audiences, real-time behavior, black-box frustration)? Four yeses = ideal profile.
2. **The 30-minute live walkthrough** (sales + SA): the running engine, the instrument, the decay moment. This demo closes rooms — lead with it, not slides.
3. **Co-design intake** (onboarding): the standard inputs checklist — catalog access · ODP instance/creds · content sample (20–30 pieces, sparse metadata fine) · CMS/DAM API access · front-end workshop scheduled (the push-payload contract) · slot choices · success metric. This checklist *is* the onboarding plan; every item maps to a rung.
4. **Deploy rung 1** (~1–2 weeks), tune with the customer (the tuning UI: per-audience and per-dimension weights/decay/thresholds — their control surface, our anti-black-box differentiator).
5. **Build rungs 2–3 with them** (the co-design workshops), rung 4 when their organization is ready.
6. **Operate** (CSM): quarterly tuning reviews, audience-set curation, the transparency reports (what's being decided, for whom, why — surfaced through Opal), and the rung-advancement conversation.

**Team plays, one line each:** **Sales** sells the ladder and the three properties (instant / transparent / first-party), never overpromising a rung that isn't built (§8). **Onboarding** owns the intake checklist and the two workshops (SDK contract, tuning session). **CSM** owns the operating cadence and the expansion motion up the ladder. **Marketing** owns naming/packaging — this doc deliberately avoids branding the offering so that choice stays open.

## 4. Where each current customer sits

- **Tapestry (reference customer):** rung 1 live and demonstrated; rung 2 proposed and accepted in principle (`docs/Tapestry-Content-Personalization-Proposal.md`); rung 4 vision agreed at ~6 months. Active work: the tuning UI (committed this week), the content-catalog build, the SDK contract workshop.
- **ASOS (customer #2):** entering at rung 1 evaluation (`docs/ASOS-Edge-Personalization-Overview.md`); design-partner candidate for rungs 2–3.
- **Demand signal for leadership:** four independent customers have now asked for this same layer in different words — the two above plus two who hand-built equivalents themselves. That is the productization case in one sentence.

## 5. Commitments already made (external — do not move without renegotiating)

| Commitment (Tapestry) | External date |
|---|---|
| Affinity tuning UI, first cut | This week |
| Foundation deployed to their environment | 7–14 days from go |
| Rung 2 (content S1) live | Weeks |
| Rung 3 (outcome learning) | ~2 months |
| Rung 4 (experience) | ~6 months |

## 6. The dual-track timeline policy (read this twice)

We build with AI-assisted engineering and routinely deliver in **hours-to-days** what is conventionally scoped in weeks. That speed is real — and it must be handled deliberately:

- **Internal track (this document and internal planning only):** the honest engineering estimate. Example: the tuning UI is internally a ~1–2 day build; rung 2's engine-side work is internally days, not weeks.
- **External track (everything a customer sees):** deliberately buffered commitments in human-plausible units — roughly 3–5× the internal estimate. The table in §5 is the external track.
- **The rules:** internal dates never appear in any external artifact, ever. External dates are the only dates sales/CSM may speak. We deliver **early against external dates** as a habit — the gap between tracks is our delivery margin and, over time, our reputation ("they always beat their dates").

Why this matters commercially: the buffer is not padding for slowness — it is what lets us absorb customer-side delays (access, approvals, workshops are the real long poles, not our code) while never missing a public date.

**Both tracks, side by side** — so nobody misreads §5's external dates as build-effort estimates:

| Item | Internal (build reality) | External (committed) | Why the gap exists |
|---|---|---|---|
| Tuning UI | ~1–2 days | this week | standard buffer |
| Foundation deploy | ~2–3 days | 7–14 days | customer-side access, credentials, environment approvals |
| Rung 2 — content S1 | days of engine work | weeks | the long poles are theirs: content sample, CMS API access, the front-end workshop |
| Rung 3 — outcome learning | days of build | **~2 months — the customer's own stated target** | **not build time — data physics:** it learns from outcomes, so rung 2 must run on live traffic for weeks accumulating impressions, clicks, and conversions before there is anything to learn from |
| Rung 4 — experience | design complete; build ~1–2 weeks | **~6 months — the customer's own pacing** ("not in a month or two," their words) | their organizational/governance readiness + it builds on rungs 2–3's accumulated data |

Read the two starred rows carefully: those external dates **came from the customer**, not from us — they are agreed expectations we carried into §5 as commitments. Our internal reality is that we could build faster than either; rung 3's calendar is bounded by data accumulation, not engineering, and rung 4's by the customer's own readiness.

## 7. Cost & pricing — how to think about it (the foundation, not the price)

Everything above **rides infrastructure we build and operate ourselves at the edge** (Cloudflare: compute, per-shopper stateful objects, key-value and object storage, queues, sockets). The Optimizely products (ODP, Feature Experimentation) are platform; the edge layer is **ours — and it has a real, meterable cost per visitor.**

The mental model for every commercial conversation: **an engaged shopper session has a unit cost.** A visitor who browses for 30 minutes, streaming behavioral events, holds a live connection and a per-shopper state object for that whole session — that consumption is measurable, and it scales linearly with traffic. Therefore the offering must be priced **above a known cost floor** on a usage-shaped basis (per monthly-tracked-visitor, per 1,000 sessions, or platform-fee-plus-usage — the packaging choice is marketing/pricing's).

`docs/Edge-Unit-Economics.md` (the annex) provides the pieces — **all priced on the production architecture, the only valid pricing basis**: ≈ $1 per 1,000 engaged sessions (≈ a tenth of a cent per monthly active visitor), the monthly costs at scale, margin-floor tables at 70/80/90% gross margin, separate lines for the telemetry store and the generative-AI surfaces, and the headline strategic fact: **cost will not constrain price** — pricing is a value and positioning decision. (The annex also records the demo build's cost once, purely as context for the re-architecture; it is never a pricing basis.) What the teams do with those pieces — tiers, bundles, list price — is theirs.

## 8. The honesty rules (non-negotiable, verbatim from the field)

1. **Three words, used precisely:** *live* (running and verified today) · *gated* (built; enabled by credentials/config) · *simulated* (labeled as such on screen). Never present a simulated thing as live.
2. **Never name one customer to another.** "Design-partner retailers" is the phrase.
3. **Internal dates never leak** (§6). External dates are commitments; we beat them, we don't move them.
4. **The learning claims are staged:** rung 2 "learns the shopper," rung 3 "learns what works," the discovery layer "learns what matters" — each is a named mechanism with a date, never a vague "AI does it."
5. **The runtime is deterministic** — no model call decides in the render path. AI enriches content and explains decisions. This is a *feature* (speed + explainability), and it's how we answer black-box objections.

## 9. Glossary (plain language, for every deck and call)

- **Affinity** — a 0-to-1 score of a shopper's current interest in something (a line, a style, an occasion), built from behavior, fading with time.
- **Decay** — scores fade when engagement stops; it's why shoppers *leave* audiences as naturally as they enter. The thing rule-based systems can't do.
- **Affinity audience** — an auto-created group ("Tote Affinity") a shopper joins by crossing a score threshold and leaves by decaying below it. Names come from the customer's own catalog.
- **The edge** — computing in the data center nearest the shopper; why decisions take milliseconds.
- **ODP = memory, edge = reflex** — ODP keeps the durable facts, profile, and audiences; the edge does the instant scoring and reacting.
- **Content catalog** — the customer's content (images, copy, modules) registered with IDs and tags so it can be recommended like products.
- **Push by ID** — we send the front end "show content #CMP1234 here, score 0.78, because…"; their site does the rendering. The integration model headless engineering teams love.
- **CMAB** — Optimizely's contextual bandit: an experiment that learns which variation wins for which kind of shopper. In our design, affinity scores are the "context" it learns on.
- **Glass box** — our stance versus black-box competitors: every score checkable, every decision explained, every weight tunable by the customer.
