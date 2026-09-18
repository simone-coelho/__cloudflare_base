# W22.08 — Retain recent decisions by occurrence time

Scope: DecisionRing append retention only, plus its existing learn.test.ts fixture. Document35 W22/F16/F17/F19/F22/N10/N23 requires shared identity, durable sink reconciliation, versioned histories/attribution and product evidence; this slice prevents one forward late-arrival loss, not full closure. W30 historical reconstruction and W23 full order/recovery obligations remain open. Doc22 §3.3 specifies the visitor's last 200 decisions or seven days. Customer-neutral deterministic evidence, no new infrastructure.

Baseline: actual append reconciles full records, combines retained plus unique arrivals, age-filters then slice(-200) without sorting. A delayed older record can evict a newer retained decision used by a later correlated outcome. Hourly folding already sorts timestamped decisions. This is a source-confirmed design case, not a claimed failed runtime reproduction. Entry board VALID1862, both exits0/drained; dirty tree and prior W22.07 fix preserved. Root and distinct Astra reviewer agree no new lifecycle/retention choice is needed. Reviewer's initial ID tie-break suggestion was withdrawn because it would change equal-time first/last semantics.

## Contract

C1. After existing full-cohort ownership/tombstone/collision reconciliation, sort a NEW combined age-eligible ring by numeric ts ascending, stably, before existing last-200 projection. Retain the most recent occurrence times whether arrivals are chronological, reversed, interleaved or split across calls. Equal-time ties retain existing old-before-new and input order; do not introduce ID ordering, deduplicate ambiguous legacy rows, mutate stored/input arrays or imply full equal-time permutation invariance.

C2. Preserve original payloads, 7-day ring/90-day index age filters, current reference clock, index contents/order, physical/accepted/duplicate/cutoff counts, capacity guards, serialization, conditional refusal and save/cache failure behavior. Demonstrate actual correlated original-time outcome forwarding from a newer decision that the old implementation would evict, including object recreation. No new retention/history, policy windows, current-interest effects, receipt schema or cross-call statistics idempotence. Previously evicted history cannot be recovered here.

C3. Exactly two grouped additions in existing learn.test.ts: (1) distinct-time single/multi-batch permutations, full-cap retention and stable equal-time boundary/unaltered input; (2) actual retained-decision original-time correlation after late append and restart with exact forwarded credit. Reuse existing fixtures. Run them with three unchanged controls: W26.03 atomic retries/collision/ambiguous save, W06.06 inclusive erasure suppression, W10.02 request/candidate bounds. Worker and independent reviewer each run fixed5 once on final bytes. Full compiler1536 no-emit, two-file scoped lint no new warning signatures versus baseline, and whitespace. Root reviews exact two-file delta. No broad suite/build/install or runtime infrastructure programme.

Runtime: `node node_modules/vitest/vitest.mjs run src/learn/learn.test.ts -t 'W22[.]08|W26[.]03 atomically|W06[.]06 suppresses old|W10[.]02 bounds actual' --maxWorkers=1 --minWorkers=1`

Static: full existing TypeScript compiler with --max-old-space-size=1536 --noEmit --incremental false --composite false; ESLint on the two owned files with baseline warning ceiling/no new per-file signatures; git diff --check on those files. Reuse accepted W22.07 unchanged artifact and current unchanged policy/fan/stats/erasure dependencies; do not rerun their suites.

## Ownership, authority, rollback

Sole worker /root/w2206_worker (actor w2206-worker), only src/durable-objects/DecisionRing.ts, src/learn/learn.test.ts and evidence/W22.08/worker.json. Independent /root/late_hour_next_review (actor w2205-reviewer), review.json only. Both gpt-6-astra/xhigh, no subdelegation. Root owns admission/tracker/journal/freeze/acceptance. Source GO after recorded approval; missing or stale proof is not a pass.

User Continue reuses bounded local remediation authority. No commit/stage/push, deployment/provisioning/cloud/credentials/customer-data/destructive/external action, new retention or customer/scientific policy. Full D04/D06/W24/W30 remains pending; neither valid receipt nor a current ring supplies missing historical evidence. Rollback only this admitted two-file delta via reviewed patch, never restore dirty files wholesale. Handoff records actual checks/rework/limitations and next action before yielding.
