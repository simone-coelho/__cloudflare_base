import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import { readSigningConfig, SIGNING_CONFIGURATION_UNAVAILABLE } from './signingConfig.mjs';
import { memoryStore } from './store';
import { authRoutes } from '@/routes/auth';
import { healthRoutes } from '@/routes/health';
import { configRoutes } from '@/routes/config';
import { jwt, type AuthContext } from '@/middleware/auth';
import { sdkKey, operatorWrites } from '@/middleware/edgeAccess';
import { invalidateConfigCache } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';

const CONFIG = { JWT_SECRET: 'w0202-synthetic-signing-material-32bytes', JWT_ISSUER: 'w0202', JWT_AUDIENCE: 'w0202' };
const PLACEHOLDER = 'development-secret-key-change-in-production';
const USER = { id: 'synthetic-ops', email: 'operator@example.invalid', name: 'Synthetic Operator',
  password: 'synthetic password 123', roles: ['admin'], permissions: ['*'] };
const invalid: Array<[string, Record<string, unknown>]> = [
  ['missing key', { JWT_SECRET: undefined }], ['null key', { JWT_SECRET: null }],
  ['number key', { JWT_SECRET: 123 }], ['object key', { JWT_SECRET: {} }], ['array key', { JWT_SECRET: [] }],
  ['empty key', { JWT_SECRET: '' }], ['blank key', { JWT_SECRET: ' '.repeat(40) }],
  ['31 ASCII bytes', { JWT_SECRET: 'a'.repeat(31) }], ['31 UTF8 bytes', { JWT_SECRET: 'é'.repeat(15) + 'a' }],
  ['published placeholder', { JWT_SECRET: PLACEHOLDER }], ['padded placeholder', { JWT_SECRET: ` \t${PLACEHOLDER}\n` }],
  ...['JWT_ISSUER', 'JWT_AUDIENCE'].flatMap((key) => [undefined, null, '', ' \t', 17, [], {}]
    .map((value, i): [string, Record<string, unknown>] => [`${key} invalid ${i}`, { [key]: value }])),
];
const safeKeys = ['0123456789abcdef0123456789abcdef', 'é'.repeat(16), ' '+ 'a'.repeat(31), 'é'.repeat(40), 'w0202-long-synthetic-key-'.repeat(5)];
const json = (body: unknown, token?: string): RequestInit => ({ method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const sign = (config = CONFIG, payload: jose.JWTPayload = { sub: USER.id, roles: ['admin'] }) => new jose.SignJWT(payload)
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE)
  .setExpirationTime('5m').sign(new TextEncoder().encode(config.JWT_SECRET));

function fixture(overrides: Record<string, unknown> = {}) {
  invalidateConfigCache();
  const store = memoryStore(), calls: string[] = [], bindingReads: string[] = [], authSeen: Array<AuthContext | undefined> = [];
  const values = new Map([['user:'+USER.email, JSON.stringify(USER)], ['user_id:'+USER.id, JSON.stringify(USER)]]);
  const accounts = new Proxy(store, { get(target, key) {
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? (...args: unknown[]) => { calls.push(`ACCOUNTS.${String(key)}`); return Reflect.apply(value, target, args); } : value;
  } });
  const bindings = { ...CONFIG, AUTH_MODE: 'enforced', SDK_KEYS: 'acme:synthetic-sdk', ACCOUNTS: accounts,
    RATE_LIMITER: { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({
      allowed: true, remaining: 9, resetTime: Math.floor(Date.now() / 60_000) * 60_000 + 60_000,
    }) }) },
    TENANTS: JSON.stringify({ provisioned: ['acme'], operatorGrants: { [USER.id]: ['acme'] } }),
    CACHE: {
      async get(key: string, type?: string) { calls.push('CACHE.get'); const value = values.get(key); return value === undefined ? null : type === 'json' ? JSON.parse(value) : type === 'stream' ? new Response(value).body : value; },
      async put(key: string, value: string) { calls.push('CACHE.put'); values.set(key, value); },
      async delete(key: string) { calls.push('CACHE.delete'); values.delete(key); },
    }, ...overrides };
  const env = new Proxy(bindings, { get(target, key) {
    if (['ACCOUNTS', 'CACHE', 'DB'].includes(String(key))) bindingReads.push(String(key));
    return Reflect.get(target, key);
  } }) as unknown as Env;
  const app = new Hono<{ Bindings: Env; Variables: { auth: AuthContext; tenant: string } }>();
  app.use('*', async (c, next) => { await next(); authSeen.push(c.get('auth')); });
  app.route('/auth', authRoutes); app.route('/health', healthRoutes);
  for (const path of ['/config/*', '/operator/*', '/v1/:tenant/*']) {
    app.use(path, async (c, next) => { c.set('tenant', 'acme'); await next(); });
  }
  app.route('/config', configRoutes);
  app.get('/optional', jwt({ required: false }), (c) => c.json({ authenticated: c.get('auth').isAuthenticated }));
  app.use('/v1/:tenant/*', sdkKey()); app.use('/operator/*', operatorWrites());
  app.get('/v1/:tenant/probe', (c) => { calls.push('sdk.dispatch'); return c.json({ ok: true }); });
  app.post('/operator/probe', (c) => { calls.push('operator.dispatch'); return c.json({ ok: true }); });
  const snapshot = () => JSON.stringify({ users: [...store.users], sessions: [...store.sessions], audit: store.log, kv: [...values] });
  const request = (path: string, init?: RequestInit) => app.request('https://w0202.example.invalid'+path, init, env);
  return { store, values, calls, bindingReads, authSeen, snapshot, request, env };
}

describe('signing configuration at real authentication boundaries', () => {
  it('W02.08 signing A to unsafe to B rejects stale credentials and recovers current human authority without resetting identity', async () => {
    const f = fixture(), password = USER.password;
    const login = await f.request('/auth/login', json({ email: USER.email, password }));
    expect(login.status).toBe(200);
    const a = await login.json() as { accessToken: string; refreshToken: string };
    const service = await sign(CONFIG, { type: 'service', sub: USER.id, roles: ['admin'] });
    const account = structuredClone(await f.store.getById(USER.id)), originalKeys = { sdk: f.env.SDK_KEYS, salt: f.env.IDENTITY_SALT };
    f.env.JWT_SECRET = PLACEHOLDER;
    const frozen = f.snapshot(); f.calls.length = 0;
    for (const [path, init] of [['/health/ready', undefined], ['/auth/login', json({ email: USER.email, password })],
      ['/auth/refresh', json({ refreshToken: a.refreshToken })], ['/auth/me', bearer(a.accessToken)],
      ['/operator/probe', json({}, service)]] as const) expect((await f.request(path, init)).status).toBe(503);
    expect(f.snapshot()).toBe(frozen); expect(f.calls).toEqual([]);
    f.env.JWT_SECRET = 'w0208-replacement-synthetic-signing-material';
    expect((await f.request('/health/ready')).status).toBe(200);
    expect((await f.request('/auth/me', bearer(a.accessToken))).status).toBe(401);
    expect((await f.request('/auth/refresh', json({ refreshToken: a.refreshToken }))).status).toBe(401);
    expect((await f.request('/operator/probe', json({}, service))).status).toBe(401);
    const recovered = await f.request('/auth/login', json({ email: USER.email, password }));
    expect(recovered.status).toBe(200);
    const b = await recovered.json() as { accessToken: string; refreshToken: string };
    expect((await f.request('/auth/me', bearer(b.accessToken))).status).toBe(200);
    expect((await f.request('/auth/refresh', json({ refreshToken: b.refreshToken }))).status).toBe(200);
    expect(await f.store.getById(USER.id)).toMatchObject({ id: account!.id, password_hash: account!.password_hash, roles: account!.roles, updatedAt: account!.updatedAt });
    expect({ sdk: f.env.SDK_KEYS, salt: f.env.IDENTITY_SALT }).toEqual(originalKeys);
    const current = await f.store.getById(USER.id);
    await f.store.put({ ...current!, must_change_password: true });
    expect((await f.request('/operator/probe', json({}, b.accessToken))).status).toBe(403);
    expect((await f.request('/auth/me', bearer(b.accessToken))).status).toBe(200);
  });

  it.each(invalid)('%s returns stable unavailable before all protected effects', async (_name, overrides) => {
    expect(readSigningConfig({ ...CONFIG, ...overrides })).toBeNull();
    const f = fixture(overrides), before = f.snapshot();
    const token = await sign();
    const requests: Array<[string, RequestInit | undefined]> = [
      ['/health/ready', undefined], ['/auth/login', json({ email: USER.email, password: USER.password })],
      ['/auth/login', { method: 'POST', body: '{' }], ['/auth/refresh', json({ refreshToken: token })],
      ['/auth/refresh', { method: 'POST', body: '{' }], ['/auth/me', bearer(token)],
      ['/auth/users', json({ email: 'new@example.invalid', name: 'New Account' }, token)],
      ['/config/reflex?scope=w0202-negative', { ...json({ patch: { K: 7 } }, token), method: 'PATCH' }],
      ['/optional', bearer(token)], ['/v1/acme/probe', bearer(token)], ['/operator/probe', json({}, token)],
    ];
    for (const [path, init] of requests) {
      const response = await f.request(path, init);
      expect(response.status, path).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      const body = await response.json();
      expect(body).toMatchObject({ error: SIGNING_CONFIGURATION_UNAVAILABLE });
      if (path === '/health/ready') expect(body).toMatchObject({ status: 'not_ready', timestamp: expect.any(Number) });
      else expect(body).toEqual({ error: SIGNING_CONFIGURATION_UNAVAILABLE });
    }
    expect(f.calls).toEqual([]); expect(f.bindingReads).toEqual([]);
    expect(f.authSeen).toEqual(requests.map(() => undefined)); expect(f.snapshot()).toBe(before);
    expect((await f.request('/health/live')).status).toBe(200);
    expect(f.calls).toEqual([]); expect(f.bindingReads).toEqual([]);
  });

  it.each(safeKeys)('preserves a valid key of %s without normalization through issuance and renewal', async (key) => {
    const config = { JWT_SECRET: key, JWT_ISSUER: ' w0202 issuer ', JWT_AUDIENCE: ' w0202 audience ' };
    expect(readSigningConfig(config)).toEqual({ key: new TextEncoder().encode(key), issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE });
    const f = fixture(config);
    expect((await f.request('/health/ready')).status).toBe(200); expect(f.calls).toEqual([]);
    const login = await f.request('/auth/login', json({ email: USER.email, password: USER.password }));
    expect(login.status).toBe(200);
    const tokens = await login.json() as { accessToken: string; refreshToken: string };
    const verified = await jose.jwtVerify(tokens.accessToken, new TextEncoder().encode(key), { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE });
    expect(verified.payload).toMatchObject({ sub: USER.id, type: 'access', sid: expect.any(String) });
    expect(f.store.users.size).toBe(1); expect(f.store.sessions.size).toBe(1);
    expect(f.values.has('user:'+USER.email)).toBe(false); expect(f.values.has('user_id:'+USER.id)).toBe(false);
    expect(f.store.log.map((x) => x.action)).toEqual(['account_migrated', 'sign_in']);
    const refresh = await f.request('/auth/refresh', json({ refreshToken: tokens.refreshToken }));
    expect(refresh.status).toBe(200);
    const renewed = await refresh.json() as { accessToken: string };
    expect((await f.request('/auth/me', bearer(renewed.accessToken))).status).toBe(200);
    const scope = 'acme';
    expect((await f.request('/config/reflex?scope='+scope, { ...json({ config: { ...DEFAULT_REFLEX_CONFIG, K: 7 } }, renewed.accessToken), method: 'PUT' })).status).toBe(200);
    expect(await (await f.request('/config/reflex?scope='+scope, bearer(renewed.accessToken))).json()).toMatchObject({ revision: 1, config: { K: 7 } });
    expect(f.calls.filter((call) => call === 'CACHE.put')).toHaveLength(3);
    const before = f.snapshot(); f.calls.length = 0; f.bindingReads.length = 0;
    expect((await f.request('/auth/me', bearer(tokens.refreshToken))).status).toBe(401);
    expect(f.calls).toEqual([]); expect(f.bindingReads).toEqual([]); expect(f.snapshot()).toBe(before);
  });

  it('does not read account/cache bindings even when getters would throw', async () => {
    const f = fixture({ JWT_SECRET: '' });
    for (const key of ['ACCOUNTS', 'CACHE', 'DB']) Object.defineProperty(f.env, key, { get() { throw new Error('Binding was touched'); } });
    for (const path of ['/auth/login', '/auth/refresh']) expect((await f.request(path, { method: 'POST', body: '{' })).status).toBe(503);
    expect(f.bindingReads).toEqual([]);
  });

  it('keeps absent/malformed header handling and independently valid SDK credentials', async () => {
    const f = fixture({ JWT_SECRET: '' });
    for (const header of [undefined, 'Basic credential', 'Bearer', 'Bearer ']) {
      const headers: Record<string, string> = header ? { Authorization: header } : {};
      expect((await f.request('/auth/me', { headers })).status).toBe(401);
      expect(await (await f.request('/optional', { headers })).json()).toEqual({ authenticated: false });
    }
    const sdkHeaders: Array<Record<string, string>> = [{ 'X-SDK-Key': 'synthetic-sdk' }, { 'X-SDK-Key': 'synthetic-sdk', Authorization: 'Bearer bad' }];
    for (const headers of sdkHeaders) {
      expect((await f.request('/v1/acme/probe', { headers })).status).toBe(200);
    }
    expect(f.calls).toEqual(['sdk.dispatch', 'sdk.dispatch']); expect(f.bindingReads).toEqual([]);
  });

  it('uses the validated snapshot after an account read changes the environment', async () => {
    const f = fixture();
    const original = f.env.ACCOUNTS!.getByEmail;
    f.env.ACCOUNTS!.getByEmail = async (email) => { f.env.JWT_SECRET = ''; f.env.JWT_ISSUER = ''; return original(email); };
    const response = await f.request('/auth/login', json({ email: USER.email, password: USER.password }));
    expect(response.status).toBe(200);
    const tokens = await response.json() as { accessToken: string; refreshToken: string };
    for (const token of [tokens.accessToken, tokens.refreshToken]) {
      expect((await jose.jwtVerify(token, new TextEncoder().encode(CONFIG.JWT_SECRET), { issuer: CONFIG.JWT_ISSUER, audience: CONFIG.JWT_AUDIENCE })).payload.sub).toBe(USER.id);
    }
  });
});
