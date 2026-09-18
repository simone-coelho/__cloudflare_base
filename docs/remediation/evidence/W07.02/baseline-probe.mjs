import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Actual service methods, SDK creation seam and in-process callback/storage
// fakes only. No socket transport, remote service or real data is used.
const startedAt = new Date().toISOString();
const sources = ['src/services/OptimizelyService.ts', 'src/services/EventDispatcher.ts',
  'src/services/sceneGen.ts', 'src/durable-objects/PersonalizationWebSocket.ts'];
const originalSources = sources.map(path => { const source = readFileSync(path, 'utf8');
  return { path, source, sha256: createHash('sha256').update(source).digest('hex') }; });
const bundle = await build({ stdin: { contents: sources.map((p, i) => 'export * from "./' + p + '";').join('\n') + '\nexport { getCatalog } from "./src/services/CatalogIntent.ts";',
  loader: 'ts', sourcefile: 'w0702-baseline.ts', resolveDir: process.cwd() },
  bundle: true, write: false, metafile: true, packages: 'external', platform: 'node', format: 'cjs', logLevel: 'silent' });
const require = createRequire(process.cwd() + '/package.json');
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require);
const { OptimizelyService, EventDispatcher, generateSceneToR2, PersonalizationWebSocket, getCatalog } = module.exports;
const sdk = require('@optimizely/optimizely-sdk/lite');
const oldFactories = [sdk.createInstance, sdk.default.createInstance];
const originalConsole = {}, originalFetch = globalThis.fetch, originalWebSocket = globalThis.WebSocket;
const logs = [], results = [], sdkOptions = [], sdkCalls = [], requests = [];
const mark = 'W0702_PRIVATE_SUBJECT', err = 'W0702_PRIVATE_ERROR';
for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
  originalConsole[method] = console[method];
  console[method] = (...args) => logs.push({ method, values: args.map(v => v instanceof Error ? v.message : typeof v === 'string' ? v : JSON.stringify(v)) });
}
const capture = async (label, action) => { const from = logs.length; const effects = await action(); const selected = logs.slice(from);
  results.push({ label, effects, logs: selected, containsSubject: JSON.stringify(selected).includes(mark), containsError: JSON.stringify(selected).includes(err) }); };
const client = {
  onReady: async () => {},
  getVariation: (...a) => { sdkCalls.push(['variation', ...a]); return 'variation-' + mark; },
  isFeatureEnabled: (...a) => { sdkCalls.push(['feature', ...a]); return true; },
  getFeatureVariable: (...a) => { sdkCalls.push(['variable', ...a]); return mark; },
  getAllFeatureVariables: (...a) => { sdkCalls.push(['variables', ...a]); return { private: mark }; },
  track: (...a) => { sdkCalls.push(['track', ...a]); },
  createUserContext: () => ({ decide() { throw new Error(err); } }),
};
sdk.createInstance = sdk.default.createInstance = options => { sdkOptions.push(options); return client; };
try {
  let callbackStatus;
  globalThis.fetch = async (...args) => { requests.push(args); return Response.json({ revision: 'synthetic-revision' }); };
  const service = new OptimizelyService({ OPTIMIZELY_SDK_KEY: 'synthetic-sdk-fixture', CACHE: { async get() { return { revision: 'cached' }; } } });
  await capture('Optimizely values and IDs', async () => {
    const out = [await service.getVariation('experiment-' + mark, mark), await service.isFeatureEnabled('feature-' + mark, mark),
      await service.getFeatureVariable('feature', 'variable', mark), await service.getAllFeatureVariables('feature', mark)];
    await service.track('event-' + mark, mark, { private: mark }, { private: mark });
    return { returnedValues: out, sdkMethodCalls: sdkCalls.length };
  });
  await capture('Optimizely initialize callbacks', async () => {
    sdkOptions[0].logger.log(3, mark); sdkOptions[0].errorHandler.handleError(new Error(err));
    sdkOptions[0].eventDispatcher.dispatchEvent({ url: 'https://measurement.example.invalid', params: { userId: mark } }, r => { callbackStatus = r.statusCode; });
    await Promise.resolve(); await Promise.resolve();
    return { deliveryAttempts: requests.length, callbackStatus };
  });
  await capture('Optimizely fresh SDK logger', async () => {
    const fresh = await service.createFreshClient();
    sdkOptions[1].logger.log(4, mark); sdkOptions[1].errorHandler.handleError(new Error(err));
    const before = requests.length; sdkOptions[1].eventDispatcher.dispatchEvent({ url: 'https://measurement.example.invalid' });
    return { revision: fresh.revision, freshFactoryReceivedSameClient: fresh.client === client, freshEventAttempts: requests.length - before };
  });
  await capture('Optimizely decide failure', async () => ({ result: await service.decide('flag-' + mark, mark) }));

  await capture('EventDispatcher partial failure and retries', async () => {
    const queued = [], sent = [];
    globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); if (url.endsWith('/bad')) throw new Error(err); return new Response('{}'); };
    const dispatcher = new EventDispatcher({ WEBHOOK_ENDPOINTS: JSON.stringify([
      { name: 'ok', type: 'custom', enabled: true, url: 'https://destination.example.invalid/ok' },
      { name: mark, type: 'custom', enabled: true, url: 'https://destination.example.invalid/bad', retryConfig: { maxRetries: 1, backoffMs: 1 } },
    ]), EVENT_QUEUE: { async send(body) { queued.push(body); } } });
    const event = { eventType: 'track', user: { userId: mark }, properties: { private: mark } };
    const out = await dispatcher.dispatch(event);
    return { sent: sent.length, allBodiesPreserved: sent.every(v => JSON.stringify(v) === JSON.stringify(event)),
      success: out.map(v => v.success), queueTypes: queued.map(v => v.type), failureResponseContainsError: out[1].error === err };
  });
  await capture('EventDispatcher queue error', async () => {
    let sends = 0;
    const dispatcher = new EventDispatcher({ EVENT_QUEUE: { async send() { sends++; throw new Error(err); } } });
    const result = await dispatcher.dispatch({ eventType: 'track', user: { userId: mark } });
    return { sends, returned: result };
  });

  const product = getCatalog()[0], job = { productId: product.id, sceneId: mark, sceneContext: mark, type: 'search' };
  const sceneEnv = { GEMINI_API_KEY: 'synthetic-not-a-credential', STORAGE: { async head() { return null; }, async put() {} },
    ASSETS: { async fetch() { return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } }); } } };
  await capture('scene HTTP error body', async () => {
    let modelCalls = 0, bodyReads = 0;
    globalThis.fetch = async () => { modelCalls++; return { ok: false, status: 503, async text() { bodyReads++; return mark; } }; };
    return { result: await generateSceneToR2(sceneEnv, job), modelCalls, bodyReads };
  });
  await capture('scene thrown error', async () => {
    let calls = 0; globalThis.fetch = async () => { calls++; throw new Error(err); };
    return { result: await generateSceneToR2(sceneEnv, job), calls };
  });
  await capture('scene successful bytes', async () => {
    let writes = 0, size = 0;
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: 'AQID' } }] } }] });
    return { result: await generateSceneToR2({ ...sceneEnv, STORAGE: { ...sceneEnv.STORAGE, async put(_key, bytes) { writes++; size = bytes.length; } } }, job), writes, size };
  });

  await capture('WebSocket callback state and IDs', async () => {
    globalThis.WebSocket = { READY_STATE_OPEN: 1 };
    const pending = [], writes = [], sent = [];
    const socket = new PersonalizationWebSocket({ blockConcurrencyWhile(fn) { pending.push(fn()); },
      storage: { async get() { return null; }, async put(key, value) { writes.push([key, value]); } } });
    await Promise.all(pending);
    socket.connections.set('connection-' + mark, { readyState: 1, send(value) { sent.push(JSON.parse(value)); } });
    socket.userConnections.set(mark, new Set(['connection-' + mark]));
    for (const type of ['heartbeat', 'subscribe', 'unsubscribe', mark]) await socket.handleWebSocketMessage('connection-' + mark, mark, { data: JSON.stringify({ type }) });
    await socket.broadcastUpdate({ type: 'segment_update', userId: mark, data: { private: mark } });
    await socket.handleWebSocketClose('connection-' + mark, mark);
    return { sends: sent.length, heartbeat: sent[0].type, subjectPreservedInBroadcast: sent[1].userId === mark,
      stateWrites: writes.length, remainingConnections: socket.connections.size, remainingUsers: socket.userConnections.size };
  });
} finally {
  globalThis.fetch = originalFetch; globalThis.WebSocket = originalWebSocket;
  sdk.createInstance = oldFactories[0]; sdk.default.createInstance = oldFactories[1];
  for (const method of Object.keys(originalConsole)) console[method] = originalConsole[method];
}
console.log(JSON.stringify({ startedAt, endedAt: new Date().toISOString(), results, originalSources,
  limits: ['All fetch/SDK creation/socket/storage seams intercepted in process; no external traffic or credentials',
    'SDK logger factory is actual installed code; SDK creation and methods synthetic', 'WebSocket callbacks exercised directly, not upgrade/transport acceptance',
    'No historical deletion, consent policy, retention, environment dataset or full privacy acceptance'] }, null, 2));
