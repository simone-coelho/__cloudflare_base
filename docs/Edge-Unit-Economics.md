# Edge Unit Economics — Production Cost Model & Pricing Floors

**Audience:** INTERNAL — pricing, finance, sales leadership. Companion to the [Productization Roadmap](./Productization-Roadmap.md) and [GTM-Delivery-Playbook](./GTM-Delivery-Playbook.md) §7.
**The rule this document follows:** pricing is based on the **production architecture** — the system as we will ship it — and on nothing else. The demo build's costs appear once (§2) purely as context for why we re-architect; they are **not production costs and must never be used as a pricing basis.**
**Basis:** Cloudflare published pricing fetched 2026-07-20; every operation count traced through our code. Unit = one **engaged session**: a shopper browsing ~30 minutes, ~180 behavioral events, live connection throughout — the conservative bound (light 5-minute visitors cost ~1/10th; heavy 60-minute visitors ~2×).

---

## 1. The number that matters

**Production cost: ≈ $1 per 1,000 engaged sessions** (modeled $0.9–$1.2). Per monthly active visitor at one engaged session each: **about a tenth of a cent.** Costs scale linearly with traffic — no cliffs. Fixed base independent of volume: ~$5–50/month (platform plan + operations tooling).

| | Cost per engaged session | Per 1K engaged sessions | Per MAV (1 session/mo) |
|---|---|---|---|
| **Production architecture** | **~$0.0012** | **≈ $1.19** | **≈ 0.12¢** |

Everything else in this document explains where that number comes from and what it implies for price floors.

## 2. Context only: what the demo build costs, and why we're not shipping it

The system that won the demos was built for speed of iteration, not cost: shopper state rides key-value sessions (written every event), the WebSocket relay holds an always-billed connection for the entire visit, audience definitions are re-read from storage on every single event (~59 reads), and every action writes a row into a demo-capture database with six indexes. Run exactly that pattern in production and an engaged session costs **~$0.013 ($12.95/1K)** — dominated 43% by the redundant reads, 22% by the always-on socket, 14% by the per-event session writes, 10% by demo capture.

**None of that is architecture we intend to operate.** Each line is a known artifact of the demo build with a designed replacement (§3). These figures exist in this document for one reason: so nobody ever quotes them, and so the re-architecture's value is legible.

## 3. The production architecture (what we will do — per the roadmap)

Four changes, all designed, one already built:

1. **Per-shopper hibernating objects** *(built — roadmap W2 flips it on)*: each shopper's state and socket live in one edge object that **hibernates between events** — Cloudflare bills active compute only, so "hold a live object per shopper for 30 minutes" costs a rounding error (~$0.09/1K), not $2.81. This also removes the per-event session writes and the relay hop entirely.
2. **In-process audience caching** *(roadmap W2)*: audience definitions load once per running instance and refresh on a version marker — ~59 storage reads per event become ~1. The single biggest cost and latency fix.
3. **Production telemetry store** *(roadmap W3)*: demo capture (D1, 10GB cap) is **replaced**, not tuned — events flow to the production store chosen in W3 (recommended: Neon/Postgres via Hyperdrive, which also becomes the outcome-learning aggregation store). Its cost is metered on that platform and carried as its own line (§5), off the Cloudflare bill.
4. **SDK event coalescing** *(roadmap W5, where useful)*: batching client events further divides request-linked costs; not required to hit the §1 number.

## 4. The production cost model

Per 1,000 engaged sessions, production architecture — the full Cloudflare bill:

| Line | What it is | $/1K |
|---|---|---|
| Per-shopper object writes | affinity state + timers (SQLite rows) | $0.55 |
| Requests + compute | ingest requests, CPU, alarm wakeups | $0.19 |
| Residual storage reads | config/marker checks | $0.09 |
| Object active-time | compute-only, hibernating between events | $0.09 |
| Wakeup re-reads, misc | | $0.27 |
| **Total (Cloudflare)** | | **≈ $1.19** |

Scenario range: light session ≈ $0.10–0.15/1K-equivalent; heavy ≈ $2–2.5/1K.

**Monthly at scale — strictly linear** (all-engaged worst case, at the $1.19/1K marginal rate):

| Sessions/month | Marginal cost | Billed (after included allotments + $5 plan) |
|---|---|---|
| 10,000 | ≈ $12 | **≈ $5–6** — the paid plan's included allotments absorb nearly all of it |
| 100,000 | ≈ $119 | ≈ $100–110 |
| 1,000,000 | ≈ $1,190 | ≈ $1,150–1,190 |

Read the shape correctly: **per-session cost is constant — there is no volume discount in this model.** The only non-linearity is at the *small* end, where Cloudflare's included monthly allotments (50M database rows, 10M requests, etc.) swallow most of a 10K-sessions month; past those, cost converges to the flat marginal rate and scales exactly linearly. Storage: ~5 KB per shopper, 30-day retention, inside included tiers to ~1M monthly shoppers.

What dominates in production: nothing, meaningfully — the largest line is 55¢ per thousand half-hour sessions. The architecture is deliberately shaped so cost is a non-issue in commercial conversations.

## 5. Separate lines (not in the §4 number, priced on their own platforms)

- **Production telemetry (W3 store):** metered on the chosen database platform (e.g., Neon). Off the hot path, batched — expected small; quantified when W3 is decided.
- **Generative-AI surfaces (Google/Gemini):** scene imagery is generated once per scene and cached (per-*new-scene* cost, not per-view); search/concierge are per-use of optional surfaces. Quantify against current Google pricing before bundling those surfaces into a tier.
- **Optimizely platform (ODP, FX):** contract entitlements, not infrastructure cost.

## 6. Pricing floors (production basis — the only basis)

Floors = COGS ÷ (1 − target margin), engaged-session profile:

| Basis | COGS | 70% GM floor | 80% GM floor | 90% GM floor |
|---|---|---|---|---|
| Per 1,000 engaged sessions | $1.19 | **$3.95** | **$5.93** | **$11.85** |
| Per monthly active visitor | $0.0012 | 0.4¢ | **0.6¢** | 1.2¢ |

Any plausible price point clears these floors by orders of magnitude — meaning **price will be set by value and competitive positioning, not by cost**. That is the strategic takeaway for the pricing team. Three packaging shapes to weigh (their call, one line each): **per monthly-tracked-visitor** (simplest, matches how CDP pricing reads); **per 1K sessions** (most cost-true, needs a session definition in contract); **platform fee + usage tiers** (floor protection at low volume, upside capture at high). Add a platform minimum (~$5–50/mo) independent of volume.

## 7. Caveats

Re-verify Cloudflare prices before major commitments (cloud pricing moves; basis date 2026-07-20). Two bounded uncertainties: Analytics Engine has published rates but bills $0 today (immaterial either way); object row-accounting for multi-KB values is unspecified in docs (worst case adds ~$0.55/1K). The W3 telemetry line and the Gemini line close when those decisions land. All operation counts trace to specific code paths in the underlying analysis; finance can re-derive every figure.
