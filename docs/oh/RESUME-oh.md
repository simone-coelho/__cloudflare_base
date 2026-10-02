# OH: resume state

> **Status 2026-10-02, 14:30 EDT. Live: version `58c61e9a` from `dcd37e5` at https://edge-platform-oh.expedge.workers.dev/oh/ (TV grid `/oh/?view=tvs`, product `/oh/product?id=<sku>`, phone `/oh/m`).** Hosted by `node scripts/demo-kit/host.mjs --config oh --from secrets --confirm edge-platform-oh` from WSL; verified hosted: request level 189 of 189, DOM 329 of 329; 51 of 51 regions seeded. Independent review R4 (`docs/lg/lanes/R4.md`) is on the same commit; its findings ride the next deploy. **Morning routine:** `host.mjs --config oh --step seed --confirm edge-platform-oh` (the hosted seed, the redeploy it requires, the region seed), then `--step verify`; the regional prior's horizon is 24 hours, so the region seed runs on the morning of every rehearsal. The design and its decisions log: `docs/lg/OH-Demo-Design.md`.


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

```bash
npm run check:generated
node scripts/build-demo-worker-config.mjs --name edge-platform-oh --queue events-oh --dev-port 9120
node scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/oh.json --base https://edge-platform-oh.expedge.workers.dev --token <operator token>
npx wrangler deploy --config wrangler.oh.toml        # the seed rewrote public/oh/beats/
node scripts/demo-kit/region-seed.mjs --config scripts/demo-kit/configs/oh.json --base https://edge-platform-oh.expedge.workers.dev --token <operator token>
node scripts/demo-kit/check-demo.mjs --config oh --base https://edge-platform-oh.expedge.workers.dev
```

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
