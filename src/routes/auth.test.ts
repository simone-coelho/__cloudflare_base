// src/routes/auth.test.ts
// The operator's session and accounts: a provisioned record with the password
// in the clear signs in once and is rewritten as a hash; an admin creates an
// account and gets the temporary password once; the person must change it at
// the first sign-in; reset, disable and remove end sessions; an operator is
// refused the admin's routes; there is no open registration.

import { describe, it, expect, vi } from 'vitest';
import type { Env } from '@/types/env';
import { authRoutes } from './auth';
import { memoryStore } from '@/auth/store';
import { hashPassword, newUser, storeFor } from '@/auth/accounts';
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { startOIDC, callbackOIDC, completeOIDC, assertFederationSession, oidcConfiguration } from '@/auth/oidc';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { jwt, type AuthContext } from '@/middleware/auth';
import type { TenantVariables } from '@/tenancy/tenant';
import { auditedSubjectOperation, auditedSubjectRead } from '@/auth/subjectAudit';
import { d1Authority } from '@/auth/authority';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> { const raw = this.store.get(key); if (raw === undefined) return null; return type === 'json' ? JSON.parse(raw) : raw; }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
  async list(opts: { prefix: string }) { return { keys: [...this.store.keys()].filter((k) => k.startsWith(opts.prefix)).map((name) => ({ name })), list_complete: true, cursor: undefined }; }
}
const H = 'http://w';
const json = (method: string, body: unknown, token?: string) => ({ method, headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

function barrier() {
  let arrive!: () => void, release!: () => void;
  const arrived = new Promise<void>(resolve => { arrive = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { arrived, release, async pause() { arrive(); await released; } };
}
function pauseDerivations(count: number) {
  const gates = Array.from({ length: count }, barrier);
  const original = crypto.subtle.deriveBits.bind(crypto.subtle);
  let n = 0;
  const spy = vi.spyOn(crypto.subtle, 'deriveBits').mockImplementation(async (...args) => {
    const gate = gates[n++], result = await original(...args);
    if (gate) await gate.pause();
    return result;
  });
  return { gates, restore: () => spy.mockRestore() };
}

async function stamp() {
  const store = memoryStore();
  // Explicit fixture admission; the native limiter is exercised in the claims harness.
  const budget = { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({
    allowed: true, remaining: 9, resetTime: Math.floor(Date.now() / 60_000) * 60_000 + 60_000,
  }) }) };
  const env = { CACHE: new FakeKV(), ACCOUNTS: store, RATE_LIMITER: budget, JWT_SECRET: 'w0202-synthetic-route-signing-material', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } as unknown as Env;
  // What provisioning wrote to KV before D1 held the accounts: the record by email, the password in the clear, an admin.
  await env.CACHE.put('user:admin@brand.test', JSON.stringify({ id: 'ops-1', email: 'admin@brand.test', name: 'Admin', password: 'provisioned-pw-1', roles: ['operator', 'admin'], permissions: ['*'] }));
  await env.CACHE.put('user_id:ops-1', JSON.stringify({ id: 'ops-1', email: 'admin@brand.test', name: 'Admin', password: 'provisioned-pw-1', roles: ['operator', 'admin'], permissions: ['*'] }));
  const login = async (email: string, password: string) => { const r = await authRoutes.request(`${H}/login`, json('POST', { email, password }), env); return { status: r.status, body: (await r.json()) as Record<string, unknown> }; };
  return { env, store, login };
}

describe('W15 disabled preprovisioned OIDC and immutable session provenance', () => {
  type Row = Record<string, unknown>;
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => {
    exec(sql: string): void; close(): void; prepare(sql: string): { run(...args: unknown[]): { changes: number | bigint }; get(...args: unknown[]): Row | undefined; all(...args: unknown[]): Row[] };
  } };
  async function oidcFixture() {
    const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
    for (const migration of ['0010_operator_accounts.sql', '0011_operator_audit_tenant.sql', '0012_operator_authority.sql', '0013_operator_oidc.sql']) sqlite.exec(readFileSync('migrations/product/' + migration, 'utf8'));
    const hooks: { beforeRun?: (sql: string) => Promise<void>; beforeBatch?: (sql: string[]) => Promise<void>; afterBatch?: (sql: string[]) => Promise<void> } = {};
    class Statement {
      constructor(readonly sql: string, readonly args: unknown[] = []) {}
      bind(...args: unknown[]) { return new Statement(this.sql, args); }
      async first<T>() { return (sqlite.prepare(this.sql).get(...this.args) ?? null) as T | null; }
      async all<T>() { return { success: true, results: sqlite.prepare(this.sql).all(...this.args) as T[], meta: { changes: 0 } }; }
      async run() { await hooks.beforeRun?.(this.sql); return this.execute(); }
      execute() { return { success: true, results: [], meta: { changes: Number(sqlite.prepare(this.sql).run(...this.args).changes) } }; }
    }
    const db = { prepare: (sql: string) => new Statement(sql), async batch(statements: Statement[]) {
      const sql = statements.map(s => s.sql); await hooks.beforeBatch?.(sql); sqlite.exec('BEGIN');
      let result: ReturnType<Statement['execute']>[];
      try { result = statements.map(s => s.execute()); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      await hooks.afterBatch?.(sql); return result;
    } };
    const provider = { enabled: true, issuer: 'https://issuer.example', authorizationEndpoint: 'https://issuer.example/authorize',
      tokenEndpoint: 'https://issuer.example/token', jwksUri: 'https://issuer.example/keys', origin: 'https://operator.example/', clientId: 'fixture-client',
      clientSecretRef: 'OPERATOR_OIDC_SECRET_FIXTURE', algorithms: ['ES256'], transactionMs: 30000, sessionMs: 120000, reauthMs: 180000, timeoutMs: 500 };
    const env = { DB: db, CACHE: new FakeKV(), JWT_SECRET: 'w15-synthetic-operator-signing-material', JWT_ISSUER: 'local-operator', JWT_AUDIENCE: 'local-console',
      TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'], hosts: {} }), OPERATOR_OIDC: JSON.stringify({ version: 1, tenants: { coach: provider } }),
      OPERATOR_OIDC_SECRET_FIXTURE: 'w15-synthetic-protected-oidc-material' } as unknown as Env;
    const at = Date.now(), secret = await hashPassword('synthetic dual password');
    sqlite.prepare(`INSERT INTO operator_accounts(id,email,name,roles,permissions,password_hash,must_change_password,disabled,created_at,updated_at,auth_mode)
      VALUES ('federated','federated@brand.test','Federated','["operator"]','["read"]',?,0,0,?,?,'dual')`).run(secret, at, at);
    sqlite.prepare('INSERT INTO operator_oidc_links VALUES (?,?,?,?,?,?)').run('federated', provider.issuer, 'exact-provider-subject', 'link-original', 0, at);
    sqlite.prepare('INSERT INTO operator_memberships VALUES (?,?,?,?,?,?,?)').run('federated', 'coach', 'operator', 0, 0, 'membership-original', at);
    const keys = await generateKeyPair('ES256'), jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture-key', alg: 'ES256', use: 'sig' };
    const calls: Array<{ url: string; init?: RequestInit }> = []; let mutation: Row = {}, redirect = false, pauseToken: (() => Promise<void>) | undefined;
    const originRequest = (path: string, cookie?: string) => new Request('https://operator.example' + path, { method: 'POST', headers: { Origin: 'https://operator.example', ...(cookie ? { Cookie: cookie } : {}) }, body: '{}' });
    const begin = async () => {
      const begun = await startOIDC(env, 'coach', originRequest('/auth/oidc/start'), 'federated@brand.test'), url = new URL(begun.location);
      const cookie = begun.cookie.split(';')[0]!;
      return { url, cookie, callback: new Request(`https://operator.example/auth/oidc/callback/coach?state=${url.searchParams.get('state')}&code=synthetic-code&iss=${encodeURIComponent(provider.issuer)}`, { headers: { Cookie: cookie } }) };
    };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input); calls.push({ url, init }); expect(init?.redirect).toBe('manual');
      if (redirect) return new Response('redirect', { status: 302, headers: { Location: 'https://unapproved.example/steal' } });
      if (url === provider.tokenEndpoint) {
        const form = new URLSearchParams(String(init?.body)); expect(form.get('grant_type')).toBe('authorization_code'); expect(form.get('client_id')).toBe(provider.clientId);
        expect(form.get('client_secret')).toBe('w15-synthetic-protected-oidc-material'); expect(form.get('redirect_uri')).toBe('https://operator.example/auth/oidc/callback/coach');
        const tx = sqlite.prepare('SELECT * FROM operator_oidc_transactions ORDER BY created_at DESC LIMIT 1').get()!;
        expect(form.get('code_verifier')).toBe(tx.verifier); await pauseToken?.();
        const now = Math.floor(Date.now() / 1000);
        const token = await new SignJWT({ iss: provider.issuer, sub: 'exact-provider-subject', aud: provider.clientId, nonce: tx.nonce,
          iat: now, exp: now + 300, auth_time: now, ...mutation }).setProtectedHeader({ alg: 'ES256', kid: 'fixture-key' }).sign(keys.privateKey);
        return Response.json({ id_token: token, access_token: 'unused-provider-token' });
      }
      if (url === provider.jwksUri) return Response.json({ keys: [jwk] });
      throw new Error('Unexpected fixture egress');
    });
    return { env, sqlite, hooks, provider, calls, begin, originRequest, mutate: (value: Row) => { mutation = value; }, redirect: () => { redirect = true; },
      pause: (fn: () => Promise<void>) => { pauseToken = fn; }, close() { fetch.mockRestore(); sqlite.close(); } };
  }
  it('W15 uses exact issuer/subject, PKCE and one-use same-browser completion without role/group/email grants or token URLs', async () => {
    const f = await oidcFixture();
    try {
      expect(oidcConfiguration({ ...f.env, OPERATOR_OIDC: undefined })).toEqual({});
      const begun = await f.begin(); expect(begun.url.searchParams.get('scope')).toBe('openid'); expect(begun.url.searchParams.get('code_challenge_method')).toBe('S256');
      const transaction = f.sqlite.prepare('SELECT verifier FROM operator_oidc_transactions WHERE state=?').get(begun.url.searchParams.get('state'))!;
      expect(begun.url.searchParams.get('code_challenge')).toBe(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(transaction.verifier)))).toString('base64url'));
      const result = await callbackOIDC(f.env, 'coach', begun.callback); expect(result.location).toBe('https://operator.example/console?oidc=complete&tenant=coach');
      expect(f.calls.map(c => c.url)).toEqual([f.provider.tokenEndpoint, f.provider.jwksUri]);
      const complete = await completeOIDC(f.env, 'coach', f.originRequest('/auth/oidc/complete', begun.cookie)) as { accessToken: string; refreshToken: string; expiresIn: number };
      const claims = decodeJwt(complete.accessToken); expect(claims).toMatchObject({ sub: 'federated', type: 'access', authMethod: 'oidc' });
      expect(claims).not.toHaveProperty('roles'); expect(claims).not.toHaveProperty('permissions'); expect(claims.sid).toMatch(/^oidc\./);
      const session = await storeFor(f.env).getSession(claims.sid as string); expect(session?.authMethod).toBe('oidc'); expect(session?.expiresAt).toBeLessThanOrEqual(Date.now() + 120000);
      const retained = f.sqlite.prepare('SELECT * FROM operator_oidc_completions').get()!; expect(retained.payload).toBe(''); expect(retained.consumed_at).not.toBeNull();
      expect(JSON.stringify(f.sqlite.prepare('SELECT * FROM operator_oidc_sessions').all())).not.toContain(complete.refreshToken);
      await expect(completeOIDC(f.env, 'coach', f.originRequest('/auth/oidc/complete', begun.cookie))).rejects.toThrow();
      const count = f.calls.length; await expect(callbackOIDC(f.env, 'coach', begun.callback)).rejects.toThrow(); expect(f.calls).toHaveLength(count);
      expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: complete.refreshToken }), f.env)).status).toBe(200);
      expect((await authRoutes.request(`${H}/logout`, json('POST', {}, complete.accessToken), f.env)).status).toBe(200);
      expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: complete.refreshToken }), f.env)).status).toBe(401);
    } finally { f.close(); }
  });
  it('W15 rejects claim mismatches, browser swaps, provider redirects and missing provenance without password fallback', async () => {
    for (const mutation of [{ iss: 'https://issuer.example/' }, { sub: 'foreign-subject' }, { aud: 'foreign-client' }, { nonce: 'foreign' }, { azp: 'foreign' }, { auth_time: 0 }]) {
      const f = await oidcFixture(); try { const begun = await f.begin(); f.mutate(mutation); await expect(callbackOIDC(f.env, 'coach', begun.callback)).rejects.toThrow();
        expect(f.sqlite.prepare('SELECT * FROM operator_sessions').all()).toEqual([]);
      } finally { f.close(); }
    }
    const f = await oidcFixture(); try {
      const begun = await f.begin(); await expect(callbackOIDC(f.env, 'coach', new Request(begun.callback.url, { headers: { Cookie: '__Host-operator-oidc-coach=' + 'a'.repeat(43) } }))).rejects.toThrow(); expect(f.calls).toEqual([]);
      f.redirect(); await expect(callbackOIDC(f.env, 'coach', begun.callback)).rejects.toThrow(); expect(f.calls.map(c => c.url)).toEqual([f.provider.tokenEndpoint]);
    } finally { f.close(); }
    const g = await oidcFixture(); try {
      const begun = await g.begin(); await callbackOIDC(g.env, 'coach', begun.callback);
      const complete = await completeOIDC(g.env, 'coach', g.originRequest('/auth/oidc/complete', begun.cookie)) as { accessToken: string; refreshToken: string };
      const sid = decodeJwt(complete.accessToken).sid as string; g.sqlite.prepare('DELETE FROM operator_oidc_sessions WHERE session_id=?').run(sid);
      await expect(storeFor(g.env).getSession(sid)).rejects.toThrow('Session provenance unavailable');
      expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: complete.refreshToken }), g.env)).status).toBe(401);
      expect(() => g.sqlite.prepare("UPDATE operator_sessions SET auth_method='password' WHERE jti=?").run(sid)).toThrow();
    } finally { g.close(); }
  });
  it('W15 fences account/link/config changes during provider work and original transaction/completion deadlines during DB waits', async () => {
    for (const change of ['account', 'link', 'config']) {
      const f = await oidcFixture(), gate = barrier(); try {
        const begun = await f.begin(); f.pause(() => gate.pause()); const pending = callbackOIDC(f.env, 'coach', begun.callback).then(() => false, () => true);
        await gate.arrived;
        if (change === 'account') f.sqlite.prepare('UPDATE operator_accounts SET disabled=1,updated_at=updated_at+1 WHERE id=?').run('federated');
        else if (change === 'link') f.sqlite.prepare('UPDATE operator_oidc_links SET disabled=1 WHERE account_id=?').run('federated');
        else f.env.OPERATOR_OIDC = JSON.stringify({ version: 1, tenants: { coach: { enabled: false } } });
        gate.release(); expect(await pending, change).toBe(true); expect(f.calls.map(c => c.url)).toEqual([f.provider.tokenEndpoint]); expect(f.sqlite.prepare('SELECT * FROM operator_sessions').all()).toEqual([]);
      } finally { gate.release(); f.close(); }
    }
    for (const phase of ['callback-before', 'callback-after', 'completion']) {
      const f = await oidcFixture(), gate = barrier(); let clock: { mockRestore(): void } | undefined;
      try {
        const begun = await f.begin();
        if (phase === 'completion') {
          await callbackOIDC(f.env, 'coach', begun.callback);
          f.hooks.beforeRun = sql => sql.startsWith('UPDATE operator_oidc_completions SET consumed_at') ? gate.pause() : Promise.resolve();
        } else f.hooks[phase === 'callback-before' ? 'beforeBatch' : 'afterBatch'] = sql => sql[0]?.startsWith('UPDATE operator_oidc_transactions SET consumed_at') ? gate.pause() : Promise.resolve();
        const pending = (phase === 'completion' ? completeOIDC(f.env, 'coach', f.originRequest('/auth/oidc/complete', begun.cookie)) : callbackOIDC(f.env, 'coach', begun.callback)).then(() => false, () => true);
        await gate.arrived;
        const expiry = Number(f.sqlite.prepare(phase === 'completion' ? 'SELECT expires_at FROM operator_oidc_completions' : 'SELECT expires_at FROM operator_oidc_transactions').get()!.expires_at);
        clock = vi.spyOn(Date, 'now').mockReturnValue(expiry + 1); gate.release(); expect(await pending, phase).toBe(true);
        if (phase !== 'completion') expect(f.sqlite.prepare('SELECT * FROM operator_sessions').all()).toEqual([]);
        if (phase === 'callback-after') expect(f.sqlite.prepare('SELECT consumed_at FROM operator_oidc_transactions').get()!.consumed_at).not.toBeNull();
        if (phase === 'completion') expect(f.sqlite.prepare('SELECT payload FROM operator_oidc_completions').get()!.payload).toBe('');
      } finally { gate.release(); clock?.mockRestore(); f.close(); }
    }
  });
  it('W15 renewal re-reads persisted authority after token signing and retains the original absolute expiry', async () => {
    for (const change of ['logout', 'disable', 'mode']) {
      const f = await oidcFixture(), gate = barrier(); let signing: { mockRestore(): void } | undefined;
      try {
        const begun = await f.begin(); await callbackOIDC(f.env, 'coach', begun.callback);
        const tokens = await completeOIDC(f.env, 'coach', f.originRequest('/auth/oidc/complete', begun.cookie)) as { accessToken: string; refreshToken: string };
        const sid = decodeJwt(tokens.accessToken).sid as string, store = storeFor(f.env), user = (await store.getById('federated'))!, session = (await store.getSession(sid))!;
        await assertFederationSession(f.env, user, session, 'oidc'); const sign = SignJWT.prototype.sign;
        signing = vi.spyOn(SignJWT.prototype, 'sign').mockImplementation(async function (this: SignJWT, key, options) { const result = await sign.call(this, key, options); await gate.pause(); return result; });
        const pending = authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: tokens.refreshToken }), f.env); await gate.arrived;
        if (change === 'logout') f.sqlite.prepare('DELETE FROM operator_sessions WHERE jti=?').run(sid);
        else if (change === 'disable') f.sqlite.prepare('UPDATE operator_accounts SET disabled=1,updated_at=updated_at+1 WHERE id=?').run('federated');
        else f.sqlite.prepare("UPDATE operator_accounts SET auth_mode='password' WHERE id=?").run('federated');
        gate.release(); expect((await pending).status, change).toBe(401); expect((await store.getSession(sid))?.expiresAt ?? session.expiresAt).toBe(session.expiresAt);
      } finally { gate.release(); signing?.mockRestore(); f.close(); }
    }
  });
  it('W15 refuses native membership mutation and audit when the original federated authority expires during the final SQL wait', async () => {
    const f = await oidcFixture(), gate = barrier();
    try {
      const begun = await f.begin(); await callbackOIDC(f.env, 'coach', begun.callback);
      const tokens = await completeOIDC(f.env, 'coach', f.originRequest('/auth/oidc/complete', begun.cookie)) as { accessToken: string };
      const sid = decodeJwt(tokens.accessToken).sid as string, store = storeFor(f.env), user = (await store.getById('federated'))!, session = (await store.getSession(sid))!;
      const at = Date.now(), expires = at + 60;
      f.sqlite.prepare('UPDATE operator_sessions SET expires_at=? WHERE jti=?').run(expires, sid);
      f.sqlite.prepare('UPDATE operator_oidc_sessions SET expires_at=? WHERE session_id=?').run(expires, sid);
      const authority = d1Authority(f.env.DB), original = (await authority.member(user.id, 'coach'))!;
      const snapshot = () => JSON.stringify(['operator_memberships', 'operator_audit'].map(table => f.sqlite.prepare('SELECT * FROM ' + table).all()));
      const before = snapshot(); f.hooks.beforeBatch = () => gate.pause();
      const pending = authority.changeMember(original, { ...original, role: 'admin', revision: 'must-not-commit' },
        { id: user.id, sid, accountRevision: user.updatedAt!, owner: true, tenant: 'coach', federation: session.federation }, at);
      await gate.arrived; await new Promise(resolve => setTimeout(resolve, Math.max(0, expires - Date.now() + 25))); gate.release();
      expect(await pending).toBe(false); expect(snapshot()).toBe(before);
    } finally { gate.release(); f.close(); }
  });
  it('W15 rechecks current session and selected membership after admission and result audits without releasing protected data', async () => {
    for (const operation of ['read', 'mutation'] as const) for (const phase of ['admitted', 'result']) for (const revoke of ['session', 'membership']) {
      const f = await oidcFixture(), gate = barrier(); let entered = 0, audits = 0;
      try {
        const begun = await f.begin(); await callbackOIDC(f.env, 'coach', begun.callback);
        const tokens = await completeOIDC(f.env, 'coach', f.originRequest('/auth/oidc/complete', begun.cookie)) as { accessToken: string };
        const sid = decodeJwt(tokens.accessToken).sid as string;
        f.env.DEPLOYMENT_PROFILE = 'customer'; f.env.AUTH_MODE = 'enforced'; f.env.IDENTITY_SALT = 'w15-synthetic-audit-reference-material';
        const app = new Hono<{ Bindings: Env; Variables: TenantVariables & { auth: AuthContext } }>();
        app.use('*', async (c, next) => { c.set('tenant', 'coach'); await next(); }); app.use('*', jwt());
        app.post('/probe', c => operation === 'read'
          ? auditedSubjectRead(c, 'coach', 'recent', 'owned-subject', async () => { entered++; return c.json({ privateResult: 'must-not-release-after-revocation' }); })
          : auditedSubjectOperation(c, 'coach', 'identity_erase', { kind: 'identity', visitorId: 'owned-subject' }, async report => {
            entered++; report.result({ outcome: 'identity_erase', status: 'local_complete', localComplete: true, complete: false, cutoff: Date.now() }); return c.json({ privateResult: 'must-not-release-after-revocation' });
          }));
        f.hooks.beforeRun = sql => {
          if (/INSERT INTO operator_audit/.test(sql)) { audits++; if (audits === (phase === 'admitted' ? 1 : 2)) return gate.pause(); }
          return Promise.resolve();
        };
        const pending = Promise.resolve(app.request('https://operator.example/probe', json('POST', {}, tokens.accessToken), f.env));
        const reached = await Promise.race([gate.arrived.then(() => true), pending.then(() => false)]);
        expect(reached, `${operation}/${phase}/${revoke}: actual audit boundary reached`).toBe(true);
        if (revoke === 'session') f.sqlite.prepare('DELETE FROM operator_sessions WHERE jti=?').run(sid);
        else f.sqlite.prepare('UPDATE operator_memberships SET removed=1,disabled=1,revision=? WHERE account_id=? AND tenant=?').run('revoked-during-audit', 'federated', 'coach');
        gate.release(); const response = await pending, body = await response.json();
        expect(response.status, `${operation}/${phase}/${revoke}`).toBe(503); expect(entered).toBe(phase === 'admitted' ? 0 : 1);
        expect(JSON.stringify(body)).not.toContain('must-not-release-after-revocation');
        if (operation === 'mutation') expect(body).toMatchObject({ operationMayHaveApplied: phase === 'result' });
      } finally { gate.release(); f.close(); }
    }
  }, 15000);
});

describe('the operator session', () => {
  it('W02.08 a paused customer owner reset cannot commit after owner logout', async () => {
    const { env, store, login } = await stamp();
    const owner = (await login('admin@brand.test', 'provisioned-pw-1')).body.accessToken as string;
    env.DEPLOYMENT_PROFILE = 'customer'; env.AUTH_MODE = 'enforced'; env.STAMP_OWNER_SUBJECTS = '["ops-1"]';
    const target = { ...newUser({ email: 'target@brand.test', name: 'Target' }, await hashPassword('synthetic target password')), must_change_password: false };
    await store.put(target);
    const paused = pauseDerivations(1);
    const reset = authRoutes.request(`${H}/users/${target.id}/reset`, json('POST', {}, owner), env);
    try {
      await paused.gates[0]!.arrived;
      expect((await authRoutes.request(`${H}/logout`, json('POST', {}, owner), env)).status).toBe(200);
      const afterLogout = JSON.stringify({ users: [...store.users], sessions: [...store.sessions], audit: store.log });
      paused.gates[0]!.release();
      const reply = await reset;
      expect(reply.status).toBe(409); expect(await reply.json()).toEqual({ error: 'Account or session changed. Sign in again and retry.' });
      expect(JSON.stringify({ users: [...store.users], sessions: [...store.sessions], audit: store.log })).toBe(afterLogout);
      expect(await store.getById(target.id)).toEqual(target);
    } finally { paused.gates[0]!.release(); paused.restore(); await reset; }
  });

  it('W02.07 retained removal blocks stale and in-flight legacy imports while explicit recreation keeps onboarding', async () => {
    const { env, store, login } = await stamp();
    const admin = (await login('admin@brand.test', 'provisioned-pw-1')).body.accessToken as string;
    const legacy = { id: 'legacy-target', email: 'target@brand.test', name: 'Legacy Target',
      password: 'legacy synthetic password', roles: ['admin'], permissions: ['*'] };
    await env.CACHE.put(`user:${legacy.email}`, JSON.stringify(legacy));
    await env.CACHE.put(`user_id:${legacy.id}`, JSON.stringify(legacy));
    const snapshot = () => JSON.stringify({ users: [...store.users], sessions: [...store.sessions], audit: store.log,
      kv: [...(env.CACHE as unknown as FakeKV).store] });
    const unmigrated = snapshot();
    expect((await authRoutes.request(`${H}/users`, json('POST', { email: legacy.email, name: 'Duplicate' }, admin), env)).status).toBe(409);
    expect(snapshot() === unmigrated).toBe(true);
    const cleanup = vi.spyOn(env.CACHE, 'delete').mockRejectedValue(new Error('synthetic KV cleanup failure'));
    const paused = pauseDerivations(1);
    const pending = authRoutes.request(`${H}/login`, json('POST', { email: legacy.email, password: legacy.password }), env);
    try {
      await paused.gates[0]!.arrived;
      const migrated = await login(legacy.email, legacy.password);
      expect(migrated.status).toBe(200);
      const migratedUser = migrated.body.user as { id: string; mustChangePassword: boolean };
      expect(migratedUser.id === legacy.id && migratedUser.mustChangePassword === false).toBe(true);
      expect((await store.getById(legacy.id))?.password === undefined).toBe(true);
      expect(await env.CACHE.get(`user:${legacy.email}`) !== null).toBe(true);
      expect(await env.CACHE.get(`user_id:${legacy.id}`) !== null).toBe(true);
      expect(cleanup).toHaveBeenCalledTimes(2);
      expect((await authRoutes.request(`${H}/users/${legacy.id}`, json('DELETE', {}, admin), env)).status).toBe(200);
      const removed = snapshot();
      const markers = store.log.filter(row => row.action === 'account_removed');
      expect(markers.length).toBe(1);
      expect(markers[0]?.actorId === 'ops-1' && markers[0]?.actorEmail === 'admin@brand.test'
        && markers[0]?.targetId === legacy.id && markers[0]?.targetEmail === legacy.email).toBe(true);
      expect(await store.getById(legacy.id) === null).toBe(true);
      expect([...store.sessions.values()].some(row => row.accountId === legacy.id)).toBe(false);
      paused.gates[0]!.release();
      const stale = await pending;
      expect(stale.status).toBe(409);
      const conflict = JSON.stringify({ error: 'Account or session changed. Sign in again and retry.' });
      expect(JSON.stringify(await stale.json()) === conflict).toBe(true);
      const retained = await login(legacy.email.toUpperCase(), legacy.password);
      expect(retained.status).toBe(409); expect(JSON.stringify(retained.body) === conflict).toBe(true);
      expect(snapshot() === removed).toBe(true);
      expect((await authRoutes.request(`${H}/me`, bearer(migrated.body.accessToken as string), env)).status).toBe(401);
      expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: migrated.body.refreshToken }), env)).status).toBe(401);
      expect(snapshot() === removed).toBe(true);
      expect(cleanup).toHaveBeenCalledTimes(2);

      const created = await authRoutes.request(`${H}/users`, json('POST', { email: legacy.email.toUpperCase(), name: 'Recovered Operator' }, admin), env);
      expect(created.status).toBe(201);
      const recovered = await created.json() as { user: { id: string }; temporaryPassword: string };
      expect(recovered.user.id !== legacy.id).toBe(true);
      expect(await store.hasRemoval(legacy)).toBe(true);
      expect(JSON.stringify(store.log.filter(row => row.action === 'account_removed')) === JSON.stringify(markers)).toBe(true);
      expect((await login(legacy.email, legacy.password)).status).toBe(401);
      const first = await login(legacy.email, recovered.temporaryPassword);
      expect(first.status).toBe(200); expect(first.body.mustChangePassword).toBe(true);
      const recoveredUser = first.body.user as { id: string; roles: string[] };
      expect(recoveredUser.id === recovered.user.id && recoveredUser.roles.join(',') === 'operator').toBe(true);
      expect((await authRoutes.request(`${H}/users`, bearer(first.body.accessToken as string), env)).status).toBe(403);
      const renewed = await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: first.body.refreshToken }), env);
      expect(renewed.status).toBe(200);
      expect((await renewed.json() as { mustChangePassword: boolean }).mustChangePassword === true).toBe(true);
      const changed = await authRoutes.request(`${H}/password`, json('POST', { currentPassword: recovered.temporaryPassword,
        newPassword: 'recovered synthetic password' }, first.body.accessToken as string), env);
      expect(changed.status).toBe(200);
      const replacement = await changed.json() as { accessToken: string; refreshToken: string };
      expect((await authRoutes.request(`${H}/me`, bearer(replacement.accessToken), env)).status).toBe(200);
      expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: replacement.refreshToken }), env)).status).toBe(200);
      const current = snapshot();
      expect((await authRoutes.request(`${H}/users`, json('POST', { email: legacy.email, name: 'Duplicate' }, admin), env)).status).toBe(409);
      expect(snapshot() === current).toBe(true);
      expect(await store.hasRemoval({ id: recovered.user.id, email: legacy.email })).toBe(true);
      console.info('W02.07 legacy route barrier', JSON.stringify({ firstMigration: 200, stale: 409, retained: 409,
        cleanupFailures: cleanup.mock.calls.length, removalMarkers: markers.length, recreated: 201, onboarding: true, recoveredRefresh: 200 }));
    } finally { paused.gates[0]!.release(); paused.restore(); cleanup.mockRestore(); await pending; }
  });

  it('W02.06 pending credentials and admin snapshots cannot undo completed account or session transitions', async () => {
    const password = 'initial synthetic password';
    const observed: Array<{ pending: string; transition: string; status: number }> = [];
    for (const pending of ['login', 'password']) for (const transition of ['disable', 'demote', 'reset', 'delete', 'logout']) {
      const { env, store, login } = await stamp();
      const admin = (await login('admin@brand.test', 'provisioned-pw-1')).body.accessToken as string;
      const target = { ...newUser({ email: 'target@brand.test', name: 'Target Operator', roles: ['admin'] }, await hashPassword(password)), must_change_password: false };
      await store.put(target);
      const first = (await login(target.email, password)).body;
      const paused = pauseDerivations(1);
      const request = pending === 'login' ? authRoutes.request(`${H}/login`, json('POST', { email: target.email, password }), env)
        : authRoutes.request(`${H}/password`, json('POST', { currentPassword: password, newPassword: 'stale proposed password' }, first.accessToken as string), env);
      try {
        await paused.gates[0]!.arrived;
        const path = transition === 'logout' ? '/logout' : `/users/${target.id}${transition === 'reset' ? '/reset' : ''}`;
        const method = transition === 'delete' ? 'DELETE' : ['disable', 'demote'].includes(transition) ? 'PATCH' : 'POST';
        const response = await authRoutes.request(H + path, json(method,
          transition === 'disable' ? { disabled: true } : transition === 'demote' ? { roles: ['operator'] } : {},
          transition === 'logout' ? first.accessToken as string : admin), env);
        expect(response.status, pending + transition).toBe(200);
        const completed = await response.json() as { temporaryPassword?: string };
        const snapshot = () => JSON.stringify({ users: [...store.users], sessions: [...store.sessions], audit: store.log });
        const winner = snapshot();
        paused.gates[0]!.release();
        const stale = await request;
        expect(stale.status, pending + transition).toBe(409);
        expect(await stale.json()).toEqual({ error: 'Account or session changed. Sign in again and retry.' });
        expect(snapshot(), pending + transition).toBe(winner);
        expect((await authRoutes.request(`${H}/me`, bearer(first.accessToken as string), env)).status).toBe(401);
        expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: first.refreshToken }), env)).status).toBe(401);
        if (transition === 'delete') expect((await login(target.email, password)).status).toBe(401);
        else {
          if (transition === 'disable') {
            expect((await login(target.email, password)).status).toBe(403);
            expect((await authRoutes.request(`${H}/users/${target.id}`, json('PATCH', { disabled: false }, admin), env)).status).toBe(200);
          }
          const recovered = await login(target.email, completed.temporaryPassword ?? password);
          expect(recovered.status).toBe(200);
          expect((await authRoutes.request(`${H}/me`, bearer(recovered.body.accessToken as string), env)).status).toBe(200);
          if (transition === 'reset') {
            expect(recovered.body.mustChangePassword).toBe(true);
            expect((await authRoutes.request(`${H}/password`, json('POST', { currentPassword: completed.temporaryPassword,
              newPassword: 'recovered synthetic password' }, recovered.body.accessToken as string), env)).status).toBe(200);
          }
        }
        observed.push({ pending, transition, status: stale.status });
      } finally { paused.gates[0]!.release(); paused.restore(); await request; }
    }
    for (const pending of ['patch', 'reset', 'delete']) {
      const { env, store, login } = await stamp();
      const admin = (await login('admin@brand.test', 'provisioned-pw-1')).body.accessToken as string;
      const target = { ...newUser({ email: 'target@brand.test', name: 'Target Operator' }, await hashPassword(password)), must_change_password: false };
      await store.put(target); await login(target.email, password);
      const gate = barrier(), get = store.getById.bind(store); let held = false;
      const spy = vi.spyOn(store, 'getById').mockImplementation(async id => {
        const snapshot = await get(id);
        if (id === target.id && !held) { held = true; await gate.pause(); }
        return snapshot;
      });
      const request = authRoutes.request(`${H}/users/${target.id}${pending === 'reset' ? '/reset' : ''}`,
        json(pending === 'patch' ? 'PATCH' : pending === 'delete' ? 'DELETE' : 'POST', { name: 'Stale Name' }, admin), env);
      try {
        await gate.arrived;
        expect((await authRoutes.request(`${H}/users/${target.id}`, json('PATCH', { disabled: true }, admin), env)).status).toBe(200);
        const winner = JSON.stringify({ users: [...store.users], sessions: [...store.sessions], audit: store.log });
        gate.release(); const response = await request;
        expect(response.status, pending).toBe(409);
        expect(JSON.stringify({ users: [...store.users], sessions: [...store.sessions], audit: store.log })).toBe(winner);
        observed.push({ pending, transition: 'disable', status: response.status });
      } finally { gate.release(); spy.mockRestore(); await request; }
    }
    console.info('W02.06 paused route transitions', JSON.stringify(observed));
  }, 30_000);

  it('W02.06 only one competing password replacement commits and the losing request preserves its usable session', async () => {
    const { env, store, login } = await stamp();
    const first = (await login('admin@brand.test', 'provisioned-pw-1')).body;
    const second = (await login('admin@brand.test', 'provisioned-pw-1')).body;
    const paused = pauseDerivations(2);
    const send = (token: unknown, password: string) => authRoutes.request(`${H}/password`, json('POST', {
      currentPassword: 'provisioned-pw-1', newPassword: password,
    }, token as string), env);
    const winnerRequest = send(first.accessToken, 'winning synthetic password');
    let loserRequest: ReturnType<typeof send> | undefined;
    try {
      await paused.gates[0]!.arrived;
      loserRequest = send(second.accessToken, 'losing synthetic password');
      await paused.gates[1]!.arrived;
      paused.gates[0]!.release();
      const winner = await winnerRequest; expect(winner.status).toBe(200);
      const tokens = await winner.json() as { accessToken: string; refreshToken: string };
      const snapshot = JSON.stringify({ users: [...store.users], sessions: [...store.sessions], audit: store.log });
      paused.gates[1]!.release();
      expect((await loserRequest).status).toBe(409);
      expect(JSON.stringify({ users: [...store.users], sessions: [...store.sessions], audit: store.log })).toBe(snapshot);
      expect(store.sessions.size).toBe(1);
      for (const old of [first, second]) expect((await authRoutes.request(`${H}/me`, bearer(old.accessToken as string), env)).status).toBe(401);
      expect((await authRoutes.request(`${H}/me`, bearer(tokens.accessToken), env)).status).toBe(200);
      expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: tokens.refreshToken }), env)).status).toBe(200);
      expect((await login('admin@brand.test', 'losing synthetic password')).status).toBe(401);
      expect((await login('admin@brand.test', 'winning synthetic password')).status).toBe(200);
      console.info('W02.06 password competition', JSON.stringify({ winner: 200, loser: 409, replacementRenewal: 200 }));
    } finally { paused.gates.forEach(g => g.release()); paused.restore(); await Promise.all([winnerRequest, loserRequest]); }
  });

  it('W02.04 replaces every previous browser session after password change and keeps the replacement renewable', async () => {
    const { env, store, login } = await stamp();
    const first = (await login('admin@brand.test', 'provisioned-pw-1')).body;
    const second = (await login('admin@brand.test', 'provisioned-pw-1')).body;
    const response = await authRoutes.request(`${H}/password`, json('POST', {
      currentPassword: 'provisioned-pw-1', newPassword: 'a changed synthetic password',
    }, first.accessToken as string), env);
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const replacement = await response.json() as { accessToken: string; refreshToken: string };
    expect(decodeJwt(replacement.accessToken)).toMatchObject({ type: 'access', sid: decodeJwt(replacement.refreshToken).jti });
    expect(store.sessions.size).toBe(1);
    for (const old of [first, second]) {
      expect((await authRoutes.request(`${H}/me`, bearer(old.accessToken as string), env)).status).toBe(401);
      expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: old.refreshToken }), env)).status).toBe(401);
    }
    expect((await authRoutes.request(`${H}/me`, bearer(replacement.accessToken), env)).status).toBe(200);
    expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: replacement.refreshToken }), env)).status).toBe(200);
    expect((await login('admin@brand.test', 'provisioned-pw-1')).status).toBe(401);
    expect((await login('admin@brand.test', 'a changed synthetic password')).status).toBe(200);
  });
  it('signs in a record still in KV, moves it to D1 as a hash and deletes the KV keys, renews, answers who, signs out', async () => {
    const { env, store, login } = await stamp();
    expect((await login('admin@brand.test', 'wrong-pw-1234')).status).toBe(401);
    const l = await login('admin@brand.test', 'provisioned-pw-1');
    expect(l.status).toBe(200);
    expect(l.body.user).toMatchObject({ id: 'ops-1', name: 'Admin', roles: ['operator', 'admin'], mustChangePassword: false });
    expect(l.body.mustChangePassword).toBe(false);
    const stored = (await store.getById('ops-1'))!;
    expect(stored.password).toBeUndefined();
    expect(String(stored.password_hash)).toMatch(/^pbkdf2\$/);
    expect(await env.CACHE.get('user:admin@brand.test')).toBeNull();
    expect(await env.CACHE.get('user_id:ops-1')).toBeNull();
    expect(store.log.map((e) => e.action)).toEqual(['account_migrated', 'sign_in']);
    expect((await login('admin@brand.test', 'provisioned-pw-1')).status).toBe(200);   // still signs in, now against the hash, and a second browser does not end the first
    const renew = await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: l.body.refreshToken }), env);
    expect(renew.status).toBe(200);
    const r = (await renew.json()) as { accessToken: string };
    const me = await authRoutes.request(`${H}/me`, bearer(r.accessToken), env);
    expect(((await me.json()) as { account: { email: string } }).account.email).toBe('admin@brand.test');
    expect((await authRoutes.request(`${H}/logout`, json('POST', {}, r.accessToken), env)).status).toBe(200);
    expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: l.body.refreshToken }), env)).status).toBe(401);
  });

  it('W02.05 keeps historical audit without email lockout and preserves recovery while login admission is unavailable', async () => {
    const { env, login, store } = await stamp();
    for (let i = 0; i < 10; i++) await store.audit({ at: Date.now(), action: 'sign_in_failed', targetEmail: 'admin@brand.test' });
    const history = JSON.stringify(store.log);
    const failed = vi.spyOn(store, 'failedSignIns');
    for (let i = 0; i < 10; i++) expect((await login('admin@brand.test', `wrong-pw-${i}00`)).status).toBe(401);
    expect((await login('nobody@brand.test', 'whatever-pw-1')).status).toBe(401);
    expect(JSON.stringify(store.log)).toBe(history); expect(failed).not.toHaveBeenCalled();
    const admitted = await login('admin@brand.test', 'provisioned-pw-1');
    expect(admitted.status).toBe(200);
    env.RATE_LIMITER = undefined as unknown as DurableObjectNamespace;
    expect((await login('admin@brand.test', 'provisioned-pw-1')).status).toBe(503);
    expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: admitted.body.refreshToken }), env)).status).toBe(200);
    const changed = await authRoutes.request(`${H}/password`, json('POST', {
      currentPassword: 'provisioned-pw-1', newPassword: 'recovered synthetic password',
    }, admitted.body.accessToken as string), env);
    expect(changed.status).toBe(200);
    const replacement = await changed.json() as { accessToken: string; refreshToken: string };
    expect((await authRoutes.request(`${H}/logout`, json('POST', {}, replacement.accessToken), env)).status).toBe(200);
    expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: replacement.refreshToken }), env)).status).toBe(401);
    expect(store.log.slice(10).map(row => row.action)).toEqual(['account_migrated', 'sign_in', 'password_changed', 'sign_out']);
    expect(JSON.stringify(store.log.slice(0, 10))).toBe(history);
    failed.mockRestore();
  });

  it('W02.05 gates actual body and account work, bounds source identity and streamed bytes, and always rejects dummy candidates', async () => {
    const { env, store, login } = await stamp();
    const effects: string[] = [], requests: Array<{ name: string; url: string; body: string }> = [];
    const spyRead = vi.spyOn(store, 'getByEmail'), spyKV = vi.spyOn(env.CACHE, 'get');
    const spyFailed = vi.spyOn(store, 'failedSignIns'), spyAudit = vi.spyOn(store, 'audit');
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    const future = () => Math.floor(Date.now() / 60_000) * 60_000 + 60_000;
    let reply: () => Response | Promise<Response> = () => Response.json({ allowed: false, remaining: 0, resetTime: future() });
    const namespace = { idFromName(name: string) { effects.push('budget'); return name; }, get(name: string) { return {
      async fetch(url: string, init: RequestInit) { requests.push({ name, url, body: String(init.body) }); return reply(); },
    }; } } as unknown as DurableObjectNamespace;
    env.RATE_LIMITER = namespace;
    const streamed = async (chunks: Uint8Array[], headers: Record<string, string> = {}, pendingCancel = false) => {
      let reads = 0, cancelled = false;
      const stream = new ReadableStream<Uint8Array>({ pull(controller) {
        effects.push('body'); reads++; const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk); else controller.close();
      }, cancel() { cancelled = true; if (pendingCancel) return new Promise<void>(() => undefined); } }, { highWaterMark: 0 });
      const request = new Request(H + '/login', { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit);
      const response = await authRoutes.fetch(request, env);
      return { response, reads, cancelled };
    };
    try {
      for (const mode of [undefined, 'open', 'enforced', 'ENFORCED']) {
        env.AUTH_MODE = mode as Env['AUTH_MODE'];
        for (const variant of ['denied', 'missing', 'throw', 'status', 'json', 'shape', 'allowed-string', 'remaining', 'denied-remaining', 'stale', 'future']) {
          env.RATE_LIMITER = variant === 'missing' ? undefined as unknown as DurableObjectNamespace : namespace;
          reply = () => {
            if (variant === 'throw') throw new Error('synthetic limiter unavailable');
            if (variant === 'status') return new Response('', { status: 500 });
            if (variant === 'json') return new Response('{');
            return Response.json({ allowed: variant === 'allowed-string' ? 'true' : false,
              remaining: variant === 'remaining' ? -1 : variant === 'denied-remaining' ? 1 : 0,
              resetTime: future() + (variant === 'stale' ? -60_000 : variant === 'future' ? 60_000 : 0),
              ...(variant === 'shape' ? { extra: true } : {}) });
          };
          const result = await streamed([new TextEncoder().encode('{')], { 'CF-Connecting-IP': '192.0.2.1' });
          expect(result.response.status, String(mode) + variant).toBe(variant === 'denied' ? 429 : 503);
          expect(result.response.headers.get('Cache-Control')).toBe('no-store'); expect(result.reads).toBe(0);
          if (variant === 'denied') {
            expect(Number(result.response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
            expect(Number(result.response.headers.get('Retry-After'))).toBeLessThanOrEqual(60);
            expect(Number(result.response.headers.get('X-RateLimit-Reset'))).toBe(future());
          }
        }
      }
      expect(spyRead).not.toHaveBeenCalled(); expect(spyKV).not.toHaveBeenCalled();
      expect(spyFailed).not.toHaveBeenCalled(); expect(spyAudit).not.toHaveBeenCalled(); expect(derive).not.toHaveBeenCalled();
      env.AUTH_MODE = 'enforced'; env.RATE_LIMITER = namespace;
      const originalSecret = env.JWT_SECRET;
      env.JWT_SECRET = ''; effects.length = 0;
      expect((await streamed([new Uint8Array(1)])).response.status).toBe(503); expect(effects).toEqual([]);
      env.JWT_SECRET = originalSecret;

      reply = () => Response.json({ allowed: true, remaining: 9, resetTime: future() });
      const sourceKeys: string[] = [];
      for (const ip of ['192.0.2.1', '192.000.002.001', '::ffff:c000:201', '2001:db8::1', '2001:0DB8:0:0:0:0:0:1', '', 'bad', '999.0.0.1', '2001:::1', 'x'.repeat(100)]) {
        const result = await streamed([new TextEncoder().encode('{')], {
          'CF-Connecting-IP': ip, 'X-Forwarded-For': crypto.randomUUID(), 'X-Tenant': crypto.randomUUID(),
        });
        expect(result.response.status).toBe(401);
        sourceKeys.push((JSON.parse(requests.at(-1)!.body) as { sourceKey: string }).sourceKey);
      }
      expect(new Set(sourceKeys.slice(0, 3)).size).toBe(1); expect(sourceKeys[3]).toBe(sourceKeys[4]);
      expect(new Set(sourceKeys.slice(5)).size).toBe(1); expect(new Set([sourceKeys[0], sourceKeys[3], sourceKeys[5]]).size).toBe(3);
      expect(requests.every(r => r.name === 'operator-login:v1' && new URL(r.url).pathname === '/auth/login-budget'
        && /^\{"sourceKey":"[a-f0-9]{64}"\}$/.test(r.body))).toBe(true);
      expect(spyRead).not.toHaveBeenCalled(); expect(spyKV).not.toHaveBeenCalled(); expect(derive).not.toHaveBeenCalled();

      for (const lengthHeader of [undefined, '1', '999999']) {
        effects.length = 0;
        const result = await streamed([new Uint8Array(4096), new Uint8Array(1), new Uint8Array(100)],
          lengthHeader === undefined ? {} : { 'Content-Length': lengthHeader }, lengthHeader === '1');
        expect(result.response.status).toBe(413); expect(result.cancelled).toBe(true); expect(result.reads).toBe(2);
        expect(effects).toEqual(['budget', 'body', 'body']);
      }
      expect(spyRead).not.toHaveBeenCalled(); expect(spyKV).not.toHaveBeenCalled(); expect(derive).not.toHaveBeenCalled();
      const credentials = JSON.stringify({ email: 'nobody@brand.test', password: 'dummy synthetic password' });
      const exact = new TextEncoder().encode(credentials + ' '.repeat(4096 - credentials.length));
      const missing = await streamed([exact.subarray(0, 9), exact.subarray(9)], { 'Content-Length': '1' });
      expect(missing.response.status).toBe(401); expect(await missing.response.json()).toEqual({ error: 'Invalid credentials' });
      expect(derive).toHaveBeenCalledTimes(1); expect(derive.mock.calls[0]![0]).toMatchObject({ name: 'PBKDF2', iterations: 100_000, hash: 'SHA-256' });
      expect(store.users.size).toBe(0); expect(store.sessions.size).toBe(0); expect(spyAudit).not.toHaveBeenCalled();
      // A real positive still migrates the legacy account after admission.
      expect((await login('admin@brand.test', 'provisioned-pw-1')).status).toBe(200);
      derive.mockClear();
      expect((await login('admin@brand.test', 'wrong hashed password')).status).toBe(401);
      expect(derive).toHaveBeenCalledTimes(1); expect(store.log.map(e => e.action)).toEqual(['account_migrated', 'sign_in']);
      console.info('W02.05 route admission', JSON.stringify({ modes: 4, failureVariants: 11,
        sourceInputs: sourceKeys.length, overflowCases: 3, exactBytes: 4096, missingKdf: 100_000, hashedKdf: 100_000 }));
    } finally {
      spyRead.mockRestore(); spyKV.mockRestore(); spyFailed.mockRestore(); spyAudit.mockRestore(); derive.mockRestore();
    }
  });

  it('there is no open registration', async () => {
    const { env } = await stamp();
    const r = await authRoutes.request(`${H}/register`, json('POST', { email: 'x@y.test', password: 'password-123', name: 'Anyone', roles: ['admin'] }), env);
    expect(r.status).toBe(404);
  });
});

describe('accounts, an admin\'s', () => {
  it('creates an account with a temporary password answered once; the person must change it at the first sign-in', async () => {
    const { env, login } = await stamp();
    const admin = (await login('admin@brand.test', 'provisioned-pw-1')).body.accessToken as string;
    const created = await authRoutes.request(`${H}/users`, json('POST', { email: 'Merch@Brand.test', name: 'Merchandiser' }, admin), env);
    expect(created.status).toBe(201);
    const c = (await created.json()) as { user: { id: string; email: string; roles: string[]; mustChangePassword: boolean }; temporaryPassword: string };
    expect(c.user).toMatchObject({ email: 'merch@brand.test', roles: ['operator'], mustChangePassword: true });
    expect(c.temporaryPassword).toMatch(/^[a-zA-Z2-9]{16}$/);
    expect((await authRoutes.request(`${H}/users`, json('POST', { email: 'merch@brand.test', name: 'Again' }, admin), env)).status).toBe(409);
    const first = await login('merch@brand.test', c.temporaryPassword);
    expect(first.status).toBe(200);
    expect(first.body.mustChangePassword).toBe(true);
    const tok = first.body.accessToken as string;
    const weak = await authRoutes.request(`${H}/password`, json('POST', { currentPassword: c.temporaryPassword, newPassword: 'short' }, tok), env);
    expect(((await weak.json()) as { error: string }).error).toBe('A password needs at least ten characters.');
    const wrong = await authRoutes.request(`${H}/password`, json('POST', { currentPassword: 'not-it-at-all', newPassword: 'a fine long password' }, tok), env);
    expect(wrong.status).toBe(401);
    const changed = await authRoutes.request(`${H}/password`, json('POST', { currentPassword: c.temporaryPassword, newPassword: 'a fine long password' }, tok), env);
    expect(changed.status).toBe(200);
    expect((await login('merch@brand.test', c.temporaryPassword)).status).toBe(401);
    const second = await login('merch@brand.test', 'a fine long password');
    expect([second.status, second.body.mustChangePassword]).toEqual([200, false]);
    const list = await authRoutes.request(`${H}/users`, bearer(admin), env);
    const users = ((await list.json()) as { users: Array<{ email: string; mustChangePassword: boolean }> }).users;
    expect(users.map((u) => [u.email, u.mustChangePassword])).toEqual([['admin@brand.test', false], ['merch@brand.test', false]]);
    expect(JSON.stringify(users)).not.toContain('pbkdf2');
    // Who did what, newest first, with the actor and the target.
    const audit = ((await (await authRoutes.request(`${H}/audit?limit=20`, bearer(admin), env)).json()) as { entries: Array<{ action: string; actorEmail: string | null; targetEmail: string | null }> }).entries;
    expect(audit[0]).toMatchObject({ action: 'sign_in', actorEmail: 'merch@brand.test' });
    expect(audit.map((e) => e.action)).toContain('password_changed');
    expect(audit.find((e) => e.action === 'account_created')).toMatchObject({ actorEmail: 'admin@brand.test', targetEmail: 'merch@brand.test' });
  });

  it('an operator is refused the admin\'s routes', async () => {
    const { env, login } = await stamp();
    const admin = (await login('admin@brand.test', 'provisioned-pw-1')).body.accessToken as string;
    const c = (await (await authRoutes.request(`${H}/users`, json('POST', { email: 'merch@brand.test', name: 'Merchandiser' }, admin), env)).json()) as { temporaryPassword: string };
    const op = (await login('merch@brand.test', c.temporaryPassword)).body.accessToken as string;
    expect((await authRoutes.request(`${H}/users`, bearer(op), env)).status).toBe(403);
    expect((await authRoutes.request(`${H}/users`, json('POST', { email: 'x@brand.test', name: 'Nobody' }, op), env)).status).toBe(403);
    expect((await authRoutes.request(`${H}/users`, {}, env)).status).toBe(401);
  });

  it('reset hands over a new temporary password and ends the session; disable refuses sign-in and renewal; remove deletes; an admin cannot lock themself out', async () => {
    const { env, login } = await stamp();
    const adminLogin = (await login('admin@brand.test', 'provisioned-pw-1')).body;
    const admin = adminLogin.accessToken as string;
    const c = (await (await authRoutes.request(`${H}/users`, json('POST', { email: 'merch@brand.test', name: 'Merchandiser' }, admin), env)).json()) as { user: { id: string }; temporaryPassword: string };
    const first = (await login('merch@brand.test', c.temporaryPassword)).body;
    const reset = (await (await authRoutes.request(`${H}/users/${c.user.id}/reset`, json('POST', {}, admin), env)).json()) as { temporaryPassword: string; user: { mustChangePassword: boolean } };
    expect(reset.user.mustChangePassword).toBe(true);
    expect((await login('merch@brand.test', c.temporaryPassword)).status).toBe(401);
    expect((await login('merch@brand.test', reset.temporaryPassword)).status).toBe(200);
    expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: first.refreshToken }), env)).status).toBe(401);
    const again = (await login('merch@brand.test', reset.temporaryPassword)).body;
    const disabled = await authRoutes.request(`${H}/users/${c.user.id}`, json('PATCH', { disabled: true }, admin), env);
    expect(((await disabled.json()) as { user: { disabled: boolean } }).user.disabled).toBe(true);
    expect((await login('merch@brand.test', reset.temporaryPassword)).status).toBe(403);
    expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: again.refreshToken }), env)).status).toBe(401);   // revoked with the disable
    expect((await authRoutes.request(`${H}/users/ops-1`, json('PATCH', { disabled: true }, admin), env)).status).toBe(400);
    expect((await authRoutes.request(`${H}/users/ops-1`, json('PATCH', { roles: ['operator'] }, admin), env)).status).toBe(400);
    expect((await authRoutes.request(`${H}/users/ops-1`, { method: 'DELETE', ...bearer(admin) }, env)).status).toBe(400);
    const removed = await authRoutes.request(`${H}/users/${c.user.id}`, { method: 'DELETE', ...bearer(admin) }, env);
    expect(((await removed.json()) as { removed: string }).removed).toBe('merch@brand.test');
    expect((await login('merch@brand.test', reset.temporaryPassword)).status).toBe(401);
  });
});
