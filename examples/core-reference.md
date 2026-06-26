# Optimizely Entity Management – Core Reference (AI‑Friendly)

## 1  Purpose

A 6‑kilobyte cheat‑sheet for AI agents that programmatically manage **Optimizely Web** and **Optimizely Feature** projects via the REST API v2.

> Always decide **platform first**, then consult the dependency map and CRUD rules below.
> All IDs are numeric (int64) unless noted.

---

## 2  Platform Split

| Platform    | Primary container                                                    | Web‑only entities                            | Feature‑only entities                                         |
| ----------- | -------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| **Web**     | `experiment` (A/B, MVT) or `campaign ➜ experience` (personalization) | `page`, in‑page `event`, `section` (for MVT) | —                                                             |
| **Feature** | `flag` + `environment.ruleset` (`rule type:"experiment"`)            | —                                            | `flag`, `variation`, `ruleset`, `rule`, `variable_definition` |

**Detection:** read `project.purpose`. If purpose≈“Web”, treat as Web; else treat as Feature.

---

## 3  Condensed Dependency Map

```ts
export const DEP_MAP = {
  project : {},
  // Web
  page       : { req:["project"],              platform:"web" },
  experiment : { req:["project","page","event?","campaign?"], platform:"web" },
  campaign   : { req:["project"],              platform:"web" },
  section    : { req:["experiment (mvt)"],     platform:"web" },
  // Feature
  flag       : { req:["project"],              platform:"feature" },
  variation  : { req:["flag"],                 platform:"feature" },
  environment: { req:["project"],              platform:"feature" },
  ruleset    : { req:["flag","environment"],  platform:"feature" },
  rule       : { req:["ruleset"],              platform:"feature" },
  // Shared
  event      : { req:["project"],              platform:"both" },
  audience   : { req:["project"],              platform:"both" },
  attribute  : { req:["project"],              platform:"both" }
} as const;
```

---

## 4  CRUD & Update Formats

| Category                      | Entities                                | Update method                                   |
| ----------------------------- | --------------------------------------- | ----------------------------------------------- |
| **Standard CRUD**             | project · campaign · event · page       | `PATCH` JSON‑patch or full body                 |
| **Archive‑instead‑of‑delete** | flag · variation · audience · attribute | `POST /{id}/archive` then `unarchive` if needed |
| **Patch‑only (immutables)**   | ruleset                                 | `PATCH` JSON‑patch (enable/disable)             |
| **Read‑only (via parent)**    | rule · variable\_definition · section   | n/a – update parent container                   |

> JSON‑Patch tip – use `/variations/0/name` to change first variation’s name, `/rules/‑` to append rule.

---

## 5  Experiment / Rule Types — authoritative list

The **allowed strings** live in the swagger file. The helper can fetch them at runtime:

```ts
const enumVals = schema.enumFor("experiment","experiment_type");
// e.g. ["a/b","multivariate","redirect","multi_page"]
```

### 5.1  Web `experiment_type` (enum)

| Value (enum)        | What it means                                                               | Extra calls / payload hints               |
| ------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| `"a/b"` *(default)* | Standard split test with 2+ variations.                                     | none                                      |
| `"multivariate"`    | Factor‑based test; after create call **Sections** endpoint once per factor. | `POST /experiments/{id}/sections`         |
| `"redirect"`        | Visitors are bounced to `redirect_url` in each variation.                   | Each variation adds `redirect_url` field. |
| `"multi_page"`      | Test spans >1 Page; each variation may reference multiple `changesets`.     | Include `changesets` array in payload.    |

> **Why only these four?** They are the exact enum returned by `enumFor("experiment","experiment_type")` in today’s swagger. If Optimizely adds more (e.g. `"multi_arm_bandit"`), the generator will pull it automatically and the agent will accept it.

### 5.2  Campaign `type` (web‑only)

Swagger enum for Campaign shows: `personalization`, `recommendation`, `promotion`, `overlay`.  The agent sets `type` accordingly when **creating a campaign**; experiences inside inherit it.

### 5.3  Feature `rule.type`

`enumFor("rule","type")` returns exactly `experiment` or `rollout`.  Use `experiment` when you need a results chart; use `rollout` for gradual release.

---

## 6  Schema & Enum Quick‑Lookup (critical defaults)

| Entity                   | Field                 | Allowed values (swagger enum)                                  | Default if omitted |
| ------------------------ | --------------------- | -------------------------------------------------------------- | ------------------ |
| **project**              | `purpose`             | *free text* (≤ 250 chars)                                      | "Web"              |
| **experiment**           | `status`              | `not started` · `running` · `paused` · `concluded`             | `not started`      |
|                          | `experiment_type`     | `a/b` · `multivariate` · `redirect` · `multi_page`             | `a/b`              |
|                          | `percentage_included` | 0.0 – 1.0                                                      | 1.0                |
| **variation**            | `weight`              | 0 – 10000 (int)                                                | even split         |
| **campaign**             | `type`                | `personalization` · `recommendation` · `promotion` · `overlay` | `personalization`  |
| **flag.rule**            | `type`                | `experiment` · `rollout`                                       | —                  |
|                          | `status`              | `running` · `disabled`                                         | `running`          |
| **ruleset**              | `status`              | `enabled` · `disabled`                                         | `enabled`          |
| **attribute**            | `data_type`           | `string` · `boolean` · `integer` · `double` · `json`           | `string`           |
| **variable\_definition** | `type`                | `string` · `boolean` · `integer` · `double` · `json`           | (no default)       |
| **environment**          | `environment_type`    | `production` · `development` · `staging`                       | `development`      |
| **event**                | `event_type`          | `custom` · `pageview` · `click`                                | `custom`           |

*(The helper’s `enumFor(entity, field)` pulls these lists directly; if swagger changes, the values update automatically.)*

\--------|-------|-------------------------|-------------------|
\| project | `purpose` | free text ≤ 250 chars | "Web" |
\| experiment | `status` | `not started` · `running` · `paused` · `concluded` | `not started` |
\| experiment | `percentage_included` | 0.0 – 1.0 | 1.0 |
\| variation | `weight` | 0 – 10000 (int) | auto even |
\| flag.rule | `type` | `experiment` · `rollout` | — |
\| flag.rule | `status` | `running` · `disabled` | `running` |
\| ruleset | `status` | `enabled` · `disabled` | `enabled` |

*(All enums & defaults pulled from `/definitions` in swagger; agent can call `OpenAPISchema.required()` for complete list.)*

---

## 7  Pre‑flight Checklist

* [ ] Have project ID
* [ ] Platform decided (web / feature)
* [ ] All **req** entities in DEP\_MAP exist (create if not)
* [ ] Correct payload fields (use OpenAPI schema)
* [ ] Using right update format (JSON‑patch vs full)

### Common Pitfalls

1. Missing `page_id` in web experiment variations. 
2. Variation weights not summing to **10000**. 
3. Using `/flags/v1` routes – switch to `/v2`. 
4. Attempting to update feature flag via `/features/{id}` (use ruleset instead). 

---

## 7  Minimal Flow Algorithms  (pseudocode)

```ts
if (intent.platform==="web") {
  ensure(project);
  ensure(page);
  ensure(events);
  ensure(audience);
  createOrUpdateExperiment();
} else {
  ensure(project);
  ensure(environment);
  ensure(flag);
  ensure(variations);
  patchRulesetWithExperimentRule();
}

