// src/auth/accounts.test.ts
// A password nobody can read back, verified in constant time; a record from
// before hashing verified once and rewritten; a temporary password handed
// over once; the rules a chosen password must meet; the store, in memory,
// with the same interface D1 answers.

import { describe, it, expect } from 'vitest';
import { hashPassword, newUser, passwordProblem, publicUser, rolesOf, temporaryPassword, tokenHash, verifyPassword } from './accounts';
import { memoryStore } from './store';

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

  it('the store keeps a record by email and by id, lists accounts, and counts failed sign-ins', async () => {
    const store = memoryStore();
    const u = newUser({ email: 'ops@brand.test', name: 'Operator', roles: ['admin'] }, await hashPassword('a fine long password'));
    await store.put(u);
    expect((await store.getByEmail('OPS@brand.test'))?.id).toBe(u.id);
    expect((await store.getById(u.id))?.email).toBe('ops@brand.test');
    expect((await store.list()).map((x) => x.email)).toEqual(['ops@brand.test']);
    expect(publicUser(u)).toMatchObject({ email: 'ops@brand.test', roles: ['admin'], disabled: false, mustChangePassword: true });
    expect(JSON.stringify(publicUser(u))).not.toContain('pbkdf2');
    await store.audit({ at: 1000, action: 'sign_in_failed', targetEmail: 'ops@brand.test' });
    await store.audit({ at: 2000, action: 'sign_in_failed', targetEmail: 'ops@brand.test' });
    expect(await store.failedSignIns('ops@brand.test', 1500)).toBe(1);
    expect(await store.failedSignIns('ops@brand.test', 0)).toBe(2);
    await store.remove(u.id);
    expect(await store.getByEmail('ops@brand.test')).toBeNull();
  });

  it('a token is kept as its hash only', async () => {
    const h = await tokenHash('a.b.c');
    expect(h).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h).toBe(await tokenHash('a.b.c'));
    expect(h).not.toBe(await tokenHash('a.b.d'));
  });
});
