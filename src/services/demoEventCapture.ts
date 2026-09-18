import type { Env } from '@/types/env';
import { DEFAULT_TENANT } from '@/tenancy/tenant';

/** Legacy tenantless D1 capture is restricted to an explicitly enabled development demo. */
export function demoEventCaptureEnabled(
  env: Partial<Pick<Env, 'AUTH_MODE' | 'ENVIRONMENT' | 'DEMO_EVENT_CAPTURE'>>,
  tenant: string | undefined,
): boolean {
  return env.AUTH_MODE === 'open'
    && typeof env.ENVIRONMENT === 'string' && env.ENVIRONMENT.trim().toLowerCase() === 'development'
    && typeof env.DEMO_EVENT_CAPTURE === 'string' && env.DEMO_EVENT_CAPTURE.trim().toLowerCase() === 'true'
    && tenant === DEFAULT_TENANT;
}
