# Opal Chat — Validated Question Catalog (presenter menu)

Opal answers **any** question over the seeded Coach data by writing its own **guarded read-only SQL**
(SELECT-only, allow-listed tables/views, 200-row cap, self-corrects on error). It is **not** limited to
the list below — improvise freely. These are representative luxury-retail questions **validated live on
production**: each returns a real, tool-backed answer. **13/13 pass, 0 errors.**

**Data scope:** 3,200 customer profiles (historical + shoppers captured live this session) · full product
catalog · transactions (incl. BNPL: Tabby/Affirm/Afterpay) · line items · timeline ~Mar–Jun 2026.

## Audience & segments
- **High-intent Tabby browsers who haven't added to cart — how many, and their AOV?** → 114 shoppers, $320 AOV.
- **How many gifters have a predicted LTV above $2,000?** → 88.
- **Average order-likelihood: window shoppers vs loyal-repeat customers?** → 27% vs 68%.

## Personas & value
- **Which persona has the highest predicted lifetime value?** → `luxe_collector`, ~$4,904 avg.

## Loyalty & churn
- **How many platinum members are at high churn risk (score > 0.6)?** → none (platinum skews loyal).

## Products & sales
- **Top 5 best-selling products by units, with revenue?** → Tabby Bag Charm (477 units, $71,550), …
- **Which product line has the highest cart-abandonment rate?** → Novelty, ~56%.

## Payments / BNPL
- **90-day revenue from BNPL (Tabby/Affirm/Afterpay)?** → $322,116.

## Gifting
- **What share of orders are gifts, and the average gift order value?** → 16.8% of orders, $374 avg.

## Geography & time
- **Compare average order value: US vs Canada.** → $350 vs $351.
- **Total revenue in the last 30 days?** → $2,361,529.
- **How many orders in the last 90 days?** → 7,293.

## Activation (writes gated; enable `OPTIMIZELY_WRITE_ENABLED=true`)
- **"Create an audience for high-AOV Tabby browsers and launch complete-the-look to them."** →
  Opal calls `createOptimizelyAudience` then `createFlag` (real FX entities, taken live). With writes off
  it returns the exact plan.

_Validated via `scratchpad/catalog-validate.mjs` + `date-check.mjs` against production._
