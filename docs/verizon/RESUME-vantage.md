# Vantage carrier demo: resume state

**Written 2026-09-30, late evening, by lane L5. Assume the reader has none of the prior context.**

Branch `feature/real-time-personalization`. Committed at `3851f35`, not pushed. **The hosted worker is live** since 2026-10-01, on Simone's go (lane D1, below).

---

## What this is

A demo for Verizon that sells nothing. It shows how we think about personalisation **before identity**. A stranger arrives from a paid-social ad, and the first paint answers the ad and her region. She browses, and the homepage and the phone page reorganise around what she does, with a receipt behind every card and the price never touched. Fictional carrier **Vantage**, tenant `vantage`. Real phones and prices; plans and promotions in real shapes; regional sales synthetic and labelled.

## Where to start reading

1. `docs/verizon/Vantage-Demo-Design.md`: the governing brief, §2, §5, §6, §9 and the decisions log §12.
2. `docs/verizon/Vantage-Presenter-Script.md`: the fifteen beats, spoken, with the measured figures.
3. `docs/verizon/lanes/L1.md` (engine, seed, route, deploy checklist) and `L2.md` (the pages, the 22 presses, the DOM hooks). Then `L4.md` (cold start, arrival, exit), `R1.md` (independent review) and `L5.md` (the suites and the findings below).

## What is running, and where

| | |
|---|---|
| Local worker | `http://localhost:9110/vantage/`: `wrangler dev` **inside WSL**, `--config wrangler.vantage.toml --persist-to .wrangler/state-vantage-l1`, on the session host (`REFLEX_HOST=session`). It will not be running after a restart. |
| Hosted worker | **`https://edge-platform-vantage.expedge.workers.dev/vantage/`**, live since 2026-10-01 (version `222b29ab`, lane D1): its own worker, never the shared `edge-platform` and never the Top Offers worker. Reseed it every rehearsal morning (below). |
| Other ports | 9111 and 9112 were lanes L2 and L4's scratch servers. Not needed. |

The page is `public/vantage/index.html` and `phone.html` with `vantage.js`. The worker side is `src/routes/vantage.ts` (beats by name, reset, receipt, report), `src/routes/vantageColdStart.ts` (the Arrival panel) and the engine changes listed in L4.md.

## Bring it back up locally

From WSL: `node_modules` is a Linux install, and Windows `npx` finds a global wrangler 4.4 while WSL runs 4.105.

```bash
cd /mnt/c/Users/LAH/Documents/__Development/Optimizely/__cloudflare_base
node scripts/build-demo-worker-config.mjs --name edge-platform-vantage --queue events-vantage --dev-port 9110
# once per fresh state: the audit tables, then census and crosswalk rows (not the Coach cohort)
CI=1 npx wrangler d1 migrations apply coach-demo-db --local --persist-to .wrangler/state-vantage-l1 --config wrangler.vantage.toml
sed -n 32,172p migrations/seed/seed_011_geo.sql > /tmp/geo-census.sql
npx wrangler d1 execute coach-demo-db --local --persist-to .wrangler/state-vantage-l1 --config wrangler.vantage.toml --file /tmp/geo-census.sql
node scripts/seed-vantage.mjs --files-only          # the beat files exist before wrangler lists public/
npx wrangler dev --config wrangler.vantage.toml --port 9110 --persist-to .wrangler/state-vantage-l1
export JWT_SECRET="$(grep '^JWT_SECRET=' .dev.vars | cut -d= -f2- | tr -d "'")" JWT_ISSUER=edge-platform JWT_AUDIENCE=edge-platform-api DEPLOYMENT_PROFILE=demo
node scripts/seed-vantage.mjs --base http://localhost:9110          # re-anchors every window to now
node scripts/seed-vantage-region.mjs --base http://localhost:9110   # after every reseed
```

- **The regional prior has a 24-hour horizon. Rerun `seed-vantage-region.mjs` on the morning of every rehearsal**, and after every reseed. Without it, New York and Texas open on whatever rehearsal traffic the worker has seen.
- **The seed anchors every promotion window to the moment it runs.** The windows are absolute, so a week-old seed has a flash offer already closed. Reseed on the morning of a rehearsal.
- **Restart `wrangler dev` after any `.dev.vars` edit or any new file under `public/`.** It lists the static assets at startup.
- `wrangler dev` never runs the scheduled jobs. The five-minute fold, the hourly trend rollup and the 03:00 day report run only on a deployed worker.

**Local-only state not in git.** `.dev.vars` is gitignored and must carry five things for `vantage`: `TENANTS` (provisioned, with operator grants for `vantage-demo`, `seed-vantage` and `seed-vantage-region`), `SDK_KEYS` (`vantage:demo-site`), `RETENTION` (the seven categories), `JWT_SECRET` and `IDENTITY_SALT` (the audited receipt read needs it). Never copy a value into a document or a page.

It also carries `VANTAGE_REMOTE_JWT_SECRET`: the hosted worker's own `JWT_SECRET`, which nothing reads automatically. The morning reseed mints its tokens from it. **`.dev.vars` is this machine's only copy, and the owner must back it up.** Without it, the hosted demo cannot be reseeded until a new `JWT_SECRET` is put on the worker (Simone's go).

## The two suites

```bash
node scripts/rehearse-vantage-page.mjs --base http://localhost:9110   # request level; any shell, Node 18+; about 1.5 min
node scripts/rehearse-vantage-dom.mjs  --base http://localhost:9110   # the real page in headless Chrome; Windows, Node 22+; about 3 min
```

- **Run them one at a time.** Both publish into the same tenant. Each starts with the page's own reset and ends with `POST /vantage/api/reset`.
- **The DOM suite opens a fresh Chrome profile of its own on every run**, under the OS temp directory. Two runs sharing one profile collided at launch (R1).
- `--wait 45` shortens beat 5's on-screen minute (the page's `?wait=`). Brand must be re-read at least about 41 seconds after her third Samsung touch.
- `--size 1440x900` is the default viewport, and L2 also walked 1920×1080 and 1366×768.
- A line marked `!` is a known defect in another lane's file, named on the last line; `--strict` makes it fail.
- Both run against a hosted worker with `--base https://edge-platform-vantage.expedge.workers.dev`.
- **Last results, 2026-09-30, on the code after F1:** DOM 220 of 221 at 1920×1080. The one failure was a receipt read answering 503. The request-level suite passed 110 of 110 at 22:09 on a healthy ledger consumer. At 23:17 it passed 102 of 110, after the consumer had stalled, with every receipt check finding "no record". Outputs are in `lanes/L5.md`.
- **Hosted, 2026-10-01, 03:37 to 03:43 UTC (lane D1):** request level 111 of 111, DOM 221 of 221 at 1440×900, no line marked `!`.
- **If every receipt check says "no record", the ledger consumer has stalled.** The worker log stops printing `QUEUE events-vantage` lines and receipts answer 202. Restarting `wrangler dev` clears it. That is the owner's process, so ask; never kill it from a lane.

**Beat 15's report sums folded hours** (`runDayReport`, `src/learn/hourly.ts`). The five-minute cron folds hours closed at least five minutes (`CLOSE_GRACE_MS`), two per run, oldest first, over a 26-hour lookback. So a click appears once its hour has closed and the next fold has run, never in the same second. A click at 10:20 shows from about 11:05. The script says so.

**Locally, fold the hours yourself (R1 7b-iii).** `wrangler dev` never runs the cron. With no folded hour for the day, `/learn/report` reads the day's raw records and refuses past 16 MiB (`REPORT_LIMITS.rawBytes`, `src/learn/report.ts`) with a 413. The busy day of 2026-09-30 measured 16.8 MB (lane F1). The build is always one whole UTC day, with no slot or hour filter. Beat 15 then shows "Report too large for the window (413)", and both suites name it. Fold with the same job the hosted worker runs:

```bash
curl "http://localhost:9110/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"
```

Each run folds two hours, so repeat until today's report builds. A worker idle for a day starts with up to 26 pending hours. Each run also does what the hosted cron does every five minutes: it expires quarantined ledger records, writes one monitor decision per provisioned tenant (they fail locally with 10 to 12 problems), runs the warehouse slice and republishes day reports. The lead ruled this acceptable on 9110 on 2026-09-30.

## The beats and what each publishes

| Presses | Beat | Publishes |
|---|---|---|
| 1 | A stranger from the ad, New York | `POST /vantage/api/reset` (open-slots, then open-catalog), then a new visitor |
| 2–10d | Texas; browse; hinge; exit minute; the phone page; storage; perk; four lines; bring your own; upgrade | nothing: events, snapshots with `ctx.intent` and `ctx.region`, receipts, `/sort` |
| 11 | Two weeks pass | `11-two-weeks-pass` (catalog) |
| 12 | Black Friday | `12-black-friday` (catalog) |
| 13 | Pin the Duo pre-order | `13-pin-duo-preorder` (slots) |
| 14a, 14b | 5G Home where available | nothing (New York, then Montana) |
| 15a–15c | Cart, template, clicks and the report | nothing; 15c builds the day report |

Every beat goes by name through `src/routes/vantage.ts`, with a 60-second operator token minted in the worker. No document or token crosses from the page. Anyone holding the hosted URL can reset the tenant, publish these beats or build a report (R1 N10): the closed list is the protection.

## Deploy checklist for `edge-platform-vantage` (Simone's go; every line is a cloud change)

```text
1. Queues          npx wrangler queues create events-vantage
                   npx wrangler queues create events-vantage-dlq
2. Shared D1       done for the deploy lane, 2026-09-30: coach-demo-db carries 0001-0013 (0010-0013 are the receipt's
                   audited read) and the geo_census rows; check: npx wrangler d1 migrations list coach-demo-db --remote
                   On any FRESH database: "migrations apply --remote" fails on 0012, because D1's remote statement
                   splitter cuts the trigger at its inner CASE ... END;. Apply 0012 and 0013 with
                   npx wrangler d1 execute <db> --remote --file <scratch copy>, where the scratch copy is the committed
                   migration text with its INSERT INTO "d1_migrations" row appended (an all-or-nothing import).
3. Five secrets    npx wrangler secret put <NAME> --config wrangler.vantage.toml
                   TENANTS, SDK_KEYS, RETENTION, JWT_SECRET (new, kept: the hosted seeds' --token is minted
                   with it), IDENTITY_SALT (new, 32+ characters). Shapes in L1.md §4.
                   Secrets come BEFORE the first deploy on purpose: the first secret creates the worker as an empty
                   draft that answers 404 until step 5, so its first real version boots with TENANTS set.
4. Build           npm run check:generated
                   node scripts/build-demo-worker-config.mjs --name edge-platform-vantage --queue events-vantage --dev-port 9110
5. Deploy          npx wrangler deploy --config wrangler.vantage.toml          (from WSL)
6. Seed            node scripts/seed-vantage.mjs --base https://edge-platform-vantage.expedge.workers.dev --token <operator token>
                   npx wrangler deploy --config wrangler.vantage.toml          (the seed rewrote the beat documents)
                   node scripts/seed-vantage-region.mjs --base https://edge-platform-vantage.expedge.workers.dev --token <operator token>
7. Verify          through the APIs, never the pages: snapshot, beat, receipt, report; then both suites with
                   --base https://edge-platform-vantage.expedge.workers.dev
```

- **A reseed is followed by a deploy, always.** The worker applies beats from its own `ASSETS` copy of `public/vantage/beats/`.
- **Deploy forward only.** A slots document carrying `platform` or `dampen` fails the stored parse on older builds (L4 §8.6). Never redeploy an older build, and never touch the shared worker, the Top Offers worker or a customer stamp.

### Reseed the hosted worker, every rehearsal morning

The earliest opening-catalog window closes 24 hours after the seed's anchor, and the regional prior's horizon is 24 hours, so a rehearsal morning needs all three steps. From WSL, at the repo root:

```bash
npm run check:generated
S="$(grep '^VANTAGE_REMOTE_JWT_SECRET=' .dev.vars | cut -d= -f2-)"     # the hosted worker's JWT_SECRET; never print it
mint() { env -u OPERATOR_TOKEN JWT_SECRET="$S" JWT_ISSUER=edge-platform JWT_AUDIENCE=edge-platform-api DEPLOYMENT_PROFILE=demo \
  node -e "import('./scripts/lib/tool-token.mjs').then(m=>m.resolveToolToken({payload:{sub:process.argv[1],roles:['operator']},expiresIn:'30m',allowMint:true})).then(t=>process.stdout.write(t))" "$1"; }
node scripts/seed-vantage.mjs --base https://edge-platform-vantage.expedge.workers.dev --token "$(mint seed-vantage)"
npx wrangler deploy --config wrangler.vantage.toml        # the seed rewrote public/vantage/beats/
node scripts/seed-vantage-region.mjs --base https://edge-platform-vantage.expedge.workers.dev --token "$(mint seed-vantage-region)"
```

- `S` comes from `.dev.vars`, **this machine's only copy; the owner must back it up.**
- Then, with time, run the request-level suite with `--base https://edge-platform-vantage.expedge.workers.dev`. It ends with the reset.

## Known engine findings (none changed here)

1. **The object host stalls the ledger consumer** after 20 to 40 quick snapshots (L1; not reproduced by L4). The worker runs the **session host**. Beat 5 is a timed re-ask on the engine's lazy decay, and the alarm push over `/realtime/ws` stays behind `?exit=1`.
2. **Rare slow meter reads on the session host**: 4 of 771 reads were over 1 s, up to 15.8 s (L1). The page shows "asking the engine" at beat 5. Both findings point at the owner forwards in `src/identity/sessionAuthority.ts` (`ledgerUnderOwners`, line 178; `ownerFetch`'s 5 s abort, line 299).
3. **Report builds raise `Configuration publication authority unavailable`** in `LearnStats.priorsFor` (`src/durable-objects/LearnStats.ts:855`). Locally, an event that lands in that second is refused with 503 "worker restarted mid-request". The page clicks first and builds second, so the walk avoids it (L5).
4. **On the session host an audience flag outlives its score.** The score decays below 0.45 at read, but `brand_samsung_affinity` stays listed until her next event. Ranking reads the score (L5).
5. **The session host's ledger consumer stalled twice on 9110, at 22:11 and about 23:16 on 2026-09-30.** Both followed a beat-15c report build, among bursts of finding 3's errors (L5 finding 4). It is a hypothesis, not a cause, that the restarts those errors trigger leave an owner forward unsettled. Receipt reads also answered 503 now and then (F1 finding 4).
6. **A busy hour can fail to fold on every run**, logged as "hourly fold hours failed and skipped 1" with the cause unlogged. The day report then lists that hour as missing and sums the rest. It happened to 9110's 21:00–22:00 EDT hour on 2026-09-30 (L5). On a hosted rehearsal day, read beat 15's report once the rehearsal hours have folded.
7. **Hosted, observed once: a receipt waited 35 seconds after a report build** (lane D1, 2026-10-01 at 03:44 UTC). A snapshot taken 4 s after a report build answered 202 for 35 s, with 0 of 5 records written. The records were written late, not lost: the next report build counted that visitor. Three rechecks wrote receipts in 4.3 to 4.8 s, one of them straight after a build, and `wrangler tail` showed every queue batch consumed 2 to 3 s after its snapshot, with no exception or retry. The miss came before the tail ran, so its cause was not caught (compare findings 3 and 5).

## The phone page URL

The phone page is `/vantage/phone?id=<id>`, which the assets binding serves everywhere. The path form `/vantage/phone/<id>` is retired: lane F1 emptied L1's route after R1 N7. A browser navigation to it never reached the worker, because the assets binding's fallback answers navigations with the root page. `run_worker_first` would have changed that, but it broke local POSTs with 405. The page suite still reports what a browser gets at the path form, as information.

## What is still open

| | |
|---|---|
| Lane F1, landed (`lanes/F1.md`) | Done: her own phone state after Compare, the named 413 and the report window, the retired path form, the footer's geography sentence, the hero campaign seed, the chips, one reseed. Residuals: the address bar keeps the streaming shopper's `/vantage/phone?id=` until her next press; beat 5's "fading" sentence says "still above" when the minute starts late (L5.md findings 1 and 3). |
| R1's remaining items | The design's geography and "never stored" wording, cold-start route tests, receipt-ownership route tests, manifest hashes (R1.md, verdict) |
| The hosted worker | Live since 2026-10-01 (lane D1). Its crons fired only after a triggers-only redeploy, `npx wrangler triggers deploy --config wrangler.vantage.toml`, at 04:43 UTC (the worker began as an empty draft from `secret put`, and the first code deploys did not attach the crons). Firing since 04:50, five-minute and hourly both seen; the fold caught up its 26-hour lookback two hours per run, so today's hours fold around 05:50–05:55; until then the report reads the raw day ledger. |
| The sign-in hand-off | designed, not built |
| ASN-based switch seeding | held in reserve (design §5) |

## Hard-won rules

- **Replay the page's events exactly, or you measure a different demo.** The page's `creditDecided()` sends a `content_click` for every decided container around a pressed control. That moves `contentType`. A replay without them put protection above Pair with a plan at 10c, and the real page does not (L5).
- **Measure, then claim.** Scores move in real time. Claim positions and thresholds, say "about" for spreads, and never promise a reorder at beat 5.
- **A press that changes nothing visible is a broken press.** The DOM suite fails it.
- **Verify through the APIs, never the pages.**
- **This checkout is shared.** Stage only your own paths; never `git add -A`.
