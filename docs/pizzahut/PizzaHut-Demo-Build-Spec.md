# Pizza Hut Demo — Build Specification

**Status:** INTERNAL · 2026-08-11 · Based on a file:line audit of the codebase (read-only pass). Register: every claim here is checkable in the repo.
**Prime directive:** this repo hosts multiple demos. The Coach storefront and every other surface keep working, byte-identical, throughout. Nothing is deleted, nothing is overridden.

---

## 1. Route & surface — the cheap part is genuinely cheap

- **`/restaurant` is free.** No Hono route serves the storefront today — `public/storefront.html` is auto-served by the static-assets layer (`wrangler.toml [assets] directory="public"`, auto html handling). Dropping `public/restaurant.html` + `public/restaurant.js` claims the route with **zero routing code**. Nothing exists at `/restaurant` today (verified: no `pizza|restaurant` hits in src/ or public/).
- The page copies the storefront's *patterns* (WS bootstrap, event posting, affinity instrument), not its content — `storefront.html/js` are ~6,100 lines of Coach-specific UI; the restaurant page is written fresh against the same seams.

## 2. Reuse verdict (from the audit): the engine is catalog-agnostic; the wiring isn't — yet

**Reusable as-is (verified):** the reflex math core (`src/reflex/core.ts` — `DimensionSpec` registry is data-driven: `key/source/multi/derive:'band'/cuts` + per-dim `tauMs/K/thetaIn/thetaOut`; `extractTouches()` reads declared fields off any product-shaped object); the audience generator (`audienceGenerator.ts:89-139` takes any products + any config; population filter is counting); the condition evaluator; the qualification seam; journey stage; attribute accrual; WS + session plumbing (DO-per-visitor upgrade, SessionManager, reset endpoint); event ingestion + D1 capture (schema already generic); the scene-gen pipeline mechanics (R2 keys are id-namespaced — `PH-*` can't collide with `COA-*`); geo + census; FX write primitives (`experimentFx.ts` is key-parameterized and idempotent).

**Needs parameterization (the real work, all located):**

| # | Item | Where | Size |
|---|---|---|---|
| P1 | Catalog resolution is a hardwired singleton — `CatalogService` imports the Coach JSON at build time; consumers construct it bare (4 sites). Similarity kernel constants are Coach-specific (`ATTR_WEIGHTS` fields, price-band cuts 150/400, color families, complete-the-look rules) | `CatalogService.ts:17,43-77,94,189-217,256-264` + 4 construction sites | M |
| P2 | Reflex config selection is a code constant — `DEFAULT_REFLEX_CONFIG` referenced at 11 host sites; needs `configFor(surface)` | `core.ts:150-188`; RealtimeSegmentEngine ×6; ShopperReflex ×5 | S–M |
| P3 | Engine surface-awareness — pick catalog + config + flag-key set per event; cheapest honest key = the client's existing `source` field on every event | `realtime.ts:62`; engine ctor + decide/recs paths | M |
| P4 | **DO drops unknown product IDs** — with `REFLEX_HOST='do'`, every PH menu id is rejected at the trust gate; session host degrades silently (zero touches) instead | `ShopperReflex.ts:368-386`; `RealtimeSegmentEngine.ts:364-372` | S (blocker until done) |
| P5 | Audience generation host hardcodes Coach catalog + one **global version marker** | `RealtimeSegmentEngine.ts:262-279` | S |
| P6 | Decision anchor dimension hardcodes `line` — PH's anchor is `recipe` | `DecisionProvider.ts:178-189`; `audienceGenerator.ts:131` | S–M |
| P7 | Scene prompts say "Coach ${name}" / exact-bag fidelity; catalog gate uses the Coach import | `sceneGen.ts:18-31,90-91` | S |
| P8 | Client identity + reset are origin-wide (`opt_visitor_id` localStorage; `opt_*` cookies at `Path=/`) | `storefront.js:144-152,3038-3047`; `SessionManager.ts:245` | S |
| P9 | Experiment readout URL hardcodes `/storefront` | `experimentFx.ts:274` | XS |

## 3. Collision risks → named mitigations (the isolation contract)

| Risk | What happens if ignored | Mitigation |
|---|---|---|
| **Audience-generator ping-pong (sharpest trap)** — regeneration *archives every catalog-sourced audience not in the current generated set*; alternating Coach/PH passes over one store+marker would archive each other's audiences on every flip (`audienceGenerator.ts:189-202`; marker `reflex:audgen:v1`) | Both demos' affinity audiences flap dead | Per-catalog marker key + catalog tag on generated defs (archive loop filters to same catalog); `ph_` prefix in audience keys |
| **Shared identity = shared reflex state** — `opt_visitor_id` is origin-wide; `opt_session_id` cookie (`Path=/`, HttpOnly) wins session resolution; both catalogs share dimension keys (`category`, `priceBand`) | One browser on both pages merges a handbag vector with a pizza vector | Restaurant page mints its own `ph_visitor_id` + posts with `credentials:'omit'` (Coach session cookie neither sent nor overwritten); engine's userId fallback resolves the PH session. Cleaner later: per-surface cookie prefix |
| **"New Shopper" nukes both demos** — reset expires all `opt_*` cookies at `Path=/` and deletes the shared session | Presenter resets one demo, kills the other | PH page gets its own "New Diner" reset clearing only `ph_*` keys (automatic once identity is split) |
| **Coach decisions/recs leak to PH sessions** — counter-based Coach seed audiences qualify PH visitors; decide path pushes Coach modules ('Tabby' anchors) + Coach recs | Pizza demo shows handbag content | Per-surface flag-key set + catalog (P3); interim: restaurant.js renders from `affinity` only, ignores `decisions/recommendations/sortOrder` |
| **DO trust gate** (P4) | PH events silently dropped in 'do' mode | Surface-aware catalog at the lookup; until then run PH on the session host |
| **ODP pollution** — the env-gated forwarder would send restaurant events into the retail demo's ODP instance | Cross-vertical garbage in a live instance | Forwarder keyed to **surface-scoped credentials**: restaurant dispatch reads `RST_ODP_*` only (absent in v1 → dormant), never the retail creds. Capture in D1 is unconditional; flipping ODP on = setting the creds |
| **demo_events mixing / operator reset scope 'all'** | Analytics cross-talk; a global reset wipes both demos' runs | Tag PH rows via `source`; always reset by `demo_run_id` |
| **Global mode switches** (`DECISION_SOURCE`, `CONNECTOR_MODE`, `REFLEX_HOST`, `REFLEX_ENABLED`) flip both surfaces | A Coach-driven config change alters the PH demo mid-pitch | Accepted for v1 (documented); per-surface overrides if it ever bites |
| **Opal chat thread shared** (`opal-session-id` origin-wide) | Cross-demo chat history | PH page uses its own storage key (DO keying is already per-session) |

## 4. The build list (ordered; engine → visible → depth)

| # | Item | Size |
|---|---|---|
| 1 | `src/data/restaurant-menu.json` (+ `public/data/` copy): ~40–60 items, IDs `RST-*`, Italian-American menu (pepperoni centerpiece per the habit story), axes `category/recipe/crust/toppings[]/daypart[]/price_usd/image_url`, `_meta` header per the Coach convention | S |
| 2 | `PH_REFLEX_CONFIG` (new `src/reflex/configs.ts`): dims `category`, `recipe` (slow τ — the habit axis, exactly the priceBand-override pattern), `crust` (slow), `toppings (multi)`, `daypart (multi)`, `priceBand (derive:'band', cuts:[8,15])` | S |
| 3 | Surface resolution: `catalogFor/reflexConfigFor/flagKeysFor(surface)` threaded through engine ctor, reflex block, decide, recs, and the DO ingest — the core enablement (P1–P4, P6) | M |
| 4 | Per-catalog audience generation (marker + scoped archive — kills the ping-pong trap) | S |
| 5 | `public/restaurant.html` + `restaurant.js`: shell, menu grid, WS bootstrap, event posting, affinity instrument, `ph_visitor_id`, own New Diner reset, `credentials:'omit'` | L |
| 6 | Menu images `public/images/RST-*.jpg` — sourced from Pizza Hut's public product photography (private demo; provenance internal) + AI-generated fillers; 74 Coach files show the path convention; scene-gen reads references from this path | S |
| 7 | `scripts/generate-ph-data.mjs`: deterministic synthetic orders (Mulberry32 pattern) with **reorder-habit sequences** (same-recipe repeats + occasional exploration), daypart-weighted timestamps, geo spread. D1 `ph_*` tables only if the Opal/aggregate chapter is wanted — the live reflex demo runs without them | M |
| 8 | Food scene prompts + surface-aware catalog gate in scene-gen (if AI food photography is in scope) | S |
| 9 | **ODP wired-dormant** (the flip-a-switch requirement): reuse the odpLoop pattern with **surface-scoped credentials** (`RST_ODP_API_HOST` / `RST_ODP_PUBLIC_KEY`, absent by default). Events are ALWAYS captured in D1; the outbound forwarder + seed reader exist and no-op cleanly without creds; setting creds (+ a dedicated instance from the ODP team) turns the loop on with zero code changes. Restaurant events must never use the retail demo's credentials | S |
| 10 | Decision-anchor dim per surface (`recipe`) | XS–S |
| 11 | **Menu Search + Table Concierge**: port the retail `/ai` search + concierge routes to surface-aware grounding (menu catalog + live affinity vector in the prompt context), restaurant-tailored prompt templates ("feeding six, game night, ~$50" → priced one-tap order; pairing mode; dietary gates as eligibility), answers cite explain-record references | M |
| 12 | Widget UI on `restaurant.html`: header search + floating "Ask the kitchen" concierge, both ending in actionable carts | S–M |

Items 1–4 make the engine honest for a second catalog; 5–6 make it visible; 7–10 deepen the story.

## 5. Experimentation setup (the "new project" answer)

The code reads two independent credential sets:
- **Decision reads:** `OPTIMIZELY_SDK_KEY` + `OPTIMIZELY_DATAFILE_URL` (datafile cached per SDK key), active when `DECISION_SOURCE='optimizely'` — note the switch is global today.
- **Writes:** `OPTIMIZELY_API_TOKEN` + `OPTIMIZELY_PROJECT_ID` + `OPTIMIZELY_ENVIRONMENT`, gated by `OPTIMIZELY_WRITE_ENABLED` (`fxEnv.ts:9-27`), REST against `flags/v1/projects/{id}`.

**Recommended: a dedicated Pizza Hut FX project** — own project ID, SDK key, datafile URL — surfaced as a second env-var set (`PH_OPTIMIZELY_*`) with `fxConfig(env, surface)` and a surface-keyed `OptimizelyService`. The cheaper-but-dirtier alternative (shared project, `ph_`-prefixed flag keys) collides with the unprefixed module-slot flags (`hero_module`, `plp_sort`) and muddies results — avoid. Mock mode needs no credentials and works day one (with the interim render-from-affinity-only rule until P3 lands).

**Project creation: Simone is creating the FX project (2026-08-11).** Engineering needs handed back: **Project ID · SDK key** (datafile URL derives: `cdn.optimizely.com/datafiles/{sdkKey}.json`) **· environment key · API token** with flag/experiment scope **· bandit availability confirmed** on the new project. Wired as the `PH_OPTIMIZELY_*` second env-var set per above. The code path for creating flags, A/B, MAB, and CMAB rules against the real API is already proven.

## 6. Data & assets

- **Catalog:** representative menu, third-party-sourced prices marked representative; refresh named deals the week of any showing (their constructs rotate and are channel-locked).
- **Synthetic history:** the generator must encode the *thesis* — heavy same-recipe repeat sequences punctuated by exploration events and lapses — so the habit/wander/lapse beats have true signal to find, at human navigation pace (beats are verified at human pace, on rendered state, per house rules).
- **Images:** AI food photography via the existing pipeline (model + R2 flow already in place; add food prompt templates), human-eye QA for cheese/pepperoni artifacts; brand chrome from press assets or de-branded — never generated.

## 7. Definition of done (demo-ready)

1. `/restaurant` renders with market-aware cold start (real geo), generic hero.
2. Three same-recipe interactions → affinity bars fill → audience chip lights ("Pepperoni Lover's Regulars") → hero flips to Your Usual. Verified on rendered state.
3. Exploration browse → Wander Mode swap. Time-warp → decay exit + win-back hero (entry AND exit both shown).
4. Daypart flip (clock control) changes the same URL's composition.
5. Pins + gates demonstrably outrank the engine (Protected Hero), explain record visible for every slot.
6. One live experiment (hero bandit) created against the real FX project from the operator surface.
7. Coach storefront regression: full existing demo run passes, byte-identical behavior, with a restaurant session active in another browser — no crossover in either direction (the §3 mitigations proven, not assumed).
8. Menu Search answers a constraint query ("spicy but light, one gluten-free") with eligibility-gated, affinity-ranked results; the Table Concierge turns "feeding six, game night, ~$50" into a priced one-tap order — and its picks cite the same explain records the inspector shows.
9. Events verified end-to-end with ODP dormant: every interaction lands in D1 capture; the forwarder no-ops cleanly with no creds set; setting test creds (staging) activates dispatch with zero code changes — the flip-a-switch requirement demonstrated, not asserted.
