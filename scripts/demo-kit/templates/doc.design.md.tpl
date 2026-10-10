# @@NAME@@: the demo's design, as built on the kit

**A pointer, scaffolded @@DATE@@ by `scripts/demo-kit/new-demo.mjs`.** The governing design, with its use cases, surfaces, dimensions, beats and lanes, is **[@@DESIGN@@](../../@@DESIGN@@)**; this file says where each of its decisions lives in the repository, and logs the decisions made while building. A lane that needs a decision not logged in either file stops and asks the lead.

| | |
|---|---|
| Customer | @@CUSTOMER@@ |
| Tenant | `@@TENANT@@` |
| Worker | `@@WORKER@@` (its own; never the shared `edge-platform`, never a customer stamp) |
| Queues | `@@QUEUE@@` and `@@QUEUE@@-dlq` |
| Local port | `@@PORT@@` |
| The config | `public/@@SLUG@@/demo.config.json`, the one file an SE edits first; `scripts/demo-kit/configs/@@SLUG@@.json` is derived from it |
| The page | `public/@@SLUG@@/index.html`, `product.html`, `m.html`, `@@SLUG@@.css`, `@@SLUG@@.js` on `public/demo-kit/` |
| The beats | `public/@@SLUG@@/beats.json` (the director's script) and `public/@@SLUG@@/beats/*.json` (the published documents) |
| The server | `src/demos/@@SLUG@@.config.ts` (the constants) and `src/routes/@@SLUG@@.ts` (the kit's factories) |
| The suites | `scripts/rehearse-@@SLUG@@-page.mjs` (request level) and `scripts/rehearse-@@SLUG@@-dom.mjs` (the real page) |
| Decided slots | @@SLOTS@@ |

## The beats as scaffolded

| # | Act | The press | What moves | Beat document | Its presses are written by |
|---|---|---|---|---|---|
@@BEATS_TABLE@@

A beat whose presses are not written yet runs `notBuilt`: the status line names its lane and the beat stops. It never lands as "done".

## The mount lines (the lead applies them to `src/index.ts`)

```ts
@@MOUNT_IMPORT@@
@@MOUNT_1@@
@@MOUNT_2@@
```

## The morning routine (every rehearsal morning, hosted, once the worker exists)

```bash
npm run check:generated
node scripts/build-demo-worker-config.mjs --name @@WORKER@@ --queue @@QUEUE@@ --dev-port @@PORT@@
node scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/@@SLUG@@.json --base https://@@WORKER@@.expedge.workers.dev --token <operator token>
npx wrangler deploy --config wrangler.@@SLUG@@.toml          # the seed rewrote public/@@SLUG@@/beats/; the owner's go
node scripts/demo-kit/region-seed.mjs --config scripts/demo-kit/configs/@@SLUG@@.json --base https://@@WORKER@@.expedge.workers.dev --token <operator token>
node scripts/demo-kit/check-demo.mjs --config @@SLUG@@ --base https://@@WORKER@@.expedge.workers.dev
```

The windows are anchored to the seed's moment and the regional prior has a 24-hour horizon, so a rehearsal morning needs all of it. A reseed is always followed by a deploy.

## Decisions log

| Date | Decision | By |
|---|---|---|
| @@DATE@@ | Scaffolded from `public/@@SLUG@@/demo.config.json` by `scripts/demo-kit/new-demo.mjs`; the design above governs | scaffold |
