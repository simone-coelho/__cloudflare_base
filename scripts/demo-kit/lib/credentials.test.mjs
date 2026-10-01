// node --test scripts/demo-kit/lib/credentials.test.mjs
// The credential grep check-demo.mjs runs, and check-demo's own helpers. Token-shaped test values are
// assembled at run time, so this file itself holds nothing a grep would flag; no real value is used, and
// no finding ever carries a value, only the variable's name.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './config.mjs';
import { FORBIDDEN_NAMES, scanForCredentials, secretValues, tokenFindings } from './credentials.mjs';
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

test('check-demo reads both suites\' last lines, maps a Windows path into WSL, and knows another platform\'s binary', () => {
  assert.deepEqual(suiteSummary('…\n✓ 111 checks: the page works through its own path, with no manual step\n'), { ok: true, passed: 111, total: 111, line: '✓ 111 checks: the page works through its own path, with no manual step' });
  assert.deepEqual(suiteSummary('✗ 2 of 221 check(s) failed: do not hand this over · 1 known page defect'), { ok: false, passed: 219, total: 221, line: '✗ 2 of 221 check(s) failed: do not hand this over · 1 known page defect' });
  assert.equal(suiteSummary('no summary here'), null);
  assert.equal(wslPathOf('C:\\Users\\LAH\\Documents\\__cloudflare_base'), '/mnt/c/Users/LAH/Documents/__cloudflare_base');
  assert.equal(otherPlatformBinary('You installed esbuild for another platform than the one you\'re currently using.'), true);
  assert.equal(otherPlatformBinary('Error: bundle is stale'), false);
});
