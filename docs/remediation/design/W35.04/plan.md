# W35.04 — Durable per-grant authority and revocation

## Scope and authority

Implement the next local W35 unit under the approved D03 direction: on the `REFLEX_HOST=do` candidate, the existing shopper Durable Object becomes the durable authority for each browser grant and its revocation. This fixes source-confirmed stale bearer reuse after detach/reset/erase, receipt-replay reminting, and stale socket delivery. It preserves W35.03 link serialization and does not switch hosts, migrate production tokens, deploy, or claim strong revocation for the current KV/session host.

Current signed capabilities identify only tenant, subject and shared profile SID. Same-account devices can receive identical tokens; detach only returns a replacement; reset/erasure deletes the state that happened to reject old authority; W35.03 completed-link recovery can then mint another recognized token; heartbeat/push paths check signature/expiry but not current authority. The retained W35.01 test presently proves the bad reset/retention behavior by expecting the old grant to recreate the object. The baseline records that passing before-state.

## Coherent implementation

- New capabilities carry a unique `grantId` and durable-object `authorityEpoch`, separate from profile SID and browsing attribution. Verification remains compatible with legacy capabilities for the unchanged session host, but the DO authority rejects legacy credentials that cannot identify a grant.
- The shopper object stores its epoch and exact active grant records. New-format cold anonymous authority may establish the first epoch only on an empty object, or adopt an exact pre-authority owned profile after all current SID/subject/transfer checks pass. The normal identity bootstrap explicitly activates its grant before returning it. Once an epoch/barrier or transition record exists, absent or malformed authority is not a cold object: mismatched, expired, corrupt or revoked grants fail closed and are never recreated merely because their signature is valid.
- The target identity receipt owns one immutable recognized grant descriptor (`grantId`, epoch, subject/SID/kind, issue/expiry). First transfer stores the receipt, target behavior and active grant together. Lost-response retry returns/signs that same descriptor. If detach/reset removed it, replay through the original anonymous source and still-valid backend assertion fails; it never registers or renews the receipt-bound grant.
- DO detach is a serialized, retryable per-grant rotation. It captures current restrictive consent, persists one replacement descriptor, idempotently activates the fresh anonymous object, then atomically removes only the presented grant and completes the transition before success. Recovery is bound to the exact original grant, epoch and operation, retains the original replacement issue/expiry, and cannot renew authority. A lost response may use the old signed token only to recover that exact transition; it cannot perform ordinary reads/writes. A completed retry verifies that the replacement grant is still active and never reactivates it if it was subsequently detached/reset. Before returning, pending and completed recovery re-intersect the source's current consent with the retained refusal and durably tighten the replacement, so a later refusal is not replayed as the earlier captured value. Other device grants on the shared shopper remain active.
- DO reset uses the same recoverable rotation but removes behavior and every active grant for that subject, closes its sockets, and leaves a fresh epoch/barrier plus the presented transition receipt. Reset, internal erasure and retention replace `deleteAll` with one storage transaction that lists/deletes the prior keys and writes the new barrier (and transition when applicable) atomically; there is no empty post-cleanup window in which an old signed token can self-adopt. Failed or commit-ambiguous cleanup invalidates warm mirrors and recovers by rereading after restart. Prepared cross-object transfer racing erasure and complete subject discovery remain separate.
- Every DO effect checks the exact active grant inside the object's existing serialization. Socket upgrade, message/heartbeat and each push revalidate the attachment; revocation closes affected sockets. Deferred ODP receipt push is brought back through the same serialized authority boundary. Ambiguous writes invalidate warm authority assumptions and recover from durable records rather than reporting a false successful transition.

Late-event age semantics do not change: a buffered event may retain its historical event time and age-decayed interest/measurement treatment, but it still needs current authority when processed.

## Ownership and acceptance

The sole implementer `/root/w3503_link_investigation` (gpt-6-astra/xhigh) owns only:

- `src/identity/sessionCapability.ts`
- `src/identity/consentContinuity.ts`
- `src/identity/link.ts`
- `src/routes/identity.ts`
- `src/routes/realtime.ts`
- `src/durable-objects/ShopperReflex.ts`
- `src/routes/realtime.sdkContract.test.ts`
- `docs/remediation/evidence/W35.04/worker.json`

The lead owns admission, freeze, tracker/history and acceptance. Distinct `/root/w3503_stale_session_investigation` (gpt-6-astra/xhigh) owns preflight/frozen review records only. No subdelegation.

C1: Two same-account/same-second device grants are distinct. Detach A durably rotates only A, preserves current/refined refusal and the shared profile, rejects A's ordinary HTTP/reconnect/open-socket authority, and leaves B functional. Lost detach response recovers the same still-active replacement without reopening A or resurrecting a replacement later revoked.

C2: A lost link response recovers the identical receipt-bound recognized grant. After detach/reset/internal erase, the recognized grant and original anonymous-source replay both fail after restart; atomic reset/erase/retention cleanup leaves a barrier that prevents empty-state resurrection while a fresh authorized bootstrap works. Failed, interrupted and commit-ambiguous transition/cleanup writes recover after restart without treating corrupt/partial authority as cold, exposing an empty adoption window or yielding false success.

C3: HTTP/buffered writes, socket upgrade/action/heartbeat, synchronous push and deferred ODP push observe the same serialized grant fence. Existing W35.03 transfer/consent/result behavior and session-host behavior remain intact. Frozen worker and distinct reviewer run the fixed checks plus compiler/lint/whitespace with no new warning signatures.

Smallest runtime addition: three grouped W35.04 cases in the existing actual-module boundary fixture—device detach/recovery, link/reset/erasure barrier (including interrupted cleanup/restart), and serialized socket/push authority. Within those groups, a legacy signed token remains accepted on the unchanged session host and is rejected by the DO host. Amend the existing W35.01 reset/retention expectation from stale recreation to rejection. Existing W35.03 reset and W05.01 consent checks must assert behavioral emptiness/refusal separately from the new non-behavioral authority/barrier records; they may not keep treating raw storage size as the privacy or behavior contract. Add only the fixture's minimal list/transaction behavior needed to exercise the production transaction. Reuse its signed routes, storage faults, restart and socket helpers; no new suite or general harness.

Required runtime:

`node node_modules/vitest/vitest.mjs run src/routes/realtime.sdkContract.test.ts src/routes/identity.test.ts -t 'W35[.]04|W35[.]03|W05[.]01 withdrawal continuity|contains unbound/corrupt/forwarded/refused alarms' --maxWorkers=1 --minWorkers=1`

Required static on final bytes: existing 1536 MB no-emit compiler; 512 MB ESLint on the seven owned TS files with zero errors and no warning-signature increase from the recorded 113-warning baseline; scoped `git diff --check`. Reviewer repeats runtime once on the frozen artifact and may reuse exact-byte static evidence.

## Rollback and limits

Retain exact before bytes and all pre-existing worktree changes. Rollback is a reviewed inverse of this task delta; persisted authority/transition records require compatibility review before older code can run. No install, stage, commit, push, deployment, cloud/resource mutation, credential/customer-data access, destructive cleanup or external message. Session-host serialization, account-wide logout, production legacy-token migration, prepared-transfer erasure races, full F14/W35, native/customer/browser/SLO and release acceptance remain open.
