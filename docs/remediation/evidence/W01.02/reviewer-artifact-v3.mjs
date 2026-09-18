// Read-only independent W01.02 episode3 source/hash/dependency reconstruction.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const base = 'docs/remediation/evidence/W01.02/';
const sha = value => createHash('sha256').update(value).digest('hex');
const oldManifest = JSON.parse(readFileSync(base + 'artifact-manifest-v2.json'));
const manifest = JSON.parse(readFileSync(base + 'artifact-manifest-v3.json'));
const mismatches = manifest.files.flatMap(entry => {
  try {
    const actual = sha(readFileSync(entry.path));
    return actual === entry.sha256 ? [] : [{ path: entry.path, expected: entry.sha256, actual }];
  } catch (error) { return [{ path: entry.path, error: error.code }]; }
});
const delta = manifest.files.flatMap(entry => {
  const previous = oldManifest.files.find(old => old.path === entry.path);
  return previous?.sha256 === entry.sha256 ? [] : [{ path: entry.path, before: previous?.sha256, after: entry.sha256 }];
});
const changedPrior = delta.filter(entry => entry.before !== undefined);
const added = delta.filter(entry => entry.before === undefined);
const dropped = oldManifest.files.filter(entry => !manifest.files.some(current => current.path === entry.path)).map(entry => entry.path);
const expectedChanges = [
  { path: 'src/middleware/auth.ts', before: 'a3a7be192b89395fed567d59b48aed6076f7e80797c8a6c175bff20ff6fce5ea', after: '71b8bff20c06df6fdcbddd37678a73fcdfe7b0b3dcafbfba49d16b70587c1316' },
  { path: 'src/routes/auth.ts', before: '678fd63e42f5ce93b2cce1eb7f6d7a05ee98cbb33d7f18c3b9e04e279ff8d20e', after: 'f69f9d83d15d869fa1685a23550322b28fe023ece00295a694efd2b4355096b1' },
  { path: 'src/routes/health.ts', before: 'aff5a4bd2eff3caf35136f4550dbc85e5f1647fb7bbc0f662b71dc5ee65e3d6e', after: '0ea5b72d026c4964bb8a34fac627a8704c8a0c5f8eed95e3b656b83a8fda3712' },
  { path: 'tsconfig.json', before: '480c32f5b079b289385b0a0b73cc59a9dba47e318144c4c85ac4b96a9a6472a9', after: '727f746bde977608d363635adba711c8623524325cd2e77a7fe7968128c17782' },
];
const expectedAdded = [
  'src/auth/signingConfig.mjs',
  ...['worker-k1-v3.log', 'reviewer-artifact-v3.mjs', 'lead-artifact-v3.mjs', 'runtime-inputs-v3.json'].map(name => base + name),
].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sourceDeltaMatches = same([...changedPrior].sort((a, b) => a.path.localeCompare(b.path)), expectedChanges)
  && same(added.map(entry => entry.path).sort(), expectedAdded) && dropped.length === 0
  && added.find(entry => entry.path === 'src/auth/signingConfig.mjs')?.after === '82d740178da6c5fb2d6fa26fa76de1242d7ffdda7e6764c79181f89d81963084';
const test = readFileSync('src/index.api-boundary.test.ts', 'utf8');
const context = { JSON };
for (const name of ['SECRET', 'PRIVATE', 'CACHE_KEY', 'STORAGE_KEY', 'STATE_KEY']) {
  const match = test.match(new RegExp('const ' + name + " = ('[^']*');"));
  if (!match) throw new Error('Frozen fixture constant not found: ' + name);
  context[name] = runInNewContext(match[1]);
}
const wrapperMatch = test.match(/const wrapper = (`[\s\S]*?`);\n\nlet runtime/);
const bannerMatch = test.match(/banner: \{ js: (`[\s\S]*?`) \},/);
if (!wrapperMatch || !bannerMatch) throw new Error('Frozen fixture source extraction failed');
const bundled = await build({
  stdin: { contents: runInNewContext(wrapperMatch[1], context), resolveDir: process.cwd(), sourcefile: 'w0102-runtime.ts', loader: 'ts' },
  bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'],
  alias: { path: 'node:path', 'node:os': 'unenv/node/os' },
  banner: { js: runInNewContext(bannerMatch[1]) }, plugins: [], logLevel: 'silent',
});
const inputs = Object.keys(bundled.metafile.inputs).sort();
const declaredInputs = JSON.parse(readFileSync(base + 'runtime-inputs-v3.json')).inputs;
const missing = declaredInputs.filter(path => !inputs.includes(path));
const surplus = inputs.filter(path => !declaredInputs.includes(path));
const priorInputs = JSON.parse(readFileSync(base + 'runtime-inputs.json')).inputs;
const droppedInputs = priorInputs.filter(path => !inputs.includes(path));
const addedInputs = inputs.filter(path => !priorInputs.includes(path));
const graphDeltaMatches = droppedInputs.length === 0 && same(addedInputs, ['src/auth/signingConfig.mjs']);
const uncovered = inputs.filter(path => path !== 'w0102-runtime.ts' && !manifest.files.some(entry => entry.path === path));
const scopedDiff = execFileSync('git', ['diff', '--', 'docs/api/01-rest-endpoints.md', 'examples/usage-examples.js', 'src/index.ts', 'src/routes/api.ts'], { encoding: 'utf8' });
const callers = spawnSync('rg', ['-n', '/api/(storage|cache|queue|state|analytics)|useStorageExample|useCacheExample|sendToQueueExample|@/routes/api|apiRoutes',
  'src', 'scripts', 'examples', 'public', '-g', '!*.test.*', '-g', '!*.map', '-g', '!*.json'], { encoding: 'utf8' });
const orphanCallerCheck = callers.status === 1 && callers.stdout === '' && !callers.error;
const result = {
  at: new Date().toISOString(), manifestDigest: manifest.digest,
  manifestFileSha256: sha(readFileSync(base + 'artifact-manifest-v3.json')),
  files: manifest.files.length, mismatches, delta, dropped, sourceDeltaMatches,
  dependencyInputs: inputs.length, bundleSha256: sha(bundled.outputFiles[0].contents), missing, surplus, uncovered,
  droppedInputs, addedInputs, graphDeltaMatches, orphanCallerCheck, orphanCallerOutput: callers.stdout,
  scopedDiffMatches: scopedDiff === readFileSync(base + 'implementation.patch', 'utf8'),
  deletedApiAbsent: !existsSync('src/routes/api.ts'),
  originals: Object.fromEntries(['index', 'api'].map(name => [name, sha(readFileSync(base + 'before-' + name + '.ts.txt', 'utf8').slice(0, -1))])),
};
console.log(JSON.stringify(result, null, 2));
if (mismatches.length || missing.length || surplus.length || uncovered.length || !result.scopedDiffMatches || !result.deletedApiAbsent
  || !sourceDeltaMatches || !graphDeltaMatches || !orphanCallerCheck
  || result.originals.index !== 'a9ca5ae49c3741d9375bd0245c7e377bfd779021055df9d90671b0f580f9f4f1'
  || result.originals.api !== '905f2512b23e6639441067a45864fe25634b3fbf2d9fc977b34370fbd90dca58') process.exitCode = 1;
