# Experiment Types — Capabilities, Valid Use Cases & "Awe Moments" (Coach / Tapestry, Mon 2026-06-29)

_Owner: A/B + CMAB workstream. Purpose: make sure every experiment type we show has a **valid** use case (right tool for the job), is **impactful**, and lands an **awe moment** — and that we're **honest** about real vs representative._

## 0. Terminology — get this right on stage (it's a sophisticated audience)

Two independent axes; don't conflate them:

- **Product** — *Web Experimentation* vs *Feature Experimentation (FX)*. Different products, different APIs.
  - **Web Experimentation:** visual/client-side; experiments at `/v2/experiments`; `experiment_type ∈ {a/b, multivariate, redirect, multi_page}`.
  - **Feature Experimentation (what THIS demo uses):** server-side/edge via flags + ruleset rules; base `…/flags/v1`; **`rule.type ∈ {targeted_delivery, a/b, multi_armed_bandit}`** (authoritative, from `examples/optimizely-swagger-fx.json`).
- **Experiment type / method** — A/B, MAB, CMAB, etc. "A/B" exists in *both* products but as *different entities* (a Web `experiment` vs an FX ruleset `rule`). When we say "A/B" Monday we mean the **FX `a/b` rule** we create live.

> The earlier "guide is stale" note was imprecise. The FX swagger is current and authoritative: FX rule types are `targeted_delivery · a/b · multi_armed_bandit`. The cheat-sheet's "rule.type = experiment|rollout" and the relationship-guide's "a/b_test"/array-weights are simplified/older renderings; the **live API + swagger** are what we build to (verified: our launched A/B rule is `type:"a/b"`, object-map variations, 50/50, revenue metric).

## 1. What's REAL vs REPRESENTATIVE in our FX project (honesty grid)

| Type | FX REST support | In our demo | Honesty line |
|---|---|---|---|
| **A/B test** (`a/b`) | ✅ GA | **REAL** — verified live (flag 563892, 50/50, event metric `checkout_complete`, no fallback) | Real experiment artifact; **lift figures representative** (real stats need real traffic) |
| **MAB** (`multi_armed_bandit`) | ✅ GA | **REAL** — verified live (flag 563891, even 3-way split, event metric `add_to_cart`, `baseline:null`) | Real bandit artifact; allocation/lift numbers representative |
| **CMAB** (contextual) | ✅ **GA in FX** — rule `type: "multi_armed_bandit"` + contextual **user attributes** (we have full access; **not** gated) | **REAL (in progress)** — decision service `cmab.ts` done; needs the exact contextual-attributes REST field to create the live rule | Real artifact; per-context lift numbers representative |
| **Targeted delivery** (`targeted_delivery`) | ✅ GA | **REAL** (optimizelyFx) | Real delivery rule (rollout/kill-switch); not an experiment |

## 2. The decision framework — WHEN to use which (the "valid use case" test)

- **A/B** → when you must **LEARN and PROVE** with a control + statistical significance. You can afford to show the losing variation during the test. *"Is this change better, and by how much, with confidence?"*
- **MAB** → when you must **EXPLOIT the winner fast / minimize regret**, usually **time-boxed**, and the cost of showing losers is high. You don't need clean significance. *"Stop wasting traffic on losers — shift to the winner automatically."*
- **CMAB** → when the **best variation varies by context** (device · segment · intent · geo). Personalization-as-optimization. *"Don't find ONE winner — find the best winner for EACH shopper."*
- **Targeted delivery / rollout** → when you're **delivering a known-good experience** (no test): graduate a proven winner to 100%, gate by audience, or kill-switch.

The four form a **lifecycle arc** worth narrating: **A/B (prove) → MAB (auto-optimize) → CMAB (personalize per context) → Targeted delivery (graduate the winner).** One platform, the whole loop.

## 3. Per-type: the Coach/Tapestry use case + the awe moment

### A/B test — "From a sentence to a measured, live experiment"
- **Scenario (valid for A/B):** the hero fix. Gen-Z, high-AOV shopper hesitating at payment on a $575 Tabby → **treatment** = BNPL installments (Tabby BNPL is in the seed) + light social proof; **control** = static payment. Metric = checkout completion / revenue. We need to **prove** it works → A/B is the right tool.
- **Awe moment:** a merchandiser asks Opal in plain English; seconds later a **real Optimizely A/B experiment is live** (pull up the Optimizely UI — "not a mockup"), measured with rigor. *Velocity + rigor + real, with zero dev/analyst ticket* — relieving the experimentation team's actual pain.
- **Status:** ✅ done + verified.

### MAB — "It optimizes itself, while the moment is hot"
- **Scenario (valid for MAB, NOT A/B):** a **time-boxed drop** — e.g., a limited Tabby holiday colorway or flash event — with 3 creative hero treatments (Classic / Complete-the-Look / Premium edit). A 2-week A/B would conclude *after* the drop ends; the cost of showing losers during a short, high-traffic window is high. The bandit **auto-shifts traffic to the winner within hours**.
- **Awe moment:** "No analyst watching dashboards, no manual ramp — traffic **auto-flowed to the winning experience** and captured lift *while it was still learning*. Set it and it earns." Autonomy + speed-to-value when time = money.
- **Status:** representative today → **recommend upgrading to a REAL `multi_armed_bandit` rule** (swagger-confirmed; ~the same launch path as A/B).

### CMAB — "One experiment, many winners — the thing DY structurally cannot do"
- **Scenario (valid for CMAB, NOT MAB):** the **anti-DY centerpiece**. The best experience differs by shopper-context, decided in-session at the edge: Mobile Tabby-lover → Complete-the-Look (+22% ATC); Desktop gifter → Gift edit (+16% conv); Returning luxe → Premium edit (+12% rev/visitor); **Gen-Z at payment → BNPL save** (+9% checkout completion). MAB finds *one* global winner; CMAB finds the **best winner per context**.
- **Awe moment:** "Dynamic Yield knows the **neighborhood** (postal-code averages). Optimizely knows the **shopper** — and serves a **different winning experience to each context, automatically, in real time, at the edge.** One experiment, many winners." This is the competitive kill-shot.
- **Status:** decision service `src/services/cmab.ts` done (real, explainable). CMAB **is GA in Feature Experimentation** — rule `type: "multi_armed_bandit"` + contextual **user attributes** (we have full access, not gated). **Making it a real live rule** is in progress, pending the exact contextual-attributes REST field (the public docs + our swagger don't expose it). Lift numbers stay representative.

### Targeted delivery / rollout — "Graduate the winner" (supporting beat)
- **Scenario:** after the A/B proves BNPL, **roll it out to 100% of the Gen-Z BNPL audience** (or kill-switch instantly). Completes the lifecycle.
- **Awe moment:** modest — it's the satisfying "and now it's shipped to everyone who should see it, instantly, no release train." Use as the closer of the lifecycle arc.

## 4. Recommendations

1. **A/B = rigor anchor** — ✅ real + verified (flag, 50/50, event metric). Lead with it; it earns the experimentation team's trust.
2. **MAB = autonomous optimization** — ✅ real + verified (`multi_armed_bandit`, even split, event metric, no baseline). Frame on a **time-boxed drop** (where MAB genuinely beats A/B), not "a better A/B."
3. **CMAB = the anti-DY kill-shot** — GA in FX (`multi_armed_bandit` + contextual user attributes); **real live rule in progress** (only blocker = the contextual-attributes REST field). Lean all the way into "one experiment, many winners."
4. **Narrate the lifecycle arc** (A/B → MAB → CMAB → rollout) — one coherent platform story, each type with a distinct, valid reason to exist.
5. **Never** claim proven lift on Tapestry production traffic; every bandit/A-B number is labeled representative.

## 5. Open item
- **CMAB live rule** — the only blocker is the exact **contextual-attributes REST field** on a `multi_armed_bandit` rule (not in the public docs or our swagger). Fastest resolution: create a CMAB rule once in the UI (**Add Rule → Contextual Bandit**) and read the ruleset back via `GET /experiment/_diag/ruleset/{flagKey}`, or paste the ruleset JSON. Then `launchExperiment` type `cmab` is fully real.

## 6. Verified FX facts (live, 2026-06-26)
- Rule types: `a/b` · `multi_armed_bandit` · `targeted_delivery`. CMAB = `multi_armed_bandit` + contextual user attributes.
- Experiment rule needs ≥1 metric: **event metric** `{event_id, event_type:"custom", scope:"visitor", aggregator:"unique", winning_direction:"increasing", display_title}` or **revenue metric** `{aggregator:"sum", field:"revenue", scope:"visitor", winning_direction:"increasing"}`.
- Create a custom event: `POST /v2/projects/{projectId}/custom_events` `{key, name, description}` → `id` (the `event_id`). (Not `/v2/events` — that 404s.)
- MAB rule: `baseline_variation_id:null`, no `distribution_mode`, even split. A/B rule: has `distribution_mode`, a baseline.
