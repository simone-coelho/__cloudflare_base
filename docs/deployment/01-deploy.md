# Deployment (as-built)

**Status:** verified 2026-07-08. This directory was empty until now; this doc is the deploy source of truth.

## The one safe path

```bash
npm run deploy        # = wrangler deploy → worker "edge-platform" (the live demo)
```

Deploys `src/index.ts` with **all bindings** (KV `CACHE`+`SESSIONS`, R2 `STORAGE`, D1 `coach-demo-db`, Queue `events`, 4 Durable Objects, Browser Rendering, Analytics Engine, assets from `public/`).

## ⚠️ The `--env` landmine (do not use yet)

`wrangler.toml` declares `[env.production]` → `edge-platform-prod` and `[env.staging]` → `edge-platform-staging` **with only a `name`** — named envs do **not inherit** bindings or vars in Wrangler. `wrangler deploy --env production|staging` therefore ships a worker with **no KV/R2/D1/DO/Queues/vars**. The README and `scripts/deploy.sh` still recommend this path (and `deploy.sh` uses removed wrangler-v3 `kv:key` syntax) — both are flagged for fix. **Until per-env bindings are duplicated in `wrangler.toml`, deploy only via `npm run deploy`.**

## Secrets & vars

- Local: `.dev.vars` (gitignored). Remote: `wrangler secret put <NAME>`.
- Names (never commit values): `GEMINI_API_KEY` (required for AI surfaces), `ODP_PUBLIC_KEY` (enables the live ODP loop with `ODP_API_HOST`, which is a var), `OPTIMIZELY_API_TOKEN` + `OPTIMIZELY_WRITE_ENABLED` (FX writes), `OPTIMIZELY_WEBHOOK_SECRET` (datafile webhook HMAC), optional `GEMINI_MODEL`/`GEMINI_IMAGE_MODEL`, `SIGNAL_API_HOST/KEY`.
- Plain vars in `[vars]`: `ENVIRONMENT`, `CONNECTOR_MODE`, `DECISION_SOURCE`, `ODP_API_HOST`, `OPTIMIZELY_SDK_KEY` (deliberately non-secret), JWT settings.

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
