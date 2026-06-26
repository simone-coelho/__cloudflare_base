import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { timing } from 'hono/timing';
import { secureHeaders } from 'hono/secure-headers';

import type { Env } from '@/types/env';
import { errorHandler } from '@/middleware/error';
import { requestId } from '@/middleware/request-id';
import { rateLimiter } from '@/middleware/rate-limiter';

import { authRoutes } from '@/routes/auth';
import { apiRoutes } from '@/routes/api';
import { trackingRoutes } from '@/routes/tracking';
import { pixelRoutes } from '@/routes/pixel';
import { webhookRoutes } from '@/routes/webhook';
import { healthRoutes } from '@/routes/health';
import { optimizelyRoutes } from '@/routes/optimizely';
import { cdpRoutes } from '@/routes/cdp';
import { operatorRoutes } from '@/routes/operator';
import realtimeRoutes from '@/routes/realtime';
import { aiRoutes } from '@/routes/ai';
import { aiSceneRoutes } from '@/routes/aiScene';

import { routeAgentRequest } from 'agents';

import { StateManager } from '@/durable-objects/StateManager';
import { RateLimiter } from '@/durable-objects/RateLimiter';
import { PersonalizationWebSocket } from '@/durable-objects/PersonalizationWebSocket';
import { OpalAgent } from '@/agents/OpalAgent';

const app = new Hono<{ Bindings: Env }>();

app.use('*', timing());
app.use('*', requestId());
app.use('*', logger());
app.use('*', secureHeaders());

app.use(
  '*',
  cors({
    origin: (origin) => origin,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposeHeaders: ['X-Request-Id', 'X-Response-Time'],
    credentials: true,
    maxAge: 86400,
  })
);

app.use('/api/*', rateLimiter());

app.onError(errorHandler);

app.route('/health', healthRoutes);
app.route('/auth', authRoutes);
app.route('/api', apiRoutes);
app.route('/track', trackingRoutes);
app.route('/pixel', pixelRoutes);
app.route('/webhook', webhookRoutes);
app.route('/optimizely', optimizelyRoutes);
app.route('/cdp', cdpRoutes);
app.route('/operator', operatorRoutes);
app.route('/realtime', realtimeRoutes);
app.route('/ai', aiRoutes);
app.route('/ai/scene', aiSceneRoutes);

// API info endpoint - moved to /api-info so root can serve static files
app.get('/api-info', (c) => {
  return c.json({
    name: 'Edge Platform API',
    version: '1.0.0',
    environment: c.env.ENVIRONMENT,
    endpoints: {
      demo: '/',
      health: '/health',
      auth: '/auth',
      api: '/api',
      tracking: '/track',
      pixel: '/pixel',
      webhook: '/webhook',
      optimizely: '/optimizely',
      cdp: '/cdp',
      realtime: '/realtime',
    },
  });
});

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

export { StateManager, RateLimiter, PersonalizationWebSocket, OpalAgent };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Route /agents/* to the Cloudflare Agents SDK (Opal chat). Returns null for
    // every other path, so all existing Hono routes are untouched.
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;
    return app.fetch(request, env, ctx);
  },
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    switch (event.cron) {
      case '*/5 * * * *':
        console.log('Running 5-minute scheduled task');
        break;
      case '0 * * * *':
        console.log('Running hourly scheduled task');
        break;
      default:
        console.log('Unknown scheduled event:', event.cron);
    }
  },
  queue: async (batch: MessageBatch, env: Env, ctx: ExecutionContext) => {
    for (const message of batch.messages) {
      try {
        const event = message.body;
        console.log('Processing queued event:', event);
        message.ack();
      } catch (error) {
        console.error('Error processing message:', error);
        message.retry();
      }
    }
  },
};