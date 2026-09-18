// Independent W02.02 reviewer probe. Synthetic state only; never reads settings,
// writes source, launches operational adapters, or permits outbound requests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const sha = value => createHash('sha256').update(value).digest('hex');
const originals = JSON.parse(readFileSync('docs/remediation/evidence/W02.02/before-source.json', 'utf8'));
const expectedOriginals = {
  'src/middleware/auth.ts': 'a3a7be192b89395fed567d59b48aed6076f7e80797c8a6c175bff20ff6fce5ea',
  'src/routes/auth.ts': '678fd63e42f5ce93b2cce1eb7f6d7a05ee98cbb33d7f18c3b9e04e279ff8d20e',
  'src/routes/health.ts': 'aff5a4bd2eff3caf35136f4550dbc85e5f1647fb7bbc0f662b71dc5ee65e3d6e',
};
for (const [path, hash] of Object.entries(expectedOriginals)) {
  const file = originals.files.find(file => file.path === path);
  assert.equal(file?.sha256, hash);
  assert.equal(sha(file.content), hash);
}

const wrapper = `
import { Hono } from 'hono';
import * as jose from 'jose';
import { authRoutes } from './src/routes/auth.ts';
import { healthRoutes } from './src/routes/health.ts';
import { configRoutes } from './src/routes/config.ts';
import { memoryStore } from './src/auth/store.ts';
import { jwt } from './src/middleware/auth.ts';
import { sdkKey } from './src/middleware/edgeAccess.ts';
import { invalidateConfigCache } from './src/reflex/configStore.ts';

export default { async fetch(transport) {
  const input = await transport.json();
  let assertions = 0;
  const check = (condition, label) => { assertions++; if (!condition) throw new Error(input.label + ': ' + label); };
  const store = memoryStore(), calls = [], bindingsRead = [], contexts = [];
  const user = { id: 'reviewer-operator', email: 'reviewer@example.invalid', name: 'Reviewer Synthetic',
    roles: ['operator', 'admin'], permissions: ['read', 'write'], password: 'reviewer synthetic password' };
  const cache = new Map([['user:' + user.email, JSON.stringify(user)], ['user_id:' + user.id, JSON.stringify(user)]]);
  const config = { JWT_SECRET: input.key, JWT_ISSUER: input.issuer ?? 'reviewer-issuer', JWT_AUDIENCE: input.audience ?? 'reviewer-audience' };
  Object.assign(config, input.overrides ?? {});
  const originalConfig = { ...config };
  const snapshot = () => JSON.stringify({ users: [...store.users], sessions: [...store.sessions], audit: store.log, cache: [...cache] });
  const before = snapshot();
  const accounts = new Proxy(store, { get(target, prop) {
    const value = target[prop];
    return typeof value === 'function' ? async (...args) => {
      calls.push('ACCOUNTS.' + String(prop));
      if (input.mutateDuringPut && prop === 'put') {
        config.JWT_SECRET = 'changed-after-validation-secret-32bytes';
        config.JWT_ISSUER = 'changed-issuer'; config.JWT_AUDIENCE = 'changed-audience';
      }
      return value.apply(target, args);
    } : value;
  } });
  const env = new Proxy(config, { get(target, prop) {
    bindingsRead.push(String(prop));
    if (['ACCOUNTS', 'DB', 'CACHE'].includes(String(prop)) && input.throwStore) throw new Error('Unexpected protected binding access');
    if (prop === 'ACCOUNTS') return accounts;
    if (prop === 'AUTH_MODE') return 'enforced';
    if (prop === 'SDK_KEYS') return 'reviewer:reviewer-site-key';
    if (prop === 'CACHE') return {
      async get(key, type) { calls.push('CACHE.get'); const value = cache.get(key); return value === undefined ? null : type === 'json' ? JSON.parse(value) : value; },
      async put(key, value) { calls.push('CACHE.put'); cache.set(key, value); },
      async delete(key) { calls.push('CACHE.delete'); cache.delete(key); },
    };
    return target[prop];
  } });
  const app = new Hono();
  app.use('*', async (c, next) => { await next(); contexts.push(c.get('auth')); });
  app.route('/auth', authRoutes); app.route('/health', healthRoutes); app.route('/config', configRoutes);
  app.get('/optional', jwt({ required: false }), c => c.json({ auth: c.get('auth') }));
  app.get('/sdk/:tenant/probe', sdkKey(), c => c.json({ ok: true }));
  app.onError(() => new Response('Synthetic route failure', { status: 500 }));
  const req = (path, method = 'GET', body, bearer, sdk) => app.request('https://reviewer.invalid' + path, {
    method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(bearer !== undefined ? { Authorization: bearer } : {}), ...(sdk ? { 'X-SDK-Key': sdk } : {}) },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  }, env);
  const ready = await req('/health/ready');
  const live = await req('/health/live');
  check(live.status === 200, 'live remains200');

  if (input.kind === 'baseline') {
    const login = await req('/auth/login', 'POST', { email: user.email, password: user.password });
    check(ready.status === 200, 'original unconditional readiness');
    check(login.status === (input.key ? 200 : 500), 'original login outcome');
    check(store.users.size === 1 && cache.size === 0, 'original migrated account and deleted legacy state');
    check(store.log.some(row => row.action === 'account_migrated'), 'original migration audit');
    return Response.json({ label: input.label, assertions, ready: ready.status, login: login.status,
      accounts: store.users.size, sessions: store.sessions.size, legacyKeys: cache.size,
      audit: store.log.map(row => row.action), calls });
  }

  if (input.kind === 'invalid') {
    check(ready.status === 503 && ready.headers.get('cache-control') === 'no-store', 'not-ready503 no-store');
    const readyBody = await ready.json(); check(readyBody.status === 'not_ready', 'not-ready body');
    for (const [path, method, body, authorization] of [
      ['/auth/login', 'POST', '{malformed'], ['/auth/refresh', 'POST', '{malformed'],
      ['/auth/me', 'GET', undefined, 'Bearer invalid-token'],
      ['/config/reflex?scope=reviewer', 'PATCH', '{malformed', 'Bearer invalid-token'],
      ['/optional', 'GET', undefined, 'Bearer invalid-token'],
      ['/sdk/reviewer/probe', 'GET', undefined, 'Bearer invalid-token'],
    ]) {
      const response = await req(path, method, body, authorization);
      check(response.status === 503 && response.headers.get('cache-control') === 'no-store', 'configuration error priority');
      check(JSON.stringify(await response.json()) === JSON.stringify({ error: 'Authentication configuration unavailable' }), 'stable redacted error');
    }
    check(contexts.every(value => value === undefined), 'no authenticated context');
    for (const authorization of [undefined, 'Basic abc', 'bearer abc', 'Bearer  abc', 'Bearer abc extra', 'Bearer']) {
      check((await req('/auth/me', 'GET', undefined, authorization)).status === 401, 'missing/malformed bearer retains401');
      const anonymous = await req('/optional', 'GET', undefined, authorization);
      check(anonymous.status === 200, 'optional missing/malformed bearer anonymous');
      check((await anonymous.json()).auth.isAuthenticated === false, 'explicit anonymous context');
    }
    check((await req('/sdk/reviewer/probe', 'GET', undefined, 'Bearer invalid-token', 'reviewer-site-key')).status === 200, 'independent SDK credential');
    check(calls.length === 0, 'zero protected method calls');
    check(!bindingsRead.some(name => ['ACCOUNTS', 'DB', 'CACHE'].includes(name)), 'zero protected binding reads');
    check(snapshot() === before, 'all destination state unchanged');
    return Response.json({ label: input.label, assertions, configurationDenials: 7, missingHeaderControls: 12, sdkControl: 1, protectedCalls: 0 });
  }

  check(ready.status === 200, 'valid ready');
  const login = await req('/auth/login', 'POST', { email: user.email, password: user.password });
  check(login.status === 200, 'valid real login');
  const tokens = await login.json();
  const verification = { issuer: originalConfig.JWT_ISSUER, audience: originalConfig.JWT_AUDIENCE };
  const key = new TextEncoder().encode(originalConfig.JWT_SECRET);
  const accessClaims = (await jose.jwtVerify(tokens.accessToken, key, verification)).payload;
  const refreshClaims = (await jose.jwtVerify(tokens.refreshToken, key, verification)).payload;
  check(accessClaims.sub === user.id && accessClaims.type === undefined, 'unchanged untyped access');
  check(accessClaims.iss === originalConfig.JWT_ISSUER && accessClaims.aud === originalConfig.JWT_AUDIENCE, 'exact issuer/audience');
  check(accessClaims.exp - accessClaims.iat === 900 && refreshClaims.exp - refreshClaims.iat === 604800, 'unchanged lifetimes');
  check(refreshClaims.type === 'refresh' && store.sessions.size === 1, 'real refresh session');
  check(cache.size === 0 && store.users.size === 1, 'valid migration success');
  Object.assign(config, originalConfig); // Only the fixture changes back after the intentional snapshot race.
  const renewed = await req('/auth/refresh', 'POST', { refreshToken: tokens.refreshToken });
  check(renewed.status === 200, 'valid renewal');
  const renewal = await renewed.json();
  await jose.jwtVerify(renewal.accessToken, key, verification);
  const scope = 'reviewer-' + crypto.randomUUID();
  const configPath = '/config/reflex?scope=' + scope;
  const write = await req(configPath, 'PATCH', { patch: { K: 7 }, note: 'reviewer synthetic control' }, 'Bearer ' + renewal.accessToken);
  check(write.status === 200, 'renewed access protected write');
  const written = await write.json();
  check(written.revision === 1 && written.config.K === 7, 'actual revision/body control');
  const protectedBefore = snapshot(); calls.length = 0;
  check((await req('/auth/me', 'GET', undefined, 'Bearer ' + tokens.refreshToken)).status === 401, 'fresh refresh denied');
  check((await req(configPath, 'PATCH', { patch: { K: 99 } }, 'Bearer ' + tokens.refreshToken)).status === 401, 'fresh refresh write denied');
  check(calls.length === 0 && snapshot() === protectedBefore, 'fresh refresh zero effects');
  check((await req('/auth/logout', 'POST', {}, 'Bearer ' + renewal.accessToken)).status === 200 && store.sessions.size === 0, 'real logout');
  check((await req('/auth/refresh', 'POST', { refreshToken: tokens.refreshToken })).status === 401, 'revoked renewal denied');
  calls.length = 0; const revokedBefore = snapshot();
  check((await req('/auth/me', 'GET', undefined, 'Bearer ' + tokens.refreshToken)).status === 401, 'revoked refresh denied');
  check((await req(configPath, 'PATCH', { patch: { K: 99 } }, 'Bearer ' + tokens.refreshToken)).status === 401, 'revoked refresh write denied');
  check(calls.length === 0 && snapshot() === revokedBefore, 'revoked refresh zero effects');
  invalidateConfigCache(scope);
  const readback = await (await req(configPath)).json();
  check(readback.revision === 1 && readback.config.K === 7, 'uncached readback unchanged');
  return Response.json({ label: input.label, assertions, keyBytes: key.length, login: 200, renewal: 200,
    snapshotMutation: Boolean(input.mutateDuringPut), refreshDenials: 4, revision: readback.revision });
} };`;

const invalid = [
  ['missing', undefined], ['empty', ''], ['null', null], ['number', 123], ['array', ['x'.repeat(32)]],
  ['blank-unicode', '\u2003'.repeat(40)], ['31-bytes', 'x'.repeat(31)], ['utf8-31-bytes', 'é'.repeat(15) + 'x'],
  ['placeholder', 'development-secret-key-change-in-production'], ['padded-placeholder', '\u2003development-secret-key-change-in-production\n'],
];
const safe = [
  { label: 'ascii32', key: '0123456789abcdefghijklmnopqrstuv' },
  { label: 'ascii160', key: 'reviewer0123456789'.repeat(10) },
  { label: 'utf8-32bytes', key: 'é'.repeat(16) },
  { label: 'emoji32bytes', key: '🙂'.repeat(8) },
  { label: 'padded-exact-strings', key: '  reviewer-synthetic-key-preserve-spaces  ', issuer: ' issuer with padding ', audience: ' audience with padding ' },
  { label: 'snapshot-mutates-during-account-put', key: 'reviewer-snapshot-key-at-least-32bytes', mutateDuringPut: true },
];

let totalAssertions = 0, outbound = 0;
for (const basis of ['original', 'current']) {
  const sourcePlugin = { name: 'reviewer-original-only', setup(builder) {
    builder.onLoad({ filter: /\/src\/(middleware\/auth|routes\/(auth|health))\.ts$/ }, args => {
      const original = originals.files.find(file => resolve(file.path) === args.path);
      assert.ok(original && expectedOriginals[original.path]);
      return { contents: original.content, loader: 'ts', resolveDir: resolve(args.path, '..') };
    });
  } };
  const bundle = await build({ stdin: { contents: wrapper, sourcefile: 'reviewer-runtime.ts', resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', conditions: ['workerd', 'worker', 'browser'],
    plugins: basis === 'original' ? [sourcePlugin] : [], logLevel: 'silent' });
  console.log(JSON.stringify({ basis, bundleSha256: sha(bundle.outputFiles[0].contents), inputs: Object.keys(bundle.metafile.inputs).sort() }));
  const runtime = new Miniflare({ modules: [{ type: 'ESModule', path: 'reviewer-runtime.mjs', contents: bundle.outputFiles[0].text }],
    compatibilityDate: '2025-06-01', outboundService() { outbound++; throw new Error('Reviewer forbids outbound requests'); } });
  const run = async input => {
    const response = await runtime.dispatchFetch('http://reviewer.local/probe', { method: 'POST', body: JSON.stringify(input) });
    assert.equal(response.status, 200, input.label + ' independent runtime probe');
    const result = await response.json(); totalAssertions += result.assertions;
    console.log(JSON.stringify({ basis, ...result }));
  };
  try {
    await runtime.ready;
    if (basis === 'original') {
      for (const [label, key] of invalid.filter(([label]) => ['missing', 'empty', 'placeholder'].includes(label))) await run({ kind: 'baseline', label, key });
    } else {
      for (const [label, key] of invalid) await run({ kind: 'invalid', label, key, throwStore: true });
      for (const field of ['JWT_ISSUER', 'JWT_AUDIENCE']) {
        for (const [kind, value] of [['null', null], ['blank', '\u2003'], ['array', ['valid']], ['number', 1]]) {
          await run({ kind: 'invalid', label: field + '-' + kind, key: 'reviewer-valid-signing-key-32bytes', overrides: { [field]: value }, throwStore: true });
        }
      }
      for (const scenario of safe) await run({ kind: 'valid', ...scenario });
    }
  } finally { await runtime.dispose(); }
}
assert.equal(outbound, 0);
console.log(JSON.stringify({ verdict: 'pass', totalAssertions, outboundAttempts: outbound }));
