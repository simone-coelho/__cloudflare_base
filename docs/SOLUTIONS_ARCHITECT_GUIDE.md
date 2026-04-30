# Solutions Architect Guide

**Audience:** Optimizely Solutions Architects demoing this platform internally or to prospects.
**Goal:** Give you everything you need to run a credible 15–30 minute demo without reading the rest of the docs.

---

## 1. What this is, in one paragraph

This repo is a **Cloudflare Workers** edge platform that demonstrates **real-time personalization powered by Optimizely**. A visitor's behavior (email open, form fill, page visit) is sent to a Worker at the edge, segmented in milliseconds via Durable Objects, and pushed back to the page over a WebSocket — so the UI reacts to what the visitor is doing **as they do it**, with no full-page reload and no round-trip to a CDP. It's a working application, not a mockup.

---

## 2. Two demos ship in this repo — know the difference

There are **two separate demo surfaces** served by the same Worker. Show the right one to the right audience.

| | Visual Demo (customer-facing) | Internal Diagnostic View |
|---|---|---|
| **URL** | `http://localhost:9100/visual-demo.html` | `http://localhost:9100/` |
| **Branding** | First National Bank | Generic "Optimizely Edge Platform" |
| **What it looks like** | Polished retail-bank website with an email inbox, homepage, and contact form | Dashboard of panels: connection status, segments, engagement score, event log |
| **Use for** | Prospect calls, executive demos, anything customer-facing | Internal SA enablement, debugging, showing the *mechanics* under the hood |
| **Strength** | Tells a story. The visitor sees personalization happen on a real-looking site. | Shows the wires. You can watch segments flip and events arrive in real time. |

**Recommended demo flow:** lead with the **Visual Demo** for the story, then switch to the **Internal View** for technical deep-dives ("here's what was actually happening behind that page").

---

## 3. Five-minute setup

### Prerequisites
- Node.js 18+
- `npm install` already run (it has been on this machine — check `node_modules/`)

### Start it

```bash
npm run dev
```

Wrangler boots the Workers runtime locally on **port 9100**. It serves both the API routes and the static demo pages from `public/`.

### Verify

```bash
curl http://localhost:9100/health
```

You should get `{"status":"healthy",...}`. If you do, both demos are live:

- Visual demo: <http://localhost:9100/visual-demo.html>
- Internal view: <http://localhost:9100/>

That's the whole setup. No database, no separate frontend server, no Cloudflare account needed for local demos.

---

## 4. Visual Demo — talk track (the one you show prospects)

Open `http://localhost:9100/visual-demo.html`. The page has three tabs across the top.

### Opening line
> "This is a fictional retail bank. What you're about to see is the bank's own website — except every interaction the visitor has is being scored, segmented, and personalized at the Cloudflare edge in real time, by Optimizely. No page reloads."

### Tab 1 — Email Journey
A simulated inbox with three marketing emails: **Mortgage**, **Investment**, **Credit Card**.

1. Click **Open Email** on *Mortgage*.
2. Point out the visitor info panel updating — engagement score climbs, a `mortgage_interested` segment appears.
3. Click **Open Email** on *Investment*. Watch the segment set evolve.
4. Open the *Credit Card* email and let the bank homepage load — note how the **hero banner and product tiles have already adapted** to the visitor's interests. That's the personalization the segment engine just decided.

> "Every email open fired a tracking pixel to the Worker. The segment engine on the edge re-evaluated this visitor's profile, decided which segments they now belong to, and pushed a new personalization payload back over the open WebSocket — all in under 50ms."

### Tab 2 — Form Journey
A standard contact form.

1. Fill in name, email, select a product of interest, submit.
2. Engagement score jumps; a `lead_qualified` segment appears.
3. Switch back to the Email or Browse tab — the page now treats the visitor as a known lead.

> "Form submission is the classic 'identify' moment. We just turned an anonymous visitor into a known prospect, attached their interests, and updated every other surface they touch — instantly."

### Tab 3 — Browse Journey
Five visitor actions: **View Pricing**, **Use Calculator**, **Compare Products**, **Read Blog**, **Start Application**.

1. Click *View Pricing* and *Use Calculator* — engagement score builds, intent segments fire.
2. Click *Start Application* — the visitor crosses into a high-intent segment, and the UI typically shifts to a more conversion-focused presentation.

> "This is where the segment engine earns its keep. We're not waiting for a nightly batch job in a CDP — every click reshapes the experience for the rest of the session."

### Closing line
> "What we just demoed is fully running on Cloudflare's 300+ edge locations. Same code, same architecture, single-digit-millisecond decision time worldwide."

---

## 5. Internal Diagnostic View — what to show technical audiences

Open `http://localhost:9100/`. This is the SA's debugging surface. Six panels:

1. **Connection Status** — WebSocket state, session ID, user ID. Use this to prove real-time connectivity.
2. **Current Personalization** — active segments and engagement score. Flashes green when an update arrives.
3. **Demo Actions** — fire individual events (`Email Open`, `Form Submit`, `View Pricing`, `Demo Request`) or run pre-scripted **journey scenarios** (Email Engagement, Lead Qualification, E-commerce, Content, Mobile App, Re-engagement).
4. **Session Metrics** — duration, event count, segment count.
5. **Event Log** — every event sent and every personalization payload received. This is the panel to read out loud during a deep-dive.
6. **Custom Event** sender — for ad-hoc demos.

**When to use this view:**
- Showing a partner engineer how the WebSocket protocol works.
- Walking through what an event payload looks like end-to-end.
- Demonstrating the journey scenarios (great for solo prep — they automate a sequence so you can watch segmentation evolve).
- Verifying the platform is healthy before a customer call.

---

## 6. Architecture at a glance

```
Visitor Browser
     │  (HTTP events + WebSocket)
     ▼
Cloudflare Worker  ─── KV (sessions/cache)
     │              ─── R2 (assets)
     │              ─── Analytics Engine (metrics)
     ▼
Durable Objects
   ├── PersonalizationWebSocket  ← pushes updates back to the page
   ├── StateManager              ← per-visitor state at the edge
   └── RateLimiter
     │
     ▼
Optimizely Feature Experimentation
   (feature flags, experiments, audience targeting)
     │
     ▼
Event Dispatcher → Segment / Amplitude / Mixpanel / custom webhooks
```

**Three things to emphasize when this slide is up:**
1. **State lives at the edge.** Durable Objects mean we don't need a central database round-trip to know who this visitor is.
2. **Optimizely is the decision engine.** Feature flags and experiments are evaluated on the edge using Optimizely's SDK — full A/B and audience targeting capability.
3. **One Worker, many channels.** The same edge platform serves web, mobile, and email-pixel events through the same segmentation pipeline.

For the full architecture deep-dive, see `COMPLETE_ARCHITECTURE_DOCUMENTATION.md` in the repo root (42KB; for the technical buyer, not the call).

---

## 7. Pre-demo checklist

Run through this **5 minutes before** the call:

- [ ] `npm run dev` is running and you've seen "Ready on http://localhost:9100".
- [ ] `curl http://localhost:9100/health` returns `healthy`.
- [ ] Open `http://localhost:9100/visual-demo.html` in a fresh browser window. Click **Open Email** on one email — confirm the segment panel updates.
- [ ] Open `http://localhost:9100/` in a second tab. Confirm the connection dot is **green**.
- [ ] If you'll show the architecture, have `COMPLETE_ARCHITECTURE_DOCUMENTATION.md` open in a separate window.
- [ ] Close noisy browser tabs and notifications (this *will* be screen-shared).

---

## 8. Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| `npm run dev` fails with port-in-use | Port 9100 occupied by an old wrangler | `lsof -ti:9100 \| xargs kill -9` then retry |
| WebSocket dot is red | Dev server restarted; page has stale connection | Refresh the demo page |
| Optimizely decisions return defaults | `OPTIMIZELY_SDK_KEY` in `wrangler.toml` is a placeholder | Demo still works — segmentation is local. Only matters if you specifically need to show a live Optimizely experiment. |
| KV errors on first run | Placeholder KV namespace IDs in `wrangler.toml` | Wrangler simulates KV locally; usually harmless. For a real Cloudflare deploy, replace with real IDs from the Cloudflare dashboard. |
| Segments not updating | Backend received the event but WebSocket dropped | Check the Internal View event log; reconnect WebSocket via the panel button |

---

## 9. FAQ — likely customer questions

**"Is this production-grade or a prototype?"**
The architecture is production-grade — Cloudflare Workers, Durable Objects, and Optimizely's SDK are all production technologies running this exact pattern at large companies. This specific repo is a reference implementation for demos and customer foundations; it's a starting point, not a finished product.

**"What's the latency story?"**
Cloudflare Workers run within ~50ms of 95% of internet users. Durable Objects co-locate visitor state with the Worker. Personalization decisions are typically single-digit milliseconds end-to-end inside the edge.

**"Can this run alongside our existing CDP / analytics?"**
Yes — the `EventDispatcher` service forwards events to Segment, Amplitude, Mixpanel, and arbitrary webhooks. The edge platform is additive: it gives you sub-second personalization without replacing your data warehouse pipeline.

**"How does this work without cookies / with consent regulations?"**
Sessions are keyed by an anonymous ID stored in localStorage or a first-party cookie. Identification (form submit, login) merges anonymous and known profiles. Consent gating is a configuration concern that lives in the integration layer — not in scope for this demo, but straightforward to add.

**"What does Optimizely specifically bring vs. building this ourselves?"**
The decision engine — feature flags, audience targeting, statistical experimentation, and the management UI for non-engineers to run campaigns. The edge platform is the delivery mechanism; Optimizely is what marketing and product teams actually use to drive it.

---

## 10. Going deeper

If a question goes past this guide, here's where to send the technical buyer:

| Topic | File |
|---|---|
| Full architecture, every component | `COMPLETE_ARCHITECTURE_DOCUMENTATION.md` |
| Real-time personalization design | `REAL_TIME_PERSONALIZATION_ARCHITECTURE.md` |
| Setup detail for engineers | `docs/guides/01-quick-start.md` |
| REST API reference | `README.md` (root) — API Documentation section |
| How the demo works internally | `docs/DEMO_EXPLANATION.md` |
| Deploying to Cloudflare | `README.md` Deployment section + `scripts/deploy.sh` |
| Optimizely-specific configuration | `docs/OPTIMIZELY_SETUP.md`, `docs/optimizely-setup-instructions.md` |

---

## 11. One-page cheat sheet

```
START:        npm run dev
VISUAL DEMO:  http://localhost:9100/visual-demo.html   (show prospects)
INTERNAL:     http://localhost:9100/                   (show engineers)
HEALTH:       curl http://localhost:9100/health
KILL PORT:    lsof -ti:9100 | xargs kill -9

VISUAL DEMO TABS: Email Journey | Form Journey | Browse Journey
INTERNAL JOURNEYS: Email Engagement | Lead Qualification | E-commerce | Content | Mobile | Re-engagement
```
