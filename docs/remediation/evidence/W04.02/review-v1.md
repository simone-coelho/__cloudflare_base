# W04.02 independent review

Disposition at 2026-09-07T17:36:30.569Z: **C1–C4 pass within the admitted local scope; recommend lead acceptance.** Reviewer: w0202-reviewer, gpt-6-astra/xhigh, independent of implementation; no delegation.

Artifact [artifact-v1.json](artifact-v1.json): `a7e61c32e70c549951f672798f4034aed0d3c10f999a8ceb01180c9844ca2f4d`. Contract: `6e17e12bea1e9228f9abad560b3f449e866cdcc3657f06d5359f8769a7f71a8e`. All 211 physical pins match, including 35 frozen outputs and 189 local graph inputs; all 34 retained original source contents hash correctly. Source freeze: 2026-09-07T17:29:01.994Z.

## Independent results

Exact commands, complete outputs, UTC launch/observed-completion times and identity checks are in [review-checks-v1.json](review-checks-v1.json), SHA-256 `f4bfe8506c7bede5c9b89114feff9a784e6178e1b43f4aad80e1a050bed0c4b4`.

| Check | Result | UTC launch → observed completion |
|---|---|---|
| Exact K1, seven server fixtures | 72/72, exit 0 | 17:30:57.546 → 17:32:02.093 |
| Exact K2, four SDK fixtures | 25/25, exit 0 | 17:30:57.546 → 17:31:20.881 |
| Exact K3, existing workerd fixture, `-t W04.02` | 2/2, exit 0; 25 historical cases filtered | 17:30:57.546 → 17:31:21.141 |
| In-memory graph/bundle reproduction | 189/189 inputs; both bundles byte-identical | 17:33:02.668 → 17:33:04.151 |
| Final artifact/contract/original identity | zero mismatches, exit 0 | 17:34:28.751 → 17:34:30.263 |

ESM: 35,795 bytes, `bb3a6d0386ea95a9ec280fc8505e08a60689a6f818360747cc32fc0f5ca6677f`. IIFE: 37,866 bytes, `90c93376330a7dc0b761bb5f5c760a2d23a015c985ea17d115216fab2966b056`.

## Criterion disposition

- C1: Actual crypto/router controls reject missing, forged, expired, wrong-tenant and conflicting target authority before protected effects. Bootstrap does not certify supplied victim IDs. Backend proof and owned anonymous source precede linking. Actual SDK/router retry forwards proof unchanged.
- C2: Source and focused assertions confirm exact profile ownership, terminal anonymous-forward refusal, working named routes on both hosts, canonical DO profile SID and separately retained browsing attribution. SDK coalescing, scoped persistence, authenticated keepalive/subprotocol, local generation/callback guards and failed-logout forgetting are present. Consent/deferred-write and deterministic-order controls pass. Selected analytics/preferences counts remain 1 read and 3 reads/2 writes on the session host; DO positives use zero session-KV calls, not zero total work.
- C3: Actual exported DO classes run in workerd with real 101 upgrades: both hosts prove welcome/heartbeat, wrong-subject closure, private delivery before expiry, refusal/closure after expiry, and an unexpired receiving control. The DO case also proves owned frame ingestion, matching SID and page-view effect. Outbound attempts are asserted zero.
- C4: Reviewed actual baseline, original-to-current source, all declared fixtures, guidance/types/config and all 17 retained worker check records. Final app/SDK noEmit, build, syntax and scoped diff exit 0 were inspected, not redundantly compiled. Worker proof SHA `aa7752bad9d60fcdb95b9eb3be0b1223b41ee585ea2c36697e5e04bd33689370`; worker report SHA `009c7018d51e7dee231563a775ea6d31ce3f30a41ddbd0c68e456d57d60ac72a`.

The initial TextDecoder compiler failure and two obsolete fixture expectations remain retained. Source-review rework corrected pre-store ownership, DO continuity, attribution, SDK transition/callback gaps and restrictive cookie forwarding; these are not mislabeled test failures. The final false-only hint is applied after ownership inside DO serialization; the cold-owned control retains only refusal storage and true cookies cannot enable it.

Limits: synthetic bindings/browser host in K1/K2; native local runtime in K3, not deployment, full browser or every hibernation/alarm lifecycle. The packages-external graph is not installed-dependency/full TypeScript-program attestation. Copied unexpired grants, cross-tab/server revocation, admitted in-flight effects, transactional consent/deletion, KV consistency, forwarding lifecycle and other perimeter interfaces remain open. This is neither all-egress consent proof nor full W04/F04/F06/N05, customer, SLO, historical-contract or release acceptance. No reviewer processes remain. Root owns E1–E4 registration and final signoff.
