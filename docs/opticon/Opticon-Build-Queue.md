# Meridian — the agreed build queue

Everything agreed with Simone in the 2026-08-29 review session, in one place, so nothing is skipped again. Status is updated as each lands. **Nothing here is optional** — each item is something he asked for and agreed the shape of.

| # | Item | Why it matters | Status |
|---|---|---|---|
| 1 | **The signal honesty split** — stop saying "this part is simulated"; name the ONE simulated thing (the detection) against the four real ones and the one representative one, on screen as a ledger card and in every wording that carries it (beat 40 say/watch/real, the trail entry, the takeover provenance line, beat 42's honesty line) | "We can't make it sound like we simulated the whole thing." One ambiguous word undoes four real things | ✅ done |
| 2 | **Compare + Capture in the transport** — out of the palette drawer, beside Next/Auto, prominent, always visible; quiet until a baseline exists | He must never hunt for Compare in a drawer mid-demo | ✅ done |
| 3 | **"Do it" beside Next** — fires the same handler as the card's *OK — let her do it*, visible only while a declaration is open | So his hand never crosses the screen to perform the act he just declared | ✅ done |
| 4 | **The act/beat text shifts right** — the new buttons take the gap to its left | His observation: plenty of space there | ✅ done |
| 5 | **The leader sentence tells the truth** — name what actually MOVED, and say the banner *stays* pinned; in all three places (declaration card, page strip, Why line) | "The merch banner now leads" was false — it was already leading and had not moved | ✅ done |
| 6 | **Drop the duplicated parenthetical** in the middle column — the dimension list repeats the table below it | Wasted the space the explanation needs | ✅ done |
| 7 | **THE DECISIONS BAND — every decision, every beat.** A full-width band under the three columns: one row per decision, four columns — WHAT changed · WHY (the number) · AGAINST (threshold cleared or rival beaten) · AUTHORITY (engine / intent priority / merchandiser pin / tenant config / campaign claim / rule refusal / cohort). Appears on EVERY beat, not only rearrangements; the now→after map moves beside it and shows only when the order changes | The whole no-black-box argument. "Every time you see it win, you can explain it to your CFO" | ✅ done |
| 8 | **Runner-up in the item receipt** — the composer keeps the second-best score so a row can read "beat the Shorewell Trench 0.244 to 0.191" instead of "rank 1 of 39" | A demonstration instead of a claim | ✅ done |
| 9 | **The Predicted pill replays the decisions band** too | The questions come minutes later; he needs an answer he can press | ✅ done |
| 10 | **A tuning beat** — the dial is real (writes into the live strategy table, hero re-decides, receipt stamps `+tuned`) but NO beat shows it. Declare it, turn one slider on stage, watch the hero re-decide | Tapestry's data scientists asked for self-tunable weights by name; the demo proves it and the script never shows it | ✅ done |

| 11 | **Every rearrangement is choreographed** — the slow, one-section-at-a-time move with the "SLOWED FOR THE ROOM" label was gated behind a flag only the pin beat set; every other reorder happened in one 700ms flash. Now every reorder performs, pace in one constant (`CHOREO`, currently 1200ms per move + 900ms between: ~3.7s for three sections) | "It just happens in a flash. There's no intention." Deliberately slow first — tighten only if the room asks | ✅ done |
| 12 | **Every section in a move carries its own evidence** — a badge on the section: `was 3 · now 1` for movers, `held 1 · the page moved around it` (or `pinned by the merchandiser`) for the section left at the top. Each badge lands as its own section lands; they persist **until the next press** | The top of the viewport is the primary seat — "untouched" is the wrong impression when the page reorganised around it | ✅ done |
| 13 | **"Do it" sits immediately right of Next** | So his hand never travels across the bar mid-sentence | ✅ done |
| 14 | **The decisions band reads in the app's own sans**, 14px rows, tabular figures — not 9.5–12px monospace | "Do not use fancy fonts… fonts that are understood to be clearly simple to read" | ✅ done |
| 15 | **Card pills wrap** instead of running off the right edge of their column | The cold-start touch list is long by design | ✅ done |

## Verification standard (his rule, not negotiable)

The acceptance test is the **cold 1440×800 viewport walked from the top**, including the beats that do *not* rearrange — that is where the decisions band has to prove itself. Judge from the screenshots, not from element assertions. Never hand over an unwalked build.

## Open items owned by Simone

- Whether the tuning dial should also expose the **section weights** (turning a knob would then reorder the page, not just re-decide the hero). Bigger change; his call.
- Review of `docs/Tapestry-Recency-Leads-Addendum.md`.
- Timed dress rehearsal; incognito second visitor; print the talk track.

## Standing rules this queue must not violate

Nothing changes without a press. Every act is declared on the band first, and OK performs it. Time moves only when the presenter moves it. Build exactly what was asked — no artistic additions. Never name a competitor on screen. The `real:` honesty line on every beat is law, and the simulated part is said proudly, first.
