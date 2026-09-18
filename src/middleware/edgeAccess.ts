// src/middleware/edgeAccess.ts
// ─────────────────────────────────────────────────────────────────────────────
// CW10 — who may talk to the worker, and from where.
//
// Three gates, one switch. AUTH_MODE is 'open' by default, which is byte-for-byte
// today's behavior: the shared demo worker keeps working, the Coach console keeps
// posting to /operator without a token, the storefront keeps posting to /realtime
// without a key, and CORS reflects any origin. AUTH_MODE = 'enforced' is what the
// staging stamp sets: SDK keys bind the selected tenant, operator reads/writes
// need a tenant-authorized JWT, and CORS answers only configured origins (and self).
//
// The one exception to the switch is CORS_ORIGINS: when it is configured, the
// allow-list applies in either mode, because listing origins IS the decision.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Env } from '@/types/env';
import { isValidTenantId, type TenantVariables } from '@/tenancy/tenant';
import { tenantConfig } from '@/tenancy/middleware';
import { operatorJwt } from './operatorAuth';
import { assertShopperSelectors } from '@/identity/sessionAuthority';

export type AuthMode = 'open' | 'enforced';

export function authMode(env: Pick<Env, 'AUTH_MODE'>): AuthMode {
  return env.AUTH_MODE === 'enforced' ? 'enforced' : 'open';
}

// ── CORS ─────────────────────────────────────────────────────────────────────

/** The local dev server, so `npm run dev` never needs configuring. */
const LOCAL_ORIGINS = new Set(['http://localhost:9100', 'http://127.0.0.1:9100']);

export function corsOrigins(env: Pick<Env, 'CORS_ORIGINS'>): string[] {
  return (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function hostOf(origin: string): string {
  try { return new URL(origin).host.toLowerCase(); } catch { return ''; }
}

/** `*` matches everything; `*.example.com` matches the apex and any subdomain; anything else is exact. */
export function originMatches(rule: string, origin: string): boolean {
  if (rule === '*') return true;
  if (rule.startsWith('*.')) {
    const host = hostOf(origin);
    const apex = rule.slice(2).toLowerCase();
    return host === apex || host.endsWith(`.${apex}`);
  }
  return rule.toLowerCase() === origin.toLowerCase();
}

/**
 * Whether a cross-origin caller may be answered. The request's own origin and
 * the local dev server always may. With an allow-list configured, only its
 * entries may. With none configured: everything in open mode (today's
 * behavior), nothing in enforced mode (fail closed).
 */
export function originAllowed(origin: string, requestUrl: string, env: Pick<Env, 'AUTH_MODE' | 'CORS_ORIGINS'>): boolean {
  if (!origin) return false;
  let self = '';
  try { self = new URL(requestUrl).origin; } catch { self = ''; }
  if (origin === self || LOCAL_ORIGINS.has(origin)) return true;
  const list = corsOrigins(env);
  if (list.length === 0) return authMode(env) === 'open';
  return list.some((rule) => originMatches(rule, origin));
}

/** The `origin` option for hono/cors: the origin back when allowed, nothing when not. */
export function corsOrigin(origin: string, c: Context<{ Bindings: Env }>): string | null {
  return originAllowed(origin, c.req.url, c.env) ? origin : null;
}

// ── SDK keys ─────────────────────────────────────────────────────────────────

/**
 * SDK_KEYS is `tenant:key[|key2],tenant2:key3`. A tenant of `*` accepts the key
 * for any tenant when wildcard grants are permitted by the stamp policy.
 * The value is a secret; the format is not.
 */
export function sdkKeyTable(env: Pick<Env, 'SDK_KEYS'>): Map<string, Set<string>> {
  const table = new Map<string, Set<string>>();
  for (const entry of (env.SDK_KEYS ?? '').split(',')) {
    const [tenantRaw, keysRaw] = entry.split(':');
    const tenant = (tenantRaw ?? '').trim();
    const keys = (keysRaw ?? '').split('|').map((k) => k.trim()).filter(Boolean);
    if (!tenant || keys.length === 0) continue;
    const set = table.get(tenant) ?? new Set<string>();
    for (const k of keys) set.add(k);
    table.set(tenant, set);
  }
  return table;
}

export type SdkKeyVerdict =
  | { ok: true; tenant: string }
  | { ok: false; status: 401 | 403; reason: string };

export function verifySdkKey(key: string, tenant: string | null, env: Pick<Env, 'SDK_KEYS' | 'AUTH_MODE' | 'TENANTS'>): SdkKeyVerdict {
  if (!key) return { ok: false, status: 401, reason: 'SDK key required' };
  const table = sdkKeyTable(env);
  const owners = [...table.entries()].filter(([, keys]) => keys.has(key)).map(([t]) => t);
  if (owners.length === 0) return { ok: false, status: 401, reason: 'SDK key not recognized' };
  // Explicit named grants remain valid even if this key also has a wildcard
  // entry. A null tenant is only the pure helper's named-owner lookup.
  const named = tenant ? owners.includes(tenant) : owners.some(owner => owner !== '*');
  let wildcard = false;
  if (!named && owners.includes('*')) {
    if (authMode(env) === 'open') wildcard = true;
    else {
      // tenantConfig reads TENANTS only and supplies canonical distinct brands.
      // Invalid configuration must never grant wildcard authority.
      try { wildcard = tenantConfig(env as Env).provisioned.length === 1; } catch { wildcard = false; }
    }
  }
  if (!named && !wildcard) {
    return { ok: false, status: 403, reason: 'SDK key is for a different tenant' };
  }
  return { ok: true, tenant: tenant ?? (owners.find((t) => t !== '*') ?? '*') };
}

/**
 * The SDK-facing surface. Reads the key from the header the SDK sends on fetch,
 * or from the query the SDK sends on a socket upgrade, where headers cannot be set.
 * Operator tools may use a Bearer token without a site key, but must hold an
 * explicit grant for the canonical tenant. JWT-required routes repeat that
 * authorization independently, so a site key never bypasses operator authority.
 */
export function sdkKey(): MiddlewareHandler<{ Bindings: Env; Variables: TenantVariables }> {
  return createMiddleware<{ Bindings: Env; Variables: TenantVariables }>(async (c, next) => {
    if (/\/(?:decisions\/snapshot|realtime\/(?:ws|session\/(?:[^/]+\/)?preferences))$/.test(new URL(c.req.url).pathname)) assertShopperSelectors(c.req.raw);
    let key: string;
    try { key = sdkRequestKey(c.req.raw); } catch {
      c.header('Cache-Control', 'no-store');
      return c.json({ ok: false, error: 'Invalid SDK key transport' }, 401);
    }
    if (authMode(c.env) === 'open') return next();
    if (!key && /^Bearer\s+\S+/i.test(c.req.header('Authorization') ?? '')) {
      return operatorJwt()(c as unknown as Parameters<ReturnType<typeof operatorJwt>>[0], next);
    }
    // The ingress resolver owns this context; key ownership must authorize it,
    // including generic routes that have no :tenant path parameter.
    const tenant = c.get('tenant');
    if (!isValidTenantId(tenant)) {
      c.header('Cache-Control', 'no-store');
      return c.json({ ok: false, error: 'Tenant unavailable' }, 403);
    }
    const verdict = verifySdkKey(key, tenant, c.env);
    if (verdict.ok) return next();
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: false, error: verdict.reason }, verdict.status);
  });
}

/** Browser sockets cannot set headers. This canonical protocol is still a
 * secret transport, not a logging/redaction or deployed-access guarantee. */
export function sdkRequestKey(request: Request): string {
  const offered = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map(v => v.trim());
  const keys = offered.filter(v => v.startsWith('sdk-key-v1'));
  if (keys.length > 1) throw new Error('Invalid site key');
  let protocol: string | undefined;
  if (keys.length) {
    const encoded = keys[0]!.slice('sdk-key-v1.'.length);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || !keys[0]!.startsWith('sdk-key-v1.') || !/^[A-Za-z0-9_-]{1,683}$/.test(encoded)) throw new Error('Invalid site key');
    const raw = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    protocol = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    const canonical = btoa(String.fromCharCode(...new TextEncoder().encode(protocol))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    if (raw.length > 512 || !protocol || protocol.trim() !== protocol || canonical !== encoded) throw new Error('Invalid site key');
  }
  const query = new URL(request.url).searchParams.getAll('sdkKey');
  if (query.length > 1) throw new Error('Invalid site key');
  const selected = [request.headers.get('X-SDK-Key'), query[0], protocol].filter((v): v is string => v !== undefined && v !== null);
  if (selected.some(v => !v || v !== v.trim() || v !== selected[0])) throw new Error('Conflicting site key');
  return selected[0] ?? '';
}

// ── Operator access ──────────────────────────────────────────────────────────

/**
 * Enforced reads and writes both need tenant-authorized operator access.
 * The historical export name remains for existing mounts; open demos bypass it.
 */
export function operatorWrites(): MiddlewareHandler<{ Bindings: Env }> {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    if (authMode(c.env) === 'open') return next();
    return operatorJwt()(c as unknown as Parameters<ReturnType<typeof operatorJwt>>[0], next);
  });
}
