import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  deriveStatus,
  makeReceiptTemplate,
  parseTicketIds,
  renderWorkOrder,
  validateProgram,
  validateReceipt,
  workOrderHash,
} from '../src/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const examplePath = resolve(here, '../examples/basic/program.json');

function exampleProgram() {
  return JSON.parse(readFileSync(examplePath, 'utf8'));
}

function validReceipt(program, ticketId = 'T01', kind = 'DELIVERY') {
  const receipt = makeReceiptTemplate(program, ticketId, kind);
  receipt.artifact = {
    revision: 'artifact-revision-123',
    repository: 'example/repository',
  };
  receipt.implementation = {
    actor: 'implementer-agent',
    evidence: [`evidence/${ticketId}/implementation.json`],
  };
  receipt.acceptance.evidence = [`evidence/${ticketId}/acceptance.tap`];
  receipt.integration.evidence = [`evidence/${ticketId}/integration.tap`];
  receipt.verification = {
    verdict: 'PASS',
    verifier: 'reviewer-agent',
    evidence: [`evidence/${ticketId}/verification.json`],
  };
  receipt.completedAt = '2026-09-20T16:00:00.000Z';
  return receipt;
}

test('the example program has a frozen, valid denominator', () => {
  const result = validateProgram(exampleProgram());
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
});

test('missing and extra tickets are rejected', () => {
  const missing = exampleProgram();
  missing.tickets.pop();
  const missingResult = validateProgram(missing);
  assert.equal(missingResult.valid, false);
  assert.ok(missingResult.errors.some(error => error.path === 'tickets' && error.message.includes('exactly 3')));

  const extra = exampleProgram();
  extra.tickets.push(structuredClone(extra.tickets[2]));
  extra.tickets[3].id = 'T04';
  const extraResult = validateProgram(extra);
  assert.equal(extraResult.valid, false);
  assert.ok(extraResult.errors.some(error => error.path === 'tickets' && error.message.includes('exactly 3')));
});

test('actionable placeholders fail closed', () => {
  const program = exampleProgram();
  program.tickets[0].outcome = 'TBD: decide later';
  const result = validateProgram(program);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path === 'tickets[0].outcome' && error.message.includes('TBD')));
  assert.ok(result.errors.some(error => error.path === 'tickets[0].outcome' && error.message.includes('decide later')));
});

test('DONE cannot be authored and only one ticket may be ACTIVE', () => {
  const authoredDone = exampleProgram();
  authoredDone.tickets[0].state = 'DONE';
  const doneResult = validateProgram(authoredDone);
  assert.equal(doneResult.valid, false);
  assert.ok(doneResult.errors.some(
    error => error.path === 'tickets[0].state' && error.message.includes('receipt-derived'),
  ));

  const multipleActive = exampleProgram();
  multipleActive.tickets[1].state = 'ACTIVE';
  const activeResult = validateProgram(multipleActive);
  assert.equal(activeResult.valid, false);
  assert.ok(activeResult.errors.some(
    error => error.path === 'tickets' && error.message.includes('only one'),
  ));
});

test('the specification gate requires independent review and a negative control', () => {
  const sameActor = exampleProgram();
  sameActor.tickets[0].specificationGate.reviewer = 'SPECIFIER-AGENT';
  const actorResult = validateProgram(sameActor);
  assert.equal(actorResult.valid, false);
  assert.ok(actorResult.errors.some(
    error => error.path === 'tickets[0].specificationGate.reviewer' && error.message.includes('specifier'),
  ));

  const noNegativeControl = exampleProgram();
  noNegativeControl.tickets[0].specificationGate.negativeControlEvidence = [];
  const controlResult = validateProgram(noNegativeControl);
  assert.equal(controlResult.valid, false);
  assert.ok(controlResult.errors.some(
    error => error.path === 'tickets[0].specificationGate.negativeControlEvidence',
  ));
});

test('a valid receipt derives local completion while live acceptance remains separate', () => {
  const program = exampleProgram();
  const receipt = validReceipt(program);
  const validation = validateReceipt(program, receipt);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2));

  const status = deriveStatus(program, new Map([['T01', receipt]]));
  assert.equal(status.valid, true, JSON.stringify(status.errors, null, 2));
  assert.equal(status.summary.localDone, 1);
  assert.equal(status.summary.finalDone, 0);
  assert.equal(status.tickets[0].state, 'DONE_LOCAL');
  assert.equal(status.next.id, 'T02');

  receipt.deferredLiveAcceptance[0] = {
    id: 'LIVE1',
    status: 'PASS',
    evidence: ['evidence/T01/live-walkthrough.json'],
  };
  const finalStatus = deriveStatus(program, new Map([['T01', receipt]]));
  assert.equal(finalStatus.summary.finalDone, 1);
  assert.equal(finalStatus.tickets[0].state, 'DONE_FINAL');
});

test('changing a frozen work order invalidates its old receipt', () => {
  const program = exampleProgram();
  const receipt = validReceipt(program);
  const originalHash = workOrderHash(program, 'T01');
  assert.equal(receipt.workOrderHash, originalHash);

  program.tickets[0].remainingWork.push('Publish the refusal code in the API reference.');
  const validation = validateReceipt(program, receipt);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.path === 'receipt.workOrderHash'));
});

test('routing state can advance without invalidating a completed work order', () => {
  const program = exampleProgram();
  const receipt = validReceipt(program, 'T01');
  const completedHash = workOrderHash(program, 'T01');

  program.tickets[0].state = 'INACTIVE';
  program.tickets[1].state = 'ACTIVE';

  assert.equal(workOrderHash(program, 'T01'), completedHash);
  const validation = validateReceipt(program, receipt);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2));

  const status = deriveStatus(program, new Map([['T01', receipt]]));
  assert.equal(status.valid, true, JSON.stringify(status.errors, null, 2));
  assert.equal(status.next.id, 'T02');
  assert.equal(status.next.state, 'ACTIVE');
});

test('the implementer cannot verify its own ticket', () => {
  const program = exampleProgram();
  const receipt = validReceipt(program);
  receipt.verification.verifier = 'IMPLEMENTER-AGENT';
  const validation = validateReceipt(program, receipt);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.path === 'receipt.verification.verifier'));
});

test('the implementer is separate from specification and the designated reviewer judges delivery', () => {
  const program = exampleProgram();

  const authoredBySpecifier = validReceipt(program);
  authoredBySpecifier.implementation.actor = 'specifier-agent';
  const specifierResult = validateReceipt(program, authoredBySpecifier);
  assert.equal(specifierResult.valid, false);
  assert.ok(specifierResult.errors.some(
    error => error.path === 'receipt.implementation.actor' && error.message.includes('specification actor'),
  ));

  const judgedBySomeoneElse = validReceipt(program);
  judgedBySomeoneElse.verification.verifier = 'another-reviewer';
  const reviewerResult = validateReceipt(program, judgedBySomeoneElse);
  assert.equal(reviewerResult.valid, false);
  assert.ok(reviewerResult.errors.some(
    error => error.path === 'receipt.verification.verifier' && error.message.includes('specification gate'),
  ));
});

test('delivery receipts cannot close a later ticket out of order', () => {
  const program = exampleProgram();
  const receipt = validReceipt(program, 'T03');
  const status = deriveStatus(program, new Map([['T03', receipt]]));
  assert.equal(status.valid, false);
  assert.ok(status.errors.some(error => error.path === 'receipts.T03' && error.message.includes('T01')));
});

test('an explicitly grandfathered adoption receipt may preserve prior completed work', () => {
  const program = exampleProgram();
  program.program.sequencePolicy.grandfatheredDoneTicketIds = ['T03'];
  const receipt = validReceipt(program, 'T03', 'ADOPTION');
  const status = deriveStatus(program, new Map([['T03', receipt]]));
  assert.equal(status.valid, true, JSON.stringify(status.errors, null, 2));
  assert.equal(status.summary.localDone, 1);
  assert.equal(status.next.id, 'T01');
});

test('grandfathering does not let a new delivery receipt bypass sequence', () => {
  const program = exampleProgram();
  program.program.sequencePolicy.grandfatheredDoneTicketIds = ['T03'];
  const receipt = validReceipt(program, 'T03', 'DELIVERY');
  const status = deriveStatus(program, new Map([['T03', receipt]]));
  assert.equal(status.valid, false);
  assert.ok(status.errors.some(error => error.path === 'receipts.T03' && error.message.includes('T01')));
});

test('a deferred decision must point to tracked deferred live acceptance', () => {
  const missingReference = exampleProgram();
  missingReference.tickets[0].decisions[0].status = 'DEFERRED_LIVE';
  const missingResult = validateProgram(missingReference);
  assert.equal(missingResult.valid, false);
  assert.ok(missingResult.errors.some(
    error => error.path === 'tickets[0].decisions[0].deferredAcceptanceId',
  ));

  const linked = exampleProgram();
  linked.tickets[0].decisions[0].status = 'DEFERRED_LIVE';
  linked.tickets[0].decisions[0].deferredAcceptanceId = 'LIVE1';
  const linkedResult = validateProgram(linked);
  assert.equal(linkedResult.valid, true, JSON.stringify(linkedResult.errors, null, 2));
});

test('a receipt template is deliberately invalid until exact evidence replaces placeholders', () => {
  const program = exampleProgram();
  const template = makeReceiptTemplate(program, 'T01');
  const result = validateReceipt(program, template);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.message.includes('replacement placeholder')));
});

test('receipt timestamps require a complete timezone and template kinds are constrained', () => {
  const program = exampleProgram();
  const receipt = validReceipt(program);
  receipt.completedAt = '2026-09-20';
  const result = validateReceipt(program, receipt);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path === 'receipt.completedAt'));
  assert.throws(() => makeReceiptTemplate(program, 'T01', 'HISTORICAL'), /receipt kind/);
  assert.throws(() => makeReceiptTemplate(program, 'T01', 'ADOPTION'), /explicitly grandfathered/);
});

test('work-order rendering includes the contract and its hash', () => {
  const program = exampleProgram();
  const rendered = renderWorkOrder(program, 'T01');
  assert.match(rendered, /^# T01 — Carry the validated session identity/m);
  assert.match(rendered, /## Acceptance criteria/);
  assert.match(rendered, /## Specification gate/);
  assert.match(rendered, new RegExp(workOrderHash(program, 'T01')));
  assert.match(rendered, /Deferred live acceptance/);
});

test('ticket range parsing supports full and compact expressions', () => {
  assert.deepEqual(parseTicketIds('W16-W19'), ['W16', 'W17', 'W18', 'W19']);
  assert.deepEqual(parseTicketIds('T01-03'), ['T01', 'T02', 'T03']);
  assert.deepEqual(parseTicketIds('A1,B2,C3'), ['A1', 'B2', 'C3']);
  assert.throws(() => parseTicketIds('W19-W16'), /descending/);
  assert.throws(() => parseTicketIds('W16,X17,W16'), /duplicates/);
});
