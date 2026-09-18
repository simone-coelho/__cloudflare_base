// Read-only scoped identity collector. Does not execute operational adapters or write files.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { artifactDigest, taskContractDigest } from '../../../../scripts/remediation/board.mjs';

const dir = 'docs/remediation/evidence/W02.02/';
const task = JSON.parse(readFileSync('docs/remediation/tracker.json')).tasks.find(t => t.id === 'W02.02');
const sha = value => createHash('sha256').update(value).digest('hex');
const tests = task.checks.find(check => check.id === 'W02.02-K1').command.split(' ').filter(part => part.endsWith('.test.ts'));
const local = await build({ entryPoints: tests, bundle: true, packages: 'external', write: false,
  outdir: '/tmp/w0202-not-written', metafile: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const tool = await build({ entryPoints: ['scripts/lib/tool-token.mjs'], bundle: true, write: false,
  metafile: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const log = readFileSync(dir + 'k2-final-v1.log', 'utf8');
const runtimeGraphs = log.split('\n').flatMap(line => {
  try { const row = JSON.parse(line); return row.phase?.endsWith('-inputs') ? [row] : []; } catch { return []; }
});
assert.equal(runtimeGraphs.length, 2, 'exact before/current runtime graphs');
const byPath = new Map();
const add = (path, role) => {
  if (path.startsWith('<')) return;
  assert.ok(existsSync(path), 'missing artifact file: ' + path);
  if (!byPath.has(path) || role === 'output') byPath.set(path, role);
};
for (const path of Object.keys(local.metafile.inputs)) add(path, 'source');
for (const path of Object.keys(tool.metafile.inputs)) add(path, 'source');
for (const graph of runtimeGraphs) for (const path of graph.inputs) add(path, 'source');
for (const path of task.write_paths.filter(path => !path.startsWith('docs/'))) add(path, 'output');
for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'src/sdk/tsconfig.json',
  ...['esbuild', 'hono', 'jose', 'zod', 'vitest', 'typescript', 'miniflare', 'workerd'].map(name => 'node_modules/' + name + '/package.json')]) {
  if (byPath.get(path) !== 'output') byPath.set(path, 'configuration');
}
for (const name of ['.gitignore', 'before-source.json', 'worker-baseline-v1.mjs', 'worker-baseline-v1.log',
  'worker-checks-v1.json', 'worker-source-freeze-v1.log', 'k1-first-pass-v1.log',
  'typecheck-command-failure-v1.log', 'typecheck-initial-failure-v1.log',
  'workerd-boundary.mjs', 'k1-final-v1.log', 'k2-final-v1.log', 'k3-final-v1.log',
  'reviewer-runtime-probe-v1.mjs', 'lead-artifact-v1.mjs']) add(dir + name, 'output');
const artifact = { status: 'recorded', contract_digest: taskContractDigest(task),
  configuration: 'W02.02 local Node22.15/Vitest real-route tests, selected actual-router Miniflare/workerd (2025-06-01 compatibility), isolated actual eight tool preflights. Local test dependency traversal uses installed packages external; complete selected workerd and Node token-helper bundle inputs, source/config/lockfile and installed package manifests pinned. Not complete runner/binary attestation, default-export/native-resource/deployed/customer acceptance. No operational scripts against live services or real credentials.',
  files: [...byPath].sort(([a], [b]) => a.localeCompare(b)).map(([path, role]) => ({ path, sha256: sha(readFileSync(path)), role })), digest: null };
artifact.digest = artifactDigest(artifact);
if (process.argv.includes('--verify')) {
  const frozen = JSON.parse(readFileSync(dir + 'artifact-manifest-v1.json'));
  assert.deepEqual(artifact, frozen, 'exact frozen graph, files and configuration');
  console.log(JSON.stringify({ at: new Date().toISOString(), result: 'pass', digest: artifact.digest,
    files: artifact.files.length, localInputs: Object.keys(local.metafile.inputs).length,
    nodeTokenInputs: Object.keys(tool.metafile.inputs).length,
    runtimeInputs: runtimeGraphs.map(({ phase, inputs }) => ({ phase, count: inputs.length })) }));
} else console.log(JSON.stringify(artifact, null, 2));
