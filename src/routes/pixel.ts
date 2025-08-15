import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { PixelDecoder } from '@/services/PixelDecoder';
import { EventDispatcher } from '@/services/EventDispatcher';
import { generateEmailPixel } from '@/utils/pixel';
import { getUserContext, getPageContext } from '@/utils/context';

const pixel = new Hono<{ Bindings: Env }>();

const PIXEL_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x04, 0x01, 0x00, 0x3b
]);

pixel.get('/track/:pixelId', async (c) => {
  const pixelId = c.req.param('pixelId');
  const url = new URL(c.req.url);
  
  try {
    const decoder = new PixelDecoder();
    const decodedData = decoder.decode(pixelId);
    
    const event = {
      eventId: crypto.randomUUID(),
      timestamp: Date.now(),
      eventType: 'pixel' as const,
      source: 'pixel',
      version: '1.0',
      pixelId,
      ...decodedData,
      user: {
        anonymousId: decodedData.recipientId || crypto.randomUUID(),
        ...getUserContext(c.req),
      },
      page: getPageContext(c.req),
      metadata: {
        queryParams: Object.fromEntries(url.searchParams),
        userAgent: c.req.header('User-Agent'),
        referer: c.req.header('Referer'),
      },
    };

    const dispatcher = new EventDispatcher(c.env);
    await dispatcher.dispatch(event);

    await c.env.ANALYTICS.writeDataPoint({
      blobs: [
        JSON.stringify(event),
        'pixel',
        'pixel-tracking',
      ],
      doubles: [event.timestamp],
      indexes: [event.user.anonymousId],
    });

    return new Response(PIXEL_GIF, {
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('Pixel tracking error:', error);
    
    return new Response(PIXEL_GIF, {
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  }
});

pixel.post('/generate', async (c) => {
  try {
    const body = await c.req.json();
    const { campaignId, emailId, recipientId, metadata = {} } = body;
    
    if (!campaignId || !emailId || !recipientId) {
      return c.json({ 
        error: 'Missing required fields: campaignId, emailId, recipientId' 
      }, 400);
    }

    const pixelData = {
      campaignId,
      emailId,
      recipientId,
      metadata,
      timestamp: Date.now(),
    };

    const pixelId = generateEmailPixel(pixelData);
    const pixelUrl = `${new URL(c.req.url).origin}/pixel/track/${pixelId}`;
    
    return c.json({
      pixelId,
      pixelUrl,
      htmlTag: `<img src="${pixelUrl}" width="1" height="1" style="display:none;" />`,
      data: pixelData,
    });
  } catch (error) {
    console.error('Pixel generation error:', error);
    return c.json({ error: 'Failed to generate pixel' }, 500);
  }
});

pixel.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'pixel' });
});

export { pixel as pixelRoutes };