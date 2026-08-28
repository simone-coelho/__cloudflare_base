# Tapestry — Customer Obligations

**What Tapestry must provide, and by when, for the January 15, 2027 milestone.**

This document covers Tapestry's responsibilities only. Optimizely's build, infrastructure, and delivery obligations are documented separately and are not repeated here.

---

## Why this document exists

The Order Form attaches delivery dates and a termination right to those dates. Every item below is something only Tapestry can supply, and each one gates work that cannot begin without it.

**Recommended contractual mechanism:** each obligation carries a Needed By date. Where an item lands late, the affected milestone moves **day for day** from the date the item is received, and the termination right adjusts accordingly. This is standard for a delivery commitment with a remedy attached, and it is the mechanism that makes the January date safe for both parties to sign. Without it, Tapestry's internal timelines become Optimizely's contractual exposure.

**Phase definitions used below:**

| Phase | Meaning |
|---|---|
| **Kickoff** | The first working sessions, where the registry, taxonomy, and payload contract are agreed |
| **Catalog** | Before catalogs can be built and activated |
| **Integration** | Before Tapestry's developers begin front-end integration |
| **Pre-launch** | Before the launch page goes live |
| **Ongoing** | Sustained for the life of the program |

---

## 1. Content

| What we need | Why it matters | Needed by |
|---|---|---|
| **Content inventory export** — every asset eligible for personalization | This is the candidate pool. Nothing can be ranked that is not registered. | Kickoff |
| **Stable content IDs** that do not change when an asset is edited, republished, or moved | The entire delivery contract is content-by-ID. If IDs change on republish, decisions silently point at nothing and slots fall back to defaults. This is the single most common integration failure in content personalization. | Kickoff |
| **Render URL or reference per asset** | How the front end resolves a decision into something displayable | Kickoff |
| **Content type taxonomy** — the agreed vocabulary (for example on-model, silo, detail, video, editorial) | Content type is a scoring dimension. Without an agreed vocabulary there is nothing to score. | Kickoff |
| **Existing metadata and tags**, however sparse | The starting point for enrichment. Sparse is workable; absent is not. | Kickoff |
| **Lifecycle data** — publish date, expiry, embargo where applicable | Drives eligibility. Prevents expired or embargoed content being served. | Catalog |
| **Usage or rights constraints** where any asset is restricted by market, campaign window, or licence | These become eligibility gates. If they are not declared, the engine cannot enforce them. | Catalog |
| **Content feed access** — CMS or DAM API credentials, or an export path, plus the refresh cadence | How the catalog stays current. A manual export path is acceptable at the start so that adapter work does not block anything. | Catalog |
| **Named content operations owner** | Taxonomy and tagging decisions require a decision-maker, not a committee | Kickoff |

**Does anything need to be added to the CMS?** Potentially yes, and it should be assessed at kickoff. At minimum every asset needs a stable ID and a content type. Where those already exist, nothing changes. Where content type is not modelled, it needs to be added as a field or derivable from an existing one. Lifecycle and market restrictions are the same question. This is why the content sample is requested at kickoff rather than later: it tells us what is missing before it becomes a schedule problem.

---

## 2. Product

| What we need | Why it matters | Needed by |
|---|---|---|
| **Product feed** with stable product IDs, matching the IDs used by the commerce platform | Products are ranked by the same engine. ID parity between the feed, the commerce platform, and the events is what allows the three to be joined. | Catalog |
| **Product attribute taxonomy** — line, category, subcategory, silhouette, occasion, price band, material, colour, or the equivalent | These attributes are what ranking scores against. Ranking quality is bounded by attribute quality. | Catalog |
| **Feed refresh cadence**, and confirmation of how price and availability changes propagate | Determines how current eligibility gates can be | Catalog |
| **Commerce response structure** — whether the sort or search call returns the full result set or a server-side page, and whether product attributes arrive inline or must be resolved by ID | Determines the depth of ranking. Where the platform paginates server-side, ranking operates within the returned page. This answer is needed early because it shapes the integration. | Kickoff |

---

## 3. The pages

| What we need | Why it matters | Needed by |
|---|---|---|
| **Slot map** — which slots on which templates are personalizable, which are fixed, and which are off-limits | Defines the surface. Also defines what we are contractually accepting against. | Kickoff |
| **Stable slot identifiers** in the front end | Decisions are addressed to slots. Slot identity must be stable across releases. | Kickoff |
| **Default content per slot** | Named explicitly in the acceptance bar: Tapestry's defaults render wherever no decision applies. Without declared defaults the acceptance criterion cannot be demonstrated. | Kickoff |
| **Template inventory for the launch scope** | Establishes what is in and out for January | Kickoff |
| **Named front-end lead** for the payload contract | The payload contract is reviewed with their front end, not handed to it | Kickoff |

**Do the pages need anything added?** Yes. Slots that are to be personalized need stable identifiers the front end can address, and each needs a declared default. Where the front end already renders content by ID from the CMS, this is largely a mapping exercise rather than new work.

---

## 4. Instrumentation and events

This is the area with the highest variability and the greatest schedule risk.

| What we need | Why it matters | Needed by |
|---|---|---|
| **Content events emitted** — impression, click, dwell, video completion, per content item | These are the signals the engine learns from. No events, no affinity, no personalization. | Integration |
| **Product events emitted** — view, save, add to cart | Product-side affinity depends on these | Integration |
| **Conversion and order event** — order identifier, items, value | How the platform learns what actually worked, and what measurement is read against | Integration |
| **ID parity in events** — the content and product IDs emitted in events must be the same IDs used in the catalogs | The classic silent failure. Events with mismatched IDs are discarded, affinity never builds, and the system appears to work while learning nothing. | Integration |
| **dataLayer or tag manager status** — confirmed at kickoff | Where one exists, our adapter reads it and instrumentation is straightforward. Where none exists, tagging is a materially larger effort on Tapestry's side and adds calendar time. | Kickoff |
| **Instrumentation QA on Tapestry's side** | Events must be verified firing correctly in their environment before integration is considered complete | Integration |

**This is the item most likely to move the date.** It should be assessed in the first week, not discovered during integration.

---

## 5. Identity, consent, and privacy

| What we need | Why it matters | Needed by |
|---|---|---|
| **First-party storage confirmation** on Tapestry's domains | The visitor identifier is first-party. Confirmation that it is available and not stripped by their configuration. | Integration |
| **Consent framework and how consent state is exposed** to the client, plus the required behaviour when consent is withheld | Determines what the engine may do per visitor and per market | Integration |
| **Data processing agreement executed** | Precedes any production traffic | Pre-launch |
| **Data residency requirements stated**, per market | Affects deployment configuration, and carries lead time. Relevant the moment markets outside North America enter scope. | Kickoff |
| **ODP instance decision** for the launch brand | Optional. Adds durable cross-session memory; the engine runs fully without it. | Pre-launch, flexible |
| **Historical data access**, if calibration against Tapestry's existing performance and journey records is desired | Optional enhancement, not a precondition. If it is wanted, the governance approval should start early because access negotiations are slow. | Optional |

---

## 6. Environments, network, and security

| What we need | Why it matters | Needed by |
|---|---|---|
| **Lower-environment origins list** | Required for authentication and allow-listing | Integration |
| **CORS allow-listing** for those origins | Without it, the client cannot connect | Integration |
| **WebSocket egress permitted** through their network, CDN, and WAF | The persistent connection is how decisions are pushed mid-session. Enterprise CDN and WAF configurations frequently block WebSocket upgrade by default. **This is a common late-stage blocker and should be verified early, not assumed.** | Integration |
| **CDN and cache behaviour review** | Confirms that personalized responses are not cached across visitors | Integration |
| **Custom domain decision**, if required | Carries DNS and certificate lead time | Integration |
| **Security review requirements, timeline, and named approver** | Security review is frequently the longest single item in an enterprise integration and is rarely scheduled early enough | Kickoff |
| **Production origins and release process** | Required to move from lower environments to live | Pre-launch |

---

## 7. People, capacity, and calendar

| What we need | Why it matters | Needed by |
|---|---|---|
| **Working-session participants** — data science for the dimension registry, front-end lead for the payload contract, content operations for the taxonomy | The registry and taxonomy are agreed jointly. They cannot be authored unilaterally and then accepted. | Kickoff |
| **Registry sign-off decision-maker** | The dimension registry is the contractual scoring basis. It needs one named approver. | Kickoff |
| **Front-end development capacity**, scheduled, between delivery of the integration kit and the code freeze | The critical path for January runs through Tapestry's front-end team. This is the dependency most likely to determine whether the date holds. | Integration |
| **QA capacity and test windows** | Integration is not complete until their QA confirms it | Integration |
| **Code freeze dates and the exception process** | Determines the last date code can ship, which is the real deadline behind any launch date | Kickoff |
| **Production release slot** | A calendar slot must exist for the launch | Pre-launch |
| **Named tuning owner** — a merchandiser or analyst who holds the weights after launch | Weight configurability is in the acceptance bar. Someone on Tapestry's side must own it. | Pre-launch |

---

## 8. Measurement

| What we need | Why it matters | Needed by |
|---|---|---|
| **Primary metric agreed in writing** before launch, with secondary metrics named at the same time | Prevents the result being re-litigated after the fact | Pre-launch |
| **Holdout approved** — acceptance that a portion of traffic receives no personalized decisions | The holdout is the only mechanism that can substantiate the program's value. **Traffic that ran without one cannot be re-run.** If a holdout is not approved before launch, the value of the program cannot be proven afterwards. | Pre-launch |
| **Staged traffic ramp agreed** | Reduces launch risk, particularly for a launch into a peak trading period | Pre-launch |
| **Analytics access** for Tapestry's team to read results in their own environment | Results are read by Tapestry, on Tapestry's numbers | Pre-launch |

---

## The short version

If only five things are tracked, track these. Each one can move the date on its own.

1. **Stable content IDs and the content export.** Nothing starts without them.
2. **dataLayer maturity and event instrumentation.** The largest single variable in the implementation.
3. **WebSocket egress through their CDN and WAF.** Cheap to verify now, expensive to discover in December.
4. **Front-end development capacity before the code freeze.** The critical path runs through their developers, not ours.
5. **Security review scheduled early**, with a named approver.
