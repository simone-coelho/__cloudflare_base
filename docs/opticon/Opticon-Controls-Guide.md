# Meridian — the controls, in detail

Every control on the stage, what it does, what appears on screen and where to look, and what is real versus representative. The on-screen tooltips (hover any control for about a second) carry a two-line version of exactly this text. The standing rules behind all of it: **nothing changes without a press**, **every act is declared on the band before it happens (OK performs it)**, and **time moves only when the presenter moves it**.

---

## 1 · The transport (bottom-left)

| Control | What it does | What you see |
|---|---|---|
| **←** | Moves the script back one beat. Performs nothing. | The beat title and counter in the bar change. |
| **Next ▶** | Advances the script **and performs the beat**: the declaration band opens (what she does · the weights · the arithmetic · what will change); you press **OK — let her do it**; the cursor then does her acts, clicking real controls. Beats that perform also **auto-capture a Compare "Before"** first. | The band, then the 44px cursor with the red click marks; the page answers each click. |
| **Auto** | Auto-advances, one beat every ~6 s. Still stops at **every** band for your OK — Auto never consents for you. Press again to pause; the in-flight beat finishes. | The button reads *Pause* while on. |
| **↻** | Restart: aborts anything in flight, closes any band or window, resets to a brand-new visitor (server profile wiped), returns the script to beat 1, clears both strips, the drawer, the Why line and the demo-clock readout. Always clickable. | The page returns to the standard order; the Why reads "Nothing has happened yet." |

## 2 · Vertical

**Calder / Calder Financial** — swaps the catalogue. The same engine, the same **eight** dimension shapes; only the vocabulary changes (line→subFamily, colour→card tier, occasion→intent, …). *Look at the instrument: eight bars stay, labels change.* Profiles per vertical are separate.

## 3 · Ask

| Control | What it does | Real vs representative |
|---|---|---|
| **AI search** *(ask in words)* | Opens the search page. **Before a query**: two rows fill the height — *Because of what you have looked at* (her live picks + the leading dimension) and *Shoppers near you bought* (the neighbourhood cohort, e.g. New York metro · N=320), plus suggestion chips. **After**: the model reads the intent (categories, occasions, price ceilings from live enums), hard-filters, and ranks real in-stock pieces blended with her live affinity, over a pre-generated scene plate with the real product composited. | Intent reading LIVE (Gemini, local fallback); every result a real SKU; plates generated at design time and reviewed. |
| **Style concierge** | A stylist that builds a look with advice, not a list. Item ids are an enum built from the live catalogue minus everything already shown — a fake SKU or a repeat is **unrepresentable**; "we don't carry that" is a first-class answer. | Prose LIVE (model); picks structurally real. |
| **Ask Opal** | Describe an audience in plain English; Opal proposes one over the **live** dimension vocabulary (it can only name dimensions and values this catalogue actually has). Proposing and publishing are deliberately separate — a person publishes. | Proposal LIVE (model, schema-bound). |
| **Signal detected** | The moment: a **simulated, labelled** TikTok signal → Opal writes the copy (live) → composed onto pre-approved artwork (never generated on stage) → shipped as a **real `multi_armed_bandit` rule** with a 28:00 window on the demo clock. | Signal SIMULATED · copy LIVE · art pre-approved · rule REAL · allocation REPRESENTATIVE. |

## 4 · She browses
Each button plays a scripted visitor sequence: the band declares **all** its acts first (one band per sequence); OK; the cursor performs. Esc / Pause / Restart abort between clicks.

| Control | The sequence | The story it tells |
|---|---|---|
| **She arrives** | The cold start. Band: real edge geo · the free census row (income, home value, source) · **your receipts** (N shoppers in her metro, the leading lines with shares, the band they buy in). OK → the hero *"The Drover leads near you · New York metro · N=320"*, the first line *"What shoppers near you carry"* badged **near you**, the welcome strip, the provenance card. | The abstract's premise: first-party purchase history + free census, before any behaviour. Her first act hands the page from the cohort to her — and says so. |
| **Three coats** | Outerwear department, three coat clicks. | Three signals enter audiences; the shelf re-ranks; the picks take the first line. |
| **Wanders to bags** | Bags department, two bag clicks. | The handoff: the campaign's claim expires or is superseded; the hero follows *her*, the ledger closes the email. |
| **Adds to bag** | Adds the hero item. | Journey stage → *deciding*: the hold banner (15:00, real expiry math), the stylist/courier offer with its labelled countdown, the row becomes **Complete the look** (complements from the whole store). |
| **Three Fenwick, one Linden** | Knitwear ×3, then one Linden bag. | Recency leads within the line; membership persists — the D2 story. |

## 5 · Compare

| Control | What it does |
|---|---|
| **Capture baseline** | Freezes a **full-page** picture of the page at the instant of the press — the press *is* the capture (nothing can change the page while it is in flight; the band's OK waits for it). A strip confirms *"Before captured."* Every performed beat also captures one automatically, so Compare always has a Before. |
| **Compare** | Waits for the page to finish moving, takes "Now" (full page, 1:1), and opens Before/Now with the draggable seam. If the first change sits below the fold, it opens scrolled to it. If nothing changed, a **bold warm band** says "this is the page against itself" — including honestly when a step's only change was in the drawer or the side panel (they live outside the page). |

## 6 · Merchandiser

| Control | What it does | What you see |
|---|---|---|
| **Show what changed** | Re-highlights, in the step colour, every card sitting **above its standard-order position**, badged `std N`. True whenever pressed — it is a fresh comparison against the control order, not a replay. | The row lights up; a strip says *"N cards sit above where the standard order puts them"* (or *"Nothing has moved — this is the standard order"*). |
| **Pin the hero / Release the pin** | The merchandiser override: pins the hero to an item the engine did **not** choose, so the override is unmistakable; ranking is skipped for that slot. The button's label always states the current state. | A **PINNED BY THE MERCHANDISER** badge on the hero itself, a strip, and the receipts record it. Release → ranking resumes. |
| **Sell out the top** | Marks the **hero's** item sold out — an item property, never a visitor property. A rule refuses it; the engine re-decides in front of the room; her affinity is untouched. | The hero changes; a strip names the refusal; the Glass box shows it; the refusal beat (band 22) builds on this. |
| **Pin the banner at #3 / Unpin the banner** | The content act's pin: the tenant-config merch strip (non-personalizable, `CMP-1007`) moves to **visible position 3** and the engine re-ranks everything else around it — the contract is *slot → position index*, and nothing is ever permanently pinned; any slot can be pinned at any position. The movement is choreographed one section at a time under a **"SLOWED FOR THE ROOM — in production this is one frame"** label. Position counts what the room can **see** — the engine maps past hidden sections. | The strip travels; the sticky *Page rearranged* strip, the Why and the trail all say **#3**; the button's label states the current state. |

## 7 · Experiments
All three create **real objects in the real Optimizely project** (`OPTIMIZELY_WRITE_ENABLED` gates writes; the card's badge says `live · created now`, `writes off`, or `refused` — never dressed up). Each press creates a **new rule** (unique key) on the flag, so *"Created just now"* is always literally true, and the creating step shows the API's real elapsed seconds ticking. Results appear in the **floating experiment drawer** over the page's right edge — never in the page flow — and the **hero wears the treatment** with a badge.

| Control | Rule type | The readout |
|---|---|---|
| **Create A/B** | `a/b`, 50/50, real metric | Two arms with illustrative rates, labelled *REPRESENTATIVE figures · the rule is real*, plus **Open it now →** into Optimizely. |
| **Create MAB** | `multi_armed_bandit` | Traffic allocation moves **one round per "Let two minutes pass"** (50/50 → 40/60 → 27/73 → 20/80) until *"Loop closed — winner promoted automatically"*, with the governance line (a human presses Launch; autonomy is roadmap). |
| **Create CMAB** | `contextual_multi_armed_bandit` (attributes: visit_number · entry_channel · price_band) | A winner per context, labelled representative; a CMAB rule may land as a draft needing review — the badge says which. |
| **Revenue Radar** | — | The funnel over simulated sessions, computed live on every request: *everyone* looks like an ordinary week; filter **Gen-Z** and the payment→order transition collapses **44.3%**, **$7,627** recoverable, term by term (114 excess sessions × $223 catalogue-mean order × 0.3). **Launch the fix** → a real audience + a real experiment → the funnel **recovers on screen** (24.6% / $201, green) → **Prove it in-session** opens Checkout. |

## 8 · Session

| Control | What it does |
|---|---|
| **How the cold start works** | The two-column card: *what the area tells us* (ZIP, income, home value — free census, ours to use) and *what your own sales tell us* (lines with shares, the band, the attach rate), ending in the sentence: people here earn about $X and buy your premium pieces — the Drover first — so that is how the store opens. **No competitor is named anywhere.** |
| **Show the receipts** | Every decision as warehouse rows — the receipts behind the session. |
| **Checkout** | The payment step as this shopper sees it right now: a plain card form before any fix; after the Radar's launch, **Pay in 4 with social proof**, served by the real flag — the proof in the room. |
| **Let two minutes pass** | Advances the demo clock exactly two minutes — after a band shows precisely what will decay and lapse. Nothing moves before OK. Also advances a running bandit by one round. |
| **Come back later** | Reloads as the same visitor: the profile survives at the edge (per-visitor Durable Object). |
| **New visitor** | A fresh visitor, clean slate (same as Restart's reset, without moving the script). |

## 8a · The content slots (the second catalogue)

Content lives on the page alongside the product grammar, rendered **as its type**: the **merch banner** is a real ad — the committed Winter Sale artwork with a clear *Shop the event* button and a `PINNED · MERCHANDISER` chip (tenant config; hover the chip for the id) — the **stories** (two full-width slots) render a film with a play control and its runtime, or an editorial/guide with artwork and a real paragraph of body copy; the **content hero** leads with art and an excerpt; the **carousel** carries five art slides with type and runtime in the caption. Every content slot carries a **strip inside its own box, at the bottom**: the why on the left (`completes · the Fenwick in her bag 1.00 × 0.5`), the type and the customer's CMS id on the right — never on the top edge, never over the art. Product sections carry the same identity quietly: a coloured left edge and a small corner chip (`PERSONALIZED · HERO`, `PERSONALIZED · RANKING`, `JOURNEY · OFFER`).

The pieces are a content catalogue — 18 retail with committed art and authored excerpts + 4 financial — each carrying the customer's own CMS id (`customerContentId`), scored by the **same** affinity arithmetic as products and delivered as decisions **by ID**: the push is `{contentId, customerContentId, type, slot, order, score, explain}` — merch, content hero, both stories and all five slides, one push per page, visible verbatim in **Show the receipts** under *THE CONTENT PUSH*. Beat 20's band also declares **the content stage**: the shelf narrows to one line so the content areas hold the fold — a presentation choice, declared like everything else; no score moves. When she commits (journey stage → deciding), a slot may prefer content that **completes** the piece in her bag — the bonus is a named driver in the explain, scored, never smuggled. Honesty: *content catalogue REPRESENTATIVE (your CMS in production) · scoring LIVE · the payload REAL*.

## 9 · The instrument (right panel)

- **Live affinity** — the eight bars with thresholds; the **demo clock bar** on top: paused by default, **Resume ×15** (4 real seconds = 1 demo minute) to watch an affinity expire, Pause, Reset, and the *next to lapse* readout with its time.
- **The trail** — the consequence log, newest first: every act, what it moved, and why.
- **Cold start** — the census row and source, the price-band derivation, **your receipts** (lines, shares, band, attach, the grain used), the honesty tags, and the button into *How the cold start works*.
- **Glass box** — why this hero, exactly: section order and its reason, the chosen item, strategy, candidates, refusals, thresholds.
- **The 15** — Coach's capability checklist, verbatim, each ticking **only when the room has seen it happen** in this session; the tab badge counts.

## 10 · The band, the strips, the colours

- **The predict band** opens before every act (scripted or by hand): *what she has done* · *what we are watching for* (the acts, the weights, the arithmetic against thresholds) · *what will change*. **OK — let her do it** performs it. Its scrim never swallows presses on the bar.
- **Strips** pin to the top of the page as it scrolls: audience entered/left, *Page rearranged* (names which section now leads and why), Welcome (the cold start), merchandiser actions, sold-out. Restart clears them.
- **The step colour** rotates red → green → yellow → blue on every step that changes the page, shared by the hero's edging and drop shadow, the moved cards and their badges — so consecutive changes never look alike.

---

*Generated 2026-08-28. The tooltip table in `public/meridian/meridian.js` (`TIPS`) must stay in sync with this guide.*
