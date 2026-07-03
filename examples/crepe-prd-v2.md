---
title: "CRePE PRD v2 - Prescriptive Draft"
subtitle: "Content Recommendations Compatibility and Deterministic Personalization Resolver for HD Supply"
status: "Prescriptive Draft for Architecture/TDD Review"
created: "2026-06-08"
owner: "Optimizely Enterprise Architecture"
audience: "Optimizely engineering, HD Supply architecture, Head App team, SiteX content team, DevOps/prod support"
---

# CRePE PRD v2 - Prescriptive Draft

## ⚠️ 0.0 Reconciliation Errata — applied 2026-06-09

This PRD has been reconciled against the HD Supply customer feedback and the Global Architecture
Board addendum (`docs/source-of-truth/hd-prd-comments-addendum.md`). **Where inline text below
conflicts with a correction in this table, the correction supersedes.** Full item-by-item mapping:
`docs/source-of-truth/PRD_TDD_ERRATA.md`. Decisions: `docs/adr/ADR-006` (config storage),
`docs/adr/ADR-007` (userStatus — **superseded by ADR-008**), `docs/adr/ADR-008` (userStatus Day-1),
`docs/adr/ADR-009` (auth posture + production guardrails). All corrections are implemented and
CI-verified (run history: GitHub Actions on `main`).

> **Accuracy note (2026-06-10, post-audit):** an independent audit + remediation pass followed this
> banner (see `docs/audit/`). Two rows below are superseded by later ADRs, which govern: **row 2** —
> the pending request-attribute/values were finalized by ADR-008 as CMS field `UserType` →
> `pf_usertype`, request attribute `usertype` (alias `userstatus`), values
> `guest`/`cookied`/`authenticated` matched **leniently** (no 400 on unknown values, superseding
> FR-3 AC7); **row 15** — the scope model is per ADR-009 (content endpoint accepts any valid token
> for the audience by default, flag-restorable gating; production-mode startup guard). Also note:
> FR-6's "unknown page type → 400" was superseded by TDD §7.6's sprint-1 lenient default — an
> unknown page is omitted from the 200 response and recorded in the empty-widget metric as
> `PAGE_NOT_CONFIGURED` (delivery doc 07 documents the operational consequence).

| # | Correction (normative) | Source | Implemented |
| --- | --- | --- | --- |
| 1 | Rule/targeting configuration is **config-as-code (YAML)** promoted via Git/Jenkins/Helm in sprint 1; PostgreSQL stores content snapshots, sync state, and metadata only. DB-backed rule authoring is sprint 2+. | ADR-006 | ConfigLoader |
| 2 | **`userStatus` is a Day-1 requirement** (ADR-008, supersedes ADR-007) — the business confirmed it (similar experience already in production). Modeled as `pf_userstatus` + a `userstatus` request attribute and restored to the PF inventory; the resolver targets it as a normal field. Pending: exact request-attr name + allowed values (Praveen/Sydney). | ADR-008 | PfFieldRegistry |
| 3 | Widget exclusions are **reusable, audience-gated exclusion groups** (`sharedExclusionGroups` + widget `exclusionGroups`/inline `exclusions`), each with `conditionMode` + optional `activeFrom`/`activeTo`. Replaces "global exclusion bucket"; `constrainedcontract` is a configured value, not hardcoded. An audience-excluded widget **still serves its explicit fallback**. | Addendum §6/§7 | RECON-001 |
| 4 | Rules, widgets, and exclusion groups support optional **activation windows** `activeFrom`/`activeTo`; widgets an `active` flag. Out-of-window rule/group → skipped; out-of-window widget → `WIDGET_INACTIVE`. | Addendum §20/§24 | RECON-002 |
| 5 | **Content lifecycle status** is ACTIVE/INACTIVE/EXPIRED/SOFT_DELETED/INVALID_FAIL_CLOSED; only ACTIVE serves; expired content may reactivate. | Addendum §21/§22 | RECON-003 |
| 6 | Admin sync is **async + lock-protected**: `POST /api/v1/admin/sync` → 202 `{accepted,syncRunId,statusUrl}`, 409 if running; `GET /api/v1/admin/sync-runs/{id}`. Serving snapshot unchanged until activation. | Addendum §2 | RECON-004 |
| 7 | **Effective-config endpoint** `GET /api/v1/admin/config/effective` (crepe.admin), sanitized (no secrets). | Addendum §11 | RECON-005 |
| 8 | **Matched-rule debug metadata** `{matchedRuleId,matchedRuleName,matchedConditions}` gated by `debug=true` + new `crepe.debug` scope. | Addendum §17 | RECON-006 |
| 9 | Config/snapshot activation is **cluster-safe**: deployment-promoted config + a poller so every pod converges on the active snapshot (no pod-local reload). | ADR-005 / Addendum §12 | RECON-007 |
| 10 | The "no content identified" metric is **`crepe_resolver_empty_widgets_total`** {pageType,widgetId,resolutionStatus,configVersion}; statuses include WIDGET_INACTIVE, PAGE_NOT_CONFIGURED. | Addendum §30 | RECON-008 |
| 11 | Observability emits via **OpenTelemetry** (metrics+traces) to the collector (env-injected, off by default), with a Prometheus baseline; logs-over-OTel applied at deploy. Expanded metrics: sync runs, snapshot age, exclusion-validation failures. | Addendum §5 | RECON-009 |
| 12 | **`containsAny`/`notContainsAny`** are allowed only on fields marked substring-matchable (sprint-1: `pf_searchterm`); exact token equality is the default. | Addendum §13 | RECON-010 |
| 13 | New PF fields **`pf_contentsubtype`, `pf_pagescope`**; `pf_contentsubtype` scopes a widget's candidates by declared subtype (untyped items stay eligible). | Addendum §27 | CORE-006a/c |
| 14 | **`pf_weight` is 0–9999**; persisted timestamps use PostgreSQL **`timestamptz`**; business timezone `America/New_York`. | Addendum §19/§26 | ContentNormalizer / snapshot schema |
| 15 | Authentication is **Microsoft Entra ID JWT** (issuer/audience/signature/expiry/scope); no static bearer token. Runtime secrets via Google Secret Manager. | Addendum §3/§4 | AUTH-001/002/003 |
| 16 | **Page-header has exactly one production widget**; test/`DELETE-ME` widgets are excluded from prod. Match mode is **per rule** (`conditionMode`), not per widget. | Addendum §14/§18 | RuleConfig / example |

---

## 0. Document Control

| Field | Value |
|---|---|
| Product / solution | CRePE - Content Recommendations Compatibility and Personalization Engine |
| Customer | HD Supply |
| Document status | Prescriptive draft for architecture and TDD preparation |
| Created | 2026-06-08 |
| Supersedes | May 27, 2026 PRD draft |
| Primary authoring perspective | Optimizely Managing Principal Enterprise Architect / enterprise architecture review |
| Implementation target | Bespoke customer solution, not an Optimizely product feature |
| Hosting ownership | HD Supply-hosted Google Cloud / GKE runtime |
| Source inputs | May 27 draft PRD, HD Supply workbook `crepe-int-test1-inttest-data.xlsx`, local engineering analysis, customer PRD comments, TestData / Issues / FieldsList workbook sheets |

### 0.1 Purpose

This PRD v2 defines the required sprint-1 behavior for CRePE in a form that can be used directly to create the Technical Design Document (TDD), test plan, implementation epics, and engineering stories.

This version intentionally removes ambiguity from the May 27 draft. It converts open questions and workbook notes into explicit product and engineering decisions. Where the workbook corrected the original PRD, this PRD v2 treats the workbook as the newer requirement input.

### 0.2 Most Important Reframe

CRePE is **not** an ML recommendation engine. It is a deterministic, rules-driven content personalization resolver that returns a Product Recommendations-compatible response to the Head App.

The required architecture is therefore two-layered:

1. **External compatibility layer:** CRePE accepts and returns Product Recommendations-shaped request/response payloads to minimize Head App changes.
2. **Internal resolver layer:** CRePE normalizes the request into a canonical customer context and evaluates page -> widget -> rule -> condition logic deterministically.

The external vocabulary may continue to say `recommend`, `recs`, `refCode`, `widget`, `alias`, and `position`. The internal design, tests, and TDD must use deterministic resolver vocabulary: page, widget, rule, condition, candidate, inclusion, exclusion, fallback, snapshot, and dedupe.

### 0.3 Sprint-1 Design Principles

CRePE sprint 1 must optimize for correctness, deterministic behavior, operational safety, and fast delivery.

| Principle | Requirement implication |
|---|---|
| Product Recs compatibility outside | Preserve the Head App-facing request/response vocabulary where practical. Do not force unnecessary Head App rewrites. |
| Clean rule engine inside | Do not model the implementation as a recommender. Implement a deterministic resolver with explicit rule evaluation. |
| Correctness before cleverness | If no rule matches, return no normal content. Never fill slots with arbitrary content. |
| Exclusions fail closed | A malformed or unknown exclusion-like field must not result in forbidden content being served. |
| Snapshot serving | API requests must never read from a half-loaded or partially validated catalog. |
| In-memory evaluation | Request-time matching must execute against an immutable in-memory catalog/config snapshot; PostgreSQL is the durable cache and cold-start source, not the primary rule engine. |
| Cluster consistency | Config and snapshot activation must be consistent across pods. Local-only reloads are prohibited. |
| TDD as executable spec | Matching, fallback, exclusion, dedupe, and date semantics must be fully specified before implementation. |

---

## 1. Executive Summary

HD Supply needs the Head App to render personalized CMS-authored content such as hero carousel items, promo tiles, strip banners, alert banners, middle banners, resource cards, and page-header content.

The current Product Recommendations-based approach is not able to satisfy HD Supply's deterministic content targeting needs. The required capabilities are rule-based, not behavioral recommendation capabilities:

- exact and array-overlap matching against customer attributes;
- include and exclude filters;
- global exclusion buckets;
- deterministic weight-based ordering;
- per-rule and per-widget limits;
- scheduled page/widget/rule activation;
- explicit fallback/default content;
- cross-widget dedupe on a page;
- debug metadata indicating which rule selected a result.

CRePE will replace the content-delivery role currently assigned to Product Recommendations for this HD Supply use case. It does **not** replace product catalog recommendations. It does **not** learn from behavior. It does **not** rank based on engagement or collaborative filtering. It does **not** perform experimentation.

Sprint 1 must deliver a Java 21 / Spring Boot service deployed to HD Supply GKE, backed by Cloud SQL for PostgreSQL, authenticated through Microsoft Entra ID bearer-token validation, observed through OpenTelemetry into HD Supply's collector/Splunk/OpsGenie path, and integrated with Optimizely Content Graph for CMS content ingestion.

---

## 2. Goals, Non-Goals, and Success Criteria

### 2.1 Goals

| ID | Goal |
|---|---|
| G-1 | Provide a fast Head App API that returns all configured content recommendations for a requested page type using Product Recommendations-compatible response vocabulary. |
| G-2 | Resolve content deterministically using explicit page -> widget -> rule -> condition configuration. |
| G-3 | Support customer targeting based on canonical request attributes derived from Product Recs-compatible request fields, including industry, state, organization segments, sold-to, TopLink, winning relation, affiliate, comp type, ZIP code, category/product/search fields, and user status. |
| G-4 | Enforce absolute exclusions from CMS item-level exclusion PF fields and YAML-configured global exclusion buckets. |
| G-5 | Serve from an immutable active content snapshot so requests never see mid-ingestion or partially validated data. |
| G-6 | Support explicit fallback/default content sets without ever filling empty slots with arbitrary non-matching content. |
| G-7 | Provide debug/explanation metadata so SiteX, Head App engineering, and support can identify which rule selected each returned item. |
| G-8 | Provide a golden-profile regression suite based on HD Supply's TestData and Issues workbook examples. |
| G-9 | Keep sprint 1 operationally conservative: YAML/Git/Jenkins/Helm config promotion, no UI, no ODP lookup, no click/impression tracking. |

### 2.2 Non-Goals

| ID | Non-goal |
|---|---|
| NG-1 | CRePE is not a general-purpose Optimizely product feature. It is a bespoke HD Supply solution. |
| NG-2 | CRePE is not an ML, behavioral, collaborative-filtering, or self-learning recommendation engine. |
| NG-3 | CRePE does not replace HD Supply's product catalog recommendation system. |
| NG-4 | CRePE does not resolve customer identity from ODP in sprint 1. The Head App sends the attributes needed for targeting. |
| NG-5 | CRePE does not serve full CMS display assets in sprint 1. It returns content references/refCodes; the Head App continues to fetch/render display content through its existing content path. |
| NG-6 | CRePE does not provide a no-code SiteX configurator UI in sprint 1. |
| NG-7 | CRePE does not perform A/B testing, experimentation, click tracking, impression tracking, or engagement optimization. |
| NG-8 | CRePE does not support local-only hot reload of config in a multi-pod cluster. Config changes must be cluster-consistent. |

### 2.3 Success Criteria

| ID | Metric | Target | Validation method |
|---|---|---|---|
| SM-1 | API latency | p95 < 500 ms for warmed pods under expected traffic | Load/integration test |
| SM-2 | Resolver execution time | p95 resolver time < 100 ms for catalog <= 5,000 items and sprint-1 page config | Unit/performance test |
| SM-3 | Targeting correctness | 100% pass rate for golden-profile scenarios | TDD + golden-profile regression suite |
| SM-4 | Exclusion correctness | 100% fail-closed behavior for malformed or matching exclusion fields | Unit/integration tests |
| SM-5 | Product Recs contract compatibility | Head App can integrate without UI/rendering contract ambiguity | Head App integration test |
| SM-6 | Snapshot safety | Requests never observe partial sync state | Integration/concurrency test |
| SM-7 | Observability | Sync failure, stale snapshot, config activation failure, API error-rate, and exclusion validation failure produce Splunk/OpsGenie-routable telemetry | Observability test |
| SM-8 | Architecture approval | HD Supply architecture approval before production deployment | Praveen approval gate |
| SM-9 | Operational ownership | DevOps/prod support can operate health, sync, config, and alert paths | Runbook review |

### 2.4 Counter-Metrics

| ID | Counter-metric | Rationale |
|---|---|---|
| CM-1 | Do not optimize payload size by removing metadata required for debugging. | Correctness and supportability are more important than shaving small JSON payloads. |
| CM-2 | Do not increase sync frequency to chase near-real-time freshness. | Rule activation can be request-time; CMS sync should remain operationally sane. |
| CM-3 | Do not optimize latency by skipping validation or exclusions. | Exclusion correctness is more important than marginal latency improvement. |

---

## 3. Stakeholders, Roles, and Approval Gates

| Stakeholder / group | Role | Approval / responsibility |
|---|---|---|
| Praveen Hariharan | HD Supply primary architect | Blocking architecture approval for deployment model, auth, data flow, observability, and production readiness |
| Sydney Carter / SiteX | Content operations and targeting owner | Approves widget coverage, rule behavior, fallback/default expectations, and golden-profile expected outputs |
| Rich Schunk / Head App team | API consumer | Approves request/response compatibility, error behavior, and integration readiness |
| HD Supply DevOps and production support | Runtime owner | Owns GKE runtime, Cloud SQL, Splunk/OpsGenie alerting, deployments, and production runbooks |
| Optimizely engineering | Build team | Implements service, tests, CI/CD artifacts, and TDD outputs |
| Joshua Rowe | Product Recommendations reintegration gate owner | Owns any future decision to revisit Product Recommendations, but reintegration is not a sprint-1 design driver |
| Optimizely Enterprise Architecture | Architecture quality owner | Ensures PRD/TDD consistency, deterministic rule model, risk closure, and customer-facing accuracy |

---

## 4. Scope and Deployment Decisions

### 4.1 Sprint-1 Scope

Sprint 1 includes:

1. Java 21 / Spring Boot CRePE API.
2. Deployment to a new HD Supply GKE Standard cluster.
3. Cloud SQL for PostgreSQL as durable content snapshot/config state store.
4. Content ingestion from Optimizely Content Graph.
5. Manual and scheduled sync trigger paths.
6. Immutable active catalog snapshot serving.
7. In-memory resolver using active catalog snapshot and active config version.
8. Product Recs-compatible public API response vocabulary.
9. Page -> widget -> rule -> condition YAML configuration.
10. Home page widgets and one production page-header widget.
11. Inclusion, exclusion, global exclusion, date filtering, sorting, rule/widget limits, fallback/default, and page-level dedupe.
12. Entra ID bearer token validation for Head App-to-CRePE and admin access.
13. OTel logs, metrics, traces to collector; Splunk/OpsGenie alert path.
14. Health, readiness, sync status, and effective config endpoints.
15. Golden-profile regression tests from HD Supply TestData and Issues examples.

### 4.2 Explicitly Out of Scope for Sprint 1

1. No SiteX no-code configurator UI.
2. No DB-backed rule-authoring CRUD API for business users.
3. No direct ODP lookup.
4. No Content Graph display asset aggregation.
5. No engagement telemetry or experimentation.
6. No public internet exposure.
7. No local-only config reload endpoint.
8. No Product Recommendations reintegration implementation.
9. No hard deletion of expired/absent content history.

### 4.3 Deployment and Environment Decisions

| Topic | Decision |
|---|---|
| Cluster posture | New GKE Standard cluster |
| CI/CD | Jenkins pipeline |
| Environments | `dev`, `qa1`, `qa2`, `stg`, `prod` |
| CMS environment mapping | `dev` and `qa1` point to test1 CMS; `qa2` and `stg` point to test2 CMS; `prod` points to production CMS |
| Database date storage | PostgreSQL `timestamp with time zone` (`TIMESTAMPTZ`) |
| Alert escalation | Splunk logs/metrics to OpsGenie |
| Observability transport | OpenTelemetry logs, metrics, and traces to HD Supply OTel collector |
| Runtime ownership | HD Supply DevOps and production support team |
| CMS authoring governance | SiteX team |
| Product Recommendations reintegration owner | Joshua Rowe |
| Secret delivery | Google Secret Manager values sourced to the application as environment variables during Helm deployment |

---

## 5. Domain Model and Vocabulary

### 5.1 External vs Internal Vocabulary

| External Product Recs-compatible term | Internal CRePE term | Definition |
|---|---|---|
| `recommend` | resolve | The API verb remains compatibility-oriented; the internal operation is deterministic resolution. |
| `type` | page type | Requested page context such as `home` or `page-header`. |
| `widget` | widget ID | Content slot on a page. |
| `alias` | widget display name | Human-readable widget name. |
| `position` | widget position / slot ID | Rendering slot identifier, usually same as widget ID. |
| `recs` | resolved content items | Ordered content references selected by rules. |
| `refCode` | content ref code / dashless CMS GUID | Dashless content GUID used by the Head App. |
| `title` | content title | CMS display name/title returned for debugging/render support. |
| `customAttributes` | raw attributes | Product Recs-compatible key-value inputs from Head App. |
| `CustomerContext` | canonical customer context | Normalized internal targeting context. |

### 5.2 Required Domain Entities

| Entity | Required fields | Notes |
|---|---|---|
| Page | `pageType`, `displayName`, `activeFrom`, `activeTo`, `widgets`, `dedupePolicy` | A request resolves one or more pages. |
| Widget | `widgetId`, `alias`, `position`, `contentSubTypes`, `widgetPriority`, `maxItems`, `rules`, `fallback`, `activeFrom`, `activeTo` | A configured content slot. |
| Rule | `ruleId`, `ruleName`, `priority`, `maxItems`, `activeFrom`, `activeTo`, `contentSelector`, `conditionMode`, `conditions` | First-class object. Replaces widget-level `matchMode`. |
| Condition | `requestAttribute`, `contentField`, `operator`, optional `values` | A condition compares request context to CMS PF values or to configured literal values. |
| Content item | `contentKey`, `refCode`, `title`, `contentType`, `contentSubType`, `pageScope`, `pfFields`, `publishAt`, `expireAt`, `validationStatus` | A CMS content entry after normalization. |
| Catalog snapshot | `snapshotId`, `status`, `startedAt`, `completedAt`, `itemCounts`, `validationSummary` | Immutable serving dataset once active. |
| Config version | `configVersion`, `status`, `activatedAt`, `checksum`, `sourceCommit`, `validationSummary` | Active rule/config dataset. |
| Golden profile | `profileId`, `inputRequest`, `expectedWidgetOutputs`, `reason` | Acceptance oracle for TDD/regression. |

### 5.3 Required Hierarchy

CRePE's resolver hierarchy is mandatory:

```text
page
  -> widget
      -> rule
          -> condition
```

Rules are first-class objects. A widget-level `ANY` / `ALL` match mode is prohibited because it cannot express HD Supply's required logic, such as:

```text
Rule A: affiliate match
OR
Rule B: winning-relation match
OR
Rule C: TopLink match
OR
Rule D: industry = Hospitality AND state IN [TX, GA, NY, CA]
```

The resolver must union results across rules inside a widget, then dedupe, sort, trim, and fallback deterministically.

---

## 6. Functional Requirements

### 6.1 API Compatibility and Request Handling

#### FR-1: Product Recs-compatible resolve endpoint

CRePE must expose the Head App-facing endpoint:

```http
POST /api/v1/content/recommend
```

The name `recommend` is retained for compatibility. Internally this endpoint invokes the deterministic resolver.

**Acceptance criteria:**

1. The endpoint accepts `application/json` requests.
2. The endpoint requires a valid Microsoft Entra ID bearer token.
3. The endpoint resolves the requested page type(s) using the active config version and active catalog snapshot.
4. The endpoint returns a Product Recs-compatible array of widget result objects on success.
5. The endpoint must not expose internal stack traces, database errors, or raw config payloads in public errors.

#### FR-2: Request body contract

The sprint-1 request body must support the Product Recs-style shape below.

```json
{
  "type": "home",
  "ip": "{{ip}}",
  "userAgent": "{{userAgent}}",
  "currentURI": "https://dev1.hdsupplysolutions.com/",
  "previousURI": "https://dev1.hdsupplysolutions.com/p/example",
  "user": {
    "id": "WCS-765799"
  },
  "customAttributes": {
    "industry": "hospitality",
    "state": "TX",
    "organizationsegments": ["constrainedcontract", "gastate"],
    "affiliate": ["16412428"],
    "winningrelation": ["257400"],
    "toplink": ["321427"],
    "userStatus": "loggedIn"
  },
  "customer": {
    "customerId": "0006064212",
    "segmentIds": ["constrainedcontract"]
  },
  "site": "{{crepeSite}}",
  "clientToken": "{{crepeClientToken}}",
  "lang": "{{lang}}",
  "session": "new",
  "cuid": "75124238753|example",
  "channel": "{{channel}}",
  "debug": false
}
```

**Acceptance criteria:**

1. `type` is required.
2. `type` may be either a string or a non-empty array of strings.
3. If `type` is a string, CRePE resolves one page.
4. If `type` is an array, CRePE resolves pages in array order and returns a flattened widget-result array in page/config order.
5. The legacy PRD v1 field `pageTypes` is not part of the required sprint-1 Head App contract. It may be accepted as a temporary alias only if enabled by an environment/config flag.
6. If both `type` and `pageTypes` are provided, CRePE must return HTTP 400 because the request is ambiguous.
7. Product Recs context fields not used by CRePE targeting, such as `ip`, `userAgent`, `currentURI`, `previousURI`, `site`, `clientToken`, `lang`, `session`, `cuid`, and `channel`, must be accepted and ignored unless explicitly mapped in a future requirement.
8. CRePE must not use ignored Product Recs context fields to change deterministic content selection.

#### FR-3: Canonical customer context normalization

CRePE must normalize the Product Recs-style request into a canonical `CustomerContext` before rule evaluation.

| Canonical attribute | Request source(s) | Normalization |
|---|---|---|
| `industry` | `customAttributes.industry` | token set; lowercase; trimmed |
| `state` | `customAttributes.state` | token set; uppercase state code is accepted, internally lowercase token |
| `organizationsegments` | `customAttributes.organizationsegments`, `customer.segmentIds` | merge into one token set |
| `soldto` | `customAttributes.soldto`, `customer.customerId` | merge into one token set; preserve leading zeros |
| `toplink` | `customAttributes.toplink` | token set; preserve numeric string |
| `winningrelation` | `customAttributes.winningrelation`, `customAttributes.wr` | token set; preserve numeric string |
| `affiliate` | `customAttributes.affiliate` | token set; preserve numeric string |
| `comptype` | `customAttributes.comptype` | token set |
| `zipcode` | `customAttributes.zipcode` | token set; preserve leading zeros |
| `searchterm` | `customAttributes.searchterm` | normalized text token |
| `categoryidentifier` | `customAttributes.categoryidentifier` | lowercase token |
| `parentcategeoryidentifiers` | `customAttributes.parentcategeoryidentifiers` | lowercase token set; typo preserved because CMS field is typoed |
| `partnumber` | `customAttributes.partnumber` | token set |
| `productattributes` | `customAttributes.productattributes` | token set |
| `userStatus` | `customAttributes.userStatus` | one of `guest`, `cookied`, `loggedIn`; aliases normalized |

**Acceptance criteria:**

1. Scalar request values must normalize to single-token sets.
2. Array request values must normalize to token sets.
3. Empty strings, blank array entries, and nulls must be discarded.
4. Duplicate tokens must be removed.
5. Numeric identifiers must remain strings; CRePE must not parse numeric IDs as numbers because leading zeros may be significant.
6. Unknown `customAttributes` keys must be accepted but ignored. They must be logged only at debug level to avoid noisy production logs.
7. Invalid known values for `userStatus` must return HTTP 400 because user status drives targeting.
8. Missing request attributes must be represented as empty token sets and must not match conditions.

#### FR-4: Product Recs-compatible response contract

On success, CRePE must return a top-level JSON array. The array contains one object per resolved widget.

```json
[
  {
    "widget": "home_hpherocarousel",
    "alias": "Homepage Carousel",
    "position": "home_hpherocarousel",
    "recs": [
      {
        "refCode": "964012041b5f463d9a7e3dfa68aba80d",
        "title": "IHG Hotels - Avid - Home Hero - Brand Guide"
      }
    ],
    "metadata": {
      "resolutionStatus": "MATCHED",
      "pageType": "home",
      "itemCount": 1,
      "maxItems": 5,
      "activeSnapshotId": "2026-06-08T12:00:00Z",
      "configVersion": "home-rules-2026-06-08",
      "evaluatedAt": "2026-06-08T12:34:56.789Z"
    }
  }
]
```

**Acceptance criteria:**

1. Required Product Recs-compatible fields: `widget`, `alias`, `position`, `recs`.
2. Required content fields inside each `rec`: `refCode`, `title`.
3. `refCode` must be the dashless content GUID.
4. `recs` must be an array. It may be empty.
5. Widget result order must follow page configuration order after page ordering.
6. Additional `metadata` is allowed because JSON consumers can ignore unknown fields.
7. Metadata must include `resolutionStatus`, `pageType`, `itemCount`, `maxItems`, `activeSnapshotId`, `configVersion`, and `evaluatedAt`.
8. CRePE must not return the PRD v1 `widgets[].items[].contentKey` response as the default sprint-1 contract.

#### FR-5: Debug response metadata

CRePE must support gated debug metadata for integration testing and support.

Debug metadata may be requested through `debug: true` only when the bearer token includes an approved debug/admin scope or role.

```json
{
  "refCode": "964012041b5f463d9a7e3dfa68aba80d",
  "title": "IHG Hotels - Avid - Home Hero - Brand Guide",
  "debug": {
    "matchedRuleId": "affiliate-ihg-avid",
    "matchedRuleName": "Affiliate: IHG Avid",
    "matchedConditions": ["affiliate"],
    "rulePriority": 900,
    "weight": 2500,
    "excludedBy": [],
    "candidateReason": "matched rule affiliate-ihg-avid"
  }
}
```

**Acceptance criteria:**

1. Normal Head App calls without debug scope must not include detailed condition-level debug output.
2. Calls with `debug: true` but without debug/admin authorization must return HTTP 403 or ignore debug based on security review. The sprint-1 default is HTTP 403 to avoid silent surprise.
3. Debug metadata must identify the selected rule when an item appears in output.
4. If an item matched multiple rules, debug metadata must identify the winning attribution rule according to rule priority and tie-break rules.
5. Empty widgets must include widget-level debug metadata in authorized debug mode explaining `NO_MATCH`, `FALLBACK_EMPTY`, `EXCLUDED`, or `DEDUPED_EMPTY`.

#### FR-6: API error behavior

CRePE must use conventional HTTP status codes.

| Condition | Status | Response |
|---|---:|---|
| Success | 200 | Product Recs-compatible array |
| Malformed JSON | 400 | Problem details JSON |
| Missing required `type` | 400 | Problem details JSON |
| Unknown page type | 400 | Problem details JSON |
| Ambiguous request with both `type` and `pageTypes` | 400 | Problem details JSON |
| Invalid known customer attribute value, such as invalid `userStatus` | 400 | Problem details JSON |
| Missing/invalid bearer token | 401 | Problem details JSON |
| Valid token without required scope/role | 403 | Problem details JSON |
| Admin sync/config conflict | 409 | Problem details JSON |
| Unexpected server failure | 500 | Problem details JSON |
| Temporarily unavailable due to startup with no active snapshot | 503 | Problem details JSON |

**Acceptance criteria:**

1. The success response must not use the PRD v1 `success: true` envelope.
2. Error responses must not be Product Recs-compatible arrays.
3. Problem details must include `traceId` for observability correlation.
4. CRePE must never return HTTP 200 with arbitrary recs when resolution fails.

---

### 6.2 Content Ingestion, Snapshotting, and Cache Safety

#### FR-7: Scheduled and manual content sync

CRePE must support both scheduled and manually triggered Content Graph sync.

**Endpoints and triggers:**

```http
POST /api/v1/admin/sync
GET  /api/v1/admin/sync/status
```

**Acceptance criteria:**

1. Sync must be triggerable by scheduler.
2. Sync must be triggerable manually for testing and operations.
3. Admin sync endpoints require admin scope/role.
4. Sync must pull all configured CMS content fields and PF fields required for sprint-1 rules.
5. Sync must emit OTel logs, metrics, and traces.
6. Sync must obtain a cluster-wide lock before starting.
7. If another sync is running, manual sync must return HTTP 409 with current sync status.
8. Scheduled sync must not run concurrently with manual sync.

#### FR-8: Immutable active catalog snapshots

CRePE must serve API requests from an immutable active catalog snapshot.

**Required behavior:**

```text
1. Sync starts and creates a BUILDING snapshot.
2. CRePE pulls content from Content Graph.
3. CRePE normalizes fields and validates content.
4. CRePE writes the candidate snapshot to PostgreSQL.
5. CRePE builds the in-memory index for the candidate snapshot.
6. CRePE activates the snapshot atomically only after successful validation.
7. All pods switch to the new active snapshot version.
8. If the sync fails before activation, the prior active snapshot remains serving.
```

**Acceptance criteria:**

1. Requests must never read directly from a BUILDING snapshot.
2. Requests must never see a partially ingested catalog.
3. Each API response must include the `activeSnapshotId` in metadata.
4. A failed sync must not alter the active snapshot pointer.
5. A pod that cannot load the active snapshot must fail readiness but must not serve mixed data.
6. PostgreSQL is the durable snapshot store and cold-start source.
7. In-memory immutable indexes are the request-time resolver source.
8. Request-time matching must not depend on PostgreSQL array-overlap queries for correctness.

#### FR-9: Snapshot activation and pod propagation

Snapshot activation must be cluster-consistent.

**Acceptance criteria:**

1. Active snapshot identity must be stored in PostgreSQL or another cluster-visible control plane.
2. Each pod must maintain an atomic reference to the active in-memory snapshot.
3. Pods must detect active snapshot changes within a configurable interval. Sprint-1 target: <= 30 seconds.
4. A pod must continue serving the prior active snapshot while loading the new snapshot.
5. A pod must switch only after fully loading and validating the new in-memory index.
6. `GET /api/v1/health/readiness` must fail if a pod cannot load any active snapshot.
7. `GET /api/v1/admin/sync/status` must report per-pod active snapshot version if available.

#### FR-10: Soft delete, expiration, absence, and reactivation

CRePE must not hard-delete content history solely because content is absent or expired.

**Acceptance criteria:**

1. Content absent from a clean full sync must be marked inactive/absent in the new snapshot, not hard-deleted from historical storage.
2. Expired content must be marked ineligible at request time while expired.
3. Previously expired or absent content may become eligible again if it reappears in Content Graph or has future active dates.
4. CRePE must preserve enough history to diagnose why content disappeared from serving output.
5. Sweep deletion of historical rows is out of scope for sprint 1 except for retention policies approved by DevOps/security.
6. A partial failed sync must not mark missing items inactive because absence cannot be distinguished from sync failure.
7. A clean full sync may produce a new active snapshot where absent items are not eligible, while their historical rows remain stored.

#### FR-11: Item-level ingestion failure behavior

CRePE must distinguish between normal transform failures and safety-related validation failures.

| Failure type | Behavior |
|---|---|
| Content Graph request fails | Do not activate candidate snapshot. Keep prior active snapshot. Alert. |
| Required system field missing, such as content GUID | Mark item invalid in candidate snapshot. Do not serve item. Alert if count exceeds threshold. |
| Non-exclusion unknown PF field | Drop unknown field, warn, item may remain eligible if other fields are valid. |
| Malformed non-critical field, such as bad weight | Apply default behavior if defined, warn. |
| Unknown or malformed exclusion-like PF field | Fail closed for affected item. Mark item ineligible. Alert. Do not carry forward previous version for that item. |
| Config references unknown field | Reject config version. Keep prior active config. Alert. |

**Acceptance criteria:**

1. The active snapshot may include invalid items, but invalid items must be marked `servingEligible=false`.
2. Invalid items must be visible in sync status and debug/admin endpoints.
3. Unknown exclusion-like fields must not be silently dropped.
4. If an item has a safety-related validation failure, CRePE must not serve its prior last-good version because the current CMS metadata indicates possible exclusion intent.

---

### 6.3 PF Field Inventory, Normalization, and Validation

#### FR-12: Canonical PF field inventory

CRePE must use the HD Supply workbook `FieldsList` inventory as the sprint-1 source of truth, superseding Appendix A of the May 27 PRD.

| CMS field name | CMS type | CRePE PF attribute | Request attribute | Notes |
|---|---|---|---|---|
| ContentSubType | choice | `pf_contentsubtype` | n/a | Specialized content classification field |
| PageScope | choice | `pf_pagescope` | n/a | Specialized page scoping field |
| Weight | number | `pf_weight` | n/a | Number 0-9999 |
| SearchTerm | text | `pf_searchterm` | `searchterm` |  |
| CategoryIdentifier | text | `pf_categoryidentifier` | `categoryidentifier` | Lowercase |
| excludeCategoryIdentifier | text | `pf_excludecategoryidentifier` | n/a | Excludes against `categoryidentifier` |
| ParentCategeoryIdentifiers | text | `pf_parentcategeoryidentifiers` | `parentcategeoryidentifiers` | CMS spelling preserved |
| excludeParentCategeoryIdentifiers | text | `pf_excludeparentcategeoryidentifiers` | n/a | Excludes against `parentcategeoryidentifiers` |
| Partnumber | text | `pf_partnumber` | `partnumber` |  |
| excludePartnumber | text | `pf_excludepartnumber` | n/a | Excludes against `partnumber` |
| ProductAttributes | text | `pf_productattributes` | `productattributes` |  |
| excludeProductAttributes | text | `pf_excludeproductattributes` | n/a | Excludes against `productattributes` |
| OrganizationSegments | text | `pf_organizationsegments` | `organizationsegments` | May be populated from `customAttributes` and `customer.segmentIds` |
| excludeOrganizationSegments | text | `pf_excludeorganizationsegments` | n/a | Excludes against `organizationsegments` |
| CompType | text | `pf_comptype` | `comptype` |  |
| excludeCompType | text | `pf_excludecomptype` | n/a | Excludes against `comptype` |
| Industry | choice | `pf_industry` | `industry` | Supersedes `pf_industryvertical` for sprint 1 |
| excludeIndustry | choice | `pf_excludeindustry` | n/a | Excludes against `industry` |
| SoldTo | text | `pf_soldto` | `soldto` | May be populated from `customer.customerId` |
| excludeSoldTo | text | `pf_excludesoldto` | n/a | Excludes against `soldto` |
| Toplink | text | `pf_toplink` | `toplink` |  |
| excludeToplink | text | `pf_excludetoplink` | n/a | Excludes against `toplink` |
| WinningRelation | text | `pf_winningrelation` | `winningrelation` | Alias `wr` accepted in request |
| excludeWinningRelation | text | `pf_excludewinningrelation` | n/a | Excludes against `winningrelation` |
| Affiliate | text | `pf_affiliate` | `affiliate` |  |
| excludeAffiliate | text | `pf_excludeaffiliate` | n/a | Excludes against `affiliate` |
| State | text | `pf_state` | `state` | Supersedes `pf_states` for sprint 1 |
| excludeState | text | `pf_excludestate` | n/a | Excludes against `state` |
| Zipcode | text | `pf_zipcode` | `zipcode` |  |
| excludeZipcode | text | `pf_excludezipcode` | n/a | Excludes against `zipcode` |
| UserStatus | choice | `pf_userstatus` | `userStatus` | New sprint-1 field: `guest`, `cookied`, `loggedIn` |
| excludeUserStatus | choice | `pf_excludeuserstatus` | n/a | Excludes against `userStatus` |

**Acceptance criteria:**

1. `pf_industryvertical` and `pf_states` are legacy aliases only. CRePE may map them to `pf_industry` and `pf_state` if present, but sprint-1 documentation and config must use the workbook names.
2. `pf_weight` range is 0-9999.
3. `pf_contentsubtype` and `pf_pagescope` are first-class specialized fields.
4. `pf_userstatus` and `pf_excludeuserstatus` must be added to support guest/cookied/logged-in targeting.
5. Config validation must fail if a rule references a field not in this canonical inventory or alias mapping.

#### FR-13: Field name validation and alias mapping

CRePE must normalize CMS field names and map known aliases/typos.

**Acceptance criteria:**

1. CMS field name matching must be case-insensitive.
2. Known documented aliases and typos must map to canonical fields.
3. Examples of allowed alias mapping:
   - `pf_industryvertical` -> `pf_industry`
   - `pf_states` -> `pf_state`
   - documented `pf_excludeselected*` variants -> canonical `pf_exclude*`
   - documented typo variants such as `pf_exclide*` -> canonical exclusion field if the target is known
4. Unknown non-exclusion PF fields must be dropped from the serving model and logged as warnings.
5. Unknown exclusion-like PF fields must fail closed as defined in FR-14.
6. Alias mappings must be test-covered and versioned with config/code.

#### FR-14: Exclusion validation must fail closed

CRePE must treat unrecognized exclusion-like PF fields as safety failures.

An exclusion-like field is any PF field that matches one of these patterns after lowercase normalization and punctuation removal:

```text
pf_exclude*
pf_excludeselected*
pf_excl*
pf_exclide*
pf_exclud*
```

**Acceptance criteria:**

1. If an exclusion-like field can be mapped to a known canonical exclusion field, CRePE must map it and continue.
2. If an exclusion-like field cannot be mapped, CRePE must mark the affected content item ineligible for serving.
3. CRePE must emit a high-severity validation event for the affected content item.
4. CRePE must increment `crepe_exclusion_validation_failures_total`.
5. CRePE must include the validation error in admin sync status.
6. CRePE must not silently drop unknown exclusion-like fields.
7. CRePE must not serve a prior last-good version of an item when the current CMS item contains an unknown exclusion-like field.

#### FR-15: Value normalization

CRePE must normalize request and CMS field values consistently before matching.

| Input pattern | Normalized result |
|---|---|
| `"Hospitality"` | `hospitality` |
| `" hospitality "` | `hospitality` |
| `"Commercial, Trade, Healthcare"` | `commercial`, `trade`, `healthcare` for fields configured as delimited token fields |
| `["Hospitality", "Trade"]` | `hospitality`, `trade` |
| `"TX"` for state | `tx` |
| `"0006064212"` | `0006064212` |
| `"topLink (321427, 1271155)"` in workbook notes | Not a literal CMS/request value; parsed test-data notation only |
| Empty string | no token |
| Null | no token |

**Acceptance criteria:**

1. Matching must be case-insensitive unless a field is explicitly configured as case-sensitive. Sprint-1 fields are case-insensitive.
2. String and array cross-cases must compare as token sets.
3. Comma-delimited CMS text values must be split only for fields configured as token-list fields.
4. Numeric IDs must be treated as strings.
5. Whitespace must be trimmed.
6. Duplicate tokens must be removed.
7. Missing request attributes produce empty sets and do not match.
8. Missing content PF fields produce empty sets and do not match.
9. Empty arrays do not match.

---

### 6.4 Rule Configuration Model

#### FR-16: YAML configuration hierarchy

CRePE sprint 1 must use YAML configuration with this hierarchy:

```text
config version
  -> pages
      -> widgets
          -> rules
              -> conditions
  -> fallback product sets
  -> global exclusion buckets
  -> field aliases
  -> operator policy
```

**Acceptance criteria:**

1. Widget-level `matchMode` is prohibited in sprint-1 config.
2. Every matching behavior must be expressed through rules and conditions.
3. Rules are unioned within a widget.
4. Conditions inside a rule are combined by that rule's `conditionMode`.
5. New page types and widgets must be addable by YAML without Java code changes.
6. Config must be validated before activation.
7. Invalid config must not replace the active config.

#### FR-17: Required YAML shape

The following YAML shape is normative for sprint 1. Field names may be adjusted in the TDD only if the semantics remain identical.

```yaml
configVersion: home-rules-2026-06-08
businessTimezone: America/New_York

pages:
  - pageType: home
    displayName: Home
    activeFrom: null
    activeTo: null
    dedupe:
      enabled: true
      key: refCode
      strategy: widgetPriorityThenRulePriorityThenWeight
    widgets:
      - widgetId: home_hpherocarousel
        alias: Homepage Carousel
        position: home_hpherocarousel
        widgetPriority: 100
        contentSubTypes:
          - Hero Carousel
        maxItems: 5
        activeFrom: null
        activeTo: null
        fallback:
          enabled: true
          strategy: productSet
          productSetId: home_hpherocarousel_default
        rules:
          - ruleId: affiliate
            ruleName: Affiliate Rule
            priority: 900
            maxItems: null
            activeFrom: null
            activeTo: null
            contentSelector:
              requiredFields: [pf_affiliate]
              prohibitedFields: []
            conditionMode: ALL
            conditions:
              - requestAttribute: affiliate
                contentField: pf_affiliate
                operator: overlapsAny

          - ruleId: winning-relation
            ruleName: Winning Relation Rule
            priority: 800
            maxItems: null
            activeFrom: null
            activeTo: null
            contentSelector:
              requiredFields: [pf_winningrelation]
              prohibitedFields: []
            conditionMode: ALL
            conditions:
              - requestAttribute: winningrelation
                contentField: pf_winningrelation
                operator: overlapsAny

          - ruleId: toplink
            ruleName: TopLink Rule
            priority: 700
            maxItems: null
            activeFrom: null
            activeTo: null
            contentSelector:
              requiredFields: [pf_toplink]
              prohibitedFields: []
            conditionMode: ALL
            conditions:
              - requestAttribute: toplink
                contentField: pf_toplink
                operator: overlapsAny

          - ruleId: industry-state
            ruleName: Industry and State Rule
            priority: 600
            maxItems: null
            activeFrom: null
            activeTo: null
            contentSelector:
              requiredFields: [pf_industry, pf_state]
              prohibitedFields: [pf_affiliate, pf_toplink, pf_winningrelation, pf_soldto]
            conditionMode: ALL
            conditions:
              - requestAttribute: industry
                contentField: pf_industry
                operator: equalsAny
              - requestAttribute: state
                contentField: pf_state
                operator: overlapsAny

fallbackProductSets:
  - productSetId: home_hpherocarousel_default
    description: Default hero carousel content when no targeted rule matches
    itemRefs:
      - c021dc3ebc1941708d9d629bdc6aba53

globalExclusionBuckets:
  - bucketId: constrained-contract-sale-content
    description: Prevent constrained contract customers from seeing sale-oriented content in selected home widgets
    appliesTo:
      pageTypes: [home]
      widgetIds: [home_hpherocarousel, home_hppromotile]
    itemRefs: []
    excludeWhen:
      conditionMode: ANY
      conditions:
        - requestAttribute: organizationsegments
          operator: overlapsAny
          values: [constrainedcontract]
```

**Acceptance criteria:**

1. `configVersion` is required and must be included in API metadata.
2. `businessTimezone` is required and defaults to `America/New_York` only if omitted by legacy config.
3. `pageType`, `widgetId`, `ruleId`, `ruleName`, `priority`, and `conditions` are required for non-fallback rules.
4. `contentSelector.requiredFields` is required unless a rule explicitly declares `selectorMode: none`.
5. `contentSelector.prohibitedFields` is optional and defaults to empty.
6. `conditionMode` must be `ALL` or `ANY`.
7. Nested condition groups are out of scope for sprint 1. If `(A AND B) OR (C AND D)` is needed, configure two rules.
8. `maxItems` may be null at rule level, but must be a positive integer at widget level.

#### FR-18: Page and widget scheduling

CRePE must support scheduled activation/deactivation at page, widget, and rule level.

**Acceptance criteria:**

1. `activeFrom` is inclusive.
2. `activeTo` is exclusive.
3. A null `activeFrom` means active from the beginning of time.
4. A null `activeTo` means no configured end.
5. Page, widget, and rule windows compose by intersection. If any level is inactive, the item cannot be selected through that path.
6. Scheduled widget add/remove must be expressible by setting widget `activeFrom` and `activeTo`.
7. Scheduled rule add/remove must be expressible by setting rule `activeFrom` and `activeTo`.
8. Rules become active/inactive at request evaluation time without requiring content resync.
9. Date-only YAML values, if allowed, must be interpreted in `businessTimezone`. Sprint-1 preferred format is ISO-8601 with timezone offset.

#### FR-19: Content selector semantics

A rule's `contentSelector` determines which content items the rule may evaluate.

**Acceptance criteria:**

1. `requiredFields` means the content item must contain all listed PF fields with at least one normalized token.
2. `prohibitedFields` means the content item must not contain any listed PF field with normalized tokens.
3. If a content item fails the selector, the rule must not evaluate conditions for that item.
4. Content selectors prevent more-specific content, such as affiliate- or TopLink-specific content, from leaking through generic industry rules unless explicitly allowed.
5. The selector result must be visible in debug mode.

---

### 6.5 Targeting Resolver Semantics

#### FR-20: Mandatory evaluation order

CRePE must evaluate requests in this exact order:

```text
1. Validate bearer token.
2. Parse and validate request body.
3. Normalize request into canonical CustomerContext.
4. Select active catalog snapshot.
5. Select active config version.
6. Resolve requested page type(s).
7. For each page, select active widgets in configured order.
8. For each widget:
   a. Build candidate pool by page scope and content subtype.
   b. For each active rule:
      i. Apply rule contentSelector.
      ii. Evaluate rule conditions.
      iii. Apply item-level exclusions.
      iv. Apply global exclusion buckets.
      v. Apply CMS publish/expire windows.
      vi. Apply page/widget/rule activation windows.
      vii. Sort rule result candidates.
      viii. Apply rule-level maxItems, if configured.
   c. Union rule results.
   d. Deduplicate within widget by refCode.
   e. Sort final widget candidates.
   f. Apply widget-level maxItems.
   g. If empty, evaluate explicit fallback/default strategy.
9. Apply page-level cross-widget dedupe.
10. Backfill widgets if dedupe removed items and eligible backfill exists.
11. Map canonical results to Product Recs-compatible response.
12. Attach metadata/debug fields according to authorization.
13. Emit metrics/logs/traces.
```

**Acceptance criteria:**

1. This order must be represented in unit tests and integration tests.
2. The TDD may split implementation into classes/functions, but must not change semantics.
3. If ordering changes in the future, it must be approved as a PRD/TDD change because it can affect customer-visible results.

#### FR-21: Inclusion matching

A content item is normally eligible for a widget only if it matches at least one active include rule for that widget.

**Acceptance criteria:**

1. A content item with no matching rule is not eligible.
2. A content item with no relevant PF fields is not a universal match.
3. A rule with `conditionMode: ALL` matches only when all conditions are true.
4. A rule with `conditionMode: ANY` matches when at least one condition is true.
5. Missing request attributes cause conditions referencing them to evaluate false.
6. Missing content PF fields cause conditions referencing them to evaluate false.
7. Extra request attributes do not cause a match unless a rule references them.
8. Extra content PF fields do not cause a match unless a rule selector/condition references them.
9. Content that matched no include rule must not be used to fill widget slots.

#### FR-22: Operators

Sprint 1 must support these operators.

| Operator | Required? | Semantics |
|---|---:|---|
| `equalsAny` | Yes | True when normalized request tokens and content/config tokens share at least one exact token. Intended for choice/scalar fields. |
| `overlapsAny` | Yes | True when normalized request token set intersects normalized content/config token set. Intended for list/multi-value fields. |
| `containsAny` | Yes | True when normalized content text contains at least one normalized request/config token. May be enabled only for fields explicitly listed in operator policy. |
| `notContainsAny` | Yes | True when normalized content text does not contain any normalized request/config token and the content field is present. May be enabled only for fields explicitly listed in operator policy. |
| `exists` | Yes | True when the referenced request or content field has at least one normalized token. |
| `notExists` | Yes | True when the referenced request or content field has no normalized tokens. |

**Acceptance criteria:**

1. `containsAny` and `notContainsAny` must not be globally available for all fields by default.
2. Operator policy must explicitly list fields that allow contains-style matching.
3. Contains-style matching must be tested for false positives such as short tokens matching unrelated words.
4. `notContainsAny` must not be used as an implicit fallback/default. It is only true when configured in a rule and all other rule semantics pass.
5. Unknown operators in YAML must reject config activation.

#### FR-23: Exclusion filtering

Exclusions are absolute and must be evaluated after inclusion but before final output.

**Acceptance criteria:**

1. If any item-level exclusion PF field matches the customer context, the content item must be removed.
2. If any global exclusion bucket applies and matches the customer context for the item/widget/page, the content item must be removed.
3. Exclusion wins over all inclusion matches.
4. Exclusion wins over fallback/default selection.
5. Exclusion wins over weight and priority.
6. Exclusion match debug information must be available in authorized debug mode.
7. Excluded items must not be available for backfill.

#### FR-24: Global exclusion buckets

CRePE must support YAML-configured global exclusion buckets so SiteX does not need to tag every excluded item individually in CMS.

**Acceptance criteria:**

1. A global exclusion bucket must have `bucketId`, `appliesTo`, `excludeWhen`, and at least one item selector.
2. Sprint-1 item selector is `itemRefs`, a list of dashless refCodes/content GUIDs.
3. Future selector types may include content subtype, page scope, tags, or content category, but sprint 1 must not infer unsupported selectors.
4. A global exclusion bucket applies only when page/widget scope matches `appliesTo`.
5. If `itemRefs` is empty, the bucket is valid but excludes no items. This supports staged setup.
6. If a bucket references an unknown refCode, config activation must fail in strict environments and warn in non-prod based on environment policy. Production default is fail activation.
7. Global exclusion buckets must be included in debug explanation when they remove an item.

#### FR-25: Date filtering and timezone policy

CRePE must enforce CMS and YAML activation windows using a single timezone policy.

**Acceptance criteria:**

1. PostgreSQL stores all timestamps as `TIMESTAMPTZ`.
2. Application comparisons use instants derived from the server clock.
3. CMS publish date is inclusive.
4. CMS expire/unpublish date is exclusive.
5. YAML `activeFrom` is inclusive.
6. YAML `activeTo` is exclusive.
7. CMS content dates and YAML config dates compose by intersection.
8. If any required active window is inactive, the content item is not eligible through that path.
9. YAML date-time values must include timezone offset or be interpreted in `businessTimezone`.
10. `businessTimezone` default is `America/New_York` for HD Supply unless explicitly overridden.
11. Date-only values, if accepted, map to local business-day boundaries: start date at 00:00 local inclusive; end date at 00:00 local on the following day exclusive.

#### FR-26: Weighting and deterministic sorting

CRePE must sort results deterministically.

**Sort order inside a rule:**

1. Rule priority descending.
2. `pf_weight` descending.
3. CMS publish date descending.
4. Content title ascending.
5. `refCode` ascending.

**Sort order after union inside a widget:**

1. Winning rule priority descending.
2. `pf_weight` descending.
3. CMS publish date descending.
4. Content title ascending.
5. `refCode` ascending.

**Acceptance criteria:**

1. `pf_weight` valid range is 0-9999.
2. Missing `pf_weight` defaults to 0.
3. Malformed `pf_weight` defaults to 0 and emits a validation warning.
4. Out-of-range `pf_weight` defaults to 0 and emits a validation warning unless strict validation is enabled.
5. Equal weights must never produce nondeterministic ordering.
6. A content item that matches multiple rules in one widget appears once, attributed to the highest-priority matched rule; ties use the same deterministic sort order.

#### FR-27: Rule-level and widget-level limits

CRePE must support both rule-level and widget-level item limits.

**Acceptance criteria:**

1. `rule.maxItems` is optional.
2. If `rule.maxItems` is present, it must be a positive integer.
3. `widget.maxItems` is required and must be a positive integer.
4. Rule-level trim happens before union across rules.
5. Widget-level trim happens after union, within-widget dedupe, and final widget sorting.
6. If fewer items survive than the configured limit, CRePE returns fewer items; it must not pad with non-matches.
7. Fallback may fill only when no normal items survive for the widget, not when a widget returns fewer than maxItems unless a future explicit backfill mode is approved.

#### FR-28: Fallback/default strategy

Fallback/default content must be explicit.

**Acceptance criteria:**

1. CRePE must never use arbitrary catalog content as fallback.
2. CRePE must never fill remaining slots with non-matching content.
3. Fallback executes only when a widget has zero normal results after inclusion, exclusion, date, rule limits, union, within-widget dedupe, sort, and widget trim.
4. Sprint-1 fallback strategy is `productSet`.
5. A fallback product set contains an ordered list of `itemRefs`.
6. Fallback items must still pass safety filters: item-level exclusions, global exclusions, CMS dates, page/widget active windows, and serving eligibility.
7. Fallback items are sorted by fallback product-set order first, then `pf_weight`, then deterministic tie-breakers, unless config explicitly says `sortByWeight`.
8. If no fallback item survives, the widget must return `recs: []` with `resolutionStatus: "NO_MATCH_NO_FALLBACK"` or `"FALLBACK_EMPTY"`.
9. The Head App is responsible for rendering/collapsing an empty widget according to its UI behavior.

#### FR-29: Page-level cross-widget dedupe

CRePE must support Product Recs parity dedupe so the same `refCode` does not appear in more than one widget on the same page response when dedupe is enabled.

**Acceptance criteria:**

1. Page-level dedupe is configured per page.
2. Default sprint-1 policy for `home` is dedupe enabled by `refCode`.
3. Widgets are processed in `widgetPriority` descending, then configuration order.
4. If a content item appears in an earlier widget, it is removed from later widgets on the same page response.
5. If dedupe removes an item from a later widget, the widget may backfill from its remaining eligible candidates.
6. Backfill must use only candidates that already passed normal or fallback eligibility.
7. Fallback items participate in dedupe unless a future approved config explicitly exempts them. Sprint-1 default: no exemptions.
8. Dedupe behavior must be included in authorized debug output.

#### FR-30: Page scope and content subtype filtering

CRePE must use page scope and content subtype to limit candidate pools before rule evaluation.

**Acceptance criteria:**

1. `pf_contentsubtype` is the preferred source for content subtype.
2. If `pf_contentsubtype` is absent, CRePE may use CMS content type only if `allowCmsContentTypeFallback=true` is set for the widget. Production default is false once CMS tagging is complete.
3. `pf_pagescope` is the preferred source for page eligibility.
4. A content item with `pf_pagescope` must match the requested page type or a configured wildcard value such as `all`.
5. A content item missing `pf_pagescope` is ineligible unless the page/widget config explicitly sets `allowMissingPageScope=true`. Production default is false once CMS tagging is complete.
6. Widget `contentSubTypes` must match normalized content subtype values.
7. Page scope and content subtype mismatches must be visible in debug mode.

---

### 6.6 Page and Widget Coverage

#### FR-31: Sprint-1 page coverage

CRePE sprint 1 must support these page types:

| Page type | Scope |
|---|---|
| `home` | Required |
| `page-header` | Required, one production widget only |

#### FR-32: Home page widgets

CRePE must provide configuration for these home widgets:

| Widget ID | Required? | Notes |
|---|---:|---|
| `home_hpherocarousel` | Yes | Hero carousel |
| `home_hpherostripbanner` | Yes | Strip banner |
| `home_hpmajoralertbanner` | Yes | Major alert banner |
| `home_hpmidbanner1` | Yes | Middle banner 1 |
| `home_hpmidbanner2` | Yes | Middle banner 2 |
| `home_hpmidbanner3` | Yes | Middle banner 3 |
| `home_hpminoralertbanner` | Yes | Minor alert banner |
| `home_hppromotile` | Yes | Promo tile |
| `home_hpresource1` | Yes | Resource card 1 |
| `home_hpresource2` | Yes | Resource card 2 |

#### FR-33: Page-header widgets

CRePE must configure only one sprint-1 production page-header widget unless HD Supply later approves additional production widgets.

| Widget ID | Required? | Notes |
|---|---:|---|
| `cobranded_logo` | Yes | Production page-header widget |
| `ecom10911-*` test widgets | No | Test entries are ignored and must not be propagated to production |
| `*DELETE-ME*` widgets | No | Must not ship in production config |

**Acceptance criteria:**

1. The May 27 PRD's statement that page-header has 12 sprint-1 production widgets is superseded.
2. Success metrics must reference 10 home widgets plus 1 page-header widget unless additional widgets are approved.
3. Production config validation must fail if widget IDs include `DELETE-ME`.
4. Non-prod test widgets may exist only in non-prod environment overlays and must be explicitly gated.

---

### 6.7 Configuration Activation and Effective Config

#### FR-34: Configuration source and promotion

Sprint-1 configuration must be managed as versioned YAML promoted through Git/Jenkins/Helm.

**Acceptance criteria:**

1. Sprint-1 config changes follow normal code/config promotion pipeline.
2. Config must be validated in lower environments before production promotion.
3. Config files must not contain secrets.
4. Config version/checksum must be visible in API metadata and admin endpoints.
5. Scheduled activation through YAML date windows must happen at request evaluation time and does not require resync.

#### FR-35: No local-only reload endpoint

The May 27 PRD's local file reload behavior is not allowed for sprint 1 production.

**Acceptance criteria:**

1. CRePE must not expose an endpoint that reloads YAML only on the pod receiving the request.
2. If any reload/activation endpoint is implemented, it must activate one cluster-visible config version for all pods.
3. Sprint-1 default is config promotion through Jenkins/Helm rolling deployment, not ad hoc local reload.
4. Future sprint DB/UI-driven config activation must be defined in a separate PRD/TDD section.

#### FR-36: Effective config endpoint

CRePE must expose an admin endpoint to view effective config metadata.

```http
GET /api/v1/admin/config/effective
```

**Acceptance criteria:**

1. Endpoint requires admin scope/role.
2. Endpoint returns `configVersion`, checksum, source commit/build identifier, activation time, page/widget/rule counts, and validation summary.
3. Endpoint may return sanitized config details but must not return secrets.
4. Endpoint must show whether scheduled page/widget/rule windows are currently active or inactive at the time of the call.
5. Endpoint must support debugging "did my scheduled rule go live?" without requiring logs.

---

### 6.8 Security

#### FR-37: Microsoft Entra ID bearer token validation

CRePE must validate Microsoft Entra ID-issued bearer tokens for Head App and admin requests.

**Acceptance criteria:**

1. Head App obtains token from Microsoft Entra ID.
2. CRePE validates JWT signature using Entra JWKS.
3. CRePE validates issuer.
4. CRePE validates audience.
5. CRePE validates expiration and not-before claims.
6. CRePE validates required scopes/roles.
7. CRePE caches JWKS with safe refresh behavior.
8. Invalid/missing token returns HTTP 401.
9. Valid token without required scope/role returns HTTP 403.
10. Static manually rotated Head App bearer token from the May 27 draft is not the sprint-1 target.

#### FR-38: Scope/role requirements

CRePE must separate resolve, debug, and admin permissions.

| Permission | Required for |
|---|---|
| `Content.Resolve` or equivalent app role/scope | `POST /api/v1/content/recommend` |
| `Content.Debug` or admin equivalent | `debug: true` response metadata |
| `Crepe.Admin` or equivalent | `/api/v1/admin/*` endpoints |
| Kubernetes/internal probe identity or network policy | Liveness/readiness endpoints as approved by DevOps |

**Acceptance criteria:**

1. Scope/role names may be finalized in TDD, but separation of permissions is mandatory.
2. Debug metadata must not be available to ordinary end-user traffic.
3. Admin endpoints must not be accessible with only resolve permission.

#### FR-39: Network and secret security

CRePE must be internal-only and secret-safe.

**Acceptance criteria:**

1. Public internet exposure is prohibited.
2. CRePE endpoint is reachable only from approved Head App/network paths.
3. Content Graph token and other secrets come from Google Secret Manager sourced into environment variables via Helm.
4. No secrets in source code, container images, YAML rule config, logs, traces, metrics, or error responses.
5. Database access must use HD Supply-approved Cloud SQL access pattern, preferably Workload Identity / Cloud SQL Auth Proxy or equivalent approved setup.
6. Admin endpoints must be protected by both auth and network restrictions where feasible.

---

### 6.9 Observability, Health, and Operations

#### FR-40: Health and readiness endpoints

CRePE must expose health endpoints suitable for Kubernetes and operations.

```http
GET /api/v1/health/live
GET /api/v1/health/ready
GET /api/v1/health/status
```

**Acceptance criteria:**

1. Liveness verifies the process is running and not deadlocked.
2. Readiness verifies database connectivity, active config loaded, active snapshot loaded, and service ready to answer requests.
3. Status returns last sync time, active snapshot age, active config version, item counts, validation counts, and staleness state.
4. Stale snapshot should degrade status and alert but should not fail liveness.
5. If no active snapshot exists at startup, readiness must fail and resolve endpoint must return 503.

#### FR-41: OpenTelemetry instrumentation

CRePE must emit logs, metrics, and traces through OpenTelemetry to HD Supply's collector.

**Required metrics:**

```text
crepe_api_requests_total
crepe_api_request_duration_ms
crepe_resolver_duration_ms
crepe_widget_resolution_duration_ms
crepe_empty_widget_total
crepe_sync_started_total
crepe_sync_success_total
crepe_sync_failure_total
crepe_sync_duration_ms
crepe_active_snapshot_age_seconds
crepe_content_items_active
crepe_content_items_invalid
crepe_exclusion_validation_failures_total
crepe_config_validation_failures_total
crepe_config_version_active
crepe_snapshot_activation_total
crepe_snapshot_activation_failure_total
```

**Required trace spans:**

```text
POST /api/v1/content/recommend
  authenticate
  normalizeRequest
  selectActiveSnapshot
  selectActiveConfig
  resolvePage
  resolveWidget
  evaluateRule
  applyExclusions
  applyFallback
  applyDedupe
  mapResponse

POST /api/v1/admin/sync
  acquireSyncLock
  queryContentGraph
  normalizeContent
  validateContent
  writeSnapshot
  buildInMemoryIndex
  activateSnapshot
```

**Acceptance criteria:**

1. Logs must be structured JSON or framework-approved structured logs.
2. Logs must include trace IDs.
3. API logs must include customer attribute keys but not sensitive attribute values by default.
4. Sync logs may include content refCode/title for operational debugging.
5. Debug logs with detailed rule matching must be controlled by environment/log-level and not enabled broadly in prod.

#### FR-42: Alerts

CRePE must produce telemetry that Splunk can route to OpsGenie for these conditions.

| Alert | Trigger |
|---|---|
| Sync failure | Sync job fails before snapshot activation |
| Snapshot staleness | Active snapshot age exceeds configured SLA |
| No active snapshot | Service cannot load any active snapshot |
| Exclusion validation failure | Unknown/malformed exclusion-like PF field encountered |
| Config validation failure | Config activation/deployment rejects config |
| Elevated API 5xx | Error-rate threshold breached |
| Elevated latency | p95 latency threshold breached |
| Pod snapshot divergence | Pods serving different active snapshot/config beyond allowed propagation window |

**Acceptance criteria:**

1. Alert log/metric fields must be stable and documented.
2. Alert conditions must be testable in lower environments.
3. Runbook entries must explain mitigation steps for each alert.

---

### 6.10 Testing, Golden Profiles, and TDD Requirements

#### FR-43: TDD is mandatory

All Java resolver implementation must be test-driven.

**Acceptance criteria:**

1. Unit tests must be written before production code for normalization, condition evaluation, rule evaluation, exclusions, fallback, dedupe, sorting, and snapshot activation.
2. The resolver core must be testable as pure functions wherever possible.
3. Tests must not require live Content Graph or live PostgreSQL for pure resolver behavior.
4. Integration tests must cover PostgreSQL snapshot activation and API contract behavior.
5. Contract tests must validate Product Recs-compatible request/response shape.

#### FR-44: Required unit test suites

The TDD must include at least these test suites:

```text
RequestNormalizerTest
ValueNormalizerTest
FieldAliasMapperTest
ContentValidatorTest
ConditionEvaluatorTest
RuleSelectorTest
RuleEvaluatorTest
ExclusionEvaluatorTest
GlobalExclusionBucketTest
DateWindowEvaluatorTest
SorterTest
FallbackResolverTest
WidgetResolverTest
PageDedupeTest
CatalogSnapshotActivationTest
ConfigValidatorTest
ApiContractTest
AuthFilterTest
ObservabilityEventTest
```

#### FR-45: Golden-profile acceptance suite

CRePE must define a golden-profile test suite owned jointly by SiteX/HD Supply and Optimizely engineering.

**Acceptance criteria:**

1. Golden profiles must be anonymized or use approved test accounts.
2. Each golden profile must include a request payload and expected widget outputs.
3. Expected outputs must include exact `refCode` order where deterministic.
4. Expected outputs must include negative assertions for content that must not appear.
5. Golden profiles must be executable in CI.
6. Golden profiles must cover the workbook Issues scenarios.
7. Golden profile changes must be reviewed by SiteX/business owner because they change the business oracle.

#### FR-46: Required golden-profile scenarios

Sprint 1 must include these minimum scenarios.

| Scenario ID | Input profile | Expected behavior |
|---|---|---|
| GP-1 | Hospitality customer with no affiliate, WR, TopLink, sold-to, or org segment | Hero carousel must not return affiliate-, WR-, TopLink-, or unrelated vertical-specific content merely to fill five slots. If no normal rule matches, use explicit fallback/default or empty. |
| GP-2 | Hospitality customer with affiliate `16412428` | Both IHG/Avid affiliate hero items are eligible and must be returned in deterministic order by weight: 2500 before 2400, unless excluded/deduped by config. |
| GP-3 | Affiliate with two eligible content items | CRePE must not collapse multiple valid items from the same rule. Dedupe key is `refCode`, not rule ID or affiliate value. |
| GP-4 | State of Georgia constrained-contract customer | Content explicitly targeted to `constrainedcontract` and `gastate` may appear, but sale/promo exclusions must still be enforced. |
| GP-5 | Content with unknown exclusion-like PF field | Affected item is not served; exclusion validation alert is emitted. |
| GP-6 | No normal matches and fallback product set configured | Fallback items return if they pass dates/exclusions. |
| GP-7 | No normal matches and no fallback survives | Widget returns `recs: []` and resolution status indicates no fallback. |
| GP-8 | Same refCode eligible for two widgets | Page-level dedupe keeps the item in the higher-priority widget and backfills the lower-priority widget if possible. |
| GP-9 | Guest user | Content targeted to `pf_userstatus=guest` appears only for guest/cookied/logged-in values as configured. |
| GP-10 | Scheduled widget expired | Widget is omitted or returns no recs according to config; it must not remain active after `activeTo`. |
| GP-11 | Expired CMS content later reactivated | Item is ineligible while expired and eligible again after future activation without hard-delete issues. |
| GP-12 | Inconsistent repeated request | Same request against same snapshot/config returns same ordered results every time. |

#### FR-47: Integration bug regressions

The workbook Issues sheet must be converted into regression tests.

**Required regressions:**

1. Content that does not match any condition must not be returned up to the first five slots.
2. Affiliate rule with two matching content items must return both items unless limited/excluded/deduped by explicit config.
3. Config/rule changes must have a defined reflection path. In sprint 1, scheduled activation is real-time at request evaluation; config file changes reflect after Jenkins/Helm rollout.
4. Same request parameters must produce consistent results for the same active snapshot and config.

---

## 7. Non-Functional Requirements

### 7.1 Performance

| Requirement | Target |
|---|---|
| API p95 latency | < 500 ms |
| Resolver p95 time | < 100 ms on warmed pod for <= 5,000 items and sprint-1 config |
| Catalog size | Support at least 5,000 content items |
| Widget/rule counts | No artificial Product Recs-style cap of 10 widgets or 10 rules; practical limits governed by performance tests |
| Sync duration | Target < 60 seconds for 5,000 items excluding extended Content Graph outage |
| Snapshot propagation | Active snapshot/config visible across pods within <= 30 seconds, or all pods replaced by rollout |

### 7.2 Reliability

1. Availability over freshness: stale active snapshot may continue serving if Content Graph sync fails.
2. No active snapshot means service not ready; do not serve invented empty data as success.
3. Sync failure does not alter active snapshot.
4. Config validation failure does not alter active config.
5. Exclusion validation failure makes affected content ineligible.
6. Pod restart must hydrate active snapshot/config from PostgreSQL/config source.
7. Repeated identical request against same snapshot/config must return identical result order.

### 7.3 Security

1. Entra ID bearer token validation required.
2. Internal-only network exposure.
3. No secrets in code, images, logs, traces, metrics, or rule YAML.
4. Admin/debug permissions separated from resolve permission.
5. Request logs avoid customer attribute values by default.
6. Detailed debug metadata gated by authorization.

### 7.4 Operability

1. DevOps/prod support must have runbooks for sync failure, stale snapshot, exclusion validation failure, config validation failure, elevated error rate, and pod divergence.
2. Health/status endpoints must be sufficient to diagnose active snapshot/config state without shelling into pods.
3. Sync status must show active snapshot, last attempted sync, last successful sync, validation counts, and failure reason.
4. Effective config endpoint must show currently active scheduled rule/widget status.

### 7.5 Maintainability

1. Resolver core must be pure and unit-testable.
2. API compatibility adapter must be separated from resolver core.
3. Field normalization/alias mapping must be centralized.
4. Operators must be centralized and test-covered.
5. YAML schema must be versioned and validated.
6. Rule evaluation must produce explanation objects internally, even if not returned to ordinary callers.

---

## 8. Proposed Logical Architecture

### 8.1 Runtime Flow

```text
Head App
  -> POST /api/v1/content/recommend
      -> Entra JWT auth filter
      -> Product Recs compatibility request adapter
      -> CustomerContext normalizer
      -> ActiveConfig AtomicReference
      -> ActiveCatalogSnapshot AtomicReference
      -> PageResolver
          -> WidgetResolver
              -> RuleSelector
              -> ConditionEvaluator
              -> ExclusionEvaluator
              -> DateWindowEvaluator
              -> Sorter
              -> FallbackResolver
          -> PageDedupeResolver
      -> Product Recs compatibility response adapter
      -> OTel logs/metrics/traces
```

### 8.2 Sync Flow

```text
Scheduler or admin
  -> POST /api/v1/admin/sync
      -> acquire distributed lock
      -> query Content Graph
      -> normalize CMS content and PF fields
      -> validate field names and values
      -> write BUILDING snapshot to PostgreSQL
      -> build immutable in-memory index candidate
      -> validate snapshot activation criteria
      -> atomically update active_snapshot pointer
      -> pods load/swap AtomicReference
      -> emit metrics/logs/traces/alerts
```

### 8.3 Architectural Decision: In-Memory Matching

Sprint 1 must use in-memory request-time matching.

**Decision:** PostgreSQL is the durable cache/snapshot store and cold-start hydration source. It is not the primary request-time targeting engine.

**Rationale:**

1. The catalog size is small enough for in-memory evaluation.
2. Pure Java evaluation is easier to test exhaustively.
3. The 500 ms SLA is dominated by network/serialization, not array comparisons.
4. SQL array-overlap logic would spread business semantics across DB queries and Java, increasing ambiguity.
5. In-memory immutable snapshots prevent partial-read concerns during sync.

---

## 9. Data Storage Requirements

### 9.1 Minimum PostgreSQL Tables

The TDD may refine schema names, but the storage model must support these concepts.

#### `content_snapshot`

| Column | Purpose |
|---|---|
| `snapshot_id` | Unique immutable snapshot ID |
| `status` | `BUILDING`, `ACTIVE`, `FAILED`, `SUPERSEDED` |
| `started_at` | Sync start time, `TIMESTAMPTZ` |
| `completed_at` | Sync completion time, `TIMESTAMPTZ` |
| `activated_at` | Activation time, `TIMESTAMPTZ` |
| `source_item_count` | Count returned from Content Graph |
| `valid_item_count` | Items eligible or potentially eligible |
| `invalid_item_count` | Items invalid/ineligible due to validation |
| `validation_summary_json` | Validation summary |
| `source_cms_environment` | test1/test2/prod CMS source |

#### `content_item_snapshot`

| Column | Purpose |
|---|---|
| `snapshot_id` | Snapshot foreign key |
| `content_key` | CMS GUID with dashes |
| `ref_code` | Dashless content GUID |
| `title` | CMS content title |
| `content_type` | CMS content type |
| `content_subtype` | Normalized `pf_contentsubtype` |
| `page_scope` | Normalized `pf_pagescope` |
| `publish_at` | CMS publish date, `TIMESTAMPTZ` |
| `expire_at` | CMS expire/unpublish date, `TIMESTAMPTZ`, nullable |
| `pf_fields_json` | Normalized canonical PF field map |
| `validation_status` | `VALID`, `WARN`, `INVALID_FAIL_CLOSED` |
| `serving_eligible` | Boolean |
| `validation_errors_json` | Structured errors |

#### `active_snapshot`

| Column | Purpose |
|---|---|
| `id` | Singleton key |
| `snapshot_id` | Active snapshot ID |
| `activated_at` | Activation time |

#### `config_version`

| Column | Purpose |
|---|---|
| `config_version` | Version ID |
| `checksum` | Config checksum |
| `source_commit` | Jenkins/Git source reference |
| `activated_at` | Activation time |
| `validation_summary_json` | Validation summary |
| `status` | `ACTIVE`, `SUPERSEDED`, `REJECTED` |

### 9.2 Storage Acceptance Criteria

1. All temporal columns use `TIMESTAMPTZ`.
2. Active snapshot pointer update is atomic.
3. Snapshot history is retained at least long enough for operational debugging.
4. Secrets are not stored in content/config tables.
5. JSON fields must not be used to avoid core validation; they are acceptable for normalized PF maps and diagnostics.

---

## 10. Risks and Mitigations

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| R-1 | Rule semantics remain ambiguous and bugs are codified in tests | Medium | High | PRD v2 defines exact rule hierarchy, operators, ordering, fallback, dedupe, and truth tables. |
| R-2 | Exclusion typo causes forbidden content to be served | Medium | Very high | Unknown exclusion-like fields fail closed and alert. |
| R-3 | CRePE returns arbitrary content when no rule matches | Medium | High | Explicit no-match invariant and fallback-only behavior. |
| R-4 | Mid-sync reads expose partially loaded content | Medium | High | Immutable active snapshots with atomic activation. |
| R-5 | Config reload affects only one pod | Medium | High | Local-only reload prohibited. Config promoted through Jenkins/Helm or future cluster-visible activation. |
| R-6 | Product Recs compatibility pollutes internal design | Medium | Medium | Compatibility adapter outside; deterministic resolver inside. |
| R-7 | Contains/not-contains creates false positives | Medium | Medium | Operator policy restricts fields and requires tests. |
| R-8 | Fallback product sets are not populated | Medium | Medium | Empty-widget status returned; golden profiles include no-fallback case; SiteX owns fallback definitions. |
| R-9 | Page-level dedupe removes required content unexpectedly | Medium | Medium | Configurable dedupe, deterministic priority, debug metadata, golden tests. |
| R-10 | Runtime ownership unclear | Low after workbook | High | DevOps/prod support identified; runbooks required. |
| R-11 | Static token design is used accidentally | Low | High | PRD v2 mandates Entra ID JWT validation. |
| R-12 | Expired content cannot reactivate | Medium | Medium | Soft-delete/inactive state; no hard delete of history. |

---

## 11. Open Implementation Inputs for the TDD

These are not product-behavior ambiguities. They are implementation/config values required by the TDD or deployment pipeline.

| ID | Input needed | Owner | Required by |
|---|---|---|---|
| TI-1 | Entra tenant ID, issuer, audience, app roles/scopes, JWKS URL | HD Supply architecture/security | Auth implementation |
| TI-2 | Exact Content Graph query and CMS content type list | Optimizely engineering + SiteX | Sync implementation |
| TI-3 | Final sprint-1 YAML config values for all 10 home widgets and `cobranded_logo` | SiteX + Optimizely engineering | Resolver config/tests |
| TI-4 | Golden-profile expected outputs for TestData scenarios | SiteX/HD Supply | Acceptance tests |
| TI-5 | Splunk index/source type and OpsGenie routing details | DevOps/prod support | Observability implementation |
| TI-6 | Jenkins/Helm deployment conventions | DevOps/prod support | CI/CD implementation |
| TI-7 | Whether any existing Scala extract code is reused | Optimizely engineering/architecture | ADR before implementation |

For TI-7, this PRD assumes sprint 1 owns extraction inside the Spring Boot CRePE application unless an ADR explicitly decides to reuse or wrap existing Scala extract code. The TDD must record that decision before code starts.

---

## 12. Appendix A - Matching Truth Tables

### 12.1 Request vs content value matching

| Request value | Content PF value | Operator | Result | Notes |
|---|---|---|---:|---|
| `hospitality` | `hospitality` | `equalsAny` | true | Exact normalized token |
| `Hospitality` | ` hospitality ` | `equalsAny` | true | Case/trim normalization |
| `hospitality` | `commercial` | `equalsAny` | false | No overlap |
| `[hospitality, trade]` | `trade` | `equalsAny` | true | Scalar/content cross-case becomes set intersection |
| `hospitality` | `[hospitality, trade]` | `equalsAny` | true | Request scalar becomes one-token set |
| `[hospitality]` | `[commercial, trade]` | `overlapsAny` | false | No intersection |
| `[constrainedcontract]` | `[gastate, constrainedcontract]` | `overlapsAny` | true | Exclusion or inclusion overlap |
| missing | `hospitality` | any match operator | false | Missing request attribute never matches |
| `hospitality` | missing | any match operator | false | Missing content field never matches |
| empty array | `hospitality` | any match operator | false | Empty request set never matches |
| `hospitality` | empty array | any match operator | false | Empty content set never matches |

### 12.2 Rule condition modes

| Rule condition mode | Conditions | Result |
|---|---|---:|
| `ALL` | true, true | true |
| `ALL` | true, false | false |
| `ALL` | false, false | false |
| `ANY` | true, true | true |
| `ANY` | true, false | true |
| `ANY` | false, false | false |
| `ALL` | zero conditions | invalid config |
| `ANY` | zero conditions | invalid config |

### 12.3 Inclusion/exclusion precedence

| Include rule matched? | Exclusion matched? | Fallback? | Output? |
|---:|---:|---:|---|
| true | false | n/a | eligible normal item |
| true | true | n/a | excluded |
| false | false | false | not returned |
| false | false | true and no normal results | eligible only if explicit fallback product set selects it and safety filters pass |
| false | true | true | excluded |

### 12.4 Widget result status

| Situation | `resolutionStatus` |
|---|---|
| One or more normal rule matches returned | `MATCHED` |
| Normal matches existed but all removed by exclusions | `EXCLUDED_EMPTY` |
| No normal matches, fallback returned items | `FALLBACK_USED` |
| No normal matches and no fallback configured | `NO_MATCH_NO_FALLBACK` |
| Fallback configured but no fallback items survived | `FALLBACK_EMPTY` |
| Widget inactive by schedule | `WIDGET_INACTIVE` |
| Widget lost all items to page dedupe and no backfill exists | `DEDUPED_EMPTY` |

---

## 13. Appendix B - Worked Examples from HD Supply TestData

### 13.1 Affiliate with two hero carousel items

TestData includes two IHG/Avid hero carousel items for affiliate `16412428` with weights 2500 and 2400.

**Expected behavior:**

1. A request with `customAttributes.affiliate = ["16412428"]` matches the affiliate rule.
2. Both content items are eligible unless excluded, inactive, or deduped.
3. They are returned in descending weight order: 2500 item before 2400 item.
4. The engine must not collapse them because they share the same affiliate value or same rule.

### 13.2 Hospitality-only request must not return unrelated or more-specific content

The Issues sheet includes a request where only `customAttributes.industry = hospitality` was provided and unrelated/specific content was returned up to five items.

**Expected behavior:**

1. CRePE evaluates only configured rules.
2. Affiliate-specific content does not match unless the request contains the affiliate attribute and the affiliate rule passes.
3. Winning-relation-specific content does not match unless the request contains the winning relation and the rule passes.
4. TopLink-specific content does not match unless the request contains TopLink and the rule passes.
5. Manufacturing Safety content whose verticals do not include Hospitality must not match a Hospitality-only request.
6. If no normal rule matches, CRePE uses explicit fallback/default or returns an empty widget. It must not fill five slots with arbitrary content.

### 13.3 State of Georgia constrained contract

TestData includes a State of Georgia constrained-contract home hero item targeted to organization segments `constrainedcontract` and `gastate`.

**Expected behavior:**

1. A request with both organization segments can match the configured segment rule.
2. Any item-level or global sale/promo exclusion still applies.
3. Inclusion by `constrainedcontract` does not override exclusions.

---

## 14. Appendix C - TDD Entry Criteria Checklist

Implementation should not begin until these are approved or explicitly delegated to the TDD:

| # | Entry criterion | Status for PRD v2 |
|---:|---|---|
| 1 | Product Recs-compatible request/response shape defined | Defined |
| 2 | Page -> widget -> rule -> condition model defined | Defined |
| 3 | Canonical PF field inventory defined | Defined |
| 4 | Matching truth table defined | Defined |
| 5 | Exclusion fail-closed behavior defined | Defined |
| 6 | Snapshot serving model defined | Defined |
| 7 | Soft-delete/reactivation behavior defined | Defined |
| 8 | Fallback/default strategy defined | Defined |
| 9 | Cross-widget dedupe behavior defined | Defined |
| 10 | Config promotion/reload behavior defined | Defined |
| 11 | Auth model defined | Defined |
| 12 | Observability/alert model defined | Defined |
| 13 | Golden-profile minimum scenarios defined | Defined |
| 14 | Environment/deployment decisions incorporated | Defined |
| 15 | Remaining implementation inputs listed | Defined in section 11 |

---

## 15. Appendix D - PRD v2 Change Summary from May 27 Draft

| Area | May 27 draft | PRD v2 decision |
|---|---|---|
| Product framing | CRePE as content recommendation API | Deterministic personalization resolver with Product Recs-compatible API |
| API response | `widgets[].items[].contentKey` | Product Recs-compatible `widget`, `alias`, `position`, `recs[].refCode` |
| Request body | `pageTypes[]`, `customerAttributes` | Product Recs-compatible `type`, `customAttributes`, `customer`, `user`, context fields |
| Matching model | Widget-level `matchMode` | Page -> widget -> rule -> condition |
| Rules per widget | Implicit/simple | Unlimited by product rule; practical limits via performance tests |
| Rule limits | Widget max only | Rule-level and widget-level `maxItems` |
| Exclusion validation | Unknown fields dropped; accepted risk | Unknown exclusion-like fields fail closed and alert |
| Sync model | Per-item replacement | Immutable snapshot build/validate/activate |
| Delete model | Reflected after full sync | Soft delete/inactive/absent with reactivation support |
| Alerting | Structured logs | OTel to collector, Splunk/OpsGenie alerts |
| Auth | Static manually rotated bearer token | Microsoft Entra ID JWT validation |
| Config reload | Local reload endpoint | Local-only reload prohibited; config via Jenkins/Helm or future cluster-visible activation |
| Page-header | 12 widgets including test/DELETE-ME | One production widget; test widgets ignored/not prod |
| PF fields | Old Appendix A | Workbook FieldsList canonical inventory |
| Weight | 0-1000 | 0-9999 |
| Fallback | `pf_fallbackitem=true` | Explicit fallback product sets/default strategy |
| Deduplication | No cross-widget dedupe | Page-level dedupe by `refCode` when enabled |
| User status | Not included | Add `userStatus` request/PF field |
| Dates | UTC storage open question | PostgreSQL `TIMESTAMPTZ`; explicit business timezone policy |

