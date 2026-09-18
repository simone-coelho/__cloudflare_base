# W35.03 — Recoverable DO link transfer and source-writer fence

## Scope and authority

Implement one local W35 unit under the recorded D03 direction: the existing per-shopper Durable Object becomes the authority for an anonymous-browser-to-person link. This task fixes the source-confirmed lost/duplicate merge, stale source writer and unrecoverable retry paths in the DO host only. It preserves the session-host path and does not switch hosts, migrate data, deploy, repair historical links, or close full W35/F14.

The current DO path publishes the KV identity index before target absorb/source forward; retry then trusts `already` and can skip the missing merge. Export and forward are separate source operations, so an accepted event can land after export and be abandoned. Concurrent requests can merge one source twice. A committed-but-rejected `forwardTo` write can leave the warm mirror authorizing the old source until restart. The compatibility shopper record also loses concurrent visitor additions because its KV read/modify/write is not serialized. These are source-confirmed design cases from the actual modules; baseline W35.01 remains green. A pre-existing publication-fixture failure in the broader W04.02 case is recorded but is not part of this task.

## Coherent implementation

- On the DO host, `linkVisitor` asks the source shopper object to perform/resume one durable transition bound to tenant, anonymous subject/session, target shopper, assurance/source and stable link time. The session-host path is unchanged.
- The source object serializes preparation with ordinary actions, freezes its committed affinity/pipeline only after validation, and persists a transition before exposing that payload. Pending/completed transfer state fences behavioral HTTP, WS, buffered, manual/internal import/absorb and alarm mutation across restart. Restrictive consent remains allowed and is re-read before transfer; reset/retention may erase state and cancel recovery, without a claim of stale-grant revocation.
- Give the transfer an immutable fingerprint over transfer id, tenant, source subject/session, target and the frozen committed-profile digest. Consent is not part of that immutable identity: it may only tighten. Before the first target commit, intersect the current source and target switches. Under the existing `personalizes` gate, any false switch suppresses the incoming behavioral/enrichment payload while the refusal still propagates. Once a receipt commits, later refusal restricts target consent but never remerges, rewrites, or claims to undo the already accepted merge; retries return the same merge identity/result.
- The source drives the target absorb while its serialization is held. The target validates the frozen transfer and atomically commits the merged affinity/pipeline, a per-transfer receipt, and its current authoritative compatibility-member set. An identical retry returns the stored result; a conflicting immutable fingerprint, source/session or target fails closed. Apply W35.01 ambiguous-write recovery to transition, receipt, membership and forward mirrors.
- Only after the receipt exists, publish the existing KV identity compatibility projections under target serialization. Publication is retryable and never decides whether to absorb. The target always republishes its latest authoritative member set—not the historical subset held by an older receipt—and writes the visitor projection last. This covers delayed KV reads and source-A retry after source B. Stable outcome/link time comes from the receipt. Then atomically mark the source completed and forwarding. Lost responses resume with the original grant and return the same target result without another merge.

Reset/erasure versus an already in-flight cross-object request, revocation of old recognized or anonymous bearer grants, pushed-frame revocation, existing-data migration and full identity-index migration remain separate work. Do not encode a new retention/privacy policy here.

## Ownership and acceptance

The sole implementer `/root/w3503_link_investigation` (gpt-6-astra/xhigh) owns only:

- `src/identity/link.ts`
- `src/identity/store.ts`
- `src/durable-objects/ShopperReflex.ts`
- `src/routes/realtime.sdkContract.test.ts`
- `docs/remediation/evidence/W35.03/worker.json`

The lead owns admission, freeze, tracker/history and acceptance. Distinct `/root/w3503_stale_session_investigation` (gpt-6-astra/xhigh) owns preflight/frozen review records only. No subdelegation.

C1: Actual source/target objects serialize an immutable prepared transfer, fence every named source writer across restart, include every accepted pre-fence event once, and reject post-fence or conflicting-target mutation without changing either profile.

C2: Target state, receipt and authoritative compatibility members commit together; failures/ambiguous acknowledgements at prepare, absorb, delayed/stale compatibility publication and source completion recover after object restart to one merge, stable SID/outcome and terminal forwarding. Two sources linking one target retain both contributions/members, and retrying the older source republishes the latest complete member set.

C3: Tenant/session/subject/immutable-fingerprint conflicts fail closed; source and target consent are intersected before first commit, while later refusal tightens consent without a second merge or false undo claim. Existing visit/channel/enrichment and W35.01 commit recovery remain intact. Frozen worker and distinct reviewer run the same fixed checks plus compiler/lint/whitespace with no new warning signatures.

Smallest runtime addition: three grouped W35.03 cases in the existing actual-module boundary fixture—failure/restart/retry, concurrency/fencing, and authority/consent. Reuse its storage gates, ambiguous puts, object restart and signed route/WS helpers. Do not repair or broaden the obsolete unsigned identity fixture.

Required runtime:

`node node_modules/vitest/vitest.mjs run src/routes/realtime.sdkContract.test.ts src/routes/identity.test.ts -t 'W35[.]03|W35[.]01|the link, on the session host|detach' --maxWorkers=1 --minWorkers=1`

Required static on final bytes: existing 1536 MB no-emit compiler; 512 MB ESLint on the four owned TS files with zero errors and no warning-signature increase from the recorded 109-warning baseline; scoped `git diff --check`. Reviewer repeats runtime on the frozen artifact and may reuse exact-byte static evidence.

## Rollback and limits

Retain exact before bytes and all pre-existing worktree changes. Rollback is a reviewed inverse of this task delta; it must not silently run an older binary against durable transition/receipt records. No install, stage, commit, push, deployment, cloud/resource mutation, credential/customer-data access, destructive cleanup or external message. Local Node/Vitest fakes are not native workerd, customer, latency/SLO, migration or release acceptance.
