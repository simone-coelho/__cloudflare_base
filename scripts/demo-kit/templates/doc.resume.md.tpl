# @@NAME@@: resume state

> **Status @@DATE@@: scaffolded, not built, not deployed.** `scripts/demo-kit/new-demo.mjs` wrote the scaffold from `public/@@SLUG@@/demo.config.json`. The worker `@@WORKER@@`, its queues, its tenant and its secrets do not exist until the owner approves creating them. Keep this status line current: what is deployed (version and commit), what was verified hosted, what is open.

**Assume the reader has none of the prior context.** Start from the design ([@@DESIGN@@](../../@@DESIGN@@)), then [the design pointer](@@NAME@@-Demo-Design.md) for where everything lives, then this file for how to run it.

## What is running, and where

| | |
|---|---|
| Local worker | `http://localhost:@@PORT@@/@@SLUG@@/`: `wrangler dev` **inside WSL**, `--config wrangler.@@SLUG@@.toml --persist-to .wrangler/state-@@SLUG@@`. Not running after a restart. |
| Hosted worker | none yet: `https://@@WORKER@@.expedge.workers.dev/@@SLUG@@/` once the owner approves |

## Bring it back up locally (from WSL, at the repository root)

`scripts/demo-kit/rig.mjs` runs the rig on its own port and state. Until the lead has added the mount lines to `src/index.ts` (the design pointer lists them), it runs a copy of `src/index.ts` with them applied (`.wrangler/rig-@@SLUG@@/index.ts`); and when `.dev.vars` does not provision `@@TENANT@@` (`TENANTS` with grants for @@OPERATORS@@, `SDK_KEYS` `@@TENANT@@:demo-site`, `RETENTION` for the tenant), it passes those three settings for that one process, never writing `.dev.vars` and never printing a value. `JWT_SECRET` and `IDENTITY_SALT` stay in `.dev.vars`. Never copy a value into a document or a page.

```bash
cd /mnt/c/Users/LAH/Documents/__Development/Optimizely/__cloudflare_base
node scripts/build-demo-worker-config.mjs --name @@WORKER@@ --queue @@QUEUE@@ --dev-port @@PORT@@
node scripts/demo-kit/rig.mjs --config @@SLUG@@ --port @@PORT@@ --state .wrangler/state-@@SLUG@@ --prepare   # a fresh state: migrations, census rows, then wrangler dev
node scripts/demo-kit/rig.mjs --config @@SLUG@@ --port @@PORT@@ --state .wrangler/state-@@SLUG@@             # every later time; Ctrl-C stops it
# in another WSL shell: the local mint (the secret goes into the environment, never onto the screen)
export JWT_SECRET="$(grep '^JWT_SECRET=' .dev.vars | cut -d= -f2- | tr -d "'")" JWT_ISSUER=edge-platform JWT_AUDIENCE=edge-platform-api DEPLOYMENT_PROFILE=demo
node scripts/demo-kit/seed.mjs --config @@SLUG@@ --base http://localhost:@@PORT@@          # re-anchors every window to now and rewrites public/@@SLUG@@/beats/
node scripts/demo-kit/region-seed.mjs --config @@SLUG@@ --base http://localhost:@@PORT@@   # every state, synthetic → warehouse; about 4 minutes
```

- The seed rewrites `public/@@SLUG@@/beats/*.json`; in a shared checkout, snapshot them by hash before it and put them back after, or use `--out` under your scratchpad for every seed after the first.
- Lanes run their own rigs, each on its own port and `.wrangler/state-<lane>`; never two suites at once on one tenant.
- Restart the rig after any new file under `public/`: `wrangler dev` lists the static assets at startup.
- `wrangler dev` never runs the scheduled jobs; fold the hours yourself before a day report: `curl "http://localhost:@@PORT@@/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"`.

## The two suites, and the kit's check

```bash
node scripts/demo-kit/check-demo.mjs --config @@SLUG@@ --base http://localhost:@@PORT@@   # bundles, typecheck, the credential grep, both suites
node scripts/rehearse-@@SLUG@@-page.mjs --base http://localhost:@@PORT@@                  # request level; any shell
node scripts/rehearse-@@SLUG@@-dom.mjs  --base http://localhost:@@PORT@@                  # the real page in headless Chrome; Windows, Node 22+
```

Run them one at a time: both publish into the one tenant, and each ends with the reset.

## The worker, once (the owner's approval; every line is a cloud change)

```text
1. Queues         npx wrangler queues create @@QUEUE@@ ; npx wrangler queues create @@QUEUE@@-dlq
2. Secrets        npx wrangler secret put <NAME> --config wrangler.@@SLUG@@.toml, for each of @@SECRETS@@
                  (before the first deploy, so its first real version boots with TENANTS set)
3. Build          npm run check:generated
                  node scripts/build-demo-worker-config.mjs --name @@WORKER@@ --queue @@QUEUE@@ --dev-port @@PORT@@
4. Deploy         npx wrangler deploy --config wrangler.@@SLUG@@.toml       (from a clean worktree made by WSL git)
5. Crons          npx wrangler triggers deploy --config wrangler.@@SLUG@@.toml   (a worker begun as a draft by secret put may not get them)
6. Seed           the morning routine below, then verify through the APIs, never the pages
```

## The morning routine

```bash
npm run check:generated
node scripts/build-demo-worker-config.mjs --name @@WORKER@@ --queue @@QUEUE@@ --dev-port @@PORT@@
node scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/@@SLUG@@.json --base https://@@WORKER@@.expedge.workers.dev --token <operator token>
npx wrangler deploy --config wrangler.@@SLUG@@.toml        # the seed rewrote public/@@SLUG@@/beats/
node scripts/demo-kit/region-seed.mjs --config scripts/demo-kit/configs/@@SLUG@@.json --base https://@@WORKER@@.expedge.workers.dev --token <operator token>
node scripts/demo-kit/check-demo.mjs --config @@SLUG@@ --base https://@@WORKER@@.expedge.workers.dev
```

## Hard-won rules (from Vantage)

- **A reseed is followed by a deploy, always.** The worker applies beats from its own `ASSETS` copy of `public/@@SLUG@@/beats/`.
- **Verify through the APIs, never the pages.** A 200 on a static page proves only that a file exists.
- **Deploy from a clean worktree made by WSL git.** Windows git checks it out with CRLF and `check:generated` fails on that alone.
- **Never `npx wrangler deploy` from the repository root**: `wrangler.toml` names the shared worker.
- **This checkout is shared.** Stage only your own paths; never `git add -A`.

## Decisions log

| Date | Decision | By |
|---|---|---|
| @@DATE@@ | Scaffolded; nothing created in the cloud | scaffold |
