# W35.07 — Generation-bound session erasure and v5 cursor safety

## Scope

Close the destructive session-copy seam left by W35.06 without claiming strong authority for the legacy KV/session host. Fresh object-bound erasure jobs use an explicit v6 protocol. Before its barrier removes authority, each ShopperReflex object atomically retains the exact session IDs and authority epoch eligible for that erasure. Exact registered-source cleanup retains the source intent's session ID and source epoch with its completion receipt, including the retired-generation path. A generic or historical receipt alone never authorizes a session deletion.

`/identity/erase/session` accepts only an exact retained session witness plus the matching erasure receipt. It refuses a current grant or pipeline that reuses that ID under another epoch. The controller addresses the captured session's `userId`, not a pointer source. New H+1/successor sessions therefore cannot inherit an old receipt. Witnesses survive reset and retention; conflicting same-ID generations fail closed.

V6 freezes the original serialized session bytes from one strict validated KV read. Registered-source cleanup completes before scanned-session cleanup; scanned, extra/canonical and base session deletes all require session eligibility and unchanged raw bytes. V6 base and extra work guard objects before adjacent deletion. Ambiguous writes and restarts reuse the same erasure ID, witness and checkpoint; missing, malformed, changed or legacy-unprovable sessions pause without deleting adjacent state or reporting completion.

Rejected and accepted W35.06 artifacts used different v5 extra-step orders with the same numeric cursor. An untagged v5 discovered page compares legacy and object-first completed prefixes by unique `(kind,id,key)` identity. Ambiguous prefixes refuse without mutation. At an equivalent prefix, conditionally persist a page-local object-first layout witness before another effect. Completed/compacted pages are never replayed. V1–v4 semantics and existing v5 records are not relabelled as v6.

## Ownership and acceptance

The sole implementer owns only:

- `src/durable-objects/ShopperReflex.ts`
- `src/identity/erase.ts`
- `src/services/SessionManager.ts`
- `src/routes/realtime.sdkContract.test.ts`
- `src/routes/identity.test.ts`
- `docs/remediation/evidence/W35.07/worker.json`

C1: Fresh v6 target, source and generic-object cleanup atomically retain exact eligible SID/epoch witnesses. Session authorization requires that witness and receipt, rejects current same-SID successor epochs, uses the actual captured session owner, and never backfills eligibility from legacy/current state.

C2: One-read exact serialized witnesses protect session-scan, extra/canonical and base session deletion. Source cleanup precedes sessions; object/session guards precede adjacent deletes. Visible H+1, changed bytes, unknown fields, same-SID successor, lost acknowledgements and restart preserve successor and adjacent state while eligible old sessions finish idempotently.

C3: Untagged v5 extra progress is tagged only at an equivalent prefix and refuses at an ambiguous prefix, including checkpoint ambiguity and compaction. V1–v4, W35.03–.06 and W06.08–.09 behavior remains intact; final scoped compiler/lint/whitespace checks have zero errors and no warning-signature increase.

Focused runtime only:

`node node_modules/vitest/vitest.mjs run src/routes/realtime.sdkContract.test.ts src/routes/identity.test.ts -t 'W35[.]0[34567]|W06[.]0[89]|resumes frozen v2 CACHE steps|retains a nonzero v1 cursor' --maxWorkers=1 --minWorkers=1`

Add only three grouped schedules in existing fixtures: cutoff/receipt/SID reuse; exact raw witness across all session branches; v5 safe/ambiguous/layout-retry progress. Static check is the existing no-emit compiler, ESLint on the five owned TS files, and scoped `git diff --check`. No broad suite.

## Rollback and limits

Rollback is a reviewed inverse on pinned before bytes. Older code must not consume v6 or tagged-v5 records; no automatic migration or cursor remap is authorized. Preserve unrelated work.

This proves prospective DO-authorized session eligibility plus exact-snapshot cleanup. KV read/delete is still not transactional with legacy writers. Unseen SID reuse, grantless/legacy session records, full session-host revocation/socket authority, historical discovery, migration/cutover/deployment, external/physical erasure, retention/capacity, customer/native/browser/SLO/release acceptance and full W35/F06/F14 remain open. No external operation is authorized.
