# AI Search + Style Concierge — validated query catalog (for the run-of-show)

**Purpose:** the curated set of search/concierge queries we demo, with **certainty** about the image
each produces. Re-validate before every demo with:

```bash
node scripts/validate-search.mjs          # fast: confirms every curated query → a verified pre-genned scene, stably
node scripts/validate-search.mjs --live   # also live-generates the novel "type-anything" examples to eyeball
```
Last validated: **2026-06-26** — Tier A **18/18** search + **8/8** concierge curated queries INSTANT & STABLE
(product-accurate **occasion × SKU grid**: 39 pre-genned scenes across **13 occasions**); off-script queries live-generate (verified).

## How it works (this IS the real model)
A typed query is **not** scripted. The storefront calls `POST /ai/search` → **Gemini** parses intent + writes
the editorial headline/subhead/scene → deterministic rank over the **real 71-SKU catalog**. Then the client
picks the hero scene, in order:
1. **Exact chip** → its hand-verified scene. Instant.
2. **Occasion × SKU grid** (39 pre-genned scenes / 13 occasions) → the scene for the **actual #1 ranked product**
   for that occasion (product-accurate — matches the shopper's personalized hero), else the occasion's top bag.
   Instant, campaign-grade, **zero variance**.
3. **Off-script query → live `gemini-3.1-flash-image`**, vibe-matched, from the **real product** shot, cached in R2.
   ~8–10s first time, instant on repeat.
4. If anything fails → graceful fall back to the real ranked grid (never a broken state).

Matching is **keyword-first** (literal cue in the text wins) so curated phrasings always land on the same occasion;
the **grid makes the hero match the ranked #1**, so the Edit reflects her personalization (not a fixed anchor).

---

## TIER A — Guaranteed occasions (use these on stage)
Each resolves — deterministically, verified across repeat runs — to an instant, human-verified scene. With the
**occasion × SKU grid** the hero now matches the **actual #1 ranked product** for that occasion (so it reflects
the shopper's personalization), falling back to the occasion's top bag. Every scene's caption reads
*"Styled with AI · the {product} shown is the real product."* (13 occasions; 2 hero variants each.)

| Type this (or phrasings of it) | Occasion |
|---|---|
| `bags for a winter wedding` / `what should I wear to a winter wedding` | winter-wedding |
| `a gift under $150` / `a holiday gift for my sister` | gift |
| `everyday work tote` / `a bag for the office` | work |
| `a crossbody for travel` | travel |
| `an investment bag` / `an heirloom bag` | investment |
| `a date night bag` | date-night |
| `a fun festival bag` | festival |
| `an everyday neutral shoulder bag` | everyday |
| `a cocktail party bag` | cocktail *(new)* |
| `a black-tie gala bag` | gala *(new)* |
| `something elegant for the opera` | opera *(new)* |
| `a bag for a gallery opening` | gallery *(new)* |
| `a beach resort bag` / `a bold bag for a yacht party` | beach-resort *(new)* |
| `a weekend brunch bag` | brunch *(new)* |

The on-screen chips (winter wedding / gift under $150 / work tote) are a subset — all guaranteed.

## Concierge — Guaranteed prompts (styled "look" + real picks)
| Ask the concierge | Look |
|---|---|
| `What should I carry to a winter wedding?` | winter-wedding (Tabby 26) |
| `I need a gift under $200` | gift (Essential Billfold) |
| `Build me a work look` | work (Mollie Tote 25) |
| `put together a travel look` | travel (Tabby Crossbody, COA-76197) |
| `Build me a capsule around the Tabby 26` | capsule (Tabby 26) |
| `I love the Brooklyn line — complete the look` | brooklyn (Brooklyn Shoulder 39, COA-CU044) |

---

## TIER B — "Type anything" (proves it's live, real-time)
Queries with **no grid occasion** generate a **new, vibe-matched** scene live (the grid now absorbs most common
occasions instantly — opera/gallery/yacht/cocktail/gala are Tier A now). Genuinely off-script, validated examples:

| Type this | What happens |
|---|---|
| `a bag for my college graduation ceremony` | live-generates a graduation scene (~8–10s), then cached |
| `a whimsical bag for a garden tea party` | live-generates a garden-tea-party scene, then cached |

Both rows above were confirmed LIVE by `validate-search.mjs` on 2026-06-26. Note: any query containing a grid
keyword (gala, opera, gallery, cocktail, beach/yacht, brunch, work, travel, festival, winter wedding, gift…) is
Tier A (instant), even in an unusual phrasing — so to *demonstrate* live gen, avoid those words.

Earlier proof scenes (rooftop engagement / opera / gallery / yacht) were all generated live and visually approved
before being promoted into the grid — they're now **instant** (Tier A).

**Presenter guidance for Tier B:**
- The request **never blocks**. The ranked grid/cards are instant; the hero scene is generated as a **background
  job** (Cloudflare Queue) and fades in when ready (~10–20s for a first-ever novel query), then it's **cached
  forever** so every later ask (re-type / next shopper) is instant. Two ways to play it:
  - **Pre-warm** (safest): run the exact query once before the session (`node scripts/validate-search.mjs --live`
    uses the synchronous path) — it caches in R2, so on stage it's **instant**.
  - **Lean in**: type it live and narrate "the page is instant — our AI is styling a custom scene in the
    background" — the grid is fully interactive while the hero fades in.
- It is **not** 100%-guaranteed per arbitrary query the way Tier A is — that's the trade for "type anything."
  For the scripted, must-land beats, use **Tier A**.

## Honesty framing (say it if asked)
The **bag in every scene is the real catalog product** (reference-image generation preserves it); the NL
understanding, ranking, editorial copy and picks are real model output over the real catalog. The **scene around
the bag is AI styling** — surfaced verbatim in the caption on every image. Nothing here is faked or hardcoded.
