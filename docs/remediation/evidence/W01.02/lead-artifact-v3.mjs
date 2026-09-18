// Read-only actual-default-export graph/identity collector; never runs a live service.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { artifactDigest, taskContractDigest, sha256 } from '../../../../scripts/remediation/board.mjs';
const dir = 'docs/remediation/evidence/W01.02/';
const task = JSON.parse(readFileSync('docs/remediation/tracker.json')).tasks.find(t => t.id === 'W01.02');
const test = readFileSync('src/index.api-boundary.test.ts', 'utf8');
const context = { JSON };
for (const name of ['SECRET', 'PRIVATE', 'CACHE_KEY', 'STORAGE_KEY', 'STATE_KEY']) {
  const match = test.match(new RegExp('const ' + name + " = ('[^']*');"));
  assert.ok(match, 'frozen fixture constant ' + name); context[name] = runInNewContext(match[1]);
}
const wrapper = test.match(/const wrapper = (`[\s\S]*?`);\n\nlet runtime/);
const banner = test.match(/banner: \{ js: (`[\s\S]*?`) \},/);
assert.ok(wrapper && banner, 'actual frozen wrapper/banner');
const bundle = await build({ stdin: { contents: runInNewContext(wrapper[1], context), resolveDir: process.cwd(), sourcefile: 'w0102-runtime.ts', loader: 'ts' },
  bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'],
  alias: { path: 'node:path', 'node:os': 'unenv/node/os' }, banner: { js: runInNewContext(banner[1]) }, plugins: [], logLevel: 'silent' });
const inputs = Object.keys(bundle.metafile.inputs).sort();
if (process.argv.includes('--inputs')) {
  console.log(JSON.stringify({ at: new Date().toISOString(), method: 'Exact unchanged K1 wrapper/banner/build configuration, read-only esbuild metafile reconstruction', inputs }, null, 2));
} else {
  assert.deepEqual(inputs, JSON.parse(readFileSync(dir + 'runtime-inputs-v3.json')).inputs);
  const old = JSON.parse(readFileSync(dir + 'artifact-manifest-v2.json'));
  const paths = new Map(old.files.map(({ path, role }) => [path, role]));
  for (const path of inputs) if (path !== 'w0102-runtime.ts' && !paths.has(path)) paths.set(path, 'source');
  for (const name of ['worker-k1-v3.log', 'reviewer-artifact-v3.mjs', 'lead-artifact-v3.mjs', 'runtime-inputs-v3.json']) paths.set(dir + name, 'output');
  const artifact = { status: 'recorded', contract_digest: taskContractDigest(task),
    configuration: 'W01.02 episode3 unchanged actual Worker default-export local synthetic workerd suite after accepted W02.02 signing and W02.01 refresh proof. Complete exact current wrapper/build graph rebuilt; all prior manifest files retained with explicit accepted source/config deltas and new signing helper. Fresh proof is not historical-log reuse. Synthetic successful bindings, blocked outbound, compatibilityDate2025-06-01/nodejs_compat; not native-resource/deployed-assets/customer/SLO/full-perimeter/release or complete runner-binary attestation.',
    files: [...paths].sort(([a], [b]) => a.localeCompare(b)).map(([path, role]) => ({ path, sha256: sha256(readFileSync(path)), role })), digest: null };
  artifact.digest = artifactDigest(artifact);
  if (process.argv.includes('--verify')) {
    assert.deepEqual(artifact, JSON.parse(readFileSync(dir + 'artifact-manifest-v3.json')));
    assert.equal(existsSync('src/routes/api.ts'), false);
    console.log(JSON.stringify({ at: new Date().toISOString(), result: 'pass', digest: artifact.digest, files: artifact.files.length, runtimeInputs: inputs.length }));
  } else console.log(JSON.stringify({ ...artifact, files: artifact.files.map(({ path, sha256, role }) => [path, sha256, role]) }));
}
