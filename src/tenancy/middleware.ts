// src/tenancy/middleware.ts
// ---------------------------------------------------------------------------
// Resolving which brand a request belongs to, once, at the edge of the worker.
//
// Until this, every converted call site passed DEFAULT_TENANT explicitly: the
// isolation was real and provably correct, and nothing could reach it. This is
// the wiring.
//
// TWO PROPERTIES IT HAS TO HAVE.
//
// It cannot throw. Tenant resolution runs before every request, including the
// health check, so a malformed TENANTS variable must degrade to "serve the
// default brand" rather than 500 the whole worker. A stamp with a typo in its
// configuration should look under-provisioned, not dead.
//
// It cannot let a caller pick a brand. `X-Tenant` is caller-controlled, so it is
// only honoured for a brand this stamp has actually provisioned. An unconfigured
// stamp is default-only, which is the safe reading rather than the permissive one.
// ---------------------------------------------------------------------------

import { createMiddleware } from 'hono/factory';
import type { Env } from '@/types/env';
import { DEFAULT_TENANT, isValidTenantId, resolveTenant, type TenantId } from '@/tenancy/tenant';

export interface TenantConfig {
  /** The brands this stamp serves. Always contains the default. */
  provisioned: TenantId[];
  /** host -> tenant, for brands on their own domain. */
  hosts: Record<string, TenantId>;
}

const DEFAULT_CONFIG: TenantConfig = { provisioned: [DEFAULT_TENANT], hosts: {} };

/**
 * Read the stamp's tenant configuration from `TENANTS`, a JSON object:
 *
 *     { "provisioned": ["coach", "kate-spade"],
 *       "hosts": { "shop.katespade.com": "kate-spade" } }
 *
 * Anything unparseable, malformed, or naming an invalid tenant id degrades to
 * default-only. Entries that are individually invalid are dropped rather than
 * failing the whole config, so one bad host line cannot deprovision a brand.
 */
export function tenantConfig(env: Env): TenantConfig {
  const raw = (env as unknown as { TENANTS?: string }).TENANTS;
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_CONFIG;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[tenancy] TENANTS is not valid JSON; serving the default brand only');
    return DEFAULT_CONFIG;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_CONFIG;
  const obj = parsed as { provisioned?: unknown; hosts?: unknown };

  const provisioned = Array.isArray(obj.provisioned)
    ? obj.provisioned.filter(isValidTenantId)
    : [];
  if (!provisioned.includes(DEFAULT_TENANT)) provisioned.push(DEFAULT_TENANT);

  const hosts: Record<string, TenantId> = {};
  if (obj.hosts && typeof obj.hosts === 'object' && !Array.isArray(obj.hosts)) {
    for (const [host, tenant] of Object.entries(obj.hosts as Record<string, unknown>)) {
      const h = host.trim().toLowerCase();
      if (h !== '' && isValidTenantId(tenant)) hosts[h] = tenant;
    }
  }
  return { provisioned, hosts };
}

/** The tenant for a request, given the stamp's configuration. Never throws. */
export function tenantForRequest(env: Env, req: Request): TenantId {
  try {
    const cfg = tenantConfig(env);
    let host: string | null = null;
    try {
      host = new URL(req.url).hostname;
    } catch {
      host = null;
    }
    return resolveTenant({
      header: req.headers.get('X-Tenant'),
      host,
      hostMap: cfg.hosts,
      provisioned: cfg.provisioned,
    });
  } catch (err) {
    // Belt and braces. This runs before every request; the worst acceptable
    // outcome is "you got the default brand", never "the worker is down".
    console.warn('[tenancy] resolution failed, serving the default brand', err);
    return DEFAULT_TENANT;
  }
}

/** Sets `c.get('tenant')` for every downstream handler. */
export const tenantMiddleware = () =>
  createMiddleware<{ Bindings: Env; Variables: { tenant: TenantId } }>(async (c, next) => {
    c.set('tenant', tenantForRequest(c.env, c.req.raw));
    await next();
  });
