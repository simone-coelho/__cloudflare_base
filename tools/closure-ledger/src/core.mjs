import { createHash } from 'node:crypto';

export const SCHEMA_VERSION = 1;

export const TICKET_STATES = Object.freeze([
  'NOT_STARTED',
  'RECONCILE',
  'READY',
  'ACTIVE',
  'INACTIVE',
  'BUILT_PENDING_VERIFY',
  'PARTIAL',
  'BLOCKED',
]);

export const EXECUTION_MODES = Object.freeze([
  'IMPLEMENTATION',
  'RECONCILIATION',
  'VERIFICATION_ONLY',
]);

export const CRITERION_KINDS = Object.freeze([
  'LOCAL',
  'DECISION',
  'DEFERRED_LIVE',
]);

export const DECISION_STATUSES = Object.freeze([
  'RESOLVED',
  'DEFERRED_LIVE',
]);

export const RECEIPT_KINDS = Object.freeze([
  'DELIVERY',
  'ADOPTION',
]);

const COMPLETION_POLICY = 'LOCAL_WITH_SEPARATE_LIVE';
const SEQUENCE_MODE = 'STRICT';
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

const AMBIGUITY_PATTERNS = [
  { pattern: /\bTBD\b/i, label: 'TBD' },
  { pattern: /\bTODO\b/i, label: 'TODO' },
  { pattern: /\bFIXME\b/i, label: 'FIXME' },
  { pattern: /\bXXX\b/i, label: 'XXX' },
  { pattern: /\bno[-_ ]?witness\b/i, label: 'no-witness' },
  { pattern: /\bto be determined\b/i, label: 'to be determined' },
  { pattern: /\bdecide later\b/i, label: 'decide later' },
  { pattern: /\bas needed\b/i, label: 'as needed' },
  { pattern: /\betc\.(?:\s|$)/i, label: 'etc.' },
  { pattern: /<[^>\n]+>/, label: 'angle-bracket placeholder' },
  { pattern: /REPLACE_(?:ME|WITH)[A-Z0-9_]*/i, label: 'replacement placeholder' },
];

const ROOT_KEYS = ['schemaVersion', 'program', 'tickets'];
const PROGRAM_KEYS = [
  'id',
  'title',
  'ticketIds',
  'maxActive',
  'completionPolicy',
  'integrationGateCommand',
  'sequencePolicy',
];
const SEQUENCE_KEYS = ['mode', 'grandfatheredDoneTicketIds'];
const TICKET_KEYS = [
  'id',
  'title',
  'state',
  'executionMode',
  'authority',
  'outcome',
  'criteria',
  'existingEvidence',
  'remainingWork',
  'decisions',
  'deferredLiveAcceptance',
  'allowedPaths',
  'acceptanceCommand',
  'specificationGate',
  'doneWhen',
  'blockers',
];
const AUTHORITY_KEYS = ['source', 'locator', 'requirement'];
const CRITERION_KEYS = [
  'id',
  'kind',
  'observable',
  'proof',
  'decisionId',
  'deferredAcceptanceId',
];
const EVIDENCE_KEYS = ['ref', 'description'];
const DECISION_KEYS = ['id', 'status', 'authorityRef', 'effect', 'deferredAcceptanceId'];
const DEFERRED_KEYS = ['id', 'description', 'owner', 'proof'];
const BLOCKER_KEYS = ['id', 'kind', 'condition', 'owner', 'evidence'];
const SPECIFICATION_KEYS = [
  'specifier',
  'reviewer',
  'reviewedRevision',
  'verdict',
  'evidence',
  'negativeControlEvidence',
];

const RECEIPT_KEYS = [
  'schemaVersion',
  'kind',
  'ticketId',
  'workOrderHash',
  'artifact',
  'implementation',
  'acceptance',
  'integration',
  'verification',
  'completedAt',
  'deferredLiveAcceptance',
];
const ARTIFACT_KEYS = ['revision', 'repository'];
const IMPLEMENTATION_KEYS = ['actor', 'evidence'];
const RESULT_KEYS = ['command', 'result', 'evidence'];
const VERIFICATION_KEYS = ['verdict', 'verifier', 'evidence'];
const RECEIPT_DEFERRED_KEYS = ['id', 'status', 'evidence'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

function checkObject(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, 'must be an object');
    return false;
  }
  return true;
}

function checkKnownKeys(value, allowed, path, errors) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) addError(errors, `${path}.${key}`, 'is not an allowed field');
  }
}

function checkString(value, path, errors, { actionable = false, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    addError(errors, path, allowEmpty ? 'must be a string' : 'must be a non-empty string');
    return false;
  }
  if (actionable) checkAmbiguity(value, path, errors);
  return true;
}

function checkAmbiguity(value, path, errors) {
  for (const { pattern, label } of AMBIGUITY_PATTERNS) {
    if (pattern.test(value)) addError(errors, path, `contains forbidden ambiguous text: ${label}`);
  }
}

function checkId(value, path, errors) {
  if (!checkString(value, path, errors)) return false;
  if (!ID_PATTERN.test(value)) {
    addError(errors, path, 'must begin with a letter and contain only letters, digits, dot, underscore, or hyphen');
    return false;
  }
  return true;
}

function checkStringArray(value, path, errors, { min = 0, actionable = false } = {}) {
  if (!Array.isArray(value)) {
    addError(errors, path, 'must be an array');
    return false;
  }
  if (value.length < min) addError(errors, path, `must contain at least ${min} item(s)`);
  value.forEach((entry, index) => checkString(entry, `${path}[${index}]`, errors, { actionable }));
  return true;
}

function checkUniqueIds(items, path, errors) {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    const id = item?.id;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (seen.has(id)) addError(errors, `${path}[${index}].id`, `duplicates id ${id}`);
    seen.add(id);
  }
  return seen;
}

function checkEvidenceList(value, path, errors) {
  if (!Array.isArray(value)) {
    addError(errors, path, 'must be an array');
    return;
  }
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!checkObject(entry, entryPath, errors)) return;
    checkKnownKeys(entry, EVIDENCE_KEYS, entryPath, errors);
    checkString(entry.ref, `${entryPath}.ref`, errors, { actionable: true });
    checkString(entry.description, `${entryPath}.description`, errors, { actionable: true });
  });
}

function checkDecisions(value, path, deferredIds, errors) {
  if (!Array.isArray(value)) {
    addError(errors, path, 'must be an array');
    return new Set();
  }
  const ids = checkUniqueIds(value, path, errors);
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!checkObject(entry, entryPath, errors)) return;
    checkKnownKeys(entry, DECISION_KEYS, entryPath, errors);
    checkId(entry.id, `${entryPath}.id`, errors);
    if (!DECISION_STATUSES.includes(entry.status)) {
      addError(errors, `${entryPath}.status`, `must be one of ${DECISION_STATUSES.join(', ')}`);
    }
    checkString(entry.authorityRef, `${entryPath}.authorityRef`, errors, { actionable: true });
    checkString(entry.effect, `${entryPath}.effect`, errors, { actionable: true });
    if (entry.status === 'DEFERRED_LIVE') {
      if (checkString(entry.deferredAcceptanceId, `${entryPath}.deferredAcceptanceId`, errors)) {
        if (!deferredIds.has(entry.deferredAcceptanceId)) {
          addError(
            errors,
            `${entryPath}.deferredAcceptanceId`,
            `does not name deferred live acceptance declared by this ticket: ${entry.deferredAcceptanceId}`,
          );
        }
      }
    }
    else if (Object.hasOwn(entry, 'deferredAcceptanceId')) {
      addError(errors, `${entryPath}.deferredAcceptanceId`, 'is allowed only for DEFERRED_LIVE decisions');
    }
  });
  return ids;
}

function checkDeferred(value, path, errors) {
  if (!Array.isArray(value)) {
    addError(errors, path, 'must be an array');
    return new Set();
  }
  const ids = checkUniqueIds(value, path, errors);
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!checkObject(entry, entryPath, errors)) return;
    checkKnownKeys(entry, DEFERRED_KEYS, entryPath, errors);
    checkId(entry.id, `${entryPath}.id`, errors);
    checkString(entry.description, `${entryPath}.description`, errors, { actionable: true });
    checkString(entry.owner, `${entryPath}.owner`, errors, { actionable: true });
    checkString(entry.proof, `${entryPath}.proof`, errors, { actionable: true });
  });
  return ids;
}

function checkCriteria(value, path, decisionIds, deferredIds, errors) {
  if (!Array.isArray(value)) {
    addError(errors, path, 'must be an array');
    return;
  }
  if (value.length === 0) addError(errors, path, 'must contain at least one acceptance criterion');
  checkUniqueIds(value, path, errors);
  const referencedDeferred = new Set();

  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!checkObject(entry, entryPath, errors)) return;
    checkKnownKeys(entry, CRITERION_KEYS, entryPath, errors);
    checkId(entry.id, `${entryPath}.id`, errors);
    if (!CRITERION_KINDS.includes(entry.kind)) {
      addError(errors, `${entryPath}.kind`, `must be one of ${CRITERION_KINDS.join(', ')}`);
    }
    checkString(entry.observable, `${entryPath}.observable`, errors, { actionable: true });
    checkString(entry.proof, `${entryPath}.proof`, errors, { actionable: true });

    if (entry.kind === 'DECISION') {
      if (!checkString(entry.decisionId, `${entryPath}.decisionId`, errors)) return;
      if (!decisionIds.has(entry.decisionId)) {
        addError(errors, `${entryPath}.decisionId`, `does not name a decision declared by this ticket: ${entry.decisionId}`);
      }
    }
    else if (Object.hasOwn(entry, 'decisionId')) {
      addError(errors, `${entryPath}.decisionId`, 'is allowed only for DECISION criteria');
    }

    if (entry.kind === 'DEFERRED_LIVE') {
      if (!checkString(entry.deferredAcceptanceId, `${entryPath}.deferredAcceptanceId`, errors)) return;
      if (!deferredIds.has(entry.deferredAcceptanceId)) {
        addError(
          errors,
          `${entryPath}.deferredAcceptanceId`,
          `does not name deferred live acceptance declared by this ticket: ${entry.deferredAcceptanceId}`,
        );
      }
      referencedDeferred.add(entry.deferredAcceptanceId);
    }
    else if (Object.hasOwn(entry, 'deferredAcceptanceId')) {
      addError(errors, `${entryPath}.deferredAcceptanceId`, 'is allowed only for DEFERRED_LIVE criteria');
    }
  });

  for (const id of deferredIds) {
    if (!referencedDeferred.has(id)) {
      addError(errors, path, `deferred live acceptance ${id} is not referenced by a DEFERRED_LIVE criterion`);
    }
  }
}

function checkBlockers(value, path, state, errors) {
  if (!Array.isArray(value)) {
    addError(errors, path, 'must be an array');
    return;
  }
  checkUniqueIds(value, path, errors);
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!checkObject(entry, entryPath, errors)) return;
    checkKnownKeys(entry, BLOCKER_KEYS, entryPath, errors);
    checkId(entry.id, `${entryPath}.id`, errors);
    checkString(entry.kind, `${entryPath}.kind`, errors, { actionable: true });
    checkString(entry.condition, `${entryPath}.condition`, errors, { actionable: true });
    checkString(entry.owner, `${entryPath}.owner`, errors, { actionable: true });
    checkString(entry.evidence, `${entryPath}.evidence`, errors, { actionable: true });
  });
  if (state === 'BLOCKED' && value.length === 0) addError(errors, path, 'must name at least one exact blocker');
  if (state !== 'BLOCKED' && value.length > 0) addError(errors, path, 'must be empty unless state is BLOCKED');
}

function checkSpecificationGate(value, path, errors) {
  if (!checkObject(value, path, errors)) return;
  checkKnownKeys(value, SPECIFICATION_KEYS, path, errors);
  checkString(value.specifier, `${path}.specifier`, errors, { actionable: true });
  checkString(value.reviewer, `${path}.reviewer`, errors, { actionable: true });
  checkString(value.reviewedRevision, `${path}.reviewedRevision`, errors, { actionable: true });
  if (value.verdict !== 'PASS') {
    addError(errors, `${path}.verdict`, 'must equal PASS before implementation may begin');
  }
  checkStringArray(value.evidence, `${path}.evidence`, errors, { min: 1, actionable: true });
  checkStringArray(
    value.negativeControlEvidence,
    `${path}.negativeControlEvidence`,
    errors,
    { min: 1, actionable: true },
  );
  if (
    typeof value.specifier === 'string'
    && typeof value.reviewer === 'string'
    && value.specifier.trim().toLowerCase() === value.reviewer.trim().toLowerCase()
  ) {
    addError(errors, `${path}.reviewer`, 'must differ from the specifier');
  }
}

function checkTicket(ticket, index, expectedId, errors) {
  const path = `tickets[${index}]`;
  if (!checkObject(ticket, path, errors)) return;
  checkKnownKeys(ticket, TICKET_KEYS, path, errors);
  checkId(ticket.id, `${path}.id`, errors);
  if (ticket.id !== expectedId) {
    addError(errors, `${path}.id`, `must be ${expectedId}; tickets must follow program.ticketIds order`);
  }
  checkString(ticket.title, `${path}.title`, errors, { actionable: true });
  if (!TICKET_STATES.includes(ticket.state)) {
    addError(errors, `${path}.state`, `must be one of ${TICKET_STATES.join(', ')}; DONE is receipt-derived`);
  }
  if (!EXECUTION_MODES.includes(ticket.executionMode)) {
    addError(errors, `${path}.executionMode`, `must be one of ${EXECUTION_MODES.join(', ')}`);
  }

  if (checkObject(ticket.authority, `${path}.authority`, errors)) {
    checkKnownKeys(ticket.authority, AUTHORITY_KEYS, `${path}.authority`, errors);
    checkString(ticket.authority.source, `${path}.authority.source`, errors);
    checkString(ticket.authority.locator, `${path}.authority.locator`, errors);
    // The authority is quoted verbatim and may legitimately contain words that
    // are forbidden in an executable work order, so it is not ambiguity-scanned.
    checkString(ticket.authority.requirement, `${path}.authority.requirement`, errors);
  }

  checkString(ticket.outcome, `${path}.outcome`, errors, { actionable: true });
  const deferredIds = checkDeferred(ticket.deferredLiveAcceptance, `${path}.deferredLiveAcceptance`, errors);
  const decisionIds = checkDecisions(ticket.decisions, `${path}.decisions`, deferredIds, errors);
  checkCriteria(ticket.criteria, `${path}.criteria`, decisionIds, deferredIds, errors);
  checkEvidenceList(ticket.existingEvidence, `${path}.existingEvidence`, errors);
  checkStringArray(ticket.remainingWork, `${path}.remainingWork`, errors, { min: 1, actionable: true });
  checkStringArray(ticket.allowedPaths, `${path}.allowedPaths`, errors, { actionable: true });

  if (ticket.executionMode === 'IMPLEMENTATION' && Array.isArray(ticket.allowedPaths) && ticket.allowedPaths.length === 0) {
    addError(errors, `${path}.allowedPaths`, 'must name at least one writable path for IMPLEMENTATION');
  }
  if (
    ['RECONCILIATION', 'VERIFICATION_ONLY'].includes(ticket.executionMode)
    && Array.isArray(ticket.allowedPaths)
    && ticket.allowedPaths.length > 0
  ) {
    addError(errors, `${path}.allowedPaths`, `${ticket.executionMode} is read-only and must not grant writable paths`);
  }
  if (ticket.state === 'RECONCILE' && ticket.executionMode !== 'RECONCILIATION') {
    addError(errors, `${path}.executionMode`, 'must be RECONCILIATION when state is RECONCILE');
  }
  if (ticket.state === 'BUILT_PENDING_VERIFY' && ticket.executionMode !== 'VERIFICATION_ONLY') {
    addError(errors, `${path}.executionMode`, 'must be VERIFICATION_ONLY when state is BUILT_PENDING_VERIFY');
  }

  checkString(ticket.acceptanceCommand, `${path}.acceptanceCommand`, errors, { actionable: true });
  checkSpecificationGate(ticket.specificationGate, `${path}.specificationGate`, errors);
  checkStringArray(ticket.doneWhen, `${path}.doneWhen`, errors, { min: 3, actionable: true });
  checkBlockers(ticket.blockers, `${path}.blockers`, ticket.state, errors);
}

export function validateProgram(document) {
  const errors = [];
  if (!checkObject(document, '$', errors)) return { valid: false, errors };
  checkKnownKeys(document, ROOT_KEYS, '$', errors);
  if (document.schemaVersion !== SCHEMA_VERSION) {
    addError(errors, 'schemaVersion', `must equal ${SCHEMA_VERSION}`);
  }
  if (!checkObject(document.program, 'program', errors)) return { valid: false, errors };
  checkKnownKeys(document.program, PROGRAM_KEYS, 'program', errors);
  checkId(document.program.id, 'program.id', errors);
  checkString(document.program.title, 'program.title', errors, { actionable: true });
  checkStringArray(document.program.ticketIds, 'program.ticketIds', errors, { min: 1 });

  const ticketIds = Array.isArray(document.program.ticketIds) ? document.program.ticketIds : [];
  const uniqueTicketIds = new Set();
  ticketIds.forEach((id, index) => {
    checkId(id, `program.ticketIds[${index}]`, errors);
    if (uniqueTicketIds.has(id)) addError(errors, `program.ticketIds[${index}]`, `duplicates ticket id ${id}`);
    uniqueTicketIds.add(id);
  });

  if (document.program.maxActive !== 1) {
    addError(errors, 'program.maxActive', 'must equal 1; this method permits one active ticket');
  }
  if (document.program.completionPolicy !== COMPLETION_POLICY) {
    addError(errors, 'program.completionPolicy', `must equal ${COMPLETION_POLICY}`);
  }
  checkString(document.program.integrationGateCommand, 'program.integrationGateCommand', errors, { actionable: true });

  if (checkObject(document.program.sequencePolicy, 'program.sequencePolicy', errors)) {
    checkKnownKeys(document.program.sequencePolicy, SEQUENCE_KEYS, 'program.sequencePolicy', errors);
    if (document.program.sequencePolicy.mode !== SEQUENCE_MODE) {
      addError(errors, 'program.sequencePolicy.mode', `must equal ${SEQUENCE_MODE}`);
    }
    checkStringArray(
      document.program.sequencePolicy.grandfatheredDoneTicketIds,
      'program.sequencePolicy.grandfatheredDoneTicketIds',
      errors,
    );
    const seen = new Set();
    for (const [index, id] of (document.program.sequencePolicy.grandfatheredDoneTicketIds ?? []).entries()) {
      const path = `program.sequencePolicy.grandfatheredDoneTicketIds[${index}]`;
      if (seen.has(id)) addError(errors, path, `duplicates grandfathered ticket ${id}`);
      if (!uniqueTicketIds.has(id)) addError(errors, path, `does not name a ticket in program.ticketIds: ${id}`);
      seen.add(id);
    }
  }

  if (!Array.isArray(document.tickets)) {
    addError(errors, 'tickets', 'must be an array');
    return { valid: false, errors };
  }
  if (document.tickets.length !== ticketIds.length) {
    addError(errors, 'tickets', `must contain exactly ${ticketIds.length} ticket(s), one for every frozen ticket id`);
  }

  const active = document.tickets.filter(ticket => ticket?.state === 'ACTIVE');
  if (active.length > 1) addError(errors, 'tickets', `contains ${active.length} ACTIVE tickets; only one is allowed`);

  const max = Math.max(document.tickets.length, ticketIds.length);
  for (let index = 0; index < max; index += 1) {
    if (index >= document.tickets.length) continue;
    checkTicket(document.tickets[index], index, ticketIds[index], errors);
  }

  return { valid: errors.length === 0, errors };
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalize(value[key])]),
  );
}

export function workOrderHash(document, ticketId) {
  const ticket = document?.tickets?.find(candidate => candidate?.id === ticketId);
  if (!ticket) throw new Error(`ticket not found: ${ticketId}`);
  // Routing state changes as the lead advances the program. Completion is
  // pinned to the closure contract, not to that mutable scheduling marker.
  const { state: _routingState, ...ticketContract } = ticket;
  const contract = {
    schemaVersion: document.schemaVersion,
    program: {
      id: document.program.id,
      ticketIds: document.program.ticketIds,
      maxActive: document.program.maxActive,
      completionPolicy: document.program.completionPolicy,
      integrationGateCommand: document.program.integrationGateCommand,
      sequencePolicy: document.program.sequencePolicy,
    },
    ticket: ticketContract,
  };
  const encoded = JSON.stringify(canonicalize(contract));
  return `sha256:${createHash('sha256').update(encoded).digest('hex')}`;
}

function checkReceiptEvidence(value, path, errors, { min = 1 } = {}) {
  checkStringArray(value, path, errors, { min, actionable: true });
}

function checkReceiptResult(value, path, expectedCommand, errors) {
  if (!checkObject(value, path, errors)) return;
  checkKnownKeys(value, RESULT_KEYS, path, errors);
  checkString(value.command, `${path}.command`, errors, { actionable: true });
  if (value.command !== expectedCommand) {
    addError(errors, `${path}.command`, 'does not match the frozen work-order command');
  }
  if (value.result !== 'PASS') addError(errors, `${path}.result`, 'must equal PASS to close a ticket');
  checkReceiptEvidence(value.evidence, `${path}.evidence`, errors);
}

export function validateReceipt(document, receipt) {
  const errors = [];
  const programValidation = validateProgram(document);
  if (!programValidation.valid) {
    return {
      valid: false,
      errors: programValidation.errors.map(error => ({
        path: `program.${error.path}`,
        message: error.message,
      })),
    };
  }
  if (!checkObject(receipt, '$receipt', errors)) return { valid: false, errors };
  checkKnownKeys(receipt, RECEIPT_KEYS, '$receipt', errors);
  if (receipt.schemaVersion !== SCHEMA_VERSION) {
    addError(errors, 'receipt.schemaVersion', `must equal ${SCHEMA_VERSION}`);
  }
  if (!RECEIPT_KINDS.includes(receipt.kind)) {
    addError(errors, 'receipt.kind', `must be one of ${RECEIPT_KINDS.join(', ')}`);
  }
  checkString(receipt.ticketId, 'receipt.ticketId', errors);
  const ticket = document?.tickets?.find(candidate => candidate?.id === receipt.ticketId);
  if (!ticket) {
    addError(errors, 'receipt.ticketId', `does not name a ticket in the program: ${receipt.ticketId}`);
    return { valid: false, errors };
  }

  if (receipt.kind === 'ADOPTION') {
    const grandfathered = document.program.sequencePolicy.grandfatheredDoneTicketIds ?? [];
    if (!grandfathered.includes(receipt.ticketId)) {
      addError(errors, 'receipt.kind', 'ADOPTION is allowed only for a ticket explicitly grandfathered by the program');
    }
  }

  checkString(receipt.workOrderHash, 'receipt.workOrderHash', errors);
  if (typeof receipt.workOrderHash === 'string' && !HASH_PATTERN.test(receipt.workOrderHash)) {
    addError(errors, 'receipt.workOrderHash', 'must use sha256:<64 lowercase hex characters>');
  }
  const expectedHash = workOrderHash(document, receipt.ticketId);
  if (receipt.workOrderHash !== expectedHash) {
    addError(errors, 'receipt.workOrderHash', `does not match the frozen work order (${expectedHash})`);
  }

  if (checkObject(receipt.artifact, 'receipt.artifact', errors)) {
    checkKnownKeys(receipt.artifact, ARTIFACT_KEYS, 'receipt.artifact', errors);
    checkString(receipt.artifact.revision, 'receipt.artifact.revision', errors, { actionable: true });
    if (Object.hasOwn(receipt.artifact, 'repository')) {
      checkString(receipt.artifact.repository, 'receipt.artifact.repository', errors, { actionable: true });
    }
  }

  if (checkObject(receipt.implementation, 'receipt.implementation', errors)) {
    checkKnownKeys(receipt.implementation, IMPLEMENTATION_KEYS, 'receipt.implementation', errors);
    checkString(receipt.implementation.actor, 'receipt.implementation.actor', errors, { actionable: true });
    checkReceiptEvidence(receipt.implementation.evidence, 'receipt.implementation.evidence', errors);
  }

  checkReceiptResult(receipt.acceptance, 'receipt.acceptance', ticket.acceptanceCommand, errors);
  checkReceiptResult(
    receipt.integration,
    'receipt.integration',
    document.program.integrationGateCommand,
    errors,
  );

  if (checkObject(receipt.verification, 'receipt.verification', errors)) {
    checkKnownKeys(receipt.verification, VERIFICATION_KEYS, 'receipt.verification', errors);
    if (receipt.verification.verdict !== 'PASS') {
      addError(errors, 'receipt.verification.verdict', 'must equal PASS to close a ticket');
    }
    checkString(receipt.verification.verifier, 'receipt.verification.verifier', errors, { actionable: true });
    checkReceiptEvidence(receipt.verification.evidence, 'receipt.verification.evidence', errors);
  }

  if (
    typeof receipt.implementation?.actor === 'string'
    && typeof receipt.verification?.verifier === 'string'
    && receipt.implementation.actor.trim().toLowerCase() === receipt.verification.verifier.trim().toLowerCase()
  ) {
    addError(errors, 'receipt.verification.verifier', 'must differ from the implementation actor');
  }
  if (
    typeof receipt.implementation?.actor === 'string'
    && typeof ticket.specificationGate?.specifier === 'string'
    && receipt.implementation.actor.trim().toLowerCase() === ticket.specificationGate.specifier.trim().toLowerCase()
  ) {
    addError(errors, 'receipt.implementation.actor', 'must differ from the specification actor');
  }
  if (
    typeof receipt.implementation?.actor === 'string'
    && typeof ticket.specificationGate?.reviewer === 'string'
    && receipt.implementation.actor.trim().toLowerCase() === ticket.specificationGate.reviewer.trim().toLowerCase()
  ) {
    addError(errors, 'receipt.implementation.actor', 'must differ from the specification reviewer');
  }
  if (
    typeof receipt.verification?.verifier === 'string'
    && typeof ticket.specificationGate?.reviewer === 'string'
    && receipt.verification.verifier.trim().toLowerCase() !== ticket.specificationGate.reviewer.trim().toLowerCase()
  ) {
    addError(errors, 'receipt.verification.verifier', 'must equal the reviewer named by the specification gate');
  }

  checkString(receipt.completedAt, 'receipt.completedAt', errors);
  if (
    typeof receipt.completedAt === 'string'
    && (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.completedAt)
      || Number.isNaN(Date.parse(receipt.completedAt))
    )
  ) {
    addError(errors, 'receipt.completedAt', 'must be a complete ISO-8601 timestamp with a timezone');
  }

  if (!Array.isArray(receipt.deferredLiveAcceptance)) {
    addError(errors, 'receipt.deferredLiveAcceptance', 'must be an array');
  }
  else {
    const expected = ticket.deferredLiveAcceptance.map(item => item.id);
    const actual = receipt.deferredLiveAcceptance.map(item => item?.id);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      addError(
        errors,
        'receipt.deferredLiveAcceptance',
        `must list exactly these ids in order: ${expected.join(', ') || '(none)'}`,
      );
    }
    checkUniqueIds(receipt.deferredLiveAcceptance, 'receipt.deferredLiveAcceptance', errors);
    receipt.deferredLiveAcceptance.forEach((entry, index) => {
      const path = `receipt.deferredLiveAcceptance[${index}]`;
      if (!checkObject(entry, path, errors)) return;
      checkKnownKeys(entry, RECEIPT_DEFERRED_KEYS, path, errors);
      checkString(entry.id, `${path}.id`, errors);
      if (!['PENDING', 'PASS'].includes(entry.status)) {
        addError(errors, `${path}.status`, 'must be PENDING or PASS');
      }
      checkReceiptEvidence(entry.evidence, `${path}.evidence`, errors, { min: entry.status === 'PASS' ? 1 : 0 });
    });
  }

  return { valid: errors.length === 0, errors, ticket };
}

function receiptEntries(receipts) {
  if (receipts instanceof Map) return [...receipts.entries()];
  return Object.entries(receipts ?? {});
}

export function deriveStatus(document, receipts = {}) {
  const programValidation = validateProgram(document);
  if (!programValidation.valid) {
    return {
      valid: false,
      errors: programValidation.errors,
      tickets: [],
      summary: null,
      next: null,
    };
  }

  const errors = [];
  const receiptMap = new Map(receiptEntries(receipts));
  for (const [ticketId, receipt] of receiptMap) {
    if (!document.program.ticketIds.includes(ticketId)) {
      addError(errors, `receipts.${ticketId}`, 'does not belong to this program');
      continue;
    }
    if (receipt?.ticketId !== ticketId) {
      addError(errors, `receipts.${ticketId}.ticketId`, `must equal receipt map key ${ticketId}`);
    }
  }

  const tickets = document.program.ticketIds.map(id => {
    const ticket = document.tickets.find(candidate => candidate.id === id);
    const receipt = receiptMap.get(id);
    if (!receipt) {
      return {
        id,
        title: ticket.title,
        state: ticket.state,
        localDone: false,
        finalDone: false,
        deferredPending: ticket.deferredLiveAcceptance.length,
        receiptErrors: [],
      };
    }
    const validation = validateReceipt(document, receipt);
    if (!validation.valid) {
      validation.errors.forEach(error => addError(errors, `receipts.${id}.${error.path}`, error.message));
      return {
        id,
        title: ticket.title,
        state: 'INVALID_RECEIPT',
        localDone: false,
        finalDone: false,
        deferredPending: ticket.deferredLiveAcceptance.length,
        receiptErrors: validation.errors,
      };
    }
    const deferredPending = receipt.deferredLiveAcceptance.filter(item => item.status !== 'PASS').length;
    return {
      id,
      title: ticket.title,
      state: deferredPending === 0 ? 'DONE_FINAL' : 'DONE_LOCAL',
      localDone: true,
      finalDone: deferredPending === 0,
      deferredPending,
      receiptErrors: [],
      artifactRevision: receipt.artifact.revision,
      receiptKind: receipt.kind,
    };
  });

  for (const [index, ticket] of tickets.entries()) {
    if (!ticket.localDone || ticket.receiptKind === 'ADOPTION') continue;
    const unfinishedEarlier = tickets.slice(0, index).find(candidate => !candidate.localDone);
    if (unfinishedEarlier) {
      addError(
        errors,
        `receipts.${ticket.id}`,
        `closes out of order while earlier ticket ${unfinishedEarlier.id} is not locally done`,
      );
    }
  }

  const next = tickets.find(ticket => !ticket.localDone) ?? null;
  const active = tickets.find(ticket => ticket.state === 'ACTIVE');
  if (active && next && active.id !== next.id) {
    addError(errors, `tickets.${active.id}.state`, `is ACTIVE but the next unfinished ticket is ${next.id}`);
  }

  const byState = {};
  for (const ticket of tickets) byState[ticket.state] = (byState[ticket.state] ?? 0) + 1;
  const summary = {
    total: tickets.length,
    localDone: tickets.filter(ticket => ticket.localDone).length,
    finalDone: tickets.filter(ticket => ticket.finalDone).length,
    deferredPendingTickets: tickets.filter(ticket => ticket.deferredPending > 0).length,
    byState,
  };

  return {
    valid: errors.length === 0,
    errors,
    tickets,
    summary,
    next,
  };
}

function escapeTable(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function listOrNone(values, render) {
  if (!Array.isArray(values) || values.length === 0) return '_None._';
  return values.map(render).join('\n');
}

export function renderWorkOrder(document, ticketId) {
  const validation = validateProgram(document);
  if (!validation.valid) throw new Error('program is invalid; run check before rendering a work order');
  const ticket = document.tickets.find(candidate => candidate.id === ticketId);
  if (!ticket) throw new Error(`ticket not found: ${ticketId}`);

  const criterionRows = ticket.criteria.map(criterion => {
    const reference = criterion.decisionId ?? criterion.deferredAcceptanceId ?? '—';
    return `| ${escapeTable(criterion.id)} | ${criterion.kind} | ${escapeTable(criterion.observable)} | `
      + `${escapeTable(criterion.proof)} | ${escapeTable(reference)} |`;
  });
  const decisionRows = ticket.decisions.map(decision =>
    `| ${escapeTable(decision.id)} | ${decision.status} | ${escapeTable(decision.authorityRef)} | `
      + `${escapeTable(decision.effect)} | ${escapeTable(decision.deferredAcceptanceId ?? '—')} |`);
  const deferredRows = ticket.deferredLiveAcceptance.map(item =>
    `| ${escapeTable(item.id)} | ${escapeTable(item.description)} | ${escapeTable(item.owner)} | ${escapeTable(item.proof)} |`);
  const blockerRows = ticket.blockers.map(blocker =>
    `| ${escapeTable(blocker.id)} | ${escapeTable(blocker.kind)} | ${escapeTable(blocker.condition)} | `
      + `${escapeTable(blocker.owner)} | ${escapeTable(blocker.evidence)} |`);

  const lines = [
    `# ${ticket.id} — ${ticket.title}`,
    '',
    `**Starting state:** ${ticket.state}  `,
    `**Execution mode:** ${ticket.executionMode}  `,
    `**Work-order hash:** \`${workOrderHash(document, ticketId)}\``,
    '',
    '## Authority',
    '',
    `Source: \`${ticket.authority.source}\` (${ticket.authority.locator})`,
    '',
    ...ticket.authority.requirement.split('\n').map(line => `> ${line}`),
    '',
    '## Required outcome',
    '',
    ticket.outcome,
    '',
    '## Acceptance criteria',
    '',
    '| ID | Kind | Observable | Proof | Reference |',
    '|---|---|---|---|---|',
    ...criterionRows,
    '',
    '## Existing evidence',
    '',
    listOrNone(ticket.existingEvidence, item => `- ${item.description} — \`${item.ref}\``),
    '',
    '## Remaining work',
    '',
    ...ticket.remainingWork.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## Decisions',
    '',
    ...(decisionRows.length > 0
      ? [
          '| ID | Status | Authority | Effect | Deferred acceptance |',
          '|---|---|---|---|---|',
          ...decisionRows,
        ]
      : ['_None._']),
    '',
    '## Deferred live acceptance',
    '',
    ...(deferredRows.length > 0
      ? ['| ID | Requirement | Owner | Proof |', '|---|---|---|---|', ...deferredRows]
      : ['_None._']),
    '',
    '## Write boundary',
    '',
    ticket.allowedPaths.length > 0
      ? ticket.allowedPaths.map(path => `- \`${path}\``).join('\n')
      : '_Read-only. No writable paths._',
    '',
    '## Acceptance command',
    '',
    '```text',
    ticket.acceptanceCommand,
    '```',
    '',
    '## Specification gate',
    '',
    `Specifier: ${ticket.specificationGate.specifier}  `,
    `Reviewer: ${ticket.specificationGate.reviewer}  `,
    `Reviewed revision: \`${ticket.specificationGate.reviewedRevision}\`  `,
    `Verdict: **${ticket.specificationGate.verdict}**`,
    '',
    'Review evidence:',
    ...ticket.specificationGate.evidence.map(item => `- \`${item}\``),
    '',
    'Negative-control evidence:',
    ...ticket.specificationGate.negativeControlEvidence.map(item => `- \`${item}\``),
    '',
    '## Integration gate',
    '',
    '```text',
    document.program.integrationGateCommand,
    '```',
    '',
    '## Done when',
    '',
    ...ticket.doneWhen.map(item => `- ${item}`),
    '',
    '## Blockers',
    '',
    ...(blockerRows.length > 0
      ? ['| ID | Kind | Condition | Owner | Evidence |', '|---|---|---|---|---|', ...blockerRows]
      : ['_None._']),
    '',
  ];
  return lines.join('\n');
}

export function makeReceiptTemplate(document, ticketId, kind = 'DELIVERY') {
  const validation = validateProgram(document);
  if (!validation.valid) throw new Error('program is invalid; run check before creating a receipt template');
  const ticket = document.tickets.find(candidate => candidate.id === ticketId);
  if (!ticket) throw new Error(`ticket not found: ${ticketId}`);
  if (!RECEIPT_KINDS.includes(kind)) {
    throw new Error(`receipt kind must be one of ${RECEIPT_KINDS.join(', ')}`);
  }
  if (kind === 'ADOPTION' && !document.program.sequencePolicy.grandfatheredDoneTicketIds.includes(ticketId)) {
    throw new Error('ADOPTION is allowed only for a ticket explicitly grandfathered by the program');
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    kind,
    ticketId,
    workOrderHash: workOrderHash(document, ticketId),
    artifact: {
      revision: 'REPLACE_WITH_EXACT_REVISION',
      repository: 'REPLACE_WITH_REPOSITORY_OR_ARTIFACT_ID',
    },
    implementation: {
      actor: 'REPLACE_WITH_IMPLEMENTATION_ACTOR',
      evidence: ['REPLACE_WITH_IMPLEMENTATION_EVIDENCE'],
    },
    acceptance: {
      command: ticket.acceptanceCommand,
      result: 'PASS',
      evidence: ['REPLACE_WITH_ACCEPTANCE_EVIDENCE'],
    },
    integration: {
      command: document.program.integrationGateCommand,
      result: 'PASS',
      evidence: ['REPLACE_WITH_INTEGRATION_EVIDENCE'],
    },
    verification: {
      verdict: 'PASS',
      verifier: ticket.specificationGate.reviewer,
      evidence: ['REPLACE_WITH_VERIFICATION_EVIDENCE'],
    },
    completedAt: 'REPLACE_WITH_ISO_8601_TIMESTAMP',
    deferredLiveAcceptance: ticket.deferredLiveAcceptance.map(item => ({
      id: item.id,
      status: 'PENDING',
      evidence: [],
    })),
  };
}

export function parseTicketIds(input) {
  if (typeof input !== 'string' || input.trim().length === 0) throw new Error('ticket id expression is empty');
  const result = [];
  for (const rawToken of input.split(',')) {
    const token = rawToken.trim();
    if (token.length === 0) throw new Error('ticket id expression contains an empty item');
    const fullRange = /^([A-Za-z][A-Za-z0-9._-]*?)(\d+)-([A-Za-z][A-Za-z0-9._-]*?)(\d+)$/.exec(token);
    const shortRange = /^([A-Za-z][A-Za-z0-9._-]*?)(\d+)-(\d+)$/.exec(token);
    if (!fullRange && !shortRange) {
      if (!ID_PATTERN.test(token)) throw new Error(`invalid ticket id: ${token}`);
      result.push(token);
      continue;
    }
    const prefix = (fullRange ?? shortRange)[1];
    const startText = (fullRange ?? shortRange)[2];
    const endPrefix = fullRange ? fullRange[3] : prefix;
    const endText = fullRange ? fullRange[4] : shortRange[3];
    if (prefix !== endPrefix) throw new Error(`range prefixes differ: ${prefix} and ${endPrefix}`);
    const start = Number(startText);
    const end = Number(endText);
    if (end < start) throw new Error(`descending ranges are not supported: ${token}`);
    if (end - start > 999) throw new Error(`range is too large: ${token}`);
    const width = Math.max(startText.length, endText.length);
    for (let value = start; value <= end; value += 1) {
      result.push(`${prefix}${String(value).padStart(width, '0')}`);
    }
  }
  if (new Set(result).size !== result.length) throw new Error('ticket id expression contains duplicates');
  return result;
}

export function makeDraftProgram({ id, title, ticketIds }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    program: {
      id,
      title,
      ticketIds,
      maxActive: 1,
      completionPolicy: COMPLETION_POLICY,
      integrationGateCommand: 'TBD: replace with one exact integration command',
      sequencePolicy: {
        mode: SEQUENCE_MODE,
        grandfatheredDoneTicketIds: [],
      },
    },
    tickets: ticketIds.map(ticketId => ({
      id: ticketId,
      title: `TBD: ${ticketId} title`,
      state: 'NOT_STARTED',
      executionMode: 'IMPLEMENTATION',
      authority: {
        source: 'TBD: authoritative source',
        locator: 'TBD: exact locator',
        requirement: 'TBD: copy the authoritative requirement verbatim',
      },
      outcome: 'TBD: one observable outcome',
      criteria: [
        {
          id: 'A1',
          kind: 'LOCAL',
          observable: 'TBD: exact observable behavior',
          proof: 'TBD: exact proof',
        },
      ],
      existingEvidence: [],
      remainingWork: ['TBD: one finite implementation action'],
      decisions: [],
      deferredLiveAcceptance: [],
      allowedPaths: ['TBD: exact writable path'],
      acceptanceCommand: 'TBD: one exact ticket command',
      specificationGate: {
        specifier: 'TBD: specification actor',
        reviewer: 'TBD: independent reviewer actor',
        reviewedRevision: 'TBD: exact reviewed test revision',
        verdict: 'PASS',
        evidence: ['TBD: specification review evidence'],
        negativeControlEvidence: ['TBD: negative-control evidence'],
      },
      doneWhen: [
        'The frozen acceptance command returns PASS.',
        'The program integration gate returns PASS once.',
        'A distinct verifier records PASS at the exact artifact revision.',
      ],
      blockers: [],
    })),
  };
}
