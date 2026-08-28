# Opticon — Layout & Motion Spec

**Every number here is a decision. Where a number came from another demo in this repo, the source is cited — those were tuned against live rooms and should not be re-litigated casually.**

Design target: **1920×1080 projected**. Presenter laptop **1440×900** must also clear the fold. Below 1280 the demo is not supported.

---

## 1 · The shell

```
:root {
  --world-w:  360px;   /* left — the rest of the world */
  --engine-w: 380px;   /* right — what we know          */
  --page-min: 720px;   /* centre never narrower than this */
}
```

| Width | world | page | engine |
|---|---|---|---|
| 1920 | 360 | **1180** | 380 |
| 1600 | 340 | 900 | 360 |
| 1440 | 320 | **780** | 340 |
| <1280 | unsupported | | |

**The page never scrolls.** `html, body { height: 100vh; overflow: hidden }` — inherited from the bank demo (`visual-demo.html:19-22`), which is a large part of why it feels composed rather than webby. **Exactly three scroll regions**: the world panel, the page panel, the engine panel. Nothing else.

**Panels reserve width. Nothing overlays the page.** Bright Hour's rule (`live.css:96`) — the panel narrows the store rather than covering it. Chrome that must float (toasts, the compare modal) respects the same edges.

---

## 2 · Type

Two families, deliberately split so the page and the instruments never blur together — the bank demo's accidental win, made deliberate.

- **Page:** `'Playfair Display', ui-serif, Georgia, serif` for display; `'Inter', system-ui, sans-serif` for UI
- **Panels:** `'Inter', system-ui, sans-serif`
- **Numerals & detail:** `ui-monospace, SFMono-Regular, Menlo, monospace`

### The page (light)

| Role | Size | Weight | Notes |
|---|---|---|---|
| **Hero headline** | **44px** | **300** | Serif. Light weight on a pale ground reads editorial, not advertising — the bank's single best typographic decision (`visual-demo.html:608`, 36px at a 728px column; scaled here for 1180px) |
| Hero eyebrow | 13px | 600 | uppercase, `ls .14em`, accent |
| Hero subline | 20px | 400 | max-width 46ch |
| Hero CTA | 16px | 500 | |
| Content block title | 28px | 500 | serif |
| Content block kicker | 12px | 600 | uppercase, `ls .14em` |
| Sort card name | 17px | 500 | serif |
| Sort card meta | 13px | 400 | muted |
| Sort card price | 19px | 600 | mono |
| Zone badge | 11px | 600 | uppercase, hover-revealed only |

### The panels (dark)

| Role | Size | Weight | Notes |
|---|---|---|---|
| **Affinity bar label** | **13.5px** | **700** | Bright Hour's measured number (`live.css:1023-1026`): *"labels stay LARGE — they are read from across a room"* |
| **The sentence** | **14px** | 500 | line-height 1.5. The one line the room actually reads. |
| Bar value | 13px | 500 | mono |
| Episode title | 14px | 600 | |
| Episode chain row | 13px | 500 | |
| Section header | 12px | 600 | uppercase, `ls .14em` |
| Glass Box detail | 11px | 400 | mono, collapsed, engineer-only |

**Two hard rules.**
1. **Nothing the audience is asked to read is below 13px.** 11px is permitted only inside collapsed detail nobody is pointed at.
2. **No weight 400 in the panels.** Bright Hour ships only 500/600/700 and its body default is Medium — synthetic-bold on a projector is mush.

---

## 3 · Colour

### Page — warm, quiet, luxury-appropriate
```
--paper   #FBF9F5    --ink     #1C1A17    --muted  #6B6459
--line    #E6DFD4    --card    #FFFFFF
--accent  #A8763F   (retail)  ·  #1F4E79 (financial)
--accent-soft #F1E5D6 (retail) ·  #DCE7F1 (financial)
```
Hero ground is a pale two-stop gradient, never a photograph competing with the headline: `linear-gradient(135deg, var(--accent-soft) 0%, #FFFFFF 78%)`. The bank's hero holds **10:1** contrast across its whole diagonal; ours must not drop below **7:1** at the dark end. Measure it, don't assume it.

### Panels — dark as a *role*, not a theme
```
--p-bg   #0F131A    --p-panel #171D26   --p-line #262E3A
--p-text #D8DFE8    --p-dim   #8A97A8
--p-blue #6BB0FF    --enter   #4ED17A   --exit   #F0A92B
```
`--p-text` on `--p-bg` ≈ **13:1**. `--p-dim` ≈ **6.5:1** and is for secondary labels only — never for a number the room is asked to read. *(My previous build used `#6E7B8C` at ≈4.3:1 for exactly that job. That is the "muted colours impossible to see" defect.)*

### Card identity — the trackability palette
Eight hues, spread across the wheel, matched for saturation and lightness so none dominates:
```
coral  #E2664F   amber  #D99A2B   olive #7A8F4A   teal  #2E8B84
indigo #4A5FA8   plum   #8B5288   rose  #C4557A   slate #5A7089
```
One hue per item, assigned deterministically and **never reused inside a visible row**. This is what the eye follows during a re-rank.

### Meaning is reserved
| Colour | Means | Used for nothing else |
|---|---|---|
| `--accent` | this zone is engine-controlled | zone badges only |
| `--enter` | entered / confirmed | |
| `--exit` | left / ended | |
| Coral ring, **solid** | **this just changed** | |
| Navy ring, **dashed** | **look here next** | |

*"'Look here next' and 'this just changed' are two different statements, and a room that cannot tell them apart learns nothing from either."* — `live.css:911`

---

## 4 · The page

| Element | Geometry |
|---|---|
| Page padding | 48px horizontal, 32px top |
| **Hero** | full width, **min-height 46vh**, padding 56px 48px, radius 10px |
| Hero image | right, 260×260, radius 8px |
| **Sort zone** | one row, **5 cards**, `grid-template-columns: repeat(5, 1fr)`, gap 16px, framed, 32px of air above and below |
| Sort card | image 4:5, colour edge **6px top**, rank chip 26px top-left |
| **Content block** | full width band, padding 28px 32px, 24px above |
| Section gap | 40px |

**Two change zones. Only two.** The hero and the sort row. The content block changes rarely and slowly, and it is structural rather than competitive. Everything else is quiet furniture whose job is to make the page read as a real public site.

**Not on the page:** no nav dropdowns, no second grid, no cart, no counters, no badges, no floating rail, no search bar in the chrome. Search and the concierge open as full-screen moments and close again.

---

## 5 · Motion

Every duration, with its reason. This table is the single source — no component invents its own timing.

| What | ms | Why |
|---|---|---|
| Hero fade-out | 300 | swap fires **at 300ms, before the fade completes**, so it cross-dissolves and never blacks out (bank demo, measured: opacity never drops below 0.11) |
| Hero fade-in | 420 | |
| Zone glow pulse | 1000 | peaks at ~450ms — as the new headline becomes readable |
| **Sort FLIP travel** | **450** | cards physically travel; the eye follows the colour |
| Sort stagger | 60/card | a tight row needs less than Bright Hour's 150ms grid cascade |
| Content block reorder | 700 | slow and structural, so it is never confused with the sort |
| Episode card land | 350 | |
| Affinity bar width | 420 | width outruns colour (300) so the bar arrives before it changes meaning |
| Chip enter / exit | 700 / 1100 | **the exit is the beat** — it gets 1.6× |
| Ring persistence | **until next recompose** | *"a 2.5s ring that expires while the presenter is still explaining it has told nobody anything"* |

**Rules.**
- **A highlight must never resize the thing it highlights.** Outline and box-shadow only. Stated three times in `live.css`; it is why nothing twitches.
- **Nothing animates off-screen.** Marks are armed as an attribute and played by an IntersectionObserver when the element actually intersects.
- `prefers-reduced-motion` skips the work rather than shortening it — no arming, no rings, no veil.

---

## 6 · Presenter controls

Big, labelled, and **state legible at a glance**. Bright Hour's recorded defect: *"These were six identical chips lost mid-panel; on stage a presenter could not find the quota toggle."*

- Each control names **what it is** and **what it currently is**, as two separate strings — never one merged label.
- ON is loud; OFF is deliberately quiet.
- Minimum hit area 40px. Label ≥13px.
- Panel order is a stage decision, not a taxonomy: **instrument first** (what the room watches), **director second** (what the presenter drives), controls third, engineer detail last and collapsed.
- Play must never require scrolling; watching the result must never require scrolling back.

---

## The episode card — the grouped chain format

The left panel's job is to prove that four unrelated surfaces resolve to one profile. The failure mode it exists to avoid is a **running log**: a scrolling list of events reads as telemetry, and telemetry is exactly what the room already has and does not believe. So an off-site cause produces **one card, complete**, and never a stream.

### Anatomy

```
┌─ 3px blue left rule ────────────────────────────┐
│ EMAIL                        ← kind, 11px mono, .12em, blue
│ The Autumn Edit is here      ← subject, 14px/600, white
│ ────────────────────────────                    ← rule
│ opened            ✓          ← chain, 13px, label column 74px
│ pixel fired       ✓
│ identity resolved ✓
│ landed            the page answered it   ← terminal step names the CONSEQUENCE
│ superseded — Outerwear gave way to Bags  ← closing line, amber, only when closed
└─────────────────────────────────────────────────┘
```

### Rules

1. **One card per cause.** Four surfaces, four cards, in the order the presenter fired them. Newest on top — `prepend`, so the most recent cause is never below the fold.
2. **The chain is the argument.** Each step is a link the room can audit: `opened → pixel fired → identity resolved → landed`. Every step but the last takes a `✓`.
3. **The terminal step names the consequence, not the event.** It reads `the page answered it`, not `landed ✓`. The point of the card is not that we observed something; it is that the page had already changed by the time she arrived.
4. **A card can close itself, and closing is amber.** When observed behaviour supersedes the claim a campaign made, the card gains one line — `superseded — Outerwear gave way to Bags` — in `--exit` amber. This is the only place amber appears in the left panel, so it always means *this is no longer driving the page*.
5. **A closed card is never deleted.** The trail is the evidence. Removing it would make the handoff beat unprovable thirty seconds after it happened.
6. **Fired surfaces dim to 0.45 opacity** rather than disappearing, so the count in the header (`1 of 4 surfaces · one profile`) can be checked against what is on screen.
7. **Declared surfaces read differently.** A form is zero-party, so its chain says `submitted → declared preference stored → joined to observed behaviour`, and the consequence line names the half-life rather than the arrival.

### Why grouped rather than streamed

A log answers "what happened". A grouped card answers "what happened, and what it caused" — which is the only question the room is actually asking. It also survives being looked at late: a presenter who missed the moment can point at a complete card thirty seconds afterwards and the argument still lands, which a scrolled-past log line cannot do.
