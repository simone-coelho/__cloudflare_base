# W06.02 — persistent ledger replay suppression

Standing local G0 mandate. Sole implementer `w0602-worker` (`/root/sdk_consent_preflight`), independent reviewer `w0602-reviewer` (`/root/w0506_review`), both gpt-6-astra/xhigh; root owns admission, tracker and acceptance. No subdelegation.

## Boundary

This is the smallest coherent decision-independent slice of document 35 W06/F06/F18: keep the tenant/visitor erasure predicate after physical rewrite and apply it at ledger queue ingestion so delayed or redelivered records at or before the erasure cutoff cannot become visible. It does not claim shopper-capability revocation, stale-cookie/session protection, concurrent cross-store fencing, ring/online-learning suppression, approved retention duration, external reconciliation, or full W06/F04/N05/N12/N13/customer/release acceptance.

Current source still deletes the only active predicate when rewrite completes and `consumeLedger` writes delayed records without consulting erasures. The raw F06 verifier reproduced the resulting permanent resurrection. Entry board check/status are valid at journal313. Exact source hashes and the dirty-worktree boundary are retained in `before-sources-v1.json`; no broad baseline suite is needed.

## Change

- `rewriteErasures` preserves the strict tenant/visitor tombstone in the pending namespace, marks physical rewrite complete, and keeps reader suppression active. A later explicit erasure restarts physical progress without lowering the cutoff.
- `loadTombstones` fails closed on a listed missing, malformed or mismatched barrier. Old valid tombstones remain readable.
- Ledger wire validation requires the record tenant/time to equal its parsed ID carrier and requires a valid visitor ID. `consumeLedger` loads each represented tenant's barriers once, suppresses records with `ts <= erased_at`, reports the suppression count, and returns `ok:false` on barrier read failure so the queue retries instead of acknowledging an unsafe write.
- No cache and no automatic barrier expiry are introduced. Retention/removal requires the still-pending D06 policy and a later compatible lifecycle task.

## Acceptance and rollback

Use only existing `src/ledger/ledger.test.ts` and `src/ledger/erasure.test.ts`. Add grouped assertions for delayed decision/outcome suppression before and after physical completion, two non-default tenants, post-cutoff positive records, corrupt/read-failed barriers, strict carrier mismatch, restart/finalization, and unchanged ordinary batching. Worker runs that exact two-suite command, app `tsc --noEmit`, and scoped diff/whitespace checks; independent reviewer runs the same two suites once against the frozen artifact and inspects actual R2 state.

Rollback must not delete already-created barriers. Reverting the reader/consumer while barriers exist would restore the defect and therefore requires disabled ledger ingestion/reads or a compatible replacement under separate authority. Preserve W06.01 accepted implementation historically; qualify its overlapping proof before edits rather than pretending it reviewed new bytes.
