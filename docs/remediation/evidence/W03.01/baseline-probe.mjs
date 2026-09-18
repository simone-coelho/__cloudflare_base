import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const startedAt = new Date().toISOString();
const originalSources = ['src/routes/config.ts', 'src/routes/content.ts', 'src/routes/content.test.ts'].map(path => {
  const source = readFileSync(path, 'utf8');
  return { path, sha256: createHash('sha256').update(source).digest('hex'), source };
});
const wrapper = [
  "export { configRoutes } from './src/routes/config.ts';",
  "export { contentRoutes } from './src/routes/content.ts';",
  "export { invalidateCache } from './src/config/versionedStore.ts';",
  "export { DEFAULT_REFLEX_CONFIG } from './src/reflex/core.ts';",
  "export { Hono } from 'hono';",
  "export { SignJWT } from 'jose';",
].join('\n');
const bundle = await build({ stdin: { contents: wrapper, resolveDir: process.cwd(), loader: 'ts' }, bundle: true,
  platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(process.cwd() + '/package.json'), module, module.exports);
const { configRoutes, contentRoutes, invalidateCache, DEFAULT_REFLEX_CONFIG, Hono, SignJWT } = module.exports;
const app = new Hono().route('/config', configRoutes).route('/content', contentRoutes);
class FakeKV {
  store = new Map(); reads = []; puts = [];
  async get(key) { this.reads.push(key); return this.store.has(key) ? JSON.parse(this.store.get(key)) : null; }
  async put(key, value) { this.puts.push(key); this.store.set(key, value); }
}
const kv = new FakeKV();
const env = { CACHE: kv, AUTH_MODE: 'enforced', ENVIRONMENT: 'test',
  TENANTS: JSON.stringify({ provisioned: ['coach', 'synthetic-brand-b'] }),
  JWT_SECRET: randomBytes(32).toString('hex'), JWT_ISSUER: 'synthetic-issuer', JWT_AUDIENCE: 'synthetic-audience' };
const access = await new SignJWT({ sub: 'synthetic-operator', type: 'access' }).setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt().setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setExpirationTime('5m')
  .sign(new TextEncoder().encode(env.JWT_SECRET));
const scope = '?scope=synthetic-brand-b';
const records = [];
let networkAttempts = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkAttempts++; throw new Error('network prohibited in synthetic preflight'); };
async function request(label, path, method = 'GET', body, authenticated = false) {
  invalidateCache(); kv.reads = []; kv.puts = [];
  const before = JSON.stringify([...kv.store.entries()].sort());
  const response = await app.request('https://synthetic.invalid' + path + scope, {
    method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer ' + access } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const payload = await response.json();
  const text = JSON.stringify(payload);
  const row = { label, method, path, authenticated, status: response.status,
    cacheControl: response.headers.get('Cache-Control'), source: payload.source ?? null, revision: payload.revision ?? null,
    configSentinel: text.includes('synthetic-private-config'), catalogSentinel: text.includes('SYNTHETIC_PRIVATE_CAMPAIGN'),
    historySentinel: text.includes('SYNTHETIC_PRIVATE_NOTE'), valid: payload.valid ?? null,
    privateWeight: payload.config?.weights?.synthetic_private_signal ?? null,
    kvReads: [...kv.reads], kvPuts: [...kv.puts], stateChanged: before !== JSON.stringify([...kv.store.entries()].sort()) };
  records.push(row);
  return { row, payload };
}
const piece = (suffix) => ({ id: 'synthetic-piece', customerContentId: 'synthetic-cms', type: 'editorial',
  title: 'SYNTHETIC_PRIVATE_CAMPAIGN_' + suffix, tags: { line: ['synthetic-line'] }, slotTypes: ['hero'], lifecycle: { status: 'draft' } });
try {
  for (const revision of [1, 2]) {
    const config = { ...DEFAULT_REFLEX_CONFIG, version: 'synthetic-private-config',
      weights: { ...DEFAULT_REFLEX_CONFIG.weights, synthetic_private_signal: 30 + revision } };
    for (const [path, body] of [
      ['/config/reflex', { config, note: 'SYNTHETIC_PRIVATE_NOTE_' + revision }],
      ['/content/catalog', { document: { pieces: [piece(revision)] }, note: 'SYNTHETIC_PRIVATE_NOTE_' + revision }],
    ]) {
      const { row } = await request('signed setup revision ' + revision, path, 'PUT', body, true);
      assert.equal(row.status, 200); assert.equal(row.revision, revision); assert.equal(row.kvPuts.length, 3);
    }
  }
  for (const path of ['/config/reflex', '/content/catalog']) {
    const { row } = await request('anonymous write control', path, 'PUT', {});
    assert.equal(row.status, 401); assert.equal(row.stateChanged, false); assert.equal(row.kvReads.length, 0);
  }
  for (const path of ['/config/reflex', '/content/catalog']) {
    const { row } = await request('signed read control', path, 'GET', undefined, true);
    assert.equal(row.status, 200); assert.equal(row.revision, 2); assert.ok(row.configSentinel || row.catalogSentinel);
  }
  for (const path of ['/config/reflex', '/config/reflex/history', '/config/reflex/revisions/1',
    '/content/catalog', '/content/catalog/history', '/content/catalog/revisions/1']) {
    const { row } = await request('anonymous disclosure', path);
    assert.equal(row.status, 200); assert.ok(row.configSentinel || row.catalogSentinel || row.historySentinel);
    assert.ok(row.kvReads.length > 0); assert.equal(row.stateChanged, false);
  }
  const { row } = await request('anonymous merged-state disclosure', '/config/reflex/validate', 'POST', { patch: {} });
  assert.equal(row.status, 200); assert.equal(row.valid, true); assert.equal(row.configSentinel, true);
  assert.equal(row.privateWeight, 32); assert.ok(row.kvReads.length > 0); assert.equal(row.stateChanged, false);
  assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ startedAt, completedAt: new Date().toISOString(), originalSources, records, networkAttempts,
    limits: 'Actual mounted subrouters and real JWT/config modules in Node over synthetic working KV; not deployed or tenant-membership proof. Secret and bearer were ephemeral and are not emitted.' }));
} finally { globalThis.fetch = originalFetch; }
