# The demo kit: design

**Governing document for the demo kit.** Opened 2026-10-01 by the lead on Simone's ruling that demos must stop being rebuilt: account executives and solutions engineers should be able to take a demo, restyle it for their customer, swap in the products and present, with an agent doing the heavy lifting. A new demo is a palette, a product feed and a set of beats, never a rebuild. Vantage is the proving consumer, the LG demo is the first new consumer, and the `/new-demo` path is what an SE uses. Decisions are logged at the end; a lane that needs a decision not logged here stops and asks.

Companion documents: [Vantage-Demo-Design.md](../verizon/Vantage-Demo-Design.md) (the chassis as built), [BOOTSTRAP.md](../demos/BOOTSTRAP.md) (operations), [LG-Understanding-and-Use-Cases.md](../lg/LG-Understanding-and-Use-Cases.md) (the first consumer), the framework lane's map in [lg-framework-map.md](../lg/research/lg-framework-map.md) (the extraction table with file and line citations).

---

## 1. What a demo is made of

Every demo since Top Offers has the same anatomy; Vantage is the cleanest instance.

| Layer | What it is | Where it lives in Vantage |
|---|---|---|
| Worker | its own worker, queue pair and tenant, generated from `wrangler.toml` | `scripts/build-demo-worker-config.mjs`, `wrangler.vantage.toml` |
| Tenant documents | catalog (pieces: promotions, heroes, modules, packages, companions, where-to-buy), slots (take, pins, diversity, weights, `eligibleWhen`), learn (dimensions with τ, K, θ; regional allowlist; retention), reflex (action weights, band cuts). Beats are versioned publishes of catalog or slots | `public/vantage/catalog.json`, `beats/*.json`, `scripts/seed-vantage.mjs` |
| Server routes, demo profile only | `/beat` (a closed list of names, a 60-second minted operator token), `/reset`, `/receipt` (own decisions only), `/report`; the cold-start route (region resolve, census, seed prior, estimate) | `src/routes/vantage.ts`, `src/routes/vantageColdStart.ts` |
| Page chassis | transport (X-Tenant, visitor minting, consent, events, ask); the director (beats, runner, presses, keyboard, `?debug ?wait ?region ?fixtures`); panels (signals and meters, why these, cold start, report); the before/now row with deltas; predict-then-prove; Compare; sheets | `public/vantage/vantage.js` and `vantage.css` |
| Vertical layer | cards, buy box, module bodies, the facts the beats speak about | the same two files, mixed in |
| Data | products with attributes, pieces, seeds, imagery with a provenance manifest, fixtures | `phones.json`, `plans.json`, `seeds.json`, `img/**`, `fixtures/**` |
| Scripts | seed (windows re-anchored to now, beat envelopes, bootstrap publish), region seed (synthetic sales for every state), imagery fetch and art, two rehearsal suites (request-level; DOM over DevTools with computed visibility), the morning routine | `scripts/seed-vantage*.mjs`, `fetch-vantage-devices.mjs`, `generate-vantage-art.mjs`, `rehearse-vantage-*.mjs` |
| Documents | design with decisions log, presenter script, resume | `docs/verizon/` |

Top Offers was copied into Vantage. The LG demo would be copy three. The kit is extraction, once, with Vantage holding its suites as the gate.

---

## 2. The kit

### 2.1 Server: `src/demos/kit/`

- `demoActionRoutes({ tenant, operator, beats, reset, reportSlots, asserted })` returns the four routes. The pure helpers lift out of `vantage.ts` unchanged (`publishedDocument`, `ownDecisionId` with the tenant prefix as a parameter, `receiptOf`, `assertedContextOf`, `assertedOf`, `reportTooLarge`) with their tests.
- `demoColdStartRoutes({ tenant, vocabulary, sentence, markerKey })`; `resolveRegion`, `censusFor` and `estimateOf` are already tenant-free.
- `src/demos/<slug>.config.ts` per demo holds only its constants; `vantage.ts` becomes that config plus a mount. `topOffers.ts` and the QVC worker are not touched by the kit lanes.
- The authority model is unchanged: demo routes mount only where `DEPLOYMENT_PROFILE` is `demo`, accept a closed set of names and no caller-supplied document, mint genuine short-lived operator authority, re-enter the ordinary route pipeline. No page carries a credential. Every page call sends `X-Tenant`.

### 2.2 Page: `public/demo-kit/`

ES modules, no DOM access at import time, each pairing with its CSS, all reading one token sheet.

| Module | Holds | Configured by |
|---|---|---|
| `transport.js` | api base, X-Tenant, visitor minting, consent, events, ask and snapshot, receipts | `{ tenant, api }` |
| `director.js` | the beats list, the runner, performed presses with the visible cursor, the keyboard, the query flags | `beats`, `facts`, `verbs` |
| `panels.js` | signals and meters, why these, cold start, report, the day's numbers | `dimLabels`, `slots`, `panels` |
| `deltas.js` | the before/now row and the moved chips, slot-keyed | `slots` |
| `prove.js` | predict-then-prove from the published registry (K, θ, τ, action weights read, never typed) | none |
| `compare.js`, `compare.css` | the page-level Compare: Seam, Side by side, What changed; a Before always exists (Lane C1) | `details` provider |
| `sheets.js` | quick look, perk and compare sheets, one overlay at a time | `renderers` |
| `tokens.css` | the brand: `--brand`, `--brand-deep`, `--accent`, `--ink`, `--paper`, `--line`, `--font`, `--mono`, radii and the director's own palette | the demo's stylesheet overrides |
| `kit.css` | director, panels, rows, compare chrome, drawn from tokens only | |
| `kit.js` | `createDemo(config)` wiring the above | `demo.config` |

The vertical layer stays in `public/<slug>/`: `index.html` and page templates, `<slug>.css` (token overrides plus the vertical's own styles), `<slug>.js` (renderers for cards, buy boxes and module bodies; the `facts` object the beats speak about; any beat verb the kit lacks), the data files and the imagery.

**Beats are data.** `public/<slug>/beats.json` holds each beat as `{ key, no, act, who, label, declare[], acts[], will[], line, run[] }`. Strings are templates over `facts` (`{{phone.name}}`, `{{storageStep.label}}`); `acts` name engine actions with attribute templates; `run` is a list of kit verbs (`open`, `click`, `select`, `wait`, `custom`, `assert`, `focus`) with one escape hatch, `call: <name>`, into the vertical's functions. An SE edits JSON; the agent generates it; the runner performs it. Vantage's sixteen beats are the proof that the vocabulary is sufficient; a beat that cannot be expressed is a kit gap, named in the lane report, never a reason to write the beat in code again.

### 2.3 Scripts: `scripts/demo-kit/`

- `lib/seed.mjs` (windows re-anchored to now, beat envelopes, bootstrap publish, local checks), `lib/region.mjs` (the all-states synthetic seed from a vocabulary), `lib/rehearse.mjs` (request helpers), `lib/cdp.mjs` (Chrome over DevTools, a fresh profile, computed visibility, the wire audit), `lib/imagery.mjs` (fetch by URL list, resize and encode, a manifest with provenance per file).
- `new-demo.mjs --config public/<slug>/demo.config.json`: writes the worker config through `build-demo-worker-config.mjs`, the server config file and its registration, the page skeleton from templates, the thin seed and rehearsal wrappers, the document skeletons (design, presenter script, resume), and prints the secrets the worker needs by name only.
- `check-demo.mjs <slug>`: `check:generated`, the app typecheck, the credential grep over `public/<slug>`, both suites against a local or a named base.

### 2.4 `demo.config.json`

The one file an SE edits first. Name and slug; tenant; worker name, queue and dev port; palette tokens and fonts; pages and the slots on each; dimensions with their τ; the beats file; the products file and its attribute map; the imagery manifest; the regional seed vocabulary; the asserted context names; the report slots; flags (exit beat, sign-in demo accounts by name only). A schema and a test guard it.

### 2.5 The SE path

- `docs/demo-kit/HOWTO.md`: from a customer brief to a hosted demo, in the order the work actually happens: the research lanes, the design document, the config, the products and imagery, the beats, the suites, the deploy on the owner's go, the morning routine.
- A repository skill, `.claude/skills/new-demo/SKILL.md`, invoked as `/new-demo`: it interviews for the customer, the fictional name, the palette, the product source and the story in three to five beats; runs the scaffolder; dispatches build lanes for the vertical renderers, the catalog pieces and the imagery; runs `check-demo`; writes the resume. The SE's own work is the palette, the products and the beats.
- The lead's method stays the law for a new customer: research lanes first, then the design document with its decisions log, then build lanes by path ownership, an independent review, suites that assert computed state, deploy on the owner's go, verification through the APIs.

---

## 3. The gate

- Vantage on the kit passes both of its suites, locally and hosted, with the counts Lane C1 establishes as the new baseline; Top Offers is untouched; `npm run check:generated` and the app typecheck pass; the credential grep over `public/` is clean.
- An independent review of the extraction before Vantage redeploys on it (the R lane pattern from Vantage).
- Redeploys of Vantage are covered by the owner's standing approval for Vantage fixes; a new worker, queue, secret or tenant is a new approval.

---

## 4. Lanes

| Lane | Scope | Owns | Gate |
|---|---|---|---|
| **C1** (running) | the Compare widget as the kit's first module; Vantage wired; a Before always exists; Fresh visitor on both views | `public/demo-kit/compare.*`, `public/vantage/**`, the Vantage suites | both Vantage suites, new assertions, measured capture time |
| **K1** server | `src/demos/kit/` route factories; `vantage.ts` and `vantageColdStart.ts` become configs; tests kept | `src/demos/kit/**`, `src/routes/vantage*.ts`, their tests, `src/index.ts` mount lines | route tests, request-level suite |
| **K2** page | `public/demo-kit/` modules and tokens; Vantage's page on them; Vantage's beats as data with the verb vocabulary | `public/demo-kit/**` except compare, `public/vantage/**` | DOM suite |
| **K3** scripts | the libraries, `new-demo.mjs`, `check-demo.mjs`, the config schema; Vantage's scripts as wrappers | `scripts/demo-kit/**`, `scripts/*vantage*.mjs` | both suites through the wrappers, schema test |
| **K4** the SE path | HOWTO and the `/new-demo` skill, proven by scaffolding the LG demo | `docs/demo-kit/HOWTO.md`, `.claude/skills/new-demo/**` | the LG scaffold builds and its empty suites run |
| **R2** review | independent review of K1–K3 on the exact tree | nothing | PASS before the Vantage redeploy |

**Sequencing.** C1 now. K1 and K3 start in parallel on disjoint paths. K2 follows C1, because it consumes the compare module and shares `public/vantage/**`. K4 follows K3. The LG data lanes (the products feed from the taxonomy file, imagery from LG's media host with a manifest, the catalog pieces, the regional vocabulary, the beats script as data) start now, since they are data and depend on nothing in the kit; the LG page lanes start the moment Vantage holds its suites on the kit. One writer per path; the lead integrates, verifies and commits.

---

## 5. Decisions log

| Date | Decision | By |
|---|---|---|
| 2026-10-01 | Demos are extracted into a kit now, before the LG build, so a new demo is a restyle plus products plus beats; AEs and SEs are the users of the kit, with an agent path | Simone |
| 2026-10-01 | Compare is a standard feature of every demo: the page-level Seam and Side by side from the Meridian widget, a What changed view for the decided state, a Before that always exists, no silent no-op; Lane C1 fixes Vantage and creates the module | lead, on Simone's finding |
| 2026-10-01 | Beats are data with a verb vocabulary and one escape hatch; Vantage's sixteen beats are the proof | lead |
| 2026-10-01 | Vantage is the proving consumer and holds its suites as the gate; Top Offers is left alone by the kit lanes | lead |
| 2026-10-01 | The LG demo is the first new consumer; its data lanes start immediately, its page lanes once the kit holds Vantage | lead |
| 2026-10-01 | K1 landed and verified by the lead (63 of 63 route and factory tests, typecheck green, request-level suite 113 of 113 on a private port); four config fields beyond the brief (`beatsPath`, `seedScript`, `scoredSentence`) accepted; two notes for R2: the `ctx.` prefix regex has an unescaped dot, and `/receipt` does not compare `X-Tenant` with the demo tenant | lead |
| 2026-10-01 | K3 part a landed (52 node:test tests; seed, region and imagery proven equal to Vantage's scripts; `check-demo` 5 of 5). Ruling for part b: **the beat documents under `public/<slug>/beats/` are the edited data**; `seed.mjs` re-anchors and publishes them and writes the re-anchored copies back for the worker's ASSETS binding (`--out` elsewhere for proofs); the definitions still held in `seed-vantage.mjs` move into `configs/vantage/` and the drift guards retire with the code. A demo's seed, region seed and imagery fetch become thin wrappers over the kit's command lines. Part b starts when C1 has landed | lead |
| 2026-10-01 | Parallel lanes that run a local Vantage use their own port and state directory, and anything that runs `seed-vantage.mjs` snapshots and restores the 19 files it writes under `public/vantage/` (K1 restored; K3 redirected the writes); recorded here so no brief omits it again | lead |
| 2026-10-01 | C1 landed (DOM 279 of 279 with 54 new assertions, request level 113 of 113, a Before costs a median 55 ms on the press, rendering deferred until the beat lands). Three C1 choices confirmed: no Before inside a beat except the beat's own, so beat 1 compares the site's own page with the personalised one; the boot paint is not captured, so Compare before any press shows the message; "nothing changed" means pixel-identical. One copy fix handed to K2: the streaming shopper's title names one phone page while two phones are compared | lead |
| 2026-10-01 | Commit `c720907` = C1 + K1 + K3a, committed with explicit paths; other sessions' uncommitted files (Tapestry, BTI, `docs/lg/`, `docs/verizon/explainer/`, `public/vantage/how-it-works.*`) left out. The Vantage redeploy was refused by the session's permission classifier as a production deploy and waits for the owner; the hosted worker runs the previous version. R2 (review of the commit), K2 (page kit) and K3 part b started in parallel on disjoint paths and ports | lead |
| 2026-10-01 | K3 part b landed: Vantage's seed, region seed and fetch scripts are thin wrappers over the kit's command lines with every documented flag kept; 67 of 67 tests; equivalence to part a's captures and to the committed files proven; `check-demo` 5 of 5. Behaviour change by ruling: the beat documents are the data; the device verdicts live in `configs/vantage/imagery.json`; the anchor file binds the page's copy of the registry, the learn summary, the reset and the closed list, and a seed stops with nothing written if they disagree. Two stale notes under `public/vantage/` (`catalog.json`, `seeds.json`) handed to K2 | lead |
| 2026-10-01 | Build item opened by K3b's ruling: featured phones, prices in the beats' events and plan titles are literal copies of `phones.json` and `plans.json` inside the beat documents, so a product change no longer reaches the beats and nothing checks it. The check belongs with the products file of `demo.config.json` in `new-demo.mjs` (K4): a seed refuses when a beat document's product facts disagree with the products file. Also noted: the committed `MANIFEST.json` Pixel 11 launch-tile title is stale against `catalog.json`; the art generator's next run corrects it | lead |
| 2026-10-01 | WSL restarted under every lane at about 19:35 (Hyper-V tore the machine down; Ubuntu reattached its disk at 19:42), stopping the owner's 9110 rig and a 9112 rig; the lanes restarted their own rigs on their own state and finished. Nothing in the lanes caused it | lead |
| 2026-10-01 | K2 landed in the working tree: Vantage runs on `public/demo-kit/` (transport, director, panels, deltas, prove, sheets, kit, util, tokens.css, kit.css); `vantage.js` 3,380 lines to 2,104 with the renderers unchanged; the director's script is `public/vantage/beats.json` (22 presses of fifteen beats, three verbs added: publish, ask, template; two escape hatches: beat 1's arrival and beat 5's meter reading); computed styles equal on three pages; DOM 279 of 279, request level 113 of 113; the "How it works" footer link on both pages; `catalog.json`'s note reworded; `seeds.json` kept because the request-level suite asserts it is served (retiring it is a suite change, K3c). **Held uncommitted until an independent review (R3) passes**, so the branch head the owner deploys from stays the reviewed Compare fix | lead |
| 2026-10-01 | R2 verdict on `c720907`: **K1 PASS, K3 part a PASS, C1 FAIL on evidence.** C1: four of the 54 new DOM assertions cannot fail for what they name (blank frames pass; her four not restored passes because the check runs after beat 1 when her four and a stranger's are identical; "her visitor is unchanged" reads a chip the restore never redraws; "the message closes" passes when nothing opened); and a race: `openCompare` checks for a frame before waiting on the capture in flight, so Fresh visitor pressed within about a second of the first decided paint opens on the message (fix: wait when a capture is pending). Lows: a beat's Before is cloned after `#railDeltas` is hidden; Compare pressed during a tool takes over that tool's comparison; the 22 per-press checks read the kit's state, not the screen. Shared Medium: nothing checks `public/demo-kit/` for credentials (a planted token there passed `check-demo` and the request-level suite). K1 hardening: `/receipt` should answer 404 when the capability's tenant is not the demo's tenant, before any worker serves two kit demos. Lane C2 fixes C1 after R3 finishes (both touch the DOM suite); Lane H1 takes the hardening now | lead |
| 2026-10-01 | Vantage deployed by the Verizon Demo session on the owner's instruction: version `cfc5d93d`, from a clean worktree of `93e51c7` created in WSL (a Windows-created worktree fails `check:generated` on line endings alone: deploy worktrees are made from WSL). The hosted DOM suite runs from this session once that session reports the worker quiet | lead |
| 2026-10-01 | Hosted verification of `cfc5d93d`: DOM suite 279 of 279 from this session (248 calls, every one with `X-Tenant`, none with `Authorization`, no script error, tenant reset at the end); request-level 113 of 113 and the explainer self-test from the Verizon Demo session. The Compare fix is live | lead |
| 2026-10-01 | H1 landed and verified by the lead (67 of 67 route and factory tests, 69 of 69 library tests, typecheck green): `/receipt` answers 404 to a capability of another tenant before any read; the credential grep follows every path the pages name from `public/<slug>` and `public/demo-kit` (for Vantage: those two and `html2canvas.min.js`), proven against a planted tree where the old grep found nothing; the validator refuses the customer stamps' workers and queues, the root `wrangler.toml` and a `publicDir` other than `public/<slug>`, and matches credential keys by pattern; the `ctx.` dot is escaped. Ruling on H1's question: **a demo's worker is `edge-platform-<slug>` and its queue `events-<slug>`**, derived by the scaffolder and enforced by the validator (K4). Open from R2: the request-level suite's own source checks do not yet cover `public/demo-kit/` (C2 item 5) | lead |
| 2026-10-01 | R3 verdict on K2 (working tree): **FAIL on three small edits**, everything else holding (keyboard, query flags, navigation, panels, socket, computed styles identical but the footer column, 183 of 183 beat phrases both ways, transport unchanged, suites 279 and 112 or 113 on K2's rig and on the new head's source). Must change: the two-phone streaming caption still claims the same prices; "the carrier's" inside `panels.js`; a Vantage layout rule inside `kit.css`. Also: an unresolved template renders empty and can silently skip a step; beat 12 dropped `fixtureDone.add('black-friday')`. The Compare race is C1's and reproducible without throttling (Fresh visitor 0.3 s after a direct phone-page landing's first paint). Suite gaps: beat body unchecked, tenant check reads a constant not `transport.js`, no kit-boundary guard, footer link unchecked, one phrase sampled per beat. K2 resumed for its five edits; C2 started in parallel on compare, kit.js's wait and the two suites | lead |
| 2026-10-01 | K2 made R3's five edits (the two-phone caption from the two phones; `coldStart.salesOf` as config with "the brand's" as default and Vantage supplying "the carrier's"; the pill offset moved to `vantage.css`; an unresolved template is a visible error, validated for every beat at load; beat 12's fixture step restored) and both suites held (279 of 279; 112 of 112 with the 113th check state-dependent). **Committed.** Four published beat documents under `public/vantage/beats/` were re-anchored by C2's rig seed and are excluded; C2 restores them to HEAD when it finishes | lead |

