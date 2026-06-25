# Tapestry / Coach — Personalization Demo: North Star & What We Can Credibly Show

**For:** Customer Success Manager · Account Executive · Leadership
**From:** Solutions Architecture
**Date:** 2026-06-25 · **Decision deadline:** end of this week (Fri, Jun 26)
**Stakes:** $800K renewal · actively compared against **Dynamic Yield** · expansion upside across **ODP, Recommendations, Opal**

---

## TL;DR — the ask

We can put a **mostly-real, end-to-end personalization demo** in front of Coach by EOW that directly answers their vision: **real-time, individual-level personalization at the edge**, plus **AI (Opal) creating audiences that go live on the storefront**. It is built to survive a hands-on-keyboard test by a DY-savvy engineer.

We need leadership to sign off on three things:
1. **The North Star** (below).
2. **The honesty framing** we'll present to Coach — what is *real*, what is *representative*, and what we position as *co-innovation*. This protects us from overpromising on a renewal.
3. **One access dependency:** an Optimizely sandbox with **Opal enabled + a Feature Experimentation instance** so the AI-creates-the-audience step is live rather than recorded.

---

## The North Star

**The scene we will demo:**
> A brand-new, **signed-out** shopper lands on Coach. No history, no login. The storefront curates itself, then **specializes in real time** as she browses — Tabby bags surface, the homepage hero and product-list sort reorganize around her taste, a "complete the look" module appears — all computed **at the edge in under 50ms**. On a second screen, a Coach merchandiser tells Optimizely, in plain language through **Opal**, *"create an audience of high-intent Tabby browsers who haven't added to cart and switch on complete-the-look for them."* She reviews the **AI-drafted** audience, clicks **Publish**, and seconds later that experience is **live** for matching shoppers — with an **A/B test already measuring it**.

**One sentence:** *Talk to Optimizely; watch Coach's storefront personalize itself for an anonymous shopper, live, in milliseconds — AI creates the audiences, the edge delivers them.*

**Two pillars:**
- **Pillar A — The Experience (we build, real, at the edge):** anonymous cold-start, in-session real-time personalization, recommendations + personalized sort, personalized page content/structure, journey-stage detection, A/B + bandit measurement.
- **Pillar B — The Link (real seams, mocked calls):** Opal-style audience creation → segment qualification → our edge engine → live storefront. The **connector interfaces are the real Optimizely products** (ODP `fetchQualifiedSegments`, Opal's ODP audience tools), but for the demo their **calls return synthetic data** — no live ODP dependency, no large-data manipulation. Swapping mock → live is a config change. This keeps the demo 100% reliable on stage while staying architecturally faithful.

**Where we differentiate from Dynamic Yield (corrected — defensible):** DY is a mature personalization-AI product, *not* a rules engine — proprietary prediction models, ML recommendations, and **shopper-facing** conversational AI (Shopping Muse, 2023; Experience Search, 2025). Post-acquisition it now carries **Mastercard's predictive models** (112B+ transactions) — a data asset we do not have. So we do **not** win on "they're just rules" or on predictive data. We win on **architecture and platform**:
- **Sub-50ms decisioning at the edge** (Cloudflare Workers) — computed next to the shopper, no round-trip.
- **Operator-side conversational AI through Opal** — a merchandiser talks to the platform and AI **drafts a live audience that publishes to the storefront**. DY's conversational AI is *shopper-facing*; we have found no evidence of operator-facing audience creation. **This is our real wedge.**
- **Experimentation native to the same platform**, plus the **ODP + CMS span**.
- **First-party data sovereignty** — Coach's customer data stays in *their* ODP, not pooled into a payments network's models. (A real question for a luxury brand's data/legal team — validate, don't lead with FUD.)
- **Honest angle on DY:** in practice it is **services-heavy and template-driven** (expert-executed campaigns, template libraries) — a defensible critique, unlike "rules-based."

*Internal caveat:* DY's real-time "1:1" claims are partly marketing; how deep their individual-level decisioning goes vs. segment targeting needs a competitive teardown before we contest it head-on (in progress).

---

## What's real vs. representative vs. co-innovation

This is the spine of how we talk to Coach. Every claim is defensible.

| Layer | Status | Notes |
|---|---|---|
| Real-time in-session personalization, anonymous profiles, recs, sort, page content/structure, journey-stage, A/B | **Real & production-faithful** | Runs live; survives "can I drive?" |
| AI → Optimizely audience/flag creation (remote MCP) | **Real** *(if sandbox access)* | Draft-only by design; human clicks Publish |
| Edge consumes published audience → personalizes | **Real, always** | Our engine, on Cloudflare Workers |
| Cold start, CMAB, recommendation *relevance* | **Real mechanism, needs their data to tune** | Works in demo; we're explicit it's not validated on Coach conversions |
| **Opal generating audiences from Coach's data** | **Real via Opal + ODP (GA, US-only)** | Opal's ODP system tools / Real-time Audience Builder create real-time audiences from natural language, off the **ODP schema**, human-approved. Requires Coach NA data **in ODP** — so **we mock the data, not the capability.** *(Correction: the Analytics MCP server* does *ship — but it's for analytics explorations, not audience creation; audience creation runs through Opal's ODP tools.)* |
| Cross-channel web ↔ CRM/email | **Real our side / sandbox at the seam** | Decisioning + event fan-out real; live CRM = co-innovation |
| **Proven incrementality / lift on Coach traffic** | **The line we will NOT cross** | We make the *measurement* real; the *numbers* are demo data until it runs on their site |

### How the demo is wired (real seams, mocked calls)

The demo has **no live external dependency.** Every integration point is built as a **real connector interface named after the actual Optimizely product** — ODP real-time segment qualification (`fetchQualifiedSegments`), Opal's ODP audience-authoring tools, Experimentation decisions — with the **live adapter present but the response mocked.** Data is **synthetic Coach NA data shaped to ODP's schema.** We do this deliberately: (1) loading Coach's real data into ODP is impractical in the timeframe and unnecessary for the story; (2) zero live dependency means the demo never fails on stage; (3) every seam is swap-to-live with a config change, so a technical buyer can see exactly where the real products plug in. **We are transparent that the demo mocks these calls** — the underlying capabilities (Opal audience creation, ODP real-time audiences, MAB/CMAB) are GA, as cited above.

---

## Coverage of Coach's feature checklist

| Their requirement | Demo status |
|---|---|
| Recommendations | Real (catalog-based, our engine) |
| Sort rules / Personalized sort | Real |
| Personalized page structure | Real |
| Personalized page content | Real |
| Journey-stage detection (land / in-session / cross-session) | Real |
| Real-time updates | Real |
| Customer profile without sign-in | Real |
| A/B testing | Real (Feature Experimentation) |
| MAB | **Real — GA** across Web Exp, Personalization, Feature Exp (Thompson Sampling / Epsilon-Greedy) |
| CMAB | **GA for Personalization & Web Exp (since Jul 2025); BETA + access-gated for Feature Exp** — confirm entitlement w/ CSM |
| Cold start | Real mechanism, catalog-bootstrapped *(quality needs their data)* |
| Search (AI) | Real |
| AI chat | Real (Opal / MCP client) |
| Cross-channel (web + CRM) | Real our side; live CRM = co-innovation |
| Audience generation from their data | **Real via Opal + ODP** (GA, US-only) — we mock the data, not the capability |
| Consulting / execution support | Commercial — out of engine scope |

> **Note:** AI chat and AI search are *parity* features — DY already ships them (Shopping Muse, 2023; Experience Search, 2025). Our differentiation is architectural and **operator-side** (see North Star), not these.

---

## The two known landmines — and how we're handling them

**1. The Opal "spinning" data problem.** Our architectural read: this is almost certainly a **data-state / retrieval problem, not a Gemini volume ceiling.** You should never push raw warehouse volume into a model's context; the correct pattern is to **aggregate/query first** and hand the model a workable representation — which is what **ODP** is for. A cheap test settles the internal debate: run one *bounded aggregate query* (e.g., top categories by revenue, NA, last 30 days) through Opal — if it returns fast, volume isn't the ceiling, the pipeline is. **The demo sidesteps this entirely** by using curated synthetic data, and in doing so it *shows Coach the fix.*

**2. The remote MCP constraints (already designed around).** (a) **Draft-only — no autonomous publish.** Confirmed expected; we frame the human Publish click as a **governance beat**, not a limitation. (b) **No variation HTML/CSS/JS via MCP.** Correct — MCP creates the *decision*; **our engine owns the content** (a library of personalization modules that flags/variables select and parameterize).

---

## What we are explicitly NOT promising (so we don't overcommit Coach)

- Autonomous, no-human publish from the agent.
- Authoring brand-new bespoke page content by voice (that's CMS / Visual Editor / code).
- Live analysis of Coach's production warehouse in the demo.
- Proven lift numbers on Coach traffic.
- Production-grade cold-start quality without their data to tune it.

---

## Dependencies & asks from the team

1. **Sandbox access (highest priority):** an Optimizely org with **Opal enabled + a Feature Experimentation instance** we can create and publish audiences in. Who can provision by EOW? Without it, Pillar B is recorded instead of live.
2. **Product confirmation:** exact current status of **MAB / CMAB** in Feature Experimentation, so we state it correctly to Coach.
3. **Data approval:** we intend to use **publicly scraped coach.com catalog data** + **synthetic behavioral data** we generate. Any brand/legal sensitivity to flag?
4. **Platform sign-off:** anything we build on the platform needs leadership approval, since it isn't supported in our current state.

---

## Plan to EOW

1. **Now:** sign-off on this brief (North Star + honesty framing + access dependency).
2. **On approval:** dispatch the build swarm — architecture investigation, public catalog acquisition, synthetic-data generation, edge engine + MCP→datafile link, storefront reskin.
3. **Build & rehearse** the hero flows; record fallbacks for any live step so the demo never depends on a single point of failure.

**Strategic posture:** show full strength against their vision where it's real, frame the gaps honestly as co-innovation, and prove we understand their actual problem (the data/Opal pattern) better than DY does. That combination — capability *plus* candor — is what turns this renewal around.
