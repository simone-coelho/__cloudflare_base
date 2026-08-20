<!-- SHAREABLE with the account team (AE/SE). Derived 2026-08-20 from three internal research dossiers (docs/nyt/, INTERNAL - do not forward those). This brief carries the strategy without the forensics; deeper sourcing available on request. -->

# The New York Times — Account Strategy Brief
*Prepared by Simone Coelho, Managing Principal Enterprise Architect · Aug 2026 · For account-team strategy discussion. Please don't forward beyond the account team — happy to produce a customer-safe version when we need one.*

## Why now (all within the last 90 days, all public record)

- **Their growth math just got tight.** On the Q2 call (Aug 5), the CEO publicly conceded that big-tech traffic decline is hitting the Times itself ("The Times isn't immune"). Net digital adds have decelerated four straight readings (460K → 450K → 310K → 280K) against a public **15M-subscribers-by-2027** target that needs ~275K per quarter — they delivered 280K. Zero slack.
- **The doctrine is set from the top.** The publisher's June keynote: "Be a destination first… to make them **loyal, habituated and valuable**." And their own 10-K names the mission in four verbs: *"engage, habituate, convert and retain."* That is precisely the problem space we work in.
- **The org just clarified who buys.** An April restructure created two clear owners: **Alex Hardiman** (EVP — product, engineering, AI platforms, ad product) and **Hannah Yang** (EVP — subscription growth, marketing, data). And in March they hired **Josh Laurito as SVP Data** with an explicit "unified data strategy" mandate — a new executive with a cross-cutting charter is classically the way in.
- Context worth knowing: Berkshire Hathaway has built a ~10% stake (~$1.1B) over the last three quarters — board-level attention on exactly the subscriber economics we'd be selling into.

## How they buy (the single most important thing to internalize)

**NYT builds in-house, proudly and publicly.** Their engineering blog has a section literally titled "Built, Not Bought." They built their own experimentation platform (ABRA), their own ML paywall, their own CDP, their own privacy system — and they publish papers about them. Walking in with "replace your testing/personalization stack" is a **credibility-killer** and would end the conversation.

But there's a tell: **they buy where they're not differentiating.** They run at least one third-party feature-management/experimentation vendor in production today at the edge — and that vendor's ownership has churned twice in twelve months (its founding team went to **OpenAI, whom NYT is actively suing**, and its product was sold to Amplitude in May with the migration still in flight). A vendor slot they've already accepted, now carrying continuity risk and a conflict-of-interest optic: that is a real, honest opening for Optimizely Feature Management + Experimentation. Not a rip-and-replace of anything they're proud of.

## The play we'd propose

**Don't out-model them — out-orchestrate them.** Every ML system they've published is single-surface (the paywall, the recommender, homepage curation). Their analytics *measure* readers moving across News, Games, Cooking, and The Athletic — but nothing *acts* on those journeys in real time. Cross-property orchestration toward the bundle is the seam, and their own economics justify it: bundle subscribers are worth **3.6×** single-product subscribers ($12.67 vs $3.47 monthly ARPU per their 10-K), and 2026 exec compensation quietly moved to *total* revenue.

The conversation-opener is a question, not a claim: *"Does anything today carry what a reader did in Games into what the paywall says to her?"* If the answer is no, they've named the gap themselves. If yes, we pivot to the broader bundle journey and lose nothing.

One more thing that plays to our strengths: their newsroom famously blocked adoption of their own homepage algorithms until engineering built editor-facing observability (dashboards, change alerts, inspection tools). **Transparency is their institutional acceptance bar** — and explainable, auditable decisioning is exactly what our platform demos best. We'd also mirror their own vocabulary back to them: their "exposure minimums" concept is our discovery quota; their public editor has argued for a reader-facing personalization dial — both are beats we can show.

## Guardrails — things we must never say

1. **Never** pitch replacing ABRA (their experimentation platform) or their paywall ML. Respect it explicitly; it buys standing.
2. **Never** cite a news-publisher case study — we don't have one (Channel 4 is our closest honest reference: experimentation across web, apps, and TV platforms).
3. **Never** assert what their internal systems can't do — we probe with questions and let them tell us.
4. Their subscriber file, litigation posture, and licensing deals are public record — fine to reference; always from the filings, not from press folklore.

## What I need from you (the strategizing agenda)

1. **Account state:** any live or historical Optimizely relationship, open opportunities, past evaluations at NYT Co. (including The Athletic, Wirecutter, Games)?
2. **Relationship map:** any paths to Hardiman's org (product/AI platforms), Yang's org (growth/data), or Laurito (new SVP Data — my bet for the first conversation)? Any partner/agency routes?
3. **Piano check:** NYT used a social-publishing tool Piano later acquired (as of 2022) — worth quietly confirming whether Piano has an account presence today.
4. **Motion decision (joint):** probe (a few conversations, low investment) vs. full pursuit (research is done; a representative publisher demo is a known quantity for us — we just shipped the equivalent for a retail pursuit in under a week). My recommendation: probe first via Laurito's office, with the demo held in reserve as the follow-up to a good first meeting.

*Deeper sourcing (SEC-verified financials, full vendor landscape, litigation timeline) exists — ask and I'll walk you through it. Everything above traces to public filings, their engineering blog, and their executives' own words.*
