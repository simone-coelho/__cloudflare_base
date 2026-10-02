# How to build a demo on the kit

**For a solutions engineer who has never seen this repository.** From a customer brief to a hosted demo, in the order the work actually happens. Each step names the file you edit, the command you run and what "done" looks like. The worked examples are Vantage (Verizon, `public/vantage/`) and OH (LG, `public/oh/`). If you work with Claude Code, `/new-demo` runs steps 3 to 8 with you (`.claude/skills/new-demo/SKILL.md`).

A demo is **a palette, a product feed and a set of beats on a shared chassis**, never a rebuild. You write data; the kit (`public/demo-kit/`, `src/demos/kit/`, `scripts/demo-kit/`) does the rest.

---

## Before anything: the four rules

1. **The page never ranks.** It sends events and renders what the engine decided, in the order it decided it. A beat that works only because of page code is a claim the product cannot keep.
2. **Every figure on stage is real or labelled.** Synthetic regional sales say "synthetic → warehouse"; the census is shown, never scored; attribution is never called lift.
3. **No credential in a page.** `public/` is served wholesale. A merchandiser beat is a *name* the worker publishes; the worker mints its own short-lived authority.
4. **The visitor's region is always the request's own.** A contrast region is asserted by a press, labelled, and never the opening default.

And two about the machinery: **never run `npx wrangler deploy` from the repository root** (it would replace the shared worker that runs four older demos), and **nothing is created in the cloud without the owner's approval** (worker, queues, secrets, tenant).

---

## 1. Research, in parallel (hours, not days)

Before a line of config, understand the customer. Run these as parallel research lanes (agents or people), each writing one file under `docs/<customer>/research/`:

| Lane | Answers | Example |
|---|---|---|
| Site reconnaissance and taxonomy | How the site is built, its categories, filters and attributes, product rows with images | `docs/lg/research/lg-site-recon.md`, `lg-taxonomy.json` |
| Buying journey and merchandising levers | How people shop, what the merchandiser can move | `docs/lg/research/lg-buying-journeys.md` |
| Data and cold start | What first-party data exists, what a stranger looks like on arrival | `docs/lg/research/lg-data-and-memory.md` |
| Competitive landscape | What they run today, framed as their next step, never a critique | `docs/lg/research/lg-landscape.md` |
| Code map | Where the kit already does it, and what is new engine work | `docs/lg/research/lg-framework-map.md` |

Then one document of **use cases**, each in the customer's own words with who said it: `docs/lg/LG-Understanding-and-Use-Cases.md` is the template. Its "lines we hold" section (price never varies by geography, no protected class, and so on) applies to every piece of copy you write later.

**Done when** the owner has read the use cases and agreed the story.

## 2. The design document, with its decisions log

One governing document, `docs/<customer>/<NAME>-Demo-Design.md` (OH: `docs/lg/OH-Demo-Design.md`): the fictional name and palette (the customer's colours, never their mark), the surfaces and their slots (what is decided, what is off limits), the dimensions with their memory (τ), the walk as acts and beats (each: the press, what moves, what the room sees), the data, the engine items, the lanes. It ends with a **decisions log**: date, decision, who. Every later question that is not answered there goes to the lead, and the answer becomes a row.

**Done when** the lead has opened it and its lanes are named.

## 3. The demo config: `public/<slug>/demo.config.json`

The one file you edit first. Pick a short **slug** (OH: `oh`); it fixes everything else: the worker is `edge-platform-<slug>`, its queue `events-<slug>`, the tenant usually the slug, the public directory `public/<slug>`, and a dev port no other demo uses (Vantage 9110, OH 9120). Copy `public/oh/demo.config.json` and change it section by section:

| Section | What you write |
|---|---|
| `name`, `slug`, `tenant`, `customer`, `worker`, `design` | the names above; `design` points at your design document |
| `brand`, `palette`, `fonts` | the wordmark, the page title, the footer's honesty sentence; colours as the kit's tokens (`brand`, `brand-deep`, `ink`, `paper`, `line`, `soft`, ... from `public/demo-kit/tokens.css`); Google Fonts families |
| `dimensions` | each `{ key, tau, values, multi? }`: `tau` as `60s`, `10m`, `60d`; `values` the vocabulary, from the products file |
| `regional` | the dimensions the regional prior may blend |
| `pages` | each page: its `key`, the engine's `page` name, its `entry` (`home`, `grid`, `product`, `phone`), its `url`, its `shell`, and its `slots` (`slot`, `take`, `weights`, and optionally `diversity`, `stage`, `complements`, a `gate` that keeps a slot closed until the page asserts it), plus `sorted` rails over the products (`POST /sort`) and `offLimits` in words |
| `seeds` | what an arrival is evidence for, as context: `{ slots, signal: campaign_term, value: "lg tvs", tags, weight }` |
| `arrival` | the landing beat 1 opens on (`utm_source`, `utm_medium`, `utm_term`) |
| `beats` | `acts` by number, and `list`: each beat's `key`, `no`, `act`, `who` (shopper, merch, engine), `label`, `press`, `declare[]`, `will[]`, `line`, `kind` (`context`, `catalog`, `slots`), the `change` a publish makes (`shiftDays`, `close`, `outOfStock`, `pin`), the `lane` that writes its presses, and a `run` when you already know it |
| `products` | the products file and how to read it: `list`, `id`, the `attributes` map (event attribute → product field, dotted paths allowed), an `overlay` merged by id, `pageContext` (what a product page asserts as `ctx.*`) |
| `catalog`, `imagery`, `region` | where the data lanes write; the region section's vocabulary and the contrast regions |
| `asserted`, `reportSlots`, `flags`, `copy` | the intents the page may assert, the slots a day report reads, the clock jump and the sign-in accounts (**fictional names only**; their secrets live on the worker), the cold-start sentences |

Check it as you go; the validator names every problem by field:

```bash
node -e "import('./scripts/demo-kit/lib/config.mjs').then(m=>console.log(m.validateDemoConfig(JSON.parse(require('fs').readFileSync('public/<slug>/demo.config.json','utf8')))))"
```

## 4. The scaffold

```bash
node scripts/demo-kit/new-demo.mjs --config public/<slug>/demo.config.json --dry-run    # see the plan
node scripts/demo-kit/new-demo.mjs --config public/<slug>/demo.config.json [--leave img/MANIFEST.json]
```

It refuses a slug whose worker, queue, tenant or port another demo holds, and **never overwrites a file that exists** (it says "exists, left as it is"; `--leave` keeps a path for another lane even when it is absent). It writes: `wrangler.<slug>.toml` (through `scripts/build-demo-worker-config.mjs`), `src/demos/<slug>.config.ts` and `src/routes/<slug>.ts` (the kit's route factories), the three page shells, `<slug>.css` (your palette as tokens), `<slug>.js` (empty renderers, the facts skeleton, section markers for the page lanes), `beats.json` (the director's script), `beats/` (the anchor file, the opening catalog and slots, one document per beat), a labelled starter catalog and placeholder products file when you have none, the kit config `scripts/demo-kit/configs/<slug>.json` with its reflex and learn documents, two suites with the arrival checks written, and `docs/<slug>/` (design pointer, presenter script, resume, each with a decisions log and the morning routine).

It **prints, and never applies**, two things: the mount lines for `src/index.ts` (the lead adds them), and the cloud resources the worker will need, by name only.

When your real catalog lands after a starter one, cut the opening documents from it again, before anyone edits them by hand:

```bash
node scripts/demo-kit/new-demo.mjs --config public/<slug>/demo.config.json --rebuild-beats
```

## 5. Products and imagery (data lanes)

- **Products** `public/<slug>/products.json`: the customer's real products by their real names and prices, one row each, with the attributes your dimensions name. Prices are content: the engine never decides one. The seed holds every product fact a beat document states (a featured product id, an event's price) to this file and **refuses to publish** when they disagree.
- **Catalog pieces** `public/<slug>/catalog.json`: promotions, heroes, modules, packages; each with `tags` in your vocabulary, the `slotTypes` it can fill, a `window`, an `eligibleWhen` rule when it must fail closed, and page-only fields under `display` (the scaffold strips them from what the engine receives). A value no piece names builds no taste, and the seed refuses it.
- **Imagery** `public/<slug>/img/` with `MANIFEST.json`: provenance, source hash and a by-eye verdict per file (`scripts/demo-kit/fetch-imagery.mjs`), within a 25 MB budget. Real product images are allowed for the products the customer itself sells; never another company's brand assets, never the customer's logo.
- **Regional sales** `scripts/demo-kit/configs/<slug>/region.json`: synthetic sales for every US state over the allowlisted dimensions, labelled synthetic → warehouse; its vocabulary must equal the one in `src/demos/<slug>.config.ts`.

## 6. The beats

`public/<slug>/beats.json` is the director's script: each beat's sentences (templates over the page's facts, `{{region.ownName}}`) and its `run`, a list of the kit's verbs (`open`, `click`, `select`, `wait`, `custom`, `assert`, `focus`, `publish`, `ask`, `template`) and one escape hatch, `call`, into your page's own functions. Read Vantage's `public/vantage/beats.json` for every verb in use. A beat the scaffold has not built runs `notBuilt` and stops with its lane named: it never lands silently. A merchandiser beat is a publish by name of a document under `beats/`; the worker's closed list in `src/demos/<slug>.config.ts` must name it.

Every template must resolve against the facts your page computes (`facts()` in `<slug>.js`); the page refuses to boot and names the path when one does not.

## 7. A local rig, and the suites

From WSL (the Linux `workerd` only runs there), at the repository root, on your own port and state directory:

```bash
node scripts/demo-kit/rig.mjs --config <slug> --port <port> --state .wrangler/state-<you> --prepare   # a fresh state: migrations and census rows, then wrangler dev
node scripts/demo-kit/rig.mjs --config <slug> --port <port> --state .wrangler/state-<you>             # every later time: wrangler dev; Ctrl-C stops it
```

The rig provisions your tenant for that one process when `.dev.vars` does not (it never writes `.dev.vars` and never prints a value), and runs the printed mount lines on a copy of `src/index.ts` until the lead has applied them. Then, in another WSL shell:

```bash
export JWT_SECRET="$(grep '^JWT_SECRET=' .dev.vars | cut -d= -f2- | tr -d "'")" JWT_ISSUER=edge-platform JWT_AUDIENCE=edge-platform-api DEPLOYMENT_PROFILE=demo
node scripts/demo-kit/seed.mjs --config <slug> --base http://localhost:<port>          # publishes the opening documents
node scripts/demo-kit/region-seed.mjs --config <slug> --base http://localhost:<port>   # every state, about 4 minutes
```

The seed rewrites `public/<slug>/beats/*.json` with windows anchored to now: snapshot them by hash first if others share the checkout, and put them back after. Then, from Windows (the DOM suite needs Chrome):

```bash
node scripts/demo-kit/check-demo.mjs --config <slug> --base http://localhost:<port>
```

That is the gate: the generated bundles, the app typecheck, the credential grep over everything the pages load, and both suites (`scripts/rehearse-<slug>-page.mjs`, request level; `scripts/rehearse-<slug>-dom.mjs`, the real page in a fresh headless Chrome). Every check reads what a person would see: computed style and a real box, never an attribute. Add each beat's measured outcome to both suites as its presses land. Run suites one at a time: they share the tenant and each ends with its reset.

## 8. The deploy, on the owner's go

Nothing below happens without the owner's explicit approval; each line is a cloud change. From a **clean worktree created by WSL git** of the exact commit (Windows git checks out CRLF and `check:generated` fails on that alone):

```text
queues    npx wrangler queues create events-<slug> ; npx wrangler queues create events-<slug>-dlq
secrets   npx wrangler secret put <NAME> --config wrangler.<slug>.toml   for TENANTS, SDK_KEYS, RETENTION, JWT_SECRET, IDENTITY_SALT
          (before the first deploy, so the first version boots with TENANTS set)
build     npm run check:generated
          node scripts/build-demo-worker-config.mjs --name edge-platform-<slug> --queue events-<slug> --dev-port <port>
deploy    npx wrangler deploy --config wrangler.<slug>.toml
crons     npx wrangler triggers deploy --config wrangler.<slug>.toml   (a worker begun as a draft by secret put may not get them)
seed      the morning routine, then verify through the APIs, never the pages
```

Record the version id wrangler prints in `docs/<slug>/RESUME-<slug>.md`.

## 9. The morning routine (every rehearsal morning)

The windows are anchored to the seed's moment and the regional prior has a 24-hour horizon, so:

```bash
npm run check:generated
node scripts/demo-kit/seed.mjs --config <slug> --base https://edge-platform-<slug>.expedge.workers.dev --token <operator token>
npx wrangler deploy --config wrangler.<slug>.toml          # the seed rewrote the beat documents the worker serves; the owner's go
node scripts/demo-kit/region-seed.mjs --config <slug> --base https://edge-platform-<slug>.expedge.workers.dev --token <operator token>
node scripts/demo-kit/check-demo.mjs --config <slug> --base https://edge-platform-<slug>.expedge.workers.dev
```

**A reseed is always followed by a deploy.** The operator token is minted from the hosted worker's own `JWT_SECRET` as `docs/verizon/RESUME-vantage.md` shows; never write it down.

---

## Where to look when something is wrong

| Symptom | Look at |
|---|---|
| The page says `beats.json: beat N.…: {{path}}` | a template names a fact `facts()` does not hold |
| The seed stops with "nothing written, nothing sent" | the line above it: a vocabulary value no piece names, an anchor copy that disagrees, a product fact that disagrees with the products file |
| Every call fails with "Tenant unavailable" | the page did not send `X-Tenant`, or the worker does not provision the tenant (the rig says which) |
| `/<slug>/api/*` answers 404 | the mount lines are not in `src/index.ts` (the rig runs them on a copy until they are), or `DEPLOYMENT_PROFILE` is not `demo` |
| Receipts say "no record" for a minute | the ledger writes a few seconds after a decision; restart a local rig after a report build |

The operating rules for every demo worker are in `AGENTS.md` ("Demo operations") and `docs/demos/BOOTSTRAP.md`; the kit's design and its decisions are `docs/demo-kit/Demo-Kit-Design.md`.
