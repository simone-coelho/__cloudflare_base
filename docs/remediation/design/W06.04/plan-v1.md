# W06.04 — known-subject CACHE cleanup

Standing local G0 authority; no deployment, customer data, schema or policy decision. Parent document 35 W06/F06/N05 remains open beyond this bounded remedy: orphan discovery, stale-cookie/deletion generations, concurrent writers, online ring/seen replay, D1, Analytics Engine/logs/external destinations, retention and accountability are excluded. D03/D06 remain pending.

Source-confirmed baseline: the durable erasure job never addresses tenant CACHE. Exact discovered subjects can retain `profile:<id>`, `profile:user:<id>`, `profile:anon:<id>` and every `override:<id>:*`; current readers continue to consume those records after local completion. Both independent Astra/xhigh triages selected this as the smallest ready residual. No extra baseline suite is needed; the existing identity fixture will inspect actual cache state and readers.

Implement only in `src/identity/erase.ts` and the existing `src/routes/identity.test.ts`. New jobs use an explicit versioned CACHE plan derived only from immutable discovered targets: the three exact profile keys per target plus every strictly paginated key under that target's override prefix. Discovery/cursor/storage failure stops before destructive work. Preserve tenant isolation, another subject, both host resets, original actor/cutoff, the 32-attempt bound, exact per-step checkpointing and `complete:false`.

Compatibility is mandatory: version-1 pending jobs keep their original dynamically derived step ordering and numeric cursor, including nonzero cursors after links disappear. They do not silently gain CACHE completion. Version-2 jobs have a stable cache-aware plan; delete/checkpoint ambiguity is safely retryable and binding/target conflict still fails closed. A later explicit erase after a compact v1 completion may create a fresh v2 job.

Acceptance is the single existing identity suite, app `tsc --noEmit`, scoped diff/whitespace, then independent exact-suite review of frozen source/proof and relevant pins. No new suite, framework, broad build, request-time scorer/SDK change or performance claim. Rollback must retain/read pending v2 recovery state; never discard it to revert code.
