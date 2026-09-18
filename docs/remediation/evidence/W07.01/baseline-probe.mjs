import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Actual Worker/router baseline. Uses the existing index boundary fixture's
// workerd build settings; every binding and incoming record here is synthetic.
const sources = ['src/index.ts', 'src/routes/tracking.ts', 'src/routes/pixel.ts',
  'src/routes/webhook.ts', 'src/routes/optimizely.ts', 'src/identity/erase.ts'];
const originalSources = sources.map(path => {
  const source = readFileSync(path, 'utf8');
  return { path, sha256: createHash('sha256').update(source).digest('hex'), source };
});
const wrapper = `
import worker from './src/index.ts';
import { PixelDecoder } from './src/services/PixelDecoder.ts';
import { eraseSubject } from './src/identity/erase.ts';
export default { async fetch() {
  const logs = [], points = [], queued = [], cases = [], store = new Map();
  globalThis.__W0701_LOGS__ = logs;
  const kv = {
    async get(k, type) { const v = store.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list(o = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(o.prefix || '')).map(name => ({ name })), list_complete: true }; },
  };
  const env = { AUTH_MODE: 'open', ENVIRONMENT: 'w0701-synthetic', CACHE: kv, SESSIONS: kv,
    EVENT_QUEUE: { async send(value) { queued.push(value); } },
    ANALYTICS: { writeDataPoint(point) { points.push(point); } },
    STORAGE: { async put(k, v) { store.set(k, v); }, async get() { return null; }, async list() { return { objects: [], truncated: false }; } },
  };
  const ctx = { waitUntil() { throw new Error('Unexpected deferred work'); }, passThroughOnException() {} };
  const sentinels = { userId: 'W0701_ACCOUNT', anonymousId: 'W0701_VISITOR', email: 'w0701@example.invalid',
    ip: '203.0.113.77', userAgent: 'W0701_USER_AGENT', referrer: 'https://mail.example.invalid/W0701_REFERRER',
    trait: 'W0701_PRIVATE_TRAIT', query: 'W0701_QUERY', session: 'W0701_SESSION' };
  const flags = value => Object.fromEntries(Object.entries(sentinels).map(([k, v]) => [k, JSON.stringify(value).includes(v)]));
  const base = { eventId: crypto.randomUUID(), timestamp: 1788740000000, eventType: 'track', source: 'synthetic',
    event: 'synthetic-event', user: { userId: sentinels.userId, anonymousId: sentinels.anonymousId,
      email: sentinels.email, traits: { private: sentinels.trait } } };
  async function request(label, path, body) {
    const p = points.length, q = queued.length, l = logs.length;
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': sentinels.ip,
      'User-Agent': sentinels.userAgent, Referer: sentinels.referrer,
      Cookie: 'opt_tracking_consent=false; opt_personalization_enabled=false' };
    const res = await worker.fetch(new Request('https://coach.example.invalid' + path, {
      method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), env, ctx);
    const type = res.headers.get('content-type');
    const response = type?.includes('json') ? await res.json() : { bytes: (await res.arrayBuffer()).byteLength, contentType: type };
    cases.push({ label, status: res.status, response, analyticsWrites: points.length - p,
      queueSends: queued.length - q, analyticsContains: flags(points.slice(p)), logsContains: flags(logs.slice(l)),
      logCount: logs.length - l });
  }
  await request('track/event', '/track/event?marker=' + sentinels.query, base);
  await request('track/batch', '/track/batch', { events: [base] });
  const pixel = new PixelDecoder().encode({ recipientId: sentinels.anonymousId, emailId: sentinels.email, metadata: { trait: sentinels.trait } });
  await request('pixel/track', '/pixel/track/' + encodeURIComponent(pixel) + '?marker=' + sentinels.query);
  await request('webhook/optimizely', '/webhook/optimizely', { source: 'synthetic', event_type: 'synthetic-event', timestamp: base.timestamp,
    data: { visitor_uuid: sentinels.anonymousId, user_id: sentinels.userId, email: sentinels.email, trait: sentinels.trait } });
  await request('webhook/segment', '/webhook/segment', { type: 'track', userId: sentinels.userId,
    anonymousId: sentinels.anonymousId, event: 'synthetic-event', traits: { email: sentinels.email, private: sentinels.trait } });
  await request('webhook/custom', '/webhook/custom', { userId: sentinels.userId, email: sentinels.email, private: sentinels.trait });
  await request('optimizely/decisions', '/optimizely/decisions', { userId: sentinels.userId, userAttributes: { private: sentinels.trait }, experiments: ['synthetic-experiment'] });
  await request('optimizely/track', '/optimizely/track', { userId: sentinels.userId, eventKey: 'synthetic-event', userAttributes: { email: sentinels.email }, eventTags: { private: sentinels.trait } });
  await request('request logging under refusal', '/api-info?visitorId=' + sentinels.anonymousId + '&sessionId=' + sentinels.session);
  const l = logs.length;
  let ack = 0, retry = 0;
  await worker.queue({ messages: [{ body: queued[0], ack() { ack++; }, retry() { retry++; } }] }, env, ctx);
  const queue = { ack, retry, logCount: logs.length - l, logsContain: flags(logs.slice(l)) };
  const receipt = await eraseSubject(env, 'coach', { visitorId: sentinels.anonymousId }, 'synthetic-operator');
  return Response.json({ cases, queue, receipt: { notReached: receipt.notReached }, analyticsWrites: points.length,
    queueSends: queued.length, limitations: ['Optimizely uses its existing no-key mock fallback, not external SDK measurement',
      'Local workerd and synthetic bindings only; no deployed dataset, retention, historical deletion or full consent claim'] });
} };
`;
const startedAt = new Date().toISOString();
const bundled = await build({ stdin: { contents: wrapper, resolveDir: process.cwd(), sourcefile: 'w0701-baseline.ts', loader: 'ts' },
  bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'],
  alias: { path: 'node:path', 'node:os': 'unenv/node/os' }, logLevel: 'silent',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire('/w0701-worker.mjs'); globalThis.__W0701_LOGS__ = []; for (const method of ['log','warn','error','info','debug']) console[method] = (...values) => globalThis.__W0701_LOGS__.push(values.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' '));" },
});
let outboundAttempts = 0;
const runtime = new Miniflare({ modules: [{ type: 'ESModule', path: 'w0701-worker.mjs', contents: bundled.outputFiles[0].text }],
  compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'],
  outboundService: () => { outboundAttempts++; throw new Error('W07.01 forbids outbound network'); },
});
try {
  const response = await runtime.dispatchFetch('http://w0701.local/baseline');
  const result = await response.json();
  console.log(JSON.stringify({ startedAt, endedAt: new Date().toISOString(), transportStatus: response.status,
    result, outboundAttempts, reportedInputCount: Object.keys(bundled.metafile.inputs).length,
    originalSources }, null, 2));
  if (response.status !== 200 || outboundAttempts) process.exitCode = 1;
} finally { await runtime.dispose(); }
