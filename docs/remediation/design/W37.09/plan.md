# W37.09 enforced multi-brand wildcard containment

Root approves the existing local G0 mandate after entry check/status VALID610 exit0, full required governance/canonical W37/W03/F03/F31/F33/N29/customer-clause reads and independent Astra/xhigh preflight. Source-confirmed design case: current verifySdkKey accepts a wildcard key against every canonical tenant. This remains unsafe on an enforced multi-brand stamp; no new executed failing baseline or live configuration claim.

Disable wildcard-derived grants when AUTH_MODE is enforced and canonical tenantConfig has more than one distinct provisioned brand. Reuse that parser's deduplication, absent-default and invalid-manifest semantics. Explicit named grants take precedence, including a key listed under both * and that tenant; such a key cannot use * to reach another tenant. Explicit grants to multiple named brands remain intentional configured grants, not a newly invented unique-key rule. Preserve named-only paths without added registry parsing, missing/unknown401 and wrong-owner403/no-store, canonical context, explicit-key precedence over Bearer, no-key verified JWT, open mode and absent/single-brand wildcard compatibility. Invalid registry never grants wildcard authority. Do not add flags, storage, caching or new registry infrastructure.

Three owned files: src/middleware/edgeAccess.ts, src/middleware/edgeAccess.test.ts, src/index.api-boundary.test.ts. Implementer actor w3709-worker uses resumed Astra/xhigh run /root/w3708_worker; independent reviewer w3709-reviewer uses /root/w3709_review; root alone owns governance/integration/acceptance. Worker additionally owns evidence/W37.09/worker.json; reviewer review.json only. No subdelegation. Initial worker dispatch hit thread limit; successful resumed run preserves model/effort and distinct independence.

C1: actual Worker/workerd two nondefault valid target-capability reads/writes/query-key upgrades reject wildcard reliance before destination calls/state/pending work; named positives inspect exact tenant namespace. Named/wildcard overlap cannot broaden an explicit grant. Existing Hono/helper fixture covers malformed/duplicate/single/default manifests and key/Bearer precedence.
C2: preserve named paths, open/default/single compatibility, W37.08 canonical/CORS and both-host native socket safeguards. Reuse unchanged prior auth/signing/refresh, registry/cron, config/catalog/ODP/consent and erasure dependency assurance; not all old suites rerun.
C3: independent frozen source, full primary outputs, three reversible admission deltas and pins, exact K1 once, bounded verdict and lead acceptance. No full W37/F03/customer/gate/release or North Star relevance/latency/lift closure.

Fixed checks:
K1: node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --testNamePattern="W37.09|W37.08|retains SDK-authorized|W04.02" --maxWorkers=1 --minWorkers=1
K2:
- node node_modules/vitest/vitest.mjs run src/middleware/edgeAccess.test.ts --maxWorkers=1 --minWorkers=1
- node node_modules/typescript/bin/tsc --noEmit --incremental false --composite false
- node node_modules/eslint/bin/eslint.js src/middleware/edgeAccess.ts src/middleware/edgeAccess.test.ts src/index.api-boundary.test.ts --format json --max-warnings 0
- git diff --check -- src/middleware/edgeAccess.ts src/middleware/edgeAccess.test.ts src/index.api-boundary.test.ts
K3: independent actual source/evidence review and exact K1 once after source STOP. Existing fixture's in-memory esbuild write:false only; synthetic bindings/credentials and blocked egress. No new suite or performance programme.

Qualify prior W37.08 whole-source proof before shared edits, retain exact historical acceptance and implemented named-key/CORS remedy; baseline pins and compressed exact owned bytes support review/rollback. Rollback only exact owned deltas under lead review, never restore unsafe authorization or unrelated dirty work. No source write until admission checker passes and explicit GO.

Operator membership/audit, managed provisioning/stamps/resources, customer destinations/SDK distribution, all-store export/erasure, tenant retirement and cross-invocation fencing remain open. Preserve v4 erasure readers/recovery until pending work drains and exact v1-v3 semantics. No deploy/provision/seed/project build/install/migration/cloud/credential/customer-data/external messages/commit/push/destructive operations.
