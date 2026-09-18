import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import optimizely from '@optimizely/optimizely-sdk/lite';
import type { Env } from '@/types/env';
import { configuredDestinations, configuredOperationalDestinations } from '@/connectors/config';
import { retentionBirth, externalRetentionBirths, destinationRetentionCategory } from '@/retention';
import { admitOwnerPrincipal, currentOwnerConsent, dispatchOwnedRequest, pinProfileRetention, runOwnerOperation } from '@/identity/sessionAuthority';
import { issueSessionCapability, verifySessionCapability, type SessionCapability } from '@/identity/sessionCapability';
import { CONSENT_LIFETIME_MS, storedConsent } from '@/content/consent';
import type { Event } from '@/types/events';
import { OptimizelyService } from './OptimizelyService';
import { EventDispatcher } from './EventDispatcher';
import { generateSceneToR2, sceneUrl } from './sceneGen';
import { getCatalog } from './CatalogIntent';
import { PersonalizationWebSocket } from '@/durable-objects/PersonalizationWebSocket';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { CDPService } from './CDPService';
import { SessionManager } from './SessionManager';
import { FeatureVariableManager } from './FeatureVariableManager';
import { RealtimeSegmentEngine, type ActionEvent } from './RealtimeSegmentEngine';
import { forwardEventToOdp, upsertOdpProfile, fetchOdpAudiences, vuidFor } from './odpLoop';
import { cdpRoutes } from '@/routes/cdp';
import realtimeRoutes from '@/routes/realtime';
import type { TenantVariables } from '@/tenancy/tenant';
import { read, write, invalidateCache, type DocumentKind } from '@/config/versionedStore';
import { LiveDecisionProvider } from '@/connectors/DecisionProvider';
import { RateLimiter } from '@/durable-objects/RateLimiter';
import { StateManager } from '@/durable-objects/StateManager';
import { aiSceneRoutes } from '@/routes/aiScene';
import { webhookRoutes } from '@/routes/webhook';
import { runMonitor } from '@/ops/monitor';
import { tenantForRequest } from '@/tenancy/middleware';

// Actual service methods; only SDK creation, fetch, storage and socket endpoints
// are synthetic. This suite does not inherit the route fixture's service mocks.
const SUBJECT = 'vis-00000000-0000-4000-8000-000000000701', ERROR = 'W0702_PRIVATE_ERROR';
const eventFixture = (): Event => ({ eventId: '00000000-0000-4000-8000-000000000001', timestamp: 1,
  source: 'synthetic', version: '1.0', eventType: 'track', event: 'purchase',
  user: { userId: SUBJECT, anonymousId: SUBJECT }, properties: { private: SUBJECT } });
let logs: unknown[][];
beforeEach(() => {
  logs = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => { logs.push(args); });
  }
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected external request'); }));
});
afterEach(() => {
  // Never stringify callback objects to test logging: that would itself invoke
  // potentially hostile coercion hooks. Only literals/numeric status survive.
  for (const args of logs) for (const value of args) {
    expect(['string', 'number']).toContain(typeof value);
    if (typeof value === 'string') { expect(value).not.toMatch(/W0702_PRIVATE/); expect(value).not.toContain(SUBJECT); }
  }
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

/** Actual service methods under an explicitly admitted synthetic owner. This
 * unit seam is not evidence that generic public webhooks acquire authority. */
async function unitAuthority<T>(env: Env, tenant: string, work: (owner: object, principal: SessionCapability, capability: string) => Promise<T>, extra: Array<{ name: string; type: string; url: string }> = []): Promise<T> {
  env.TENANTS = JSON.stringify({ provisioned: [tenant] }); env.DEPLOYMENT_PROFILE = 'demo';
  env.SESSIONS ??= subjectStore() as unknown as KVNamespace;
  const now = Date.now(), policy = { id: 'synthetic-unit', revision: 1, durationMs: 60000, basis: 'admitted', renewal: 'new-record-only' };
  const categories = ['profile', 'identity', 'ledger', 'online', 'hourly', ...(await configuredDestinations(env, tenant, () => {})).map(d => d.category)];
  if (env.OPTIMIZELY_SDK_KEY) categories.push(await destinationRetentionCategory('fx', { eventsUrl: 'https://logx.optimizely.com/v1/events', accountId: 'undefined', projectId: 'undefined' }));
  for (const destination of extra) categories.push(await destinationRetentionCategory('tracking', { name: destination.name, type: destination.type, url: new URL(destination.url).href }));
  env.RETENTION = JSON.stringify({ version: 1, tenants: { [tenant]: Object.fromEntries(categories.map(c => [c, policy])) } });
  const externalRetention = externalRetentionBirths(env, tenant, now, now), owner = {};
  env.JWT_SECRET ??= 'w0705-unit-signing-material-not-secret'; env.JWT_ISSUER ??= 'w0705'; env.JWT_AUDIENCE ??= 'w0705';
  const grant = await issueSessionCapability(env, { tenant, subject: SUBJECT, sessionId: 's-unit', kind: 'anonymous' });
  const principal = await verifySessionCapability(env, grant.capability, tenant);
  const consent = storedConsent({ version: 1, tenant, subject: SUBJECT, revision: 'unit-choice', tracking: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS }, personalization: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS } });
  return runOwnerOperation(owner, env, async () => {
    admitOwnerPrincipal(owner, principal); pinProfileRetention(env, { retention: retentionBirth(env, tenant, 'profile', now, now), externalRetention }, tenant);
    return work(owner, principal, grant.capability);
  }, env.SESSIONS as never, async (_operation, subject, scope, body) => env.PERSONALIZATION_WEBSOCKET.get(env.PERSONALIZATION_WEBSOCKET.idFromName(scope === 'coach' ? subject : `t:${scope}:${subject}`)).fetch('https://relay/broadcast', { method: 'POST', body: JSON.stringify(body) }), async () => consent, undefined, async () => externalRetention);
}

function sdkFixture() {
  const decision = vi.fn(() => ({ enabled: true, variationKey: SUBJECT, ruleKey: SUBJECT, variables: { private: SUBJECT } }));
  const client = {
    onReady: vi.fn(async () => undefined),
    getVariation: vi.fn(() => SUBJECT), isFeatureEnabled: vi.fn(() => true),
    getFeatureVariable: vi.fn(() => SUBJECT), getAllFeatureVariables: vi.fn(() => ({ private: SUBJECT })),
    track: vi.fn(() => undefined), createUserContext: vi.fn(() => ({ decide: decision })),
  };
  const options: any[] = [];
  vi.spyOn(optimizely, 'createInstance').mockImplementation((o: any) => { options.push(o); return client as never; });
  const cache = { get: vi.fn(async () => ({ revision: 'cached', audiences: [], experiments: [], featureFlags: [] })),
    put: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) };
  const env = { DEPLOYMENT_PROFILE: 'demo', OPTIMIZELY_SDK_KEY: 'synthetic-fixture', CACHE: cache } as unknown as Env;
  return { service: new OptimizelyService(env), env, options, client, cache, decision };
}

describe('Optimizely service log boundaries', () => {
  it('preserves actual public method values/arguments and both event-delivery policies', async () => {
    const { service, options, client, decision, env } = sdkFixture();
    const attrs = { private: SUBJECT }, tags = { value: 1 };
    expect(await service.getVariation('experiment', SUBJECT, attrs)).toBe(SUBJECT);
    expect(await service.isFeatureEnabled('feature', SUBJECT, attrs)).toBe(true);
    expect(await service.getFeatureVariable('feature', 'variable', SUBJECT, attrs)).toBe(SUBJECT);
    expect(await service.getAllFeatureVariables('feature', SUBJECT, attrs)).toEqual(attrs);
    await service.track('event', SUBJECT, attrs, tags);
    expect(client.getVariation).toHaveBeenCalledWith('experiment', SUBJECT, attrs);
    expect(client.isFeatureEnabled).toHaveBeenCalledWith('feature', SUBJECT, attrs);
    expect(client.getFeatureVariable).toHaveBeenCalledWith('feature', 'variable', SUBJECT, attrs);
    expect(client.getAllFeatureVariables).toHaveBeenCalledWith('feature', SUBJECT, attrs);
    expect(client.track).toHaveBeenCalledWith('event', SUBJECT, attrs, tags);
    expect(await service.decide('flag', SUBJECT, attrs)).toEqual({ flagKey: 'flag', enabled: true, variationKey: SUBJECT, ruleKey: SUBJECT, variables: attrs });
    await service.decide('flag', SUBJECT, attrs, true);
    expect(decision.mock.calls).toEqual([['flag', [optimizely.OptimizelyDecideOption.DISABLE_DECISION_EVENT]], ['flag', []]]);
    expect(options).toHaveLength(1);
    expect(logs).toEqual([['Using cached Optimizely datafile'], ['Optimizely client initialized successfully (lite/edge build)']]);

    const send = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', send);
    const body = { userId: SUBJECT, private: SUBJECT };
    const callback = await unitAuthority(env, 'coach', () => new Promise(resolve => options[0].eventDispatcher.dispatchEvent({ url: 'https://synthetic.invalid/event', params: body }, resolve)));
    expect(callback).toEqual({ statusCode: 202 });
    expect(send).toHaveBeenCalledWith('https://synthetic.invalid/event', { method: 'POST', redirect: 'error', signal: expect.any(AbortSignal), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    send.mockRejectedValueOnce(new Error(ERROR));
    expect(await unitAuthority(env, 'coach', () => new Promise(resolve => options[0].eventDispatcher.dispatchEvent({ url: 'https://synthetic.invalid/event', params: body }, resolve)))).toEqual({ statusCode: 0 });

    send.mockResolvedValueOnce(Response.json({ revision: 'fresh', featureFlags: [] }));
    const fresh = await service.createFreshClient();
    expect(fresh).toMatchObject({ client, revision: 'fresh', datafile: { revision: 'fresh' } });
    expect(send.mock.calls[2]![1]).toEqual({ redirect: 'error', headers: { 'Cache-Control': 'no-cache' }, cf: { cacheTtl: 0, cacheEverything: false } });
    const freshCallback = vi.fn();
    options[1].eventDispatcher.dispatchEvent({ url: 'https://synthetic.invalid/event', params: body }, freshCallback);
    options[1].errorHandler.handleError(new Error(ERROR));
    expect(send).toHaveBeenCalledTimes(3); expect(freshCallback).not.toHaveBeenCalled();
  });

  it('keeps initialize threshold3/suppression and fresh threshold4/no suppression without coercion', async () => {
    const { service, options } = sdkFixture();
    await service.initialize();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ revision: 'fresh' })));
    await service.createFreshClient();
    logs.length = 0;
    const coerce = vi.fn(() => { throw new Error(ERROR); });
    const hostile = { toString: coerce, valueOf: coerce, toJSON: coerce };
    options[0].logger.log(2, SUBJECT);
    options[0].logger.log(3, SUBJECT);
    options[0].logger.log(4, SUBJECT + ' is not in datafile');
    options[0].logger.log(3, hostile);
    options[0].errorHandler.handleError(hostile);
    options[1].logger.log(3, SUBJECT);
    options[1].logger.log(4, SUBJECT + ' is not in datafile');
    options[1].logger.log(4, hostile);
    expect(coerce).not.toHaveBeenCalled();
    expect(logs).toEqual([['[optimizely] SDK error'], ['[optimizely] SDK error'], ['Optimizely error'],
      ['[optimizely] SDK error'], ['[optimizely] SDK error']]);
  });

  it('retains method fallbacks and initialization/cache failure behavior with constant errors', async () => {
    const { service, client, decision, cache, env } = sdkFixture();
    await service.initialize(); logs.length = 0;
    const fail = () => { throw new Error(ERROR); };
    for (const method of [client.getVariation, client.isFeatureEnabled, client.getFeatureVariable, client.getAllFeatureVariables, client.track, decision]) method.mockImplementation(fail);
    expect(await service.getVariation(SUBJECT, SUBJECT)).toBeNull();
    expect(await service.isFeatureEnabled(SUBJECT, SUBJECT)).toBe(false);
    expect(await service.getFeatureVariable(SUBJECT, SUBJECT, SUBJECT)).toBeNull();
    expect(await service.getAllFeatureVariables(SUBJECT, SUBJECT)).toEqual({});
    await service.track(SUBJECT, SUBJECT);
    expect(await service.decide(SUBJECT, SUBJECT)).toBeNull();
    cache.delete.mockRejectedValueOnce(new Error(ERROR));
    expect(await service.refreshDatafile()).toBe(false);
    cache.get.mockRejectedValueOnce(new Error(ERROR));
    const fallback = new OptimizelyService(env);
    expect(await fallback.getVariation(SUBJECT, SUBJECT)).toBe('control');
    expect(logs).toEqual([['Error getting variation'], ['Error checking feature flag'], ['Error getting feature variable'],
      ['Error getting all feature variables'], ['Error tracking event'], ['Error deciding flag'], ['Error refreshing datafile'],
      ['Error fetching datafile'], ['Failed to initialize Optimizely, falling back to mock client']]);
  });
});

describe('EventDispatcher log boundaries', () => {
  it('preserves partial dispatch results and full payloads without queue writes', async () => {
    const queue: any[] = [];
    const send = vi.fn(async (url: string, _init: RequestInit) => new Response('', url.endsWith('/bad') ? { status: 503, statusText: ERROR } : { status: 200 }));
    vi.stubGlobal('fetch', send);
    const env = { WEBHOOK_ENDPOINTS: JSON.stringify([
      { name: 'ok', type: 'custom', url: 'https://synthetic.invalid/ok', enabled: true },
      { name: SUBJECT, type: 'custom', url: 'https://synthetic.invalid/bad', enabled: true, retryConfig: { maxRetries: 1, backoffMs: 1 } },
    ]), EVENT_QUEUE: { async send(body: unknown) { queue.push(body); } } } as unknown as Env;
    const dispatcher = new EventDispatcher(env);
    const event = eventFixture();
    const out = await unitAuthority(env, 'coach', () => dispatcher.dispatch(event));
    expect(out).toEqual([{ success: true, destination: 'ok', responseTime: expect.any(Number) },
      { success: false, destination: SUBJECT, error: 'HTTP 503: ' + ERROR, responseTime: expect.any(Number) }]);
    expect(send).toHaveBeenCalledTimes(2);
    for (const [, init] of send.mock.calls) expect(JSON.parse(init.body as string)).toEqual(event);
    expect(queue).toEqual([]);
    expect(logs).toEqual([['Failed to dispatch event']]);
  });

  it('keeps caught cache/config errors and destination updates without queue access or detailed logging', async () => {
    const send = vi.fn(async () => { throw new Error(ERROR); });
    const put = vi.fn(async () => { throw new Error(ERROR); });
    const env = { WEBHOOK_ENDPOINTS: '{' + SUBJECT, EVENT_QUEUE: { send }, CACHE: { put } } as unknown as Env;
    const dispatcher = new EventDispatcher(env);
    expect(await dispatcher.dispatch(eventFixture())).toEqual([]);
    await dispatcher.addDestination({ name: SUBJECT, type: 'custom', url: 'https://synthetic.invalid', enabled: true, retryConfig: { maxRetries: 1, backoffMs: 1 } });
    expect(dispatcher.getDestinations().some(v => v.name === SUBJECT)).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(ERROR); }));
    const out = await unitAuthority(env, 'coach', () => dispatcher.dispatch(eventFixture()), dispatcher.getDestinations());
    expect(out[0]).toMatchObject({ success: false, destination: SUBJECT, error: ERROR });
    expect(send).not.toHaveBeenCalled(); expect(put).toHaveBeenCalledOnce();
    expect(logs).toEqual([['Failed to load destinations'], ['Failed to save destinations'], ['Failed to dispatch event']]);
  });
});

describe('scene-generation log boundaries', () => {
  const productId = getCatalog()[0]!.id;
  const job = { productId, sceneId: SUBJECT, sceneContext: SUBJECT, type: 'search' as const };
  function fixture() {
    const put = vi.fn(async (_key: string, _bytes: Uint8Array, _options: unknown) => undefined);
    const head = vi.fn(async (): Promise<unknown> => null);
    const assets = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } }));
    return { put, head, assets, env: { GEMINI_API_KEY: 'synthetic-not-a-credential', STORAGE: { put, head }, ASSETS: { fetch: assets } } as unknown as Env };
  }
  it('keeps generated bytes/metadata and cached short-circuit without logging request content', async () => {
    const f = fixture();
    const fetch = vi.fn(async (_url: unknown, _init: RequestInit) => Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: 'AQID' } }] } }] }));
    vi.stubGlobal('fetch', fetch);
    const out = await generateSceneToR2(f.env, job);
    expect(out).toMatchObject({ ok: true, cached: false, url: sceneUrl(productId, SUBJECT.toLowerCase().replaceAll('_', '-')) });
    expect(fetch).toHaveBeenCalledOnce(); expect(f.assets).toHaveBeenCalledOnce(); expect(f.put).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![1].body).toContain(SUBJECT);
    const [key, bytes, options] = f.put.mock.calls[0]!;
    expect(key).toBe('scene/live/' + productId.toLowerCase() + '__' + SUBJECT + '.jpg');
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(options).toEqual({ httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { productId, sceneId: SUBJECT, type: 'search', model: 'gemini-3.1-flash-image' } });
    f.head.mockResolvedValueOnce({ size: 3 });
    expect(await generateSceneToR2(f.env, job)).toMatchObject({ ok: true, cached: true, url: out.url });
    expect(fetch).toHaveBeenCalledOnce(); expect(f.put).toHaveBeenCalledOnce(); expect(logs).toEqual([]);
  });
  it('leaves non-OK bodies unread, retains public errors and avoids effects on missing model configuration', async () => {
    const f = fixture(), text = vi.fn(async () => SUBJECT);
    const fetch = vi.fn(async () => ({ ok: false, status: 503, text }));
    vi.stubGlobal('fetch', fetch);
    expect(await generateSceneToR2(f.env, job)).toEqual({ ok: false, error: 'image model 503' });
    expect(text).not.toHaveBeenCalled(); expect(f.put).not.toHaveBeenCalled();
    fetch.mockRejectedValueOnce(new Error(ERROR));
    expect(await generateSceneToR2(f.env, job)).toEqual({ ok: false, error: ERROR });
    expect(logs).toEqual([['sceneGen HTTP', 503], ['generateSceneToR2 error']]);
    expect(await generateSceneToR2({ ...f.env, GEMINI_API_KEY: '' }, job)).toEqual({ ok: false, error: 'image model not configured' });
    expect(fetch).toHaveBeenCalledTimes(2); expect(f.assets).toHaveBeenCalledTimes(2);
  });
});

async function socketFixture() {
  const pending: Promise<unknown>[] = [];
  const put = vi.fn(async (_key: string, _value: unknown) => undefined);
  const NativeResponse = Response;
  const env = { DEPLOYMENT_PROFILE: 'demo', JWT_SECRET: 'w0705-synthetic-socket-key-material', JWT_ISSUER: 'unit', JWT_AUDIENCE: 'unit',
    PERSONALIZATION_WEBSOCKET: { idFromName: (name: string) => name } } as unknown as Env;
  const grant = await issueSessionCapability(env, { tenant: 'coach', subject: SUBJECT, sessionId: 's-unit', kind: 'anonymous' });
  const socket = new PersonalizationWebSocket({ id: SUBJECT, blockConcurrencyWhile(fn: () => Promise<unknown>) { pending.push(fn()); },
    storage: { async get() { return null; }, put } } as never, env) as any;
  env.SHOPPER_REFLEX = { idFromName: (name: string) => name, get: () => ({ fetch: async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.type === 'heartbeat') socket.sendToConnection(body.connectionId, { type: 'heartbeat_response' });
    return new NativeResponse('{}');
  } }) } as never;
  vi.stubGlobal('WebSocket', { READY_STATE_OPEN: 1 });
  return { socket, put, grant, ready: Promise.all(pending) };
}

describe('WebSocket direct callbacks and storage (not native transport)', () => {
  it('keeps registered heartbeat/error callbacks, no-op subscriptions and close persistence without IDs', async () => {
    const { socket, put, ready, grant } = await socketFixture(); await ready;
    const handlers: Record<string, (event: any) => void> = {};
    const send = vi.fn((_value: string) => undefined), accept = vi.fn();
    const server = { readyState: 1, send, accept, addEventListener(type: string, callback: (event: any) => void) { handlers[type] = callback; } };
    vi.stubGlobal('WebSocketPair', class { 0 = {}; 1 = server; });
    // Node disallows status101. This response shim exposes only the constructed
    // status; no native upgrade or live socket success is inferred from it.
    vi.stubGlobal('Response', class { status: number; constructor(_body: unknown, init: { status: number }) { this.status = init.status; } });
    const response = await socket.fetch(new Request('https://synthetic.invalid/owner/upgrade?tenant=coach', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'shopper-session-v1, ' + grant.capability } }));
    expect(response.status).toBe(101); expect(accept).toHaveBeenCalledOnce();
    const welcome = JSON.parse(send.mock.calls[0]![0]);
    expect(welcome).toMatchObject({ type: 'connected', userId: SUBJECT, connectionId: expect.any(String) });
    for (const type of ['heartbeat', 'subscribe', 'unsubscribe', SUBJECT]) handlers.message!({ data: JSON.stringify({ type }) });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(JSON.parse(send.mock.calls[1]![0]).type).toBe('heartbeat_response');
    expect(send).toHaveBeenCalledTimes(2); expect(socket.connections.size).toBe(1); expect(put).toHaveBeenCalledOnce();
    handlers.error!({ message: ERROR });
    await Promise.resolve(); await Promise.resolve();
    expect(socket.connections.size).toBe(0); expect(socket.userConnections.size).toBe(0);
    expect(put).toHaveBeenCalledTimes(2); expect(put.mock.calls[1]).toEqual(['connections', []]);
    expect(logs).toEqual([['Error handling WebSocket message'], ['WebSocket error']]);
  });

  it('preserves targeted/global sends, handled send errors and cleanup/storage outcomes', async () => {
    const { socket, put, ready, grant } = await socketFixture(); await ready;
    const send = vi.fn((_body: string) => undefined);
    socket.connections.set(SUBJECT, { readyState: 1, send }); socket.userConnections.set(SUBJECT, new Set([SUBJECT]));
    const { capability: _capability, ...principal } = grant; socket.principals.set(SUBJECT, principal);
    const update = { type: 'segment_update', userId: SUBJECT, data: { private: SUBJECT } };
    await socket.broadcastUpdate(update, Date.now() + 60000);
    expect(JSON.parse(send.mock.calls[0]![0])).toMatchObject(update);
    await socket.broadcastToAll({ type: 'segment_update', data: { private: SUBJECT } });
    expect(JSON.parse(send.mock.calls[1]![0])).toMatchObject({ scope: 'global', data: { private: SUBJECT } });
    send.mockImplementation(() => { throw new Error(ERROR); });
    await socket.handleWebSocketMessage(SUBJECT, SUBJECT, { data: JSON.stringify({ type: 'heartbeat' }) });
    await socket.broadcastUpdate(update, Date.now() + 60000);
    await socket.broadcastToAll({ type: 'segment_update', data: { private: SUBJECT } });
    put.mockRejectedValueOnce(new Error(ERROR));
    await socket.saveConnectionState();
    socket.connections.get(SUBJECT).readyState = 3;
    await socket.cleanup();
    expect(socket.connections.size).toBe(0); expect(socket.userConnections.size).toBe(0);
    expect(put).toHaveBeenCalledTimes(4);
    expect(logs).toEqual([['Error handling WebSocket message'], ['Error sending to connection'],
      ['Error broadcasting to connection'], ['Error saving connection state'], ['Cleaned up 1 dead connections']]);
  });
});

function subjectStore() {
  const values = new Map<string, string>();
  const get = vi.fn(async (key: string, format?: string) => {
    const value = values.get(key);
    return value === undefined ? null : format === 'json' ? JSON.parse(value) : format === 'stream' ? new Response(value).body : value;
  });
  const put = vi.fn(async (key: string, value: string) => { values.set(key, value); });
  const remove = vi.fn(async (key: string) => { values.delete(key); });
  const list = vi.fn(async ({ prefix = '' }: { prefix?: string } = {}) => ({
    keys: [...values.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true,
  }));
  return { values, get, put, delete: remove, list };
}

// W07.03: grouped actual-service/router controls; reuse the same intercepted
// log/fetch fixture. Domain payloads and public error details intentionally remain.
describe('CDP/ODP/session/realtime log boundaries', () => {
  const tenant = 'w0703-brand';
  const identity = { visitorId: SUBJECT, sessionId: 'synthetic-session' };
  const action: ActionEvent = { type: 'page_view', userId: SUBJECT,
    data: { path: '/' + SUBJECT }, timestamp: 1, source: 'synthetic' };
  const odpConfig = { ODP_API_HOST: 'https://synthetic.invalid', ODP_PUBLIC_KEY: 'synthetic' };

  it.each([false, true])('keeps HTTP status receipts and never reads non-OK bodies (rejecting text=%s)', async (rejectingText) => {
    const text = vi.fn(async () => { if (rejectingText) throw new Error(ERROR); return SUBJECT; });
    const fetch = vi.fn(async (_url: unknown, _init: RequestInit) => { const response = new Response(SUBJECT, { status: 503 }); response.text = text; return response; });
    vi.stubGlobal('fetch', fetch);
    const relay = vi.fn(async (_url: unknown, _init: RequestInit) => new Response('{}'));
    const idFromName = vi.fn((name: string) => name);
    const env = { ...odpConfig, PERSONALIZATION_WEBSOCKET: { idFromName, get: () => ({ fetch: relay }) } } as unknown as Env;
    const callback = vi.fn(), vuid = await vuidFor(identity);
    await unitAuthority(env, 'coach', async () => {
    await forwardEventToOdp(env, 'coach', action, identity, 'callback', callback);
    await forwardEventToOdp(env, 'coach', action, identity, 'relay');
    await upsertOdpProfile(env, 'coach', identity, { dims: { line: { Tabby: 0.7 } } }, 'late');
    expect(text).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(3);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith({ receiptId: 'callback', status: 503, source: 'odp', ts: expect.any(Number) });
    expect(relay).toHaveBeenCalledOnce(); expect(idFromName).toHaveBeenCalledOnce();
    expect(idFromName).toHaveBeenCalledWith(SUBJECT);
    expect(JSON.parse(relay.mock.calls[0]![1].body as string)).toEqual({
      type: 'odp_receipt', userId: SUBJECT, data: { receiptId: 'relay', status: 503, source: 'odp', ts: expect.any(Number) },
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([odpConfig.ODP_API_HOST + '/v3/events', odpConfig.ODP_API_HOST + '/v3/events', odpConfig.ODP_API_HOST + '/v3/profiles']);
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ type: 'pageview', data: { page: '/' + SUBJECT }, identifiers: { vuid } });
    expect(JSON.parse(fetch.mock.calls[2]![1].body as string)).toEqual([{ attributes: {
      vuid, line_affinity_tabby: 0.7, silhouette_affinity_tote: 0, occasion_affinity_evening: 0, dominant_line: 'Tabby', journey_stage: 'late',
    } }]);
    expect(logs).toEqual([['[odp] event forward HTTP', 503], ['[odp] event forward HTTP', 503], ['[odp] profile upsert HTTP', 503]]);
    const accepted = new Response('{}', { status: 202 }); accepted.text = text;
    fetch.mockResolvedValueOnce(accepted);
    await forwardEventToOdp(env, 'coach', action, identity, 'success', callback);
    expect(callback.mock.calls[1]![0]).toMatchObject({ receiptId: 'success', status: 202 });
    await forwardEventToOdp({ ...env, ODP_API_HOST: '' }, 'coach', action, identity, 'disabled', callback);
    expect(fetch).toHaveBeenCalledTimes(4); expect(callback).toHaveBeenCalledTimes(2);
    expect(text).not.toHaveBeenCalled();
    });
  });

  it('keeps GraphQL business parsing and failure-null behavior without serializing errors', async () => {
    const coerce = vi.fn(() => { throw new Error(ERROR); });
    const json = vi.fn(async (): Promise<unknown> => ({ errors: [{ message: SUBJECT }] }));
    const fetch = vi.fn(async (_url: unknown, _init: RequestInit) => Response.json(await json()));
    vi.stubGlobal('fetch', fetch);
    const env = odpConfig as unknown as Env;
    await unitAuthority(env, 'coach', async () => {
    expect(await fetchOdpAudiences(env, 'coach', identity, [{ type: 'pageview', private: SUBJECT }])).toBeNull();
    expect(coerce).not.toHaveBeenCalled(); expect(json).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string).query).toContain(SUBJECT);
    json.mockResolvedValueOnce({ data: { customer: { audiences: { edges: [
      { node: { name: SUBJECT, state: 'qualified' } }, { node: { name: 'excluded', state: 'not_qualified' } },
    ] } } } });
    expect(await fetchOdpAudiences(env, 'coach', identity)).toEqual([SUBJECT]);
    json.mockRejectedValueOnce(new Error(ERROR));
    expect(await fetchOdpAudiences(env, 'coach', identity)).toBeNull();
    fetch.mockRejectedValue(new Error(ERROR));
    expect(await fetchOdpAudiences(env, 'coach', identity)).toBeNull();
    await forwardEventToOdp(env, 'coach', action, identity);
    await upsertOdpProfile(env, 'coach', identity, {});
    expect(logs).toEqual([['[odp] seed graphql errors'], ['[odp] seed failed'], ['[odp] seed failed'],
      ['[odp] event forward failed'], ['[odp] profile upsert failed']]);
    });
  });

  it('preserves CDP profile/queue payloads and partial forwarding with fixed errors', async () => {
    const cache = subjectStore(), queued: unknown[] = [];
    const fetch = vi.fn(async (url: string, _init: RequestInit) => {
      if (url.endsWith('/bad')) throw new Error(ERROR); return Response.json({ ok: true });
    });
    vi.stubGlobal('fetch', fetch);
    const env = { CACHE: cache, CDP_ENDPOINTS: JSON.stringify(['ok', 'bad'].map(id => ({
      id: id + SUBJECT, name: id + SUBJECT, enabled: true, config: { url: 'https://synthetic.invalid/' + id },
    }))), EVENT_QUEUE: { async send(body: unknown) { queued.push(body); } } } as unknown as Env;
    const service = new CDPService(env, tenant);
    await service.identify({ userId: SUBJECT, traits: { private: SUBJECT } });
    await service.track({ userId: SUBJECT, event: 'purchase', properties: { private: SUBJECT } });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string))).toEqual([
      { action: 'identify', userId: SUBJECT, traits: { private: SUBJECT }, timestamp: expect.any(Number) },
      { action: 'identify', userId: SUBJECT, traits: { private: SUBJECT }, timestamp: expect.any(Number) },
      { action: 'track', userId: SUBJECT, event: 'purchase', properties: { private: SUBJECT }, timestamp: expect.any(Number) },
      { action: 'track', userId: SUBJECT, event: 'purchase', properties: { private: SUBJECT }, timestamp: expect.any(Number) },
    ]);
    expect(queued).toEqual([{ type: 'track', data: { userId: SUBJECT, event: 'purchase', properties: { private: SUBJECT }, timestamp: expect.any(Number) }, timestamp: expect.any(Number) }]);
    expect(await service.getProfile({ userId: SUBJECT })).toMatchObject({ userId: SUBJECT, traits: { private: SUBJECT } });
    expect(cache.put.mock.calls.every(([key]) => key.startsWith('t:' + tenant + ':'))).toBe(true);
    cache.get.mockRejectedValue(new Error(ERROR));
    expect(await service.getProfile({ userId: SUBJECT })).toBeNull(); expect(await service.getSegments(SUBJECT)).toEqual([]);
    await expect(service.identify({ userId: SUBJECT, traits: {} })).rejects.toThrow(ERROR);
    expect(logs).toEqual([['Error forwarding to destination'], ['Failed to forward to destination'],
      ['Error forwarding to destination'], ['Failed to forward to destination'], ['Error getting profile'], ['Error getting segments'], ['Error in identify']]);
  });

  it('retains session data, deferred storage and caught fallback/rethrow distinctions', async () => {
    const store = subjectStore(), env = { SESSIONS: store } as unknown as Env, manager = new SessionManager(env, { tenant });
    await expect(unitAuthority(env, tenant, async () => {
    const pending: Promise<unknown>[] = [];
    const first = await manager.createOrUpdateSession('session', SUBJECT, { attributes: { private: SUBJECT } }, undefined, p => pending.push(p));
    expect(pending).toHaveLength(1); await Promise.all(pending);
    expect(await manager.getSession('session')).toEqual(first);
    expect(first).toMatchObject({ userId: SUBJECT, attributes: { private: SUBJECT }, metadata: { sessionCount: 1, visitCount: 1 } });
    expect(store.put).toHaveBeenCalledTimes(2); expect(store.put.mock.calls.every(([key]) => key.startsWith('t:' + tenant + ':'))).toBe(true);
    store.get.mockRejectedValue(new Error(ERROR)); store.put.mockRejectedValue(new Error(ERROR));
    expect(await manager.getSession('session')).toBeNull();
    await expect(manager.createOrUpdateSession('session', SUBJECT, {})).rejects.toThrow(ERROR);
    expect(await manager.resolveSessionIdByUserId(SUBJECT)).toBeNull();
    expect(await manager.cleanupExpiredSessions()).toBe(0);
    expect(logs).toEqual([['Error retrieving session'], ['Error retrieving session'], ['Error creating/updating session'],
      ['Error resolving session id by user ID'], ['Session cleanup scheduled - KV TTL handles automatic expiration']]);
    })).rejects.toThrow(ERROR); // Owner drain also retains the deliberately failed storage effects.
  });

  it('retains feature overrides and fallback results without dynamic feature/error labels', async () => {
    const cache = subjectStore(), manager = new FeatureVariableManager({ CACHE: cache } as unknown as Env, tenant);
    const service = (manager as any).optimizelyService as OptimizelyService;
    vi.spyOn(service, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(service, 'isFeatureEnabled').mockResolvedValue(true);
    vi.spyOn(service, 'getAllFeatureVariables').mockResolvedValue({ private: 'base' });
    await manager.setUserOverride({ userId: SUBJECT, featureKey: SUBJECT, variableKey: 'private', value: SUBJECT });
    expect((await manager.getFeatureVariables(SUBJECT, {}, [SUBJECT]))[SUBJECT]).toMatchObject({
      featureKey: SUBJECT, enabled: true, source: 'override', variables: { private: SUBJECT },
    });
    await manager.removeUserOverride(SUBJECT, SUBJECT, 'private');
    vi.mocked(service.initialize).mockRejectedValue(new Error(ERROR));
    expect((await manager.getFeatureVariables(SUBJECT, {}, [SUBJECT]))[SUBJECT]).toMatchObject({
      featureKey: SUBJECT, enabled: false, source: 'fallback', variables: {},
    });
    cache.list.mockRejectedValue(new Error(ERROR));
    expect(await manager.getUserOverrides(SUBJECT)).toEqual([]);
    expect(await manager.getFeatureVariableAnalytics()).toMatchObject({ totalFeatures: 0, activeOverrides: 0, cacheHitRate: 0 });
    expect(logs).toEqual([['Error getting feature variables'], ['Error fetching user overrides'], ['Error getting feature variable analytics']]);
  });

  it('retains segment qualification fallback and persisted assignment despite relay failure', async () => {
    const cache = subjectStore(), sessions = subjectStore(), fetch = vi.fn(async (_request: Request) => { throw new Error(ERROR); });
    const idFromName = vi.fn((name: string) => name);
    const qualify = vi.fn(async () => ['segment-control']);
    const env = { CACHE: cache, SESSIONS: sessions,
      PERSONALIZATION_WEBSOCKET: { idFromName, get: () => ({ fetch }) } } as unknown as Env;
    const engine = new RealtimeSegmentEngine(env,
    { segments: { fetchQualifiedSegments: qualify } } as never, { tenant });
    await unitAuthority(env, tenant, async () => {
    const initial = await engine.getUserProfile(SUBJECT);
    initial.retention = retentionBirth(env, tenant, 'profile', Date.now()); initial.externalRetention = externalRetentionBirths(env, tenant, Date.now());
    cache.values.set('t:' + tenant + ':profile:' + SUBJECT, JSON.stringify(initial));
    await engine.assignSegment(SUBJECT, 'segment-control', SUBJECT);
    expect(JSON.parse(cache.values.get('t:' + tenant + ':profile:' + SUBJECT)!)).toMatchObject({ userId: SUBJECT, segments: ['segment-control'] });
    expect(idFromName).toHaveBeenCalledOnce(); expect(idFromName).toHaveBeenCalledWith('t:' + tenant + ':' + SUBJECT);
    expect(await fetch.mock.calls[0]![0].json()).toMatchObject({ type: 'segment_update', userId: SUBJECT, data: { segments: ['segment-control'], source: SUBJECT } });
    cache.get.mockRejectedValue(new Error(ERROR));
    expect(await engine.getUserSegments(SUBJECT)).toEqual(['segment-control']);
    expect(qualify).toHaveBeenCalledOnce();
    expect(logs).toEqual([['Error broadcasting update']]); // Non-default tenants do not seed demo audiences.
    });
  });

  it('reaches authenticated malformed handlers and preserves successful relay despite nonfatal capture error', async () => {
    const config = { JWT_SECRET: 'w0703-synthetic-signing-material-32bytes', JWT_ISSUER: 'w0703', JWT_AUDIENCE: 'w0703' };
    const token = await new SignJWT({ sub: SUBJECT, roles: ['admin'] }).setProtectedHeader({ alg: 'HS256' })
      .setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime('5m').sign(new TextEncoder().encode(config.JWT_SECRET));
    const app = new Hono<{ Bindings: Env; Variables: TenantVariables }>();
    app.use('*', async (c, next) => { c.set('tenant', tenant); await next(); });
    app.route('/cdp', cdpRoutes); app.route('/realtime', realtimeRoutes);
    const env = { ...config, CACHE: subjectStore(), SESSIONS: subjectStore() } as unknown as Env;
    for (const path of ['/cdp/identify', '/realtime/action']) {
      const response = await app.request('https://synthetic.invalid' + path,
        { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: SUBJECT }, env);
      expect(response.status).toBe(path.includes('cdp') ? 500 : 401);
      expect(await response.json()).toMatchObject(path.includes('cdp')
        ? { error: 'Failed to identify user' } : { error: 'Shopper session unavailable' });
    }
    const fetch = vi.fn(async (_request: Request) => Response.json({ success: true, sessionId: 's-unit', consent: await currentOwnerConsent() }));
    const prepare = vi.fn(() => { throw new Error(ERROR); });
    const ownedEnv = { ...env, AUTH_MODE: 'open', ENVIRONMENT: 'development', REFLEX_HOST: 'do', DEMO_EVENT_CAPTURE: 'true', DB: { prepare },
      SHOPPER_REFLEX: { idFromName: (name: string) => name, get: () => ({ fetch }) } } as unknown as Env;
    const response = await unitAuthority(ownedEnv, 'coach', async (owner, principal, capability) => {
      const send = (body: unknown) => dispatchOwnedRequest(owner, ownedEnv, new Request('https://synthetic.invalid/realtime/action', { method: 'POST',
        headers: { 'X-Shopper-Session': capability, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), principal, fetch);
      const malformed = await send({ userId: SUBJECT });
      expect(malformed.status).toBe(400); expect(fetch).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
      return send(action);
    });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true, sessionId: 's-unit', consent: { tracking: true, personalization: true, instruction: { revision: 'unit-choice' } } });
    expect(prepare).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
    expect(await fetch.mock.calls[0]![0].json()).toMatchObject(action);
    expect(logs).toEqual([['CDP identify error'], ['Error processing action event'], ['captureDemoEvent failed (non-fatal)']]);
  });
});

describe('W07.04 remaining runtime logs and monitor telemetry', () => {
  it('preserves config failure retry, invalid-document fallback and successful versioned writes', async () => {
    invalidateCache();
    const store = subjectStore(), fallback = { allowed: true, private: 'fallback' };
    const kind: DocumentKind<{ allowed: boolean; private?: string }> = {
      name: 'telemetry_fixture', validate(value: any) {
        return value?.allowed ? { ok: true, value } : { ok: false, errors: [SUBJECT] };
      },
    };
    store.get.mockRejectedValueOnce(new Error(ERROR)).mockRejectedValueOnce(new Error(ERROR));
    const env = { CACHE: store } as unknown as Env;
    expect(await read(env, kind, SUBJECT, fallback)).toBe(fallback);
    expect(await read(env, kind, SUBJECT, fallback)).toBe(fallback);
    expect(store.get).toHaveBeenCalledTimes(2); // Failed reads were not cached.
    store.values.set('telemetry_fixture:config:' + SUBJECT + ':current', JSON.stringify({ value: {} }));
    expect(await read(env, kind, SUBJECT, fallback)).toBe(fallback);
    await expect(write(env, kind, SUBJECT, { allowed: true }, { actor: 'synthetic' })).rejects.toThrow('Stored configuration is unavailable');
    expect(store.put).not.toHaveBeenCalled();
    store.values.delete('telemetry_fixture:config:' + SUBJECT + ':current');
    expect((await write(env, kind, SUBJECT, { allowed: true, private: SUBJECT }, { actor: 'synthetic' })).ok).toBe(true);
    expect(store.put).toHaveBeenCalledTimes(3);
    expect(await read(env, kind, SUBJECT, fallback)).toEqual({ allowed: true, private: SUBJECT });
    expect(logs).toEqual([['[config] read failed, serving fallback'], ['[config] read failed, serving fallback'],
      ['[config] stored document is invalid and was ignored']]);
    invalidateCache();
  });

  it('preserves live-provider memoization, no-event decisions and fallbacks with numeric-only flag counts', async () => {
    const decide = vi.fn(() => ({ flagKey: SUBJECT, enabled: true, variationKey: SUBJECT, variables: { private: SUBJECT }, ruleKey: 'rule' }));
    const createUserContext = vi.fn(() => ({ decide }));
    const fresh = vi.fn(async () => ({ revision: SUBJECT, datafile: { featureFlags: [{ key: SUBJECT }] }, client: { createUserContext } }));
    const provider = new LiveDecisionProvider({ createFreshClient: fresh, externalIdentity: async (subject: string) => subject } as unknown as OptimizelyService);
    for (let i = 0; i < 2; i++) expect(await provider.decide(SUBJECT, SUBJECT, ['segment'], { private: SUBJECT, object: {} })).toMatchObject({
      enabled: true, variables: { private: SUBJECT }, variationKey: SUBJECT, reason: 'experiment',
    });
    expect(fresh).toHaveBeenCalledOnce(); expect(decide).toHaveBeenCalledTimes(2);
    expect(createUserContext).toHaveBeenCalledWith(SUBJECT, { private: SUBJECT, qualified_segments: 'segment' });
    expect(decide).toHaveBeenCalledWith(SUBJECT, [optimizely.OptimizelyDecideOption.DISABLE_DECISION_EVENT]);
    decide.mockImplementationOnce(() => { throw new Error(ERROR); });
    expect(await provider.decide(SUBJECT, SUBJECT, [], {})).toMatchObject({ enabled: false, reason: 'fallback' });
    const malformed = new LiveDecisionProvider({ externalIdentity: async (subject: string) => subject, async createFreshClient() { return {
      revision: SUBJECT, datafile: { featureFlags: { length: SUBJECT } }, client: { createUserContext },
    }; } } as unknown as OptimizelyService);
    expect(await malformed.decide(SUBJECT, SUBJECT, [], {})).toMatchObject({ enabled: false, reason: 'fallback' });
    const init = vi.fn(async () => { throw new Error(ERROR); });
    const failed = new LiveDecisionProvider({ createFreshClient: init } as unknown as OptimizelyService);
    await failed.decide(SUBJECT, SUBJECT, [], {}); await failed.decide(SUBJECT, SUBJECT, [], {});
    expect(init).toHaveBeenCalledOnce();
    expect(logs).toEqual([['LiveDecisionProvider: datafile loaded; feature flags', 1],
      ['LiveDecisionProvider.decide failed — using mock fallback'], ['LiveDecisionProvider: datafile loaded; feature flags', 0],
      ['LiveDecisionProvider: datafile/client init failed — using mock fallback']]);
  });

  it('keeps actual limiter writes/cleanup and StateManager unawaited-handler rejection', async () => {
    const put = vi.fn(async (_key: string, _value: unknown) => undefined);
    const list = vi.fn(async () => { throw new Error(ERROR); });
    const limiter = new RateLimiter({ storage: { get: async () => 0, put, list } } as never);
    const response = await limiter.fetch(new Request('https://synthetic.invalid', { method: 'POST', body: JSON.stringify({ limit: 2, window: 60 }) }));
    expect(await response.json()).toMatchObject({ allowed: true, remaining: 1 });
    expect(put).toHaveBeenCalledOnce(); expect(list).toHaveBeenCalledOnce();
    const malformed = await limiter.fetch(new Request('https://synthetic.invalid', { method: 'POST', body: SUBJECT }));
    expect(malformed.status).toBe(500); expect(await malformed.text()).toBe('Internal Server Error');
    const state = new StateManager({ storage: { async get() { throw new Error(ERROR); } } } as never);
    await expect(state.fetch(new Request('https://synthetic.invalid/get?key=' + SUBJECT))).rejects.toThrow(ERROR);
    // A truly synchronous handler throw is caught; do not add an await just to
    // make asynchronous storage failures enter this different existing branch.
    (state as any).handleGet = () => { throw new Error(ERROR); };
    expect((await state.fetch(new Request('https://synthetic.invalid/get?key=' + SUBJECT))).status).toBe(500);
    expect(logs).toEqual([['Cleanup error'], ['RateLimiter error'], ['StateManager error']]);
  });

  it('preserves scene queue-to-inline cache fallback and webhook revision/cache results', async () => {
    const head = vi.fn(async (): Promise<unknown> => null).mockResolvedValueOnce(null).mockResolvedValueOnce({ size: 3 });
    const send = vi.fn(async (_job: unknown) => { throw new Error(ERROR); });
    const scene = await aiSceneRoutes.request('https://synthetic.invalid/', { method: 'POST', body: JSON.stringify({
      productId: 'COA-CH857', sceneId: SUBJECT, sceneContext: SUBJECT,
    }) }, { GEMINI_API_KEY: 'synthetic', STORAGE: { head }, EVENT_QUEUE: { send } } as unknown as Env);
    expect(scene.status).toBe(200); expect(await scene.json()).toEqual({
      ok: true, status: 'ready', url: '/ai/scene/COA-CH857/' + SUBJECT, cached: true,
    });
    expect(head).toHaveBeenCalledTimes(2); expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toMatchObject({ productId: 'COA-CH857', sceneContext: SUBJECT, kind: 'scene' });
    const datafile = { revision: SUBJECT, featureFlags: [{ key: SUBJECT }] }, cache = subjectStore();
    const fetch = vi.fn(async () => Response.json(datafile));
    vi.stubGlobal('fetch', fetch);
    const response = await webhookRoutes.request('https://synthetic.invalid/optimizely-datafile', { method: 'POST', body: '{}' },
      { DEPLOYMENT_PROFILE: 'demo', OPTIMIZELY_SDK_KEY: 'synthetic', CACHE: cache } as unknown as Env);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true, revision: SUBJECT, flags: 1 });
    expect(fetch).toHaveBeenCalledOnce(); expect(cache.put).toHaveBeenCalledOnce();
    expect(JSON.parse(cache.values.get('optimizely-datafile-synthetic')!)).toEqual(datafile);
    expect(logs).toEqual([['ai/scene enqueue failed, generating inline'], ['Datafile webhook: cache refreshed; flags', 1]]);
  });

  it('W07.05 sanitizes monitor returned/stored/alert diagnostics while retaining real delivery and cooldown', async () => {
    invalidateCache();
    const cache = subjectStore(), originalGet = cache.get.getMockImplementation()!;
    cache.get.mockImplementation(async (key, format) => {
      if (key === 'monitor-probe') throw new Error(ERROR); return originalGet(key, format);
    });
    const point = vi.fn((_point: unknown) => undefined), requests: any[] = [];
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => { requests.push(JSON.parse(init.body as string)); return new Response('{}'); });
    vi.stubGlobal('fetch', fetch);
    const env = { CACHE: cache, SESSIONS: subjectStore(), STORAGE: { async head() { return null; } },
      DB: { prepare: () => ({ first: async () => ({ one: 1 }) }) }, ENVIRONMENT: 'test', REFLEX_HOST: 'do',
      SHOPPER_REFLEX: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ consent: { tracking: false, personalization: false } }) }) },
      LEARN_STATS: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('{}', { status: 404 }) }) },
      ANALYTICS: { writeDataPoint: point }, ALERT_WEBHOOK_URL: 'https://synthetic.invalid/alert',
    } as unknown as Env;
    const tenant = 'w0704-brand';
    env.TENANTS = JSON.stringify({ provisioned: [tenant] });
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.ALERT_WEBHOOK_URL)))].map(n => n.toString(16).padStart(2, '0')).join('');
    env.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: { [tenant]: { telemetry: { environment: 'test', schema: 'ops-v1',
      analytics: { binding: 'ANALYTICS', dataset: 'synthetic_ops', accessPolicy: 'test-only' }, monitor: { binding: 'CACHE', namespace: 'monitor', accessPolicy: 'test-only' },
      alert: { binding: 'ALERT_WEBHOOK_URL', destination: 'synthetic-alert', urlSha256: hash, accessPolicy: 'test-only' } } } } });
    env.RETENTION = JSON.stringify({ version: 1, tenants: { [tenant]: Object.fromEntries((await configuredOperationalDestinations(env, tenant)).map(d => [d.category,
      { id: 'test-only', revision: 1, durationMs: 60000, basis: 'occurred', renewal: 'new-record-only' }])) } });
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    const result = await runMonitor(env, tenant, 100000);
    expect(result.ok).toBe(false); expect(Object.keys(result.checks)).toEqual(['identity', 'retention', 'kv', 'sessions', 'storage', 'database', 'objects', 'decision', 'personalizedSession', 'personalizedObject', 'producer', 'consumer', 'ledger', 'learning', 'event', 'delivery']);
    expect(result.checks.kv!.detail).toBe('CHECK_FAILED');
    const { retention, ...stored } = JSON.parse(cache.values.get('monitor:' + tenant + ':last')!);
    expect(stored).toEqual(result); expect(retention.expiresAt).toBe(160000);
    expect(point).toHaveBeenCalledOnce();
    expect(point.mock.calls[0]![0]).toEqual({ blobs: ['ops-v1', 'test', tenant, 'monitor', 'problem', 'sent'],
      doubles: [0, result.checks.decision!.ms, result.checks.database!.ms, result.checks.kv!.ms], indexes: [tenant] });
    expect(fetch).toHaveBeenCalledOnce(); expect(requests[0].checks.kv.detail).toBe('CHECK_FAILED');
    expect(JSON.stringify([result, stored, requests, point.mock.calls])).not.toContain(ERROR);
    expect(fetch.mock.calls[0]![1].redirect).toBe('error');
    expect(requests[0].problems).toEqual(result.problems);
    expect(cache.values.get('monitor:' + tenant + ':alerted')).toBe('100000');
    // Buffered AE failure still permits the run, and cooldown still suppresses
    // a second alert without removing the detailed operator result.
    point.mockImplementationOnce(() => { throw new Error(ERROR); });
    vi.spyOn(Date, 'now').mockReturnValue(100001);
    const second = await runMonitor(env, tenant, 100001);
    expect(second.checks.kv!.detail).toBe('CHECK_FAILED'); expect(fetch).toHaveBeenCalledOnce();
    expect(logs).toEqual([['monitor result; ok/decisionMs/problems', 0, result.checks.decision!.ms, result.problems.length],
      ['monitor delivery; status/resultSaved/recoverySaved', 'sent', 1, 1],
      ['monitor result; ok/decisionMs/problems', 0, second.checks.decision!.ms, second.problems.length],
      ['monitor delivery; status/resultSaved/recoverySaved', 'cooling-down', 1, 1]]);
    invalidateCache();
  });

  it('keeps tenant-resolution refusal without logging the thrown object', () => {
    const env = Object.defineProperty({}, 'TENANTS', { get() { throw new Error(ERROR); } }) as Env;
    expect(() => tenantForRequest(env, new Request('https://synthetic.invalid'))).toThrow('Tenant configuration unavailable');
    expect(logs).toEqual([]);
  });
});
