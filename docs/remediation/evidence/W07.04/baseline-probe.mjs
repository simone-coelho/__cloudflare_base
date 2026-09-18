import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const startedAt = new Date().toISOString();
const sources = ['src/index.ts', ...['live','liveOps','operator','ai','aiScene','funnel','webhook'].map(n => 'src/routes/' + n + '.ts'),
  ...['ShopperReflex','RateLimiter','StateManager'].map(n => 'src/durable-objects/' + n + '.ts'),
  'src/config/versionedStore.ts', 'src/connectors/DecisionProvider.ts', 'src/tenancy/middleware.ts', 'src/ops/monitor.ts',
  'src/demos/meridian/MeridianReflex.ts', 'src/demos/brighthour/offerDesk.ts', 'src/demos/brighthour/composer.ts'];
const originalSources = sources.map(path => { const source = readFileSync(path, 'utf8');
  return { path, source, sha256: createHash('sha256').update(source).digest('hex') }; });
const contents = [
  'export * from "./src/config/versionedStore.ts";', 'export * from "./src/connectors/DecisionProvider.ts";',
  'export * from "./src/durable-objects/RateLimiter.ts";', 'export * from "./src/durable-objects/StateManager.ts";',
  'export * from "./src/routes/aiScene.ts";', 'export * from "./src/routes/webhook.ts";',
  'export * from "./src/ops/monitor.ts";', 'export * from "./src/tenancy/middleware.ts";',
].join('\n');
const bundle = await build({ stdin: { contents, loader: 'ts', sourcefile: 'w0704-baseline.ts', resolveDir: process.cwd() },
  bundle: true, write: false, packages: 'external', platform: 'node', format: 'cjs', logLevel: 'silent' });
const module = { exports: {} }, require = createRequire(process.cwd() + '/package.json');
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require);
const { read, write, invalidateCache, LiveDecisionProvider, RateLimiter, StateManager,
  aiSceneRoutes, webhookRoutes, runMonitor, tenantForRequest } = module.exports;
const marker = 'W0704_PRIVATE_SUBJECT', errorMark = 'W0704_PRIVATE_ERROR', logs = [], results = [];
const oldConsole = {}, oldFetch = globalThis.fetch;
for (const method of ['log','info','warn','error','debug']) { oldConsole[method] = console[method];
  console[method] = (...args) => logs.push({ method, values: args.map(v => v instanceof Error ? v.message : typeof v === 'object' ? '[synthetic object]' : v) }); }
globalThis.fetch = async () => { throw new Error('Unexpected external request'); };
const capture = async (label, fn) => { const offset = logs.length; const effects = await fn();
  results.push({ label, effects, logs: logs.slice(offset) }); };
function kv() { const values = new Map(), puts = [];
  return { values, puts, async get(key, format) { const value = values.get(key); return value === undefined ? null : format === 'json' ? JSON.parse(value) : value; },
    async put(key, value) { puts.push(key); values.set(key, value); }, async delete(key) { values.delete(key); },
    async list() { return { keys: [] }; } }; }
try {
  await capture('Versioned config failure retry and valid writes', async () => {
    invalidateCache(); let reads = 0;
    const kind = { name: 'content', validate(value) { return value?.allowed ? { ok: true, value } : { ok: false, errors: [marker] }; } };
    const bad = { CACHE: { async get() { reads++; throw new Error(errorMark); } } };
    const fallback = { fallback: true };
    const failed = [await read(bad, kind, marker, fallback), await read(bad, kind, marker, fallback)];
    const store = kv(); store.values.set('content:config:' + marker + ':current', JSON.stringify({ value: {} }));
    const invalid = await read({ CACHE: store }, kind, marker, fallback);
    const written = await write({ CACHE: store }, kind, marker, { allowed: true, private: marker }, { actor: 'synthetic' });
    return { readAttempts: reads, failuresUsedFallback: failed.every(v => v === fallback), invalidUsedFallback: invalid === fallback,
      writeOk: written.ok, writeCount: store.puts.length, currentPrivatePreserved: JSON.parse(store.values.get('content:config:' + marker + ':current')).value.private === marker };
  });
  await capture('Live decisions memoization, values and caught fallback', async () => {
    let factories = 0, decisions = 0, fail = false;
    const provider = new LiveDecisionProvider({ async createFreshClient() { factories++; return {
      revision: marker, datafile: { featureFlags: [{ key: marker }] }, client: { createUserContext(userId, attrs) {
        return { decide(flag, options) { decisions++; if (fail) throw new Error(errorMark);
          return { flagKey: flag, enabled: true, variables: { private: userId }, variationKey: marker, ruleKey: 'rule' }; } }; },
      } }; } });
    const first = await provider.decide(marker, marker, [], {}), second = await provider.decide(marker, marker, [], {});
    fail = true; const fallback = await provider.decide(marker, marker, [], {});
    return { factories, decisions, firstPreserved: first.variables.private === marker, secondPreserved: second.variationKey === marker,
      fallbackEnabled: fallback.enabled, fallbackReason: fallback.reason };
  });
  await capture('Actual DO caught cleanup/error and unawaited-handler semantics', async () => {
    const stored = new Map(); let puts = 0, cleanupCalls = 0;
    const limiter = new RateLimiter({ storage: { async get(key) { return stored.get(key); },
      async put(key, value) { puts++; stored.set(key, value); }, async list() { cleanupCalls++; throw new Error(errorMark); } } });
    const good = await limiter.fetch(new Request('https://synthetic.invalid', { method: 'POST', body: JSON.stringify({ limit: 2, window: 60 }) }));
    await Promise.resolve();
    const bad = await limiter.fetch(new Request('https://synthetic.invalid', { method: 'POST', body: marker }));
    const state = new StateManager({ storage: { async get() { throw new Error(errorMark); } } });
    let escaped = false; try { await state.fetch(new Request('https://synthetic.invalid/get?key=' + marker)); } catch (e) { escaped = e.message === errorMark; }
    return { allowed: (await good.json()).allowed, puts, cleanupCalls, malformedStatus: bad.status, stateHandlerRejectionEscapes: escaped };
  });
  await capture('Scene queue fallback and datafile cache response', async () => {
    let heads = 0, queues = 0; const cache = kv();
    const response = await aiSceneRoutes.request('https://synthetic.invalid/', { method: 'POST',
      body: JSON.stringify({ productId: 'COA-CH857', sceneId: marker, sceneContext: marker }) },
      { GEMINI_API_KEY: 'synthetic', STORAGE: { async head() { heads++; return heads === 1 ? null : { size: 3 }; } },
        EVENT_QUEUE: { async send() { queues++; throw new Error(errorMark); } } });
    let fetches = 0;
    globalThis.fetch = async () => { fetches++; return Response.json({ revision: marker, featureFlags: [{ key: marker }] }); };
    const webhook = await webhookRoutes.request('https://synthetic.invalid/optimizely-datafile', { method: 'POST', body: '{}' },
      { OPTIMIZELY_SDK_KEY: 'synthetic', CACHE: cache });
    const body = await webhook.json();
    return { sceneStatus: response.status, scene: await response.json(), heads, queues, fetches,
      webhookStatus: webhook.status, revisionPreserved: body.revision === marker, flags: body.flags, cacheWrites: cache.puts.length };
  });
  await capture('Monitor log and AE raw error with preserved diagnostics/alert', async () => {
    const cache = kv(), points = [], alerts = []; const get = cache.get;
    cache.get = async (key, format) => { if (key === 'monitor-probe') throw new Error(errorMark); return get(key, format); };
    globalThis.fetch = async (_url, init) => { alerts.push(JSON.parse(init.body)); return new Response('{}'); };
    const env = { CACHE: cache, SESSIONS: kv(), STORAGE: { async head() { return null; } },
      DB: { prepare() { return { async first() { return { one: 1 }; } }; } },
      REFLEX_HOST: 'do', SHOPPER_REFLEX: { idFromName: n => n, get: () => ({ fetch: async () => Response.json({ consent: { tracking: false, personalization: false } }) }) },
      LEARN_STATS: { idFromName: n => n, get: () => ({ fetch: async () => new Response('{}', { status: 404 }) }) },
      ANALYTICS: { writeDataPoint(point) { points.push(point); } }, ALERT_WEBHOOK_URL: 'https://synthetic.invalid/alert', ENVIRONMENT: 'synthetic' };
    const result = await runMonitor(env, 'w0704-brand', 100000);
    return { returnedOk: result.ok, returnedErrorPreserved: result.checks.kv.detail === errorMark, checks: Object.keys(result.checks),
      points: points.length, pointRawError: points.some(p => p.blobs.some(b => b.includes(errorMark))), pointShape: points.map(p => ({ blobs: p.blobs.length, doubles: p.doubles.length, indexes: p.indexes.length })),
      alerts: alerts.length, alertErrorPreserved: alerts.some(a => a.problems.some(p => p.includes(errorMark))),
      storedErrorPreserved: JSON.parse(cache.values.get('monitor:w0704-brand:last')).checks.kv.detail === errorMark, cacheWrites: cache.puts.length };
  });
  await capture('Tenant resolution caught failure keeps default', async () => {
    const env = Object.defineProperty({}, 'TENANTS', { get() { throw new Error(errorMark); } });
    return { tenant: tenantForRequest(env, new Request('https://synthetic.invalid')) };
  });
} finally { for (const method of Object.keys(oldConsole)) console[method] = oldConsole[method]; globalThis.fetch = oldFetch; }
console.log(JSON.stringify({ task: 'W07.04', startedAt, completedAt: new Date().toISOString(),
  command: 'node docs/remediation/evidence/W07.04/baseline-probe.mjs', results, originalSources,
  limits: 'Representative actual local modules, intercepted bindings/network only; not every catch or scheduled/runtime path. All18 originals retained; no complete graph/native Worker/deployed/customer/privacy acceptance claim.' }, null, 2));

