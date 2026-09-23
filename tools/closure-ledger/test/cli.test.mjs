import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(root, 'bin/closure-ledger.mjs');
const program = resolve(root, 'examples/basic/program.json');

test('CLI check validates the example', () => {
  const output = execFileSync(process.execPath, [cli, 'check', '--program', program], { encoding: 'utf8' });
  assert.match(output, /PASS: example-remediation has exactly 3 frozen tickets/);
});

test('CLI status reports ticket-level progress only', () => {
  const output = execFileSync(process.execPath, [cli, 'status', '--program', program], { encoding: 'utf8' });
  assert.match(output, /Local done: 0\/3/);
  assert.match(output, /Next: T01 \[ACTIVE\]/);
  assert.doesNotMatch(output, /units/i);
  assert.doesNotMatch(output, /percent/i);
});

test('CLI render emits a complete work order', () => {
  const output = execFileSync(process.execPath, [cli, 'render', 'T01', '--program', program], { encoding: 'utf8' });
  assert.match(output, /# T01/);
  assert.match(output, /Work-order hash/);
  assert.match(output, /## Done when/);
});

test('CLI fails closed on an unknown ticket', () => {
  const result = spawnSync(process.execPath, [cli, 'hash', 'T99', '--program', program], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ticket not found/);
});

test('CLI init freezes the requested denominator but leaves the draft fail-closed', t => {
  const scratch = mkdtempSync(join(tmpdir(), 'closure-ledger-init-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const target = resolve(scratch, 'program');
  const created = spawnSync(
    process.execPath,
    [
      cli,
      'init',
      '--dir', target,
      '--ids', 'W16-W41',
      '--program-id', 'portable-remediation',
      '--title', 'Portable Remediation',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(created.status, 0, created.stderr);

  const draft = JSON.parse(readFileSync(resolve(target, 'program.json'), 'utf8'));
  assert.equal(draft.program.ticketIds.length, 26);
  assert.deepEqual(draft.program.ticketIds.slice(0, 2), ['W16', 'W17']);
  assert.deepEqual(draft.program.ticketIds.slice(-2), ['W40', 'W41']);

  const validation = spawnSync(
    process.execPath,
    [cli, 'check', '--program', resolve(target, 'program.json')],
    { encoding: 'utf8' },
  );
  assert.equal(validation.status, 1);
  assert.match(validation.stderr, /TBD/);

  const overwrite = spawnSync(
    process.execPath,
    [
      cli,
      'init',
      '--dir', target,
      '--ids', 'W16-W41',
      '--program-id', 'portable-remediation',
      '--title', 'Portable Remediation',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /not empty/);
});

test('CLI receipt templates use exclusive creation and remain invalid until completed', t => {
  const scratch = mkdtempSync(join(tmpdir(), 'closure-ledger-receipt-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const receipt = resolve(scratch, 'T01.json');
  const created = spawnSync(
    process.execPath,
    [cli, 'receipt-template', 'T01', '--program', program, '--out', receipt],
    { encoding: 'utf8' },
  );
  assert.equal(created.status, 0, created.stderr);

  const template = JSON.parse(readFileSync(receipt, 'utf8'));
  assert.equal(template.ticketId, 'T01');
  assert.match(template.workOrderHash, /^sha256:[0-9a-f]{64}$/);

  const validation = spawnSync(
    process.execPath,
    [cli, 'check', '--program', program, '--receipts', scratch],
    { encoding: 'utf8' },
  );
  assert.equal(validation.status, 1);
  assert.match(validation.stderr, /replacement placeholder/);

  const overwrite = spawnSync(
    process.execPath,
    [cli, 'receipt-template', 'T01', '--program', program, '--out', receipt],
    { encoding: 'utf8' },
  );
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /EEXIST|file already exists/i);
});

test('CLI derives the next whole ticket from a completed receipt', t => {
  const scratch = mkdtempSync(join(tmpdir(), 'closure-ledger-status-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const receiptPath = resolve(scratch, 'T01.json');
  execFileSync(
    process.execPath,
    [cli, 'receipt-template', 'T01', '--program', program, '--out', receiptPath],
    { encoding: 'utf8' },
  );

  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.artifact = { revision: 'artifact-revision-123', repository: 'example/repository' };
  receipt.implementation = {
    actor: 'implementer-agent',
    evidence: ['evidence/T01/implementation.json'],
  };
  receipt.acceptance.evidence = ['evidence/T01/acceptance.tap'];
  receipt.integration.evidence = ['evidence/T01/integration.tap'];
  receipt.verification.evidence = ['evidence/T01/verification.json'];
  receipt.completedAt = '2026-09-20T16:00:00.000Z';
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  const status = execFileSync(
    process.execPath,
    [cli, 'status', '--program', program, '--receipts', scratch],
    { encoding: 'utf8' },
  );
  assert.match(status, /Local done: 1\/3/);
  assert.match(status, /Final accepted: 0\/3/);
  assert.match(status, /Next: T02 \[READY\]/);
  assert.doesNotMatch(status, /criteria.*\//i);
});
