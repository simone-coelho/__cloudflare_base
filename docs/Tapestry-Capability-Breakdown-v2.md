# Tapestry — Behavioral Targeting and Intelligence
## Personalization Capability Breakdown

**Prepared for:** Mandeep Sethi · **Purpose:** CFO review · **Date:** [DATE]

*Corrected draft. Replaces the 2026-08-20 version. Ready to format.*
*Fields in [brackets] must be filled from Tapestry's own reporting or confirmed with the account team before this goes out. Review notes for the account team are in `Tapestry-CFO-Capability-Doc-Review.md` and are not part of this document.*

---

**What this document separates:** the capabilities Tapestry owns and can activate today, and the new behavioral capability being built in partnership with Tapestry under the Behavioral Targeting and Intelligence initiative.

---

## Why this initiative exists

Between 90 and 95 percent of the traffic arriving on Tapestry's brand sites is unidentified. Roughly 80 percent has never been seen before. Email is around 10 percent of arrivals, and paid clickthroughs land unidentified.

Every personalization capability in production today, across every vendor in the market, reaches the identified minority. It needs a profile, a login, or a segment the visitor has already been sorted into.

**This initiative is about the other 90 percent.** It builds a live behavioral understanding of a visitor who has never been seen before, within their first session, from their own behavior on the site, using first-party signals only. That is why the initiative is named Behavioral Targeting and Intelligence rather than site personalization. The distinction is not branding. It is the entire addressable population.

---

## At a glance

| | Core platform | Content decisioning | Experience composition |
|---|---|---|---|
| **Status** | In production today | New, in build | Roadmap direction |
| **Live** | Now | [Pilot brand], first page, January | Sequenced after content is live and measured |
| **What it does** | Experiments, personalizes, and measures across the digital experience | Decides which content each visitor sees, per slot, in real time | Composes the order of the page around each visitor |

---

## 1. Core platform — available today

The foundation Tapestry can activate immediately. *(Each line to be marked against the current order form: in use, entitled but unused, or requires a separate SKU.)*

**Experimentation**

- **A/B and multivariate testing** across any page, feature, or experience.
- **Multi-armed and contextual bandits.** Bandits shift traffic toward better-performing variations automatically. Contextual bandits go further and select per visitor based on their attributes, rather than picking one global winner.
- **Feature flagging** with targeted exposure and instant rollback.
- **Stats Engine.** Optimizely's sequential testing engine: results are valid at any point with no fixed sample size, and false-discovery rate is controlled across metrics, so the business team is not acting on statistical noise.

**Personalization**

- **Audience targeting and segmentation** from behavioral, geographic, and first-party data.
- **Rules-based personalization**: different content, offers, and experiences for defined segments.
- **Behavioral targeting** on on-site actions, journey stage, and engagement.
- **Geo and device targeting** by location, market, and device.
- **Real-time audience qualification.** Segments refresh continuously as behavior and transactions land, typically within seconds.
- **Product recommendations.** Algorithmic product suggestions: viewed together, bought together, trending, personalized.
- **Unified customer profile (ODP).** Behavioral and transactional data consolidated per customer. The durable memory layer beneath everything above.

**Analytics**

- **Optimizely Analytics.** Unified reporting across experiments and personalization: conversion, revenue impact, and audience performance in one view.
- **Experiment results.** Significance, lift, and confidence intervals surfaced for the business team.
- **Audience performance reporting.** Which segments respond, convert, and generate revenue.
- **Warehouse connectivity.** Behavioral and decision data export to Tapestry's Snowflake environment for independent analysis, and Tapestry's data science team can push derived priors back into the platform.

**Value to Tapestry:** this is the operational backbone. It runs the current program, powers the testing roadmap the digital team owns, and is the data and audience layer everything else is built on. Without it, the new capability has nothing to reason against and nothing to be measured by.

---

## 2. Content decisioning — new capability

Treating content the way the platform already treats product: as a catalog of items, ranked per visitor, at decision time.

**Content decisioning runs standalone.** It does not require an experiment to be running and it does not depend on the experimentation platform to make a decision. Experimentation is how the value gets measured, and that is optional.

- **Content catalog.** Tapestry's content registered under Tapestry's own IDs, with type, tags, slot eligibility, and lifecycle. Content becomes a rankable asset, exactly as product is today.
- **Live per-visitor affinity.** Interest is scored continuously from behavior in the current session, decays over time, and is held per visitor at the edge.
- **Cold start from the first impression.** A visitor nobody has seen before is served against first-party regional trending, meaning what content and product are performing in their region right now, and their personal profile takes over within the same session as behavior accumulates. No third-party data. No waiting for a segment to populate.
- **Six to eight agreed dimensions**, documented explicitly and configurable by Tapestry's team: location with regional trending, visit number, entry channel, content type and metadata, and the behavioral affinities derived from the catalog.
- **Per-slot strategies.** Each slot can carry its own combination of dimensions and weights, so a hero and a story module can be driven by different logic on the same page.
- **In-session audience entry and exit.** Visitors qualify inside their current session and drop out again as interest decays, without waiting for a refresh cycle.
- **Page-level ordered decisions.** The platform returns which content wins each slot and the order of the slots, addressed by Tapestry's content IDs. Tapestry's front end renders, exactly as it does today. Reordering later becomes a data change, not a re-integration.
- **Transparent and configurable.** Every weight, decay horizon, and threshold is visible and editable by Tapestry's team, versioned, and effective immediately. Tapestry's data scientists can inject their own math, as priors and as derived weights.
- **An explain record behind every decision.** The drivers, the scores, the context, exportable. Not a black box.

**Performance.** First paint is served from a snapshot endpoint, so there is no flash of default content. In-session decisions are computed at the edge in milliseconds and delivered over a persistent connection. Cross-session memory re-seeds in under a second.

**Value to Tapestry:** content placement today is manually curated and largely static, and it is tuned for the identified visitor. This makes every content slot work harder against demonstrated intent, for the anonymous majority as well as the known customer, with no additional operational lift from the merchandising team.

---

## 3. Governance and merchandising control

The system is designed on the assumption that the brand will not hand its pages to an autonomous model. Authority is layered, and merchandising sits above the engine.

- **Eligibility gates run before scoring.** Out of stock, expired, off-limits. The item drops out of consideration. Visitor affinity is untouched.
- **Pins and blocks outrank the engine.** A merchandiser's pinned campaign is absolute, and it survives audience regeneration.
- **Season, promotion, and margin apply as tunable multipliers** on scores, and each one is itemized in the explain record.
- **Precedence is declared, not implicit:** eligibility gates, then pins and blocks, then weighted ranking.
- **Audiences are proposed, not imposed.** The engine generates audiences from the catalog, in Tapestry's own merchandising language. Tapestry's team reviews and approves them.

In one line: rules decide what can and must show, affinity decides what does show in the space that is left, and every placement shows its receipts.

---

## 4. How the value gets measured

The business case below is a projection until it is measured. The measurement design is agreed before launch, not after.

- **A holdout group** receives no personalized decisions for the duration of the measurement window. This is the control the entire claim rests on.
- **A primary metric agreed before launch**, with secondary metrics named at the same time, so the result cannot be re-litigated afterwards.
- **Read through Stats Engine**, whose results are valid at any point and which controls false-discovery rate across metrics.
- **Reported by Tapestry's own team**, in Tapestry's own analytics environment, with decision and outcome records exportable to Snowflake for independent verification.

Tapestry can prove or disprove the number in this document using its own tooling. That is deliberate.

---

## 5. Experience composition — roadmap direction

Composing the page layout itself around each visitor: which modules appear and in what order, rather than which content sits inside a fixed template.

The architecture already carries this. The decision payload is a page-level ordered set from day one, so ordering is delivered as data rather than as a new integration. Activating it after the content capability is live and measured is a configuration and front-end exercise, not another build.

This is shown here as direction. It is sequenced after the content capability is live, measured, and tuned, and the timing is set jointly at that point.

---

## 6. What is not included

- Site search. Not included in this investment, available separately.
- Content management or CMS replacement.
- Front-end rendering. Tapestry's sites continue to render as they do today. The platform returns decisions by content ID, and Tapestry's front end paints them.
- Any capability outside content and experience decisioning.

---

## 7. Data, privacy, and residency

- **First-party data only.** Behavioral events from Tapestry's own sites, Tapestry's content and product feeds, and Tapestry's ODP profiles. No third-party data.
- **No PII in the decision path.** Decisions are made against a first-party visitor identifier and an interest vector, not against personal data.
- **Coarse geolocation only.** Country, region, and metro from the edge network. No device permissions.
- **Regional trending is aggregate only.** Population-level counts. No per-visitor location history is stored.
- **Durable profile facts live in Tapestry's own ODP instance.**
- **Erasure is a single API call**, and it clears both the edge profile and the durable record.

---

## 8. Delivery

| Milestone | What is true when it is done | Target |
|---|---|---|
| **Integration kit delivered** | SDK, integration guide, and API reference in Tapestry's developers' hands. Staging origins connected and verified. This is the line that protects the November freeze. | Mid-October |
| **Acceptance in Tapestry's environment** | On [pilot brand]'s homepage, with 20 to 30 assets, different visitors verifiably see different content chosen by the agreed dimensions, with weights live-tunable and every decision explainable. Demonstrated in Tapestry's lower environment. | End of October |
| **Integration and test window** | Tapestry's teams integrate and test inside their environments, through the freeze window, on their calendar. | November to December |
| **First page live** | Launch on one page on [pilot brand], with joint announcement. | January |
| **Expansion** | Additional pages, regions, and brands, sequenced jointly once launch performance is measured. | Agreed at launch |

**Acceptance bar for January**, stated plainly so both sides are measuring the same thing: on the pilot brand's homepage, with a candidate pool of 20 to 30 assets, different visitors verifiably see different content, chosen by the agreed dimension registry, with weight configurability live, an explain record behind every decision, and Tapestry's defaults rendering wherever no decision applies.

---

## 9. What we need from Tapestry

These dates depend on both sides. Stated up front so the plan is real rather than optimistic.

| | What | Needed by |
|---|---|---|
| 1 | Working-session participants: data science for the dimension registry, a front-end lead for the payload contract, content operations for the taxonomy | Kickoff |
| 2 | A content sample, roughly 100 to 500 assets, with whatever metadata exists. Sparse is fine. | Kickoff |
| 3 | Content feed access: CMS or DAM credentials, or an export path. A manual import path unblocks us immediately if API access takes longer. | Catalog build |
| 4 | Slot map and default content for the pilot page | Kickoff |
| 5 | Staging origins and network review, including WebSocket access | Before the integration kit |
| 6 | Conversion and order event, one integration point, required for outcome learning | With integration |
| 7 | ODP instance decision for the pilot brand. The engine runs standalone if this lands later. | Flexible |
| 8 | Security review inputs, if more than API-key and SSO-backed operator access is required | Before the integration kit |
| 9 | Front-end integration capacity between the integration kit and the November freeze | The critical dependency |

---

## 10. The business case

**The addressable base.** Only digital revenue is addressable by this system, and within digital, only the traffic that reaches the personalized surfaces, and within that, only the share exposed rather than held out for measurement.

| | |
|---|---|
| Digital DTC revenue, launch market | **[A, from Tapestry reporting]** |
| Share of digital sessions on personalized surfaces in scope | **[B]** |
| Share exposed, excluding the measurement holdout | **[C]** |
| Relative conversion lift on exposed traffic | **[L]** |
| **Incremental revenue** | **A x B x C x L** |

| Scenario | Relative lift on exposed traffic | Incremental annual revenue |
|---|---|---|
| Conservative | [ ]% | [ ] |
| Expected | [ ]% | [ ] |
| Strong | [ ]% | [ ] |

**Year one investment: [figure]. At the conservative band, payback is [N] months.** Every band above conservative shortens it.

**Three effects the table above does not count:**

- **Order value, not only conversion rate.** Better content changes what gets discovered, not only whether a visit converts.
- **Content operations effort.** Slot curation moves from manual scheduling to reviewing what the engine proposes.
- **Portfolio amortization.** The platform is multi-brand from the first line: per-brand catalogs, configurations, and audiences, with hard data isolation between brands. Extending from the pilot brand to the next brand is provisioning, not another build. **One investment, amortized across the portfolio.**

---

## 11. Why Tapestry is positioned differently

- **Design partner influence.** Tapestry's team is shaping the dimension registry, the learning logic, and the tuning surface. This is co-designed, not received off the shelf.
- **Executive sponsorship.** A direct line between Optimizely's CEO and Mandeep's team.
- **No migration cost.** Additive to the existing Optimizely footprint. No lift and shift, no replatforming, and it works with a headless front end as it stands.
- **Implementation included.** Standing the solution up is included as part of the Lighthouse partnership, a services engagement that would normally scope at **[range]**.
- **The capability compounds.** Stage one learns the shopper, which is what launches. Stage two learns what works, correlating content, context, and outcome once live traffic accumulates. Stage three surfaces discovery to the team as human-approved proposals. The investment buys a curve, not a step.

---

*Internal draft for review. Figures and scope subject to final confirmation.*
