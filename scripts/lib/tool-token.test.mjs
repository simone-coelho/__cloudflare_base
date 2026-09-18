import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import { Hono } from 'hono';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from './tool-token.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONFIG = { DEPLOYMENT_PROFILE: 'demo', JWT_SECRET: 'w0202-tool-synthetic-signing-material', JWT_ISSUER: ' custom issuer ', JWT_AUDIENCE: ' custom audience ' };
const PLACEHOLDER = 'development-secret-key-change-in-production';
const defaults = { payload: { sub: 'synthetic-tool' }, expiresIn: '10m' };
const family = [
  ['dev-token', 'operator', ['operator'], 86400], ['acceptance-run', 'acceptance-run', ['operator'], 1800],
  ['import-content', 'import-content', ['operator'], 600], ['seed-coach-content', 'seed-coach-content', ['operator'], 600],
  ['console-operator', 'console-preview-admin', ['admin'], 600], ['holdout-proof', 'holdout-proof', ['operator'], 900],
  ['identity-proof', 'identity-proof', undefined, 600],
];

// Bundle the real shared verifier in memory. No source/build file is written.
const bundled = await build({ stdin: { contents: "export { jwt } from './src/middleware/auth.ts';", resolveDir: ROOT, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
const compiled = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const verifier = new Hono(); verifier.get('/', compiled.exports.jwt(), (c) => c.json({ sub: c.get('auth').user.sub }));
async function claims(token, config = CONFIG) {
  return (await jwtVerify(token, new TextEncoder().encode(config.JWT_SECRET), { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE })).payload;
}

// Execute complete actual JS adapter source with a fixed import allowlist and
// synthetic process/host interfaces. Stop at its first intercepted operation;
// neither fetch nor the import/seed child process can execute outside this VM.
async function adapter(name, env = {}, args = [], replies = []) {
  const url = new URL(`../${name}.mjs`, import.meta.url);
  const operations = [], reads = [], output = [], acquired = [];
  const boundary = new Error('synthetic operational boundary');
  const imports = {
    './lib/tool-token.mjs': { isLoopbackTarget, tokenFromArgs, async resolveToolToken(options) {
      const token = await resolveToolToken({ ...options, env }); acquired.push(token); return token;
    } },
    'node:child_process': { execFileSync(...args) { operations.push({ kind: 'child', args }); throw boundary; } },
    'node:fs': { readFileSync(path) {
      reads.push(String(path));
      assert.equal(String(path), new URL('../../public/data/coach-content.json', import.meta.url).href);
      return JSON.stringify({ pieces: [] });
    } },
  };
  let source = readFileSync(url, 'utf8').replace(/^#![^\n]*\n/, '').replaceAll('import.meta.url', JSON.stringify(url.href));
  source = source.replace(/^import \{([^}]+)\} from '([^']+)';$/gm, (_line, names, specifier) => {
    assert.ok(imports[specifier], `Unexpected adapter import ${specifier}`);
    return `const {${names}} = __imports[${JSON.stringify(specifier)}];`;
  });
  assert.doesNotMatch(source, /^import /m);
  const context = {
    __imports: imports, URL, Date, JSON, crypto: globalThis.crypto,
    process: { argv: ['node', fileURLToPath(url), ...args], env: Object.freeze({ ...env }), exit(code) { throw new Error(`synthetic exit ${code}`); } },
    console: Object.fromEntries(['log', 'error', 'warn'].map(method => [method, (...values) => output.push(values.map(String).join(' '))])),
    fetch: async (...args) => {
      operations.push({ kind: 'fetch', args });
      if (replies.length) { const body = replies.shift(); return { status: 200, json: async () => body, text: async () => JSON.stringify(body) }; }
      throw boundary;
    },
    setTimeout() { throw new Error('Unexpected adapter timer'); },
  };
  let error;
  try { await new vm.Script(`(async () => {\n${source}\n})()`, { filename: fileURLToPath(url) }).runInNewContext(context, { timeout: 1000 }); }
  catch (caught) { error = caught; }
  return { operations, reads, output, acquired, error };
}

test('explicit opaque tokens have priority without consulting local signing settings', async () => {
  const env = { OPERATOR_TOKEN: 'env-opaque-token', get JWT_SECRET() { throw new Error('signing settings were read'); } };
  assert.equal(await resolveToolToken({ ...defaults, token: 'cli-opaque-token', env }), 'cli-opaque-token');
  assert.equal(await resolveToolToken({ ...defaults, env }), 'env-opaque-token');
  for (const bad of ['', ' \t', null, 42, {}, []]) {
    await assert.rejects(resolveToolToken({ ...defaults, token: bad, env }), /Operator credentials unavailable/);
    await assert.rejects(resolveToolToken({ ...defaults, env: { ...CONFIG, OPERATOR_TOKEN: bad } }), /Operator credentials unavailable/);
  }
  assert.equal(tokenFromArgs(['--token', 'opaque', '--scope', 'acme']), 'opaque');
  assert.equal(tokenFromArgs([]), undefined);
  for (const args of [['--token'], ['--token', ''], ['--token', '--scope', 'acme']]) assert.equal(tokenFromArgs(args), '');
});

test('W02.08 customer tools require issued credentials and key A to B never renews an old explicit bearer', async () => {
  for (const profile of [undefined, 'customer', 'typo']) {
    const env = { ...CONFIG, DEPLOYMENT_PROFILE: profile };
    await assert.rejects(resolveToolToken({ ...defaults, env }), /Operator credentials unavailable/);
    assert.equal(await resolveToolToken({ ...defaults, env, token: 'registered-opaque-bearer' }), 'registered-opaque-bearer');
  }
  const a = await resolveToolToken({ ...defaults, env: CONFIG });
  const bConfig = { ...CONFIG, JWT_SECRET: 'w0208-other-synthetic-signing-material' };
  const b = await resolveToolToken({ ...defaults, env: bConfig });
  assert.equal((await claims(b, bConfig)).type, 'service');
  await assert.rejects(claims(a, bConfig));
  assert.equal(await resolveToolToken({ ...defaults, env: { ...bConfig, DEPLOYMENT_PROFILE: 'customer' }, token: a }), a);
  await assert.rejects(claims(a, bConfig));
});

test('shared signing policy refuses unsafe keys and identity configuration', async () => {
  for (const secret of [undefined, null, 7, {}, [], '', ' '.repeat(40), 'a'.repeat(31), 'é'.repeat(15)+'a', PLACEHOLDER, ' '+PLACEHOLDER+' ']) {
    await assert.rejects(resolveToolToken({ ...defaults, env: { ...CONFIG, JWT_SECRET: secret } }), /Operator credentials unavailable/);
  }
  for (const field of ['JWT_ISSUER', 'JWT_AUDIENCE']) for (const value of [undefined, null, 3, [], {}, '', ' \t']) {
    await assert.rejects(resolveToolToken({ ...defaults, env: { ...CONFIG, [field]: value } }), /Operator credentials unavailable/);
  }
  for (const key of ['a'.repeat(32), 'é'.repeat(16), ' '+'a'.repeat(31), 'é'.repeat(40), 'synthetic-long-key-'.repeat(6)]) {
    const env = { ...CONFIG, JWT_SECRET: key };
    assert.equal((await claims(await resolveToolToken({ ...defaults, env }), env)).sub, 'synthetic-tool');
  }
});

test('local target policy uses exact parsed loopback names', () => {
  for (const base of ['http://localhost:9100', 'https://127.0.0.1', 'http://[::1]:9200']) assert.equal(isLoopbackTarget(base), true);
  for (const base of ['https://localhost.example.invalid', 'https://example.invalid/localhost', 'http://127.0.0.1.example.invalid',
    'http://localhost@example.invalid', 'http://user@localhost', 'file://localhost/path', 'not a URL']) assert.equal(isLoopbackTarget(base), false);
});

for (const [name, sub, roles, lifetime] of family) {
  test(`${name}: unsafe configuration stops before operational or configuration-file effects`, async () => {
    for (const env of [{}, { ...CONFIG, JWT_SECRET: PLACEHOLDER }, { ...CONFIG, JWT_SECRET: 'short' }, { ...CONFIG, JWT_ISSUER: '' },
      { ...CONFIG, JWT_AUDIENCE: '' }, { ...CONFIG, OPERATOR_TOKEN: '' }]) {
      const result = await adapter(name, env);
      assert.match(result.error?.message ?? '', /Operator credentials unavailable/);
      assert.deepEqual(result.operations, []); assert.deepEqual(result.reads, []); assert.deepEqual(result.acquired, []); assert.deepEqual(result.output, []);
    }
  });
  test(`${name}: explicit settings preserve claims, lifetime, verifier compatibility and adapter use`, async () => {
    const result = await adapter(name, CONFIG);
    assert.equal(result.acquired.length, 1);
    const token = result.acquired[0], payload = await claims(token);
    assert.equal(payload.sub, sub); assert.deepEqual(payload.roles, roles); assert.equal(payload.type, 'service'); assert.equal(payload.exp-payload.iat, lifetime);
    assert.equal(decodeProtectedHeader(token).alg, 'HS256');
    if (['console-operator', 'holdout-proof', 'identity-proof'].includes(name)) assert.equal(decodeProtectedHeader(token).typ, 'JWT');
    if (name === 'console-operator') assert.deepEqual({ email: payload.email, name: payload.name, permissions: payload.permissions },
      { email: 'admin@local.test', name: 'Preview Admin', permissions: ['*'] });
    assert.equal((await verifier.request('https://synthetic.invalid/', { headers: { Authorization: 'Bearer '+token } }, { ...CONFIG, AUTH_MODE: 'enforced' })).status, 200);
    if (name === 'dev-token') assert.deepEqual(result.output, [token]);
    else assert.equal(result.operations.length, 1);
    if (name === 'holdout-proof') {
      assert.equal(result.operations[0].kind, 'child');
      const args = result.operations[0].args[1]; assert.equal(args[args.indexOf('--token')+1], token);
    } else if (['acceptance-run', 'import-content', 'seed-coach-content'].includes(name)) {
      assert.equal(result.operations[0].args[1].headers.Authorization, 'Bearer '+token);
    }
  });
  test(`${name}: OPERATOR_TOKEN passes through without signing configuration`, async () => {
    const result = await adapter(name, { OPERATOR_TOKEN: 'synthetic-opaque-bearer' });
    assert.deepEqual(result.acquired, ['synthetic-opaque-bearer']);
    if (name !== 'dev-token') assert.equal(result.operations.length, 1);
  });
}

for (const name of ['acceptance-run', 'import-content', 'seed-coach-content']) test(`${name}: CLI precedence and remote token path; no ambiguous local mint`, async () => {
  const result = await adapter(name, { OPERATOR_TOKEN: 'env-opaque' }, ['--base', 'https://remote.example.invalid', '--token', 'cli-opaque']);
  assert.deepEqual(result.acquired, ['cli-opaque']); assert.equal(result.operations.length, 1);
  for (const args of [['--token'], ['--token', ''], ['--token', '--scope', 'acme']]) {
    const invalid = await adapter(name, { ...CONFIG, OPERATOR_TOKEN: 'env-opaque' }, args);
    assert.match(invalid.error?.message ?? '', /Operator credentials unavailable/); assert.deepEqual(invalid.operations, []);
  }
  for (const base of ['https://localhost.example.invalid', 'https://remote.example.invalid', 'http://localhost@remote.example.invalid']) {
    const invalid = await adapter(name, CONFIG, ['--base', base]);
    assert.match(invalid.error?.message ?? '', /Operator credentials unavailable/); assert.deepEqual(invalid.operations, []);
  }
  assert.equal((await adapter(name, CONFIG, ['--base', 'http://[::1]:9100'])).acquired.length, 1);
});

test('console remains local-only, while existing remote-capable proof scripts remain usable', async () => {
  const rejected = await adapter('console-operator', { OPERATOR_TOKEN: 'opaque' }, ['https://localhost.example.invalid']);
  assert.deepEqual(rejected.operations, []); assert.deepEqual(rejected.acquired, []);
  assert.equal((await adapter('console-operator', CONFIG, ['http://[::1]:9200'])).acquired.length, 1);
  for (const name of ['holdout-proof', 'identity-proof']) assert.equal((await adapter(name, CONFIG, ['https://remote.example.invalid'])).acquired.length, 1);
  const dev = await adapter('dev-token', CONFIG, ['--sub', 'custom-synthetic-sub', '--hours', '4']);
  const payload = await claims(dev.acquired[0]); assert.equal(payload.sub, 'custom-synthetic-sub'); assert.equal(payload.exp-payload.iat, 14400);
});

// Execute the shell's exact credential prelude, ending before its workflow.
// The screenshot read is a shell-function stub; its marker proves JWT failure
// exits before that read and hence before every later curl. No .dev.vars is read.
function rehearsal(env) {
  const source = readFileSync(new URL('../rehearse-storefront.sh', import.meta.url), 'utf8');
  const end = source.indexOf('\n# The beats:'); assert.ok(end > 0);
  const nodePath = "'"+process.execPath.replaceAll("'", "'\\''")+"'";
  const input = `node() { command ${nodePath} "$@"; }\ngrep() { printf 'SCREENSHOT_READ\\n' >&2; printf 'SHOT_TOKEN=synthetic-shot\\n'; }\n`
    +source.slice(0, end)+`\nprintf 'PREFLIGHT_PASSED\\n' >&2\nprintf '%s' "$JWT"\n`;
  return spawnSync('/bin/bash', ['-s'], { cwd: ROOT, env: { PATH: '/usr/bin:/bin', ...env }, input, encoding: 'utf8', timeout: 15000 });
}
test('rehearsal refuses unsafe/missing configuration visibly before screenshot read or later curl', () => {
  for (const env of [{}, { ...CONFIG, JWT_SECRET: PLACEHOLDER }, { ...CONFIG, JWT_AUDIENCE: '' }, { ...CONFIG, OPERATOR_TOKEN: '' }]) {
    const result = rehearsal(env);
    assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.match(result.stderr, /Operator credentials unavailable/);
    assert.doesNotMatch(result.stderr, /SCREENSHOT_READ|PREFLIGHT_PASSED/); assert.ok(!result.stderr.includes(PLACEHOLDER));
  }
});
test('rehearsal accepts explicit bearer or custom settings and preserves the historical token', async () => {
  const opaque = rehearsal({ OPERATOR_TOKEN: 'synthetic-opaque-bearer' });
  assert.equal(opaque.status, 0); assert.equal(opaque.stdout, 'synthetic-opaque-bearer'); assert.match(opaque.stderr, /PREFLIGHT_PASSED/);
  const minted = rehearsal(CONFIG); assert.equal(minted.status, 0);
  const payload = await claims(minted.stdout); assert.equal(payload.sub, 'rehearsal'); assert.equal(payload.roles, undefined); assert.equal(payload.type, 'service'); assert.equal(payload.exp-payload.iat, 600);
  assert.equal((await verifier.request('https://synthetic.invalid/', { headers: { Authorization: 'Bearer '+minted.stdout } }, CONFIG)).status, 200);
});

test('W03.01 importer authenticates its catalogue read and continues through the slot write', async () => {
  const result = await adapter('import-content', { OPERATOR_TOKEN: 'synthetic-import-token' },
    ['--base', 'https://synthetic.invalid', '--scope', 'synthetic-brand'], [
      { ok: true, revision: 1 },
      { document: { pieces: [{ id: 'synthetic-merch', slotTypes: ['merch'] }] } },
      { ok: true, revision: 1, version: 'slots+r1' },
    ]);
  assert.match(result.error?.message ?? '', /synthetic exit 0/);
  assert.equal(result.operations.length, 3);
  assert.deepEqual(result.operations.map(op => [new URL(op.args[0]).pathname, op.args[1]?.method ?? 'GET']), [
    ['/content/catalog/pull', 'POST'], ['/content/catalog', 'GET'], ['/content/slots', 'PUT'],
  ]);
  for (const op of result.operations) assert.ok(op.args[1].headers.Authorization === 'Bearer synthetic-import-token');
  const slots = JSON.parse(result.operations[2].args[1].body).document;
  assert.equal(slots.pages.home[0].pinnedPieceId, 'synthetic-merch');
  assert.ok(result.output.every(line => !line.includes('synthetic-import-token')));
});

test('W03.03 named import/seed/acceptance adapters retain opaque auth and selected tenant', async () => {
  for (const scope of ['acme', 'globex']) {
    const args = ['--base', 'https://synthetic.invalid', '--scope', scope];
    const env = { OPERATOR_TOKEN: 'synthetic-opaque-token' };
    const imported = await adapter('import-content', env, args, [{ ok: true }, { document: { pieces: [] } }, { ok: true }]);
    assert.match(imported.error?.message ?? '', /synthetic exit 0/);
    assert.equal(imported.operations.length, 3);
    const seeded = await adapter('seed-coach-content', env, args, [{ ok: true }, { ok: true }, { document: { slots: {} } }, { ok: true }]);
    assert.match(seeded.error?.message ?? '', /synthetic exit 0/);
    assert.equal(seeded.operations.length, 4);
    const acceptance = await adapter('acceptance-run', env, args, [
      ...[{ pieces: [] }, { pages: {} }, { slots: {} }].map(document => ({ document, revision: 1 })),
      ...Array.from({ length: 3 }, () => ({ ok: true, revision: 2 })),
    ]);
    assert.equal(acceptance.operations.length, 8); // setup6, first shopper intercepted, first restoration intercepted
    for (const operation of [...imported.operations, ...seeded.operations, ...acceptance.operations.slice(0, 6), acceptance.operations[7]]) {
      const [url, init] = operation.args;
      assert.equal(new URL(url).searchParams.get('scope'), scope);
      assert.equal(init.headers['X-Tenant'], scope);
      assert.equal(init.headers.Authorization, 'Bearer synthetic-opaque-token');
    }
    const [url, init] = acceptance.operations[6].args;
    assert.equal(new URL(url).pathname, `/v1/${scope}/decisions/snapshot`);
    assert.equal(init.headers['X-Tenant'], scope);
    assert.equal(init.headers['X-SDK-Key'], 'demo-site');
    assert.equal(init.headers.Authorization, undefined);
  }
  // Malformed names stay one encoded selector; they cannot inject another scope.
  for (const name of ['import-content', 'seed-coach-content', 'acceptance-run']) {
    const result = await adapter(name, { OPERATOR_TOKEN: 'opaque' }, ['--scope', 'acme&scope=globex']);
    const [url, init] = result.operations[0].args;
    assert.deepEqual(new URL(url).searchParams.getAll('scope'), ['acme&scope=globex']);
    assert.equal(init.headers['X-Tenant'], 'acme&scope=globex');
  }
});

// Only the exact preview sign-in and data-decision fragments run. Shell functions intercept
// HTTP and the seed command; node -e only parses synthetic
// JSON. Startup, migrations, account provisioning and the workflow never run.
function previewDecision(overrides = {}) {
  const source = readFileSync(new URL('../console-preview.sh', import.meta.url), 'utf8');
  const start = source.indexOf('\n# 4. The data,');
  const end = source.indexOf('\ncat <<EOF', start);
  assert.ok(start > 0 && end > start);
  const signin = source.slice(source.indexOf('signin() {'), source.indexOf('\n}\n', source.indexOf('signin() {')) + 3);
  assert.match(signin, /curl -fsS /);
  const nodePath = "'"+process.execPath.replaceAll("'", "'\\''")+"'";
  const prelude = [
    'set -u',
    'exec 3>&2',
    'PORT=9200; SCOPE="$SYNTHETIC_SCOPE"; EMAIL=synthetic-email; PASSWORD=synthetic-password',
    'curl() { local found=false tenant=false login=false scope=false; for arg in "$@"; do [ "$arg" = "Authorization: Bearer synthetic-preview-token" ] && found=true; [ "$arg" = "X-Tenant: $SCOPE" ] && tenant=true; [ "$arg" = "http://localhost:$PORT/auth/login" ] && login=true; [ "$arg" = "scope=$SCOPE" ] && scope=true; done; [ "$tenant" = true ] || return 96; if [ "$login" = true ]; then printf "SIGNIN\\n" >&3; printf "%s\\n200" "$SYNTHETIC_LOGIN"; return "$SYNTHETIC_SIGNIN_EXIT"; fi; [ "$found" = true ] && [ "$scope" = true ] || return 97; printf "AUTH_READ\\n" >&3; printf "%s\\n%s" "$SYNTHETIC_DOCUMENT" "$SYNTHETIC_HTTP_STATUS"; return "$SYNTHETIC_CURL_EXIT"; }',
    'node() { if [ "$1" = "scripts/holdout-proof.mjs" ]; then [ "$OPERATOR_TOKEN" = "synthetic-preview-token" ] || return 98; printf "SEED\\n" >&3; return "$SYNTHETIC_SEED_EXIT"; fi; [ "$1" = "-e" ] || return 99; command '+nodePath+' "$@"; }',
  ].join('\n');
  return spawnSync('/bin/bash', ['-s'], { cwd: ROOT, encoding: 'utf8', timeout: 15000,
    env: { PATH: '/usr/bin:/bin', SYNTHETIC_SCOPE: 'synthetic-brand', SYNTHETIC_LOGIN: '{"accessToken":"synthetic-preview-token"}',
      SYNTHETIC_SIGNIN_EXIT: '0', SYNTHETIC_DOCUMENT: '{"source":"stored"}',
      SYNTHETIC_CURL_EXIT: '0', SYNTHETIC_HTTP_STATUS: '200', SYNTHETIC_SEED_EXIT: '0', ...overrides },
    input: prelude + '\n' + signin + source.slice(start, end) + '\nprintf "DECISION_DONE\\n" >&3\n',
  });
}
test('W03.01 preview skips stored and seeds only an authenticated compiled default', () => {
  for (const scope of ['acme', 'globex']) for (const source of ['stored', 'compiled-default']) {
    const result = previewDecision({ SYNTHETIC_SCOPE: scope, SYNTHETIC_DOCUMENT: JSON.stringify({ source }) });
    assert.equal(result.status, 0); assert.match(result.stderr, /AUTH_READ/); assert.match(result.stderr, /DECISION_DONE/);
    assert.equal(result.stderr.includes('SEED\n'), source === 'compiled-default');
    assert.ok(!(result.stdout + result.stderr).includes('synthetic-preview-token'));
  }
});
test('W03.01 preview fails closed on credential, HTTP, JSON or source failure without leaking responses', () => {
  for (const [overrides, read] of [
    [{ SYNTHETIC_SIGNIN_EXIT: '22' }, false],
    [{ SYNTHETIC_LOGIN: 'SYNTHETIC_PRIVATE_BODY' }, false],
    [{ SYNTHETIC_LOGIN: '{}' }, false],
    [{ SYNTHETIC_LOGIN: '{"accessToken":" "}' }, false],
    [{ SYNTHETIC_CURL_EXIT: '22', SYNTHETIC_DOCUMENT: '{"source":"compiled-default"}' }, true],
    [{ SYNTHETIC_CURL_EXIT: '7' }, true],
    [{ SYNTHETIC_HTTP_STATUS: '302', SYNTHETIC_DOCUMENT: '{"source":"compiled-default"}' }, true],
    [{ SYNTHETIC_DOCUMENT: 'SYNTHETIC_PRIVATE_BODY' }, true],
    [{ SYNTHETIC_DOCUMENT: '{"source":"unexpected","private":"SYNTHETIC_PRIVATE_BODY"}' }, true],
    [{ SYNTHETIC_DOCUMENT: '{}' }, true],
  ]) {
    const result = previewDecision(overrides);
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr.includes('AUTH_READ'), read);
    assert.doesNotMatch(result.stderr, /SEED\n|DECISION_DONE/);
    assert.ok(!(result.stdout + result.stderr).includes('synthetic-preview-token'));
    assert.ok(!(result.stdout + result.stderr).includes('SYNTHETIC_PRIVATE_BODY'));
  }
  const failedSeed = previewDecision({ SYNTHETIC_DOCUMENT: '{"source":"compiled-default"}', SYNTHETIC_SEED_EXIT: '9' });
  assert.notEqual(failedSeed.status, 0); assert.match(failedSeed.stderr, /SEED\n/); assert.doesNotMatch(failedSeed.stderr, /DECISION_DONE/);
});
