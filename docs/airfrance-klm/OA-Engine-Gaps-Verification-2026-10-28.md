# OA engine and kit gaps: verification and remedies

28 October 2026. Internal. This checks every claim in `OA-Engine-Gaps-v1.0.docx` (and its markdown twin `OA-Engine-Gaps.md`) against the code, and says what fixes each one at its cause. The detail, with file and line references and the reproductions, is in `verification/OA-Engine-Gaps-Verify-engine.md` and `verification/OA-Engine-Gaps-Verify-kit.md`.

## The one fact that changes how to read the document

The demo runs on the feature branch at `4d882915`. That branch split from the engine the programmes ship (`rem/integration`) at `2ffd1a70`: 10 commits on the demo side, 1,899 on the shipped side. Every claim was checked on both. Two of the document's items are already fixed in the shipped engine.

## Engine: defects, features and customer asks

| # | Item | Verdict | Root cause | Remedy at the cause | Size |
|---|---|---|---|---|---|
| 18 | Money slots refuse every outcome naming a currency | **Accurate on both engines, and worse than stated.** 7 of the 10 money slots learn nothing even from the synthetic history, because its add-to-cart events still name EUR. The report credits revenue that live learning refused. The SDK sends USD when the page names no currency. | The money rule was built inside the learning store with no way to publish a policy: the learn document has no member for it, nothing reads one, and the offline report folds skip the rule. | Add a `money` member (currency, what to do with zero or negative values) to the learn document; pass it on both outcome paths; move the rule into the one credit rule the live and offline paths share; the SDK sends no currency when none is named; kit 02 states it. | 2–3 days |
| 20 | Day report over 16 MiB after a realistic day | **Accurate on the symptom, both engines. The cause is wider, and paging the report would not fix it.** Spreading the traffic over two hours makes the second hour's fold refuse, and the day report then builds marked "incomplete" with that hour missing. | The batch fold works in one request that holds a whole hour of raw rows plus every visitor's decisions for 48 hours, under fixed 16 MiB limits. Its memory grows with traffic. | Rework the fold so every step has a fixed memory bound: deduplicate by digest while streaming, fold one shard at a time. Design first. | 8–15 days |
| 19 | No lift for up to a minute after new learning | **Accurate on the demo's engine. Already fixed in the shipped engine** (P62 `3657e892`, P72 `9a1c1c6e`). | A cached copy replaced by a newer publication was refused rather than served. | None: run the demo on the shipped engine. The 90-second talking gap is then unnecessary. | 0 |
| 15 | `utm_campaign` not read on arrival | **Accurate on the demo's engine. Already in the shipped engine** (P36 `88e39487`). | | None: run on the shipped engine. | 0 |
| — | Customer ask: their diagnostics (time to decide, abandonment, repeat dismissal, completion beside upgrades) | Accurate | Reports count outcomes per slot and per holdout arm only. | Tenant-declared named outcomes and per-arm journey measures in the hourly fold. | 5–8 days, after 20 |
| 2 | Candidates that arrive with the request (their flight list) | Accurate | A content slot ranks only catalogue pieces. | A slot kind whose candidates and tags come with the request, with lift kept per candidate. | 5–8 days |
| — | Customer ask: judge optional steps on the whole journey | Partly (the brief guards the steps with the holdout on completed bookings) | Under the default matching, a completed booking never credits the "no step" piece. | A per-slot journey credit on top of the existing per-slot attribution. | 2–4 days, after 18 |
| 11 | A labelled synthetic warm start | Accurate | Imported priors are the only seed and are refused on money slots. | A labelled warm-start import in each objective's own unit, named on the receipt. | 3–5 days, after decision D09 |
| 13 | Learning broken down by page context | Accurate | The learning cell's dimensions are fixed. | A declared, bucketed page-context dimension through the cell, statistics, folds and replay. | 10–15 days |
| 12 | Page context on the receipt | Accurate | Request context only gates eligibility and is never recorded. | Record which conditions admitted the piece on the decision's explanation, under the tracking-consent gate. | 2–3 days |
| 14 | An attribution window per slot | Partly: the six-hour example is already met (after-booking offers learn add-to-bag, whose window is 6 h) | Windows are per reward type for the whole tenant. | An optional per-slot override. | 2–3 days, low priority |
| — | Customer ask: three extra hypotheses | Accurate that the brief left them out; page and content design, not engine work | | Demo or content design. | 0 engine days |

## Demo kit

All 16 rows checked at `4d882915`. The three marked "built" (4 the dial beat, 5 the consent mint, 16 the learn settings) are built and their tests pass. Of the 13 marked "open", 11 are accurate and 2 are partly right. Every cause sits in shared kit code, so every fix serves all demos. Total about 8–10 days.

| # | Gap | Verdict | Remedy at the cause | Size |
|---|---|---|---|---|
| 24 | Reset fallback skips the learn settings | **Accurate, and worse:** it can never succeed on a kit worker, and a 503 whose text says "Not Found" reports success without restoring the learn settings, so a raised dial stays raised | Delete the fallback; a missing `/reset` becomes a named error | 1–2 h |
| 22 | Receipt prefetch stops after one server error | Partly: the kit treats every 5xx as final; the document's "OA's page retries once" is wrong for receipts | Retry 5xx within the existing budget; stop only on a 4xx or a coded permanent refusal | 2–4 h |
| 21 | Browser-test helper rejects dial beats | Accurate | Check each beat against the demo's closed list; call the helper from the template | 2–3 h |
| 23 | Drift check ignores the learn lines | Accurate, and wider (the reset order is not compared either) | Compare every derived constant | 2–3 h |
| 8 | Receipt panel: no page context, no lift value | Accurate | Pass the declared context names; show the lift's value, level and showings (full provenance needs engine 12) | 0.5–1 d |
| 17 | Image manifest expects downloaded photos | Accurate, and wider (all three kit demos keep drawn art outside it) | Drawn art as a first-class imagery kind | 1 d |
| 25 | Guide silent on the dial beat and learn settings | Accurate, and wider (consent missing too) | Update the guide; a test that it names every kind and section the validator accepts | 0.5 d |
| 26 | One-command hosting always runs the US seed; no history step | Accurate | Regional seed only when the demo has a regional lean; a declared history step | 0.5–1 d |
| 7 | Cart in dollars only; add-to-cart carries no value | Accurate | A currency in the demo config; value on add-to-cart; one purchase per order (with engine 18) | 1 d |
| 9 | Regional seed is US only | Accurate, and wider | Each demo declares its regions in the engine's key form; census an optional US input | 1.5–2 d |
| 27 | No option to hide the census rows | **Accurate, and worse:** a visitor outside the US is shown the US national figure | A census switch in the demo config; no US fallback for non-US regions | 0.5 d |
| 6 | No path addresses such as `/oa/results` | Accurate | Route by the page's declared `url` in the store and the worker | 1–1.5 d |
| 10 | Starting assumptions only for count-based slots | Partly: not a kit gap; the engine refuses money priors pending decision D09 | Decision D09, then the engine; a kit priors section after that | decision, then ~0.5 d |

The section's opening line, "none of them shows in the demo", is not quite true: 27 and 22 can show on screen.

## What to do

1. **Run the airline demo on the shipped engine.** That closes Engine 19 and Feature 15 with no engine work and removes the 90-second talking gap.
2. **Fix the two real engine defects at their cause:** Engine 18 (a publishable money policy and one credit rule online and offline; 2–3 days) and Engine 20 (a fold with a fixed memory bound per step; design first, 8–15 days). Both hit any customer, not only the airline.
3. **Fix the kit at its cause:** the 13 open items, about 8–10 days, starting with 24, 22 and 27, which can show on screen or leave a demo in the wrong state.
4. **Decide D09:** what a starting assumption means for a revenue slot. Feature 11 and kit item 10 wait on it.
5. **Product backlog for the airline's production asks:** request-supplied candidates (2), page context on the receipt (12) and in learning (13), journey credit and diagnostics, per-slot windows (14).
