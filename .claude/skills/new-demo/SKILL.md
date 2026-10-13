---
name: new-demo
description: Start a new customer demo on the demo kit, from a brief to a scaffold that boots and passes its arrival checks. Interviews for the customer, the fictional name, the palette, the product source and the story in three to five beats; writes public/<slug>/demo.config.json; runs scripts/demo-kit/new-demo.mjs; dispatches build lanes for the renderers, the catalog pieces and the imagery by path ownership; runs check-demo against a local rig; writes the resume. Never deploys and never creates a cloud resource; it prints the deploy command for the owner. Use when someone asks for a new demo, a demo for a new customer or prospect, or to "do the Vantage method" for someone.
---

# /new-demo

You are leading a new demo on the kit. The guide a solutions engineer reads is `docs/demo-kit/HOWTO.md`; follow it, in its order. The kit's design and its decisions log are `docs/demo-kit/Demo-Kit-Design.md`; the worked examples are Vantage (`public/vantage/`, `docs/verizon/`) and OH (`public/oh/demo.config.json`, `docs/lg/OH-Demo-Design.md`). Lead and govern: write briefs, sequence lanes, verify; agents build. Plan in hours, run lanes in parallel.

## Hard rules (stop and ask rather than break one)

- **No cloud resource of any kind**: no worker, queue, secret, D1 or tenant created; nothing run against a hosted worker; no deploy. Print the commands for the owner.
- **Never `npx wrangler deploy` from the repository root**; never touch `wrangler.toml`, the shared worker, Top Offers, Vantage or a customer stamp.
- **Never edit `src/index.ts`**: the scaffold prints its two mount lines; hand them to the lead.
- **No credential in a page or a config**: sign-in demo accounts are fictional names only. Secrets come from the local `.dev.vars`, are never printed and never written.
- **No `git checkout/reset/stash/restore/switch/rm`, no `rm -rf`, no installs, no commit or push.** Preserve every file other sessions have open in the checkout.
- **The visitor's region is the request's own**; a contrast region is asserted and labelled. Synthetic data is labelled synthetic → warehouse. Price never varies by geography or inferred income.

## 1. Interview (one message, then wait)

Ask, plainly, and record the answers in the design document's decisions log:

1. **The customer** and the room: who will watch, and what they asked for (their words, with who said it).
2. **The fictional name** (a nod to the customer is welcome; never their mark) and a **slug** of two to eight lower-case letters.
3. **The palette**: the customer's brand colour, ink, paper, a quiet panel colour; the fonts (Inter and JetBrains Mono unless they say otherwise).
4. **The product source**: a crawl, a feed, a list; which categories the first build carries.
5. **The story in three to five beats**: for each, the press, what moves, what the room sees; the arrival first (beat 1 lands from a real landing in her real region).

If there is no research yet, propose the five research lanes of HOWTO §1 and the design document of §2 before any config; the owner wants the understanding before a build.

## 2. Write the config, then scaffold

1. Write `public/<slug>/demo.config.json` from the answers and the design, copying `public/oh/demo.config.json`'s shape: worker `edge-platform-<slug>`, queue `events-<slug>`, a dev port no `wrangler.*.toml` or `scripts/demo-kit/configs/*.json` uses, the palette as kit tokens, the pages and slots, the dimensions with their memory, the beats with `kind`, `change` for publishes and the `lane` that builds each.
2. Validate it until it is clean (the command in HOWTO §3).
3. `node scripts/demo-kit/new-demo.mjs --config public/<slug>/demo.config.json --dry-run`, read the plan, then run it for real (with `--leave <path>` for anything a data lane is already writing).
4. Hand the printed mount lines to the lead; keep the printed cloud list for the owner.

## 3. Dispatch build lanes, by path ownership

One writer per path, ever. Brief each lane with its paths, its rig (port and `.wrangler/state-<lane>`), the rules above, and a Report section to fill. Typical lanes, in parallel:

| Lane | Owns | Builds |
|---|---|---|
| Data: products and pieces | `public/<slug>/products.json`, `catalog.json`, `scripts/demo-kit/configs/<slug>/region.json` | the products by real name and price with the attributes; the catalog pieces with tags, windows and `eligibleWhen`; the all-states regional vocabulary |
| Imagery | `public/<slug>/img/**`, `scripts/demo-kit/configs/<slug>/imagery.json` | images with a provenance manifest and a by-eye verdict per file |
| Page lanes | sections of `public/<slug>/<slug>.js` by the scaffold's markers, the shells, `<slug>.css`, `beats.json` presses | the renderers and the facts their beats read; each beat's `run` on the kit's verbs |
| Engine items | `src/content/**`, `src/learn/**`, `src/reflex/**` as needed, with tests | anything general the story needs that the engine lacks |
| Suites | `scripts/rehearse-<slug>-*.mjs`, `scripts/demo-kit/configs/<slug>.json` | each beat's measured outcome, computed state only |

When the data lane's catalog replaces the starter one, run `new-demo.mjs --rebuild-beats` once, before anyone edits the beat documents by hand.

## 4. Verify on a local rig

From WSL: `node scripts/demo-kit/rig.mjs --config <slug> --port <port> --state .wrangler/state-<slug> --prepare`, then without `--prepare` to run it; seed it (`seed.mjs`, `region-seed.mjs`, with the local mint in HOWTO §7), snapshotting `public/<slug>/beats/*.json` by hash first and restoring after. From Windows: `node scripts/demo-kit/check-demo.mjs --config <slug> --base http://localhost:<port>`. Report the counts as the suites print them; never claim a number they did not read.

## 5. Write the resume, and stop

Fill `docs/<slug>/RESUME-<slug>.md`'s status line: what is built, what the suites read, what is open, and the deploy command for the owner, exactly:

```text
npm run check:generated && node scripts/build-demo-worker-config.mjs --name edge-platform-<slug> --queue events-<slug> --dev-port <port> && npx wrangler deploy --config wrangler.<slug>.toml
```

with the one-time cloud list before it (queues, the five secrets by name, the crons). Do not run it. The owner deploys from a clean WSL worktree of the commit, and verifies through the APIs.
