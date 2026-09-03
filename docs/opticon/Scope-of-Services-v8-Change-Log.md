# Scope of Services v8: what changed, and where

Companion to `Tapestry_Scope_of_Services_v8_tracked.docx`. Every change is a Word tracked change by
"Optimizely Delivery" and can be accepted or rejected individually. Five requests, 31 edits.

| Nitin's request | Where it landed |
|---|---|
| **1.** §1.1 says first-party only; reflect that historical and other data, via Snowflake or a provider such as Merkle, will be supported | §1.1 rewritten and §1.12 extended |
| **2.** §2.1 and §2.2 need tighter definitions with per-page examples | Two paragraphs added to §2.1, one to §2.2, plus the milestone boundary test |
| **3.** §3.2 "Delivered" only tests Content Personalization | §3.2 split into two named definitions |
| **4.** Make autonomy explicit per capability, with a roadmap for autonomous tuning | Autonomy note on all 14 capabilities, a three-state lead-in, and a new §2.4 |
| **5.** §1.11 says "will be enhanced" inside a section headed available on signature | §1.11 rewritten in present tense, integration pointed at D4 |

## The five, in detail

**1 · Third-party and historical data.** §1.1 previously ended "No fingerprinting, nothing acquired from
outside Tapestry," which both foreclosed Merkle and contradicted §1.12, where CSV, S3 and REST ingestion
were already in scope. It now says the *in-session profile* is first-party by construction, and points at
§1.12 for everything external. §1.12 then names third-party attribute files explicitly, with the two
conditions that actually govern feasibility: a stable identifier that resolves to a visitor, and a
documented meaning per field. Usage rights for purchased data are placed with Tapestry.

**2 · Content versus Experience.** Both sections keep their existing text and gain worked examples on the
two page types he named. On a homepage the slots are the modules; on a product page they are the imagery
set and the modules below the buy box, where on-model leads on a first visit and silo, zoom, detail and
fit lead on a return. §2.2 closes with the test that makes the milestones separately acceptable: same
order with different content is Content delivered; a different order as well is Experience delivered.

**3 · Two delivery definitions.** "For both contractual milestones" became "separately for each." The
existing definition is now labelled Content Personalization, a parallel Experience Personalization
definition sits beside it, and the shared closing line reads "In each case." Both retain *weights
live-tunable by your team*.

**4 · Autonomy.** Section 1 opens with the three states used throughout: autonomous, human-configured,
human-approved. Each of the twelve §1 capabilities and both §2 capabilities then carries an **Autonomy.**
note in the same style as **What this lets you do.** His own example is confirmed directly: content is
decided and served autonomously, and module order is decided and served autonomously. A new **§2.4
Roadmap for Autonomous Optimization** gives the three learning stages, names the gate on stage two as
data volume rather than engineering, and closes with the line worth keeping in the contract: no model
runs on the decision path at any stage.

**5 · Custom product sort.** The old sentence conflated a capability with an integration, which is why it
read as future tense inside a present-tense section. It now describes the ranking capability in present
tense and sends the commerce connection to the integration window in §3.1 against dependency D4, which
already exists in the document as "Product feed access." No new milestone was needed.

**Also filled (2026-09-02):** the "launch brand" field at the end of the appendix now reads *Coach*, as a tracked change, per Mandeep's decision.

## Two things worth a sentence in the covering note

- **Third-party data was not in the original scope.** It is being added because it costs the engine
  nothing, not because it was previously agreed. Say so once, plainly, so nobody later reads v8 as a
  correction of v7.
- **§1.11 was a real defect on our side**, and naming it as such is cheap credibility with a reviewer who
  is clearly reading for tense.
