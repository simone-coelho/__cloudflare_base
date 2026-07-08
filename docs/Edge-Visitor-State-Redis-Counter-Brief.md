# Edge Visitor State — the "Redis Counter" Use Case (Brief)

**Audience:** AE / SA / CSM (Mike, Christian) — for the scoping & roadmapping session.
**Context:** the customer runs **Redis next to ODP** to track per-visitor behavioral state — e.g., *"has this visitor seen this page three times?"* — because ODP ingests the events but offers no instant, decision-time counter/threshold primitive. They built the missing layer themselves.

---

## The requirement, decomposed

| # | Requirement (their words → ours) | Their Redis today |
|---|---|---|
| R1 | **Per-visitor counters** over behavioral events ("page seen 3×") | `INCR` per visitor+key |
| R2 | **Instant, in-memory reads at decision time** ("alive in memory… immediately respond") | Redis `GET` |
| R3 | **Events still flow to ODP** — the side-store compensates, never replaces | dual-write from their servers |
| R4 | **Threshold awareness** — know the *moment* a counter crosses | app code checks/polls |
| R5 | **A client integration surface** (event listener / handler — their open question) | custom |
| R6 | **Start-from-zero onboarding path** (start now → scoping call → roadmap) | n/a |

## Why our edge engine answers this natively

**A counter is the degenerate case of our affinity scoring.** Our accumulator is `R ← R·e^(−Δt/τ) + w`; with no decay and weight 1, that *is* `INCR` — so the Redis use case is a strict subset of what's already running.

- **R1/R2 — the visitor-state layer:** every client connects to a **per-visitor Durable Object at the edge** — the visitor's live state in memory, persistence underneath, fed by proxied events. Counters and numeric thresholds (`gte`) are evaluated by the same machinery that runs our affinity audiences; per-specific-page counters are configuration of the same accumulation seam. Optional bonus Redis can't offer cleanly: counters that **decay** ("seen 3× *recently*").
- **R3 — the ODP loop, done right:** the edge proxies events, keeps the live state, and forwards the **raw facts to ODP**. Facts to ODP; derived state at the edge. ODP remains the durable memory and system of record.
- **R4 — push, not poll:** threshold crossings are **pushed the instant they happen** (and decay-exits are computed in closed form). "When this segment has been counted" becomes an event, not a query.
- **R5 — exposure menu** (the scoping-call decision; same engine under all four):
  (a) **WebSocket listener** — subscribe to state/threshold events;
  (b) **HTTP snapshot** — GET current counters/memberships for a visitor;
  (c) **webhook/callback** on threshold-cross;
  (d) **attributes injected into `decide()`** / their edge middleware.

## Versus running Redis themselves

No infrastructure to run or scale · state **co-located with decision logic** (no app-server→Redis hop) · per-visitor isolation by construction · **global** (the object lives near the user; Redis is typically regional) · retention/erasure lifecycle built in · every threshold-cross **explains itself** · feeds ODP natively instead of a custom dual-write.

## Status framing (honest)

The counting / threshold / push mechanism is **live in beta today**; the per-visitor object hosting is in **final hardening**. Christian's framing stands: *start immediately; shape the integration surface (R5) in the roadmapping session.*

## Strategic note

This is the **third customer independently improvising the same missing layer** — HD Supply (deterministic content resolver), Coach (DY-style affinity), and now Redis counters. All three are one product: **real-time, per-visitor behavioral state + decisioning at the edge, with ODP as the durable memory.**

---

*Companions: [Technical Design](./Edge-Affinity-Reflex-Technical-Design.md) · [ODP Wiring Spec](./Coach-ODP-Wiring-Spec.md)*
