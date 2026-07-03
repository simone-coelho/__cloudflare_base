# Tapestry / Coach Rollout — SA "color" for the AE

_SA → AE alignment on the rollout timeline. Mirrors the AE's phase format so it drops straight into his doc. The core reframe: **the engine is real today; what's left isn't building it, it's tailoring it to Tapestry's data, governance, and rules.**_

---

## The message (copy/send — internal, SA→AE)

Hey [AE name] — strong frame, thanks for pulling this together. Let me add the SA color, especially on the two phases we own (engine build + scale). One thing I want us aligned on *before* this goes to Coach, because it's the difference between a confident plan and an accidental overpromise:

**The engine is real and running today — but "works in the demo" and "live in Tapestry's production" are two different things, and the gap between them isn't *building* the engine, it's *tailoring* it to their data, governance, and rules.** We built the demo on a data model *we* designed to give it shape. We don't yet know which warehouse fields/segments/properties Coach will actually expose, what their governance rules are (DAM imagery, what we're allowed to collect and tag), or how deep they want to go. So framing Weeks 3–4 as "deploy + flip on" undersells the discovery that has to come first — and if we set that expectation and then hit a multi-week data/governance conversation, it lands on us.

Here's how I'd re-color the timeline — same spirit, sequenced for reality, framed as a partnership:

**✅ Already done — Platform foundation**
FE live · CMABs in pre-prod · Optimizely Analytics connected to their data (Joe building the custom dashboard now) · ODP snippet deployed · Edge Storefront demo live on real seams. *This part is real, today.*

**Phase 1 · Discovery & data-model alignment** *(≈1–3 weeks, gated on Coach SME availability)*
This is the real "Weeks 1–2," and it's bigger than requirements-gathering — it's effectively a re-onboarding. The demo runs on our assumed data model; production runs on theirs. We align on:
- Which warehouse fields / columns / segments they'll expose for personalization (Snowflake key-pair confirmed is great — but "connected" ≠ "we know what to use").
- ODP: what gets tagged and collected on-site, and which segments we build.
- Catalog semantics mapping (their taxonomy → our engine).
- The **rules of the game** for the richer use cases: **Style Concierge** (what they care about, what they'll expose), **AI-image search** (must pull from a *governed* DAM universe — they've already flagged imagery as a concern), and whether they want the **geo-cohort cold start** (our Mastercard alternative) and its data sourcing.

**Phase 2 · Engine tailoring + first live value** *(≈4–6 weeks, overlapping — connection starts mid-phase)*
Less *build*, more *refine to their reality*. Two tracks run in parallel:
- **Quick wins (light up fast, low data-dependency):** Opal driving real experiments, querying Optimizely Analytics, and the Revenue Radar diagnose→fix→prove loop. Cold start + behavioral sorting come online as soon as the Phase-1 data mapping lands. *Coach sees real value inside this phase, not at the end of it.*
- **Deeper builds (need the Phase-1 rules first):** Style Concierge, AI-image-in-search (governed DAM), geo-cohort cold start. This is where "how deep do they want to go" really drives the timeline.

**Phase 3 · Optimize & scale**
CMABs at scale · Warehouse Audience Sync · social-signal use cases (TikTok → site) · continuous optimization with Opal learning from every experiment. Layered in as refinement completes, scaled to the depth they choose.

**The honest range to set with Coach:** across the full breadth this is a **3–6 month** engagement — but that does *not* mean nothing ships for months. Realistically **75–80% is functional within the first 2–3 months**; the remaining month or two is refinement on the deeper, bespoke pieces. The exact shape depends on **how far and how feature-rich** they want to go — the demo deliberately shows the *ceiling* of what's possible; the engagement is us dialing that to their appetite.

**What we need from Coach to lock dates:** time with their data + governance owners for Phase 1. The faster we get that, the faster the Phase-2 quick wins go live.

Net: I'd rather we walk in with *"real engine today, discovery-led tailoring next, real value in weeks, full breadth in a few months"* than *"switch flips in week 3."* It's more credible, it protects us on delivery, and it's still a fast story. Happy to jump on a call and tighten before it goes to them.

---

## Notes before you send (internal — do NOT paste into the message)

- **The "buy the data" point:** I framed the geo-cohort as running on **their first-party purchase history + free public census (no licensing)** — because *that's the entire differentiator vs Mastercard* ("your own data + free census, no third-party fees"). Avoid telling anyone we need to "buy data," or it undercuts our own pitch. If you specifically meant a licensed third-party enrichment *on top* of that, add it as an optional line.
- **Audience:** this draft is **internal, SA→AE** (it says "protects us," "lands on us"). If you want a **customer-safe version** — same phasing and the "fast and real" framing, none of the internal candor — ask and I'll spin one.
- **Phases, not hard weeks:** I deliberately used ranges + "gated on Coach availability" instead of fixed week numbers, so we don't re-commit to the same switch-flip trap. Elapsed time = scope × their availability.

---

## Appendix — the AE's original first pass (for reference)

> **Here's What Happens Next.**
>
> **Already Done — Platform Foundation:** Feature Experimentation live. CMABs in pre-prod. Optimizely Analytics connected to your data — Joe Timko is building your custom dashboard now. ODP snippet deployed. View Edge Storefront Demo.
>
> **Weeks 1–2 — Requirements + Data Integration:** Gather personalization requirements from Coach. Map product catalog semantics. Connect Snowflake warehouse (key-pair auth confirmed). Configure behavioral event pipeline.
>
> **Weeks 3–4 — Personalization Engine Build:** Deploy real-time edge personalization engine on Coach's site. Connect Opal AI to Coach's warehouse data. Launch first personalization campaigns — cold start, behavioral sorting, audience-driven experiences.
>
> **Weeks 5–8 — Optimize + Scale:** Launch CMABs at scale. Activate Warehouse Audience Sync. Layer in social signal use cases (TikTok → site). Continuous optimization loop live — Opal learning from every experiment.
