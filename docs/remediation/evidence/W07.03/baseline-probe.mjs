import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const startedAt = new Date().toISOString();
const sources = ['src/services/CDPService.ts', 'src/services/odpLoop.ts', 'src/services/SessionManager.ts',
  'src/services/RealtimeSegmentEngine.ts', 'src/services/FeatureVariableManager.ts', 'src/routes/cdp.ts', 'src/routes/realtime.ts'];
const originalSources = sources.map(path => { const source = readFileSync(path, 'utf8');
  return { path, source, sha256: createHash('sha256').update(source).digest('hex') }; });
const bundle = await build({ stdin: { contents: sources.slice(0, 5).map(p => 'export * from "./' + p + '";').join('\n')
  + '\nexport { cdpRoutes as cdp } from "./src/routes/cdp.ts";\nexport { default as realtime } from "./src/routes/realtime.ts";',
  loader: 'ts', sourcefile: 'w0703-baseline.ts', resolveDir: process.cwd() },
  bundle: true, write: false, packages: 'external', platform: 'node', format: 'cjs', logLevel: 'silent' });
const module = { exports: {} }, require = createRequire(process.cwd() + '/package.json');
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require);
const { forwardEventToOdp, upsertOdpProfile, fetchOdpAudiences, CDPService, SessionManager,
  FeatureVariableManager, RealtimeSegmentEngine, cdp, realtime } = module.exports;
const mark = 'W0703_PRIVATE_SUBJECT', errorMark = 'W0703_PRIVATE_ERROR', tenant = 'w0703-brand';
const saved = {}, originalFetch = globalThis.fetch, results = [], logs = [];
for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
  saved[method] = console[method];
  console[method] = (...args) => logs.push({ method, values: args.map(v => v instanceof Error ? v.message : typeof v === 'string' ? v : JSON.stringify(v)) });
}
globalThis.fetch = async () => { throw new Error('Unexpected external request'); };
const capture = async (label, action) => { const from = logs.length; const effects = await action(); const selected = logs.slice(from);
  results.push({ label, effects, logs: selected, containsSubject: JSON.stringify(selected).includes(mark), containsError: JSON.stringify(selected).includes(errorMark) }); };
function kv() {
  const values = new Map(), writes = [];
  return { values, writes, async get(key, format) { const v = values.get(key); return v === undefined ? null : format === 'json' ? JSON.parse(v) : v; },
    async put(key, value) { writes.push(key); values.set(key, value); }, async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...values.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } };
}
try {
  const identity = { visitorId: mark, sessionId: 'synthetic-session' };
  const event = { type: 'page_view', userId: mark, data: { path: '/' + mark }, timestamp: 1, source: 'synthetic' };
  for (const rejectingText of [false, true]) await capture('ODP non-OK ' + (rejectingText ? 'rejecting text' : 'ordinary text'), async () => {
    let textReads = 0; const requests = [], receipts = [], relays = [], names = [];
    globalThis.fetch = async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return {
      ok: false, status: 503, async text() { textReads++; if (rejectingText) throw new Error(errorMark); return mark; } }; };
    const env = { ODP_API_HOST: 'https://synthetic.invalid', ODP_PUBLIC_KEY: 'synthetic',
      PERSONALIZATION_WEBSOCKET: { idFromName(name) { names.push(name); return name; }, get() { return { async fetch(url, init) { relays.push(JSON.parse(init.body)); return new Response('{}'); } }; } } };
    await forwardEventToOdp(env, event, identity, 'callback-receipt', r => receipts.push(r), tenant);
    await forwardEventToOdp(env, event, identity, 'relay-receipt', undefined, tenant);
    await upsertOdpProfile(env, identity, { dims: { line: { Tabby: 0.7 } } }, 'late');
    return { requests: requests.length, textReads, callbackStatuses: receipts.map(r => r.status), relayStatuses: relays.map(r => r.data.status),
      relayTenantScoped: names.every(n => n === 't:' + tenant + ':' + mark), pagePreserved: requests[0].body.data.page === '/' + mark,
      hashedVuid: /^[0-9a-f]{32}$/.test(requests[0].body.identifiers.vuid), profileScore: requests[2].body[0].attributes.line_affinity_tabby };
  });
  await capture('ODP GraphQL success, payload and caught failure', async () => {
    const env = { ODP_API_HOST: 'https://synthetic.invalid', ODP_PUBLIC_KEY: 'synthetic' }, bodies = [];
    const responses = [{ errors: [{ message: mark }] }, { data: { customer: { audiences: { edges: [
      { node: { name: 'qualified-control', state: 'qualified' } }, { node: { name: 'excluded-control', state: 'not_qualified' } }] } } } }];
    globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return Response.json(responses.shift()); };
    const gqlError = await fetchOdpAudiences(env, identity, [{ type: 'pageview', private: mark }]);
    const success = await fetchOdpAudiences(env, identity);
    globalThis.fetch = async () => { throw new Error(errorMark); };
    const caught = await fetchOdpAudiences(env, identity);
    await forwardEventToOdp(env, event, identity);
    await upsertOdpProfile(env, identity, {});
    return { gqlError, success, caught, recentEventPreserved: bodies[0].query.includes(mark) };
  });
  await capture('CDP partial forwarding, store, queue and read fallback', async () => {
    const cache = kv(), sent = [], queued = [];
    globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); if (url.endsWith('/bad')) throw new Error(errorMark); return Response.json({ ok: true }); };
    const service = new CDPService({ CACHE: cache, CDP_ENDPOINTS: JSON.stringify(['ok', 'bad'].map(id => ({
      id: id + mark, name: id + mark, enabled: true, config: { url: 'https://synthetic.invalid/' + id } }))),
      EVENT_QUEUE: { async send(body) { queued.push(body); } } }, tenant);
    await service.identify({ userId: mark, traits: { private: mark } });
    await service.track({ userId: mark, event: 'purchase', properties: { private: mark } });
    const profile = await service.getProfile({ userId: mark });
    const failed = new CDPService({ CACHE: { async get() { throw new Error(errorMark); } } }, tenant);
    return { sent: sent.length, queue: queued.length, allSubjectsPreserved: sent.every(v => v.userId === mark),
      storeScoped: cache.writes.every(k => k.startsWith('t:' + tenant + ':')), traitPreserved: profile.traits.private === mark,
      missingProfile: await failed.getProfile({ userId: mark }), missingSegments: await failed.getSegments(mark) };
  });
  await capture('Session successful storage and caught fallback/rethrow', async () => {
    const sessions = kv(), manager = new SessionManager({ SESSIONS: sessions }, { tenant });
    await manager.createOrUpdateSession('session', mark, { attributes: { private: mark } });
    const loaded = await manager.getSession('session');
    const failed = new SessionManager({ SESSIONS: { async get() { throw new Error(errorMark); }, async put() { throw new Error(errorMark); } } }, { tenant });
    const missing = await failed.getSession('session'); let rethrown;
    try { await failed.createOrUpdateSession('session', mark, {}); } catch (error) { rethrown = error.message === errorMark; }
    return { writes: sessions.writes.length, storedSubject: loaded.userId === mark, storedTrait: loaded.attributes.private === mark,
      scoped: sessions.writes.every(k => k.startsWith('t:' + tenant + ':')), missing, rethrown };
  });
  await capture('Feature and segment service error fallbacks', async () => {
    const cache = kv(), manager = new FeatureVariableManager({ CACHE: cache }, tenant);
    manager.optimizelyService = { async initialize() { throw new Error(errorMark); } };
    const feature = await manager.getFeatureVariables(mark, {}, [mark]);
    const failedCache = { async get() { throw new Error(errorMark); }, async list() { throw new Error(errorMark); } };
    const failed = new FeatureVariableManager({ CACHE: failedCache }, tenant);
    const overrides = await failed.getUserOverrides(mark);
    const engine = new RealtimeSegmentEngine({ CACHE: failedCache, SESSIONS: kv() },
      { segments: { async fetchQualifiedSegments() { return ['segment-control']; } } }, { tenant });
    const segments = await engine.getUserSegments(mark);
    return { featureSource: feature[mark].source, featureDisabled: !feature[mark].enabled, overrides, segments };
  });
  await capture('Actual routers malformed input and successful relay with capture failure', async () => {
    const env = { CACHE: kv(), SESSIONS: kv() }, statuses = [];
    for (const [router, path] of [[cdp, '/identify'], [realtime, '/action']]) {
      const response = await router.request('https://synthetic.invalid' + path, { method: 'POST', body: mark }, env);
      statuses.push(response.status);
    }
    const sent = [], pending = [];
    const response = await realtime.request('https://synthetic.invalid/action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event) }, { ...env, REFLEX_HOST: 'do', DEMO_EVENT_CAPTURE: 'true',
      DB: { prepare() { throw new Error(errorMark); } },
      SHOPPER_REFLEX: { idFromName(name) { return name; }, get() { return { async fetch(url, init) {
        sent.push(JSON.parse(init.body)); return Response.json({ success: true, sessionId: 'synthetic-session', consent: { tracking: false } }); } }; } },
    }, { waitUntil(p) { pending.push(p); }, passThroughOnException() {} });
    await Promise.all(pending);
    return { malformedStatuses: statuses, successStatus: response.status, relayCount: sent.length, subjectPreserved: sent[0].userId === mark,
      response: await response.json(), captureSettled: pending.length };
  });
} finally {
  for (const method of Object.keys(saved)) console[method] = saved[method];
  globalThis.fetch = originalFetch;
}
console.log(JSON.stringify({ task: 'W07.03', startedAt, completedAt: new Date().toISOString(),
  command: 'node docs/remediation/evidence/W07.03/baseline-probe.mjs',
  limits: 'Actual local modules; all fetch/KV/DO/D1/SDK seams synthetic. No live network, data, native Worker or complete dependency attestation. GraphQL 1500ms timers are allowed to settle before process exit.',
  results, originalSources }, null, 2));
