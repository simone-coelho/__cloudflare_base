import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { readSigningConfig, SIGNING_CONFIGURATION_UNAVAILABLE } from '@/auth/signingConfig.mjs';
import { tenantConfig } from '@/tenancy/middleware';
import { IDENTITY_MATERIAL_UNAVAILABLE, requiresSafeIdentity, validateIdentityMaterial } from '@/identity/material.mjs';
import { recoveryReady } from '@/ledger/quarantine';

const health = new Hono<{ Bindings: Env }>();

health.get('/', async (c) => {
  const checks = {
    timestamp: Date.now(),
    environment: c.env.ENVIRONMENT,
    status: 'healthy',
    services: {
      cache: 'unknown',
      storage: 'unknown',
      queue: 'unknown',
      durable_objects: 'unknown',
      analytics: 'unknown',
    },
  };

  try {
    await c.env.CACHE.get('health-check');
    checks.services.cache = 'healthy';
  } catch (error) {
    checks.services.cache = 'unhealthy';
    checks.status = 'degraded';
  }

  try {
    await c.env.STORAGE.head('health-check');
    checks.services.storage = 'healthy';
  } catch (error) {
    checks.services.storage = 'unhealthy';   // it used to say healthy here too, which is not a check
    checks.status = 'degraded';
  }

  // The queue is not probed by enqueueing: every health call used to add a message the consumer then
  // logged as an unknown event. The binding's presence is the check; the monitor exercises the real path.
  checks.services.queue = c.env.EVENT_QUEUE ? 'bound' : 'unbound';
  if (!c.env.EVENT_QUEUE) checks.status = 'degraded';

  try {
    const id = c.env.STATE_MANAGER.idFromName('health-check');
    const stub = c.env.STATE_MANAGER.get(id);
    await stub.fetch('http://fake/get?key=health');
    checks.services.durable_objects = 'healthy';
  } catch (error) {
    checks.services.durable_objects = 'unhealthy';
    checks.status = 'degraded';
  }

  // This is a stamp-level check, not a tenant event. No tenant may be selected
  // merely to borrow its optional telemetry policy. Do not touch the binding
  // or report held capture as a successful dataset write/readback.
  checks.services.analytics = 'held: no stamp-scoped telemetry authority';

  const statusCode = checks.status === 'healthy' ? 200 : 503;
  return c.json(checks, statusCode);
});

health.get('/ready', (c) => {
  c.header('Cache-Control', 'no-store');
  if (!readSigningConfig(c.env)) {
    return c.json({ status: 'not_ready', error: SIGNING_CONFIGURATION_UNAVAILABLE, timestamp: Date.now() }, 503);
  }
  try {
    if (requiresSafeIdentity(c.env)) validateIdentityMaterial(c.env, tenantConfig(c.env).provisioned);
  } catch { return c.json({ status: 'not_ready', error: IDENTITY_MATERIAL_UNAVAILABLE, timestamp: Date.now() }, 503); }
  if (c.env.LEDGER_RECOVERY_ENABLED !== undefined && c.env.LEDGER_RECOVERY_ENABLED !== 'false' && !recoveryReady(c.env)) {
    return c.json({ status: 'not_ready', error: 'Durable recovery prerequisites unavailable', timestamp: Date.now() }, 503);
  }
  return c.json({ status: 'ready', timestamp: Date.now() });
});

health.get('/live', (c) => {
  return c.json({ status: 'alive', timestamp: Date.now() });
});

export { health as healthRoutes };
