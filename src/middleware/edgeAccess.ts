// src/middleware/edgeAccess.ts
// ─────────────────────────────────────────────────────────────────────────────
// CW10 — who may talk to the worker, and from where.
//
// Three gates, one switch. AUTH_MODE is 'open' by default, which is byte-for-byte
// today's behavior: the shared demo worker keeps working, the Coach console keeps
// posting to /operator without a token, the storefront keeps posting to /realtime
// without a key, and CORS reflects any origin. AUTH_MODE = 'enforced' is what the
// staging stamp sets: the SDK-facing surface needs an SDK key, operator writes
// need a JWT, and CORS answers only the configured origins (and the page's own).
//
// The one exception to the switch is CORS_ORIGINS: when it is configured, the
// allow-list applies in either mode, because listing origins IS the decision.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Env } from '@/types/env';
import { jwt } from './auth';

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
 * for any tenant. The value is a secret; the format is not.
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

export function verifySdkKey(key: string, tenant: string | null, env: Pick<Env, 'SDK_KEYS'>): SdkKeyVerdict {
  if (!key) return { ok: false, status: 401, reason: 'SDK key required' };
  const table = sdkKeyTable(env);
  const owners = [...table.entries()].filter(([, keys]) => keys.has(key)).map(([t]) => t);
  if (owners.length === 0) return { ok: false, status: 401, reason: 'SDK key not recognized' };
  if (tenant && !owners.includes(tenant) && !owners.includes('*')) {
    return { ok: false, status: 403, reason: 'SDK key is for a different tenant' };
  }
  return { ok: true, tenant: tenant ?? (owners.find((t) => t !== '*') ?? '*') };
}

/**
 * The SDK-facing surface. Reads the key from the header the SDK sends on fetch,
 * or from the query the SDK sends on a socket upgrade, where headers cannot be set.
 * An operator token is stronger than a site key: the learning console and the
 * support tools reach the same routes with a Bearer token and no site key, and a
 * verified token passes the gate (CW22, 2026-09-04). Routes that require a token
 * still verify it themselves; this only opens the door the site key guards.
 */
export function sdkKey(): MiddlewareHandler<{ Bindings: Env }> {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    if (authMode(c.env) === 'open') return next();
    const key = (c.req.header('X-SDK-Key') ?? c.req.query('sdkKey') ?? '').trim();
    if (!key && /^Bearer\s+\S+/i.test(c.req.header('Authorization') ?? '')) {
      return jwt({ required: true })(c as unknown as Parameters<ReturnType<typeof jwt>>[0], next);
    }
    const tenant = (c.req.param('tenant') ?? '').trim() || null;
    const verdict = verifySdkKey(key, tenant, c.env);
    if (verdict.ok) return next();
    return c.json({ ok: false, error: verdict.reason }, verdict.status);
  });
}

// ── Operator writes ──────────────────────────────────────────────────────────

/**
 * Reads stay open; anything that changes state needs a verified token. The
 * config routes already hold this line unconditionally; this brings the
 * operator surface up to it when enforced.
 */
export function operatorWrites(): MiddlewareHandler<{ Bindings: Env }> {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    if (authMode(c.env) === 'open') return next();
    const m = c.req.method.toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
    return jwt({ required: true })(c as unknown as Parameters<ReturnType<typeof jwt>>[0], next);
  });
}
