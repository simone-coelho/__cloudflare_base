# The Bright Hour — Presenter Runbook

**INTERNAL · presenter-facing · 2026-08-18**
Surface: `/live` · Engine: `src/demos/brighthour/*` + `src/routes/live.ts` · Design law: `QVC-Site-Recon-Demo-Design.md` Part C · Framing law: `QVC-Demo-Design-Brief.md` §2, §5

Read §1 and §5 before the room. Print §6.

Three beats (8, 12, 13) are marked **GATE: verify before session**. They are built tonight. Run the 30-second check in §1.6. If a check fails, drop the beat and use its one-line fallback from the cheat sheet. Never claim a gated beat that did not pass.

---

## 1 · SETUP (10 minutes before)

### 1.1 URL — use the deployed worker

```
https://edge-platform.expedge.workers.dev/live/
```

Prefer this. It has no local runtime, no file-watcher, no hot-reload pauses.

**Local fallback only if the deploy is broken:**

```bash
pkill -9 -f workerd
npx wrangler dev            # [dev] port = 9100 in wrangler.toml
# → http://localhost:9100/live/
```

Hard-reload once (Ctrl-Shift-R / Cmd-Shift-R). Code shipped tonight; a cached `live.js` is the single most likely cause of a control that "isn't there".

### 1.2 Fresh start

1. Open `/live/`. The Glass Box panel opens on the right by default (`?panel=0` suppresses it; do not use that).
2. Click **New Viewer** (red button, ops strip).
3. Confirm: all nine affinity bars read `no signal yet`, Audience memberships reads the empty line, `Visitor` shows a new `bh_…` id.

New Viewer clears only `bh_*` keys, mints a new visitor id, drops any queued telemetry, and re-composes. It is the reset for every wedged state in this demo.

### 1.3 Presenter panel tour (know these cells cold)

| Cell | Reads | Use it for |
|---|---|---|
| **Demo clock** + ISO | ET time and a real ISO stamp | The stamps are real; only the rate is ours |
| **Multiplier** | `×1` | Say "real time" unless a clock-advance is in play |
| **Decision source** | `api` / `api (push)` / `mock (…)` | Must read `api` for a live run |
| **nextTransitionAt** | ISO + `(N s real)` | The next lifecycle boundary, computed not scheduled |
| **Engine latency** | ms | Quote the number on screen, never a rehearsed one |
| **Push** | `websocket connected` | Swaps arrive over the socket, not a poll |
| **Visitor** | `bh_…` | Copy this for the export beat |
| **config_version** | `brighthour-demo-v1` | Stamped on every explain record and every row |

Four buttons: **Mode: browse ⇄ mission** · **Cardholder offer: on ⇄ off** · **Discovery quota: on ⇄ off** · **New Viewer**.

Three panel sections below the ops strip: **Affinity instrument** (nine bars, each with θin and θout markers supplied by the engine's own config, plus the demo τ and prod τ under each bar) · **Audience memberships** · **Decision records** (one expandable explain per slot).

### 1.4 `?mock=1` — the offline path

```
https://edge-platform.expedge.workers.dev/live/?mock=1
```

Renders the full storefront from a built-in payload with no network. Decision source will read `mock (forced by ?mock=1)`. Mode and Cardholder toggles still respond. **The affinity instrument, the succession, and the export rows are not real in mock** — if you fall back to it, present the page and the composition story only, say plainly that you are running the offline copy, and drop beats 5–12 of the arc.

The page also falls into mock on its own if `/live/api/page` fails. Watch the Decision source cell: if it ever reads `mock (…)` mid-demo, you are no longer showing the engine.

### 1.5 Second and third visitor

- Pane A: your main window.
- Pane B: **incognito window** (separate `localStorage`, so a genuinely separate `bh_visitor_id`).
- Pane C: a **second browser** (Edge/Firefox), or reuse pane A with **New Viewer**.

A second tab in the same profile is the same visitor. It will not work.

Arrange A and B side by side before the meeting starts. Do not do window management in front of the room.

### 1.6 Pre-flight checks (run all six)

```bash
# 1. Page composes from the engine (not mock)
#    → open /live/, confirm Decision source = api

# 2. Rows are landing (visitor id from the ops strip)
curl -s "https://edge-platform.expedge.workers.dev/live/api/decisions/export?visitorId=<bh_id>&parse=1&limit=5" | head -40
#    → ok:true, count > 0. A 503 means D1 is not bound; the export beat is dead, cut it.

# 3. Clock-advance controls present in the ops strip (+1h / +6h / +24h / Reset)

# 4. Offer Desk: page + API + tray + model key
#    → /live/ops loads and shows the incoming tray
curl -s "https://edge-platform.expedge.workers.dev/live/ops-api/staged" | head -20
#    → ok:true, records[] non-empty, and note `modelConfigured` (true = real model call)
curl -s "https://edge-platform.expedge.workers.dev/live/ops-api/state" | head -20
#    → ok:true

# 5. Rehearse the desk end to end, then put it back:
curl -s -X POST "https://edge-platform.expedge.workers.dev/live/ops-api/reset"

# 6. Pre-propose ONE card so the stage copy opens instantly (see beat 6)
```

**GATE checks (30 seconds each):**

- **Beat 8 — waitlist flip.** Offer Desk → **Live catalog controls** → **Sell it out** on the daily-deal occupant, with two panes open. Pass = high-affinity pane keeps the item, waitlist language, price untouched, explain reads `availability (waitlist)`; fresh pane's slot moves to the desk-approved successor. **Restock** afterwards. Fail = skip beat 8.
- **Beat 12 — host affinity.** Drive three views on `host_dana_reyes` items, then check the **On Air Now** rail leads with her segments. Pass = order changes and `hostAffinity` shows `host_dana_reyes` above θin 0.55. Fail = skip beat 12.
- **Beat 13 — experiment.** The ops strip shows an **Experiment** line with an arm and a source. `GET /live/api/experiment/status` returns the ids and the results URL, and that URL opens in `app.optimizely.com`. Then confirm a fresh export row carries non-null `experiment_id` / `variation_id`. Fail = skip beat 13 and keep the export beat (the columns exist regardless).
- **Two Speeds — idle decay.** Leave the panel open and untouched for 15 seconds. Pass = a fast bar visibly falls with no clicks. Fail = after the idle, toggle **Cardholder offer** off then on to force the re-read.

Have the Offer Desk (`/live/ops`) open in its own tab, behind the storefront, before you start.

---

## 2 · THE ARC (~12–15 minutes)

Order is the C5 spine adapted to what is built. The Glass Box panel stays open the whole time and you click into it as you go — it is not a finale.

---

### BEAT 1 — Cold Open (~90 s)

**Clicks.** New Viewer. Click three kitchen cards, about five seconds apart.

**Screen.** The `category` bar climbs and crosses the green θin marker at 0.60 with the value name on it (`Kitchen & Table`) — three clicks land it around **0.75**, clear of the threshold. **Spotlight for You** repaints from its evergreen fallback to a kitchen item. Audience memberships gains its first entry.

**Line.** *"Three interactions, about fifteen seconds, fully anonymous. No login, no history, no training period."*

**Recovery lever.** If the bar is slower than you expect, **add one item to cart** — that action weighs 3 and crosses θin on its own.

---

### BEAT 2 — Mission vs Browse (~60 s)

**Clicks.** Ops strip → **Mode: browse** → click once → **Mode: mission**.

**Screen.** The page drops from **eight modules to four** (hero, Today's Bright One, Spotlight for You, Shop by Category). Ops status line shows `moduleCount 4`.

**Line.** *"Personalization that removes modules, not one that adds another carousel."*

Click back to **browse** before moving on. Both layouts are needed later.

---

### BEAT 3 — Three Visitors, One Slot (~90 s)

**Clicks.** Bring up pane B (incognito, cold). Point at the same two slots in both panes: **Spotlight for You** and **Something New to You**. Then in pane B, click two Jewelry or Garden cards and let it repaint.

**Screen.** Same slot ids, different occupants. **Deals Worth the Trip position 1 is identical in both panes** — that is the pinned Bright Fifty Pick, and it is the bridge into the next beat. Open `[explain]` on Spotlight in each pane: different candidate sets, different rank scores, same `config_version`.

**Line.** *"Several strong eligible offers, and the system choosing which offer for which customer — same slot, same second, one engine."*

**Do not** use Today's Bright One for this beat. That slot is window-driven and is the same item for everyone by design; that is the point of beat 6, not this one.

---

### BEAT 4 — The Billboard Stays, and the Quota (~75 s)

**Clicks.** Point at the hero billboard in both panes (identical). Open its `[explain]`: `pinned · ranking skipped`, `rank_score` null. Then ops strip → **Discovery quota: off**. Let the page repaint. Then **Discovery quota: on**.

**Screen.** With the quota off, **Something New to You** collapses into more of the same category the visitor already leans on — a monotone wall. With it back on, the reserved picks return, flagged `quota_reserved · exposure floor` in the explain with affinity near zero.

**Line.** *"The merchandiser's billboard outranks the model, and a fixed share of the page is held open for things the ranking would never pick. Over-personalization is a failure mode we engineered against, not a promise."*

---

### BEAT 5 — Two Speeds (~2 min real, and you talk over it)

**Clicks.** None. Read the instrument aloud, then stop touching the page for **90 seconds**. The bars fall on their own: the panel re-reads the snapshot every 5 seconds once the page has been idle for 3, and the bars animate down. *(Verify at pre-flight: leave the panel open and untouched for 15 seconds and watch a fast bar move. The poll needs the panel open and the tab in the foreground.)*

**Screen.** After the idle: `sessionMission` (τ 30 s) and `urgencyResponsiveness` (τ 45 s) have collapsed; `subcategory` (60 s) and `category` (90 s) are visibly down; **`brandPersonality` (τ 240 s) and `priceBand` (τ 300 s) have barely moved.** Two decay curves, one engine.

**Patter to fill the 90 seconds** (this is the beat that needs scripted talk):
1. Point at the τ line under each bar: demo τ on the left, production τ on the right. *"Same nine axes. In production these are 14 days, 30 days, 45 days. We changed the rate, not the model."*
2. Adobe's cadence, from their own docs: a new item takes **2–32 hours to become recommendable**, algorithm runs every 12–24 hours, feeds cap at daily.
3. Their signature offer construct lives 24 hours. *"A model that rebuilds daily cannot rank an offer that lives a day."*
4. The explainability point: Adobe's Personalization Insights report requires an activity live and taking traffic for **15 days**. For a one-day offer that report can never exist.

**Line.** *"Taste is durable; tonight is not. That is one config file, not two systems."*

**Known limit — do not overclaim.** `category` at τ 90 s decays visibly too. The durable pair to point at is brand personality and price band.

---

### BEAT 6 ★ CENTERPIECE — The Offer Desk (~3 min) · **GATE: verify before session**

**This beat and beat 8 chain.** What you approve here is the Dutch Oven as **Today's Bright One℠**; in beat 8 you sell out the featured item and that approval is what the fresh visitor's slot falls to. Do not swap their order, and do not skip the approval.

**Clicks.** Switch to the **Offer Desk** tab (`/live/ops`).

1. **Ingest** — a raw feed row arrives with sparse metadata: title, price, one image. Nothing else.
2. **Propose** — click it and **talk for eight seconds**. This is a real model call, 7–8 seconds. Patter: *"the model is reading the item — the title, the copy, the price, nothing else."* The card comes back with a value, a confidence and provenance per tag.
3. **The correction moment** (take it when it appears). The Arc Floor Lamp arrives from the feed tagged **Electronics & Tech**. The model proposes **For the Home at 0.95**, and the card surfaces the conflict in its own words: the feed said one thing, the proposal says another, judged from the title and copy rather than the hint. **Line:** *"It caught the vendor's mislabel — and it showed you that it disagreed, instead of quietly overwriting."*
4. **Approve with one edit.** Brand personality comes back right on its own at ~0.8 — leave it. The **offer construct** comes back low-confidence (~0.5–0.7): **edit it to `TBO` — Today's Bright One℠**. Then **reject Occasion**. Your name and the timestamp stamp onto the record. **Do not skip the edit.** It is the whole human-loop argument.
5. **The governance click** (worth ten seconds). Try to reject **Category**. The desk refuses, in a human sentence: a load-bearing tag is edited, never rejected. *"The desk will not let a merchandiser delete something the decision depends on."*
6. **Schedule the window** — a start time and an end time. Nothing else. No campaign, no audience, no page.
7. Switch back to `/live/`. The item is in the composition.

**Line.** *"You didn't build a campaign. You published an item with a start time and an end time. Your product data already has that field — `specialPriceStartTime` / `specialPriceEndTime`. We just made the page read it."*

**Before you speak, two checks.** The tray reports whether a real model call is available (`modelConfigured`, and the card says which proposed it). If the key is absent, the proposals come from the deterministic fallback and the card says so — then say "proposed tags", never "the model just did that". And if you rehearsed, click **Reset tray** (or `POST /live/ops-api/reset`) so the beat runs clean.

**Optional insurance:** pre-propose one card before the session. The proposal persists, so on stage that card opens instantly and you spend the time on the approval rather than the wait.

**Fallback if the gate failed:** skip the desk, go straight to the succession below, and say *"the item enters through an ops surface with human approval on every tag — that's the part your team already does by hand today."* Do not open `/live/ops` if it is not working.

---

### BEAT 7 — Succession (~60 s) · **GATE: verify controls present**

**Clicks.** On `/live/`, look at **Today's Bright One℠**. Read the line under the card: the next one is already in preview. Point at `nextTransitionAt` in the ops strip. Then click **+24h**.

**Screen.** The demo clock ISO jumps a day. The slot's occupant changes — the outgoing Bright One leaves every eligible set and the queued one takes the slot, in the same instant, with no human action. The explain for `daily_deal` now names a different item and a different window.

**Today's succession ladder** (windows are offsets from ET midnight):

| Occupant | Window | Live |
|---|---|---|
| Copperline 9-Qt Enamel Cast Iron Dutch Oven | −8 h → +16 h | until 4:00 pm ET |
| Havenmoor 5-Piece Quilted Coverlet Set | +16 h → +40 h | 4:00 pm ET → next day 4:00 pm |
| Solene Overnight Renewal Cream | +40 h → +64 h | after that |

**+24h always crosses a boundary.** +6h advances two reveals inside the 120-hour event (3-hour cadence). +1h usually shows nothing — do not use it in front of the room.

**Line.** *"Nobody scheduled that. The window is the gate; the boundary is computed. Zero human action, and it happened in every open browser at once."*

Click **Reset** before moving on.

---

### BEAT 8 — Sold Out Mid-Session (~60 s) · **GATE: verify before session**

**This is the back half of beat 6.** The successor you approved at the desk is what the fresh visitor lands on.

**Clicks.** Offer Desk → **Live catalog controls**. The strip lists the current hero, Today's Bright One and deals-rail occupants, so you never guess what is on screen. Click **Sell it out** on the **featured** item (the daily-deal occupant). Then look at pane A (your high-affinity visitor) and pane B (fresh).

**Screen.** Pane A **keeps the item**, in their waitlist vocabulary, **price untouched** — the explain reads `availability (waitlist)` and the record notes `retained: high_affinity_waitlist`. Pane B's Today's Bright One moves to the successor you approved at the desk. No reloads in either.

**Line.** *"Same event, two different right answers — and the waitlist holds her price, because that is your published rule, not our default."*

**The detail that lands with their engineers.** Retention fires when **any weighted dimension** is at or above **its own** θin — not a single blended score. In the verified run it fired on brand personality, price band and host affinity while `category` sat at 0.568, just under its 0.60. The glass box names which one carried it. *"She kept it on taste and price posture, not on the category — and the panel says so."*

Click **Restock** to put it back before the next beat.

**Fallback:** skip. The hero already carries a waitlist state on the air fryer; you can point at it in passing without claiming a live flip. Without an approved successor the empty-slot language shows instead — honest, but it is not the beat.

---

### BEAT 9 — Host Affinity (~60 s) · **GATE: verify before session**

**Clicks.** Click three items presented by the same host, then scroll to **On Air Now**.

**Screen.** `hostAffinity` crosses θin 0.55 with `host_dana_reyes` named on the bar. The rail leads with her segments.

**Line.** *"Twenty-nine hosts, twelve host shops, an entire parasocial economy — and nobody in your vendor set models the host as a dimension. We studied your business, not your funnel."*

**Boundary — say nothing about host likeness or synthetic presenters.** Host *affinity* personalizes merchandising, not a person.

**Fallback:** skip the rail claim; the `hostAffinity` bar on the instrument is real either way and can be pointed at as a dimension.

---

### BEAT 10 — The Glass Box, and the rule that refuses (~60 s)

**Clicks.** Open `[explain]` on any slot. Scroll the panel to **refused candidates** — the exclusion is hoisted to the top of the list wherever you open it.

**Screen.** A high-affinity item in the visitor's own leading category, refused — `vip_offer_exclusion` with its roster reason, its rank score, and its dimension scores all shown. For a kitchen visitor this is the Copperline 20-Piece Glass Food Storage Set, refused as `vip_offer_exclusion (clearance)`. Then click **Cardholder offer: off** — the refusal disappears and the item becomes rankable. Click it back **on** — the refusal returns.

**Line.** *"That is the engine refusing a click it would probably have won, because your merchandising rule outranks the model. Precedence is real, and it is visible."*

Also point at, in the same panel: gates passed and failed with reasons, candidate set, rank score, rank position, tie-break hash, `config_version`, latency. *"Same inputs, same config version, same output — every time. Replayable."*

---

### BEAT 11 — Experiment on Top (~60 s) · **GATE: verify before session**

**Clicks.** Point at the **Experiment** line in the ops strip — it names the arm this visitor is actually in and how it was decided (`sdk` means Optimizely bucketed them, not us). Then open the results URL from `GET /live/api/experiment/status` — the experiment in `app.optimizely.com`.

**Screen.** The arm on the strip matches the offer copy on the slot under test: the two arms say the same true thing about the same window in two registers, and neither invents pressure. The experiment exists in the real product, with its real ids, and the assignment rides in the decision row.

**Line.** *"The experiment is not a picture of an experiment. It is the same platform your team would run it in — and the assignment rides in the same row as the affinity scores."*

**Fallback:** skip, and go straight to the export row noting that `experiment_id`, `variation_id` and `campaign_id` are columns in the schema today, waiting on the project.

---

### BEAT 12 — The Export Row (~90 s)

**Clicks.** Copy the visitor id from the ops strip. Open:

```
/live/api/decisions/export?visitorId=<bh_id>&parse=1&limit=20
```

**Screen.** Flat, warehouse-shaped rows. One per slot decision. Read three columns aloud and map them to their own scorecard:

| Their KPI (CEO-level, from the 10-Q) | Column |
|---|---|
| Unique website visitors | `visitor_id` × distinct `session_id` |
| Conversion rate / productive sessions | `decision_id` joined to the downstream event |
| Module engagement | `slot_id` split by `quota_reserved` |
| Uplift | `experiment_id` + `variation_id` + a real holdout, computed by their analysts |

**Line.** *"We hand you the rows; you compute the lift. We will never present our own uplift number as the proof."*

Point at `gates_failed` and `dimension_scores` in the row: *"the reason is in the row, not in a dashboard we own."* Then the contrast, from Adobe's docs: their flagship ML activity cannot report through Adobe Analytics at all, and no per-decision export exists without buying RTCDP.

**Close.** *"You don't have a recommendations problem. You have a decisioning-under-expiry problem. Everything you just watched was that, and it ran on real edge decisions with the reasons attached."*

---

## 3 · TIMINGS AT DEMO τ

Everything the room watches is real time. The demo τ set is the only compression on affinity; the clock-advance buttons compress the **offer calendar only** and do not age the visitor's profile.

| Beat | What you do | Real clock |
|---|---|---|
| 1 Cold Open | 3 card clicks ~5 s apart | ~15 s to cross θin; 90 s with the talk |
| 2 Mission/Browse | 1 click, 1 recompose | ~60 s |
| 3 Three visitors | pane B interactions | ~90 s |
| 4 Billboard + quota | 2 toggles, 2 recomposes | ~75 s |
| 5 Two Speeds | 90 s idle, no clicks | ~2 min |
| 6 Offer Desk | propose (**7–8 s model call**) → edit construct → reject → window → live | ~3 min |
| 7 Succession | +24h, one recompose | ~60 s |
| 8 Sold out | Sell it out + 2 panes + Restock | ~60 s |
| 9 Host affinity | 3 views + rail | ~60 s |
| 10 Glass Box | explain + VIP toggle | ~60 s |
| 11 Experiment | status + product URL | ~60 s |
| 12 Export row | one URL | ~90 s |
| | **Total** | **~13–15 min** |

**Decay reference** — mass retained after an idle, per dimension:

| Dimension | τ demo | 60 s idle | 90 s idle |
|---|---|---|---|
| `sessionMission` | 30 s | 14 % | 5 % |
| `urgencyResponsiveness` | 45 s | 26 % | 14 % |
| `subcategory` | 60 s | 37 % | 22 % |
| `category`, `mediaAffinity` | 90 s | 51 % | 37 % |
| `offerTypeAffinity` | 120 s | 61 % | 47 % |
| `hostAffinity` | 180 s | 72 % | 61 % |
| `brandPersonality` | 240 s | 78 % | 69 % |
| `priceBand` | 300 s | 82 % | 74 % |

Crossing θin (0.60 on `category`): **three card clicks ≈ 0.75** · one add-to-cart ≈ 0.63 · three card views ≈ 0.61 · one waitlist join ≈ 0.53.

**Time-of-day facts that change what is on screen:**
- The 120-hour event opens at **noon ET**. Before noon its module reads "opens on its start time". Advance +12h or do not lead with it.
- Today's Bright One turns over at **4:00 pm ET** on its own. If you are presenting near that time, `nextTransitionAt` will show it coming and the swap may land live over the socket — take it, it is better than the button.
- The Harvest Kitchen Event runs all day, so the hero billboard always has a pinned occupant.

---

## 4 · NOT TOMORROW

Say it if asked. Never volunteer it. Never claim it as built.

- **ODP** — out of scope for this customer, by design. The engine's memory here is first-party and at the edge; ODP is additive and not part of this build or this conversation.

---

## 5 · TROUBLESHOOTING

| Symptom | Fix |
|---|---|
| Any wedged demo state | **New Viewer.** First move, every time. |
| Decision source reads `mock (…)` | The API is unreachable. Reload. If it persists, switch to `?mock=1` deliberately and say so. |
| Meters frozen during the idle beat | The idle poll needs the panel open and the tab in the foreground. If it still looks frozen, toggle **Cardholder offer** off then on to force a re-read. |
| Propose seems to hang | It is a real model call, 7–8 seconds. Talk over it. If it errors, the card says so — use the pre-proposed card instead. |
| Desk refuses a rejection | Working as designed: load-bearing tags are edited, not rejected. Show the message, then edit the tag. |
| A control is missing from the ops strip | Stale `live.js`. Hard-reload (Ctrl-Shift-R). |
| Export returns 503 | D1 is not bound on that deployment. Cut beat 12; do not improvise a substitute. |
| Export returns 0 rows | Rows are written off the response path — load the page once more, wait two seconds, retry. Check the `visitorId` matches the ops strip. |
| Offer Desk tray is empty or half-approved | **Reset tray** on the desk (or `curl -X POST …/live/ops-api/reset`), then reload `/live/ops`. |
| Local dev only: stale runtime | `pkill -9 -f workerd`, then `npx wrangler dev`. |
| Local dev only: port in use | `lsof -ti:9100 \| xargs kill -9`. |
| Local dev only: page hangs 11–23 s | The wrangler file-watcher stalling on `/mnt/c`. Not a product problem. **Use the deployed URL — it avoids all of this.** |
| Second tab shows the same visitor | Same profile, same storage. Use incognito or a second browser. |
| Network dies entirely | `/live/?mock=1`. Present the composition story, drop beats 5–12, name the fallback out loud. |

**Do not** open dev tools in front of the room. **Do not** narrate a number that is not on screen. **Do not** show a beat whose gate failed.

---

## 6 · CHEAT SHEET (print this page)

| # | Beat | Clicks | The one line |
|---|---|---|---|
| 1 | **Cold Open** | New Viewer → click 3 kitchen cards, ~5 s apart | "Three interactions, ~15 seconds, fully anonymous." |
| 2 | **Mission/Browse** | Ops → Mode: mission → back to browse | "Personalization that removes modules, not one that adds another carousel." |
| 3 | **Three Visitors** | Pane B (incognito) → 2 cards → compare Spotlight + Something New | "Several strong eligible offers, and the system choosing which for which customer." |
| 4 | **Billboard + Quota** | Explain on hero (`pinned`) → Quota off → Quota on | "The billboard outranks the model, and part of the page is held open on purpose." |
| 5 | **Two Speeds** | Idle 90 s, no clicks (talk over it) | "Taste is durable; tonight is not. One config file, not two systems." |
| 6 | **★ Offer Desk** ⚠ | `/live/ops`: propose (talk 8 s) → mislabel caught → **edit construct → TBO**, reject Occasion → window → `/live/` | "You didn't build a campaign. You published an item with a start time and an end time." |
| 7 | **Succession** ⚠ | +24h → watch Today's Bright One change → Reset | "Nobody scheduled that. The window is the gate, and the boundary is computed." |
| 8 | **Sold Out** ⚠ | Desk → Live catalog controls → **Sell it out** on the featured item → 2 panes → Restock | "Same event, two right answers — and the waitlist holds her price." |
| 9 | **Host Affinity** ⚠ | 3 same-host items → On Air Now | "Nobody in your vendor set models the host as a dimension." |
| 10 | **Glass Box** | Explain on any slot → refused candidates → Cardholder off/on | "The engine refusing a click it would have won." |
| 11 | **Experiment** ⚠ | Ops strip **Experiment** line → open the results URL | "Not a picture of an experiment — the same platform your team runs." |
| 12 | **Export Row** | `/live/api/decisions/export?visitorId=…&parse=1` | "We hand you the rows; you compute the lift." |

**6 and 8 chain.** The construct you approve at the desk (Dutch Oven → TBO) is the successor the fresh visitor lands on when you sell out the featured item. Run 6 first, always.

⚠ = **GATE: verify before session.** Fallback lines if a gate failed:

- **6 Offer Desk:** *"The item enters through an ops surface with human approval on every tag — the part your team does by hand today."* Then go to 7.
- **7 Succession:** *"The window is the gate. Watch `nextTransitionAt` in the panel — that boundary is computed from the item's own end time, not scheduled by anyone."*
- **8 Sold Out:** *"Availability is a gate like any other — your Y/W/N model, evaluated per decision, and retention fires on any dimension the shopper is already above threshold on."* Point at the waitlist state already on the hero.
- **9 Host Affinity:** *"Host affinity is one of the nine axes — there it is on the instrument. Nobody else models it."*
- **11 Experiment:** *"`experiment_id`, `variation_id` and `campaign_id` are columns in this row today. The assignment lands in the same row as the affinity scores."*

**Closers.**
"You don't have a recommendations problem. You have a decisioning-under-expiry problem."
"We hand you the rows; you compute the lift."

**Never say:** any language that pressures the shopper, any uplift number of ours presented as proof, anything about host likeness or synthetic presenters, anything from a beat whose gate failed.
