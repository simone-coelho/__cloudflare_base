# W06.02 acceptance and handoff

Accepted by `w01-lead` (`/root`) at 2026-09-08T14:30:00Z after independent `w0602-reviewer` PASS C1–C3. Artifact `0b46c7e75c3bb6ff912e3933bf212a058bcdf71987db5f85513226ff8ef5b60d`; admitted plan and contract unchanged.

Implemented: completed physical ledger scans no longer delete the tenant/visitor/cutoff predicate. Scan progress is persisted before audit/final marking so interrupted finalization resumes without rescanning, same/earlier erasure retries preserve state, and a later erasure restarts progress at a monotonic cutoff. Listed missing, corrupt, mismatched or incomplete tombstone state fails closed.

Ledger ingestion now validates the ID carrier against record tenant, integer time and bounded visitor, loads every represented tenant's barriers before the first R2 put, suppresses only matching records at or before the cutoff, and returns retryable failure when barrier state cannot be trusted. Other visitors, tenants and post-cutoff records remain writable.

Evidence: worker exact existing-suite K1 passed 17/17, app noEmit and scoped five-file diff/whitespace passed. Independent exact K1 ran once and passed 17/17 in 5.86 seconds; all 40 artifact pins, five originals and the independently reconstructed 18-input write:false graph match. Lead inspected the actual erasure, consumer and writer source, assertions, full worker/reviewer evidence, queue retry caller, cron and ledger/report readers.

North Star: this repair is outside the request-time relevance/ranking path. It adds no scorer RPC, cache, customer-specific logic or runtime model; deterministic decisions and content latency are unchanged. It improves privacy correctness and trustworthy ledger measurement by preventing delayed pre-erasure rows from re-entering R2.

Limits: this does not fence a writer that read barriers before a concurrent erasure, revoke shopper capabilities/cookies/sessions/sockets, reconcile DecisionRing/online learning/seen/D1/Analytics Engine/logs/external destinations, approve retention or prove an exhaustive physical SLA. The existing `/receipts` blanket 410 and operator “pending” counts now remain durable for completed barriers; post-cutoff receipts/re-entry UX is not accepted pending D06. Pre-checkpoint physical mutations can still undercount removed rows after retry. No deployed R2, customer, SLO, finding, gate or release acceptance is claimed.

W06.01's prior acceptance is retained historically and marked for revalidation because W06.02 changed its shared erasure source/fixture. W06.02 closes only the bounded ledger replay criterion. W06, F04/F06/F18/N05/N12/N13 and D03/D06 remain open. No deployment, cloud, credentials, customer data, commit or push occurred.

Next: select the next bounded W06 remedy from the canonical residuals. Strict concurrent cross-store fencing and shopper deletion-generation/re-entry semantics require D03/D06 rather than being inferred here.
