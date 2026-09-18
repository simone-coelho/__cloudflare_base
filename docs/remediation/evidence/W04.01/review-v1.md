# W04.01 independent review

Disposition: **accept C1–C3 within the admitted local scope**. Reviewer: w0202-reviewer, gpt-6-astra/xhigh; completed 2026-09-07T16:00:55.232Z. Lead acceptance remains separate.

Artifact: `a8d7eff3a36ce88b80323c3f53b9efe2f21f4425466ca76be99d6a6571b494cc` (`artifact-v1.json`, 63 physical pins, 41 relevant local inputs). Contract: `2225c5d17653e7e75b505eb72bbe4adb27c4557179f4b5070d787e8ddb663019`.

## Actual checks

Independent K1, 2026-09-07T15:55:00.867Z–15:55:37.384Z observation, exit0: **46/46**, 22 route + 16 primitive/store + 8 SDK; Vitest duration10.78s:

```sh
node node_modules/vitest/vitest.mjs run src/identity/identity.test.ts src/routes/identity.test.ts src/sdk/identify.test.ts --maxWorkers=1 --minWorkers=1
```

Read-only reproduction of the inspected SDK build options (`write:false`) matched both bundles exactly: ESM28,365 bytes, IIFE30,062 bytes. Final identity check at15:59:00.382Z–15:59:01.603Z passed all63 hashes, exact artifact digest, independently rebuilt41-input graph, both bundle graphs and11 worker outputs/original hashes. These bind the provisional-freeze K1 to unchanged final bytes; no additional K1 run is claimed.

Read complete actual baseline/probe, all three fixtures and their admitted-original diffs, production changes, current guidance, relevant types/config/build and worker proof. Worker final46/46, application noEmit, separate browser-SDK noEmit, build, bundle syntax and scoped diff passed. Neither compiler was duplicated.

## Criteria and rework

C1: missing/unusable verification configuration now refuses before stores/objects/cookies in every mode. Both host choices have signed controls and36 grouped denial observations with zero KV/DO/cookie effects. Binding, expiry, rotation/wildcard, historical site records and route400/409 priority remain. Existing merge/relink/idempotency/history/JWT/privacy assertions are preserved.

C2: provider precedence has no static fallback; retry requires strict successful detach and fresh captured-visitor proof, at most once. Real SDK/router transport passes proof unchanged and verifies409→200→200. Static409, provider/detach failures and pending identity changes are covered. Review found an extra caller-await gap; the corrected caller-side guards and nested-microtask control cover it before detach/adoption.

C3: required independent evidence passes. Baseline syntax/mount failures and both initial TS2352 fixture-cast failures remain recorded; the latter correction changed only the explicit `unknown` cast. Exactly180 W07.04 pins remain unchanged outside its three declared shared changes; original erasure/JWT assertions remain intact. This is historical scope preservation, not old-contract reclosure. Journal186's disclosed62-pin prose typo is not authoritative: this review verifies63, leaving the correction to the lead.

## Limits

Local Node/WebCrypto with synthetic KV/DO/fetch/browser seams, not workerd/browser/deployed/customer acceptance. The graph excludes installed-package and full TypeScript-program attestation. Session capabilities/ownership, rotation/revocation, forwarding, stale cookies/tabs, ABA/generations, erasure and real backend/SSO integration remain open. Unsigned legacy callers now fail closed. No F04/F06/N05/W04, SLO, gate or release closure; no external operations. No pending reviewer processes.

Full commands, outputs, timestamps, source/evidence hashes and limitations: `review-checks-v1.json`, SHA256 `47440776f888c95de510a87c984f48dac2f9ed464e5a6e50acdcc986e109d88e`.
