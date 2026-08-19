# Edge Personalization — Expert Services Implementation Runbook

**Audience:** INTERNAL — Expert Services solutions architects and solutions engineers. Written so a **new technical resource** can pick up the implementation motion and understand what a customer deployment actually consists of.
**Status:** v0.2 — describes the operating model Expert Services receives **at handover**. The standing principle: **deployment, management, and verification arrive automated.** Services effort concentrates where human judgment is the product — discovery, catalog semantics, instrumentation QA, tuning — and infrastructure toil is software's job. That is the profitability design, not an aspiration: the motion is not handed to services until the automation exists, so this document carries no build-status caveats (internal build truth lives in the ledger; see §11).
**How this relates to the other documents:** `docs/PS-Implementation-Delivery-Guide.md` is the **engagement frame** — who does what (RACI), the P0–P7 phase playbook, effort ranges, SOW units. This runbook is the **technical companion** — what a deployment physically is, what gets collected from whom, what gets configured, and what "verified" means. The internal ledger (`docs/architecture/19-tapestry-delivery-ledger.md`) is the **build truth** — always check it before making a customer commitment. If documents disagree: Delivery Guide wins on process, this runbook wins on mechanics, the ledger wins on status.

---

## 1. The mental model (read this first)

**The product in four sentences.** Most personalization only works on the small slice of visitors a brand already knows; this engine is built for the other ninety percent, the ones who arrive anonymous and leave before any profile exists. It runs at the network edge and learns each visitor from their first few clicks, scoring interests across the brand's own catalog and adapting the page in the same session, in milliseconds. It is deterministic rather than a black box: every decision can show exactly why it was made, and merchandisers stay in control through pins, rules, and tunable weights that always outrank the engine. Because it treats a content ID like a product ID, the same engine personalizes products, content, or both — headless, over the brand's existing front end, on first-party data alone.

**The seam — ours vs. theirs.** This is the single most important thing a new SA must internalize:

```
      THEIRS (customer)                          OURS (Optimizely-operated)
┌──────────────────────────────┐          ┌─────────────────────────────────────┐
│ Front end (they PAINT)       │  events  │ Customer STAMP on Cloudflare        │
│ CMS / PIM / feeds            │  ──────► │  · edge worker (decisions, ms)      │
│   (systems of record for     │          │  · affinity engine + audiences      │
│    content + product IDs)    │  ◄────── │  · policy/config store (governed)   │
│ dataLayer / tags on pages    │ decisions│  · event capture + explain records  │
│ Conversion event             │  by ID   │  · transport (WebSocket + snapshot) │
│ Slot defaults (fallbacks)    │          │  · Day-2 operations                 │
└──────────────────────────────┘          └─────────────────────────────────────┘
                    SHARED BOUNDARY: the SDK — we ship it, they install it
```

Three sentences to repeat until they're reflexive:
1. **The customer's front end always paints.** We push ordered decisions by ID; we never inject into their pages.
2. **The customer's systems stay the system of record.** Their CMS IDs and product IDs are the join key end to end — we never mint identity for their content.
3. **We operate the infrastructure — through automation.** The customer never touches Cloudflare, and nobody hand-edits infrastructure: pipelines execute, people approve.

## 2. Anatomy of a customer stamp

One codebase, deployed as **one Worker per customer per environment** ("a stamp"), version-pinned per customer. The resource shape below is the reference build's actual configuration (`wrangler.toml`); per-customer stamps replicate the *shape* with customer-scoped names (`{customer}-{env}`). Binding names are reference-era and may be renamed during productization — **the shape is the contract, not the names.**

| Resource | Reference binding | What it holds / does |
|---|---|---|
| Worker | `edge-platform` | The engine: routing, scoring, decisions, transport, ops routes |
| KV namespace | `CACHE` | Catalog snapshots, generated + pinned audiences, versioned engine config (weights/decay/thresholds), feature flags |
| KV namespace | `SESSIONS` | Session state (the affinity vector rides here in session-host mode) |
| D1 database | `DB` | Event capture, profile rollups and views, geo/census reference data, attribute metadata catalog |
| Durable Object | `SHOPPER_REFLEX` | Per-visitor SQLite actor: affinity state + WebSocket + decay alarms (co-located host mode, behind `REFLEX_HOST`) |
| Durable Object | `PERSONALIZATION_WEBSOCKET` | Relay/push channel (session-host mode) |
| Durable Object | `OpalAgent` | Per-session conversational assistant (optional feature) |
| Durable Objects | `STATE_MANAGER`, `RATE_LIMITER` | Coordination + abuse protection |
| Queue | `events` | Async jobs off the request path (e.g., generation work) |
| R2 bucket | `STORAGE` | Generated/static assets |
| Analytics Engine | `ANALYTICS` | Operational metrics stream |
| Static assets | `ASSETS` | Reference UI / served files |
| Browser Rendering | `BROWSER` | **Internal verification only** (screenshot route) — not customer-facing |

**Configuration surface (per stamp):**
- **Vars (not secret):** environment mode, connector/decision-source switches, reflex host mode, ODP host, Optimizely SDK key (datafiles are public by design).
- **Secrets (`wrangler secret put`):** ODP private key, FX API token (only if experimentation is composed), JWT signing secret, any CMS credentials.
- **Environments:** staging + production stamps minimum (the `[env.*]` pattern exists in the reference config). The customer's lower-environment integration points at **our staging stamp**.

## 3. How a stamp gets deployed — the automated model

The handover contract with Expert Services is simple: **provisioning, deployment, and verification are pipeline operations, not projects.** Services never performs manual infrastructure work and never quotes infrastructure effort — human time is limited to reviewing and approving. Wrangler remains the tool under the hood; the automation wraps it. Stamps deploy into **our Cloudflare organization** (managed-service posture — the customer never holds the infrastructure); a customer-owned Cloudflare account is a non-standard exception — escalate before agreeing to it.

**The stamp manifest — the single input.** One declarative file per customer in the fleet repository (`stamps/{customer}.yaml`): customer name, environments, domains + CORS origins, brand list, dimension registry, catalog sources, connector switches (CDP on/off with instance references), version pin. Secrets never appear in the manifest — it carries **references** to vault entries. Creating a customer = opening a pull request with one new file; the PR review **is** the human control point.

**The pipeline (runs on manifest merge):**
1. **Validate** — manifest schema + policy checks (naming, isolation invariants, CORS sanity).
2. **Provision** — idempotently create/verify the §2 resource set (KV ×2, D1, R2, queue, DO namespaces) via the Cloudflare API; generate the stamp's wrangler configuration from the template.
3. **Migrate & seed** — apply D1 migrations in order; load reference seeds.
4. **Secrets** — injected from the vault by reference; no human ever pastes a key.
5. **Deploy** — worker deploy (Durable Object migrations ride it); routes + domain binding.
6. **Load catalogs** — run the source adapters; build → validate → **activate the immutable snapshot** (requests never see a half-loaded catalog).
7. **Configure** — push the dimension registry and engine config; confirm the version marker.
8. **Wire-check gate** — the §8 verification loop executed automatically against the fresh stamp with a synthetic visitor (events land → scores move → memberships flip both directions → decisions push → fallback renders). **A stamp is not "done" until this gate is green** — the pipeline certifies it, not a person.

**Fleet management is the same model:**
- **Git is the fleet's source of truth.** Desired state = the manifests; drift detection reconciles actual Cloudflare state against them.
- **Upgrades** = a PR bumping a stamp's version pin (canary stamp first, then the fleet on each customer's window). **Rollback** = revert the pin. Code-freeze customers simply keep their pin.
- **Day-2 runs itself:** per-stamp health and event-flow heartbeats ("no events for N minutes" pages someone), scheduled catalog refresh, config versioning and backup, per-stamp dashboards provisioned with the stamp.
- **Human touchpoints are decisions, not keystrokes:** approve the manifest PR, approve go-live, approve an out-of-window upgrade. Everything else is software.

### The agent operations pack (ships with the handover)

The automation is built to be **driven by AI agents as first-class operators** — services teams increasingly work through copilots, and this motion is designed for that from day one. The handover package therefore includes an agent pack at the fleet-repository root:

- **`AGENTS.md`** — the canonical, tool-agnostic operating contract (the emerging cross-tool convention), with thin pointer files for specific assistants (`CLAUDE.md`, `.github/copilot-instructions.md`) so whichever agent a services engineer uses picks up the same truth.
- **The task catalog, written for machine execution.** Every operation — `validate`, `provision`, `deploy`, `wire-check`, `load-catalog`, `pin/upgrade`, `rollback`, `erase-visitor`, `stamp-status` — is specified as: purpose → preconditions → exact command → expected output → failure modes → rollback. Pre- and postconditions are what let an agent chain tasks safely instead of improvising.
- **Guardrails encoded, not implied:** production-touching operations require named human approval; one customer stamp per operation, always explicitly named — an agent never enumerates or crosses stamps; secrets are referenced, never read or echoed; the escalation map (L1 PS → L2 solutions engineering → L3 product engineering) is included so agents hand off instead of guessing.
- **The manifest schema with worked examples**, so "create a stamp for customer X" is a fill-in-the-template task an agent completes in minutes and a human approves in one review.
- **Evolution path:** the same task catalog is the specification for an internal **MCP tool surface** (`provision_stamp`, `run_wirecheck`, `pin_version`, …), so agents eventually call typed tools instead of shelling out. The agent file is the day-one interface; the MCP server is its mature form — same catalog, same guardrails.

The test of the pack is concrete: **a new services engineer — or their copilot — takes a signed-off discovery packet (§5) and produces a green staging stamp the same day, having typed no infrastructure commands by hand.**

## 4. Identifiers and access to collect

The gathering checklist, organized by source. Collect during P0/P1; every missing item is a timeline risk to surface, not absorb.

**From Optimizely systems (per customer; per brand where noted):**
| Item | Needed for | Notes |
|---|---|---|
| Feature Experimentation project ID + SDK key | Only if experimentation is composed with the engine | **Optional — the engine is standalone by design.** SDK key/datafile are public; the API token (for programmatic experiment setup) is a secret |
| ODP instance: scope, host, public key (event ingest), private key (GraphQL) | Durable memory / CDP loop | **Optional and additive** — per brand; the engine runs fully without it |
| Opal workspace access | Authoring + insight surfaces | Optional; **never on the decision path** (credit boundary: `docs/Opal-Credit-Boundary-Pricing-Guide.md`) |
| CMS/CMP API credentials or export path | Content catalog sync | Whatever their CMS is — ours or third-party; API preferred, JSON/CSV export acceptable |

**From the customer:**
- Domain plan + DNS decision (custom domain lead time is real), CORS origins list
- Brand list (multi-brand tenancy scoping) + environments + **their code-freeze calendar**
- Product feed: access, format, taxonomy dimensions, refresh cadence
- Content inventory with **stable IDs and render URLs** (the non-negotiable)
- dataLayer / tag-manager spec (**the #1 cost driver — ask at pre-sales**, per Delivery Guide §8)
- Conversion/order event definition and feasibility
- Consent/CMP requirements; network approval for WebSocket egress
- Named owners: slot-map owner + tuning owner (people, not teams)

**From our side:** Cloudflare account/zone, stamp naming (`{customer}-{env}`), secrets vault entries, the version pin for their stamp.

## 5. Requirements gathering — the discovery artifacts

The workshops themselves are Delivery Guide P1 (three sessions, straw-man materials first — nobody workshops a blank page). This section is the **exit criteria**: discovery is done when these artifacts exist and are signed off.

1. **Dimension registry** — the agreed 6–8 scoring dimensions, explicitly documented (no internal "magic"). Location expectations set correctly: trending/aggregate by region, never per-shopper location history.
2. **Content-type taxonomy + content catalog spec** — their ID, type, render URL, metadata/tags, slot eligibility, lifecycle.
3. **Product feed spec** — IDs, taxonomy dimensions, attributes, cadence.
4. **Slot map** — pages × slots × defaults × owner, reviewed **with their front-end team** against the delivery contract (page-level ordered decision set, by ID).
5. **Tag plan** — page types × events × capture method × owner × status, from the template.
6. **Conversion event definition** — non-negotiable; outcome learning depends on it.
7. **Acceptance criteria** — expressed as rendered-state checks (see §8), agreed before integration starts.
8. **Privacy answer pack** — first-party ID only, coarse geo, population-level aggregates, one-call erasure (pre-answered in the Delivery Guide; confirm against their review process).

**"How does content identify?" — the one-sentence answer for every customer conversation:** by **their CMS ID, everywhere, end to end** — the catalog registers it, the engine ranks it, the push delivers it, their front end maps it to a component, the explain record cites it. We never mint content identity. Sparse metadata is expected and handled: the enrichment pipeline proposes tags at design time (AI-assisted, human-approved, calibrated on a 100–500-asset sample during catalog onboarding — never in the serving path).

## 6. What the customer installs — the SDK

One npm package (+ CDN build), browser-first, three parts:

- **Core (mandatory, shared):** first-party visitor identity (localStorage + cookie, no fingerprinting), session boundaries, WebSocket + snapshot transport, SDK-key auth. Non-negotiable because events and decisions must share one visitor ID and one socket.
- **Emit (events in), four capture paths used together:** automatic (impressions/dwell for content we pushed — free), declarative (`data-*` attributes on slots), **dataLayer/GTM adapter** (the cheap path wherever a tag layer exists), explicit API (commerce events — add-to-cart, purchase).
- **Listen (decisions out):** subscribes to the page-level ordered `content_decisions`, per-slot callbacks, first-paint snapshot hydration (no flash of default), and **guaranteed graceful absence** — no decision means the customer's default renders; the page never waits on us.

Integration mode selection: dataLayer exists → adapter path first. No dataLayer → declarative + explicit (and the added customer effort goes in the SOW explicitly, never absorbed). Customers keeping their own analytics pipeline → **listen-only mode** is supported; PS then QAs their pipeline to the same standard.

**What "painting" means (set this expectation early):** the customer owns a small mapping layer from content ID → their component/template. PS runs a front-end mapping workshop; the reference storefront demonstrates the pattern. Native apps: the contract is transport-level JSON and therefore portable, but a native SDK is a roadmap port — **never sell it as available.**

## 7. What PS configures after deploy, before launch

- **Dimension registry + weights/decay/thresholds** — per-dimension and per-audience, versioned configuration, hot (no redeploy), edited in the tuning UI.
- **Audience review** — audiences generate from the customer's catalog automatically; PS facilitates the human pass: rename, pin, prune. Pinned and human-edited audiences survive regeneration.
- **Merchandising layers** — eligibility gates, pins/priority rules, shaping boosts; declared precedence: gates → pins → weighted ranking.
- **Strategies per slot** — a dimensions+weights profile per slot, customer-configured or engine-autonomous.
- **CDP loop on/off** — ODP forwarding/seeding if the customer has it.
- **Transparency surfaces** — QA overlay + explain-record access for the customer's tuning owner.

## 8. Verification and acceptance — the wire-check

The pipeline runs this loop automatically against every fresh or upgraded stamp (synthetic visitor, scripted browse) — it is the §3 gate. PS and agents rerun it on demand, and it doubles as the manual checklist when a human wants to see the loop with their own eyes. In this order; each step has a visible artifact; "it should work" is not a step.

1. **Connect:** visitor ID minted; WebSocket up (or snapshot fallback engages).
2. **Events land:** the debug overlay shows schema-complete events on every page type in the tag plan.
3. **Scores move:** the affinity vector responds to a scripted browse sequence.
4. **Memberships flip — both directions:** audiences enter on interest AND exit on decay.
5. **Decisions push:** `content_decisions` arrives with the contract shape (IDs, order, scores).
6. **Paint:** the customer's front end renders it — **verify rendered state (computed display/geometry), never attributes or DOM flags.** This is a house rule with a scar behind it.
7. **Explain:** every decision has its receipt (the explain record).
8. **Fallback:** kill the socket — defaults render, no flash, no waiting page.

Then the scripted acceptance run (Delivery Guide P6): an N-asset pool, verifiably different picks for different visitors, a live weight change re-ranks, an explain record behind every decision. Launch gate, rollback (= flip the stamp's version pin), and the hypercare window are P7.

## 9. Multiple customers, brands, environments — the separation model

- **Customer = stamp = hard isolation:** separate worker, storage, keys, domain per customer. No shared compute, storage, or credentials. This is the one-sentence answer in every security review.
- **Brand = tenant inside the stamp:** per-brand catalogs, configuration, audiences, credentials, namespaced throughout. One multi-brand customer runs one stamp.
- **Environment = separate stamp** (staging/production), independently version-pinned — one customer holds through a code freeze while another upgrades.
- **Data residency + erasure:** all shopper state lives inside the customer's stamp; no PII in the vector; idle self-expiry; one-call erasure endpoint.

## 10. The guidance catalog — the help we are on the hook for

What "supporting the customer" concretely means, mapped to phases (effort ranges live in the Delivery Guide):

| Guidance item | What PS delivers | Phase |
|---|---|---|
| Discovery workshops ×3 | Straw-man registry, taxonomy, slot map, data plan — customer reacts, never drafts | P1 |
| Tag plan + instrumentation QA | Template-driven plan; QA with the event-validation overlay until the schema flows on every page type | P1, P4 |
| Catalog onboarding | Feed mapping, enrichment calibration (AI proposes, customer approves), snapshot activation | P3 |
| Front-end mapping workshop | ID → component mapping session with their FE team; reference implementation walk-through | P5 |
| Tuning coaching | Reading explain records, weight sessions, seeding strategies — "the first pulls on every lever" | P6–P7 |
| Launch + hypercare | Monitoring watch, weekly tuning session, 2-week window | P7 |
| Recurring attach | Quarterly tuning reviews / optimization blocks | Post-launch |

## 11. Internal build note — not part of the services conversation

This runbook describes the operating model **as handed over**: the automation in §3 is the handover condition, not a roadmap promise made to services. Until handover, any interim procedures are executed by the platform/solutions team — services is never asked to run manual steps and never quotes infrastructure effort, because it will never perform infrastructure work. Build sequencing and current component status are internal matters: `docs/Productization-Roadmap.md` (workstreams) and `docs/architecture/19-tapestry-delivery-ledger.md` (build truth). Any capability commitment to a customer routes through the product team against the ledger — not through this document, and never from a services conversation.

## 12. New-SA bootstrap — the first week

1. **Read, in order:** this runbook → `PS-Implementation-Delivery-Guide.md` → `Content-Personalization-Explained-Simply.md` → architecture docs 16 + 18 (skim for shape, not detail) → ledger 19 (status only).
2. **Hands-on:** run the reference storefront; watch the affinity instrument fill as you browse; watch an audience enter and decay out; kill the socket and watch defaults render; read one explain record end to end.
3. **Shadow:** one discovery workshop and one tag-plan QA session.
4. **You are field-ready when** you can draw the §1 seam diagram from memory, recite the three reflexive sentences, walk the §3 pipeline and §8 wire-check without notes, and answer the Delivery Guide's FAQ unprompted.

---

🔗 Companions: `docs/PS-Implementation-Delivery-Guide.md` (engagement frame) · `docs/Productization-Roadmap.md` (workstreams W1–W10) · `docs/architecture/19-tapestry-delivery-ledger.md` (build truth, INTERNAL) · `docs/Edge-Unit-Economics.md` + `docs/Monetization-Legal-Brief.md` + `docs/Opal-Credit-Boundary-Pricing-Guide.md` (commercial) · `docs/architecture/16` + `18` (architecture)
