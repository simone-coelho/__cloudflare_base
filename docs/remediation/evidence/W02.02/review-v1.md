# W02.02 independent evidence review — PASS

Captured 2026-09-07T02:03:11.136Z. Independent verifier `/root/w0202_review`, actor `w0202-reviewer`, explicitly assigned gpt-6-astra/xhigh; distinct from implementer `/root/w0202_impl` and lead `/root`. Evidence **W02.02-E4**, design review supporting C1–C4/K4 with independently executed local synthetic Node integration and selected-router workerd challenges. **Technical evidence for the bounded remedy passes; no implementation rework required.** Lead disposition, acceptance/handoff and tracker registration remain separate.

I read AGENTS.md, execution README, complete document36/checkpoint, the actual admitted task and exact plan, complete canonical W02/F02/F09/N02/N14 and linked verifier qualifications, actual relevant source, all eight tool adapters and their tests, and the frozen worker evidence. My initial board check/status both exited0, VALID with expected historical/superseded warnings. At final record inspection the task was in verification, journal55, with the same contract/artifact. The lead owns current/trusted-prior governance validation; I did not run another full board scan or change governance.

## Reviewed basis

- HEAD `e49aef83c9a9843dd21479f1b08d53e7709fac41`; canonical document35 SHA256 `34b5c7d286650d879223062be352d244b176c9def6d2ebfb543a2dd7e985aedf`.
- Plan `plan-v1.md` SHA256 `c285dc5248b9ce9d93380e18b788c60a79192e8ff97c34cf654e683ca2f6d4b3`; task contract `961e4e1b19fc8e41b2081d795d5778b0c651d1bcdf7c82e778fed2ff2add3acc`.
- [348-file artifact manifest](artifact-manifest-v1.json): digest `e96e57fa6b2fa46bbe92e7caac450c70e6d5340b500fbd8d91eb4f9b5960202b`; manifest file SHA256 `b6bfd09405aa67750439a4ae93ba3d4fa8196e304aa9f7480e9c289a070ddeb5`.
- [Worker handoff](worker.md) SHA256 `b6e93c27fec9f58017853bab5911a5536cd058cde86a9fb4ccf0d6cc989e98bd`; [actual lead checks](lead-checks-v1.json) SHA256 `ca6309c8caddcd7362e356e0881ec6908d23ee57a3670b1500b825b43271d1ca`.
- My independently authored [runtime probe](reviewer-runtime-probe-v1.mjs), prepared before implementation freeze and first executed after release, SHA256 `9a561c20d0302e1226b750e0d681e3e00a39a5a3817a27bc56221a15af10a8c7`. No frozen source, test, probe or worker log was changed during this review.
- Installed versions read directly: Node22.15.0, Vitest1.6.1, Hono4.12.27, jose5.10.0, esbuild0.28.1, Miniflare4.20260625.0, workerd1.20260625.1 and TypeScript5.9.2. Workerd compatibility date2025-06-01; synthetic accounts, sessions, KV data and credentials; enforced edge mode in the runtime probes.

The independently executed collector matched all348 declared identities,43 K1 local inputs,85 Node token-helper bundle inputs, and196/197 before/current runtime inputs. My separate [post-execution hash/graph comparison](reviewer-graph-check-v1.json) rehashed every declared file and compared actual independently emitted graphs. Both my own probe and K2 rerun have exactly the same195/196 filesystem inputs as the retained before/current graphs; only each in-memory wrapper source label is excluded. Every filesystem input is declared. This verifies actual graph coverage, not just copied counts. Package-external K1 traversal, installed package manifests and lockfile are identified honestly; complete runner/binary attestation is not claimed.

## Independent execution

All five commands started at01:59:23.802Z; actual completion was observed by02:00:40.576Z. [Exact commands, observed timestamps and exits](reviewer-checks-v1.json) and complete captured output are retained. All exited0.

| Check | Independently observed result |
|---|---|
| [K1 route integration/regressions](reviewer-k1-v1.log) |108/108 across7 suites, zero skips/failures;32.20s runner duration.33 new signing cases,30 existing refresh-boundary cases and45 existing regressions.|
| [K2 workerd replay/boundaries](reviewer-k2-v1.log) |35 fixtures:5 retained-source reproductions,25 invalid configuration fixtures producing200 unavailable responses,5 successful real flows; outbound0.|
| [K3 eight tool preflights](reviewer-k3-v1.log) |30/30, zero skips/failures;11.125s runner duration.|
| [Independent runtime challenge](reviewer-challenge-v1.log) |819 assertions across27 fixtures;3 original reproductions,18 invalid cases,6 successful flows; outbound0.|
| [Artifact collector verification](reviewer-identity-v1.log) |Exact348-file manifest and scoped graph match.|

K1's exact command is recorded in the checks JSON. The other executions were:

```bash
node docs/remediation/evidence/W02.02/workerd-boundary.mjs
node --test scripts/lib/tool-token.test.mjs
node docs/remediation/evidence/W02.02/reviewer-runtime-probe-v1.mjs
node docs/remediation/evidence/W02.02/lead-artifact-v1.mjs --verify
```

Both independently executed workerd probes load actual auth/health/JWT/config modules and working synthetic stores, use real cryptography, forbid outbound requests and dispose their runtimes. Original replay substitutes only the three retained, explicitly hash-checked original sources in memory; live files are never restored. Missing/empty original keys produced readiness200 and login500 after account persistence, two legacy deletions and migration audit. Placeholder signing produced successful login/session issuance; K2 also reproduced three actual configuration writes with unsafe material. This establishes concrete bad state, not merely an unexpected response code. It does not claim empty-key forgery in workerd.

Current K2 invalid cases preserve account/session/audit/legacy state with no protected method calls or binding reads. Successful32-byte ASCII/UTF8/padded,125-byte ASCII and80-byte UTF8 keys exercise real login-issued access/refresh, renewal, protected reads, config revision1/K7/three puts and refresh-bearer rejection.

My additional probe tests throwing protected-binding getters; malformed login/refresh bodies; extracted invalid bearers; optional authentication; edge SDK delegation; and independently valid SDK credentials. Each of18 invalid cases produces7 configuration denials,12 missing/malformed-header controls and1 SDK success, with zero protected effects. Cases include Unicode blank and padded-placeholder values,31-byte multibyte boundaries and wrong-type issuer/audience.

Six successful additional flows verify both issued signatures, exact issuer/audience, unchanged900/604800-second access/refresh lifetimes, renewal, protected writes, actual logout and fresh/revoked refresh denial before read/write effects. They include32-byte accented and emoji keys,42-byte padded material, and a180-byte ASCII key. The historical fixture label `ascii160` is inaccurate; its emitted `keyBytes:180` is the actual measured size and is preserved without editing frozen evidence. A final case changes the synthetic signing environment during account put; both tokens still verify against the initially validated snapshot. Uncached configuration readback remains revision1/K7 after24 combined fresh/revoked refresh read/write denials across the six flows.

## Criterion assessment

**C1 passes.** The pure helper captures all three values once, rejects wrong types/blank/short/published-placeholder material, and preserves accepted UTF8 bytes and issuer/audience strings. Login and refresh check before storeFor/body parsing, outside token-error catches; mint/verify consume the validated snapshot. Shared JWT preserves missing/malformed-header401 and anonymous optional continuation, then refuses unusable configuration before cryptography, authority/context or protected dispatch. Stable503/no-store responses disclose no material. Readiness does no service probes; liveness remains200. Existing refresh-purpose, untyped credential, crypto, role/permission and SDK behavior remains covered. Four fixture diffs contain only key-literal replacements; no existing assertion was weakened.

**C2 passes.** Required selected-router workerd proof was independently rerun and corroborated by my separate probe. The recorded empty-key runtime correction is preserved. Long/multibyte keys are actually used to mint, renew, verify and authorize writes; helper-only acceptance was not substituted.

**C3 passes within the explicit preflight boundary.** I inspected and independently executed all30 tests. Seven complete actual JavaScript adapter sources run in an isolated VM with an explicit import allowlist, synthetic argv/environment, intercepted fetch/child operations and a catalog-only filesystem stub. Signing configuration is supplied explicitly to the real resolver; no repository settings or real catalog contents are consumed. Invalid configuration asserts zero operations/reads/acquired credentials/output. Actual resolver output is checked for historical subjects, roles/no-role claims, optional typ, lifetimes and shared-verifier compatibility. Explicit CLI values take priority over environment tokens; blank/missing flag values cannot silently fall back. HTTP(S), userinfo-free parsed loopback rules and console's unconditional local restriction are preserved. Holdout passes the same token to its intercepted import child.

The shell executes only its exact credential prelude with an explicit synthetic environment and screenshot-read stub; failure exits before that read and all later curl commands. Successful bearer/configuration paths preserve the rehearsal token. Later console/identity bearer use is source-reviewed unchanged behavior: their positive VM tests stop at the first non-bearer operational request. Full workflows, seed/customer effects and browser/ledger acceptance are not claimed.

**C4 technical evidence passes.** I reviewed actual source/diffs, worker logs, original-source snapshots, frozen graph identities, [worker compiler/syntax results](worker-checks-v1.json) and [lead checks](lead-checks-v1.json). Worker application/SDK TypeScript and tool/shell/diff syntax checks exited0; the lead independently repeated ordinary application TypeScript, artifact and diff checks and rehashed330 protected baseline files with no unauthorized delta. Initial TS6379 command failure, explicit-helper-include/header-type errors and superseding results remain retained. The explicit shared .mjs include is the only substantive tsconfig change. Earlier raw/refresh test hashes remain unchanged. No required technical check was skipped or left failing.

## Disposition, limits and handoff

Accept E1/K1, E2/K2 and E3/K3 as technical evidence on this artifact and this E4 independent review as K4 support. The lead must separately inspect/register the review, disposition C1–C4 and complete acceptance/handoff/checkpoint. This report does not close the task by itself and does not supersede earlier W01.02/W02.01 acceptance.

These are source-confirmed/local synthetic and selected-router local-runtime results, not default-export, native D1/KV, deployed configuration, complete operational adapters, customer, privacy/business, performance/SLO or release acceptance. Recorded runner durations are not benchmarks. The key check establishes minimum suitability, not entropy, actual secret installation or safe rotation/recovery. The full health dependency contract, global entrypoint tenancy/logging, token-type/service/session migration, temporary-password enforcement, membership and N14 abuse/lockout/audit budgets remain outside this remedy.

Prior W02.01/W01.02 protections remain implemented; their old evidence and acceptance histories are retained/reopened and require separately admitted current-source verification. This task's regressions cannot be backdated into those acceptances. Full W02 and all finding/package/gate/customer/release obligations remain unaccepted. Relevant source/dependency/configuration/test/evidence changes invalidate this reviewed basis and require scoped revalidation. Selective reversal would restore unsafe signing behavior; no reversal was performed.

No reviewer command/process remains pending. I wrote only my new evidence/probe/report files; no engine/tool/governance edits, deployment, cloud/credential/customer-data operation, operational seed, installation, git mutation, external message or further delegation occurred. Next: lead record the bounded disposition and durable handoff, then admit the planned prior-task current-source verification episodes. No new user decision is needed for those already authorized local checks.

