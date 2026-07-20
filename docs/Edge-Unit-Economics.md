# Edge Unit Economics — Cost Model & Pricing Floors

**Audience:** INTERNAL — pricing, finance, sales leadership. Companion to [GTM-Delivery-Playbook.md](./GTM-Delivery-Playbook.md) §7.
**What this is:** the cost foundation — what the edge layer costs *us* per visitor, verified against Cloudflare's current published pricing (fetched 2026-07-20) and traced call-by-call through our own code. **What this is not:** a price. Margin floors and packaging options are inputs; the pricing/marketing teams decide.
**Scope:** Cloudflare infrastructure only — the layer *we* build and operate. Optimizely product calls (ODP, FX) cost nothing on the Cloudflare side (subrequests/egress are free) and live on the Optimizely contract. Generative-AI model spend is a separate line (§7).

---

## 1. The headline numbers (plain language)

The unit that matters is **one engaged shopper session**: a visitor browsing ~30 minutes, sending a behavioral event every ~10 seconds (≈180 events), holding a live connection throughout. What that session costs us:

| Architecture | Cost per engaged session | Per 1,000 engaged sessions |
|---|---|---|
| **Today** (session-hosted state) | $0.0130 | **$12.95** |
| **After the P2 cutover** (per-shopper hibernating object) | $0.0073 | **$7.28** — 44% cheaper |
| **Optimized** (P2 + the two cheap fixes in §5) | $0.0012 | **≈ $1.19** — ~10× cheaper |

For intuition at the edges: a **light** 5-minute visitor costs roughly a tenth of an engaged one; a **heavy** 60-minute visitor roughly double. Monthly, at an all-engaged worst case: ~**$100/mo at 10K sessions, ~$1,225 at 100K, ~$12,880 at 1M** on today's architecture — roughly halving after the cutover, and an order of magnitude lower optimized. Fixed base regardless of volume: ~$5–50/month (platform plan + internal verification tooling).

Three sentences of context for non-engineers: the costs scale **linearly with traffic** (no cliff); the biggest single cost turned out to be something we can fix with a small code change, not a structural property (§5); and the already-built P2 architecture is not just faster — it is **the cheaper way to run this**, which turns an engineering upgrade into a margin decision.

## 2. What we pay for (bill of materials)

Every component below is **ours** — none is an Optimizely product:

| Component | Role in plain words | Billed by |
|---|---|---|
| Workers (+$5/mo plan) | the edge compute answering every shopper action | requests + CPU-ms |
| Durable Objects — `ShopperReflex` (P2) | one small stateful object per shopper: their live scores, their socket, their timers; **hibernates** between events | requests, active-time, stored rows |
| Durable Objects — relay + agent + utility (4 classic) | today's WebSocket relay (always-on while connected — the expensive kind), the operator chat agent, rate-limit/state utilities | requests, wall-clock time, storage |
| KV (two namespaces) | the audience definitions/config cache + (today) each shopper's session state | reads, writes, lists, GB |
| D1 (SQL database) | the demo dataset + one row captured per shopper action | rows read/written, GB (**10 GB/db cap**) |
| R2 + Queues | generated imagery storage + the async generation pipeline | GB, ops (≈$0.005 per new scene; negligible) |
| Analytics Engine | metrics (published rates exist; **Cloudflare bills $0 today**) | data points |
| Browser Rendering | internal visual verification only — ops cost, not per-visitor | browser-hours (~$0 under included tier) |

## 3. Price basis

All unit prices fetched 2026-07-20 from developers.cloudflare.com pricing pages (Workers, Durable Objects, KV, R2, Queues, D1, Analytics Engine, Browser Rendering). Marginal overage rates used throughout; included monthly allotments netted out in the billed totals. Load-bearing facts worth knowing: Workers bill CPU-time not wall-clock; DO WebSocket *incoming* messages bill at a 20:1 ratio and outgoing are free; and the sentence the whole P2 business case turns on — classic `accept()` sockets bill **wall-clock for the entire connection**, while hibernation-eligible objects **are not billed for duration at all** between events.

## 4. The cost model

Per-session and per-1K costs, three traffic profiles, both architectures (every operation count traced to a file/line in the underlying report; assumptions: ~25–33% of events change state and trigger a push; ODP loop live; mock decisioning — live FX adds only free subrequests + CPU):

| Profile | Today (session) | P2 (DO) |
|---|---|---|
| Light — 5 min, 15 events | $1.34 / 1K | $0.68 / 1K |
| **Engaged — 30 min, 180 events** | **$12.95 / 1K** | **$7.28 / 1K** |
| Heavy — 60 min, 400 events | $28.00 / 1K | $16.05 / 1K |

**Where the engaged dollar goes (per 1K sessions):**

*Today:* KV reads **$5.60 (43%)** · always-on relay socket time **$2.81 (22%)** · KV session writes $1.81 (14%) · D1 event capture $1.26 (10%) · KV list ops $1.13 (9%) · everything else ≈ $0.34.
*P2:* KV reads **$4.36 (60%)** · D1 capture $1.26 (17%) · KV lists $0.92 (13%) · object storage writes $0.55 (8%) · **object active-time $0.09 (1%)** — hibernation reduces the "keep a live object per shopper for 30 minutes" cost, the intuitive scary number, to a rounding error.

**Storage at scale:** shopper state is ~5–7 KB held ≤30 days → inside included tiers up to ~1M monthly shoppers, then cents/GB. The exception is §6's D1 flag.

## 5. What actually drives cost — and the levers

**The discovery:** the #1 cost is not compute or sockets — it's **audience-definition read amplification**. Every event, in both architectures, re-reads every audience definition from KV individually (~59 reads + a premium list op per event) instead of using the in-memory cache invalidated by the version marker that *already exists* for exactly this purpose. That's 43–60% of all COGS, and it's a small code change.

| Lever | What it is | Saves (per 1K engaged) |
|---|---|---|
| **A — cache audience defs in-process** (invalidate on the existing version marker) | small code change | **$5–6** in both modes |
| **B — the P2 cutover** (hibernating per-shopper objects) | flip the flag we already built | **$5.67 (−44%)** vs today |
| **C — trim `demo_events` indexes** (6 → 1–2) / production telemetry design | migration | ~$0.90 |
| D — client event coalescing (~3:1) | SDK option | further ~2–3× on residuals |

**The P2 business case, now in dollars:** today's architecture *floors* at ~$6.9/1K even after Lever A (its per-event session writes and always-on relay time are structural); P2 with levers A+C reaches **~$1.19/1K**, with a true floor near **$0.9–1.2** once demo-only capture is replaced by production telemetry. The cutover is simultaneously the performance upgrade, the scale-correctness fix (it removes a per-key write-rate ceiling on sessions), and a ~10× COGS reduction. It should be scheduled as a margin decision, not just an engineering one.

## 6. Red flags before any at-scale commitment

1. **`demo_events` cannot ride to production scale.** An engaged session writes ~130 KB to D1; at 100K sessions/month that accrues ~13 GB/month against a **10 GB per-database cap**. It's demo capture by design (resettable) — it must be pruned, batched, or replaced with a production telemetry design before any 100K+/month commitment. (Tracked as engineering follow-up.)
2. **Two pricing uncertainties, both bounded and immaterial today:** Analytics Engine is published-but-unbilled (modeled at published rates: pennies); DO row-accounting for multi-KB values is unspecified in docs (worst case adds ~$0.55/1K in P2 mode).

## 7. The generative-AI surfaces (separate line, external spend)

The shopper AI features (intent search, concierge, scene imagery) are billed by the model provider (Google), not Cloudflare, and are **structurally cheap by design**: scene images are generated once and cached in R2 (repeat views cost ~nothing on our side; generation is a per-*new-scene* cost, not per-view), and search/concierge are per-*use* of optional surfaces, not per-event. **Open item for finance:** quantify per-session model spend against current Google pricing before bundling these surfaces into a priced tier — they should carry their own line in any package that includes them.

## 8. Margin floors and packaging options (inputs — the teams decide)

Floors = COGS ÷ (1 − target margin), on the **engaged** profile (the conservative bound — real traffic mixes run cheaper):

| Per 1,000 engaged sessions | COGS | 70% GM | 80% GM | 90% GM |
|---|---|---|---|---|
| Today (ship as-is) | $12.95 | $43 | $65 | $130 |
| After P2 cutover | $7.28 | $24 | $36 | $73 |
| Optimized (P2 + A + C) | $1.19 | **$3.95** | **$5.93** | **$11.85** |

Per **monthly active visitor** (at one engaged session each): COGS of 1.3¢ / 0.7¢ / 0.12¢ → 80%-margin floors of **6.5¢ / 3.6¢ / 0.6¢ per visitor per month**. Add a platform minimum (~$5–50/mo fixed base) independent of volume.

**Three packaging shapes for the pricing team to weigh** (one line each, no recommendation): **per monthly-tracked-visitor** — simplest to sell, matches how ODP/CDP pricing already reads, absorbs session-length variance; **per 1K sessions** — most cost-true, meters exactly what we pay for, needs session definition in the contract; **platform fee + usage tiers** — protects the floor at low volume, captures upside at high volume, most contract complexity. All three clear the optimized floor by wide margins at plausible price points; the strategic question is positioning against what customers currently pay for the competitor products this displaces — which is the teams' territory, not this document's.

## 9. Method

Every operation count in §4–§5 was traced to specific code paths (routes, engine, store, DO) in the underlying analysis; every unit price quoted from Cloudflare's published pages on the verification date; all assumptions (event rates, changed-event share, active-time per event, alarm counts) labeled and sensitivity-tested where they matter. Finance can re-derive any line. Re-verify prices before major commitments — cloud pricing moves.
