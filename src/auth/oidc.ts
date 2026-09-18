import { z } from 'zod';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import type { CurrentHumanActor, FederationSession, SessionRow, UserRecord } from './store';
import { storeFor, tokenHash, publicUser } from './accounts';
import { readSigningConfig } from './signingConfig.mjs';
import { tenantConfig } from '@/tenancy/middleware';

const fail = (): never => { throw new Error('Federated sign-in unavailable'); };
const text = new TextEncoder();
const issuerIdentifier = z.string().min(1).max(1024).refine(value => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search && value.trim() === value; } catch { return false; }
});
const endpoint = z.string().min(1).max(1024).refine(value => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search && u.href === value; } catch { return false; }
});
const provider = z.object({ enabled: z.literal(true), issuer: issuerIdentifier, authorizationEndpoint: endpoint,
  tokenEndpoint: endpoint, jwksUri: endpoint, origin: endpoint.refine(v => new URL(v).origin + '/' === v),
  clientId: z.string().min(1).max(200), clientSecretRef: z.string().regex(/^OPERATOR_OIDC_SECRET_[A-Z0-9_]{1,80}$/),
  algorithms: z.array(z.enum(['RS256', 'ES256'])).min(1).max(2).refine(v => new Set(v).size === v.length),
  transactionMs: z.number().int().min(30000).max(300000), sessionMs: z.number().int().min(60000).max(86400000),
  reauthMs: z.number().int().min(60000).max(86400000), timeoutMs: z.number().int().min(100).max(10000),
}).strict();
export type OIDCProvider = z.infer<typeof provider>;
export function oidcConfiguration(env: Env): Record<string, OIDCProvider | { enabled: false }> {
  if (env.OPERATOR_OIDC === undefined) return {};
  try {
    const value = z.object({ version: z.literal(1), tenants: z.record(z.string(), z.union([provider, z.object({ enabled: z.literal(false) }).strict()])) }).strict().parse(JSON.parse(env.OPERATOR_OIDC));
    const tenants = tenantConfig(env).provisioned;
    if (Object.keys(value.tenants).length > tenants.length || Object.keys(value.tenants).some(t => !tenants.includes(t))) return fail();
    return value.tenants;
  } catch { return fail(); }
}
function configured(env: Env, tenant: string): { config: OIDCProvider; secret: string } {
  const config = oidcConfiguration(env)[tenant];
  if (!config?.enabled) return fail();
  const secret = (env as unknown as Record<string, unknown>)[config.clientSecretRef];
  if (typeof secret !== 'string' || secret.trim() !== secret || secret.length < 32 || secret.length > 4096) return fail();
  return { config, secret };
}
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', text.encode(value))), x => x.toString(16).padStart(2, '0')).join('');
const nonce = () => jose.base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
export async function oidcBasis(env: Env, tenant: string): Promise<string> {
  const { config, secret } = configured(env, tenant);
  return hash(JSON.stringify([1, config, await hash(secret)]));
}
const cookieName = (tenant: string) => '__Host-operator-oidc-' + tenant;
function cookie(request: Request, tenant: string): string {
  const matches = (request.headers.get('Cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(cookieName(tenant) + '='));
  if (matches.length !== 1) return fail();
  const value = matches[0]!.slice(cookieName(tenant).length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return fail();
  return value;
}
export const oidcCookie = (tenant: string, value: string, seconds: number) => `${cookieName(tenant)}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
export function oidcSameOrigin(env: Env, tenant: string, request: Request): void {
  const { config } = configured(env, tenant), origin = new URL(request.url).origin;
  if (origin !== new URL(config.origin).origin || request.headers.get('Origin') !== origin
    || (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) fail();
}
async function bounded<T>(milliseconds: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work(controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Federated sign-in unavailable')); }, milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}
async function readJSON(response: Response, signal: AbortSignal, maximum: number): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) return fail();
  const bytes = new Uint8Array(maximum); let length = 0, complete = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) return fail();
      const part = await reader.read(); if (signal.aborted) return fail();
      if (part.done) { complete = true; break; }
      if (part.value.byteLength > maximum - length) return fail();
      bytes.set(part.value, length); length += part.value.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, length)));
  } finally { signal.removeEventListener('abort', abort); if (!complete) abort(); reader.releaseLock(); }
}
export async function oidcBody(request: Request): Promise<unknown> {
  return bounded(5000, signal => readJSON(new Response(request.body), signal, 4096));
}
interface Link { account_id: string; issuer: string; subject: string; revision: string; disabled: number }
const linkFor = (env: Env, account: string) => env.DB.prepare('SELECT * FROM operator_oidc_links WHERE account_id=?').bind(account).first<Link>();
const epochFor = async (env: Env) => (await env.DB.prepare('SELECT epoch FROM operator_oidc_epoch WHERE id=1').first<{ epoch: string }>())?.epoch ?? fail();
function allowed(user: UserRecord | null, link: Link | null, config: OIDCProvider): asserts user is UserRecord {
  if (!user || user.disabled || user.must_change_password || !['oidc', 'dual'].includes(user.authMode ?? '')
    || !link || link.account_id !== user.id || link.disabled !== 0 || link.issuer !== config.issuer
    || typeof link.subject !== 'string' || !link.subject || link.subject.length > 255 || !link.revision) fail();
}
interface Transaction { state: string; cookie_hash: string; tenant: string; origin: string; account_id: string; account_revision: number;
  link_revision: string; config_digest: string; epoch: string; nonce: string; verifier: string; created_at: number; expires_at: number; consumed_at: number | null }
async function housekeeping(env: Env, at: number): Promise<void> {
  // Fixed bounded housekeeping; consumed transactions are not authorization.
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM operator_oidc_transactions WHERE state IN (SELECT state FROM operator_oidc_transactions WHERE expires_at<=? LIMIT 100)').bind(at),
    env.DB.prepare('DELETE FROM operator_oidc_completions WHERE id IN (SELECT id FROM operator_oidc_completions WHERE expires_at<=? LIMIT 100)').bind(at),
  ]);
  if (results.some(r => !r.success)) fail();
}
export async function startOIDC(env: Env, tenant: string, request: Request, email: string): Promise<{ location: string; cookie: string }> {
  oidcSameOrigin(env, tenant, request);
  const { config } = configured(env, tenant), basis = await oidcBasis(env, tenant);
  const user = await storeFor(env).getByEmail(email), link = user && await linkFor(env, user.id); allowed(user, link, config);
  const epoch = await epochFor(env), at = Date.now(), state = nonce(), browser = nonce(), verifier = nonce(), n = nonce();
  const challenge = jose.base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', text.encode(verifier)))), cookieHash = await hash(browser);
  await housekeeping(env, at);
  if (await oidcBasis(env, tenant) !== basis) return fail();
  const result = await env.DB.prepare(`INSERT INTO operator_oidc_transactions
    (state,cookie_hash,tenant,origin,account_id,account_revision,link_revision,config_digest,epoch,nonce,verifier,created_at,expires_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM operator_accounts a JOIN operator_oidc_links l ON l.account_id=a.id
      WHERE a.id=? AND a.updated_at=? AND a.auth_mode IN ('oidc','dual') AND a.disabled=0 AND a.must_change_password=0
      AND l.revision=? AND l.issuer=? AND l.subject=? AND l.disabled=0) AND EXISTS(SELECT 1 FROM operator_oidc_epoch WHERE epoch=?)`)
    .bind(state, cookieHash, tenant, new URL(config.origin).origin, user.id, user.updatedAt ?? 0, link!.revision, basis, epoch, n, verifier, at, at + config.transactionMs,
      user.id, user.updatedAt ?? 0, link!.revision, link!.issuer, link!.subject, epoch).run();
  if (!result.success || result.meta.changes !== 1) return fail();
  const u = new URL(config.authorizationEndpoint);
  u.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: new URL('/auth/oidc/callback/' + tenant, config.origin).href,
    scope: 'openid', state, nonce: n, code_challenge: challenge, code_challenge_method: 'S256', max_age: String(Math.floor(config.reauthMs / 1000)) }).toString();
  return { location: u.href, cookie: oidcCookie(tenant, browser, Math.ceil(config.transactionMs / 1000)) };
}
export async function assertFederationSession(env: Env, user: UserRecord, session: SessionRow, method?: unknown): Promise<void> {
  const isOIDC = session.jti.startsWith('oidc.') || session.authMethod === 'oidc' || Boolean(session.federation) || method === 'oidc';
  if (!isOIDC) { if (user.authMode === 'oidc' || (method !== undefined && method !== 'password')) fail(); return; }
  const f = session.federation;
  if (!f || session.authMethod !== 'oidc' || !session.jti.startsWith('oidc.') || (method !== undefined && method !== 'oidc')) return fail();
  const { config } = configured(env, f.tenant), link = await linkFor(env, user.id); allowed(user, link, config);
  if (f.issuer !== config.issuer || f.linkRevision !== link!.revision || f.accountRevision !== (user.updatedAt ?? 0)
    || f.configDigest !== await oidcBasis(env, f.tenant) || f.epoch !== await epochFor(env)
    || f.expiresAt !== session.expiresAt || !Number.isSafeInteger(f.authTime) || f.authTime > Date.now()
    || f.expiresAt > f.authTime + config.reauthMs || f.expiresAt > session.createdAt + config.sessionMs || f.expiresAt <= Date.now()) fail();
  const store = storeFor(env), current = await store.getById(user.id), retained = await store.getSession(session.jti);
  if (!current || current.disabled || current.must_change_password || current.updatedAt !== user.updatedAt || current.authMode !== user.authMode
    || !retained || retained.authMethod !== 'oidc' || retained.accountId !== user.id || retained.tokenHash !== session.tokenHash
    || retained.expiresAt !== session.expiresAt || retained.expiresAt <= Date.now() || JSON.stringify(retained.federation) !== JSON.stringify(f)) fail();
}
async function completionKey(env: Env): Promise<CryptoKey> {
  const signing = readSigningConfig(env); if (!signing) return fail();
  const material = await crypto.subtle.importKey('raw', signing.key as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: text.encode(signing.issuer), info: text.encode('operator-oidc-completion/v1') }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(env: Env, id: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12)), plain = text.encode(JSON.stringify(value)); if (plain.length > 32768) return fail();
  return jose.base64url.encode(iv) + '.' + jose.base64url.encode(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(id) }, await completionKey(env), plain)));
}
export async function callbackOIDC(env: Env, tenant: string, request: Request): Promise<{ location: string }> {
  const { config, secret } = configured(env, tenant), u = new URL(request.url), browserHash = await hash(cookie(request, tenant));
  if (u.origin !== new URL(config.origin).origin || u.pathname !== '/auth/oidc/callback/' + tenant || u.search.length > 8192
    || [...u.searchParams.keys()].some(k => !['code', 'state', 'iss'].includes(k))
    || ['code', 'state', 'iss'].some(k => u.searchParams.getAll(k).length > 1)) return fail();
  const code = u.searchParams.get('code'), state = u.searchParams.get('state');
  if (!code || code.length > 4096 || !state || !/^[A-Za-z0-9_-]{43}$/.test(state) || (u.searchParams.has('iss') && u.searchParams.get('iss') !== config.issuer)) return fail();
  const tx = await env.DB.prepare('SELECT * FROM operator_oidc_transactions WHERE state=?').bind(state).first<Transaction>();
  if (!tx || tx.cookie_hash !== browserHash || tx.tenant !== tenant || tx.origin !== u.origin || tx.consumed_at !== null) return fail();
  const live = async () => {
    if (Date.now() >= tx.expires_at || tx.config_digest !== await oidcBasis(env, tenant) || tx.epoch !== await epochFor(env)) return fail();
    const user = await storeFor(env).getById(tx.account_id), link = await linkFor(env, tx.account_id); allowed(user, link, config);
    if ((user.updatedAt ?? 0) !== tx.account_revision || link!.revision !== tx.link_revision || Date.now() >= tx.expires_at) return fail();
    return { user, link: link! };
  };
  await live();
  const claims = await bounded(Math.min(config.timeoutMs, tx.expires_at - Date.now()), async signal => {
    const send = async (url: string, init: RequestInit, max: number) => {
      await live(); if (signal.aborted || Date.now() >= tx.expires_at) return fail();
      const response = await fetch(url, { ...init, signal, redirect: 'manual' });
      if (response.status !== 200) { void response.body?.cancel().catch(() => undefined); return fail(); }
      return readJSON(response, signal, max);
    };
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: u.origin + '/auth/oidc/callback/' + tenant,
      client_id: config.clientId, client_secret: secret, code_verifier: tx.verifier }).toString();
    if (text.encode(body).length > 16384) return fail();
    const tokens = z.object({ id_token: z.string().min(1).max(32768) }).passthrough().parse(await send(config.tokenEndpoint,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body }, 65536));
    const jwks = z.object({ keys: z.array(z.object({ kty: z.string().min(1) }).catchall(z.unknown())).min(1).max(20) }).strict().parse(await send(config.jwksUri,
      { method: 'GET', headers: { Accept: 'application/json' } }, 65536));
    const verified = await jose.jwtVerify(tokens.id_token, jose.createLocalJWKSet(jwks as jose.JSONWebKeySet), {
      algorithms: config.algorithms, issuer: config.issuer, audience: config.clientId, clockTolerance: 0,
      requiredClaims: ['sub', 'iat', 'exp', 'nonce', 'auth_time'],
    });
    const p = verified.payload, now = Math.floor(Date.now() / 1000);
    if (p.nonce !== tx.nonce || typeof p.sub !== 'string' || !p.sub || !Number.isSafeInteger(p.iat) || p.iat! > now
      || !Number.isSafeInteger(p.exp) || !Number.isSafeInteger(p.auth_time) || Number(p.auth_time) > now
      || (Array.isArray(p.aud) && p.aud.length > 1 && p.azp !== config.clientId) || (p.azp !== undefined && p.azp !== config.clientId)
      || Number(p.auth_time) * 1000 + config.reauthMs <= Date.now()) return fail();
    return p;
  });
  const { user, link } = await live(); if (claims.sub !== link.subject) return fail();
  const at = Date.now(), expiry = Math.min(Number(claims.exp) * 1000, Number(claims.auth_time) * 1000 + config.reauthMs, at + config.sessionMs);
  if (expiry <= at) return fail();
  const signing = readSigningConfig(env); if (!signing) return fail();
  const sid = 'oidc.' + crypto.randomUUID(), completion = nonce();
  const refreshToken = await new jose.SignJWT({ sub: user.id, type: 'refresh', authMethod: 'oidc' }).setProtectedHeader({ alg: 'HS256' })
    .setJti(sid).setIssuedAt().setIssuer(signing.issuer).setAudience(signing.audience).setExpirationTime(Math.floor(expiry / 1000)).sign(signing.key);
  const accessToken = await new jose.SignJWT({ sub: user.id, type: 'access', sid, authMethod: 'oidc' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setIssuer(signing.issuer).setAudience(signing.audience).setExpirationTime(Math.floor(Math.min(expiry, at + 900000) / 1000)).sign(signing.key);
  const payload = await seal(env, completion, { accessToken, refreshToken, user: publicUser(user), mustChangePassword: false,
    expiresIn: Math.floor((Math.min(expiry, at + 900000) - at) / 1000) }), tokenDigest = await tokenHash(refreshToken);
  await live(); const commitAt = Date.now(); if (expiry <= commitAt) return fail();
  const q = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args);
  const result = await env.DB.batch([
    q(`UPDATE operator_oidc_transactions SET consumed_at=?,session_id=? WHERE state=? AND consumed_at IS NULL AND expires_at>?
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
      AND cookie_hash=? AND epoch=(SELECT epoch FROM operator_oidc_epoch WHERE id=1) AND EXISTS
      (SELECT 1 FROM operator_accounts a JOIN operator_oidc_links l ON a.id=l.account_id WHERE a.id=? AND a.updated_at=?
        AND a.disabled=0 AND a.must_change_password=0 AND a.auth_mode IN ('oidc','dual') AND l.disabled=0 AND l.revision=? AND l.subject=? AND l.issuer=?)`,
    commitAt, sid, state, commitAt, browserHash, user.id, tx.account_revision, tx.link_revision, claims.sub, config.issuer),
    q(`INSERT INTO operator_sessions(jti,account_id,token_hash,created_at,expires_at,auth_method)
      SELECT ?,?,?,?,?, 'oidc' WHERE EXISTS(SELECT 1 FROM operator_oidc_transactions WHERE state=? AND session_id=?)`, sid, user.id, tokenDigest, at, expiry, state, sid),
    q(`INSERT INTO operator_oidc_sessions(session_id,account_id,tenant,issuer,link_revision,config_digest,account_revision,epoch,auth_time,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM operator_sessions WHERE jti=?)`, sid, user.id, tenant, config.issuer, tx.link_revision,
    tx.config_digest, tx.account_revision, tx.epoch, Number(claims.auth_time) * 1000, expiry, sid),
    q(`INSERT INTO operator_oidc_completions(id,cookie_hash,tenant,origin,epoch,session_id,payload,expires_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM operator_sessions WHERE jti=?)`, completion, browserHash, tenant, u.origin, tx.epoch, sid, payload, Math.min(expiry, tx.expires_at, commitAt + 60000), sid),
    q(`UPDATE operator_accounts SET last_sign_in_at=MAX(COALESCE(last_sign_in_at,0),?) WHERE id=? AND EXISTS(SELECT 1 FROM operator_sessions WHERE jti=?)`, commitAt, user.id, sid),
    q(`INSERT INTO operator_audit(at,action,actor_id,target_id,tenant,detail) SELECT ?,'sign_in',?,?,?,'{"method":"oidc"}' WHERE EXISTS(SELECT 1 FROM operator_sessions WHERE jti=?)`, commitAt, user.id, user.id, tenant, sid),
  ]);
  if (result.some(r => !r.success || r.meta.changes !== 1)) return fail();
  if (Date.now() >= tx.expires_at || Date.now() >= expiry) {
    // Never release a late result. Preserve the consumed transaction barrier;
    // dispose only this attempt's undisclosed session and encrypted completion.
    await env.DB.batch([q('DELETE FROM operator_oidc_completions WHERE id=? AND session_id=?', completion, sid), q('DELETE FROM operator_sessions WHERE jti=?', sid)]);
    return fail();
  }
  return { location: u.origin + '/console?oidc=complete&tenant=' + encodeURIComponent(tenant) };
}
export async function completeOIDC(env: Env, tenant: string, request: Request): Promise<unknown> {
  oidcSameOrigin(env, tenant, request); const browserHash = await hash(cookie(request, tenant)), origin = new URL(request.url).origin;
  const r = await env.DB.prepare(`SELECT * FROM operator_oidc_completions WHERE cookie_hash=? AND tenant=? AND origin=? AND consumed_at IS NULL AND expires_at>? ORDER BY expires_at DESC LIMIT 2`)
    .bind(browserHash, tenant, origin, Date.now()).all<{ id: string; epoch: string; session_id: string; payload: string; expires_at: number }>();
  if (!r.success || r.results.length !== 1) return fail(); const row = r.results[0]!;
  if (row.epoch !== await epochFor(env)) return fail();
  const store = storeFor(env), session = await store.getSession(row.session_id), user = session && await store.getById(session.accountId);
  if (!session || !user) return fail(); await assertFederationSession(env, user, session, 'oidc');
  const [iv, ciphertext, extra] = row.payload.split('.'); if (!iv || !ciphertext || extra || row.payload.length > 65536) return fail();
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: jose.base64url.decode(iv), additionalData: text.encode(row.id) }, await completionKey(env), jose.base64url.decode(ciphertext));
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  await assertFederationSession(env, user, session, 'oidc');
  const done = await env.DB.prepare(`UPDATE operator_oidc_completions SET consumed_at=?,payload='' WHERE id=? AND consumed_at IS NULL AND expires_at>?
    AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    AND epoch=(SELECT epoch FROM operator_oidc_epoch WHERE id=1) AND EXISTS(SELECT 1 FROM operator_sessions s JOIN operator_accounts a ON a.id=s.account_id
      JOIN operator_oidc_links l ON l.account_id=a.id JOIN operator_oidc_sessions f ON f.session_id=s.jti
      WHERE s.jti=? AND s.auth_method='oidc' AND s.expires_at>? AND a.updated_at=? AND a.disabled=0 AND a.must_change_password=0
      AND l.revision=? AND l.disabled=0 AND f.config_digest=? AND f.account_revision=a.updated_at AND f.link_revision=l.revision
      AND f.epoch=operator_oidc_completions.epoch AND f.expires_at=s.expires_at AND a.auth_mode IN ('oidc','dual'))`)
    .bind(Date.now(), row.id, Date.now(), session.jti, Date.now(), user.updatedAt ?? 0, session.federation!.linkRevision, session.federation!.configDigest).run();
  if (!done.success || done.meta.changes !== 1 || Date.now() >= row.expires_at || Date.now() >= session.expiresAt) return fail();
  await assertFederationSession(env, user, session, 'oidc');
  if (Date.now() >= row.expires_at) return fail(); return value;
}

/** Predicate shared by late native writes. Missing provenance is never password authority. */
export function federationGate(sid: string, federation?: FederationSession): { sql: string; args: unknown[] } {
  if (!sid.startsWith('oidc.')) return { sql: "s.auth_method='password'", args: [] };
  if (!federation) return { sql: '0', args: [] };
  return { sql: `s.auth_method='oidc' AND s.expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
    AND EXISTS(SELECT 1 FROM operator_oidc_sessions f JOIN operator_oidc_links l ON l.account_id=f.account_id
    JOIN operator_oidc_epoch e ON e.id=1 WHERE f.session_id=s.jti AND f.account_id=a.id AND f.account_revision=a.updated_at
    AND f.expires_at=s.expires_at AND f.epoch=e.epoch AND l.disabled=0 AND l.revision=f.link_revision AND l.issuer=f.issuer
    AND a.auth_mode IN ('oidc','dual') AND f.config_digest=? AND f.link_revision=? AND f.tenant=? AND f.epoch=?)`,
  args: [federation.configDigest, federation.linkRevision, federation.tenant, federation.epoch] };
}

export const federationInput = z.object({ mode: z.enum(['oidc', 'dual']), issuer: issuerIdentifier, subject: z.string().min(1).max(255),
  disabled: z.boolean(), expectedRevision: z.number().int().nonnegative() }).strict();
export async function provisionFederation(env: Env, user: UserRecord, input: z.infer<typeof federationInput> | null, actor: CurrentHumanActor): Promise<void> {
  if (input && (input.expectedRevision !== (user.updatedAt ?? 0) || (input.mode === 'dual' && !user.password_hash))) return fail();
  if (input && !Object.values(oidcConfiguration(env)).some(p => p.enabled && p.issuer === input.issuer)) return fail();
  const owner = await storeFor(env).getById(actor.id), session = await storeFor(env).getSession(actor.sid);
  if (!owner || !session || session.accountId !== owner.id || owner.updatedAt !== actor.accountRevision || owner.disabled || owner.must_change_password
    || session.expiresAt <= Date.now()) return fail();
  await assertFederationSession(env, owner, session);
  const g = federationGate(actor.sid, session.federation), at = Date.now(), q = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args);
  const statements = [q(`INSERT INTO operator_sessions(jti,account_id,token_hash,created_at,expires_at)
    SELECT '',NULL,'',0,0 WHERE NOT EXISTS(SELECT 1 FROM operator_accounts a JOIN operator_sessions s ON s.account_id=a.id
      WHERE a.id=? AND a.updated_at=? AND a.disabled=0 AND a.must_change_password=0 AND s.jti=? AND s.expires_at>? AND ${g.sql})
      OR NOT EXISTS(SELECT 1 FROM operator_accounts WHERE id=? AND updated_at=?)`, actor.id, actor.accountRevision, actor.sid, at, ...g.args, user.id, user.updatedAt ?? 0)];
  if (input) {
    statements.push(q(`UPDATE operator_accounts SET auth_mode=?,password_hash=CASE WHEN ?='oidc' THEN NULL ELSE password_hash END,
      must_change_password=CASE WHEN ?='oidc' THEN 0 ELSE must_change_password END,updated_at=MAX(updated_at+1,?) WHERE id=?`, input.mode, input.mode, input.mode, at, user.id));
    statements.push(q(`INSERT INTO operator_oidc_links(account_id,issuer,subject,revision,disabled,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET issuer=excluded.issuer,subject=excluded.subject,revision=excluded.revision,disabled=excluded.disabled,updated_at=excluded.updated_at`,
    user.id, input.issuer, input.subject, crypto.randomUUID(), input.disabled ? 1 : 0, at));
  } else statements.push(q('DELETE FROM operator_oidc_links WHERE account_id=?', user.id));
  statements.push(q('DELETE FROM operator_sessions WHERE account_id=?', user.id));
  statements.push(q(`INSERT INTO operator_audit(at,action,actor_id,target_id,detail) VALUES(?,'account_changed',?,?,?)`, at, actor.id, user.id,
    JSON.stringify({ operation: 'federation_link', mode: input?.mode ?? 'unlinked', disabled: input?.disabled ?? true })));
  const result = await env.DB.batch(statements); if (result.some(r => !r.success)) fail();
}
export async function federationStatus(env: Env, user: UserRecord): Promise<unknown> {
  const link = await linkFor(env, user.id);
  return { mode: user.authMode ?? 'password', revision: user.updatedAt ?? 0,
    link: link ? { issuer: link.issuer, subject: link.subject, disabled: link.disabled === 1, revision: link.revision } : null };
}
