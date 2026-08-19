# The Bright Hour — Presenter Runbook

**INTERNAL · presenter-facing · 2026-08-18**
Surface: `/live` · Offer Desk: `/live/ops` · Engine: `src/demos/brighthour/*` + `src/routes/live.ts` · Design law: `QVC-Site-Recon-Demo-Design.md` Part C · Framing law: `QVC-Demo-Design-Brief.md` §2, §5

**You drive this demo with the Demo Director.** You press play; the page drives itself and captions each beat; you narrate over it. Manual clicking is the fallback and lives in the appendix (§7).

Read §1 and §5 before the room. Print §6.

---

## 1 · SETUP (10 minutes before)

### 1.1 URL — use the deployed worker

```
https://edge-platform.expedge.workers.dev/live/
```

Prefer this. No local runtime, no file-watcher, no asset-manifest rebuild, no hot-reload pauses.

**Local fallback only if the deploy is broken:**

```bash
pkill -9 -f workerd
npx wrangler dev            # [dev] port = 9100 in wrangler.toml
# → http://localhost:9100/live/
```

Hard-reload once (Ctrl-Shift-R / Cmd-Shift-R).

### 1.2 Fresh start

1. Open `/live/`. The Glass Box panel is on the right.
2. **Controls** → **New Viewer**.
3. Confirm: the nine affinity bars read `no signal yet`, memberships empty, `Visitor` shows a new `bh_…` id.

**Do not idly scroll the page before the Cold Open.** Scrolling feeds real impressions across every category it passes, and a different category can end up leading. Land on the page, reset, press play.

### 1.3 The panel, top to bottom

| Section | What it is |
|---|---|
| **Affinity — 9 live dimensions** | The instrument. Each bar carries engine-supplied θin/θout markers and demo τ / prod τ |
| **Audience memberships** | Audiences the catalog generated, not ones anybody typed |
| **Demo Director** | ▶ Play full arc · ⏸ Pause · ⏭ Skip · ⏹ Stop, plus one button per beat. Header reads **Beat N of 9** |
| **Controls** | Big labeled state buttons: mode, cardholder offer, discovery quota, clock advance, New Viewer |
| **Engine details** (collapsed) | Demo clock + ISO, multiplier, decision source, nextTransitionAt, latency, push, visitor, config_version, experiment arm, and the per-slot decision records. **The Glass Box beat opens this** |

**Caption bar** (bottom of the storefront): the Director writes what is happening and the talk-track line for the beat. It is your teleprompter. Let the room read it, then say your version of it.

### 1.4 `?mock=1` — the offline path

```
https://edge-platform.expedge.workers.dev/live/?mock=1
```

Full storefront, no network, decision source reads `mock (forced by ?mock=1)`. **The Director, the affinity instrument, succession and the export rows are not real in mock.** If you fall back to it, present the page and the composition story only, say plainly that you are on the offline copy, and stop after beat 2.

Watch the decision-source cell: if it ever reads `mock (…)` mid-demo, you are no longer showing the engine.

### 1.5 Second and third visitor

- Pane A: your main window.
- Pane B: **incognito window** (separate storage = a separate visitor).
- Pane C: a second browser, or New Viewer in pane A.

A second tab in the same profile is the same visitor. The Director's Second Shopper beat handles this for you inside one window; the two-pane version is the manual variant (§7).

### 1.6 Pre-flight

```bash
# 1. Page composes from the engine — Engine details → Decision source = api

# 2. Rows are landing (visitor id from Engine details)
curl -s ".../live/api/decisions/export?visitorId=<bh_id>&parse=1&limit=5" | head -40
#    → ok:true, count > 0.  503 = D1 unbound → cut the Receipts beat.

# 3. Clock wiring present
grep -c clockOffsetMs src/routes/live.ts      # → 5

# 4. Offer Desk: /live/ops loads, tray populated, model key present
curl -s ".../live/ops-api/staged" | head -20  # → ok:true, records[], modelConfigured
curl -s ".../live/ops-api/state"  | head -20  # → ok:true

# 5. Put the desk back after any rehearsal
curl -s -X POST ".../live/ops-api/reset"
```

**Rehearse the full arc once, end to end, and time it.** The computed estimate is **≈3 m 40 s**; your rehearsal is the number to trust, and it also warms the Offer Desk proposal.

Local dev only: after any image drop, **restart the dev server** — the asset manifest builds at boot. The deployed URL avoids this entirely.

---

## 2 · THE ARC — nine beats, driven (~4 min running, ~12–15 min with narration)

Open the panel. Press **▶ Play full arc**. The header counts **Beat N of 9**; the caption bar names each beat and carries its line. Between beats there is a deliberate pause — that is your talking time.

**Use ⏸ Pause the moment a question lands.** Answer it, then ▶ Resume. Use ⏭ Skip to move on, ⏹ Stop to take manual control. Each beat also has its own button, so you can run any single beat out of order if the room pulls you somewhere.

Your job is not to describe what is on the caption. Your job is to say what it means to *them*.

---

### 1 · Anonymous Stranger
**What runs.** A brand-new visitor. Three kitchen cards, five seconds apart. The `category` bar climbs past θin 0.60 — the caption quotes the real crossing value. Spotlight for You repaints from its evergreen fallback to kitchen.

**You say.** *"Three interactions, about fifteen seconds, fully anonymous. No login, no history, no training period — and this is your bleeding number: new customers are three percent of shipped sales, and ninety percent of them start digitally."*

---

### 2 · Governance & quota
**What runs.** The billboard is shown as pinned, ranking skipped. The discovery quota goes off — the page collapses toward one category — then back on, and the reserved picks return flagged `quota_reserved`.

**You say.** *"The merchandiser's billboard outranks the model, and part of the page is held open for things the ranking would never pick. Over-personalization is a failure mode we engineered against — this is the beat most vendors skip."*

---

### 3 · Second Shopper
**What runs.** A second visitor with different behavior, against the same slot ids. Same slots, different occupants, different explain records, same `config_version`.

**You say.** *"Several strong eligible offers, and the system choosing which offer for which customer — same slot, same second, one engine."*

---

### 4 · A New Offer Is Born ★ centerpiece
**What runs.** The Offer Desk: a sparse feed row, a real model proposal, a human approval with an edit, a window, and the item live in the composition.

**The propose call takes about 16 seconds on production.** That is measured, twice. Talk across it — this is the longest single wait in the demo and it is the most valuable one:
1. *"It has the title, the price and one image. That is all your feed gives it."*
2. *"Nothing here is pre-tagged. It is reading the item now."*
3. The mislabel: the lamp arrives from the feed tagged Electronics & Tech; the proposal comes back **For the Home at 0.95**, and the card surfaces the disagreement in its own words. **Say it:** *"It caught the vendor's mislabel — and it told you it disagreed instead of quietly overwriting."*
4. The edit: brand personality comes back right on its own; the **offer construct comes back low-confidence, and a human sets it to Today's Bright One℠**. Occasion gets rejected. *"That edit is the point. The machine proposes, your merchandiser decides, and both are on the record with a name and a timestamp."*
5. Governance: the desk refuses to let a load-bearing tag be deleted — edited, never rejected.

**The line.** *"You didn't build a campaign. You published an item with a start time and an end time. Your product data already has that field — `specialPriceStartTime` / `specialPriceEndTime`. We just made the page read it."*

---

### 5 · Time Passes
**What runs.** The page sits idle and the instrument decays on its own: the session-scale dimensions collapse while brand personality and price band barely move. Then the clock advances a day and Today's Bright One turns over — the outgoing offer leaves every eligible set and the queued one takes the slot, with no human action.

**You say.** *"Taste is durable; tonight is not — same engine, same math, different half-life. And nobody scheduled that turnover: the window is the gate and the boundary is computed."* Then the competitive fact: *"A new item takes two to thirty-two hours to become recommendable in Adobe, and their explainability report needs an activity live fifteen days. Your signature offer lives twenty-four hours."*

**Only +24h moves Today's Bright One.** +6h moves the event-module reveal. +1h changes nothing on the storefront — never press it in front of the room.

---

### 6 · Sold Out Mid-Session
**What runs.** The featured item sells through mid-session. The high-affinity visitor **keeps it**, in their waitlist vocabulary, **price untouched** (`retained: high_affinity_waitlist`, explain reads `availability (waitlist)`). The fresh visitor's slot moves to the successor approved at the desk in beat 4.

**You say.** *"Same event, two right answers — and the waitlist holds her price, because that is your published rule, not our default."*

**The detail for their engineers.** Retention fires when **any weighted dimension** is at or above **its own** threshold, not on a blended score. In the verified run it fired on brand personality, price band and host affinity while `category` sat at 0.568, just under 0.60 — and the glass box names which one carried it.

---

### 7 · The Glass Box
**What runs.** Engine details opens. An explain record leads with **one plain-English sentence** — cause first, effect named — with the full record underneath it. The refusal is hoisted to the top of the refused candidates: a high-affinity item excluded by `vip_offer_exclusion`, not by score. The cardholder offer toggles off and on so the refusal disappears and returns.

**You say.** *"That is the engine refusing a click it would probably have won, because your merchandising rule outranks the model. A room reads the sentence; your engineer reads the record underneath — gates, scores, quota, rank, tie-break hash, config version, latency. Same inputs, same config version, same output. Replayable."*

---

### 8 · Experiment on Top
**What runs.** The arm this visitor is in, named on screen with how it was decided (`sdk` = Optimizely bucketed them, not us), and the offer copy on the slot under test matching that arm. The results URL opens the experiment in `app.optimizely.com`.

**You say.** *"Not a picture of an experiment — the same platform your team would run it in. Both arms say the same true thing about the same window in two registers, and the assignment rides in the same row as the affinity scores."*

---

### 9 · The Receipts
**What runs.** The warehouse-shaped rows. One per slot decision.

**You say, mapping their own scorecard:**

| Their KPI (CEO-level, from the 10-Q) | Column |
|---|---|
| Unique website visitors | `visitor_id` × distinct `session_id` |
| Conversion rate / productive sessions | `decision_id` joined to the downstream event |
| Module engagement | `slot_id` split by `quota_reserved` |
| Uplift | `experiment_id` + `variation_id` + a real holdout, **computed by their analysts** |

**The line.** *"We hand you the rows; you compute the lift. We will never present our own uplift number as the proof."* Then: *"Adobe's flagship ML activity can't report through Adobe Analytics at all, and there is no per-decision export without buying RTCDP."*

**Close.** *"You don't have a recommendations problem. You have a decisioning-under-expiry problem."*

---

### Two things to show by hand, if the room asks

Neither has a Director beat.

- **Mission vs Browse** — Controls → mode. Eight modules collapse to four. *"Personalization that removes modules, not one that adds another carousel."*
- **Host affinity** — click three items from the same host; the bar names `host_dana_reyes`. *"Twenty-nine hosts, and nobody in your vendor set models the host as a dimension."* Say nothing about host likeness or synthetic presenters.

### Three details worth naming when they appear

- **Category tiles genuinely refocus the rail** — the rail re-narrows and a chip reads `Showing: X ✕`, while **Spotlight deliberately stays on the shopper's affinity**. The line: *"the page followed your click, but it still knows who you are."*
- **Change-highlighting** — new cards sweep in, changed slots carry a pip, and a toast names what changed and why. *"Nothing moved without telling you what moved it."*
- **The plain-English sentence** atop every explain record. *"One sentence for the room, the record underneath for your engineer — and every number in the sentence is the number in the record."*

---

## 3 · TIMINGS

The Director's arc runs **≈3 m 40 s** of machine time (computed; your rehearsal is the measurement). With narration and the pauses you take, plan **12–15 minutes**.

| Beat | Machine time | Where your time goes |
|---|---|---|
| 1 Anonymous Stranger | ~25 s | The three-percent number |
| 2 Governance & quota | ~20 s | The beat most vendors skip |
| 3 Second Shopper | ~20 s | Same slot, different answer |
| 4 A New Offer Is Born ★ | **~60 s** (propose ≈16 s) | The mislabel, the edit, the window |
| 5 Time Passes | ~45 s | Two speeds, then the Adobe cadence facts |
| 6 Sold Out | ~25 s | Retention on any dimension |
| 7 The Glass Box | ~25 s | The refusal |
| 8 Experiment | ~20 s | Real platform, real ids |
| 9 The Receipts | ~20 s | Their KPI table |

**Decay reference** — mass retained after an idle:

| Dimension | τ demo | 60 s | 90 s |
|---|---|---|---|
| `sessionMission` | 30 s | 14 % | 5 % |
| `urgencyResponsiveness` | 45 s | 26 % | 14 % |
| `subcategory` | 60 s | 37 % | 22 % |
| `category`, `mediaAffinity` | 90 s | 51 % | 37 % |
| `offerTypeAffinity` | 120 s | 61 % | 47 % |
| `hostAffinity` | 180 s | 72 % | 61 % |
| `brandPersonality` | 240 s | 78 % | 69 % |
| `priceBand` | 300 s | 82 % | 74 % |

Crossing θin 0.60 on `category`: **three card clicks ≈ 0.75** · one add-to-cart ≈ 0.63 · three impressions ≈ 0.61.

**Time-of-day facts:**
- The 120-hour event opens at **noon ET**; before then its module reads "opens on its start time".
- Today's Bright One turns over at **4:00 pm ET** on its own — if you are near it, `nextTransitionAt` shows it coming and the swap may land live. Take it; it beats the button.
- The Harvest Kitchen Event runs all day, so the billboard always has a pinned occupant.

---

## 4 · NOT TOMORROW

Say it if asked. Never volunteer it. Never claim it as built.

- **ODP** — out of scope for this customer, by design. The memory here is first-party and at the edge; ODP is additive and not part of this build or this conversation.

---

## 5 · TROUBLESHOOTING

| Symptom | Fix |
|---|---|
| Any wedged state | **New Viewer.** First move, every time. |
| A beat goes wrong mid-arc | **⏭ Skip.** Do not stop the arc to fix something. |
| A question lands mid-beat | **⏸ Pause**, answer, **▶ Resume**. |
| You want to go off-script | **⏹ Stop**, then drive by hand (§7). |
| Decision source reads `mock (…)` | API unreachable. Reload. If it persists, switch to `?mock=1` deliberately and say so. |
| Propose seems stuck | ~16 s on production is normal. Keep talking. The card reports an error if it actually failed — then use the pre-warmed proposal from your rehearsal. |
| Desk refuses a rejection | Working as designed: load-bearing tags are edited, not rejected. Show the message, then edit. |
| Desk tray empty or half-approved | **Reset tray** (or `POST /live/ops-api/reset`), reload `/live/ops`. |
| Bars look frozen while idle | The idle re-read needs the panel open and the tab in the foreground. |
| A control is missing | Stale `live.js`. Hard-reload. |
| Export 503 | D1 unbound on that deployment. Cut beat 9. |
| Export 0 rows | Rows are written off the response path. Load the page again, wait two seconds, retry, and check the visitor id matches. |
| Local dev: stale runtime | `pkill -9 -f workerd`, then `npx wrangler dev`. |
| Local dev: port in use | `lsof -ti:9100 \| xargs kill -9`. |
| Local dev: images missing | Restart the dev server — the asset manifest builds at boot. |
| Local dev: 11–23 s stalls | The file-watcher on `/mnt/c`. Not a product problem. **Use the deployed URL.** |

**Do not** open dev tools in front of the room. **Do not** narrate a number that is not on screen.

---

## 6 · CHEAT SHEET (print this page)

**Setup:** deployed `/live/` → panel open → **New Viewer** → do not scroll → **▶ Play full arc**.
**Transport:** ⏸ pause for questions · ⏭ skip past trouble · ⏹ stop to go manual · header reads **Beat N of 9**.

| # | Beat | What you say over it |
|---|---|---|
| 1 | **Anonymous Stranger** | "Three interactions, ~15 seconds, fully anonymous." |
| 2 | **Governance & quota** | "The billboard outranks the model, and part of the page is held open on purpose." |
| 3 | **Second Shopper** | "Several strong eligible offers, and the system choosing which for which customer." |
| 4 | **★ A New Offer Is Born** | Talk 16 s: sparse feed → "it caught the vendor's mislabel" → the human edit → **"You didn't build a campaign. You published an item with a start time and an end time."** |
| 5 | **Time Passes** | "Taste is durable; tonight is not." + "Nobody scheduled that turnover." |
| 6 | **Sold Out** | "Same event, two right answers — and the waitlist holds her price." |
| 7 | **The Glass Box** | "The engine refusing a click it would have won." |
| 8 | **Experiment on Top** | "Not a picture of an experiment — the same platform your team runs." |
| 9 | **The Receipts** | "We hand you the rows; you compute the lift." |

**On request:** mission/browse (8 modules → 4) · host affinity.
**When they appear:** category tile refocus — *"the page followed your click, but it still knows who you are"* · change toasts · the plain-English sentence on every explain.

**Closers.**
"You don't have a recommendations problem. You have a decisioning-under-expiry problem."
"We hand you the rows; you compute the lift."

**Never say:** language that pressures the shopper · an uplift number of ours as proof · anything about host likeness or synthetic presenters · anything not on screen.

---

## 7 · APPENDIX — DRIVING BY HAND (fallback)

Use this if the Director is unavailable, or after ⏹ Stop when the room wants to steer.

| Beat | Clicks | Screen |
|---|---|---|
| **Cold Open** | New Viewer → click 3 kitchen cards, ~5 s apart | `category` crosses 0.60 (≈0.75); Spotlight repaints off its evergreen fallback |
| **Mission/Browse** | Controls → mode | 8 modules → 4 |
| **Three Visitors** | Pane B incognito → 2 cards → compare Spotlight + Something New to You | Different occupants, same slot ids; deals-rail position 1 identical (the pinned Bright Fifty Pick) |
| **Billboard + Quota** | Explain on hero → quota off → quota on | `pinned · ranking skipped`; monotone page; `quota_reserved · exposure floor` |
| **Two Speeds** | Nothing for 90 s | Session bars collapse; brand personality and price band hold. If frozen, toggle cardholder offer off/on |
| **Offer Desk** | `/live/ops`: propose (~16 s) → edit construct to TBO → reject Occasion → set window → back to `/live/` | Mislabel conflict shown; approval stamped with name and time |
| **Succession** | Controls → **+24h** | Today's Bright One turns over. +6h = event reveal. +1h = no-op |
| **Sold Out** | Desk → Live catalog controls → **Sell it out** on the featured item → compare panes → **Restock** | Retention with price untouched vs. the approved successor |
| **Host Affinity** | 3 items from one host → On Air Now | `hostAffinity` names `host_dana_reyes` |
| **Glass Box** | Engine details → explain on any slot | Plain-English sentence, then the refusal hoisted to the top of refused candidates |
| **Experiment** | Engine details → experiment arm → open results URL | Arm + source; the product |
| **Receipts** | `/live/api/decisions/export?visitorId=…&parse=1&limit=20` | The rows |

**Manual-mode hazards.** Scrolling feeds real impressions across whatever categories pass the viewport — reset before the Cold Open and do not browse idly. Today's Bright One is window-driven and identical for every visitor by design; never use it for the three-visitors comparison. And `category` at τ 90 s decays visibly too — the durable pair to point at is brand personality and price band.

**Today's succession ladder** (offsets from ET midnight): Copperline Dutch Oven −8 h → +16 h · Havenmoor Coverlet +16 h → +40 h · Solene Renewal Cream +40 h → +64 h.
