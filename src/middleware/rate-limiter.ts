import { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Env } from '@/types/env';

interface RateLimitOptions {
  limit?: number;
  window?: number;
  keyGenerator?: (c: any) => string;
}

export const rateLimiter = (
  options: RateLimitOptions = {}
): MiddlewareHandler<{ Bindings: Env }> => {
  const { 
    limit = 100, 
    window = 60,
    keyGenerator = (c) => c.req.header('CF-Connecting-IP') || 'unknown'
  } = options;
  
  return createMiddleware(async (c, next) => {
    const key = keyGenerator(c);
    const id = c.env.RATE_LIMITER.idFromName(key);
    const rateLimiter = c.env.RATE_LIMITER.get(id);
    
    const response = await rateLimiter.fetch(c.req.raw, {
      method: 'POST',
      body: JSON.stringify({ limit, window }),
    });
    
    const result = await response.json() as { allowed: boolean; remaining: number };
    
    c.header('X-RateLimit-Limit', limit.toString());
    c.header('X-RateLimit-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Reset', (Date.now() + window * 1000).toString());
    
    if (!result.allowed) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }
    
    await next();
  });
};