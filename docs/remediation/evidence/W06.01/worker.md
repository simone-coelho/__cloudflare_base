# W06.01 worker — frozen for independent review

Frozen 2026-09-08 12:36:44 UTC. Three production files and two existing fixtures changed; IdentityStore unchanged. Exact source pins, commands, timestamps and full available outputs are in worker-checks.json.

Durable discovery now precedes deletion, retaining exact targets/actor/cutoff. Conditional R2 create and ETag checkpoints stop failed/conflicting executors; same-selector manual retries survive removed links/pointers. Both bound hosts are cleaned, at most32 steps per request, links last. Strict current targets and tombstone dates/actor are validated. Local status stays separate from physical/external completion (`complete:false`, `erased:[]`).

Final checks: declared identity-route + ledger-erasure suites33/33; app noEmit clean; exact before/current scoped diff and git diff --check pass. Earlier K1 passes remain historical. First compiler failure and pre-crash attempt2's lost completion are retained; final successful runs supersede them. Actual reset classes run against synthetic state; conditional R2 behavior is a fixture, not deployed attestation.

No replay/epoch/concurrent-ingestion or cross-selector transaction, exhaustive/orphan/cache/D1/history/external erasure, retention-policy or customer/release acceptance. Full W06 and D01/D03/D06 remain open. Next: independent frozen source/evidence review and lead disposition; no further worker edits.
