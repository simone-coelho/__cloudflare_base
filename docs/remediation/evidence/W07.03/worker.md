# W07.03 worker handoff

Eight owned source/test files frozen at 2026-09-07T14:09:23.211Z; exact hashes, complete command outputs and original fixture bytes are in worker-checks.json. Baseline.json retains the original seven production sources, exact successful stdout and initial probe-only export failure. No pending processes.

Seven production files replace 49 raw logging sites with constant labels, keeping numeric HTTP status and audience aggregates. ODP event/profile log-only text reads are removed: both ordinary and formerly unreadable HTTP503 responses deliver actual status through callback or tenant-scoped relay. GraphQL business JSON parsing, payloads, storage, fallback/rethrow distinctions and other asynchronous sequencing remain.

Checks (actual outputs/times retained):

- K1: `node node_modules/vitest/vitest.mjs run src/services/telemetry.boundary.test.ts src/telemetry.boundary.test.ts src/content/consent.test.ts --maxWorkers=1 --minWorkers=1` — final 55/55, exit0,16.39s.
- K2: `node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1 -t W07.01` —5/5 selected,19 outside selection, exit0,12.62s.
- Application: `node node_modules/typescript/bin/tsc --noEmit --tsBuildInfoFile /tmp/w0703-typecheck.CGUhg9/application.tsbuildinfo` — final exit0.
- Scoped `git diff --check` over the eight owned paths — exit0.

Initial K1 had four fixture failures (unsupported matcher in three cases; numeric CDP timestamps in one). Initial compiler found matcher types and missing synthetic ExecutionContext.props. Only those fixture expectations/types were corrected; superseding K1/compiler passed. No production rework. Original nine service cases/helpers are byte-identical after imports; all three other fixtures are unchanged.

Eight new grouped cases cover status/body/receipt behavior, GraphQL serialization-free errors, CDP forwarding/store/queue, session deferred storage/fallback/rethrow, feature overrides/fallbacks, segment assignment/seed failure and authenticated malformed handlers plus successful relay with nonfatal D1 failure. All external seams are synthetic.

Limits: not exhaustive per-catch coverage, native socket transport, customer/deployed/SLO or prior full-contract reclosure. Public error bodies and other logs remain; historical data, D06 consent/retention, aggregate access/schema/datasets and full W07 are unresolved. Independent review and separate lead acceptance remain required.

