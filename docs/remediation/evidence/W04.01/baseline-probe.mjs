// W04.01 read-only actual-module baseline. Synthetic stores/SDK transport only.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const startedAt = new Date().toISOString();
const files = ['src/identity/assertion.ts', 'src/routes/identity.ts', 'src/sdk/identify.ts',
  'src/types/env.ts', 'src/sdk/README.md', 'src/identity/identity.test.ts',
  'src/routes/identity.test.ts', 'src/sdk/identify.test.ts',
  'public/sdk/edge-personalization.js', 'public/sdk/edge-personalization.esm.js'];
const sourceIdentity = files.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
const originalCoreSources = ['src/identity/assertion.ts', 'src/sdk/identify.ts'].map(path => ({ path, source: readFileSync(path, 'utf8') }));
const bundle = await build({ stdin: { contents: `
export { identityRoutes } from './src/routes/identity.ts';
export { signAssertion, verifyAssertion } from './src/identity/assertion.ts';
export { SessionManager } from './src/services/SessionManager.ts';
export { shopperIdFor } from './src/identity/shopperId.ts';
export { createCore } from './src/sdk/core.ts';
export { createIdentity } from './src/sdk/identify.ts';
export { memoryHost } from './src/sdk/memoryHost.ts';
export { DEFAULT_REFLEX_CONFIG, apply, emptyState, audienceKey } from './src/reflex/core.ts';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, packages: 'external',
 platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { identityRoutes, signAssertion, verifyAssertion, SessionManager, shopperIdFor,
  createCore, createIdentity, memoryHost, DEFAULT_REFLEX_CONFIG, apply, emptyState, audienceKey } = module.exports;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error('unexpected external fetch'); };
class KV {
  data = new Map(); calls = [];
  async get(key, type) { this.calls.push(['get', key]); const v = this.data.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; }
  async put(key, value) { this.calls.push(['put', key]); this.data.set(key, value); }
  async delete(key) { this.calls.push(['delete', key]); this.data.delete(key); }
  async list({ prefix = '' } = {}) { this.calls.push(['list', prefix]); return { keys: [...this.data.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; }
}
const makeEnv = (extra = {}) => ({ AUTH_MODE: 'enforced', CONNECTOR_MODE: 'mock', ENVIRONMENT: 'w0401-synthetic',
  IDENTITY_SALT: 'w0401-local-synthetic-salt', CACHE: new KV(), SESSIONS: new KV(), ...extra });
const post = async (env, path, body) => {
  const response = await identityRoutes.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
  return { status: response.status, body: await response.json(), headers: response.headers };
};
const results = [];
for (const [label, extra] of [['absent', {}], ['empty', { IDENTITY_SECRETS: '' }], ['other-tenant-only', { IDENTITY_SECRETS: 'other:w0401-synthetic-other-key' }]]) {
  const env = makeEnv(extra), sm = new SessionManager(env, { tenant: 'acme' });
  const shopperId = await shopperIdFor(env, 'acme', 'synthetic-account');
  let reflex = emptyState(DEFAULT_REFLEX_CONFIG);
  for (let i = 0; i < 3; i++) reflex = apply(reflex, { action: 'product_view', touches: [{ dim: 'line', value: 'Tabby' }] }, Date.now() - 3000 + i, DEFAULT_REFLEX_CONFIG).state;
  await sm.createOrUpdateSession('synthetic-person-session', shopperId, { reflex, identity: { shopperId, linkedAt: Date.now() }, attributes: { privateMarker: 'W0401_PRIVATE_PROFILE' } });
  env.SESSIONS.calls = []; env.CACHE.calls = [];
  const r = await post(env, '/acme/identity/link', { visitorId: 'vis-stranger', accountId: 'synthetic-account' });
  const calls = [...env.SESSIONS.calls];
  const exposed = r.body.audiences?.includes(audienceKey('line', 'Tabby'));
  assert.equal(r.status, 200); assert.equal(r.body.assurance, 'site'); assert.equal(r.body.shopperId, shopperId);
  assert.equal(exposed, true); assert.ok(calls.some(([op]) => op === 'put'));
  results.push({ label, status: r.status, assurance: r.body.assurance, existingShopperExposed: r.body.shopperId === shopperId,
    privateAudienceExposed: exposed, sessionReads: calls.filter(([op]) => op === 'get').length,
    sessionWrites: calls.filter(([op]) => op === 'put').length, cookieSet: r.headers.has('set-cookie') });
}
{
  const env = makeEnv({ IDENTITY_SECRETS: 'acme:w0401-synthetic-backend-key' });
  const unsigned = await post(env, '/acme/identity/link', { visitorId: 'vis-unsigned', accountId: 'synthetic-account' });
  assert.equal(unsigned.status, 401); assert.equal(env.SESSIONS.calls.length, 0); assert.equal(env.CACHE.calls.length, 0);
  results.push({ label: 'configured-unsigned-control', status: unsigned.status, sessionCalls: env.SESSIONS.calls.length, cacheCalls: env.CACHE.calls.length });
  let uuid = 0;
  const requests = [];
  const host = memoryHost({ uuid: () => 'w0401-uuid-' + (++uuid), location: { protocol: 'https:', host: 'synthetic.invalid' },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body), path = new URL(url).pathname;
      const r = await post(env, path.replace(/^\/v1/, ''), body);
      requests.push({ path, status: r.status, visitorId: body.visitorId, proofPresent: typeof body.assertion === 'string' });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
    } });
  const oldVisitor = 'sh_' + 'a'.repeat(32);
  host.storage.set('opt_visitor_id', oldVisitor);
  const core = createCore({ tenant: 'acme' }, host), sdk = createIdentity(core);
  const exp = Math.floor(Date.now() / 1000) + 300;
  const assertion = await signAssertion('w0401-synthetic-backend-key', 'acme', oldVisitor, 'synthetic-second-account', exp);
  const beforeSession = core.sessionId;
  const r = await sdk.identify('synthetic-second-account', { exp, assertion });
  assert.equal(r.ok, false); assert.equal(r.status, 401); assert.equal(r.retried, true);
  assert.deepEqual(requests.map(r => r.status), [409, 200, 401]);
  assert.notEqual(requests[0].visitorId, requests[2].visitorId);
  const initialProofStillValidForOldVisitor = (await verifyAssertion(env, 'acme', { visitorId: oldVisitor, accountId: 'synthetic-second-account', exp, assertion })).ok;
  results.push({ label: 'configured-real-sdk-signed-409', statuses: requests.map(r => r.status),
    visitorChanged: requests[0].visitorId !== requests[2].visitorId,
    linkProofPresent: requests.filter(r => r.path.endsWith('/link')).map(r => r.proofPresent),
    initialProofStillValidForOldVisitor, finalStatus: r.status, retried: r.retried,
    sessionUnchangedResidual: core.sessionId === beforeSession, sessionCalls: env.SESSIONS.calls.length });
  const fresh = core.visitorId;
  const freshProof = await signAssertion('w0401-synthetic-backend-key', 'acme', fresh, 'synthetic-second-account', exp);
  const control = await sdk.identify('synthetic-second-account', { exp, assertion: freshProof });
  assert.equal(control.ok, true);
  results.push({ label: 'fresh-visitor-signed-control', ok: control.ok, retried: control.retried,
    sessionWrites: env.SESSIONS.calls.filter(([op]) => op === 'put').length });
}
assert.equal(externalCalls, 0);
process.stdout.write(JSON.stringify({ task: 'W04.01', startedAt, completedAt: new Date().toISOString(),
  results, externalCalls, sourceIdentity, originalCoreSources,
  limits: ['Actual identity subrouter and SDK core/identify with synthetic successful KV and in-memory HTTP transport, not whole Worker/perimeter or deployed proof.',
    'No logout/session-ownership/generation/erasure correction claimed; no external traffic.'] }, null, 2) + '\n');
