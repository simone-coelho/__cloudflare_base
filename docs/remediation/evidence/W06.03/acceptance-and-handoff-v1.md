# W06.03 acceptance and handoff

Accepted by `w01-lead` (`/root`) at 2026-09-08T15:41:00Z after independent `w0602-reviewer` PASS C1–C3. Artifact `0d3c5ff5ec4f018f318d35febba8ae5d13a2bfb2da3e045625d80c5bbbb24bcb`; admitted plan and contract unchanged.

Implemented: the physical ledger rewrite now enforces its positive integer object cap inside a dense day and persists tenant/day/tombstone-bound progress. Each mutation has a durable before/after intent; restart reconciles exact object state, advances one cursor/credit checkpoint and applies absolute per-target totals, so ambiguous failures neither skip objects nor double-count removal. `done_through` advances only after the complete day, all target anchors are installed before ledger mutation, later cutoffs wait for active recovery, and corrupt, missing or conflicting recovery state fails closed.

Evidence: worker exact K1 passed 20/20 on its first run, app `tsc --noEmit`, scoped two-file diff and whitespace checks passed. The independent reviewer inspected actual before/final source, assertions, complete worker output, the 40 frozen pins and exact 18-input local graph, then ran exact K1 once: 20/20 in 12.34 seconds. Root rechecked the frozen record/review hashes and scoped whitespace before acceptance. No failed engine or compiler run is hidden.

North Star: this removes silent physical-erasure loss and false progress from the scheduled/operator ledger path while leaving request-time content selection, relevance and latency untouched. It improves trustworthy privacy/accountability evidence; it is not performance or lift evidence.

Limits: sequential local synthetic R2 recovery only. The cap bounds ledger-object opens, not whole-day listing, memory, metadata operations or physical-deletion SLA. Concurrent rewrite/ingestion fencing, shopper revocation/re-entry, other stores and destinations, approved retention, reader/operator UX, deployed/customer/SLO evidence, D03, D06 and full W06/finding/gate/release acceptance remain open. Pending recovery requires the recorded scan window, and rollback must preserve coordinator/anchor state.

Handoff: W06.03 is closed. Select the next bounded, decision-independent W06 implementation residual from document 35; do not infer D03 concurrency authority or D06 retention/re-entry policy.
