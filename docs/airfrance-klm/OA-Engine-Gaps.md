# OA demo: engine and kit gaps, for the team lead

**28 October 2026. Internal.** This file lists what the OA demo build (the Air France-KLM demo) found in the engine and the demo kit. Each item says where to look in the code, how to reproduce it, and what the demo does about it today. The full technical notes, numbered the same way, are in `docs/airfrance-klm/OA-Demo-Design.md` §10.

> **Read this with its verification.** On 28 October every claim below was checked against the code, in [OA-Engine-Gaps-Verification-2026-10-28.md](OA-Engine-Gaps-Verification-2026-10-28.md) in this folder, with the detail in [verification/](verification/). In short:
> - Engine 19 and Feature 15 are already fixed in the shipped engine (`rem/integration`).
> - Engine 18 and Engine 20 are real defects, and wider than stated here.
> - Kit gap 22's "OA's page retries once" is wrong for receipts.
>
> Where the two documents differ, the verification is right.

**The demo is complete and runs.** Every page, slot and beat the brief asked for is built and walked end to end. Nothing below stops the demo. Each item is either worked around in the demo or matters only for a production version.

| | Count |
|---|---|
| Engine defects the demo works around | 3 |
| Engine features a production version would need | 6 |
| Demo-kit tooling gaps | 16 (3 already built) |
| Customer asks the brief left out | 3 |

**Terms used here:**
- **Lift:** how much better a piece did for travellers like this one than for everyone. It's learned from showings and bookings and capped between 0.5 and 2.
- **Trust dial (γ):** how far the lift may change the order. Final score = base score × lift^γ. At 0 the lift is shown on the receipt but changes nothing.
- **Receipt:** the explanation the engine returns with each decision: what drove it, the lift and the dial.

---

## 1. Engine defects the demo works around

These are real behaviours of today's engine that the demo hit. Each has a workaround in place, and each should go on the engine backlog.

### Engine 18: money-based slots refuse every purchase that names a currency

- **What happens:** a slot that learns from revenue or margin refuses any outcome that states a currency, unless a money policy is published for the tenant. No policy can be published, because nothing in the code ever passes one.
- **Evidence:** `src/learn/fan.ts:131-135`. In `moneyRefusal`, no policy plus a stated currency returns `money_policy_unset`. The policy would arrive as the `money` field at `src/durable-objects/DecisionRing.ts:134` and is used at line 550, but no file under `src/` sets it.
- **Reproduce:** on a local OA rig, run `node scripts/seed-oa-history.mjs --base http://localhost:9130 --order-currency EUR`. The outcomes on the money slots come back refused with `money_policy_unset`.
- **Effect on OA:** the page sends euro amounts, as the brief requires. So none of the money-based slots learns from the room's own clicks. Those slots are the recommended fare, the offer format, the fare prompt, the seat and bag steps, and the after-booking offers. Only the flight list learns live.
- **Workaround:** the synthetic history sends its order values without a currency. Those slots therefore learn before the demo, and the dial still moves. The script prints this.
- **Suggested fix:** let the tenant's learning settings declare a currency, and pass that policy from the outcome path into the decision store.

### Engine 19: decisions carry no lift for up to a minute after new learning is published

- **What happens:** the decision path keeps the lift numbers in a 60-second cache. If newer numbers are published inside that minute, the cache check fails and the decision gets no lift until the minute runs out. It should read the new numbers instead.
- **Evidence:** `src/content/service.ts:98`, in `readLift`. A cache hit that is no longer current returns `null` rather than re-reading. The cache length is `LIFT_TTL_MS = 60_000` at line 85.
- **Reproduce:** keep traffic flowing on a rig with learning in place, and read receipts every few seconds. On the local rig, about half of each minute showed no lift.
- **Effect on OA:** if the presenter turns the dial (beat 7) straight after beat 6, the pages may not re-sort, because the lift is briefly missing.
- **Workaround:** the presenter script says to talk for at least 90 seconds before beat 7. With that gap, the final walk re-sorted the pages.
- **Suggested fix:** on a stale cache hit, read the new numbers and replace the cached entry.

### Engine 20: the day report goes over its size limit after a realistic amount of traffic

- **What happens:** after the synthetic history (560 travellers), that day's report is too large to read back. The request returns `413 report_too_large`: 17,166,176 bytes against a limit of 16,777,216.
- **Evidence:** the limit is set at `src/learn/report.ts:28` (16 MiB). The figures above are the ones the request-level suite printed.
- **Reproduce:** run the history on a fresh rig, then `node scripts/rehearse-oa-page.mjs --base http://localhost:9130`. It prints the 413 as one known line.
- **Effect on OA:** none on screen, because the page and the beats never read the day report. Anyone who asks the report for that day's credited orders gets the 413.
- **Suggested fix:** page or split the day report, so a busy day can still be read. Real airline traffic would pass this limit with far fewer than 560 travellers.

---

## 2. Engine features a production version would need

The demo doesn't need these. Air France-KLM would, once this moved past a demo.

| Item | What is missing | Why it matters for them |
|---|---|---|
| 2 | A slot whose candidates arrive with the request. Today the engine ranks only pieces already in its catalogue. | Their flight list comes from their offer system with each search. The demo stores six flights in the catalogue instead. This one is a design note only. |
| 11 | A way to load labelled synthetic learning. | The demo fakes it by sending 560 synthetic travellers through the public API, which takes about 18 minutes. A pilot would want a labelled warm start. |
| 12 | Page context on the receipt: days to departure, trip length, party size, booking stage. | The page sends these, and their own targeting uses them, but the receipt can't name them as inputs. |
| 13 | Learning broken down by page context, such as days out or party size. | The engine learns separately only by channel, visit, stage, region and leading interest. A family booking months ahead and a business traveller flying tomorrow would share numbers. |
| 14 | A different attribution window for each slot. | The brief wanted after-booking offers credited within six hours, but every slot shares one window today. |
| 15 | The campaign name (`utm_campaign`) read on arrival. | The engine reads only the search term (`src/sdk/identity.ts:82`). Beat 8 lands its campaign through a search term instead. |

---

## 3. Demo-kit tooling gaps

These are about our internal kit for building demos, not the engine, and none of them shows in the demo. Three were built during OA, and they work for every future demo.

| Item | Gap | State |
|---|---|---|
| 4 | A beat that turns the trust dial. | built, tested |
| 5 | Starting a visitor who refused or limited consent. | built, tested |
| 16 | Per-slot learning settings (reward, holdout) set from the demo's config. Before, every rebuild overwrote them with defaults. | built, tested |
| 6 | Funnel pages can't have their own addresses such as `/oa/results`; the kit only supports `/oa/?view=results`. | open |
| 7 | The kit's shopping cart is dollars only and puts no value on add-to-cart. OA sends its own euro events. | open |
| 8 | The kit's receipt panel can't show page context. It shows the dial but not the lift's value or where it came from; OA's page adds both. | open |
| 9 | The regional data seed covers the US only. | open |
| 10 | Starting assumptions can be published only for count-based slots, not money-based ones. | open |
| 17 | The kit's image manifest expects downloaded photos, so OA's locally drawn images use a workaround layout. | open |
| 21 | The kit's browser-test helper (`scripts/demo-kit/lib/cdp.mjs`) rejects dial beats, so OA's test checks them itself. | open |
| 22 | The receipt prefetch stops trying after one server error, so a receipt can stay empty until the next press. OA's page retries once. | open |
| 23 | The scaffold's config-drift check ignores the learning lines (`scripts/demo-kit/new-demo.mjs:51`). | open |
| 24 | The reset fallback doesn't republish the learning settings. | open |
| 25 | The kit guide (`docs/demo-kit/HOWTO.md`) doesn't yet describe the dial beat or the learning settings. | open |
| 26 | One-command hosting (`host.mjs`) always runs the US regional seed and can't run a demo's own history step. As a result, OA's morning setup needs three manual commands. | open |
| 27 | There's no option to hide the US census figures (median household income, home value) on the kit's arrival panel. They look out of place next to an airline page. | open |

---

## 4. Customer asks the brief left out

These are in Air France-KLM's use-case file (`docs/airfrance-klm/use-cases-2026-10-26.md`) but not in the demo brief, so the demo doesn't show them.

- **Judging the optional steps on the whole journey.** They noted that more add-on revenue on one step can cost completed bookings. The demo rewards each step on the add-on bought.
- **Three extra hypotheses:**
  - ask what matters for this trip;
  - help when comparison shows uncertainty;
  - offer a relevant next step on the home page.

  The nearest the demo comes is the home page's "continue your search" slot.
- **Their diagnostics:** time to decide, abandonment, repeat dismissal, and booking completion beside upgrades. The engine reports outcomes per slot and against a holdout, not funnel abandonment.

---

Every number here is one the test suites and scripts printed on the local rig; nothing is estimated. Code references are to the working tree of 28 October 2026.
