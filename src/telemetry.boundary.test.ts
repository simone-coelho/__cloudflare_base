import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { trackingRoutes } from '@/routes/tracking';
import { pixelRoutes } from '@/routes/pixel';
import { webhookRoutes } from '@/routes/webhook';
import { optimizelyRoutes } from '@/routes/optimizely';
import { healthRoutes } from '@/routes/health';
import { EventDispatcher } from '@/services/EventDispatcher';
import { OptimizelyService } from '@/services/OptimizelyService';
import { PixelDecoder } from '@/services/PixelDecoder';
import { errorHandler } from '@/middleware/error';
import { issueSessionCapability, verifySessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { CONSENT_LIFETIME_MS } from '@/content/consent';
import * as context from '@/utils/context';
import { SignJWT } from 'jose';
import { configuredDestinations } from '@/connectors/config';

// Real mounted routers/decoder/dispatcher; only external fetch and Optimizely
// service seams are intercepted. This does not attest external SDK delivery.
const SUBJECT = 'vis-00000000-0000-4000-8000-000000000005';
const PRIVATE = 'W0701_PRIVATE_ERROR';
const event = (id = '00000000-0000-4000-8000-000000000001') => ({
  eventId: id, timestamp: 1, eventType: 'track', source: 'synthetic', event: 'purchase',
  user: { userId: SUBJECT, anonymousId: SUBJECT, email: 'w0701@example.invalid', traits: { private: SUBJECT } },
});
const pixelId = () => new PixelDecoder().encode({ recipientId: SUBJECT, emailId: 'w0701@example.invalid' });
const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.77',
  'User-Agent': SUBJECT, Referer: 'https://mail.example.invalid/' + SUBJECT,
  Cookie: 'opt_tracking_consent=false; opt_personalization_enabled=false' };
const app = new Hono<{ Bindings: Env }>();
app.route('/track', trackingRoutes).route('/pixel', pixelRoutes).route('/webhook', webhookRoutes)
  .route('/optimizely', optimizelyRoutes).route('/health', healthRoutes);

type Spy<T extends (...args: any[]) => any> = MockInstance<Parameters<T>, ReturnType<T>>;
let queued: unknown[], remote: Mock<[string, RequestInit], Promise<Response>>, errors: Spy<typeof console.error>;
let initialize: Spy<OptimizelyService['initialize']>, track: Spy<OptimizelyService['track']>;
let variation: Spy<OptimizelyService['getVariation']>, features: Spy<OptimizelyService['isFeatureEnabled']>;
let variables: Spy<OptimizelyService['getAllFeatureVariables']>, segments: Spy<OptimizelyService['getSegments']>;
type TelemetryOwner = { data: Map<string, unknown>; object: ShopperReflex; state: DurableObjectState };
const owners = new WeakMap<Env, Map<string, TelemetryOwner>>();
beforeEach(() => {
  queued = [];
  remote = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', remote);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  initialize = vi.spyOn(OptimizelyService.prototype, 'initialize').mockResolvedValue(undefined);
  track = vi.spyOn(OptimizelyService.prototype, 'track').mockResolvedValue(undefined);
  variation = vi.spyOn(OptimizelyService.prototype, 'getVariation').mockResolvedValue('synthetic-variation');
  features = vi.spyOn(OptimizelyService.prototype, 'isFeatureEnabled').mockResolvedValue(true);
  variables = vi.spyOn(OptimizelyService.prototype, 'getAllFeatureVariables').mockResolvedValue({ label: 'synthetic' });
  segments = vi.spyOn(OptimizelyService.prototype, 'getSegments').mockResolvedValue(['synthetic-segment']);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function env(binding: 'absent' | 'throwing' = 'throwing') {
  let analyticsReads = 0;
  const value = { AUTH_MODE: 'open', ENVIRONMENT: 'test',
    JWT_SECRET: 'w0505-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    SESSIONS: { async get() { return null; }, async put() {} },
    WEBHOOK_ENDPOINTS: JSON.stringify([{ name: 'synthetic', type: 'custom', url: 'https://destination.example.invalid', enabled: true }]),
    EVENT_QUEUE: { async send(body: unknown) { queued.push(body); } },
  };
  if (binding === 'throwing') Object.defineProperty(value, 'ANALYTICS', {
    get() { analyticsReads++; throw new Error('AE binding must not be accessed'); },
  });
  const e = value as unknown as Env, objects = new Map<string, TelemetryOwner>();
  e.REFLEX_HOST = 'do'; e.DEPLOYMENT_PROFILE = 'demo'; owners.set(e, objects);
  e.SHOPPER_REFLEX = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    let item = objects.get(name);
    if (!item) {
      const data = new Map<string, unknown>(); let alarm: number | null = null;
      const state = { id: name, getWebSockets: () => [], waitUntil: (task: Promise<unknown>) => task, storage: {
        get: async (key: string | string[]) => structuredClone(Array.isArray(key) ? new Map(key.map(k => [k, data.get(k)])) : data.get(key)),
        put: async (key: string | Record<string, unknown>, v?: unknown) => { for (const [k, v2] of typeof key === 'string' ? [[key, v]] : Object.entries(key)) data.set(k as string, structuredClone(v2)); },
        delete: async (key: string) => data.delete(key),
        list: async (o?: { prefix?: string; limit?: number }) => structuredClone(new Map([...data].filter(([k]) => k.startsWith(o?.prefix ?? '')).sort(([a], [b]) => a.localeCompare(b)).slice(0, o?.limit))),
        getAlarm: async () => alarm, setAlarm: async (at: number) => { alarm = at; },
        transaction: async (work: (tx: DurableObjectTransaction) => Promise<unknown>) => {
          const candidate=structuredClone(data);let candidateAlarm=alarm;
          const tx={get:async(key:string|string[])=>structuredClone(Array.isArray(key)?new Map(key.map(k=>[k,candidate.get(k)])):candidate.get(key)),
            put:async(key:string|Record<string,unknown>,value?:unknown)=>{for(const[k,v]of typeof key==='string'?[[key,value]]:Object.entries(key))candidate.set(k as string,structuredClone(v));},
            delete:async(keys:string|string[])=>{const list=typeof keys==='string'?[keys]:keys;let deleted=0;for(const key of list)if(candidate.delete(key))deleted++;return deleted;},
            list:async(o?:{prefix?:string;limit?:number})=>structuredClone(new Map([...candidate].filter(([k])=>k.startsWith(o?.prefix??'')).sort(([a],[b])=>a.localeCompare(b)).slice(0,o?.limit))),
            getAlarm:async()=>candidateAlarm,setAlarm:async(at:number)=>{candidateAlarm=at;},deleteAlarm:async()=>{candidateAlarm=null;},
          } as unknown as DurableObjectTransaction;
          const result=await work(tx); // A rejection leaves map and alarm untouched.
          data.clear();for(const[key,value]of candidate)data.set(key,value);alarm=candidateAlarm;return result;
        },
      } } as unknown as DurableObjectState;
      item = { data, state, object: new ShopperReflex(state, e) }; objects.set(name, item);
    }
    return item.object.fetch(new Request(input, init));
  } }) } as unknown as DurableObjectNamespace;
  return { value: e, analyticsReads: () => analyticsReads };
}
async function requestHeaders(path: string, e: Env) {
  const out = new Headers(headers);
  if (e.RETENTION === undefined && (path.startsWith('/track/') || path.startsWith('/optimizely/'))) {
    e.TENANTS = JSON.stringify({ provisioned: ['coach'] });
    const policy = { id: 'explicit-telemetry-fixture', revision: 1, durationMs: 60000, basis: 'admitted', renewal: 'new-record-only' };
    e.RETENTION = JSON.stringify({ version: 1, tenants: { coach: Object.fromEntries((await configuredDestinations(e, 'coach')).map(d => [d.category, policy])) } });
  }
  // Existing track positive/error controls now have real owned authority and
  // consenting input; the actual both-host fixture separately tests refusal.
  if (path === '/track/event' || path === '/track/batch' || path === '/optimizely/track' || path === '/optimizely/decisions') {
    const grant = await issueSessionCapability(e, { tenant: 'coach', subject: SUBJECT, sessionId: 's-telemetry', kind: 'anonymous' });
    const principal = await verifySessionCapability(e, grant.capability, 'coach');
    const owner = e.SHOPPER_REFLEX.get(e.SHOPPER_REFLEX.idFromName(SUBJECT));
    await owner.fetch('https://owner/identity/export', { headers: { 'X-Reflex-Tenant': 'coach', 'X-Reflex-Subject': SUBJECT } });
    const item = owners.get(e)!.get(SUBJECT)!;
    item.data.set('grantAuthority', { version: 1, epoch: principal.authorityEpoch, grants: { [principal.grantId!]: principal } });
    const now = Date.now();
    item.data.set('consent', { version: 1, tenant: 'coach', subject: SUBJECT, revision: 'explicit-telemetry-choice',
      tracking: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS },
      personalization: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS } });
    out.set(SHOPPER_HEADER, grant.capability); out.delete('Cookie');
  }
  return out;
}
async function call(path: string, body: unknown, e: Env) {
  return app.request('https://coach.example.invalid' + path, {
    method: body === undefined ? 'GET' : 'POST', headers: await requestHeaders(path, e),
    body: body === undefined ? undefined : JSON.stringify(body),
  }, e);
}
it('W06.12 pins each actual webhook lifetime and refuses changed or expired event retries after quiet cleanup and owner restart', async () => {
  const at = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(at), f = env();
  f.value.TENANTS = JSON.stringify({ provisioned: ['coach'] });
  const policy = { id: 'synthetic-webhook', revision: 1, durationMs: 60000, basis: 'admitted', renewal: 'new-record-only' };
  const destinations = await configuredDestinations(f.value, 'coach'); expect(destinations).toHaveLength(1);
  f.value.RETENTION = JSON.stringify({ version: 1, tenants: { coach: { [destinations[0]!.category]: policy } } });
  const h = await requestHeaders('/track/event', f.value), body = { ...event(), timestamp: at };
  const send = (value = body) => app.request('https://coach.example.invalid/track/event', { method: 'POST', headers: h, body: JSON.stringify(value) }, f.value);
  expect((await send()).status).toBe(200); expect(remote).toHaveBeenCalledOnce(); expect(remote.mock.calls[0]![1].redirect).toBe('error');
  const owner = owners.get(f.value)!.get(SUBJECT)!, key = [...owner.data.keys()].find(key => key.startsWith('externalAdmission:'))!;
  const first = structuredClone(owner.data.get(key)), grants = structuredClone(owner.data.get('grantAuthority')), consent = structuredClone(owner.data.get('consent'));
  expect(first).toMatchObject({ expired: false, stamps: { [destinations[0]!.category]: { bornAt: at, expiresAt: at + 60000 } } });
  expect(JSON.stringify(first)).not.toContain('w0701@example.invalid'); expect(await owner.state.storage.getAlarm()).toBe(at + 60000);
  clock.mockReturnValue(at + 1000); expect((await send()).status).toBe(200); expect(remote).toHaveBeenCalledTimes(2); expect(owner.data.get(key)).toEqual(first);
  expect((await send({ ...body, event: 'changed-payload' })).ok).toBe(false); expect(remote).toHaveBeenCalledTimes(2); expect(owner.data.get(key)).toEqual(first);
  clock.mockReturnValue(at + 60000); await owner.object.alarm();
  expect(owner.data.get(key)).toEqual({ digest: (first as { digest: string }).digest, expired: true });
  expect(owner.data.get('grantAuthority')).toEqual(grants); expect(owner.data.get('consent')).toEqual(consent);
  owner.object = new ShopperReflex(owner.state, f.value);
  expect((await send()).ok).toBe(false); expect(remote).toHaveBeenCalledTimes(2);
  expect(owner.data.get(key)).toEqual({ digest: (first as { digest: string }).digest, expired: true });
  expect(f.analyticsReads()).toBe(0); expect(queued).toEqual([]);
});

const cases = [
  { label: 'track event', path: '/track/event', body: () => event(), dispatch: true },
  { label: 'track batch', path: '/track/batch', body: () => ({ events: [event()] }), dispatch: true },
  { label: 'pixel', path: () => '/pixel/track/' + encodeURIComponent(pixelId()) + '?subject=' + SUBJECT, body: () => undefined, dispatch: false },
  { label: 'Optimizely webhook', path: '/webhook/optimizely', body: () => ({ source: 'synthetic', event_type: 'purchase', timestamp: 1, data: { user_id: SUBJECT, visitor_uuid: SUBJECT } }), dispatch: true },
  { label: 'Segment webhook', path: '/webhook/segment', body: () => ({ type: 'track', event: 'purchase', userId: SUBJECT, traits: { private: SUBJECT } }), dispatch: true },
  { label: 'custom webhook', path: '/webhook/custom', body: () => ({ event: 'purchase', userId: SUBJECT }), dispatch: true },
  { label: 'Optimizely decisions', path: '/optimizely/decisions', body: () => ({ userId: SUBJECT, userAttributes: { private: SUBJECT }, experiments: ['experiment'], features: ['feature'] }), dispatch: false },
  { label: 'Optimizely track', path: '/optimizely/track', body: () => ({ userId: SUBJECT, eventKey: 'purchase', userAttributes: { private: SUBJECT }, eventTags: { value: 1 } }), dispatch: false },
];

describe.each(['absent', 'throwing'] as const)('eight raw writers with %s AE', binding => {
  for (const c of cases) it(c.label, async () => {
    const e = env(binding), body = c.body();
    const response = await call(typeof c.path === 'function' ? c.path() : c.path, body, e.value);
    const unownedWebhook = c.label.endsWith('webhook');
    expect(response.status).toBe(unownedWebhook ? 502 : 200);
    expect(e.analyticsReads()).toBe(0);
    expect(queued).toEqual([]);
    expect(remote).toHaveBeenCalledTimes(c.dispatch && !unownedWebhook ? 1 : 0);
    if (c.dispatch && !unownedWebhook) {
      expect(remote.mock.calls[0]![1].body).toContain(SUBJECT);
      expect(JSON.parse(remote.mock.calls[0]![1].body as string)).toMatchObject({ eventType: 'track', event: 'purchase' });
    }
    if (c.label === 'pixel') {
      expect(response.headers.get('Content-Type')).toBe('image/gif');
      expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      expect(response.headers.get('Expires')).toBe('0');
      expect((await response.arrayBuffer()).byteLength).toBe(43);
    } else {
      const result = await response.json() as any;
      if (c.label === 'Optimizely decisions') {
        expect(result).toEqual({ userId: SUBJECT, experiments: { experiment: 'synthetic-variation' },
          features: { feature: { enabled: true, variables: { label: 'synthetic' } } }, segments: ['synthetic-segment'] });
        expect(initialize).toHaveBeenCalledOnce();
        for (const seam of [variation, features, variables]) expect(seam).toHaveBeenCalledWith(expect.any(String), SUBJECT, { private: SUBJECT });
        expect(segments).toHaveBeenCalledWith(SUBJECT, { private: SUBJECT });
      } else {
        expect(result.success).toBe(!unownedWebhook);
        if (unownedWebhook) expect(result).toMatchObject({ error: 'Event delivery not confirmed', delivery: { status: 'unconfirmed', attempted: null, acknowledged: null } });
        if (c.label === 'track batch') expect(result).toMatchObject({ processed: 1, results: [{ eventId: event().eventId, status: 'success' }] });
        else if (c.label === 'Optimizely track') {
          expect(result).toMatchObject({ userId: SUBJECT, eventKey: 'purchase', timestamp: expect.any(Number) });
          expect(track).toHaveBeenCalledWith('purchase', SUBJECT, { private: SUBJECT }, { value: 1 });
        } else expect(result.eventId).toEqual(expect.any(String));
      }
    }
    expect(errors.mock.calls).toEqual(unownedWebhook ? [['Event delivery error']] : []);
  });
});

it('W05.07 keeps optional JWT validation distinct from ownership and rechecks expiry after initialize', async () => {
  const e = env();
  const token = (type?: string) => new SignJWT({ sub: 'synthetic-operator', ...(type ? { type } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a').setExpirationTime('5m')
    .sign(new TextEncoder().encode(e.value.JWT_SECRET));
  const valid = await token(), refresh = await token('refresh');
  for (const path of ['/optimizely/track', '/optimizely/decisions']) {
    for (const [authorization, owned, expected] of [[undefined, true, 200], [valid, true, 200], ['invalid', true, 401], [refresh, true, 401], [valid, false, 401]] as const) {
      initialize.mockClear(); track.mockClear(); features.mockClear();
      const h = await requestHeaders(path, e.value);
      if (authorization) h.set('Authorization', `Bearer ${authorization}`);
      if (!owned) h.delete(SHOPPER_HEADER);
      const r = await app.request(path, { method: 'POST', headers: h, body: JSON.stringify({ userId: SUBJECT, eventKey: 'purchase', features: ['feature'] }) }, e.value);
      expect(r.status).toBe(expected); if (expected !== 200) { expect(initialize).not.toHaveBeenCalled(); expect(track).not.toHaveBeenCalled(); expect(features).not.toHaveBeenCalled(); }
    }
    const h = await requestHeaders(path, e.value), now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    initialize.mockImplementationOnce(async () => { clock.mockReturnValue(now + 25 * 60 * 60 * 1000); });
    track.mockClear(); features.mockClear(); segments.mockClear();
    try {
      const r = await app.request(path, { method: 'POST', headers: h, body: JSON.stringify({ userId: SUBJECT, eventKey: 'purchase', features: ['feature'] }) }, e.value);
      expect(r.status).toBe(401); expect(await r.json()).toMatchObject({ error: 'Shopper session unavailable' });
      expect(track).not.toHaveBeenCalled(); expect(features).not.toHaveBeenCalled(); expect(segments).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  }
  expect(errors).not.toHaveBeenCalled(); expect(queued).toEqual([]); expect(remote).not.toHaveBeenCalled();
});

it('batch errors keep per-event safe receipts and continue, while logging only a label', async () => {
  vi.spyOn(EventDispatcher.prototype, 'dispatch').mockRejectedValueOnce(new Error(PRIVATE));
  const e = env(), second = event('00000000-0000-4000-8000-000000000002');
  const res = await call('/track/batch', { events: [event(), second] }, e.value);
  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ success: false, processed: 2, results: [
    { eventId: event().eventId, status: 'error', error: 'Event delivery not confirmed',
      delivery: { status: 'unconfirmed', attempted: null, acknowledged: null } }, { eventId: second.eventId, status: 'success' },
  ] });
  expect(errors.mock.calls).toEqual([['Event delivery error']]);
  expect(queued).toEqual([]); expect(remote).toHaveBeenCalledOnce(); expect(e.analyticsReads()).toBe(0);
});

it('W22.06 webhook delivery retains truthful fail-closed receipts for unowned event webhooks', async () => {
  for (const entry of cases.filter(value => value.label.endsWith('webhook'))) {
    for (const variant of ['acknowledged', 'partial', 'unconfirmed', 'network', 'unconfigured', 'invalid', 'rejected']) {
      const e = env(), destination = { name: PRIVATE, type: 'custom', url: 'https://synthetic.invalid/' + PRIVATE,
        enabled: true, headers: { Authorization: PRIVATE }, retryConfig: { maxRetries: 1, backoffMs: 1 } };
      e.value.WEBHOOK_ENDPOINTS = variant === 'unconfigured' ? undefined : variant === 'invalid' ? JSON.stringify([destination, null])
        : JSON.stringify([destination, { ...destination, name: 'second' }]);
      let queueReads = 0;
      Object.defineProperty(e.value, 'EVENT_QUEUE', { get() { queueReads++; throw new Error(PRIVATE); } });
      remote.mockReset();
      remote.mockImplementation(async () => {
        if (variant === 'network') throw new Error(PRIVATE);
        return new Response(PRIVATE, { status: variant === 'acknowledged' || (variant === 'partial' && remote.mock.calls.length === 1) ? 200 : 503, statusText: PRIVATE });
      });
      const dispatch = variant === 'rejected' ? vi.spyOn(EventDispatcher.prototype, 'dispatch').mockRejectedValueOnce(new Error(PRIVATE)) : undefined;
      try {
        const response = await call(String(entry.path), entry.body(), e.value), text = await response.text();
        const unconfigured = variant === 'unconfigured' || variant === 'invalid';
        expect(response.status).toBe(unconfigured ? 503 : 502);
        expect(JSON.parse(text)).toEqual({ success: false, eventId: expect.any(String), error: 'Event delivery not confirmed', delivery: {
            status: unconfigured ? 'unconfigured' : 'unconfirmed',
            attempted: unconfigured ? 0 : null,
            acknowledged: unconfigured ? 0 : null,
          } });
        expect(text).not.toContain(PRIVATE); expect(response.headers.has('Retry-After')).toBe(false);
        expect(remote).not.toHaveBeenCalled();
        for (const [, init] of remote.mock.calls) expect(JSON.parse(String(init.body))).toMatchObject({ eventType: 'track', event: 'purchase' });
        expect(queueReads).toBe(0); expect(queued).toEqual([]); expect(e.analyticsReads()).toBe(0);
      } finally { dispatch?.mockRestore(); }
    }
  }
  expect(JSON.stringify(errors.mock.calls)).not.toContain(PRIVATE);
});

it('W05.05 pixel GET/HEAD is inert for valid/forged/invalid inputs and generator discloses temporary containment', async () => {
  const e = env();
  const inputs = [pixelId(), new PixelDecoder().encode({ recipientId: 'other-recipient', metadata: { private: PRIVATE } }), PRIVATE];
  const decode = vi.spyOn(PixelDecoder.prototype, 'decode').mockImplementation(() => { throw new Error('decode forbidden'); });
  const page = vi.spyOn(context, 'getPageContext'), user = vi.spyOn(context, 'getUserContext'), dispatch = vi.spyOn(EventDispatcher.prototype, 'dispatch');
  const trappedEnv = new Proxy(e.value, { get() { throw new Error('pixel binding access forbidden'); } });
  let bytes: number[] | undefined;
  for (const id of inputs) for (const method of ['GET', 'HEAD']) {
    const response = await app.request('/pixel/track/' + encodeURIComponent(id) + '?trackingConsent=true&subject=' + SUBJECT, {
      method, headers: { ...headers, [SHOPPER_HEADER]: 'synthetic-invalid-capability' },
    }, trappedEnv);
    expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toBe('image/gif');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate'); expect(response.headers.get('Pragma')).toBe('no-cache'); expect(response.headers.get('Expires')).toBe('0');
    const body = [...new Uint8Array(await response.arrayBuffer())]; expect(body).toHaveLength(method === 'GET' ? 43 : 0);
    if (method === 'GET') { bytes ??= body; expect(body).toEqual(bytes); }
  }
  for (const spy of [decode, page, user, dispatch]) expect(spy).not.toHaveBeenCalled();
  const generated = await call('/pixel/generate', { campaignId: 'synthetic-campaign', emailId: 'synthetic-email', recipientId: SUBJECT }, e.value);
  expect(generated.status).toBe(200); expect(await generated.json()).toMatchObject({ trackingEnabled: false,
    reason: 'Email pixel tracking is temporarily disabled pending an authorized consent-capable design', pixelId: expect.any(String), pixelUrl: expect.any(String), htmlTag: expect.any(String), data: { recipientId: SUBJECT },
  });
  expect(queued).toEqual([]); expect(remote).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled();
  expect(e.analyticsReads()).toBe(0);
});

it.each([
  ['/track/event', 400, 'Tracking error'], ['/track/batch', 400, 'Batch tracking error'],
  ['/pixel/generate', 500, 'Pixel generation error'], ['/webhook/optimizely', 400, 'Optimizely webhook error'],
  ['/webhook/segment', 400, 'Segment webhook error'], ['/webhook/custom', 400, 'Custom webhook error'],
  ['/optimizely/decisions', 500, 'Optimizely decision error'], ['/optimizely/track', 500, 'Optimizely track error'],
] as const)('malformed input at %s retains status and a fixed error label', async (path, status, label) => {
  const e = env();
  const res = await app.request(path, { method: 'POST', headers: await requestHeaders(path, e.value), body: '{' + PRIVATE }, e.value);
  const guarded = path.startsWith('/track/') || path.startsWith('/optimizely/');
  expect(res.status).toBe(guarded ? 401 : status); expect(await res.json()).toHaveProperty('error');
  expect(errors.mock.calls).toEqual(guarded ? [] : [[label]]);
  if (guarded) {
    const invalid = await app.request(path, { method: 'POST', headers: await requestHeaders(path, e.value), body: '{}' }, e.value);
    expect(invalid.status).toBe(status); expect(await invalid.json()).toHaveProperty('error');
    expect(errors.mock.calls).toEqual([[label]]);
  }
  expect(queued).toEqual([]); expect(remote).not.toHaveBeenCalled(); expect(e.analyticsReads()).toBe(0);
});

it('global error middleware keeps its public response but never logs the thrown object', async () => {
  const errorsApp = new Hono().onError(errorHandler);
  errorsApp.get('/synthetic-error', () => { throw new Error(PRIVATE); });
  const response = await errorsApp.request('/synthetic-error');
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ error: 'Internal server error', message: PRIVATE });
  expect(errors.mock.calls).toEqual([['Error']]);
});

it('W07.05 health retains store probes without assigning its stamp-level event to a tenant', async () => {
  const points: unknown[] = [];
  const response = await app.request('/health', {}, { ENVIRONMENT: 'test',
    get ANALYTICS() { throw new Error('held sink must not be accessed'); },
    CACHE: { async get() { return null; }, async put() {} },
    STORAGE: { async head() { return null; } }, EVENT_QUEUE: {},
    STATE_MANAGER: { idFromName() { return 'synthetic'; }, get() { return { async fetch() { return new Response('{}'); } }; } },
  } as unknown as Env);
  expect(response.status).toBe(200);
  expect(points).toHaveLength(0);
  expect(await response.json()).toMatchObject({ services: { analytics: 'held: no stamp-scoped telemetry authority', cache: 'healthy', storage: 'healthy' } });
  expect(JSON.stringify(points)).not.toContain(SUBJECT);
});
