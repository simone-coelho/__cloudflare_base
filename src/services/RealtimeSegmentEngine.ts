// src/services/RealtimeSegmentEngine.ts
// Connector-driven, catalog-aware real-time personalization engine.
// See docs/architecture/05-demo-build-spec.md §2.1.
//
// REAL SEAMS, MOCKED CALLS: this engine no longer hardcodes B2B segment rules or
// Optimizely flag keys. Qualification is delegated to the ODP seam
// (connectors.segments.fetchQualifiedSegments) and decisioning to the Optimizely
// Feature Experimentation seam (connectors.decisions.decideAll). Coach launch
// audiences are seeded idempotently into the shared AudienceStore at boot, so the
// very first (cold) event a shopper generates is qualified against every audience —
// and an audience Opal creates at runtime becomes qualifiable with zero redeploy.
//
// The public methods routes call are preserved verbatim (processActionEvent,
// processActionEventWithSession, getOrCreateSessionFromCookies,
// getSessionPersonalizationConfig, getUserSegments, assignSegment, …). The
// constructor accepts an optional Connectors so existing single-arg route calls
// (`new RealtimeSegmentEngine(env)`) keep working while the spec's two-arg form
// (`new RealtimeSegmentEngine(env, getConnectors(env))`) is also supported.

import type { Env } from '@/types/env';
import { SessionManager, type SessionData } from './SessionManager';
import { FeatureVariableManager, type FeatureVariableResult } from './FeatureVariableManager';
import { CatalogService, priceBandOf, type Product } from './CatalogService';
import { deriveStage } from './JourneyStage';
import type { PersonalizationUpdate } from '@/durable-objects/PersonalizationWebSocket';
import {
  getConnectors,
  KvAudienceStore,
  type Connectors,
  type Decision,
  type QualificationContext,
} from '@/connectors';
import { CATALOG_FLAG_KEYS } from '@/connectors/DecisionProvider';
import { SEED_AUDIENCES } from '@/data/seed-audiences';
import {
  DEFAULT_REFLEX_CONFIG,
  apply as applyReflex,
  attributesFrom as reflexAttributes,
  extractTouches,
  snapshot as reflexSnapshot,
  type ReflexResult,
} from '@/reflex/core';
import {
  DEFAULT_GENERATOR_CONFIG,
  generateAffinityAudiences,
  regenerateCatalogAudiences,
} from '@/reflex/audienceGenerator';
import { odpEnabled, refreshOdpSeedIfDue, updateOdpRing } from '@/services/odpLoop';

export interface ActionEvent {
  type:
    // existing (backward compatible) B2B/event types
    | 'email_open'
    | 'form_submit'
    | 'page_view'
    | 'button_click'
    | 'custom'
    // retail / Coach storefront signals (shared ingestion path with realtime.ts)
    | 'product_view'
    | 'add_to_cart'
    | 'wishlist_add';
  userId: string;
  anonymousId?: string;
  data: Record<string, any>;
  timestamp: number;
  source: string;
}

export interface UserProfile {
  userId: string;
  anonymousId?: string;
  segments: string[];
  attributes: Record<string, any>;
  lastUpdated: number;
  events: ActionEvent[];
  metadata: {
    firstSeen: number;
    lastSeen: number;
    sessionCount: number;
    emailOpens: number;
    formSubmissions: number;
    pageViews: number;
  };
}

export interface PersonalizationConfig {
  /** Optimizely decisions, one per CATALOG_FLAG_KEYS slot — drives which module renders. */
  decisions: Record<string, Decision>;
  /** Back-compat: enabled-state per flag, derived from `decisions` (was getFeatureFlagDecisions). */
  featureFlags: Record<string, boolean>;
  /** Back-compat: chosen variation per flag, derived from `decisions` (was getExperimentDecisions). */
  experiments: Record<string, string>;
  /** Flat module-variables view of `decisions` (back-compat with featureVariables consumers). */
  featureVariables: Record<string, any>;
  enhancedFeatureVariables: Record<string, FeatureVariableResult>;
  cookieUpdates: Record<string, string>;
  cookieHeaders: string[];
  segments: string[];
  /** Personalized catalog recommendations for the current session. */
  recommendations: Product[];
  /** Personalized PLP sort order (product ids) for the current session. */
  sortOrder: string[];
  journeyStage: 'early' | 'mid' | 'late';
  sessionData: SessionData;
}

/**
 * Retail signals every QualificationContext starts with, so a cold session still
 * evaluates the audience condition trees sensibly (e.g. a `cart_adds eq 0` predicate
 * must be true for a brand-new shopper). Numeric counters initialize to 0.
 * Exported for the ShopperReflex DO (doc 16 §6, P2) — both hosts qualify against
 * the identical baseline.
 */
export const RETAIL_SIGNAL_DEFAULTS: Record<string, number> = {
  product_views: 0,
  cart_adds: 0,
  wishlist_adds: 0,
  page_views: 0,
  category_dwell_ms: 0,
  // `purchases eq 0` gates the ready-to-buy/cart audiences — without a default an
  // anonymous session evaluates undefined === 0 → false, and they can NEVER qualify.
  purchases: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// P2 seam (doc 16 §6): the pure/pipeline pieces of this engine that the
// ShopperReflex Durable Object must run IDENTICALLY are lifted to module scope
// and exported. The class methods below delegate to these — same behavior, one
// source, two hosts (request path today, per-shopper DO behind REFLEX_HOST='do').
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update attributes based on a retail action event. Retail intent can arrive either
 * as a typed event or carried in `event.data.action` (the storefront posts catalog
 * events as page_view/custom with a `line`/`productId`/`action` payload), so we
 * inspect both. Derives the attributes the Coach audiences are written against:
 * viewed_product_line, product_views, cart_adds, wishlist_adds, price_band_viewed,
 * category_dwell_ms, page_views.
 */
export function applyEventToAttributes(
  attributes: Record<string, any>,
  event: ActionEvent,
  catalog: CatalogService
): void {
  const data = event.data ?? {};
  // The retail action: explicit data.action wins, else the event type.
  const action = String(data.action ?? data.eventName ?? event.type);

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const inc = (key: string, by = 1) => {
    attributes[key] = num(attributes[key]) + by;
  };

  // Resolve a product (if referenced) so we can enrich line / price band from the catalog.
  const productId: string | undefined = data.productId ?? data.product_id ?? data.sku;
  const product = productId ? catalog.getProduct(productId) : undefined;
  const line: string | undefined =
    product?.line ?? (typeof data.line === 'string' ? data.line : undefined);
  const priceUsd: number | undefined =
    product?.price_usd ?? (typeof data.price_usd === 'number' ? data.price_usd : undefined);

  const applyLineAndBand = () => {
    if (line) attributes.viewed_product_line = line;
    if (typeof priceUsd === 'number') attributes.price_band_viewed = priceBandOf(priceUsd);
  };

  switch (action) {
    case 'product_view':
    case 'pdp_view':
    case 'view_product':
      inc('product_views');
      applyLineAndBand();
      if (typeof data.dwellMs === 'number') inc('category_dwell_ms', data.dwellMs);
      break;

    case 'add_to_cart':
    case 'cart_add':
      inc('cart_adds');
      applyLineAndBand();
      break;

    case 'wishlist':
    case 'wishlist_add':
    case 'add_to_wishlist':
    case 'save_for_later':
      inc('wishlist_adds');
      applyLineAndBand();
      break;

    case 'purchase':
    case 'checkout':
    case 'order_complete':
      inc('purchases');
      applyLineAndBand();
      break;

    case 'page_view':
      inc('page_views');
      if (typeof data.path === 'string') attributes.last_page_path = data.path;
      if (typeof data.dwellMs === 'number') inc('category_dwell_ms', data.dwellMs);
      // A page_view that carries a product line/category still updates affinity.
      applyLineAndBand();
      break;

    case 'button_click':
      inc('button_clicks');
      if (data.buttonId) attributes.last_button_clicked = data.buttonId;
      break;

    default:
      // Unknown/custom retail signal: still capture line/band if present so affinity grows.
      applyLineAndBand();
      if (typeof data.dwellMs === 'number') inc('category_dwell_ms', data.dwellMs);
      break;
  }

  attributes.last_activity = Date.now();
}

/**
 * Catalog-aware engagement score. Weights real retail intent: cart adds and
 * wishlist saves dominate, PDP views and dwell contribute, page views are a light
 * signal. Clamped to 0–100 so it stays a stable, comparable session score.
 */
export function calculateEngagementScore(attributes: Record<string, any>): number {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  const productViews = num(attributes.product_views);
  const cartAdds = num(attributes.cart_adds);
  const wishlistAdds = num(attributes.wishlist_adds);
  const purchases = num(attributes.purchases);
  const pageViews = num(attributes.page_views);
  const dwellMinutes = num(attributes.category_dwell_ms) / 60000;

  const score =
    productViews * 8 +
    cartAdds * 25 +
    wishlistAdds * 15 +
    purchases * 40 +
    pageViews * 2 +
    dwellMinutes * 5;

  return Math.min(100, Math.round(score));
}

/** Set-diff over segment keys — the change-detect both hosts trigger pushes on. */
export function hasSegmentChanges(oldSegments: string[], newSegments: string[]): boolean {
  if (oldSegments.length !== newSegments.length) {
    return true;
  }
  const oldSet = new Set(oldSegments);
  return newSegments.some((segment) => !oldSet.has(segment));
}

/**
 * Idempotently load the Coach launch audiences + the catalog-generated affinity
 * audiences (doc 16 §5) into the shared AudienceStore. Version-gated on a hash of
 * the generated set so the hot path pays ONE KV read; the diff
 * (regenerateCatalogAudiences) runs only when the catalog or generator config
 * actually changed — and never clobbers pinned/human edits.
 */
export async function ensureAudiencesSeeded(env: Env, catalogService: CatalogService): Promise<void> {
  const store = new KvAudienceStore(env);
  await store.seed(SEED_AUDIENCES);
  const generated = generateAffinityAudiences(
    catalogService.getAllProducts() as unknown as Array<Record<string, unknown>>,
    DEFAULT_REFLEX_CONFIG,
    DEFAULT_GENERATOR_CONFIG
  );
  const setHash = generated.map((d) => `${d.key}:${d.generatorHash}`).join('|');
  const MARKER = 'reflex:audgen:v1';
  if ((await env.CACHE.get(MARKER)) === setHash) return;
  const s = await regenerateCatalogAudiences(store, generated);
  await env.CACHE.put(MARKER, setHash);
  console.log(
    `[reflex] catalog audiences regenerated: +${s.published.length} ~${s.updated.length} −${s.archived.length}` +
      ` (skipped: ${s.skippedHumanEdited.length} human-edited, ${s.skippedPinned.length} pinned)`
  );
}

export class RealtimeSegmentEngine {
  private env: Env;
  private connectors: Connectors;
  private sessionManager: SessionManager;
  private featureVariableManager: FeatureVariableManager;
  private catalogService: CatalogService;
  /** Audiences are seeded once per engine instance (idempotent on the store regardless). */
  private seeded = false;

  constructor(
    env: Env,
    connectors?: Connectors,
    options?: { domain?: string; secure?: boolean }
  ) {
    this.env = env;
    // Default to getConnectors(env) so existing single-arg route calls keep working
    // while the spec's two-arg `new RealtimeSegmentEngine(env, getConnectors(env))` is honored.
    this.connectors = connectors ?? getConnectors(env);
    this.sessionManager = new SessionManager(env, options);
    this.featureVariableManager = new FeatureVariableManager(env);
    this.catalogService = new CatalogService();
  }

  /**
   * Idempotently load the Coach launch audiences into the shared AudienceStore.
   * Called at the start of any operation that qualifies segments, so ODP (mock or
   * live) always has the seed audiences plus any Opal-created ones to evaluate.
   * Delegates to the exported ensureAudiencesSeeded (shared with the P2 DO).
   */
  private async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    try {
      await ensureAudiencesSeeded(this.env, this.catalogService);
      this.seeded = true;
    } catch (error) {
      console.error('Error seeding audiences:', error);
    }
  }

  async processActionEvent(event: ActionEvent, sessionId?: string): Promise<PersonalizationUpdate | null> {
    try {
      // 0. Seed Coach launch audiences idempotently (cold sessions qualify on first event).
      await this.ensureSeeded();

      // 1. Get or create session
      const currentSessionId = sessionId || this.sessionManager.generateSessionId();
      let sessionData = await this.sessionManager.getSession(currentSessionId);

      // If no session exists, get user profile data from legacy method
      if (!sessionData) {
        const userProfile = await this.getUserProfile(event.userId);
        sessionData = await this.sessionManager.createOrUpdateSession(currentSessionId, event.userId, {
          anonymousId: event.anonymousId,
          segments: userProfile.segments,
          attributes: userProfile.attributes,
          metadata: {
            firstSeen: userProfile.metadata.firstSeen,
            lastSeen: Date.now(),
            sessionCount: userProfile.metadata.sessionCount,
            engagementScore: calculateEngagementScore(userProfile.attributes),
            lastSegmentUpdate: userProfile.lastUpdated
          },
          preferences: {
            trackingConsent: true,
            personalizationEnabled: true,
            cookieConsent: true
          }
        });
      }

      // 2. Apply this event's retail signals to a fresh attribute snapshot.
      const newAttributes = { ...sessionData.attributes };
      applyEventToAttributes(newAttributes, event, this.catalogService);
      const newEngagementScore = calculateEngagementScore(newAttributes);

      // 2.5 Edge Affinity Reflex (doc 16): decayed per-dimension affinity via the
      // pure core. State rides the session in P0 (relocates into the DO in P2).
      // The ENGINE clock is authoritative — client timestamps are advisory only.
      const nowMs = Date.now();
      const reflexOn = (this.env.REFLEX_ENABLED ?? 'true') !== 'false';
      let reflex: ReflexResult | null = null;
      if (reflexOn) {
        const data = event.data ?? {};
        const pid = data.productId ?? data.product_id ?? data.sku;
        const product = pid ? this.catalogService.getProduct(String(pid)) : undefined;
        const action = String(data.action ?? data.eventName ?? event.type);
        reflex = applyReflex(
          sessionData.reflex,
          {
            action,
            touches: product
              ? extractTouches(product as unknown as Record<string, unknown>, DEFAULT_REFLEX_CONFIG)
              : [],
          },
          nowMs,
          DEFAULT_REFLEX_CONFIG
        );
      }

      // 3. Qualify segments through the ODP seam against the live context.
      const ctx = this.buildQualificationContext(
        event.userId,
        event.anonymousId ?? sessionData.anonymousId,
        newAttributes,
        sessionData.segments
      );
      const journeyStage = deriveStage(ctx);
      ctx.attributes.journey_stage = journeyStage; // stage is itself an audience attribute
      // Reflex scores are computed FRESH into the context (never persisted — they
      // decay by construction), so store-published affinity audiences can gte them.
      if (reflex) Object.assign(ctx.attributes, reflexAttributes(reflex.state, nowMs, DEFAULT_REFLEX_CONFIG));
      const localSegments = await this.connectors.segments.fetchQualifiedSegments(event.userId, ctx);
      // ODP loop (doc 16 §8): seed/refresh the session's LIVE ODP-qualified audiences.
      // Additive + hard-capped (1.5s in fetchOdpAudiences) — ODP can only ever ADD;
      // slow or down degrades to exactly the pre-ODP behavior.
      let odpSeed = sessionData.odpSeed ?? [];
      let odpSeedAt = sessionData.odpSeedAt ?? 0;
      let odpRing = Array.isArray(sessionData.odpRecentEvents) ? sessionData.odpRecentEvents.slice() : [];
      if (odpEnabled(this.env)) {
        // Ring maintenance + seed read policy live in odpLoop (updateOdpRing /
        // refreshOdpSeedIfDue) — shared verbatim with the ShopperReflex DO (P2)
        // so the two hosts can never drift.
        odpRing = updateOdpRing(odpRing, event, nowMs);
        const membershipChanged = !!reflex && (reflex.changes.entered.length > 0 || reflex.changes.exited.length > 0);
        ({ seed: odpSeed, seedAt: odpSeedAt } = await refreshOdpSeedIfDue(
          this.env,
          currentSessionId,
          odpRing,
          { seed: odpSeed, seedAt: odpSeedAt },
          nowMs,
          membershipChanged
        ));
      }
      // Union: local evaluation ∪ live reflex memberships ∪ ODP-confirmed seed —
      // any enter/exit drives the same change-detect → persist → decide → push loop.
      const newSegments = Array.from(new Set([
        ...localSegments,
        ...(reflex ? reflex.state.audiences : []),
        ...odpSeed,
      ]));

      // 4. Detect what actually changed (segments OR journey stage) — either is a trigger.
      const segmentsChanged = hasSegmentChanges(sessionData.segments, newSegments);
      const stageChanged = sessionData.metadata.journeyStage !== journeyStage;

      if (!segmentsChanged && !stageChanged) {
        // No personalization change — persist the accrued attributes/activity and stop.
        await this.sessionManager.createOrUpdateSession(currentSessionId, event.userId, {
          ...sessionData,
          attributes: newAttributes,
          reflex: reflex ? reflex.state : sessionData.reflex,
          odpSeed,
          odpSeedAt,
          odpRecentEvents: odpRing,
          metadata: {
            ...sessionData.metadata,
            lastSeen: Date.now(),
            engagementScore: newEngagementScore,
            journeyStage
          }
        });
        return null;
      }

      // 5. Persist new attributes, segments, engagement score, and journey stage.
      await this.sessionManager.createOrUpdateSession(currentSessionId, event.userId, {
        ...sessionData,
        attributes: newAttributes,
        reflex: reflex ? reflex.state : sessionData.reflex,
        odpSeed,
        odpSeedAt,
        odpRecentEvents: odpRing,
        segments: newSegments,
        metadata: {
          ...sessionData.metadata,
          lastSeen: Date.now(),
          engagementScore: newEngagementScore,
          lastSegmentUpdate: Date.now(),
          journeyStage
        }
      });

      const updatedSessionData = await this.sessionManager.getSession(currentSessionId);
      if (!updatedSessionData) {
        throw new Error('Failed to update session data');
      }

      // 6. Decide the storefront modules through the Optimizely FX seam.
      const personalizationConfig = await this.getPersonalizationConfig(updatedSessionData, currentSessionId);

      // 7. Create the personalization update with retail payloads.
      const update: PersonalizationUpdate = {
        type: 'personalization_update',
        userId: event.userId,
        data: {
          segments: newSegments,
          decisions: personalizationConfig.decisions,
          featureVariables: personalizationConfig.featureVariables,
          recommendations: personalizationConfig.recommendations,
          sortOrder: personalizationConfig.sortOrder,
          journeyStage,
          // Live affinity payload for the Affinity Instrument (dims use original
          // catalog value names; changed = this event's explain records).
          affinity: reflex
            ? { ...reflexSnapshot(reflex.state, nowMs, DEFAULT_REFLEX_CONFIG), changed: reflex.changes.explain, odpConfirmed: odpSeed }
            : undefined,
          cookies: personalizationConfig.cookieUpdates,
          cookieHeaders: personalizationConfig.cookieHeaders,
          sessionId: currentSessionId,
          engagementScore: newEngagementScore,
          timestamp: Date.now(),
          source: event.source
        } as PersonalizationUpdate['data']
      };

      // 8. Broadcast update via WebSocket
      await this.broadcastUpdate(update);

      return update;

    } catch (error) {
      console.error('Error processing action event:', error);
      throw error;
    }
  }

  async getUserProfile(userId: string): Promise<UserProfile> {
    const cacheKey = `profile:${userId}`;
    const cached = await this.env.CACHE.get(cacheKey, 'json') as UserProfile;

    if (cached) {
      return cached;
    }

    // Create new profile — cold start: no segments yet (ODP qualifies on first event).
    return {
      userId,
      segments: [],
      attributes: {},
      lastUpdated: Date.now(),
      events: [],
      metadata: {
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        sessionCount: 1,
        emailOpens: 0,
        formSubmissions: 0,
        pageViews: 0
      }
    };
  }

  async saveUserProfile(profile: UserProfile): Promise<void> {
    const cacheKey = `profile:${profile.userId}`;
    await this.env.CACHE.put(cacheKey, JSON.stringify(profile), {
      expirationTtl: 7 * 24 * 60 * 60 // 7 days
    });
  }

  /**
   * Build the real-time QualificationContext the SegmentProvider qualifies against.
   * Numeric retail signals are initialized to 0 so cold sessions evaluate condition
   * trees sensibly (e.g. `cart_adds eq 0` is true for a brand-new shopper).
   */
  private buildQualificationContext(
    userId: string,
    anonymousId: string | undefined,
    attributes: Record<string, any>,
    segments: string[]
  ): QualificationContext {
    return {
      userId,
      anonymousId,
      attributes: { ...RETAIL_SIGNAL_DEFAULTS, ...attributes },
      segments
    };
  }

  // updateAttributesWithEvent / hasSegmentChanges / calculateEngagementScore were
  // lifted verbatim to exported module functions (applyEventToAttributes, …) so
  // the ShopperReflex DO runs the identical pipeline — see the P2 seam block above.

  private async getPersonalizationConfig(sessionData: SessionData, sessionId: string): Promise<PersonalizationConfig> {
    const attributes = { ...RETAIL_SIGNAL_DEFAULTS, ...sessionData.attributes };
    // Live affinity reads for the decision layer (doc 16 §10 choreography):
    // computed FRESH from the reflex state — they decay by construction, so they
    // are never persisted; the decision sees the score as of THIS moment.
    if ((this.env.REFLEX_ENABLED ?? 'true') !== 'false' && sessionData.reflex) {
      Object.assign(attributes, reflexAttributes(sessionData.reflex, Date.now(), DEFAULT_REFLEX_CONFIG));
    }

    const userAttributes = {
      segments: sessionData.segments,
      ...attributes,
      engagement_score: sessionData.metadata.engagementScore,
      session_count: sessionData.metadata.sessionCount,
      journey_stage: sessionData.metadata.journeyStage,
      days_since_first_seen: Math.floor((Date.now() - sessionData.metadata.firstSeen) / (24 * 60 * 60 * 1000)),
      tracking_consent: sessionData.preferences.trackingConsent,
      personalization_enabled: sessionData.preferences.personalizationEnabled
    };

    const journeyStage: 'early' | 'mid' | 'late' = sessionData.metadata.journeyStage ?? 'early';

    // Decide the full storefront module set through the Optimizely FX seam.
    const decisions = await this.connectors.decisions.decideAll(
      CATALOG_FLAG_KEYS,
      sessionData.userId,
      sessionData.segments,
      userAttributes
    );

    // Flat views derived from decisions (back-compat with the existing route response shape).
    const featureVariables: Record<string, any> = {};
    const featureFlags: Record<string, boolean> = {};
    const experiments: Record<string, string> = {};
    for (const [flagKey, decision] of Object.entries(decisions)) {
      featureVariables[flagKey] = decision.variables;
      featureFlags[flagKey] = decision.enabled;
      if (decision.variationKey) experiments[flagKey] = decision.variationKey;
    }

    // Catalog-aware recommendations + personalized sort for this session.
    const anchorLine =
      typeof sessionData.attributes.viewed_product_line === 'string'
        ? sessionData.attributes.viewed_product_line
        : undefined;
    const recommendations = this.catalogService.getRecommendations(
      { line: anchorLine },
      sessionData.segments,
      8
    );
    const sortOrder = this.catalogService
      .sortForSegments(null, sessionData.segments, sessionData.attributes)
      .slice(0, 24)
      .map((p) => p.id);

    // Enhanced feature variables (unchanged — driven by FeatureVariableManager).
    const enhancedFeatureVariables = await this.featureVariableManager.getSessionFeatureVariables(sessionData);

    // Legacy cookie updates for backward compatibility.
    const cookieUpdates = this.generateCookieUpdates(sessionData.segments, attributes, journeyStage);

    // Enhanced secure cookies via SessionManager.
    const sessionCookies = this.sessionManager.generateSessionCookies(sessionData, sessionId);
    const cookieHeaders = this.sessionManager.createCookieHeaders(sessionCookies);

    return {
      decisions,
      featureFlags,
      experiments,
      featureVariables,
      enhancedFeatureVariables,
      cookieUpdates,
      cookieHeaders,
      segments: sessionData.segments,
      recommendations,
      sortOrder,
      journeyStage,
      sessionData
    };
  }

  private generateCookieUpdates(
    segments: string[],
    attributes: Record<string, any>,
    journeyStage: 'early' | 'mid' | 'late'
  ): Record<string, string> {
    return {
      'opt_segments': segments.join(','),
      'opt_last_update': Date.now().toString(),
      'opt_product_views': (attributes.product_views ?? 0).toString(),
      'opt_cart_adds': (attributes.cart_adds ?? 0).toString(),
      'opt_journey_stage': journeyStage,
      'opt_engagement_score': calculateEngagementScore(attributes).toString()
    };
  }

  private async broadcastUpdate(update: PersonalizationUpdate): Promise<void> {
    try {
      const id = this.env.PERSONALIZATION_WEBSOCKET.idFromName(update.userId);
      const websocketObject = this.env.PERSONALIZATION_WEBSOCKET.get(id);

      await websocketObject.fetch(new Request('http://fake/broadcast', {
        method: 'POST',
        body: JSON.stringify(update),
        headers: { 'Content-Type': 'application/json' }
      }));
    } catch (error) {
      console.error('Error broadcasting update:', error);
    }
  }

  // Get user segments for external API calls
  async getUserSegments(userId: string): Promise<string[]> {
    await this.ensureSeeded();

    // Prefer the live session context if one exists, so segments reflect accrued signals.
    const sessionData = await this.sessionManager.getSessionByUserId(userId);
    const attributes = sessionData?.attributes ?? {};
    const segments = sessionData?.segments ?? [];
    const ctx = this.buildQualificationContext(
      userId,
      sessionData?.anonymousId,
      attributes,
      segments
    );
    ctx.attributes.journey_stage = deriveStage(ctx);
    return this.connectors.segments.fetchQualifiedSegments(userId, ctx);
  }

  // Manual segment assignment (operator/admin path) — adds a segment to the profile and broadcasts.
  async assignSegment(userId: string, segment: string, source: string = 'manual'): Promise<void> {
    const profile = await this.getUserProfile(userId);

    if (!profile.segments.includes(segment)) {
      profile.segments.push(segment);
      profile.lastUpdated = Date.now();
      await this.saveUserProfile(profile);

      // Mirror onto the live session if present, so subsequent decisions see it.
      const sessionData = await this.sessionManager.getSessionByUserId(userId);
      if (sessionData) {
        const merged = Array.from(new Set([...sessionData.segments, segment]));
        await this.sessionManager.updateUserSegments(
          await this.sessionIdForUser(userId),
          merged,
          sessionData.metadata.engagementScore
        );
      }

      // Broadcast update
      const update: PersonalizationUpdate = {
        type: 'segment_update',
        userId,
        data: {
          segments: profile.segments,
          timestamp: Date.now(),
          source
        }
      };

      await this.broadcastUpdate(update);
    }
  }

  /** Resolve the active sessionId for a user (used by manual segment assignment). */
  private async sessionIdForUser(userId: string): Promise<string> {
    const sid = await this.env.SESSIONS.get(`user:${userId}`);
    return sid ?? this.sessionManager.generateSessionId();
  }

  // Session Management Methods for API integration

  /**
   * Create or get session from cookie header
   */
  async getOrCreateSessionFromCookies(cookieHeader: string | null, userId: string): Promise<{
    sessionId: string;
    sessionData: SessionData;
    isNewSession: boolean;
  }> {
    const cookies = this.sessionManager.parseSessionCookies(cookieHeader);
    let sessionId = cookies.sessionId;
    let sessionData: SessionData | null = null;
    let isNewSession = false;

    // Try to get existing session
    if (sessionId) {
      sessionData = await this.sessionManager.getSession(sessionId);
    }

    // Fallback: resolve by stable userId (anon vuid) when the cookie is absent/blocked.
    if (!sessionData) {
      const sid = await this.sessionManager.resolveSessionIdByUserId(userId);
      if (sid) {
        const existing = await this.sessionManager.getSession(sid);
        if (existing) {
          sessionId = sid;
          sessionData = existing;
        }
      }
    }

    // If no valid session, create new one
    if (!sessionData) {
      sessionId = this.sessionManager.generateSessionId();
      isNewSession = true;

      // Get user profile for initial session creation
      const userProfile = await this.getUserProfile(userId);
      sessionData = await this.sessionManager.createOrUpdateSession(sessionId, userId, {
        anonymousId: cookies.anonymousId,
        segments: cookies.segments ? cookies.segments.split(',').filter(Boolean) : userProfile.segments,
        attributes: userProfile.attributes,
        metadata: {
          firstSeen: userProfile.metadata.firstSeen,
          lastSeen: Date.now(),
          sessionCount: userProfile.metadata.sessionCount,
          engagementScore: parseInt(cookies.engagementScore || '0') || calculateEngagementScore(userProfile.attributes),
          lastSegmentUpdate: parseInt(cookies.lastUpdate || '0') || userProfile.lastUpdated
        },
        preferences: {
          trackingConsent: cookies.trackingConsent === 'true',
          personalizationEnabled: cookies.personalizationEnabled === 'true',
          cookieConsent: true
        }
      });
    }

    return {
      sessionId: sessionId!,
      sessionData,
      isNewSession
    };
  }

  /**
   * Get personalization configuration for current session
   */
  async getSessionPersonalizationConfig(sessionId: string): Promise<PersonalizationConfig | null> {
    await this.ensureSeeded();

    const sessionData = await this.sessionManager.getSession(sessionId);
    if (!sessionData) {
      return null;
    }

    return this.getPersonalizationConfig(sessionData, sessionId);
  }

  /**
   * Update session preferences
   */
  async updateSessionPreferences(
    sessionId: string,
    preferences: Partial<SessionData['preferences']>
  ): Promise<SessionData | null> {
    return this.sessionManager.updateUserPreferences(sessionId, preferences);
  }

  /**
   * Get session analytics data
   */
  async getSessionAnalytics(sessionId: string): Promise<{
    sessionDuration: number;
    pageViews: number;
    engagementScore: number;
    segmentHistory: string[];
  } | null> {
    return this.sessionManager.getSessionAnalytics(sessionId);
  }

  /**
   * Process action event with session ID from request
   */
  async processActionEventWithSession(
    event: ActionEvent,
    cookieHeader: string | null
  ): Promise<{
    update: PersonalizationUpdate | null;
    sessionId: string;
    cookieHeaders: string[];
  }> {
    const { sessionId } = await this.getOrCreateSessionFromCookies(
      cookieHeader,
      event.userId
    );

    const update = await this.processActionEvent(event, sessionId);

    // Get updated session for cookies
    const updatedSession = await this.sessionManager.getSession(sessionId);
    const cookies = updatedSession ?
      this.sessionManager.generateSessionCookies(updatedSession, sessionId) :
      [];
    const cookieHeaders = this.sessionManager.createCookieHeaders(cookies);

    return {
      update,
      sessionId,
      cookieHeaders
    };
  }

  // Enhanced Feature Variable Management Methods

  /**
   * Get feature variables for a user with enhanced functionality
   */
  async getEnhancedFeatureVariables(
    userId: string,
    userAttributes?: Record<string, any>
  ): Promise<Record<string, FeatureVariableResult>> {
    // Get session data to create enhanced attributes if not provided
    const sessionData = await this.sessionManager.getSessionByUserId(userId);

    if (sessionData && !userAttributes) {
      return this.featureVariableManager.getSessionFeatureVariables(sessionData);
    }

    return this.featureVariableManager.getFeatureVariables(
      userId,
      userAttributes || {}
    );
  }

  /**
   * Set feature variable override for testing/personalization
   */
  async setFeatureVariableOverride(
    userId: string,
    featureKey: string,
    variableKey: string,
    value: any,
    options?: {
      expiresAt?: number;
      reason?: string;
    }
  ): Promise<void> {
    await this.featureVariableManager.setUserOverride({
      userId,
      featureKey,
      variableKey,
      value,
      expiresAt: options?.expiresAt,
      reason: options?.reason
    });

    // Clear any cached personalization configs for this user
    const sessionData = await this.sessionManager.getSessionByUserId(userId);
    if (sessionData) {
      // Trigger a personalization update to reflect the override
      const update: PersonalizationUpdate = {
        type: 'feature_flag_update',
        userId,
        data: {
          featureKey,
          variableKey,
          value,
          source: 'override',
          timestamp: Date.now()
        } as PersonalizationUpdate['data']
      };

      await this.broadcastUpdate(update);
    }
  }

  /**
   * Remove feature variable override
   */
  async removeFeatureVariableOverride(
    userId: string,
    featureKey: string,
    variableKey: string
  ): Promise<void> {
    await this.featureVariableManager.removeUserOverride(userId, featureKey, variableKey);

    // Trigger update to reflect removal
    const sessionData = await this.sessionManager.getSessionByUserId(userId);
    if (sessionData) {
      const update: PersonalizationUpdate = {
        type: 'feature_flag_update',
        userId,
        data: {
          featureKey,
          variableKey,
          source: 'override_removed',
          timestamp: Date.now()
        } as PersonalizationUpdate['data']
      };

      await this.broadcastUpdate(update);
    }
  }

  /**
   * Get all feature variable overrides for a user
   */
  async getUserFeatureVariableOverrides(userId: string) {
    return this.featureVariableManager.getUserOverrides(userId);
  }

  /**
   * Get feature variable configurations for demo/testing
   */
  getFeatureVariableConfigurations() {
    return this.featureVariableManager.getFeatureConfigurations();
  }

  /**
   * Create demo feature variable overrides for testing
   */
  async createDemoFeatureVariableOverrides(userId: string): Promise<void> {
    await this.featureVariableManager.createDemoOverrides(userId);

    // Broadcast update about demo overrides
    const update: PersonalizationUpdate = {
      type: 'feature_flag_update',
      userId,
      data: {
        source: 'demo_overrides_created',
        timestamp: Date.now()
      }
    };

    await this.broadcastUpdate(update);
  }

  /**
   * Get feature variable analytics
   */
  async getFeatureVariableAnalytics() {
    return this.featureVariableManager.getFeatureVariableAnalytics();
  }
}
