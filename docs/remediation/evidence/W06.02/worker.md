# W06.02 worker — frozen for independent review

Frozen 2026-09-08 14:12:58 UTC. Changed only ledger erasure/consumer/writer and their two existing suites. Exact originals, source pins, command timestamps and full outputs are in worker-checks.json.

Completed scans retain the strict active tenant/visitor/cutoff barrier. Cursor persistence precedes audit/final completion, so interrupted finalization resumes without rescanning. The consumer validates carrier tenant/time/visitor, reads every represented tenant's barriers before writing, and suppresses matching decisions/outcomes at or before the cutoff. Other visitors, tenants and post-cutoff records remain writable.

Checks: exact two-suite K1 passed17/17; app noEmit clean; exact scoped diff, whitespace and hashes pass. Initial read-only baseline-format inspection error is retained; corrected originals verified before edits. No failing runtime/compiler checks.

Lead-dispositioned limit: existing /receipts blanket410 now remains durable, including post-cutoff receipts; operator pending counts include completed active barriers. Routes untouched. This is ledger replay containment, not concurrent fencing, identity/session/socket revocation, full reader UX, online-learning/external suppression or physical/retention/customer acceptance. D03/D06 and full W06 remain open. No automatic expiry; rollback must preserve compatible barrier readers/ingestion or disable those paths under separate authority.

Next: independent frozen artifact review and lead disposition. No further worker edits.
