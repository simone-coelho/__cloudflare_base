# S47 kit: verifying section 3 of the airline demo's gap document (the demo kit)

**Read at** the demo's feature branch **4d882915** (detached worktree `/home/simonecoelho/rem/oa-verify`, clean, never edited). Tests and probes ran on git-archive copies under `S47/kit/scratch/`. Logs are in `S47/kit/logs/`. Engine cross-checks: rem/integration **ed7d6bbe**, read with `git show` (that checkout's HEAD moved to c953c04e during this run). The document checked is `S47/OA-Engine-Gaps.md`, byte-identical to the control copy. Its technical notes are `docs/airfrance-klm/OA-Demo-Design.md` §10, identical in the tree and the control checkout.

## For the owner, in plain words

Of the 16 kit rows, the three marked "built" are built, and their tests pass. Of the 13 marked "open", 11 are accurate as written, often with a wider root cause than the row says. Two are only partly right:
- **Item 10** is not a kit gap. It is an engine rule waiting on an owner decision.
- **Item 22**'s "OA's page retries once" is wrong for receipts. The page retries events only.

Every kit fix below works at the cause. None keeps a workaround. Kit work in total is roughly **8–10 days**. Two rows also need engine work that is someone else's scope: money learning (engine 18) and provenance and page context on the record (engine 11 and 12).

| # | Gap (as claimed) | Verdict | Root cause, one line | Remedy at the cause, one line | Size | Who it hits |
|---|---|---|---|---|---|---|
| 4 | A dial (γ) beat | **ACCURATE: built, tests pass** | n/a | none needed | 0 | kit-wide (built) |
| 5 | Start a visitor who refused or limited consent | **ACCURATE: built, tests pass** | n/a | none needed (the guide gap is item 25) | 0 | kit-wide (built) |
| 16 | Learn settings from the demo config | **ACCURATE: built, tests pass** | n/a; note: the holdout is tenant-wide, not per slot | none needed | 0 | kit-wide (built) |
| 24 | Reset fallback skips the learn document | **ACCURATE, and worse** | The fallback hard-codes two documents. It can never succeed on a kit worker, and it can misfire on a non-404 | Delete the fallback; a missing `/reset` becomes a named error | 1–2 h | all 3 kit demos + future |
| 22 | Receipt prefetch gives up after one server error | **PARTLY** | The kit treats every 5xx as final and gives a permanent "not provisioned" the same 503 | Retry 5xx within the existing budget; stop only on 4xx or a coded permanent refusal | 2–4 h | all 3 kit demos + future |
| 21 | Browser-test helper rejects dial beats | **ACCURATE** | The helper keeps its own two-kind list instead of the demo's closed list; the scaffold's suite never calls it | Check each beat against the closed list; call it from the template | 2–3 h | every demo with a dial; all future |
| 23 | Scaffold's drift check ignores learn lines | **ACCURATE, and wider** | A regex picks only `catalog`/`slots` lines; the reset order is not compared either | Compare every derived constant, not a regex subset | 2–3 h | every demo |
| 8 | Kit receipt panel: no page context, no lift value | **ACCURATE** | The route accepts only intent and region, though the config declares the page's context names; the panel prints γ only | Pass the declared context names to the route; render the lift's value, level and showings | 0.5–1 d (+engine 11/12) | all 3 kit demos |
| 17 | Image manifest expects downloaded photos | **ACCURATE, and wider** | The kit's imagery contract knows one kind of image, a downloaded render; all three demos keep drawn art outside it | Make drawn art a first-class imagery kind with its own row check and gate | 1 d | all 3 kit demos |
| 25 | Kit guide silent on the dial beat and learn section | **ACCURATE, and wider** | The guide is written by hand and has not changed since 2026-10-03; consent is missing too | Update §3 and §6; add a test that the guide names every kind and section the validator accepts | 0.5 d | every future demo |
| 26 | One-command hosting always runs the US seed; no history step | **ACCURATE** | The seed step is fixed: kit seed, redeploy, US regional seed | Run the regional seed only when the demo has a lean; add a declared history step | 0.5–1 d | every demo with its own history or no lean |
| 7 | Kit cart: dollars only; add-to-cart carries no value | **ACCURATE** | The store hard-codes USD, a `$` formatter and one purchase per line | A currency in the demo config; value on add-to-cart; one purchase per order with items | 1 d (+engine 18) | every non-US demo |
| 9 | Regional seed is US only | **ACCURATE, and wider** | The kit derives regions from 51 US census rows; config, script and seed route all require `US-XX` | Each demo declares its regions in the engine's own key form; census becomes an optional US input | 1.5–2 d | every non-US demo |
| 27 | No option to hide the census rows | **ACCURATE, and worse** | The route always reads the census, and falls back to the **US national** figure for a non-US visitor | A census on/off in the demo config; the route reads nothing when off; no US fallback for non-US regions | 0.5 d | every non-US or non-retail demo |
| 6 | No path addresses such as `/oa/results` | **ACCURATE** | The store parses only fixed paths and `?view=`; the worker redirects any other page to the demo root; the config's page `url` is validated but never used | Route by the page's declared `url`, in the store and in the worker's root rule | 1–1.5 d | any demo whose customer uses path URLs |
| 10 | Starting assumptions only for count-based slots | **PARTLY** | Engine rule, held for owner decision **D09** (what a money prior means); the kit has no priors door at all | Owner decision D09, then the engine; a kit `priors` section only after that | decision; then ~0.5 d kit | kit-wide once D09 is taken |

**Ranked by how many demos each affects:**
- **All three kit demos (Vantage, OH, OA) and every future one:** 24, 22, 8, 17, 23, 21, 25.
- **Every future demo outside the US, or not a retail store:** 9, 27, 7.
- **Every demo with its own history step or no regional lean:** 26.
- **Only where a customer asks for path URLs:** 6.
- **Waiting on an owner decision:** 10.

Nothing is OA-only. Every item's cause sits in shared kit code.

**One correction to the section's opening line.** "None of them shows in the demo" is not quite true:
- Item 27's census rows are on the arrival panel the room sees (P22 tells the presenter to avoid that tab).
- Item 22 can leave a receipt empty on screen.

**Replace OA's workarounds with the kit fixes?**
- **Yes** for 21, 24, 26, 17 and 8. OA's own copies duplicate the kit and drift from it.
- **Partly** for 7: OA's funnel is its own page, but its money formatting and event shapes should come from the kit.
- **Optional** for 6 and 9. The design chose `?view=` (P8) and no regional lean (P7).

---

## Built and tested (items 4, 5, 16)

**Kit library tests, REPRODUCED.** `node --test --test-concurrency=1 scripts/demo-kit/lib/*.test.mjs` on the archive copy gave **196 tests: 195 pass, 1 skipped, 0 fail**. That matches the claim of "195 of 196, 1 skipped". The skip is the headless-Chrome test, because WSL has no Chrome. Log: `logs/kit-lib-only-node-test.log`.
- With `scripts/seed-oa-history.test.mjs` added: 206 tests, 205 pass, 1 skip (`logs/kit-lib-node-test.log`).
- My first run of that wider set showed 7 failures. All were an artefact of my archive leaving out `docs/lg/` (OH's design file). After I added it, they passed. That log was overwritten by the clean run.

**Kit route tests, REPRODUCED.** `vitest run src/demos/kit` gave **6 files, 106 of 106 pass** (`logs/kit-routes-vitest.log`). The landing notes said 105 of 106, the one failure being the drift guard for OA's missing `DEMO_ROOTS` line. At 4d882915 that line is applied (`src/demos/kit/root.ts:90`), so the guard now passes ("names Vantage, OH and OA from their configs").

**Item 4: the dial beat. ACCURATE (REPRODUCED).**
- Source: beat kind `learn` and change `gamma` are in the validator (`scripts/demo-kit/lib/config.mjs`: `BEAT_KINDS`, `CHANGE_KIND`, `gammaChangeRule`). The scaffold cuts the dial document from the learn document in force (`lib/scaffold.mjs` `beatDocuments`, learn branch). The reset puts the opening learn document first (`resetOf`). The worker route accepts `learn` (`src/demos/kit/helpers.ts:15-17`, `actionRoutes.ts` `settled`). The route refuses to build when a published kind is never reset. The director passes any kind through (`public/demo-kit/director.js:473-487`).
- Tests: library tests #20, #46, #134–#140 and #160–#163, all K7. Route tests: `actionRoutes.learn.test.ts`, 3 of 3: the dial raises γ to 0.6; the reset lowers it and restores slots and catalog in order; pressing twice changes nothing else.

**Item 5: refusing or partial consent at the mint. ACCURATE (REPRODUCED).**
- Source: `mintVisitor(key, entry, label, { consent })`, `setConsent` and `configure({ consent })` (`public/demo-kit/transport.js:149-286`). The kept record holds the real choice (`public/demo-kit/store.js` `consentKept`). The panel's chip never says "on" when a switch is off (`panels.js:77-89`).
- Tests: #164–#168 (`store-consent.test.mjs`) and #179–#192 (`transport.test.mjs`). They include: the default mint sends exactly the bytes it always sent; a refusing mint goes through the engine's door without browser cookies; one visitor's refusal never reaches another visitor on the page.
- The guide does not mention it (item 25).

**Item 16: learn settings from the config. ACCURATE (REPRODUCED).**
- Before K7, the claim holds (SOURCE-TRACED at d606ce62): `learn.json` was rebuildable (`scripts/demo-kit/new-demo.mjs:47-48`), and the scaffold wrote every slot as click/unit/γ 0 (`lib/scaffold.mjs:310`). So a rebuild overwrote any hand edits.
- Now: `learnDocument` merges the config's `learn` section over `KIT_LEARN`, and `learnSectionRules` holds each field to the engine's rule.
- Tests: #47 and #138–#140. #140 shows OH's derived learn document is unchanged.
- Probe (`logs/probe-learn-16.log`): OA's `learn.json` equals what its config derives; `open-learn.json` equals `learn.json`; the dial document differs from it only in γ (0.6 on 15 of 15 slots). Holdout is 0.05, regional prior off, and 10 slots are on the revenue objective.
- Wording: "per-slot … holdout" is loose. The holdout is one share for the tenant, not per slot.
- Note: the validator accepts revenue slots without saying that, until engine 18 lands, they refuse every outcome that states a currency (see item 7).

## Open items

**24. The reset fallback. ACCURATE (REPRODUCED).**
- Claim checked: `public/demo-kit/transport.js:114-120`. When `/reset` fails with `/404|Not Found/` in its message, the kit publishes `open-slots` then `open-catalog` and never `open-learn`.
- Probe (`logs/probe-transport-22-24.log`):
  - **24a:** `/reset` answers 404 and `/beat` works. The fallback applies `open-slots(slots), open-catalog(catalog)`, no learn.
  - **24b:** `/reset` and `/beat` both answer 404. The fallback throws "Not Found".
  - **24c:** `/reset` answers **503** with the error text "Not Found". The fallback runs anyway and reports **success** without the learn document, so a raised dial stays raised.
- Root cause (SOURCE-TRACED): all three kit demos mount `/reset` and `/beat` on one router (`src/demos/kit/actionRoutes.ts:187-190, 269, 283`; `src/routes/vantage.ts:41`, `oh.ts:189`, `oa.ts:24`). Off the demo profile, that router answers 404 `Not Found` to both. So whenever `/reset` is truly absent, `/beat` is absent too (24b), and the fallback can never succeed.
- `/reset` already existed when the fallback was written: in Vantage's routes from 3851f35a (2026-09-30) and in the kit factory from c720907c (2026-10-01). The fallback came in 2ca67bdf (2026-10-01).
- The fallback also tests the message text, not `error.status` (`transport.js:116`; `demoRoute` sets `status` at :84). That is how 24c misfires.
- Remedy: `resetTenant` becomes `demoRoute(API.reset)`, and a 404 becomes a named error ("this worker mounts no /<slug>/api: not the demo profile, or the routes are not mounted"). Drop `beatName`'s reset role (`transport.js:39`).
- Tests to pin it (`transport.test.mjs`): a 404 makes no `/beat` call and gives the named error; a 503 whose text says "Not Found" throws and makes no `/beat` call.
- Size 1–2 h. Kit-wide (Vantage, OH, OA).

**22. Receipt prefetch after a server error. PARTLY (REPRODUCED).**
- Claim checked: `transport.js:376`. `if (!(r.status === 202 || r.status === 200)) break;` ends the loop on any other status.
- Probe (`logs/probe-transport-22-24.log`):
  - **22a:** 503 then 200 sends 1 ask; the receipt is never stored.
  - **22b** (control): 202 then 200 sends 2 asks; the receipt is stored.
  - **22c:** the route's own 502 for a failed ledger read (`actionRoutes.ts:340`) also ends after 1 ask.
- **Inaccurate part:** "OA's page retries once" is not about receipts. OA re-sends **events** on a 503 or no answer (`public/oa/oa.js:805-812`). Nothing in OA re-asks a receipt. OA's own DOM suite says so: "the rig answered 503 to … call(s) of the page, which the page does not ask again" (`scripts/rehearse-oa-dom.mjs:1020`).
- Root cause (SOURCE-TRACED):
  - The kit's loop treats a transient 5xx like a refusal ("refused or unprovisioned: ask no more").
  - The route gives its one permanent state, the tenant not provisioned (`actionRoutes.ts:175, 328`), the same 503 as a transient failure. So the page cannot tell them apart.
- Remedy:
  - Give the route's not-provisioned answer a stable `code` (permanent).
  - In `prefetchReceipts`, keep asking on 5xx and status 0 within the existing 10-attempt budget, with growing waits; stop on 4xx or that code.
  - Tests (`transport.test.mjs`): 503→200 and 502→200 store the receipt; `unprovisioned` stops after one ask; 400 stops after one ask.
- Size 2–4 h. Kit-wide.
- UNVERIFIED: which component answered 503 under load on the local rig. Candidates on this path are `src/tenancy/middleware.ts:113`, `src/identity/sessionCapability.ts:51`, `src/index.ts:413` and the runtime itself; telling them apart needs a rig run, which this brief does not allow.

**21. The browser-test helper and dial beats. ACCURATE (REPRODUCED).**
- Claim checked: `scripts/demo-kit/lib/cdp.mjs:219-230` (kinds hard-coded at :224).
- Probe (`logs/probe-cdp-21.log`):
  - **21a:** OA's beat 7 (`{kind:'learn', name:'07-the-dial'}`) plus a reset **fails** the check.
  - **21b** (control): a slots beat passes.
  - **21c:** `{kind:'catalog', name:'open-slots'}` **passes**, although the closed list says `open-slots` is a slots document. The helper is too strict and too loose at once.
- OA checks the bodies itself (`scripts/rehearse-oa-dom.mjs:83, 1005-1012`), against a hand-typed copy of the closed list (`kitPublishable`, :83).
- Root cause: the helper keeps its own kind pair instead of the demo's one closed list (`seed.beats.publishable` in the kit config). The scaffold's DOM-suite template never imports it either (`scripts/demo-kit/templates/rehearse-dom.mjs.tpl:17`), so a scaffolded demo has no beat-body check at all.
- Remedy:
  - `checkDemoRouteBodies(checks, wire, { api, publishable })` checks `publishable[name] === kind`, defaulting to `PUBLISH_BEAT_KINDS` imported from `config.mjs`.
  - Call it from the template, and replace OA's copy.
  - Tests (`cdp.test.mjs`): a learn beat on the list passes; a kind that contradicts the list fails.
- Size 2–3 h. Kit-wide.

**23. The scaffold's drift check. ACCURATE, and wider (REPRODUCED).**
- Claim checked: `scripts/demo-kit/new-demo.mjs:51`. `derivedLines` keeps only `'name': '(catalog|slots)',` lines and vocabulary lines; the comparison is at :129-133.
- Probe (dry runs of the real `main` on a mutable archive copy `scratch/tree23`):
  - **Baseline:** no warning (`logs/probe-23-baseline.log`).
  - **Learn line removed** (`'07-the-dial': 'learn',` deleted from `src/demos/oa.config.ts`): **no warning** (`logs/probe-23-learn-line-removed.log`).
  - **Slots line removed** (`'open-slots': 'slots',`): warning printed (`logs/probe-23-slots-line-removed.log`).
  - **Reset changed** (`OA_RESET` without `open-learn`): **no warning** (`logs/probe-23-reset-line-changed.log`). The worker would instead throw at module load (`actionRoutes.ts` `settled`), taking the whole worker down.
- Root cause: the check compares a regex subset of the derived constants, not the constants themselves.
- Remedy: compare every value the template is filled with (`serverVars`: beats, beat-kind union, reset, vocabulary, asserted).
- Tests (`scaffold.test.mjs`): the three mutations above each produce the warning.
- Size 2–3 h. Kit-wide.

**8. The kit's receipt panel. ACCURATE (SOURCE-TRACED).**
- (a) Page context: the receipt route accepts only `intent` and `region` (`src/demos/kit/helpers.ts:82-97`, refusal at :89). Yet the demo config already declares the names a page may assert (`asserted.context`, `config.mjs:1091-1094`; OA declares 8). The scaffold writes only the intents into the server constants (`lib/scaffold.mjs:889`), so the route never learns those names.
- (b) The lift: the panel prints base → final and γ only (`public/demo-kit/panels.js:461`). The same record carries the lift's value, level, level words and showings, which OA's page reads (`public/oa/oa.js:866-874`).
- Root cause:
  - The declared context names stop at the scaffold.
  - The panel renders a subset of `explain.lift`.
  - The record-backed version of page context, and a "synthetic" provenance label, need engine items 12 and 11. Nothing on the engine record marks a tally as synthetic, so a kit-wide "where it came from" cannot be honest without them.
- Remedy:
  - A server constant for the asserted context names; `assertedContextOf` accepts them and `assertedOf` labels them as asserted by the page.
  - `panels.js` renders lift ×value, level words and showings beside γ.
  - Tests: `actionRoutes.test.ts` (declared names accepted, others refused). There is no panel test today (no `panels.js` test under `scripts/demo-kit/lib/`); add one.
- Size 0.5–1 day kit. Kit-wide. OA's own receipt block can then use the kit's renderer.

**17. Drawn art and the imagery manifest. ACCURATE, and wider (REPRODUCED).**
- Probe (`logs/probe-imagery-17.log`, the kit's own `validateConfig(…, { sections: ['imagery'] })`, as `scripts/demo-kit/fetch-imagery.mjs:35` runs it):
  - OA's imagery section fails with 6 errors (`subdir`, `cacheName`, `placeholder`, `views`, `licences`, `sources: the URL list`).
  - OA's manifest keeps its art in an `art` object, as OH's does.
  - Vantage's art sections (`plans`, `modules`, `promos`, `heroes`) fail the kit's row check: 52, 91, 294 and 39 problems.
- Root cause:
  - The kit's imagery contract models one kind of image: a downloaded render with https sources and three encodings (`config.mjs:354-399`, `sources` at :379; `scripts/demo-kit/lib/imagery.mjs:306-329`, `generated must be false` at :321).
  - Every demo's drawn art (`scripts/generate-oa-art.mjs`, OH's and Vantage's generators) lives outside it.
  - `check-demo.mjs` validates only `check` (:61), so nothing in the kit checks a demo's art.
- Remedy:
  - A drawn-art kind in the imagery contract (generator, method, sha256, by-eye verdict; no sources or encodings), with its own row check and config rules chosen by kind.
  - `check-demo` runs the imagery gate.
  - Tests: `imagery.test.mjs` and `config.test.mjs`.
- Size 1 day. Kit-wide (all 3).

**25. The kit guide. ACCURATE, and wider (SOURCE-TRACED).**
- `docs/demo-kit/HOWTO.md:55` lists beat kinds `context`, `catalog`, `slots` and changes `shiftDays`, `close`, `outOfStock`, `pin`: no `learn`, no `gamma`. §3's table has no `learn` row.
- The consent option (item 5) is absent too.
- Last change: be6e0a55 (2026-10-03), before K7 and K8.
- Root cause: the guide is written by hand, with nothing tying it to the validator.
- Remedy: update §3 and §6, and add a test in `config.test.mjs` that every beat kind, change and top-level section the validator accepts is named in §3.
- Size 0.5 day. Kit-wide.

**26. One-command hosting. ACCURATE (REPRODUCED).**
- Probe (`logs/probe-host-26.log`): `runHost` for OA, dry run, seed step only. The runner throws if called, `.dev.vars` is a fixture string and the signing value is fabricated. The plan is: kit seed → redeploy → `region-seed.mjs` for OA; no history step.
- Source: `scripts/demo-kit/lib/host.mjs:37` (steps), :495-504 (the seed step, region seed at :502 unconditionally).
- OA's learn document has the regional prior off (`scripts/demo-kit/configs/oa/learn.json:10-11`), so that seed writes rows nothing reads.
- OA's manual morning (`docs/oa/RESUME-oa.md:73-75`) passes a hand-minted operator token as a command-line **argument** and runs a plain `npx wrangler deploy`. host.mjs's own rule is tokens only in the environment, never as an argument (`host.mjs:485`).
- Root cause: the seed step is a fixed sequence, and the kit config cannot declare "no lean" or a history step.
- Remedy:
  - Run the region seed only when the demo seeds a lean (from the region section, or the learn document's `regional.enabled`), and print why when skipping.
  - An optional declared `seed.history` step after the redeploy, with `OPERATOR_TOKEN` in the environment. Both seeds already read `OPERATOR_TOKEN`: `scripts/seed-oa-history.mjs:63`, `scripts/demo-kit/seed.mjs:16`.
  - Tests (`host.test.mjs`): regional off plans no region seed; a declared history runs after the redeploy, with the token never in an argument; OH's plan unchanged.
- Size 0.5–1 day. Kit-wide.

**7. Money in the kit store. ACCURATE (SOURCE-TRACED).**
- `add_to_cart` carries no value (`public/demo-kit/store.js:530-531`).
- Checkout sends one `purchase` per line with `currency: 'USD'` (:632-636).
- `money()` is `$`/en-US (`public/demo-kit/util.js:12-13`).
- OA sends its own euro events (`public/oa/oa.js:1714, 1836, 2635, 2675`) and one order-level purchase (:2693).
- Root cause: currency, locale and order shape are hard-coded in the shared store.
- Coupling: a revenue slot refuses any outcome that states a currency until a money policy can be published (`src/learn/fan.ts:125-136` at 4d882915). At ed7d6bbe the learn document still has no money member (`git show ed7d6bbe:src/content/kinds.ts` has no `money`), and the outcome path sets none (`src/learn/route.ts`). So the kit's own `USD` would meet the same refusal on any revenue slot.
- Remedy (kit):
  - `store.currency` (ISO code + locale) in the demo config; `money()` through `Intl.NumberFormat`.
  - `value` and `currency` on `add_to_cart`.
  - One purchase per order with `items`.
  - Tests (`store.test.mjs` cart test): OH and Vantage stay byte-identical under the USD default.
- Engine 18 is the remedy for learning from those amounts.
- Size 1 day kit. Kit-wide for non-US demos.

**9. Regional seed. ACCURATE, and wider (SOURCE-TRACED).**
- The kit's region keys must be `US-XX` (`config.mjs:31`, used at :311 and :1086).
- Every seeded region comes from the US census rows (`scripts/demo-kit/lib/region.mjs:28-38, 147-153`; `migrations/seed/seed_011_geo.sql`, 51 `('region'` rows). Even the census-free fixed model takes its region list from the census file (`region.mjs:90`).
- The kit's server seed door also refuses non-US keys ("region must be a US state key", `src/demos/kit/coldStartRoutes.ts:288`) and assumes US at :98 and :151.
- The engine's own region key is general (`src/reflex/regionTrend.ts:41-46`: `NL-NH` or `NL`).
- Root cause: the kit took the US census as its region universe.
- Remedy:
  - A declared region list in the region section, in the engine's key form.
  - The fixed model runs over it; census becomes an optional US-only input to the income-tilt model.
  - The seed door checks the engine's key form and the declared list.
  - Tests: `region.test.mjs`, `config.test.mjs`, `coldStartRoutes.test.ts`.
- Size 1.5–2 days. Kit-wide for non-US demos.

**27. Census rows on the arrival panel. ACCURATE, and worse (SOURCE-TRACED).**
- The panel always renders income, home value and the census source when the answer carries them, plus the tag "census real · shown, never scored" (`public/demo-kit/panels.js:373-376, 387`).
- The route always reads the census (`coldStartRoutes.ts:248`). For a region with no census row, it shows the **US national** figure (`coldStartRoutes.ts:161-176`). A visitor in the Netherlands would see US median income.
- There is no config switch: the kit config's `coldStart` carries only `seeded` and `salesOf` (`panels.js:367-368`).
- Remedy:
  - `coldStart.census: false` in the demo config → the route reads no census and answers none, with a reason → the panel draws no census rows or tag.
  - No US national fallback for a non-US key.
  - Tests: `coldStartRoutes.test.ts`.
- Size 0.5 day (shares code with item 9). Kit-wide.

**6. Path addresses. ACCURATE (REPRODUCED).**
- Probe (`logs/probe-root-6-vitest.log`, a vitest file in my archive copy): a browser load of `/oa/results` on OA's single-demo worker answers `302 → /oa/`, so the view is lost. `/oa/?view=results` is left to the assets.
- Source:
  - The store's parser knows only `<base>`, `m`, `product`, `search` and `?view=` (`public/demo-kit/store.js:379-395, 404-410`).
  - The worker's root rule sends any unknown page to the demo root (`src/demos/kit/root.ts:179-184`).
  - The config validates each page's `url` (`config.mjs:960`), and the scaffold passes it to the page (`lib/scaffold.mjs:532`), but no kit browser module reads `url` for routing.
- Remedy:
  - The store builds its routes from the declared page `url`s.
  - The worker's root rule serves the demo's shell (from ASSETS) for a navigation to a declared page path, and still redirects undeclared ones. That needs the page paths in the server constants.
  - Tests: `store.test.mjs` (routes) and `root.test.ts` (a declared path answers the shell; an undeclared one still 302s).
- Size 1–1.5 days. Kit-wide; matters where the customer's own site uses path URLs.

**10. Starting assumptions (priors) for money slots. PARTLY (SOURCE-TRACED).**
- The restriction is real, but it is the **engine's**: `src/learn/priors.ts:151-160` refuses a prior row on a revenue or margin slot, called at `src/routes/content.ts:105`. It is unchanged at ed7d6bbe (`priors.ts:270-280`).
- It is an **INTENTIONAL BOUNDARY**: "WHAT a money prior should look like is an owner decision (D09)". D09 is recorded at ed7d6bbe in `docs/handover/HANDOFF-2026-09-18.md:374` and `HANDOFF-2026-09-16.md:359` (money, currency, refunds, prior units: the customer's business and data-science owners).
- The kit has no priors door for any slot. Nothing under `scripts/demo-kit`, `public/demo-kit` or `src/demos` publishes priors, and the route refuses `priors` as a beat kind (`src/demos/kit/actionRoutes.test.ts:358`).
- Remedy: D09 first, then the engine; a kit `priors` section published by `seed.mjs` only after that.

---

## Commands and logs (all serial, one run at a time, on archive copies; no network, server, port or secret)

- Archive: `git -C /home/simonecoelho/rem/oa-verify archive 4d882915 -- . ':(exclude)docs/remediation' ':(exclude)docs/lg' ':(exclude)data/synthetic' ':(exclude)docs/enablement' ':(exclude)examples/images' | tar -x -C scratch/tree`, plus `docs/lg/*.md`. `node_modules` is linked to the worktree's, and nothing in it was written (checked). Second copy: `scratch/tree23` (kit paths only), used for the item 23 mutations, then restored (`cmp`).
- `env -C scratch/tree node --test --test-concurrency=1 scripts/demo-kit/lib/*.test.mjs` → `logs/kit-lib-only-node-test.log` (196: 195 pass, 1 skip).
- The same plus `scripts/seed-oa-history.test.mjs` → `logs/kit-lib-node-test.log` (206: 205 pass, 1 skip).
- `env -C scratch/tree node node_modules/vitest/vitest.mjs run src/demos/kit --root scratch/tree --no-cache --maxWorkers=1 --minWorkers=1` → `logs/kit-routes-vitest.log` (106/106).
- The same runner for the item 6 probe file → `logs/probe-root-6-vitest.log` (2/2).
- Probes in `scratch/probes/`: `transport-probe.mjs` (22, 24), `cdp-probe.mjs` (21), `host-probe.mjs` (26), `imagery-probe.mjs` (17), `learn-probe.mjs` (16). Each is `env -C scratch/probes node <probe> scratch/tree`.
- Item 23: `env -C scratch/tree23 node scripts/demo-kit/new-demo.mjs --config public/oa/demo.config.json --dry-run --root scratch/tree23`, four runs → `logs/probe-23-*.log`.

## UNVERIFIED

- What answered 503 under load on the local rig (item 22). It needs a rig run, which the brief rules out.
- Whether any real engine answer puts "404" or "Not Found" in the error text that `/reset` passes through. That decides whether 24c happens in practice; the transport's misfire itself is reproduced.
- Whether a kit-level retry of **events** is safe, that is, whether the engine de-duplicates a re-sent action. OA's `oaSend` already re-sends, with the same open question.
- The headless-Chrome kit test (skipped: no Chrome in WSL).
- Engine items at c953c04e, the current rem/integration HEAD. I read ed7d6bbe as briefed.

## OUT OF SCOPE, NOTICED

1. `public/oa/oa.js:2973` still wires the kit's `store.cart.add` for a generic add-to-cart action, which would send the kit's valueless USD event beside OA's euro ones.
2. A bad reset order in a server config throws when the worker module loads (`actionRoutes.ts` `settled`), so the whole worker fails to start rather than one route.
3. The scaffold's DOM-suite template carries no beat-body check at all (the template side of item 21).
4. Before engine 18 lands, the kit validator accepts revenue objectives with no warning that they refuse currency-stated outcomes.
5. `scratch/` holds about 180 MB of archive copies, which I have not deleted (no `rm -rf` allowed); they are the lead's to remove.
