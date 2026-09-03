import { tenantMiddleware } from '@/tenancy/middleware';
import type { TenantId } from '@/tenancy/tenant';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { timing } from 'hono/timing';
import { secureHeaders } from 'hono/secure-headers';

import type { Env } from '@/types/env';
import { errorHandler } from '@/middleware/error';
import { requestId } from '@/middleware/request-id';
import { rateLimiter } from '@/middleware/rate-limiter';
import { corsOrigin, sdkKey, operatorWrites } from '@/middleware/edgeAccess';

import { authRoutes } from '@/routes/auth';
import { apiRoutes } from '@/routes/api';
import { trackingRoutes } from '@/routes/tracking';
import { pixelRoutes } from '@/routes/pixel';
import { webhookRoutes } from '@/routes/webhook';
import { healthRoutes } from '@/routes/health';
import { optimizelyRoutes } from '@/routes/optimizely';
import { cdpRoutes } from '@/routes/cdp';
import { operatorRoutes } from '@/routes/operator';
import { configRoutes } from '@/routes/config';
import { contentRoutes } from '@/routes/content';
import realtimeRoutes from '@/routes/realtime';
import { aiRoutes } from '@/routes/ai';
import { aiSceneRoutes } from '@/routes/aiScene';
import { generateSceneToR2 } from '@/services/sceneGen';
import { shotRoutes } from '@/routes/shot';
import { geoRoutes } from '@/routes/geo';
import { funnelRoutes } from '@/routes/funnel';
import { funnelSimRoutes } from '@/routes/funnelSim';
import { experimentRoutes } from '@/routes/experiment'; // A/B + CMAB workstream (owner: ab-cmab)
import { signalRoutes } from '@/routes/signals'; // Signal-Led Moment DETECT layer (owner: ab-cmab)
import { liveRoutes } from '@/routes/live'; // The Bright Hour storefront API (docs/qvc)
import { liveOpsRoutes } from '@/routes/liveOps'; // The Bright Hour Offer Desk (Beat 2)

import { routeAgentRequest } from 'agents';

import { StateManager } from '@/durable-objects/StateManager';
import { RateLimiter } from '@/durable-objects/RateLimiter';
import { PersonalizationWebSocket } from '@/durable-objects/PersonalizationWebSocket';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { OpalAgent } from '@/agents/OpalAgent';

const app = new Hono<{ Bindings: Env; Variables: { tenant: TenantId } }>();

// Which brand this request belongs to, resolved once. Every store and every
// per-shopper object is already scoped; this is what reaches that scoping.
// It runs first because everything after it may want to know.
app.use('*', tenantMiddleware());

app.use('*', timing());
app.use('*', requestId());
app.use('*', logger());
app.use('*', secureHeaders());

app.use(
  '*',
  cors({
    // CW10: policy-driven. Open mode with nothing configured reflects, as before;
    // a configured allow-list or enforced mode answers only what is listed.
    origin: corsOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-SDK-Key'],
    exposeHeaders: ['X-Request-Id', 'X-Response-Time'],
    credentials: true,
    maxAge: 86400,
  })
);

app.use('/api/*', rateLimiter());
// CW10 — the access gates. All three are pass-through while AUTH_MODE is
// 'open' (the default), so the shared demo worker is unchanged; the staging
// stamp sets 'enforced'. See src/middleware/edgeAccess.ts.
app.use('/realtime/*', sdkKey());
app.use('/v1/:tenant/*', sdkKey());
app.use('/operator/*', operatorWrites());

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
// CW0 — versioned reflex config (scope appendix §1.4). Reads open, writes
// authenticated and fail closed; the tuning UI is a client of these routes.
app.route('/config', configRoutes);
// CW2 — the content catalog, slot strategies and learning settings: reads open,
// writes authenticated, every write validated, versioned and attributed.
app.route('/content', contentRoutes);
app.route('/realtime', realtimeRoutes);
app.route('/meridian/api', meridianRoutes);
// CW4 — the content decision surface (scope appendix §2.3). Reads only; the
// ledger writer (Phase 0) and SDK-key auth (CW10) attach here, not elsewhere.
app.route('/v1', decisionRoutes);
app.route('/ai', aiRoutes);
app.route('/ai/scene', aiSceneRoutes);
app.route('/__shot', shotRoutes);
app.route('/geo', geoRoutes);
app.route('/funnel', funnelRoutes);
app.route('/funnel/sim', funnelSimRoutes);
app.route('/experiment', experimentRoutes); // A/B + CMAB (owner: ab-cmab)
app.route('/signals', signalRoutes); // Signal-Led Moment DETECT layer (owner: ab-cmab)
// The Bright Hour demo surface. The PAGE is static assets at /live (same
// mechanism as every other demo); this is only its data plane, so the mount is
// namespaced under /live/api and touches no existing route.
app.route('/live/api', liveRoutes);
// The Offer Desk (Beat 2) — the operator surface at /live/ops.html. Its own
// mount so the storefront's data plane and the desk's never share a handler;
// every write it makes lands under the `bh:offerdesk:` KV prefix.
app.route('/live/ops-api', liveOpsRoutes);

// API info endpoint - moved to /api-info so root can serve static files
app.get('/api-info', (c) => {
  return c.json({
    name: 'Edge Platform API',
    version: '2.0.0',
    environment: c.env.ENVIRONMENT,
    endpoints: {
      storefront: '/storefront',
      health: '/health',
      auth: '/auth',
      api: '/api',
      tracking: '/track',
      pixel: '/pixel',
      webhook: '/webhook',
      optimizely: '/optimizely',
      cdp: '/cdp',
      realtime: '/realtime',
      operator: '/operator',
      ai: '/ai',
      aiScene: '/ai/scene',
      geo: '/geo',
      funnel: '/funnel',
      experiment: '/experiment',
      signals: '/signals',
      opalAgent: '/agents/opal-agent/:session',
    },
    docs: 'docs/api/01-rest-endpoints.md',
  });
});

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

import { meridianRoutes } from '@/demos/meridian/routes';
import { decisionRoutes } from '@/routes/decisions';
import { MeridianReflex } from '@/demos/meridian/MeridianReflex';

import { RegionTrend } from '@/durable-objects/RegionTrend';
import { rollupTenant } from '@/reflex/regionTrend';

export { StateManager, RateLimiter, PersonalizationWebSocket, ShopperReflex, OpalAgent, MeridianReflex, RegionTrend };

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
      case '0 * * * *': {
        // CW6: sum each tenant's published regions into its countries and into everyone.
        const tenants = (env.TREND_ROLLUP_TENANTS ?? 'coach').split(',').map((t) => t.trim()).filter(Boolean);
        for (const tenant of tenants) {
          ctx.waitUntil(rollupTenant(env, tenant).then(
            (r) => console.log(`trend rollup ${tenant}: ${r.regions} regions → ${r.countries.length} countries + everyone`),
            (e) => console.error(`trend rollup ${tenant} failed`, e),
          ));
        }
        break;
      }
      default:
        console.log('Unknown scheduled event:', event.cron);
    }
  },
  queue: async (batch: MessageBatch, env: Env, ctx: ExecutionContext) => {
    for (const message of batch.messages) {
      try {
        const event = message.body as any;
        if (event && event.kind === 'scene') {
          // Background styled-scene generation → R2 (so the request path never blocks on ~8s gen).
          const res = await generateSceneToR2(env, event);
          console.log(`queue scene ${event.productId}/${event.sceneId}: ${res.ok ? (res.cached ? 'already cached' : `generated ${res.tookMs}ms`) : 'failed: ' + res.error}`);
          message.ack(); // ack even on a handled failure — no poison loop; client falls back to the grid
        } else {
          console.log('Processing queued event:', event);
          message.ack();
        }
      } catch (error) {
        console.error('Error processing message:', error);
        message.retry(); // transient/unexpected → retry
      }
    }
  },
};