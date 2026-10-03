# OH: resume state

> **Status 2026-10-03, 11:30 UTC. Live: version `c88b7948` from commit `49384bf5` (the reseed's redeploy; `2157ea76` was the same commit before it): the engine panel restored to the proven one (the kit's classic meters and tabs as Vantage, Meridian's audience chips under the meters), the one-row mode and the Just now strip removed; looked at by the lead on the hosted store with the director open. Before it: version `adba15bd` from commit `d91143dd` (the page set: daylight art, R5's homepage list, the product gallery with 549 second pictures, five decided deals and twelve on the rail; hosted suites 223 of 226 and 503 of 506, the misses all the day report's 413). Before it: version `dd29784d` from commit `6157ae7` (E4: the action answers in about half a second hosted, 433 to 587 ms over ten actions from the live page, against 1.0 to 2.1 s before; the panel moves 542 ms after an Add to Cart). Previous: version `974f1c2f` from commit `272ede8` (the visitor kept at the mint, the panel drawn from the action's answer, "Forget this browser" and `?present=1` in the director, every on-screen word neutral, the phone homepage in the customer's order). Verified by hand on the hosted store: a second load after the mint continues the visitor with no identity call; the forget control opens the cold page; an Add to Cart moves the panel 0.36 to 0.68 with the Just now strip naming it; the engine's action answered in about 1.5 s hosted before E4; about half a second since. Previous status, kept for the record: version `cd3775e2` from commit `bbf8a9d` at https://edge-platform-oh.expedge.workers.dev/oh/ — the visitor persists across page loads (localStorage under the SDK's key names, mirrored in sessionStorage; cleared by the reset; swapped at sign-in) and the director's panel, receipts and before/now strips redraw after every event the store sends; the registry's sixty-second dials on the page-driving dimensions are in force (reflex r7). Verified by hand on the live store: one subject across a direct load, a navigation and a reload, no identity call; an Add to Cart redraws the panel to the engine's reading the moment the action answers. Known on the hosted worker: `POST /realtime/action` answers in 1 to 2 seconds (a profile read in 0.2), so a click shows late by that much; lane E4 is fixing it in the engine (`docs/lg/lanes/E4.md`). Suites on a rig: request level 231 of 231, DOM 498 of 498 (S2, 2026-10-03). Committed since: `ca127a5` (S2's suites, W1c's script), `e584287` (M1d: the phone hero and service strip, the kit's `?present` and "Forget this browser"; C3: every on-screen word neutral; R5's second look PASS at both widths). E4 passed R6's second look, is merged (`6157ae7`) and live as `dd29784d` (run 11). The page set (A1b's daylight art and tall banners, M1e's homepage list, M2b's product page and gallery, D2b's 549 second pictures, C4's five-and-twelve consistency, S2's suites: 231 / 506 / 161 on a fresh state) is committed as `d91143dd` and live as `adba15bd` (run 12). E6 merged (`ba7b1632`, R7 PASS) and deploying as run 14 with the Learned tab's caption reading `hours.open`; W1e and M2b closed. Open: R7's short look at E6's two post-PASS commits; the small queued items in the design log. `272ede8` is live as `974f1c2f` (run 10). Still in lanes: E4's second build (engine), A1b (brighter art), M1e and M2b (R5's list). Suites on a rig for `49384bf5` (S2): request level 231 of 231, DOM 517 of 518 (a local 503), store part 173 of 173, X7 caught. Hosted verify on `c88b7948`: request level 223 of 226, DOM 515 of 518; every miss is the day report's 413 after a day of hosted suite traffic (lane E6, under review R7); every page check passes hosted. Known until E6 lands: heavy rehearsal and a presentation on the same UTC day can meet that refusal at beat 16. Morning routine unchanged: `node scripts/demo-kit/host.mjs --config oh --step seed --confirm edge-platform-oh` then the same with `--step verify` (every step but preflight needs `--confirm` with the worker's name), from WSL.**

> **Status 2026-10-02, 22:40 EDT. Live: the restyled working store, version `5e701b44` from `fa063e7` at https://edge-platform-oh.expedge.workers.dev/oh/ (TV grid `/oh/?view=tvs`, product `/oh/product?id=<sku>`, search `/oh/?q=`, phone `/oh/m`; the worker's root redirects to `/oh/`).** Deployed and reseeded by `host.mjs` (51 of 51 regions, no census term). Hosted suites on that version: **request level 221 of 221, DOM 466 of 466**. Independent visual review R5: PASS, every region CLOSE or MATCH beside lg.com at 1440 and 390; its CLOSE-to-MATCH list (lg.com's action red as a pill, a full-bleed hero with lighter weights, the 80 px header with icons, the charcoal top bar, phone carousels and a docked buy bar, a category pager) is the next pass. **Morning routine:** `host.mjs --config oh --step seed --confirm edge-platform-oh` then `--step verify`; the reset starts a new Dana. Design and decisions: `docs/lg/OH-Demo-Design.md`.


> **Status 2026-10-02: scaffolded, not built, not deployed.** `scripts/demo-kit/new-demo.mjs` wrote the scaffold from `public/oh/demo.config.json`. The worker `edge-platform-oh`, its queues, its tenant and its secrets do not exist until the owner approves creating them. Keep this status line current: what is deployed (version and commit), what was verified hosted, what is open.

**Assume the reader has none of the prior context.** Start from the design ([docs/lg/OH-Demo-Design.md](../../docs/lg/OH-Demo-Design.md)), then [the design pointer](OH-Demo-Design.md) for where everything lives, then this file for how to run it.

## What is running, and where

| | |
|---|---|
| Local worker | `http://localhost:9120/oh/`: `wrangler dev` **inside WSL**, `--config wrangler.oh.toml --persist-to .wrangler/state-oh`. Not running after a restart. |
| Hosted worker | none yet: `https://edge-platform-oh.expedge.workers.dev/oh/` once the owner approves |

## Bring it back up locally (from WSL, at the repository root)

`scripts/demo-kit/rig.mjs` runs the rig on its own port and state. Until the lead has added the mount lines to `src/index.ts` (the design pointer lists them), it runs a copy of `src/index.ts` with them applied (`.wrangler/rig-oh/index.ts`); and when `.dev.vars` does not provision `oh` (`TENANTS` with grants for oh-demo, seed-oh, seed-oh-region, `SDK_KEYS` `oh:demo-site`, `RETENTION` for the tenant), it passes those three settings for that one process, never writing `.dev.vars` and never printing a value. `JWT_SECRET` and `IDENTITY_SALT` stay in `.dev.vars`. Never copy a value into a document or a page.

```bash
cd /mnt/c/Users/LAH/Documents/__Development/Optimizely/__cloudflare_base
node scripts/build-demo-worker-config.mjs --name edge-platform-oh --queue events-oh --dev-port 9120
node scripts/demo-kit/rig.mjs --config oh --port 9120 --state .wrangler/state-oh --prepare   # a fresh state: migrations, census rows, then wrangler dev
node scripts/demo-kit/rig.mjs --config oh --port 9120 --state .wrangler/state-oh             # every later time; Ctrl-C stops it
# in another WSL shell: the local mint (the secret goes into the environment, never onto the screen)
export JWT_SECRET="$(grep '^JWT_SECRET=' .dev.vars | cut -d= -f2- | tr -d "'")" JWT_ISSUER=edge-platform JWT_AUDIENCE=edge-platform-api DEPLOYMENT_PROFILE=demo
node scripts/demo-kit/seed.mjs --config oh --base http://localhost:9120          # re-anchors every window to now and rewrites public/oh/beats/
node scripts/demo-kit/region-seed.mjs --config oh --base http://localhost:9120   # every state, synthetic → warehouse; about 4 minutes
```

- The seed rewrites `public/oh/beats/*.json`; in a shared checkout, snapshot them by hash before it and put them back after, or use `--out` under your scratchpad for every seed after the first.
- Lanes run their own rigs, each on its own port and `.wrangler/state-<lane>`; never two suites at once on one tenant.
- Restart the rig after any new file under `public/`: `wrangler dev` lists the static assets at startup.
- `wrangler dev` never runs the scheduled jobs; fold the hours yourself before a day report: `curl "http://localhost:9120/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"`.

## The two suites, and the kit's check

```bash
node scripts/demo-kit/check-demo.mjs --config oh --base http://localhost:9120   # bundles, typecheck, the credential grep, both suites
node scripts/rehearse-oh-page.mjs --base http://localhost:9120                  # request level; any shell
node scripts/rehearse-oh-dom.mjs  --base http://localhost:9120                  # the real page in headless Chrome; Windows, Node 22+
```

Run them one at a time: both publish into the one tenant, and each ends with the reset.

## The worker, once (the owner's approval; every line is a cloud change)

```text
1. Queues         npx wrangler queues create events-oh ; npx wrangler queues create events-oh-dlq
2. Secrets        npx wrangler secret put <NAME> --config wrangler.oh.toml, for each of TENANTS, SDK_KEYS, RETENTION, JWT_SECRET, IDENTITY_SALT
                  (before the first deploy, so its first real version boots with TENANTS set)
3. Build          npm run check:generated
                  node scripts/build-demo-worker-config.mjs --name edge-platform-oh --queue events-oh --dev-port 9120
4. Deploy         npx wrangler deploy --config wrangler.oh.toml       (from a clean worktree made by WSL git)
5. Crons          npx wrangler triggers deploy --config wrangler.oh.toml   (a worker begun as a draft by secret put may not get them)
6. Seed           the morning routine below, then verify through the APIs, never the pages
```

## The morning routine

One script runs the hosted sequence from a clean WSL worktree of the branch head and refuses the shared worker and the customer stamps; every step but preflight needs `--confirm` with the worker's name. From WSL at the repository root:

```bash
node scripts/demo-kit/host.mjs --config oh --step seed --confirm edge-platform-oh     # the hosted seed, the redeploy a reseed requires, the region seed (about 12 minutes)
node scripts/demo-kit/host.mjs --config oh --step verify --confirm edge-platform-oh   # check-demo against the hosted worker: request level and DOM suites (about 20 minutes)
```

After a code change: `node scripts/demo-kit/host.mjs --config oh --step preflight` (bundles, typecheck, the credential grep, the config byte-equal to the builder's, the head mounts `/oh/api`), then `node scripts/demo-kit/host.mjs --config oh --from deploy --confirm edge-platform-oh` (deploy, seed, redeploy, region seed, verify). Operator tokens are minted inside the script from the owner's `OH_REMOTE_JWT_SECRET` in `.dev.vars` and never printed. The old hand sequence (builder, `seed.mjs`, `wrangler deploy`, `region-seed.mjs`, `check-demo.mjs`) is what the script runs, in that order, and is not run by hand any more.

**A reset starts a new Dana:** the sign-in links `oh-demo-dana-whitfield-<generation>`, the generation being the catalog revision the last reset published (beat 1, or a suite's closing reset), so one showing's laptop and phone are one fresh person and nobody from an earlier showing is in her (`src/routes/oh.ts`).

## Hard-won rules (from Vantage)

- **A reseed is followed by a deploy, always.** The worker applies beats from its own `ASSETS` copy of `public/oh/beats/`.
- **Verify through the APIs, never the pages.** A 200 on a static page proves only that a file exists.
- **Deploy from a clean worktree made by WSL git.** Windows git checks it out with CRLF and `check:generated` fails on that alone.
- **Never `npx wrangler deploy` from the repository root**: `wrangler.toml` names the shared worker.
- **This checkout is shared.** Stage only your own paths; never `git add -A`.

## Decisions log

| Date | Decision | By |
|---|---|---|
| 2026-10-02 | Scaffolded; nothing created in the cloud | scaffold |
