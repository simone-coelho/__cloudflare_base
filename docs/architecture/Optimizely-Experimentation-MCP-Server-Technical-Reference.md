# Optimizely Experimentation MCP Server — Technical Capability Reference

**Audience:** Software architects & engineering team building a personalization engine that integrates with Optimizely
**Purpose:** Establish a shared, detailed understanding of what the Optimizely Experimentation MCP server is, what it can and cannot do, how an agent communicates with it, and the practical constraints that affect architecture decisions.
**Scope:** This is a capability/technical-understanding document, *not* an end-user setup guide. Sources are Optimizely's official support documentation plus corroborating field reports from practitioners (May 2026).

---

## 1. Executive summary (read this first)

The Optimizely Experimentation MCP server is a **hosted, remote MCP server** operated by Optimizely. It exposes Optimizely Experimentation (both **Web Experimentation** and **Feature Experimentation**) to any MCP-compatible AI client as a small set of structured, AI-callable tools. An agent uses it to **query** experimentation data, **manage** (create/update/archive) experimentation entities, and get **implementation help** (SDK docs + code generation) — all driven by natural language, no hand-written API scripts required.

For your personalization-engine project, the three load-bearing facts are:

1. **It can create and manage audiences, flags, and experiments**, and configure targeting rules and rollouts — which maps directly onto "create audiences and interact with the experimentation API for web and feature experimentation." This is real, supported, available today.
2. **There is a critical write-path limitation:** the MCP server appears to operate on **drafts**. It can read everything and modify the active draft of an entity, but field testing shows it does **not perform the final "Publish" step** — a human still has to click Publish in the Optimizely UI for changes to go live. Architect around this; do not assume the agent can ship a change end-to-end autonomously.
3. **It is an access/orchestration layer over the existing Optimizely platform, not a new data plane.** It inherits the authenticated user's exact permissions (OAuth via Opti ID), returns only data that user can already see, and — importantly — **does not support variation-level code changes** (custom HTML/CSS/JS). Those still go through the Visual Editor.

---

## 2. What the MCP server is

### 2.1 MCP in one paragraph
The **Model Context Protocol (MCP)** is an open standard that lets AI agents connect to external tools and data sources through a structured, discoverable interface rather than copy-pasting data into prompts or writing bespoke API scripts. An MCP client (the AI tool) connects to an MCP server (here, Optimizely's hosted endpoint), discovers the tools the server advertises, and calls them in a structured way. The agent decides *which* tool to call based on the user's natural-language request.

### 2.2 The Optimizely Experimentation MCP server specifically
- A **hosted service** ("remote MCP") run by Optimizely. Nothing runs locally; you point your client at a URL.
- **Single endpoint for all clients:** `https://exp.mcp.opal.optimizely.com/mcp`
- Connects the agent to Optimizely Experimentation so it can query projects, flags, and experiment results; create/manage experiments, flags, and audiences; and generate SDK implementation code — in the AI tools the team already uses (IDE, terminal, or browser-based client).
- Covers these Optimizely products: **Web Experimentation, Personalization, Feature Experimentation, Performance Edge.**

> **History/context:** Optimizely first shipped a *local* MCP server scoped to IDEs (closed beta, mid-2025). The *remote/hosted* server — the one documented here — launched broadly around **April 29, 2026**, extending access to browser-based tools (Claude.ai, ChatGPT) and non-developers. Optimizely has signaled that remote MCP for **CMS** and **Analytics** is "coming soon," so expect the surface area to grow.

---

## 3. Architecture & how communication works

### 3.1 Topology
```
AI Client (Claude, Cursor, VS Code, ChatGPT, etc.)
        │   speaks MCP over HTTP (Streamable HTTP transport)
        ▼
Optimizely Remote MCP Server  ──  https://exp.mcp.opal.optimizely.com/mcp
        │   authenticates through your Opal instance (OAuth 2.0 / Opti ID)
        ▼
Optimizely Experimentation platform
   ├── Feature Experimentation instance(s)
   └── Web Experimentation instance(s)
```

- **Transport:** Remote MCP over HTTP. Clients configure it as an HTTP / "Streamable HTTP" server type.
- **Auth model:** OAuth 2.0 in the browser on first tool use. The user logs in with **Opti ID** (Optimizely's unified identity — the same login as the Optimizely UI), connects to their **Opal** instance, and authorizes the connection. **No API keys, no manual tokens, no local server.**
- **Authorization scope:** During auth you connect to an Opal instance; the MCP server then automatically gains access to **any Experimentation instances linked to that Opal instance.** The server "sees exactly what your account has access to" — same projects, experiments, and data as the UI. Permissions are *inherited*, not separately granted.
- **Session lifetime:** Auth sessions are **time-limited**. On expiry the client prompts for re-authentication (re-run the OAuth flow). Behavior/prompt varies by client.
- **Tool namespace:** All tools are prefixed **`exp_`** in the client's tool list. (Useful for verifying the connection is live and for allow-listing.)

### 3.2 Prerequisites (platform-level)
1. An **Opti ID** account.
2. An Optimizely account with **Opal enabled**, connected to at least one **Feature Experimentation or Web Experimentation** instance.
3. Access to **both** the Opal and Experimentation instances.
4. An AI client that supports **remote MCP**.

> **Cost note:** Use of the Experimentation MCP server **does not consume Opal credits.**

### 3.3 Important auth/architecture nuance: the Opal dependency
Authentication is routed **through Opal** (Optimizely's agent-orchestration platform), not directly against an Experimentation API. The practical implication for architects: Opal must be enabled and the target Experimentation instances must be **connected as product connections under Opal**. If an Experimentation instance isn't linked to the Opal instance you authenticate against, the agent won't see it. This is an org/tenant configuration dependency to verify early.

---

## 4. The tools (capability surface)

The server groups capabilities into **three categories — Query, Manage, Implement** — implemented by the following advertised tools. Natural-language prompts are mapped by the agent onto these; you do not normally call them by name.

| Tool | Category | What it does |
|------|----------|--------------|
| `exp_get_schemas` | Query | Retrieve the **data schema** for experimentation entities (projects, flags, experiments, etc.). Lets the agent learn entity shapes before querying/writing. |
| `exp_execute_query` | Query | Run **structured queries** against your experimentation data (the general-purpose read tool). |
| `exp_summarize_test_result` | Query | Retrieve and **analyze results for an individual experiment** (metrics, variation performance, significance indicators). |
| `exp_program_reporting_top_experiments` | Query | Surface **top-performing experiments across the program.** Returns reporting-tool data — **best for paused/concluded experiments**, not live ones. |
| `exp_search_fx_sdk_docs` | Implement | Search **Feature Experimentation SDK documentation** across supported languages (see §6). |
| `exp_manage_entity_lifecycle` | Manage | **Create, update, and archive** flags, experiments, audiences, "and more." The primary write tool. |
| `exp_get_entity_templates` | Manage | Retrieve **templates and required fields** for creating/updating entities. The agent typically calls this before a write so it knows what fields are mandatory. |

### 4.1 Behavioral notes on the tools
- **Most tools return *live* data.** The exception is `exp_program_reporting_top_experiments`, which reads from the reporting layer and is therefore most meaningful for paused/concluded experiments.
- **Write tools are guarded.** Creating/updating flags, experiments, and audiences modifies live Optimizely data. The agent **always confirms the target project, environment, and details before committing.** Reviewers should treat that confirmation step as a real gate, not a formality.
- **Schema/template-first pattern.** `exp_get_schemas` and `exp_get_entity_templates` exist so the agent can introspect entity structure and required fields before constructing a query or a write. This is the mechanism that lets natural language map onto valid API payloads.

---

## 5. What you can actually do — by category

### 5.1 Query (read)
- List **projects** (names, IDs, status), **flags**, **experiments**, **environments**.
- List the **entity types** the server supports ("What entities can I query?" → projects, flags, experiments, audiences, environments, …).
- Filter/search experiments and flags: e.g. running experiments in a named project; flags not modified in N days (stale-flag detection); all experiments using a specific audience.
- **Compare configurations across environments** — e.g. flags enabled in production but not staging; flag differences between staging and production. (Useful pre-release and for debugging environment-specific behavior.)
- Program-level analytics: experiments launched last quarter vs this quarter (velocity); audiences in use across running experiments; **overall experiment win rate** for a period.

### 5.2 Experiment results (read/analyze)
- Pull **per-experiment results**: metrics, variation performance, and **statistical-significance** indicators.
- Ask whether a specific test is **statistically significant yet** (per-metric).
- Summarize **top experiments** for a period.
- Field reports confirm the agent will render results into formatted tables and can **flag anomalies** (e.g. it caught a 0%/100% traffic split on Original vs Variation #1 and flagged two underperforming metrics).

### 5.3 Manage (write) — **most relevant to a personalization engine**
- **Flags:** create (e.g. a boolean flag with on/off variations), update, archive.
- **Experiments / A/B tests:** create an experiment with variations and **configure traffic allocation** (e.g. 50/50). The agent walks through flag, variations, and targeting, confirming before commit.
- **Audiences:** **create an audience with specified conditions** (e.g. "users in the US who visited the pricing page"). The agent confirms attribute names and condition logic before saving.
- **Targeting rules and rollouts:** configure targeting conditions and **rollout rules** (e.g. a 10% rollout in staging).
- **Web Experimentation entities:** for Web Experimentation you can query experiments and **create experiments, campaigns, audiences, and other entities** in projects.
- **Orchestration value:** what used to be many sequential API calls — create flag → set up variables → configure environments → establish audiences → set rollout rules — is handled by the server **in the correct order with proper dependencies** from a single natural-language instruction. This dependency-aware orchestration is the main engineering benefit over hand-rolling the REST API.
- **Flag cleanup:** identify stale flags, check whether they're referenced in running experiments, and produce a prioritized cleanup plan. In an AI code editor (Cursor/VS Code), the agent can additionally search the **local codebase** for references to a flag key (**file access stays local — no code is sent to Optimizely**) and then archive the flag after confirmation.

### 5.4 Implement (SDK help + code generation)
- Search **Feature Experimentation SDK docs** for a specific language/framework.
- Get **setup/onboarding guidance**: installation, initialization, evaluating your first flag.
- **Generate SDK integration code** — e.g. "generate the React code to evaluate this flag in my SearchResults component," referencing the **actual flag key and variation types** of a flag you just created. This closes the loop from entity creation → working code.

---

## 6. Supported SDK languages (for the Implement tools)
`exp_search_fx_sdk_docs` covers Feature Experimentation SDK docs across:
**JavaScript, Python, Java, Ruby, Go, Swift, Android, Flutter, C#, PHP, React, React Native, Next.js, Angular.**

This is the set of languages/frameworks for which the agent can retrieve docs and generate idiomatic implementation code.

---

## 7. Supported AI clients & how they connect

Works with **any client that supports remote MCP.** Officially documented setup exists for:

| Client | Where the server is configured | Notes |
|--------|-------------------------------|-------|
| **Claude Code (CLI)** | `claude mcp add --transport http optimizely-exp https://exp.mcp.opal.optimizely.com/mcp` **or** `.mcp.json` (project) / `~/.claude/.mcp.json` (global), type `http` | |
| **Claude Desktop** | `claude_desktop_config.json` → `mcpServers.optimizely.url` | |
| **Claude.ai (web)** | Settings → Connectors → Add custom connector | |
| **Codex (web/CLI)** | Settings → MCP servers → Add server; type **Streamable HTTP**; leave bearer/headers blank | |
| **Cursor** | Settings → Tools & MCPs, or `.cursor/mcp.json` → `mcpServers.optimizely.url` | |
| **VS Code + GitHub Copilot** | `settings.json` → `github.copilot.chat.mcpServers.optimizely-exp`, type `http` | |
| **Windsurf** | Settings → MCP Servers, or `.windsurf/mcp.json` → `mcpServers.optimizely-exp.url` | |
| **Others** (ChatGPT, JetBrains, etc.) | Add a custom remote MCP server using the same URL + OAuth | |

**Client roles Optimizely calls out:**
- *Developers in AI editors* (Cursor, Claude Code, Codex, VS Code+Copilot): query config, look up SDK docs, check results without leaving the editor.
- *Technical PMs in browser AI* (Claude Desktop, Claude.ai, Codex CLI, ChatGPT): query the program, pull results, ask performance questions in plain language.
- *Experimentation leads at scale:* fast answers across large numbers of flags/experiments.

**Multiple clients can connect simultaneously** to the same server with the same OAuth flow.

---

## 8. Critical limitations & gotchas (architecture-affecting)

These are the items the team must design around. Several come from field testing, not the headline docs.

1. **Draft-only writes — no autonomous "Publish."** Field testing (Niteco/Optimizely-World practitioners, May 2026) found that the MCP can pull entity templates, confirm a change, and **modify the active draft**, but the change **does not actually go live** until a human clicks **Publish** in the UI — even when the agent reports it as "live." The MCP is deliberately erring to the safe side: *let AI read everything and modify the draft, but not perform the final ship.* **Implication:** any "agent-driven personalization" pipeline needs a human (or a separate, sanctioned publish mechanism) in the loop to go live. Don't promise fully closed-loop autonomous deployment on the strength of MCP alone.
2. **No variation-level code changes.** Custom HTML, CSS, and JavaScript for Web Experimentation variations are **not supported through MCP.** Those edits still require the **Visual Editor**. So "personalized page content/structure" that depends on custom variation code can't be authored end-to-end via MCP.
3. **Permissions are inherited and capped by the UI.** The agent can only do what the authenticated user can do in the Optimizely UI — nothing more. Governance/change-control questions don't go away; they move to "who is allowed to authenticate and what can that identity do." In stricter orgs, "inherited permissions" needs to be reasoned through before opening MCP to broad teams.
4. **Reporting tool ≠ live data for top-experiments.** `exp_program_reporting_top_experiments` reflects the reporting layer and is **most accurate for paused/concluded** experiments. Don't rely on it for real-time monitoring of active tests.
5. **Opal dependency is mandatory.** No Opal instance / unlinked Experimentation instances ⇒ the agent can't see your data. This is a tenant-configuration prerequisite, not just a login.
6. **Session expiry.** Time-limited auth means long-running automation will periodically need re-auth via interactive OAuth. Pure unattended/headless automation against this server is not the documented design point.
7. **Natural-language non-determinism.** Because the agent chooses tools and constructs payloads from prose, the same intent can produce different calls. The built-in **confirmation step before writes** is the main guardrail — treat it as required review, and prefer **specific, scoped prompts** (name the project/environment/entity) to reduce ambiguity.
8. **Known client-connection rough edges.** At least one practitioner could not connect via the documented direct `claude mcp add` / `claude_desktop_config.json` URL form and had to fall back to the **`mcp-remote` bridge** (below). Budget some setup friction per client/version.

### 8.1 Documented `mcp-remote` fallback (Claude Desktop)
If the direct URL config fails to load ("Some MCP servers could not be loaded"), the working community fallback wraps the remote server with `mcp-remote`:
```json
{
  "mcpServers": {
    "optimizely": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://exp.mcp.opal.optimizely.com/mcp"]
    }
  }
}
```

---

## 9. Troubleshooting reference (official)
- **Server not listed after setup:** validate the config JSON (a missing comma/bracket is the usual cause); then **fully restart** the client (not just reload).
- **OAuth window doesn't open:** some clients only start OAuth when you invoke a tool — try "List my Optimizely projects." Check the OS default browser is set.
- **`exp_` tools don't appear:** usually auth didn't complete; re-trigger a query; if still missing, remove & re-add the server, then re-authenticate.
- **Queries return nothing / access error:** confirm the account has access to ≥1 Feature or Web Experimentation project (MCP only returns what the account can see in the UI). If access is fine and it still fails, contact Optimizely Support.
- **Network:** behind a proxy/VPN, ensure `exp.mcp.opal.optimizely.com` is reachable.

---

## 10. Representative prompts (what each demonstrates the server can do)

> These double as a capability checklist for evaluation/PoC.

**Orientation**
- "List my Optimizely projects." (returns names, IDs, status)
- "What entities can I query?"

**Query / filter**
- "Show me all running experiments in the Storefront project."
- "Which flags have not been modified in 90 days?"
- "List all experiments using the 'mobile-users' audience."
- "Show me flags in Storefront that differ between staging and production."

**Results / analysis**
- "What are the results for the homepage-hero experiment?"
- "Is the checkout-flow test statistically significant yet?"
- "What is our overall experiment win rate this quarter?"

**Create / manage (write)**
- "Create a new feature flag called checkout-redesign with boolean variations."
- "Set up an A/B test on the new pricing page with 50/50 traffic split."
- "Create an audience for users in the US who visited the pricing page."
- "Set it up with a 10% rollout in staging."

**Implement**
- "Help me get started with the React SDK for feature flags."
- "Generate the React code to evaluate this flag in my SearchResults component."

**Multi-step (context is retained within a conversation):**
1. "Show me all experiments running > 30 days" → 2. "Which of those reached significance?" → 3. "Summarize results for the significant ones." The agent chains these, narrowing each step.

---

## 11. Implications for the personalization-engine build (synthesis)

- **Good fit (available today):** programmatic **audience creation/management**, flag/experiment creation, **targeting + rollout configuration**, and reading **results/significance** — all driveable by an agent, with dependency-aware orchestration that beats hand-rolling the REST API. This covers a large part of "create audiences and interact with the experimentation API for web + feature experimentation."
- **Design constraint #1 — publish gap:** plan for a **human-in-the-loop or a separate sanctioned publish path** to take agent-prepared changes live. Treat MCP as "prepare + stage," not "ship."
- **Design constraint #2 — content/variation code:** anything requiring **custom variation HTML/CSS/JS** is **out of MCP scope** (Visual Editor territory). If personalized page content/layout depends on custom code, that path needs a different mechanism.
- **Design constraint #3 — identity & governance:** the integration runs as a **human Optimizely identity with inherited permissions** and **time-limited sessions**, authenticated **through Opal**. This shapes how/whether you can run unattended automation and who is allowed to act. Confirm Opal enablement + Experimentation instance linkage as a gating prerequisite.
- **Watch the roadmap:** remote MCP for **CMS and Analytics** is announced as coming; if the personalization engine needs content orchestration or warehouse-grade analytics via MCP, track those releases rather than assuming today's Experimentation server covers them.

---

## 12. Source list
- Optimizely Support — *Experimentation MCP server* section overview, quickstart, install, and example-prompts articles (updated Apr–May 2026).
- Optimizely blog — *Remote MCP Server is here: Bring Optimizely into your AI tools* (May 2026).
- CMSWire — *Optimizely Launches Remote MCP Server to Bring Experimentation Into AI Tools* (Apr 30, 2026).
- Optimizely World practitioner field reports — *A First Look at Optimizely Remote MCP Server for Experimentation* (May 1, 2026; documents the draft/publish gap and the `mcp-remote` fallback).
- Optimizely World — *Revolutionize Your Experimentation: Introducing the Optimizely Experimentation MCP Server* (closed-beta/local-server history, Aug 2025).

*Compiled June 2026. Capabilities and limitations reflect documentation and field reports current as of that date; verify the publish-path behavior and client compatibility against the live service before finalizing architecture, as the product is evolving quickly.*
