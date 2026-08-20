<!-- SHAREABLE with the account team (AE/SE). Derived 2026-08-20 from three internal research dossiers (docs/nyt/, INTERNAL - do not forward those). This brief carries the strategy without the forensics; deeper sourcing available on request. -->

# The New York Times — Opportunity Brief
*Prepared by Simone Coelho, Managing Principal Enterprise Architect · Aug 2026 · Net-new prospect — no existing relationship. This brief is to align the team on what the opportunity is and where to focus. Please don't forward beyond the account team — a customer-safe version can be produced when we need one.*

## Why now (all within the last 90 days, all public record)

- **Their growth math just got tight.** On the Q2 earnings call (Aug 5), the CEO publicly conceded that big-tech traffic decline is hitting the Times itself ("The Times isn't immune"). Net digital subscriber adds have slowed four straight readings (460K → 450K → 310K → 280K per quarter) against a public **15-million-subscribers-by-2027** target that needs ~275K per quarter. They delivered 280K. Zero slack.
- **The doctrine is set from the top.** The publisher's June keynote: "Be a destination first… to make them **loyal, habituated and valuable**." Their own annual report names the mission in four verbs: *"engage, habituate, convert and retain."* That is precisely the problem space Optimizely works in.
- **The org just clarified who owns the problem.** An April restructure created two clear executive owners: **Alex Hardiman** (EVP — product, engineering, AI platforms, ad product) and **Hannah Yang** (EVP — subscription growth, marketing, data). In March they hired **Josh Laurito as SVP Data** with an explicit "unified data strategy" mandate. A newly hired executive with a cross-cutting charter is classically the first door to knock on.
- Worth knowing: Berkshire Hathaway has built a ~10% stake (~$1.1B) over the last three quarters. Board-level attention is on exactly the subscriber economics described below.

## How they buy (the single most important thing to internalize)

**NYT builds in-house, proudly and publicly.** Their engineering blog has a section literally titled "Built, Not Bought." They built their own A/B testing platform (called ABRA), their own machine-learning paywall, their own customer data platform, their own privacy system — and they publish papers about them. Walking in with "replace your testing or personalization stack" would end the conversation in one meeting.

But there is a tell: **they buy where they're not differentiating.** They run at least one third-party feature-flagging/experimentation vendor in production today — and that vendor's ownership has changed twice in twelve months (its founding team went to **OpenAI, whom NYT is actively suing**, and its product was sold to another company in May with the migration still in flight). A vendor slot they have already accepted, now carrying continuity risk and an awkward conflict of interest: that is a real, honest opening for Optimizely Feature Management + Experimentation. Not a rip-and-replace of anything they are proud of.

## The play — explained properly

### First, understand how NYT makes money now
NYT is no longer just a newspaper. It is a **bundle** of products: News, Games (Wordle, the Crossword), Cooking, The Athletic (sports), and Wirecutter (product reviews). The single most important number in their business: **a bundle subscriber pays about $12.67/month; a single-product subscriber pays about $3.47** — 3.6 times more. Their entire growth strategy is moving people *into* the bundle and keeping them engaged so they don't cancel. Their own filings say churn happens when subscribers "perceive they do not engage with the content sufficiently" — in plain terms: **people cancel when they stop using it, and people upgrade when they use more of it.**

### The gap we found
Each NYT product has smart technology *inside* it. The Games app knows your Wordle streak. The paywall knows how many articles you've read this month. The news recommender knows what you read. **But these systems don't talk to each other in real time. Nothing connects what a reader does in one property to what another property shows her.** Their analytics can *measure* that readers move between properties — but nothing *acts* on it in the moment.

### What that looks like for a real reader — the story to tell
Meet a reader. She pays $6/month for **Games only**. Every morning she plays Wordle — a daily habit, exactly the behavior NYT says drives retention. A few times a month she also clicks into a news article, reads it, sometimes hits the paywall, closes the tab.

**Today, NYT wastes almost everything it knows about her:**
- When she finishes Wordle each morning, the app says "come back tomorrow." It doesn't know — or doesn't act on — the fact that she also reads news.
- When she hits the paywall, she sees the same generic subscription message as a first-time stranger. Nothing says: *"You're here every morning. The full bundle is a few dollars more and includes everything you already touch."*
- When her promotional price is about to step up (NYT raised a tenured cohort from $25 to $30 this year), nothing works to *deepen her engagement in the weeks before the increase* — even though their own filings say disengagement-perception is why people cancel.

**With an orchestration layer, the same reader experiences this:**
1. She finishes Wordle → the completion screen offers her **one** news story matched to what she actually reads. A daily Games habit starts feeding a News habit.
2. Her third article of the month → the paywall message *knows her*: it references the morning habit and prices the bundle against what she already pays. Right message, right moment, grounded in her own behavior.
3. She follows a team in The Athletic during the World Cup → the News homepage surfaces that team's coverage in one module. Another thread tying her to the bundle.
4. Her promo step-up approaches → the system spends the preceding weeks *building* engagement (the habits above), so the price increase lands on someone who uses the product daily, not someone about to churn.

Every one of those moments is the same technical act: **one live reader profile at the edge, updated by behavior in every property, that every surface can act on instantly.** That is what Optimizely's decisioning does, and it is what NYT's single-surface systems — however good — structurally do not.

### Why we can credibly claim this
- **We don't compete with their models — we connect them.** The pitch line: *"Don't out-model them; out-orchestrate them."* Their paywall ML stays. Their recommenders stay. We are the layer between.
- **Transparency is their culture's price of admission.** Their own newsroom refused to adopt the company's homepage algorithms until engineering built dashboards showing editors *why* the algorithm did what it did. Everything we demo is explainable by design — every decision carries a human-readable reason. That is normally our differentiator; at NYT it is the entry requirement, and we already meet it.
- **In the room, we ask rather than assert.** The opener is a question: *"Does anything today carry what a reader did in Games into what the paywall says to her?"* If no — they just named the gap themselves. If yes — we move to the broader bundle journey and have lost nothing.

## Guardrails — things we must never say

1. **Never** pitch replacing ABRA (their A/B platform) or their paywall ML. Respect them explicitly; it buys standing.
2. **Never** cite a news-publisher case study — we don't have one (Channel 4 is our closest honest reference: experimentation across web, apps, and TV).
3. **Never** assert what their internal systems can't do — we probe with questions and let them tell us.
4. Their subscriber numbers, litigation, and licensing deals are public record — fine to reference, always from the filings, never from press folklore.

## Where we focus

- **The door:** Josh Laurito, SVP Data (new, cross-cutting mandate, the "unified data strategy" charter that this play fits exactly). Secondary: Hardiman's product/AI org and Yang's growth org — the April restructure's two owners.
- **The sequence:** a first conversation built on the probe question and the orchestration story above — no product pitch, no deck-first approach. A representative demo is held in reserve: we recently built a fully working personalized-commerce demo for another pursuit in under a week, and a publisher equivalent (fictional masthead, Games-to-News-to-paywall journey, live on screen) is a known quantity we can produce when a first meeting earns it.
- **What success looks like in meeting one:** they answer the probe question, they see we understand *and respect* what they've built, and they agree the cross-property layer is worth a working session with their data team.

*Deeper sourcing behind every claim (SEC-verified financials, full vendor landscape, litigation timeline) exists — ask and I'll walk you through it.*
