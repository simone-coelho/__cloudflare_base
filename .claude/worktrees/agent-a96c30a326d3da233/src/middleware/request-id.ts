import { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';

export const requestId = (): MiddlewareHandler<{
  Variables: { requestId: string };
}> => {
  return createMiddleware(async (c, next) => {
    const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    await next();
  });
};