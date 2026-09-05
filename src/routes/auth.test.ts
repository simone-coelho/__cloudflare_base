// src/routes/auth.test.ts
// The operator's session: sign in with the provisioned record, renew with the
// refresh token (which finds the user by id through the mirror the login
// writes), read who is signed in, sign out and be refused a renewal after.

import { describe, it, expect } from 'vitest';
import type { Env } from '@/types/env';
import { authRoutes } from './auth';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> { const raw = this.store.get(key); if (raw === undefined) return null; return type === 'json' ? JSON.parse(raw) : raw; }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}
const H = 'http://w';
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('the operator session', () => {
  it('signs in, renews, answers who, signs out, and refuses to renew after', async () => {
    const env = { CACHE: new FakeKV(), SESSIONS: new FakeKV(), JWT_SECRET: 's', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } as unknown as Env;
    // What provisioning writes: the record by email, nothing by id.
    await env.CACHE.put('user:ops@brand.test', JSON.stringify({ id: 'ops-1', email: 'ops@brand.test', name: 'Operator', password: 'password-1', roles: ['operator'], permissions: [] }));

    const refused = await authRoutes.request(`${H}/login`, json({ email: 'ops@brand.test', password: 'wrongpass-1' }), env);
    expect(refused.status).toBe(401);

    const login = await authRoutes.request(`${H}/login`, json({ email: 'ops@brand.test', password: 'password-1' }), env);
    expect(login.status).toBe(200);
    const l = (await login.json()) as { accessToken: string; refreshToken: string; user: { id: string; name: string }; expiresIn: number };
    expect(l.user).toMatchObject({ id: 'ops-1', name: 'Operator' });
    expect(l.expiresIn).toBe(900);

    const renew = await authRoutes.request(`${H}/refresh`, json({ refreshToken: l.refreshToken }), env);
    expect(renew.status).toBe(200);
    const r = (await renew.json()) as { accessToken: string; user: { id: string } };
    expect(r.accessToken).toBeTruthy();
    expect(r.user.id).toBe('ops-1');

    const me = await authRoutes.request(`${H}/me`, { headers: { authorization: `Bearer ${r.accessToken}` } }, env);
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { sub: string } }).user.sub).toBe('ops-1');

    const out = await authRoutes.request(`${H}/logout`, json({}, { authorization: `Bearer ${r.accessToken}` }), env);
    expect(out.status).toBe(200);
    const again = await authRoutes.request(`${H}/refresh`, json({ refreshToken: l.refreshToken }), env);
    expect(again.status).toBe(401);
  });
});
