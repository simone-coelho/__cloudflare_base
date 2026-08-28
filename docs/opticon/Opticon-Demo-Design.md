# Opticon NYC — Session Design

**45 minutes · ~30 customers · online retailers plus banks and financial institutions · CEO-requested**
**Status:** INTERNAL design proposal · 2026-08-26 · Runway: 8+ weeks

---

## 1. The diagnosis

The First National Bank demo worked because of **attribution**, not simplicity. One action produced one visible change in one place, so the room could hold the whole causal loop in their heads: *I did that → the machine noticed → the page answered.*

Coach didn't fail because it was worse. It failed because the page was dense enough that changes competed for attention, and **a change nobody can attribute reads as decoration.**

So the governing principle is **legibility over density**. But the fix is not a simpler page. The fix is to stop asking the audience to infer the machine's reasoning from the page alone.

**The design thesis: show the machine and the page at the same time, on one screen, and make every presenter action move both.**

That is the user's own phone-line metaphor made literal. You click, the line lights up, the answer comes back, the page changes. Nobody has to take it on faith that something happened at the edge, because they watched it happen.

---

## 2. What the archaeology told us

Four investigations came back. Three findings shape the build.

**The bank demo's real lesson is architectural, not visual.** `public/visual-demo.js:452-480` — `triggerAction()` is awaited and its result is *discarded*. The hero/promo swap runs from a local lookup table regardless of backend state. **Nothing the network does can stall or break a visual beat.** On conference wifi that property is worth more than any feature. It is the single most important thing to inherit, and it is the opposite of how the Coach storefront works today.

Two other inheritances: the hover-revealed **"PERSONALIZED CONTENT" zone badges** (`visual-demo.html:565-581`), which teach the audience where to look without cluttering the page; and the **"Marketing Automation" response panel** (`visual-demo.js:662-688`), which shows the *downstream consequence* — "sales team notified, high-value lead assigned" — not just a pixel change. Nothing in the newer demos replaced that, and it is the best rhetorical device in the repo.

Two corrections to the remembered version: there was never any scroll-depth or dwell detection (dwell is literally fabricated at `visual-demo.js:797`), and there is no personal-loan product anywhere in the repo. The remembered beat is the **Read Blog** button, which maps to an investment guide.

**The Compare tool exists, is presenter-facing, and is a wipe not a fade.** `public/storefront.js:2190-2300` — html2canvas capture into a data URL, composited by CSS `clip-path` driven from a `--cmp-seam` custom property. Turning it into a stage-triggered "capture now, compare later" widget is roughly twenty lines, because `store.captureZone()` and `store.openCompare(a, b, title)` are already globals that accept arbitrary URLs. Adding the crossfade the session needs is one CSS rule and one line of JS.

**Adding a surface costs no routing code, but skipping the registry costs everything.** Static assets serve any new page at any new route. But `src/demos/registry.ts:66-77` resolves an unregistered surface string to `'coach'` **silently** — Coach catalog, Coach config, Coach audience namespace, and under `REFLEX_HOST=do` every product ID is dropped at the trust gate as unknown. No error is raised anywhere. Six registry edits are non-negotiable.

---

## 3. The concept

### Brand: Meridian

One brand, two businesses. **Meridian & Co.** is a general retailer. **Meridian Financial** is a bank. Same name, same design system, same engine.

This is deliberate. When the vertical swaps on stage, the *brand* does not change — only what it sells. That isolates the variable in front of the room: nothing changed except the catalog, and the engine reorganized itself around it. Agnosticism gets demonstrated rather than asserted.

The retail catalog spans the room: bags, tools, games, apparel, home. Enough breadth that every attendee sees their own category, narrow enough that a product row is six tiles rather than a hundred and fifty.

### Layout: the shopper's world and the machine's world, side by side

```
┌──────────────────────────────────────────┬─────────────────────────┐
│  THE PAGE  (light)                  ~62% │  THE ENGINE (dark) ~38% │
│                                          │                         │
│  ┌────────────────────────────┐ ┌─────┐  │  ▸ affinity bars, live  │
│  │  HERO                      │ │ THE │  │    with θ markers       │
│  │  changes on audience entry │ │RAIL │  │                         │
│  └────────────────────────────┘ │     │  │  ▸ audience chips       │
│                                 │fast-│  │    entering / exiting   │
│  ┌──────┬──────┬──────┬──────┐  │twitch│ │                         │
│  │ product row — re-ranks    │  │every│  │  ▸ explain feed         │
│  └──────┴──────┴──────┴──────┘  │signal│ │    why, per decision    │
│                                 │     │  │                         │
│  ┌────────────────────────────┐ │     │  │  ▸ consequence panel    │
│  │  CONTENT BLOCK  ↕ reorders │ └─────┘  │    what happened next   │
│  ├────────────────────────────┤          │                         │
│  │  CONTENT BLOCK  ↕ reorders │          │  [⤢ Capture] [Compare]  │
│  └────────────────────────────┘          │                         │
└──────────────────────────────────────────┴─────────────────────────┘
```

The shopper's world is light. The machine's world is dark and instrument-like. The visual separation carries the conceptual one, and the audience learns it in the first ten seconds without being told.

**Five surfaces, five reasons to change** — so that when one moves, the presenter can name why:

| Surface | Changes when | Demonstrates |
|---|---|---|
| **The Rail** | every single signal | the phone line: instant, always visible, never scrolls away |
| **Hero** | an audience is entered or exited | thresholds, hysteresis, commitment |
| **Product row** | affinity re-ranks it | ranking, gates, merchandiser pins |
| **Content blocks** | slot order is recomputed | content composition, the Mandeep lane |
| **Search** | the shopper asks in language | constrained AI over a real catalog |

Every one carries the bank demo's hover badge. The Rail is the workhorse: it is the user's floating-panel idea, and it is where the "six to eight changes in ten minutes" actually land, because it can move on a signal too small to justify redrawing the hero.

---

## 4. The 45 minutes

### Act 0 — The frame · 8 min · slides

1. **Who you are actually personalizing for.** Most traffic is unidentified; most of it has never been seen before. Every personalization system in the room reaches the minority who logged in. *(This is the thesis of the whole session.)*
2. **Where the edge is.** Not a datacenter your request travels to. The same network hop that already served the page.
3. **The phone line.** Conventional personalization posts a letter and reads the reply tomorrow. This is a line that stays open: the shopper acts, the line carries it, the answer comes back before the page has finished reacting to the click.
4. **What you do not give up.** Your merchandisers still outrank the machine. Your rules still decide what *can* show. The machine decides what *does* show in the space that is left, and it shows its receipts.

### Act 1 — The forty-second visitor · 14 min · live

The narrative spine: *someone with no patience, who never leaves the first page, and never tells us who they are. Watch what we know about them by the time they leave.*

| # | Beat | What the room sees | Real? |
|---|---|---|---|
| 1 | **Cold start** | Brand new visitor, zero actions. The page is already regionally informed. Show the census figure, the local purchasing power, the regional lean. *"He has done nothing. We already know something."* | Census real (ACS 2024, all 51 states). Cohort behavior synthetic and labeled. |
| 2 | **First signal** | One click. The Rail changes before the click animation finishes. Engine panel: one bar moves. *"That is the phone line."* | Real |
| 3 | **Threshold crossed** | Three more actions. A bar crosses θ_in, a chip lights up, the hero commits. *"It waited until it was sure. That line is the threshold, and you set it."* | Real |
| 4 | **The row re-ranks** | Product row reorders. Explain record open: gates passed, scores, rank, tie-break. | Real |
| 5 | **The page recomposes** | Content blocks change order. *"Not what is inside the box. Which box comes first."* | **To build — see §6** |
| — | **Compare #1** | Crossfade: what he saw when he arrived, what he is seeing now. One image, whole story. | Real, needs the fade + stage trigger |

### Act 2 — Memory, and honesty · 8 min · live

| # | Beat | What the room sees | Real? |
|---|---|---|---|
| 6 | **The exit** | He stops engaging. Nobody clicks anything. Roughly fifty seconds later the page changes *on its own* — the audience drops him, the hero stops claiming to know him. *"Everyone demos joining an audience. Watch him leave one."* | Real, but requires `REFLEX_HOST=do` — see §7 |
| 7 | **Memory** | New session, same person. He is remembered — ODP carries what the edge learned. *"The edge is fast. The platform is durable. Different jobs."* | Real, verified live both directions |

### Act 3 — The operator's seat · 10 min · live

| # | Beat | What the room sees | Real? |
|---|---|---|---|
| 8 | **Ask in language** | Natural-language search. *"Something for a black-tie dinner under three hundred."* Products staged into a curated scene — graduation, wedding, black tie. The AI reads the request and writes the copy; **the ranking is deterministic and the scenes are a fixed set.** No hallucination, by construction. | Real. 62 pre-generated scene images are committed, so scripted queries never call a model live. |
| 9 | **Signal to experiment** | A campaign signal arrives. We create a real experiment, in the real Optimizely project, on stage — then open the Optimizely UI and show it sitting there. | **Real and verified.** 22 flags and 11 experiments in the live project were created by this codebase. |
| 10 | **Their own data** | Opal proposes audiences from their warehouse data; a human approves. OptiAnalytics reads the result. *"The engine decides. Opal creates and explains. A person still says yes."* | Real, with the constraints in §5 |

### Act 4 — The proof · 5 min · live

| # | Beat | What the room sees | Real? |
|---|---|---|---|
| 11 | **The swap** | Same URL, same engine, same visitor. Swap the catalog to Meridian Financial. The audience generator re-mints its whole vocabulary — *Mortgage Affinity, Auto-Loan Affinity, High-Yield Savings Affinity* — in front of them. Run the forty-second visitor again through a bank. | Real. The generator is genuinely catalog-agnostic; it enumerates catalog values and names audiences from them. |
| — | **Compare #2** | The retailer and the bank, same engine, side by side. | Real |

**Q&A — 4 min.**

---

## 5. The honesty ledger — read before writing a single slide

The inventory came back with four things that would damage us in a room containing engineers. Each has a safe version.

### 5.1 CMAB — do not claim live contextual decisioning

The installed SDK is `@optimizely/optimizely-sdk@5.3.5` and its entire `dist/` contains **zero occurrences of "cmab."** It cannot decide a contextual bandit. The two experiments in the live datafile carrying real CMAB blocks were the only two of eleven that returned no decision. What renders on screen comes from `src/services/cmab.ts`, a hand-authored scorer whose lift values are computed as `hash(...) % span + lo` and which stamps `representative: true` on every response.

**The fix: cut the CMAB lift matrix from the session entirely.** It is the weakest asset we have and the riskiest. Beat 9 — creating a real experiment in a real project — is stronger, verifiable, and something no competitor can do live on stage.

If asked directly: *"The contextual bandit rule is real and lives in Optimizely. What we show you here is a representative view of how it allocates; we are not going to fabricate live traffic in a demo."* That answer wins the room. Bluffing loses it permanently.

### 5.2 MAB reallocation charts are hardcoded

`src/services/experimentRun.ts:30-50` — two fixed curves and a constant `confidence: 96`, independent of real traffic. Two of the "bandit" experiments in the live datafile are plain equal splits with bandit-sounding names. Same treatment: cut the chart, keep the rule creation.

### 5.3 Section reordering does not exist yet

`composer.ts:158-167` — slot order is the literal index of a hardcoded array, pinned by a test. Nothing in the codebase moves a section relative to another section. But the **ordered decision set is real and genuinely impressive**: eight slots in one coordinated call, each with order, strategy, chosen item, and a full glass-box explain record.

Since we have the runway, **build it** rather than mock it (§6). If it slips, the fallback is to show the ordered decision set and say plainly that order ships as data today and becomes decided next.

### 5.4 Exit and ODP will contradict each other on screen

Observed live: at the moment of exit the explain feed correctly reads `direction: "exit"` while the segment chips **still show the audience**, because the union at `RealtimeSegmentEngine.ts:473-477` includes the live ODP seed and ODP does not decay on our schedule.

If beats 6 and 7 both run with ODP on, the room sees the machine contradict itself. **Fix: run the exit beat with ODP quiet, then turn it on for the memory beat** — which also sharpens the narrative, because the two beats are precisely about the difference between fast and durable.

### 5.5 Cold start is regionally uneven

The census figures are real for all 51 states. The *cohort* is not: only 16 of 51 states clear the 30-shopper gate, and the other 35 receive the national aggregate wearing a state label (honestly flagged as `synthesized: true` in the response). Metro grain resolves meaningfully only around Winston-Salem, because `geo_xref` holds 29 ZIP codes.

**Rehearse in a state with genuine local data — NC, NY, TX, FL, CA — and never switch to a random state on stage to prove regional variance.** Use the `?cohort=<state|city>` deep link as the wifi safety net, and rehearse *with* it, not just knowing it exists.

---

## 6. What we build

Ordered so that a slip at the end costs the least.

**Phase 1 — Foundations (weeks 1-2).** Register the `meridian` surface in all six places in `src/demos/registry.ts`. Two catalogs — retail and financial — with an ID prefix that cannot collide with `COA-*` or `B\d{6}`, because `realtime.ts:686-689` enriches every captured event through a Coach-catalog singleton and a colliding ID would silently write Coach attributes into the shared table. Dimension registry and reflex config per catalog. Own identity namespace, `credentials:'omit'`, surface stamped server-side.

**Phase 2 — The surface (weeks 2-4).** The page: hero, Rail, product row, content blocks, search entry. The engine panel: live affinity bars with threshold markers, audience chips with enter/exit animation, explain feed, consequence panel. Inherit the bank demo's transition timing — 300ms fade, swap, fade, with a one-second glow pulse — and its zone badges. **Inherit its architecture: every visual beat runs from local state and never awaits the network.**

**Phase 3 — Content composition (weeks 4-6).** The genuinely new build. A small content catalog with typed, tagged, ID-addressed blocks; slot order computed per visitor rather than fixed; the ordered decision set already carries `order`, so this is making a constant into a decision rather than inventing a contract. This is the beat that has not been done before, and it is the one Mandeep's program is heading toward.

**Phase 4 — Presenter tooling (weeks 5-6).** Compare upgraded: stage-triggered capture, crossfade mode, pinned scroll position so the two frames register. Beat navigation. A one-key reset. Geo override rehearsed.

**Phase 5 — Hardening and rehearsal (weeks 6-8).** Put a cache in front of `KvAudienceStore.listPublished()` — it is an N+1 sequential KV read on the hot path, roughly 90 reads per event today, and a third catalog pushes it toward 130 **paid by every demo including Coach**. Decide `REFLEX_HOST`. Gate or remove `/__shot`, which is unauthenticated in production and executes arbitrary JS via `?js=`. Full dress rehearsals on the venue network.

---

## 7. Two decisions that need making

**`REFLEX_HOST=do`.** The unprompted exit — a page that changes on its own fifty seconds after the presenter stops touching it — is the strongest single beat available, and it exists *only* in DO mode. In the default session mode the exit is client-scheduled, which means a stalled tab never exits at all. DO mode is fully tested (486 lines, passing) but **has never run in production.** Recommendation: flip it, and give it four full weeks of soak before the session. The beat is worth the risk; discovering the risk in week eight is not.

**One session or two.** Everything above assumes one continuous surface with a vertical swap at the end. The alternative is running the whole forty-second-visitor arc twice, once per vertical, which doubles the demo time and halves the number of beats. I would not do that — the swap is more persuasive precisely because it is fast.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Venue wifi | Every visual beat runs locally. Geo override deep link rehearsed. Pre-generated scenes committed, so scripted AI queries never call a model. |
| Live Optimizely API fails during beat 9 | Pre-flight `GET /live/api/experiment/status` for `writeGate: "enabled"`. Have a second prepared flag key. Check `fellBack: false`. |
| Gemini key unset | Opal chat hangs silently with no error — the one AI surface with no fallback. Verify before the room. |
| Someone asks whether the bandit lift is real | Answer honestly per §5.1. Rehearse the sentence. |
| A new catalog degrades the Coach demo | The KV cache in Phase 5 is not optional. |
