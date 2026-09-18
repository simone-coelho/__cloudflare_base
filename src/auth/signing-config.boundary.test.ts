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
import { invalidateConfigCache, reflexScopeForTenant, REFLEX_KIND } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from '@/content/kinds';
import { initializePublicationSet, pinPublication, type PublicationBaseline } from '@/config/publication';

/**
 * Minimal R2 double honouring the strengthened put/get contract
 * (`src/config/publication.ts:89-101`, `:293-295`): `get` reports etag/size/body,
 * `put` returns key/size/etag and honours the conditional headers. Copied in
 * shape from the working double at `src/routes/realtime.sdkContract.test.ts:88-110`.
 */
class FixtureR2 {
  data = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string> | undefined>();
  async get(key: string) {
    const raw = this.data.get(key);
    if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      customMetadata: this.metadata.get(key), body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async put(key: string, raw: string, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } | Headers; customMetadata?: Record<string, string> }) {
    const old = this.data.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.data.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.data.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.data.keys()].filter((k) => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map((key) => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

/**
 * Configuration publication is the only configuration authority, and a write
 * needs an authored head to stand on (`src/config/publication.ts:379-397`,
 * `:439-441`). This is the explicit test-authored W11 baseline the working
 * fixtures use (`src/routes/realtime.sdkContract.test.ts:112-126`), never a
 * re-admitted KV fallback.
 */
const seedPublication = (env: Env, tenant: string) => {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'synthetic-fixture', note: '', value } });
  return initializePublicationSet(env, [
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }),
    baseline(LEARN_KIND, { holdout: { share: 0, salt: 'fixture', arms: ['default'] } }),
  ], '0:' + crypto.randomUUID());
};

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
  // AUTH_MODE 'enforced' makes identity material a readiness prerequisite
  // (src/identity/material.mjs:4-6, :31-40; src/routes/health.ts:69-71). Synthetic
  // per-tenant material and salt that satisfy safeIdentitySecret unchanged: 32+
  // bytes, trimmed, no separator characters, 8+ distinct characters, no published
  // placeholder token. Nothing about the signing checks this file owns is relaxed.
  const bindings = { ...CONFIG, AUTH_MODE: 'enforced', SDK_KEYS: 'acme:synthetic-sdk', ACCOUNTS: accounts,
    IDENTITY_SECRETS: 'acme:w0202-synthetic-identity-material-7Kq9Zx',
    IDENTITY_SALT: 'w0202-synthetic-identity-salt-4Rm8Wv',
    RATE_LIMITER: { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({
      allowed: true, remaining: 9, resetTime: Math.floor(Date.now() / 60_000) * 60_000 + 60_000,
    }) }) },
    TENANTS: JSON.stringify({ provisioned: ['acme'], operatorGrants: { [USER.id]: ['acme'] } }),
    // Configuration publication is the only configuration authority
    // (src/config/publication.ts:19, :150-152). The bucket is untracked by the
    // proxy below because this file's subject is the signing boundary.
    STORAGE: new FixtureR2(),
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
    // The authored write now stands on the fixture's published baseline and
    // carries the If-Match/Idempotency-Key preconditions the write contract
    // requires (src/config/publication.ts:66-73, :76-88, :379-397).
    await seedPublication(f.env, 'acme');
    const pin = await pinPublication(f.env, 'acme');
    const authored = json({ config: { ...DEFAULT_REFLEX_CONFIG, K: 7 } }, renewed.accessToken);
    const preconditions = { 'If-Match': `"1/${pin.revision}/${pin.digest}"`, 'Idempotency-Key': '1:' + crypto.randomUUID() };
    expect((await f.request('/config/reflex?scope='+scope, { ...authored, method: 'PUT', headers: { ...authored.headers, ...preconditions } })).status).toBe(200);
    // Revision 2, because the fixture's own authored baseline is revision 1 and
    // the revision counter never rewinds (src/config/publication.ts:368-370).
    expect(await (await f.request('/config/reflex?scope='+scope, bearer(renewed.accessToken))).json()).toMatchObject({ revision: 2, config: { K: 7 } });
    // The three compatibility CACHE writes are no longer where a configuration
    // write lands: publication is the only configuration authority
    // (src/config/publication.ts:19, :150-152; src/config/versionedStore.ts:92-94),
    // so the durability check reads the published set the route just advanced.
    const after = await pinPublication(f.env, 'acme');
    expect(after.refs['reflex:' + reflexScopeForTenant('acme')]!.revision).toBe(2);
    expect(after.revision).toBeGreaterThan(pin.revision);
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
