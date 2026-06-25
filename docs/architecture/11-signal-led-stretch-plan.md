# 11 — Signal-Led Stretch Plan: "Trending TikTok → Opal variant → MAB-optimized moment"

**For:** Build agents · reviewing SA · CSM/AE (for the Coach narrative)
**From:** Solutions Architecture
**Status:** Stretch design (do LAST, after the core 15-beat demo + Opal chat land). This is the "wow" encore, not a core requirement.
**Reads against:** [`./comprend_signal_led_brief.md`](./comprend_signal_led_brief.md) · [`../PROJECT_LEDGER.md`](../PROJECT_LEDGER.md) · [`../Tapestry-Coach-North-Star-Brief.md`](../Tapestry-Coach-North-Star-Brief.md) · [`./08-opal-chat-plan.md`](./08-opal-chat-plan.md) · [`./09-optimizely-api-plan.md`](./09-optimizely-api-plan.md) · [`./05-demo-build-spec.md`](./05-demo-build-spec.md)
**Existing code it bolts onto:** `public/storefront.{html,js}` (Demo Director, `runOpalStep()`, `showMab()`), `src/routes/operator.ts` (`/operator/audiences/suggest|publish`), `src/connectors/AudienceAuthoring.ts`, `src/connectors/DecisionProvider.ts`, `src/data/insights.json`.

---

## 0. TL;DR (6 lines)

1. **Feature ONE signal: TikTok velocity** (the deck's hero — the 30-min window, the Gen-Z framing). Mock the **DETECT** stage honestly via a new `SignalProvider` connector (Mock + inert Live) reading `src/data/signals.json`, badged on-screen **"SIMULATED · partner social-listening layer, not Optimizely."**
2. **DECIDE + GENERATE = Opal.** Today: reuse the real `/operator/audiences/suggest` intent-matcher, seeded with the signal's `nlSeed`. Later: the planned **Gemini Opal chat** (doc 08) writes the on-brand "moment" copy. A "variant for the moment" = **audience (WHO) + module decision + copy params (WHAT)** — *not* bespoke HTML (Opal/MCP cannot author HTML; our engine owns modules).
3. **SERVE = the existing real path** (`/operator/audiences/publish` → WebSocket `audience_published` → engine reshapes the hero). No new serve machinery.
4. **OPTIMIZE = the existing MAB beat** (`showMab()`), re-skinned so the arms are the moment variants and traffic auto-allocates to the winner **before the window closes.** Representative on stage; the real `multi_armed_bandit` FX rule (doc 09) is genuinely creatable token-gated.
5. **New surface = a 3-beat "Signal-Led Moment" encore** (DETECT → GENERATE → SERVE+OPTIMIZE+MEASURE) appended to the Director as an opt-in encore, *not* added to Coach's 15-item requirements checklist. Carries a live **window countdown** and explicit honesty chips at every stage.
6. **Effort: ~1–1.5 days for a fully self-contained mock-real version** (Phase 0, zero new external dependency); +0.5d to route GENERATE through the real Opal chat (needs doc 08 + Gemini token); +0.5–1d for a real MAB rule (needs doc 09 + Optimizely token). **The economic figures in the deck (100x reach, 60% lower cost, 80/20 split) are Comprend narrative, unsourced — never shown as Optimizely numbers.**

---

## 1. Which signal to feature — recommend **TikTok velocity**

The brief's slide 3 offers six: weather, TikTok velocity, cultural trends, geo-mobility, store proximity/POS, influencer triggers. Slide 6 step 1 narrows it to "one Gen-Z signal (TikTok velocity or weather)." Decision:

| Signal | Wow / on-narrative | Coach-catalog fit | Window drama (the 30-min stat) | Can DETECT be *real*? | Verdict |
|---|---|---|---|---|---|
| **TikTok velocity** | **Highest** — the deck's hero, the Gen-Z wedge, the "Coach said no" framing | **Strong** — a viral bag/line (Tabby, Brooklyn) is exactly the moment | **Yes** — the 20–30 min window *is* TikTok | **No** — no native velocity listener in Opal (brief §"open questions"); fully mocked | **FEATURE THIS** |
| Weather | Low — "most basic signal" | Weak — Coach sells handbags, not raincoats | None — weather has no closing window | **Yes** — free Open-Meteo API, no key | Optional honesty-hardening 2nd signal (see §7) |
| Influencer trigger | High (clears inventory in 20 min) | Strong | Yes | No — harder to mock credibly; overlaps TikTok | Fold into the TikTok story, don't build separately |
| Cultural / geo / POS | Medium | Medium / weak | Weak | No | Out of scope for the tightest demo |

**Why TikTok wins, stated plainly.** It is the only option that is simultaneously the deck's hero, a real Coach phenomenon (Tabby/Brooklyn genuinely went viral with Gen-Z), and carries the dramatic closing window the whole POV hinges on. Its one downside — DETECT is **fully** mocked — is *expected and sanctioned* by the brief, which explicitly calls signal ingestion a partner layer and the detect stage "the piece most clearly mocked." Honesty here is a **labeling** problem, not an avoid-the-mock problem, and we label it (§5).

**Skeptical note / a lever for the team.** Weather is the *one* signal where we could make DETECT genuinely real cheaply (Open-Meteo, no API key) — useful if a technical buyer pushes on "is any of the detect real?" We recommend shipping TikTok as the hero and keeping weather as an optional, genuinely-live second signal that proves the seam (§7, Phase W). Do not build both for the first cut.

---

## 2. DETECT — mocking the signal feed honestly

DETECT is a **partner / non-Optimizely** capability (brief slide 5: "Real-time signal layer → Partners"). We model it with the same "real seam, mocked call" pattern as the rest of the connector layer (`SegmentProvider`, `AudienceAuthoring`, `DecisionProvider`).

### 2.1 New connector seam — `src/connectors/SignalProvider.ts`

```ts
export interface TrendSignal {
  id: string;
  type: 'tiktok_velocity' | 'weather' | 'influencer';
  headline: string;        // "Coach Tabby spiking on TikTok"
  detail: string;          // "#CoachTabby +480% views/hr · NY metro"
  anchorLine?: string;     // "Tabby" — maps to our existing line/module logic
  skus: string[];          // real Coach catalog ids (COA-CH857, …)
  region: string;          // "US-NY"
  velocityPct: number;     // 480  (INVENTED for the demo — label it)
  windowMinutes: number;   // 28   (the closing window, made visceral)
  confidence: number;      // 0.86
  source: string;          // "partner_social_listening"
  simulated: true;         // hard-coded — DETECT is always mocked here
  nlSeed: string;          // the prompt we hand Opal in §3
  detectedAt: number;
}

export interface SignalProvider {
  nextSignal(): Promise<TrendSignal | null>;   // poll the feed
  ingest?(s: TrendSignal): Promise<void>;       // LIVE seam: a partner pushes a signal
}

export class MockSignalProvider implements SignalProvider { /* reads src/data/signals.json */ }

export class LiveSignalProvider implements SignalProvider {
  // Where a real partner social-listening integration would plug in:
  //  - poll a partner velocity API, OR
  //  - receive a partner webhook at POST /signals/ingest (Streamable push).
  // Inert until wired — makes the "partner owns DETECT" tell from slide 5 architecturally visible.
  async nextSignal(): Promise<TrendSignal | null> { throw new NotWiredError('SignalProvider'); }
}
```

Register it in `src/connectors/index.ts` alongside the others, flipped by the same `CONNECTOR_MODE`. The presence of an explicit, *inert* `LiveSignalProvider` is the honesty artifact: it shows exactly where the partner feed connects and that Optimizely does not ship it.

### 2.2 Fixture — `src/data/signals.json` (bundled, like `insights.json`)

```json
{
  "_meta": {
    "note": "SIMULATED signal feed — the DETECT stage. Signal ingestion is a PARTNER / social-listening layer, NOT native Optimizely (Comprend slide 5). Velocity numbers are invented for the demo. No live dependency.",
    "consumed_by": "MockSignalProvider.nextSignal"
  },
  "signals": [
    {
      "id": "sig_tabby_tiktok_ny", "type": "tiktok_velocity",
      "headline": "Coach Tabby spiking on TikTok",
      "detail": "#CoachTabby +480% views/hr · creator reel · NY metro",
      "anchorLine": "Tabby", "skus": ["COA-CH857", "COA-CY201"],
      "region": "US-NY", "velocityPct": 480, "windowMinutes": 28, "confidence": 0.86,
      "source": "partner_social_listening", "simulated": true,
      "nlSeed": "Coach Tabby is spiking on TikTok in NY — create a moment audience for shoppers landing on Tabby right now and switch on a 'trending now' hero plus complete-the-look.",
      "detectedAt": 0
    }
  ]
}
```

Reusing **real Coach SKUs** (`COA-CH857`, `COA-CY201` — the same Tabby ids the Director already drives) keeps the moment grounded in the live catalog and the existing engine paths.

### 2.3 Route — `src/routes/signals.ts`

- `GET /signals/next` → `MockSignalProvider.nextSignal()` (the demo polls this).
- `POST /signals/ingest` → the **live partner-push seam**; in mock mode it simply echoes/queues the posted signal so a partner integration is demonstrably swap-in. Mount under the existing Hono app next to `operator`/`realtime`.

**On-screen label for this stage:** `DETECT · SIMULATED — partner social-listening layer (not Optimizely)`. This is the single most important honesty chip in the whole encore.

---

## 3. DECIDE + GENERATE — Opal makes the variant *for the moment*

This is the most demo-able stage (brief: "generation + serving + optimization is largely real") and it reuses our existing variant/insight machinery. The key honest reframing of "Opal generates variants":

> A **variant for the moment** = an **audience (the WHO)** + a **module decision + copy/parameters (the WHAT)**. Opal authors the *decision and the copy*; **our engine owns the module rendering.** Opal/MCP **cannot** emit HTML/CSS/JS (North-Star landmine #2; doc 09 §4) — so "generative creative" here means **model-written copy + targeting + parameters over our module library**, not bespoke page code or generated imagery. Say this out loud on stage.

### 3.1 Today (Phase 0) — reuse the real `/operator/audiences/suggest` path

The existing `MockAudienceAuthoring.suggestAudiences()` already turns plain language into a draft `AudienceDef` (status `suggested`) over the `insights.json` corpus, scored by an intent matcher. We feed it the signal:

- The encore calls `runOpalStep()`-style logic but seeds the prompt from `signal.nlSeed` instead of the hard-coded Tabby string.
- The matcher lands on the existing `high_intent_tabby_browser` insight → `recommended_module: complete_the_look`, `anchorLine: "Tabby"` (and/or `brooklyn_browser → line_spotlight`). That draft **is** the moment variant; no new audience corpus needed.
- The "generated copy" for Phase 0 is a small canned, on-brand string carried on the signal (e.g. hero eyebrow "As seen on TikTok", title "The Tabby everyone's talking about"). Rendered through the existing `resolveHero()` / `heroForLine()` path — **real serve, real module, scripted copy.**
- Human clicks **Publish** → `/operator/audiences/publish` (the existing governance two-call gate). This is already real.

### 3.2 Later (Phase 1) — route GENERATE through the real Gemini Opal chat (doc 08)

Once the Opal chat ships, the signal becomes context for a real model turn:

- The signal (`headline`, `anchorLine`, `skus`, `windowMinutes`) is injected as a system/context message; the merchandiser (or a one-click "spin up this moment" prompt) asks Opal to act.
- Opal's tools do the work: `createOptimizelyAudience` (the moment audience) + `createOptimizelyFlag`/variations (the "trending now" hero variant) — both **`needsApproval: true`** (the Publish/governance beat). **Gemini writes the on-brand copy** — this is the one genuinely *generative* bit, and it is real.
- Without a token, those tools return the doc-08 **dry-run** payload (clearly labeled), so the beat still demos.

Either way, the variant flows into the *same* decision → module pipeline the storefront already renders. Nothing downstream changes.

---

## 4. SERVE + OPTIMIZE — reuse the serve path and the MAB beat

### 4.1 SERVE — already real, already built

Publishing the moment audience already triggers `broadcastAudiencePublished()` in `src/routes/operator.ts` → a `audience_published` `PersonalizationUpdate` over the existing `PersonalizationWebSocket` → the storefront flashes and the engine reshapes the hero/grid toward the viral line. **No new serve code.** This is the existing North-Star "audience goes live in seconds" beat, re-pointed at a trend instead of a merchandiser whim.

### 4.2 OPTIMIZE — re-skin the existing MAB beat for the moment

Reuse `showMab()` verbatim in structure; change only the arm labels so the bandit is choosing between the **moment variants**:

- `Variation A · "New Arrivals" (control)`
- `Variation B · "As seen on TikTok" hero` ← winner
- `Variation C · "Complete the Tabby look"`

Keep the existing animated traffic auto-allocation (33/33/33 → 11/73/16) but frame it as happening **inside the closing window** (the countdown from §5 is on screen). The footer becomes: *"Variation B auto-promoted to 73% of traffic — lift captured before the window closed."* Honesty chip stays exactly as today: **"Representative · Optimizely MAB is GA."**

### 4.3 Tie to the real Optimizely API work (doc 09)

This is what keeps OPTIMIZE honest rather than pure theatre: doc 09 §3.6 documents the FX REST ruleset rule type **`multi_armed_bandit`** as a real, creatable primitive. So the truthful claim is:

> The same token-gated Opal-chat tool that creates an A/B rule can create a **real `multi_armed_bandit` rule** targeting the moment audience; the edge then reads the regenerated **datafile** (doc 09 §6) and the engine serves the bandit's pick. On stage we show the *representative* animation; we state the rule is genuinely creatable.

**CMAB stays representative** — it is GA for Web Exp & Personalization but **beta/access-gated for Feature Experimentation** (North-Star table; doc 09 §9). Do not promise a live CMAB rule on FX. If we show a contextual angle, reuse `showCmab()` with its existing "representative" chip.

---

## 5. The new Director beat / surface + on-screen honesty labels

### 5.1 Surface: a "Signal-Led Moment" encore (3 micro-beats)

Add a **`buildSignalArc()`** that pushes three steps shaped exactly like the existing `this.steps[]` objects (`{label, watch, caption, run, callout}`), plus one new panel in `storefront.html` (`#signal-feed`) and a re-skin of the MAB readout. **Recommendation: do not add these to the 15-item Coach Requirements checklist** (`featureList` maps to Coach's literal RFP list). Instead expose the arc behind a dedicated **"Show the Signal-Led moment ▸"** encore button shown after step 15 completes, so the core demo stays exactly 15 beats and the stretch reads as a bonus. (Alternative: append as steps 16–18 with a visually distinct "Stretch" group and leave the requirements count at 15.)

| Beat | Stage | What runs (reuses) | New surface |
|---|---|---|---|
| **S1** | DETECT | `GET /signals/next` → slide in `#signal-feed` toast with a **live countdown** of `windowMinutes` | `#signal-feed` panel + countdown timer |
| **S2** | DECIDE+GENERATE | `runOpalStep()` seeded with `signal.nlSeed` (Phase 0) or the real Opal chat (Phase 1) → draft moment variant → human **Publish** | existing `#opal` modal (re-titled "Opal · Moment Builder") |
| **S3** | SERVE+OPTIMIZE+MEASURE | WebSocket flash → hero flips to "As seen on TikTok" (real engine) → `showMomentMab()` re-skin of `showMab()` → "loop closed in 4:12 of 28:00" stat | re-skinned `#mab-readout` (`#moment-mab`) + a "loop closed" stat line |

The countdown is the dramatic spine — it makes the deck's "30-minute window" visceral and lets the loop visibly close *before zero*.

### 5.2 The explicit on-screen honesty labels (carry verbatim)

| Where | Label |
|---|---|
| `#signal-feed` (S1) | **DETECT · SIMULATED** — signal ingestion is a partner / social-listening layer, **not native Optimizely.** Velocity figures illustrative. |
| Opal modal (S2) | **Model-written copy + targeting + decision** over our module library. **No bespoke HTML via Opal/MCP.** **DRAFT → a human clicks Publish** (governance beat). |
| MAB readout (S3) | **Representative figures · Optimizely MAB is GA** (Web Exp / Personalization / Feature Exp). Real `multi_armed_bandit` rule is creatable token-gated (doc 09). |
| Autonomy line (S3 footer) | **"Act on small bets without sign-off" = roadmap.** Today the loop closes with a human Publish click. (Slide 6 step 3 is aspirational vs. current draft-only/human-publish reality.) |
| If economics ever shown | **Comprend POV framing — illustrative, not Optimizely-measured.** (100x reach / 60% cost / 80-20 split are unsourced deck narrative.) |

These labels are non-negotiable: they are what lets us run the deck's most aggressive slide (slide 6 step 3, autonomy) in front of a DY-savvy engineer without overpromising.

---

## 6. The closed loop, end-to-end (real vs. mock at each stage)

```
DETECT ───────► DECIDE+GENERATE ───────► SERVE ───────► OPTIMIZE ───────► MEASURE ──► (loop)
TikTok velocity   Opal: audience +         publish →      MAB shifts to     lift readout
(SIMULATED,       copy + module decision   WS flash →     the winner         before window
 partner layer)   (copy model-gen P1;      engine          inside the         closes
                   modules are OURS)        reshapes        window
   MOCK              REAL (P1) / scripted    REAL            REPRESENTATIVE     REPRESENTATIVE
                     mock (P0)               (existing)      (real rule P2)     (numbers demo-only)
```

The whole arc is built to close **inside the on-screen window countdown** — that *is* the demo's payoff and the deck's thesis made literal.

---

## 7. Effort, dependencies, mock-vs-real breakdown

### 7.1 Phased effort

| Phase | Scope | New deps | Effort |
|---|---|---|---|
| **Phase 0 — self-contained mock-real** (ship this first) | `signals.json` + `SignalProvider` (Mock + inert Live) + `/signals/*` route + `buildSignalArc()` 3-beat encore + `#signal-feed` panel/countdown + `showMomentMab()` re-skin. Reuses existing Opal-mock suggest/publish + WebSocket + engine + MAB animation. | **None** (no external dependency; "real seams, mocked calls") | **~1–1.5 days** |
| **Phase 1 — real GENERATE via Opal chat** | Inject the signal as context to the Gemini Opal chat (doc 08); model writes the moment copy; approval-gated `createOptimizelyAudience`/`Flag`. | doc 08 shipped + **Gemini token** (already blocked-on-user) | **+0.5 day** (after doc 08) |
| **Phase 2 — real MAB rule** | Token-gated `multi_armed_bandit` FX rule (doc 09 §3.6) targeting the moment audience; edge reads datafile. | doc 09 shipped + **Optimizely token** + sandbox project | **+0.5–1 day** (after doc 09) |
| **Phase W — optional honesty-hardening** | Add **weather** as a genuinely-live second signal via free Open-Meteo (no key) so `LiveSignalProvider` is provably real for one type. | None (public API) | **+0.5 day** |

### 7.2 Mock-vs-real, per stage

| Stage | Phase 0 (now) | Phase 1 / 2 (real) | The line we will NOT cross |
|---|---|---|---|
| DETECT | Mock fixture, badged simulated | Still partner/mock (or **real** weather via Phase W) | Implying Optimizely ships a TikTok/Spotify listener |
| DECIDE+GENERATE | Intent-match + scripted copy | **Real** Gemini copy + drafted audience | Claiming Opal authors bespoke HTML/imagery |
| SERVE | **Real** (publish + WS + engine) | **Real** (datafile if FX) | — |
| OPTIMIZE (MAB) | Representative animation | **Real** `multi_armed_bandit` rule (token) | Live CMAB on FX (beta/access-gated) |
| MEASURE | Representative figures | Real apparatus, demo numbers | Proven lift on Coach's real traffic |

### 7.3 Files to add / touch (build hand-off)

- **Add:** `src/data/signals.json`, `src/connectors/SignalProvider.ts`, `src/routes/signals.ts`.
- **Touch:** `src/connectors/index.ts` (register SignalProvider under `CONNECTOR_MODE`), `src/index.ts` (mount `/signals`), `public/storefront.html` (`#signal-feed` panel + `#moment-mab` re-skin), `public/storefront.js` (`buildSignalArc()`, `showMomentMab()`, seed `runOpalStep()` from `signal.nlSeed`, encore button), `docs/PROJECT_LEDGER.md` (mark the stretch progressing).
- **Phase 1/2 only:** the Opal chat tools (doc 08 `src/agents/tools.ts`) gain a signal-aware system prompt; the doc-09 REST surface gains the `multi_armed_bandit` rule shape.

---

## 8. Skeptical flags — what we will NOT claim

- **Economic figures are narrative, not numbers.** 100x reach, 60% lower cost, 80/20 spend split (slide 2) are **Comprend's unsourced framing.** Never present them as Optimizely-measured. If shown, badge "Comprend POV — illustrative."
- **No native social-listening in Opal.** There is no out-of-the-box TikTok/Spotify velocity listener; DETECT is genuinely mocked and that's per the brief. The `LiveSignalProvider` stub is the honest "here's where a partner plugs in."
- **Autonomy is roadmap.** Slide 6 step 3 ("let small bets run without sign-off") contradicts today's draft-only/human-publish reality (North-Star landmine #2). We frame the human Publish as the governance beat and call autonomy the roadmap — explicitly, on screen.
- **CMAB on Feature Experimentation is beta/access-gated.** Keep MAB (or A/B) for any *real* rule; CMAB stays representative.
- **The velocity numbers are invented.** "+480% views/hr", "28-min window" are demo props. The *phenomenon* (a Coach bag going viral on TikTok with a short conversion window) is real-world plausible; the specific metrics are not measured. Label them.
- **"Within seconds" go-live has a propagation caveat.** If Phase 2 creates a real FX rule, datafile CDN propagation is seconds-to-~1min (doc 09 §6); drive the on-stage reveal off our own confirmed refetch, not a blind timer — and keep the mock path as the stage fallback.
- **Don't inflate the requirements checklist.** The 15 beats map to Coach's literal RFP list; the Signal-Led arc is an encore, kept separate so we never imply "trend-detection" was one of their asked-for line items.

---

## 9. Cross-references

- Source POV + the six signals + the abstracted loop: [`./comprend_signal_led_brief.md`](./comprend_signal_led_brief.md)
- Honesty tiers, MAB/CMAB GA status, draft-only governance, "real seams mocked calls": [`../Tapestry-Coach-North-Star-Brief.md`](../Tapestry-Coach-North-Star-Brief.md)
- Real Opal chat (Gemini + CF Agents SDK) that powers Phase 1 GENERATE: [`./08-opal-chat-plan.md`](./08-opal-chat-plan.md)
- The FX REST chain incl. the real `multi_armed_bandit` rule type + datafile consumption (Phase 2): [`./09-optimizely-api-plan.md`](./09-optimizely-api-plan.md)
- Connector pattern this clones (Mock + inert Live, one `CONNECTOR_MODE` flag) + the Opal suggest/publish seam: `src/connectors/`, `src/routes/operator.ts`, `src/data/insights.json`
