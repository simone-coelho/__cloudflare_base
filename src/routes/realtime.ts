import type { TenantVariables } from '@/tenancy/tenant';
import { shopperObject, shopperObjectName } from '@/tenancy/objects';
import { DEFAULT_TENANT } from '@/tenancy/tenant';
// Singleton objects: one per worker on purpose, never per brand.
const SINGLETON_ADMIN = 'admin';
const SINGLETON_HEALTH = 'health-check';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { RealtimeSegmentEngine, type ActionEvent } from '@/services/RealtimeSegmentEngine';
import { getConnectors } from '@/connectors';
import { snapshot as reflexSnapshot } from '@/reflex/core';
import { resolveReflexConfig, resolveSurface } from '@/demos/registry';
import { forwardEventToOdp, mapActionToOdp, odpEnabled, upsertOdpProfile } from '@/services/odpLoop';
import { outcomeFromAction } from '@/ledger/records';
import { enqueueOutcome } from '@/ledger/enqueue';
import { CatalogService } from '@/services/CatalogService';
import { z } from 'zod';

const realtimeRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables }>();

// WebSocket upgrade endpoint
realtimeRoutes.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426);
  }

  const userId = c.req.query('userId');
  if (!userId) {
    return c.text('Missing userId parameter', 400);
  }

  try {
    // Edge Affinity Reflex P2 (doc 16 §6): REFLEX_HOST='do' relocates the socket
    // INTO the per-shopper ShopperReflex DO — state + compute co-located, hot,
    // hibernating. `userId` is the STABLE visitor id the client persists
    // (opt_visitor_id), so every tab/device lands on the same object. Default
    // 'session' keeps the original relay DO — byte-identical behavior.
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const id = c.env.SHOPPER_REFLEX.idFromName(shopperObjectName(c.get('tenant'), userId));
      return c.env.SHOPPER_REFLEX.get(id).fetch(c.req.raw);
    }

    // Get the Durable Object instance for this user
    const id = c.env.PERSONALIZATION_WEBSOCKET.idFromName(shopperObjectName(c.get('tenant'), userId));
    const durableObject = c.env.PERSONALIZATION_WEBSOCKET.get(id);

    // Forward the WebSocket upgrade request to the Durable Object
    return durableObject.fetch(c.req.raw);
  } catch (error) {
    console.error('Error establishing WebSocket connection:', error);
    return c.text('Failed to establish WebSocket connection', 500);
  }
});

// Real-time action event processing.
// Retail event types ('product_view','add_to_cart','wishlist_add') are accepted
// alongside the original B2B types so the Coach storefront and existing callers
// share one ingestion path (REAL SEAMS, MOCKED CALLS — see docs/architecture/05-demo-build-spec.md §3).
export const actionEventSchema = z.object({
  type: z.enum([
    // existing (backward compatible)
    'email_open', 'form_submit', 'page_view', 'button_click', 'custom',
    // retail / Coach storefront signals
    'product_view', 'add_to_cart', 'wishlist_add',
  ]),
  userId: z.string(),
  anonymousId: z.string().optional(),
  data: z.record(z.string(), z.any()),
  source: z.string(),
  // Which demo posted this (@/demos/registry). Optional and stripped-if-absent:
  // the engine falls back to `source`, and then to the default surface (coach),
  // so every existing client is unaffected.
  surface: z.string().optional(),
  // How the shopper arrived. Captured once per page load by the client and sent
  // with every action, because the server cannot know in advance which event
  // will be the one that opens a new visit. Optional, so every existing client
  // is unaffected and simply resolves to `direct`.
  entry: z.object({
    utmMedium: z.string().optional(),
    utmSource: z.string().optional(),
    referrer: z.string().optional(),
    siteHost: z.string().optional(),
  }).optional(),
  timestamp: z.number().optional()
});

realtimeRoutes.post('/action', async (c) => {
  try {
    const body = await c.req.json();
    const validatedEvent = actionEventSchema.parse(body);

    // Add timestamp if not provided.
    // Cast: the zod schema accepts the retail event types ('product_view',
    // 'add_to_cart','wishlist_add'); ActionEvent['type'] is widened to the same
    // union by the catalog-aware engine refactor (build-spec §2.1/§2.2). The
    // runtime values are always valid events, so this stays correct post-refactor.
    const cfGeo = ((c.req.raw as unknown as { cf?: { country?: string; regionCode?: string } }).cf) ?? null;
    const actionEvent = {
      ...validatedEvent,
      timestamp: validatedEvent.timestamp || Date.now(),
      // CW6: coarse request geolocation rides the event so the scoring host can
      // fan the touches into the shopper's region. Aggregates only, never stored per person.
      ...(cfGeo?.country ? { geo: { country: cfGeo.country, regionCode: cfGeo.regionCode ?? null } } : {}),
    } as ActionEvent;

    // Capture this demo-run event into D1 `demo_events` (source='demo'), kept
    // SEPARATE from the historical synthetic data so POST /operator/events/reset
    // can wipe ONLY these rows. Off the response path (waitUntil) so it adds zero
    // latency, and self-guarding so a D1 hiccup can never break the demo.
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
    const capture = captureDemoEvent(c.env, actionEvent, sessionId);
    try { c.executionCtx.waitUntil(capture); } catch { void capture; /* no execCtx (e.g. tests) */ }
    // Phase 0 (doc 22 §3.2): a reward-bearing action becomes an outcome record, after the response.
    const outcome = outcomeFromAction({ ...actionEvent, sessionId }, c.get('tenant'));
    if (outcome) { const p = enqueueOutcome(c.env, outcome); try { c.executionCtx.waitUntil(p); } catch { void p; } }

    // ── Edge Affinity Reflex P2 (doc 16 §6): REFLEX_HOST='do' forwards to the
    // shopper's ShopperReflex DO, which runs the same pipeline IN-OBJECT (reflex →
    // qualify → decide → push over its own socket) and returns the same envelope
    // shape ({success, update?, sessionId, cookiesUpdated, odp?}). The DO owns the
    // ODP loop on this path (forward + seed + receipt over its own socket), so no
    // route-level ODP dispatch here. The D1 captureDemoEvent above ran either way.
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const stub = shopperObject(c.env.SHOPPER_REFLEX, actionEvent.userId, c.get('tenant'));
      const doRes = await stub.fetch('https://shopper-reflex/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(actionEvent),
      });
      const out = (await doRes.json()) as Record<string, unknown>;
      return c.json(out, doRes.status as 200);
    }

    // Get cookie header for session management
    const cookieHeader = c.req.header('Cookie') ?? null;

    // Process the action event with enhanced session management
    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env), { tenant: c.get('tenant') });
    let execCtx: { waitUntil(p: Promise<unknown>): void } | undefined;
    try { execCtx = c.executionCtx; } catch { execCtx = undefined; /* no execCtx (e.g. tests) */ }
    const result = await segmentEngine.processActionEventWithSession(actionEvent, cookieHeader, execCtx);

    // ODP loop (doc 16 §8): forward the behavioral event to ODP OFF the response
    // path — the shopper never waits on the memory; ODP down = zero impact.
    // The response carries a dispatch RECEIPT (server truth: what the platform is
    // forwarding); the forwarder later pushes the ODP status over the WebSocket as
    // an `odp_receipt` so the feed row upgrades to its real ✓ 202.
    let odpReceipt: { receiptId: string; type: string; action?: string; product_id?: string } | undefined;
    if (odpEnabled(c.env)) {
      const mapped = mapActionToOdp(actionEvent);
      if (mapped) {
        odpReceipt = {
          receiptId: crypto.randomUUID(),
          type: mapped.type,
          ...(mapped.action ? { action: mapped.action } : {}),
          ...(typeof mapped.data.product_id === 'string' ? { product_id: mapped.data.product_id } : {}),
        };
        c.executionCtx.waitUntil(forwardEventToOdp(
          c.env, actionEvent,
          { visitorId: actionEvent.userId, sessionId: result.sessionId },
          odpReceipt.receiptId,
          undefined,
          c.get('tenant'),
        ));
      }
      // §4 score upsert: on membership changes, persist the reflex's live scores
      // onto the ODP profile (the memory carrying the edge's numbers).
      const aff = result.update?.data?.affinity;
      if (aff && Array.isArray(aff.changed) && aff.changed.length > 0) {
        c.executionCtx.waitUntil(
          upsertOdpProfile(
            c.env,
            { visitorId: actionEvent.userId, sessionId: result.sessionId },
            aff, result.update?.data?.journeyStage,
          )
        );
      }
    }

    // Set updated cookies in response
    result.cookieHeaders.forEach(cookieHeader => {
      c.header('Set-Cookie', cookieHeader, { append: true });
    });

    if (result.update) {
      return c.json({
        success: true,
        message: 'Action processed and personalization updated',
        update: result.update,
        sessionId: result.sessionId,
        cookiesUpdated: result.cookieHeaders.length > 0,
        odp: odpReceipt
      });
    } else {
      return c.json({
        success: true,
        message: 'Action processed, no personalization changes needed',
        sessionId: result.sessionId,
        cookiesUpdated: result.cookieHeaders.length > 0,
        odp: odpReceipt
      });
    }

  } catch (error) {
    console.error('Error processing action event:', error);
    
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Invalid action event format',
        details: error.issues
      }, 400);
    }

    return c.json({
      error: 'Failed to process action event',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get personalization config with session management
realtimeRoutes.get('/personalization/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    
    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    const cookieHeader = c.req.header('Cookie') ?? null;
    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env), { tenant: c.get('tenant') });
    
    // Get or create session from cookies
    const { sessionId, sessionData, isNewSession } = await segmentEngine.getOrCreateSessionFromCookies(
      cookieHeader,
      userId
    );

    // Get personalization configuration
    const config = await segmentEngine.getSessionPersonalizationConfig(sessionId);
    
    if (!config) {
      return c.json({ error: 'Failed to get personalization configuration' }, 500);
    }

    // Set cookies in response
    config.cookieHeaders.forEach(cookieHeader => {
      c.header('Set-Cookie', cookieHeader, { append: true });
    });

    return c.json({
      userId,
      sessionId,
      isNewSession,
      config: {
        segments: config.segments,
        featureFlags: config.featureFlags,
        featureVariables: config.featureVariables,
        experiments: config.experiments
      },
      cookiesSet: config.cookieHeaders.length > 0,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error getting personalization config:', error);
    return c.json({
      error: 'Failed to get personalization configuration',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Edge Affinity Reflex — hydrate snapshot for the Affinity Instrument (doc 16 §10).
// Resolves the shopper's session from cookies and returns freshly-computed live
// affinity (scores decay by construction, so they are ALWAYS computed at read).
realtimeRoutes.get('/reflex', async (c) => {
  try {
    const cookieHeader = c.req.header('Cookie') ?? null;
    const userId = c.req.query('userId') || 'anonymous';

    // REFLEX_HOST='do' (doc 16 §6): the vector lives in the shopper's own
    // ShopperReflex DO — read the snapshot there (same response shape).
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const stub = shopperObject(c.env.SHOPPER_REFLEX, userId, c.get('tenant'));
      const doRes = await stub.fetch('https://shopper-reflex/snapshot');
      return c.json((await doRes.json()) as Record<string, unknown>, doRes.status as 200);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env), { tenant: c.get('tenant') });
    const { sessionData } = await segmentEngine.getOrCreateSessionFromCookies(cookieHeader, userId);
    // Surface-aware tuning (@/demos/registry): an explicit ?surface= wins, else
    // the session remembers which demo it belongs to, else DEFAULT_SURFACE.
    // With both absent and nothing stored, this resolves to
    // DEFAULT_REFLEX_CONFIG BY IDENTITY — every pre-existing caller gets a
    // byte-identical response until someone tunes the scope.
    const cfg = await resolveReflexConfig(
      c.env,
      resolveSurface({ surface: c.req.query('surface') ?? sessionData.surface })
    );
    const now = Date.now();
    return c.json({
      ok: true,
      now,
      config: {
        tauMs: cfg.tauMs,
        K: cfg.K,
        thetaIn: cfg.thetaIn,
        thetaOut: cfg.thetaOut,
        // Per-dimension overrides (e.g. priceBand's slower τ) so the client's
        // honest drain animation decays each bar at its TRUE rate.
        dims: Object.fromEntries(
          cfg.dimensions
            .filter((d) => d.tauMs || d.K || d.thetaIn || d.thetaOut)
            .map((d) => [d.key, { tauMs: d.tauMs, K: d.K, thetaIn: d.thetaIn, thetaOut: d.thetaOut }])
        ),
      },
      affinity: sessionData.reflex
        ? { ...reflexSnapshot(sessionData.reflex, now, cfg), odpConfirmed: sessionData.odpSeed ?? [] }
        : null,
    });
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'reflex snapshot failed' },
      500
    );
  }
});

// New shopper — expire the session cookies (opt_session_id is HttpOnly, so only the
// server can clear it) and drop the KV session. The next page load cold-starts clean:
// fresh reflex, fresh journey, geo cold-start hero. Powers the "New shopper" button
// so presenters restart WITHOUT hunting for an incognito window.
realtimeRoutes.post('/session/reset', async (c) => {
  const cookieHeader = c.req.header('Cookie') ?? '';
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  // Best-effort KV hygiene (TTL would reap these anyway).
  const sid = cookies['opt_session_id'];
  const uid = cookies['opt_user_id'];
  try { if (sid) await c.env.SESSIONS.delete(`session:${sid}`); } catch { /* best-effort */ }
  try { if (uid) await c.env.SESSIONS.delete(`user:${uid}`); } catch { /* best-effort */ }
  // Expire every opt_* cookie the SessionManager sets (superset — extras are harmless).
  const names = [
    'opt_session_id', 'opt_user_id', 'opt_anonymous_id', 'opt_segments',
    'opt_engagement_score', 'opt_last_update', 'opt_tracking_consent', 'opt_personalization_enabled',
  ];
  for (const name of names) {
    c.header('Set-Cookie', `${name}=; Max-Age=0; Path=/; SameSite=Lax`, { append: true });
  }
  return c.json({ ok: true, cleared: !!sid });
});

// Session preferences management
const preferencesSchema = z.object({
  trackingConsent: z.boolean().optional(),
  personalizationEnabled: z.boolean().optional(),
  cookieConsent: z.boolean().optional()
});

realtimeRoutes.post('/session/:sessionId/preferences', async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const body = await c.req.json();
    const preferences = preferencesSchema.parse(body);

    if (!sessionId) {
      return c.json({ error: 'Session ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env), { tenant: c.get('tenant') });
    const updatedSession = await segmentEngine.updateSessionPreferences(sessionId, preferences);

    if (!updatedSession) {
      return c.json({ error: 'Session not found' }, 404);
    }

    // Generate updated cookies
    const cookies = await segmentEngine.getSessionPersonalizationConfig(sessionId);
    if (cookies) {
      cookies.cookieHeaders.forEach(cookieHeader => {
        c.header('Set-Cookie', cookieHeader, { append: true });
      });
    }

    return c.json({
      success: true,
      sessionId,
      preferences: updatedSession.preferences,
      cookiesUpdated: cookies?.cookieHeaders.length || 0 > 0,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error updating session preferences:', error);
    
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Invalid preferences format',
        details: error.issues
      }, 400);
    }

    return c.json({
      error: 'Failed to update session preferences',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get session analytics
realtimeRoutes.get('/session/:sessionId/analytics', async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    
    if (!sessionId) {
      return c.json({ error: 'Session ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env), { tenant: c.get('tenant') });
    const analytics = await segmentEngine.getSessionAnalytics(sessionId);

    if (!analytics) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json({
      sessionId,
      analytics,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error retrieving session analytics:', error);
    return c.json({
      error: 'Failed to retrieve session analytics',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get user segments endpoint
realtimeRoutes.get('/segments/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    
    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env), { tenant: c.get('tenant') });
    const segments = await segmentEngine.getUserSegments(userId);

    return c.json({
      userId,
      segments,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error retrieving user segments:', error);
    return c.json({
      error: 'Failed to retrieve user segments',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Manual segment assignment endpoint
const assignSegmentSchema = z.object({
  segment: z.string(),
  source: z.string().optional().default('manual')
});

realtimeRoutes.post('/segments/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const body = await c.req.json();
    const { segment, source } = assignSegmentSchema.parse(body);

    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env), { tenant: c.get('tenant') });
    await segmentEngine.assignSegment(userId, segment, source);

    return c.json({
      success: true,
      message: `Segment '${segment}' assigned to user ${userId}`,
      userId,
      segment,
      source,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error assigning segment:', error);
    
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Invalid segment assignment format',
        details: error.issues
      }, 400);
    }

    return c.json({
      error: 'Failed to assign segment',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get WebSocket connection info
realtimeRoutes.get('/connections/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    
    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    // Get the Durable Object instance for this user
    const id = c.env.PERSONALIZATION_WEBSOCKET.idFromName(shopperObjectName(c.get('tenant'), userId));
    const durableObject = c.env.PERSONALIZATION_WEBSOCKET.get(id);
    
    // Request connection info from the Durable Object
    const response = await durableObject.fetch(new Request('http://fake/connections?userId=' + userId));
    const connectionInfo = await response.json() as Record<string, unknown>;

    return c.json(connectionInfo);

  } catch (error) {
    console.error('Error retrieving connection info:', error);
    return c.json({
      error: 'Failed to retrieve connection info',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get all WebSocket connections (admin endpoint)
realtimeRoutes.get('/connections', async (c) => {
  try {
    // Create a temporary ID to get any instance of the Durable Object
    const id = c.env.PERSONALIZATION_WEBSOCKET.idFromName(SINGLETON_ADMIN);
    const durableObject = c.env.PERSONALIZATION_WEBSOCKET.get(id);
    
    // Request all connections info from the Durable Object
    const response = await durableObject.fetch(new Request('http://fake/connections'));
    const connectionsInfo = await response.json() as Record<string, unknown>;

    return c.json(connectionsInfo);

  } catch (error) {
    console.error('Error retrieving all connections:', error);
    return c.json({
      error: 'Failed to retrieve connections info',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Health check for real-time services
realtimeRoutes.get('/health', async (c) => {
  try {
    // Test WebSocket Durable Object health
    const id = c.env.PERSONALIZATION_WEBSOCKET.idFromName(SINGLETON_HEALTH);
    const durableObject = c.env.PERSONALIZATION_WEBSOCKET.get(id);
    const wsHealth = await durableObject.fetch(new Request('http://fake/health'));
    const wsHealthData = await wsHealth.json();

    // Test segment engine by creating a dummy instance
    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env), { tenant: c.get('tenant') });
    const testProfile = await segmentEngine.getUserProfile('health-check-user');
    
    return c.json({
      status: 'healthy',
      services: {
        websocket: {
          status: wsHealth.ok ? 'healthy' : 'unhealthy',
          data: wsHealthData
        },
        segmentEngine: {
          status: testProfile ? 'healthy' : 'unhealthy'
        },
        timestamp: Date.now()
      }
    });

  } catch (error) {
    console.error('Health check failed:', error);
    return c.json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now()
    }, 500);
  }
});

// Demo endpoint for testing real-time flow
const demoEventSchema = z.object({
  scenario: z.enum(['email_campaign', 'form_submission', 'pricing_page', 'demo_request']),
  userId: z.string(),
  metadata: z.record(z.string(), z.any()).optional()
});

realtimeRoutes.post('/demo/trigger', async (c) => {
  try {
    const body = await c.req.json();
    const { scenario, userId, metadata = {} } = demoEventSchema.parse(body);

    let actionEvent: ActionEvent;

    // Create demo action events based on scenario
    switch (scenario) {
      case 'email_campaign':
        actionEvent = {
          type: 'email_open',
          userId,
          data: {
            campaignId: metadata.campaignId || 'demo-campaign-001',
            emailId: metadata.emailId || 'demo-email-001',
            timestamp: Date.now()
          },
          source: 'demo',
          timestamp: Date.now()
        };
        break;

      case 'form_submission':
        actionEvent = {
          type: 'form_submit',
          userId,
          data: {
            formType: metadata.formType || 'lead_capture',
            formId: metadata.formId || 'demo-form-001',
            fields: metadata.fields || { email: 'demo@example.com', interest: 'enterprise' }
          },
          source: 'demo',
          timestamp: Date.now()
        };
        break;

      case 'pricing_page':
        actionEvent = {
          type: 'page_view',
          userId,
          data: {
            path: '/pricing',
            duration: metadata.duration || 120000, // 2 minutes
            plan_viewed: metadata.plan || 'enterprise'
          },
          source: 'demo',
          timestamp: Date.now()
        };
        break;

      case 'demo_request':
        actionEvent = {
          type: 'form_submit',
          userId,
          data: {
            formType: 'demo_request',
            formId: 'demo-request-form',
            company: metadata.company || 'Demo Company Inc',
            useCase: metadata.useCase || 'E-commerce personalization'
          },
          source: 'demo',
          timestamp: Date.now()
        };
        break;

      default:
        return c.json({ error: 'Invalid demo scenario' }, 400);
    }

    // Process the demo action event
    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env), { tenant: c.get('tenant') });
    const personalizationUpdate = await segmentEngine.processActionEvent(actionEvent);

    return c.json({
      success: true,
      scenario,
      actionEvent,
      personalizationUpdate,
      message: `Demo scenario '${scenario}' triggered successfully`
    });

  } catch (error) {
    console.error('Error triggering demo scenario:', error);
    
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Invalid demo trigger format',
        details: error.issues
      }, 400);
    }

    return c.json({
      error: 'Failed to trigger demo scenario',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Persist one demo-run shopper action into D1 `demo_events` (source='demo').
 *
 * This is the SINGLE demo-event write path. Rows here are isolated from the
 * historical synthetic dataset (coach_odp_profiles / coach_transactions /
 * coach_purchase_items), so POST /operator/events/reset can delete ONLY these and
 * never touch history. Opal aggregates these via v_demo_profiles into
 * v_audience_base — the UNION (historical + demo) surface it builds audiences over
 * — so demo shoppers grow audience sizes meaningfully. line/category/price_band
 * are enriched authoritatively from coach_catalog inside v_demo_profiles, so we
 * only store what the click carried. Best-effort: never throws into the request.
 */
// One catalog per isolate for capture-time enrichment (mirrors odpLoop's pattern);
// the CatalogService constructor builds the affinity graph — never rebuild per event.
let _captureCatalog: CatalogService | null = null;
function captureCatalog(): CatalogService {
  return (_captureCatalog = _captureCatalog ?? new CatalogService());
}

/**
 * Should this deployment write demo events to D1 at all?
 *
 * The write is a per-request insert into a single-primary SQLite from every edge
 * location. Fine at demo volume; the wrong shape for a decision path at Black
 * Friday volume, and the kind of thing that survives into production precisely
 * because it works fine until then. So it is fenced here, at the single write
 * path, and production is OFF by omission: nobody has to remember to disable it.
 */
export function demoEventCaptureEnabled(env: Pick<Env, 'DEMO_EVENT_CAPTURE' | 'ENVIRONMENT'>): boolean {
  const flag = (env.DEMO_EVENT_CAPTURE ?? '').trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  // With no flag, capture only in an environment that has NAMED itself something
  // other than production. A missing ENVIRONMENT is treated as production: the
  // failure "demo reset shows nothing" is visible and fixable, and the failure
  // "per-request D1 writes in production" is neither.
  const environment = (env.ENVIRONMENT ?? '').trim().toLowerCase();
  return environment !== '' && environment !== 'production';
}

async function captureDemoEvent(
  env: Env,
  event: ActionEvent,
  sessionId?: string
): Promise<void> {
  try {
    if (!demoEventCaptureEnabled(env)) return;
    if (!env.DB) return; // D1 not bound (e.g. some test envs) — skip silently
    const d = event.data ?? {};
    const vuid = event.anonymousId ?? event.userId;
    const productId = d.product_id ?? d.productId ?? d.sku ?? null;
    // 0005: enrich the captured row with silhouette/subcategory/occasions
    // server-side (catalog-authoritative — no client payload change needed).
    // v_demo_profiles still re-joins the catalog; these are the self-contained
    // copy + the fallback when a stray product id misses the join.
    const product = productId ? captureCatalog().getProduct(String(productId)) : undefined;
    await env.DB.prepare(
      `INSERT INTO demo_events
         (ts, vuid, session_id, demo_run_id, event_type,
          product_id, product_name, line, price_usd, path, label, dwell_ms, raw_json, source,
          silhouette, subcategory, occasions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo', ?, ?, ?)`
    )
      .bind(
        event.timestamp ?? Date.now(),
        vuid,
        sessionId ?? null,
        sessionId ?? null, // demo_run_id defaults to the session — enables per-run reset
        event.type,
        productId,
        d.product_name ?? d.name ?? product?.name ?? null,
        typeof d.line === 'string' ? d.line : (product?.line ?? null),
        typeof d.price_usd === 'number' ? Math.round(d.price_usd) : (product?.price_usd ?? null),
        typeof d.path === 'string' ? d.path : null,
        d.label ?? d.query ?? null,
        typeof d.dwellMs === 'number' ? Math.round(d.dwellMs) : null,
        JSON.stringify({ source: event.source, data: d }), // full payload (provenance incl. original source)
        product?.silhouette ?? null,
        product?.subcategory ?? null,
        product?.occasion && product.occasion.length ? product.occasion.join(',') : null
      )
      .run();
  } catch (err) {
    console.error('captureDemoEvent failed (non-fatal):', err);
  }
}

export default realtimeRoutes;