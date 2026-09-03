import { DEFAULT_TENANT, type TenantVariables } from '@/tenancy/tenant';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '@/types/env';
import { CDPService } from '@/services/CDPService';
import { jwt } from '@/middleware/auth';

const cdp = new Hono<{ Bindings: Env; Variables: TenantVariables }>();

const ProfileRequestSchema = z.object({
  userId: z.string().optional(),
  email: z.string().email().optional(),
  anonymousId: z.string().optional(),
});

const SegmentRequestSchema = z.object({
  userId: z.string(),
  traits: z.record(z.string(), z.any()).optional(),
});

const EventRequestSchema = z.object({
  userId: z.string().optional(),
  anonymousId: z.string().optional(),
  event: z.string(),
  properties: z.record(z.string(), z.any()).optional(),
  traits: z.record(z.string(), z.any()).optional(),
});

cdp.use('/*', jwt({ required: false }));

cdp.post('/profile', async (c) => {
  try {
    const body = await c.req.json();
    const { userId, email, anonymousId } = ProfileRequestSchema.parse(body);
    
    if (!userId && !email && !anonymousId) {
      return c.json({ error: 'At least one identifier required' }, 400);
    }

    const cdpService = new CDPService(c.env, c.get('tenant') ?? DEFAULT_TENANT);
    const profile = await cdpService.getProfile({ userId, email, anonymousId });

    return c.json(profile);
  } catch (error) {
    console.error('CDP profile error:', error);
    return c.json({ error: 'Failed to retrieve profile' }, 500);
  }
});

cdp.post('/segments', async (c) => {
  try {
    const body = await c.req.json();
    const { userId, traits = {} } = SegmentRequestSchema.parse(body);

    const cdpService = new CDPService(c.env, c.get('tenant') ?? DEFAULT_TENANT);
    const segments = await cdpService.getSegments(userId, traits);

    return c.json({ userId, segments });
  } catch (error) {
    console.error('CDP segments error:', error);
    return c.json({ error: 'Failed to retrieve segments' }, 500);
  }
});

cdp.post('/identify', async (c) => {
  try {
    const body = await c.req.json();
    const { userId, anonymousId, traits = {} } = body;

    if (!userId && !anonymousId) {
      return c.json({ error: 'userId or anonymousId required' }, 400);
    }

    const cdpService = new CDPService(c.env, c.get('tenant') ?? DEFAULT_TENANT);
    await cdpService.identify({ userId, anonymousId, traits });

    return c.json({ success: true, timestamp: Date.now() });
  } catch (error) {
    console.error('CDP identify error:', error);
    return c.json({ error: 'Failed to identify user' }, 500);
  }
});

cdp.post('/track', async (c) => {
  try {
    const body = await c.req.json();
    const { userId, anonymousId, event, properties = {}, traits = {} } = 
      EventRequestSchema.parse(body);

    if (!userId && !anonymousId) {
      return c.json({ error: 'userId or anonymousId required' }, 400);
    }

    const cdpService = new CDPService(c.env, c.get('tenant') ?? DEFAULT_TENANT);
    await cdpService.track({
      userId,
      anonymousId,
      event,
      properties,
      traits,
    });

    return c.json({ success: true, timestamp: Date.now() });
  } catch (error) {
    console.error('CDP track error:', error);
    return c.json({ error: 'Failed to track event' }, 500);
  }
});

cdp.post('/forward/:destination', async (c) => {
  try {
    const destination = c.req.param('destination');
    const body = await c.req.json();

    const cdpService = new CDPService(c.env, c.get('tenant') ?? DEFAULT_TENANT);
    const result = await cdpService.forward(destination, body);

    return c.json(result);
  } catch (error) {
    console.error('CDP forward error:', error);
    return c.json({ error: 'Failed to forward event' }, 500);
  }
});

cdp.get('/destinations', jwt(), async (c) => {
  try {
    const cdpService = new CDPService(c.env, c.get('tenant') ?? DEFAULT_TENANT);
    const destinations = await cdpService.getDestinations();

    return c.json({ destinations });
  } catch (error) {
    console.error('CDP destinations error:', error);
    return c.json({ error: 'Failed to get destinations' }, 500);
  }
});

cdp.post('/destinations', jwt({ roles: ['admin'] }), async (c) => {
  try {
    const body = await c.req.json();
    const { name, type, config } = body;

    if (!name || !type || !config) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const cdpService = new CDPService(c.env, c.get('tenant') ?? DEFAULT_TENANT);
    const destination = await cdpService.createDestination({ 
      name, 
      type, 
      config, 
      enabled: true 
    });

    return c.json(destination);
  } catch (error) {
    console.error('CDP create destination error:', error);
    return c.json({ error: 'Failed to create destination' }, 500);
  }
});

cdp.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'cdp' });
});

export { cdp as cdpRoutes };