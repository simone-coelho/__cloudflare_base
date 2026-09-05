// src/routes/auth.ts
// The operator's session and accounts. A person signs in with an email and a
// password and gets a fifteen-minute access token and a seven-day refresh
// token; the session renews itself with the refresh token; signing out ends
// it. An admin creates accounts, hands over a temporary password once, resets
// one, disables one, removes one; everyone changes their own password, and
// must at their first sign-in. There is no open registration: on a public host
// that was a door anyone could walk through with any role (closed 2026-09-05).

import { Hono } from 'hono';
import { z } from 'zod';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import { jwt, type AuthContext } from '@/middleware/auth';
import {
  deleteUser, getUserByEmail, getUserById, hashPassword, isAdmin, listUsers, newUser, normalizeEmail, passwordProblem, publicUser, putUser, rolesOf, temporaryPassword, verifyPassword,
  type UserRecord,
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

async function mintAccess(env: Env, user: UserRecord): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  return new jose.SignJWT({ sub: user.id, email: user.email, name: user.name, roles: rolesOf(user.roles), permissions: user.permissions || [] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setExpirationTime(ACCESS_TTL).sign(secret);
}
/**
 * One refresh token per session, keyed by the token's random id, so a person signed in on two
 * browsers keeps both, and ending the account's sessions ends every one of them.
 */
async function mintRefresh(env: Env, user: UserRecord): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const jti = crypto.randomUUID();
  const token = await new jose.SignJWT({ sub: user.id, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' }).setJti(jti).setIssuedAt().setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setExpirationTime('7d').sign(secret);
  await env.SESSIONS.put(`refresh:${user.id}:${jti}`, token, { expirationTtl: 7 * 24 * 60 * 60 });
  return token;
}
/** Ends every session of the account: a reset, a disable, a removal, or a sign-out, which signs out everywhere. */
async function revokeRefresh(env: Env, id: string): Promise<void> {
  try {
    let cursor: string | undefined;
    do {
      const page = await env.SESSIONS.list({ prefix: `refresh:${id}:`, cursor, limit: 1000 });
      for (const k of page.keys) await env.SESSIONS.delete(k.name);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    await env.SESSIONS.delete(`refresh:${id}`);   // the key the sessions before this scheme used
  } catch { /* a revocation that fails leaves a token that expires within seven days */ }
}
const me = (c: { get: (k: 'auth') => AuthContext | undefined }) => c.get('auth')?.user ?? null;
/** Only an admin, and never a request whose token carries no id. */
const admin = jwt({ required: true, roles: ['admin'] });

// ── The session ──────────────────────────────────────────────────────────────

auth.post('/login', async (c) => {
  const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid credentials' }, 401);
  const { email, password } = parsed.data;
  const user = await getUserByEmail(c.env, email);
  if (!user) return c.json({ error: 'Invalid credentials' }, 401);
  const check = await verifyPassword(password, user);
  if (!check.ok) return c.json({ error: 'Invalid credentials' }, 401);
  if (user.disabled) return c.json({ error: 'This account is disabled' }, 403);
  const signed: UserRecord = { ...(check.upgrade ?? user), lastSignInAt: Date.now() };
  await putUser(c.env, signed);
  const [accessToken, refreshToken] = await Promise.all([mintAccess(c.env, signed), mintRefresh(c.env, signed)]);
  return c.json({ accessToken, refreshToken, user: publicUser(signed), mustChangePassword: Boolean(signed.must_change_password), expiresIn: EXPIRES_IN });
});

auth.post('/refresh', async (c) => {
  try {
    const { refreshToken } = RefreshSchema.parse(await c.req.json());
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jose.jwtVerify(refreshToken, secret, { issuer: c.env.JWT_ISSUER, audience: c.env.JWT_AUDIENCE });
    const stored = payload.jti ? await c.env.SESSIONS.get(`refresh:${payload.sub}:${payload.jti}`) : null;
    if (!stored || stored !== refreshToken) return c.json({ error: 'Invalid refresh token' }, 401);
    const user = await getUserById(c.env, String(payload.sub));
    if (!user) return c.json({ error: 'User not found' }, 404);
    if (user.disabled) { await revokeRefresh(c.env, user.id); return c.json({ error: 'This account is disabled' }, 403); }
    return c.json({ accessToken: await mintAccess(c.env, user), user: publicUser(user), mustChangePassword: Boolean(user.must_change_password), expiresIn: EXPIRES_IN });
  } catch {
    return c.json({ error: 'Token refresh failed' }, 401);
  }
});

auth.post('/logout', jwt(), async (c) => {
  const u = me(c);
  if (u) await revokeRefresh(c.env, u.sub);
  return c.json({ success: true });
});

auth.get('/me', jwt(), async (c) => {
  const u = me(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const user = await getUserById(c.env, u.sub);
  return c.json({ user: u, account: user ? publicUser(user) : null });
});

/** Anyone signed in changes their own password; the first sign-in with a temporary password must. */
auth.post('/password', jwt(), async (c) => {
  const u = me(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const parsed = PasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'currentPassword and newPassword are required' }, 400);
  const user = await getUserById(c.env, u.sub);
  if (!user) return c.json({ error: 'User not found' }, 404);
  const check = await verifyPassword(parsed.data.currentPassword, user);
  if (!check.ok) return c.json({ error: 'The current password was not accepted' }, 401);
  const problem = passwordProblem(parsed.data.newPassword, user.email);
  if (problem) return c.json({ error: problem }, 400);
  const next: UserRecord = { ...(check.upgrade ?? user), password_hash: await hashPassword(parsed.data.newPassword), must_change_password: false, updatedAt: Date.now() };
  delete next.password;
  await putUser(c.env, next);
  return c.json({ ok: true, user: publicUser(next) });
});

// ── Accounts, an admin's ─────────────────────────────────────────────────────

auth.get('/users', admin, async (c) => c.json({ ok: true, users: (await listUsers(c.env)).map(publicUser) }));

/** Creates the account and answers with the temporary password, once. The person changes it at their first sign-in. */
auth.post('/users', admin, async (c) => {
  const parsed = NewUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'email, name (2 to 80 characters) and optional roles are required' }, 400);
  if (await getUserByEmail(c.env, parsed.data.email)) return c.json({ error: 'An account with that email exists' }, 409);
  const temporary = temporaryPassword();
  const user = newUser(parsed.data, await hashPassword(temporary));
  await putUser(c.env, user);
  return c.json({ ok: true, user: publicUser(user), temporaryPassword: temporary }, 201);
});

auth.patch('/users/:id', admin, async (c) => {
  const user = await getUserById(c.env, c.req.param('id'));
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
  await putUser(c.env, next);
  if (next.disabled) await revokeRefresh(c.env, next.id);
  return c.json({ ok: true, user: publicUser(next) });
});

/** A new temporary password, answered once; the person's current session is ended. */
auth.post('/users/:id/reset', admin, async (c) => {
  const user = await getUserById(c.env, c.req.param('id'));
  if (!user) return c.json({ error: 'User not found' }, 404);
  const temporary = temporaryPassword();
  const next: UserRecord = { ...user, password_hash: await hashPassword(temporary), must_change_password: true, updatedAt: Date.now() };
  delete next.password;
  await putUser(c.env, next);
  await revokeRefresh(c.env, next.id);
  return c.json({ ok: true, user: publicUser(next), temporaryPassword: temporary });
});

auth.delete('/users/:id', admin, async (c) => {
  const user = await getUserById(c.env, c.req.param('id'));
  if (!user) return c.json({ error: 'User not found' }, 404);
  if (me(c)?.sub === user.id) return c.json({ error: 'You cannot remove your own account' }, 400);
  await deleteUser(c.env, user);
  await revokeRefresh(c.env, user.id);
  return c.json({ ok: true, removed: normalizeEmail(user.email) });
});

export { auth as authRoutes };
