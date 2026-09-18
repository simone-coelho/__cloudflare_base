// src/routes/auth.ts
// The operator's session and accounts, on D1 (doc 30). A person signs in with
// an email and a password and gets a fifteen-minute access token and a
// seven-day refresh token; the session renews itself with the refresh token;
// signing out ends it. An admin creates accounts, hands over a temporary
// password once, resets one, disables one, removes one; everyone changes their
// own password, and must at their first sign-in. Every one of those is a row
// in the audit. Anonymous sign-in work has bounded source and stamp budgets.
// There is no open registration: on a public host that was a door
// anyone could walk through with any role (closed 2026-09-05).

import { Hono } from 'hono';
import { z } from 'zod';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import { jwt, type AuthContext } from '@/middleware/auth';
import { readSigningConfig, SIGNING_CONFIGURATION_UNAVAILABLE, type SigningConfig } from '@/auth/signingConfig.mjs';
import { admitLogin, LOGIN_BUDGET_UNAVAILABLE, readLoginBody } from '@/auth/loginBudget';
import {
  forgetLegacy, hashPassword, isAdmin, legacyRecord, newUser, normalizeEmail, passwordProblem, publicUser, rolesOf, storeFor, temporaryPassword, tokenHash, verifyPassword,
  type AuditEntry, type UserRecord,
} from '@/auth/accounts';
import type { AccountPatch, CurrentHumanActor, SessionRow } from '@/auth/store';
import { authorityFor, customerAuthority, stampOwner, type AuthorityActor, type Membership, type ServiceCredential } from '@/auth/authority';
import { tenantConfig } from '@/tenancy/middleware';
import { isValidTenantId } from '@/tenancy/tenant';
import { assertFederationSession, callbackOIDC, completeOIDC, federationInput, federationStatus, oidcBody, oidcCookie, provisionFederation, startOIDC } from '@/auth/oidc';

type Vars = { Variables: { auth: AuthContext; tenant: string } };
const auth = new Hono<{ Bindings: Env } & Vars>();
auth.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
const RefreshSchema = z.object({ refreshToken: z.string() });
const PasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });
const NewUserSchema = z.object({ email: z.string().email(), name: z.string().min(2).max(80), roles: z.array(z.string()).optional() });
const PatchUserSchema = z.object({ name: z.string().min(2).max(80).optional(), roles: z.array(z.string()).optional(), disabled: z.boolean().optional() });

const ACCESS_TTL = '15m';
const EXPIRES_IN = 900;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function mintAccess(signing: SigningConfig, user: UserRecord, sid: string, session?: SessionRow): Promise<string> {
  return new jose.SignJWT({ sub: user.id, type: 'access', sid, ...(session?.authMethod === 'oidc' ? { authMethod: 'oidc' } : {}), email: user.email, name: user.name, roles: rolesOf(user.roles), permissions: user.permissions || [] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(signing.issuer).setAudience(signing.audience)
    .setExpirationTime(session?.authMethod === 'oidc' ? Math.floor(Math.min(session.expiresAt, Date.now() + 900000) / 1000) : ACCESS_TTL).sign(signing.key);
}
/** One refresh token per session, its hash in the sessions table; the token itself is never stored. */
async function prepareSession(signing: SigningConfig, user: UserRecord): Promise<{ accessToken: string; refreshToken: string; session: SessionRow }> {
  const jti = crypto.randomUUID();
  const now = Date.now();
  const token = await new jose.SignJWT({ sub: user.id, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' }).setJti(jti).setIssuedAt().setIssuer(signing.issuer).setAudience(signing.audience).setExpirationTime('7d').sign(signing.key);
  const session = { jti, accountId: user.id, tokenHash: await tokenHash(token), createdAt: now, expiresAt: now + REFRESH_TTL_MS };
  return { accessToken: await mintAccess(signing, user, jti), refreshToken: token, session };
}
const ACCOUNT_CONFLICT = 'Account or session changed. Sign in again and retry.';
const selfservice = () => jwt({ accountSession: true, allowPasswordChange: true });
const me = (c: { get: (k: 'auth') => AuthContext | undefined }) => c.get('auth')?.user ?? null;
const actor = (c: { get: (k: 'auth') => AuthContext | undefined }): Pick<AuditEntry, 'actorId' | 'actorEmail'> => { const u = me(c); return { actorId: u?.sub ?? null, actorEmail: u?.email ?? null }; };
const ownerCondition = (c: { env: Env; get: (k: 'auth') => AuthContext | undefined }): CurrentHumanActor | undefined => {
  if (!customerAuthority(c.env)) return undefined;
  const auth = c.get('auth');
  if (!auth?.user?.sid || auth.authority?.accountRevision === undefined) throw new Error('Owner authority unavailable');
  return { id: auth.user.sub, sid: auth.user.sid, accountRevision: auth.authority.accountRevision, federation: auth.authority.federation };
};
/** Shared identity administration is distinct from tenant membership authority. */
const admin: ReturnType<typeof jwt> = async (c, next) => {
  c.header('Cache-Control', 'no-store');
  const customer = customerAuthority(c.env);
  return jwt(customer ? { accountSession: true } : { required: true, roles: ['admin'] })(c, async () => {
    if (customer ? !stampOwner(c.env, c.get('auth')?.user?.sub) : c.env.AUTH_MODE === 'enforced') {
      c.res = c.json({ error: 'Global account administration unavailable' }, 403);
      return;
    }
    await next();
  });
};

// ── The session ──────────────────────────────────────────────────────────────

auth.post('/oidc/start', async (c) => {
  try {
    const signing = readSigningConfig(c.env); if (!signing) return c.json({ error: SIGNING_CONFIGURATION_UNAVAILABLE }, 503);
    const budget = await admitLogin(c.env, signing, c.req.raw);
    if (!budget) return c.json({ error: LOGIN_BUDGET_UNAVAILABLE }, 503);
    if (!budget.allowed) return c.json({ error: 'Sign-in rate limited' }, 429);
    const body = z.object({ email: z.string().email().max(254) }).strict().parse(await oidcBody(c.req.raw));
    const result = await startOIDC(c.env, c.get('tenant'), c.req.raw, normalizeEmail(body.email));
    c.header('Set-Cookie', result.cookie); return c.json({ authorizationUrl: result.location });
  } catch { return c.json({ error: 'Federated sign-in unavailable' }, 401); }
});
auth.get('/oidc/callback/:tenant', async (c) => {
  c.header('Referrer-Policy', 'no-referrer');
  try {
    if (c.get('tenant') !== c.req.param('tenant')) throw new Error('Tenant mismatch');
    const result = await callbackOIDC(c.env, c.get('tenant'), c.req.raw);
    return c.redirect(result.location, 303);
  } catch { return c.json({ error: 'Federated sign-in unavailable' }, 401); }
});
auth.post('/oidc/complete', async (c) => {
  try {
    const result = await completeOIDC(c.env, c.get('tenant'), c.req.raw);
    c.header('Set-Cookie', oidcCookie(c.get('tenant'), '', 0)); return c.json(result as Record<string, unknown>);
  } catch { return c.json({ error: 'Federated sign-in unavailable' }, 401); }
});

auth.post('/login', async (c) => {
  const signing = readSigningConfig(c.env);
  if (!signing) {
    c.header('Cache-Control', 'no-store');
    return c.json({ error: SIGNING_CONFIGURATION_UNAVAILABLE }, 503);
  }
  const budget = await admitLogin(c.env, signing, c.req.raw);
  if (!budget) return c.json({ error: LOGIN_BUDGET_UNAVAILABLE }, 503);
  if (!budget.allowed) {
    c.header('Retry-After', String(Math.max(1, Math.ceil((budget.resetTime - Date.now()) / 1000))));
    c.header('X-RateLimit-Reset', String(budget.resetTime));
    return c.json({ error: 'Too many sign-in requests. Try again after the current window.' }, 429);
  }
  const body = await readLoginBody(c.req.raw);
  if (body.overflow) return c.json({ error: 'Sign-in body exceeds 4096 bytes' }, 413);
  const parsed = LoginSchema.safeParse(body.value);
  if (!parsed.success) return c.json({ error: 'Invalid credentials' }, 401);
  const store = storeFor(c.env);
  const now = Date.now();
  const email = normalizeEmail(parsed.data.email);
  const { password } = parsed.data;
  // The record: in D1, or still in KV from before, in which case it moves here on this sign-in.
  const user = await store.getByEmail(email);
  const legacy = user ? null : await legacyRecord(c.env, email);
  const candidate = user ?? legacy;
  if (!candidate) {
    // Spend the existing 100,000-iteration derivation, then always reject.
    // This removes the no-KDF branch; it does not establish constant timing.
    await hashPassword(password);
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  const check = await verifyPassword(password, candidate);
  if (!check.ok) return c.json({ error: 'Invalid credentials' }, 401);
  if (candidate.disabled) return c.json({ error: 'This account is disabled' }, 403);
  const signed: UserRecord = legacy ? { ...(check.upgrade ?? candidate), createdAt: candidate.createdAt ?? now, updatedAt: now } : { ...candidate };
  delete signed.password;
  const { accessToken, refreshToken, session } = await prepareSession(signing, signed);
  if (legacy && !await store.importLegacy(signed)) return c.json({ error: ACCOUNT_CONFLICT }, 409);
  const completedAt = Date.now();
  if (!await store.completeSignIn(signed, session, completedAt)) return c.json({ error: ACCOUNT_CONFLICT }, 409);
  if (legacy) { await forgetLegacy(c.env, legacy); await store.audit({ at: now, action: 'account_migrated', targetId: signed.id, targetEmail: signed.email, detail: 'moved from KV to D1 at sign-in' }); }
  await store.audit({ at: completedAt, action: 'sign_in', actorId: signed.id, actorEmail: signed.email, targetId: signed.id, targetEmail: signed.email });
  return c.json({ accessToken, refreshToken, user: publicUser({ ...signed, lastSignInAt: completedAt }), mustChangePassword: Boolean(signed.must_change_password), expiresIn: EXPIRES_IN });
});

auth.post('/refresh', async (c) => {
  const signing = readSigningConfig(c.env);
  if (!signing) {
    c.header('Cache-Control', 'no-store');
    return c.json({ error: SIGNING_CONFIGURATION_UNAVAILABLE }, 503);
  }
  try {
    const { refreshToken } = RefreshSchema.parse(await c.req.json());
    const { payload } = await jose.jwtVerify(refreshToken, signing.key, { issuer: signing.issuer, audience: signing.audience, algorithms: ['HS256'] });
    if (payload.type !== 'refresh' || typeof payload.sub !== 'string' || !payload.sub.trim()
      || typeof payload.jti !== 'string' || !payload.jti.trim()
      || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return c.json({ error: 'Invalid refresh token' }, 401);
    const store = storeFor(c.env);
    const session = await store.getSession(payload.jti);
    if (!session || session.jti !== payload.jti || session.accountId !== payload.sub || !Number.isFinite(session.expiresAt)
      || session.expiresAt <= Date.now() || session.tokenHash !== (await tokenHash(refreshToken))) return c.json({ error: 'Invalid refresh token' }, 401);
    const user = await store.getById(String(payload.sub));
    if (!user || user.id !== payload.sub) return c.json({ error: 'User not found' }, 404);
    if (user.disabled) { await store.revokeSessions(user.id); return c.json({ error: 'This account is disabled' }, 403); }
    await assertFederationSession(c.env, user, session, payload.authMethod);
    const accessToken = await mintAccess(signing, user, session.jti, session);
    await assertFederationSession(c.env, user, session, payload.authMethod);
    return c.json({ accessToken, user: publicUser(user), mustChangePassword: Boolean(user.must_change_password), expiresIn: Math.min(EXPIRES_IN, Math.floor((session.expiresAt - Date.now()) / 1000)) });
  } catch {
    return c.json({ error: 'Token refresh failed' }, 401);
  }
});

/** Signs out everywhere: every session of the account ends. */
auth.post('/logout', selfservice(), async (c) => {
  const store = storeFor(c.env);
  const u = me(c);
  if (u) { await store.revokeSessions(u.sub); await store.audit({ at: Date.now(), action: 'sign_out', ...actor(c), targetId: u.sub, targetEmail: u.email ?? null }); }
  return c.json({ success: true });
});

auth.get('/me', selfservice(), async (c) => {
  const u = me(c);
  if (!u) return c.json({ error: 'Not authenticated' }, 401);
  const user = await storeFor(c.env).getById(u.sub);
  return c.json({ user: u, account: user ? publicUser(user) : null });
});

/** Anyone signed in changes their own password; the first sign-in with a temporary password must. */
auth.post('/password', selfservice(), async (c) => {
  const signing = readSigningConfig(c.env);
  if (!signing) return c.json({ error: SIGNING_CONFIGURATION_UNAVAILABLE }, 503);
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
  const next: UserRecord = { ...user, password_hash: await hashPassword(parsed.data.newPassword), must_change_password: false };
  const { session, ...tokens } = await prepareSession(signing, next);
  if (!u.sid || !await store.replacePassword(user, u.sid, next.password_hash!, session, Date.now())) return c.json({ error: ACCOUNT_CONFLICT }, 409);
  await store.audit({ at: Date.now(), action: 'password_changed', ...actor(c), targetId: user.id, targetEmail: user.email });
  return c.json({ ok: true, user: publicUser(next), ...tokens, mustChangePassword: false, expiresIn: EXPIRES_IN });
});

// ── Accounts, an admin's ─────────────────────────────────────────────────────

auth.get('/users', admin, async (c) => c.json({ ok: true, users: (await storeFor(c.env).list()).map(publicUser) }));

auth.get('/users/:id/federation', admin, async (c) => {
  const user = await storeFor(c.env).getById(c.req.param('id')); if (!user) return c.json({ error: 'User not found' }, 404);
  return c.json(await federationStatus(c.env, user) as Record<string, unknown>);
});
auth.on(['PUT', 'DELETE'], '/users/:id/federation', admin, async (c) => {
  try {
    if (!stampOwner(c.env, me(c)?.sub)) return c.json({ error: 'Stamp owner required' }, 403);
    const user = await storeFor(c.env).getById(c.req.param('id')), principal = ownerCondition(c);
    if (!user || !principal) return c.json({ error: ACCOUNT_CONFLICT }, 409);
    const input = c.req.method === 'PUT' ? federationInput.parse(await oidcBody(c.req.raw)) : null;
    await provisionFederation(c.env, user, input, principal); return c.json({ ok: true });
  } catch { return c.json({ error: ACCOUNT_CONFLICT }, 409); }
});

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
  if (await store.getByEmail(parsed.data.email)) return c.json({ error: 'An account with that email exists' }, 409);
  const legacy = await legacyRecord(c.env, parsed.data.email);
  if (legacy && !await store.hasRemoval(legacy)) return c.json({ error: 'An account with that email exists' }, 409);
  const temporary = temporaryPassword();
  const user = newUser(parsed.data, await hashPassword(temporary));
  if (!await store.create(user, ownerCondition(c))) return c.json({ error: 'Account exists or owner authority changed' }, 409);
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
  const patch: AccountPatch = {
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.roles !== undefined ? { roles: rolesOf(parsed.data.roles), permissions: isAdmin(rolesOf(parsed.data.roles)) ? ['*'] : ['read'] } : {}),
    ...(parsed.data.disabled !== undefined ? { disabled: parsed.data.disabled } : {}),
  };
  if (!await store.patchAccount(user, patch, Date.now(), ownerCondition(c))) return c.json({ error: ACCOUNT_CONFLICT }, 409);
  const next = { ...user, ...patch };
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
  if (!await store.resetPassword(user, next.password_hash!, Date.now(), ownerCondition(c))) return c.json({ error: ACCOUNT_CONFLICT }, 409);
  await store.audit({ at: Date.now(), action: 'account_reset', ...actor(c), targetId: next.id, targetEmail: next.email });
  return c.json({ ok: true, user: publicUser(next), temporaryPassword: temporary });
});

auth.delete('/users/:id', admin, async (c) => {
  const store = storeFor(c.env);
  const user = await store.getById(c.req.param('id'));
  if (!user) return c.json({ error: 'User not found' }, 404);
  if (me(c)?.sub === user.id) return c.json({ error: 'You cannot remove your own account' }, 400);
  if (!await store.removeAccount(user, { at: Date.now(), ...actor(c) }, ownerCondition(c))) return c.json({ error: ACCOUNT_CONFLICT }, 409);
  return c.json({ ok: true, removed: normalizeEmail(user.email) });
});

// ── Customer membership and machine authority ────────────────────────────────

const MemberSchema = z.object({ accountId: z.string().min(1).max(200), role: z.enum(['operator', 'admin']).default('operator') }).strict();
const MemberPatch = z.object({ role: z.enum(['operator', 'admin']).optional(), disabled: z.boolean().optional(),
  regrant: z.literal(true).optional() }).strict().refine(v => Object.keys(v).length > 0);
const ServiceSchema = z.object({ id: z.string().uuid(), subject: z.string().min(1).max(200).refine(s => s.trim() === s),
  role: z.enum(['operator', 'admin']).default('operator'), expiresAt: z.number().int().positive().refine(Number.isSafeInteger),
  replaces: z.string().uuid().optional() }).strict();
const conflict = () => ({ error: 'Authority changed or operation already exists. Reload before retrying.' });
const publicCredential = ({ tokenHash: _hash, ...row }: ServiceCredential) => row;

/** Do not derive a tenant from the body or grant list; ingress owns it. */
function selectedTenant(c: { env: Env; get(key: 'tenant'): string }): string | null {
  const tenant = c.get('tenant');
  try { return isValidTenantId(tenant) && tenantConfig(c.env).provisioned.includes(tenant) ? tenant : null; }
  catch { return null; }
}
const customerHuman: ReturnType<typeof jwt> = async (c, next) => {
  if (!customerAuthority(c.env)) return c.json({ error: 'Customer authority required' }, 403);
  return jwt({ accountSession: true })(c, next);
};
async function authorityActor(c: { env: Env; get(key: 'auth'): AuthContext; get(key: 'tenant'): string }, ownerOnly = false): Promise<AuthorityActor | null> {
  const auth = c.get('auth'), u = auth?.user, tenant = selectedTenant(c);
  if (!tenant || !u?.sid || u.type !== 'access' || auth.authority?.accountRevision === undefined) return null;
  const owner = stampOwner(c.env, u.sub), membership = owner ? null : await authorityFor(c.env).member(u.sub, tenant);
  if (!owner && (ownerOnly || !membership || membership.disabled || membership.removed || membership.role !== 'admin')) return null;
  return { id: u.sub, sid: u.sid, accountRevision: auth.authority.accountRevision, owner, tenant, membershipRevision: membership?.revision, federation: auth.authority.federation };
}

auth.get('/authority', selfservice(), async (c) => {
  const u = me(c), tenant = selectedTenant(c);
  if (!customerAuthority(c.env)) return c.json({ customer: false, stampOwner: Boolean(u?.roles?.includes('admin')), tenant });
  const user = u && await storeFor(c.env).getById(u.sub);
  if (!user || user.must_change_password) return c.json({ error: 'Password change required' }, 403);
  const owner = stampOwner(c.env, u?.sub), member = tenant && u ? await authorityFor(c.env).member(u.sub, tenant) : null;
  return c.json({ customer: true, stampOwner: owner, tenant,
    tenantRole: member && !member.disabled && !member.removed ? member.role : null });
});

auth.get('/memberships', customerHuman, async (c) => {
  const actor = await authorityActor(c);
  if (!actor) return c.json({ error: 'Tenant membership administration required' }, 403);
  const after = c.req.query('after');
  if (after !== undefined && (!after || after.length > 200)) return c.json({ error: 'Invalid membership cursor' }, 400);
  const page = await authorityFor(c.env).members(actor.tenant, after), store = storeFor(c.env);
  const users = await Promise.all(page.items.map(async member => {
    const user = await store.getById(member.accountId);
    return user ? { ...publicUser(user), ...member, roles: [member.role], accountDisabled: Boolean(user.disabled) } : null;
  }));
  return c.json({ ok: true, tenant: actor.tenant, users: users.filter(Boolean), next: page.next });
});
auth.post('/memberships', customerHuman, async (c) => {
  const actor = await authorityActor(c);
  if (!actor) return c.json({ error: 'Tenant membership administration required' }, 403);
  const body = MemberSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Existing accountId and tenant role are required' }, 400);
  const at = Date.now(), next: Membership = { ...body.data, tenant: actor.tenant, disabled: false, removed: false, revision: crypto.randomUUID(), updatedAt: at };
  if (!await authorityFor(c.env).changeMember(null, next, actor, at)) return c.json(conflict(), 409);
  return c.json({ ok: true, membership: next }, 201);
});
auth.on(['PATCH', 'DELETE'], '/memberships/:id', customerHuman, async (c) => {
  const actor = await authorityActor(c);
  if (!actor) return c.json({ error: 'Tenant membership administration required' }, 403);
  const store = authorityFor(c.env), current = await store.member(c.req.param('id'), actor.tenant);
  if (!current) return c.json({ error: 'Membership not found' }, 404);
  if (c.req.header('If-Match') !== JSON.stringify(current.revision)) return c.json(conflict(), 409);
  const deleting = c.req.method === 'DELETE';
  const body = deleting ? null : MemberPatch.safeParse(await c.req.json().catch(() => null));
  if (body && !body.success) return c.json({ error: 'Only tenant role, disabled or explicit regrant may be changed' }, 400);
  const patch = body?.success ? body.data : {};
  if (current.removed && (deleting || patch.regrant !== true)) return c.json(conflict(), 409);
  if (current.accountId === actor.id && (deleting || patch.disabled === true || patch.role === 'operator')) {
    return c.json({ error: 'You cannot remove your own tenant administration' }, 400);
  }
  const at = Date.now(), next = deleting ? null : { ...current, role: patch.role ?? current.role,
    disabled: patch.disabled ?? (patch.regrant ? false : current.disabled), removed: false, revision: crypto.randomUUID(), updatedAt: at };
  if (!await store.changeMember(current, next, actor, at)) return c.json(conflict(), 409);
  return c.json({ ok: true, membership: next });
});

auth.get('/service-credentials', customerHuman, async (c) => {
  const actor = await authorityActor(c, true);
  if (!actor) return c.json({ error: 'Stamp owner required' }, 403);
  const after = c.req.query('after');
  if (after !== undefined && !z.string().uuid().safeParse(after).success) return c.json({ error: 'Invalid credential cursor' }, 400);
  const page = await authorityFor(c.env).credentials(actor.tenant, after);
  return c.json({ ok: true, credentials: page.items.map(publicCredential), next: page.next });
});
auth.post('/service-credentials', customerHuman, async (c) => {
  const actor = await authorityActor(c, true);
  if (!actor) return c.json({ error: 'Stamp owner required' }, 403);
  const parsed = ServiceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.expiresAt <= Math.floor(Date.now() / 1000)) return c.json({ error: 'Explicit credential ID, subject, role and future expiry are required' }, 400);
  const signing = readSigningConfig(c.env);
  if (!signing) return c.json({ error: SIGNING_CONFIGURATION_UNAVAILABLE }, 503);
  const input = parsed.data, store = authorityFor(c.env), at = Date.now();
  const replaced = input.replaces ? await store.credential(input.replaces) : null;
  if (input.replaces && (!replaced || replaced.tenant !== actor.tenant || replaced.revokedAt !== null)) return c.json(conflict(), 409);
  const token = await new jose.SignJWT({ type: 'service', sub: input.subject, roles: [input.role] })
    .setProtectedHeader({ alg: 'HS256' }).setJti(input.id).setIssuedAt(Math.floor(at / 1000))
    .setIssuer(signing.issuer).setAudience(signing.audience).setExpirationTime(input.expiresAt).sign(signing.key);
  const row: ServiceCredential = { id: input.id, subject: input.subject, tenant: actor.tenant, role: input.role,
    tokenHash: await tokenHash(token), expiresAt: input.expiresAt, createdAt: at, createdBy: actor.id, revokedAt: null };
  try {
    if (!await store.issue(row, actor, replaced ?? undefined)) return c.json(conflict(), 409);
  } catch { return c.json({ error: 'Credential outcome unconfirmed; reconcile the supplied ID before retrying.' }, 503); }
  return c.json({ ok: true, credential: publicCredential(row), token }, 201);
});
auth.delete('/service-credentials/:id', customerHuman, async (c) => {
  const actor = await authorityActor(c, true);
  if (!actor) return c.json({ error: 'Stamp owner required' }, 403);
  const store = authorityFor(c.env), row = await store.credential(c.req.param('id'));
  if (!row || row.tenant !== actor.tenant) return c.json({ error: 'Credential not found' }, 404);
  if (row.revokedAt !== null) return c.json({ ok: true, revoked: row.id });
  if (!await store.revoke(row, actor, Date.now())) return c.json(conflict(), 409);
  return c.json({ ok: true, revoked: row.id });
});

export { auth as authRoutes };
