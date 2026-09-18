# W06.01 acceptance and handoff

Accepted by w01-lead (/root) at 2026-09-08T12:48:18Z after independent w0601-reviewer PASS C1–C3 at 2026-09-08T12:47:21Z. Artifact `0976bb2e00d968d006c8e1bff3f1f626682c19f2260c19401ea9e75d8b1f64d3`; plan and contract unchanged.

Implemented: erasure discovery and exact target state is durable before deletion; conditional create and ETag checkpoints make same-selector failures manually resumable and stop conflicting executors. Both configured profile hosts are cleaned, work is bounded to 32 attempts per request, identity links are removed last, same-cutoff tombstone progress is preserved, and malformed state or failed destination acknowledgments fail closed. The route now returns honest 200/202/409/503 status while keeping `complete:false` and `erased:[]` until physical/external deletion is proven.

Evidence: worker final existing-suite K1 33/33, app noEmit and scoped diff pass; independent exact K1 once 33/33 plus actual source, full worker history, 76 frozen pins and 63-input graph pass. The initial compiler failure and crash-lost attempt remain recorded. No new suite, build, deployment or infrastructure programme was added.

North Star: the deterministic affinity/ranking/content/SDK hot path is unchanged. This remedy improves privacy correctness and operator truthfulness without adding work to personalization decisions.

Limits: Bounded same-original-selector, manually resumable immediate-local erasure only. Actual local Hono/identity/ledger/ShopperReflex/DecisionRing code with synthetic tenant KV/R2 conditional-write and Durable Object state; no deployed/native R2/CAS, runtime latency/SLO, customer or release acceptance. No deletion epoch/replay or concurrent-ingestion/cross-selector transaction, uncapped/orphan discovery, CACHE/seen/D1/historical telemetry/log/external reconciliation, physical ledger rewrite/retained suppression/retention accountability, or D01/D03/D06 policy approval. Both configured profile hosts only; unbound destinations remain explicit. Full W06 and linked finding/gate scopes remain open; W05.08 shared-input assurance remains qualified, not reaccepted.

W06.01 closes only this bounded local criterion. It does not close W06, F04/F06/F18, a gate, customer acceptance or release. No deployment, cloud, credentials, customer data, commit or push occurred.

Next: Inspect and admit the next decision-independent W06 remedy for deletion epoch/replay and stale-cookie or delayed-ingestion resurrection. Keep physical rewrite, external reconciliation, retention policy and customer decisions explicit; do not reopen this accepted local retry task merely to grow test coverage.

Final existing board check/status and trusted-journal comparison follow closure and will be retained in final-checks-v1.json. They check record consistency, not engine performance.
