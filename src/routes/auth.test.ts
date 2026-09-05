// src/routes/auth.test.ts
// The operator's session and accounts: a provisioned record with the password
// in the clear signs in once and is rewritten as a hash; an admin creates an
// account and gets the temporary password once; the person must change it at
// the first sign-in; reset, disable and remove end sessions; an operator is
// refused the admin's routes; there is no open registration.

import { describe, it, expect } from 'vitest';
import type { Env } from '@/types/env';
import { authRoutes } from './auth';
import { memoryStore } from '@/auth/store';

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

async function stamp() {
  const store = memoryStore();
  const env = { CACHE: new FakeKV(), ACCOUNTS: store, JWT_SECRET: 's', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } as unknown as Env;
  // What provisioning wrote to KV before D1 held the accounts: the record by email, the password in the clear, an admin.
  await env.CACHE.put('user:admin@brand.test', JSON.stringify({ id: 'ops-1', email: 'admin@brand.test', name: 'Admin', password: 'provisioned-pw-1', roles: ['operator', 'admin'], permissions: ['*'] }));
  await env.CACHE.put('user_id:ops-1', JSON.stringify({ id: 'ops-1', email: 'admin@brand.test', name: 'Admin', password: 'provisioned-pw-1', roles: ['operator', 'admin'], permissions: ['*'] }));
  const login = async (email: string, password: string) => { const r = await authRoutes.request(`${H}/login`, json('POST', { email, password }), env); return { status: r.status, body: (await r.json()) as Record<string, unknown> }; };
  return { env, store, login };
}

describe('the operator session', () => {
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
    expect(store.log.map((e) => e.action)).toEqual(['sign_in_failed', 'account_migrated', 'sign_in']);
    expect((await login('admin@brand.test', 'provisioned-pw-1')).status).toBe(200);   // still signs in, now against the hash, and a second browser does not end the first
    const renew = await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: l.body.refreshToken }), env);
    expect(renew.status).toBe(200);
    const r = (await renew.json()) as { accessToken: string };
    const me = await authRoutes.request(`${H}/me`, bearer(r.accessToken), env);
    expect(((await me.json()) as { account: { email: string } }).account.email).toBe('admin@brand.test');
    expect((await authRoutes.request(`${H}/logout`, json('POST', {}, r.accessToken), env)).status).toBe(200);
    expect((await authRoutes.request(`${H}/refresh`, json('POST', { refreshToken: l.body.refreshToken }), env)).status).toBe(401);
  });

  it('ten failed sign-ins in ten minutes lock the email for ten minutes, and the audit says so', async () => {
    const { login, store } = await stamp();
    for (let i = 0; i < 10; i++) expect((await login('admin@brand.test', `wrong-pw-${i}00`)).status).toBe(401);
    const locked = await login('admin@brand.test', 'provisioned-pw-1');
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('Too many failed sign-ins. Try again in ten minutes.');
    expect(store.log.filter((e) => e.action === 'sign_in_failed')).toHaveLength(10);
    expect(store.log.at(-1)?.action).toBe('sign_in_locked');
    // Another email is not locked by it.
    expect((await login('nobody@brand.test', 'whatever-pw-1')).status).toBe(401);
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
