// Evidence-only, read-only current-source identity reconstruction.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { artifactDigest, taskContractDigest, sha256 } from '../../../../scripts/remediation/board.mjs';
const dir = 'docs/remediation/evidence/W02.01/';
const old = JSON.parse(readFileSync(dir + 'artifact-manifest-v1.json'));
const task = JSON.parse(readFileSync('docs/remediation/tracker.json')).tasks.find(t => t.id === 'W02.01');
const text = readFileSync(dir + 'reviewer-probe-v2.mjs', 'utf8');
const match = text.match(/const source = (String.raw`[\s\S]*?`);\n/);
assert.ok(match, 'exact retained independent wrapper');
const source = runInNewContext(match[1]);
const local = await build({ entryPoints: ['src/middleware/auth.refresh-boundary.test.ts'], bundle: true,
  packages: 'external', write: false, metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
const runtime = await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: 'w0201-independent-probe.ts', loader: 'ts' },
  alias: { '@': resolve('src') }, bundle: true, write: false, metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
const paths = new Map(old.files.map(({ path, role }) => [path, role]));
for (const path of [...Object.keys(local.metafile.inputs), ...Object.keys(runtime.metafile.inputs)]) {
  if (path === 'w0201-independent-probe.ts') continue;
  if (!paths.has(path)) paths.set(path, 'source');
}
for (const name of ['worker-k1-v2.log', 'reviewer-probe-v2.mjs', 'lead-artifact-v2.mjs']) paths.set(dir + name, 'output');
const artifact = { status: 'recorded', contract_digest: taskContractDigest(task),
  configuration: 'W02.01 episode2 unchanged30-case Node22.15/Vitest real-route proof after accepted W02.02. Actual focused local graph (packages external) and complete current independent Node replay bundle inputs rebuilt and pinned, with config/lockfile/package identities. Original proof files remain historical inputs, not new execution. Baseline composes original common verifier with current dependencies. No engine/test edits, external services, native/deployed/customer/release or complete runner-binary attestation.',
  files: [...paths].sort(([a], [b]) => a.localeCompare(b)).map(([path, role]) => ({ path, sha256: sha256(readFileSync(path)), role })), digest: null };
artifact.digest = artifactDigest(artifact);
if (process.argv.includes('--verify')) {
  assert.deepEqual(artifact, JSON.parse(readFileSync(dir + 'artifact-manifest-v2.json')));
  const changed = old.files.filter(f => sha256(readFileSync(f.path)) !== f.sha256).map(f => f.path).sort();
  assert.deepEqual(changed, ['src/middleware/auth.ts', 'src/routes/auth.ts', 'tsconfig.json']);
  console.log(JSON.stringify({ at: new Date().toISOString(), result: 'pass', digest: artifact.digest, files: artifact.files.length,
    focusedInputs: Object.keys(local.metafile.inputs).length, replayInputs: Object.keys(runtime.metafile.inputs).length, changedPriorInputs: changed }));
} else console.log(JSON.stringify(artifact, null, 2));
