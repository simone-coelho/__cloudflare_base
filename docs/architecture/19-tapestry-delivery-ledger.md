# Tapestry Delivery Ledger — Behavioral Targeting and Intelligence

**Audience:** INTERNAL ONLY — engineering + the architect running the delivery. This document is never customer-visible and is the ONLY place internal dates and effort estimates live.
**Purpose:** the never-miss-anything instrument for the Tapestry contract: every requirement from the 2026-07-24 call traced to an artifact and a build item; every build item statused against the actual code; the internal fast path and its guardrails.
**Dual-track rule (absolute):** internal dates/effort in this file are NEVER quoted externally. The external commitments live in `docs/Tapestry-Implementation-Plan.md` and are the only dates the customer ever sees.

---

## 1. The contract picture (from the 2026-07-24 call)

- Delivery becomes **contractual** — procurement milestones; a committed timeline (range acceptable) is required.
- Contract is **Tapestry-wide**: pilot on **Kate Spade** (lower business impact), learnings carried to Coach. Multi-brand tenancy is therefore contract scope.
- Initiative name (theirs, adopted in all artifacts): **"Behavioral Targeting and Intelligence."**
- Owners on their side: Holly (commercial), Mandeep (capability), **Nitin (head of platform + AI — will own the system; primary technical audience)** + his data scientists.
- Their stated need: **content-recommendations API in their staging/lower environments by end of October** (holiday prep done by then); November = their code freeze; January = launch on one page + joint announcement.
- ⚠️ **The August trap:** an end-of-August offer was floated on the call; Mandeep said he'd take it AND then promise Europe deliveries in September (Boxing Day peak). He explicitly asked us to vet internally and commit only what we can hit. **No August delivery date ever appears in any external artifact.** External anchor = end-October staging; we beat it privately.
- V1 acceptance in his words: *"20–30 images on the homepage served differently per user based on the agreed dimensions, with weight configurability"* — works in spirit and in behavior from day one; tuning afterward is expected and fine.

## 2. Requirement traceability — his asks → our artifacts → build items

| # | His requirement (call) | External artifact | Build item |
|---|---|---|---|
| 1 | Contractual milestones with procurement | Impl Plan §6 milestones (draft-for-response) | Leadership date vetting before send |
| 2 | Tapestry-wide, Kate Spade pilot | Doc 1 "One platform, brand by brand"; Impl Plan tenant provisioning | CW1 tenancy |
| 3 | "Behavioral Targeting and Intelligence" naming | Doc 1 retitle (title, eyebrow, footer) | — |
| 4 | Content/experience recs, NOT product recs | Doc 1 frame ("product recs are table stakes") | — |
| 5 | Standalone outside experimentation; no CMAB required (repeated) | Doc 1 invariant + FX row demotion + kitchen section | Engine serves without any experiment (already true by design) |
| 6 | Works for anonymous traffic (90–95% unknown, ~80% never seen) | Doc 1 anonymous-first frame + identity honesty | CW6 regional prior (cold start), CW7 identity/visit |
| 7 | Probabilistic model, defined dimensions, configurable weights, visibility | Doc 1 "The model, precisely" (deterministic computation / probabilistic interpretation) | CW0 config, CW9 tuning UI |
| 8 | Slot progression (current → content leads → slot organization ~6mo) | Doc 1 ordering section + ladder (kept; his pacing on stage 4) | Stage 4 = separate lane, not this contract's critical path |
| 9 | Phase 1 on 6–8 explicitly documented dimensions | Doc 1 dimension registry v1 (8 proposed, workshop trims) | M0 registry sign-off workshop |
| 10 | **Location non-negotiable v1, affinity-driven** ("trending or liked in that region", not if-then-else) | Doc 1 dimension 1 (regional lift + cold-start blend) | **CW6 RegionTrend (new build, 2.5–3 agent-days)** |
| 11 | Visit number (40% buy visit 1 / 60% later; on-model first visit → detail/reviews return) | Doc 1 dimension 2 + seeded-defaults-reweighted story | CW7 (fix visit semantics — see §4 honesty notes) |
| 12 | Content type + metadata (on-model/silo/zoom/sole/video; video affinity) | Doc 1 dimension 4 + content-feed spec | CW2 catalog `type`, CW3 content dims |
| 13 | Marketing channel | Doc 1 dimension 3 | CW7 (UTM/referrer capture — doesn't exist yet) |
| 14 | Per-slot strategies, configured AND autonomous modes | Doc 1 strategies section | CW5 SlotStrategy config |
| 15 | No black box; visibility into weightings; tune themselves | Doc 1 control section (every constant a visible parameter) | CW0 + CW9 + CW11 explain persistence |
| 16 | DS team can inject their own math (he valued this — keep it) | Doc 1 four injection surfaces (params / priors import / egress closed loop / co-designed hooks) | CW11 priors import + export |
| 17 | Adding dimensions later may be hard → review algo up front | Doc 1 "Adding dimensions later" (versioned registry, backfill from retained events) | Registry versioning rides CW0 |
| 18 | "You tell me what you need to feed your machine" | Doc 1 "feeding the machine" (field-level) + Impl Plan dependencies table | M0 workshops |
| 19 | End-Oct: API in their staging/lower envs | Impl Plan M4 (end-October anchor) | CW10 staging + auth; **real deadline = M3 SDK mid-Oct** |
| 20 | Nov–Dec integrate/test (Nov code freeze) | Impl Plan M5 — held OPEN (their calendar) | Support role |
| 21 | January: launch one page + joint announcement | Impl Plan M6 — proposed, to confirm together | — |
| 22 | Commit only what we can actually deliver | Dual-track: external Oct/Jan; internal ~Aug 28 complete | This file §5 |
| 23 | One accurate doc; he never saw the ordering-image version | Doc 1 (the updated HTML IS the resend) | HTML integration (in flight) |
| 24 | Learning logic: session-over-session | Doc 1 four layers (L1–L4) | L3 design = CW13 (S2 design doc) |
| 25 | Implementation plan incl. learning-logic build, both-sides dependencies, envs, data questions | Impl Plan §§4–8 | — |
| 26 | V1 acceptance: 20–30 homepage images, day-one behavior | Doc 1 acceptance bar + Impl Plan M4 | CW14 scripted acceptance run (rendered-state verification) |
| 27 | Foundation = harden the proven deterministic engine + marry with affinity | Impl Plan §2 (deterministic content-by-ID engine described, **not named** — HD Supply/CRePE never appear in external docs) | CW2 reuses the proven contract patterns |

## 3. Requirement ledger — status vs the actual code (audited 2026-07-24)

Full audit with file:line evidence below; summary: **the engine core is real; everything content-shaped is gap.**

| Req | Name | Status | Key evidence | Remains |
|---|---|---|---|---|
| R1 | Content catalog + ContentSourceProvider | **GAP** (designed, doc 18 §3) | zero `content*` hits in src/; analogs: `CatalogService.ts:23-98`, adapter seam `geo/cohort.ts:148-158` | schema, KV/D1 store + immutable snapshots, provider seam + manual CSV/JSON adapter first, ingest/list routes |
| R2 | Content telemetry | **GAP**, seam ready | `actionEventSchema` realtime.ts:51-63; DO allowlist ShopperReflex.ts:127-130; chokepoint `captureDemoEvent` realtime.ts:680-724; `extractTouches` core.ts:232-260 is already tag-generic | 3 event types + weights; content resolution in ingest; flatten to D1 + ODP. **Also: purchases still not forwarded to ODP** (odpLoop.ts:82-104 — no purchase case) |
| R3 | Ranker + `content_decisions` push + snapshot | **GAP** for content; transport/ranking **BUILT** | push `ShopperReflex.pushFrame:624-633`; snapshot realtime.ts:236-279 + DO /snapshot:732-759; ranking pattern `CatalogService.getRecommendations` | content ranker per slot; page assembler (order, dedupe, off-limits, default fallback); first-paint variant |
| R4 | Dimension registry 6–8 | **PARTIAL** | 6 dims live in `DEFAULT_REFLEX_CONFIG` core.ts:150-188; `DimensionSpec` core.ts:26-44 IS the registry entry (per-dim τ/K/θ; priceBand override :162). Geo detection real (routes/geo.ts:21-40; grain ladder cohort.ts:429-454) but **no live regional trending**. Visit semantics wrong (per-update, SessionManager.ts:121). **Entry channel: zero UTM/referrer capture.** Content-format: gap until R2 | CW6 trending; CW7 visit boundaries + channel capture; CW3 content dims |
| R5 | Slot strategies | **GAP** as named object; ingredients built | per-dim weights core.ts:150-188; per-flag decisions DecisionProvider.ts; no slot→weights profile, no mode switch | `SlotStrategy` {slot, mode, dimWeights, constraints, maxItems} in KV config; assembler consumes |
| R6 | Tuning UI ⏰ (externally committed) | **GAP — config is compile-time everywhere** | `const cfg = DEFAULT_REFLEX_CONFIG` at ShopperReflex.ts:392,555,659,734 + RealtimeSegmentEngine.ts (6 sites) + realtime.ts:251; **no KV read of ReflexConfig anywhere** (doc 16 §6 designed-only). Audience review machinery live (audienceGenerator.ts:151-205, operator.ts:74,108,151, operator-console.js) | KV-versioned config loader + write API; rename/pin/prune endpoints; per-audience content association; UI (extend operator console) |
| R7 | Multi-brand tenancy | **GAP — zero** | grep `tenant` = zero; DO keyed bare visitor id (realtime.ts:31); single KV/D1/ODP creds (wrangler.toml:13-21,115); Coach hardcoded in `upsertOdpProfile` odpLoop.ts:243-249 | tenant key-spacing everywhere; per-tenant config/catalogs/audiences/creds/SDK keys; de-Coach the core (Coach = tenant #1) |
| R8 | Customer SDK | **BUILT-IN-MONOLITH** | mintVisitorId storefront.js:142-153; connectWebSocket :235-249; sendAction :265-295 (4,192-line demo class) | extract ~300-line versioned client (ESM+IIFE); tenant+key params; decisions listener + auto-impressions; docs. Payload freeze needs their workshop |
| R9 | Staging consumable by them | **GAP** | env stanzas have **zero bindings** (wrangler.toml:6-10); auth middleware exists (auth.ts:29-123) but **applied nowhere** (index.ts:71 mounts /operator bare); CORS reflects any origin **with credentials** (index.ts:47-57) | full per-env bindings/secrets; SDK-key + operator auth wiring; CORS allowlist; API docs; deploy runbook |
| R10 | DS injection | **GAP** (a,b) / **PARTIAL** (c) | no config API; no priors import; overrides exist but unrouted (RealtimeSegmentEngine.ts:891-928); **live decisions/explains never persisted** (decisions/conversions tables = synthetic seed, 0001:332,359) | config API (falls out of CW0); priors endpoint; decision/explain persistence + NDJSON export |
| R11 | Anonymous identity + visits | **BUILT-NEEDS-HARDENING** | opt_visitor_id stable (storefront.js:142-153); erasure `POST /reset` ShopperReflex.ts:220-228; retention self-expiry :662-667. **vuid still session-derived** (recorded debt ShopperReflex.ts:46-49, odpLoop.ts:48-54) | idle-gap visit boundaries on DO record (firstSeen/lastSeen exist :110-118); vuid⇄visitor-id cutover (~1 day) — without it cross-session ODP memory doesn't accrue per shopper |
| R12 | ODP wiring | **BUILT-VERIFIED** | odpLoop.ts:15 "LIVE-VERIFIED 2026-07-03"; forward :184-224; GraphQL seed :273-309; upsert :231-260; 5 mirrored audiences :35-41; wired in both hosts | tenancy caveats: per-tenant creds + mirrored segments (Kate Spade ODP instance = customer/ODP-team dependency); purchase forwarding |
| R13 | LLM auto-tagging (design-time) | **GAP** (pipeline); plumbing **BUILT** | Gemini→R2 path proven (sceneGen.ts:1-50; queue consumer index.ts:138-156); suggest→human-publish governance pattern (operator.ts:12-15,74,108) | tagging job (taxonomy-constrained JSON out); suggestions store; approve/reject UI |
| R14 | Explain records | **BUILT at generation; not persisted** | ExplainRecord core.ts:96-109, emitted :343-360, on every push | last-N ring + authorized debug endpoint; per-decision drivers in R3 payload; persistence (→R10c) |
| R15 | Outcome statistics (S2) | **GAP by design** (post-launch; data physics) | enriched capture (migrations 0002/0005); cmab.ts exists; cron stub index.ts:126-137 | CW13 design doc now: content×context×outcome tables, decayed lift fold-in, exploration share, volume gates |

**Honesty corrections recorded (do not repeat the errors):** actual test count = **56 cases** across `src/reflex/*.test.ts` (roadmap's "112 tests" is overstated); the suite currently doesn't run in this checkout (missing `vitest-environment-miniflare`) — fix the harness in week 1 so every CW lands tested. Purchases are not forwarded to ODP. Visit counting is per-update, not per-visit. vuid is session-derived (W7 debt).

## 4. The build plan — internal fast path (AI-agent velocity)

| CW | Work | Depends on | Agent-days |
|---|---|---|---|
| CW0 | KV-versioned ReflexConfig + read/write API (both hosts) | — | 1.5 |
| CW1 | Multi-tenancy (key-spacing, per-tenant everything, de-Coach core) | CW0 | 5 |
| CW2 | Content catalog + snapshots + manual import adapter + provider seam | CW1 | 2.5 |
| CW3 | Content telemetry + content dims + purchase/outcome forwarding | CW2 | 1.5 |
| CW4 | Content ranker + page-level assembler + snapshot | CW2, CW0 | 2.5 |
| CW5 | Slot strategies (2 modes) | CW0, CW4 | 1.5 |
| CW6 | Regional trending (RegionTrend DO + KV publish + blend + ladder) | CW0 ∥ | 2.5–3 |
| CW7 | Visit boundaries + entry channel + vuid cutover | ∥ | 1.5 |
| CW8 | SDK extraction + content listener + docs | CW4 | 2.5 |
| CW9 | Tuning UI (⏰ folds the "3–4 days" verbal into this milestone) | CW0; CW2 | 2 |
| CW10 | Staging envs (full bindings/secrets) + auth wiring + CORS allowlist + API docs | CW1 | 3 |
| CW11 | Explain ring/debug + decision persistence + export + priors import | CW0 ∥ | 2.5 |
| CW12 | Auto-tagging pipeline + review UI | CW2; their sample | 2 |
| CW13 | S2 design doc | ∥ (paper) | 1.5 |
| CW14 | Acceptance hardening: scripted 20–30-image run, rendered-state verified | all | 2 |

**Totals:** ~32 agent-days; **critical path** CW0→CW1→CW2→CW4→CW5→CW8→CW10→CW14 ≈ **20.5 agent-days**. With 2–3 parallel lanes (CW6/7/9/11/12/13 ride side lanes): **internal-complete ~2026-08-28** (aggressive floor 2026-08-21), assuming start ~2026-07-28, one dedicated engineer driving agents, auth-model + W3 database decisions by ~Aug 15 (D1 is acceptable for October staging — W3 does not gate), and no demo-calendar crunch stealing lanes.

**Additions 2026-07-28 (PS/monetization alignment — side-lane, critical path unchanged; totals → ~37 agent-days):**

| CW | Work | Agent-days |
|---|---|---|
| CW15 | Stamp-provisioning automation: templated wrangler config + CI deploy matrix + scoping script (bindings, secrets, domain, CORS, registry config, brand tenants) | 1.5 |
| CW16 | Instrumentation kit: dataLayer/GTM adapter in the SDK emit module + tag-plan template + event-validation debug overlay (PS QA tool) | 2 |
| CW17 | Strategy pins + priority rules (CRePE rules-lane parity: per-slot pinned overrides, priority among constraints) | 1 |
| CW18 | Day-2 ops runbook: monitoring/alarm definitions (incl. "no events for N min"), per-stamp upgrade policy, incident tiers | 0.5 |

**DECISIONS LOCKED 2026-07-28 (all four recommendations accepted by Simone):**
1. **Isolation = STAMP PER CUSTOMER**: one codebase → separate worker per customer (own DO/KV/D1/queues/R2/secrets/domain); **brand = tenant inside the stamp** (logical isolation); per-customer release pinning (code-freeze friendly); CW1 tenant-agnostic core unchanged; Workers-for-Platforms = future self-serve path only.
2. **SDK = one package, two modules**: shared core (identity/session/WS+snapshot transport/auth — non-negotiable so events and decisions share one visitor ID) + emit module (auto-capture, declarative data-attrs, dataLayer/GTM adapter, explicit commerce API) + listen module (decisions, hydration); listen-only mode supported; npm + CDN; browser-first, native = later port.
3. **CRePE = contract reimplemented, NEVER a Java port**: the content engine IS the CRePE-equivalent layer; CW17 closes the rules-lane gap; reimplementation-from-first-principles keeps IP clean (no customer-engagement code in the product line).
4. **Delivery RACI = PS owns the customer-facing implementation motion** (workshops → tag plan → catalog onboarding → SDK support → tuning → launch/hypercare); solutions eng owns stamps + L2; product eng platform-only + L3. Guide = `docs/PS-Implementation-Delivery-Guide.md` (internal, customer-generic; P0–P7 playbook; PS 17–33 pd typical / 6–10 wks calendar; SOW units for monetization).

**The ~8-week gap to the external anchor is the buffer that absorbs the true long poles — customer dependencies:** content export + slot taxonomy; the SDK payload workshop (freezes CW8); dimension sign-off; their origins/network approvals (workers.dev WebSockets vs custom domain — ask their network team EARLY); Kate Spade ODP instance + mirrored segments; their integration time before the November freeze ⇒ **SDK + docs in their hands ~mid-October is the real external deadline, not Oct 31.**

### Regional trending — committed design (CW6)

Hybrid DO + D1, reusing the decay machinery verbatim (`effectiveScore` core.ts:213-216):
- **`RegionTrend` DO** (SQLite, migration v5) keyed `{tenant}:{country}-{regionCode}` (regionCode already read at routes/geo.ts:29). ~50–200 active objects per tenant market.
- **Fan-in:** each scored event fire-and-forgets `{dim, value, w, ts}` to the shopper's region DO (same `waitUntil` posture as `forwardEventToOdp`). DO keeps `(R, tLast)` per (dim, value) — identical lazy-decay invariant, τ_region in hours–days. Caps/ε-prune reuse `maxValuesPerDim`/`epsilon` (core.ts:303-319).
- **Publish:** write-coalesced (or 30–60s alarm) snapshot of the normalized trend vector to KV `trend:{tenant}:{region}`; hot path reads via the in-process version-marker cache pattern proven by `reflex:audgen:v1` (RealtimeSegmentEngine.ts:270-274) — zero per-event KV reads.
- **Blend as prior — never contaminate the personal vector** (keeps replay determinism): `score(item) = personal(item) + λ·regional(item)`, `λ = K_blend/(K_blend + Σ_d R_personal[d])`. New shopper: λ≈1 (regional trending on first paint — snapshot endpoint has request geo); engaged: λ→0. Explain records gain a `regional` driver.
- **Sparse-region fallback:** rollup ladder region→country→global (pattern: `resolveGeoRollup` cohort.ts:429-454), gated on min-event count per grain.
- **Privacy:** population aggregates only — no per-shopper data in region DOs (the pre-built answer for their privacy review). **D1 rollup** (daily cron — index.ts:126-137 stub finally used) persists region×tag×day for analytics/S2.

### Staging definition (what M3/M4 literally include)

`edge-platform-staging` with FULL bindings (today the env stanza is empty) + secrets · `kate-spade` tenant provisioned (content catalog, ReflexConfig with agreed dims, reviewed audiences, SDK key, ODP creds or ODP-off — engine is additive by design) · SDK-key-authed surface: WS `/v1/:tenant/ws`, `POST /v1/:tenant/events`, `GET /v1/:tenant/decisions/snapshot?page=` returning the doc 18 §7 contract · operator-authed surface: catalog import/activate, config read/write, audience review, priors import, decisions/explain export · versioned SDK artifact (ESM+IIFE) + integration guide · tuning UI per tenant · CORS allowlist replacing reflect-any · scripted acceptance run (the 20–30-image bar, verified on rendered state — the `/__shot` lesson) · erasure/GDPR note (`POST /reset` exists).

## 5. Risks & decision register

| # | Item | Owner | Impact if unresolved |
|---|---|---|---|
| 1 | Content export format / CMS-DAM access | Customer | Blocks real adapter + auto-tagging; mitigated: manual CSV/JSON import first — engine never waits |
| 2 | Slot taxonomy + payload workshop | Both | Blocks SDK freeze; mitigation: propose doc 18 §7 proactively, iterate |
| 3 | Dimension sign-off workshop | Customer | Registry churn in October; get it in M0 |
| 4 | W3 database (Neon/Postgres vs D1) | Leadership | D1 fine for Oct staging; undecided past ~mid-Sept delays S2 store + production telemetry (10GB cap) |
| 5 | Auth model (SDK keys + JWT vs their-security asks) | Leadership + their security | Security review can stall staging access; wire simple model early, offer the review artifact |
| 6 | workers.dev vs custom domain | Leadership + their IT | Corporate proxies sometimes block workers.dev WebSockets; ask early — DNS lead time |
| 7 | Kate Spade ODP instance + mirrored segments | ODP team + customer | Loop degrades gracefully (edge stands alone) but "durable memory" story absent from pilot |
| 8 | vuid cutover (CW7) | Us | Cross-session ODP memory silently fails per shopper — falsifies the "visit 2–3" narrative |
| 9 | Their November code freeze | Customer calendar | SDK+docs must land mid-October — treat M3, not M4, as the hard line |
| 10 | Repo is a multi-demo base | Us | Demo churn destabilizes the contract build; branch discipline + separate staging worker; consider a productization branch cut at CW1 |
| 11 | Regional-trending privacy review | Their legal | Aggregates-only answer is pre-built — surface proactively |
| 12 | Test harness broken in checkout | Us | Fix `vitest-environment-miniflare` in week 1; every CW lands tested |

## 6. Standing guardrails (applied to every artifact)

- **No August** in anything external. External anchor: end-October staging (M4); real hard line: mid-October SDK (M3). January launch = proposed, held open.
- **No internal dates/effort external.** This file is their only home.
- **No other customer names external** (HD Supply / CRePE / ASOS never appear; the delivery-engine lineage is described, not named).
- **CMAB = optional per-slot instrument** in every artifact; the engine never reads as experiment-dependent.
- **No build phases start until Simone approves the document set.** (Docs 1 & 2 are the current work product; CW0 begins only on approval.)
- Present all boundaries as *our starting interpretation*, co-design posture ("many ways to skin a cat — how do you want it").

---

🔗 External artifacts: `docs/content-personalization-design.html` (Doc 1 — Solution & Algorithm) · `docs/Tapestry-Implementation-Plan.md` (Doc 2) · sources: [16 — reflex](./16-edge-affinity-reflex.md) · [18 — content affinity engine](./18-content-affinity-engine.md) · [roadmap](../Productization-Roadmap.md) · [ODP wiring](../Coach-ODP-Wiring-Spec.md)
