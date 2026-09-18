// src/tenancy/middleware.ts
// ---------------------------------------------------------------------------
// Resolving which brand a request belongs to, once, at the edge of the worker.
//
// Until this, every converted call site passed DEFAULT_TENANT explicitly: the
// isolation was real and provably correct, and nothing could reach it. This is
// the wiring.
//
// An absent manifest retains legacy Coach operation. An explicit manifest is
// the complete local authority: invalid configuration or disagreeing selectors
// refuse tenant work. Provisioning is not SDK/operator authorization.
// ---------------------------------------------------------------------------

import { createMiddleware } from 'hono/factory';
import { getPath } from 'hono/utils/url';
import type { Env } from '@/types/env';
import { DEFAULT_TENANT, isValidTenantId, resolveTenant, TenantResolutionError, type TenantId } from '@/tenancy/tenant';

export interface TenantConfig {
  /** The distinct brands this stamp explicitly serves, in declared order. */
  provisioned: TenantId[];
  /** host -> tenant, for brands on their own domain. */
  hosts: Record<string, TenantId>;
}

export class TenantConfigurationError extends Error {
  constructor() { super('Tenant configuration unavailable'); this.name = 'TenantConfigurationError'; }
}

function validHost(host: string): boolean {
  try {
    const url = new URL(`https://${host}`);
    if (url.hostname !== host || url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return false;
    if (host.startsWith('[')) return true; // URL validated an IPv6 address.
    return host.length <= 253 && host.replace(/\.$/, '').split('.').every(label =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  } catch { return false; }
}

/**
 * Read the stamp's tenant configuration from `TENANTS`, a JSON object:
 *
 *     { "provisioned": ["coach", "kate-spade"],
 *       "hosts": { "shop.katespade.com": "kate-spade" } }
 *
 * Reject an invalid explicit manifest as a whole. Never silently add a tenant
 * or discard a host mapping. Each call owns its arrays and host map.
 */
export function tenantConfig(env: Pick<Env, 'TENANTS' | 'DEPLOYMENT_PROFILE'>): TenantConfig {
  try {
    const raw = env.TENANTS;
    if (raw === undefined) {
      if (env.DEPLOYMENT_PROFILE === 'customer') throw new TenantConfigurationError();
      return { provisioned: [DEFAULT_TENANT], hosts: {} };
    }
    if (typeof raw !== 'string' || raw.trim() === '') throw new TenantConfigurationError();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new TenantConfigurationError();
    const obj = parsed as { provisioned?: unknown; hosts?: unknown };
    if (!Array.isArray(obj.provisioned) || !obj.provisioned.length || !obj.provisioned.every(isValidTenantId)) throw new TenantConfigurationError();
    const provisioned = [...new Set(obj.provisioned)];
    const hosts: Record<string, TenantId> = Object.create(null);
    if (obj.hosts !== undefined) {
      if (!obj.hosts || typeof obj.hosts !== 'object' || Array.isArray(obj.hosts)) throw new TenantConfigurationError();
      for (const [host, tenant] of Object.entries(obj.hosts)) {
        const h = host.trim().toLowerCase();
        if (!validHost(h) || !isValidTenantId(tenant) || !provisioned.includes(tenant)
          || (Object.hasOwn(hosts, h) && hosts[h] !== tenant)) throw new TenantConfigurationError();
        hosts[h] = tenant;
      }
    }
    return { provisioned, hosts };
  } catch { throw new TenantConfigurationError(); }
}

/** Shared by Hono ingress and shopper capability checks, including WebSockets. */
export function tenantForRequest(env: Env, req: Request): TenantId {
  const cfg = tenantConfig(env);
  try {
    const url = new URL(req.url);
    // Match Hono's route decoding, then its parameter decoding. The global
    // middleware's own route does not carry the downstream :tenant parameter.
    const path = getPath(req).split('/');
    let explicit: string | undefined;
    if (path[1] === 'v1' && path.length > 2) {
      explicit = decodeURIComponent(path[2]!);
      // Downstream document handlers retain the decoded spelling as their key.
      if (!isValidTenantId(explicit)) throw new TenantResolutionError();
    }
    if (req.method === 'GET' && path.length === 5 && path[1] === 'auth' && path[2] === 'oidc' && path[3] === 'callback') {
      explicit = decodeURIComponent(path[4]!);
      if (!isValidTenantId(explicit)) throw new TenantResolutionError();
    }
    return resolveTenant({
      explicit,
      header: req.headers.get('X-Tenant'),
      query: req.headers.get('Upgrade')?.toLowerCase() === 'websocket' ? url.searchParams.getAll('tenant') : [],
      host: url.hostname,
      hostMap: cfg.hosts,
      provisioned: cfg.provisioned,
    });
  } catch { throw new TenantResolutionError(); }
}

/** Sets `c.get('tenant')` for every downstream handler. */
export const tenantMiddleware = () =>
  createMiddleware<{ Bindings: Env; Variables: { tenant: TenantId } }>(async (c, next) => {
    try { c.set('tenant', tenantForRequest(c.env, c.req.raw)); }
    catch (error) {
      c.header('Cache-Control', 'no-store');
      return error instanceof TenantResolutionError
        ? c.json({ ok: false, error: 'Tenant unavailable' }, 403)
        : c.json({ ok: false, error: 'Tenant configuration unavailable' }, 503);
    }
    await next();
  });
