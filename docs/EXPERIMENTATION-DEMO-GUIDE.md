# Experimentation in the Demo — Presenter Walkthrough (A/B · MAB · CMAB)

_Plain-English: what it is, what you'll see, how to run it, what's real vs representative, and what (if anything) you need to do. Demo: Mon 2026-06-29._

## TL;DR — do I need to do anything?
**No setup.** It's deployed (dev worker) and wired into the demo. You present by clicking through the guided demo; the one button that creates a **real** experiment is **Launch** in the Revenue Radar tab. Nothing to configure. (Prod deploy is the other team.)

Storefront (dev): `https://edge-platform.expedge.workers.dev/storefront`

---

## Where experimentation lives on screen
Two surfaces, both in the right-hand sidebar:
1. **Revenue Radar tab** — the diagnose → recommend → **Launch** loop (this is where a *real* experiment gets created).
2. **Engine tab** — the A/B / MAB / CMAB **readouts** (the visual "results" panels), shown by guided beats 11–13.

---

## How the demo runs (automatic, or do I click?)
The demo is **self-driving + guided** via the **Demo Director** (top of the sidebar):
- Click **Start ▶**, then **Next** to advance **one beat at a time** — each beat narrates itself and runs its own actions/animations. No manual setup per beat.
- Or toggle **Auto-play** to advance automatically on a timer.
- When you land on **beats 11 / 12 / 13**, the Engine tab readout for that beat renders on its own.

So: **it's automatic per beat — you just advance.** The only thing you actively click for the "real artifact" payoff is the **Launch** button in Revenue Radar.

---

## What you'll SEE (visually)
- **Beat 11 — A/B test** (Engine tab): "Complete the Look · A/B test · ● RUNNING" with two bars (Control vs Personalized) + "+X% conversion · 96% confidence".
- **Beat 12 — MAB** (Engine tab): three bars where traffic **auto-shifts to the winner** across a few rounds ("traffic auto-allocating to the winner").
- **Beat 13 — CMAB** (Engine tab): "Contextual Bandit · winner per context · ● SERVING" — a **different winner per shopper-context** (Mobile Tabby-lover → Complete-the-Look; Desktop gifter → Gift edit; **Gen-Z at payment → BNPL**), each with a one-line reason. This one is backed by a live decision service.
- **Revenue Radar Launch**: after you click Launch, an inline "⚡ Experiment live — `<id>`" confirmation appears in the Radar card.

---

## What's REAL vs REPRESENTATIVE (say this on stage)
- **REAL:** the experiment **artifact** created when you click Launch — a genuine Optimizely **flag + rule** in the project, pullable in app.optimizely.com ("not a mockup"). The engine to create real **A/B, MAB, and CMAB** rules is built and verified live.
- **REPRESENTATIVE:** every **number** on the readouts (lift / allocation / confidence) — labeled "figures representative / illustrative". Real statistics need real traffic over time; we never claim proven lift on Tapestry's production traffic.

### The precise nuance (so you're never caught out)
- **A/B:** becomes a **real Optimizely experiment** the moment you click **Launch** in Revenue Radar (it calls our `POST /experiment/launch` seam → creates a real `a/b` flag/rule). Beat 11's Engine readout itself is representative.
- **MAB (beat 12) & CMAB (beat 13):** shown as **representative readouts** in the guided flow. The capability to create them as **real** Optimizely rules (`multi_armed_bandit` / `contextual_multi_armed_bandit`) is built and verified — you can create one live by asking **Opal** ("launch a CMAB experiment for Gen-Z"). The guided beats don't auto-create real MAB/CMAB rules unless we wire them to (optional).
- **Net:** out of the box the demo creates **one real experiment** (the A/B via Launch). MAB/CMAB are real-capable and shown representative; trigger a real one via Opal if you want to prove it in the Optimizely UI.

---

## Your presenter checklist
1. Open the storefront (link above).
2. **Demo Director → Start ▶ → Next** through the beats (or **Auto-play**).
3. In **Revenue Radar** → click **Launch** to create the real A/B experiment (watch the "Experiment live" confirmation).
4. *(Optional, for a real MAB/CMAB artifact)* open **Opal** and ask it to "launch a CMAB experiment for Gen-Z BNPL shoppers."
5. *(Optional proof)* open **app.optimizely.com** → the project → show the flag the Launch just created.

You do **not** need to: create events, configure anything, or deploy. (Events are auto-created by the launch code; deploy is the other team.)

---

## Known gaps / honesty notes
- Running on the **dev** worker; **prod deploy is the other team** (`edge-platform-prod`).
- Each Launch with writes enabled creates a **real flag** → test flags accumulate in the project (archivable in the UI).
- Minor: Revenue Radar's Launch currently sends the audience `conditions`, while the seam targets by `audienceId` — so the created A/B isn't audience-scoped yet. Works for the demo; can be tightened so the experiment targets the exact Gen-Z audience.
- `/__shot` is an internal verification route — gate/remove before prod.

_Strategy + per-type "why this type" rationale: `docs/EXPERIMENT-USE-CASES.md`. Cross-team coordination: `docs/MEMO-ab-cmab-handoff.md`._
