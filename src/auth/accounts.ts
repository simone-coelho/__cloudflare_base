// src/auth/accounts.ts
// Operator accounts: a person per record, a password nobody can read back,
// roles that say what they may do, and the two flows an admin needs without
// an email service: a temporary password handed over once and changed at the
// first sign-in, and a reset that does the same. Records live in the CACHE
// store under `user:<email>` with a mirror under `user_id:<id>` for the refresh
// route. A record from before this module carries the password in the clear;
// it is verified once and rewritten as a hash at that sign-in.

import type { Env } from '@/types/env';

export type Role = 'operator' | 'admin';
export const ROLES: readonly Role[] = ['operator', 'admin'];

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  permissions: string[];
  /** `pbkdf2$<iterations>$<salt>$<hash>`, base64url. */
  password_hash?: string;
  /** Only on records from before hashing; removed at the first successful sign-in. */
  password?: string;
  must_change_password?: boolean;
  disabled?: boolean;
  createdAt?: number;
  updatedAt?: number;
  lastSignInAt?: number;
}

export interface PublicUser { id: string; email: string; name: string; roles: Role[]; disabled: boolean; mustChangePassword: boolean; createdAt: number | null; lastSignInAt: number | null }

const ITERATIONS = 100_000;
const enc = new TextEncoder();
const b64u = (bytes: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (ch) => ch.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64u(salt)}$${b64u(await derive(password, salt, ITERATIONS))}`;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!; return d === 0; };

/** Does the password fit the record? `upgrade` is the record rewritten with a hash when it still carried the password in the clear. */
export async function verifyPassword(password: string, user: UserRecord): Promise<{ ok: boolean; upgrade?: UserRecord }> {
  if (user.password_hash) {
    const [scheme, iter, salt, hash] = user.password_hash.split('$');
    if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return { ok: false };
    const got = await derive(password, unb64u(salt), Number(iter));
    return { ok: same(got, unb64u(hash)) };
  }
  if (typeof user.password === 'string') {
    if (!same(enc.encode(user.password), enc.encode(password))) return { ok: false };
    const { password: _plain, ...rest } = user;
    return { ok: true, upgrade: { ...rest, password_hash: await hashPassword(password), updatedAt: Date.now() } };
  }
  return { ok: false };
}

/** Sixteen characters from a safe alphabet, handed over once. */
export function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** A password a person may set: at least ten characters, not the email, not all one character. */
export function passwordProblem(password: string, email?: string): string | null {
  if (typeof password !== 'string' || password.length < 10) return 'A password needs at least ten characters.';
  if (password.length > 200) return 'A password may not be longer than two hundred characters.';
  if (email && password.toLowerCase().includes(email.toLowerCase().split('@')[0]!)) return 'A password may not contain your email.';
  if (/^(.)\1+$/.test(password)) return 'A password may not be one character repeated.';
  return null;
}

export const normalizeEmail = (email: string): string => String(email || '').trim().toLowerCase();
export const rolesOf = (roles: unknown): Role[] => { const out = (Array.isArray(roles) ? roles : []).filter((r): r is Role => (ROLES as readonly string[]).includes(String(r))); return out.length ? [...new Set(out)] : ['operator']; };
export const isAdmin = (roles: readonly string[] | undefined): boolean => Boolean(roles?.includes('admin'));

export function publicUser(u: UserRecord): PublicUser {
  return { id: u.id, email: u.email, name: u.name, roles: rolesOf(u.roles), disabled: Boolean(u.disabled), mustChangePassword: Boolean(u.must_change_password), createdAt: u.createdAt ?? null, lastSignInAt: u.lastSignInAt ?? null };
}

// ── The store ────────────────────────────────────────────────────────────────

type Store = Pick<Env, 'CACHE'>;
const emailKey = (email: string) => `user:${normalizeEmail(email)}`;
const idKey = (id: string) => `user_id:${id}`;
const isUser = (v: unknown): v is UserRecord => Boolean(v) && typeof v === 'object' && typeof (v as UserRecord).email === 'string' && typeof (v as UserRecord).id === 'string';

export async function getUserByEmail(env: Store, email: string): Promise<UserRecord | null> {
  const v = await env.CACHE.get(emailKey(email), 'json').catch(() => null);
  return isUser(v) ? v : null;
}
export async function getUserById(env: Store, id: string): Promise<UserRecord | null> {
  const v = await env.CACHE.get(idKey(id), 'json').catch(() => null);
  return isUser(v) ? v : null;
}
/** Writes the record under both keys. The email key is the truth; the id key is the mirror the refresh route reads. */
export async function putUser(env: Store, user: UserRecord): Promise<void> {
  const body = JSON.stringify(user);
  await env.CACHE.put(emailKey(user.email), body);
  await env.CACHE.put(idKey(user.id), body);
}
export async function deleteUser(env: Store, user: UserRecord): Promise<void> {
  await env.CACHE.delete(emailKey(user.email));
  await env.CACHE.delete(idKey(user.id));
}
/** Every account, by email. Anything under the prefix that is not an account is skipped. */
export async function listUsers(env: Store): Promise<UserRecord[]> {
  const out: UserRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.CACHE.list({ prefix: 'user:', cursor, limit: 1000 });
    for (const k of page.keys) {
      const v = await env.CACHE.get(k.name, 'json').catch(() => null);
      if (isUser(v)) out.push(v);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => a.email.localeCompare(b.email));
}

export function newUser(input: { email: string; name: string; roles?: unknown }, passwordHash: string, now = Date.now()): UserRecord {
  const roles = rolesOf(input.roles);
  return {
    id: `ops-${crypto.randomUUID().slice(0, 8)}`, email: normalizeEmail(input.email), name: String(input.name || '').trim(),
    roles, permissions: roles.includes('admin') ? ['*'] : ['read'],
    password_hash: passwordHash, must_change_password: true, disabled: false, createdAt: now, updatedAt: now,
  };
}
