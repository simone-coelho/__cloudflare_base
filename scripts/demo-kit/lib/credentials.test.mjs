// node --test scripts/demo-kit/lib/credentials.test.mjs
// The credential grep check-demo.mjs runs, and check-demo's own helpers. Token-shaped test values are
// assembled at run time, so this file itself holds nothing a grep would flag; no real value is used, and
// no finding ever carries a value, only the variable's name.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from './config.mjs';
import { FORBIDDEN_NAMES, referencesIn, scanForCredentials, secretValues, servedPaths, tokenFindings } from './credentials.mjs';
import { otherPlatformBinary, suiteSummary, wslPathOf } from '../check-demo.mjs';

const jwtShaped = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ0ZXN0LW9ubHkifQ', 'bm90LWEtcmVhbC1zaWduYXR1cmU'].join('.');

test('the three token shapes are found; a template literal, a placeholder or a short string is not', () => {
  assert.deepEqual(tokenFindings(`token: ${jwtShaped}`), ['a JWT']);
  assert.deepEqual(tokenFindings(`Authorization: Bearer ${'Q'.repeat(32)}`), ['a bearer token literal']);
  assert.deepEqual(tokenFindings(`ss1.${'k'.repeat(40)}`), ['a shopper capability literal']);
  assert.deepEqual(tokenFindings('Authorization: `Bearer ${token}`'), []);
  assert.deepEqual(tokenFindings('--token <operator token>'), []);
  assert.deepEqual(tokenFindings('eyJ short.bit.only'), []);
});

test('secretValues reads only the secret names, unquoted, sixteen characters or more', () => {
  const text = [
    `JWT_SECRET='${'s'.repeat(40)}'`, `IDENTITY_SALT="${'t'.repeat(32)}"`, 'SDK_KEYS=vantage:demo-site', `TENANTS={"vantage":{}}`,
    'SHOT_TOKEN=short', `GEMINI_API_KEY=${'g'.repeat(39)}`, '# JWT_SECRET=commented-out-value-here', `ODP_PUBLIC_KEY=${'p'.repeat(30)}`,
  ].join('\n');
  const found = secretValues(text);
  assert.deepEqual(found.map((s) => s.name), ['JWT_SECRET', 'IDENTITY_SALT', 'GEMINI_API_KEY']);
  assert.equal(found[0].value, 's'.repeat(40), 'quotes removed');
});

test('a scan names the file and the variable, never the value; a never-served file name is a finding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-kit-cred-'));
  mkdirSync(join(dir, 'beats'));
  const secret = 'x'.repeat(12) + 'leaked-value-1234';
  writeFileSync(join(dir, 'page.js'), `const KEY = '${secret}';`);
  writeFileSync(join(dir, 'beats', 'operator.local.json'), '{}');
  writeFileSync(join(dir, 'doc.json'), JSON.stringify({ token: jwtShaped }));
  writeFileSync(join(dir, 'clean.css'), 'body { color: red }');
  writeFileSync(join(dir, 'photo.png'), Buffer.concat([Buffer.from([0x89, 0x50]), Buffer.from(secret)]));
  const scan = scanForCredentials({ dir, secrets: [{ name: 'JWT_SECRET', value: secret }] });
  const lines = scan.findings.map((f) => `${f.file}: ${f.what}`).sort();
  assert.deepEqual(lines, [
    'beats/operator.local.json: a file named operator.local.json, which must never be served',
    'doc.json: a JWT',
    'page.js: the value of JWT_SECRET from .dev.vars',
    'photo.png: the value of JWT_SECRET from .dev.vars',
  ]);
  assert.ok(!JSON.stringify(scan).includes(secret), 'no finding carries the value');
  assert.deepEqual([scan.dirFiles, scan.textFiles], [5, 4]);
  assert.ok(FORBIDDEN_NAMES.includes('.dev.vars'));
});

test('Vantage\'s public directory and the kit\'s own config carry no credential', () => {
  const devVars = join(REPO_ROOT, '.dev.vars');
  const secrets = existsSync(devVars) ? secretValues(readFileSync(devVars, 'utf8')) : [];
  const configs = ['vantage.json', 'vantage/reflex.json', 'vantage/learn.json', 'vantage/region.json', 'vantage/imagery.json']
    .map((f) => join(REPO_ROOT, 'scripts', 'demo-kit', 'configs', f));
  const scan = scanForCredentials({ dir: join(REPO_ROOT, 'public', 'vantage'), extraFiles: configs, secrets, root: REPO_ROOT });
  assert.deepEqual(scan.findings, []);
  assert.equal(scan.extraFiles, 5);
  assert.ok(scan.dirFiles > 100, `${scan.dirFiles} files under public/vantage`);
});

// ── What the pages load (R2: a token planted in public/demo-kit/ passed check-demo) ─────────────────────

/** Write `files` (path → text or Buffer) under `root`, making directories as needed. */
const plant = (root, files) => { for (const [rel, body] of Object.entries(files)) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); } };

/**
 * A demo tree in a temporary directory, never the checkout: the demo's page loads the kit, the kit loads a
 * sibling directory and a file at the public root, and every one of those carries a plant. Two more plants
 * are named by nothing the demo loads (another demo's directory) or lie outside public/ altogether.
 */
function plantedTree(secret) {
  const root = mkdtempSync(join(tmpdir(), 'demo-kit-served-'));
  plant(root, {
    'public/demo/index.html': '<link rel="stylesheet" href="/demo-kit/compare.css"><link href="https://fonts.example/css">'
      + '<img src="//cdn.example/x.png"><script type="module" src="/demo/demo.js"></script><a href="/">home</a>',
    'public/demo/demo.js': "import { createDemo } from '/demo-kit/kit.js';\nfetch(`/v1/demo/decisions?x=1`); fetch(`/demo/beats/${name}.json`);\n"
      + "const outside = '../../outside.js'; const re = /^ctx\\./;\n",
    'public/demo/catalog.json': JSON.stringify({ image: '/demo/img/a.webp', about: 'clean' }),
    'public/demo-kit/kit.js': "import * as util from './util.js';\nconst shared = () => import('../shared/lib.js');\nconst lib = '/lib.min.js';\n",
    'public/demo-kit/util.js': 'export const one = 1;\n',
    'public/demo-kit/compare.js': `export const leaked = '${jwtShaped}';\n`,
    'public/demo-kit/compare.css': `.cmp-back { --cmp-note: "${secret}"; }\n`,
    'public/shared/lib.js': `const auth = 'Bearer ${'Q'.repeat(32)}';\n`,
    'public/lib.min.js': `var s="ss1.${'k'.repeat(40)}";\n`,
    'public/unrelated/page.js': `export const other = '${jwtShaped}';\n`,
    'outside.js': `export const outside = '${jwtShaped}';\n`,
  });
  return root;
}

test('the paths a file names: imports, stylesheets, scripts, url() and template literals; never a protocol-relative or external URL', () => {
  assert.deepEqual(referencesIn("import { a } from '/demo-kit/kit.js'; import('./compare.js'); x = `/vantage/beats/${n}.json`"),
    ['/demo-kit/kit.js', './compare.js', '/vantage/beats/']);
  assert.deepEqual(referencesIn('<link href="/demo-kit/tokens.css"><img src=/img/a.png> .x { background: url(../shared/a.svg) }'),
    ['/demo-kit/tokens.css', '/img/a.png', '../shared/a.svg']);
  assert.deepEqual(referencesIn('<link href="https://fonts.googleapis.com/css2"><img src="//cdn.example/x.png">'), []);
});

test('what a demo\'s pages load is followed from its directory and the kit\'s to every directory and file they name, and no further', () => {
  const root = plantedTree('x'.repeat(24));
  const served = servedPaths({ root, publicDir: 'public/demo' });
  assert.deepEqual(served.map((s) => s.path).sort(), ['public/demo', 'public/demo-kit', 'public/lib.min.js', 'public/shared']);
  const via = Object.fromEntries(served.map((s) => [s.path, s.via]));
  assert.deepEqual(via, { 'public/demo': null, 'public/demo-kit': null, 'public/shared': 'public/demo-kit/kit.js', 'public/lib.min.js': 'public/demo-kit/kit.js' });
  assert.deepEqual(served.map((s) => [s.path, s.dir]).sort(), [['public/demo', true], ['public/demo-kit', true], ['public/lib.min.js', false], ['public/shared', true]]);
  // The kit is followed from the page too: a demo without the kit's starting point still reaches it through its own imports.
  assert.deepEqual(servedPaths({ root, publicDir: 'public/demo', kit: 'public/none' }).map((s) => s.path).sort(),
    ['public/demo', 'public/demo-kit', 'public/lib.min.js', 'public/shared']);
});

test('a token or a .dev.vars value planted anywhere the pages load is found: public/demo-kit, a sibling directory, a root file', () => {
  const secret = randomBytes(18).toString('hex');
  const root = plantedTree(secret);
  const secrets = [{ name: 'JWT_SECRET', value: secret }];
  // The check before R2's finding: the demo's own directory alone, where nothing is planted.
  assert.deepEqual(scanForCredentials({ dir: join(root, 'public', 'demo'), secrets, root }).findings, []);
  const served = servedPaths({ root, publicDir: 'public/demo' });
  const scan = scanForCredentials({ dirs: served.map((s) => join(root, s.path)), secrets, root });
  assert.deepEqual(scan.findings.map((f) => `${f.file}: ${f.what}`).sort(), [
    'public/demo-kit/compare.css: the value of JWT_SECRET from .dev.vars',
    'public/demo-kit/compare.js: a JWT',
    'public/lib.min.js: a shopper capability literal',
    'public/shared/lib.js: a bearer token literal',
  ]);
  assert.ok(!JSON.stringify(scan).includes(secret), 'no finding carries the value');
  assert.equal(scan.dirFiles, 9, 'three in public/demo, four in public/demo-kit, one in public/shared, and public/lib.min.js');
});

test('check-demo itself fails on a token planted in public/demo-kit/, run on a scratch copy of the kit, never the checkout', () => {
  const secret = randomBytes(18).toString('hex');
  const root = plantedTree(secret);
  // The kit's check-demo and the two libraries it loads, copied so that their REPO_ROOT is the scratch tree.
  const kitDir = fileURLToPath(new URL('..', import.meta.url));
  for (const rel of ['check-demo.mjs', 'lib/config.mjs', 'lib/credentials.mjs']) {
    mkdirSync(dirname(join(root, 'scripts', 'demo-kit', rel)), { recursive: true });
    copyFileSync(join(kitDir, rel), join(root, 'scripts', 'demo-kit', rel));
  }
  plant(root, {
    'scripts/suite.mjs': 'console.log("✓ 1 checks");\n',
    'scripts/demo-kit/configs/demo.json': JSON.stringify({
      name: 'Demo', slug: 'demo', tenant: 'demo', publicDir: 'public/demo',
      worker: { name: 'edge-platform-demo', queue: 'events-demo', devPort: 9199 },
      check: { suites: [{ name: 'request level', script: 'scripts/suite.mjs' }] },
    }),
    '.dev.vars': `JWT_SECRET=${secret}\nTENANTS={"demo":{}}\n`,
  });
  const run = () => spawnSync(process.execPath, [join(root, 'scripts', 'demo-kit', 'check-demo.mjs'), '--config', join(root, 'scripts', 'demo-kit', 'configs', 'demo.json'),
    '--skip', 'generated,typecheck,suites'], { cwd: root, encoding: 'utf8' });
  const planted = run();
  assert.equal(planted.status, 1, planted.stdout + planted.stderr);
  for (const line of ['public/demo-kit/compare.js: a JWT', 'public/demo-kit/compare.css: the value of JWT_SECRET from .dev.vars',
    'public/shared/lib.js: a bearer token literal', 'public/lib.min.js: a shopper capability literal']) {
    assert.ok(planted.stdout.includes(`✗ ${line}`), `${line}\n${planted.stdout}`);
  }
  assert.match(planted.stdout, /✗ credentials\s+9 files in public\/demo, public\/demo-kit, public\/shared, public\/lib\.min\.js and 1 config file\(s\)/);
  assert.ok(!(planted.stdout + planted.stderr).includes(secret), 'the value is never printed');
  // With the plants removed, the same run passes: what failed was the plants, not the wiring.
  plant(root, {
    'public/demo-kit/compare.js': 'export const clean = 1;\n', 'public/demo-kit/compare.css': '.cmp-back { color: red }\n',
    'public/shared/lib.js': 'export const clean = 1;\n', 'public/lib.min.js': 'var clean = 1;\n',
  });
  const clean = run();
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /✓ credentials\s+9 files in public\/demo, public\/demo-kit, public\/shared, public\/lib\.min\.js .*; no finding/);
});

test('everything Vantage\'s pages load carries no credential: public/vantage, the kit, and html2canvas at the public root', () => {
  const devVars = join(REPO_ROOT, '.dev.vars');
  const secrets = existsSync(devVars) ? secretValues(readFileSync(devVars, 'utf8')) : [];
  const served = servedPaths({ root: REPO_ROOT, publicDir: 'public/vantage' });
  const paths = served.map((s) => s.path);
  for (const p of ['public/vantage', 'public/demo-kit', 'public/html2canvas.min.js']) assert.ok(paths.includes(p), `${p} in ${paths.join(', ')}`);
  const scan = scanForCredentials({ dirs: paths.map((p) => join(REPO_ROOT, p)), secrets, root: REPO_ROOT });
  assert.deepEqual(scan.findings, []);
  assert.ok(scan.dirFiles > 110, `${scan.dirFiles} files served to Vantage's pages`);
});

test('check-demo reads both suites\' last lines, maps a Windows path into WSL, and knows another platform\'s binary', () => {
  assert.deepEqual(suiteSummary('…\n✓ 111 checks: the page works through its own path, with no manual step\n'), { ok: true, passed: 111, total: 111, line: '✓ 111 checks: the page works through its own path, with no manual step' });
  assert.deepEqual(suiteSummary('✗ 2 of 221 check(s) failed: do not hand this over · 1 known page defect'), { ok: false, passed: 219, total: 221, line: '✗ 2 of 221 check(s) failed: do not hand this over · 1 known page defect' });
  assert.equal(suiteSummary('no summary here'), null);
  assert.equal(wslPathOf('C:\\Users\\LAH\\Documents\\__cloudflare_base'), '/mnt/c/Users/LAH/Documents/__cloudflare_base');
  assert.equal(otherPlatformBinary('You installed esbuild for another platform than the one you\'re currently using.'), true);
  assert.equal(otherPlatformBinary('Error: bundle is stale'), false);
});
