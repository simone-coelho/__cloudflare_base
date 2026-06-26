import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '@/types/env';
import { EventDispatcher } from '@/services/EventDispatcher';
import { OptimizelyService } from '@/services/OptimizelyService';

const webhook = new Hono<{ Bindings: Env }>();

const WebhookEventSchema = z.object({
  source: z.string(),
  event_type: z.string(),
  timestamp: z.number(),
  data: z.record(z.string(), z.any()),
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

// Optimizely DATAFILE webhook — fires whenever the project's datafile changes (a flag/rule/audience
// edit in the Optimizely UI, or one Opal just created). We re-fetch the datafile once and overwrite
// the KV cache, so steady-state edge decisions read KV (fast) and stay current without polling.
// Configure in Optimizely: Settings → Webhooks → URL = https://<worker>/webhook/optimizely-datafile.
webhook.post('/optimizely-datafile', async (c) => {
  try {
    const raw = await c.req.text();
    const secret = c.env.OPTIMIZELY_WEBHOOK_SECRET;
    if (secret) {
      const ok = await verifyHubSignature(secret, raw, c.req.header('X-Hub-Signature') || '');
      if (!ok) return c.json({ error: 'invalid signature' }, 401);
    }
    const { revision, flags } = await new OptimizelyService(c.env).refreshDatafileCache();
    console.log(`Datafile webhook: cache refreshed to revision ${revision} (${flags} flags)`);
    return c.json({ success: true, revision, flags });
  } catch (error) {
    console.error('Optimizely datafile webhook error:', error);
    return c.json({ error: 'Failed to refresh datafile' }, 500);
  }
});

/** Verify Optimizely's X-Hub-Signature ("sha1=<hmac>") over the raw body (constant-time). */
async function verifyHubSignature(secret: string, raw: string, header: string): Promise<boolean> {
  const expected = (header || '').replace(/^sha1=/, '').trim();
  if (!expected) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

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