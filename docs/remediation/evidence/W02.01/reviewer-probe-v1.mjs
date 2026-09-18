// Independent W02.01 replay. Synthetic in-memory accounts/KV only; bundles in
// memory and verifies retained original bytes without changing application files.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Module } from 'node:module';
import { resolve } from 'node:path';

const root = process.cwd();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const current = readFileSync('src/middleware/auth.ts');
if (hash(current) !== 'a3a7be192b89395fed567d59b48aed6076f7e80797c8a6c175bff20ff6fce5ea') throw new Error('Frozen auth mismatch');
if (hash(readFileSync('src/middleware/auth.refresh-boundary.test.ts')) !== '11628a318420ddb8d2d269373a7f23a46f7ad4b7913648db565b0dedd07ee177') throw new Error('Frozen test mismatch');
const original = readFileSync('docs/remediation/evidence/W02.01/before-auth.ts.txt', 'utf8').slice(0, -1);
if (hash(original) !== '65a1553ae0d93627f82f5c6dd3f5acb8ee3a8b94b7d82955c15098d3c1317492') throw new Error('Original auth mismatch');

const source = String.raw`
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT, decodeJwt } from 'jose';
import { authRoutes } from '@/routes/auth';
import { configRoutes } from '@/routes/config';
import { hashPassword } from '@/auth/accounts';
import { memoryStore } from '@/auth/store';
import { invalidateConfigCache } from '@/reflex/configStore';
import { jwt } from '@/middleware/auth';
import { sdkKey, operatorWrites } from '@/middleware/edgeAccess';
const KEY = 'w0201-independent-synthetic-signing-material';
const baseEnv = { JWT_SECRET: KEY, JWT_ISSUER: 'review', JWT_AUDIENCE: 'review', SDK_KEYS: 'acme:synthetic-key', AUTH_MODE: 'enforced' };
const bearer = token => ({ Authorization: 'Bearer ' + token });
const signed = async (payload, secret = KEY, expiry = '5m') => new SignJWT(payload).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt().setIssuer('review').setAudience('review').setExpirationTime(expiry).sign(new TextEncoder().encode(secret));
export async function run(before) {
  const observations = [];
  for (const mode of ['open', 'enforced']) for (const revoked of [false, true]) {
    const store = memoryStore();
    const values = new Map();
    const calls = [];
    const cache = {
      async get(k, type) { calls.push(['get', k]); const v = values.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
      async put(k, v) { calls.push(['put', k]); values.set(k, v); },
      async delete(k) { calls.push(['delete', k]); values.delete(k); },
    };
    let reads = 0;
    const realGetById = store.getById;
    store.getById = async (id) => { reads++; return realGetById(id); };
    await store.put({ id: 'review-operator', email: 'review@example.invalid', name: 'Reviewer Fixture', roles: ['admin'], permissions: ['read', 'write'], password_hash: await hashPassword('independent synthetic password'), disabled: false, must_change_password: false });
    const app = new Hono();
    app.route('/auth', authRoutes); app.route('/config', configRoutes);
    const env = { ...baseEnv, AUTH_MODE: mode, ACCOUNTS: store, CACHE: cache };
    const request = (path, method = 'GET', token, body) => app.request('https://review.example.invalid' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? bearer(token) : {}) }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }, env);
    const login = await request('/auth/login', 'POST', undefined, { email: 'review@example.invalid', password: 'independent synthetic password' });
    assert.equal(login.status, 200); const tokens = await login.json();
    assert.equal(decodeJwt(tokens.accessToken).type, undefined);
    assert.equal(decodeJwt(tokens.refreshToken).type, 'refresh');
    const scope = 'review-' + crypto.randomUUID();
    const path = '/config/reflex?scope=' + scope;
    const read = async () => { invalidateConfigCache(scope); const r = await request(path); assert.equal(r.status, 200); return r.json(); };
    for (const K of [3, 7]) assert.equal((await request(path, 'PATCH', tokens.accessToken, { patch: { K } })).status, 200);
    let config = await read(); assert.equal(config.revision, 2); assert.equal(config.config.K, 7);
    assert.equal((await request('/auth/refresh', 'POST', undefined, { refreshToken: tokens.refreshToken })).status, 200);
    if (revoked) {
      assert.equal((await request('/auth/logout', 'POST', tokens.accessToken, {})).status, 200);
      assert.equal(store.sessions.size, 0);
      assert.equal((await request('/auth/refresh', 'POST', undefined, { refreshToken: tokens.refreshToken })).status, 401);
    }
    calls.length = 0; reads = 0;
    const originalState = JSON.stringify({ cache: [...values], users: [...store.users], sessions: [...store.sessions], audit: store.log });
    const statuses = [];
    for (const [p, m, body] of [
      ['/auth/me', 'GET'], ['/auth/me', 'HEAD'],
      [path, 'PUT', { config: { ...config.config, K: 99 }, note: 'independent refresh misuse' }],
      ['/config/reflex/rollback/1?scope=' + scope, 'POST', { note: 'independent refresh rollback' }],
    ]) {
      const r = await request(p, m, tokens.refreshToken, body); statuses.push(r.status);
      assert.equal(r.status, before ? 200 : 401, mode + ':' + revoked + ':' + m + p);
    }
    const protectedCalls = [...calls]; const protectedReads = reads;
    if (before) { assert.equal(protectedReads, 2); assert.equal(protectedCalls.filter(c => c[0] === 'put').length, 6); }
    else {
      assert.equal(protectedReads, 0); assert.deepEqual(protectedCalls, []);
      assert.equal(JSON.stringify({ cache: [...values], users: [...store.users], sessions: [...store.sessions], audit: store.log }), originalState);
    }
    config = await read();
    assert.equal(config.revision, before ? 4 : 2); assert.equal(config.config.K, before ? 3 : 7);
    observations.push({ before, mode, revoked, statuses, accountReads: protectedReads, configWrites: protectedCalls.filter(c => c[0] === 'put').length, revision: config.revision, K: config.config.K });
    if (!before) {
      const tool = await signed({ sub: 'review-tool' });
      assert.equal((await request('/auth/me', 'GET', tool)).status, 200);
      assert.equal((await request(path, 'PUT', tool, { config: { ...config.config, K: 11 } })).status, 200);
      config = await read(); assert.equal(config.revision, 3); assert.equal(config.config.K, 11); assert.equal(config.actor, 'review-tool');
      assert.equal((await request('/config/reflex/rollback/1?scope=' + scope, 'POST', tool, {})).status, 200);
      config = await read(); assert.equal(config.revision, 4); assert.equal(config.config.K, 3); assert.equal(config.actor, 'review-tool');
      calls.length = 0;
      assert.equal((await request(path, 'PUT', tokens.refreshToken, '{malformed')).status, 401);
      assert.deepEqual(calls, []);
      assert.equal((await request('/auth/refresh', 'POST', undefined, { refreshToken: tokens.refreshToken })).status, revoked ? 401 : 200);
    }
  }
  if (!before) {
    const app = new Hono(); const reached = []; const seen = [];
    app.use('*', async (c, next) => { await next(); seen.push(c.get('auth')); });
    app.get('/optional', jwt({ required: false, roles: ['admin'], permissions: ['write'] }), c => { reached.push(c.get('auth')); return c.json({ ok: true }); });
    const goodRefresh = await signed({ sub: 'refresh', type: 'refresh', roles: ['admin'], permissions: ['write'] });
    for (const [token, error] of [[goodRefresh, 'Invalid token'], [await signed({ sub: 'refresh', type: 'refresh' }, 'wrong-synthetic-key'), 'Authentication failed'], [await signed({ sub: 'refresh', type: 'refresh' }, KEY, Math.floor(Date.now() / 1000) - 30), 'Token expired']]) {
      const r = await app.request('https://review.example.invalid/optional', { headers: bearer(token) }, baseEnv);
      assert.equal(r.status, 401); assert.deepEqual(await r.json(), { error });
    }
    assert.deepEqual(reached, []); assert.deepEqual(seen, [undefined, undefined, undefined]);
    const edge = new Hono(); const effects = [];
    edge.use('/v1/:tenant/*', sdkKey()); edge.use('/realtime/*', sdkKey()); edge.use('/operator/*', operatorWrites());
    edge.all('/v1/:tenant/read', c => { effects.push('sdk'); return c.json({ ok: true }); });
    edge.all('/realtime/write', c => { effects.push('realtime'); return c.json({ ok: true }); });
    edge.all('/operator/write', c => { effects.push('operator'); return c.json({ ok: true }); });
    const tool = await signed({ sub: 'review-tool' });
    for (const [p, method] of [['/v1/acme/read', 'GET'], ['/realtime/write', 'POST'], ['/operator/write', 'POST']]) {
      assert.equal((await edge.request('https://review.example.invalid' + p, { method, headers: bearer(goodRefresh) }, baseEnv)).status, 401);
    }
    assert.deepEqual(effects, []);
    for (const [p, method] of [['/v1/acme/read', 'GET'], ['/realtime/write', 'POST'], ['/operator/write', 'POST']]) {
      assert.equal((await edge.request('https://review.example.invalid' + p, { method, headers: bearer(tool) }, baseEnv)).status, 200);
    }
    assert.deepEqual(effects, ['sdk', 'realtime', 'operator']);
    assert.equal((await edge.request('https://review.example.invalid/v1/acme/read', { headers: { ...bearer(goodRefresh), 'X-SDK-Key': 'synthetic-key' } }, baseEnv)).status, 200);
    assert.equal((await edge.request('https://review.example.invalid/v1/acme/read', { headers: { ...bearer(tool), 'X-SDK-Key': 'wrong-key' } }, baseEnv)).status, 401);
    assert.equal(effects.length, 4);
    observations.push({ optionalInvalidPurposeSignatureExpired: 'passed', edgeRefreshDenied: 3, edgeToolAllowed: 3, independentKeyAllowed: 1, wrongKeyDenied: 1, malformedBodiesDenied: 4, subOnlyToolPutRollbackControls: 8 });
  }
  return observations;
}
`;

for (const before of [true, false]) {
  const bundled = await build({
    stdin: { contents: source, resolveDir: root, sourcefile: 'w0201-independent-probe.ts', loader: 'ts' },
    alias: { '@': resolve(root, 'src') }, bundle: true, write: false, metafile: true,
    platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: before ? [{ name: 'retained-original-auth', setup(b) {
      b.onLoad({ filter: /[/\\]src[/\\]middleware[/\\]auth\.ts$/ }, () => ({ contents: original, loader: 'ts', resolveDir: resolve(root, 'src/middleware') }));
    } }] : [],
  });
  const module = new Module(resolve(root, 'w0201-independent-probe.cjs'));
  module.filename = resolve(root, 'w0201-independent-probe.cjs');
  module.paths = Module._nodeModulePaths(root);
  module._compile(bundled.outputFiles[0].text, module.filename);
  console.log(JSON.stringify({ phase: before ? 'retained-original' : 'frozen-current', at: new Date().toISOString(), bundleSha256: hash(bundled.outputFiles[0].contents), inputCount: Object.keys(bundled.metafile.inputs).length, results: await module.exports.run(before) }, null, 2));
}
