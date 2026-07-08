# API Reference — REST Endpoints (as-built)

**Status:** verified against code 2026-07-08 (every route confirmed mounted in `src/index.ts`). Supersedes the 2025 reference (preserved as [legacy-01-rest-endpoints-2025.md](./legacy-01-rest-endpoints-2025.md), which documented ~15 of the current ~75 endpoints and 3 endpoints that never existed).
**Companion:** [02-websocket-protocol.md](./02-websocket-protocol.md).

## Conventions

- **Base URL:** the worker origin (dev: `http://localhost:9100`).
- **Auth, honestly stated:** most endpoints are **open** (demo trust model). JWT (HS256, 15-min access / 7-day refresh) is required only on `/api/*`, `/auth/me`, `/auth/logout`, `/optimizely/experiments`, `/optimizely/features`, and `/cdp/destinations`.
- **Rate limiting:** only `/api/*` (100 req/min per IP, via the RateLimiter DO). Nothing else is rate-limited.
- **Env gates:** `GEMINI_API_KEY` (AI endpoints degrade/503 without it) · `OPTIMIZELY_WRITE_ENABLED` + `OPTIMIZELY_API_TOKEN` (FX writes return `created:false`/"stubbed" when off) · ODP creds (`ODP_API_HOST`+`ODP_PUBLIC_KEY` — the ODP loop silently no-ops without them) · `OPTIMIZELY_WEBHOOK_SECRET` (datafile webhook HMAC) · `DECISION_SOURCE`, `CONNECTOR_MODE`, `REFLEX_ENABLED`.
- **Honesty convention:** simulated payloads self-label (`simulated`, `_meta`, `dataSource` fields).
- **Dispatch order:** `/agents/*` is handled by the Agents SDK **before** Hono — it bypasses Hono middleware.

## Real-time personalization — `/realtime`

| Method & path | Purpose |
|---|---|
| `GET /realtime/ws?userId=` | WebSocket upgrade → per-shopper `PersonalizationWebSocket` DO (see [protocol](./02-websocket-protocol.md)) |
| `POST /realtime/action` | **The behavioral ingest.** Body `{type, userId, anonymousId?, sessionId?, data, source?, timestamp?}`; types: `product_view, add_to_cart, wishlist_add, page_view, button_click, email_open, form_submit, custom`. Runs the reflex, qualifies audiences (local ∪ reflex ∪ ODP), decides modules, captures to D1, **forwards the fact to ODP** off-path. Returns `{success, update?{data{segments, decisions, featureVariables, recommendations, sortOrder, journeyStage, affinity}}, sessionId, cookiesUpdated, odp?{receiptId,type,action,product_id}}` + `Set-Cookie` |
| `GET /realtime/personalization/:userId` | Cookie-session-aware personalization snapshot |
| `GET /realtime/reflex` | **Affinity snapshot** for the instrument: `{ok, now, config{tauMs,K,thetaIn,thetaOut,dims}, affinity{dims, audiences, changed, odpConfirmed}\|null}` (fresh-computed; scores decay at read) |
| `POST /realtime/session/reset` | "New shopper" — expires `opt_*` cookies + deletes the KV session |
| `POST /realtime/session/:sessionId/preferences` | `{trackingConsent?, personalizationEnabled?, cookieConsent?}` |
| `GET /realtime/session/:sessionId/analytics` | session analytics |
| `GET/POST /realtime/segments/:userId` | read / manually assign (`{segment, source?}`) |
| `GET /realtime/health` | engine + WS DO check |

Cookies: `opt_session_id` (HttpOnly), `opt_user_id`, `opt_segments`, `opt_engagement_score`.

## AI — `/ai`, `/ai/scene` (Gemini)

| Method & path | Purpose |
|---|---|
| `POST /ai/search` | `{query, limit?, affinity?}` → `{ok, intent, productIds[], hero, tookMs, source:'gemini'\|'fallback'}` — intent parse + deterministic catalog rank; also yields the Edit-hero copy/scene context |
| `POST /ai/concierge` | `{messages[], affinity?, avoidIds?}` → **plain-text stream** ending `PICKS: <id>,…` (grounded to real catalog ids) |
| `POST /ai/scene` | `{productId, sceneId?, type?, sceneContext, aspect?, sync?}` → `{ok, status:'ready'\|'queued', url, cached?}` — async via Queue → Gemini image → R2 |
| `GET /ai/scene/:productId/:sceneId` | serve the cached JPEG (404 until generated) |

## Optimizely — `/optimizely`, `/webhook`

| Method & path | Purpose |
|---|---|
| `POST /optimizely/decisions` | `{userId, userAttributes?, experiments?, features?}` → decisions + segments |
| `POST /optimizely/preview` | fresh no-store `decide()`; supports forced `variationKey` — the storefront's preview path |
| `GET /optimizely/banner-rules` | live `personalized_banner` cascade (`[]` without FX token) |
| `POST /optimizely/track` | event tracking (mock-safe) |
| `GET /optimizely/datafile` | current datafile |
| `GET /optimizely/experiments` · `GET /optimizely/features` | **JWT required** |
| `POST /webhook/optimizely-datafile` | datafile-change webhook; HMAC `X-Hub-Signature` verified when `OPTIMIZELY_WEBHOOK_SECRET` set → refreshes the KV datafile cache |
| `POST /webhook/optimizely` · `/webhook/segment` · `/webhook/custom` | generic inbound webhooks |

## Operator — `/operator` (two-call governance: suggest → publish)

| Method & path | Purpose |
|---|---|
| `POST /operator/audiences/suggest` | `{nlPrompt}` → drafted audience (nothing goes live) |
| `POST /operator/audiences/publish` | `{audience}` → publish + WS-notify qualifying connected shoppers → `{audienceId, notifiedUsers}` |
| `GET /operator/audiences` | published audiences (seeded + catalog-generated + Opal-created) |
| `GET /operator/insights` | synthetic ODP aggregate views |
| `POST /operator/events/reset` | `{scope:'all'\|'run'\|'session'\|'vuid', value?}` — wipes **only** `demo_events` |
| `GET /operator/events/stats` | demo-event counts |

## Experimentation — `/experiment`, `/funnel`

| Method & path | Purpose |
|---|---|
| `POST /experiment/launch` | launch a scenario (A/B · MAB · CMAB); real FX rule when writes enabled, simulated readout otherwise |
| `GET /experiment/cmab/decide` | contextual decide (query params = context attributes) |
| `GET /experiment/cmab/matrix` · `GET /experiment/scenarios` · `GET /experiment/:key/readout` · `GET /experiment/` | CMAB matrix, scenario presets, readouts, list |
| `GET /funnel?brand=&cohort=` · `GET /funnel/diagnose` | funnel metrics + diagnosis |
| `POST /funnel/event` | checkout-stage events → D1 (never blocks checkout) |
| `POST /funnel/audience` | create a **real** FX audience — gated by `OPTIMIZELY_WRITE_ENABLED` |
| `POST /funnel/sim/tick` · `/burst` · `/reset` | **demo/presenter traffic simulator — internal** |

## Signals & geo — `/signals`, `/geo`

| Method & path | Purpose |
|---|---|
| `GET /signals/next` | next social signal — fixture + **real** edge-geo overlay; self-labels `simulated:true` |
| `POST /signals/ingest` | partner-feed seam (501 + NotWired in live mode until a feed is contracted) |
| `GET /geo` | edge geolocation (country/region/city/zip/season…) |
| `GET /geo/cohort?zip=&region=…` | geo-cohort cold start (params = labeled QA override); curation only, never pricing |

## Eventing — `/track`, `/pixel`, `/cdp`

`POST /track/event` (zod-validated, enriched, dispatched) · `POST /track/batch` · `GET /pixel/track/:pixelId` (1×1 GIF) · `POST /pixel/generate` (returns `htmlTag`) · `/cdp/*` (mock CDP identify/track/forward; `GET /cdp/destinations` JWT).

## Opal chat — `/agents/*`

`/agents/opal-agent/:sessionName` — Cloudflare Agents SDK WebSocket protocol to the per-session `OpalAgent` DO (SQLite-backed, Gemini). Tools (server-side): `queryData` (allow-listed read-only D1, LIMIT 200), `createOptimizelyAudience`, `createFlag`, `targetMessageToAudience`, `launchExperiment`, `diagnoseFunnel`, `geoCohort` — write tools return `status:'stubbed'` unless `OPTIMIZELY_WRITE_ENABLED`.

## Auth & platform (mostly internal)

`POST /auth/login|register|refresh|logout` · `GET /auth/me` — demo JWT.
**Internal / exclude from partner docs:** `/api/*` (infra CRUD over R2/KV/Queue/DO; JWT + rate-limited; `/api/analytics/query` is a stub) · `/health*` · `GET /api-info` (self-description — currently stale, flagged for code fix) · `/realtime/connections*` · `POST /realtime/demo/trigger` (bank-demo scenarios) · `/funnel/sim/*` · **`GET /__shot`** (Browser Rendering screenshot verification) · Durable Object internal endpoints (`/broadcast`, `/connections` on the WS DO; StateManager `/get|/set|…`; RateLimiter POST).
