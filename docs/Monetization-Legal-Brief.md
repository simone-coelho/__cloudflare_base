# Monetization & Legal Brief — Edge Personalization Platform

**Audience:** INTERNAL — monetization/pricing, legal, deal desk (with GTM/PS as secondary readers).
**Purpose:** the decision framework and recommended commercial structure for the edge personalization offering — the billing metric, the contract definitions legal needs, the audit mechanics, and illustrative deal shapes.
**Posture:** this brief provides the *framework, cost truth, and a recommendation*. Rate cards, discounting, and final packaging are monetization's decisions. All dollar figures in §7 are illustrative, not a price list.
**Cost source of record:** `docs/Edge-Unit-Economics.md` (production-basis cost model). One standing guard from that document: the demo-build cost figure that appears there is context only and is **never** a pricing basis — the production number is the only basis.

---

## 1. Executive summary

1. **Cost does not force the metric.** Production COGS is **~$1.19 per 1,000 engaged sessions**, strictly linear, with fixed per-customer costs of $5–50/month. Every plausible enterprise price clears the 80% gross-margin floor ($5.93/1K sessions) by an order of magnitude. Choose the metric for commercial fit, risk shape, and incentives — not margin survival.
2. **Underwrite every deal internally in engaged sessions.** It is the unit of both our cost and the customer's delivered value. Whatever the order form says, deal-desk math is sessions.
3. **Recommended packaging (this offering is PS-delivered, per-customer "stamps," not the standard price list):** a **monthly platform fee per customer stamp, sized by engaged-session band** (wide bands, annual true-up) + a one-time PS implementation SOW (units in `docs/PS-Implementation-Delivery-Guide.md` §10) + a recurring support tier.
4. **For deals bundled into existing MAU-based order forms:** express the same economics as a **per-MAU add-on rate with a stated engagement envelope** (assumed sessions per MAU per month; usage beyond the envelope converts at the per-1K-session rate). Internally identical; commercially MAU-shaped; keeps a future product-line merge clean.
5. **Two hard guardrails:** never price per event (it taxes the behavioral data the engine depends on), and never blend this platform meter with AI credits or shopper-AI features — the three-meter separation in `docs/Opal-Credit-Boundary-Pricing-Guide.md` stands (platform = traffic-scaled; credits = team-scaled; AI features = adoption-scaled).

## 2. The cost truth (what monetization must know)

From the validated production model:

| Fact | Number | Implication |
|---|---|---|
| Marginal cost | **≈ $1.19 per 1K engaged sessions** (~$0.0012/session) | The variable cost is trivial relative to enterprise price points |
| Shape | **Strictly linear** — no cliffs, no volume discounts from the infrastructure | Cost forecasting is multiplication; overage exposure is bounded and predictable |
| Fixed per customer | ~$5–50/month per stamp + managed-service labor | Justifies a platform minimum independent of volume |
| Margin floors | $3.95 / $5.93 / $11.85 per 1K sessions at 70/80/90% GM | Any realistic price ⇒ ~85–99% GM on variable cost |
| **Shopper profiles at rest** | ~5KB each, hibernating; storage inside included tiers to ~1M monthly shoppers; active-compute line ≈ $0.09/1K sessions | **Maintaining a persistent profile per visitor costs effectively nothing.** Cost is caused by *activity*, not by visitor count |

The last row settles a natural intuition: "we keep a durable profile per visitor, so bill per visitor" does not follow from the costs. Our cost is **activity-shaped, not visitor-shaped** — a visitor with twelve 40-event sessions costs ~40× a one-bounce visitor; under MAU pricing both would pay the same.

**Does the billing metric change our cost?** No — the infrastructure bills what shoppers do, not what we invoice. The only second-order effect is behavioral: a metric that discourages event instrumentation (per-event pricing) would degrade the product itself, because event flow is the engine's input. Metering is free either way — visitor IDs, session boundaries, and decision records are native to the platform.

## 3. Metric evaluation (the full space, including rejected options)

| Metric | Cost fit | Value fit | Procurement friction | Verdict |
|---|---|---|---|---|
| **Engaged sessions** | Exact — it *is* the cost unit | Strong — a personalized session is the delivered unit | New metric; needs contractual definition (§5 provides it) | **Recommended underwriting unit + banded fee basis** |
| **MAU** | Weak — engagement varies ~10× per visitor | Weak — bouncers count same as loyal shoppers | Lowest — Optimizely's existing language; bundles with ODP | **Acceptable as the *expression* on bundled order forms, with an engagement envelope (§4.3)** |
| Flat fee per stamp (banded) | Good if bands are session-sized | Good | Lowest of all — one predictable number | **This IS the recommendation** — bands make "flat" safe |
| Per decision served | Good | Closest to value in theory | High — huge counts, meter anxiety; multi-slot pages make the count arbitrary (8 slots = 8 decisions?) | Rejected as a customer meter; useful only as an internal fair-use guard |
| Per profile stored | Poor — storage is trivial | Poor — penalizes long memory, which is our differentiator | Low | Rejected |
| Per event | Poor incentive | Poor | Moderate | **Rejected — never.** Taxes the input the product depends on |
| Outcome share (% of uplift) | n/a | Strongest story | Extreme — attribution disputes, legal complexity | Not a base model; at most an optional gain-share clause on a lighthouse deal |

**Why not pure MAU, given it's the house metric:** the cross-subsidy runs the wrong way. Revenue per visitor is fixed while cost per visitor varies with engagement — so the customers we most want (highly engaged retail sites) become our thinnest margins. At these COGS the absolute damage is small, but the *shape* is adversely selective and compounds at scale. The §4.3 envelope removes the risk while keeping MAU language available.

## 4. The recommended structure

### 4.1 The underwriting rule (internal, no exceptions)

Every deal is modeled in **engaged sessions per month** before any order-form translation. Session forecast × rate = the deal's economic core; MAU expressions are derived from it, never the reverse.

### 4.2 Standalone deals — platform fee per stamp, session-banded

- **One-time:** PS implementation SOW (typical 17–33 PS person-days; units and variance drivers in the PS guide §10).
- **Recurring platform fee:** a monthly fee per customer stamp, sized by the customer's engaged-session band. Wide bands (illustratively: up to 2M / 2–10M / 10–30M / 30M+ sessions per month) so the customer experiences predictable flat pricing. **Annual true-up** (or trailing-quarter averaging) rather than monthly overage penalties — retail is seasonal and holiday spikes should not generate invoice surprises.
- **Platform minimum** independent of volume (covers the stamp's fixed costs + managed-service floor).
- **Recurring support tier** per the PS guide §9; optional recurring PS tuning blocks.
- Additional **brands** inside a customer's stamp are provisioning increments (PS guide: 5–8 PS person-days) — brand count can also be a fee dimension if monetization wishes; cost-wise it is already captured by the session count.

### 4.3 Bundled deals — the MAU expression

When this rides an existing MAU-based order form: quote a **per-MAU add-on rate** derived from the session rate and a **stated engagement envelope**, e.g.:

> *Rate assumes up to N engaged sessions per MAU per month (measured as a trailing-quarter average). Usage beyond the envelope is billed at $X per 1,000 engaged sessions.*

Worked example (illustrative rates): at $8/1K sessions and a customer averaging 1.5 sessions/MAU/month, the add-on quotes as ~1.2¢/MAU with an envelope of 2 sessions/MAU/month. If their engagement rises to 3 sessions/MAU, the excess converts at the session rate — margin is protected without renegotiation, and the customer was told the rule up front.

### 4.4 What is never in this meter

Opal/AI credits (team-activity-scaled) and optional shopper-AI features (adoption-scaled, cached generation) are **separate lines with separate meters** — see the credit-boundary guide. Blending them with traffic pricing invites the customer's finance team to model AI cost against their traffic curve and stall the deal on a fear that isn't real.

## 5. Contract definitions (legal's section)

Proposed defined terms — written so the meter and the platform can never disagree:

- **"Engaged Session":** a period of shopper activity on Customer's instrumented digital properties, commencing with the first event processed by the Platform and ending after thirty (30) minutes of inactivity, in which the Platform processes at least one event or serves at least one decision. (Matches the SDK's session semantics exactly.)
- **"Monthly Active User (MAU)"** (bundled expression only): a unique visitor identifier active in at least one Engaged Session during a calendar month.
- **"Decision":** a content or product selection delivered by the Platform, each carrying an explain record. (Defined for audit purposes; not a billing meter.)
- **"Customer Stamp":** the dedicated, single-customer deployment of the Platform (dedicated compute, storage, credentials, and domain) operated by Optimizely.
- **Measurement & audit:** the Platform's decision and event records are the system of record for usage. **Customer may export its own decision/outcome records at any time and independently recount** — the meter is customer-verifiable by design. Monthly usage reporting to Customer; disputes resolved against the exported records.
- **True-up mechanics:** band evaluation on a trailing-quarter average; annual reconciliation; band changes prospective, never retroactive penalties.
- **Version & change management:** releases are version-pinned per Customer Stamp with scheduled upgrade windows (aligns with enterprise code-freeze calendars; see PS guide §2/§9).
- **Data terms (pre-answered for the DPA):** first-party, device-scoped visitor identifier only; no PII required for operation; no fingerprinting; coarse request geolocation (country/region/metro), never precise location; regional trending computed from **population-level anonymous aggregates** (no per-shopper location history stored); shopper erasure via a single API call; shopper profile data resides in the Customer's dedicated stamp; durable profile facts reside in the Customer's own ODP instance where connected.
- **Service boundaries:** the Platform delivers decisions as data; the Customer's applications render (no code injection into Customer properties). CDP connectivity (ODP) is optional and additive — the Platform is fully functional without it.

## 6. Deal-desk guardrails (the short card)

1. Underwrite in engaged sessions — always, before any MAU translation.
2. Never quote per-event pricing. Never.
3. Every MAU quote states its sessions-per-MAU envelope and the overage conversion rate.
4. Platform minimum per stamp — no zero-floor deals.
5. Three meters, never blended: platform (traffic) / credits (team) / AI features (adoption).
6. Price against value and displacement, not cost-plus — the competitive envelope for enterprise personalization at this scale is mid-six to seven figures annually; our floors are pennies. Anchor there.
7. Implementation SOW is scoped from the PS guide's checklist — a customer without a dataLayer means 10–15 customer-side person-days stated explicitly in the SOW, never absorbed.

## 7. Illustrative deal shapes (NOT a price list)

Illustrative banded rates with a strategic taper ($12 → $10 → $8 → $6 per 1K sessions). The taper is pure strategy — COGS is linear, so any taper is a commercial choice, not a cost necessity.

| Customer scale | Engaged sessions/mo | Our COGS/mo | Illustrative platform fee/mo | Annual | GM on variable |
|---|---|---|---|---|---|
| Mid-market | 500K | ~$0.6K | ~$6K | ~$72K | ~90% |
| Enterprise | 2M | ~$2.4K | ~$20K | ~$240K | ~88% |
| Large enterprise | 5M | ~$6K | ~$40K | ~$480K | ~85% |
| Flagship retail | 15M | ~$18K | ~$90K | ~$1.08M | ~80% |

Add per deal: implementation SOW (one-time), support tier (recurring), optional AI features/credits (separate meters). The flagship row sits naturally inside the competitive displacement envelope — which is the real pricing ceiling, far above these illustrations if value support is there.

## 8. Objection handling / FAQ

**"Why not just MAU like the rest of the business?"** — MAU remains available as the order-form expression (§4.3). The envelope is the only addition, and it exists because our cost and the customer's value are session-shaped; without it, our most engaged customers would be our worst-shaped deals.
**"What if the customer disputes usage?"** — They hold the counter-evidence themselves: exported decision records. The meter is the product's own audit trail.
**"What about holiday spikes?"** — Trailing-quarter banding + annual true-up. Costs are linear with no cliffs, so a spike is proportionally priced, never punitive.
**"Does long profile memory raise cost?"** — Immaterially. Profiles hibernate; storage is ~5KB/shopper inside included tiers to ~1M monthly shoppers. Longer retention is a product differentiator we can afford by default.
**"What if usage 10×'s?"** — Our cost 10×'s linearly (still pennies per thousand); the band structure converts growth to revenue prospectively. There is no scenario where growth surprises us into negative margin.
**"Why is this priced as a custom engagement rather than product SKU?"** — Because delivery is currently a PS-implemented, per-customer stamp (see the PS guide). The §4.3 MAU expression deliberately preserves a clean migration path if/when this becomes a standard product line.
**"Is there AI cost inside the platform fee?"** — No. The decision path is deterministic — zero AI credits at any traffic volume. That sentence has its own guide; use it verbatim with customers.

---

🔗 `docs/Edge-Unit-Economics.md` (cost source of record) · `docs/PS-Implementation-Delivery-Guide.md` (implementation motion + SOW units) · `docs/Opal-Credit-Boundary-Pricing-Guide.md` (the three-meter rule) · `docs/Content-Personalization-Explained-Simply.md` (what the offering is, in plain words) · `docs/architecture/19-tapestry-delivery-ledger.md` (INTERNAL build truth)
