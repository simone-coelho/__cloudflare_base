import type { MiddlewareHandler } from 'hono';
import type { Env } from '@/types/env';
import { isValidTenantId, type TenantVariables } from '@/tenancy/tenant';
import { tenantConfig } from '@/tenancy/middleware';
import { jwt, type AuthContext } from './auth';
import { customerAuthority } from '@/auth/authority';

type OperatorContext = { Bindings: Env; Variables: TenantVariables & { auth: AuthContext } };

/** Trusted stamp assignments, never token roles/email or a request selector. */
export function hasOperatorGrant(env: Env, subject: string | undefined, tenant: unknown, auth?: AuthContext): boolean {
  if (!subject || !isValidTenantId(tenant)) return false;
  try {
    const raw = env.TENANTS;
    const { provisioned } = tenantConfig({ TENANTS: raw } as Env);
    if (!provisioned.includes(tenant) || typeof raw !== 'string') return false;
    if (customerAuthority(env)) return auth?.isAuthenticated === true && auth.user?.sub === subject
      && Boolean(auth.authority?.grants.some(grant => grant.tenant === tenant));
    const grants: unknown = JSON.parse(raw).operatorGrants;
    if (!grants || typeof grants !== 'object' || Array.isArray(grants)) return false;
    for (const [sub, tenants] of Object.entries(grants)) {
      if (!sub.trim() || sub === '*' || !Array.isArray(tenants)
        || !tenants.every(id => isValidTenantId(id) && provisioned.includes(id))) return false;
    }
    return Object.hasOwn(grants, subject)
      && (grants as Record<string, string[]>)[subject]!.includes(tenant);
  } catch { return false; }
}

/** Required access JWT plus explicit tenant authority in enforced mode. */
export function operatorJwt(): MiddlewareHandler<OperatorContext> {
  return async (c, next) => {
    c.header('Cache-Control', 'no-store');
    return jwt({ required: true })(c as unknown as Parameters<ReturnType<typeof jwt>>[0], async () => {
      if (c.env.AUTH_MODE === 'enforced'
        && !hasOperatorGrant(c.env, c.get('auth')?.user?.sub, c.get('tenant'), c.get('auth'))) {
        c.res = c.json({ error: 'Operator tenant authority unavailable' }, 403);
        return;
      }
      const auth = c.get('auth'), grant = auth?.authority?.grants.find(g => g.tenant === c.get('tenant'));
      if (customerAuthority(c.env) && auth?.user && grant) {
        // Tenant privilege must not inherit the shared identity's global role.
        auth.user = { ...auth.user, roles: [grant.role], permissions: grant.role === 'admin' ? ['*'] : ['read'] };
      }
      await next();
    });
  };
}
