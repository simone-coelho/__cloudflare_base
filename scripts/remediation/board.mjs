#!/usr/bin/env node
// Read-only governance checks. Records are assertions, not authenticated approvals.
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUDIT_PATH = 'docs/architecture/35-audit-verification-and-source-of-truth.md';
export const TRACKER_PATH = 'docs/remediation/tracker.json';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const list = value => Array.isArray(value) ? value : [];
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
const refs = text => [...new Set(text.match(/(?:F|N|W)\d{2}/g) ?? [])];
const cells = line => line.slice(1, -1).split('|').map(s => s.trim());
const section = (text, number) => text.split(new RegExp(`^## ${number} ·.*$`, 'm'))[1]?.split(/^## \d+ ·/m)[0] ?? '';
const digestPattern = /^[a-f0-9]{64}$/;
const permittedEfforts = ['xhigh', 'max', 'ultra'];
const transitions = {
  draft: ['ready', 'blocked'], ready: ['in_progress', 'draft', 'blocked'],
  in_progress: ['verification', 'blocked'], verification: ['closed', 'in_progress', 'blocked'],
  closed: ['reopened'], reopened: ['ready', 'blocked'], blocked: ['draft', 'ready', 'reopened'],
};
const claimRank = { source_confirmed: 0, local_synthetic: 1, local_runtime: 2, deployed: 3, customer_accepted: 4 };
const evidenceCeiling = {
  source_inventory: 0, design_review: 0, unit_test: 1, integration_test: 1,
  runtime_test: 2, deployed_test: 3, customer_acceptance: 4,
};

/** Canonical strings remain verbatim; a source edit requires explicit reconciliation. */
export function parseAudit(text) {
  const packages = section(text, 5).split('\n').filter(l => /^\| W\d{2} ·/.test(l)).map(line => {
    const [label, full_scope, finding_refs, sizing_owner] = cells(line);
    return { id: label.slice(0, 3), canonical: { gate_scope: label.slice(6), full_scope, finding_refs, sizing_owner } };
  });
  const findings = [...section(text, 2).matchAll(/^### (F\d{2}) · ([^\n]+)\n([\s\S]*?)(?=^### F\d{2} ·|$(?![\s\S]))/gm)].map(m => ({
    id: m[1], type: 'original_finding', alias_of: null,
    canonical: { title: m[2], disposition: m[3].trim() },
  }));
  for (const line of section(text, 3).split('\n').filter(l => /^\| N\d{2} \|/.test(l))) {
    const [id, disposition, relationship, evidence_work] = cells(line);
    findings.push({ id, type: ['N04', 'N28'].includes(id) ? 'duplicate_alias' : id === 'N21' ? 'model_validation_question' : id === 'N30' ? 'assurance' : 'issue_extension',
      alias_of: id === 'N04' ? 'N01' : id === 'N28' ? 'N06' : null,
      canonical: { disposition, relationship, evidence_work } });
  }
  const decisions = section(text, 7).split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Decision')).map((line, i) => {
    const [title, boundary] = cells(line);
    return { id: `D${String(i + 1).padStart(2, '0')}`, canonical: { title, boundary } };
  });
  const gates = section(text, 5).split('\n').filter(l => /^\| G[0-4] ·/.test(l)).map(line => {
    const [title, outcome] = cells(line);
    return { id: title.slice(0, 2), canonical: { title: title.slice(5), outcome } };
  });
  return { packages, findings, decisions, gates };
}

export function artifactDigest(artifact) {
  return sha256(JSON.stringify({ contract_digest: artifact.contract_digest, configuration: artifact.configuration,
    files: list(artifact.files).map(({ path, sha256: hash, role }) => ({ path, sha256: hash, role })).sort((a, b) => a.path.localeCompare(b.path)) }));
}

export const scopeFragments = scope => scope.split(/(?<=\.)\s+/).filter(Boolean);
export const taskContractDigest = task => sha256(JSON.stringify({
  id: task.id, package_id: task.package_id, kind: task.kind, scope: task.scope,
  read_paths: task.read_paths, write_paths: task.write_paths, non_goals: task.non_goals,
  criteria: task.criteria, checks: list(task.checks).map(({ id, required, criterion_ids, command, runtime, workload }) => ({ id, required, criterion_ids, command, runtime, workload })),
  dependencies: task.dependencies, assignments: task.assignments,
}));
export const decompositionDigest = p => sha256(JSON.stringify({ canonical: p.canonical,
  criteria: p.decomposition.criteria, coverage: p.decomposition.coverage, task_ids: p.decomposition.task_ids }));
export const packageCoverageDigest = (p, tasks) => sha256(JSON.stringify({ decomposition_digest: decompositionDigest(p),
  tasks: list(p.decomposition.task_ids).map(id => {
    const task = list(tasks).find(t => t.id === id);
    return { id, artifact_digest: task?.artifact?.digest, lead_signoff_sha256: sha256(JSON.stringify(task?.lead_signoff ?? null)) };
  }) }));

function safePath(path) {
  return nonempty(path) && !isAbsolute(path) && !path.includes('\\') && !path.split('/').some(p => ['..', '.', ''].includes(p)) && !/[?*\[\]{}]/.test(path);
}

/** previousTracker must come from an independently retained revision to check append-only history. */
export function validateTracker(tracker, options = {}) {
  try { return validateTrackerRecords(tracker, options); }
  catch (error) { return { ok: false, errors: [{ code: 'schema', message: `Malformed tracker: ${error.message}` }], warnings: [] }; }
}

function validateTrackerRecords(tracker, { rootDir = process.cwd(), auditText, previousTracker } = {}) {
  const errors = [], warnings = [];
  const error = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });
  const requireText = (value, label) => { if (!nonempty(value)) error('missing_field', `${label} must be nonempty`); };
  if (!tracker || typeof tracker !== 'object' || Array.isArray(tracker)) return { ok: false, errors: [{ code: 'schema', message: 'Tracker must be an object' }], warnings };
  const t = tracker;
  const getMap = (items, label) => {
    if (!Array.isArray(items)) error('schema', `${label} must be an array`);
    const map = new Map();
    for (const item of list(items)) {
      if (!item || !nonempty(item.id)) { error('id', `${label} has missing ID`); continue; }
      if (map.has(item.id)) error('duplicate_id', `${label} repeats ${item.id}`);
      map.set(item.id, item);
    }
    return map;
  };
  const exactIds = (map, expected, label) => {
    if (!equal([...map.keys()].sort(), [...expected].sort())) error('canonical_ids', `${label} must contain exactly ${expected.join(', ')}`);
  };
  const file = (record, label, historical = false) => {
    const fail = msg => (historical ? warn : error)('stale_proof', `${label}: ${msg}; preserve record and revalidate`);
    if (!record || !safePath(record.path) || !digestPattern.test(record.sha256 ?? '')) { fail('requires a relative local file and SHA256'); return; }
    try {
      const target = realpathSync(resolve(rootDir, record.path));
      const outside = relative(realpathSync(rootDir), target);
      if (outside.startsWith('../') || isAbsolute(outside) || !statSync(target).isFile()) { fail('file resolves outside repository or is not a file'); return; }
      if (sha256(readFileSync(target)) !== record.sha256) fail(`hash mismatch at ${record.path}`);
    } catch { fail(`missing/unreadable ${record.path}`); }
  };
  if (t.version !== 1) error('schema', 'Only tracker version 1 is supported');
  for (const field of ['packages', 'findings', 'decisions', 'gates', 'tasks', 'actors', 'evidence', 'journal']) if (!Array.isArray(t[field])) error('schema', `${field} must be an array`);
  if (t.source?.path !== AUDIT_PATH || !digestPattern.test(t.source?.sha256 ?? '')) error('audit_source', 'Canonical audit path and SHA256 are required');
  if (!equal(t.source?.sections, { packages: 5, findings: [2, 3], requirements: 4, decisions: 7 })) error('traceability', 'Audit section references must preserve package, finding, customer and decision authority');
  try { auditText ??= readFileSync(resolve(rootDir, AUDIT_PATH), 'utf8'); }
  catch { error('audit_source', 'Cannot read canonical audit'); auditText = ''; }
  if (sha256(auditText) !== t.source?.sha256) error('audit_drift', 'Canonical audit SHA256 changed: explicit reconciliation and reviewed repin required; no status was regenerated');
  const canonical = parseAudit(auditText);
  const packages = getMap(t.packages, 'packages'), findings = getMap(t.findings, 'findings');
  const decisions = getMap(t.decisions, 'decisions'), gates = getMap(t.gates, 'gates');
  const tasks = getMap(t.tasks, 'tasks'), actors = getMap(t.actors, 'actors'), evidence = getMap(t.evidence, 'evidence');
  exactIds(packages, ids('W', 41), 'packages'); exactIds(findings, [...ids('F', 35), ...ids('N', 30)], 'findings');
  exactIds(decisions, ids('D', 10), 'decisions'); exactIds(gates, ['G0', 'G1', 'G2', 'G3', 'G4'], 'gates');
  for (const key of ['packages', 'findings', 'decisions', 'gates']) {
    const actual = { packages, findings, decisions, gates }[key];
    if (canonical[key].length !== actual.size) error('audit_parse', `Canonical ${key} inventory does not match expected register`);
    for (const entry of canonical[key]) {
      const saved = actual.get(entry.id);
      if (!saved || !equal(saved.canonical, entry.canonical)) error('scope_drift', `${entry.id} canonical scope/classification differs from audit`);
      if (key === 'findings' && (saved?.type !== entry.type || saved?.alias_of !== entry.alias_of)) error('finding_type', `${entry.id} type or alias differs from audit`);
    }
  }
  const a = t.authority ?? {};
  if (!['framework_only', 'local_remediation_authorized'].includes(a.mode) || a.deployment !== false) error('authority', 'Only framework_only or explicitly authorized local remediation is supported; deployment remains unauthorized');
  if ((a.mode === 'framework_only' && (a.local_engine_changes !== false || a.local_authorization !== null)) || (a.mode === 'local_remediation_authorized' && a.local_engine_changes !== true)) error('authority', 'Authority mode and local engine permission disagree');
  if (a.model !== 'gpt-6-astra' || !equal(a.efforts, permittedEfforts) || a.max_active_tasks !== 1) error('authority', 'Require exact gpt-6-astra, xhigh/max/ultra, and one active task');
  if (t.release?.state !== 'not_authorized' || t.release?.human_authority !== null) error('release_authority', 'Release/deployment authority is separate and unsupported in v1');
  for (const actor of actors.values()) {
    if (!['agent', 'human', 'system'].includes(actor.kind)) error('actor', `${actor.id} has invalid actor kind`);
    if (actor.kind === 'agent' && (actor.model !== 'gpt-6-astra' || !permittedEfforts.includes(actor.effort) || !nonempty(actor.run_id))) error('agent_policy', `${actor.id} requires exact gpt-6-astra, xhigh/max/ultra and run ID`);
    requireText(actor.description, `${actor.id}.description`);
  }
  const actor = (id, label, role = false) => {
    const value = actors.get(id);
    if (!value || value.kind === 'system' || (role && value.kind !== 'agent')) error('actor', `${label} requires an assigned ${role ? 'agent' : 'agent/human'} actor`);
    return value;
  };
  if (a.mode === 'local_remediation_authorized') {
    const auth = a.local_authorization ?? {};
    if (actors.get(auth.actor_id)?.kind !== 'human') error('authority', 'Local implementation mandate requires a named human authority');
    if (!Number.isFinite(Date.parse(auth.at))) error('authority', 'Local implementation mandate requires timestamp');
    requireText(auth.description, 'local_authorization.description');
    file(auth.record, 'Local implementation authority record');
    if (!list(auth.scope_task_ids).length && !list(auth.scope_package_ids).length) error('authority', 'Local mandate needs explicit task or package scope');
    for (const id of list(auth.scope_task_ids)) if (!tasks.has(id)) error('dangling_reference', `Local mandate task ${id} missing`);
    for (const id of list(auth.scope_package_ids)) if (!packages.has(id)) error('dangling_reference', `Local mandate package ${id} missing`);
    if (!equal(auth.allowed_actions, ['local_engine_changes', 'local_checks'])) error('authority', 'Local mandate allowed_actions must be exactly local_engine_changes/local_checks; no cloud or destructive actions');
  }
  for (const p of packages.values()) {
    requireText(p.title, `${p.id}.title`); requireText(p.proposed_owner, `${p.id}.proposed_owner`);
    if (!equal(p.gates, [...new Set(p.canonical?.gate_scope?.match(/G[0-4]/g) ?? [])])) error('traceability', `${p.id} gate references changed`);
    if (!equal(p.source_findings, refs(p.canonical?.finding_refs ?? ''))) error('traceability', `${p.id} finding references changed`);
    for (const id of list(p.source_findings)) if (!findings.has(id)) error('dangling_reference', `${p.id} references missing ${id}`);
    if (!['open', 'scope_verified', 'containment_verified'].includes(p.scope_status)) error('unsupported_closure', `${p.id}: invalid package scope state`);
    if (p.closure_kind !== (p.id === 'W36' ? 'containment_only' : 'full_scope')) error('containment', `${p.id} closure kind differs from canonical scope`);
    if (p.id === 'W36' && (p.closure_kind !== 'containment_only' || !equal(p.cannot_close_findings, ['F14']))) error('containment', 'W36 is containment only and cannot close F14');
    const d = p.decomposition ?? {};
    if (!['unscoped', 'partial', 'scoped'].includes(d.status)) error('decomposition', `${p.id} must declare unscoped/partial/scoped decomposition`);
    for (const key of ['criteria', 'coverage', 'task_ids']) if (!Array.isArray(d[key])) error('decomposition', `${p.id}.${key} must be explicit`);
    if (d.status === 'unscoped' && (list(d.criteria).length || list(d.coverage).length)) error('decomposition', `${p.id} unscoped cannot claim complete criterion coverage`);
    const criteria = getMap(d.criteria, `${p.id} package criteria`);
    for (const c of criteria.values()) requireText(c.description, `${c.id}.description`);
    for (const id of list(d.task_ids)) if (tasks.get(id)?.package_id !== p.id) error('dangling_reference', `${p.id} task link ${id} is missing or belongs elsewhere`);
    for (const c of list(d.coverage)) if (!criteria.has(c.criterion_id) || tasks.get(c.task_id)?.package_id !== p.id || !list(tasks.get(c.task_id)?.criteria).some(x => x.id === c.task_criterion_id)) error('coverage', `${p.id} has dangling criterion/task coverage`);
    if (d.status === 'scoped' && (!criteria.size || [...criteria.keys()].some(id => !list(d.coverage).some(c => c.criterion_id === id)))) error('coverage', `${p.id} scoped decomposition requires criterion coverage`);
    if (d.status === 'scoped' || p.scope_status !== 'open') {
      const fragments = scopeFragments(p.canonical?.full_scope ?? '');
      const covered = [...criteria.values()].flatMap(c => list(c.scope_fragments));
      if (fragments.some(fragment => !covered.includes(fragment)) || covered.some(fragment => !fragments.includes(fragment))) error('coverage', `${p.id} decomposition must explicitly cover every verbatim canonical scope fragment`);
      const approval = d.approval ?? {};
      actor(approval.actor_id, `${p.id} decomposition approval`, true);
      if (approval.status !== 'approved' || approval.decomposition_digest !== decompositionDigest(p) || !Number.isFinite(Date.parse(approval.at))) error('decomposition', `${p.id} scoped decomposition requires approval of the exact scope/coverage digest`);
      file(approval.record, `${p.id} decomposition approval`);
    }
    if (p.scope_status !== 'open') {
      if (p.scope_status !== (p.id === 'W36' ? 'containment_verified' : 'scope_verified') || d.status !== 'scoped' || !list(d.task_ids).length || list(d.task_ids).some(id => tasks.get(id)?.state !== 'closed')) error('unsupported_closure', `${p.id} scope verification requires approved full decomposition and all linked tasks closed`);
      const digest = packageCoverageDigest(p, t.tasks), review = p.independent_review ?? {}, lead = p.lead_signoff ?? {};
      const implementerRuns = new Set(list(d.task_ids).map(id => actors.get(tasks.get(id)?.assignments?.implementer)?.run_id));
      for (const [record, name] of [[review, 'independent review'], [lead, 'lead signoff']]) {
        const who = actor(record.actor_id, `${p.id} ${name}`, true);
        if (record.status !== 'accepted' || record.coverage_digest !== digest || !Number.isFinite(Date.parse(record.at))) error('package_acceptance', `${p.id} ${name} must accept exact scope, coverage and task artifacts`);
        if (implementerRuns.has(who?.run_id)) error('self_review', `${p.id} ${name} run implemented a linked task`);
        requireText(record.limitations, `${p.id} ${name} limitations`); file(record.record, `${p.id} ${name}`);
      }
      if (actors.get(review.actor_id)?.run_id === actors.get(lead.actor_id)?.run_id) error('self_review', `${p.id} package reviewer and lead must be separate runs`);
      if (lead.review_sha256 !== sha256(JSON.stringify(review)) || Date.parse(lead.at) < Date.parse(review.at)) error('package_acceptance', `${p.id} lead must follow and bind exact independent review`);
      for (const id of list(d.task_ids)) if (Date.parse(tasks.get(id)?.lead_signoff?.at) > Date.parse(review.at)) error('package_acceptance', `${p.id} review predates task acceptance ${id}`);
    }
  }
  for (const f of findings.values()) {
    const expected = f.type === 'duplicate_alias' ? 'alias' : f.type === 'assurance' ? 'assurance_only' : f.type === 'model_validation_question' ? 'unresolved' : 'open';
    if (f.status !== expected) error('unsupported_closure', `${f.id}: finding disposition must remain ${expected}; no finding acceptance engine in v1`);
    if (f.alias_of && !findings.has(f.alias_of)) error('dangling_reference', `${f.id} alias missing`);
  }
  for (const g of gates.values()) if (g.state !== 'not_assessed') error('unsupported_gate', `${g.id}: gate pass/waiver unsupported; G0/G1 cannot be waived for real data`);
  for (const d of decisions.values()) {
    if (!['pending', 'approved'].includes(d.state)) error('decision', `${d.id}: only pending or explicitly recorded approved human decisions are supported`);
    if (d.state === 'approved') {
      if (actors.get(d.actor_id)?.kind !== 'human' || !Number.isFinite(Date.parse(d.at))) error('decision', `${d.id} approval requires human actor and timestamp`);
      requireText(d.scope, `${d.id} approved scope`); requireText(d.outcome, `${d.id} approved outcome`); file(d.record, `${d.id} human decision`);
    } else if (d.record !== null) error('decision', `${d.id} pending decision must not attach approval record`);
  }

  const journalStates = new Map(), journalTimes = new Map(), taskStarts = new Map(), taskAdmissions = new Map(), startEvents = new Map(), admissionEvents = new Map(), closureEvents = new Map(), changes = new Map();
  const changeValue = (subjectType, subjectId) => ({ source: () => t.source, authority: () => t.authority,
    decision: () => decisions.get(subjectId), evidence: () => evidence.get(subjectId), package: () => packages.get(subjectId),
    task_contract: () => tasks.has(subjectId) ? taskContractDigest(tasks.get(subjectId)) : undefined,
  }[subjectType]?.());
  let lastTime = -Infinity;
  for (const [index, event] of list(t.journal).entries()) {
    if (!event || typeof event !== 'object') { error('journal', 'Journal entry must be an object'); continue; }
    const time = Date.parse(event.at);
    if (event.seq !== index + 1 || !Number.isFinite(time) || time < lastTime) error('journal', 'Journal needs consecutive sequence and nondecreasing timestamps');
    lastTime = time;
    requireText(event.reason, `journal ${event.seq}.reason`);
    if (event.kind === 'record_change') {
      const value = changeValue(event.subject_type, event.subject_id), key = `${event.subject_type}:${event.subject_id}`;
      if (value === undefined || !nonempty(event.subject_id)) error('dangling_reference', `Journal ${event.seq}: unknown record-change subject`);
      actor(event.actor_id, `Journal ${event.seq} record change`);
      if ((!digestPattern.test(event.before_sha256 ?? '') && event.before_sha256 !== null) || !digestPattern.test(event.after_sha256 ?? '')) error('journal', `Journal ${event.seq}: record changes require before/after SHA256 (null only for creation)`);
      file(event.record, `Journal ${event.seq} retained change record`);
      try {
        const retained = JSON.parse(readFileSync(resolve(rootDir, event.record.path), 'utf8'));
        const before = retained.before === null ? null : sha256(JSON.stringify(retained.before));
        if (before !== event.before_sha256 || sha256(JSON.stringify(retained.after)) !== event.after_sha256) error('journal', `Journal ${event.seq}: retained record must contain exact before/after snapshots matching the digests`);
        if (retained.before?.record) file(retained.before.record, `Journal ${event.seq} historical authority/approval`, true);
      } catch { error('journal', `Journal ${event.seq}: retained change record must be readable JSON with before/after snapshots`); }
      if (changes.has(key) && changes.get(key).after_sha256 !== event.before_sha256) error('journal', `Journal ${event.seq}: record-change digest chain is broken`);
      changes.set(key, event); continue;
    }
    if (event.kind !== undefined && event.kind !== 'task_transition') error('journal', `Journal ${event.seq}: unknown event kind`);
    if (!tasks.has(event.task_id) || !actors.has(event.actor_id)) error('dangling_reference', `Journal ${event.seq} references missing task/actor`);
    const old = journalStates.get(event.task_id) ?? null;
    if (event.from !== old || !(old === null ? event.to === 'draft' : transitions[old]?.includes(event.to))) error('transition', `Journal ${event.seq}: invalid ${event.from} -> ${event.to}`);
    if (actors.get(event.actor_id)?.kind === 'system' && old !== null) error('actor', `Journal ${event.seq}: system cannot approve task transitions`);
    if (event.to === 'in_progress') { taskStarts.set(event.task_id, time); startEvents.set(event.task_id, event); }
    if (event.to === 'ready') { taskAdmissions.set(event.task_id, time); admissionEvents.set(event.task_id, event); }
    if (event.to === 'closed') closureEvents.set(event.task_id, event);
    if (event.to === 'in_progress' && (!digestPattern.test(event.plan_sha256 ?? '') || !Number.isFinite(Date.parse(event.plan_approved_at)) || Date.parse(event.plan_approved_at) > time)) error('preflight', `Journal ${event.seq}: start must retain approved plan hash and prior approval timestamp`);
    if (event.to === 'in_progress') {
      const snapshot = event.plan_snapshot ?? {};
      if (snapshot.status !== 'approved' || snapshot.plan?.sha256 !== event.plan_sha256 || snapshot.approval?.plan_sha256 !== event.plan_sha256 || snapshot.approval?.at !== event.plan_approved_at || !digestPattern.test(snapshot.contract_digest ?? '') || snapshot.approval?.actor_id !== event.assignments?.lead?.actor_id) error('preflight', `Journal ${event.seq}: start must bind the exact approved plan and historical lead`);
      file(snapshot.plan, `Journal ${event.seq} historical approved plan`, true);
    }
    if (event.to === 'blocked') for (const field of ['reason', 'owner', 'next_action']) requireText(event.blocked?.[field], `Journal ${event.seq}.blocked.${field}`);
    if (['ready', 'in_progress', 'verification', 'closed'].includes(event.to)) {
      const runs = [];
      for (const role of ['implementer', 'independent_reviewer', 'lead']) {
        const assignment = event.assignments?.[role], who = actor(assignment?.actor_id, `Journal ${event.seq} ${role}`, true);
        if (assignment?.run_id !== who?.run_id) error('actor', `Journal ${event.seq}: historical actor/run mismatch`);
        runs.push(assignment?.run_id);
      }
      if (new Set(runs).size !== runs.length) error('self_review', `Journal ${event.seq}: historical roles must have distinct run IDs`);
      if (['ready', 'closed'].includes(event.to) && event.actor_id !== event.assignments?.lead?.actor_id) error('actor', `Journal ${event.seq}: only historical assigned lead admits/closes task`);
    }
    journalStates.set(event.task_id, event.to); journalTimes.set(event.task_id, time);
  }
  for (const event of changes.values()) {
    if (event.after_sha256 !== sha256(JSON.stringify(changeValue(event.subject_type, event.subject_id)))) error('journal_mismatch', `Journal ${event.seq}: latest ${event.subject_type}/${event.subject_id} digest differs from current record`);
  }
  if (previousTracker) {
    const oldJournal = list(previousTracker.journal), oldEvidence = list(previousTracker.evidence);
    if (!equal(list(t.journal).slice(0, oldJournal.length), oldJournal)) error('append_only', 'Journal history was removed or edited versus retained prior tracker');
    for (const old of oldEvidence) {
      const current = evidence.get(old.id);
      // Supersession metadata can be appended; original proof and provenance stay immutable.
      const original = ({ status, superseded_by, ...record }) => record;
      if (!current || !equal(original(old), original(current))) error('append_only', `Historical evidence ${old.id} was removed or edited`);
      if (old.superseded_by && current?.superseded_by !== old.superseded_by) error('append_only', `Historical evidence ${old.id} supersession link cannot be rewritten`);
    }
    for (const old of list(previousTracker.tasks)) {
      const current = tasks.get(old.id);
      if (!current) { error('append_only', `Historical task ${old.id} was removed`); continue; }
      if (!equal(list(current.acceptance_history).slice(0, list(old.acceptance_history).length), list(old.acceptance_history))) error('append_only', `${old.id} acceptance history was edited`);
      const snapshot = { artifact: old.artifact, independent_review: old.independent_review, lead_signoff: old.lead_signoff };
      if (old.independent_review?.status === 'accepted' && (!equal(old.artifact, current.artifact) || !equal(old.independent_review, current.independent_review) || !equal(old.lead_signoff, current.lead_signoff)) && !list(current.acceptance_history).some(record => equal(record, snapshot))) error('append_only', `${old.id} changed acceptance must retain prior artifact/review/lead snapshot`);
    }
    const changed = (subjectType, subjectId, before, after) => {
      if (equal(before, after)) return;
      const event = list(t.journal).slice(oldJournal.length).find(e => e.kind === 'record_change' && e.subject_type === subjectType && e.subject_id === subjectId && e.before_sha256 === (before === undefined ? null : sha256(JSON.stringify(before))));
      if (!event || changes.get(`${subjectType}:${subjectId}`)?.after_sha256 !== sha256(JSON.stringify(after))) error('append_only', `${subjectType}/${subjectId} changed without a retained before/after governance journal record`);
    };
    changed('source', 'audit', previousTracker.source, t.source); changed('authority', 'local', previousTracker.authority, t.authority);
    for (const [name, currentItems] of [['decision', t.decisions], ['evidence', t.evidence], ['package', t.packages]]) {
      const oldItems = list(previousTracker[name === 'evidence' ? 'evidence' : `${name}s`]);
      for (const current of list(currentItems)) changed(name, current.id, oldItems.find(x => x.id === current.id), current);
    }
    for (const current of tasks.values()) {
      const old = list(previousTracker.tasks).find(x => x.id === current.id);
      if (old) changed('task_contract', current.id, taskContractDigest(old), taskContractDigest(current));
    }
  }
  const graph = new Map();
  const active = [];
  for (const task of tasks.values()) {
    const label = task.id;
    if (!/^W\d{2}\.\d{2,}$/.test(label) || !label.startsWith(`${task.package_id}.`) || !packages.has(task.package_id)) error('task_id', `${label} needs a canonical package and numbered subtask ID`);
    if (!list(packages.get(task.package_id)?.decomposition?.task_ids).includes(label)) error('dangling_reference', `${label} missing from package task list`);
    if (!Object.hasOwn(transitions, task.state)) error('state', `${label} has invalid state (blocked is never done)`);
    if (journalStates.get(label) !== task.state) error('journal_mismatch', `${label} current state does not match ordered journal`);
    if (!['design', 'implementation'].includes(task.kind)) error('task_kind', `${label} must be design or implementation`);
    if (task.kind === 'implementation' && (!['draft', 'blocked'].includes(task.state) || taskStarts.has(label))) {
      const auth = a.local_authorization ?? {};
      if (a.mode !== 'local_remediation_authorized' || (!list(auth.scope_task_ids).includes(label) && !list(auth.scope_package_ids).includes(task.package_id)) || (taskStarts.has(label) && Date.parse(auth.at) > taskStarts.get(label))) error('authority', `${label} engine implementation requires an earlier human mandate covering this task/package`);
    }
    for (const key of ['title', 'scope']) requireText(task[key], `${label}.${key}`);
    if (!list(task.non_goals).length) error('missing_field', `${label} needs explicit non-goals`);
    for (const key of ['read_paths', 'write_paths']) {
      if (!Array.isArray(task[key]) || !task[key].length) error('ownership', `${label}.${key} requires explicit paths`);
      for (const path of list(task[key])) {
        if (!safePath(path)) error('ownership', `${label} invalid/unbounded ${key}: ${path}`);
        if (key === 'write_paths' && task.kind === 'design' && ![`docs/remediation/evidence/${label}`, `docs/remediation/design/${label}`].some(prefix => path === prefix || path.startsWith(`${prefix}/`))) error('ownership', `${label} design writes must be task-specific evidence/design files`);
      }
    }
    if (['in_progress', 'verification'].includes(task.state)) active.push(task);
    const started = taskStarts.has(label), assigned = !['draft', 'blocked', 'reopened'].includes(task.state) || started;
    const roles = task.assignments ?? {};
    for (const key of ['implementer', 'independent_reviewer', 'lead']) {
      if (!Object.hasOwn(roles, key)) error('roles', `${label} needs explicit ${key}`);
      if (assigned || roles[key] !== null) actor(roles[key], `${label}.${key}`, true);
    }
    const runIds = Object.values(roles).filter(Boolean).map(id => actors.get(id)?.run_id).filter(Boolean);
    if (new Set(runIds).size !== runIds.length) error('self_review', `${label} implementer, independent reviewer and lead must have distinct run IDs`);
    const currentAssignments = event => ['implementer', 'independent_reviewer', 'lead'].every(role => event?.assignments?.[role]?.actor_id === roles[role] && event?.assignments?.[role]?.run_id === actors.get(roles[role])?.run_id);
    if (task.state === 'ready' && !currentAssignments(admissionEvents.get(label))) error('episode_binding', `${label} current admission must retain its actual assigned actor/run identities`);
    if (['in_progress', 'verification', 'closed'].includes(task.state) && !currentAssignments(startEvents.get(label))) error('episode_binding', `${label} current work must retain its actual assigned actor/run identities`);
    if (task.state === 'closed' && (!currentAssignments(closureEvents.get(label)) || closureEvents.get(label)?.actor_id !== roles.lead || closureEvents.get(label)?.actor_id !== task.lead_signoff?.actor_id)) error('episode_binding', `${label} current closure must be recorded by its assigned and accepting lead`);
    const criteria = getMap(task.criteria, `${label} criteria`), checks = getMap(task.checks, `${label} checks`);
    if (!criteria.size || !checks.size) error('coverage', `${label} needs criteria and required checks`);
    for (const c of criteria.values()) {
      requireText(c.description, `${c.id}.description`);
      if (!list(c.required_evidence_kinds).length || list(c.required_evidence_kinds).some(k => !Object.hasOwn(evidenceCeiling, k)) || !Object.hasOwn(claimRank, c.minimum_claim)) error('coverage', `${c.id} needs known evidence kinds and claim requirement`);
      if (![...checks.values()].some(check => check.required === true && list(check.criterion_ids).includes(c.id))) error('coverage', `${c.id} has no required check`);
    }
    for (const check of checks.values()) {
      for (const key of ['command', 'runtime', 'workload']) requireText(check[key], `${check.id}.${key}`);
      if (typeof check.required !== 'boolean' || !['not_run', 'pass', 'fail'].includes(check.result)) error('check', `${check.id} needs explicit required/result values`);
      if (!list(check.criterion_ids).length || list(check.criterion_ids).some(id => !criteria.has(id))) error('coverage', `${check.id} has missing criterion references`);
      if (!Array.isArray(check.evidence_ids)) error('check', `${check.id} evidence IDs must be explicit`);
      for (const id of list(check.evidence_ids)) {
        const proof = evidence.get(id);
        if (!proof || proof.task_id !== label || proof.check_id !== check.id || proof.status !== 'current') error('evidence_link', `${check.id} has missing, foreign or superseded evidence ${id}`);
        else if (proof.command !== check.command || proof.runtime !== check.runtime || proof.workload !== check.workload || proof.result !== check.result) error('evidence_link', `${check.id} result or execution basis differs from ${id}`);
      }
      if (check.result !== 'not_run' && !list(check.evidence_ids).length) error('missing_evidence', `${check.id} result requires evidence`);
      if (check.result === 'not_run' && list(check.evidence_ids).length) error('check', `${check.id} not_run cannot attach completed evidence`);
      if (task.state === 'closed' && check.required && check.result !== 'pass') error('required_check', `${label} cannot close with ${check.id} ${check.result}`);
    }
    const plan = task.preflight ?? {};
    if (!['pending', 'approved'].includes(plan.status)) error('preflight', `${label} requires explicit preflight status`);
    if (['ready', 'in_progress', 'verification', 'closed'].includes(task.state) || plan.status === 'approved') {
      if (plan.status !== 'approved') error('preflight', `${label} plan must be approved before implementation/work starts`);
      if (plan.contract_digest !== taskContractDigest(task)) error('contract_drift', `${label} approved plan no longer matches scope, criteria, checks, dependencies or ownership`);
      file(plan.plan, `${label} preflight plan`);
      const approval = plan.approval ?? {};
      actor(approval.actor_id, `${label} plan approval`);
      const approvalBoundary = task.state === 'ready' ? taskAdmissions.get(label) : ['in_progress', 'verification', 'closed'].includes(task.state) ? taskStarts.get(label) : undefined;
      if (approval.actor_id !== roles.lead || approval.plan_sha256 !== plan.plan?.sha256 || !Number.isFinite(Date.parse(approval.at)) || (approvalBoundary !== undefined && Date.parse(approval.at) > approvalBoundary)) error('preflight', `${label} needs lead approval of this plan before its current admission/work starts`);
      requireText(approval.rationale, `${label} plan approval rationale`);
      if (started && ['in_progress', 'verification', 'closed'].includes(task.state)) {
        const event = startEvents.get(label);
        if (event.plan_sha256 !== plan.plan?.sha256 || !equal(event.plan_snapshot, plan) || event.plan_approved_at !== plan.approval?.at) error('preflight', `${label} current work must use its exact admitted plan, approving actor and task contract; record a new admission for rework`);
      }
    }
    if (task.state === 'blocked') for (const field of ['reason', 'owner', 'next_action']) requireText(task.blocked?.[field], `${label}.blocked.${field}`);
    else if (task.blocked !== null) error('blocked', `${label} nonblocked task must set blocked:null and preserve history in journal`);
    const deps = list(task.dependencies); graph.set(label, []);
    if (!Array.isArray(task.dependencies)) error('dependency', `${label} needs explicit dependencies`);
    for (const dep of deps) {
      if (!['blocks_start', 'blocks_acceptance', 'informs'].includes(dep.kind)) error('dependency', `${label} invalid dependency kind`);
      requireText(dep.rationale, `${label} dependency rationale`);
      if (!['source_explicit', 'proposed'].includes(dep.origin)) error('dependency', `${label} dependency must label source_explicit or proposed origin`);
      requireText(dep.consumed_output, `${label} dependency consumed output`);
      const map = { task: tasks, package: packages, decision: decisions, gate: gates }[dep.target_type];
      const target = map?.get(dep.target_id);
      if (!target) { error('dangling_reference', `${label} dependency ${dep.target_id} missing`); continue; }
      if (dep.kind !== 'informs' && dep.target_type === 'task') graph.get(label).push(dep.target_id);
      if (dep.kind !== 'informs' && dep.target_type === 'package') graph.get(label).push(...list(target.decomposition?.task_ids));
      const accepted = (dep.target_type === 'task' && target.state === 'closed') || (dep.target_type === 'package' && ['scope_verified', 'containment_verified'].includes(target.scope_status)) || (dep.target_type === 'decision' && target.state === 'approved');
      if (!accepted && ((dep.kind === 'blocks_start' && ['ready', 'in_progress', 'verification', 'closed'].includes(task.state)) || (dep.kind === 'blocks_acceptance' && task.state === 'closed'))) error('prerequisite', `${label} unmet ${dep.kind} prerequisite ${dep.target_id}`);
      const acceptanceAt = dep.target_type === 'task' ? journalTimes.get(dep.target_id) : dep.target_type === 'package' ? Date.parse(target.lead_signoff?.at) : Date.parse(target.at);
      const neededAt = dep.kind === 'blocks_start' ? taskAdmissions.get(label) : dep.kind === 'blocks_acceptance' && task.state === 'closed' ? journalTimes.get(label) : undefined;
      if (accepted && neededAt !== undefined && (!Number.isFinite(acceptanceAt) || acceptanceAt > neededAt)) error('prerequisite_time', `${label} ${dep.target_id} was accepted after the ${dep.kind} admission/closure boundary`);
    }
    const artifact = task.artifact ?? {};
    if (!Array.isArray(task.acceptance_history)) error('schema', `${label} acceptance_history must be explicit`);
    for (const old of list(task.acceptance_history)) {
      if (old.artifact?.digest !== artifactDigest(old.artifact ?? {})) error('artifact_drift', `${label} historical artifact manifest was edited`);
      for (const record of list(old.artifact?.files)) file(record, `${label} historical artifact`, true);
      file(old.independent_review?.record, `${label} historical review`, true);
      if (old.lead_signoff?.status === 'accepted') file(old.lead_signoff?.record, `${label} historical lead signoff`, true);
    }
    if (!['not_recorded', 'recorded', 'revalidation_required'].includes(artifact.status)) error('artifact', `${label} requires explicit artifact status`);
    if (artifact.status === 'recorded' || artifact.status === 'revalidation_required') {
      const historical = artifact.status === 'revalidation_required';
      if (historical && !['reopened', 'blocked', 'draft'].includes(task.state)) error('artifact', `${label} revalidation_required artifact cannot advance until revalidated`);
      requireText(artifact.configuration, `${label} artifact configuration basis`);
      if (!historical && artifact.contract_digest !== taskContractDigest(task)) error('contract_drift', `${label} artifact no longer matches approved task contract`);
      if (!list(artifact.files).length || artifact.digest !== artifactDigest(artifact)) error('artifact_drift', `${label} artifact manifest digest invalid`);
      const paths = new Set();
      for (const record of list(artifact.files)) {
        if (!['source', 'output', 'configuration'].includes(record.role) || paths.has(record.path)) error('artifact', `${label} manifest needs unique paths and known roles`);
        paths.add(record.path); file(record, `${label} artifact`, historical);
        if (!historical && record.role === 'output' && !list(task.write_paths).some(path => record.path === path || record.path.startsWith(`${path}/`))) error('ownership', `${label} output artifact is outside assigned write paths`);
      }
      if (!historical) for (const path of list(task.write_paths)) if (/\.[a-z][a-z0-9]*$/i.test(path.split('/').at(-1)) && !list(artifact.files).some(record => record.role === 'output' && record.path === path)) error('artifact', `${label} declared file output ${path} is missing from manifest`);
    } else if (list(artifact.files).length || artifact.digest !== null || artifact.configuration !== null) error('artifact', `${label} not_recorded manifest must be explicitly empty`);
    if (task.state === 'closed' && artifact.status !== 'recorded') error('artifact', `${label} cannot close without artifact/configuration identity`);
    const review = task.independent_review ?? {}, lead = task.lead_signoff ?? {};
    if (!['not_requested', 'pending', 'accepted', 'rework'].includes(review.status) || !['pending', 'accepted', 'rework'].includes(lead.status)) error('review', `${label} review and lead status required`);
    for (const [record, role, name] of [[review, 'independent_reviewer', 'independent review'], [lead, 'lead', 'lead signoff']]) {
      if (record.status === 'accepted') {
        actor(record.actor_id, `${label} ${name}`, true);
        file(record.record, `${label} ${name} record`);
        requireText(record.limitations, `${label} ${name} limitations`);
        if (record.actor_id !== roles[role] || !artifact.digest || record.artifact_digest !== artifact.digest) error('review_drift', `${label} ${name} must bind the assigned actor and current artifact`);
        if (!Number.isFinite(Date.parse(record.at))) error('review', `${label} ${name} needs a timestamp`);
        if (started && Date.parse(record.at) < taskStarts.get(label)) error('review', `${label} ${name} predates the applicable work start`);
      }
    }
    if (lead.status === 'accepted' && (review.status !== 'accepted' || lead.review_sha256 !== sha256(JSON.stringify(review)) || Date.parse(lead.at) < Date.parse(review.at))) error('review_drift', `${label} lead signoff must follow and bind the exact independent review`);
    if (task.state === 'closed') {
      if (review.status !== 'accepted' || lead.status !== 'accepted') error('unsupported_closure', `${label} closure needs independent acceptance and separate lead signoff`);
      if (Date.parse(lead.at) > journalTimes.get(label)) error('journal', `${label} lead signoff must precede closure`);
      for (const check of checks.values()) if (check.required) for (const id of list(check.evidence_ids)) if (!list(review.evidence_ids).includes(id)) error('required_check_review', `${label} independent review omits required check ${check.id} proof ${id}`);
      for (const c of criteria.values()) for (const kind of list(c.required_evidence_kinds)) {
        const proof = [...evidence.values()].find(e => e.task_id === label && e.status === 'current' && e.result === 'pass' && e.kind === kind && list(e.criterion_ids).includes(c.id) && claimRank[e.claim] >= claimRank[c.minimum_claim] && list(review.evidence_ids).includes(e.id) && list(checks.get(e.check_id)?.evidence_ids).includes(e.id));
        if (!proof) error('criterion_evidence', `${label}/${c.id} lacks independently reviewed ${kind} proof meeting ${c.minimum_claim}`);
      }
      if (task.handoff?.status !== 'complete') error('handoff', `${label} closure needs a completed handoff`);
    }
    if (!['pending', 'complete'].includes(task.handoff?.status)) error('handoff', `${label} handoff status required`);
    if (task.handoff?.status === 'complete') file(task.handoff.record, `${label} durable handoff`);
    requireText(task.handoff?.next_action, `${label} handoff next action`);
    if (!safePath(task.handoff?.resume_path)) error('handoff', `${label} handoff requires local resume pointer`);
    for (const id of list(review.evidence_ids)) {
      const e = evidence.get(id);
      if (!e || e.task_id !== label || e.status !== 'current') error('evidence_link', `${label} review references missing/foreign/superseded ${id}`);
      else if (review.status === 'accepted' && Date.parse(e.at) > Date.parse(review.at)) error('review', `${label} review predates evidence ${id}`);
    }
  }
  if (active.length > 1) error('work_in_progress', `Only one integration task may be active: ${active.map(t => t.id).join(', ')}`);
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) for (const left of list(active[i].write_paths)) for (const right of list(active[j].write_paths)) if (left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) error('overlapping_ownership', `${active[i].id} and ${active[j].id} overlap at ${left} / ${right}`);
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    if (visiting.has(id)) { error('dependency_cycle', `Dependency cycle through ${id}`); return; }
    if (visited.has(id)) return;
    visiting.add(id); for (const next of graph.get(id) ?? []) visit(next); visiting.delete(id); visited.add(id);
  };
  for (const id of graph.keys()) visit(id);
  for (const e of evidence.values()) {
    const task = tasks.get(e.task_id);
    if (!task || !list(task.checks).some(c => c.id === e.check_id)) error('evidence_link', `${e.id} has missing task/check`);
    if (!list(e.criterion_ids).length || list(e.criterion_ids).some(id => !list(task?.criteria).some(c => c.id === id))) error('evidence_link', `${e.id} has missing criterion`);
    const who = actor(e.actor_id, `${e.id} evidence`);
    if (who?.kind === 'agent' && e.run_id !== who.run_id) error('actor', `${e.id} actor/run mismatch`);
    for (const key of ['command', 'runtime', 'workload', 'limitations', 'run_id']) requireText(e[key], `${e.id}.${key}`);
    if (!['pass', 'fail'].includes(e.result) || !['current', 'superseded', 'revalidation_required'].includes(e.status) || !Number.isFinite(Date.parse(e.at))) error('evidence', `${e.id} needs result, current/superseded/revalidation_required status and timestamp`);
    if (!Object.hasOwn(evidenceCeiling, e.kind) || !Object.hasOwn(claimRank, e.claim) || claimRank[e.claim] > evidenceCeiling[e.kind]) error('overclaim', `${e.id} claim is stronger than its evidence kind`);
    if (task?.kind === 'design' && claimRank[e.claim] > 1) error('overclaim', `${e.id} design acceptance cannot attest deployed/runtime correctness`);
    file(e.file, `${e.id} evidence`, e.status !== 'current');
    if (!e.artifact_basis || e.artifact_digest !== artifactDigest(e.artifact_basis) || e.artifact_basis.digest !== e.artifact_digest) error('artifact_drift', `${e.id} must retain the exact artifact/configuration basis`);
    if (e.status === 'current' && !equal(e.artifact_basis, task?.artifact)) error('artifact_drift', `${e.id} artifact basis differs from current task manifest`);
    if (e.status !== 'current') for (const record of list(e.artifact_basis?.files)) file(record, `${e.id} historical artifact`, true);
    if (e.status === 'current' && (!task?.artifact?.digest || e.artifact_digest !== task.artifact.digest)) error('artifact_drift', `${e.id} evidence was collected against a different artifact/configuration`);
    if (e.status === 'current' && (!taskStarts.has(e.task_id) || Date.parse(e.at) < taskStarts.get(e.task_id))) error('evidence_time', `${e.id} acceptance evidence must follow its applicable work start; preflight baselines belong in the retained plan`);
    if (e.status === 'superseded' && (!evidence.has(e.superseded_by) || evidence.get(e.superseded_by)?.task_id !== e.task_id || Date.parse(evidence.get(e.superseded_by)?.at) < Date.parse(e.at))) error('evidence', `${e.id} supersession must preserve history and identify a later replacement in this task`);
    if (e.status !== 'superseded' && e.superseded_by !== null) error('evidence', `${e.id} only superseded evidence may have a replacement link`);
    if (e.status === 'revalidation_required') warn('revalidation_required', `${e.id} is retained historical proof awaiting a replacement; it cannot support acceptance`);
  }
  for (const first of evidence.values()) {
    const seen = new Set(); let current = first;
    while (current?.status === 'superseded') {
      if (seen.has(current.id)) { error('evidence_cycle', `Supersession cycle through ${current.id}`); break; }
      seen.add(current.id); current = evidence.get(current.superseded_by);
    }
  }
  if (!tasks.has(t.resume?.task_id) || !safePath(t.resume?.path) || !nonempty(t.resume?.next_action) || t.resume?.journal_seq !== list(t.journal).length) error('resume', 'Resume requires current task, local path, next action and latest journal sequence');
  warnings.push({ code: 'limits', message: 'Checks validate recorded consistency and local hashes only; they do not authenticate people, attest deployed correctness, approve customer scope or authorize release. Append-only proof needs an independently retained prior tracker.' });
  return { ok: errors.length === 0, errors, warnings };
}

export function formatStatus(tracker, result) {
  const count = (items, key) => Object.entries(list(items).reduce((acc, item) => { acc[item[key]] = (acc[item[key]] ?? 0) + 1; return acc; }, {})).map(([key, n]) => `${key}=${n}`).join(', ');
  return [
    `Tracker ${result.ok ? 'VALID' : 'INVALID'} | mode=${tracker.authority?.mode}`,
    `Packages: ${list(tracker.packages).length}; scope ${count(tracker.packages, 'scope_status')}`,
    `Decomposition: ${count(list(tracker.packages).map(p => p.decomposition), 'status')}`,
    `Findings/register: ${list(tracker.findings).length}; ${count(tracker.findings, 'status')}`,
    `Tasks: ${count(tracker.tasks, 'state') || 'none'}; evidence records=${list(tracker.evidence).length}`,
    `Gates: ${list(tracker.gates).map(g => `${g.id}=${g.state}`).join(', ')}`,
    `Human decisions: ${count(tracker.decisions, 'state')}; release=${tracker.release?.state}`,
    `Resume: ${tracker.resume?.task_id} — ${tracker.resume?.next_action}`,
    ...result.errors.map(e => `ERROR ${e.code}: ${e.message}`),
    ...result.warnings.map(e => `NOTE ${e.code}: ${e.message}`),
    'No task, finding, package or gate was changed by this command.',
  ].join('\n');
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!['check', 'status'].includes(command) || args.length) {
    process.stderr.write('Usage: node scripts/remediation/board.mjs <check|status>\nRead-only; no mutation or automatic reconciliation commands.\n');
    process.exitCode = 2; return;
  }
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  try {
    const tracker = JSON.parse(readFileSync(resolve(rootDir, TRACKER_PATH), 'utf8'));
    const result = validateTracker(tracker, { rootDir });
    process.stdout.write(`${formatStatus(tracker, result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Tracker INVALID: ${error.message}\n`); process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
