# W06.01 — durable erasure retries

Standing local G0 authority in tracker; no external/data operation or customer-policy approval. Sole implementer w0601-worker (/root/sdk_consent_preflight), independent w0601-reviewer (/root/w0506_review), requested gpt-6-astra/xhigh; root governs admission, records and acceptance. No subdelegation.

Parent35 W06 remains fully open outside this bounded manually resumable local job. Trace F04/F06/F18/N05/N12/N13;35 section4 first-party identity, D9 erasure/D10 consent, DS exports and warehouse deletion. Complete scope also requires epochs/replay/concurrent ingestion, all hosts/orphans/caches/rings/seen/D1/history/external destinations, physical progress/retention and accountability. Do not call this isolated task full erasure or privacy acceptance. D01/D03/D06 remain pending.

## Baseline and scope

Entry check/status VALID301 and byte-identical to previous accepted outputs; actual tracker SHA ad5be2b512f923c172d4e4eb36ceea8fd0ea857e8a797058dcd33743a8017171, HEAD e49aef8, dirty worktree membership unchanged. Exact six source/fixture originals and complete entry output retained beside this plan. Source-confirmed baseline: eraseSubject removes links before failing profile/ledger stages, loses exact retry discovery, uses swallowing session helpers, labels attempted IDs erased; route always ok:true. Same-cutoff writeTombstone drops done_through, ring retry repeats that write. No extra executable baseline run: actual source ordering/error branches plus existing verifier reproduction suffice for this design case; new assertions must inspect actual destination state, not status alone.

Only four production files (identity/erase.ts, identity/store.ts if required, ledger/erasure.ts, routes/identity.ts), existing routes/identity.test.ts and ledger/erasure.test.ts, worker.md/worker-checks.json. Preserve unrelated changes. No scorer/SDK/general SessionManager/ShopperReflex/index changes or new framework/suite/build.

## Implementation contract

Strict existing R2 job under erasures/<tenant>/jobs/, address SHA256(normalized exact original selector). Before destructive work, capture all discovered subjects, exact own/current SIDs and pointer/link keys, original actor/cutoff and required bound destinations. Validate conflicting visitor+shopper input and currently relinked historical visitors before discovery is accepted; never union another account's current pointer targets. Stored malformed/null/read-error state is not absence.

Conditional initial create (If-None-Match:*); ETag-guarded checkpoint writes. Keep original target/cutoff basis immutable while pending. Persist each actual object/key/stage completion; any failed/ambiguous/conflicting checkpoint stops that executor and next request re-reads. Same original selector finds pending work even after links/pointers vanish. At most32 work attempts per call; return explicit manual continuation, no scheduler claim. On local completion compact to minimal checkpoint metadata without raw IDs/SIDs/profile snapshots; a later explicit same-selector erase creates a new job/cutoff. Necessary pending records/minimal pseudonymous metadata are not an approved retention/audit policy. No cross-selector or cross-store atomicity claim.

Delete captured session records/pointers through strict TenantKV operations. Cover both profile hosts when bound regardless of host flag; freeze required destinations so missing binding on retry cannot turn failure into success. Existing object reset is consumed, not modified. Match actual responses: ShopperReflex ok:true; DecisionRing ok:true/reset:true. Known links are removed only after their captured local cleanup has checkpointed; reject changed current-link/pointer ownership, preserve recovery on conflict. This is not a concurrent-ingestion deletion epoch.

Separate tombstone establishment and ring reset. Strict prior tombstone read; same/earlier cutoff reuses established counts/done_through/actor, later erasure restarts its window. Checkpointed stage reuse is historical confirmation, not proof retired suppression remains active. Keep direct ledger helper's interface, but propagate failure truthfully.

Receipt: complete:false, erased:[] (no physical/external claim), explicit targets/local-completed stages and notReached/unbound destinations. Local completion200; pending bounded continuation202; conflict409; storage/destination failure503. No failed stage ok:true. Do not log raw subjects, records or caught exceptions. Existing erased-array positives and idempotent no-op tests must be corrected to the truthful response and actual deletion state.

R2 conditional API semantics checked against installed types and [official Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations): failed conditional put returns null; successful writes return metadata. Local conditional fixtures are not deployed R2 attestation.

## Acceptance and rollback

Exact C1-C3/K1-K2 are in task-contract-v1.json. Worker runs only the existing two-suite K1, app tsc --noEmit and scoped before/current diff/whitespace check. Independent same K1 once, actual source/complete available proof, relevant local import graph/pins. Group fail-before-write, mid-target/ambiguous/checkpoint/CAS failure, restart after removed keys, both-host/two-non-default-tenant positives, original cutoff, relink conflicts, bounded continuation and fresh post-completion request. Expand only for a concrete admitted dependency defect. No browser/workerd/live/customer/SLO claim; unchanged hot path and existing dependency assurance are reused narrowly.

Root qualifies W05.08 proof/history before shared inputs change; its actual fixes stay. Rollback source only from retained exact originals and preserve unrelated dirt. Never remove recovery records to roll back or make tests green; a deployed rollback would need a compatible pending-job reader or disabled erasure entry until recovery, under separate authority. Source/artifact/worker proof frozen before independent review; lead alone accepts and updates existing board/checkpoint. Full W06 and release remain open.
