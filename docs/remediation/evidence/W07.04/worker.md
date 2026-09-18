# W07.04 worker handoff

Source/tests are frozen; no worker processes remain. Root/reviewer own independent acceptance. Exact commands, UTC launch/completion-observation times, complete outputs, failures, final 20-file hashes and original two fixture bytes are in `worker-checks.json`. Original 18 production bytes remain in immutable `baseline.json`.

The 18-file production batch replaces raw log arguments with constant labels/numeric diagnostics. Monitor AE removes only the problem-detail blob tail; original four category blobs/four doubles/index, returned result, detailed KV data, alerts/cooldown and buffering remain. Config retries/fallback/write, provider memoization/no-decision-event/fallback, DO asynchronous behavior, scene queue-to-inline, webhook, tenant and scheduled jobs are preserved.

Final corrected-source checks, launched 2026-09-07T15:03:48Z: K1 **61 passed** (original55 + six compact groups), K2 **six selected passed**, **19 outside declared filter**, application noEmit **exit0** using task-specific /tmp metadata, scoped20-file diff check **exit0**. K1 duration52.74s; K2 duration41.40s.

Correction history is retained, not overwritten: first K2 failed on assumed concurrent log order; second failed on `:everyone` versus actual `:*` key. Fixture-only corrections produced an initial six-pass run. Independent review then found stored count strings could enter day-report logs. Only those two console arguments gained finite-number guards. One seeded hourly aggregate in the existing scheduled group proves original stored/raw report values persist but logged counts become -1 without markers. Final K1/K2/noEmit supersede all pre-review passes.

Limits: representative synthetic execution plus repetitive source review, not every catch path or deployed/runtime-log privacy attestation. Original17 service assertions and five selected Worker controls remain; old full contracts are not reclosed. Public/retained diagnostics, alerts, historic data, consent/schema/access/retention, SDK/platform logs and customer/SLO/release acceptance remain separate. No external operations, installs, real credentials/data or git mutations.

Next: independent frozen-artifact K1/K2 reruns and review; lead disposition. Rollback is limited to owned hunks using retained original18 sources and two fixture originals, preserving unrelated work.

