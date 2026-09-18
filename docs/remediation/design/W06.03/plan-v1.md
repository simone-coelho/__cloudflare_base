# W06.03 — bounded resumable physical ledger rewrite

Standing local G0 mandate. Sole implementer `w0602-worker` (`/root/sdk_consent_preflight`) and independent reviewer `w0602-reviewer` (`/root/w0506_review`) are gpt-6-astra/xhigh; root owns admission, integration and acceptance. No subdelegation. Contract `bec3c4ca384f4ce1811244eed01db8ca19d9d56854c697d8e3ee6d46903ac6cf`.

## Boundary and failure

Document35 W06/F06/F18 requires tested physical progress. Current `rewriteErasures` checks `maxObjects` only between days, then opens every object in a dense day and persists progress only after the whole day. A cap of one therefore processes multiple objects, while a mid-day or ambiguous R2 failure repeats physical mutations and can lose or overstate counters.

The repair is one production module and one existing fixture. Enforce the cap before each object, persist tenant/tombstone-bound within-day progress and a pre-mutation intent, reconcile exact before/after state on restart, and advance `done_through` only after the day is complete. Preserve W06.02's active inclusive barrier and queue suppression.

## Acceptance and rollback

Use only the existing ledger and erasure suites. Add grouped dense-day cap, restart, ambiguous mutation/checkpoint, exact-once counter and positive isolation assertions. Worker runs exact K1, app `tsc --noEmit`, and scoped diff/whitespace; the independent reviewer runs K1 once against the frozen artifact and inspects actual state/pins.

No new retention duration, shopper generation, concurrent cross-store authority, destination inventory, deployed/SLO/customer or release claim. Rollback is the retained pre-task source: do not remove active barriers or erase durable recovery state unless a compatible implementation has completed it.
