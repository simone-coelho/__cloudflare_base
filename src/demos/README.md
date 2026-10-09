# Demos — where each one actually lives

**Start with [`docs/demos/BOOTSTRAP.md`](../../docs/demos/BOOTSTRAP.md).** This page only maps the code.

Only three of the six demos live in this directory. The other three do not, and that is by design.

| Demo | Code | Worker | Engine |
|---|---|---|---|
| **The Bright Hour** (QVC, live shopping) | [`brighthour/`](brighthour/README.md) — catalog, offer lifecycle, demo clock, reflex config; routes in `src/routes/live.ts`, `liveOps.ts`; page in `public/live/` | shared `edge-platform` | Generation 1, via `registry.ts` |
| **Meridian** / on screen **Calder** (Opticon) | [`meridian/`](meridian/README.md) — self-contained by charter; page in `public/meridian/` | shared `edge-platform` | Generation 1 fork, importing only the pure math |
| **Coach / Tapestry** | the repository's core: `src/reflex/`, `src/services/`, `src/agents/`, `src/routes/`; page in `public/storefront.*` | shared `edge-platform` | Generation 1 |
| **First National Bank** | `public/visual-demo.*` | shared `edge-platform` | Generation 1 |
| **Top Offers** (QVC, Lantern & Lane) | `public/top-offers/`, `src/routes/topOffers.ts`, `scripts/seed-shn.mjs`, `scripts/lib/shn-promotions.mjs` | **its own** `edge-platform-top-offers` | **Generation 2** — the content decision service |
| **Vantage** (Verizon, carrier) | `public/vantage/`, `vantage.config.ts` here, thin mounts in `src/routes/vantage.ts` and `vantageColdStart.ts` built by `kit/`, `scripts/seed-vantage*.mjs` | **its own** `edge-platform-vantage` | **Generation 2**, on the demo kit |

Top Offers is not here because it is not a demo fork: it runs on the product engine (`src/content/`,
`src/routes/decisions.ts`), and its only demo-specific server code is the route that applies a named beat.

`registry.ts` is the one shared seam for Generation 1 surfaces. An unrecognised surface resolves to `coach`
**silently**, which is why Meridian deliberately stays out of it (`meridian/README.md`, rule 2).

**Before deploying anything:** the shared worker runs commit `26e2db1` and is deployed only with
`bash scripts/deploy-legacy-demos.sh --deploy`. Plain `npx wrangler deploy` from the repo root ships today's code
onto it and breaks Coach, Bright Hour and Meridian. See `AGENTS.md` → "The two demo workers".

## The demo kit (`src/demos/kit/`, 2026-10-01)

Generation 2 demos share one chassis. `kit/actionRoutes.ts` builds a demo's `/beat`, `/reset`, `/receipt` and `/report` routes from a config (tenant, operator, the closed list of beat names, the reset list, the report slots, the asserted context names, the beats path); `kit/coldStartRoutes.ts` builds the cold-start route (region resolve, census, seed prior, estimate) the same way; `kit/helpers.ts` holds the pure helpers. A demo is a config file beside this directory (`vantage.config.ts` is the first) plus a thin mount in `src/routes/`. The authority model is unchanged: demo routes mount only under the demo deployment profile, accept a closed set of names and no caller-supplied document, mint short-lived operator authority and re-enter the ordinary pipeline. The design and the lanes are in `docs/demo-kit/Demo-Kit-Design.md`. Top Offers (`src/routes/topOffers.ts`) predates the kit and is left as it is.
