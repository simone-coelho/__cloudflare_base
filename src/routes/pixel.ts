import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { generateEmailPixel } from '@/utils/pixel';

const pixel = new Hono<{ Bindings: Env }>();

const PIXEL_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x04, 0x01, 0x00, 0x3b
]);

// Temporary local containment: an email image carries no owned consent proof.
// Preserve image delivery, but do not decode, enrich, collect or dispatch it.
pixel.get('/track/:pixelId', () => new Response(PIXEL_GIF, {
  headers: {
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  },
}));

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
      trackingEnabled: false,
      reason: 'Email pixel tracking is temporarily disabled pending an authorized consent-capable design',
      pixelId,
      pixelUrl,
      htmlTag: `<img src="${pixelUrl}" width="1" height="1" style="display:none;" />`,
      data: pixelData,
    });
  } catch (error) {
    console.error('Pixel generation error');
    return c.json({ error: 'Failed to generate pixel' }, 500);
  }
});

pixel.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'pixel' });
});

export { pixel as pixelRoutes };
