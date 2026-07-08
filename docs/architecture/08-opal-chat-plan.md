# Opal Chat (as-built)

**Status:** as-built, verified 2026-07-08. Supersedes the June plan (preserved at [legacy/08-opal-chat-plan-2026-06.md](./legacy/08-opal-chat-plan-2026-06.md)) — the architecture shipped as planned (AIChatAgent DO + Gemini + agent-first routing + esbuild island); names, tools, and governance evolved.

---

## 1. Architecture

- **`OpalAgent`** (`src/agents/OpalAgent.ts`) extends `AIChatAgent` from `agents/ai-chat-agent` — a **SQLite-backed Durable Object** (wrangler migration v3). The `@cloudflare/ai-chat` package serves only the React island side.
- **Routing:** `routeAgentRequest(request, env)` runs **before** Hono in the worker's fetch (`src/index.ts:110-114`) — `/agents/*` never touches Hono middleware; the plan's `run_worker_first` proved unnecessary.
- **Island:** `island/opal-chat.tsx` → `scripts/build-island.mjs` (esbuild, IIFE, minified) → `public/opal-chat.js`, mounted in the storefront's Opal tab.
- **Session isolation (do not remove):** the island passes a per-browser `name` from `localStorage` (`opal-session-id`) to `useAgent({agent:'opal-agent', name})` → one DO per presenter. Omitting `name` routes everyone to a single shared "default" DO (the crossover bug, fixed 2026-06-28).

## 2. Model & loop

Gemini **`gemini-2.5-flash`** by default (`GEMINI_MODEL` override), Vercel AI SDK `streamText` with `stepCountIs(5)` tool loop, streamed via `createUIMessageStream`. The system prompt encodes: the queryable D1 schema, funnel-diagnosis guidance, geo-cohort rules, and **present-tense Signal-Led-Moment narration** (fresh thread per moment run — never "already live").

## 3. Tool catalog (as-built names + gating)

| Tool | Does | Gate |
|---|---|---|
| `queryData` | read-only D1 `SELECT` — table allow-list (`v_audience_base`, `coach_*`, `demo_events`, `geo_census`, `geo_xref`, `meta_attribute_catalog`…), single statement, forced `LIMIT 200` | none (read-only) |
| `createOptimizelyAudience` | real FX audience via REST | write gate |
| `createFlag` | creates **and enables** a real FX flag live | write gate |
| `targetMessageToAudience` | cascading rule on the shared `personalized_banner` flag | write gate |
| `launchExperiment` | scenario presets (A/B · MAB · CMAB incl. `tiktok_tabby_moment`) + copy overrides | write gate |
| `diagnoseFunnel` | funnel drop-off diagnosis over D1 | none |
| `geoCohort` | geo-cohort inspection | none |

**Governance (as-built):** the env **write gate** — `OPTIMIZELY_WRITE_ENABLED === 'true'` + `OPTIMIZELY_API_TOKEN` — replaces the plan's per-call `needsApproval` UI. When off, write tools return a full plan payload with `status:'stubbed'` (the "dry-run" concept, kept). Status vocabulary: `stubbed` · `created` · `live` · `error`.

## 4. Storefront bridges

The island dispatches window events the storefront listens for: **`opal:ask`** (`{text, fresh:true}` — fresh thread per moment run) and **`opal:experiment` / `opal:experience`** (preview the just-created object). **Live-gate rule (hard-won):** tool-call side-effects fire **only after a message is sent in this session** — the DO replays its persisted thread on every load, and ungated replay re-triggered historical launches (the takeover-hijack bug). Any future Opal-tool → DOM effect must respect the live-gate.

## 5. Ops

Secrets: `GEMINI_API_KEY` (required), FX write pair for live creation. Datafile note: after a `createFlag`/`launchExperiment`, storefront visibility follows datafile propagation — the webhook (`POST /webhook/optimizely-datafile`) + no-store preview fetch make the reveal event-driven. D1 binding: `coach-demo-db`.
