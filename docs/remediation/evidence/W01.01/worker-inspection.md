# W01.01 worker source-inspection evidence

Worker: /root/w01_inventory (gpt-6-astra, xhigh). Lead: /root. Independent verifier: /root/w01_boundary_review. This record supports K1 only; it is not the independent K2 review, lead acceptance, implemented enforcement, customer acceptance or release authorization.

## Authority and artifact freeze

The worker read the repository AGENTS instructions, remediation README, governance protocol and RESUME; the current W01.01 task/criteria; complete doc35 W01, F01/F03/F25/F33, N01/N03/N04 and applicable §4/§7 clauses; linked historical findings; and the complete [approved plan](../../design/W01.01/plan-v1.md) and [authorization](authorization.md). Preflight was read-only. The lead admitted W01.01 at journal sequence 5 before output work. Only the four artifact files below and this evidence file were edited, using apply_patch. No other agent was delegated by this worker.

Artifact freeze was announced to the lead at **2026-09-06T21:56:19Z**. These four files will not change without explicit rework notification and renewed identity/review. They are workspace-local/uncommitted; HEAD is the inspected checkout, not a commit containing these new outputs.

| Artifact | SHA256 |
|---|---|
| [inventory.md](../../design/W01.01/inventory.md) | `381de8d39f76e1dba1a09dc47d792fa8eda870e4aab2b72155c0e0a96e59fc70` |
| [boundary-matrix.md](../../design/W01.01/boundary-matrix.md) | `f836da14fec7b2ca86cb27c003357f7f048a8bd535ae0f88a9c7aff032073899` |
| [source-route-manifest.json](../../design/W01.01/source-route-manifest.json) | `8e416da07db15b5ad87ef87b2ddab9f1279080665f5c7fa810c3b2798b5e0871` |
| [inspect-routes.mjs](inspect-routes.mjs) | `803bf9fbda3bcb2c05da6f551e37d5bd47958e072f1e34ba4eb5315d94926c9d` |

Source basis: branch `feature/real-time-personalization`, HEAD `e49aef83c9a9843dd21479f1b08d53e7709fac41`, Node v22.15.0. Canonical doc35 SHA256 is `34b5c7d286650d879223062be352d244b176c9def6d2ebfb543a2dd7e985aedf`; approved plan SHA256 is `ec208c6841f9b7ccfcd526c336e7761ba4bf33fc6e7d92d26762d0d514c49060`. The source-route manifest hashes 200 non-test source files, 18 dependency/configuration files and 361 public files (579 inputs). Evidence, review, signoff, mutable governance records and this record's own hash are deliberately outside that manifest. The lead's [artifact-manifest-v1.json](artifact-manifest-v1.json) adds approved scope/plan/baseline/authority/handoff-contract inputs and the four frozen outputs: 588 files, aggregate digest `4b908ea19ae17877a8f71380e0f683ac2972aac02380322930e9adead08c0e5e`. This is the artifact basis for reserved evidence ID W01.01-E1; reservation is not evidence registration or acceptance. The lead separately records this report hash.

## Executed K1 outcome

Claim level: **source_confirmed only**. The source-only helper parses installed TypeScript ASTs, resolves local Hono imports/mounts, records registration positions and scans direct Hono fetch calls. It reads files and emits stdout; it never imports application modules, calls a handler, writes a file or makes network requests.

| Check | Actual result |
|---|---|
| Helper syntax | `node --check` exited 0. |
| Mount/route enumeration | 26 mounts; 185 explicit endpoints: 91 GET, 84 POST, 5 PUT, 3 DELETE, 2 PATCH. No explicit HEAD/OPTIONS/all/on route registration. |
| Additional dispatch | 91 GET-derived HEAD handlers; 20 middleware registrations; three direct Hono fetch dispatches (root app.fetch and two live→realtime.fetch calls). Pre-Hono Agents and asset handling are separately documented, not counted as Hono endpoints. |
| Static registration uncertainty | No computed/conditional/unsupported registration and no unmounted Hono router detected in inspected non-test source. This is bounded to the actual source patterns; it is not a general-purpose framework parser. |
| Independent lexical cross-check | A separate regular-expression scan discovered each actual `new Hono` identifier, found all 185 endpoint source-line locations and 26 mounts, and matched the manifest's endpoint source-line multiset exactly. Manual source reading checked ordering/alias/dynamic parameter semantics. |
| Determinism and saved output | Two fresh helper stdout runs were byte-identical; both matched saved source-route-manifest.json byte-for-byte. |
| Source and asset identity | All 579 manifest input hashes matched current files; all 330 protected files in the lead's source-baseline.json matched unchanged. |
| Human-readable route table | Exactly 185 ID/method/path/source rows, equal in order and content to manifest routes. |
| Design links | 344 relative Markdown links checked after this evidence file was created; no missing file or out-of-range #L line target. Semantic heading anchors and deployed-link rendering were not runtime-tested. |
| Proposed tests | NT01–NT26 are 26 unique cases. They are proposals, not executed runtime tests. |
| Governance read-only checks | board check and status exited 0 / Tracker VALID while W01.01 remained in_progress; 41 W scopes open, 10 human decisions pending, all gates not_assessed, release not_authorized. |

Installed versions retained in the manifest: Hono 4.12.27, Agents 0.16.2, Partyserver 0.5.8, @cloudflare/ai-chat 0.8.6, Wrangler 4.105.0 and TypeScript 5.9.2. Hashes identify inspected local dependency bytes, not a deployed artifact.

Manual K1 reading covered every mounted route module and relevant downstream auth/tenant/store/DO/dispatcher/connector/SDK/model/queue/job source, plus the installed Hono HEAD/compose/CORS and Agents/Partyserver/AIChat dispatch. The inventory links the precise source positions used for each family and destination. It explicitly distinguishes source-possible effects from an actually executed effect.

Important reconciled qualifications are retained: Agent forwarding keeps the original URL, so exact-path DO HTTP APIs are not automatically exposed; upgrades and RateLimiter/AIChat receiving behavior differ. Generic /api exposes only its actual raw CACHE/STORAGE/queue/StateManager verbs. HEAD executes GET with the original raw method and content/config authorization ordering differs. Global CORS OPTIONS precedes later Hono gates but does not cover Agents/assets. SDK Bearer fallback occurs only without a nonempty supplied SDK key. JWT middleware does not require exp or access-token type/revocation/membership merely by invoking jwtVerify. Signals queued:true is isolate memory, not EVENT_QUEUE; experiment gate-off/failure still writes CACHE; scene queue failure can generate inline; live-ops and operator GETs can seed CACHE; live calls a child router directly. Identity erasure does not invoke ODP deletion. Earlier draft wording about ODP erasure and shot logging was corrected before artifact freeze; no execution claim was made from that wording.

## Exact retained verification commands

All commands below were executed in the repository root. These are read-only checks. Source excerpts were also inspected with cat/sed/rg during the investigation; the retained repeatable commands below are not represented as a complete terminal transcript.

```sh
git status --short
node scripts/remediation/board.mjs check
node scripts/remediation/board.mjs status
node --check docs/remediation/evidence/W01.01/inspect-routes.mjs
node docs/remediation/evidence/W01.01/inspect-routes.mjs --summary
rg -n 'new Hono' src --glob '*.ts' --glob '!*.test.ts' --glob '!*.spec.ts'
rg -n 'routeAgentRequest|app\.fetch|app\.route|app\.use|realtimeRoutes\.fetch' src/index.ts src/routes/live.ts
rg -n 'run_worker_first|not_found_handling|binding =|class_name =|directory =' wrangler.toml
sed -n '1,125p' src/middleware/auth.ts
sed -n '1,120p' src/middleware/edgeAccess.ts
sha256sum docs/remediation/design/W01.01/inventory.md docs/remediation/design/W01.01/boundary-matrix.md docs/remediation/design/W01.01/source-route-manifest.json docs/remediation/evidence/W01.01/inspect-routes.mjs
```

Helper determinism / saved-file equality (exit 0; repeat_equal=true, saved_equal=true):

```sh
node --input-type=module -e 'import fs from "node:fs"; import {execFileSync} from "node:child_process"; const p="docs/remediation/evidence/W01.01/inspect-routes.mjs"; const a=execFileSync(process.execPath,[p]); const b=execFileSync(process.execPath,[p]); const saved=fs.readFileSync("docs/remediation/design/W01.01/source-route-manifest.json"); const result={repeat_equal:a.equals(b),saved_equal:a.equals(saved)}; console.log(JSON.stringify(result)); if(!result.repeat_equal||!result.saved_equal) process.exitCode=1;'
```

Protected baseline (exit 0; baseline_files=330, changed_or_missing=[]):

```sh
node --input-type=module -e 'import fs from "node:fs"; import crypto from "node:crypto"; const b=JSON.parse(fs.readFileSync("docs/remediation/evidence/W01.01/source-baseline.json","utf8")); const failures=b.files.filter(x=>!fs.existsSync(x.path)||crypto.createHash("sha256").update(fs.readFileSync(x.path)).digest("hex")!==x.sha256).map(x=>x.path); console.log(JSON.stringify({baseline_files:b.files.length,changed_or_missing:failures})); if(failures.length)process.exitCode=1;'
```

Independent lexical enumeration (exit 0; GET91/POST84/PUT5/DELETE3/PATCH2/mount26, total_explicit=185, source_line_set_equal=true):

```sh
node --input-type=module -e 'import fs from "node:fs"; const m=JSON.parse(fs.readFileSync("docs/remediation/design/W01.01/source-route-manifest.json","utf8")); const counts={}; const found=[]; for(const {file} of m.source_hashes.filter(x=>x.file.endsWith(".ts"))){const s=fs.readFileSync(file,"utf8"); const names=[...s.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*new Hono\b/g)].map(x=>x[1]); if(!names.length)continue; const re=new RegExp("\\b(?:"+names.join("|")+")\\.(get|post|put|patch|delete|head|options|all|on|route)\\(","g"); for(const r of s.matchAll(re)){counts[r[1]]=(counts[r[1]]??0)+1; if(r[1]!=="route")found.push(file+":"+(s.slice(0,r.index).split("\n").length));}} const expected=m.routes.map(x=>x.file+":"+x.line).sort(); const same=JSON.stringify(found.sort())===JSON.stringify(expected); console.log(JSON.stringify({independent_registration_counts:counts,total_explicit:found.length,source_line_set_equal:same})); if(!same)process.exitCode=1;'
```

Current source/configuration/dependency/asset hashes and exact route-table equality (exit 0; hashed_inputs=579, hash_mismatches=[], route_table_rows=185, table_equal=true):

```sh
node --input-type=module -e 'import fs from "node:fs"; import crypto from "node:crypto"; const m=JSON.parse(fs.readFileSync("docs/remediation/design/W01.01/source-route-manifest.json","utf8")); const inputs=[...m.source_hashes,...m.dependency_hashes,...m.public_asset_hashes]; const bad=inputs.filter(x=>!fs.existsSync(x.file)||crypto.createHash("sha256").update(fs.readFileSync(x.file)).digest("hex")!==x.sha256).map(x=>x.file); const text=fs.readFileSync("docs/remediation/design/W01.01/inventory.md","utf8"); const rows=[...text.matchAll(/^\| (R\d{3}) \| ([A-Z]+)(?: \(\+ HEAD\))? \| `([^`]+)` \| \[([^\]]+)\]/gm)].map(x=>({id:x[1],method:x[2],path:x[3],source:x[4]})); const tableEqual=JSON.stringify(rows)===JSON.stringify(m.routes.map(x=>({id:x.id,method:x.method,path:x.path,source:x.file+":"+x.line}))); console.log(JSON.stringify({hashed_inputs:inputs.length,source:m.source_hashes.length,dependency:m.dependency_hashes.length,assets:m.public_asset_hashes.length,hash_mismatches:bad,route_table_rows:rows.length,table_equal:tableEqual})); if(bad.length||!tableEqual)process.exitCode=1;'
```

Link and proposed-case check (exit 0; checked_links=344, missing=[], invalid_line_targets=[], negative_test_cases=26, unique_case_ids=26). The first run before creating this report found only the two expected links to worker-inspection.md missing; the repeated run after creation found none:

```sh
node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; const docs=["docs/remediation/design/W01.01/inventory.md","docs/remediation/design/W01.01/boundary-matrix.md"]; const missing=[]; const invalidLines=[]; let checked=0; for(const file of docs){const s=fs.readFileSync(file,"utf8");for(const hit of s.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){if(/^(https?:|#)/.test(hit[1]))continue; const [target,anchor]=hit[1].split("#"); const p=path.resolve(path.dirname(file),target); checked++;if(!fs.existsSync(p))missing.push({file,target});else if(/^L\d+$/.test(anchor??"")&&Number(anchor.slice(1))>fs.readFileSync(p,"utf8").split("\n").length)invalidLines.push({file,target,anchor});}} const matrix=fs.readFileSync(docs[1],"utf8"); const cases=[...matrix.matchAll(/^\| (NT\d{2}) /gm)].map(x=>x[1]); console.log(JSON.stringify({checked_links:checked,missing,invalid_line_targets:invalidLines,negative_test_cases:cases.length,unique_case_ids:new Set(cases).size})); if(invalidLines.length||missing.some(x=>!x.target.endsWith("worker-inspection.md")))process.exitCode=1;'
```

## Unsuccessful or incomplete inspection attempts

- An initial independent lexical scan used only receiver names matching app or a Routes suffix. It exited 0 but found only 91 explicit registrations, not 185; this was an incomplete diagnostic, **not** a pass. Inspection of all `new Hono` declarations identified unsuffixed names (api, auth, meridian, etc.). The corrected identifier-discovery command above matches all 185 source lines. The AST helper's manifest was not changed to fit the failed shortcut.
- Early package-metadata resolution through package exports reported ERR_PACKAGE_PATH_NOT_EXPORTED for installed Hono/Agents package.json. Direct installed-file reads succeeded; no packages were installed or application imports substituted.
- Early rg/sed attempts against guessed split SignalProvider/adapter file paths and some guessed source filenames returned missing-file errors. Actual source was found with rg --files and read at the paths now linked in the inventory. These exploratory attempts are not passing evidence and their initial guessed command strings are not retained as a replayable check.
- Some large read outputs were truncated by tool output budgets; relevant files/sections were read again in narrower windows. A truncated read was not used as the sole basis for a complete-file instruction or a route-family claim.
- No required runtime test failed or passed: none was executed. The separate lead-owned framework fixture observation is not an engine defect or a K1 check in this worker record.

## Limitations and handoff

No app module/handler, Worker/dev server, browser, socket, HTTP request, cloud API, deployed environment, provider data, customer record, credential material or secret value was exercised or output. No test suite, build, typecheck, deployment/provision/seed/install, commit or push was run. No full environment dump was taken. Source hashes of public files do not mean their code was executed.

The parser and lexical check cannot attest runtime URL normalization, asset-first/SPA/host routing, method/upgrade compatibility, DO instantiation/alarms/SQLite, queue delivery/retries, cross-isolate storage or egress. Installed library reading narrows the source expectation; actual mounted-path/runtime/deployed/customer evidence remains required under the matrix. Potential async, fallback, memory, read-disclosure and external effects are included in the proposed assertions rather than presumed absent.

The original modified Meridian bundle and all 330 protected baseline inputs are unchanged. Existing dirty/deleted/untracked work was preserved. K2 remains the independent verifier's responsibility; C1/C2/C3 acceptance and evidence registration remain the lead's. The [handoff acceptance contract](handoff-contract-v1.md) specifies independent review, aggregate identity, lead disposition and final checkpoint obligations. This worker does not mark its own output independently verified.

D01 and D08 remain pending without blocking this design; their topology/asset/binding choices were not selected. Other privacy/model/SSO/customer decisions remain pending. Six later implementation slices are proposals only. All W packages, findings, gates and release remain open/unassessed/not authorized as applicable. Exact next action: independent review of the frozen artifact plus this evidence, then lead disposition/rework and durable handoff before any new bounded admission.
