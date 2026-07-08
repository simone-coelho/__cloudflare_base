# Connector Layer & Engine Spec (as-built)

**Status:** as-built, verified 2026-07-08. Supersedes the June build spec (preserved at [legacy/05-demo-build-spec-2026-06.md](./legacy/05-demo-build-spec-2026-06.md) — its connector contract shipped nearly verbatim; this doc records what actually runs, including everything the engine grew since).

---

## 1. The connector quad

All external integrations sit behind **four** named interfaces (`src/connectors/index.ts:18-23` — the original triad plus `signals`):

| Connector | Mock adapter (active by default) | Live adapter |
|---|---|---|
| `segments` | `MockSegmentProvider` — evaluates published `AudienceDef` condition trees from the shared `KvAudienceStore` via `evaluateCondition` | `LiveSegmentProvider` — **inert stub** (`NotWiredError`); its commented GraphQL shape is outdated (superseded by the live `odpLoop`, §5) |
| `audiences` | `MockAudienceAuthoring` — deterministic NL suggestion over the insight corpus | `LiveAudienceAuthoring` — inert stub (documents the Opal MCP path) |
| `decisions` | `MockDecisionProvider` — deterministic segment→module mapping (§3) | `LiveDecisionProvider` — **real** (Mode-B, §3) |
| `signals` | `MockSignalProvider` — fixture signals + real edge-geo overlay, self-labeled `simulated` | `LiveSignalProvider` — inert until a partner feed is contracted (501) |

`AudienceDef` as-built adds to the original schema: `source: 'catalog'|…`, `pinned`, `generatorHash`, `recommendedModule`, `anchorLine`, `stats` (`src/connectors/types.ts:24-38`); `AudienceStore` gained `archive()` — both in service of the catalog audience generator's diff-regeneration (doc 16 §5).

## 2. The switches (the original "one flag" is now a matrix)

| Switch | Scope | Default |
|---|---|---|
| `CONNECTOR_MODE=live` | flips the whole quad to live adapters | `mock` |
| `DECISION_SOURCE=optimizely` | flips **only** the decision seam to the real SDK — works inside mock mode (Mode-B) | `mock` |
| `OPTIMIZELY_WRITE_ENABLED=true` + token | real FX REST writes (audiences/flags/experiments) | off |
| ODP creds (`ODP_API_HOST`+`ODP_PUBLIC_KEY`) | the **ODP loop — additive, bypasses `CONNECTOR_MODE` entirely** (§5) | set |
| `REFLEX_ENABLED` | the affinity reflex kill switch | on |

Decision-seam matrix: `mock/mock` = insight-driven deterministic decisions (default) · `mock + DECISION_SOURCE=optimizely` = **Mode-B**: real `decide()` over a no-store datafile with `DISABLE_DECISION_EVENT`, degrading **per-flag** to mock when a flag is absent (`DecisionProvider.ts:354-454`) · `live` = full quad.

## 3. Decisions as-built

- **Flag surface** — `CATALOG_FLAG_KEYS` (`DecisionProvider.ts:51-57`): `hero_module`, `plp_sort`, `complete_the_look`, `promo_banner`, `journey_message`.
- **MockDecisionProvider** is not a lookup table: insight-corpus-derived `SEGMENT_MODULE` + `SEGMENT_PRIORITY` ranking + `MODULE_TO_FLAG` + `SEGMENT_TO_SORT` + `FLAG_DEFAULTS` (`DecisionProvider.ts:80-308`).
- **Reflex choreography outranks everything for hero/sort:** with `line_affinity_top` present *and* current membership, hero → `affinity_hero` (variables: module, anchorLine, affinityKey, affinityScore; ruleKey = the audience) and plp_sort → `line_first`; decay-out falls back → a **visible revert** (`DecisionProvider.ts:169-258`).

## 4. The engine pipeline (per event, `RealtimeSegmentEngine`)

```
POST /realtime/action
 1. capture → D1 demo_events (waitUntil, off-path)
 2. reflex: ReflexCore.apply(state, event, now, config)   # engine clock authoritative
 3. fresh flattened affinity attrs → qualification context (line_affinity.tabby …)
 4. local qualification: MockSegmentProvider over KV audience store
 5. ODP: maintain recent-events ring (≤10 events, ≤55 min) →
    read policy: INSTANT recent_events read on reflex membership change (~200 ms)
                 else 10 s throttle with events / 120 s idle
 6. UNION: segments = local ∪ reflex.audiences ∪ odpSeed
 7. journey stage (early/mid/late) → decideAll(CATALOG_FLAG_KEYS)
 8. respond + WS push: {segments, decisions, featureVariables, recommendations,
    sortOrder, journeyStage, affinity{dims, changed, odpConfirmed}} (+ odp receipt)
 9. waitUntil: forwardEventToOdp (facts out) · upsertOdpProfile on membership change
```

State (session + reflex + odpSeed + ring) rides KV `SESSIONS` (`SessionManager.ts:12-18`) — relocating into a per-shopper DO is the planned P2 (doc 16 §6). `PersonalizationUpdate` gained the `affinity` envelope and the `odp_receipt` type (`PersonalizationWebSocket.ts:4-25`).

## 5. The ODP loop — first-class, NOT behind `CONNECTOR_MODE`

`src/services/odpLoop.ts` (live-verified): event forward to `/v3/events` (flattened `product_*` fields; internal signals never leave the edge), the `recent_events` GraphQL seed against the **mirrored audience names**, the `/v3/profiles` affinity-score upsert, `vuid = SHA-256(sessionId)` dashless 32-hex. Deliberately additive: gated solely on creds; failure degrades to pre-ODP behavior. Details: [ODP wiring spec](../Coach-ODP-Wiring-Spec.md) · [recent-events reference](../ODP-Recent-Events-Reference.md).

## 6. File ownership

`src/connectors/` (quad + types + store + evaluateCondition) · `src/reflex/` (core + generator + tests) · `src/services/RealtimeSegmentEngine.ts` (pipeline) · `src/services/odpLoop.ts` (ODP) · `src/services/optimizelyFx.ts` + `experimentFx.ts` (gated writes) · `src/routes/realtime.ts` (ingest/WS/reflex snapshot) · **the storefront is a purpose-built app** (`public/storefront.html/.js`) — *not* a reskin of `visual-demo.html`, which remains the banking demo.
