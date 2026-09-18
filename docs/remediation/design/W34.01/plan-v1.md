# W34.01 — withdraw external scoring from live decisions

Standing approved local G0 mandate; lead /root, worker /root/w0202_impl, independent reviewer /root/w0202_review, both gpt-6-astra/xhigh. Updated AGENTS.md preserves the user's proportionate-execution rule.

## Scope and baseline

Read complete doc35 W34/F30 and §4 North Star: deployment-enforced off/zero calls; no service-name exemption; any accepted seam needs destination/data/candidate/budget controls, immutable offline publication, fallback/cancellation/replay/privacy proof. This task provides only OFF containment. Publication, authorized seam enablement, customer wording/decisions and deployed acceptance remain open. No runtime-model or table opt-in is added.

Actual five-case baseline is evidence/W34.01/baseline.json, SHA4b3ff3702bcaa0d59a11b5dbfedb7d85883d4bac7608c873577f7785a91a7d8a. Ordinary actual-service decision selects a at0.45 with zero external effects. Stored HTTP/binding/AI each makes one intercepted call carrying affinity and draft candidates; table makes one ext:* read; each changes choice to n at0.5. All five replay equal. Only synthetic working KV/DO and in-memory bundling; original source/command/output retained. Reported52 local inputs are a count, not a captured full graph. No additional baseline reconstruction is required.

## Change and checks

Worker owns only src/content/service.ts, existing src/content/consent.test.ts and its new W34.01 worker evidence. Remove the sole production scoreExternal invocation, external request construction and adapter dependency reads. Configured positive-weight/non-default requests receive existing unavailable metadata with a constant truthful deployment-policy reason and ms0; no contribution or captured external scores. Off is enforced by this deployed code artifact, without an enabling environment value. Existing stored settings cannot bypass it. Preserve ordinary decisions, default/consent/gamma behavior, pure adapter/scoring helpers and historical replay. Table lookup is deliberately withdrawn until its publication/authority is separately accepted.

C1/K1: extend the existing working service fixture with bounded HTTP, binding, AI and table zero-effect cases, ordinary/absent/zero-weight/default controls and disabled-receipt replay. Reuse existing gamma/ranking/consent/historical replay checks. Run only:

`node node_modules/vitest/vitest.mjs run src/content/consent.test.ts src/learn/phase3.test.ts src/content/decide.test.ts src/learn/holdoutArms.test.ts --maxWorkers=1 --minWorkers=1`

C2/K2: independent actual source/baseline/assertion/result review and K1 rerun; application TypeScript with noEmit and task-temporary build metadata, scoped diff/source identity and residual handoff. No new harness, workerd, SDK/auth/tool matrix, benchmarks, infrastructure or customer test programme. This is local synthetic integration/source proof, not an SLO.

## Admission and handoff

Root retains source/worktree/check baseline, approves exact contract after independent design challenge, and preserves/reopens affected W02.03 broad current-artifact proof before changing service.ts. Earlier security code remains unchanged; historical assurance is not backdated or automatically reclosed. Prior proof reconciliation stays recorded, while this independent North Star G0 remedy takes priority under the user's throughput direction.

Root alone owns tracker/journal/plan/manifest/acceptance; reviewer owns only new review evidence. No further delegation or external/deployment/credential/customer/commit operations. Freeze source/proof once; independent reviewer accepts or identifies a concrete defect; lead records bounded acceptance and concise handoff. Rollback is selective reversal of this exact diff and would restore the unsafe external path, requiring reopening; never reset unrelated work.
