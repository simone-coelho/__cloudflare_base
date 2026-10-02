# Demo Bootstrap

**For:** an engineering team or agent team taking over the demos in this repository, with none of the history.
**Answers:** what demos exist, what each one is for, what it proves, how it was built, how to run, verify and
deploy it, what is real and what is representative, where we are going, and how to build the next one.

Everything below was checked against the running workers and the code on 2026-09-30. Where a claim comes from a
document rather than a measurement, the document is named.

---

## 0. Four rules before you touch anything

1. **There are two demo workers, and plain `npx wrangler deploy` from the repo root breaks three demos.**
   `wrangler.toml` names the shared worker, so a plain deploy ships today's code onto it, and today's code
   cannot run Coach, Bright Hour or Meridian. This happened on 2026-09-23 and went unnoticed for a week. Use the
   commands in §9 and nothing else.
2. **Verify through the APIs, never the pages.** Throughout that week every demo page returned 200 while the
   APIs behind it returned 404 and 403. A 200 on a static page proves only that a file exists.
3. **The page never ranks.** A demo sends events and renders what the engine decided. A beat that only works
   because of page JavaScript is a claim the product cannot keep. (Owner's ruling, 2026-09-04: "a realistic
   representation of what exists, not smoke and mirrors.")
4. **Every figure on stage is real or labelled.** There is no third option. §7 is the grid.

The rules for the workers themselves are also in `AGENTS.md` → "The two demo workers", which every agent loads.

---

## 1. What this repository is

A real-time **edge personalization platform** on Cloudflare Workers, built for Optimizely, and the set of
customer demos that run on it. One codebase, several demos, and a productised engine — the **content decision
service**, sold to Tapestry as *Behavioral Targeting and Intelligence* (BTI) — that the newest demos run on.

The repo is a base for many demos. Documents about one demo are not superseded by another demo's documents;
the banking demo's guides, for example, are current for the banking demo. Never delete or archive a document
because it belongs to a demo you are not working on.

---

## 2. The demos at a glance

| Demo | For | URL | Code | Engine | State |
|---|---|---|---|---|---|
| **Coach / Tapestry** storefront | Tapestry (Coach), our contracted customer | [`/storefront`](https://edge-platform.expedge.workers.dev/storefront) · operator console [`/operator-console`](https://edge-platform.expedge.workers.dev/operator-console) | `src/` core, `public/storefront.*`, `public/operator-console.*` | Generation 1 | Live, shared worker |
| **First National Bank** | Lead-gen banking; the oldest demo | [`/visual-demo`](https://edge-platform.expedge.workers.dev/visual-demo) | `public/visual-demo.*` | Generation 1 | Live, shared worker |
| **The Bright Hour** | QVC, first demo: live shopping | [`/live/`](https://edge-platform.expedge.workers.dev/live/) · Offer Desk [`/live/ops`](https://edge-platform.expedge.workers.dev/live/ops) | `src/demos/brighthour/`, `src/routes/live*.ts`, `public/live/` | Generation 1 | Live, shared worker |
| **Meridian** (on screen: **Calder**) | Opticon NYC, CEO session, retail + banks | [`/meridian/`](https://edge-platform.expedge.workers.dev/meridian/) | `src/demos/meridian/`, `public/meridian/` | Generation 1 fork | Live, shared worker |
| **Top Offers** (Lantern & Lane) | QVC, their number one use case | [`/top-offers/`](https://edge-platform-top-offers.expedge.workers.dev/top-offers/) | `public/top-offers/`, `src/routes/topOffers.ts`, `scripts/seed-shn.mjs` | **Generation 2** | Live, **own worker** |
| **Vantage** | Verizon, a lighthouse conversation about affinity for the anonymous shopper | [`/vantage/`](https://edge-platform-vantage.expedge.workers.dev/vantage/) | `public/vantage/`, `src/routes/vantage.ts`, `src/routes/vantageColdStart.ts`, `scripts/seed-vantage*.mjs` | **Generation 2** | Live, **own worker** |

Only two demos live in `src/demos/`. Coach is the repository's core, and Top Offers is built on the product
engine rather than a demo fork. `src/demos/README.md` maps all five.

**The Meridian/Calder split.** Code, routes, files, storage prefixes and most documents say **Meridian**
(`meridian/`, `mrd_`). The projector and the newest presenter documents say **Calder** (Calder & Co. retail,
Calder Financial bank). The brand moved because real Meridian banks exist; the code namespace deliberately did
not (`docs/opticon/Opticon-Task-List.md`, decision D12).

**The bare domain** (`/`) is the 2025 platform page. It predates every demo above and links to none of them.

**Pursuits without a demo.** Pizza Hut (`docs/pizzahut/`: proposal, use cases, research and a build spec for a
`/restaurant` surface; tabled 2026-08-18, never built), the New York Times (`docs/nyt/`, research only), Verizon
Media (`docs/Verizon-*`, perspective and dossier) and ASOS (`docs/ASOS-*`, offered the content engine).

---

## 3. Why there are five different demos

They are not five versions of one demo. Each was built for a different room, to prove a different thing, and
each deliberately leaves things out.

| Demo | The room | What it proves | What it deliberately does not do |
|---|---|---|---|
| **Coach** | Tapestry's team, against Dynamic Yield | Breadth: edge decisions under 50 ms for an anonymous shopper, in-session, plus a merchandiser creating a live audience in plain English through Opal. Fifteen beats and a TikTok encore. | Hide density. The owner's own diagnosis: it lost the room on **density, not quality** — changes competed for attention. That lesson shaped Meridian. |
| **First National Bank** | Early prospects | **Attribution**: one action, one visible change, in one place, so the room holds the cause. | Anything at scale. It is the structural ancestor of Meridian's layout. |
| **The Bright Hour** | QVC, displacing Adobe Target | **Decisioning under expiry**: offers that live hours to days, a new offer born and ranked with no history, the page reading the window field QVC already populates. | Recommendations, and urgency theatre. QVC deliberately hides countdowns and scarcity; the demo enforces a banned-vocabulary list. |
| **Meridian** | ~30 retailers and banks at Opticon | **Agnosticism, demonstrated**: one brand, two businesses, and a live vertical swap where the same eight instrument bars stay on screen while only their labels change. **Legibility over density.** | Let anything move without a press. The page is frozen between actions and engine time advances only when the presenter acts. |
| **Top Offers** | QVC's merchandising and engineering team | **Their literal requirement, on the product**: a four-container module filled from a pool of promotions, the visitor earning it, a merchandiser's day of real publishes, a weather rule, a page reorder, and the click report. | Products. The pool is promotions, because Constructor already owns product discovery at QVC and a product grid argues on the incumbent's ground. |
| **Vantage** | Verizon's digital and personalization people, shown what the engine does rather than sold anything | **The moment before identity**: a stranger served from the first paint on an ad click, the region's own sales and her OS family; the page following her away from the ad; a phone page whose modules reorder around her intent while the buy box stays off limits; the merchandiser's pin and availability rule visible as overrides; receipts behind every card. Fifteen beats in Verizon's colours with real phones. | Price, financing or credit. Nothing geographic beyond availability. No claim that the deals module reorders when a claim decays. No "more upgrades", no lift number, no critique of the systems they run today. |

The practical consequence: **reuse the patterns, never the pitch.** A new customer gets a demo built from their
own words (§12), not a reskin of whichever demo is newest.

---

## 4. The two engine generations — the one architectural fact you must know

Everything in the demos runs on one scoring model: an interest per dimension value, `a = R / (R + K)` with
`K = 1.8`, decayed continuously as `R · exp(−Δt / τ)`, entering an audience at `a ≥ 0.60` and leaving it at
`a < 0.45`. `R` is the decayed count of touches, `K` is how much evidence is needed before an interest is
believed, and `τ` is the memory length, set per dimension. That arithmetic lives in `src/reflex/core.ts` and is
shared by every demo. What differs is everything around it.

**Generation 1 — the reflex and the shared demo pipeline.** The affinity vector, the catalog-driven audience
generator, product ranking in `CatalogService`, the realtime socket, the Opal agent, and experiment surfaces
that create real A/B, MAB and CMAB rules in Optimizely. A surface registry (`src/demos/registry.ts`) routes
`coach` and `brighthour` through it. Coach and Bright Hour run here. Meridian runs a **fork** of every stateful
part and imports only the pure math (`src/demos/meridian/README.md`, the isolation charter).

**Generation 2 — the content decision service.** Tenants with their own keys; a shopper-session capability on
every shopper call; explicit, owner-issued consent records; retention policies per data category; versioned
configuration documents (catalog, slots, learn, reflex) published through a publication set; eligibility rules;
a decision ledger with served and rendered measurement bases; hourly folds and day reports; holdouts; assisted
learning; and design-time, human-reviewed attribute enrichment. `GET /v1/:tenant/decisions/snapshot` is its
front door. This is what the Tapestry contract ships and what the remediation programme hardens (`AGENTS.md`,
`docs/remediation/`). **Top Offers runs here.**

**Why they cannot share a worker today.** Generation 2 requires a shopper session on every shopper call, and the
Coach storefront and Bright Hour pages never create one. Under `AUTH_MODE=enforced`, Generation 2 also refuses
Generation 1's demo roots (`/meridian/api`, `/live/api`, `/geo/cohort`, `/ai`, `/agents`, `/experiment`,
`/signals`, `/funnel`). So the shared worker runs commit `26e2db1` — the version all four older demos were built
and rehearsed on — and Top Offers has its own worker.

**Direction:** new demos are built on Generation 2, because that is the product customers buy.

---

## 5. Demo by demo

### 5.1 Coach / Tapestry

**Story.** A live Coach storefront. An anonymous shopper gets individual personalization at the edge, and an
operator talks to Opal in plain English to query data, build audiences, launch experiments and fix revenue
leaks. North star, as written for the account: (A) the anonymous shopper is personalized in-session in under
50 ms; (B) a merchandiser's plain-English audience goes live on the storefront.

**Arc.** Fifteen beats through a Demo Director, each posting a *Signal → Segment → Decision* card with a
before/now Compare: profile without sign-in, cold start, real-time hero change, recommendations, baseline sort,
personalized sort, page structure, page content, journey stage with the buy signal, Opal audience builder, A/B,
MAB, CMAB, AI search and the AI style concierge. The encore is the **Signal-Led Moment**: a TikTok trend
detected, a hero generated live from the real product image, served, and optimized by a real multi-armed
bandit. Also: the **geo-cohort cold start**, which paints a first-time visitor's page from the retailer's own
purchases in their metro plus free census income — the first-party answer to Dynamic Yield's
Mastercard-powered geo cold start.

**Read first.** `docs/DEMO-MASTER-PLAYBOOK.md` (how to run it; the honesty grid; Opal's tools and prompts),
`docs/Tapestry-Coach-North-Star-Brief.md`, `docs/architecture/12-signal-led-moment-build-brief.md`,
`docs/architecture/13-geo-cohort-coldstart-prd-tdd.md`, `docs/EXPERIMENT-SURFACE-RUNBOOK.md`,
`docs/REVENUE-RADAR-PRESENTER-GUIDE.md`.

**Landmines.** Opal's writes to Optimizely happen only with `OPTIMIZELY_WRITE_ENABLED="true"`; with it off,
audiences and flags render nothing ("stubbed" is not "simulated"), while experiments still render their
representative readout. A new flag takes 20–30 seconds to reach the storefront through the datafile. The SDK
transport exists behind `?sdk=1`; flipping the default is the presenter's decision after a rehearsal, never an
engineer's. The TikTok takeover renders only on a real gesture with creative attached, because the Opal chat
island replays its stored thread on every load.

### 5.2 First National Bank

The 2025 banking demo at `/visual-demo`, and the one that established the rule the others inherit. It works
because of attribution — one action, one visible change, one place. Architecturally, its beats swap from a
local table and never wait on the network, so conference wifi cannot stall a visual. Meridian adopted that
deliberately. Read `docs/SOLUTIONS_ARCHITECT_GUIDE.md` (§4–6) and `docs/DEMO_EXPLANATION.md`.

### 5.3 The Bright Hour (QVC, first demo)

**Story.** A fictional live-shopping retailer built on **QVC's own published product schema**, mirrored field
for field, because the posture is "this uses a field you already have". The frame is **decisioning under
expiry**: Adobe Target's own documentation needs about fifteen days live before its insights arrive, and QVC's
offers are gone in hours to days.

**Arc.** Nine beats, driven by the Demo Director: the anonymous stranger, governance and quota, a second
shopper, **a new offer is born** (the centrepiece: ingest, AI tags, human approve or edit, window opens,
per-visitor ranking diverges, expiry, automatic succession, the exported row), time passes, sold out
mid-session, the glass box, an experiment on top, and the receipts.

**Data.** 77 items, 9 dimensions — including host affinity, session mission and media affinity, which exist in
no other vendor's model because nobody else models the host. Offer windows are stored as **offsets from a demo
epoch**, never as timestamps, so the same file stages a live hour on whatever day a presenter opens it: scale the
clock, never fake the stamps. The data contract and its ten invariants are in `src/demos/brighthour/README.md`.

**Read first.** `docs/qvc/BrightHour-Demo-Runbook.md` and `BrightHour-Cheat-Sheet.md` — the best presenter pair
in the repository, with a fresh-start checklist, an offline mode (`?mock=1`) and an "if something goes
sideways" page. Then `BrightHour-Engine-Explainer.md` and `QVC-Demo-Design-Brief.md`.

### 5.4 Meridian — "Calder" (Opticon)

**Story.** Run **outside-in**: the ecosystem first, the page second, the engine third. The visitor opens an
email, taps a TikTok ad, signs up by text, fills a partner's form — and a real system has already started deciding
before she lands. **The hinge:** the campaign said handbags; she starts looking at wallets. The page has to decide
whom to believe, the marketer who bought the click or the person on the site now. Then the catalog swaps from
retail to a bank, and the same instrument keeps working.

**Arc.** Six acts, about forty minutes: the frame, the arrival, the handoff and the session, the operator (Opal
and experimentation), the business, and the moment. The strongest single beat is the **unprompted exit**: the
presenter stops touching the page, and about fifty seconds later it changes on its own as an interest decays
below the exit threshold. **As built, the page draws that exit from its own clock** (`public/meridian/meridian.js:1358-1367`,
`:2966-2987`) and discards the server's frames; `MeridianReflex` does fire the closed-form alarm and push, but the
page does not use it (read from the code on 2026-09-30, `docs/verizon/Vantage-Demo-Design.md` §5). Say the beat as
the engine's decay arithmetic re-asked on a timer, never as an alarm-driven push. The object host also stalls its
ledger consumer under a burst of snapshots (same finding), so new demos run the session host until that is fixed.

**Stage rules the owner set** (`docs/opticon/`, and the charter): nothing changes without a press; engine time
advances only on the presenter's acts ("let two minutes pass" is a button); the director performs beats through
a visible cursor; the reason is always visible; test at 1440×800 and 1366×768, not only 1920×1080; green means
promoted and nothing else.

**Read first.** `src/demos/meridian/README.md` (the isolation charter — its five rules are binding),
`docs/opticon/Opticon-Run-Of-Show.md`, `Opticon-Controls-Guide.md`, `Opticon-Talk-Track.md` (generated by
`node src/demos/meridian/build-talk-track.mjs`; do not hand-edit), `Opticon-Presenter-Companion.md`.

**Hooks.** `?prompter` shows the presenter's line on the director bar; `?debug` exposes the state as
`window.__S` and the beat driver as `window.__goBeat`; `?region=`, `?zip=`, `?city=`, `?country=` override the
cold start's location for rehearsing a region you are not in.

### 5.5 Top Offers — Lantern & Lane (QVC, their number one use case)

**Story.** QVC stated it plainly on 11 and 22 September: a four-container homepage module filled from about
twelve promotions (growing to twenty), each live three to seven days, judged on clicks into the module.
Lantern & Lane is a fictional retailer; the tenant is `shn`. The pool is **promotions, not products**, matching
the visual QVC's team shared.

**Arc.** Fifteen beats in five acts, and the director bar names the act on screen:

| Act | Beats | What happens |
|---|---|---|
| 1 · The visitor earns it | 1–5 | QVC's defined defaults hold for four presses; the rule (five lifetime pages) releases them; cooking interest crosses the threshold and the department cap holds it to two containers |
| 2 · The merchandiser's day | 6–10 | A window closes; a new promotion reaches the module with no history; Final Hours creative on the same id; a promotion weight; a pin |
| 3 · Location and weather | 11–12 | Snow in Washington makes a winter promotion eligible; the same visitor in Florida loses it |
| 4 · Garrett's page questions | 13–14 | The module moves to position one and the four do not change; `take: 2` renders two of the same ranking |
| 5 · The metric | 15 | Clicks, and the per-promotion report, labelled attribution, not incrementality |

**How it is built.** Every merchandiser beat is a **real versioned publish** to the tenant's configuration. The
page holds no credential: it names a beat, and `src/routes/topOffers.ts` applies it, minting a genuine 60-second
operator token and going through the ordinary pipeline. That route exists only on a demo-profile worker and
accepts a closed list of beat names and no document. Predict-then-prove explains any beat on demand, before or
after. The neighbouring homepage blocks are marked "not personalised" because exactly one module on the page is
decided per visitor — that boundary is the point.

**Engine changes it brought, all general.** `eligibleWhen` on a piece (regions and named conditions, failing
closed, evaluated before scoring); the offer envelope made opt-in, which had been suppressing served-decision
capture for every caller; and `POST /ops/demo-bootstrap`, which creates a demo tenant's publication set once and
refuses everywhere else.

**Read first.** `docs/qvc/QVC-Top-Offers-Demo-Script.md` (the presenter script, every beat attributed to the
QVC ask it closes, with the honesty ledger inline), `docs/qvc/RESUME-top-offers.md` (operations), and
`docs/qvc/QVC-Use-Cases-and-Engine-Fit.md` (QVC's requirements line by line against the code).

---

## 6. Imagery — how every demo got its pictures

One principle runs through all of it: **pictures are generated or sourced at design time, inspected, and
committed. Nothing is generated on the serving path**, except where generation is itself the beat and is shown
honestly with its progress.

| Demo | Source | How |
|---|---|---|
| Coach | Coach's own product photography | Tapestry is the customer, so its real catalog is appropriate *for its own demo*. The Signal-Led Moment hero is generated live from the real product image through `/ai/scene`, with honest progress states, because the generation is the beat. |
| Bright Hour | 77 packshots, `gemini-3.1-flash-image` | `scripts/generate-bh-images.mjs`: one locked recipe per category, a human-standard defect check on every image, and a deliberate placeholder wherever the gate fails. The target was never 77 of 77; it was **zero bad images shipped** (`docs/qvc/BrightHour-Imagery-QA.md`). |
| Meridian | 40 packshots | `build-images.mjs` then `normalise-images.mjs` (uniform apparent product size). One prompt family on a pure white ground gives coherence by construction; forty stock photos from forty photographers read as a mood board. Paired products must be named as pairs in the prompt (the QA gate caught "earrings" rendered as a pendant). |
| Top Offers | Editorial promotion art, 3:2 | `scripts/generate-shn-art.mjs`, including a Final Hours variant; a missing image renders a placeholder, never a broken tag. |

**Rules for any new demo's imagery:** never real brand marks or another company's photography in a demo shown
to a different company (a public dataset of Amazon product photos was rejected for Meridian because a
competitor's logo was legible on the first image); split by category and curate, never promise "all AI"; the
owner distrusts unreviewed generated imagery, so every image passes a gate a person could defend.

**One exception, ruled by the owner on 2026-09-30 for the Vantage (Verizon) demo:** the products the customer
itself sells may appear under their real names with their makers' own renders (a carrier sells iPhones and Galaxys;
a fictional phone reads as a toy). Provenance, source hash and a by-eye verdict per file live in the demo's
`img/MANIFEST.json`, and legal confirms before any public or recorded use. The rule against another company's brand
assets stands for everything else, and the customer's own logo is never used: its colours only.

---

## 7. What is real and what is representative

| Real, and safe to demonstrate | Representative — say so, or cut it |
|---|---|
| The affinity arithmetic, audience entry and exit, and the audiences minted from catalog vocabulary | Experiment lift and confidence figures, and CMAB per-context "winners" |
| Real Optimizely audiences, flags and experiment rules, created through the REST API (Coach, Meridian) | Traffic volumes, funnels and revenue figures from simulated sessions |
| Generation 2's decisions, versioned publishes, eligibility, holdouts and click attribution (Top Offers) | Any claim of lift on a customer's own traffic — **never** |
| Edge geography, and the census data behind the cold start | Top Offers' day report counts are real attribution, but not incrementality; the customer's warehouse computes lift |

**Claims never to make:** that the engine creates a bandit, learns and declares a winner by itself (that was the
Signal-Led Moment on Optimizely Experimentation, and this engine's Thompson mode is withdrawn); "under 200
milliseconds" (a first-time shopper's decision is about 235 ms at the median, a known one tens of
milliseconds); "no limit" on offers; that replay is exact for a multi-slot page (it is exact for one slot); any
customer's name to another customer; any case study that does not exist.

---

## 8. Running the demos locally

```bash
npm install
# .dev.vars — there is no template; the keys are below
```

| `.dev.vars` key | Needed for |
|---|---|
| `GEMINI_API_KEY` | Opal chat and `/ai/scene` image generation |
| `SHOT_TOKEN` | the `/__shot` headless-screenshot route; unset means the route does not exist |
| `TENANTS`, `SDK_KEYS`, `RETENTION`, `JWT_SECRET` | Generation 2 (Top Offers): tenant registry, site keys, retention policy per data category, operator signing |
| `ODP_*`, `OPTIMIZELY_*` | live ODP and live Optimizely writes; everything runs without them |
| `DEMO_REMOTE_JWT_SECRET` | minting the seed token for the **deployed** Top Offers worker; nothing reads it automatically |

A fresh clone needs the local D1 database once (this checkout already has it):

```bash
npx wrangler d1 migrations apply coach-demo-db --local
for f in migrations/seed/seed_*.sql; do npx wrangler d1 execute coach-demo-db --local --file "$f"; done
```

Then **one at a time** — both use port 9100:

| To run | Command | Open |
|---|---|---|
| Coach, Bright Hour, Meridian, the bank demo | `bash scripts/deploy-legacy-demos.sh --dev` | `/storefront`, `/live/`, `/meridian/`, `/visual-demo` |
| Top Offers | `npm run dev`, then seed it (`docs/qvc/RESUME-top-offers.md`) | `/top-offers/` |

`npm run dev` runs **today's** code, which cannot run the three older demos; that is why the legacy command
exists. Verified on 2026-09-30: every older demo's API answered, the Meridian rehearsal passed 18 of 18, and the
isolation suite passed 10 of 10 with Coach's pipeline included.

**Local gotcha:** `wrangler dev` snapshots its static-asset list at startup, so a file newly added under
`public/` returns 404 until the dev server restarts. It has cost an hour more than once.

---

## 9. Deploying

| Worker | Runs | Deploy with |
|---|---|---|
| `edge-platform.expedge.workers.dev` | Coach, bank, Bright Hour, Meridian — commit `26e2db1` | `bash scripts/deploy-legacy-demos.sh --deploy` |
| `edge-platform-top-offers.expedge.workers.dev` | Top Offers — today's engine | `node scripts/build-top-offers-config.mjs && npx wrangler deploy --config wrangler.top-offers.toml` (the builder delegates to `build-demo-worker-config.mjs` and renames the recovery queues; a config naming the shared `events` queue leaves the ledger unconsumed, the 2026-09-30 finding) |
| `edge-platform-vantage.expedge.workers.dev` | Vantage — today's engine, session host | `node scripts/build-demo-worker-config.mjs --name edge-platform-vantage --queue events-vantage --dev-port 9110 && npx wrangler deploy --config wrangler.vantage.toml` (from WSL); after any reseed, redeploy, then `scripts/seed-vantage-region.mjs`; details in `docs/verizon/RESUME-vantage.md` |

- **Never** `npx wrangler deploy` from the repo root (§0, rule 1).
- `npm run check:generated` must pass first: `npm run dev` rebuilds the Meridian and SDK bundles, a deploy does not.
- **A reseed of Top Offers must be followed by a deploy.** The seed re-anchors every window to now and rewrites the
  beat documents under `public/`; the worker reads those documents from its own assets when it applies a beat.
- **A new worker whose secrets were set before its first deploy may not get its crons.** `secret put` creates the
  worker as an empty draft; the Vantage worker's three crons did not fire for 66 minutes after its first code
  deploy, and `npx wrangler triggers deploy --config <toml>` attached them within seven minutes (2026-10-01). Check
  the `monitor:<tenant>:recovery` KV key after any first deploy.
- **Do not change a demo worker's secrets or settings without the owner.** Adding a tenant list to the shared
  worker once removed its implicit `coach` tenant and cut Coach off.
- A straight `wrangler rollback` of the shared worker is refused: the Top Offers period applied Durable Object
  migrations v6 and v7, and migrations only move forward. The legacy script adds empty stand-in classes for them.
- **Staging and production are customer stamps, not demo targets.** `npm run deploy staging|production` is the
  guarded customer workflow (`docs/deployment/01-deploy.md`).

---

## 10. Verifying

| After | Run |
|---|---|
| Any shared-worker change | `MERIDIAN_BASE=<base> node scripts/meridian-rehearsal.mjs` and `node scripts/meridian-isolation.mjs` — the second exercises Coach's pipeline |
| Any Top Offers change | `node scripts/rehearse-top-offers-page.mjs --base <base>` (request level) and `node scripts/rehearse-top-offers-dom.mjs --base <base>` (loads the real page script and presses the real buttons) |
| Any Vantage change | `node scripts/rehearse-vantage-page.mjs --base <base>` (request level, 115 checks; 116 when the day report reads the ledger) and `node scripts/rehearse-vantage-dom.mjs --base <base>` (the real page in a fresh browser profile, 292 checks, run from Windows with Chrome), or both at once through the kit: `node scripts/demo-kit/check-demo.mjs --config vantage --base <base>` (generated bundles, typecheck, the credential grep over everything the pages load, then the two suites); never two suites at once on one tenant, and restart a local rig after a report build. Both suites are the vertical's outcomes on `scripts/demo-kit/lib/rehearse.mjs` and `lib/cdp.mjs` (2026-10-02) |
| A Coach storefront change | `bash scripts/rehearse-storefront.sh` — drives both transports headlessly and compares them; needs `SHOT_TOKEN` |

Two hand-offs of Top Offers passed a request-level test and still failed in the browser, because both bugs lived
in the page's own JavaScript. That is why its DOM suite exists, and why "the page loads" is never evidence.

`/__shot` (headless screenshots, same-origin, token-gated) is how visual claims get verified. Assert computed
visibility and geometry, never attributes: a "two heroes" bug once passed a check on the `hidden` attribute while
both heroes were visible. `/__shot` is refused under `AUTH_MODE=enforced`, so use it against the legacy worker
locally.

---

## 11. Where we are going

- **The demo is the product.** New demos run on Generation 2 and render its decisions. A demo that paints from
  page code rehearses the wrong thing.
- **Anonymous first.** A signed-out visitor gets individual, in-session personalization at the edge.
- **The engine decides; Opal creates and explains.** No model sits in the decision path. Enrichment and
  embeddings run at design time; a live model call is acceptable only where a person expects to wait, such as a
  typed search.
- **Deterministic and auditable.** Every decision has a receipt, and the affinity is arithmetic anyone can check.
- **Merchandiser control stays visible.** Weights, pins, windows and eligibility rules; an override reads as an
  override.
- **Measurement is honest.** Attribution is not incrementality, and the customer's warehouse computes lift.
- **Tapestry's order.** Experience personalization — sequencing modules on a page — ships first, then content
  (`docs/Tapestry-BTIE-Working-Notes.md`; `docs/architecture/tapestry-requirements-extraction-2026-09-18.md`).

---

## 12. Building a demo for a new customer

What worked, in the order it matters:

1. **Start from their own words.** Extract the requirements verbatim and attribute every beat to one of them.
   `docs/qvc/QVC-Use-Cases-and-Engine-Fit.md` is the template: the ask, who said it, and what the code does.
2. **A fictional brand on their schema.** Never real marks, and never another customer's name. The brand is the
   one stable thing; the data is what is representative.
3. **Build on Generation 2.** Beats are publishes to the engine's documents — pieces, tags, weights, pins,
   windows, rules — never page code.
4. **Every beat visibly changes something, or says why it did not.** A before-and-after row, the act on screen,
   and predict-then-prove available on demand, never as a gate.
5. **Legibility over density.** Nothing changes without a press.
6. **Imagery at design time, gated and committed** (§6).
7. **No credential in the page.** The worker performs named actions for it.
8. **Two suites before anyone presents** — one at request level, one that runs the real page script.
9. **Host it where its code runs.** If it needs code the shared worker does not run, it gets its own worker, and
   the deploy is verified through its APIs.
10. **A presenter script** that maps every beat to the customer's ask with the honesty ledger inline, and **a
    resume document** a cold session can follow.

---

## 13. Document map

| For | Read |
|---|---|
| Agent rules, both workers, remediation law | `AGENTS.md` |
| Replicating the *engine* elsewhere | `ONBOARDING.md` |
| Coach | `docs/DEMO-MASTER-PLAYBOOK.md`, `docs/Tapestry-Coach-North-Star-Brief.md`, `docs/architecture/12-*`, `13-*` |
| Tapestry delivery (BTI) | `docs/BTI-Implementation-Guide.md`, `docs/Tapestry-BTIE-Working-Notes.md`, `docs/architecture/18-content-affinity-engine.md` |
| Bank | `docs/SOLUTIONS_ARCHITECT_GUIDE.md`, `docs/DEMO_EXPLANATION.md` |
| Bright Hour | `docs/qvc/BrightHour-*.md`, `src/demos/brighthour/README.md` |
| Meridian | `src/demos/meridian/README.md`, `docs/opticon/` |
| Top Offers | `docs/qvc/QVC-Top-Offers-Demo-Script.md`, `docs/qvc/RESUME-top-offers.md` |
| Vantage | `docs/verizon/Vantage-Demo-Design.md` (the governing brief and decisions log), `docs/verizon/Vantage-Presenter-Script.md`, `docs/verizon/RESUME-vantage.md`, `docs/verizon/Verizon-Use-Cases-and-Engine-Fit.md` |
| The engine's maths and design | `docs/architecture/16-edge-affinity-reflex.md`, `18-content-affinity-engine.md` |
| An earlier audit of all of this | `docs/handover/02-demo-handover.md` (2026-08-29; predates Top Offers and the two-worker split) |
