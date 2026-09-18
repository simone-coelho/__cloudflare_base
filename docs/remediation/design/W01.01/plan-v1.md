# W01.01 — approved source-boundary inventory plan v1

Lead: /root. Worker: /root/w01_inventory. Independent verifier: /root/w01_boundary_review. All are recorded as Astra; delegated agents were explicitly requested as gpt-6-astra at xhigh. These are orchestration identities, not fabricated provider UUIDs. Lead approval and exact plan/contract hashes are recorded in tracker.json before admission.

## Authority, baseline and scope

The user's **go** authorizes this bounded design task only; see [authorization.md](../../evidence/W01.01/authorization.md). Parent scope is doc35 W01, linked F01/F03/F25/F33/N01/N03/N04; primary customer trace is doc35 §4 §1.7 multi-brand hard isolation, with related §1.1/§1.2/§1.8/§1.11/§1.12 access and data boundaries. Scope retention is not customer-clause acceptance.

Source baseline: HEAD e49aef83c9a9843dd21479f1b08d53e7709fac41, branch feature/real-time-personalization; doc35 SHA 34b5c7d286650d879223062be352d244b176c9def6d2ebfb543a2dd7e985aedf. [source-baseline.json](../../evidence/W01.01/source-baseline.json) retains hashes for 330 existing source/script/config/bundle files and the observed dirty tree. [tracker-before-admission.json](../../evidence/W01.01/tracker-before-admission.json) is the separately retained initial register for append-only comparison. No baseline file is a new engine test result.

Protected changes: deleted data/optimizely-cache.db-shm and .db-wal; modified public/meridian/engine.bundle.js; existing audit edits in documents 20 and 35; original untracked audit/document/diagnostic files and all framework bootstrap artifacts. Preserve these. Do not use a clean worktree operation, app import, deploy, seed, network probe or dependency install as verification.

Justified design case: the reconciled audit identifies multiple distinct ingress paths, and source orientation confirms a pre-Hono routeAgentRequest call and many route mounts. Route enumeration, method-sensitive middleware and binding dispatch must be known before a deny/retain policy can be safely implemented. This task does not reproduce a deployed exploit or change that behavior.

## Owned outputs and boundaries

Worker owns inventory.md, boundary-matrix.md and source-route-manifest.json in this directory, plus evidence/W01.01/inspect-routes.mjs and worker-inspection.md. The helper may use installed TypeScript/fs modules to parse source and emit JSON on stdout only; it must not import application modules, execute handlers, make network calls or write files. Use apply_patch to create/edit approved artifacts.

Independent verifier owns only evidence/W01.01/independent-review-v1.md (increment the version for a new verdict). Lead owns plan/authority, retained baseline/change records, tracker/journal, artifact/evidence metadata, handoff and RESUME. Workers/reviewer must not edit one another's files or central governance state. No further delegation.

Read scope: src, relevant public asset files/listing, wrangler.toml, package.json/package-lock.json, installed hono/agents/partyserver source and TypeScript parser, canonical audit/supporting reports and remediation protocol. Do not read .env/private credentials or output secret values/full environment bindings. Names and nonsecret policy selectors are sufficient.

## Acceptance criteria

| ID | Required design outcome | Required evidence / owner |
|---|---|---|
| W01.01-C1 | Complete source-linked mounted route/method inventory, nested/dynamic registration expansion, original dispatch order, auth/tenant resolution, binding and destination effects. Distinguish explicit routes, derived HEAD/OPTIONS behavior, unmatched/unknown and unmounted files. Include host/asset variants as source-declared, not live attestations. | K1 source inventory and retained manifest; worker, independently checked by verifier. |
| W01.01-C2 | A proposed boundary matrix and negative-test contract cover legitimate shopper/operator routes and all named perimeter paths. Proposed policies are clearly separate from current behavior; pending decisions and ownership are explicit. | K2 design review on frozen output/source hashes; independent verifier. |
| W01.01-C3 | Handoff provides source/output identity, actual check results and exclusions, retained independent review/lead disposition, unresolved decisions and bounded proposed implementation slices. No route removal, full W01 or finding/gate acceptance claim. | K2 review of the handoff contract and supporting record references; final lead checks the actual completed handoff against that review before closure. |

## Required source-inspection procedure (K1)

1. Enumerate src/index.ts fetch, middleware registrations in order, every app.route mount and direct handler, plus nested/conditional/dynamic route registrations. Parse local source only. Read exported-but-unmounted routes separately.
2. Inspect installed Hono/Agents/Partyserver source for non-obvious dispatch: HEAD may execute GET while handlers still see the original method; CORS can short-circuit OPTIONS before later gates; generic Agent routing precedes Hono and may expose additional DO namespaces without rewriting the original URL. Record exact local source/version and qualification, not guesses from framework names.
3. Trace each route family to actual auth and canonical tenant resolution, storage bindings/key construction and possible side effects, including rate-limit/analytics/seed/session writes before or inside apparently read-only paths. Inspect downstream source where necessary.
4. Include generic CACHE/STORAGE/queue/StateManager API, legacy tracking/CDP/webhooks, operator and live-ops, demo/activation/AI, report GETs, catalog/config/dials/history/merged validation reads, shopper decisions/sort/realtime/identity, WebSocket upgrades and declared static/SPA routing. Distinguish API reachability from whether an individual forwarded DO path is implemented.
5. Emit a deterministic source-route manifest and source hashes using the helper; reconcile its result with manual code inspection. Source enumeration is not runtime route acceptance. Retain exact commands and any incomplete/failed inspection in worker-inspection.md.

## Required independent review procedure (K2)

The verifier independently reads primary entrypoint/middleware/route/dependency source, reruns the read-only helper, reconciles its route set against actual registration constructs, and checks all three outputs on the frozen manifest. A parser's successful exit alone is insufficient. Challenge omissions, auth ordering, implicit methods, dynamic dispatch, tenant conflicts, destination state and legitimate customer capability retention. Inspect all required checks and the handoff/residual plan; record a separate pass/rework/insufficient verdict with exact hashes, commands, limits and criterion dispositions.

The negative-test proposal must specify auth mode, caller/tenant/host/header/path/query combinations, method/upgrade and expected allowed/denied behavior; assertions inspect affected KV/R2/D1/DO/queue/AE and external side effects, including any operation occurring before denial. Use two non-default brands in the future acceptance design. Tests are proposals this turn; do not execute application handlers or claim runtime/deployed correctness.

## Dependencies, decisions and residual work

D01 (demo/customer surface policy) and D08 (customer/brand/environment/region topology) inform this inventory. They are not start prerequisites and remain pending. Show separate-deployable versus omitted/disabled-surface alternatives without selecting a customer deployment policy. Model/SSO/privacy/customer choices are not decided by this source investigation.

Full W01 requires implemented enforcement/removal/authorization and mounted-path destination tests. W03/W08/W37 and customer isolation acceptance remain cross-package work. Propose subsequent narrow W01 slices and required interface/decision outputs, label proposed dependencies, and avoid cycles or implying a broader user mandate. No package decomposition is declared complete by this task.

## Measurement, rollback and handoff

Claim level is source_confirmed only. Node v22.15.0 and installed dependency versions/file hashes identify the local inspection environment; no server/Worker/browser/latency/business-lift measurement is claimed. Engine source is unchanged, so no engine rollout or rollback occurs. Correct documents by versioned amendments; preserve original accepted evidence and append-only records instead of deleting history.

Freeze the source/output manifest before final review. Keep evidence/review/signoff records outside their own hashed artifact basis to avoid self-referential hashes. Lead validates artifact/evidence hashes, all criteria, independent review and final handoff; compares tracker transitions to the retained prior snapshot; runs board check/status and checks protected source hashes before closing only W01.01. Update RESUME before reporting the next action. If source changes or evidence is insufficient, preserve the failure and return for rework; do not close a finding or start engine fixes.
