// src/auth/accounts.ts
// Operator accounts: a person per record, a password nobody can read back,
// roles that say what they may do, and the two flows an admin needs without
// an email service: a temporary password handed over once and changed at the
// first sign-in, and a reset that does the same. The records live in D1
// (doc 30) behind the store in ./store; a record still in KV from before is
// moved at its owner's next sign-in and its KV keys deleted.

import type { Env } from '@/types/env';
import { d1Store, type AccountStore, type Role, type UserRecord } from './store';
export type { AccountStore, AuditEntry, AuditRow, Role, UserRecord } from './store';

export const ROLES: readonly Role[] = ['operator', 'admin'];

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

/** SHA-256 of a token, base64url: what the sessions table keeps instead of the token. */
export async function tokenHash(token: string): Promise<string> {
  return b64u(await crypto.subtle.digest('SHA-256', enc.encode(token)));
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

export function newUser(input: { email: string; name: string; roles?: unknown }, passwordHash: string, now = Date.now()): UserRecord {
  const roles = rolesOf(input.roles);
  return {
    id: `ops-${crypto.randomUUID().slice(0, 8)}`, email: normalizeEmail(input.email), name: String(input.name || '').trim(),
    roles, permissions: roles.includes('admin') ? ['*'] : ['read'],
    password_hash: passwordHash, must_change_password: true, disabled: false, createdAt: now, updatedAt: now,
  };
}

// ── The store, and the records still in KV ───────────────────────────────────

/** D1 on the worker; a test hands in its own store on the environment. */
export function storeFor(env: Pick<Env, 'DB' | 'ACCOUNTS'>): AccountStore {
  if (env.ACCOUNTS) return env.ACCOUNTS;
  return d1Store(env.DB as unknown as Parameters<typeof d1Store>[0]);
}

type KVLike = { get(key: string, type: 'json'): Promise<unknown>; delete(key: string): Promise<void> };
const isUser = (v: unknown): v is UserRecord => Boolean(v) && typeof v === 'object' && typeof (v as UserRecord).email === 'string' && typeof (v as UserRecord).id === 'string';

/** A record provisioning wrote to KV before D1 held the accounts, or null. */
export async function legacyRecord(env: Pick<Env, 'CACHE'>, email: string): Promise<UserRecord | null> {
  try { const v = await (env.CACHE as unknown as KVLike).get(`user:${normalizeEmail(email)}`, 'json'); return isUser(v) ? { ...v, email: normalizeEmail(v.email), roles: rolesOf(v.roles) } : null; } catch { return null; }
}
/** Once the record is in D1, the KV keys go. */
export async function forgetLegacy(env: Pick<Env, 'CACHE'>, user: UserRecord): Promise<void> {
  const kv = env.CACHE as unknown as KVLike;
  try { await kv.delete(`user:${normalizeEmail(user.email)}`); } catch { /* best effort */ }
  try { await kv.delete(`user_id:${user.id}`); } catch { /* best effort */ }
}
