// src/auth/accounts.test.ts
// A password nobody can read back, verified in constant time; a record from
// before hashing verified once and rewritten; a temporary password handed
// over once; the rules a chosen password must meet; the store's two keys.

import { describe, it, expect } from 'vitest';
import type { Env } from '@/types/env';
import { deleteUser, getUserByEmail, getUserById, hashPassword, listUsers, newUser, passwordProblem, publicUser, putUser, rolesOf, temporaryPassword, verifyPassword } from './accounts';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> { const raw = this.store.get(key); if (raw === undefined) return null; return type === 'json' ? JSON.parse(raw) : raw; }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
  async list(opts: { prefix: string }) { return { keys: [...this.store.keys()].filter((k) => k.startsWith(opts.prefix)).map((name) => ({ name })), list_complete: true, cursor: undefined }; }
}

describe('operator accounts', () => {
  it('hashes a password so it cannot be read back, and verifies it', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h).toMatch(/^pbkdf2\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(h).not.toContain('correct');
    expect(await hashPassword('correct horse battery')).not.toBe(h);   // a fresh salt every time
    const user = newUser({ email: 'Ops@Brand.test', name: 'Operator', roles: ['operator'] }, h);
    expect((await verifyPassword('correct horse battery', user)).ok).toBe(true);
    expect((await verifyPassword('correct horse batter', user)).ok).toBe(false);
    expect(user.email).toBe('ops@brand.test');
    expect(user.must_change_password).toBe(true);
  });

  it('a record from before hashing is verified once and comes back rewritten as a hash', async () => {
    const legacy = { id: 'ops-1', email: 'ops@brand.test', name: 'Operator', roles: ['operator' as const], permissions: [], password: 'plain-text-pw' };
    const wrong = await verifyPassword('nope-nope-nope', legacy);
    expect(wrong).toEqual({ ok: false });
    const right = await verifyPassword('plain-text-pw', legacy);
    expect(right.ok).toBe(true);
    expect(right.upgrade?.password).toBeUndefined();
    expect(right.upgrade?.password_hash).toMatch(/^pbkdf2\$/);
    expect((await verifyPassword('plain-text-pw', right.upgrade!)).ok).toBe(true);
    expect(JSON.stringify(right.upgrade)).not.toContain('plain-text-pw');
  });

  it('a temporary password is sixteen safe characters, different every time; a chosen one must meet the rules', () => {
    const a = temporaryPassword(), b = temporaryPassword();
    expect(a).toMatch(/^[a-zA-Z2-9]{16}$/); expect(a).not.toBe(b);
    expect(passwordProblem('short')).toBe('A password needs at least ten characters.');
    expect(passwordProblem('aaaaaaaaaaaa')).toBe('A password may not be one character repeated.');
    expect(passwordProblem('ops-brand-1234', 'ops@brand.test')).toBe('A password may not contain your email.');
    expect(passwordProblem('a fine long password')).toBeNull();
    expect(rolesOf(['admin', 'nope', 'admin'])).toEqual(['admin']);
    expect(rolesOf([])).toEqual(['operator']);
  });

  it('the store keeps a record under its email and its id, lists accounts and skips what is not one', async () => {
    const env = { CACHE: new FakeKV() } as unknown as Env;
    await env.CACHE.put('user:not-an-account', JSON.stringify({ sessionId: 'x' }));
    const u = newUser({ email: 'ops@brand.test', name: 'Operator', roles: ['admin'] }, await hashPassword('a fine long password'));
    await putUser(env, u);
    expect((await getUserByEmail(env, 'OPS@brand.test'))?.id).toBe(u.id);
    expect((await getUserById(env, u.id))?.email).toBe('ops@brand.test');
    expect((await listUsers(env)).map((x) => x.email)).toEqual(['ops@brand.test']);
    expect(publicUser(u)).toMatchObject({ email: 'ops@brand.test', roles: ['admin'], disabled: false, mustChangePassword: true });
    expect(JSON.stringify(publicUser(u))).not.toContain('pbkdf2');
    await deleteUser(env, u);
    expect(await getUserByEmail(env, 'ops@brand.test')).toBeNull();
    expect(await getUserById(env, u.id)).toBeNull();
  });
});
