# W01.01 source-boundary inventory

This is the source-only design deliverable admitted by [plan-v1](plan-v1.md). It changes no route, binding, engine, deployed resource or customer scope. It is not W01, finding, G0/G1, customer or release acceptance. Canonical obligations remain [doc35 W01](../../../architecture/35-audit-verification-and-source-of-truth.md#5--one-remediation-register-with-containment-separated-from-closure), F01/F03/F25/F33 and N01/N03/N04 (N04 aliases N01).

The [manifest](source-route-manifest.json) fixes the local source basis: 26 mounts, 185 explicit Hono route registrations, 91 GET handlers with derived HEAD dispatch, 20 middleware registrations, three direct Hono fetch-dispatch sites, 200 non-test source files, and 361 public asset files. It includes installed dependency versions and hashes. Hono 4.12.27, Agents 0.16.2, Partyserver 0.5.8 and AIChat 0.8.6 behavior below is read from their installed code. No handler, server, socket, cloud API or browser was run. [Worker evidence](../../evidence/W01.01/worker-inspection.md) records commands, limitations and output identity.

## Dispatch and method semantics

There are three separately reviewable ingress layers; a Hono middleware test alone covers only the last.

1. **Asset service / host routing.** [wrangler.toml:177](../../../../wrangler.toml#L177), [305](../../../../wrangler.toml#L305) and [400](../../../../wrangler.toml#L400) all select the entire `public` directory, `ASSETS`, and SPA fallback. None declares `run_worker_first`, `html_handling`, explicit custom-domain routes, `_headers` or `_redirects` policy. Asset matches can be handled outside the user Worker; source does not establish the live edge precedence, navigation fallback, URL normalization, methods, redirects or domain configuration. Treat public file paths and extensionless/trailing-slash/SPA aliases as an additional perimeter to test. A 200 HTML fallback is not proof an API handler ran. Root pages include storefront, operator-console, learning, tuning and visual-demo; nested Meridian, live/Bright Hour, console, SDK, images and backups remain in the declared asset set. The manifest lists every file. The protected modified Meridian bundle is hashed and untouched.
2. **Worker fetch before Hono.** [index.ts:185](../../../../src/index.ts#L185) always calls `routeAgentRequest(request, env)`; a response returns immediately. This precedes tenant resolution, logging, CORS, rate limiting and every Hono auth gate. No router options or before-request/before-connect authorization hooks are supplied. Non-agent paths fall through to `app.fetch` at 187; insufficient agent path segments fall through too. Unknown namespaces with a complete Agent path return 400 in the dependency and can log the URL.
3. **Hono.** [index.ts:60](../../../../src/index.ts#L60) registers middleware in this order: tenant resolution; timing; request ID; logger; secure headers; global CORS; `/api/*` rate limit; `/realtime/*` SDK gate; `/v1/:tenant/*` SDK gate; `/operator/*` write gate. Child-router middleware and handlers follow their mount order below. Error and not-found responses do not reverse already-started effects. The logger sees requests before later denial; request URL/query may carry identifiers.

[Hono dispatch:278](../../../../node_modules/hono/dist/hono-base.js#L278) routes HEAD through GET using the original Request, then strips the response body. Thus route code and middleware still see `HEAD`; GET-side reads, seed writes, telemetry, session creation and outbound calls may execute. No explicit HEAD route is registered. Notable exception: `/content/:kind` middleware appears before the read and only passes raw GET, so HEAD needs JWT. `/config/reflex` read appears before its write middleware and returns without `next()`, so HEAD stays open like GET. History/revision routes remain separately matched. See [content.ts:52](../../../../src/routes/content.ts#L52), [config.ts:70](../../../../src/routes/config.ts#L70), [config.ts:123](../../../../src/routes/config.ts#L123), [Hono compose](../../../../node_modules/hono/dist/compose.js).

[Hono CORS:46](../../../../node_modules/hono/dist/middleware/cors/index.js#L46) returns 204 for OPTIONS before rate limiting/auth/handlers, including unmatched Hono paths. It advertises GET, POST, PUT, DELETE, OPTIONS and the four headers in [index.ts:70](../../../../src/index.ts#L70); PATCH, HEAD and X-Tenant are not in those explicit lists. This is CORS response behavior, not authorization of the actual request. Denied/missing Origin does not itself stop non-OPTIONS handler dispatch. Own-origin and local development origins are accepted by [edgeAccess.ts:59](../../../../src/middleware/edgeAccess.ts#L59); configured rules may include wildcards. Agent and asset OPTIONS are separate. Test raw HEAD, allowed/unknown methods, OPTIONS, path casing, duplicate slashes, encoded separators, trailing slashes and upgrade variants in the actual runtime before accepting a method policy.

No explicit Hono `all`, `on`, `head`, `options`, nested `route`, computed/conditional registration, or exported-but-unmounted Hono router was found in non-test `src`. Nested *path patterns* and all dynamic parameters are included below. Unmatched Hono paths/methods reach JSON 404 only after applicable earlier middleware; there is no automatic method-authorization inference from a prefix. Test-only routers, DO internal paths, and exported helper functions are not extra public Hono routes.

## Current authentication and tenant selection

Codes used in the family table describe current source, not proposed enforcement:

- **O**: no required route credential; any data validation, feature flag or existence check is separate.
- **J**: `jwt()` required independently of AUTH_MODE; [auth.ts:50](../../../../src/middleware/auth.ts#L50) calls `jwtVerify` with configured issuer/audience and applies any explicit role options. Signature and library claim checks are not a middleware requirement that every token contain `exp`: no `requiredClaims` option or access-token-type check is supplied. The middleware does not establish tenant membership or current account/session revocation. **A** adds admin role. Optional JWT accepts a missing token, but rejects a supplied invalid token.
- **S**: parent SDK gate only when AUTH_MODE is enforced; otherwise passes. It accepts header/query SDK keys, including wildcard owners, and falls back to JWT when no key is supplied and a Bearer-looking header exists. A nonempty invalid SDK key does not fall through to an otherwise valid Bearer. On `/realtime` it has no path tenant to verify; on `/v1/:tenant` it checks key ownership against that path parameter. It discards the verified owner. Neither branch authorizes canonical tenant membership.
- **W**: parent operator gate requires JWT on non-GET/HEAD/OPTIONS only in enforced mode. The three rename/pin/prune routes also have their own unconditional J.
- **T**: token-specific shot gate; missing/mismatched SHOT_TOKEN returns not-found before Browser access. **FX**: deployment write flag and configured FX credentials, not caller authorization.

The checked manifest sets AUTH_MODE=enforced, CONNECTOR_MODE=mock, DECISION_SOURCE=mock and REFLEX_HOST=session in the base/staging/production configuration. Code defaults for missing AUTH_MODE are open and for missing REFLEX_HOST are session. No live variable value was inspected.

[tenantMiddleware](../../../../src/tenancy/middleware.ts#L74) resolves `c.get('tenant')` from provisioned X-Tenant, then configured host, then the default brand. [resolveTenant](../../../../src/tenancy/tenant.ts#L127) shape-checks/provisioning-checks selectors but does not compare caller authority. Unknown/malformed registry inputs can fall back. The default brand is a current compatibility implementation detail; future fixtures must use two non-default brands, not promote this default into product identity.

`/v1` routes separately use the path slug; document `?scope=`, report/lift `brand`, shopper IDs, SDK brand context, host and header can diverge. [decisions.ts:332](../../../../src/routes/decisions.ts#L332) explicitly passes path tenant for documents/ledger and context tenant for shopper state. [versionedStore.ts:113](../../../../src/config/versionedStore.ts#L113) forms raw kind/scope keys; [TenantKV](../../../../src/tenancy/tenant.ts#L209) adds non-default prefixes only where used. Scoped key construction is not an authorization check. [getConnectors:28](../../../../src/connectors/index.ts#L28) creates its audience store without a tenant argument. [SDK core](../../../../src/sdk/core.ts#L121) has additional transport propagation work under W03/W37.

### Ordered mounts

| Order | Prefix | Router source | Entrypoint line |
|---|---|---|---|
| 1 | `/health` | [src/routes/health.ts](../../../../src/routes/health.ts) | [91](../../../../src/index.ts#L91) |
| 2 | `/auth` | [src/routes/auth.ts](../../../../src/routes/auth.ts) | [92](../../../../src/index.ts#L92) |
| 3 | `/api` | [src/routes/api.ts](../../../../src/routes/api.ts) | [93](../../../../src/index.ts#L93) |
| 4 | `/track` | [src/routes/tracking.ts](../../../../src/routes/tracking.ts) | [94](../../../../src/index.ts#L94) |
| 5 | `/pixel` | [src/routes/pixel.ts](../../../../src/routes/pixel.ts) | [95](../../../../src/index.ts#L95) |
| 6 | `/webhook` | [src/routes/webhook.ts](../../../../src/routes/webhook.ts) | [96](../../../../src/index.ts#L96) |
| 7 | `/optimizely` | [src/routes/optimizely.ts](../../../../src/routes/optimizely.ts) | [97](../../../../src/index.ts#L97) |
| 8 | `/cdp` | [src/routes/cdp.ts](../../../../src/routes/cdp.ts) | [98](../../../../src/index.ts#L98) |
| 9 | `/operator` | [src/routes/operator.ts](../../../../src/routes/operator.ts) | [99](../../../../src/index.ts#L99) |
| 10 | `/config` | [src/routes/config.ts](../../../../src/routes/config.ts) | [102](../../../../src/index.ts#L102) |
| 11 | `/sort` | [src/routes/sort.ts](../../../../src/routes/sort.ts) | [106](../../../../src/index.ts#L106) |
| 12 | `/content` | [src/routes/content.ts](../../../../src/routes/content.ts) | [109](../../../../src/index.ts#L109) |
| 13 | `/realtime` | [src/routes/realtime.ts](../../../../src/routes/realtime.ts) | [110](../../../../src/index.ts#L110) |
| 14 | `/meridian/api` | [src/demos/meridian/routes.ts](../../../../src/demos/meridian/routes.ts) | [111](../../../../src/index.ts#L111) |
| 15 | `/v1` | [src/routes/decisions.ts](../../../../src/routes/decisions.ts) | [114](../../../../src/index.ts#L114) |
| 16 | `/v1` | [src/routes/identity.ts](../../../../src/routes/identity.ts) | [116](../../../../src/index.ts#L116) |
| 17 | `/ai` | [src/routes/ai.ts](../../../../src/routes/ai.ts) | [117](../../../../src/index.ts#L117) |
| 18 | `/ai/scene` | [src/routes/aiScene.ts](../../../../src/routes/aiScene.ts) | [118](../../../../src/index.ts#L118) |
| 19 | `/__shot` | [src/routes/shot.ts](../../../../src/routes/shot.ts) | [119](../../../../src/index.ts#L119) |
| 20 | `/geo` | [src/routes/geo.ts](../../../../src/routes/geo.ts) | [120](../../../../src/index.ts#L120) |
| 21 | `/funnel` | [src/routes/funnel.ts](../../../../src/routes/funnel.ts) | [121](../../../../src/index.ts#L121) |
| 22 | `/funnel/sim` | [src/routes/funnelSim.ts](../../../../src/routes/funnelSim.ts) | [122](../../../../src/index.ts#L122) |
| 23 | `/experiment` | [src/routes/experiment.ts](../../../../src/routes/experiment.ts) | [123](../../../../src/index.ts#L123) |
| 24 | `/signals` | [src/routes/signals.ts](../../../../src/routes/signals.ts) | [124](../../../../src/index.ts#L124) |
| 25 | `/live/api` | [src/routes/live.ts](../../../../src/routes/live.ts) | [128](../../../../src/index.ts#L128) |
| 26 | `/live/ops-api` | [src/routes/liveOps.ts](../../../../src/routes/liveOps.ts) | [132](../../../../src/index.ts#L132) |

### Complete explicit endpoint list

`(+ HEAD)` identifies Hono dispatch derivation, not proof of identical authorization or valid WebSocket response construction. Parameters and arbitrary `:kind` values remain patterns; content permits catalog/slots/learn/priors, generic state namespace permits only `state`, and proposal decision permits apply/reject. Literal routes preceding parameters retain their registration order.

| ID | Method | Mounted path | Registration source |
|---|---|---|---|
| R001 | GET (+ HEAD) | `/health` | [src/routes/health.ts:6](../../../../src/routes/health.ts#L6) |
| R002 | GET (+ HEAD) | `/health/ready` | [src/routes/health.ts:67](../../../../src/routes/health.ts#L67) |
| R003 | GET (+ HEAD) | `/health/live` | [src/routes/health.ts:71](../../../../src/routes/health.ts#L71) |
| R004 | POST | `/auth/login` | [src/routes/auth.ts:59](../../../../src/routes/auth.ts#L59) |
| R005 | POST | `/auth/refresh` | [src/routes/auth.ts:90](../../../../src/routes/auth.ts#L90) |
| R006 | POST | `/auth/logout` | [src/routes/auth.ts:108](../../../../src/routes/auth.ts#L108) |
| R007 | GET (+ HEAD) | `/auth/me` | [src/routes/auth.ts:115](../../../../src/routes/auth.ts#L115) |
| R008 | POST | `/auth/password` | [src/routes/auth.ts:123](../../../../src/routes/auth.ts#L123) |
| R009 | GET (+ HEAD) | `/auth/users` | [src/routes/auth.ts:143](../../../../src/routes/auth.ts#L143) |
| R010 | GET (+ HEAD) | `/auth/audit` | [src/routes/auth.ts:146](../../../../src/routes/auth.ts#L146) |
| R011 | POST | `/auth/users` | [src/routes/auth.ts:152](../../../../src/routes/auth.ts#L152) |
| R012 | PATCH | `/auth/users/:id` | [src/routes/auth.ts:164](../../../../src/routes/auth.ts#L164) |
| R013 | POST | `/auth/users/:id/reset` | [src/routes/auth.ts:188](../../../../src/routes/auth.ts#L188) |
| R014 | DELETE | `/auth/users/:id` | [src/routes/auth.ts:200](../../../../src/routes/auth.ts#L200) |
| R015 | GET (+ HEAD) | `/api/storage/:key` | [src/routes/api.ts:9](../../../../src/routes/api.ts#L9) |
| R016 | PUT | `/api/storage/:key` | [src/routes/api.ts:28](../../../../src/routes/api.ts#L28) |
| R017 | DELETE | `/api/storage/:key` | [src/routes/api.ts:51](../../../../src/routes/api.ts#L51) |
| R018 | GET (+ HEAD) | `/api/cache/:key` | [src/routes/api.ts:63](../../../../src/routes/api.ts#L63) |
| R019 | PUT | `/api/cache/:key` | [src/routes/api.ts:79](../../../../src/routes/api.ts#L79) |
| R020 | DELETE | `/api/cache/:key` | [src/routes/api.ts:99](../../../../src/routes/api.ts#L99) |
| R021 | POST | `/api/queue/send` | [src/routes/api.ts:111](../../../../src/routes/api.ts#L111) |
| R022 | GET (+ HEAD) | `/api/state/:namespace/:key` | [src/routes/api.ts:124](../../../../src/routes/api.ts#L124) |
| R023 | PUT | `/api/state/:namespace/:key` | [src/routes/api.ts:151](../../../../src/routes/api.ts#L151) |
| R024 | GET (+ HEAD) | `/api/analytics/query` | [src/routes/api.ts:178](../../../../src/routes/api.ts#L178) |
| R025 | POST | `/track/event` | [src/routes/tracking.ts:10](../../../../src/routes/tracking.ts#L10) |
| R026 | POST | `/track/batch` | [src/routes/tracking.ts:54](../../../../src/routes/tracking.ts#L54) |
| R027 | GET (+ HEAD) | `/track/health` | [src/routes/tracking.ts:124](../../../../src/routes/tracking.ts#L124) |
| R028 | GET (+ HEAD) | `/pixel/track/:pixelId` | [src/routes/pixel.ts:17](../../../../src/routes/pixel.ts#L17) |
| R029 | POST | `/pixel/generate` | [src/routes/pixel.ts:80](../../../../src/routes/pixel.ts#L80) |
| R030 | GET (+ HEAD) | `/pixel/health` | [src/routes/pixel.ts:114](../../../../src/routes/pixel.ts#L114) |
| R031 | POST | `/webhook/optimizely` | [src/routes/webhook.ts:17](../../../../src/routes/webhook.ts#L17) |
| R032 | POST | `/webhook/optimizely-datafile` | [src/routes/webhook.ts:60](../../../../src/routes/webhook.ts#L60) |
| R033 | POST | `/webhook/segment` | [src/routes/webhook.ts:90](../../../../src/routes/webhook.ts#L90) |
| R034 | POST | `/webhook/custom` | [src/routes/webhook.ts:129](../../../../src/routes/webhook.ts#L129) |
| R035 | GET (+ HEAD) | `/webhook/health` | [src/routes/webhook.ts:168](../../../../src/routes/webhook.ts#L168) |
| R036 | POST | `/optimizely/decisions` | [src/routes/optimizely.ts:27](../../../../src/routes/optimizely.ts#L27) |
| R037 | POST | `/optimizely/preview` | [src/routes/optimizely.ts:96](../../../../src/routes/optimizely.ts#L96) |
| R038 | GET (+ HEAD) | `/optimizely/banner-rules` | [src/routes/optimizely.ts:130](../../../../src/routes/optimizely.ts#L130) |
| R039 | POST | `/optimizely/track` | [src/routes/optimizely.ts:143](../../../../src/routes/optimizely.ts#L143) |
| R040 | GET (+ HEAD) | `/optimizely/experiments` | [src/routes/optimizely.ts:176](../../../../src/routes/optimizely.ts#L176) |
| R041 | GET (+ HEAD) | `/optimizely/features` | [src/routes/optimizely.ts:201](../../../../src/routes/optimizely.ts#L201) |
| R042 | GET (+ HEAD) | `/optimizely/datafile` | [src/routes/optimizely.ts:227](../../../../src/routes/optimizely.ts#L227) |
| R043 | GET (+ HEAD) | `/optimizely/health` | [src/routes/optimizely.ts:239](../../../../src/routes/optimizely.ts#L239) |
| R044 | POST | `/cdp/profile` | [src/routes/cdp.ts:31](../../../../src/routes/cdp.ts#L31) |
| R045 | POST | `/cdp/segments` | [src/routes/cdp.ts:50](../../../../src/routes/cdp.ts#L50) |
| R046 | POST | `/cdp/identify` | [src/routes/cdp.ts:65](../../../../src/routes/cdp.ts#L65) |
| R047 | POST | `/cdp/track` | [src/routes/cdp.ts:84](../../../../src/routes/cdp.ts#L84) |
| R048 | POST | `/cdp/forward/:destination` | [src/routes/cdp.ts:110](../../../../src/routes/cdp.ts#L110) |
| R049 | GET (+ HEAD) | `/cdp/destinations` | [src/routes/cdp.ts:125](../../../../src/routes/cdp.ts#L125) |
| R050 | POST | `/cdp/destinations` | [src/routes/cdp.ts:137](../../../../src/routes/cdp.ts#L137) |
| R051 | GET (+ HEAD) | `/cdp/health` | [src/routes/cdp.ts:161](../../../../src/routes/cdp.ts#L161) |
| R052 | POST | `/operator/audiences/suggest` | [src/routes/operator.ts:78](../../../../src/routes/operator.ts#L78) |
| R053 | POST | `/operator/audiences/publish` | [src/routes/operator.ts:112](../../../../src/routes/operator.ts#L112) |
| R054 | GET (+ HEAD) | `/operator/audiences` | [src/routes/operator.ts:155](../../../../src/routes/operator.ts#L155) |
| R055 | GET (+ HEAD) | `/operator/insights` | [src/routes/operator.ts:179](../../../../src/routes/operator.ts#L179) |
| R056 | POST | `/operator/events/reset` | [src/routes/operator.ts:329](../../../../src/routes/operator.ts#L329) |
| R057 | GET (+ HEAD) | `/operator/events/stats` | [src/routes/operator.ts:376](../../../../src/routes/operator.ts#L376) |
| R058 | POST | `/operator/audiences/:key/rename` | [src/routes/operator.ts:431](../../../../src/routes/operator.ts#L431) |
| R059 | POST | `/operator/audiences/:key/pin` | [src/routes/operator.ts:453](../../../../src/routes/operator.ts#L453) |
| R060 | POST | `/operator/audiences/:key/prune` | [src/routes/operator.ts:481](../../../../src/routes/operator.ts#L481) |
| R061 | GET (+ HEAD) | `/config/reflex` | [src/routes/config.ts:70](../../../../src/routes/config.ts#L70) |
| R062 | GET (+ HEAD) | `/config/reflex/history` | [src/routes/config.ts:90](../../../../src/routes/config.ts#L90) |
| R063 | GET (+ HEAD) | `/config/reflex/revisions/:n` | [src/routes/config.ts:95](../../../../src/routes/config.ts#L95) |
| R064 | POST | `/config/reflex/validate` | [src/routes/config.ts:108](../../../../src/routes/config.ts#L108) |
| R065 | PUT | `/config/reflex` | [src/routes/config.ts:130](../../../../src/routes/config.ts#L130) |
| R066 | PATCH | `/config/reflex` | [src/routes/config.ts:148](../../../../src/routes/config.ts#L148) |
| R067 | POST | `/config/reflex/rollback/:n` | [src/routes/config.ts:163](../../../../src/routes/config.ts#L163) |
| R068 | POST | `/sort` | [src/routes/sort.ts:81](../../../../src/routes/sort.ts#L81) |
| R069 | GET (+ HEAD) | `/content/:kind` | [src/routes/content.ts:58](../../../../src/routes/content.ts#L58) |
| R070 | GET (+ HEAD) | `/content/:kind/history` | [src/routes/content.ts:67](../../../../src/routes/content.ts#L67) |
| R071 | GET (+ HEAD) | `/content/:kind/revisions/:n` | [src/routes/content.ts:73](../../../../src/routes/content.ts#L73) |
| R072 | POST | `/content/:kind/validate` | [src/routes/content.ts:83](../../../../src/routes/content.ts#L83) |
| R073 | PUT | `/content/:kind` | [src/routes/content.ts:93](../../../../src/routes/content.ts#L93) |
| R074 | POST | `/content/:kind/rollback/:n` | [src/routes/content.ts:114](../../../../src/routes/content.ts#L114) |
| R075 | POST | `/content/catalog/import` | [src/routes/content.ts:145](../../../../src/routes/content.ts#L145) |
| R076 | POST | `/content/catalog/pull` | [src/routes/content.ts:167](../../../../src/routes/content.ts#L167) |
| R077 | GET (+ HEAD) | `/realtime/ws` | [src/routes/realtime.ts:25](../../../../src/routes/realtime.ts#L25) |
| R078 | POST | `/realtime/action` | [src/routes/realtime.ts:88](../../../../src/routes/realtime.ts#L88) |
| R079 | GET (+ HEAD) | `/realtime/personalization/:userId` | [src/routes/realtime.ts:249](../../../../src/routes/realtime.ts#L249) |
| R080 | GET (+ HEAD) | `/realtime/reflex` | [src/routes/realtime.ts:304](../../../../src/routes/realtime.ts#L304) |
| R081 | POST | `/realtime/session/reset` | [src/routes/realtime.ts:361](../../../../src/routes/realtime.ts#L361) |
| R082 | POST | `/realtime/session/:sessionId/preferences` | [src/routes/realtime.ts:395](../../../../src/routes/realtime.ts#L395) |
| R083 | GET (+ HEAD) | `/realtime/session/:sessionId/analytics` | [src/routes/realtime.ts:455](../../../../src/routes/realtime.ts#L455) |
| R084 | GET (+ HEAD) | `/realtime/segments/:userId` | [src/routes/realtime.ts:486](../../../../src/routes/realtime.ts#L486) |
| R085 | POST | `/realtime/segments/:userId` | [src/routes/realtime.ts:518](../../../../src/routes/realtime.ts#L518) |
| R086 | GET (+ HEAD) | `/realtime/connections/:userId` | [src/routes/realtime.ts:558](../../../../src/routes/realtime.ts#L558) |
| R087 | GET (+ HEAD) | `/realtime/connections` | [src/routes/realtime.ts:586](../../../../src/routes/realtime.ts#L586) |
| R088 | GET (+ HEAD) | `/realtime/health` | [src/routes/realtime.ts:608](../../../../src/routes/realtime.ts#L608) |
| R089 | POST | `/realtime/demo/trigger` | [src/routes/realtime.ts:651](../../../../src/routes/realtime.ts#L651) |
| R090 | GET (+ HEAD) | `/meridian/api/catalog` | [src/demos/meridian/routes.ts:50](../../../../src/demos/meridian/routes.ts#L50) |
| R091 | POST | `/meridian/api/concierge` | [src/demos/meridian/routes.ts:93](../../../../src/demos/meridian/routes.ts#L93) |
| R092 | GET (+ HEAD) | `/meridian/api/funnel` | [src/demos/meridian/routes.ts:113](../../../../src/demos/meridian/routes.ts#L113) |
| R093 | GET (+ HEAD) | `/meridian/api/coldstart` | [src/demos/meridian/routes.ts:125](../../../../src/demos/meridian/routes.ts#L125) |
| R094 | GET (+ HEAD) | `/meridian/api/cohort` | [src/demos/meridian/routes.ts:150](../../../../src/demos/meridian/routes.ts#L150) |
| R095 | GET (+ HEAD) | `/meridian/api/ws` | [src/demos/meridian/routes.ts:162](../../../../src/demos/meridian/routes.ts#L162) |
| R096 | POST | `/meridian/api/action` | [src/demos/meridian/routes.ts:173](../../../../src/demos/meridian/routes.ts#L173) |
| R097 | GET (+ HEAD) | `/meridian/api/snapshot` | [src/demos/meridian/routes.ts:189](../../../../src/demos/meridian/routes.ts#L189) |
| R098 | POST | `/meridian/api/vertical` | [src/demos/meridian/routes.ts:197](../../../../src/demos/meridian/routes.ts#L197) |
| R099 | POST | `/meridian/api/reset` | [src/demos/meridian/routes.ts:212](../../../../src/demos/meridian/routes.ts#L212) |
| R100 | POST | `/meridian/api/search` | [src/demos/meridian/routes.ts:225](../../../../src/demos/meridian/routes.ts#L225) |
| R101 | GET (+ HEAD) | `/meridian/api/scenes` | [src/demos/meridian/routes.ts:235](../../../../src/demos/meridian/routes.ts#L235) |
| R102 | POST | `/meridian/api/experiment/dispatch` | [src/demos/meridian/routes.ts:241](../../../../src/demos/meridian/routes.ts#L241) |
| R103 | GET (+ HEAD) | `/meridian/api/experiment/status` | [src/demos/meridian/routes.ts:253](../../../../src/demos/meridian/routes.ts#L253) |
| R104 | POST | `/meridian/api/opal/propose` | [src/demos/meridian/routes.ts:259](../../../../src/demos/meridian/routes.ts#L259) |
| R105 | GET (+ HEAD) | `/meridian/api/opal/vocabulary` | [src/demos/meridian/routes.ts:271](../../../../src/demos/meridian/routes.ts#L271) |
| R106 | POST | `/meridian/api/decisions` | [src/demos/meridian/routes.ts:282](../../../../src/demos/meridian/routes.ts#L282) |
| R107 | GET (+ HEAD) | `/meridian/api/decisions/export` | [src/demos/meridian/routes.ts:298](../../../../src/demos/meridian/routes.ts#L298) |
| R108 | GET (+ HEAD) | `/meridian/api/moment/signals` | [src/demos/meridian/routes.ts:311](../../../../src/demos/meridian/routes.ts#L311) |
| R109 | POST | `/meridian/api/moment/write` | [src/demos/meridian/routes.ts:315](../../../../src/demos/meridian/routes.ts#L315) |
| R110 | GET (+ HEAD) | `/meridian/api/wire-check` | [src/demos/meridian/routes.ts:324](../../../../src/demos/meridian/routes.ts#L324) |
| R111 | GET (+ HEAD) | `/v1/:tenant/trend` | [src/routes/decisions.ts:54](../../../../src/routes/decisions.ts#L54) |
| R112 | GET (+ HEAD) | `/v1/:tenant/lift/rows` | [src/routes/decisions.ts:73](../../../../src/routes/decisions.ts#L73) |
| R113 | GET (+ HEAD) | `/v1/:tenant/brands` | [src/routes/decisions.ts:110](../../../../src/routes/decisions.ts#L110) |
| R114 | GET (+ HEAD) | `/v1/:tenant/learn/slots` | [src/routes/decisions.ts:125](../../../../src/routes/decisions.ts#L125) |
| R115 | GET (+ HEAD) | `/v1/:tenant/learn/exploring` | [src/routes/decisions.ts:151](../../../../src/routes/decisions.ts#L151) |
| R116 | GET (+ HEAD) | `/v1/:tenant/monitor` | [src/routes/decisions.ts:178](../../../../src/routes/decisions.ts#L178) |
| R117 | POST | `/v1/:tenant/monitor` | [src/routes/decisions.ts:186](../../../../src/routes/decisions.ts#L186) |
| R118 | GET (+ HEAD) | `/v1/:tenant/learn/queue` | [src/routes/decisions.ts:198](../../../../src/routes/decisions.ts#L198) |
| R119 | GET (+ HEAD) | `/v1/:tenant/visitors/:visitorId/receipts` | [src/routes/decisions.ts:223](../../../../src/routes/decisions.ts#L223) |
| R120 | GET (+ HEAD) | `/v1/:tenant/lift` | [src/routes/decisions.ts:251](../../../../src/routes/decisions.ts#L251) |
| R121 | GET (+ HEAD) | `/v1/:tenant/visitors/:visitorId/recent` | [src/routes/decisions.ts:270](../../../../src/routes/decisions.ts#L270) |
| R122 | POST | `/v1/:tenant/learn/cycle` | [src/routes/decisions.ts:288](../../../../src/routes/decisions.ts#L288) |
| R123 | GET (+ HEAD) | `/v1/:tenant/learn/proposals` | [src/routes/decisions.ts:295](../../../../src/routes/decisions.ts#L295) |
| R124 | POST | `/v1/:tenant/learn/proposals/:id/:decision` | [src/routes/decisions.ts:302](../../../../src/routes/decisions.ts#L302) |
| R125 | POST | `/v1/:tenant/trend/rollup` | [src/routes/decisions.ts:312](../../../../src/routes/decisions.ts#L312) |
| R126 | GET (+ HEAD) | `/v1/:tenant/decisions/snapshot` | [src/routes/decisions.ts:318](../../../../src/routes/decisions.ts#L318) |
| R127 | GET (+ HEAD) | `/v1/:tenant/ledger/batches` | [src/routes/decisions.ts:355](../../../../src/routes/decisions.ts#L355) |
| R128 | GET (+ HEAD) | `/v1/:tenant/ledger/erasures` | [src/routes/decisions.ts:381](../../../../src/routes/decisions.ts#L381) |
| R129 | POST | `/v1/:tenant/ledger/erasures` | [src/routes/decisions.ts:388](../../../../src/routes/decisions.ts#L388) |
| R130 | POST | `/v1/:tenant/ledger/erasures/rewrite` | [src/routes/decisions.ts:399](../../../../src/routes/decisions.ts#L399) |
| R131 | GET (+ HEAD) | `/v1/:tenant/ledger/:id` | [src/routes/decisions.ts:416](../../../../src/routes/decisions.ts#L416) |
| R132 | GET (+ HEAD) | `/v1/:tenant/replay/:id` | [src/routes/decisions.ts:434](../../../../src/routes/decisions.ts#L434) |
| R133 | POST | `/v1/:tenant/models/reference` | [src/routes/decisions.ts:452](../../../../src/routes/decisions.ts#L452) |
| R134 | GET (+ HEAD) | `/v1/:tenant/lift/history` | [src/routes/decisions.ts:467](../../../../src/routes/decisions.ts#L467) |
| R135 | POST | `/v1/:tenant/learn/items/reset` | [src/routes/decisions.ts:493](../../../../src/routes/decisions.ts#L493) |
| R136 | POST | `/v1/:tenant/learn/publish` | [src/routes/decisions.ts:513](../../../../src/routes/decisions.ts#L513) |
| R137 | POST | `/v1/:tenant/learn/report` | [src/routes/decisions.ts:533](../../../../src/routes/decisions.ts#L533) |
| R138 | GET (+ HEAD) | `/v1/:tenant/learn/report/window` | [src/routes/decisions.ts:568](../../../../src/routes/decisions.ts#L568) |
| R139 | GET (+ HEAD) | `/v1/:tenant/learn/report` | [src/routes/decisions.ts:580](../../../../src/routes/decisions.ts#L580) |
| R140 | POST | `/v1/:tenant/identity/link` | [src/routes/identity.ts:55](../../../../src/routes/identity.ts#L55) |
| R141 | POST | `/v1/:tenant/identity/detach` | [src/routes/identity.ts:98](../../../../src/routes/identity.ts#L98) |
| R142 | POST | `/v1/:tenant/identity/resolve` | [src/routes/identity.ts:108](../../../../src/routes/identity.ts#L108) |
| R143 | GET (+ HEAD) | `/v1/:tenant/identity/visitor/:visitorId` | [src/routes/identity.ts:120](../../../../src/routes/identity.ts#L120) |
| R144 | GET (+ HEAD) | `/v1/:tenant/identity/shopper/:shopperId` | [src/routes/identity.ts:130](../../../../src/routes/identity.ts#L130) |
| R145 | POST | `/v1/:tenant/identity/events` | [src/routes/identity.ts:146](../../../../src/routes/identity.ts#L146) |
| R146 | POST | `/v1/:tenant/identity/erase` | [src/routes/identity.ts:175](../../../../src/routes/identity.ts#L175) |
| R147 | POST | `/ai/search` | [src/routes/ai.ts:16](../../../../src/routes/ai.ts#L16) |
| R148 | POST | `/ai/concierge` | [src/routes/ai.ts:56](../../../../src/routes/ai.ts#L56) |
| R149 | GET (+ HEAD) | `/ai/scene/:productId/:sceneId` | [src/routes/aiScene.ts:22](../../../../src/routes/aiScene.ts#L22) |
| R150 | POST | `/ai/scene` | [src/routes/aiScene.ts:37](../../../../src/routes/aiScene.ts#L37) |
| R151 | GET (+ HEAD) | `/__shot` | [src/routes/shot.ts:69](../../../../src/routes/shot.ts#L69) |
| R152 | GET (+ HEAD) | `/geo` | [src/routes/geo.ts:21](../../../../src/routes/geo.ts#L21) |
| R153 | GET (+ HEAD) | `/geo/cohort` | [src/routes/geo.ts:58](../../../../src/routes/geo.ts#L58) |
| R154 | GET (+ HEAD) | `/funnel` | [src/routes/funnel.ts:20](../../../../src/routes/funnel.ts#L20) |
| R155 | POST | `/funnel/event` | [src/routes/funnel.ts:46](../../../../src/routes/funnel.ts#L46) |
| R156 | GET (+ HEAD) | `/funnel/diagnose` | [src/routes/funnel.ts:75](../../../../src/routes/funnel.ts#L75) |
| R157 | POST | `/funnel/audience` | [src/routes/funnel.ts:88](../../../../src/routes/funnel.ts#L88) |
| R158 | POST | `/funnel/sim/tick` | [src/routes/funnelSim.ts:32](../../../../src/routes/funnelSim.ts#L32) |
| R159 | POST | `/funnel/sim/burst` | [src/routes/funnelSim.ts:53](../../../../src/routes/funnelSim.ts#L53) |
| R160 | POST | `/funnel/sim/reset` | [src/routes/funnelSim.ts:82](../../../../src/routes/funnelSim.ts#L82) |
| R161 | POST | `/experiment/launch` | [src/routes/experiment.ts:25](../../../../src/routes/experiment.ts#L25) |
| R162 | GET (+ HEAD) | `/experiment/cmab/decide` | [src/routes/experiment.ts:32](../../../../src/routes/experiment.ts#L32) |
| R163 | GET (+ HEAD) | `/experiment/cmab/matrix` | [src/routes/experiment.ts:46](../../../../src/routes/experiment.ts#L46) |
| R164 | GET (+ HEAD) | `/experiment/scenarios` | [src/routes/experiment.ts:49](../../../../src/routes/experiment.ts#L49) |
| R165 | GET (+ HEAD) | `/experiment/:key/readout` | [src/routes/experiment.ts:54](../../../../src/routes/experiment.ts#L54) |
| R166 | GET (+ HEAD) | `/experiment` | [src/routes/experiment.ts:59](../../../../src/routes/experiment.ts#L59) |
| R167 | GET (+ HEAD) | `/signals/next` | [src/routes/signals.ts:24](../../../../src/routes/signals.ts#L24) |
| R168 | POST | `/signals/ingest` | [src/routes/signals.ts:49](../../../../src/routes/signals.ts#L49) |
| R169 | POST | `/live/api/page` | [src/routes/live.ts:361](../../../../src/routes/live.ts#L361) |
| R170 | GET (+ HEAD) | `/live/api/geo` | [src/routes/live.ts:479](../../../../src/routes/live.ts#L479) |
| R171 | POST | `/live/api/event` | [src/routes/live.ts:685](../../../../src/routes/live.ts#L685) |
| R172 | POST | `/live/api/events` | [src/routes/live.ts:728](../../../../src/routes/live.ts#L728) |
| R173 | GET (+ HEAD) | `/live/api/reflex` | [src/routes/live.ts:779](../../../../src/routes/live.ts#L779) |
| R174 | POST | `/live/api/experiment/launch` | [src/routes/live.ts:805](../../../../src/routes/live.ts#L805) |
| R175 | GET (+ HEAD) | `/live/api/experiment/status` | [src/routes/live.ts:849](../../../../src/routes/live.ts#L849) |
| R176 | GET (+ HEAD) | `/live/api/decisions/export` | [src/routes/live.ts:885](../../../../src/routes/live.ts#L885) |
| R177 | GET (+ HEAD) | `/live/ops-api/staged` | [src/routes/liveOps.ts:99](../../../../src/routes/liveOps.ts#L99) |
| R178 | POST | `/live/ops-api/propose/:itemNumber` | [src/routes/liveOps.ts:116](../../../../src/routes/liveOps.ts#L116) |
| R179 | POST | `/live/ops-api/approve/:itemNumber` | [src/routes/liveOps.ts:181](../../../../src/routes/liveOps.ts#L181) |
| R180 | POST | `/live/ops-api/reset` | [src/routes/liveOps.ts:231](../../../../src/routes/liveOps.ts#L231) |
| R181 | POST | `/live/ops-api/soldout/:itemNumber` | [src/routes/liveOps.ts:267](../../../../src/routes/liveOps.ts#L267) |
| R182 | POST | `/live/ops-api/restock/:itemNumber` | [src/routes/liveOps.ts:286](../../../../src/routes/liveOps.ts#L286) |
| R183 | GET (+ HEAD) | `/live/ops-api/occupants` | [src/routes/liveOps.ts:310](../../../../src/routes/liveOps.ts#L310) |
| R184 | GET (+ HEAD) | `/live/ops-api/state` | [src/routes/liveOps.ts:386](../../../../src/routes/liveOps.ts#L386) |
| R185 | GET (+ HEAD) | `/api-info` | [src/index.ts:135](../../../../src/index.ts#L135) |

## Per-family source effects and current boundary

Every endpoint ID above maps to one row below. “Reads” includes isolate caching where the called reader caches; upstream logger and any parent rate limiter apply separately. Potential effects are source-confirmed branches, not claims they occurred on a deployment.

| Endpoint IDs | Current authority / selectors | Destinations and possible effects |
|---|---|---|
| R001–R003 health | O; stamp-global | R001 reads CACHE, STORAGE.head and STATE_MANAGER health object, and writes an ANALYTICS point ([health.ts:20](../../../../src/routes/health.ts#L20)). R002/R003 return timestamp/readiness constants without those probes. GET/HEAD health is not uniformly pure. |
| R004–R014 auth | Login/refresh use their own account proof; R006–R008 J; R009–R014 A; account-wide, no tenant model | [auth.ts:59](../../../../src/routes/auth.ts#L59), [auth/store.ts:65](../../../../src/auth/store.ts#L65): D1 operator_accounts, operator_sessions and operator_audit read/write/delete. Login can migrate a legacy CACHE record and erase the legacy copy; failed login writes audit. Refresh may revoke disabled-account sessions. Logout/password/admin actions alter account/session/audit state. Authorization does not imply tenant-scoped administration. |
| R015–R024 generic API | J after rate-limit DO; caller-selected raw key/namespace | R015–R017 STORAGE get/put/delete; R018–R020 CACHE get/put/delete; R021 arbitrary EVENT_QUEUE submission; R022/R023 only STATE_MANAGER namespace `state`, caller-named object and key, rewritten internal /get and /set URLs ([api.ts:124](../../../../src/routes/api.ts#L124)); PUT body spread can supply the internal key. R024 only echoes query/not-implemented text, not an AE query. This mount does **not** directly expose SESSIONS, DB or every DO. Queue payload selection can still trigger ledger/scene consumer branches. RATE_LIMITER writes may occur even when J denies. |
| R025–R027 track | O; payload identifiers; no canonical tenant threaded into dispatcher | R025/R026 [EventDispatcher:87](../../../../src/services/EventDispatcher.ts#L87) posts to enabled WEBHOOK_ENDPOINTS destinations, queues event and possible retry envelopes, and route writes subject-bearing AE. Context adds IP/UA/referrer. R027 is static health. HTTP success/failure does not determine which preceding sink received data. |
| R028–R030 pixel | O; path-encoded recipient and query context | R028 GET/HEAD decodes event, dispatches external/queue and writes AE ([pixel.ts:17](../../../../src/routes/pixel.ts#L17)); GIF returned even on a caught failure. R029 constructs a pixel URL/encoded response, no store write; R030 static health. Generated anonymousId can overwrite decoded recipient in the index; recipient data can remain in payload. |
| R031–R035 webhooks | O except R032 conditional HMAC if secret exists; arbitrary event fields; no tenant authority | R031/R033/R034 dispatch event/retry envelopes and configured external requests plus AE ([webhook.ts:17](../../../../src/routes/webhook.ts#L17)). The body's signature field is not verified. R032 refreshes external Optimizely datafile and CACHE; no secret means signature check is skipped ([60](../../../../src/routes/webhook.ts#L60)). R035 static health. |
| R036–R043 Optimizely | Optional JWT R036/R039; J R040/R041; others O. Shared FX config; payload shopper/flag values | R036 decisions and R039 track can fetch/cache datafile, make SDK event egress and write subject AE. R037 fresh-client preview fetches datafile and can emit SDK decision events; R038 banner-rule GET calls privileged external FX reads when configured. R040/R041 initialize service and may fetch/cache; R042 returns in-memory datafile via getDatafile (no initialize call here); R043 static health. [OptimizelyService:50](../../../../src/services/OptimizelyService.ts#L50), [165](../../../../src/services/OptimizelyService.ts#L165), [routes:96](../../../../src/routes/optimizely.ts#L96). |
| R044–R051 CDP | Optional JWT globally; J R049; A R050. Context tenant + caller user/email/anonymous identifiers | TenantKV(CACHE) profiles/aliases/destination definitions; identify merges/writes profiles and forwards configured destinations; track may identify, queues cdp-track and forwards; profile/segments read those values; forward posts caller body to selected configured URL. R050 persists a destination config; R049 discloses destination definitions. R051 static health, still optional-JWT behavior. [CDPService:110](../../../../src/services/CDPService.ts#L110), [144](../../../../src/services/CDPService.ts#L144), [211](../../../../src/services/CDPService.ts#L211), [295](../../../../src/services/CDPService.ts#L295). |
| R052–R060 operator | W; R058–R060 additionally J; context tenant, default-scoped connector seams and stamp D1 | R052/R053/R054 seed audience CACHE before their main operation, including GET/HEAD list. Suggest runs connector; publish writes audience store and broadcasts via PERSONALIZATION_WEBSOCKET, potentially reading profiles/sessions. R055 bundled synthetic insights only. R056 deletes DB demo_events by source/demo and optional run/session/vuid, without tenant predicate. R057 counts that table. R058–R060 mutate scoped audience CACHE. [operator.ts:39](../../../../src/routes/operator.ts#L39), [112](../../../../src/routes/operator.ts#L112), [329](../../../../src/routes/operator.ts#L329), [AudienceStore:67](../../../../src/connectors/AudienceStore.ts#L67). Live audience/segment adapters are presently inert stubs, not proven external integrations. |
| R061–R067 config | R061–R064 O; R065–R067 J. Arbitrary validated ?scope, fallback default | CACHE reflex configuration current/revision/index reads; R064 with patch reads private current config, merges it and returns validated merged config. No durable write in validate. Full/partial write and rollback create revision/current/index writes and invalidate caches. Read route registration precedes write middleware; bodyless HEAD can still disclose through headers/timing and perform reads. [config.ts:108](../../../../src/routes/config.ts#L108), [versionedStore:226](../../../../src/config/versionedStore.ts#L226). |
| R068 sort | O; context tenant; caller userId/surface/candidates | Session host may create/refresh SESSIONS and load config CACHE; DO host calls SHOPPER_REFLEX snapshot. Returned candidate order is computed locally; no product-decision ledger enqueue is present. Registry/surface and consent/ownership remain cross-package issues. [sort.ts:51](../../../../src/routes/sort.ts#L51). |
| R069–R076 content | O GET/history/revision/validate; R069 HEAD J; R073–R076 J. ?scope chosen separately from tenant | CACHE catalog/slots/learn/priors current/history/revisions. Validate validates supplied candidate only: unlike config patch-validation, it does not merge stored content. PUT/rollback/import write versioned CACHE; import reads current catalog; pull first fetches caller URL then imports ([content.ts:167](../../../../src/routes/content.ts#L167), [import HttpJsonSource](../../../../src/content/import.ts)). Learn documents include dials/exploration/external settings; there is no separate mounted /dials route. |
| R077–R089 realtime | S; context tenant; user/session/cookie/surface selectors mostly supplied by caller | R077 upgrades SHOPPER_REFLEX or PERSONALIZATION_WEBSOCKET per REFLEX_HOST. R078 launches optional DB demo_events capture before host consent result, then session/DO ingestion, CACHE profiles/audiences, SESSIONS state, socket updates, REGION_TREND, ledger queue/AE and DECISION_RING/LEARN_STATS; configured ODP events/profiles/audience readback also reachable. R079/R080 GET/HEAD can create session state or touch DO snapshots/config; R081 deletes session/user keys and clears cookies; R082 updates session preferences and may asynchronously POST DO consent before session lookup; R083 session analytics reads caller session; R084 reads profile/segments; R085 assigns segment and updates profile/socket; R086/R087 read relay connection state, including singleton admin object; R088 performs relay/engine health reads; R089 synthesizes actions through engine. [realtime.ts:108](../../../../src/routes/realtime.ts#L108), [SessionManager:283](../../../../src/services/SessionManager.ts#L283), [odpLoop:266](../../../../src/services/odpLoop.ts#L266). |
| R090–R110 Meridian | O; visitor ID names MERIDIAN_REFLEX without canonical tenant prefix; vertical selects demo catalog; some receipt queries use context tenant | R090/R092/R101/R105/R108/R110 bundled data/pure response. R091/R100/R104/R109 can call Gemini (concierge/search/proposal/moment); source-specific memoization also applies. R093/R094 may read D1 census/warehouse/demographic sources or static cohort fixtures. R095 WebSocket; R096/R097/R098/R099 DO ingest/snapshot/vertical/reset, including DO storage, alarms and frame effects. R102 FX dispatch under its deployment gate plus memoization; R103 configuration-status read. R106 writes D1 mrd_decisions asynchronously; R107 exports them. [Meridian routes](../../../../src/demos/meridian/routes.ts), [receipts](../../../../src/demos/meridian/receipts.ts), [MeridianReflex:104](../../../../src/demos/meridian/MeridianReflex.ts#L104). |
| R111–R125, R127–R139 v1 diagnostics/learning/ledger | S; J on R116–R119,R121–R125,R127–R132,R135–R137. Path tenant with separate brand/slot/version/visitor/id selectors. R111–R115,R120,R133,R134,R138,R139 lack route J | Trend/lift/rows/slots/exploring read CACHE and sometimes R2 archives. Brands returns provisioned list plus path slug. Monitor GET reads CACHE; POST probes CACHE/SESSIONS/STORAGE/DB/LEARN_STATS and actual decisions, writes monitor CACHE/AE and can alert externally. Receipts/recent open DECISION_RING; receipts also reads tombstones/catalog. Cycle/proposal apply write config/proposal CACHE; rollup writes trend CACHE. Ledger/export/replay read R2/config snapshots and tombstones; erase/rewrite mutate tombstone/ledger/ring state. R133 reference model is pure supplied-input scoring, not a runtime model call. R134 lists R2 lift history. Reset/publish writes LEARN_STATS and published CACHE/R2 plus config revision for reset. POST report reads/folds records and writes R2 day report; custom overlays can replace canonical report (W33). Both report GETs lack J and read R2. [decisions.ts](../../../../src/routes/decisions.ts), [monitor:55](../../../../src/ops/monitor.ts#L55), [hourly:486](../../../../src/learn/hourly.ts#L486). |
| R126 content snapshot | S; path tenant/doc scope, context stateTenant, optional brand/session/page/visitor | GET/HEAD reads shopper SESSIONS or SHOPPER_REFLEX, CACHE documents/trend/lift, optional DECISION_RING; may create/refresh session, enqueue ledger+AE, fan ring and LEARN_STATS after response. Enabled external configuration can read CACHE table, invoke named Fetcher binding or arbitrary configured HTTP(S), or optional AI.run. No deployment-enforced model kill switch is established. Gamma zero does not stop all learning ingress/exploration. [content/service:93](../../../../src/content/service.ts#L93), [190](../../../../src/content/service.ts#L190), [ledger/enqueue:50](../../../../src/ledger/enqueue.ts#L50), [learn/fan:69](../../../../src/learn/fan.ts#L69), [external:62](../../../../src/learn/external.ts#L62). |
| R140–R146 identity | S; R142–R146 J; link assertion required only under configured identity-secret policy; path tenant | R140 links identity in SESSIONS; merges session state or SHOPPER_REFLEX state/forwarding and returns cookies. R141 clears client cookies only, not all server identity pointers. R142 computes salted account join IDs without a store write. R143/R144 read IdentityStore SESSIONS. R145 imports historical rows into identity/session or DO state. R146 erases discovered links/profiles/ledger through current incomplete lifecycle; its receipt explicitly says ODP deletion is not reached and must be performed separately. No ODP deletion call exists here. [identity routes](../../../../src/routes/identity.ts), [link:56](../../../../src/identity/link.ts#L56), [history:103](../../../../src/identity/history.ts#L103), [erase:66](../../../../src/identity/erase.ts#L66). |
| R147–R150 AI/scene | O; configured model key, supplied query/history/affinity/product/scene | R147/R148 model generation/stream with caller context and catalog. R149 R2 scene read. R150 R2 head, async EVENT_QUEUE scene enqueue; sync=true or queue rejection falls back to inline ASSETS reference-image read, Gemini HTTP request and R2 write. Same scene generation reachable through queue consumer. [aiScene:37](../../../../src/routes/aiScene.ts#L37), [sceneGen:75](../../../../src/services/sceneGen.ts#L75). |
| R151 shot | T; optional BROWSER; caller path/JS/click parameters | Browser session list/connect/launch, page navigation/script execution/screenshot. The comment says same-origin, but new URL(q.path, currentURL) itself accepts absolute URLs; do not treat that comment as a verified URL restriction. Browser can initiate further network and application actions. [shot.ts:34](../../../../src/routes/shot.ts#L34), [69](../../../../src/routes/shot.ts#L69). Hono logger executes before the shot token gate and may see its token-bearing query. |
| R152–R153 geo | O; edge geography or explicit query override | R152 returns request geography including precise fields. R153 reads D1 synthetic/cohort/census or configured source interface; warehouse adapter is not completed external warehouse delivery. [geo.ts:58](../../../../src/routes/geo.ts#L58), [geo/cohort:395](../../../../src/services/geo/cohort.ts#L395). |
| R154–R160 funnel/simulation | O; caller brand/cohort; R157 FX gate only | R154/R156 D1-backed funnel/diagnosis reads. R155 inserts DB demo_events (not controlled by realtime DEMO_EVENT_CAPTURE). R157 external FX audience create if enabled. R158/R159 insert simulated DB funnel_live rows; R160 deletes funnel_live. [funnel.ts:46](../../../../src/routes/funnel.ts#L46), [funnel/sim:85](../../../../src/services/funnel/sim.ts#L85). |
| R161–R166 experiment | O; context tenant; R161 FX gate for external write only | R161 uses TenantKV(CACHE) exp:key/index even when FX writes disabled or launch fails; enabled FX can create/activate external experiment entities. R162–R164 pure/bundled responses; R165/R166 CACHE experiment reads. [experimentRun:78](../../../../src/services/experimentRun.ts#L78), [110](../../../../src/services/experimentRun.ts#L110). |
| R167–R168 signals | O; CONNECTOR_MODE selects adapter | Mock GET returns latest isolate-memory signal/fixture; POST appends to module-local INGESTED array despite queued:true response. It does not send EVENT_QUEUE. Live adapter throws NotWiredError even when configuration fields exist. [SignalProvider:60](../../../../src/connectors/SignalProvider.ts#L60), [80](../../../../src/connectors/SignalProvider.ts#L80). |
| R169–R176 Bright Hour | O; body/query visitor; some branches use context tenant; R174 FX gate only | Page reads catalog CACHE/session or DO affinity, may emit FX impression and writes DB bh_decisions after response; geo reads cohort data. Event/batch schedule per-isolate visitor queues, then call realtime subrouter /action directly, bypassing parent auth/tenant middleware, with D1/SESSIONS/DO/queue/AE/ODP effects above and optional FX conversion. Reflex GET directly calls realtime /reflex without parent middleware, so context tenant is absent and downstream default/validation behavior matters; it must be measured rather than assumed isolated. Status can getAssignment and emit a first impression; export reads DB bh_decisions. [live.ts:426](../../../../src/routes/live.ts#L426), [577](../../../../src/routes/live.ts#L577), [632](../../../../src/routes/live.ts#L632), [785](../../../../src/routes/live.ts#L785), [experiment:467](../../../../src/demos/brighthour/experiment.ts#L467). |
| R177–R184 Bright Hour operator | O; stamp-global bh:offerdesk namespace | GET staged seeds/reset-writes CACHE if empty; propose calls Gemini or mock fallback and writes record; approve writes accepted metadata; reset deletes/reseeds desk; soldout/restock write/delete availability overrides; occupants/state read CACHE/config and compose/display. [liveOps:99](../../../../src/routes/liveOps.ts#L99), [offerDesk:1204](../../../../src/demos/brighthour/offerDesk.ts#L1204), [1310](../../../../src/demos/brighthour/offerDesk.ts#L1310). |
| R185 API info | O; stamp environment value | Returns advertised endpoint metadata, including /storefront as asset destination and /agents as separate dispatcher; those strings are not additional route registrations. |

## Generic Agents namespace/method/upgrade inventory

[routeAgentRequest](../../../../node_modules/agents/dist/index.js#L6281) supplies the agents prefix to [Partyserver:468](../../../../node_modules/partyserver/dist/index.js#L468). Partyserver splits/filter-removes empty URL segments, uses `/agents/:namespace/:name[/...]`, discovers every env object with idFromName, kebab-cases binding names and forwards the **original URL**. It does not consult AUTH_MODE. No app-supplied CORS option exists here, so there is no Agent-router early OPTIONS shortcut in this call. HTTP methods, HEAD and upgrades reach the DO directly, without Hono's HEAD/OPTIONS semantics. Doubled-slash alias behavior differs from Hono and requires runtime tests.

All nine bindings are declared in base, staging and production. “Forwarded” means namespace resolution/DO invocation is reachable, not that every DO internal endpoint is exposed.

| Binding / URL namespace | Current receiving behavior / possible destination effects |
|---|---|
| OpalAgent / opal-agent | Inherited AIChat/Agent HTTP and socket handling. Path ending in get-messages returns persisted messages without method check in [AIChat:383](../../../../node_modules/@cloudflare/ai-chat/dist/index.js#L383), so include POST/HEAD/OPTIONS, not only GET. Socket chat submit/persist/clear/cancel/resume/tool-result/tool-approval protocol affects Agent SQLite and streams; inherited state updates also exist. Configured chat invokes Gemini and tools: D1 queryData, funnel/geo reads and deployment-gated external FX writes. No app membership or tenant/name ownership gate; absence of a model key does not prevent message/state storage/read. Lexical queryData guard is not DB least privilege ([tools:26](../../../../src/agents/tools.ts#L26)); do not claim arbitrary callable methods bypass SDK callable rules. |
| RATE_LIMITER / rate-limiter | [fetch:10](../../../../src/durable-objects/RateLimiter.ts#L10) ignores path/method and parses caller JSON limit/window, writes counter and cleans old windows. Caller-selected name can coincide with /api IP quota object. Request body/runtime constraints affect which HTTP methods can reach this branch. |
| SHOPPER_REFLEX / shopper-reflex | Upgrade checked before pathname; requires query userId, accepts socket and action frames can run reducer/storage/learning/ODP branches. HTTP /agents/... does not match exact /ingest, /snapshot, /identity/*, /consent or /reset branches and returns 404. [ShopperReflex:240](../../../../src/durable-objects/ShopperReflex.ts#L240). |
| PERSONALIZATION_WEBSOCKET / personalization-websocket | Upgrade checked before pathname, query userId opens relay socket and persists connection state; frame/relay behavior remains reachable. Exact /broadcast, /connections and /health do not match unrewritten /agents/... HTTP paths. [relay:52](../../../../src/durable-objects/PersonalizationWebSocket.ts#L52). |
| MERIDIAN_REFLEX / meridian-reflex | Upgrade accepted before pathname, socket visitor/vertical attachment and subsequent action processing/alarms can mutate demo affinity. Exact /ingest,/snapshot,/vertical,/reset HTTP branches do not match /agents/... . [MeridianReflex:104](../../../../src/demos/meridian/MeridianReflex.ts#L104). |
| STATE_MANAGER / state-manager | Original agent path misses exact internal /get,/set,/delete,/list,/session/* dispatch; returns 404. It is still addressable/instantiable, not a directly working raw-store HTTP path here. The /api/state mount separately rewrites URL and does reach it. |
| REGION_TREND / region-trend | Original agent path misses exact internal /ingest,/snapshot,/reset; forwarded invocation is not proof of those mutations. [RegionTrend:32](../../../../src/durable-objects/RegionTrend.ts#L32). |
| DECISION_RING / decision-ring | Original path misses exact internal ring/outcome/recent/reset branches; 404. [DecisionRing:32](../../../../src/durable-objects/DecisionRing.ts#L32). |
| LEARN_STATS / learn-stats | Original path misses exact internal exposure/credit/snapshot/publish/reset branches; 404. [LearnStats:32](../../../../src/durable-objects/LearnStats.ts#L32). |

Existing direct shopper socket doors are R077 (/realtime/ws, S) and R095 (/meridian/api/ws, O). Generic /agents shopper/relay/Meridian paths are additional doors. Wrong-case Upgrade values, missing IDs, malformed frames, HTTP HEAD upgrading GET-derived Hono routes, WebSocket origin, name/query identity disagreement, reconnection and existing socket behavior after a future policy change are unexecuted acceptance cases.

## Binding and destination closure inventory

| Binding/destination | Source-declared boundary and uses | What a future denial must observe |
|---|---|---|
| CACHE KV | One binding per configured environment; raw API keys; TenantKV profiles/audiences/experiments; raw scope versioned documents; shared FX datafile; monitor/trend/lift; Bright Hour desk/availability/experiment memo. | Every attempted get/list/put/delete and exact logical+physical namespace; unchanged private values/version/index and no cache poisoning. |
| SESSIONS KV | Session/user pointers and IdentityStore keys; session host creation, preferences, linking, history and erasure. Not directly mounted by generic API. | No unauthorized creation/read/TTL renewal/forwarding/deletion; test both synthetic non-default namespaces and bare legacy/default keys. |
| STORAGE R2 | Raw API; ledger/tombstones/hour folds/reports; lift archive; scene objects. | Read/list/head as well as put/delete; object content/metadata/count/generation unchanged on denial. |
| EVENT_QUEUE | Raw submission, legacy dispatch/retry, ledger decisions/outcomes, AI scene jobs; one configured queue consumer. | No send/sendBatch or buffered retry on denied ingress; drain approved fixture waitUntil and consumers/alarms to prove no delayed destination effect. Existing queued work is a separate lifecycle/kill-switch problem. |
| ANALYTICS | Eight subject-bearing route writer sites (track twice, pixel, three webhook routes, Optimizely twice), plus ledger and health/monitor telemetry. Explicit dataset names absent in all three configurations. | No subject event on denied/consent-ineligible path; count/schema of authorized sanitized security audit separately. Naming omission does not attest deployed sharing or historic deletion. |
| DB D1 | Shared binding accessed by auth accounts/sessions/audit, demo_events, funnel_live, Meridian/Bright Hour decisions, census/catalog/cohort and Agent tools. | Query parameters/table scope and before/after rows; no protected subject/account/schema access through retained demo/tool path; no demo seed/reset from customer ingress. Never use real rows in tests. |
| Nine DO namespaces | As listed above; internal callers use scoped and singleton names. Region/ring/stats publish or alarm asynchronously; generic Agent dispatcher discovers bindings. | Namespace lookup, object name, fetch/RPC, storage/alarm/socket/frame changes and cross-brand broadcast; a 404 after object invocation is not zero dispatch. |
| ASSETS | Declared public file set; scene generation reads reference image via binding. Asset service can bypass user Worker. | Prohibited bytes unavailable on every asset alias/fallback; no unauthorized binding fetch. Source file omission and bound asset reachability both need checks. |
| BROWSER | Declared base and staging; no production browser block. Optional Env binding used by shot. | No session list/connect/launch/navigation/evaluation on denied requests; actual inherited/deployed binding state unverified. |
| Optional AI / configured Fetcher / HTTP model | Env declares optional AI; no AI or custom service binding block in checked manifest. External-model configuration can select URL or named Fetcher ([external:73](../../../../src/learn/external.ts#L73)); configured Geminis also serve demo/chat. | Zero run/fetch/model/tool call on withdrawn customer capability, including fallback and background paths; no inference allowed just because named “service.” |
| External HTTP destinations | Configured WEBHOOK_ENDPOINTS/CDP_ENDPOINTS; Optimizely CDN/admin/events; ODP events/profiles/GraphQL; model APIs; catalog pull URLs; Browser navigation; monitor alert URL. ODP deletion is a named unmet lifecycle obligation, not an implemented route call. Live connector stubs that only throw are marked above. | Request URL category, tenant identity and safe payload schema recorded by synthetic spies; zero outgoing request on denial, including retries and fallback. Destination configuration/name alone is not delivery/readback/erasure acceptance. |
| Isolate memory, logs and cookies | Config/lift/table/connector/SDK/memo caches; signals INGESTED; Bright Hour visitor chains/impression memo; DO/socket maps; global logger, handler/queue errors; Set-Cookie/session pointer behavior. | No forbidden mutation, later read contamination or old socket message; no credential/subject/body log before denial; approved minimal audit explicitly bounded. Cookie clearing alone does not erase server-side identity. |

Non-HTTP continuation is inside this boundary analysis: [index scheduled](../../../../src/index.ts#L189) runs monitor/fold/report/erasure per tenantConfig; autonomy/regional rollup also use a separate TREND_ROLLUP_TENANTS list. [index queue:254](../../../../src/index.ts#L254) routes kind=ledger to R2, kind=scene to model/ASSETS/R2, and logs/acks other bodies. These have no HTTP credential gate; future route containment cannot disable already queued jobs, alarms or scheduled work by implication. W03/W05/W07/W08/W09/W12/W34/W37 own relevant interfaces and lifecycle acceptance.

## Requirements and limits retained

Primary W01 customer trace is doc35 §4 §1.7 hard multi-brand isolation. Retained shopper/operator/data routes also support §1.1 first-party profiling, §1.2 audience controls, §1.4 tuning, §1.6 persistence, §1.8 exports/debug, §1.11 SFCC sort and §1.12 identity/history/warehouse sharing. Inventory does not prove those capabilities or waive §1.3 generic enrichment, §1.9 entitlement, §1.10 generic AI Search, conditional §2.3 optional widget handoff, or §3.2 customer milestone acceptance. Demo Offer Desk/chat/search cannot be relabelled as accepted generic customer delivery.

The [boundary matrix](boundary-matrix.md) proposes future rules and tests. D01 demo topology and D08 customer/brand/environment/region topology remain pending; per-customer stamp intent is retained, and no regional/residency or deployed-resource conclusion is inferred. This source inventory does not inspect credentials, customer data, remote hosts or account resources. Path normalization, assets/SPA routing, WebSocket/runtime behavior, cross-isolate/retry effects, historical destinations, quota/SLO, exact customer/browser/feed acceptance and business measurement remain unverified. Matching hashes or a complete route count does not close the perimeter.
