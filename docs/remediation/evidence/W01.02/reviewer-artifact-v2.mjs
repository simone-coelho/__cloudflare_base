// Read-only independent W01.02 episode2 source/hash/dependency reconstruction.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const base = 'docs/remediation/evidence/W01.02/';
const sha = value => createHash('sha256').update(value).digest('hex');
const oldManifest = JSON.parse(readFileSync(base + 'artifact-manifest-v1.json'));
const manifest = JSON.parse(readFileSync(base + 'artifact-manifest-v2.json'));
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
const priorInputs = JSON.parse(readFileSync(base + 'runtime-inputs.json')).inputs;
const missing = priorInputs.filter(path => !inputs.includes(path));
const surplus = inputs.filter(path => !priorInputs.includes(path));
const uncovered = inputs.filter(path => path !== 'w0102-runtime.ts' && !manifest.files.some(entry => entry.path === path));
const scopedDiff = execFileSync('git', ['diff', '--', 'docs/api/01-rest-endpoints.md', 'examples/usage-examples.js', 'src/index.ts', 'src/routes/api.ts'], { encoding: 'utf8' });
const result = {
  at: new Date().toISOString(), manifestDigest: manifest.digest,
  manifestFileSha256: sha(readFileSync(base + 'artifact-manifest-v2.json')),
  files: manifest.files.length, mismatches, delta,
  dependencyInputs: inputs.length, missing, surplus, uncovered,
  scopedDiffMatches: scopedDiff === readFileSync(base + 'implementation.patch', 'utf8'),
  deletedApiAbsent: !existsSync('src/routes/api.ts'),
  originals: Object.fromEntries(['index', 'api'].map(name => [name, sha(readFileSync(base + 'before-' + name + '.ts.txt', 'utf8').slice(0, -1))])),
};
console.log(JSON.stringify(result, null, 2));
if (mismatches.length || missing.length || surplus.length || uncovered.length || !result.scopedDiffMatches || !result.deletedApiAbsent
  || delta.length !== 1 || delta[0].path !== 'src/middleware/auth.ts'
  || delta[0].before !== '65a1553ae0d93627f82f5c6dd3f5acb8ee3a8b94b7d82955c15098d3c1317492'
  || delta[0].after !== 'a3a7be192b89395fed567d59b48aed6076f7e80797c8a6c175bff20ff6fce5ea'
  || result.originals.index !== 'a9ca5ae49c3741d9375bd0245c7e377bfd779021055df9d90671b0f580f9f4f1'
  || result.originals.api !== '905f2512b23e6639441067a45864fe25634b3fbf2d9fc977b34370fbd90dca58') process.exitCode = 1;
