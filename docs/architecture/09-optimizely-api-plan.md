# 09 — Optimizely REST API Plan: LIVE create-audience → flag → rule → experiment

**For:** Build agents (OPAL chat tools), reviewing SA, eng lead
**From:** Solutions Architecture
**Status:** Implementation contract for the **token-gated live-creation path**. Endpoints + payloads here are normative; they are what the OPAL chat's `create_*` tools call.
**Reads against:** [`../PROJECT_LEDGER.md`](../PROJECT_LEDGER.md) · [`../Tapestry-Coach-North-Star-Brief.md`](../Tapestry-Coach-North-Star-Brief.md) · [`./Optimizely-Experimentation-MCP-Server-Technical-Reference.md`](./Optimizely-Experimentation-MCP-Server-Technical-Reference.md) · [`./05-demo-build-spec.md`](./05-demo-build-spec.md)
**Sources:** Optimizely Developer Docs + `optimizely/fx-api-cookbook` (official). All URLs cited inline and in §11. Accessed **2026-06-25**.

---

## 0. TL;DR (6 lines)

1. **Use Feature Experimentation (FX), not the MCP server, for the "goes live" beat.** The remote MCP/Opal path is **draft-only** (human must click Publish — see MCP ref doc §1.2); the **FX REST API can enable a rule to LIVE programmatically**. This is the whole reason we go REST for the live experiment.
2. **Two base URLs, one Bearer token:** Flags API `https://api.optimizely.com/flags/v1` (flags/variations/rules/experiments) + Admin API `https://api.optimizely.com/v2` (audiences/attributes/events). Auth = `Authorization: Bearer <PERSONAL_ACCESS_TOKEN>`.
3. **The chain:** create attributes/events (prereqs) → create **audience** (`POST /v2/audiences`, live config) → create **flag** + variable_definitions (`POST /flags/v1/.../flags`, **created DISABLED**) → create **variations** → **PATCH the env ruleset** to add a `targeted_delivery` rule (targets the audience) **or** an `a/b` experiment rule (**both start as DRAFT/`enabled:false`**).
4. **Go live = two API calls, no UI:** `POST .../ruleset/enabled` (turn the flag on in the environment) **+** PATCH `replace /rules/<key>/enabled = true`. After that the environment **datafile** regenerates.
5. **Edge consumes via the datafile**, not a private API: `https://cdn.optimizely.com/datafiles/{SDK_KEY}.json`, per-environment, default SDK poll 5 min. For "within seconds" the Worker **fetches the datafile on-demand (no-store)** or registers a **datafile webhook** to purge cache.
6. **Human-publish flags:** FX REST = no forced human publish (good). **Web Experimentation** experiments are draft until `POST /v2/experiments/{id}?action=start`. **CDN propagation is seconds-to-~1min, not instant** — drive the demo's reveal off our own fetch, not blind faith in poll timing.

**Exact endpoints (the load-bearing set):**
```
POST   https://api.optimizely.com/v2/attributes
POST   https://api.optimizely.com/v2/projects/{projectId}/custom_events
POST   https://api.optimizely.com/v2/audiences
POST   https://api.optimizely.com/flags/v1/projects/{projectId}/flags
POST   https://api.optimizely.com/flags/v1/projects/{projectId}/flags/{flagKey}/variations
PATCH  https://api.optimizely.com/flags/v1/projects/{projectId}/flags/{flagKey}/environments/{env}/ruleset
POST   https://api.optimizely.com/flags/v1/projects/{projectId}/flags/{flagKey}/environments/{env}/ruleset/enabled
POST   https://api.optimizely.com/flags/v1/projects/{projectId}/flags/{flagKey}/environments/{env}/ruleset/disabled
GET    https://cdn.optimizely.com/datafiles/{SDK_KEY}.json        # edge consumption
```

---

## 1. Which product, and why

| | **Feature Experimentation (CHOSEN)** | Web Experimentation (alternative) |
|---|---|---|
| Create primitive | Flags + rules in an **environment ruleset** | Experiments/Campaigns on Pages |
| Go-live via API | **Yes** — enable ruleset + rule `enabled:true` | Yes — `?action=start` |
| Edge fit | **Native** — datafile + SDK decide, made for server/edge | Snippet/visual-editor oriented (DOM) |
| Anonymous cold-start attrs | Passed by our engine as `custom_attribute`s at decide time | Cookie/snippet based |
| Demo line | "AI created a **real flag + A/B test**, the edge delivers it" | weaker fit for Workers edge |

FX matches our Cloudflare Workers edge engine 1:1 (datafile in, decision out) and **can publish to live over REST** — so all primary payloads below are FX. Web Exp is documented in §8 as the fallback.

> **Architectural flag (carry into the build):** the **remote MCP server is draft-only** (it modifies the active draft, a human clicks Publish — MCP ref doc §1, fact #2). Our "goes live" North-Star beat therefore runs through the **REST API with a token**, *not* the MCP server. We keep the human "Publish" as a **governance click in our own UI** that triggers the two enable calls in §5.

---

## 2. Base URLs & auth

**Base URLs** (`fx-api-cookbook` readme; FX API overview):
- **Flags API:** `https://api.optimizely.com/flags/v1` — flags, variations, environments, **rulesets (rules = deliveries + experiments)**.
- **Admin/Experimentation API:** `https://api.optimizely.com/v2` — **audiences, attributes, custom_events**, projects, (and Web Exp experiments).

**Auth model** — `Authorization: Bearer <TOKEN>` on every request. Two ways to mint the token:

| Method | When | How |
|---|---|---|
| **Personal Access Token (use this for the demo)** | Internal/server-to-server tool, fastest | Optimizely app → **Profile → API Access → Generate New Token**, or `https://app.optimizely.com/tokens`. Does **not expire** until revoked. Server-side only; never ship to the browser. |
| **OAuth 2.0** | Customer-facing/production app | Account Settings → **Registered Apps → Register New Application** (client type Public/Confidential); standard OAuth code→access-token exchange. |

Headers on every call: `Authorization: Bearer <TOKEN>`, `Content-Type: application/json`, `Accept: application/json`.

> The cookbook stores the header as `token = "Bearer <yourToken>"` and sends `Authorization: {{token}}` — i.e. **the literal word `Bearer` is part of the value**. Token lives in a Worker secret (`OPTIMIZELY_API_TOKEN`), never `wrangler.toml`.

**`{projectId}`** comes from the Optimizely app URL. **`{env}`** is the environment **key** (default projects ship with `production` (primary) and `development`). SDK key + Datafile URL are per-environment under **Settings → Environments** (see §6, §7).

---

## 3. The full create flow (FX) — order matters

Numbering follows the official `fx-api-cookbook` lifecycle. Steps 1–2 are **prerequisites** (attributes the edge will send; the conversion event the experiment measures). Coach-themed payloads.

```
1. attributes  ─┐ (so audience conditions + SDK decide() have keys to match on)
2. custom_event ┘ (so the A/B rule has a metric)            ── both on /v2, live config
3. audience      (targets the people)                       ── /v2, live config
4. flag (+ variable_definitions)                            ── /flags/v1, DISABLED
5. variations    (the content switches the edge renders)    ── /flags/v1
6. rule          targeted_delivery  OR  a/b experiment      ── PATCH ruleset, DRAFT
7. ENABLE        ruleset/enabled  +  rule enabled:true       ── LIVE
   └─ datafile regenerates → CDN → edge (§7)
```

### Step 1 — Create attributes (prereq)
`POST https://api.optimizely.com/v2/attributes`
```json
{ "key": "viewed_tabby", "project_id": {{projectId}} }
```
Create one per attribute the edge will pass (`viewed_tabby`, `added_to_cart`, `is_logged_in`, `region_state`, `session_intent_score`). These are the `custom_attribute` names referenced in audiences (§3.3) and sent by our engine in `decide()`. Live config immediately.

### Step 2 — Create the conversion event (prereq for A/B)
`POST https://api.optimizely.com/v2/projects/{{projectId}}/custom_events`
```json
{ "event_type": "custom", "key": "add_to_cart",
  "description": "Shopper added an item to cart." }
```
**Save the returned numeric `id`** → it becomes `event_id` in the experiment metric (§3.6b).

### Step 3 — Create the AUDIENCE (with conditions)
`POST https://api.optimizely.com/v2/audiences`
```json
{
  "name": "High-Intent Tabby Browsers — No ATC",
  "project_id": {{projectId}},
  "conditions": "[\"and\",[\"or\",[\"or\",{\"name\":\"viewed_tabby\",\"type\":\"custom_attribute\",\"match_type\":\"exact\",\"value\":true}]],[\"or\",[\"or\",{\"name\":\"added_to_cart\",\"type\":\"custom_attribute\",\"match_type\":\"exact\",\"value\":false}]]]"
}
```
- **`conditions` is a JSON-encoded *string*** (escaped) of a nested array: `["and",["or",["or",{condition}]] , …]`. Each leaf = `{ "name", "type":"custom_attribute", "match_type", "value" }`. `match_type` ∈ `exact`, `exists`, `substring`, `gt`/`ge`/`lt`/`le`, … (cookbook uses `exact` and `le`).
- **Result: LIVE config object immediately** (no draft/publish step for audiences). **But it has zero effect** until an enabled rule references it and the flag is on in the environment (§5). **Save the returned numeric audience `id`** → used in the rule (§3.6).

### Step 4 — Create the FEATURE FLAG (+ variables)
`POST https://api.optimizely.com/flags/v1/projects/{{projectId}}/flags`
```json
{
  "key": "complete_the_look",
  "name": "Complete the Look module",
  "description": "Shows the AI complete-the-look module on PDP/PLP.",
  "variable_definitions": {
    "module_enabled": { "key": "module_enabled", "type": "boolean", "default_value": "false",
      "description": "Render the module." },
    "headline":       { "key": "headline", "type": "string", "default_value": "Complete the look",
      "description": "Module headline." },
    "max_items":      { "key": "max_items", "type": "integer", "default_value": "3",
      "description": "How many rec items to show." }
  }
}
```
- **`variable_definitions` is the typed contract the edge reads** (boolean/string/integer/double/json). Our engine owns the *rendering*; the flag owns the *decision + parameters* (mirrors MCP ref doc §1 fact #3 — no HTML/CSS/JS over the API).
- **Result: created DISABLED in every environment** (`"enabled": false`). **Not live.** Flags ship "off" so code can deploy dark.

### Step 5 — Create VARIATIONS (the content the edge switches between)
`POST https://api.optimizely.com/flags/v1/projects/{{projectId}}/flags/{{flagKey}}/variations`
```json
{
  "key": "ctl_on",
  "name": "Complete-the-look ON",
  "description": "Module on, 3 items.",
  "variables": { "module_enabled": true, "headline": "Complete the look", "max_items": 3 }
}
```
Every flag already has a built-in **`off`** variation (all variables at default). Create the `on`/test variations you need. These are config children — inert until a rule serves them.

### Step 6a — Create a FLAG RULE: **targeted delivery** (deliver the flag to the audience)
A *delivery* (a.k.a. targeted delivery) is the "switch the experience on for this audience" rule — exactly the North-Star "switch on complete-the-look for them." Rules live in the **environment ruleset**; edit with **JSON Patch** (RFC 6902).

> **Always GET → merge → PATCH.** The ruleset is one object; a blind PATCH can clobber other rules. `GET …/environments/{env}/ruleset` first, then send only your ops.

`PATCH https://api.optimizely.com/flags/v1/projects/{{projectId}}/flags/{{flagKey}}/environments/{{env}}/ruleset`
```json
[
  {
    "op": "add",
    "path": "/rules/ctl_for_tabby_intent",
    "value": {
      "key": "ctl_for_tabby_intent",
      "name": "Complete-the-look for high-intent Tabby browsers",
      "type": "targeted_delivery",
      "audience_conditions": ["or", { "audience_id": {{tabbyAudienceId}} }],
      "audience_ids": [ {{tabbyAudienceId}} ],
      "percentage_included": 10000,
      "variations": { "ctl_on": { "key": "ctl_on", "name": "Complete-the-look ON", "percentage_included": 10000 } }
    }
  },
  { "op": "add", "path": "/rule_priorities/0", "value": "ctl_for_tabby_intent" }
]
```
- **`type`: `targeted_delivery`** (other types: `a/b`, `multi_armed_bandit`).
- **Audience targeting:** `audience_conditions` = nested array `["or", {"audience_id": <id>}]` (combine multiple with `and`/`or`); `audience_ids` = the flat list. Use the `id` returned in §3.3.
- `percentage_included: 10000` = **100%** (basis points: 10000 = 100%).
- **Result: DRAFT** — the rule exists with `enabled:false` / `status:"draft"`. **Not live until §3.7.**

### Step 6b — *Or* create an A/B EXPERIMENT rule (measure it)
Same ruleset PATCH, `type:"a/b"`, with a metric + split + priority. This is the cookbook's `6_create_experiment` verbatim shape (audience added vs the empty `[]` "everyone" default):
```json
[
  {
    "op": "add",
    "path": "/rules/ctl_ab_test",
    "value": {
      "key": "ctl_ab_test",
      "name": "Complete-the-look A/B",
      "type": "a/b",
      "distribution_mode": "manual",
      "percentage_included": 10000,
      "audience_conditions": ["or", { "audience_id": {{tabbyAudienceId}} }],
      "audience_ids": [ {{tabbyAudienceId}} ],
      "metrics": [
        { "aggregator": "unique", "display_title": "add_to_cart", "event_id": {{eventId}},
          "event_type": "custom", "scope": "visitor", "winning_direction": "increasing" }
      ],
      "variations": {
        "off":    { "key": "off",    "name": "Off",    "percentage_included": 5000 },
        "ctl_on": { "key": "ctl_on", "name": "CTL ON", "percentage_included": 5000 }
      }
    }
  },
  { "op": "add", "path": "/rule_priorities/0", "value": "ctl_ab_test" }
]
```
- `metrics[].event_id` = the numeric id from §3.2. `variations` percentages must sum to 10000.
- **Result: DRAFT** (cookbook readme: "Experiments are created in a disabled state by default"; `enabled` goes `false`→`true` on launch).

### Step 7 — ENABLE → LIVE (no human UI step required)
Two calls. (a) turn the flag's ruleset on **for the environment**, (b) flip the **rule** on:
```
POST  https://api.optimizely.com/flags/v1/projects/{{projectId}}/flags/{{flagKey}}/environments/{{env}}/ruleset/enabled
```
```
PATCH https://api.optimizely.com/flags/v1/projects/{{projectId}}/flags/{{flagKey}}/environments/{{env}}/ruleset
[ { "op": "replace", "path": "/rules/ctl_for_tabby_intent/enabled", "value": true } ]
```
(Disable/rollback = `POST …/ruleset/disabled`, or PATCH the rule `enabled:false`.)
**After this the environment datafile is regenerated** and the change propagates to the CDN (§7).

---

## 4. LIVE vs DRAFT — what's real after each call (the publish map)

| Entity | Endpoint | State after create | What makes it LIVE | Human publish needed? |
|---|---|---|---|---|
| Attribute | `POST /v2/attributes` | **Live config** | n/a (inert key) | No |
| Custom event | `POST /v2/projects/{id}/custom_events` | **Live config** | n/a until referenced | No |
| **Audience** | `POST /v2/audiences` | **Live config** (not draft) | When an **enabled rule** references it | No |
| **Flag** | `POST /flags/v1/.../flags` | **DISABLED** in all envs | Enable ruleset in env (§3.7) | No |
| Variation | `POST /flags/v1/.../variations` | Config child | When a rule serves it | No |
| **Rule (delivery / a/b)** | `PATCH …/ruleset` | **DRAFT / `enabled:false`** | `ruleset/enabled` + rule `enabled:true` | **No (REST)** |
| Datafile | (auto) | Regenerated on enable | CDN propagation (§7) | No |

**Net:** over the **FX REST API the entire chain can go live with a token — no human Publish click** (unlike the MCP/Opal path, which is draft-only). We *choose* to keep a human "Publish" button in our UI as a **governance beat**; it simply triggers the §3.7 calls after confirmation.

**Flag for the team:** confirm the **Optimizely token's role/permissions** can write + enable in the target project (an editor/admin scope). A read-only or restricted token will create drafts but fail the enable calls.

---

## 5. Environments

- Every FX project starts with **`production` (primary)** and **`development`**. Environments are **isolated**, each with **its own SDK key + datafile**.
- Do all demo writes against a **sandbox project**, and prefer the **`development`** environment for first live writes; promote to `production` only when rehearsed. Primary env can't be archived.
- The `{env}` in ruleset paths is the environment **key**. Get SDK key + Datafile URL from **Settings → Environments**.

---

## 6. How the edge ENGINE consumes the created state (propagation)

The storefront does **not** call the REST API at request time. It reads the **datafile** — the compiled JSON of all flags/rules/variations/audiences for one environment. This is the seam our `DecisionProvider` (`src/connectors/`, see `05-demo-build-spec.md`) stands on.

**Datafile URL (per environment):**
```
https://cdn.optimizely.com/datafiles/{SDK_KEY}.json                  # standard
https://config.optimizely.com/datafiles/auth/{SDK_KEY}.json          # secure/authenticated env
```

**Three consumption options for the Cloudflare Worker:**

1. **On-demand fetch (recommended for the demo — gets "within seconds").** In the `LiveDecisionProvider`, `fetch(datafileUrl, { cache: 'no-store', cf: { cacheTtl: 0 } })`, parse, evaluate the matching rule against the shopper's `custom_attribute`s, return the variation + variables. Bypasses SDK poll latency; the demo reveal fires off *our* fetch, not a blind timer. Cache the parsed datafile in Worker memory/KV with a short TTL (e.g. 10–30s) to avoid per-request fetches.
2. **Optimizely JS SDK inside the Worker** with **datafile polling**. Default poll = **5 min** (configurable; range >0 and <2,592,000s; platform minimums e.g. Android 60s). 5 min is **too slow for a live demo** — set a low interval *or* combine with option 3.
3. **Datafile webhook (push).** Register a webhook so Optimizely **POSTs on datafile change** to a Worker route (e.g. `/hooks/optimizely-datafile`) that purges the KV/cache entry → next request refetches. Best "seconds, event-driven" option; pair with option 1's cache.

**Timing caveat (flag):** on enable, the datafile **revision increments quickly**, but there is **CDN propagation + (if polling) poll latency** — realistically **seconds to ~1 minute**, *not* guaranteed-instant. Mitigations: no-store fetch (1), webhook purge (3), and **drive the on-stage "now it's live" reveal from our own confirmed refetch** (poll the datafile `revision` until it bumps, then animate). Keep the existing **mock `DecisionProvider` as the stage fallback** per "real seams, mocked calls."

**Decide-time attributes:** whatever the audience conditions reference (`viewed_tabby`, `added_to_cart`, `region_state`, …) the edge must pass as the attributes map when evaluating — these come from our anonymous in-session profile.

---

## 7. Web Experimentation — alternative (only if FX is unavailable)

- **Base:** `https://api.optimizely.com/v2`. Same Bearer auth.
- **Create experiment:** `POST /v2/experiments` — **created in DRAFT** (`status: not_started`). Audiences referenced via `audience_conditions` (string `"everyone"` or `and`/`or` of audience ids).
- **Go live / publish:** `POST /v2/experiments/{id}?action=start` → `status: running`. Other actions: `action=pause` (→`paused`), `action=publish` (stage changes without starting). Note: *"if the experiment is not started/paused, published changes are not visible to visitors."*
- **Why not primary:** DOM/snippet-oriented, weaker fit for a Workers edge decision; FX's datafile+decide model is the native edge path.

---

## 8. Mapping to our connectors (build hand-off)

- *(As built)* The Opal chat's tools are **`createOptimizelyAudience`, `createFlag`, `targetMessageToAudience`, `launchExperiment`** (`src/agents/tools.ts`, `experimentTools.ts`) — thin wrappers over §3's endpoints, gated by the **env write gate** (`OPTIMIZELY_WRITE_ENABLED==='true'` + `OPTIMIZELY_API_TOKEN`); when off they return `status:'stubbed'` plans (no per-call human-confirm step shipped).
- *(As built)* `LiveDecisionProvider` = §6 option 1 (no-store datafile fetch + `decide()`), degrading per-flag to mock. The flip is **`DECISION_SOURCE=optimizely`** — independent of `CONNECTOR_MODE` (`src/connectors/index.ts:38-45`). `MockDecisionProvider` stays the stage fallback.
- **Subject to API rate limits** (see Optimizely "API conventions"); the chat creates sequentially and reuses ids (`ensure*` helpers), not in parallel.
- **Implemented in:** `src/services/optimizelyFx.ts` (§3 chain + banner rules), `src/services/experimentFx.ts` (typed rules: a/b · multi_armed_bandit · contextual_multi_armed_bandit + metric events), `src/routes/webhook.ts` (§6 option 3 at `/webhook/optimizely-datafile`, HMAC-verified), `src/connectors/DecisionProvider.ts` (§6 option 1).

---

## 9. Open items to confirm with the user / CSM

- **Token scope:** the provided token must be **editor/admin** on the **sandbox project** to *enable* (not just draft). Verify before the first live write.
- **Which project + environment** for live writes (recommend a sandbox project, `development` env first) and **teardown** expectations (archive flags/audiences after the demo).
- **CMAB on FX** is beta/access-gated — keep MAB/A/B for the live rule; CMAB stays "representative" (per brief honesty tiers).

---

## 10. Sources (official, accessed 2026-06-25)

- Overview / FX API reference — https://docs.developers.optimizely.com/feature-experimentation/reference/overview · https://docs.developers.optimizely.com/feature-experimentation/reference/feature-experimentation-api-overview
- **fx-api-cookbook** (official recipes: create flag/variations/events/attributes/audiences/experiment/launch) — https://github.com/optimizely/fx-api-cookbook (raw recipes under `/requests/`)
- Create feature flags — https://docs.developers.optimizely.com/feature-experimentation/docs/create-feature-flags
- Manage flags — https://docs.developers.optimizely.com/feature-experimentation/docs/manage-flags
- Manage rules — https://docs.developers.optimizely.com/feature-experimentation/docs/manage-rules
- Run flag deliveries (targeted delivery) — https://docs.developers.optimizely.com/feature-experimentation/docs/run-flag-deliveries
- Run A/B tests — https://docs.developers.optimizely.com/feature-experimentation/docs/run-a-b-tests
- Manage environments — https://docs.developers.optimizely.com/feature-experimentation/docs/manage-environments
- Configure datafile polling — https://docs.developers.optimizely.com/full-stack-experimentation/v2.0/docs/configure-datafile-polling
- Personal access token — https://docs.developers.optimizely.com/web-experimentation/docs/personal-access-token · tokens UI: https://app.optimizely.com/tokens
- OAuth 2.0 — https://docs.developers.optimizely.com/web-experimentation/docs/authentication
- Web Experimentation REST API (alternative) — https://docs.developers.optimizely.com/web-experimentation/docs/rest-api-introduction · create/start experiment reference under https://docs.developers.optimizely.com/web-experimentation/reference
- Cross-ref (draft-only MCP path): [`./Optimizely-Experimentation-MCP-Server-Technical-Reference.md`](./Optimizely-Experimentation-MCP-Server-Technical-Reference.md)
