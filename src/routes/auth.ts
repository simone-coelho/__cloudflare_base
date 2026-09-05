// src/routes/auth.ts
// The operator's session and accounts, on D1 (doc 30). A person signs in with
// an email and a password and gets a fifteen-minute access token and a
// seven-day refresh token; the session renews itself with the refresh token;
// signing out ends it. An admin creates accounts, hands over a temporary
// password once, resets one, disables one, removes one; everyone changes their
// own password, and must at their first sign-in. Every one of those is a row
// in the audit; ten failed sign-ins in ten minutes lock the email for ten
// minutes. There is no open registration: on a public host that was a door
// anyone could walk through with any role (closed 2026-09-05).

import { Hono } from 'hono';
import { z } from 'zod';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import { jwt, type AuthContext } from '@/middleware/auth';
import {
  forgetLegacy, hashPassword, isAdmin, legacyRecord, newUser, normalizeEmail, passwordProblem, publicUser, rolesOf, storeFor, temporaryPassword, tokenHash, verifyPassword,
  type AccountStore, type AuditEntry, type UserRecord,
} from '@/auth/accounts';

type Vars = { Variables: { auth: AuthContext } };
const auth = new Hono<{ Bindings: Env } & Vars>();

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
const RefreshSchema = z.object({ refreshToken: z.string() });
const PasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });
const NewUserSchema = z.object({ email: z.string().email(), name: z.string().min(2).max(80), roles: z.array(z.string()).optional() });
const PatchUserSchema = z.object({ name: z.string().min(2).max(80).optional(), roles: z.array(z.string()).optional(), disabled: z.boolean().optional() });

const ACCESS_TTL = '15m';
const EXPIRES_IN = 900;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOCKOUT_ATTEMPTS = 10;
export const LOCKOUT_WINDOW_MS = 10 * 60 * 1000;

async function mintAccess(env: Env, user: UserRecord): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  return new jose.SignJWT({ sub: user.id, email: user.email, name: user.name, roles: rolesOf(user.roles), permissions: user.permissions || [] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setExpirationTime(ACCESS_TTL).sign(secret);
}
/** One refresh token per session, its hash in the sessions table; the token itself is never stored. */
async function mintRefresh(env: Env, store: AccountStore, user: UserRecord): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const jti = crypto.randomUUID();
  const now = Date.now();
  const token = await new jose.SignJWT({ sub: user.id, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' }).setJti(jti).setIssuedAt().setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setExpirationTime('7d').sign(secret);
  await store.putSession({ jti, accountId: user.id, tokenHash: await tokenHash(token), createdAt: now, expiresAt: now + REFRESH_TTL_MS });
  return token;
}
const me = (c: { get: (k: 'auth') => AuthContext | undefined }) => c.get('auth')?.user ?? null;
const actor = (c: { get: (k: 'auth') => AuthContext | undefined }): Pick<AuditEntry, 'actorId' | 'actorEmail'> => { const u = me(c); return { actorId: u?.sub ?? null, actorEmail: u?.email ?? null }; };
/** Only an admin, and never a request whose token carries no id. */
const admin = jwt({ required: true, roles: ['admin'] });

// ── The session ──────────────────────────────────────────────────────────────

auth.post('/login', async (c) => {
  const store = storeFor(c.env);
  const now = Date.now();
  const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid credentials' }, 401);
  const email = normalizeEmail(parsed.data.email);
  const { password } = parsed.data;
  if ((await store.failedSignIns(email, now - LOCKOUT_WINDOW_MS)) >= LOCKOUT_ATTEMPTS) {
    await store.audit({ at: now, action: 'sign_in_locked', targetEmail: email });
    return c.json({ error: 'Too many failed sign-ins. Try again in ten minutes.' }, 429);
  }
  // The record: in D1, or still in KV from before, in which case it moves here on this sign-in.
  let user = await store.getByEmail(email);
  const legacy = user ? null : await legacyRecord(c.env, email);
  const candidate = user ?? legacy;
  const check = candidate ? await verifyPassword(password, candidate) : { ok: false };
  if (!candidate || !check.ok) {
    await store.audit({ at: now, action: 'sign_in_failed', targetEmail: email, targetId: candidate?.id ?? null });
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  if (candidate.disabled) return c.json({ error: 'This account is disabled' }, 403);
  const signed: UserRecord = { ...(check.upgrade ?? candidate), lastSignInAt: now, createdAt: candidate.createdAt ?? now, updatedAt: now };
  delete signed.password;
  await store.put(signed);
  if (legacy) { await forgetLegacy(c.env, legacy); await store.audit({ at: now, action: 'account_migrated', targetId: signed.id, targetEmail: signed.email, detail: 'moved from KV to D1 at sign-in' }); }
  user = signed;
  const [accessToken, refreshToken] = await Promise.all([mintAccess(c.env, user), mintRefresh(c.env, store, user)]);
  await store.audit({ at: now, action: 'sign_in', actorId: user.id, actorEmail: user.email, targetId: user.id, targetEmail: user.email });
  return c.json({ accessToken, refreshToken, user: publicUser(user), mustChangePassword: Boolean(user.must_change_password), expiresIn: EXPIRES_IN });
});

auth.post('/refresh', async (c) => {
  const store = storeFor(c.env);
  try {
    const { refreshToken } = RefreshSchema.parse(await c.req.json());
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jose.jwtVerify(refreshToken, secret, { issuer: c.env.JWT_ISSUER, audience: c.env.JWT_AUDIENCE });
    const session = payload.jti ? await store.getSession(payload.jti) : null;
    if (!session || session.accountId !== payload.sub || session.expiresAt < Date.now() || session.tokenHash !== (await tokenHash(refreshToken))) return c.json({ error: 'Invalid refresh token' }, 401);
    const user = await store.getById(String(payload.sub));
    if (!user) return c.json({ error: 'User not found' }, 404);
    if (user.disabled) { await store.revokeSessions(user.id); return c.json({ error: 'This account is disabled' }, 403); }
    return c.json({ accessToken: await mintAccess(c.env, user), user: publicUser(user), mustChangePassword: Boolean(user.must_change_password), expiresIn: EXPIRES_IN });
  } catch {
    return c.json({ error: 'Token refresh failed' }, 401);
  }
});

/** Signs out everywhere: every session of the account ends. */
auth.post('/logout', jwt(), async (c) => {
  const store = storeFor(c.env);
  const u = me(c);
  if (u) { await store.revokeSessions(u.sub); await store.audit({ at: Date.now(), action: 'sign_out', ...actor(c), targetId: u.sub, targetEmail: u.email ?? null }); }
  return c.json({ success: true });
});

auth.get('/me', jwt(), async (c) => {
  const u = me(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const user = await storeFor(c.env).getById(u.sub);
  return c.json({ user: u, account: user ? publicUser(user) : null });
});

/** Anyone signed in changes their own password; the first sign-in with a temporary password must. */
auth.post('/password', jwt(), async (c) => {
  const store = storeFor(c.env);
  const u = me(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const parsed = PasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'currentPassword and newPassword are required' }, 400);
  const user = await store.getById(u.sub);
  if (!user) return c.json({ error: 'User not found' }, 404);
  const check = await verifyPassword(parsed.data.currentPassword, user);
  if (!check.ok) return c.json({ error: 'The current password was not accepted' }, 401);
  const problem = passwordProblem(parsed.data.newPassword, user.email);
  if (problem) return c.json({ error: problem }, 400);
  const next: UserRecord = { ...user, password_hash: await hashPassword(parsed.data.newPassword), must_change_password: false, updatedAt: Date.now() };
  await store.put(next);
  await store.audit({ at: Date.now(), action: 'password_changed', ...actor(c), targetId: user.id, targetEmail: user.email });
  return c.json({ ok: true, user: publicUser(next) });
});

// ── Accounts, an admin's ─────────────────────────────────────────────────────

auth.get('/users', admin, async (c) => c.json({ ok: true, users: (await storeFor(c.env).list()).map(publicUser) }));

/** Who did what, newest first: the record a security team asks for. */
auth.get('/audit', admin, async (c) => {
  const limit = Math.max(1, Math.min(500, Number(c.req.query('limit')) || 50));
  return c.json({ ok: true, entries: await storeFor(c.env).recentAudit(limit) });
});

/** Creates the account and answers with the temporary password, once. The person changes it at their first sign-in. */
auth.post('/users', admin, async (c) => {
  const store = storeFor(c.env);
  const parsed = NewUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'email, name (2 to 80 characters) and optional roles are required' }, 400);
  if (await store.getByEmail(parsed.data.email) || await legacyRecord(c.env, parsed.data.email)) return c.json({ error: 'An account with that email exists' }, 409);
  const temporary = temporaryPassword();
  const user = newUser(parsed.data, await hashPassword(temporary));
  await store.put(user);
  await store.audit({ at: Date.now(), action: 'account_created', ...actor(c), targetId: user.id, targetEmail: user.email, detail: `roles ${user.roles.join(',')}` });
  return c.json({ ok: true, user: publicUser(user), temporaryPassword: temporary }, 201);
});

auth.patch('/users/:id', admin, async (c) => {
  const store = storeFor(c.env);
  const user = await store.getById(c.req.param('id'));
  if (!user) return c.json({ error: 'User not found' }, 404);
  const parsed = PatchUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'name, roles or disabled' }, 400);
  const self = me(c);
  if (parsed.data.disabled === true && self?.sub === user.id) return c.json({ error: 'You cannot disable your own account' }, 400);
  if (parsed.data.roles && self?.sub === user.id && !isAdmin(rolesOf(parsed.data.roles))) return c.json({ error: 'You cannot take admin away from your own account' }, 400);
  const next: UserRecord = {
    ...user,
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.roles !== undefined ? { roles: rolesOf(parsed.data.roles), permissions: isAdmin(rolesOf(parsed.data.roles)) ? ['*'] : ['read'] } : {}),
    ...(parsed.data.disabled !== undefined ? { disabled: parsed.data.disabled } : {}),
    updatedAt: Date.now(),
  };
  await store.put(next);
  if (next.disabled) await store.revokeSessions(next.id);
  const action = parsed.data.disabled === true ? 'account_disabled' : parsed.data.disabled === false ? 'account_enabled' : 'account_changed';
  await store.audit({ at: Date.now(), action, ...actor(c), targetId: next.id, targetEmail: next.email, detail: JSON.stringify(parsed.data) });
  return c.json({ ok: true, user: publicUser(next) });
});

/** A new temporary password, answered once; the person's sessions end. */
auth.post('/users/:id/reset', admin, async (c) => {
  const store = storeFor(c.env);
  const user = await store.getById(c.req.param('id'));
  if (!user) return c.json({ error: 'User not found' }, 404);
  const temporary = temporaryPassword();
  const next: UserRecord = { ...user, password_hash: await hashPassword(temporary), must_change_password: true, updatedAt: Date.now() };
  await store.put(next);
  await store.revokeSessions(next.id);
  await store.audit({ at: Date.now(), action: 'account_reset', ...actor(c), targetId: next.id, targetEmail: next.email });
  return c.json({ ok: true, user: publicUser(next), temporaryPassword: temporary });
});

auth.delete('/users/:id', admin, async (c) => {
  const store = storeFor(c.env);
  const user = await store.getById(c.req.param('id'));
  if (!user) return c.json({ error: 'User not found' }, 404);
  if (me(c)?.sub === user.id) return c.json({ error: 'You cannot remove your own account' }, 400);
  await store.remove(user.id);
  await store.revokeSessions(user.id);
  await store.audit({ at: Date.now(), action: 'account_removed', ...actor(c), targetId: user.id, targetEmail: user.email });
  return c.json({ ok: true, removed: normalizeEmail(user.email) });
});

export { auth as authRoutes };
