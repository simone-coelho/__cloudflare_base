# W02.01 — accepted guard and handoff

Lead /root, w01-lead, accepts bounded C1–C3 at 2026-09-07T00:52:13.862Z. Worker /root/w0201_impl and independent reviewer /root/w0201_review are distinct Astra/xhigh runs. The lead read the actual guard, complete test, independent probe/report, worker evidence, failure history and frozen source identities before this disposition.

The shared JWT middleware now rejects signed refresh payloads immediately after cryptographic verification, before authority/auth context/protected dispatch. Only four guard/comment lines and a terminal newline changed in production. Existing access/tool credentials, JSON renewal and independently valid SDK keys remain supported. No session-store lookup or scoring/learning behavior was introduced.

## Accepted evidence

- Artifact [33-file manifest](artifact-manifest-v1.json): 4e20a5d6f511d3e8c36451d14e99318a26e4d7ac126e9e676c3319ace4fa35ef.
- E1 [worker report](worker.md): 06396188652f16d9e69f6e5295e24ee1042940a829972c4e4f2979746a2bf8bf.
- E2 [independent review](review-v1.md): 6f5e2cd6b440bdb391b90f66fda67eabe7122e93c2b4e7ab4860b0b068c90601; exact review-metadata SHA256 982b3a24e0dd9357907e50eb6f5951429d3e9fc0bbf1206926a6b114b4c2cd90.
- [Lead-run checks](lead-checks-v1.json): 99ffa3a3829d2786f26b686dff3a7eb036c790d15fa14c6c3bdeb6533d8336c4. Frozen75/75 (30 focused,45 existing regression) and app TypeScript passed. Independent SDK TypeScript also passed.
- [Independent replay](reviewer-probe-v1.mjs): ab5cffd535c7278ebdc93a8115da563eaf6dfa89f701fa1a6050156e340b1020. Original source permitted16 unauthorized read/PUT/rollback responses,8 account reads,24 KV writes; current guard refused all16 with zero protected operations and unchanged byte snapshots. Valid sub-only tool PUT/rollback and SDK controls succeeded.

C1: real fresh/revoked refresh scenarios were reproduced before the fix and then denied with unchanged config bodies, version/history/index and account/session/audit state. C2: current legitimate token and renewal/role/optional/cryptographic/SDK behavior verified. C3: independent actual source/diff/evidence review plus this separate lead disposition/handoff are complete; no required current check is failing/skipped. Initial negative baseline failures and test-only TypeScript correction remain immutable in retained logs, not relabeled green.

The dependency inventory pins actual application sources/config/lockfile and installed versions, not every installed runner/library executable byte. Proof is local synthetic Node integration, not native KV/D1, full Worker runtime, deployment/customer/SLO acceptance. Global tenancy/logging can precede JWT; only protected destination effects are claimed. Evidence-local .gitignore retains synthetic .log files for a future authorized commit; no global ignore or staging change.

## Preserve and proceed

W02.01 is the only newly accepted code remedy. Full W02 service/access migration, mandatory authority/membership, access/session revocation after all account transitions, onboarding restrictions, signing readiness and abuse/lockout/audit work remain open. N02 missing/zero-length-key forgery stays refuted. No package/finding/G0/G1/customer/release closure follows.

Protected330-file baseline differs only at previously accepted index.ts/api.ts and this authorized auth.ts guard; other preexisting user/bundle/audit/SQLite-sidecar work is preserved. HEAD e49aef83c9a9843dd21479f1b08d53e7709fac41 and canonical doc35 hash34b5c7d286650d879223062be352d244b176c9def6d2ebfb543a2dd7e985aedf are unchanged. No deploy/cloud/real credentials/data, install/seed, git mutation or stored-data deletion occurred. All changes remain local/uncommitted.

Next: admit W01.02 episode2 under plan-v2, make no engine edits, independently rerun its unchanged actual-default-export workerd suite and replace only current-source proof while preserving old acceptance. That revalidation is required because auth.ts is in the old895-file artifact; it is not a repeat inventory or a reversal of the removed API. The standing local G0 mandate already covers it. Updated tracker/journal and actual current/prior transition validation must be retained before final handoff.

Rollback is only selective reversal of this auth diff from before-auth.ts.txt, reopening the bypass; no broad reset. After current-source revalidation, select the next decision-independent G0 slice, with remaining human/external authority boundaries unchanged.
