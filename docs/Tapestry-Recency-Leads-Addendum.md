# Addendum to the Solution & Algorithm document — Recency leads, accumulation gates

**Status:** DRAFT for Simone's review. Not sent. Decided 2026-08-28 during the Opticon build; this is an **addition** to the algorithm as currently documented, not a clarification of it.

---

## What the documented algorithm does today

Every value in a dimension is an independent accumulator with the same decay:

```
R[d][v] ← R[d][v] · e^(−Δt/τ_d) + w_action
a[d][v] = R[d][v] / (R[d][v] + K_d)
```

The value that leads a dimension — the one that drives slot decisions — is the value with the highest `a`. The documented treatment of a shopper who changes direction is decay alone (doc 16, worked example): *"if she'd wandered to totes instead of idling, her tote accumulator would rise on the same math while Tabby decayed — she'd exit Tabby Affinity and enter Tote Affinity."*

## The weakness that surfaces in practice

Accumulation and leadership are the same number. So a shopper who clicks three pieces from one line and then clicks one piece from a different line is still led by the first line until decay catches up — at the documented τ that is on the order of a minute. The page keeps recommending what she has just, visibly, moved away from. That is precisely the failure a merchandiser would point to first, and it is a property of the algorithm rather than of its tuning.

## The addition

Separate the two questions the score was answering at once:

- **Membership** — is she in the audience? — stays exactly as documented: `a ≥ θ_in` to enter, `a < θ_out` to leave, hysteresis in between. Three clicks on one line put her in that line's audience and she remains in it until it decays out on its own.
- **Leadership** — what does the page follow *right now*? — for a dimension flagged `leadBy: recency`, the lead is the **most recently touched value**, not the highest-scoring one. One click on a different line and the page follows the new line.

In the per-slot scoring `s = Σ_d ω_d · a_d · m_d`, the recency lead contributes its full `a`; every other value in that dimension contributes `a × trailing`, where `trailing` is a per-dimension parameter (default 0.25). The old line therefore still ranks — weakly — rather than vanishing, and the explain record states which value led and why (`lead: recency`).

## Where it applies, and where it must not

The rule is for **single-valued behavioural dimensions** — a product is one line, one category, one silhouette. It must not be applied to multi-valued dimensions (occasion, needs) where co-membership is the meaning, nor to context facts (visit number, channel) which are not scores at all.

## Tuning

Two new rows in the parameter catalogue, per dimension, versioned and applied hot like every other row: `leadBy ∈ {score, recency}` (default `score`, i.e. the documented behaviour) and `trailing ∈ [0, 1]` (default 0.25). Setting `leadBy: score` reproduces the current document exactly, so nothing already agreed changes unless it is switched on.

## What this changes in the documents

- Solution & Algorithm (`content-personalization-design-tapestry.html`): add the leadership/membership distinction to the scoring section, and the two parameters to the tuning table.
- System Architecture (`Tapestry-BTI-System-Architecture.md`): one row each in the parameter catalogue (§ tuning) and a sentence under the per-slot formula.
- No change to the Implementation Plan's milestones; this is inside the existing tuning workstream.

## Honesty note for the Opticon session

The demo will show this behaviour. If asked whether it is in the Tapestry design as sent, the answer is: *"It is an addition we made while building this — the documented version decays out over a minute; this follows her on the first click. It is a single tunable rule and it is going into the design document."*
