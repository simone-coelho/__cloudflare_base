// W04.02 baseline: actual router, public site-key gate, successful synthetic stores.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const startedAt = new Date().toISOString();
const sourceIdentity = ['src/routes/realtime.ts', 'src/services/SessionManager.ts',
  'src/services/RealtimeSegmentEngine.ts', 'src/middleware/edgeAccess.ts'].map(path =>
  ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
const built = await build({ stdin: { contents: `
export { default as realtimeRoutes } from './src/routes/realtime.ts';
export { SessionManager } from './src/services/SessionManager.ts';
export { tenantMiddleware } from './src/tenancy/middleware.ts';
export { sdkKey } from './src/middleware/edgeAccess.ts';
export { Hono } from 'hono';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, packages: 'external',
  platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { realtimeRoutes, SessionManager, tenantMiddleware, sdkKey, Hono } = module.exports;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error('unexpected external fetch'); };
class KV {
  data = new Map(); calls = [];
  async get(key, type) { this.calls.push(['get', key]); const value = this.data.get(key); return value === undefined ? null : type === 'json' ? JSON.parse(value) : value; }
  async put(key, value) { this.calls.push(['put', key]); this.data.set(key, value); }
  async delete(key) { this.calls.push(['delete', key]); this.data.delete(key); }
  async list({ prefix = '' } = {}) { this.calls.push(['list', prefix]); return { keys: [...this.data.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; }
}
const env = { CACHE: new KV(), SESSIONS: new KV(), AUTH_MODE: 'enforced', CONNECTOR_MODE: 'mock',
  ENVIRONMENT: 'w0402-synthetic', SDK_KEYS: 'acme:w0402-public-site-key',
  TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'] }), REFLEX_HOST: 'session' };
const app = new Hono();
app.use('*', tenantMiddleware());
app.use('/realtime/*', sdkKey());
app.route('/realtime', realtimeRoutes);
const shopper = 'sh_' + 'a'.repeat(32), session = 'w0402-victim-session';
const sm = new SessionManager(env, { tenant: 'acme' });
await sm.createOrUpdateSession(session, shopper, { identity: { shopperId: shopper, linkedAt: Date.now() },
  segments: ['W0402_PRIVATE_SEGMENT'], attributes: { page_views: 7 },
  preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true } });
const before = await sm.readRaw(session);
const requests = [];
for (const [method, suffix, body] of [['GET', 'analytics', undefined],
  ['POST', 'preferences', { trackingConsent: false, personalizationEnabled: false, cookieConsent: false }]]) {
  env.SESSIONS.calls = []; env.CACHE.calls = [];
  const response = await app.request('https://synthetic.invalid/realtime/session/' + session + '/' + suffix, {
    method, headers: { 'X-Tenant': 'acme', 'X-SDK-Key': 'w0402-public-site-key', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, env);
  const result = await response.json();
  assert.equal(response.status, 200);
  if (suffix === 'analytics') assert.deepEqual(result.analytics.segmentHistory, ['W0402_PRIVATE_SEGMENT']);
  requests.push({ handler: suffix, method, status: response.status,
    privateSegmentExposed: suffix === 'analytics' && result.analytics.segmentHistory.includes('W0402_PRIVATE_SEGMENT'),
    sessionReads: env.SESSIONS.calls.filter(([op]) => op === 'get').length,
    sessionWrites: env.SESSIONS.calls.filter(([op]) => op === 'put').length,
    cookieSet: response.headers.has('set-cookie') });
}
const after = await sm.readRaw(session);
assert.deepEqual(before.preferences, { trackingConsent: true, personalizationEnabled: true, cookieConsent: true });
assert.deepEqual(after.preferences, { trackingConsent: false, personalizationEnabled: false, cookieConsent: false });
assert.equal(after.userId, shopper); assert.equal(externalCalls, 0);
process.stdout.write(JSON.stringify({ task: 'W04.02', startedAt, completedAt: new Date().toISOString(),
  sourceIdentity, requests, preferencesBefore: before.preferences, preferencesAfter: after.preferences,
  victimIdentityPreservedWhileMutated: after.userId === shopper, externalCalls,
  limits: ['Two actual handlers behind actual tenancy/site-key middleware with synthetic successful stores, no profile ownership credential.',
    'Reset and other endpoint/host bypasses are source-confirmed in preflight, not exercised by this two-handler baseline.',
    'Not whole Worker, deployed runtime, credential/customer-data or full W04 proof.'] }, null, 2) + '\n');

