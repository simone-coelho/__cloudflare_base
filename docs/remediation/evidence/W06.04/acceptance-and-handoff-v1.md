# W06.04 lead acceptance and handoff

Accepted only the bounded known-subject tenant CACHE cleanup in frozen artifact 03b7b3657aab005204abce531a282289d4a045b3d7b1a60e2562cd572ef1b911, after independent C1–C3 PASS. Worker and reviewer exact K1 each passed 29/29; final app noEmit and scoped diff/whitespace passed. The worker's first noEmit failure and its fail-closed typing correction remain in the evidence.

The implementation freezes all three exact profile keys and strictly paginated override keys for every immutable discovered target before deletion, checkpoints each delete under the existing 32-attempt job, preserves tenant/non-target data, and resumes ambiguous deletes/checkpoints. Persisted v1 numeric cursors retain their exact historical meaning and explicit CACHE noncoverage; completed v1 work is never relabeled as v2.

This is local synthetic/source-confirmed task acceptance, not full W06, finding, gate, customer, deployed, SLO or release acceptance. Email/account aliases, in-memory caches, orphans/full scans, concurrent writers, stale-cookie/deletion generations, ring/seen, D1, Analytics Engine/log/external deletion and approved retention/accountability remain open; D03/D06 remain pending. Rollback must preserve a v2-compatible retry reader for persisted v2 jobs.

Handoff: select the next bounded decision-independent residual from document 35. Do not infer D03 concurrent authority or D06 retention/re-entry policy, and do not broaden into a new validation programme.
