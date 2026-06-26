# MEMO — Parallel Build: A/B + CMAB ⟂ Revenue Radar

**To:** A/B Testing + CMAB workstream
**From:** Revenue Radar workstream
**Re:** How we build side-by-side without colliding — Tapestry demo, **Mon 2026-06-29**
**Date:** 2026-06-26

---

## 1. The situation (30 seconds)

We're shipping two features into the **same** Cloudflare Workers + Hono storefront for Monday:

- **You:** A/B testing + **CMAB** decision logic + the **Engine-tab** readouts.
- **Us (Revenue Radar):** a real checkout funnel + an Opal-driven *"find the revenue leak → launch the fix"* loop.

They barely overlap **if** we follow the rules below. The only real coupling is **one function** (§5). Full design is in `docs/REVENUE-RADAR-TDD.md` — please skim **§11 (Parallel-work plan)**.

**Golden rule:** put substantial work in **new files you own**; touch the shared monolith only at a few additive hook-points.

---

## 2. You own — build freely

- **CMAB decision service** — new files under `src/services/` (e.g. `src/services/cmab*.ts`).
- **Experiment creation** — extend `src/services/optimizelyFx.ts` *(coordinate — see §4)* or add a new file.
- **Engine-tab readouts** in the storefront — `showAbReadout` / `showMab` / `showCmab` / `scrollEngineTo`, the engine `<section>` markup, and **beats 11–13**. This region is yours.
- **Your Opal tools** — `src/agents/tools/experiment*.ts`.
- **Your migration(s)** — use `0004_*.sql` and up (we've taken `0003_funnel_seed.sql`).

## 3. We own — please don't edit

- `migrations/0003_funnel_seed.sql`, `src/routes/funnel.ts`, `src/services/funnelCompute.ts`, `src/services/funnelSim.ts`, `src/agents/tools/diagnoseFunnel.ts`
- **`public/revenue-radar.js`** (new) — our checkout flow, funnel viz, BNPL save, simulator client
- Our beats live in a fenced `/* ===== REVENUE RADAR BEATS ===== */` block in `storefront.js`

---

## 4. The rules (how we don't collide)

1. **Branch:** work on **`feature/ab-cmab`** off the shared base. Don't commit to our branch. Merge to the integration branch **daily**, smallest changes first.
2. **`storefront.{js,html}` — stay in your zone.** Edit only the Engine-tab region. If your additions exceed a few hook lines, **extract to your own `public/ab-cmab.js`** that attaches to `window.store` (mirror what we do with `revenue-radar.js`). Fence any in-place edits: `/* ===== A/B + CMAB (owner: <you>) ===== */`. Don't touch our fenced block.
3. **`OpalAgent.ts` — one tool per file.** Put tools in `src/agents/tools/`; the agent file only gets your additive `import` + `register` lines.
4. **`src/index.ts`** — **append** your route mounts at the end of the mount block. **Do not reorder or remove existing mounts** (we lost `/operator` to a dropped mount once — keep them all).
5. **Migrations are additive** — next free number (`0004+`), never edit ours.
6. **`wrangler.toml` / `package.json`** — ping us before adding a binding or dependency so we don't both edit it.

---

## 5. The ONE integration seam

Our Opal "Launch" button (Revenue Radar) calls **your** experiment engine to turn a recommended audience into a live experiment:

```ts
launchExperiment({ audienceId, variations, metric }) → { experimentId, readoutUrl }
```

- Please implement to this signature (or propose your own and send it back — §6).
- Your **Engine-tab readout** should be able to render a result for an experiment created this way, so the loop closes on screen.

That's the *entire* coupling between our two features. Build to it blind; it composes at merge.

---

## 6. Send us back (async — does NOT block either of us)

1. Your **`launchExperiment` signature** (or equivalent).
2. The **`demo_events` `event_type` names you emit**, so we don't clash.

### Event taxonomy (claimed)

| Owner | `event_type` values |
|---|---|
| Revenue Radar (us) | `add_shipping_info`, `add_payment_info`, `purchase`, `checkout_*` |
| A/B + CMAB (you) | _your call_ — suggest `variation_assigned`, `conversion`, `experiment_view` |

Pick non-overlapping names and we're clear.

---

## 7. Honesty tiers (carry into every number you show)

- A/B / MAB / CMAB results are shown with **clearly-labeled illustrative numbers** — the Optimizely capability is GA; the demo *simulates* the outcome.
- **Do not** claim proven lift on Tapestry's real production traffic. Measurement apparatus is real; the numbers are demo data until it runs on their site.

---

## 8. Project guardrails (don't trip these)

- **Never run `npm ci`** — use `npm install` (add `--legacy-peer-deps` if needed). Don't restore `.npmrc.bak`. Don't add `@optimizely/*` private packages.
- **Secrets** live in `llm-models-keys.md` (gitignored) + `.dev.vars` — never commit or echo secret values.
- **Don't commit/push** unless asked.
- `/__shot` (the Browser-Rendering screenshot route) is **internal verification only** — handy for eyeballing your readouts (`/__shot?path=/storefront&js=...&clip=#ab-readout`), but it must be gated/removed before any production use.
- Deploy with `npm run deploy`; prod is `https://edge-platform.expedge.workers.dev/storefront`.

---

## 9. Quick start

1. Read `docs/REVENUE-RADAR-TDD.md` §11 + this memo.
2. Branch `feature/ab-cmab`.
3. Send us the two items in §6.
4. Build your CMAB service + Engine readouts in your own files / your zone.
5. Implement `launchExperiment(...)` to §5.
6. Daily merge to the integration branch.

Questions → ping the Revenue Radar workstream. Let's go. 🚀
