# W35.02 — Visit and entry-channel parity

## Scope and authority
Implement under the recorded D03 shopper-authority direction (2026-09-15) and current user continue. W35 requires transactional authority, complete identity/session/visit/channel/consent/link/erase/SDK/sort/fatigue parity, concurrent/stale/delayed/restart/rollback proof and exact customer/runtime tails. This task covers visit/channel wiring and preservation only, informed by complete W16/F13/F14/F05/F29/F32, doc18 context and doc22 six-value cell contract. Full W35/F14, gamma-zero seeded influence, journey reset, memory/classifier calibration, native/customer/SLO acceptance remain open. No host toggle/deployment/migration or new privacy/retention/science policy.

Source-confirmed baseline, not a claimed failing runtime: session writer invents direct and carries an old channel across an unobserved new arrival; content reads omit stored visit/channel; DO drops entry and live visitorId; legacy attributes invent first/direct. Current hydrate reads are already behavior-read-only, so do not recreate the old F13 hydrate-write defect. SDK supplies explicit channel only; careless auto-classification would override stored paid entry on navigation. Root source captures 757a06/432ff2/031c4f/d379fa/5b64a2, F13 original verifier bf0189. Existing 30-minute rule and channel classifier table are retained.

## Coherent change
- Shared pure visit context helpers in visit.ts: distinguish an observed live event from a read projection. Read counts are null when no valid historical count exists; otherwise project the existing boundary once from stored lastSeen. Reads never update lastSeen/count/start/TTL/alarms/cookies. Accepted live events establish/increment count with existing policy, set visit start only on a boundary, preserve valid same-visit entry and discard prior-visit entry if the new arrival is unknown.
- Entry input is optional, bounded known string fields. Missing object or no supplied string fields is unknown. Explicit browser observations with empty strings can mean direct. Invalid/nonstring/oversized fields refuse at HTTP/WS/snapshot request boundaries before effects. Keep classifier mappings unchanged. Normalize arbitrary explicit channel to the six doc22 values or unknown; enum-valid explicit request channel retains request-only precedence.
- SessionManager uses shared live calculation; RealtimeSegmentEngine legacy decision attributes and content service use shared read projection without inventing visit1/direct. DO stores optional count/start/channel, retains visitorId and validated HTTP/WS entry, and carries context through content/legacy outputs. Optional fields preserve old-record loading. Absorb uses existing SessionManager sum/later-visit-start channel rule, not a new distinct-visit dedup promise. Validate supplied context and preserve it across manual/import/alarm/buffered updates.
- Snapshot accepts one optional bounded JSON entry query. SDK sends only when tracking permits, after readiness, and core.getJson strips it in the post-ready withdrawal recheck. New query referrer is HOST ONLY, not URL/path/query. Persist no raw entry. Both shipped bundles use the same source. Consent: stored context requires both switches, while request-only entry follows the existing tracking gate; refusal cannot expose stored context.
- Keep deterministic customer-neutral behavior, tenant/identity guards, W35.01 candidate commit/recovery, buffered original-time purpose/lifetime and brand-local fatigue. No additional network/storage calls solely for visit projection.

## Ownership and acceptance
Worker /root/w2206_worker (gpt-6-astra/xhigh) owns only:
- src/services/visit.ts
- src/services/SessionManager.ts
- src/services/RealtimeSegmentEngine.ts
- src/durable-objects/ShopperReflex.ts
- src/content/service.ts
- src/content/cell.ts
- src/routes/decisions.ts
- src/routes/realtime.ts
- src/sdk/core.ts
- src/sdk/listen.ts
- src/routes/realtime.sdkContract.test.ts
- src/services/SessionManager.visit.test.ts
- src/content/cell.test.ts
- src/sdk/listen.test.ts
- public/sdk/edge-personalization.esm.js
- public/sdk/edge-personalization.js
- docs/api/01-rest-endpoints.md
- docs/remediation/evidence/W35.02/worker.json

Lead owns all admission/tracker/history/freeze/acceptance. Distinct /root/late_hour_next_review (gpt-6-astra/xhigh) owns review.json. No subdelegation. Preserve all unrelated dirty files. Reuse unchanged accepted assurance; qualify overlapping exact proofs prospectively with prior results retained.

C1: Actual both-host route/service decisions and emitted decision records carry validated first-paint/stored/return-visit context; repeated idle reads are stable and non-mutating; one following accepted live event increments once. Cold/legacy unknown remains unknown until observed. Unknown/invalid inputs do not manufacture cells or effect writes. Both-host legacy attributes agree; tracking/personalization gates respected.
C2: Object HTTP/WS live, restart, absorb and failure paths retain accepted visit/channel/visitor identity; non-live operations do not open visits. Existing commit/recovery, buffered expiry/owner and read-only sort/fatigue controls remain valid.
C3: SDK source and both shipped bundles deliver bounded host-only entry, preserve explicit channel and remove entry during readiness-withdrawal; frozen worker+independent fixed12, same-byte compiler/lint/no new warning signatures/whitespace and SDK write:false byte comparison pass.

Smallest fixed runtime: exactly 3 new grouped cases (2 actual route/object/service groups, 1 source+shipped-SDK transport/withdrawal group), 9 affected existing controls. Update only existing changed-contract fixtures (missing entry no longer direct; free-text cell unknown; hydration URL additive entry; buffered DO fixture carries visit fields). Keep failed attempts and superseding runs.
`node node_modules/vitest/vitest.mjs run src/routes/realtime.sdkContract.test.ts src/services/SessionManager.visit.test.ts src/content/cell.test.ts src/sdk/listen.test.ts src/content/consent.test.ts -t 'W35[.]02|W35[.]01|W22[.]07 (applies age-decayed interest|preserves exact session expiry)|W26[.]04|no entry signals at all|never guesses a channel|acknowledges snapshot refusal before rendered callbacks|is behavior-read-only when cold|hydrates from the snapshot and delivers each slot' --maxWorkers=1 --minWorkers=1`

Static once on final source: existing tsc noEmit/nonincremental/noncomposite with1536MB; ESLint512MB on owned TS files, zero errors/no new warning signature multiplicities relative to pre-edit baseline; scoped git diff --check. Reviewer may reuse static on exact same bytes. SDK artifacts: existing scripts/build-sdk.mjs options/banner via esbuild write:false, apply_patch only for both owned outputs, then write:false byte equality. No install, unrelated emitted build or broad suite.

## Rollback and limits
Retain exact before bytes and dependency pins. Rollback is reviewed inverse of only this task delta, never restoring whole files over user work. No commit/stage/push/deploy/cloud/credentials/customer-data/destructive/external operations. Local synthetic Node actual-module/browser-VM checks are not native workerd, customer acceptance or latency evidence. Source STOP at worker handoff, lead freezes and checks independent record, then updates existing tracker/checkpoint before next task.
