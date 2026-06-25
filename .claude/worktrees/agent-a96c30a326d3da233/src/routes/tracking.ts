import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '@/types/env';
import { EventSchema, Event } from '@/types/events';
import { EventDispatcher } from '@/services/EventDispatcher';
import { getUserContext, getPageContext } from '@/utils/context';

const tracking = new Hono<{ Bindings: Env }>();

tracking.post('/event', async (c) => {
  try {
    const body = await c.req.json();
    const event = EventSchema.parse(body) as Event;
    
    const enrichedEvent = {
      ...event,
      timestamp: Date.now(),
      source: 'api',
      user: {
        ...(event.user || {}),
        ...getUserContext(c.req),
        anonymousId: event.user?.anonymousId || crypto.randomUUID(),
      },
      page: 'page' in event && event.page ? {
        ...event.page,
        ...getPageContext(c.req),
      } : getPageContext(c.req),
    };

    const dispatcher = new EventDispatcher(c.env);
    await dispatcher.dispatch(enrichedEvent);

    await c.env.ANALYTICS.writeDataPoint({
      blobs: [
        JSON.stringify(enrichedEvent),
        enrichedEvent.eventType,
        enrichedEvent.source,
      ],
      doubles: [enrichedEvent.timestamp],
      indexes: [enrichedEvent.user.userId || enrichedEvent.user.anonymousId || 'unknown'],
    });

    return c.json({
      success: true,
      eventId: enrichedEvent.eventId,
      timestamp: enrichedEvent.timestamp,
    });
  } catch (error) {
    console.error('Tracking error:', error);
    return c.json({ error: 'Invalid event data' }, 400);
  }
});

tracking.post('/batch', async (c) => {
  try {
    const body = await c.req.json();
    const BatchSchema = z.object({
      events: z.array(EventSchema),
      context: z.object({
        source: z.string().optional(),
        campaignId: z.string().optional(),
        sessionId: z.string().optional(),
      }).optional(),
    });

    const { events, context } = BatchSchema.parse(body);
    const dispatcher = new EventDispatcher(c.env);
    const results = [];

    for (const event of events) {
      try {
        const enrichedEvent = {
          ...event,
          timestamp: Date.now(),
          source: context?.source || 'batch',
          user: {
            ...(event.user || {}),
            ...getUserContext(c.req),
            anonymousId: event.user?.anonymousId || crypto.randomUUID(),
          },
          page: 'page' in event && event.page ? {
            ...event.page,
            ...getPageContext(c.req),
          } : getPageContext(c.req),
        };

        await dispatcher.dispatch(enrichedEvent);

        await c.env.ANALYTICS.writeDataPoint({
          blobs: [
            JSON.stringify(enrichedEvent),
            enrichedEvent.eventType,
            enrichedEvent.source,
          ],
          doubles: [enrichedEvent.timestamp],
          indexes: [enrichedEvent.user.userId || enrichedEvent.user.anonymousId || 'unknown'],
        });

        results.push({
          eventId: enrichedEvent.eventId,
          status: 'success',
        });
      } catch (error) {
        console.error('Batch event error:', error);
        results.push({
          eventId: event.eventId,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return c.json({
      success: true,
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error('Batch tracking error:', error);
    return c.json({ error: 'Invalid batch data' }, 400);
  }
});

tracking.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'tracking' });
});

export { tracking as trackingRoutes };