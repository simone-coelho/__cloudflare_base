import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '@/types/env';
import { readSigningConfig, SIGNING_CONFIGURATION_UNAVAILABLE } from '@/auth/signingConfig.mjs';
import { isValidTenantId, type TenantVariables } from '@/tenancy/tenant';
import { tenantForRequest } from '@/tenancy/middleware';
import { consentFromCookies } from '@/content/consent';
import { forwardShopperRequest, shopperRequestHeld } from './sessionAuthority';

export const SHOPPER_HEADER = 'X-Shopper-Session';
export const SHOPPER_PROTOCOL = 'shopper-session-v1';
const PREFIX = 'ss1';
// A bounded bearer lifetime, not a logout/revocation or customer session SLA.
export const SHOPPER_MAX_AGE = 24 * 60 * 60;
export interface SessionCapability {
  tenant: string;
  subject: string;
  sessionId: string;
  kind: 'anonymous' | 'recognized';
  /** Legacy session-host bearers omit these; the DO host requires both. */
  grantId?: string;
  authorityEpoch?: string;
  iat: number;
  exp: number;
}
export class SessionAccessError extends HTTPException {
  constructor() { super(401, { message: 'Shopper session unavailable', res: Response.json({ ok: false, error: 'Shopper session unavailable' }, { status: 401, headers: { 'Cache-Control': 'no-store' } }) }); }
}
const bytes = new TextEncoder();
const encoded = (v: Uint8Array) => btoa(String.fromCharCode(...v)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
function decoded(v: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(v)) throw new SessionAccessError();
  const raw = atob(v.replace(/-/g, '+').replace(/_/g, '/'));
  const out = Uint8Array.from(raw, ch => ch.charCodeAt(0));
  if (encoded(out) !== v) throw new SessionAccessError();
  return out;
}
function valid(c: SessionCapability, now: number): boolean {
  return !!c && typeof c === 'object' && isValidTenantId(c.tenant)
    && typeof c.subject === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(c.subject)
    && typeof c.sessionId === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(c.sessionId)
    && (c.kind === 'anonymous' ? /^vis-[0-9a-f-]{36}$/.test(c.subject) : c.kind === 'recognized' && /^sh_[0-9a-f]{32}$/.test(c.subject))
    && ((c.grantId === undefined && c.authorityEpoch === undefined)
      || (typeof c.grantId === 'string' && /^[0-9a-f-]{36}$/.test(c.grantId)
        && typeof c.authorityEpoch === 'string' && /^[0-9a-f-]{36}$/.test(c.authorityEpoch)))
    && Number.isSafeInteger(c.iat) && Number.isSafeInteger(c.exp)
    && c.iat <= now && c.iat >= 0 && c.exp > now && c.exp > c.iat && c.exp - c.iat <= SHOPPER_MAX_AGE;
}
function config(env: Env) {
  const c = readSigningConfig(env);
  if (!c) throw new HTTPException(503, { message: SIGNING_CONFIGURATION_UNAVAILABLE });
  return c;
}
function message(issuer: string, audience: string, payload: string) {
  // Neither the wire format nor the signed input is a JWT signing input.
  return bytes.encode(JSON.stringify(['shopper-session-capability/v1', issuer, audience, payload]));
}
export async function issueSessionCapability(env: Env, claims: Omit<SessionCapability, 'iat' | 'exp'>, now = Math.floor(Date.now() / 1000), lifetime = SHOPPER_MAX_AGE) {
  return encodeSessionCapability(env, { ...claims, grantId: claims.grantId ?? crypto.randomUUID(),
    authorityEpoch: claims.authorityEpoch ?? crypto.randomUUID(), iat: now, exp: now + lifetime }, now);
}
/** Sign a persisted descriptor without extending its authority or lifetime. */
export function signSessionCapability(env: Env, principal: SessionCapability) {
  return encodeSessionCapability(env, principal, Math.floor(Date.now() / 1000));
}
async function encodeSessionCapability(env: Env, principal: SessionCapability, validationTime: number) {
  const cfg = config(env);
  if (!valid(principal, validationTime)) throw new SessionAccessError();
  const payload = encoded(bytes.encode(JSON.stringify(principal)));
  const key = await crypto.subtle.importKey('raw', cfg.key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, message(cfg.issuer, cfg.audience, payload));
  return { capability: `${PREFIX}.${payload}.${encoded(new Uint8Array(signature))}`, ...principal };
}
// ── W16 C6: the anonymous return-recognition proof ──────────────────────────
//
// A SEPARATE credential from the session capability above, and deliberately not
// a longer-lived one of them (HANDOFF-2026-09-18 §7, §12). The capability is a
// bounded bearer for a browsing session; this is a purpose- and transport-bound
// recognition proof for ONE physical subject on ONE device, whose whole life is
// fixed at issue by the tenant's published window. The two are signed over
// different context strings with different prefixes, so neither can ever be
// presented as the other, and nothing here derives anything from the device: a
// proof is recognized because the shopper's own browser still holds it.
//
// The token is DETERMINISTIC in its descriptor: rotating a chain to its next
// generation re-derives the successor rather than minting a secret that would
// then have to be stored. That is what lets the owner object keep only the
// digest, the generation and the fixed expiry.
const CONTINUITY_PREFIX = 'rc1';
/** Ruled member: the broker-mode cookie that carries the long proof. */
export const CONTINUITY_COOKIE = 'opt_shopper_continuity';
const CONTINUITY_MAX_PURPOSE = 120;

export interface ContinuityDescriptor {
  tenant: string;
  /** The physical subject the chain recognizes. Anonymous only: a recognized
   * shopper is signed in, and linking retires the descriptor. */
  subject: string;
  /** The chain this descriptor belongs to. A new descriptor starts a new one. */
  chain: string;
  /** 1 for the first descriptor of a chain, one more per consume. */
  generation: number;
  /** When the chain was issued. */
  issuedAt: number;
  /** The chain's ORIGINAL FIXED expiry: issue time plus the published window.
   * Rotation, browsing and renewal never move it. */
  expiresAt: number;
  /** The transport published when the chain was issued. */
  mode: 'direct' | 'broker';
  /** The covered purpose the credential is bound to. */
  purpose: string;
  /** The published reflex document revision the chain is bound to. */
  revision: number;
}

function continuityMessage(issuer: string, audience: string, payload: string) {
  // A different context string from the capability's: the same key can never
  // make one credential verify as the other.
  return bytes.encode(JSON.stringify(['shopper-continuity-proof/v1', issuer, audience, payload]));
}

/** One canonical member order, so the same descriptor always signs identically. */
function canonicalDescriptor(d: ContinuityDescriptor): ContinuityDescriptor {
  return { tenant: d.tenant, subject: d.subject, chain: d.chain, generation: d.generation,
    issuedAt: d.issuedAt, expiresAt: d.expiresAt, mode: d.mode, purpose: d.purpose, revision: d.revision };
}

function validContinuityDescriptor(d: ContinuityDescriptor): boolean {
  return !!d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === 9
    && isValidTenantId(d.tenant)
    && typeof d.subject === 'string' && /^vis-[0-9a-f-]{36}$/.test(d.subject)
    && typeof d.chain === 'string' && /^[0-9a-f-]{36}$/.test(d.chain)
    && Number.isSafeInteger(d.generation) && d.generation >= 1
    && Number.isSafeInteger(d.issuedAt) && d.issuedAt >= 0
    && Number.isSafeInteger(d.expiresAt) && d.expiresAt > d.issuedAt
    && (d.mode === 'direct' || d.mode === 'broker')
    && typeof d.purpose === 'string' && d.purpose.length > 0 && d.purpose.length <= CONTINUITY_MAX_PURPOSE
    && Number.isSafeInteger(d.revision) && d.revision >= 0;
}

/** The signed proof for exactly this descriptor. Deterministic. */
export async function issueContinuityProof(env: Env, descriptor: ContinuityDescriptor): Promise<string> {
  const cfg = config(env);
  const canonical = canonicalDescriptor(descriptor);
  if (!validContinuityDescriptor(canonical)) throw new SessionAccessError();
  const payload = encoded(bytes.encode(JSON.stringify(canonical)));
  const key = await crypto.subtle.importKey('raw', cfg.key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, continuityMessage(cfg.issuer, cfg.audience, payload));
  return `${CONTINUITY_PREFIX}.${payload}.${encoded(new Uint8Array(signature))}`;
}

/**
 * The descriptor a presented proof carries, or null. Never throws and never
 * refuses the request: an unknown, tampered, foreign or malformed proof is a
 * shopper the engine does not recognize, which is a COLD shopper, not an error.
 */
export async function readContinuityProof(env: Env, proof: unknown, tenant: string): Promise<ContinuityDescriptor | null> {
  try {
    const cfg = config(env);
    if (typeof proof !== 'string' || proof.length > 2048) return null;
    const parts = proof.split('.');
    if (parts.length !== 3 || parts[0] !== CONTINUITY_PREFIX) return null;
    const signature = decoded(parts[2]!);
    if (signature.length !== 32) return null;
    const key = await crypto.subtle.importKey('raw', cfg.key, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, signature, continuityMessage(cfg.issuer, cfg.audience, parts[1]!))) return null;
    const descriptor = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
      .decode(decoded(parts[1]!))) as ContinuityDescriptor;
    if (!validContinuityDescriptor(descriptor) || descriptor.tenant !== tenant) return null;
    return Object.freeze(canonicalDescriptor(descriptor));
  } catch { return null; }
}

/** The digest form this codebase already keeps for stored proofs (`erase.ts`). */
export async function continuityDigest(proof: string): Promise<string> {
  const out = await crypto.subtle.digest('SHA-256', bytes.encode(proof));
  return Array.from(new Uint8Array(out), b => b.toString(16).padStart(2, '0')).join('');
}

export function newAnonymousSession(env: Env, tenant: string) {
  return issueSessionCapability(env, { tenant, subject: `vis-${crypto.randomUUID()}`, sessionId: `s-${crypto.randomUUID()}`, kind: 'anonymous' });
}
export async function verifySessionCapability(env: Env, token: string | null | undefined, tenant: string): Promise<SessionCapability> {
  const cfg = config(env);
  try {
    if (typeof token !== 'string' || token.length > 2048) throw new SessionAccessError();
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX) throw new SessionAccessError();
    const [_, payload, sig] = parts;
    const signature = decoded(sig);
    if (signature.length !== 32) throw new SessionAccessError();
    const key = await crypto.subtle.importKey('raw', cfg.key, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, signature, message(cfg.issuer, cfg.audience, payload))) throw new SessionAccessError();
    const principal = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(decoded(payload))) as SessionCapability;
    if (!valid(principal, Math.floor(Date.now() / 1000)) || principal.tenant !== tenant) throw new SessionAccessError();
    return Object.freeze(principal);
  } catch { throw new SessionAccessError(); }
}
export function assertSessionTarget(principal: SessionCapability, subject?: unknown, sessionId?: unknown) {
  if (principal.exp <= Math.floor(Date.now() / 1000)
    || (subject !== undefined && subject !== null && subject !== principal.subject)
    || (sessionId !== undefined && sessionId !== null && sessionId !== principal.sessionId)) throw new SessionAccessError();
}
export function capabilityToken(req: Request): string | null {
  const header = req.headers.get(SHOPPER_HEADER);
  if (header !== null) return header;
  const offered = (req.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map(v => v.trim());
  const tokens = offered.filter(v => v.startsWith(`${PREFIX}.`));
  return offered.includes(SHOPPER_PROTOCOL) && tokens.length === 1 ? tokens[0] : null;
}
/** WebSocket cannot set X-Tenant. Its explicit selector must still be provisioned. */
export function shopperTenant(env: Env, req: Request, resolved?: string): string {
  try {
    const tenant = tenantForRequest(env, req);
    if (resolved !== undefined && (!isValidTenantId(resolved) || resolved !== tenant)) throw new SessionAccessError();
    return tenant;
  } catch { throw new SessionAccessError(); }
}
const principals = new WeakMap<Request, SessionCapability>();
export function shopperPrincipal(req: Request): SessionCapability {
  const p = principals.get(req);
  if (!p) throw new SessionAccessError();
  assertSessionTarget(p);
  return p;
}
async function boundedShopperBody(request: Request, limit: number, timeoutMs: number, tooLarge = 'Shopper request too large'): Promise<string> {
  const reader = request.clone().body?.getReader(); if (!reader) return '';
  let timer: ReturnType<typeof setTimeout> | undefined, active = true, complete = false;
  try {
    return await Promise.race([(async () => {
      const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }); let count = 0, text = '';
      for (;;) {
        const chunk = await reader.read(); if (!active) throw new SessionAccessError();
        if (chunk.done) { complete = true; return text + decoder.decode(); }
        count += chunk.value.byteLength; if (count > limit) throw new HTTPException(413, { res: Response.json({ ok: false, error: tooLarge }, {status:413}) });
        text += decoder.decode(chunk.value, { stream: true });
      }
    })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SessionAccessError()), timeoutMs); })]);
  } finally {
    active = false; if (timer) clearTimeout(timer);
    // A cloned request tees the source: cancel both branches on refusal so a
    // non-closing producer cannot keep filling the unused original branch.
    void reader.cancel().catch(() => undefined);
    if (!complete) void request.body?.cancel().catch(() => undefined);
  }
}
export const requireShopper = (options?: { forward?: boolean; bodyLimit?: number; ownedBodyLimit?: number; bodyTimeoutMs?: number; bodyTooLarge?: string }) => createMiddleware<{ Bindings: Env; Variables: TenantVariables }>(async (c, next) => {
  const tenant = shopperTenant(c.env, c.req.raw, c.get('tenant'));
  const pathTenant = c.req.param('tenant');
  if (pathTenant !== undefined && pathTenant !== tenant) throw new SessionAccessError();
  const p = await verifySessionCapability(c.env, capabilityToken(c.req.raw), tenant);
  for (const subject of [c.req.param('userId'), c.req.query('userId'), c.req.query('visitorId')]) assertSessionTarget(p, subject);
  for (const sid of [c.req.param('sessionId'), c.req.query('sessionId')]) assertSessionTarget(p, undefined, sid);
  // Reject caller-selected conflicts before crossing the owner boundary: even
  // adopting a new grant is an effect, and the route's body check is too late.
  if (c.req.method === 'POST') {
    let body: unknown;
    const limit = shopperRequestHeld(c.req.raw, p) ? options?.ownedBodyLimit ?? options?.bodyLimit : options?.bodyLimit;
    try { const text = limit ? await boundedShopperBody(c.req.raw, limit, options?.bodyTimeoutMs ?? 5000, options?.bodyTooLarge)
      : await c.req.raw.clone().text(); body = text ? JSON.parse(text) : {}; }
    catch (error) {
      if (limit && error instanceof HTTPException) throw error;
      if (limit && error instanceof SyntaxError) throw new HTTPException(400, { res: Response.json({ ok: false, error: 'Invalid shopper request' }, { status: 400 }) });
      throw new SessionAccessError();
    }
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const selectors = body as Record<string, unknown>;
      for (const name of ['userId', 'visitorId']) if (selectors[name] !== undefined) {
        if (typeof selectors[name] !== 'string') throw new SessionAccessError();
        assertSessionTarget(p, selectors[name] as string);
      }
      if (selectors.sessionId !== undefined) {
        if (typeof selectors.sessionId !== 'string') throw new SessionAccessError();
        assertSessionTarget(p, undefined, selectors.sessionId);
      }
    }
  }
  principals.set(c.req.raw, p);
  c.set('tenant', tenant);
  c.header('Cache-Control', 'no-store');
  if (options?.forward !== false && !shopperRequestHeld(c.req.raw, p)) return forwardShopperRequest(c.env, c.req.raw, p);
  await next();
});
export function privateShopperHeaders(req: Request): Record<string, string> {
  const p = shopperPrincipal(req);
  const hints = consentFromCookies(req.headers.get('Cookie'));
  const refusals = [!hints.tracking ? 'opt_tracking_consent=false' : '', !hints.personalization ? 'opt_personalization_enabled=false' : ''].filter(Boolean).join('; ');
  return { [SHOPPER_HEADER]: capabilityToken(req)!, 'X-Tenant': p.tenant, ...(refusals ? { Cookie: refusals } : {}) };
}
