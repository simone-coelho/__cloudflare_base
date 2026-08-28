# Opticon — Master Task List

**The single source of truth. Nothing is done until it is ticked here.**
Update this file at the end of every working session. If a decision changes, amend the decision line rather than leaving two versions alive.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done + verified · `[!]` blocked or needs a decision

---

## 0 · Locked decisions

- [x] **D1** Session: 45 min, ~30 customers, mixed retail + financial, CEO-led
- [x] **D2** Governing principle: **legibility over density**. A change nobody can attribute reads as decoration.
- [x] **D3** Three panels: **the rest of the world** (left) · **the page** (centre) · **what we know** (right). Panels reserve width, never overlay.
- [x] **D4** The left panel is **off-site surfaces**, not a behaviour log. Email, SMS, ad, form. Off-site cause → on-site effect.
- [x] **D5** The left panel groups by **episode**, never a running event list. One card per cause, showing the whole chain.
- [x] **D6** Exactly **two change zones** on the page: a large hero, and one framed sort zone. Everything else is quiet furniture.
- [x] **D7** The sort is **one tight horizontal row**, one axis of movement, strongly colour-coded per item. Not a grid.
- [x] **D8** Product card = **licensed photograph + unique colour edge + colour-matched rank chip**. Placeholder with silhouette underneath so nothing can ever break.
- [x] **D9** Catalogue: **clothing and luxury goods** — bags, outerwear, knitwear, footwear, jewellery, fragrance, eyewear. Financial: mortgage, auto, card, savings, investing.
- [x] **D10** The vertical flip is the proof: the left panel does not change, only the vocabulary does.
- [x] **D14** The ecosystem is **one capability among many**, not the demo. Act 1 sets up Act 2; the handoff is the argument.
- [x] **D15** ⚠️ Latency claim must be the **measured** number. Coach's `/realtime/action` measures 0.59–0.73s incl. ODP round trips; Bright Hour's page call measures 34–82ms. Do NOT put "under 200ms" on a slide until we have measured OUR path and can show it on screen. Split it honestly if needed: the decision is X, the memory sync is Y — different jobs.
- [x] **D11** Honesty: nothing in the UI says "fake"; simulated stages carry a mandatory chip. No fabricated lift charts. No uplift number of ours as proof.
- [x] **D12** Demo brand = **Calder** — *Calder & Co.* (retail) / *Calder Financial* (bank). Moved off "Meridian" because real Meridian banks exist and the flip would cost three seconds of doubt in a room of financial institutions. Surface-only: three files, one word to revert. Code namespace stays `meridian`/`mrd_`.
- [x] **D13** Acts 3–5 run in **retail**. The flip stays the close of Act 2 and hands back.

---

## 1 · Design artifacts

- [x] Run of show v1 written
- [x] Run of show v2 — restructured around the ecosystem, outside-in, 34 beats over 33 capabilities
- [x] Layout spec — panel widths, hero proportions, type scale, colour tokens, contrast targets
- [x] Motion spec — every duration in one table, with the reason for each *(folded into the layout spec §5)*
- [x] **Episode-card spec — DONE** (in the Layout Spec). One card per cause, never a running log — a stream reads as telemetry, which is what the room already has and does not believe. Anatomy, the seven rules (terminal step names the *consequence* not the event; a closed card is never deleted; amber appears nowhere else in that panel so it always means "no longer driving the page"), and why grouped beats streamed.
- [x] **Talk track — DONE and GENERATED.** `docs/opticon/Opticon-Talk-Track.md`, built from `beats.js` by `node src/demos/meridian/build-talk-track.mjs` — 587 lines, 37 beats, 45:00. Generated rather than written because a hand-kept talk track drifts from the director within a day, and then the page in the presenter's hand disagrees with the bar on the screen. The generator **refuses to run if act budgets and beat durations drift**. Ends with the marked beats collected (what does not get compressed if running short) and every caution in one place.

---

## 2 · Assets & data

- [x] **Catalogue imagery — DONE, 40 packshots, APPROVED.** Not sourced — **generated once at design time** by `build-images.mjs` and committed as static files. No model call at runtime, none at deploy; the demo runs with the network unplugged. Forty stock photographs would have come from forty photographers and read as a mood board; one prompt family gives coherence by construction and lets us *specify* the white ground the layout needs. ⚠️ **fakestoreapi was investigated and rejected** — its images are Amazon CDN files of real brands (the Fjällräven fox logo is legible on the first one), i.e. unlicensed third-party photography with visible brand marks, in front of ~30 competing retailers.
- [x] **Normalisation — DONE.** Regenerated on a pure white ground (lifting a warm ground afterwards lifts the product too), then per-image white-point correction: all forty grounds now measure **254–255**. Cropped to content and re-placed at one scale by `normalise-images.mjs` — apparent product size went from **66%–100% to a uniform 80%**, so the row reads as one shelf. JPEG at 800px, **38KB average / 86KB max** against a ≤300KB target.
- [x] **QA gate — DONE and it earned its place on the first pass.** "Pave Drop Earrings" came back as a single pendant: the card would have said *earrings* over a picture of a necklace charm. Fixed by naming paired products explicitly in the prompt, then regenerated. No text, no logos, no faces, no props across the set.
- [x] Per-item colour assignment — 16 identities, verified **zero collisions in any 5-card window**
- [x] Per-category silhouette SVGs — 8 retail + 5 financial, drawn not filed (cannot 404)
- [x] Retail catalogue JSON — 40 items, clothing & luxury, **all six ITEM dimensions clear minProducts=3** *(the seventh, journeyStage, is read from the verb and carries no item field, so minProducts does not apply to it)*
- [x] Financial catalogue JSON — 19 items, parallel dimension shapes
- [x] Content blocks — 12, tagged into the same dimension space
- [x] Curated scene set — 8 retail + 6 financial, 14 portrait stills, deterministic
- [x] Off-site surface creatives — email, paid social, SMS, form, per vertical

---

## 3 · The page (centre panel)

- [x] Hero — 46vh, 44px/300 serif, packshot art, verified rendered
- [x] Hero change — cross-dissolve at 300ms + 1s glow
- [x] Sort zone — one framed row of 5, colour-coded, **row hues de-collided at render**
- [x] **Sort motion — VERIFIED.** After a real re-rank: exactly **2 of 5** cards ringed, matching exactly 2 rank chips (`2→1`, `3→2`), and **5 distinct hues over 5 cards** so each card is individually trackable as it travels. "Only movers ringed" asserted by comparing ringed count to chip count, not by eye.
- [x] Content block — full-width band, slow structural motion
- [x] Zone badges — hover-revealed, accent used for nothing else
- [x] Placeholder-underneath CSS in place (photo layer wiring pending real images)
- [x] Page reads as a real site — brand bar, 8-category nav, two change zones only

---

## 4 · The rest of the world (left panel)

- [x] Surfaces panel — email · paid social · SMS · form, per vertical, openable
- [x] SMS surface
- [x] Ad surface with UTM shown
- [x] Form surface
- [x] Episode card — one cause, whole chain, grouped, verified rendered
- [x] Episode grouping — one card per cause, chain + self-closing supersede line
- [x] **Arrival reaction verified** — hero answers the email, bars move, nothing on the page clicked

---

## 5 · What we know (right panel)

- [x] Six bars — 13.5px/700 labels, hysteresis band drawn
- [x] One sentence at a time, cause first — including arrivals
- [x] Glass Box — collapsed `<details>`: chosen, strategy, candidates, rank, confidence vs θout, drivers, config version, refusals
- [x] Audience chips with enter/exit animation
- [x] **Bars hold position across the vertical flip — VERIFIED.** 7 before, 7 after, same order, labels only: `journeyStage → applicationStage` in place. ⚠️ Fixing this exposed a real stage defect: the flip's WS snapshot frame arrived after the cold-start prior was posted, carrying an EMPTY server vector, and snapshot frames deliberately bypass the sequence guard — so it erased the prior and the flip landed on a generic welcome hero with an empty image box. An empty state can never be more informed than a populated one, so it no longer wins. The flip now lands on the 30-Year Fixed Mortgage, driven by median home value × 0.8 LTV, which is the beat `beats.js` narrates.

---

## 6 · Capabilities (33 distinct)

### Ecosystem
- [x] C1 Email open → pixel → capture
- [x] C2 SMS sign-up → identity
- [x] C3 Ad click → UTM → landing reaction
- [x] C4 Form submit → identity resolution
- [x] C5 Cross-surface identity stitching — four surfaces, one profile, counter in the panel head

### The handoff — the hinge
- [x] **C35 Campaign→behaviour handoff — VERIFIED RENDERED.** Hero flips from the email's answer to observed behaviour; the episode closes itself with `superseded — Outerwear gave way to Bags`; the sentence names it and holds 8s against later frames.
- [x] **C36 Measured decision latency on screen** — a real number per event, not a claim on a slide

### The visitor
- [x] C6 Cold start from geo + real census
- [x] C7 Anonymous profile, no sign-in
- [x] C8 Real-time per-dimension affinity *(engine built + verified)*
- [x] C9 Audience entry on threshold *(verified)*
- [x] C10 Audience exit by decay — the staircase *(verified in production)*
- [x] C11 Self-building audiences from the catalogue *(verified)*
- [x] C12 **Cross-session memory — VERIFIED.** Client adopts the DO's state on load (it previously built an empty state and never asked, so a returning visitor looked cold while the profile sat in the object). ⚠️ Edge memory is real; **ODP is wired-dormant by design** — script corrected so nobody says "ODP is the memory" on this beat.
- [x] C13 **Journey stage — the seventh dimension, read from the VERB not the item.** Scores no product and carries zero slot weight; what it changes is page STRUCTURE. One add-to-bag puts it at 0.68, past θ_in of 0.60, and it decays back under θ_out in ~39s so the page returns to discovery unattended.

### The page
- [x] C14 Baseline sort — the control (`the same order every shopper sees`)
- [x] C15 Personalized sort — travel, rank chips, delta, movers ringed in ink
- [x] C16 Hero personalization
- [x] C17 Content / section composition
- [x] C18 **Page structure — complete the look.** When stage tips to deciding, the row stops offering alternatives and completes the chosen piece: anchor category excluded, coherence with world / band / occasion scored as its own named driver in the receipt. Verified — 5 items, 5 different categories, none from the anchor's.
- [x] C19 **Gates, pins, declared precedence** — pin control (`pinned · ranking skipped`), sold-out control; gates judge the ITEM, affinity untouched
- [x] C20 **The refusal — VERIFIED.** Composer now scores BEFORE gating so a refused item keeps its score; the sentence proves it would have won by comparing against the item actually shown

### The operator
- [x] C21 **Opal proposes, a person publishes — VERIFIED.** Schema built from the LIVE registry + LIVE catalogue (5 dims, 29 values), so an invented dimension is rejected at the type boundary; values re-checked against the catalogue server-side and dropped if absent. Propose and publish are two calls — the governance beat. 5/5 plain-English asks produced usable audiences in merchandiser language (2.0–4.8s).
- [x] C22 **NL search over the closed scene set** — 8 retail scenes rewritten for clothing & luxury, routing verified on 7 real sentences (1.0–1.9s), provenance line on screen, **scene audit run and two mis-returns fixed**
- [x] C23 **Style concierge — VERIFIED, 4 behaviours, ~1s a turn.** Builds a look, not a list. **The guarantees are structural, not behavioural:** item ids are a `z.enum` built from the LIVE catalogue **minus everything already shown in the conversation**, so inventing a product and repeating itself are *unrepresentable* rather than discouraged. Verified: (1) open-ended leans on live affinity — Outerwear/heritage in, wool coat out; (2) refinement returned zero overlap with turn 1; (3) asked for hiking boots and a ski jacket it answered *"We do not have hiking boots or ski jackets in our catalogue"* and still built an honest adjacent look; (4) an explicit "jewellery only" beat an Outerwear affinity. ⚠️ **Two lessons, both expensive.** *Constrain identity, never quantity or length* — `.max(3)` on the array and `.max()` on the prose did not trim the answer, they REJECTED it: the model styled four complements and the whole look came back as "did not match schema". Trim on our side. And *thinking OFF* — Gemini 2.5 reasons by default, which is pure latency here because the enum already solves the hard part; it took turns from 5.3–9s+ (blowing the budget 2 in 3) down to **0.96–1.42s**. Budget now 4s, ~3× the observed worst case.
- [x] C24 **Scene imagery — resolved as CURATED, not generated.** Per the standing constraint that the AI speaks from an approved set. 14 deterministic stills ship; nothing is generated at request time, so there is no hallucination surface and no cold-generation latency on stage.
- [x] C25 Live experiment creation — A/B *(verified against the real project)*
- [x] C26 **MAB rule — VERIFIED from the live API**: `type=multi_armed_bandit`, even split, event metric (custom event created via `/v2/projects/{pid}/custom_events`)
- [x] C27 **CMAB rule — VERIFIED from the live API**: `type=contextual_multi_armed_bandit`, `distribution_goal=automated`, variations **bandit-allocated (no manual split)**, event metric, 3 real `attribute_ids`. ⚠️ No lift matrix shown — the installed SDK cannot decide a CMAB and the numbers elsewhere in this repo are `hash()%band`.

### The business
- [x] C28 **Cohort reveal — the average lied. VERIFIED.** Traffic SIMULATED, compute LIVE: 24,000 generated sessions carry attributes, the payment step has a per-attribute failure model, and every rate is aggregated on the request — filter to a cohort we never rehearsed and it still holds. Blended payment step reads 74.5% (an ordinary week). Premium → 50.8%, a 23.7-point gap. Drill to premium + mobile (9.8% of traffic) → 28.3%, a 46.2-point gap. **Two steps by design** — one attribute dilutes the finding, and showing that dilution is more convincing than a number that is enormous on the first look.
- [x] C29 **Diagnose → recoverable → launch the fix. VERIFIED END TO END.** Recoverable is shown with its working ($162,597 = 335 sessions × $486). "Launch the fix" creates a **real, targeted** experiment: flag `mrd_checkout_remedy_retail`, variations `wallet_first` vs `saved_card_first` — its own remedy flag, because reusing the hero-strategy flag would have put "hero strategy" on screen one sentence after the presenter said "wallet payment is failing". Read back from the live API: `type=a/b`, enabled, `audience_conditions=["and",{"audience_id":4614637184876544}]`, audience conditions `priceBand=premium AND device=mobile`. ⚠️ Audience leaves use **`match_type`**, not the flags API's `match` — the wrong key parses as JSON and then fails validation, which returned null and looked exactly like "no audience wanted".
- [x] C30 **Decision receipts — VERIFIED, 54 rows × 18 columns.** Own D1 table (`mrd_decisions`) so Coach's global `demo_events` reset is *physically incapable* of taking them, and ours cannot touch a Coach row. Written off the response path via `waitUntil`; column order pinned to the migration. Export says so loudly when D1 is unbound rather than returning an empty array that reads like "no decisions were made".

### The moment & extras
- [x] C31 **Signal-led moment — VERIFIED, loop closed in 8s.** Detect (SIMULATED, chip on screen) → Opal writes the creative in ~4.5s → composes onto an APPROVED still → ships as a real flag. ⭐ **Deliberately does NOT generate the image** — generating a photograph live invites exactly the question the beat exists to answer, and the awe was never in the picture; it is in the loop closing inside a sentence. The footer says so: *"composed onto an approved still, not generated."*
- [x] C32 **Style quiz — zero-party, four taps. VERIFIED.** Fires its own `declared` verb (weight 3.2 — above an arrival because it is unambiguous, below a purchase because saying you like evening pieces is not buying one), and is deliberately absent from the verb→stage map: telling us your taste says nothing about how far along you are. The point on screen is the half-life — declared preference lands in the SAME vector as observed behaviour and decays on the SAME clock, so a preference stated once stops driving the page unless behaviour agrees.
- [x] C33 **Reflex moment — VERIFIED, full arc.** A white-glove offer (service, never a discount — a countdown on a price is the thing this beat argues against) earned by a decisive act, whose clock runs to an instant the ENGINE computes: `t* = tLast + τ·ln(R/floor)`, the same closed form as core's exit alarm. Measured 0:34 remaining against a predicted 38.5s. On expiry it names the number that ended it — *"journeyStage · deciding fell to 0.4496, under its exit threshold of 0.45. Nothing was on a timer."* It therefore cannot be extended, which is the argument against urgency theatre made mechanically. Three things land together at expiry: the offer ends, the audience exits, and the row reverts from *Complete the look* to *Selected for you* — all unattended. ⚠️ Shown at 4dp on purpose: at 3dp it rounds to "0.450, under its exit threshold of 0.45", a contradiction the room can see. `expiryOf` is mirrored from core rather than imported (widening core's signature reaches two other demos) and **pinned by `expiry.test.ts`, 3/3**, so the copy cannot drift.
- [x] C34 The vertical flip *(engine verified; surface pending)*

---

## 7 · Director & run of show

- [x] **Beat registry — DONE.** `public/meridian/beats.js` is the executable run of show: **37 beats across 6 acts**, each with act, capability, `do` (presenter), `watch` (projection-safe), `say` (presenter's line), `real` (honesty label), `secs` + `why`, and optional `mark`/`caution`. It is the twin of the run-of-show doc and must not drift from it.
- [x] **Director never performs the demo — ENFORCED, not asserted.** `ARM_ACTIONS` is a three-key whitelist (`reset`, `vertical`, `returnVisit`); any other `arm` key is refused and reported on screen, so a beat cannot quietly grow the power to click a product for the presenter. Statically checked: **0 beats request a non-whitelisted action, 0 arms would perform the demo, 37 of 37 beats have a presenter `do`.**
- [x] **Pacing table — DONE and self-checking.** `pacingCheck()` verifies each act's beats sum to its budget: 240/360/900/480/240/180 + 300 Q&A = **45:00 exactly, 0 drift**. Every one of the 37 durations carries a `why` (0 missing) — e.g. beat 21 is 115s because the three retreats measure ~90s and the presenter needs room to talk across it without dead air.
- [x] **Transport — DONE.** Docked bar, never floating, so it cannot sit on top of what the room is being asked to look at. Prev/play-pause/next/stop plus ←/→/space/Esc. One click to start; position persists in sessionStorage so it survives the reload beat 22 performs. Per-beat clock against planned (amber when over) and a running total against 45:00.
- [x] **Teleprompter legible — DONE.** Beat title 25px serif, watch line 19px, presenter action 15px; nothing under 15px and nothing important grey. **Audience-safe by default** — the room sees the beat and what to watch, never the script; `?prompter=1` reveals the `say` line for rehearsal or a confidence monitor. Cautions render in full-contrast amber (verified on beat 22: *do not say "ODP is the memory"*).

---

## 7b · The visual pass (APPROVED 2026-08-28)

Simone approved the layout after several rounds. What was wrong, and what it is now — recorded so none of it gets relitigated.

- [x] **Both side panels moved off near-black onto light.** This was the core note and I fixed the wrong variable twice, raising text brightness and adding header bars while leaving the ground. Panels are `#CDD5E0`; sections are **white cards** on them; the store page is pure white. ⚠️ The old "separated" sections were `#141922` / `#161D2A` / `#12161E` — **1.02:1** against their own ground. That separation existed in the stylesheet and nowhere on a projector.
- [x] **Section delineation is measurable, not asserted.** Card vs ground **1.48:1**, border **1.71:1**, plus a 2px header rule and a tinted header bar per section. Body text 17.4:1, headings 14.4:1.
- [x] **White ground, saturated accents, thicker borders.** Ground `#FBF9F5` → `#FFFFFF`; brand accent `#A8763F` → `#D6472F`; all 16 product identities re-saturated; card border 1px → 2px, accent rule 6px → 10px, plus a lift off the ground.
- [x] **Two sortable rows.** `rowSize` 5 → 10, so a card can travel a real distance.
- [x] **The travel animation — BUILT. It never existed.** The row re-rendered with `innerHTML` and cards *teleported*; the layout spec described travel the code did not do. FLIP with a **110ms stagger**, movers released in final-rank order, full settle **~930ms**. ⚠️ `transitionend` **bubbles** — the product photo's opacity fade ended, the event rose to the card, and an unfiltered handler wiped the transform mid-flight. Measured: the move died at **150ms of 450ms**, which reads as a stutter, not a bug, and would have reached the stage.
- [x] **Finance renders as a bank, not the retail grid with different nouns.** Rate tiles where the rate is the headline, *Check eligibility* CTAs, an offer hero, and card faces for the one banking product that genuinely has a product shot — whose colour is also its identity through a re-rank. **Finance needs no photography at all.**
- [x] **Left panel is two fixed regions.** Causes on top, ledger below, newest first, scrolling inside itself. Episode chain went from four stacked rows to one line — a third of the height.
- [x] **Controls are pinned and gridded** two-up under labelled groups, so the instrument holds the top without the presenter losing their controls.
- [x] Also caught: active button `#04121f` on blue (**3.07:1**, dark on dark); affinity track bound to `--p-panel` (invisible white on white after the change); `--sans` used by the finance tiles and never defined; `Made at Meridian` — the internal codename — on a Calder & Co storefront.

---

## 10 · Phase 2 — what the room needs (agreed 2026-08-28)

Simone's review of the deployed demo: it shows STATE, not CAUSE. Products swap places with no visible reason; the affinity engine — the thing being sold — has no on-screen argument; the compare tool from the brief is missing; the panels need scrolling mid-demo. This phase fixes that. Decisions below are settled; do not relitigate.

### Decisions
- **D1 Movers.** One loud green (Optimizely green), thick on all four sides, carrying the landed position with "was N" beneath. Holds ~12s then fades to rest. A **replay button** re-highlights the last change for 10s, as many times as pressed — a question three minutes later must not cost the moment. **Resting cards go quiet**: thin neutral border, colour reduced to a small identity mark. Green means *"just changed"* everywhere it appears (movers, audience entry).
- **D2 Recency leads, accumulation gates — an ADDITION to the Tapestry spec.** The docs specify decay only (doc 16 worked example: tote rises while Tabby decays; co-membership expected) and are blank on precedence between overlapping audiences. Under the documented algorithm three 501 clicks then one 545 click keeps pushing 501 for ~30s. New rule: in a single-valued dimension, the most recently touched value LEADS the page on one click; accumulated score decides MEMBERSHIP, which persists until it decays out. Per-dimension flag, tunable. ⚠️ Must be added to the Tapestry Solution & Algorithm doc — flag to Simone before it goes to the customer.
- **D3 Product lines.** The retail catalogue gets `line` (Calder's Tabby): families of ≥3 pieces, names led by the line. `line` becomes the NARROW dimension for retail; material stays a display attribute. This is what makes "three Drover pieces, then a Linden" tellable.
- **D4 Section ordering** per doc 15: intent-stage priority → weight → deterministic tie-break, over fixed vs re-orderable sections, with hysteresis. Sections physically travel (700ms). A **store-card offer** is a section scored on band + stage (blocks carry neither). This is the six-month tier in the docs; the demo shows it built.
- **D5 Scripted browse** on the Coach model: presenter-triggered beats, a visible cursor that scrolls the target into view *before* reading its rect, glides 740ms, clicks with a ripple, leaves a 1200ms outline, then pauses so the room can see. **Pause is BETWEEN beats** (Coach has no mid-beat pause); beats are kept short — one department, three clicks — so gaps come often. Audience enter/leave is said on screen: *"You drifted out of Drover — the offer retired with it."*
- **D6 Tuning dial**, live, so precedence is *turned* rather than asserted. ⚠️ The docs promise hot config; the delivery ledger says the real build is compile-time today. Real on the demo, a commitment on the product.
- **D7 Panels.** Right panel = tabs (affinity / why / trail / glass box); left cards collapsible to a one-line summary. **No new sections.**
- **D8 Compare restored.** It existed in v1 (`_meridian-v1.js.bak`: capture, crossfade/wipe) and was lost in the rebuild — and I wrongly said it had never been built.

### Tasks
- [x] P2-1 **Row reconciled, never rebuilt — DONE.** Cards persist across paints; DOM is reordered and only the rank chip and change badge update. Verified: every card that stayed is the same node, its photograph not reloaded. The flicker was `innerHTML` destroying ten cards per re-rank and each new `<img>` fading in from opacity 0.
- [x] P2-2 **Mover highlight + replay — DONE.** `.changed`: thick `--changed` green on all four sides, badge with landed position and "was N" (or "new in" for arrivals), holds 12s then fades. "Show what changed" re-applies it to the last movers for 10s, any number of times.
- [x] P2-3 **Quiet resting cards — DONE.** Thin neutral border, rank chip in ink, the product's hue reduced to a 4px mark beside the name. The 10px coloured top bar is gone, so green has the page to itself.
- [ ] P2-4 Catalogue lines per D3 *(agent, worktree)*
- [ ] P2-5 Recency-leads rule + test per D2 *(agent, worktree)*
- [x] P2-6 **Tuning dial — DONE.** Five sliders over the hero's per-shape weights in the Glass box tab; `SLOT_STRATEGIES` is the live table the composer reads, so a slider IS the tuning surface — the hero recomposes on the next decision and the foot stamps `<version>+tuned`. ⚠️ Real on the demo; the product build is compile-time today (ledger).
- [ ] P2-7 Section-ordering composer + test per D4 *(agent, worktree)*
- [ ] P2-8 Section ordering on the page (FLIP 700ms) + the store-card offer section
- [x] P2-9 **Scripted browse — DONE.** Ported from Coach: scroll target into view, settle 560ms, THEN read the rect; glide 740ms; click ripple; real handler fired (`el.click()` → `signal()` / `navTo()`); 1200ms outline; 700ms between clicks. Three presenter beats under *She browses*: Three coats (dept + 3 clicks), Wanders to bags (dept + 2), Adds to bag. Buttons disable while a beat runs; pause is between beats. Verified mid-beat: cursor visible over the page, outline on the clicked card, bar climbing, audience entered.
- [x] P2-10 **Audience strips — DONE.** Above the hero: green *"You entered category · outerwear — the edit re-centred on it. Nobody wrote a rule; the score crossed its entry threshold."*; amber on exit *"You drifted out of … — what it was holding on the page let go."* Retires after 9s. Stage audiences are excluded (the offer and the row already narrate those).
- [ ] P2-11 Compare restored per D8 *(agent, worktree)* + the two buttons
- [x] P2-12 **Right panel tabs — DONE.** Live affinity stays pinned above; Why / The trail / Cold start / Glass box are tabs, one pane at a time. A tab that receives content while hidden gets a green dot.
- [x] P2-13 **Left cards collapsible — DONE.** A fired surface folds to one line (`✓ fired`) and gives its height to the ledger; click it to open it again.
- [x] P2-14 **Trail in a tab — DONE.** No new section. Each act posts a card: verb + subject, evidence chips (products viewed, category ×n, departments, events), the arithmetic on the dimension it moved most with the entry threshold drawn on the track, the audience it entered, and what changed on the page.
- [ ] P2-15 Beat 16 ("which box comes first") and beat 23 corrected to what is real; run-of-show + talk track regenerated
- [ ] P2-16 `block_b` is scored by the composer but has no element on the page — render it or drop it
- [ ] P2-17 The Drover→Linden story written as a beat (three Drover, one Linden, the line audience persists, the page follows)
- [ ] P2-18 Walk end to end again with real mouse input; redeploy
- [ ] P2-19 Recency-leads addendum — **DRAFT READY** at `docs/Tapestry-Recency-Leads-Addendum.md` (what the documented algorithm does, the weakness, the addition, where it must not apply, the two tuning rows, and the honesty line for the room). Stays open until Simone reviews; nothing goes to the customer before that.

---

## 8 · Verification

**Two defects only human pace could expose:**
- **The page announced retreats before anything happened.** The cold-start prior landed the band at a = 1.6/(1.6+2.4) = **exactly 0.400 against a θ_out of 0.40**, so it claimed for one tick and immediately announced *"the hero stopped claiming"* and *"the product row stopped claiming"* at **0.0s** — spending the narration beat 21 depends on, on a page the presenter had not touched. Fixed twice over: a slot must now **hold** a claim for 5s before its retreat is worth narrating, and the prior is retuned to 1.35 (a = 0.36) so it is unmistakably non-zero without sitting on the line.
- **The cold-start hero silently downgraded to "Featured".** Lowering the prior below θ_out made the hero "fading", and the kicker checked `fading` *before* `!behaved`. With only a geo prior the honest reason is geography whether or not a threshold was crossed, so that check now comes first.


- [x] Engine rehearsal suite — 18 assertions *(passing)*
- [x] Isolation suite — 10 assertions, Coach + bank + Meridian coexist *(passing)*
- [x] **Verify with real mouse interaction, not injected clicks — DONE.** `/__shot?clicks=` uses puppeteer `page.click()`, which moves the pointer and dispatches CDP press/release at the browser input layer; JS is now used only to READ. ⚠️ The click loop silently swallowed a missed selector — exactly how a screenshot "verifies" a page in the state it would be in if the feature were broken — so every click now reports `ok:`/`FAIL:` on an `x-shot-clicks` header with `x-shot-ok:false`. **This immediately caught a real design flaw the artificial sequence hid** (see C13/C18 note).
- [x] **Verify rendered state — DONE.** The suite asserts computed `display`, measured `getBoundingClientRect()` height, and live text, never attributes. 8/8 pass on the real spine: email arrival → browse → add to bag.
- [x] **Verify at projection resolution — DONE, 1920×1080.** Layout holds, no horizontal page scroll, hero 489px tall. ⚠️ **Caught a real defect:** `.offer{display:flex}` overrode the UA `[hidden]` rule, so an empty dark slab sat between the hero and the row for the entire demo until the offer fired — the attribute said hidden, the pixels said otherwise. `.ask-answer` had the identical bug. Both now carry `[hidden]{display:none}` guards, and the suite asserts each panel is **invisible before it is earned** by computed display and measured height.
- [x] **Human pace — DONE for every timing-dependent beat** (the rest are instantaneous; the full sweep is the dress rehearsal). Measured with real mouse input and then nobody touching it: **the staircase lands at 28s / 64s / 74s** on category → price band → taste, three separate retreats each naming its own dimension; offer expiry at 38.5s predicted / 0:34 observed; concierge 0.96–1.42s a turn; experiment dispatch 2.5–4.9s. ⚠️ **Caught two defects curl pace could not have shown** — see the two entries below.
- [ ] Full dress rehearsal, end to end, timed
- [x] **Coach regression — DONE.** Live check with a Meridian session active (6 dimensions, real actions): `/health` 200, `/live/` 200, Coach's storefront and API return their normal auth codes (307/401 — pre-existing, unchanged). *Honest limit: I did not walk Coach's authenticated flow end to end, so this proves no interference, not that Coach is fully healthy.* The structural guarantee is now a **test, not a comment** — `isolation.test.ts`, 7 assertions, all passing: imports nothing outside itself but `@/reflex/core`; nothing outside imports it; **every WRITE goes to an `mrd_` table** while reads may touch an allowlisted shared reference table (`geo_census` — duplicating the published census would be duplication for its own sake); all Optimizely keys prefixed `mrd_`; 59 catalogue ids all `MRD-`, zero duplicates; its own Durable Object with no other demo's binding referenced; routes mounted only at `/meridian/api`.

---

## 9 · Pre-flight

- [ ] Deployed URL, not local
- [ ] `?region=` override rehearsed, not just known about
- [ ] Write gate confirmed enabled on the deployed environment
- [x] **`/__shot` gated — DONE.** It evaluates arbitrary JS in a real browser on our own origin, so ungated it is remote code execution wearing a screenshot tool's clothes, and it burns account-wide Browser Rendering quota. Now CLOSED BY DEFAULT: no `SHOT_TOKEN` configured means the route does not exist; with one set a request must present it. Both failures return **404, not 401** — a 401 confirms there is something to attack. Verified: no token → 404, wrong token → 404, correct token → 200. ⚠️ `.dev.vars` needs a **restart**, not a hot reload. **Leave `SHOT_TOKEN` unset on the conference deployment** — nothing on stage needs this route.
- [ ] Second-visitor flow via incognito
- [ ] Printed talk track — *artifact is ready and current: `docs/opticon/Opticon-Talk-Track.md`. Re-run the generator, then physically print it. This stays open until paper exists in a hand.*

---

## Open questions for Simone

- [ ] Is the Coach bank-demo Reset defect ours to fix? *(it calls a global that doesn't exist; presenter-path)*
