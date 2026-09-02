# Deployment (as-built)

**Status:** verified 2026-07-08. This directory was empty until now; this doc is the deploy source of truth.

## The one safe path

```bash
npm run deploy        # = wrangler deploy → worker "edge-platform" (the live demo)
```

Deploys `src/index.ts` with **all bindings** (KV `CACHE`+`SESSIONS`, R2 `STORAGE`, D1 `coach-demo-db`, Queue `events`, 4 Durable Objects, Browser Rendering, Analytics Engine, assets from `public/`).

## Staging (CW10) — the customer-facing lower environment

`[env.staging]` in `wrangler.toml` is declared **in full**: its own KV, R2, D1, queue, Durable Object
bindings, Analytics Engine, browser rendering and assets. Named environments inherit nothing in Wrangler,
so this duplication is what gives staging hard isolation from the demo worker.

Provision once, then deploy:

```bash
bash scripts/provision-staging.sh   # creates the resources, fills the ids, applies D1 migrations,
                                    # prompts for secrets, seeds an operator login
bash scripts/deploy.sh staging      # builds the Meridian engine and the SDK, then wrangler deploy --env staging
```

`deploy.sh staging` refuses to run while a `<staging-…>` placeholder remains in `wrangler.toml`.

**What is different in staging.** `AUTH_MODE = "enforced"`:

| Surface | Open (default worker) | Enforced (staging) |
|---|---|---|
| `POST /realtime/action`, `GET /realtime/ws`, `GET /realtime/reflex` | no key | `X-SDK-Key` header, or `?sdkKey=` on the socket upgrade |
| `GET /v1/:tenant/decisions/snapshot` | no key | a key registered for that tenant (or a `*` key) |
| `/operator/*` writes | no token | `Authorization: Bearer <JWT>` from `POST /auth/login` |
| `/config/*` writes | JWT, always | JWT, always |
| CORS | reflects any origin | only `CORS_ORIGINS` and the page's own origin |

The SDK sends the key on every request once `createClient({ sdkKey })` is set. The operator token comes
from `POST /auth/login` with the email and password `provision-staging.sh` seeded; paste it into the tuning
UI's token field.

## ⚠️ Production (do not use `--env production` yet)

`[env.production]` still declares **only a name**, so `wrangler deploy --env production` would ship a
worker with no bindings. `scripts/deploy.sh production` refuses. Declare it the way staging is declared,
with its own resources, before it is used.

## Secrets & vars

- Local: `.dev.vars` (gitignored). Remote: `wrangler secret put <NAME>`.
- Names (never commit values): `GEMINI_API_KEY` (required for AI surfaces), `ODP_PUBLIC_KEY` (enables the live ODP loop with `ODP_API_HOST`, which is a var), `OPTIMIZELY_API_TOKEN` + `OPTIMIZELY_WRITE_ENABLED` (FX writes), `OPTIMIZELY_WEBHOOK_SECRET` (datafile webhook HMAC), optional `GEMINI_MODEL`/`GEMINI_IMAGE_MODEL`, `SIGNAL_API_HOST/KEY`.
- Plain vars in `[vars]`: `ENVIRONMENT`, `CONNECTOR_MODE`, `DECISION_SOURCE`, `ODP_API_HOST`, `OPTIMIZELY_SDK_KEY` (deliberately non-secret), JWT settings.
- CW10 additions: `AUTH_MODE` (var: `open` | `enforced`), `CORS_ORIGINS` (var, comma-separated, `*.example.com` allowed), `SDK_KEYS` (**secret**, `tenant:key[|key2],tenant2:key3`; tenant `*` accepts the key anywhere).

## Database

Apply migrations then seeds (local and remote):

```bash
npx wrangler d1 migrations apply coach-demo-db --remote
for f in migrations/seed/seed_*.sql; do npx wrangler d1 execute coach-demo-db --remote --file "$f"; done
```

## Durable Object migrations

Tags v1–v3 in `wrangler.toml` (`StateManager`/`RateLimiter` → `PersonalizationWebSocket` → `OpalAgent` as a **SQLite class**). New DO classes (e.g. the planned `ShopperReflex`) require a new migration tag — never edit past tags.

## Build & dev

`npm run dev` (port 9100) · `npm run build:island` (esbuild → `public/opal-chat.js` — `npm run build` is a no-op echo) · tests: `npx vitest run src/reflex --environment node`.

## Post-deploy check

`GET /health` (services block), `/storefront.html` loads, `GET /realtime/reflex` returns config, and — with ODP creds — a `product_view` action returns an `odp` receipt.
