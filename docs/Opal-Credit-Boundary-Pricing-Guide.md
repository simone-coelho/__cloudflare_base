# Where Opal (and AI Credits) Fit — and Where They Never Do

**Audience:** INTERNAL — account executives, pricing, deal desk, sales enablement.
**Purpose:** the definitive map of which touchpoints in this offering consume **Opal / AI credits (token-based)** and which never do — so quotes are structured correctly and nobody promises (or fears) AI costs in the wrong place.

---

## 1. The one rule (memorize this)

> **The engine decides; Opal creates and explains.**
> When the system is making decisions for a shopper mid-session — scoring interest, picking content, serving experiences — **there is no AI in the path and no credits are consumed. Ever.**
> When a *person* asks for something in natural language, or *generative AI creates* something (an audience, a test, an image, an analysis, a label) — **that is Opal / AI, and it's credit-metered.**

The practical consequence for pricing: **AI credit consumption scales with the customer's *team activity* and *feature adoption* — never with shopper traffic.** A customer can go from 1M to 10M sessions and their credit usage doesn't move. That is both a cost-predictability selling point and an objection-killer ("does every page view burn AI credits?" — *No. Zero. The decision path is deterministic math running on edge infrastructure, priced as platform usage.*)

## 2. The touchpoint map — before, during, and after a shopper session

### BEFORE — setup & authoring *(Opal / AI credits apply)*

| Touchpoint | What happens (plain words) | Credits? |
|---|---|---|
| **Content catalog auto-tagging** | AI reads the customer's images/copy and suggests labels; a human approves. One-time per content batch, re-run when new content arrives | ✅ Credits (design-time, batch-sized) |
| **Create audiences/segments via natural language** | "Build me a high-intent evening-shopper audience" → Opal creates it in **ODP** | ✅ Credits per request |
| **Create flags / experiments / CMAB tests via natural language** | "Launch a test on the hero for this audience" → Opal creates it in **Feature Experimentation** | ✅ Credits per request |
| **Parameter/preset proposals** | "Fit my decay settings to my shoppers' actual behavior" → Opal proposes, human approves | ✅ Credits per request |

### DURING — the live shopper session *(NO Opal, NO credits — with one clearly-marked exception)*

| Touchpoint | What happens | Credits? |
|---|---|---|
| **Live affinity scoring & audience membership** | the interest thermometer; shoppers flowing in/out of audiences | ❌ **Never** — deterministic engine |
| **Content & product picks, ranking, page assembly, push** | the engine chooses what each shopper sees and sends it | ❌ **Never** |
| **CMAB serving decisions** | the bandit allocating variations at serve time | ❌ No Opal credits — FX product, its own licensing |
| **ODP event ingest, segment seed, profile updates** | the memory doing its job | ❌ No Opal credits — ODP product, its own licensing |
| **Explain records** | every decision's "why," generated as data by the engine | ❌ Never |
| ⚠️ **Optional shopper-facing AI features** (only if the customer licenses them): **AI search** (understands "bags for a winter wedding"), **style advisor** (the AI stylist chat), **scene generation** (AI-styled imagery of real products) | These *are* generative model calls, invoked by a shopper using the feature | ✅ **Metered per use** — see §3, and note scene images are generated **once and cached**: the cost is per *new scene*, not per view |

### AFTER — analysis, learning & insight *(mixed — this is where deals get misquoted, read §4)*

| Touchpoint | What happens | Credits? |
|---|---|---|
| **Outcome learning itself** (which content converts, for whom) | deterministic statistics pipeline the engine runs on its own data | ❌ **Never** — this is the engine, not Opal |
| **"How is it performing / why did shoppers see X"** | Opal narrates results, explains decisions in plain language | ✅ Credits per ask |
| **Analytics via OptiAnalytics** | Opal querying/analyzing warehouse & analytics data (`oa_*` tools) | ✅ Credits per ask |
| **Audience/segment discovery from analyzed data** | "What cohorts are forming in my data?" → Opal mines + proposes | ✅ Credits per ask |
| **Discovery proposals** (stage 3) | "A tote-affinity cohort is forming — want to activate it?" — surfaced through Opal, human-approved | ✅ Credits per proposal cycle |

## 3. How to structure a quote (three revenue lines, three different meters)

1. **The engine** — platform fee + usage (per monthly-tracked-visitor or per-1K-sessions, from the [unit-economics guide](./Edge-Unit-Economics.md)). Scales with **traffic**. No AI cost inside it, by architecture.
2. **Opal credits** — credit packs sized to the *operator team*: how many merchandisers/analysts, how often they author audiences, launch tests, ask questions. Scales with **team activity**. Rule of thumb for sizing: authoring-heavy months (onboarding, campaign season) burn more; steady-state is modest.
3. **Shopper-facing AI features** *(optional add-on line)* — metered per invocation (searches, advisor conversations, new scenes generated), or bundled as an allowance. Scales with **feature adoption**, not page views — and scene generation amortizes to near-zero per view because of caching.

Never blend lines 1 and 2 into one meter: the moment credits appear to scale with traffic, the customer's finance team will model worst-case AI costs against their traffic curve and the deal will stall on a fear that isn't real.

## 4. The three sentences AEs should say verbatim

- *"Shopper traffic never consumes AI credits — the decision path is deterministic math on edge infrastructure, priced as platform usage."*
- *"Credits scale with your **team's** questions and creations — audiences, tests, analyses — not with your shoppers' clicks."*
- *"The optional AI shopping features (search, advisor, styled imagery) are metered only when a shopper actually uses them — and generated imagery is cached, so you pay per new image, not per view."*

## 5. Quick FAQ

**"If the engine is so smart, why doesn't it use AI credits?"** — Because it's deliberately *not* an LLM: it's transparent scoring math. That's a feature (speed, cost-predictability, explainability), not a limitation — it's the anti-black-box argument that wins engineering teams.
**"Does the learning loop cost credits?"** — No. The learning (which content converts, for whom) is the engine's own statistics. Asking Opal to *explain or analyze* the results costs credits.
**"Is the content auto-tagging a recurring cost?"** — Per content batch: big at onboarding, small trickle as new content arrives. Quote it with onboarding.
**"What if the customer never buys Opal credits?"** — The engine runs fully without them: audiences can be authored in the ODP UI, tests in the FX UI, dashboards read directly. Opal is the natural-language accelerant and the transparency narrator — a strong attach, not a dependency.
**"Which products are on the order form?"** — ODP (the memory), Feature Experimentation (activation/testing), Opal credits (authoring + insight), plus the engine itself (the new offering line) and optional shopper AI features. See the [product-vs-built table](./Content-Personalization-Explained-Simply.md) for what each piece is.
