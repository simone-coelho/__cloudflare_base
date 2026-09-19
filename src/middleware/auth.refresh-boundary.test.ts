import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import { hashPassword } from '@/auth/accounts';
import { memoryStore } from '@/auth/store';
import { authRoutes } from '@/routes/auth';
import { configRoutes } from '@/routes/config';
import { invalidateConfigCache, reflexScopeForTenant, REFLEX_KIND } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from '@/content/kinds';
import { initializePublicationSet, pinPublication, type PublicationBaseline } from '@/config/publication';
import { jwt, type AuthContext } from './auth';
import { operatorWrites, sdkKey } from './edgeAccess';

// Real routes, JWT verification, password checking and session logic; only the
// account/KV destinations and credentials are synthetic. No network or secrets load.
const ORIGIN = 'https://w0201.example.invalid';
const SIGNING_MATERIAL = 'w0201-synthetic-local-signing-material';
const PASSWORD = 'w0201 synthetic password';
type Bindings = { Bindings: Env; Variables: { auth: AuthContext; tenant: string } };

class SyntheticKV {
  values = new Map<string, string>();
  calls: string[] = [];
  async get(key: string, type?: string): Promise<unknown> {
    this.calls.push(`get:${key}`);
    const raw = this.values.get(key);
    return raw === undefined ? null : type === 'json' ? JSON.parse(raw) : raw;
  }
  async put(key: string, value: string): Promise<void> {
    this.calls.push(`put:${key}`);
    this.values.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.calls.push(`delete:${key}`);
    this.values.delete(key);
  }
}

/**
 * R2 honouring the strengthened publication put/get contract: `get` reports
 * etag/size/body and `put` returns key/etag/size and honours the conditional
 * headers (src/config/publication.ts:225-237, :293-295).
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
 * Configuration publication is the only configuration authority and a write
 * stands on an authored head (src/config/publication.ts:19, :150-152, :379-397,
 * :437-441). Explicit test-authored W11 baseline, never a KV fallback.
 */
const seedPublication = (env: Env, scope: string) => {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, target = scope): PublicationBaseline =>
    ({ kind, scope: target, revision: { revision: 1, at: 1, actor: 'synthetic-fixture', note: '', value } });
  return initializePublicationSet(env, [
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(scope)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }),
    baseline(LEARN_KIND, { holdout: { share: 0, salt: 'fixture', arms: ['default'] } }),
  ], '0:' + crypto.randomUUID());
};

/**
 * Every configuration write carries the authored document revision and the
 * coherent publication identity (src/config/publication.ts:66-73, :76-88);
 * without them the route answers 428 precondition_required.
 */
async function preconditions(env: Env, scope: string) {
  const pin = await pinPublication(env, scope), revision = pin.refs['reflex:' + reflexScopeForTenant(scope)]!.revision;
  return { 'If-Match': `"${revision}/${pin.revision}/${pin.digest}"`, 'Idempotency-Key': revision + ':' + crypto.randomUUID() };
}

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const json = (method: string, body: unknown, token?: string): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json', ...(token ? bearer(token).headers : {}) },
  body: JSON.stringify(body),
});
const environment = (overrides: Partial<Env> = {}): Env => ({
  JWT_SECRET: SIGNING_MATERIAL, JWT_ISSUER: 'w0201', JWT_AUDIENCE: 'w0201',
  RATE_LIMITER: { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({
    allowed: true, remaining: 9, resetTime: Math.floor(Date.now() / 60_000) * 60_000 + 60_000,
  }) }) } as unknown as DurableObjectNamespace,
  AUTH_MODE: 'enforced', SDK_KEYS: 'acme:w0201-synthetic-site-key', ...overrides,
} as Env);

async function signed(payload: jose.JWTPayload = { sub: 'synthetic-tool', roles: ['operator'] },
  options: { secret?: string; issuer?: string; audience?: string; expiry?: number; notBefore?: number } = {}) {
  const token = new jose.SignJWT({ type: 'service', ...payload }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
    .setIssuer(options.issuer ?? 'w0201').setAudience(options.audience ?? 'w0201')
    .setExpirationTime(options.expiry ?? Math.floor(Date.now() / 1000) + 300);
  if (options.notBefore !== undefined) token.setNotBefore(options.notBefore);
  return token.sign(new TextEncoder().encode(options.secret ?? SIGNING_MATERIAL));
}

async function fixture(mode: 'open' | 'enforced' = 'enforced') {
  const scope = `w0201-${crypto.randomUUID().slice(0, 8)}`;
  const store = memoryStore();
  const cache = new SyntheticKV();
  const env = environment({ CACHE: cache as unknown as KVNamespace, ACCOUNTS: store, AUTH_MODE: mode,
    STORAGE: new FixtureR2() as unknown as R2Bucket,
    TENANTS: JSON.stringify({ provisioned: ['acme', scope], operatorGrants: {
      'synthetic-operator': ['acme', scope], 'synthetic-tool': ['acme', scope],
    } }) });
  await seedPublication(env, scope);
  await store.put({
    id: 'synthetic-operator', email: 'operator@example.invalid', name: 'Synthetic Operator',
    roles: ['operator', 'admin'], permissions: ['read', 'write'],
    password_hash: await hashPassword(PASSWORD), must_change_password: false, disabled: false,
  });
  const observedAuth: Array<AuthContext | undefined> = [];
  const app = new Hono<Bindings>();
  app.use('*', async (c, next) => { await next(); observedAuth.push(c.get('auth')); });
  app.route('/auth', authRoutes);
  app.use('/config/*', async (c, next) => { c.set('tenant', scope); await next(); });
  app.route('/config', configRoutes);
  const request = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${path}`, init, env);
  const login = await request('/auth/login', json('POST', { email: 'operator@example.invalid', password: PASSWORD }));
  expect(login.status).toBe(200);
  const tokens = await login.json() as { accessToken: string; refreshToken: string };
  expect(jose.decodeJwt(tokens.accessToken)).toMatchObject({ type: 'access', sid: jose.decodeJwt(tokens.refreshToken).jti });
  expect(jose.decodeJwt(tokens.refreshToken).type).toBe('refresh');
  expect(store.sessions.size).toBe(1);
  const configPath = `/config/reflex?scope=${scope}`;
  const inspectionToken = await signed({ sub: 'synthetic-tool' });
  const current = async () => (await (await request(configPath, bearer(inspectionToken))).json()) as {
    revision: number; actor: string; config: { version: string; K: number };
  };
  const history = async () => (await (await request(`/config/reflex/history?scope=${scope}`, bearer(inspectionToken))).json()) as {
    revisions: Array<{ revision: number; actor: string }>;
  };
  return { app, env, store, cache, tokens, scope, configPath, request, current, history, observedAuth };
}

describe.each(['open', 'enforced'] as const)('refresh credential containment in %s mode', (mode) => {
  it.each(['fresh', 'revoked'] as const)('%s real-issued refresh cannot read an account or mutate configuration', async (state) => {
    const f = await fixture(mode);
    const renewal = await f.request('/auth/refresh', json('POST', { refreshToken: f.tokens.refreshToken }));
    expect(renewal.status).toBe(200);
    const renewed = await renewal.json() as { accessToken: string };
    expect((await f.request('/auth/me', bearer(renewed.accessToken))).status).toBe(200);

    // A real, successful access-token write proves the route and KV fixture work.
    const authored = json('PUT', { config: { ...DEFAULT_REFLEX_CONFIG, K: 3 }, note: 'access control' }, f.tokens.accessToken);
    const control = await f.request(f.configPath, { ...authored, headers: { ...authored.headers, ...await preconditions(f.env, f.scope) } });
    expect(control.status).toBe(200);
    const before = await f.current();
    const historyBefore = await f.history();
    // Revision 2 over the fixture's own authored baseline: the counter never
    // rewinds (src/config/publication.ts:368-370).
    // The recorded actor is the credential's own subject, which is also what the
    // write authorization compares against (src/routes/config.ts:90-92, :101).
    expect(before).toMatchObject({ revision: 2, actor: 'synthetic-operator', config: { K: 3 } });
    expect(before.config.version).toMatch(/\+r2$/);
    expect(historyBefore.revisions).toHaveLength(2);
    // Configuration lands in the publication, not in compatibility KV
    // (src/config/publication.ts:19, :150-152; src/config/versionedStore.ts:92-94),
    // so durability is read from the published set the route just advanced.
    expect((await pinPublication(f.env, f.scope)).refs['reflex:' + reflexScopeForTenant(f.scope)]!.revision).toBe(2);

    if (state === 'revoked') {
      expect((await f.request('/auth/logout', json('POST', {}, f.tokens.accessToken))).status).toBe(200);
      expect(f.store.sessions.size).toBe(0);
      expect(f.store.log.at(-1)?.action).toBe('sign_out');
      expect((await f.request('/auth/refresh', json('POST', { refreshToken: f.tokens.refreshToken }))).status).toBe(401);
    }
    const getAccount = vi.spyOn(f.store, 'getById');
    const dataBefore = JSON.stringify([...f.cache.values]);
    const accountStateBefore = JSON.stringify({ users: [...f.store.users], sessions: [...f.store.sessions], audit: f.store.log });
    f.cache.calls.length = 0;
    f.observedAuth.length = 0;

    // Soft assertions retain both original unsafe operations and their effects
    // in the red baseline, even when the first unexpected 200 is observed.
    const me = await f.request('/auth/me', bearer(f.tokens.refreshToken));
    const mutation = await f.request(f.configPath, json('PATCH', { patch: { K: 99 }, note: 'refresh misuse' }, f.tokens.refreshToken));
    const protectedCalls = [...f.cache.calls];
    const accountReads = getAccount.mock.calls.length;
    expect.soft(me.status).toBe(401);
    expect.soft((await me.json() as { error?: string }).error).toBe('Invalid token');
    expect.soft(mutation.status).toBe(401);
    expect.soft((await mutation.json() as { error?: string }).error).toBe('Invalid token');
    expect.soft(accountReads).toBe(0);
    expect.soft(protectedCalls).toEqual([]);
    expect.soft(f.observedAuth).toEqual([undefined, undefined]);
    expect.soft(JSON.stringify([...f.cache.values]) === dataBefore).toBe(true);
    expect.soft(JSON.stringify({ users: [...f.store.users], sessions: [...f.store.sessions], audit: f.store.log }) === accountStateBefore).toBe(true);

    // Invalidate the isolate cache so unchanged response data cannot hide KV changes.
    invalidateConfigCache(f.scope);
    const after = await f.current();
    const historyAfter = await f.history();
    expect.soft(after.revision).toBe(before.revision);
    expect.soft(after.config.version).toBe(before.config.version);
    expect.soft(after.config.K).toBe(before.config.K);
    expect.soft(historyAfter).toEqual(historyBefore);
    console.info('W02.01 protected-boundary observation', JSON.stringify({ mode, state,
      statuses: { me: me.status, patch: mutation.status }, accountReads,
      kvWrites: protectedCalls.filter((call) => call.startsWith('put:')).length,
      revision: [before.revision, after.revision], K: [before.config.K, after.config.K],
      history: [historyBefore.revisions.length, historyAfter.revisions.length],
    }));
    if (state === 'fresh') {
      expect(f.store.sessions.size).toBe(1);
      expect((await f.request('/auth/refresh', json('POST', { refreshToken: f.tokens.refreshToken }))).status).toBe(200);
    }
  });
});

describe('existing access credential compatibility', () => {
  it.each(['untyped-tool', 'untyped-sub-only', 'access', 'service'])('%s credentials still read and write through the real routes', async (kind) => {
    const f = await fixture(kind.startsWith('untyped-') ? 'open' : 'enforced');
    const token = kind === 'access' ? f.tokens.accessToken : await signed({ sub: 'synthetic-tool',
      ...(kind === 'untyped-sub-only' ? {} : { roles: ['operator'], permissions: ['read'] }),
      type: kind.startsWith('untyped-') ? undefined : kind });
    expect((await f.request('/auth/me', bearer(token))).status).toBe(kind === 'access' ? 200 : 401);
    const authored = json('PUT', { config: { ...DEFAULT_REFLEX_CONFIG, K: 7 } }, token);
    const write = await f.request(f.configPath, { ...authored, headers: { ...authored.headers, ...await preconditions(f.env, f.scope) } });
    expect(write.status).toBe(200);
    // The recorded actor is the credential's subject (src/routes/config.ts:90-92, :101).
    const actor = kind === 'access' ? 'synthetic-operator' : 'synthetic-tool';
    // Revision 2 over the fixture's authored baseline (src/config/publication.ts:368-370).
    expect(await f.current()).toMatchObject({ revision: 2, actor, config: { K: 7 } });
    expect((await f.history()).revisions).toMatchObject([{ revision: 2, actor }, { revision: 1, actor: 'synthetic-fixture' }]);
    // The write lands in the publication, which is the only configuration
    // authority (src/config/publication.ts:19, :150-152).
    expect((await pinPublication(f.env, f.scope)).refs['reflex:' + reflexScopeForTenant(f.scope)]!.revision).toBe(2);
  });
});

function guarded(options?: Parameters<typeof jwt>[0]) {
  const app = new Hono<Bindings>();
  const reached: AuthContext[] = [];
  const seen: Array<AuthContext | undefined> = [];
  app.use('*', async (c, next) => { await next(); seen.push(c.get('auth')); });
  app.get('/protected', jwt(options), (c) => { reached.push(c.get('auth')); return c.json({ ok: true }); });
  const request = (token?: string) => app.request(`${ORIGIN}/protected`, token ? bearer(token) : {}, environment());
  return { request, reached, seen };
}

describe('shared JWT verifier ordering and failure behavior', () => {
  for (const options of [undefined, { required: false }, { roles: ['admin'] }, { permissions: ['write'] }]) {
    it.each([false, true])(`rejects refresh before context/next/authority checks with ${JSON.stringify(options)} (authority claims=%s)`, async (authority) => {
      const f = guarded(options);
      const token = await signed({ sub: 'synthetic-refresh', type: 'refresh',
        ...(authority ? { roles: ['admin'], permissions: ['write'] } : {}) });
      const response = await f.request(token);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Invalid token' });
      expect(f.reached).toEqual([]);
      expect(f.seen).toEqual([undefined]);
    });
  }

  it('keeps optional absent authentication anonymous and requires credentials by default', async () => {
    const optional = guarded({ required: false });
    expect((await optional.request()).status).toBe(200);
    expect(optional.reached).toEqual([{ isAuthenticated: false }]);
    const required = guarded();
    const response = await required.request();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authorization token required' });
    expect(required.reached).toEqual([]);
  });

  it.each<{ options: Parameters<typeof jwt>[0]; payload: jose.JWTPayload; error: string }>([
    { options: { roles: ['admin'] }, payload: { roles: ['operator'] }, error: 'Insufficient role permissions' },
    { options: { permissions: ['write', 'read'] }, payload: { permissions: ['read'] }, error: 'Insufficient permissions' },
  ])('preserves insufficient authority responses ($error)', async ({ options, payload, error }) => {
    const f = guarded(options);
    const response = await f.request(await signed({ sub: 'synthetic-operator', ...payload }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error });
    expect(f.reached).toEqual([]);
    expect(f.seen).toEqual([undefined]);
  });

  it('preserves role-any and permission-all success for legitimate credentials', async () => {
    const f = guarded({ roles: ['operator', 'admin'], permissions: ['read', 'write'] });
    expect((await f.request(await signed({ sub: 'synthetic-operator', roles: ['admin'], permissions: ['write', 'read'] }))).status).toBe(200);
    expect(f.reached).toHaveLength(1);
    expect(f.reached[0]).toMatchObject({ isAuthenticated: true, user: { sub: 'synthetic-operator' } });
  });

  it('verifies a refresh signature before considering its purpose claim', async () => {
    const f = guarded();
    const response = await f.request(await signed({ sub: 'synthetic-refresh', type: 'refresh' },
      { secret: 'different-synthetic-material' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authentication failed' });
    expect(f.reached).toEqual([]);
    expect(f.seen).toEqual([undefined]);
  });

  it.each(['malformed', 'signature', 'expired', 'issuer', 'audience', 'not-before', 'unsigned'])('preserves %s token denial, including optional authentication', async (kind) => {
    const now = Math.floor(Date.now() / 1000);
    const token = kind === 'malformed' ? 'not-a-jwt' : kind === 'unsigned'
      ? `${jose.base64url.encode(JSON.stringify({ alg: 'none' }))}.${jose.base64url.encode(JSON.stringify({ sub: 'synthetic' }))}.`
      : await signed(undefined, { ...(kind === 'signature' ? { secret: 'different-synthetic-material' } : {}),
        ...(kind === 'expired' ? { expiry: now - 60 } : {}), ...(kind === 'issuer' ? { issuer: 'other' } : {}),
        ...(kind === 'audience' ? { audience: 'other' } : {}), ...(kind === 'not-before' ? { notBefore: now + 60 } : {}) });
    for (const options of [undefined, { required: false }]) {
      const f = guarded(options);
      const response = await f.request(token);
      expect(response.status).toBe(401);
      if (kind === 'expired') expect(await response.json()).toEqual({ error: 'Token expired' });
      expect(f.reached).toEqual([]);
      expect(f.seen).toEqual([undefined]);
    }
  });
});

describe('refresh credentials at the actual edge middleware', () => {
  it.each(['fresh', 'revoked'] as const)('%s refresh cannot substitute for an SDK key or operator access token', async (state) => {
    const f = await fixture();
    if (state === 'revoked') {
      expect((await f.request('/auth/logout', json('POST', {}, f.tokens.accessToken))).status).toBe(200);
      expect(f.store.sessions.size).toBe(0);
    }
    const app = new Hono<Bindings>();
    const effects: string[] = [];
    for (const path of ['/v1/:tenant/*', '/realtime/*', '/operator/*']) {
      app.use(path, async (c, next) => { c.set('tenant', 'acme'); await next(); });
    }
    app.use('/v1/:tenant/*', sdkKey());
    app.use('/realtime/*', sdkKey());
    app.use('/operator/*', operatorWrites());
    app.get('/v1/:tenant/snapshot', (c) => { effects.push('shopper-read'); return c.json({ ok: true }); });
    app.post('/realtime/action', (c) => { effects.push('shopper-write'); return c.json({ ok: true }); });
    app.post('/operator/write', (c) => { effects.push('operator-write'); return c.json({ ok: true }); });
    for (const [path, method] of [['/v1/acme/snapshot', 'GET'], ['/realtime/action', 'POST'], ['/operator/write', 'POST']]) {
      const denied = await app.request(`${ORIGIN}${path}`, { method, ...bearer(f.tokens.refreshToken) }, f.env);
      expect.soft(denied.status).toBe(401);
      expect.soft(effects).toEqual([]);
    }
    effects.length = 0;
    const access = await signed();
    for (const [path, method] of [['/v1/acme/snapshot', 'GET'], ['/realtime/action', 'POST'], ['/operator/write', 'POST']]) {
      expect((await app.request(`${ORIGIN}${path}`, { method, ...bearer(access) }, f.env)).status).toBe(200);
    }
    expect(effects).toEqual(['shopper-read', 'shopper-write', 'operator-write']);
    for (const extra of [{}, bearer(f.tokens.refreshToken).headers]) {
      expect((await app.request(`${ORIGIN}/v1/acme/snapshot`, { headers: { 'X-SDK-Key': 'w0201-synthetic-site-key', ...extra } }, f.env)).status).toBe(200);
    }
    expect(effects).toHaveLength(5);
    expect((await app.request(`${ORIGIN}/realtime/action?sdkKey=w0201-synthetic-site-key`, { method: 'POST' }, f.env)).status).toBe(200);
    expect(effects).toHaveLength(6);
    expect((await app.request(`${ORIGIN}/v1/acme/snapshot`, { headers: { 'X-SDK-Key': 'wrong-site-key', ...bearer(access).headers } }, f.env)).status).toBe(401);
    expect(effects).toHaveLength(6);
  });
});
