# W35.06 — Prospective source registration and checkpointed erasure

## Scope

Fix the prospective Durable Object erasure gap left by W35.05. Before an anonymous source can persist a full prepared identity-transfer payload, it must durably record an immutable generation-bound intent and the recognized target must durably register that exact source. The source intent fixes transfer id, tenant, source visitor/session and source authority epoch before the outbound call. Under target serialization, the registration fixes the target's first assigned authority epoch and monotonic sequence. A lost admission reply recovers that same registration; it never renews or rebinds the intent after a target barrier. Transfer admission requires the matching registration. Intent-bearing sources are fenced from other behavior writers just like prepared transfers, including trusted internal and restart paths.

Extend the existing resumable erasure job with a new version; never reinterpret v1-v4 cursors and explicitly preserve all v4 session/canonical-session branches. After the initial job checkpoint and before source/object cleanup, a resolved target atomically rotates its authority, deletes its old behavioral state, retains registrations, records an idempotent erasure receipt, and returns the registration-sequence high-water captured by that same serialized barrier. Registrations after that barrier belong to the new generation and are excluded. Freeze the bounded population through exclusive monotonic-order pages no larger than 32.

Clean one exact registered source generation at a time through an internal serialized source operation, retain an exact completion receipt with its deny barrier, then replace only the matching target registration with a non-subject acknowledgement and checkpoint the frozen page. Retry ambiguous source cleanup, acknowledgement or page/root writes idempotently. Run these exact source cleanups before existing base/extra object steps. Every v5 object cleanup uses the same idempotent erasure id: the already-fenced target and already-cleaned registered sources are verified no-ops, so duplicate cleanup cannot erase a newer generation; an unresolved, malformed or conflicting witness pauses without deletion. Do not call target to source while holding target serialization.

## Ownership and checks

The sole implementer owns:

- `src/durable-objects/ShopperReflex.ts`
- `src/identity/erase.ts`
- `src/routes/realtime.sdkContract.test.ts`
- `src/routes/identity.test.ts`
- `docs/remediation/evidence/W35.06/worker.json`

C1: Every new full source transfer is preceded by durable source intent and an immutable generation-bound target registration; ambiguous admission recovers the first target epoch/order without rebinding, transfer requires the exact registration, reset/erasure/retention preserve the minimal registry, and monotonic high-water paging works beyond the 50-member compatibility cap.

C2: A fresh erasure-job version checkpoints first, establishes one atomic idempotent target barrier/high-water, freezes pages of at most 32, cleans and acknowledges each exact source before base/extra object cleanup, and resumes barrier/source/ack/page/root ambiguity. Later target/source generations and changed ownership are not deleted; existing v1-v4 cursor and v4 session/canonical-session behavior are unchanged.

C3: Exact source cleanup removes the old source behavior, prepared payload and forwarding state behind a rotated deny epoch, is idempotent after lost acknowledgement, and never erases a newer source generation. Existing W35.03-.05 transfer/revocation and W06.08-.09 erasure behavior remain green.

Focused runtime only:

`node node_modules/vitest/vitest.mjs run src/routes/realtime.sdkContract.test.ts src/routes/identity.test.ts -t 'W35[.]0[3456]|W06[.]0[89]' --maxWorkers=1 --minWorkers=1`

Static: existing no-emit compiler; ESLint and `git diff --check` on the four owned TS files. No broad suite.

## Rollback and limits

Rollback is a reviewed inverse on the recorded before bytes and must not let an older binary silently discard the new registration/job records. Preserve unrelated dirty work. This is prospective registration only: historical unregistered source objects still require a migration/discovery decision. It does not prove external/physical erasure, session-host parity, production cutover/migration, deployed performance, customer/SLO/release acceptance or full W35/F06/F14 closure.
