import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '@/types/env';
import { EventDispatcher } from '@/services/EventDispatcher';

const webhook = new Hono<{ Bindings: Env }>();

const WebhookEventSchema = z.object({
  source: z.string(),
  event_type: z.string(),
  timestamp: z.number(),
  data: z.record(z.any()),
  signature: z.string().optional(),
});

webhook.post('/optimizely', async (c) => {
  try {
    const body = await c.req.json();
    const event = WebhookEventSchema.parse(body);
    
    const transformedEvent = {
      eventId: crypto.randomUUID(),
      timestamp: event.timestamp,
      eventType: 'track' as const,
      source: 'optimizely-webhook',
      version: '1.0',
      event: event.event_type,
      properties: event.data,
      user: {
        anonymousId: event.data.visitor_uuid || crypto.randomUUID(),
        userId: event.data.user_id,
      },
    };

    const dispatcher = new EventDispatcher(c.env);
    await dispatcher.dispatch(transformedEvent);

    await c.env.ANALYTICS.writeDataPoint({
      blobs: [
        JSON.stringify(transformedEvent),
        'webhook',
        'optimizely',
      ],
      doubles: [transformedEvent.timestamp],
      indexes: [transformedEvent.user.anonymousId],
    });

    return c.json({ success: true, eventId: transformedEvent.eventId });
  } catch (error) {
    console.error('Optimizely webhook error:', error);
    return c.json({ error: 'Failed to process webhook' }, 400);
  }
});

webhook.post('/segment', async (c) => {
  try {
    const body = await c.req.json();
    
    const transformedEvent = {
      eventId: crypto.randomUUID(),
      timestamp: body.timestamp ? new Date(body.timestamp).getTime() : Date.now(),
      eventType: body.type || 'track',
      source: 'segment-webhook',
      version: '1.0',
      event: body.event,
      properties: body.properties || {},
      user: {
        userId: body.userId,
        anonymousId: body.anonymousId || crypto.randomUUID(),
        traits: body.traits,
      },
    };

    const dispatcher = new EventDispatcher(c.env);
    await dispatcher.dispatch(transformedEvent);

    await c.env.ANALYTICS.writeDataPoint({
      blobs: [
        JSON.stringify(transformedEvent),
        'webhook',
        'segment',
      ],
      doubles: [transformedEvent.timestamp],
      indexes: [transformedEvent.user.userId || transformedEvent.user.anonymousId],
    });

    return c.json({ success: true, eventId: transformedEvent.eventId });
  } catch (error) {
    console.error('Segment webhook error:', error);
    return c.json({ error: 'Failed to process webhook' }, 400);
  }
});

webhook.post('/custom', async (c) => {
  try {
    const body = await c.req.json();
    const source = c.req.header('X-Webhook-Source') || 'unknown';
    
    const transformedEvent = {
      eventId: crypto.randomUUID(),
      timestamp: Date.now(),
      eventType: 'track' as const,
      source: `webhook-${source}`,
      version: '1.0',
      event: body.event || 'custom_event',
      properties: body,
      user: {
        anonymousId: crypto.randomUUID(),
        userId: body.userId,
      },
    };

    const dispatcher = new EventDispatcher(c.env);
    await dispatcher.dispatch(transformedEvent);

    await c.env.ANALYTICS.writeDataPoint({
      blobs: [
        JSON.stringify(transformedEvent),
        'webhook',
        source,
      ],
      doubles: [transformedEvent.timestamp],
      indexes: [transformedEvent.user.anonymousId],
    });

    return c.json({ success: true, eventId: transformedEvent.eventId });
  } catch (error) {
    console.error('Custom webhook error:', error);
    return c.json({ error: 'Failed to process webhook' }, 400);
  }
});

webhook.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'webhook' });
});

export { webhook as webhookRoutes };