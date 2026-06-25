# 08 — OPAL Chat Build Plan (Cloudflare Agents SDK + Gemini)

_Last updated: 2026-06-25 · Owner: Solutions Architecture · Status: plan (pre-build)_

**Goal.** Add a **real, type-anything Opal chat** to the Coach storefront, built on the
**Cloudflare Agents SDK** chat-agent pattern, powered by a **strong model (Google Gemini)**,
with **tools** that (a) query a **D1** database (aggregate-then-reason) and (b) create
**REAL Optimizely flags/audiences/experiments via REST API** behind a human-approval gate.

**Honesty line (carries from the brief/ledger).** The chat and Gemini calls are **REAL**.
Optimizely creation is **REAL but token-gated**: with `OPTIMIZELY_API_TOKEN` present it writes
to a sandbox project; without it the same tool returns a clearly-labelled **dry-run** payload.
This preserves "real seams, mocked calls" while making the headline beats genuinely live.

> This doc is the **chat** plan. The **D1 schema + payment/purchase tables** and the
> **Optimizely REST surface** are separate parallel investigations; this plan consumes them
> via two tool implementations (`queryCoachData`, `optimizely.*`) and a `DB` binding.

---

## 1. TL;DR decisions (what we are building)

1. **Server:** one new Durable-Object-backed agent class `OpalChatAgent extends AIChatAgent<Env>`
   (from `@cloudflare/ai-chat`). It owns message persistence (SQLite), streaming over
   WebSocket, and the `streamText` **tool-calling loop**.
2. **Model:** **Gemini via the native AI SDK provider** `@ai-sdk/google`
   (`createGoogleGenerativeAI({ apiKey })` → `google('gemini-2.5-pro')`), passed straight into
   `streamText`. Optional: route through **Cloudflare AI Gateway** by setting `baseURL` for
   caching/observability/rate-limiting. (Not Workers AI — we want the strong external model.)
3. **Tool loop:** AI SDK v6 `streamText({ tools, stopWhen: stepCountIs(n) })`. Three tool
   classes: **server tools** (`execute`), **client tools** (no `execute`, resolved in browser),
   and **approval-gated tools** (`needsApproval`) — the latter is our **governance "Publish"
   beat** for Optimizely writes.
4. **Mount alongside Hono — no rewrite.** Keep the Hono app. In the Worker's default export,
   call `routeAgentRequest(request, env)` **first**; if it returns a Response, return it;
   otherwise fall through to `app.fetch`. Agent routes (incl. WebSocket upgrades) thus **bypass
   all Hono middleware**, so existing routes are untouched. Add `/agents/*` to
   `[assets].run_worker_first` so static-asset serving doesn't swallow agent traffic.
5. **UI:** a small **React "Opal island"** bundled by **esbuild** into `public/opal-chat.js`,
   mounted **only** into the new sidebar's **Opal tab** via `<div id="opal-root">`. It uses
   `useAgent` + `useAgentChat` (streaming, tool-approval UI, resumable streaming for free). The
   rest of the vanilla storefront is unchanged. (Plan B: vanilla `AgentClient` over WS — §9.)

---

## 2. How Cloudflare's chat-agent starter is structured (findings)

Verified against the live docs and the `cloudflare/agents-starter` repo (June 2026):

- **Scaffold:** `npm create cloudflare@latest -- --template cloudflare/agents-starter`. Produces
  a **Vite + React** app: `src/server.ts` (agent), `src/client.tsx` (React UI),
  `wrangler.jsonc`, `vite.config.ts`. ([quick-start])
- **Packages (current starter `package.json`):** `agents ^0.14`, `@cloudflare/ai-chat ^0.8`,
  `ai ^6` (AI SDK **v6**), `workers-ai-provider ^3.1`, `zod ^4`, `react/react-dom ^19`,
  `streamdown`, plus dev `@cloudflare/vite-plugin`, `@cloudflare/workers-types`,
  `wrangler 4.x`, `typescript 6`. ([agents-starter])
- **Server class:** `export class ChatAgent extends AIChatAgent<Env>` from `@cloudflare/ai-chat`.
  The one method you implement is **`onChatMessage(_onFinish, options?)`**; it builds a
  `streamText({...})` and returns `result.toUIMessageStreamResponse()`. `this.messages` is the
  persisted history (auto-managed, SQLite-backed); `pruneMessages`/`convertToModelMessages`
  shape it for the model. ([chat-agents API], [chat-agent example])
- **State + tools:** `AIChatAgent` extends the base `Agent` (Durable Object). Base `Agent`
  gives persistent `this.state`/`setState`, `this.sql`, `this.schedule`, `@callable()` RPC
  methods, and `this.mcp` (MCP client). Tools are passed to `streamText` as a `tools` object
  (AI SDK `tool({...})`). ([agents-api], [chat-agent example])
- **Client:** `useAgent({ agent: "ChatAgent" })` (from **`agents/react`**) opens the WebSocket;
  `useAgentChat({ agent, onToolCall })` (from **`@cloudflare/ai-chat/react`**) returns
  `{ messages, sendMessage, status, clearHistory, addToolOutput, addToolApprovalResponse, ... }`
  and manages the streaming lifecycle + tool approval UI. ([chat-agents API])
- **Routing:** default export `fetch` does `return (await routeAgentRequest(request, env)) ?? new Response("Not found",{status:404})`.
  Default URL pattern is **`/agents/{kebab-class}/{instance}`** (e.g. class `OpalChatAgent` →
  `/agents/opal-chat-agent/<id>`). ([routing])
- **Wrangler:** DO binding `{ name, class_name }` + migration **`new_sqlite_classes`** (Agents
  REQUIRE SQLite-backed DOs — not the older `new_classes`). Starter also sets
  `assets.run_worker_first: ["/agents/*","/oauth/*"]` so the SPA asset handler doesn't
  intercept agent/websocket paths. ([add-to-existing], [quick-start])

**Co-existence with our Worker is clean** because (a) the agent is just another DO class +
binding + migration tag, and (b) `routeAgentRequest` only claims the `/agents/*` prefix; every
other path still hits the Hono app. Our existing DOs (`StateManager`, `RateLimiter`,
`PersonalizationWebSocket`) use `new_classes` and are unaffected — the new agent gets its own
`new_sqlite_classes` migration tag (`v3`).

---

## 3. Wiring Gemini as the chat model

Recommended: **native AI SDK provider** (full tool-calling + streaming, model is a one-line swap).

```ts
// src/agents/model.ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Env } from "@/types/env";

export function getChatModel(env: Env) {
  const google = createGoogleGenerativeAI({
    apiKey: env.GEMINI_API_KEY,
    // OPTIONAL — route via Cloudflare AI Gateway for caching/observability/rate-limit/token spend:
    // baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/google-ai-studio/v1beta`,
  });
  // Strong model that matches Opal's underlying model. Swap id when Gemini 3 is enabled on the key.
  return google("gemini-2.5-pro");
}
```

- **Model id:** `gemini-2.5-pro` is the safe strong default (broad AI SDK v6 tool-calling
  support as of Jun 2026). `gemini-2.5-flash` is the cheap/fast option; `gemini-3-pro` /
  `gemini-3.1-pro` (thinking levels low/med/high) can be swapped in once confirmed on the
  user's key. ([ai-sdk-google], [gemini-models])
- **Secret:** `GEMINI_API_TOKEN`/`GEMINI_API_KEY` via `npx wrangler secret put GEMINI_API_KEY`
  (never in `wrangler.toml`).
- **AI Gateway option (recommended for the demo):** set `baseURL` to the `google-ai-studio`
  gateway endpoint so every Gemini call is logged, cached and rate-limited from the CF
  dashboard. Confirm the exact path suffix (`.../google-ai-studio/v1beta`) against the gateway
  docs before flipping it on. ([ai-gateway-google])
- **Alternatives (not recommended here):** Gemini's OpenAI-compatible endpoint via the `openai`
  provider with `baseURL: https://generativelanguage.googleapis.com/v1beta/openai/`; or
  `workers-ai-provider` for a CF-hosted model. We want the strong external model, so native
  `@ai-sdk/google` wins. ([using-ai-models])

---

## 4. The tool-calling loop (server)

`AIChatAgent.onChatMessage` is the entire loop — `streamText` runs the agentic cycle (model →
tool call → tool result → model → … up to `stopWhen`) and streams tokens + tool events to the
client over the WebSocket.

```ts
// src/agents/OpalChatAgent.ts
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { convertToModelMessages, pruneMessages, stepCountIs, streamText } from "ai";
import type { Env } from "@/types/env";
import { getChatModel } from "./model";
import { buildOpalTools } from "./tools";
import { OPAL_SYSTEM_PROMPT } from "./prompt";

export class OpalChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const result = streamText({
      model: getChatModel(this.env),
      system: OPAL_SYSTEM_PROMPT,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
      }),
      tools: buildOpalTools(this.env),
      stopWhen: stepCountIs(6), // bound the multi-step tool loop
      abortSignal: options?.abortSignal,
    });
    return result.toUIMessageStreamResponse();
  }
}
```

**The four tools** (`src/agents/tools.ts`):

```ts
import { tool } from "ai";
import { z } from "zod";
import type { Env } from "@/types/env";
import { optimizely } from "./optimizely-rest";

export function buildOpalTools(env: Env) {
  return {
    // (a) SERVER tool — aggregate-then-reason over D1 (never raw rows → solves the "Opal spins" beat)
    queryCoachData: tool({
      description:
        "Run ONE read-only aggregate SQL query over the Coach dataset " +
        "(customers, events, purchases, payments). Always GROUP BY/aggregate; never SELECT raw rows.",
      inputSchema: z.object({
        sql: z.string().describe("A single SELECT ... GROUP BY query"),
        maxRows: z.number().int().max(200).default(50),
      }),
      execute: async ({ sql, maxRows }) => {
        if (!/^\s*select/i.test(sql) || /;\s*\S/.test(sql)) return { error: "SELECT-only, single statement" };
        const out = await env.DB.prepare(sql).all();
        return { rows: (out.results ?? []).slice(0, maxRows) };
      },
    }),

    // (b) APPROVAL-GATED server tools — the governance "Publish" beat. Token-gated REAL writes.
    createOptimizelyAudience: tool({
      description: "Create a REAL Optimizely audience from a natural-language definition.",
      inputSchema: z.object({ name: z.string(), description: z.string().optional(), conditions: z.any() }),
      needsApproval: true,
      execute: async (input) => optimizely.createAudience(env, input), // dry-run if no OPTIMIZELY_API_TOKEN
    }),
    createOptimizelyFlag: tool({
      description: "Create a REAL Optimizely feature flag + variation.",
      inputSchema: z.object({ key: z.string(), name: z.string(), variables: z.record(z.any()).optional() }),
      needsApproval: true,
      execute: async (input) => optimizely.createFlag(env, input),
    }),
    createOptimizelyExperiment: tool({
      description: "Create a REAL A/B experiment that measures the new experience.",
      inputSchema: z.object({ name: z.string(), flagKey: z.string(), audienceId: z.string().optional() }),
      needsApproval: true,
      execute: async (input) => optimizely.createExperiment(env, input),
    }),

    // (c) CLIENT tool — no execute → resolved in the browser via useAgentChat onToolCall,
    //     drives the live storefront personalization beat.
    highlightStorefront: tool({
      description: "Tell the storefront to spotlight a personalized module for the demo.",
      inputSchema: z.object({ module: z.string(), reason: z.string() }),
    }),
  };
}
```

- **Approval flow:** `needsApproval: true` makes the model *propose* the write; the client shows
  Approve/Reject (`addToolApprovalResponse`) — the human Publish click. On approve, `execute`
  runs server-side and calls the Optimizely REST API. ([chat-agent example])
- **Token-gating:** `optimizely.*` (`src/agents/optimizely-rest.ts`) reads
  `env.OPTIMIZELY_API_TOKEN`; if absent it returns `{ dryRun: true, would: {...} }` so the beat
  still demos without a token. The REST shapes come from the Optimizely investigation
  (`docs/architecture/Optimizely-Experimentation-MCP-Server-Technical-Reference.md`).
- **Storefront link:** after a successful audience/flag create, reuse the existing
  `PersonalizationWebSocket` broadcast (`audience_published`) so the storefront reacts live —
  the chat does not need a new realtime channel.

---

## 5. Mounting alongside the existing Hono Worker

**Primary (recommended): wrap the default export.** Edit `src/index.ts`:

```ts
import { routeAgentRequest } from "agents";
import { OpalChatAgent } from "@/agents/OpalChatAgent";

// keep all existing DO exports + add the agent
export { StateManager, RateLimiter, PersonalizationWebSocket, OpalChatAgent };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Agent routes (HTTP + WebSocket) first — bypasses Hono middleware so upgrades stay clean.
    const agentResponse = await routeAgentRequest(request, env, { cors: true });
    if (agentResponse) return agentResponse;
    return app.fetch(request, env, ctx);
  },
  scheduled: /* unchanged */,
  queue: /* unchanged */,
};
```

Why this over `hono-agents`: our app has heavy global middleware (`timing`, `logger`,
`secureHeaders`, `cors`, plus `/api/*` rate-limiting). Routing the agent **before** Hono
guarantees WebSocket upgrades aren't mangled by middleware and existing routes are 100%
untouched. (Docs explicitly warn: return the agent response directly — wrapping it breaks
WebSocket connections.) ([add-to-existing])

**Alternative: `hono-agents` middleware** (`npm i hono-agents`) if you prefer it inside the Hono
pipeline: `app.use("*", agentsMiddleware({ options: { onBeforeConnect } }))` — but add it as the
**first** `app.use`, before the security/timing middleware. ([hono-agents])

**Wrangler additions** (`wrangler.toml`):

```toml
# bump for Agents SDK (docs: "set to today's date"); nodejs_compat already present
compatibility_date = "2026-06-25"

# --- new DO binding (name MUST equal class name for the router) ---
[[durable_objects.bindings]]
name = "OpalChatAgent"
class_name = "OpalChatAgent"

# --- agents require SQLite-backed DOs: NEW migration tag, do not edit v1/v2 ---
[[migrations]]
tag = "v3"
new_sqlite_classes = ["OpalChatAgent"]

# --- D1 (chat's queryCoachData tool) ---
[[d1_databases]]
binding = "DB"
database_name = "coach_personalization"
database_id = "<from: npx wrangler d1 create coach_personalization>"

# OPTIONAL — only if also using Workers AI (embeddings/fallback)
# [ai]
# binding = "AI"

# --- let the Worker handle agent paths before static assets ---
[assets]
directory = "public"
not_found_handling = "single-page-application"
run_worker_first = ["/agents/*"]
```

**Secrets** (never in toml): `npx wrangler secret put GEMINI_API_KEY` and
`npx wrangler secret put OPTIMIZELY_API_TOKEN`.

**Toolchain:** upgrade `wrangler` **3.114 → 4.x** (Agents SDK + `run_worker_first` need v4);
`@cloudflare/workers-types` to a 2026 build.

**`src/types/env.ts` additions:**

```ts
OpalChatAgent: DurableObjectNamespace;
DB: D1Database;
GEMINI_API_KEY: string;
OPTIMIZELY_API_TOKEN?: string;     // absent → tools run in dry-run
OPTIMIZELY_PROJECT_ID?: string;
// AI?: Ai;                        // only if [ai] binding enabled
// CF_ACCOUNT_ID?: string; AI_GATEWAY_ID?: string;  // only if AI Gateway baseURL used
```

---

## 6. Client UI — the "Opal island"

The storefront is **vanilla HTML/JS** (`public/storefront.{html,js}`, no bundler). The CF chat
UI is React. Bridge with a **self-contained React island** built by esbuild into `public/`,
mounted only in the new sidebar's **Opal tab**:

```tsx
// src/opal/client.tsx
import { createRoot } from "react-dom/client";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

function Opal() {
  const agent = useAgent({ agent: "OpalChatAgent" }); // → ws /agents/opal-chat-agent/<id>, same origin
  const { messages, sendMessage, status, addToolApprovalResponse, addToolOutput } = useAgentChat({
    agent,
    onToolCall: async ({ toolCall, addToolOutput }) => {
      if (toolCall.toolName === "highlightStorefront") {
        window.dispatchEvent(new CustomEvent("opal:highlight", { detail: toolCall.input }));
        addToolOutput({ toolCallId: toolCall.toolCallId, output: { ok: true } });
      }
    },
  });
  // render Coach-styled bubbles; render tool-approval parts with Approve/Reject → addToolApprovalResponse
  return /* ... Coach-branded chat ... */;
}
createRoot(document.getElementById("opal-root")!).render(<Opal />);
```

In `public/storefront.html` Opal tab: `<div id="opal-root"></div>` +
`<script type="module" src="/opal-chat.js"></script>`. The client tool dispatches a DOM event
the existing storefront JS listens for to spotlight modules — keeps the personalization engine
in vanilla JS, React only inside the panel.

esbuild script (no Vite needed):
`esbuild src/opal/client.tsx --bundle --format=esm --outfile=public/opal-chat.js --jsx=automatic --minify`.

---

## 7. Step-by-step build order

1. `npm i agents @cloudflare/ai-chat ai @ai-sdk/google zod react react-dom` and
   `npm i -D esbuild @types/react @types/react-dom`; upgrade `wrangler@^4` + workers-types.
2. `npx wrangler d1 create coach_personalization`; paste `database_id` into `wrangler.toml`
   (schema/seed land via the D1 investigation, binding `DB`).
3. `wrangler.toml`: bump `compatibility_date`, add the DO binding, migration `v3`
   (`new_sqlite_classes`), `[[d1_databases]]`, and `run_worker_first` (§5).
4. Add secrets: `GEMINI_API_KEY` (+ `OPTIMIZELY_API_TOKEN` when ready).
5. Create `src/agents/model.ts`, `prompt.ts`, `tools.ts`, `optimizely-rest.ts`,
   `OpalChatAgent.ts` (§3–4).
6. Edit `src/index.ts`: export `OpalChatAgent`, wrap fetch with `routeAgentRequest` (§5).
   Extend `src/types/env.ts`.
7. Create `src/opal/client.tsx`; add `build:opal` esbuild script; output `public/opal-chat.js`.
8. Wire the Opal sidebar tab in `public/storefront.html` (mount node + module script) and the
   `opal:highlight` DOM-event listener in `public/storefront.js`.
9. `npm run typecheck`; `npm run dev` (port 9100) → exercise: type a question → `queryCoachData`
   → an audience create → Approve → (dry-run or real) → storefront reacts.
10. `npm run build:opal && npx wrangler deploy`; re-test on
    `https://edge-platform.expedge.workers.dev/storefront`. Update `PROJECT_LEDGER.md`.

---

## 8. Risks / gotchas

- **`new_sqlite_classes`, not `new_classes`** — Agents need SQLite DOs; use a fresh tag `v3`,
  don't touch `v1/v2`.
- **`run_worker_first` for `/agents/*`** — without it the SPA asset handler can intercept the
  WebSocket/agent path.
- **Return the agent Response directly** — don't pass it through Hono middleware or you break
  WebSocket upgrades.
- **Binding name = class name** (`OpalChatAgent`) so `routeAgentRequest` resolves the namespace.
- **`compatibility_date` bump** can shift runtime behavior — smoke-test existing routes after.
- **`nodejs_compat`** already set (good — required by `agents`).
- **AI SDK is v6** (zod v4, `convertToModelMessages`/`pruneMessages`/`stepCountIs`); don't mix v4
  AI-SDK snippets.
- **Gemini tool-calling**: keep `stopWhen: stepCountIs(n)` bounded; prefer `gemini-2.5-pro` until
  Gemini 3 is confirmed on the key.
- **Token-gating must be explicit** in the dry-run payload so the demo never silently fakes a
  "real" Optimizely write.

---

## 9. Plan B — vanilla client (no React)

If we refuse a bundler: use `AgentClient` from `agents/client` (WebSocket) and parse the
UI-message-stream parts (text deltas, `tool-input-available`, `tool-approval-requested`,
`tool-output-available`) by hand to render bubbles + an Approve button. More code and more
edge-cases (you reimplement `useAgentChat`); only worth it to avoid React entirely. Server side
is identical.

---

## Sources

- Quick start — https://developers.cloudflare.com/agents/getting-started/quick-start/  [quick-start]
- Add to existing project — https://developers.cloudflare.com/agents/getting-started/add-to-existing-project/  [add-to-existing]
- Chat agent example — https://developers.cloudflare.com/agents/examples/chat-agent/  [chat-agent example]
- Chat agents API reference — https://developers.cloudflare.com/agents/api-reference/chat-agents/  [chat-agents API]
- Routing — https://developers.cloudflare.com/agents/api-reference/routing/  [routing]
- Using AI models — https://developers.cloudflare.com/agents/api-reference/using-ai-models/  [using-ai-models]
- Agents API (base Agent/state/tools) — https://developers.cloudflare.com/agents/runtime/agents-api/  [agents-api]
- `cloudflare/agents-starter` (package.json, src/server.ts, wrangler.jsonc) — https://github.com/cloudflare/agents-starter  [agents-starter]
- `@cloudflare/ai-chat` README — https://github.com/cloudflare/agents/blob/main/packages/ai-chat/README.md
- `hono-agents` — https://www.npmjs.com/package/hono-agents · https://github.com/cloudflare/agents/tree/main/packages/hono-agents  [hono-agents]
- AI SDK — Google Generative AI provider — https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai  [ai-sdk-google]
- `@ai-sdk/google` (npm) — https://www.npmjs.com/package/@ai-sdk/google
- Gemini models — https://ai.google.dev/gemini-api/docs/models  [gemini-models]
- AI Gateway — Google AI Studio provider — https://developers.cloudflare.com/ai-gateway/usage/providers/google-ai-studio/  [ai-gateway-google]
- Agents SDK v0.3.0 / AI SDK v6 changelog — https://developers.cloudflare.com/changelog/post/2025-12-22-agents-sdk-ai-sdk-v6/
</content>
</invoke>
