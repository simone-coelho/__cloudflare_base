import { tenantConfig, tenantMiddleware } from '@/tenancy/middleware';
import { retentionDays, rewriteTenantErasures } from '@/ledger/erasure';
import { catchUp, countedStorage, foldOpenHours, runBrandDayReports, RUN_BUDGET } from '@/learn/hourly';
import { runMonitor } from '@/ops/monitor';
import { runWarehouses } from '@/ledger/warehouse';
import { consumeSynthetic, SYNTHETIC_HEADER } from '@/ops/synthetic';
import { read } from '@/config/versionedStore';
import { backfillPublication } from '@/config/publication';
import { moveAudiences } from '@/connectors/AudienceStore';
import { DEFAULT_LEARN, LEARN_KIND } from '@/content/kinds';
import type { LearnConfig } from '@/content/types';
import type { TenantId } from '@/tenancy/tenant';
import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { timing } from 'hono/timing';
import { secureHeaders } from 'hono/secure-headers';
import { getPath } from 'hono/utils/url';

import type { Env } from '@/types/env';
import { customerBindingsOmitted, customerRequest, deploymentProfile } from '@/customerBoundary';
import { errorHandler } from '@/middleware/error';
import { requestId } from '@/middleware/request-id';
import { corsOrigin, sdkKey, operatorWrites } from '@/middleware/edgeAccess';

import { authRoutes } from '@/routes/auth';
import { trackingRoutes } from '@/routes/tracking';
import { pixelRoutes } from '@/routes/pixel';
import { webhookRoutes } from '@/routes/webhook';
import { healthRoutes } from '@/routes/health';
import { optimizelyRoutes } from '@/routes/optimizely';
import { cdpRoutes } from '@/routes/cdp';
import { operatorRoutes } from '@/routes/operator';
import { ledgerRecoveryRoutes } from '@/routes/ledgerRecovery';
import { captureQuarantine, expireQuarantine, recoveryConfiguration } from '@/ledger/quarantine';
import { configRoutes } from '@/routes/config';
import { sortRoutes } from '@/routes/sort';
import { searchRoutes } from '@/routes/search';
import { contentRoutes } from '@/routes/content';
import { identityRoutes } from '@/routes/identity';
import realtimeRoutes from '@/routes/realtime';
import { aiRoutes } from '@/routes/ai';
import { aiSceneRoutes } from '@/routes/aiScene';
import { generateSceneToR2 } from '@/services/sceneGen';
import { shotRoutes } from '@/routes/shot';
import { demoBootstrapRoutes } from '@/routes/demoBootstrap';
import { geoRoutes } from '@/routes/geo';
import { funnelRoutes } from '@/routes/funnel';
import { funnelSimRoutes } from '@/routes/funnelSim';
import { experimentRoutes } from '@/routes/experiment'; // A/B + CMAB workstream (owner: ab-cmab)
import { signalRoutes } from '@/routes/signals'; // Signal-Led Moment DETECT layer (owner: ab-cmab)
import { liveRoutes } from '@/routes/live'; // The Bright Hour storefront API (docs/qvc)
import { liveOpsRoutes } from '@/routes/liveOps'; // The Bright Hour Offer Desk (Beat 2)
import { topOffersRoutes } from '@/routes/topOffers'; // Lantern & Lane merchandiser half (docs/qvc)
import { vantageRoutes } from '@/routes/vantage'; // Vantage carrier demo: beats and receipts (docs/verizon)
import { vantageColdStartRoutes } from '@/routes/vantageColdStart'; // Vantage cold-start panel (docs/verizon)
import { ohRoutes, ohColdStartRoutes } from '@/routes/oh'; // OH demo: beats, receipts and the cold-start panel (docs/oh)
import { demoRootResponse } from '@/demos/kit/root'; // a demo worker's "/" is its demo (docs/demo-kit, K6)

import { routeAgentRequest } from 'agents';

import { StateManager } from '@/durable-objects/StateManager';
import { RateLimiter } from '@/durable-objects/RateLimiter';
import { PersonalizationWebSocket } from '@/durable-objects/PersonalizationWebSocket';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { OpalAgent } from '@/agents/OpalAgent';

const app = new Hono<{ Bindings: Env; Variables: { tenant: TenantId } }>();

// The platform's own Server-Timing entry, `total;dur=…;desc="Total Response Time"`, on every answer but the one that
// names its own `total`: a new visitor's first decision set through the first-request door (P96, E21; src/routes/decisions.ts).
app.use('*', timing({ enabled: (c) => !answersOwnTotal(c) }));
app.use('*', requestId());
app.use('*', secureHeaders());

app.use(
  '*',
  cors({
    // CW10: policy-driven. Open mode with nothing configured reflects, as before;
    // a configured allow-list or enforced mode answers only what is listed.
    origin: corsOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-SDK-Key', 'X-Shopper-Session', 'X-Tenant', 'If-Match', 'Idempotency-Key'],
    exposeHeaders: ['X-Request-Id', 'X-Response-Time'],
    credentials: true,
    maxAge: 86400,
  })
);

// Of the requests this app receives, two kinds resolve no tenant; every other one
// resolves exactly one here, before route work, or is refused. Every OPTIONS request,
// each CORS preflight among them: the `cors` middleware above answers it 204 without
// calling `next` (hono/cors), so it never reaches this one; a preflight carries header
// names, not the tenant selector's value. And the two health probes (H3-1): a load
// balancer's or an operator's readiness check names no brand, and the routes read none
// (src/routes/health.ts: the signing configuration, the identity material against the
// stamp's registry, the recovery prerequisites). Left behind the middleware, they answered
// a healthy customer stamp `403 Tenant unavailable`, which reads as an outage. The path is
// matched as Hono routes it (`getPath`, decoded) and only for the reads the customer boundary admits for them.
const tenantRequired = tenantMiddleware();
const tenantFreeProbe = (req: Request): boolean =>
  (req.method === 'GET' || req.method === 'HEAD') && ['/health/ready', '/health/live'].includes(getPath(req));
app.use('*', (c, next) => tenantFreeProbe(c.req.raw) ? next() : tenantRequired(c, next));

// CW10 — the access gates. All three are pass-through while AUTH_MODE is
// 'open' (the default), so the shared demo worker is unchanged; the staging
// stamp sets 'enforced'. See src/middleware/edgeAccess.ts.
app.use('/realtime/*', sdkKey());
app.use('/v1/:tenant/*', sdkKey());
app.use('/operator/*', async (c, next) => {
  // Only these dedicated routes supply their own mandatory current-human gate;
  // a stamp owner needs no fabricated tenant membership for unassigned cases.
  if (/^\/operator\/ledger-recovery(?:\/[a-f0-9]{64}(?:\/(?:redrive|resolve))?)?$/.test(new URL(c.req.url).pathname)) return next();
  return (operatorWrites() as unknown as MiddlewareHandler<{ Bindings: Env; Variables: { tenant: string } }>)(c, next);
});

app.onError(errorHandler);

app.route('/health', healthRoutes);
app.route('/auth', authRoutes);
app.route('/track', trackingRoutes);
app.route('/pixel', pixelRoutes);
app.route('/webhook', webhookRoutes);
app.route('/optimizely', optimizelyRoutes);
app.route('/cdp', cdpRoutes);
app.route('/operator', operatorRoutes);
// CW0 — versioned reflex config (scope appendix §1.4). Reads open, writes
// authenticated and fail closed; the tuning UI is a client of these routes.
app.route('/config', configRoutes);
// §1.11 custom product sort: a candidate set in, the same ids out in a
// per-shopper order. The commerce platform stays authoritative for everything
// else. Ledger 20 row 9.
app.route('/sort', sortRoutes);
app.route('/search', searchRoutes);
// CW2 — the content catalog, slot strategies and learning settings: reads open,
// writes authenticated, every write validated, versioned and attributed.
app.route('/content', contentRoutes);
app.route('/realtime', realtimeRoutes);
app.route('/meridian/api', meridianRoutes);
// CW4 — the content decision surface (scope appendix §2.3). Reads only; the
// ledger writer (Phase 0) and SDK-key auth (CW10) attach here, not elsewhere.
app.route('/v1', decisionRoutes);
app.route('/operator/ledger-recovery', ledgerRecoveryRoutes);
// CW25 — identity stitching (§1.12): link, detach, resolve, history. Same gate as /v1.
app.route('/v1', identityRoutes);
app.route('/ai', aiRoutes);
app.route('/ai/scene', aiSceneRoutes);
app.route('/__shot', shotRoutes);
// Demo scope bootstrap. Creates a configuration publication set for a demo
// tenant that has none, once, and can never overwrite one. The route itself
// answers 404 on the customer profile and 403 outside development, and refuses
// any scope that already has a head; see src/routes/demoBootstrap.ts.
app.route('/ops/demo-bootstrap', demoBootstrapRoutes);
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
// The Top Offers demo's merchandiser half. It re-enters this same app with a
// short-lived operator token so the page never holds a credential; mounted
// only where DEPLOYMENT_PROFILE is 'demo' (the route refuses otherwise).
app.route('/top-offers/api', topOffersRoutes(async (request, env, ctx) => app.fetch(request, env, ctx)));
// The Vantage demo's beats and receipts, the same pattern; and its cold-start
// panel. Both answer 404 unless DEPLOYMENT_PROFILE is 'demo'.
app.route('/vantage/api', vantageRoutes(async (request, env, ctx) => app.fetch(request, env, ctx)));
app.route('/vantage/api/coldstart', vantageColdStartRoutes);
app.route('/oh/api', ohRoutes(async (request, env, ctx) => app.fetch(request, env, ctx)));
app.route('/oh/api/coldstart', ohColdStartRoutes);

// API info endpoint - moved to /api-info so root can serve static files
app.get('/api-info', (c) => {
  return c.json({
    name: 'Edge Platform API',
    version: '2.0.0',
    environment: c.env.ENVIRONMENT,
    endpoints: {
      ...(c.env.DEPLOYMENT_PROFILE === 'customer' ? {} : { storefront: '/storefront', pixel: '/pixel' }),
      health: c.env.AUTH_MODE === 'enforced' ? '/health/ready' : '/health',
      auth: '/auth',
      ...(c.env.AUTH_MODE === 'enforced' ? {} : {
        tracking: '/track', webhook: '/webhook',
        optimizely: '/optimizely', cdp: '/cdp', opalAgent: '/agents/opal-agent/:session',
        ai: '/ai', aiScene: '/ai/scene', funnel: '/funnel', experiment: '/experiment', signals: '/signals',
      }),
      realtime: '/realtime',
      operator: '/operator',
      geo: '/geo',
    },
    docs: 'docs/api/01-rest-endpoints.md',
  });
});

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

import { meridianRoutes } from '@/demos/meridian/routes';
import { answersOwnTotal, decisionRoutes } from '@/routes/decisions';
import { MeridianReflex } from '@/demos/meridian/MeridianReflex';

import { RegionTrend } from '@/durable-objects/RegionTrend';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { rollupTenant } from '@/reflex/regionTrend';
import { consumeLedger } from '@/ledger/consume';

export { StateManager, RateLimiter, PersonalizationWebSocket, ShopperReflex, OpalAgent, MeridianReflex, RegionTrend, DecisionRing, LearnStats };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.headers.has(SYNTHETIC_HEADER)) return new Response(null, { status: 404 });
    // The obsolete raw-store API is unavailable before binding discovery,
    // logging or CORS. Use Hono's decoding so encoded aliases are covered too.
    const path = getPath(request);
    if (path === '/api' || path.startsWith('/api/')) {
      return new Response(request.method === 'HEAD' ? null : '{"error":"Not Found"}', {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    const profile = deploymentProfile(env);
    if (!profile) return boundaryUnavailable(request.method);
    if (profile === 'customer') {
      const permitted = customerRequest(request, path);
      if (!permitted) return new Response(request.method === 'HEAD' ? null : '{"error":"Not Found"}', {
        status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
      if (!customerBindingsOmitted(env)) return boundaryUnavailable(request.method);
      if (permitted.kind === 'redirect') return new Response(null, {
        status: 302, headers: { Location: new URL('/console/', request.url).href, 'Cache-Control': 'no-store' },
      });
      if (permitted.kind === 'asset') {
        const url = new URL(request.url); url.pathname = permitted.path;
        return env.ASSETS.fetch(new Request(url, request));
      }
      return app.fetch(request, env, ctx);
    }
    if (env.AUTH_MODE === 'enforced') {
      // Demo, model and legacy activation routes use stamp-global resources or
      // shopper paths without owned principals. Named grants do not authorize them.
      // Match decoded segments, including the Agents SDK's empty-segment aliases.
      const [root, child, grandchild] = path.split('/').filter(Boolean);
      if (root === 'agents' || root === 'cdp' || root === 'optimizely'
        || root === 'track' || root === 'webhook'
        || root === 'ai' || root === '__shot' || root === 'funnel' || root === 'experiment' || root === 'signals'
        || (root === 'live' && (child === 'api' || child === 'ops-api'))
        || (root === 'meridian' && child === 'api')
        || (root === 'realtime' && child === 'demo')
        || (root === 'realtime' && grandchild === undefined && (child === 'connections' || child === 'health'))
        || (root === 'geo' && child === 'cohort')
        || (root === 'health' && child === undefined)) {
        return new Response(request.method === 'HEAD' ? null : '{"error":"Not Found"}', {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
      // Do not call the SDK even for other paths: it discovers all DO bindings
      // before checking its route. Retained Hono routes resolve their own scope.
    } else {
      const agentResponse = await routeAgentRequest(request, env);
      if (agentResponse) return agentResponse;
    }
    const demoRoot = demoRootResponse(request, env, app.routes); if (demoRoot) return demoRoot;
    return app.fetch(request, env, ctx);
  },
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    const profile = deploymentProfile(env);
    if (!profile || (profile === 'customer' && !customerBindingsOmitted(env))) return;
    if (!['*/5 * * * *', '0 3 * * *', '0 * * * *'].includes(event.cron)) {
      console.log('Unknown scheduled event');
      return;
    }
    let tenants: TenantId[];
    try { tenants = tenantConfig(env).provisioned; }
    catch { console.error('Scheduled tenant configuration unavailable'); return; }
    switch (event.cron) {
      case '*/5 * * * *': {
        if (env.LEDGER_RECOVERY_CONFIG !== undefined) for (const tenant of [...tenants, null]) ctx.waitUntil((async () => {
          const key = 'ledger-quarantine-scan:' + (tenant ?? 'unassigned'), after = await env.CACHE.get(key);
          if (after !== null && !/^[a-f0-9]{64}$/.test(after)) throw new Error('Quarantine scan unavailable');
          const result = await expireQuarantine(env, tenant, after ?? undefined);
          if (result.next) await env.CACHE.put(key, result.next); else await env.CACHE.delete(key);
          if (result.unresolved) console.error('quarantine cleanup pending');
        })().catch(() => { console.error('quarantine cleanup pending'); }));
        // A single bounded/fair warehouse slice shares this cron invocation;
        // do not reset its subrequest budget independently for every tenant.
        ctx.waitUntil(runWarehouses(env, tenants).then(result => {
          if (result.status === 'failed') console.error('warehouse delivery or cleanup pending');
        }));
        // The platform watching itself (src/ops/monitor.ts): every store, and a real decision, per tenant.
        for (const tenant of tenants) {
          ctx.waitUntil(runMonitor(env, tenant).then(
            (r) => { if (!r.ok) console.error('monitor check failed; problems', r.problems.length); },
            (e) => console.error('monitor failed to run'),
          ));
        }
        // Doc 31 §3: the closed hours the ledger holds, folded into their aggregates, oldest first, two per run;
        // Then retry missing/stale day publications within the bounded aggregate-backed lookback,
        // then fold the open hour into its working aggregate (lane E6).
        for (const tenant of tenants) {
          ctx.waitUntil((async () => {
            // P102 (E27): an existing tenant's head gains its members' metadata and its serving copy without a
            // publication, here and never on a shopper's read; it cannot fail or hold back the folds below.
            await backfillPublication(env, tenant).then(
              (wrote) => { if (wrote.head || wrote.copy) console.log('publication backfill; head/copy', Number(wrote.head), Number(wrote.copy)); },
              () => { console.error('publication backfill pending'); });
            // P105 (E30): the tenant's published audiences moved from its KV records into its publication, and any
            // record an earlier release wrote after the move reconciled into it; inside the tenant's existing job.
            await moveAudiences(env, tenant).catch(() => { console.error('audience move pending'); });
            const learn = await read<LearnConfig>(env, LEARN_KIND, tenant, DEFAULT_LEARN);
            // Lane E6: the run's storage calls are counted against one budget, the catch-up's
            // RUN_BUDGET: what the catch-up spends, the open hour's folds may not. Each call is
            // passed through whole, so the catch-up's range reads stay range reads.
            const counted = countedStorage(env.STORAGE as unknown as Parameters<typeof catchUp>[0]);
            try {
              const r = await catchUp(counted.storage, tenant, learn, Date.now(), {}, env);
              if (r.built.length) console.log('hourly fold completed; hours/objects/decisions/outcomes/truncated/pending', r.built.length, r.built.reduce((n, b) => n + b.objects, 0), r.built.reduce((n, b) => n + b.decisions, 0), r.built.reduce((n, b) => n + b.outcomes, 0), r.built.filter((b) => b.truncated).length, r.pending);
              if (r.failed.length) console.error('hourly fold hours failed and skipped', r.failed.length);
              if (r.reports.published.length || r.reports.failed.length || r.reports.deferred.length) console.log('hourly day reports; published/failed/deferred', r.reports.published.length, r.reports.failed.length, r.reports.deferred.length);
            } catch { console.error('hourly fold failed'); }
            // Lane E6: then the hour that is still open, into its working aggregate, so a day report
            // reads one aggregate per hour and only the minutes of raw the queue has written since.
            // It runs whether or not the catch-up got through: it applies the erasures to the open
            // hour's ledger copy first, on every run, and folds only what the budget left covers.
            const open = await foldOpenHours(env.STORAGE as unknown as Parameters<typeof foldOpenHours>[0], tenant, learn, Date.now(),
              { start: true, publish: true, budget: Math.max(0, RUN_BUDGET - counted.calls()) }, env)
              .catch(() => { console.error('open hour fold failed'); return null; });
            if (open && (open.folded.length || open.failed.length || open.deferred.length || open.removed || open.pruned)) console.log('open hour fold; hours/objects/copied/unchanged/deferred/failed/published/removed/pruned/calls', open.folded.length, open.folded.reduce((n, h) => n + h.read, 0), open.folded.reduce((n, h) => n + h.copied, 0), open.unchanged.length, open.deferred.length, open.failed.length, open.published.length, open.removed, open.pruned, counted.calls() + open.calls);
          })().catch((e) => console.error('hourly fold failed')));
        }
        break;
      }
      case '0 3 * * *': {
        // Doc 31: yesterday's day reports, built once by the platform and read by the console with GET.
        // W37 T2: one per brand the tenant's own records carry (a tenant may serve more than one
        // brand; there is no brand registry), each inside the tenant's one job.
        const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        for (const tenant of tenants) {
          ctx.waitUntil((async () => {
            const learn = await read<LearnConfig>(env, LEARN_KIND, tenant, DEFAULT_LEARN);
            const days = await runBrandDayReports(env.STORAGE as unknown as Parameters<typeof runBrandDayReports>[0], tenant, yesterday, learn, Date.now(), env);
            for (const { report: r } of days) {
              if (!r) { console.error('day report failed'); continue; }
              console.log('day report; decisions/outcomes/unfolded/truncated', Number.isFinite(r.counts.decisions) ? r.counts.decisions : -1, Number.isFinite(r.counts.outcomes) ? r.counts.outcomes : -1, r.hours?.missing.length ?? 0, r.counts.truncated ? 1 : 0);
            }
          })().catch((e) => console.error('day report failed')));
        }
        // CW28 (doc 22 §15): the erasure rewrite. Newest day first over the retention window, capped per run, resumes tomorrow.
        for (const tenant of tenants) {
          ctx.waitUntil(rewriteTenantErasures(env, tenant, { retentionDays: retentionDays(env) }).then(
            (r) => { if (r.tombstones) console.log('erasure rewrite; rows/objects/days/retired/pending/more', r.rows_removed, r.objects_opened, r.days.length, r.retired, r.remaining, r.more ? 1 : 0); },
            (e) => console.error('erasure rewrite failed'),
          ));
        }
        break;
      }
      case '0 * * * *': {
        // CW6: sum each tenant's published regions into its countries and into everyone.
        for (const tenant of tenants) {
          ctx.waitUntil(rollupTenant(env, tenant).then(
            (r) => console.log('trend rollup; regions/countries', r.regions, r.countries.length),
            (e) => console.error('trend rollup failed'),
          ));
        }
        break;
      }
    }
  },
  queue: async (batch: MessageBatch, env: Env, ctx: ExecutionContext) => {
    const profile = deploymentProfile(env);
    if (!profile || (profile === 'customer' && !customerBindingsOmitted(env))) {
      for (const message of batch.messages) message.retry();
      return;
    }
    // consumeLedger admits each whole envelope against this stamp's current TENANTS
    // before any erasure read or storage effect; refused work retains queue retries.
    // Phase 0 of the outcome-learning design: every ledger message in the batch is
    // written to R2 in one pass, as range-named objects under the brand and hour.
    // Malformed envelopes retry independently; valid siblings still share grouped
    // persistence. Only explicit per-envelope completion acknowledges; uncertainty retries.
    let recovery: ReturnType<typeof recoveryConfiguration> | undefined;
    try { if (env.LEDGER_RECOVERY_CONFIG !== undefined) recovery = recoveryConfiguration(env); }
    catch { for (const message of batch.messages) message.retry(); return; }
    const ordinary: typeof batch.messages[number][] = [];
    const classified = await Promise.all(batch.messages.map(async message => {
      try { if (await consumeSynthetic(env, batch.queue, message.body)) { message.ack(); return true; } return false; }
      catch { message.retry(); return true; }
    }));
    batch.messages.forEach((message, index) => { if (!classified[index]) ordinary.push(message); });
    if (recovery && batch.queue === recovery.deadLetterQueue) {
      for (const message of ordinary) {
        try { await captureQuarantine(env, batch.queue, message.id, message.body); message.ack(); }
        catch { message.retry(); }
      }
      return;
    }
    if (recovery && batch.queue !== recovery.sourceQueue) { for (const message of ordinary) message.retry(); return; }
    const ledger = ordinary.filter((m) => (m.body as { kind?: unknown } | null)?.kind === 'ledger');
    if (ledger.length) {
      const res = await consumeLedger(env, ledger.map((m) => m.body));
      if (res.error) console.error('ledger batch failed');
      for (const [index, message] of ledger.entries()) {
        if (res.dispositions?.[index] === 'ack') message.ack();
        else message.retry();
      }
      if (res.skipped) console.warn('ledger envelopes rejected for retry', res.skipped);
    }
    for (const message of ordinary) {
      if ((message.body as { kind?: unknown } | null)?.kind === 'ledger') continue;
      try {
        const event = message.body as any;
        if (event && event.kind === 'scene') {
          // Preserve prohibited work for the configured retry/DLQ disposition;
          // never inspect model credentials, reference assets or scene storage.
          if (profile === 'customer' || env.AUTH_MODE === 'enforced') { message.retry(); continue; }
          // Background styled-scene generation → R2 (so the request path never blocks on ~8s gen).
          const res = await generateSceneToR2(env, event);
          if (!res.ok) console.error('queue scene failed');
          message.ack(); // ack even on a handled failure — no poison loop; client falls back to the grid
        } else {
          message.retry();
        }
      } catch (error) {
        console.error('Error processing message');
        message.retry(); // transient/unexpected → retry
      }
    }
  },
};

function boundaryUnavailable(method = 'GET'): Response {
  return new Response(method === 'HEAD' ? null : '{"error":"Deployment boundary unavailable"}', {
    status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
