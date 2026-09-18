import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { AUDIT_PATH, TRACKER_PATH, parseAudit, sha256, artifactDigest, taskContractDigest,
  scopeFragments, decompositionDigest, packageCoverageDigest, validateTracker } from './board.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const auditText = readFileSync(resolve(repo, AUDIT_PATH), 'utf8');
const seed = JSON.parse(readFileSync(resolve(repo, TRACKER_PATH), 'utf8'));
const clone = value => structuredClone(value);
const time = minute => `2026-09-06T13:${String(minute).padStart(2, '0')}:00.000Z`;

// All writes and probes below target synthetic files under a new temporary directory.
// No engine imports, cloud calls, customer records, dependencies or repository writes.
function fixture(t, closed = false) {
  const rootDir = mkdtempSync(resolve(tmpdir(), 'remediation-board-test-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const tracker = clone(seed);
  tracker.source.sha256 = sha256(auditText);
  tracker.journal[0].at = '2026-09-06T12:00:00.000Z'; // Explicit synthetic test clock, independent of actual bootstrap time.
  const put = (path, content) => {
    const destination = resolve(rootDir, path);
    mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, content);
    return { path, sha256: sha256(content) };
  };
  put(AUDIT_PATH, auditText);
  const check = (previousTracker) => validateTracker(tracker, { rootDir, previousTracker });
  if (!closed) return { tracker, rootDir, put, check };
  tracker.actors.push(...['worker', 'reviewer', 'lead'].map(id => ({ id, kind: 'agent', model: 'gpt-6-astra', effort: 'xhigh', run_id: `synthetic-${id}-run`, description: `Synthetic ${id}; no real work or acceptance claimed.` })));
  const task = tracker.tasks[0];
  Object.assign(task, {
    scope: 'Synthetic design fixture used only to test record validation.',
    read_paths: ['fixtures/source.txt'], write_paths: ['docs/remediation/design/W01.01/output.md', 'docs/remediation/evidence/W01.01'],
    criteria: [{ id: 'W01.01-C1', description: 'A synthetic source inventory record is traceable.', required_evidence_kinds: ['source_inventory'], minimum_claim: 'source_confirmed' }],
    checks: [{ id: 'W01.01-K1', required: true, criterion_ids: ['W01.01-C1'], command: 'synthetic inventory fixture', runtime: 'synthetic Node fixture; not a product runtime', workload: 'one synthetic source and output', result: 'pass', evidence_ids: ['E01'] }],
    dependencies: [], assignments: { implementer: 'worker', independent_reviewer: 'reviewer', lead: 'lead' }, state: 'closed',
  });
  const plan = put('docs/remediation/design/W01.01/plan.md', 'Synthetic approved plan; no engine change.\n');
  task.preflight = { status: 'approved', plan, contract_digest: taskContractDigest(task), approval: { actor_id: 'lead', at: time(0), plan_sha256: plan.sha256, rationale: 'Synthetic fixture approval.' } };
  task.artifact = { status: 'recorded', configuration: 'Synthetic local fixture with no customer data or deployed configuration.', contract_digest: taskContractDigest(task), files: [
    { ...put('fixtures/source.txt', 'synthetic source v1\n'), role: 'source' },
    { ...put('docs/remediation/design/W01.01/output.md', 'synthetic inventory v1\n'), role: 'output' },
  ] };
  task.artifact.digest = artifactDigest(task.artifact);
  const proof = { id: 'E01', task_id: task.id, check_id: task.checks[0].id, criterion_ids: ['W01.01-C1'], kind: 'source_inventory', claim: 'source_confirmed',
    actor_id: 'worker', run_id: 'synthetic-worker-run', command: task.checks[0].command, runtime: task.checks[0].runtime, workload: task.checks[0].workload,
    result: 'pass', limitations: 'Synthetic record only; does not prove any engine behavior.', at: time(3),
    file: put('docs/remediation/evidence/W01.01/proof.txt', 'synthetic proof v1\n'), artifact_digest: task.artifact.digest, artifact_basis: clone(task.artifact), status: 'current', superseded_by: null };
  tracker.evidence = [proof];
  task.independent_review = { status: 'accepted', actor_id: 'reviewer', at: time(4), artifact_digest: task.artifact.digest, evidence_ids: ['E01'],
    record: put('docs/remediation/evidence/W01.01/review.md', 'synthetic independent review\n'), limitations: 'Synthetic local test only.' };
  task.lead_signoff = { status: 'accepted', actor_id: 'lead', at: time(5), artifact_digest: task.artifact.digest,
    review_sha256: sha256(JSON.stringify(task.independent_review)), record: put('docs/remediation/evidence/W01.01/lead.md', 'synthetic lead disposition\n'), limitations: 'No package, finding or gate claim.' };
  task.handoff.status = 'complete';
  task.handoff.record = put('docs/remediation/evidence/W01.01/handoff.md', 'Synthetic durable handoff.\n');
  tracker.journal.push(
    { seq: 2, task_id: task.id, from: 'draft', to: 'ready', at: time(1), actor_id: 'lead', reason: 'Synthetic plan admission.' },
    { seq: 3, task_id: task.id, from: 'ready', to: 'in_progress', at: time(2), actor_id: 'worker', reason: 'Synthetic work starts.', plan_sha256: plan.sha256, plan_approved_at: time(0) },
    { seq: 4, task_id: task.id, from: 'in_progress', to: 'verification', at: time(3), actor_id: 'worker', reason: 'Synthetic verification.' },
    { seq: 5, task_id: task.id, from: 'verification', to: 'closed', at: time(6), actor_id: 'lead', reason: 'Synthetic bounded task closure.' },
  );
  for (const event of tracker.journal.slice(1)) event.assignments = Object.fromEntries(Object.entries(task.assignments).map(([role, id]) => [role, { actor_id: id, run_id: tracker.actors.find(a => a.id === id).run_id }]));
  tracker.journal[2].plan_snapshot = clone(task.preflight);
  tracker.resume.journal_seq = tracker.journal.length;
  return { tracker, rootDir, put, check, task, proof };
}
const valid = result => assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
const invalid = (result, code) => { assert.equal(result.ok, false); assert.ok(result.errors.some(e => e.code === code), `${code}: ${JSON.stringify(result.errors)}`); };
function bindContract(f) {
  for (const dep of f.task.dependencies) { dep.origin ??= 'proposed'; dep.consumed_output ??= 'Synthetic prerequisite output.'; }
  f.task.preflight.contract_digest = taskContractDigest(f.task);
  f.task.artifact.contract_digest = taskContractDigest(f.task);
  f.task.artifact.digest = artifactDigest(f.task.artifact);
  f.proof.artifact_digest = f.task.artifact.digest; f.proof.artifact_basis = clone(f.task.artifact);
  f.task.independent_review.artifact_digest = f.task.artifact.digest;
  f.task.lead_signoff.artifact_digest = f.task.artifact.digest;
  f.task.lead_signoff.review_sha256 = sha256(JSON.stringify(f.task.independent_review));
  const event = f.tracker.journal.findLast(e => e.task_id === f.task.id && e.to === 'in_progress');
  if (event) event.plan_snapshot = clone(f.task.preflight);
}

function recordChange(f, type, id, before, after, at = time(8)) {
  const event = { seq: f.tracker.journal.length + 1, kind: 'record_change', subject_type: type, subject_id: id,
    before_sha256: before === undefined ? null : sha256(JSON.stringify(before)), after_sha256: sha256(JSON.stringify(after)), actor_id: 'lead', at, reason: 'Synthetic governed record update.' };
  event.record = f.put(`fixtures/change-${event.seq}.json`, JSON.stringify({ before: before ?? null, after })); f.tracker.journal.push(event); f.tracker.resume.journal_seq = event.seq;
}
function approvePackage(f) {
  const p = f.tracker.packages[0];
  p.decomposition = { status: 'scoped', task_ids: [f.task.id], criteria: [{ id: 'W01-PC1', description: 'Synthetic full-scope coverage fixture; no actual perimeter acceptance.', scope_fragments: scopeFragments(p.canonical.full_scope) }],
    coverage: [{ criterion_id: 'W01-PC1', task_id: f.task.id, task_criterion_id: 'W01.01-C1' }] };
  p.decomposition.approval = { status: 'approved', actor_id: 'lead', at: time(0), decomposition_digest: decompositionDigest(p), record: f.put('docs/remediation/evidence/W01.01/decomposition.md', 'Synthetic decomposition approval\n') };
  p.independent_review = { status: 'accepted', actor_id: 'reviewer', at: time(7), coverage_digest: packageCoverageDigest(p, f.tracker.tasks), record: f.put('docs/remediation/evidence/W01.01/package-review.md', 'Synthetic package review\n'), limitations: 'Tests validation only.' };
  p.lead_signoff = { status: 'accepted', actor_id: 'lead', at: time(8), coverage_digest: packageCoverageDigest(p, f.tracker.tasks), review_sha256: sha256(JSON.stringify(p.independent_review)), record: f.put('docs/remediation/evidence/W01.01/package-lead.md', 'Synthetic package disposition\n'), limitations: 'Does not close findings or gates.' };
  p.scope_status = 'scope_verified'; return p;
}

test('canonical source parses 41 W, 35 F, 30 N, five gates and ten decisions', () => {
  const parsed = parseAudit(auditText);
  assert.equal(parsed.packages.length, 41); assert.equal(parsed.findings.length, 65);
  assert.equal(parsed.gates.length, 5); assert.equal(parsed.decisions.length, 10);
  assert.equal(parsed.findings.find(f => f.id === 'N04').alias_of, 'N01');
  assert.equal(parsed.findings.find(f => f.id === 'N28').alias_of, 'N06');
  assert.equal(parsed.findings.find(f => f.id === 'N21').type, 'model_validation_question');
  assert.equal(parsed.findings.find(f => f.id === 'N30').type, 'assurance');
  for (const retained of ['enrichment', 'product-sort persistence', 'entitlement', 'AI Search', 'SFCC', 'typed attributes/audiences', 'scheduled warehouse', 'optional', 'no-additional-cost', 'as availability is triggered', 'tag-plan', 'substitutions']) assert.ok(parsed.packages[13].canonical.full_scope.includes(retained), retained);
});
test('initial draft is consistent and does not manufacture any pass', t => {
  const f = fixture(t); valid(f.check());
  assert.equal(f.tracker.tasks.length, 1); assert.equal(f.tracker.tasks[0].state, 'draft');
  assert.ok(f.tracker.packages.every(p => p.scope_status === 'open' && p.decomposition.status === 'unscoped'));
  assert.ok(f.tracker.gates.every(g => g.state === 'not_assessed'));
});
test('well-formed synthetic closed task passes without closing W01 or G0', t => {
  const f = fixture(t, true); valid(f.check());
  assert.equal(f.tracker.packages[0].scope_status, 'open'); assert.equal(f.tracker.gates[0].state, 'not_assessed');
});
test('explicit synthetic package verification requires all scopes and approvals', t => {
  const f = fixture(t, true); const p = approvePackage(f); valid(f.check());
  p.decomposition.criteria[0].scope_fragments.pop(); invalid(f.check(), 'coverage');
});

const mutations = [
  ['missing W ID', f => f.tracker.packages.pop(), 'canonical_ids'],
  ['duplicate W ID', f => f.tracker.packages.push(clone(f.tracker.packages[0])), 'duplicate_id'],
  ['wrong N alias', f => { f.tracker.findings.find(x => x.id === 'N28').alias_of = 'N01'; }, 'finding_type'],
  ['wrong N model-question type', f => { f.tracker.findings.find(x => x.id === 'N21').type = 'issue_extension'; }, 'finding_type'],
  ['wrong N assurance type', f => { f.tracker.findings.find(x => x.id === 'N30').type = 'issue_extension'; }, 'finding_type'],
  ['weakened W14 scope', f => { f.tracker.packages[13].canonical.full_scope = 'Update register only.'; }, 'scope_drift'],
  ['changed finding classification', f => { f.tracker.findings[0].canonical.disposition = 'Refuted.'; }, 'scope_drift'],
  ['changed gate mapping', f => { f.tracker.packages[0].gates = []; }, 'traceability'],
  ['W36 full-remedy claim', f => { f.tracker.packages[35].closure_kind = 'full_scope'; }, 'containment'],
  ['unsupported W closure', f => { f.tracker.packages[0].scope_status = 'scope_verified'; }, 'unsupported_closure'],
  ['unsupported finding closure', f => { f.tracker.findings[0].status = 'closed_with_evidence'; }, 'unsupported_closure'],
  ['unsupported gate pass', f => { f.tracker.gates[0].state = 'passed'; }, 'unsupported_gate'],
  ['G1 real-data waiver', f => { f.tracker.gates[1].state = 'waived'; }, 'unsupported_gate'],
  ['release authorization from counts', f => { f.tracker.release.state = 'authorized'; }, 'release_authority'],
  ['low-effort agent', f => { f.tracker.actors[1].effort = 'high'; }, 'agent_policy'],
  ['wrong model', f => { f.tracker.actors[1].model = 'gpt-5.6-sol'; }, 'agent_policy'],
  ['self review under two actor names', f => { f.tracker.actors.find(a => a.id === 'reviewer').run_id = 'synthetic-worker-run'; }, 'self_review'],
  ['lead reuses reviewer run', f => { f.tracker.actors.find(a => a.id === 'lead').run_id = 'synthetic-reviewer-run'; }, 'self_review'],
  ['missing role', f => { f.task.assignments.independent_reviewer = null; }, 'actor'],
  ['changed write ownership after approval', f => { f.task.write_paths.push('docs/remediation/design/W01.01/unreviewed.md'); }, 'contract_drift'],
  ['missing evidence record', f => { f.tracker.evidence = []; }, 'evidence_link'],
  ['missing evidence file', f => { f.proof.file.path = 'fixtures/missing.txt'; }, 'stale_proof'],
  ['edited evidence file', f => { f.put(f.proof.file.path, 'changed proof\n'); }, 'stale_proof'],
  ['changed source artifact', f => { f.put('fixtures/source.txt', 'changed source\n'); }, 'stale_proof'],
  ['changed output artifact', f => { f.put('docs/remediation/design/W01.01/output.md', 'changed output\n'); }, 'stale_proof'],
  ['missing artifact manifest', f => { f.task.artifact.files = []; }, 'artifact_drift'],
  ['changed configuration basis', f => { f.task.artifact.configuration = 'different fixture'; }, 'artifact_drift'],
  ['proof for another artifact', f => { f.proof.artifact_digest = '0'.repeat(64); }, 'artifact_drift'],
  ['edited independent review file', f => { f.put(f.task.independent_review.record.path, 'changed review\n'); }, 'stale_proof'],
  ['reviewed artifact drift', f => { f.task.independent_review.artifact_digest = '0'.repeat(64); }, 'review_drift'],
  ['lead signed another review', f => { f.task.lead_signoff.review_sha256 = '0'.repeat(64); }, 'review_drift'],
  ['skipped required check', f => { f.task.checks[0].result = 'not_run'; f.task.checks[0].evidence_ids = []; }, 'required_check'],
  ['failed required check', f => { f.task.checks[0].result = 'fail'; f.proof.result = 'fail'; }, 'required_check'],
  ['required check relabeled optional', f => { f.task.checks[0].required = false; }, 'coverage'],
  ['claim exceeds evidence class', f => { f.proof.claim = 'deployed'; }, 'overclaim'],
  ['wrong check evidence workload', f => { f.proof.workload = 'unrelated case'; }, 'evidence_link'],
  ['missing preflight approval', f => { f.task.preflight.status = 'pending'; }, 'preflight'],
  ['approval after start', f => { f.task.preflight.approval.at = time(3); }, 'preflight'],
  ['start without recorded plan', f => { delete f.tracker.journal[2].plan_sha256; }, 'preflight'],
  ['journal current-state mismatch', f => { f.task.state = 'verification'; }, 'journal_mismatch'],
  ['invalid journal transition', f => { f.tracker.journal[1].to = 'closed'; }, 'transition'],
  ['journal ordering mismatch', f => { f.tracker.journal[1].seq = 8; }, 'journal'],
  ['journal timestamp goes backwards', f => { f.tracker.journal[2].at = '2026-01-01T00:00:00Z'; }, 'journal'],
  ['blocked treated as done', f => { f.task.state = 'done'; f.task.blocked = { reason: 'blocked', owner: 'lead', next_action: 'wait' }; }, 'state'],
  ['blocked without owner/action', f => { f.task.state = 'blocked'; f.task.blocked = { reason: 'blocked' }; }, 'missing_field'],
  ['no independent acceptance', f => { f.task.independent_review.status = 'pending'; }, 'unsupported_closure'],
  ['no lead acceptance', f => { f.task.lead_signoff.status = 'pending'; }, 'unsupported_closure'],
  ['missing completed handoff', f => { f.task.handoff.status = 'pending'; }, 'handoff'],
  ['missing resume pointer', f => { f.tracker.resume.task_id = 'W99.01'; }, 'resume'],
  ['engine work without mandate', f => { f.task.kind = 'implementation'; }, 'authority'],
];
for (const [name, mutate, code] of mutations) test(`fails closed: ${name}`, t => { const f = fixture(t, true); mutate(f); invalid(f.check(), code); });

test('audit drift requires reconciliation even when package strings are unchanged', t => {
  const f = fixture(t); f.put(AUDIT_PATH, `${auditText}\nSynthetic unrelated audit note.\n`); invalid(f.check(), 'audit_drift');
});
test('unrelated file edits do not invalidate dependency-scoped artifact proof', t => {
  const f = fixture(t, true); f.put('docs/unrelated.md', 'unrelated synthetic note\n'); valid(f.check());
});
test('pending topology decisions do not block initial inventory', t => { const f = fixture(t); valid(f.check()); assert.ok(f.tracker.tasks[0].dependencies.every(d => d.kind === 'informs')); });
test('acceptance prerequisite does not block work but does block closure', t => {
  const f = fixture(t, true);
  f.task.dependencies = [{ target_type: 'decision', target_id: 'D01', kind: 'blocks_acceptance', rationale: 'Synthetic acceptance condition.' }]; bindContract(f);
  invalid(f.check(), 'prerequisite');
  f.task.state = 'verification'; f.tracker.journal.pop(); f.tracker.resume.journal_seq--; valid(f.check());
});
test('unaccepted hard task dependency blocks start and dangling IDs are rejected', t => {
  const f = fixture(t, true);
  f.task.dependencies = [{ target_type: 'package', target_id: 'W02', kind: 'blocks_start', rationale: 'Requires accepted interface.' }]; bindContract(f); invalid(f.check(), 'prerequisite');
  f.task.dependencies[0].target_id = 'W99'; invalid(f.check(), 'dangling_reference');
});
test('task dependency cycles are rejected even while draft', t => {
  const f = fixture(t); const first = f.tracker.tasks[0], second = clone(first); second.id = 'W01.02';
  first.dependencies = [{ target_type: 'task', target_id: second.id, kind: 'blocks_start', rationale: 'Synthetic cycle.' }];
  second.dependencies = [{ target_type: 'task', target_id: first.id, kind: 'blocks_start', rationale: 'Synthetic cycle.' }];
  f.tracker.tasks.push(second); f.tracker.packages[0].decomposition.task_ids.push(second.id);
  f.tracker.journal.push({ seq: 2, task_id: second.id, from: null, to: 'draft', at: time(0), actor_id: 'framework-seed', reason: 'Synthetic second draft.' }); f.tracker.resume.journal_seq++;
  invalid(f.check(), 'dependency_cycle');
});
test('task-to-package dependency cycles are rejected', t => {
  const f = fixture(t); f.tracker.tasks[0].dependencies = [{ target_type: 'package', target_id: 'W01', kind: 'blocks_acceptance', rationale: 'Invalid circular full-package prerequisite.' }]; invalid(f.check(), 'dependency_cycle');
});
test('overlapping active ownership and multiple active tasks are rejected', t => {
  const f = fixture(t, true); f.task.state = 'verification'; f.task.kind = 'implementation'; f.task.write_paths = ['src/shared']; f.tracker.journal.pop();
  const second = clone(f.task); second.id = 'W01.02'; second.state = 'in_progress'; second.write_paths = ['src/shared/module.ts']; f.tracker.tasks.push(second); f.tracker.packages[0].decomposition.task_ids.push(second.id);
  for (const [from, to] of [[null, 'draft'], ['draft', 'ready'], ['ready', 'in_progress']]) f.tracker.journal.push({ seq: f.tracker.journal.length + 1, task_id: second.id, from, to, at: time(7), actor_id: 'lead', reason: 'Synthetic second task.', plan_sha256: second.preflight.plan.sha256, plan_approved_at: time(0) });
  f.tracker.resume.journal_seq = f.tracker.journal.length;
  invalid(f.check(), 'overlapping_ownership'); invalid(f.check(), 'work_in_progress');
});
test('explicit local mandate covers a package without per-task reapproval', t => {
  const f = fixture(t, true); f.task.kind = 'implementation'; bindContract(f);
  f.tracker.actors.push({ id: 'human-owner', kind: 'human', description: 'Synthetic human authority record.' });
  f.tracker.authority.mode = 'local_remediation_authorized'; f.tracker.authority.local_engine_changes = true;
  f.tracker.authority.local_authorization = { actor_id: 'human-owner', at: time(0), scope_task_ids: [], scope_package_ids: ['W01'], allowed_actions: ['local_engine_changes', 'local_checks'], description: 'Synthetic bounded local mandate.', record: f.put('fixtures/authority.md', 'Synthetic authority record; no real authorization.\n') };
  valid(f.check()); f.tracker.authority.local_authorization.scope_package_ids = ['W02']; invalid(f.check(), 'authority');
});
test('human decision requires exact retained authority and cannot be agent-approved', t => {
  const f = fixture(t, true); const d = f.tracker.decisions[0];
  f.tracker.actors.push({ id: 'human-owner', kind: 'human', description: 'Synthetic human authority record.' });
  Object.assign(d, { state: 'approved', actor_id: 'human-owner', at: time(0), scope: 'Synthetic bounded decision scope.', outcome: 'Synthetic outcome only.', record: f.put('fixtures/decision.md', 'Synthetic decision record.\n') }); valid(f.check());
  d.actor_id = 'lead'; invalid(f.check(), 'decision');
});
test('ordered journal and evidence are append-only against retained prior', t => {
  const f = fixture(t, true), previous = clone(f.tracker); valid(f.check(previous));
  f.tracker.journal[0].reason = 'Edited old reason'; invalid(f.check(previous), 'append_only');
  f.tracker.journal = clone(previous.journal); f.proof.limitations = 'Edited historical proof'; invalid(f.check(previous), 'append_only');
});
test('reopening retains old acceptance and supersedes proof without erasing history', t => {
  const f = fixture(t, true), previous = clone(f.tracker);
  f.task.acceptance_history.push({ artifact: clone(f.task.artifact), independent_review: clone(f.task.independent_review), lead_signoff: clone(f.task.lead_signoff) });
  f.task.state = 'reopened'; f.task.independent_review = { status: 'pending', evidence_ids: [] }; f.task.lead_signoff = { status: 'pending' }; f.task.handoff.status = 'pending';
  f.tracker.journal.push({ seq: 6, task_id: f.task.id, from: 'closed', to: 'reopened', at: time(7), actor_id: 'lead', reason: 'Synthetic revalidation required.' }); f.tracker.resume.journal_seq = 6;
  const next = clone(f.proof); next.id = 'E02'; next.file = f.put('docs/remediation/evidence/W01.01/proof-v2.txt', 'synthetic replacement proof\n'); next.at = time(7);
  f.proof.status = 'superseded'; f.proof.superseded_by = 'E02'; f.tracker.evidence.push(next); f.task.checks[0].evidence_ids = ['E02'];
  recordChange(f, 'evidence', 'E01', previous.evidence[0], f.proof);
  recordChange(f, 'evidence', 'E02', undefined, next);
  f.put(f.proof.file.path, 'old proof unexpectedly changed\n');
  const result = f.check(previous); valid(result); assert.ok(result.warnings.some(w => w.code === 'stale_proof'));
  f.task.acceptance_history = []; invalid(f.check(previous), 'append_only');
});
test('blocked then return-for-rework lifecycle is consistent and not done', t => {
  const f = fixture(t); const task = f.tracker.tasks[0];
  f.tracker.actors.push({ id: 'lead', kind: 'agent', model: 'gpt-6-astra', effort: 'ultra', run_id: 'synthetic-lead', description: 'Synthetic lead.' });
  task.state = 'blocked'; task.blocked = { reason: 'Synthetic missing input.', owner: 'lead', next_action: 'Obtain synthetic input.' };
  f.tracker.journal.push({ seq: 2, task_id: task.id, from: 'draft', to: 'blocked', at: time(0), actor_id: 'lead', reason: 'Synthetic blocked state.', blocked: clone(task.blocked) }); f.tracker.resume.journal_seq = 2; valid(f.check());
  task.state = 'draft'; task.blocked = null; f.tracker.journal.push({ seq: 3, task_id: task.id, from: 'blocked', to: 'draft', at: time(1), actor_id: 'lead', reason: 'Synthetic input resolved; return to draft.' }); f.tracker.resume.journal_seq = 3; valid(f.check());
});
test('malformed records return validation errors, not successful partial checks', t => {
  const f = fixture(t); f.tracker.tasks = [null]; invalid(f.check(), 'id');
  f.tracker.tasks = [{ id: 'W01.01', artifact: { files: [null], status: 'recorded' } }]; assert.equal(f.check().ok, false);
});
test('start cannot substitute another syntactically valid plan hash', t => {
  const f = fixture(t, true); f.tracker.journal[2].plan_sha256 = '0'.repeat(64); invalid(f.check(), 'preflight');
});
test('current closure cannot use an unrelated lead snapshot instead of the accepting lead', t => {
  const f = fixture(t, true);
  f.tracker.actors.push({ id: 'other-lead', kind: 'agent', model: 'gpt-6-astra', effort: 'xhigh', run_id: 'synthetic-other-lead-run', description: 'Synthetic unrelated lead.' });
  const closure = f.tracker.journal.findLast(event => event.to === 'closed'); closure.actor_id = 'other-lead'; closure.assignments.lead = { actor_id: 'other-lead', run_id: 'synthetic-other-lead-run' };
  invalid(f.check(), 'episode_binding');
});
test('current start cannot substitute another approving lead in its historical snapshot', t => {
  const f = fixture(t, true);
  f.tracker.actors.push({ id: 'other-lead', kind: 'agent', model: 'gpt-6-astra', effort: 'xhigh', run_id: 'synthetic-other-lead-run', description: 'Synthetic unrelated lead.' });
  const start = f.tracker.journal.findLast(event => event.to === 'in_progress'); start.assignments.lead = { actor_id: 'other-lead', run_id: 'synthetic-other-lead-run' }; start.plan_snapshot.approval.actor_id = 'other-lead';
  invalid(f.check(), 'episode_binding'); invalid(f.check(), 'preflight');
});
test('current ready admission must match the assigned lead even when historical snapshot is internally valid', t => {
  const f = fixture(t, true); f.task.state = 'ready'; f.tracker.journal.splice(2); f.tracker.resume.journal_seq = 2;
  f.tracker.actors.push({ id: 'other-lead', kind: 'agent', model: 'gpt-6-astra', effort: 'xhigh', run_id: 'synthetic-other-lead-run', description: 'Synthetic unrelated lead.' });
  const ready = f.tracker.journal[1]; ready.actor_id = 'other-lead'; ready.assignments.lead = { actor_id: 'other-lead', run_id: 'synthetic-other-lead-run' }; invalid(f.check(), 'episode_binding');
});
test('every required check proof must be independently reviewed', t => {
  const f = fixture(t, true), check = clone(f.task.checks[0]); check.id = 'W01.01-K2'; check.evidence_ids = ['E02']; f.task.checks.push(check); bindContract(f);
  const proof = clone(f.proof); proof.id = 'E02'; proof.check_id = check.id; f.tracker.evidence.push(proof);
  invalid(f.check(), 'required_check_review');
});
test('acceptance proof and approvals cannot predate the applicable work start', t => {
  const f = fixture(t, true); f.proof.at = time(0); f.task.independent_review.at = time(0); f.task.lead_signoff.at = time(0); bindContract(f);
  invalid(f.check(), 'evidence_time'); invalid(f.check(), 'review');
});
test('complete handoff requires a durable file with the recorded hash', t => {
  const f = fixture(t, true); delete f.task.handoff.record; invalid(f.check(), 'stale_proof');
});
test('declared exact output cannot be omitted from artifact identity', t => {
  const f = fixture(t, true); f.task.write_paths.push('docs/remediation/design/W01.01/unmanifested.md'); bindContract(f); invalid(f.check(), 'artifact');
});
test('informational dependency cycles do not block design decomposition', t => {
  const f = fixture(t); const first = f.tracker.tasks[0], second = JSON.parse(JSON.stringify(first).replaceAll('W01.01', 'W01.02'));
  first.dependencies = [{ target_type: 'task', target_id: second.id, kind: 'informs', origin: 'proposed', consumed_output: 'Related design.', rationale: 'Co-design only.' }];
  second.dependencies = [{ target_type: 'task', target_id: first.id, kind: 'informs', origin: 'proposed', consumed_output: 'Related design.', rationale: 'Co-design only.' }];
  f.tracker.tasks.push(second); f.tracker.packages[0].decomposition.task_ids.push(second.id);
  f.tracker.journal.push({ seq: 2, task_id: second.id, from: null, to: 'draft', at: time(0), actor_id: 'framework-seed', reason: 'Synthetic co-design draft.' }); f.tracker.resume.journal_seq++;
  valid(f.check());
});
test('a prerequisite approved after admission cannot retroactively permit work', t => {
  const f = fixture(t, true); f.tracker.actors.push({ id: 'human', kind: 'human', description: 'Synthetic customer owner.' });
  Object.assign(f.tracker.decisions[0], { state: 'approved', actor_id: 'human', at: time(3), scope: 'Synthetic scope.', outcome: 'Synthetic topology choice.', record: f.put('fixtures/late-decision.md', 'Synthetic decision.\n') });
  f.task.dependencies = [{ target_type: 'decision', target_id: 'D01', kind: 'blocks_start', rationale: 'Synthetic hard prerequisite.' }]; bindContract(f); invalid(f.check(), 'prerequisite_time');
  f.task.dependencies[0].kind = 'blocks_acceptance'; f.tracker.decisions[0].at = time(7); bindContract(f); invalid(f.check(), 'prerequisite_time');
});
function reopenAwaitingProof(f) {
  const previous = clone(f.tracker);
  f.task.acceptance_history.push({ artifact: clone(f.task.artifact), independent_review: clone(f.task.independent_review), lead_signoff: clone(f.task.lead_signoff) });
  f.task.state = 'reopened'; f.task.preflight = { status: 'pending', plan: null, approval: null };
  f.task.independent_review = { status: 'pending', evidence_ids: [] }; f.task.lead_signoff = { status: 'pending' }; f.task.handoff.status = 'pending';
  f.task.artifact.status = 'revalidation_required'; f.proof.status = 'revalidation_required'; f.task.checks[0].result = 'not_run'; f.task.checks[0].evidence_ids = [];
  f.tracker.journal.push({ seq: 6, task_id: f.task.id, from: 'closed', to: 'reopened', at: time(7), actor_id: 'lead', reason: 'Synthetic invalidation; no replacement proof yet.' }); f.tracker.resume.journal_seq = 6;
  recordChange(f, 'evidence', f.proof.id, previous.evidence[0], f.proof); return previous;
}
test('revalidation can remain pending without fabricated replacement evidence', t => {
  const f = fixture(t, true); const previous = reopenAwaitingProof(f); f.put('fixtures/source.txt', 'changed source awaiting revalidation\n');
  const result = f.check(previous); valid(result); assert.ok(result.warnings.some(w => w.code === 'revalidation_required')); assert.equal(f.tracker.evidence.length, 1); assert.equal(f.proof.superseded_by, null);
});
test('lead handoff after reopening preserves historical actor assignments', t => {
  const f = fixture(t, true); const previous = reopenAwaitingProof(f); const beforeContract = taskContractDigest(f.task);
  f.tracker.actors.push({ id: 'next-lead', kind: 'agent', model: 'gpt-6-astra', effort: 'max', run_id: 'synthetic-next-lead-run', description: 'Synthetic new session lead.' });
  f.task.assignments.lead = 'next-lead'; recordChange(f, 'task_contract', f.task.id, beforeContract, taskContractDigest(f.task));
  valid(f.check(previous)); assert.equal(f.tracker.journal[1].actor_id, 'lead'); assert.equal(f.tracker.journal[1].assignments.lead.actor_id, 'lead');
});
test('new lead can re-admit and revalidate through every intermediate lifecycle checkpoint', t => {
  const f = fixture(t, true), previous = reopenAwaitingProof(f); valid(f.check(previous));
  const beforeContract = taskContractDigest(f.task);
  f.tracker.actors.push({ id: 'next-lead', kind: 'agent', model: 'gpt-6-astra', effort: 'max', run_id: 'synthetic-next-lead-run', description: 'Synthetic revalidation lead.' }); f.task.assignments.lead = 'next-lead';
  const plan = f.put('docs/remediation/design/W01.01/plan-v2.md', 'Synthetic second approved plan.\n');
  f.task.preflight = { status: 'approved', plan, contract_digest: taskContractDigest(f.task), approval: { actor_id: 'next-lead', at: time(9), plan_sha256: plan.sha256, rationale: 'Synthetic second admission approval.' } };
  recordChange(f, 'task_contract', f.task.id, beforeContract, taskContractDigest(f.task), time(9)); valid(f.check(previous));
  const transition = (to, at, actorId) => {
    const event = { seq: f.tracker.journal.length + 1, task_id: f.task.id, from: f.task.state, to, at, actor_id: actorId, reason: `Synthetic revalidation ${to}.`,
      assignments: Object.fromEntries(Object.entries(f.task.assignments).map(([role, id]) => [role, { actor_id: id, run_id: f.tracker.actors.find(a => a.id === id).run_id }])) };
    if (to === 'in_progress') Object.assign(event, { plan_sha256: plan.sha256, plan_approved_at: time(9), plan_snapshot: clone(f.task.preflight) });
    f.task.state = to; f.tracker.journal.push(event); f.tracker.resume.journal_seq = event.seq;
  };
  f.task.artifact = { status: 'not_recorded', files: [], configuration: null, digest: null };
  transition('ready', time(10), 'next-lead'); valid(f.check(previous));
  transition('in_progress', time(11), 'worker'); valid(f.check(previous));
  f.task.artifact = { status: 'recorded', configuration: 'Synthetic second local configuration.', contract_digest: taskContractDigest(f.task), files: [
    { ...f.put('fixtures/source.txt', 'synthetic source v2\n'), role: 'source' },
    { ...f.put('docs/remediation/design/W01.01/output.md', 'synthetic inventory v2\n'), role: 'output' },
  ] }; f.task.artifact.digest = artifactDigest(f.task.artifact);
  const oldProof = clone(f.proof), proof = clone(f.proof); proof.id = 'E02'; proof.status = 'current'; proof.at = time(12); proof.file = f.put('docs/remediation/evidence/W01.01/proof-v2.txt', 'Synthetic second proof.\n'); proof.artifact_digest = f.task.artifact.digest; proof.artifact_basis = clone(f.task.artifact);
  f.proof.status = 'superseded'; f.proof.superseded_by = proof.id; f.tracker.evidence.push(proof); f.task.checks[0].result = 'pass'; f.task.checks[0].evidence_ids = [proof.id];
  recordChange(f, 'evidence', 'E01', oldProof, f.proof, time(12)); recordChange(f, 'evidence', 'E02', undefined, proof, time(12));
  transition('verification', time(12), 'worker'); valid(f.check(previous));
  f.task.independent_review = { status: 'accepted', actor_id: 'reviewer', at: time(13), artifact_digest: f.task.artifact.digest, evidence_ids: ['E02'], record: f.put('docs/remediation/evidence/W01.01/review-v2.md', 'Synthetic second independent review.\n'), limitations: 'Synthetic local fixture only.' };
  f.task.lead_signoff = { status: 'accepted', actor_id: 'next-lead', at: time(14), artifact_digest: f.task.artifact.digest, review_sha256: sha256(JSON.stringify(f.task.independent_review)), record: f.put('docs/remediation/evidence/W01.01/lead-v2.md', 'Synthetic new lead signoff.\n'), limitations: 'No package or gate closure.' };
  f.task.handoff = { status: 'complete', next_action: 'Synthetic bounded task accepted.', resume_path: 'docs/remediation/RESUME.md', record: f.put('docs/remediation/evidence/W01.01/handoff-v2.md', 'Synthetic second handoff.\n') }; valid(f.check(previous));
  transition('closed', time(15), 'next-lead'); valid(f.check(previous));
  assert.equal(f.tracker.journal[4].actor_id, 'lead'); assert.equal(f.tracker.journal.at(-1).actor_id, 'next-lead');
});
test('supersession A to B to C preserves immutable links and rejects cycles', t => {
  const f = fixture(t, true); const previous = clone(f.tracker);
  f.task.acceptance_history.push({ artifact: clone(f.task.artifact), independent_review: clone(f.task.independent_review), lead_signoff: clone(f.task.lead_signoff) });
  f.task.state = 'reopened'; f.task.independent_review = { status: 'pending', evidence_ids: [] }; f.task.lead_signoff = { status: 'pending' }; f.task.handoff.status = 'pending';
  f.tracker.journal.push({ seq: 6, task_id: f.task.id, from: 'closed', to: 'reopened', at: time(7), actor_id: 'lead', reason: 'Synthetic revalidation.' }); f.tracker.resume.journal_seq = 6;
  const b = clone(f.proof), c = clone(f.proof); b.id = 'E02'; b.status = 'superseded'; b.superseded_by = 'E03'; c.id = 'E03';
  f.proof.status = 'superseded'; f.proof.superseded_by = 'E02'; f.tracker.evidence.push(b, c); f.task.checks[0].evidence_ids = ['E03'];
  recordChange(f, 'evidence', 'E01', previous.evidence[0], f.proof); recordChange(f, 'evidence', 'E02', undefined, b); recordChange(f, 'evidence', 'E03', undefined, c); valid(f.check(previous));
  c.status = 'superseded'; c.superseded_by = 'E01'; invalid(f.check(), 'evidence_cycle');
});
test('source reconciliation is recorded without a fake task transition', t => {
  const f = fixture(t, true), previous = clone(f.tracker); const changedAudit = `${auditText}\nSynthetic source reconciliation note.\n`;
  f.put(AUDIT_PATH, changedAudit); f.tracker.source.sha256 = sha256(changedAudit);
  invalid(f.check(previous), 'append_only'); recordChange(f, 'source', 'audit', previous.source, f.tracker.source); valid(f.check(previous));
  assert.equal(f.task.state, 'closed'); assert.equal(f.tracker.journal.at(-1).kind, 'record_change');
  f.tracker.journal.at(-1).after_sha256 = '0'.repeat(64); invalid(f.check(), 'journal');
});
test('decision approval change retains actual before and after records', t => {
  const f = fixture(t, true), previous = clone(f.tracker); f.tracker.actors.push({ id: 'human', kind: 'human', description: 'Synthetic decision owner.' });
  const decision = f.tracker.decisions[0]; Object.assign(decision, { state: 'approved', actor_id: 'human', at: time(7), scope: 'Synthetic decision.', outcome: 'Synthetic approval.', record: f.put('fixtures/human-decision.md', 'Synthetic retained human decision.\n') });
  recordChange(f, 'decision', decision.id, previous.decisions[0], decision); valid(f.check(previous));
  const history = JSON.parse(readFileSync(resolve(f.rootDir, f.tracker.journal.at(-1).record.path), 'utf8')); assert.equal(history.before.state, 'pending'); assert.equal(history.after.record.path, decision.record.path);
});
test('CLI check/status are read-only, reject unknown commands and fail on drift', t => {
  const f = fixture(t); const script = 'scripts/remediation/board.mjs';
  f.put(script, readFileSync(resolve(repo, script), 'utf8')); f.put(TRACKER_PATH, JSON.stringify(f.tracker));
  const before = readFileSync(resolve(f.rootDir, TRACKER_PATH));
  for (const command of ['check', 'status']) {
    const result = spawnSync(process.execPath, [resolve(f.rootDir, script), command], { cwd: f.rootDir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /Tracker VALID/);
  }
  assert.deepEqual(readFileSync(resolve(f.rootDir, TRACKER_PATH)), before);
  assert.equal(spawnSync(process.execPath, [resolve(f.rootDir, script), 'close']).status, 2);
  f.put(AUDIT_PATH, `${auditText}\nChanged synthetic audit.\n`);
  const result = spawnSync(process.execPath, [resolve(f.rootDir, script), 'check'], { encoding: 'utf8' }); assert.equal(result.status, 1); assert.match(result.stdout, /audit_drift/);
  assert.deepEqual(readFileSync(resolve(f.rootDir, TRACKER_PATH)), before);
});
