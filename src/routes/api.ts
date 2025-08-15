import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { jwt } from '@/middleware/auth';

const api = new Hono<{ Bindings: Env }>();

api.use('/*', jwt());

api.get('/storage/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const object = await c.env.STORAGE.get(key);
    
    if (!object) {
      return c.json({ error: 'Object not found' }, 404);
    }
    
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    
    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Storage get error:', error);
    return c.json({ error: 'Failed to retrieve object' }, 500);
  }
});

api.put('/storage/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const body = await c.req.arrayBuffer();
    
    const object = await c.env.STORAGE.put(key, body, {
      httpMetadata: {
        contentType: c.req.header('Content-Type') || 'application/octet-stream',
      },
    });
    
    return c.json({
      success: true,
      key,
      etag: object.etag,
      size: object.size,
    });
  } catch (error) {
    console.error('Storage put error:', error);
    return c.json({ error: 'Failed to store object' }, 500);
  }
});

api.delete('/storage/:key', async (c) => {
  try {
    const key = c.req.param('key');
    await c.env.STORAGE.delete(key);
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Storage delete error:', error);
    return c.json({ error: 'Failed to delete object' }, 500);
  }
});

api.get('/cache/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const value = await c.env.CACHE.get(key, 'json');
    
    if (value === null) {
      return c.json({ error: 'Key not found' }, 404);
    }
    
    return c.json({ key, value: value as any });
  } catch (error) {
    console.error('Cache get error:', error);
    return c.json({ error: 'Failed to retrieve from cache' }, 500);
  }
});

api.put('/cache/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const body = await c.req.json();
    const { value, ttl } = body;
    
    const options: KVNamespacePutOptions = {};
    if (ttl) {
      options.expirationTtl = ttl;
    }
    
    await c.env.CACHE.put(key, JSON.stringify(value), options);
    
    return c.json({ success: true, key });
  } catch (error) {
    console.error('Cache put error:', error);
    return c.json({ error: 'Failed to store in cache' }, 500);
  }
});

api.delete('/cache/:key', async (c) => {
  try {
    const key = c.req.param('key');
    await c.env.CACHE.delete(key);
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Cache delete error:', error);
    return c.json({ error: 'Failed to delete from cache' }, 500);
  }
});

api.post('/queue/send', async (c) => {
  try {
    const body = await c.req.json();
    
    await c.env.EVENT_QUEUE.send(body);
    
    return c.json({ success: true, timestamp: Date.now() });
  } catch (error) {
    console.error('Queue send error:', error);
    return c.json({ error: 'Failed to send to queue' }, 500);
  }
});

api.get('/state/:namespace/:key', async (c) => {
  try {
    const namespace = c.req.param('namespace');
    const key = c.req.param('key');
    
    let durableObject;
    if (namespace === 'state') {
      const id = c.env.STATE_MANAGER.idFromName(key);
      durableObject = c.env.STATE_MANAGER.get(id);
    } else {
      return c.json({ error: 'Unknown namespace' }, 400);
    }
    
    const response = await durableObject.fetch(new Request(`http://fake/get?key=${key}`));
    
    if (response.status === 404) {
      return c.json({ error: 'Key not found' }, 404);
    }
    
    const data = await response.json();
    return c.json(data as any);
  } catch (error) {
    console.error('State get error:', error);
    return c.json({ error: 'Failed to retrieve state' }, 500);
  }
});

api.put('/state/:namespace/:key', async (c) => {
  try {
    const namespace = c.req.param('namespace');
    const key = c.req.param('key');
    const body = await c.req.json();
    
    let durableObject;
    if (namespace === 'state') {
      const id = c.env.STATE_MANAGER.idFromName(key);
      durableObject = c.env.STATE_MANAGER.get(id);
    } else {
      return c.json({ error: 'Unknown namespace' }, 400);
    }
    
    const response = await durableObject.fetch(new Request('http://fake/set', {
      method: 'POST',
      body: JSON.stringify({ key, ...body }),
    }));
    
    const data = await response.json();
    return c.json(data as any);
  } catch (error) {
    console.error('State put error:', error);
    return c.json({ error: 'Failed to store state' }, 500);
  }
});

api.get('/analytics/query', async (c) => {
  try {
    const query = c.req.query('query');
    
    if (!query) {
      return c.json({ error: 'Query parameter required' }, 400);
    }
    
    return c.json({
      message: 'Analytics querying not implemented in demo',
      query,
      note: 'This would typically query the Analytics Engine dataset',
    });
  } catch (error) {
    console.error('Analytics query error:', error);
    return c.json({ error: 'Failed to query analytics' }, 500);
  }
});

export { api as apiRoutes };