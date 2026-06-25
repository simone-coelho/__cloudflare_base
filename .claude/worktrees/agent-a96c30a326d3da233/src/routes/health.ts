import { Hono } from 'hono';
import type { Env } from '@/types/env';

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
    checks.services.storage = 'healthy';
  }

  try {
    await c.env.EVENT_QUEUE.send({
      type: 'health-check',
      timestamp: Date.now(),
    });
    checks.services.queue = 'healthy';
  } catch (error) {
    checks.services.queue = 'unhealthy';
    checks.status = 'degraded';
  }

  try {
    const id = c.env.STATE_MANAGER.idFromName('health-check');
    const stub = c.env.STATE_MANAGER.get(id);
    await stub.fetch('http://fake/get?key=health');
    checks.services.durable_objects = 'healthy';
  } catch (error) {
    checks.services.durable_objects = 'unhealthy';
    checks.status = 'degraded';
  }

  try {
    await c.env.ANALYTICS.writeDataPoint({
      blobs: ['health-check'],
      doubles: [Date.now()],
      indexes: ['health'],
    });
    checks.services.analytics = 'healthy';
  } catch (error) {
    checks.services.analytics = 'unhealthy';
    checks.status = 'degraded';
  }

  const statusCode = checks.status === 'healthy' ? 200 : 503;
  return c.json(checks, statusCode);
});

health.get('/ready', (c) => {
  return c.json({ status: 'ready', timestamp: Date.now() });
});

health.get('/live', (c) => {
  return c.json({ status: 'alive', timestamp: Date.now() });
});

export { health as healthRoutes };