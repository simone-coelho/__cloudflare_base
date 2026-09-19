import type { TenantVariables } from '@/tenancy/tenant';
import { shopperObject, shopperObjectName } from '@/tenancy/objects';
import { DEFAULT_TENANT, TenantKV, type KVLike } from '@/tenancy/tenant';
// Singleton objects: one per worker on purpose, never per brand.
const SINGLETON_ADMIN = 'admin';
const SINGLETON_HEALTH = 'health-check';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { RealtimeSegmentEngine, type ActionEvent } from '@/services/RealtimeSegmentEngine';
import { getConnectors } from '@/connectors';
import { snapshot as reflexSnapshot, type ReflexConfig } from '@/reflex/core';
import { resolveTenantReflexConfig, resolveSurface } from '@/demos/registry';
import { forwardEventToOdp, projectOdpState, mapActionToOdp, odpEnabled, stageOnlyOdpProjection, upsertOdpProfile, warnStageProjectionSkipped } from '@/services/odpLoop';
import { isDecisionReference, outcomeFromAction } from '@/ledger/records';
import { enqueueOutcome } from '@/ledger/enqueue';
import { storedConsent, consentOf, personalizes, type Consent } from '@/content/consent';
import { ACTION_EVENT_TYPES, isEventNonce, isEventTimestamp } from '@/events/actionTypes';
import { validBufferedAction } from '@/reflex/bufferedAction';
import { projectVisit, validEntry, type ChannelSignals } from '@/services/visit';
import { journeyCountersNow, journeyStageFrom, journeyThresholdsInForce, readTimeStageChange } from '@/services/JourneyStage';
import { outcomeToLearning } from '@/learn/route';
import { CatalogService } from '@/services/CatalogService';
import { demoEventCaptureEnabled } from '@/services/demoEventCapture';
export { demoEventCaptureEnabled } from '@/services/demoEventCapture';
import { z } from 'zod';
import { requireShopper, shopperPrincipal, assertSessionTarget, privateShopperHeaders, SessionAccessError } from '@/identity/sessionCapability';
import { anonymousWithConsent, ownedConsent, rotateObjectSession } from '@/identity/consentContinuity';
import { capabilityToken } from '@/identity/sessionCapability';
import { SessionManager } from '@/services/SessionManager';
import { assertShopperSelectors, parseShopperContext, currentOwnerConsent, ownerRelay, pinProfileRetention } from '@/identity/sessionAuthority';
import { captureRetention, RetentionUnavailable } from '@/retention';
import { captureBehavior } from '@/ledger/behavior';
import { consentFromCookies, intersectConsent, refusalHints } from '@/content/consent';
import { redeemRenderOffer } from '@/content/renderOffer';

const realtimeRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables }>();
for (const path of ['/ws', '/action', '/personalization/:userId', '/reflex', '/session/reset', '/session/preferences', '/session/:sessionId/preferences', '/session/:sessionId/analytics', '/segments/:userId', '/connections/:userId']) {
  // Authenticate before parsing an action, without entering the subject owner.
  if (path === '/action') realtimeRoutes.use(path, requireShopper({ forward: false, bodyLimit: 2 * 1024 * 1024, bodyTimeoutMs: 5000 }));
  realtimeRoutes.use(path, async (c, next) => {
    assertShopperSelectors(c.req.raw);
    if (c.req.method === 'POST' && path === '/action') {
      // Invalid logical identity must not acquire/forward the subject owner.
      let body: unknown; try { body = await c.req.raw.clone().json(); } catch { return c.json({ error: 'Invalid action event' }, 400); }
      const event = actionEventSchema.safeParse(body);
      if (!event.success || event.data.processing === 'buffered' && !validBufferedAction(event.data, Date.now())) {
        return c.json({ error: 'Invalid action event' }, 400);
      }
      if (Object.hasOwn(event.data.data, 'renderOffer') && (event.data.type !== 'content_impression'
        || !isEventNonce(event.data.eventId) || !isEventTimestamp(event.data.timestamp))) throw new SessionAccessError();
    }
    if (c.req.method === 'POST' && path.endsWith('/preferences')) {
      const body = parseShopperContext(await c.req.raw.clone().text());
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SessionAccessError();
      // Preferences do not resolve tenant authority from payload/query fields.
      // Validate supplied selectors before requireShopper can adopt an owner.
      const tenant = c.get('tenant'), queryTenant = c.req.query('tenant');
      if ((queryTenant !== undefined && queryTenant !== tenant)
        || (Object.hasOwn(body, 'tenant') && (body as Record<string, unknown>).tenant !== tenant)) throw new SessionAccessError();
    }
    await next();
  });
  realtimeRoutes.use(path, requireShopper());
}

// WebSocket upgrade endpoint
realtimeRoutes.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426);
  }

  const userId = shopperPrincipal(c.req.raw).subject;

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
    const owned = new URL(c.req.url); owned.pathname = '/owner/upgrade';
    return durableObject.fetch(new Request(owned, c.req.raw));
  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error establishing WebSocket connection');
    return c.text('Failed to establish WebSocket connection', 500);
  }
});

// Real-time action event processing.
// Retail event types ('product_view','add_to_cart','wishlist_add') are accepted
// alongside the original B2B types so the Coach storefront and existing callers
// share one ingestion path (REAL SEAMS, MOCKED CALLS — see docs/architecture/05-demo-build-spec.md §3).
export const actionEventSchema = z.object({
  // One list, in @/events/actionTypes, so this and the shopper object's door
  // cannot drift apart again (doc 31 §4: the object refused every content event).
  type: z.enum(ACTION_EVENT_TYPES),
  userId: z.string(),
  anonymousId: z.string().optional(),
  eventId: z.string().refine(isEventNonce).optional(),
  processing: z.literal('buffered').optional(),
  browsingSessionId: z.unknown().optional(),
  data: z.record(z.string(), z.any()),
  source: z.string(),
  // Which demo posted this (@/demos/registry). Optional and stripped-if-absent:
  // the engine falls back to `source`, and then to the default surface (coach),
  // so every existing client is unaffected.
  surface: z.string().optional(),
  // How the shopper arrived. Captured once per page load by the client and sent
  // with every action, because the server cannot know in advance which event
  // will be the one that opens a new visit. Optional, so every existing client
  // is unaffected; omitted/unobserved entry stays unknown.
  entry: z.custom<ChannelSignals>(value => value !== undefined && validEntry(value)).optional(),
  timestamp: z.number().refine(isEventTimestamp).optional()
}).superRefine((event, ctx) => {
  if (Object.prototype.hasOwnProperty.call(event.data, 'decisionId') && !isDecisionReference(event.data.decisionId)) {
    ctx.addIssue({ code: 'custom', path: ['data', 'decisionId'], message: 'Invalid decision reference' });
  }
  if (event.eventId !== undefined && !isEventTimestamp(event.timestamp)) {
    ctx.addIssue({ code: 'custom', path: ['timestamp'], message: 'eventId requires a safe integer event timestamp' });
  }
  if (event.processing === 'buffered' && !validBufferedAction(event, Number.MAX_SAFE_INTEGER)) {
    ctx.addIssue({ code: 'custom', path: ['processing'], message: 'Buffered action requires original event identity, timestamp and browsing session' });
  }
});

realtimeRoutes.post('/action', async (c) => {
  try {
    const body = await c.req.json();
    assertSessionTarget(shopperPrincipal(c.req.raw), body?.userId, body?.sessionId);
    const validatedEvent = actionEventSchema.parse(body);
    // Render retries carry their first wire identity/time. Generic legacy
    // synthesis would turn a lost acknowledgement into a different render.
    if (Object.hasOwn(validatedEvent.data, 'renderOffer') && (validatedEvent.type !== 'content_impression'
      || !isEventNonce(validatedEvent.eventId) || !isEventTimestamp(validatedEvent.timestamp))) throw new SessionAccessError();
    if (validatedEvent.processing === 'buffered' && !validBufferedAction(validatedEvent, Date.now())) {
      return c.json({ error: 'Invalid buffered action' }, 400);
    }

    // Add timestamp if not provided.
    // Cast: the zod schema accepts the retail event types ('product_view',
    // 'add_to_cart','wishlist_add'); ActionEvent['type'] is widened to the same
    // union by the catalog-aware engine refactor (build-spec §2.1/§2.2). The
    // runtime values are always valid events, so this stays correct post-refactor.
    const cfGeo = ((c.req.raw as unknown as { cf?: { country?: string; regionCode?: string } }).cf) ?? null;
    const actionEvent = {
      ...validatedEvent,
      eventId: validatedEvent.eventId,
      anonymousId: shopperPrincipal(c.req.raw).kind === 'anonymous' ? shopperPrincipal(c.req.raw).subject : undefined,
      timestamp: validatedEvent.timestamp ?? Date.now(),
      // CW6: coarse request geolocation rides the event so the scoring host can
      // fan the touches into the shopper's region. Aggregates only, never stored per person.
      ...(cfGeo?.country ? { geo: { country: cfGeo.country, regionCode: cfGeo.regionCode ?? null } } : {}),
    } as ActionEvent;

    // Browsing attribution is separate from the signed profile session. Capture
    // and measurement below start only after the host returns resolved consent.
    const sessionId = validatedEvent.processing === 'buffered' ? validatedEvent.browsingSessionId as string | null
      : typeof body.browsingSessionId === 'string' && body.browsingSessionId.trim()
      ? body.browsingSessionId.trim().slice(0, 128) : shopperPrincipal(c.req.raw).sessionId;
    // Actual accepted action source is admitted durably BEFORE profile, queue,
    // learning or external side effects; a downstream refusal cannot erase the
    // original event identity or turn transport ACK into canonical completion.
    const priorConsent = await currentOwnerConsent();
    if (!priorConsent) throw new SessionAccessError();
    const captureConsent = intersectConsent(priorConsent, consentFromCookies(c.req.header('Cookie')), refusalHints(actionEvent.data.consent));
    if (captureConsent.tracking && !actionEvent.eventId) actionEvent.eventId = crypto.randomUUID();
    const hasOffer = Object.hasOwn(actionEvent.data, 'renderOffer');
    if (hasOffer && actionEvent.type !== 'content_impression') throw new SessionAccessError();
    const render = hasOffer ? await redeemRenderOffer(c.env, shopperPrincipal(c.req.raw), captureConsent, actionEvent) : undefined;
    // The ciphertext is an admission capability, never behavior, demo capture,
    // pipeline input or provider data. Remove it before any ordinary handler.
    if (hasOffer) { const { renderOffer: _offer, ...data } = actionEvent.data; void _offer; actionEvent.data = data; }
    const behavior = await captureBehavior(c.env, shopperPrincipal(c.req.raw), captureConsent,
      { type: actionEvent.type, eventId: actionEvent.eventId!, eventIdSource: validatedEvent.eventId === undefined ? 'request' : 'provided',
        timestamp: actionEvent.timestamp!, source: actionEvent.source, data: actionEvent.data }, sessionId ?? null);
    // Phase 0 (doc 22 §3.2): a reward-bearing action becomes an outcome record, after the response.
    // The outcome's session must be the session the decision record carries, or session-scope
    // attribution compares two id spaces and credits nothing (found 2026-09-04). Both now prefer the
    // client's browsing session, which the SDK persists with an idle rule and sends on the snapshot and
    // on every event; a client that sends none gets the server's session on both. Called once the host
    // has answered, so the server's session is known.
    // Both hosts return the strict stored/hint intersection; cookie mirrors are
    // not independent authority for capture or outcome processing.
    const emitOutcome = (serverSessionId: unknown, consent: Consent) => {
      if (!consent.tracking) return;
      if (actionEvent.processing !== 'buffered') {
        const capture = captureDemoEvent(c.env, c.get('tenant'), actionEvent, sessionId);
        try { c.executionCtx.waitUntil(capture); } catch { void capture; }
      }
      const server = typeof serverSessionId === 'string' && serverSessionId ? serverSessionId : undefined;
      const outcome = outcomeFromAction({ ...actionEvent, sessionId: actionEvent.processing === 'buffered' ? sessionId : sessionId ?? server,
        eventId: actionEvent.eventId ?? crypto.randomUUID(),
        eventIdSource: validatedEvent.eventId === undefined ? 'request' : 'provided',
      }, c.get('tenant'));
      if (outcome) {
        outcome.retention = captureRetention(c.env, c.get('tenant'), outcome.ts);
        const p = c.env.LEDGER_RECOVERY_ENABLED === 'true'
          ? outcomeToLearning(c.env, c.get('tenant'), outcome)
          : Promise.all([enqueueOutcome(c.env, outcome), outcomeToLearning(c.env, c.get('tenant'), outcome)]);
        try { c.executionCtx.waitUntil(p); } catch { void p; }
      }
    };

    // ── Edge Affinity Reflex P2 (doc 16 §6): REFLEX_HOST='do' forwards to the
    // shopper's ShopperReflex DO, which runs the same pipeline IN-OBJECT (reflex →
    // qualify → decide → push over its own socket) and returns the same envelope
    // shape ({success, update?, sessionId, cookiesUpdated, odp?}). The DO owns the
    // ODP loop on this path (forward + seed + receipt over its own socket), so no
    // route-level ODP dispatch here. The same envelope gates D1 capture/outcomes.
    const tEngine = performance.now();
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const stub = shopperObject(c.env.SHOPPER_REFLEX, actionEvent.userId, c.get('tenant'));
      const doRes = await stub.fetch('https://shopper-reflex/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...privateShopperHeaders(c.req.raw) },
        body: JSON.stringify(actionEvent),
      });
      const out = (await doRes.json()) as Record<string, unknown>;
      c.header('Server-Timing', `object;dur=${Math.round(performance.now() - tEngine)}`);
      if (doRes.ok && out.success === true && !out.dropped) {
        if (!out.consent) throw new Error('Consent state unavailable');
        emitOutcome(out.sessionId, storedConsent(out.consent));
      }
      return c.json({ ...out, behavior, ...(render ? { render } : {}) }, doRes.status as 200);
    }

    // Get cookie header for session management
    const cookieHeader = c.req.header('Cookie') ?? null;

    // Process the action event with enhanced session management
    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant'), principal: shopperPrincipal(c.req.raw) });
    let execCtx: { waitUntil(p: Promise<unknown>): void } | undefined;
    try { execCtx = c.executionCtx; } catch { execCtx = undefined; /* no execCtx (e.g. tests) */ }
    const result = await segmentEngine.processActionEventWithSession(actionEvent, cookieHeader, execCtx);
    const consent = result.consent;
    // Where the time went: the engine's own work on the session host, for whoever is measuring.
    c.header('Server-Timing', `engine;dur=${Math.round(performance.now() - tEngine)}`);
    if (!result.dropped) emitOutcome(result.sessionId, consent);
    if (actionEvent.processing === 'buffered') return c.json({ success: true, processing: 'buffered',
      interestApplied: result.interestApplied === true, ...(result.dropped ? { dropped: result.dropped } : {}),
      ...(result.signals ? { signals: result.signals } : {}),
      sessionId: result.sessionId, cookiesUpdated: false, consent, behavior, ...(render ? { render } : {}) });

    // ODP loop (doc 16 §8): forward the behavioral event to ODP OFF the response
    // path — the shopper never waits on the memory; ODP down = zero impact.
    // The response carries a dispatch RECEIPT (server truth: what the platform is
    // forwarding); the forwarder later pushes the ODP status over the WebSocket as
    // an `odp_receipt` so the feed row upgrades to its real ✓ 202.
    let odpReceipt: { receiptId: string; type: string; action?: string; product_id?: string } | undefined;
    if (consent.tracking && odpEnabled(c.env, c.get('tenant'))) {
      const mapped = mapActionToOdp(actionEvent, c.get('tenant'), c.env);
      if (mapped) {
        odpReceipt = {
          receiptId: crypto.randomUUID(),
          type: mapped.type,
          ...(mapped.action ? { action: mapped.action } : {}),
          ...(typeof mapped.data.product_id === 'string' ? { product_id: mapped.data.product_id } : {}),
        };
        c.executionCtx.waitUntil(forwardEventToOdp(
          c.env, c.get('tenant'), actionEvent,
          { visitorId: actionEvent.userId, sessionId: result.sessionId },
          odpReceipt.receiptId,
        ));
      }
      // §4 score upsert: on membership changes, persist the reflex's live scores
      // onto the ODP profile (the memory carrying the edge's numbers).
      const aff = result.update?.data?.affinity;
      if (personalizes(consent) && aff && Array.isArray(aff.changed) && aff.changed.length > 0) {
        c.executionCtx.waitUntil(
          upsertOdpProfile(
            c.env,
            c.get('tenant'),
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
        // W16 C8.03: what the tenant's own catalogue could and could not place
        // in this input, named, on the same answer both hosts return.
        ...(result.signals ? { signals: result.signals } : {}),
        sessionId: result.sessionId,
        cookiesUpdated: result.cookieHeaders.length > 0,
        odp: odpReceipt,
        behavior,
        ...(render ? { render } : {}),
        consent,
      });
    } else {
      return c.json({
        success: true,
        message: 'Action processed, no personalization changes needed',
        ...(render ? { render } : {}),
        ...(result.signals ? { signals: result.signals } : {}),
        sessionId: result.sessionId,
        cookiesUpdated: result.cookieHeaders.length > 0,
        odp: odpReceipt,
        behavior,
        consent,
      });
    }

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error processing action event');
    
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
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const response = await shopperObject(c.env.SHOPPER_REFLEX, shopperPrincipal(c.req.raw).subject, c.get('tenant')).fetch('https://shopper-reflex/personalization', { headers: privateShopperHeaders(c.req.raw) });
      return new Response(response.body, response);
    }
    
    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    const cookieHeader = c.req.header('Cookie') ?? null;
    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant'), principal: shopperPrincipal(c.req.raw) });
    
    // Get or create session from cookies
    const { sessionId, sessionData, isNewSession, reflexConfig } = await segmentEngine.getOrCreateSessionFromCookies(
      cookieHeader,
      userId
    );

    // Get personalization configuration
    const config = await segmentEngine.getSessionPersonalizationConfig(sessionId, sessionData, reflexConfig);
    assertSessionTarget(shopperPrincipal(c.req.raw), userId, sessionId);
    
    if (!config) {
      return c.json({ error: 'Failed to get personalization configuration' }, 500);
    }

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
      cookiesSet: false,
      timestamp: Date.now()
    });

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error getting personalization config');
    return c.json({
      error: 'Failed to get personalization configuration',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Edge Affinity Reflex — hydrate snapshot for the Affinity Instrument (doc 16 §10).
/**
 * The `config` block the snapshot answer carries. Per-dimension overrides (e.g.
 * priceBand's slower τ) ride along so the client's honest drain animation decays
 * each bar at its TRUE rate. One function, so the ordinary answer and the answer
 * that carries no retained profile (W16 C5.06) can never describe the same
 * published runtime differently.
 */
const reflexConfigView = (cfg: ReflexConfig) => ({
  version: cfg.version,
  tauMs: cfg.tauMs,
  K: cfg.K,
  thetaIn: cfg.thetaIn,
  thetaOut: cfg.thetaOut,
  dims: Object.fromEntries(
    cfg.dimensions
      .filter((d) => d.tauMs || d.K || d.thetaIn || d.thetaOut)
      .map((d) => [d.key, { tauMs: d.tauMs, K: d.K, thetaIn: d.thetaIn, thetaOut: d.thetaOut }])
  ),
});

// Resolves the shopper's session from cookies and returns freshly-computed live
// affinity (scores decay by construction, so they are ALWAYS computed at read).
realtimeRoutes.get('/reflex', async (c) => {
  try {
    const cookieHeader = c.req.header('Cookie') ?? null;
    const userId = shopperPrincipal(c.req.raw).subject;

    // REFLEX_HOST='do' (doc 16 §6): the vector lives in the shopper's own
    // ShopperReflex DO — read the snapshot there (same response shape).
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const stub = shopperObject(c.env.SHOPPER_REFLEX, userId, c.get('tenant'));
      const doRes = await stub.fetch('https://shopper-reflex/snapshot', { headers: privateShopperHeaders(c.req.raw) });
      return c.json((await doRes.json()) as Record<string, unknown>, doRes.status as 200);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant'), principal: shopperPrincipal(c.req.raw) });
    // W16 C5.06 (R63). The ONE retained-data authority this read pins is the
    // shopper's own PROFILE stamp — the record the answer would be built from
    // (`SessionManager.readOwnedConsent`, and the profile birth a cold owned
    // answer mints). When the authority that stamp was born under is no longer
    // in force, nothing of that record may be read out, projected or sent; but
    // refusing to SERVE her page is not a retention remedy. The read then
    // answers with no retained profile at all, and the skip is reported once, in
    // coded words that name nobody. Nothing else is absorbed here: the
    // destination's own retained-data policy is pinned later, inside the
    // projection below, under its own narrow catch, and every other path that
    // pins retention still fails closed exactly as it did.
    let owned: Awaited<ReturnType<RealtimeSegmentEngine['getOrCreateSessionFromCookies']>>;
    try {
      owned = await segmentEngine.getOrCreateSessionFromCookies(cookieHeader, userId);
    } catch (error) {
      if (!(error instanceof RetentionUnavailable)) throw error;
      warnStageProjectionSkipped();
      const cold = await resolveTenantReflexConfig(c.env, shopperPrincipal(c.req.raw).tenant,
        resolveSurface({ surface: c.req.query('surface') }));
      return c.json({ ok: true, now: Date.now(), config: reflexConfigView(cold),
        affinity: null, journeyStage: null, visit: null, consent: await currentOwnerConsent() ?? storedConsent(undefined) });
    }
    const { sessionId, sessionData, reflexConfig } = owned;
    const consent = consentOf(sessionData);
    // Surface-aware tuning (@/demos/registry): an explicit ?surface= wins, else
    // the session remembers which demo it belongs to, else DEFAULT_SURFACE.
    // With both absent and nothing stored, this resolves to
    // DEFAULT_REFLEX_CONFIG BY IDENTITY — every pre-existing caller gets a
    // byte-identical response until someone tunes the scope.
    const cfg = reflexConfig ?? await resolveTenantReflexConfig(
      c.env,
      shopperPrincipal(c.req.raw).tenant,
      resolveSurface({ surface: c.req.query('surface') ?? sessionData.surface })
    );
    const now = Date.now();
    assertSessionTarget(shopperPrincipal(c.req.raw), userId);
    const live = personalizes(consent) && sessionData.reflex ? reflexSnapshot(sessionData.reflex, now, cfg) : null;

    // W16 C5: this read may have moved her stage on its own — the visit those
    // counters belonged to ended while she was away. That is a stage-only
    // change: it fabricates no event, writes nothing and renews no retained
    // lifetime, and the single thing it is allowed to do is tell the tenant's
    // configured destination the stage, off the response path. The object host
    // does the identical thing in ShopperReflex.handleSnapshot.
    const moved = live ? readTimeStageChange(sessionData.journey, sessionData.metadata.lastSeen, now, journeyThresholdsInForce(cfg)) : null;
    if (moved) {
      let deferred: { waitUntil(p: Promise<unknown>): void } | undefined;
      try { deferred = c.executionCtx; } catch { deferred = undefined; /* no execCtx (e.g. tests) */ }
      try {
        // The projection is an external copy of her profile, so it needs the
        // retained-data authority her record was born with. No stamp, no
        // projection: the read still answers, and nothing leaves the platform.
        pinProfileRetention(c.env, sessionData, c.get('tenant'));
        const projection = deferred
          ? stageOnlyOdpProjection(c.env, c.get('tenant'), { visitorId: userId, sessionId }, live!, moved)
          : null;
        if (projection) deferred!.waitUntil(projection);
      } catch (error) {
        // Only an unusable retained-data stamp is answered by skipping the
        // projection. Everything else — an owner or consent refusal above all —
        // is the caller's to see, and propagates.
        if (!(error instanceof RetentionUnavailable)) throw error;
        // Coded and non-identifying, like every other ODP diagnostic, and in the
        // same words the object host uses for the same skip.
        warnStageProjectionSkipped();
      }
    }

    return c.json({
      ok: true,
      now,
      config: reflexConfigView(cfg),
      affinity: live
        ? { ...live, odpConfirmed: (await projectOdpState(c.env, c.get('tenant'), sessionData)).odpSeed }
        : null,
      // W16 C4 / R29: the SDK-visible journey stage, in the shared vocabulary,
      // derived from THIS VISIT's counters against the tenant's published
      // journey thresholds — identically on the object host
      // (ShopperReflex.handleSnapshot). A shopper who declined personalization
      // is told null, exactly as before.
      journeyStage: personalizes(consent)
        ? journeyStageFrom(journeyCountersNow(sessionData.journey, sessionData.metadata.lastSeen, now), journeyThresholdsInForce(cfg))
        : null,
      // R20 / unit W16.C2.07: the SDK-visible hydrate carries the shopper's
      // visit number and entry channel in the `projectVisit` shape, identically
      // on both hosts (the DO host answers from ShopperReflex.handleSnapshot).
      // The object's internal `projection=content` shape stays internal.
      visit: personalizes(consent) ? projectVisit(sessionData.metadata, sessionData.metadata.lastSeen, now) : null,
      consent,
    });
  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
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
  const principal = shopperPrincipal(c.req.raw);
  const session = await rotateObjectSession(c.env, principal, capabilityToken(c.req.raw)!, 'reset', c.req.header('Cookie'));
  for (const header of new SessionManager(c.env, { tenant: principal.tenant }).clearCookieHeaders()) c.header('Set-Cookie', header, { append: true });
  return c.json({ ok: true, cleared: true, session });
});

// Session preferences management
const preferencesSchema = z.object({
  choice: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/), expectedRevision: z.string().nullable(), grantId: z.string(), iat: z.number().int(), exp: z.number().int() }).strict().optional(),
  trackingConsent: z.boolean().optional(),
  personalizationEnabled: z.boolean().optional(),
  cookieConsent: z.boolean().optional(),
  // CW31: on the object host the switches live on the shopper's object, which is named by the visitor id.
  userId: z.string().trim().min(1).max(200).optional(),
});

realtimeRoutes.on('POST', ['/session/preferences', '/session/:sessionId/preferences'], async (c) => {
  try {
    const sessionId = c.req.param('sessionId') ?? shopperPrincipal(c.req.raw).sessionId;
    const body = await c.req.json();
    const preferences = preferencesSchema.parse(body);
    const principal = shopperPrincipal(c.req.raw);
    assertSessionTarget(principal, preferences.userId, sessionId);

    if (!sessionId) {
      return c.json({ error: 'Session ID is required' }, 400);
    }

    const manager = new SessionManager(c.env, { tenant: principal.tenant, principal });
    if (preferences.trackingConsent === undefined && preferences.personalizationEnabled === undefined) {
      if (preferences.cookieConsent === undefined) return c.json({ error: 'Explicit preference required' }, 400);
      const current = await manager.updateUserPreferences(sessionId, { cookieConsent: preferences.cookieConsent });
      if (!current) return c.json({ error: 'Session not found' }, 404);
      return c.json({ success: true, sessionId, preferences: current.preferences, consent: await currentOwnerConsent(), cookiesUpdated: false });
    }
    if (!preferences.choice) return c.json({ error: 'Invalid explicit consent choice' }, 400);
    // The object's necessary switch write is acknowledged before preference cookies.
    {
      const told = await shopperObject(c.env.SHOPPER_REFLEX, principal.subject, principal.tenant).fetch('https://shopper-reflex/consent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...privateShopperHeaders(c.req.raw) },
        body: JSON.stringify({ tracking: preferences.trackingConsent, personalization: preferences.personalizationEnabled, choice: preferences.choice }),
      });
      if (told.status === 404) return c.json({ error: 'Session not found' }, 404);
      if (told.status === 409) return c.json({ error: 'Consent choice conflict' }, 409);
      if (told.status === 400) return c.json({ error: 'Invalid explicit consent choice' }, 400);
      if (!told.ok) throw new SessionAccessError();
      const body = await told.json() as { ok?: unknown; consent?: unknown };
      if (body.ok !== true || body.consent === undefined) throw new SessionAccessError();
      const consent = storedConsent(body.consent);
      if (preferences.cookieConsent !== undefined) await manager.updateUserPreferences(sessionId, { cookieConsent: preferences.cookieConsent });
      assertSessionTarget(principal, undefined, sessionId);
      const effective = { trackingConsent: consent.tracking, personalizationEnabled: consent.personalization, cookieConsent: preferences.cookieConsent };
      const cookieHeaders = manager.generateConsentCookieHeaders(effective, consent);
      cookieHeaders.forEach(cookie => c.header('Set-Cookie', cookie, { append: true }));
      return c.json({ success: true, sessionId, preferences: effective, consent, cookiesUpdated: cookieHeaders.length > 0, timestamp: Date.now() });
    }

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error updating session preferences');
    
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
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const response = await shopperObject(c.env.SHOPPER_REFLEX, shopperPrincipal(c.req.raw).subject, c.get('tenant')).fetch('https://shopper-reflex/analytics', { headers: privateShopperHeaders(c.req.raw) });
      return new Response(response.body, response);
    }
    
    if (!sessionId) {
      return c.json({ error: 'Session ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant'), principal: shopperPrincipal(c.req.raw) });
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
      if (error instanceof SessionAccessError) throw error;
    console.error('Error retrieving session analytics');
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
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const response = await shopperObject(c.env.SHOPPER_REFLEX, shopperPrincipal(c.req.raw).subject, c.get('tenant')).fetch('https://shopper-reflex/segments', { headers: privateShopperHeaders(c.req.raw) });
      return new Response(response.body, response);
    }
    
    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant'), principal: shopperPrincipal(c.req.raw) });
    const segments = await segmentEngine.getUserSegments(userId, c.req.header('Cookie'));
    assertSessionTarget(shopperPrincipal(c.req.raw), userId);

    return c.json({
      userId,
      segments,
      timestamp: Date.now()
    });

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error retrieving user segments');
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
    assertSessionTarget(shopperPrincipal(c.req.raw), body.userId, body.sessionId);
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const response = await shopperObject(c.env.SHOPPER_REFLEX, shopperPrincipal(c.req.raw).subject, c.get('tenant')).fetch('https://shopper-reflex/segments', { method: 'POST', headers: { ...privateShopperHeaders(c.req.raw), 'Content-Type': 'application/json' }, body: JSON.stringify({ segment, source }) });
      return new Response(response.body, response);
    }

    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant'), principal: shopperPrincipal(c.req.raw) });
    if (!await segmentEngine.assignSegment(userId, segment, source, c.req.header('Cookie'))) {
      return c.json({ ok: false, error: 'Shopper consent refused segment assignment' }, 403);
    }
    assertSessionTarget(shopperPrincipal(c.req.raw), userId);

    return c.json({
      success: true,
      message: `Segment '${segment}' assigned to user ${userId}`,
      userId,
      segment,
      source,
      timestamp: Date.now()
    });

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error assigning segment');
    
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
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') await ownedConsent(c.env, shopperPrincipal(c.req.raw), capabilityToken(c.req.raw)!);
    
    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    // Get the Durable Object instance for this user
    const response = await ownerRelay(c.env, 'connections', c.get('tenant'), userId);
    const connectionInfo = await response.json() as Record<string, unknown>;

    return c.json(connectionInfo);

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error retrieving connection info');
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
      if (error instanceof SessionAccessError) throw error;
    console.error('Error retrieving all connections');
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
    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant') });
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
      if (error instanceof SessionAccessError) throw error;
    console.error('Health check failed');
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
    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant') });
    const personalizationUpdate = await segmentEngine.processActionEvent(actionEvent);

    return c.json({
      success: true,
      scenario,
      actionEvent,
      personalizationUpdate,
      message: `Demo scenario '${scenario}' triggered successfully`
    });

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error triggering demo scenario');
    
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
 * This is the action-event capture path; /funnel/event also writes demo rows.
 * Both use the same explicit development-demo gate. Rows are separate from the
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

async function captureDemoEvent(
  env: Env,
  tenant: string | undefined,
  event: ActionEvent,
  sessionId?: string
): Promise<void> {
  try {
    if (!demoEventCaptureEnabled(env, tenant)) return;
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
    console.error('captureDemoEvent failed (non-fatal)');
  }
}

export default realtimeRoutes;
