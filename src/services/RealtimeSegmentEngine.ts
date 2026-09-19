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

import { actionOf, resolvedContentTouches, isContentAction } from '@/reflex/contentTelemetry';
import { bufferedEventAllowed, bufferedInterest, validBufferedAction } from '@/reflex/bufferedAction';
import { shopperObjectName } from '@/tenancy/objects';
import { DEFAULT_TENANT, TenantKV, type KVLike, type TenantId } from '@/tenancy/tenant';
import { fanInRegionTrend } from '@/reflex/regionTrend';
import type { ReflexConfig } from '@/reflex/core';
import { projectVisit, validEntry, visitBucket, type ChannelSignals } from '@/services/visit';
import type { Env } from '@/types/env';
import { assertOwnerScope, ownerRelay, retainOwnerWork, sessionAuthorityKV, currentOwnerConsent, requireConsentPurpose } from '@/identity/sessionAuthority';
import { externalRetentionBirths, retentionBirth } from '@/retention';
import { pinProfileRetention } from '@/identity/sessionAuthority';
import { assertSessionTarget, SessionAccessError, type SessionCapability } from '@/identity/sessionCapability';
import { SessionManager, type SessionData } from './SessionManager';
import { enrichmentInputs } from '@/identity/profileEnrichment';
import { consentOf, consentFromCookies, intersectConsent, refusalHints, personalizes, withConsent, type Consent } from '@/content/consent';
import { FeatureVariableManager, type FeatureVariableResult } from './FeatureVariableManager';
import { priceBandOf, type CatalogService, type Product } from './CatalogService';
import { advanceVisitJourney, deriveStage, journeyCountersNow, journeyStageFrom, journeyThresholdsInForce } from './JourneyStage';
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
  apply as applyReflex,
  attributesFrom as reflexAttributes,
  extractTouches,
  touchesForEvent,
  snapshot as reflexSnapshot,
  tick as tickReflex,
  type ReflexResult,
} from '@/reflex/core';
import {
  DEFAULT_GENERATOR_CONFIG,
  generateAffinityAudiences,
  regenerateCatalogAudiences,
} from '@/reflex/audienceGenerator';
import { projectOdpState, projectedOdpSegments, odpEnabled, refreshOdpSeedIfDue, updateOdpRing } from '@/services/odpLoop';
import {
  DEFAULT_SURFACE,
  audgenMarkerFor,
  audienceKeyPrefixFor,
  tenantAudienceKeyPrefix,
  resolveTenantCatalog,
  reflexConfigFor,
  resolveReflexConfig,
  resolveTenantReflexConfig,
  resolveSurface,
  type DemoSurface,
} from '@/demos/registry';

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
    | 'wishlist_add'
    // first-class since CW3; the SDK also sends them as custom + data.event
    | 'purchase'
    | 'content_impression'
    | 'content_click'
    | 'content_dwell'
    | 'video_complete';
  userId: string;
  anonymousId?: string;
  data: Record<string, any>;
  timestamp: number;
  eventId?: string;
  processing?: 'buffered';
  browsingSessionId?: string | null;
  source: string;
  /** Demo surface this event belongs to. Absent ⇒ resolved from `source`, and
      absent there too ⇒ the default surface (coach). See @/demos/registry. */
  surface?: string;
  /**
   * How the shopper arrived: utm tags and referrer, captured once per page load
   * by the client. Only consulted when an event opens a NEW visit, because entry
   * is a property of the visit rather than of every event inside it. Absent on
   * every pre-existing client; omitted entry remains unknown.
   */
  entry?: ChannelSignals;
  /** Coarse request geolocation, set by the route from request.cf. Population aggregates only (CW6). */
  geo?: { country?: string | null; regionCode?: string | null };
}

export interface UserProfile {
  externalRetention?: SessionData['externalRetention'];
  retention?: SessionData['retention'];
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
  catalog: CatalogService | null
): void {
  const data = event.data ?? {};
  // The retail action: explicit data.action wins, else the event type.
  const action = actionOf(event);

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const inc = (key: string, by = 1) => {
    attributes[key] = num(attributes[key]) + by;
  };

  // Resolve a product (if referenced) so we can enrich line / price band from the catalog.
  const productId: string | undefined = data.productId ?? data.product_id ?? data.sku;
  const product = productId ? catalog?.getProduct(productId) : undefined;
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
 *
 * Multi-surface (PH build spec §3): each surface owns its OWN version marker and
 * its own archive scope, so two demos regenerating over one store cannot archive
 * each other's audiences on alternating passes. The Coach launch seeds belong to
 * the default surface and are seeded only on its pass.
 */
export async function ensureAudiencesSeeded(
  env: Env,
  catalogService: CatalogService,
  surface: DemoSurface = DEFAULT_SURFACE,
  tenant: TenantId = DEFAULT_TENANT
): Promise<void> {
  // Demo catalogs cannot define another tenant's audiences. Customer-owned
  // generation remains separate; do not even read its store or demo config here.
  if (tenant !== DEFAULT_TENANT || env.DEPLOYMENT_PROFILE !== 'demo') return;
  const store = new KvAudienceStore(env, tenant);
  if (surface === DEFAULT_SURFACE) await store.seed(SEED_AUDIENCES);
  const generated = generateAffinityAudiences(
    catalogService.getAllProducts() as unknown as Array<Record<string, unknown>>,
    await resolveReflexConfig(env, surface),
    surface === DEFAULT_SURFACE
      ? DEFAULT_GENERATOR_CONFIG
      : { ...DEFAULT_GENERATOR_CONFIG, surface, keyPrefix: audienceKeyPrefixFor(surface) }
  );
  const setHash = generated.map((d) => `${d.key}:${d.generatorHash}`).join('|');
  const MARKER = audgenMarkerFor(surface);
  if ((await new TenantKV(env.CACHE as unknown as KVLike, tenant).get(MARKER)) === setHash) return;
  const s = await regenerateCatalogAudiences(store, generated, surface);
  await new TenantKV(env.CACHE as unknown as KVLike, tenant).put(MARKER, setHash);
  console.log(
    `[reflex] catalog audiences regenerated: +${s.published.length} ~${s.updated.length} −${s.archived.length}` +
      ` (skipped: ${s.skippedHumanEdited.length} human-edited, ${s.skippedPinned.length} pinned)`
  );
}

export class RealtimeSegmentEngine {
  readonly tenant: TenantId;
  private readonly cache: KVLike;
  private readonly sessions: KVLike;
  /**
   * CW6: how background work outlives the response. The route hands in its
   * execution context per call; without one (tests), a promise is simply let go.
   */
  private keepAlive?: (p: Promise<unknown>) => void;

  private env: Env;
  private principal?: SessionCapability;
  private connectors: Connectors;
  private sessionManager: SessionManager;
  private featureVariableManager: FeatureVariableManager;
  /** Audiences are seeded once per engine instance PER SURFACE (idempotent on the
      store regardless). */
  private seeded = new Set<DemoSurface>();

  constructor(
    env: Env,
    connectors?: Connectors,
    options?: { domain?: string; secure?: boolean; tenant?: TenantId; principal?: SessionCapability }
  ) {
    this.env = env;
    this.principal = options?.principal;
    if (this.principal) assertOwnerScope(env, this.principal);
    // The brand this engine decides for. Flows straight through to SessionManager
    // via `options`; the audience store and the socket name need it explicitly.
    this.tenant = options?.tenant ?? DEFAULT_TENANT;
    // Default connectors share this engine's tenant; custom connectors remain
    // explicitly owned by the caller supplying them.
    this.connectors = connectors ?? getConnectors(env, this.tenant);
    this.sessionManager = new SessionManager(env, options);
    this.featureVariableManager = new FeatureVariableManager(env, this.tenant);
    // The two raw stores this class still touched directly, now scoped like
    // everything that goes through SessionManager and the audience store.
    this.cache = new TenantKV(env.CACHE as unknown as KVLike, this.tenant);
    this.sessions = new TenantKV(sessionAuthorityKV(env, this.principal), this.tenant);
  }

  /**
   * Idempotently load demo audiences for the default tenant before qualification.
   * Other tenants retain only their own published records. Delegates to the
   * exported ensureAudiencesSeeded (shared with the P2 DO).
   */
  private async ensureSeeded(surface: DemoSurface = DEFAULT_SURFACE): Promise<void> {
    if (this.tenant !== DEFAULT_TENANT || this.env.DEPLOYMENT_PROFILE !== 'demo') return;
    if (this.seeded.has(surface)) return;
    try {
      const catalog = await this.catalogFor(surface);
      if (!catalog) return;
      await ensureAudiencesSeeded(this.env, catalog, surface, this.tenant);
      this.seeded.add(surface);
    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      console.error('Error seeding audiences');
    }
  }

  /** The surface an event belongs to — explicit field, else `source`, else coach. */
  private surfaceOf(event: ActionEvent): DemoSurface {
    return resolveSurface({
      source: event.source,
      surface: event.surface ?? (event.data as Record<string, unknown> | undefined)?.surface as string | undefined,
    });
  }

  /** Customers have no bundled product catalog; default demos share one per isolate. */
  private async catalogFor(surface: DemoSurface): Promise<CatalogService | null> {
    return resolveTenantCatalog(this.tenant, surface);
  }

  async processActionEvent(event: ActionEvent, sessionId?: string): Promise<PersonalizationUpdate | null> {
    return (await this.processAction(event, sessionId)).update;
  }

  private async processAction(event: ActionEvent, sessionId?: string, cookieHeader?: string | null): Promise<{
    update: PersonalizationUpdate | null; sessionId: string; sessionData: SessionData; consent: Consent; interestApplied?: boolean; dropped?: string;
  }> {
    if (!validEntry(event.entry)) throw new SessionAccessError();
    if (this.principal) {
      assertSessionTarget(this.principal, event.userId, sessionId);
      sessionId = this.principal.sessionId;
    }
    if (event.processing === 'buffered') return this.processBufferedAction(event, cookieHeader);
    try {
      const currentSessionId = sessionId || this.sessionManager.generateSessionId();
      const stored = this.principal
        ? await this.sessionManager.readRaw(currentSessionId, true)
        : await this.sessionManager.getSession(currentSessionId);
      const consent = intersectConsent(await currentOwnerConsent() ?? consentOf(stored), consentFromCookies(cookieHeader), refusalHints(event.data?.consent));
      const now = Date.now();
      // Cold owned actions cannot import a cookie/profile mirror. Resolve before
      // any behavioral creation; the one necessary refusal record is separate.
      const profile = !stored && !this.principal ? await this.getUserProfile(event.userId) : null;
      let sessionData: SessionData = stored ?? {
        userId: event.userId, anonymousId: event.anonymousId,
        segments: profile?.segments ?? ['new_user'], attributes: profile?.attributes ?? {},
        metadata: { firstSeen: profile?.metadata.firstSeen ?? now, lastSeen: now, sessionCount: 0, engagementScore: 0, lastSegmentUpdate: now },
        preferences: { trackingConsent: consent.tracking, personalizationEnabled: consent.personalization, cookieConsent: true },
      };
      if (!consent.tracking || !consent.personalization) {
        if (this.principal) await this.sessionManager.restrictConsent(currentSessionId, consent, { sessionId: currentSessionId, data: stored });
        else if (!stored || consent.tracking !== stored.preferences.trackingConsent || consent.personalization !== stored.preferences.personalizationEnabled) {
          await this.sessionManager.createOrUpdateSession(currentSessionId, event.userId, { preferences: { ...sessionData.preferences, trackingConsent: consent.tracking, personalizationEnabled: consent.personalization } });
        }
        sessionData = { ...sessionData, preferences: { ...sessionData.preferences, trackingConsent: consent.tracking, personalizationEnabled: consent.personalization } };
      }
      const answer = (update: PersonalizationUpdate | null) => ({ update, sessionId: currentSessionId, sessionData, consent });
      if (!consent.tracking) return answer(null);
      requireConsentPurpose(consent, 'tracking');
      if (personalizes(consent)) requireConsentPurpose(consent, 'personalization');
      if (!stored) {
        const born = Date.now();
        sessionData.retention = retentionBirth(this.env, this.tenant, 'profile', born, born);
        sessionData.externalRetention = externalRetentionBirths(this.env, this.tenant, born, born);
      }
      pinProfileRetention(this.env, sessionData, this.tenant);
      // Reuse this request's validated owned snapshot, including a newly stored
      // refusal. This is not transactional authority across concurrent requests.
      const ownedSnapshot = this.principal ? { sessionId: currentSessionId, data: stored ? sessionData : null } : undefined;
      // Demo hints select a catalog only inside the default tenant. Customer
      // event attributes remain governed by the tenant's authored Reflex config.
      const surface = this.surfaceOf(event);
      const catalogService = await this.catalogFor(surface);
      const reflexConfig = await resolveTenantReflexConfig(this.env, this.tenant, surface);
      const audiencePrefix = tenantAudienceKeyPrefix(this.tenant, surface);
      const reflexOn = (this.env.REFLEX_ENABLED ?? 'true') !== 'false';
      const contentEventTouches = reflexOn && isContentAction(actionOf(event))
        ? await resolvedContentTouches(this.env, this.tenant, event.data ?? {}, reflexConfig) : null;
      await this.ensureSeeded(surface);

      // 2. Apply this event's retail signals to a fresh attribute snapshot.
      const newAttributes = { ...sessionData.attributes };
      applyEventToAttributes(newAttributes, event, catalogService);
      const newEngagementScore = calculateEngagementScore(newAttributes);

      // 2.1 W16 C4: the journey of THIS VISIT, counted beside the cumulative
      // attributes above. The boundary is read from the STORED lastSeen for the
      // same reason the visit number is (SessionManager: an incoming lastSeen
      // would close the gap it is measured against), and the purchase that
      // counts in its own decision closes the journey for the next one.
      const newJourney = advanceVisitJourney(sessionData.journey, stored?.metadata.lastSeen, now, event);
      // R29: the word the engine REPORTS, from the tenant's published thresholds.
      const journeyThresholds = journeyThresholdsInForce(reflexConfig);
      const journeyWord = journeyStageFrom(newJourney.counters, journeyThresholds);
      // What the previous derivation reported, so a stage change is a trigger
      // exactly as a segment change is.
      const priorWord = journeyStageFrom(
        journeyCountersNow(sessionData.journey, stored?.metadata.lastSeen, now), journeyThresholds);

      // 2.5 Edge Affinity Reflex (doc 16): decayed per-dimension affinity via the
      // pure core. State rides the session in P0 (relocates into the DO in P2).
      // The ENGINE clock is authoritative — client timestamps are advisory only.
      const nowMs = Date.now();
      let reflex: ReflexResult | null = null;
      if (reflexOn) {
        const data = event.data ?? {};
        const pid = data.productId ?? data.product_id ?? data.sku;
        const product = pid ? catalogService?.getProduct(String(pid)) : undefined;
        const action = actionOf(event);
        // Reuse precisely the personal scorer's touches for population counts.
        const touches = contentEventTouches ?? touchesForEvent(data as Record<string, unknown>, product as unknown as Record<string, unknown> | undefined, reflexConfig);
        reflex = applyReflex(
          sessionData.reflex,
          {
            action,
            // A held product's attributes, or, where the scope allows it, the
            // event's own (CW24): a customer's site scores against their catalog.
            touches,
          },
          nowMs,
          reflexConfig
        );
        // CW6: the same touches, fanned into the shopper's region as a population count.
        // Unsigned legacy traffic and the default tenant's BrightHour demo have
        // no tenant population reader. A real BrightHour tenant owns its counts.
        if (this.principal && !(this.principal.tenant === DEFAULT_TENANT && surface !== DEFAULT_SURFACE)) {
          (this.keepAlive ?? (this.principal ? retainOwnerWork : (p: Promise<unknown>) => { void p; }))(fanInRegionTrend(this.env, {
            tenant: this.principal.tenant, geo: event.geo, now: nowMs, touches,
            w: reflexConfig.weights[action] ?? 0,
          }));
        }
      }

      if (!personalizes(consent)) {
        sessionData = await this.sessionManager.createOrUpdateSession(currentSessionId, event.userId, {
          ...sessionData, attributes: newAttributes, surface, journey: newJourney,
          reflex: reflex ? reflex.state : sessionData.reflex,
          metadata: { ...sessionData.metadata, engagementScore: newEngagementScore },
        }, event.entry, undefined, ownedSnapshot);
        return answer(null);
      }

      // Reject obsolete provider contributions before journey/local qualification.
      const odp = await projectOdpState(this.env, this.tenant, sessionData);
      // 3. Qualify segments through the ODP seam against the live context.
      const ctx = this.buildQualificationContext(
        event.userId,
        event.anonymousId ?? sessionData.anonymousId,
        newAttributes,
        sessionData.profileEnrichment === undefined ? projectedOdpSegments(sessionData.segments, sessionData, odp) : []
      );
      // Demo surface filtering separates the two demos inside the default store.
      // Other tenants qualify their own authored audiences regardless of demo hints.
      if (this.tenant === DEFAULT_TENANT) ctx.surface = surface;
      const journeyStage = deriveStage(ctx);
      ctx.attributes.journey_stage = journeyStage; // stage is itself an audience attribute
      // Reflex scores are computed FRESH into the context (never persisted — they
      // decay by construction), so store-published affinity audiences can gte them.
      if (reflex) Object.assign(ctx.attributes, reflexAttributes(reflex.state, nowMs, reflexConfig));
      const external = enrichmentInputs(sessionData.profileEnrichment);
      Object.assign(ctx.attributes, external.attributes);
      const localSegments = await this.connectors.segments.fetchQualifiedSegments(event.userId, ctx);
      // ODP loop (doc 16 §8): seed/refresh the session's LIVE ODP-qualified audiences.
      // Additive + hard-capped (1.5s in fetchOdpAudiences) — ODP can only ever ADD;
      // slow or down degrades to exactly the pre-ODP behavior.
      let { odpSeed, odpSeedAt, odpRecentEvents: odpRing } = odp;
      if (odpEnabled(this.env, this.tenant)) {
        // Ring maintenance + seed read policy live in odpLoop (updateOdpRing /
        // refreshOdpSeedIfDue) — shared verbatim with the ShopperReflex DO (P2)
        // so the two hosts can never drift.
        odpRing = updateOdpRing(odpRing, event, nowMs, this.tenant, this.env);
        const membershipChanged = !!reflex && (reflex.changes.entered.length > 0 || reflex.changes.exited.length > 0);
        ({ seed: odpSeed, seedAt: odpSeedAt } = await refreshOdpSeedIfDue(
          this.env,
          this.tenant,
          // event.userId is the stable first-party visitor id the client mints
          // and persists; the session id is only the fallback for a client that
          // does not send one.
          { visitorId: event.userId, sessionId: currentSessionId },
          odpRing,
          { seed: odpSeed, seedAt: odpSeedAt },
          nowMs,
          membershipChanged
        ));
      }
      // Union: local evaluation ∪ live reflex memberships ∪ ODP-confirmed seed —
      // any enter/exit drives the same change-detect → persist → decide → push loop.
      // The reflex core names memberships from the catalog alone; the surface
      // namespace is applied HERE so they match the generated audience keys
      // (prefix '' for coach ⇒ the same array, untouched).
      const reflexAudiences = reflex
        ? audiencePrefix
          ? reflex.state.audiences.map((k) => audiencePrefix + k)
          : reflex.state.audiences
        : [];
      const newSegments = Array.from(new Set([
        ...localSegments,
        ...reflexAudiences,
        ...odpSeed,
        ...external.audiences,
      ]));

      // 4. Detect what actually changed (segments OR journey stage) — either is a trigger.
      const segmentsChanged = hasSegmentChanges(sessionData.segments, newSegments);
      // Either grammar moving is a personalization trigger: the stored audience
      // attribute, or the reported journey word the SDK paints (W16 C4).
      const stageChanged = sessionData.metadata.journeyStage !== journeyStage || priorWord !== journeyWord;

      if (!segmentsChanged && !stageChanged) {
        // No personalization change — persist the accrued attributes/activity and stop.
        sessionData = await this.sessionManager.createOrUpdateSession(currentSessionId, event.userId, {
          ...sessionData,
          attributes: newAttributes,
          surface,
          journey: newJourney,
          reflex: reflex ? reflex.state : sessionData.reflex,
          odpContext: odp.odpContext,
          odpSeed,
          odpSeedAt,
          odpRecentEvents: odpRing,
          metadata: {
            ...sessionData.metadata,
            lastSeen: Date.now(),
            engagementScore: newEngagementScore,
            journeyStage
          }
        }, event.entry, undefined, ownedSnapshot);
        return answer(null);
      }

      // 5. Persist new attributes, segments, engagement score, and journey stage.
      sessionData = await this.sessionManager.createOrUpdateSession(currentSessionId, event.userId, {
        ...sessionData,
        attributes: newAttributes,
        surface,
        journey: newJourney,
        reflex: reflex ? reflex.state : sessionData.reflex,
        odpContext: odp.odpContext,
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
      }, event.entry, undefined, ownedSnapshot);

      // 6. Decide the storefront modules through the Optimizely FX seam.
      const personalizationConfig = await this.getPersonalizationConfig(sessionData, currentSessionId, reflexConfig);

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
          // R29: what the SDK paints is the shared vocabulary; the stored
          // `metadata.journeyStage` above keeps the persisted grammar.
          journeyStage: journeyWord,
          // Live affinity payload for the Affinity Instrument (dims use original
          // catalog value names; changed = this event's explain records).
          affinity: reflex
            ? { ...reflexSnapshot(reflex.state, nowMs, reflexConfig), changed: reflex.changes.explain, odpConfirmed: odpSeed }
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

      return answer(update);

    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      console.error('Error processing action event');
      throw error;
    }
  }

  async getUserProfile(userId: string): Promise<UserProfile> {
    if (this.principal) {
      assertSessionTarget(this.principal, userId);
      const data = await this.sessionManager.getSession(this.principal.sessionId);
      if (data) pinProfileRetention(this.env, data, this.tenant);
      return {
        retention: data?.retention,
        externalRetention: data?.externalRetention,
        userId, segments: data ? await this.enrichedSegments(data) : [], attributes: data?.attributes ?? {}, events: [], lastUpdated: data?.metadata.lastSegmentUpdate ?? Date.now(),
        metadata: { firstSeen: data?.metadata.firstSeen ?? Date.now(), lastSeen: data?.metadata.lastSeen ?? Date.now(), sessionCount: data?.metadata.sessionCount ?? 0, emailOpens: 0, formSubmissions: 0, pageViews: 0 },
      };
    }
    const cacheKey = `profile:${userId}`;
    const cached = await this.cache.get(cacheKey, 'json') as UserProfile;

    if (cached) {
      pinProfileRetention(this.env, cached, this.tenant);
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
    const retention = pinProfileRetention(this.env, profile, this.tenant);
    if (this.principal) {
      assertSessionTarget(this.principal, profile.userId);
      await this.sessionManager.getSession(this.principal.sessionId);
    }
    const cacheKey = `profile:${profile.userId}`;
    await this.cache.put(cacheKey, JSON.stringify(profile), {
      // This derived copy includes external contributions and original policy
      // metadata; it cannot outlive any of those source dependencies.
      expiration: Math.floor(Math.min(retention.expiresAt, ...Object.values(profile.externalRetention ?? {}).map(stamp => stamp!.expiresAt), Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000)
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

  private async getPersonalizationConfig(sessionData: SessionData, sessionId: string, selectedConfig?: ReflexConfig): Promise<PersonalizationConfig> {
    if (this.principal) assertSessionTarget(this.principal, sessionData.userId, sessionId);
    if (this.principal && !personalizes(consentOf(sessionData))) return {
      decisions: {}, featureFlags: {}, experiments: {}, featureVariables: {}, enhancedFeatureVariables: {},
      cookieUpdates: {}, cookieHeaders: [], segments: [], recommendations: [], sortOrder: [], journeyStage: 'early', sessionData,
    };
    if (this.principal) requireConsentPurpose(consentOf(sessionData), 'personalization');
    // The session remembers which demo it belongs to (absent ⇒ coach), so the
    // config path resolves the same catalog/config the event path scored with.
    const surface = resolveSurface({ surface: sessionData.surface });
    const cfg = selectedConfig ?? await resolveTenantReflexConfig(this.env, this.tenant, surface);
    const catalogService = await this.catalogFor(surface);
    if (this.principal) assertSessionTarget(this.principal, sessionData.userId, sessionId);
    const attributes = { ...RETAIL_SIGNAL_DEFAULTS, ...sessionData.attributes };
    // Live affinity reads for the decision layer (doc 16 §10 choreography):
    // computed FRESH from the reflex state — they decay by construction, so they
    // are never persisted; the decision sees the score as of THIS moment.
    if ((this.env.REFLEX_ENABLED ?? 'true') !== 'false' && sessionData.reflex) {
      if (this.principal) assertSessionTarget(this.principal, sessionData.userId, sessionId);
      Object.assign(
        attributes,
        reflexAttributes(sessionData.reflex, Date.now(), cfg)
      );
    }

    const visit = projectVisit(sessionData.metadata, sessionData.metadata.lastSeen, Date.now());
    const visitNumber = visit.visitNumber;
    const userAttributes = {
      segments: sessionData.segments,
      ...attributes,
      engagement_score: sessionData.metadata.engagementScore,
      // session_count is the INTERACTION count and always has been. It is kept
      // because it is persisted and read elsewhere; it is not the visit number
      // and must never be used as one.
      session_count: sessionData.metadata.sessionCount,
      // The two dimensions Mandeep named, and levels 1 and 2 of doc 22's pooling
      // ladder. visit_bucket is the cut the learning statistics pool on; the raw
      // number rides along for anything that wants finer grain.
      visit_number: visitNumber,
      visit_bucket: visitNumber === null ? 'unknown' : visitBucket(visitNumber),
      entry_channel: visit.entryChannel ?? 'unknown',
      journey_stage: sessionData.metadata.journeyStage,
      days_since_first_seen: Math.floor((Date.now() - sessionData.metadata.firstSeen) / (24 * 60 * 60 * 1000)),
      tracking_consent: sessionData.preferences.trackingConsent,
      personalization_enabled: sessionData.preferences.personalizationEnabled
    };

    const journeyStage: 'early' | 'mid' | 'late' = sessionData.metadata.journeyStage ?? 'early';

    // Decide the full storefront module set through the Optimizely FX seam.
    if (this.principal) assertSessionTarget(this.principal, sessionData.userId, sessionId);
    const decisions = await this.connectors.decisions.decideAll(
      CATALOG_FLAG_KEYS,
      sessionData.userId,
      sessionData.segments,
      userAttributes
    );
    if (this.principal) assertSessionTarget(this.principal, sessionData.userId, sessionId);

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
    const recommendations = catalogService?.getRecommendations(
      { line: anchorLine },
      sessionData.segments,
      8
    ) ?? [];
    const sortOrder = catalogService
      ?.sortForSegments(null, sessionData.segments, sessionData.attributes)
      .slice(0, 24)
      .map((p) => p.id) ?? [];

    // Enhanced feature variables (unchanged — driven by FeatureVariableManager).
    if (this.principal) assertSessionTarget(this.principal, sessionData.userId, sessionId);
    const enhancedFeatureVariables = await this.featureVariableManager.getSessionFeatureVariables(sessionData);

    // Legacy cookie updates for backward compatibility.
    if (this.principal) assertSessionTarget(this.principal, sessionData.userId, sessionId);
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
    if (this.principal) assertSessionTarget(this.principal, update.userId);
    if (this.principal) { await ownerRelay(this.env, 'broadcast', this.tenant, update.userId, update); return; }
    try {
      const id = this.env.PERSONALIZATION_WEBSOCKET.idFromName(shopperObjectName(this.tenant, update.userId));
      const websocketObject = this.env.PERSONALIZATION_WEBSOCKET.get(id);

      await websocketObject.fetch(new Request('http://fake/broadcast', {
        method: 'POST',
        body: JSON.stringify(update),
        headers: { 'Content-Type': 'application/json' }
      }));
    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      console.error('Error broadcasting update');
    }
  }

  // Get user segments for external API calls
  async getUserSegments(userId: string, cookieHeader?: string | null): Promise<string[]> {
    // Prefer the live session context if one exists, so segments reflect accrued signals.
    if (this.principal) assertSessionTarget(this.principal, userId);
    const owned = this.principal ? await this.sessionManager.readOwnedConsent(this.principal.sessionId, cookieHeader) : undefined;
    if (owned && !personalizes(owned.consent)) return [];
    if (owned) requireConsentPurpose(owned.consent, 'personalization');
    const sessionData = owned ? owned.data : await this.sessionManager.getSessionByUserId(userId);
    if (sessionData && (sessionData.profileEnrichment !== undefined || sessionData.odpSeed !== undefined)) {
      if (!personalizes(consentOf(sessionData))) return [];
      return this.enrichedSegments(sessionData);
    }
    const surface = resolveSurface({ surface: sessionData?.surface });
    await this.ensureSeeded(surface);
    if (this.principal) assertSessionTarget(this.principal, userId);

    const attributes = sessionData?.attributes ?? {};
    const segments = sessionData?.segments ?? [];
    const ctx = this.buildQualificationContext(
      userId,
      sessionData?.anonymousId,
      attributes,
      segments
    );
    if (this.tenant === DEFAULT_TENANT) ctx.surface = surface;
    ctx.attributes.journey_stage = deriveStage(ctx);
    return this.connectors.segments.fetchQualifiedSegments(userId, ctx);
  }

  private async processBufferedAction(event: ActionEvent, cookieHeader?: string | null) {
    const now = Date.now();
    if (!validBufferedAction(event, now)) throw new Error('Invalid buffered action');
    if (!this.principal) throw new SessionAccessError();
    assertSessionTarget(this.principal, event.userId);
    const previous = await this.sessionManager.readBufferedSession();
    const consent = intersectConsent(consentOf(previous), consentFromCookies(cookieHeader), refusalHints(event.data?.consent));
    const preferences = { ...previous.preferences, trackingConsent: consent.tracking, personalizationEnabled: consent.personalization };
    const restricted = preferences.trackingConsent !== previous.preferences.trackingConsent
      || preferences.personalizationEnabled !== previous.preferences.personalizationEnabled;
    const answer = (sessionData: SessionData, interestApplied = false, dropped?: string) => ({ update: null,
      sessionId: this.principal!.sessionId, sessionData, consent, interestApplied, ...(dropped ? { dropped } : {}) });
    if (restricted) await this.sessionManager.restrictConsent(this.principal.sessionId, consent, { sessionId: this.principal.sessionId, data: previous });
    const current = { ...previous, preferences };
    if (!consent.tracking) return answer(current, false, 'tracking_refused');
    requireConsentPurpose(consent, 'tracking');
    if (!await bufferedEventAllowed(this.env, this.tenant, event.userId, event.timestamp)) return answer(current, false, 'erased');
    if (!consent.personalization) return answer(current);
    requireConsentPurpose(consent, 'personalization');
    const interest = await bufferedInterest(this.env, this.tenant, event,
      { ...current, attributes: { ...RETAIL_SIGNAL_DEFAULTS, ...current.attributes } }, this.connectors.segments, now);
    if (!interest.applied) return answer(current);
    await this.sessionManager.writeBufferedSession(current, { preferences, reflex: interest.reflex, segments: interest.segments });
    return answer({ ...current, reflex: interest.reflex, segments: interest.segments }, true);
  }

  /** Read-time qualification avoids stale derived membership after replacement. */
  private async enrichedSegments(data: SessionData, selectedConfig?: ReflexConfig): Promise<string[]> {
    if (!personalizes(consentOf(data))) return [];
    requireConsentPurpose(consentOf(data), 'personalization');
    const external = enrichmentInputs(data.profileEnrichment);
    const surface = resolveSurface({ surface: data.surface });
    const cfg = selectedConfig ?? await resolveTenantReflexConfig(this.env, this.tenant, surface);
    const now = Date.now();
    const currentReflex = (this.env.REFLEX_ENABLED ?? 'true') !== 'false' && data.reflex ? tickReflex(data.reflex, now, cfg).state : undefined;
    const ctx = this.buildQualificationContext(data.userId, data.anonymousId, data.attributes, []);
    if (this.tenant === DEFAULT_TENANT) ctx.surface = surface;
    ctx.attributes.journey_stage = deriveStage(ctx);
    if (currentReflex) Object.assign(ctx.attributes, reflexAttributes(currentReflex, now, cfg));
    Object.assign(ctx.attributes, external.attributes);
    const local = await this.connectors.segments.fetchQualifiedSegments(data.userId, ctx);
    if (this.principal) assertSessionTarget(this.principal, data.userId);
    const prefix = tenantAudienceKeyPrefix(this.tenant, surface);
    const reflex = currentReflex?.audiences ?? [];
    return [...new Set([...(data.profileEnrichment === undefined ? data.segments.filter(s => !data.odpSeed?.includes(s)) : []), ...local, ...reflex.map(key => prefix + key), ...(await projectOdpState(this.env, this.tenant, data)).odpSeed, ...external.audiences])].sort();
  }

  // Manual segment assignment (operator/admin path) — adds a segment to the profile and broadcasts.
  async assignSegment(userId: string, segment: string, source: string = 'manual', cookieHeader?: string | null): Promise<boolean> {
    if (this.principal) {
      assertSessionTarget(this.principal, userId);
      const owned = await this.sessionManager.readOwnedConsent(this.principal.sessionId, cookieHeader);
      if (!personalizes(owned.consent)) return false;
      requireConsentPurpose(owned.consent, 'personalization');
    }
    const profile = await this.getUserProfile(userId);

    if (!profile.segments.includes(segment)) {
      // A signed, explicitly authorized first manual assignment is a new
      // producer. Existing session/cache profiles were validated above and
      // cannot arrive here without their original lifetime.
      if (!profile.retention && this.principal) {
        // A cache-only record is not owner authority, including a stale copy
        // from an earlier grant generation. Never overwrite/adopt it as fresh.
        if (await this.cache.get(`profile:${userId}`) !== null) throw new SessionAccessError();
        const born = Date.now();
        profile.retention = retentionBirth(this.env, this.tenant, 'profile', born, born);
        profile.externalRetention = externalRetentionBirths(this.env, this.tenant, born, born);
        pinProfileRetention(this.env, profile, this.tenant);
        // Commit the first manual producer under the same serialized owner.
        // Later assignments derive CACHE from this original lifetime, not a
        // new birth inferred from the absence of an ordinary live event.
        await this.sessionManager.createOrUpdateSession(this.principal.sessionId, userId,
          { retention: profile.retention, externalRetention: profile.externalRetention, segments: [segment] },
          undefined, undefined, { sessionId: this.principal.sessionId, data: null }, false);
      }
      profile.segments.push(segment);
      profile.lastUpdated = Date.now();
      await this.saveUserProfile(profile);

      // Mirror onto the live session if present, so subsequent decisions see it.
      const sessionData = await this.sessionManager.getSessionByUserId(userId);
      if (sessionData) {
        const merged = Array.from(new Set([...await this.enrichedSegments(sessionData), segment]));
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
    return true;
  }

  /** Resolve the active sessionId for a user (used by manual segment assignment). */
  private async sessionIdForUser(userId: string): Promise<string> {
    if (this.principal) {
      assertSessionTarget(this.principal, userId);
      return this.principal.sessionId;
    }
    const sid = (await this.sessions.get(`user:${userId}`)) as string | null;
    return sid ?? this.sessionManager.generateSessionId();
  }

  // Session Management Methods for API integration

  /**
   * Create or get session from cookie header
   */
  async getOrCreateSessionFromCookies(
    cookieHeader: string | null,
    userId: string,
    /** CW37. Where the session write goes instead of the response path. See SessionManager. */
    defer?: (p: Promise<unknown>) => void,
    /**
     * CW39. The browsing session the CLIENT is already carrying. The SDK keeps
     * one with an idle rule and sends it on the snapshot and on every event, and
     * both the decision record and the outcome prefer it -- but nothing used it
     * to find or name the session, so two requests arriving together each made a
     * session of their own and one visit was counted as two. Used when the
     * cookie says nothing, which on the decision route is always: that route
     * sets no cookie.
     */
    clientSessionId?: string,
  ): Promise<{
    sessionId: string;
    sessionData: SessionData;
    isNewSession: boolean;
    reflexConfig?: ReflexConfig;
  }> {
    const cookies = this.sessionManager.parseSessionCookies(cookieHeader);
    if (this.principal) {
      assertSessionTarget(this.principal, userId, clientSessionId);
      const sessionId = this.principal.sessionId;
      const { data: existing, consent } = await this.sessionManager.readOwnedConsent(sessionId, cookieHeader);
      if (existing) return { sessionId, sessionData: existing, isNewSession: false };
      if (!personalizes(consent)) {
        // The necessary refusal was already persisted. No behavioral creation or pointer.
        const now = Date.now();
        return { sessionId, isNewSession: true, sessionData: { userId, segments: [], attributes: {},
          metadata: { firstSeen: now, lastSeen: now, sessionCount: 0, engagementScore: 0, lastSegmentUpdate: now },
          preferences: { trackingConsent: consent.tracking, personalizationEnabled: consent.personalization, cookieConsent: true } } };
      }
      // Fresh anonymous authority never restores a legacy profile or its mirrors.
      // Explicit cookie refusals may only restrict; they cannot enable tracking.
      const reflexConfig = this.tenant === DEFAULT_TENANT ? undefined : await resolveTenantReflexConfig(this.env, this.tenant);
      const now = Date.now();
      const sessionData: SessionData = { userId,
        segments: ['new_user'], attributes: {},
        metadata: { firstSeen: now, lastSeen: now, sessionCount: 0, engagementScore: 0, lastSegmentUpdate: now },
        preferences: { trackingConsent: consent.tracking, personalizationEnabled: consent.personalization, cookieConsent: true },
      };
      assertSessionTarget(this.principal, userId, sessionId);
      return { sessionId, sessionData: withConsent(sessionData, consent), isNewSession: true, reflexConfig };
    }
    let sessionId = cookies.sessionId || (clientSessionId || '').trim();
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
      // CW37. THE ID THE BROWSER ALREADY HOLDS WINS. A cookie naming a session
      // this read could not find is not a reason to mint a second id: KV is
      // eventually consistent, so a record written moments ago can read as
      // absent, and deferring the write off the response path widens that
      // window on purpose. Minting a new id there would split one visit across
      // two sessions, and session-scope attribution compares the decision's
      // session to the outcome's -- a split credits nothing, which is the exact
      // failure found on 2026-09-04. Reusing the id the browser presents costs
      // nothing when it is genuinely new (an id nobody has written is an empty
      // session either way) and keeps the visit whole when it is not.
      sessionId = sessionId || this.sessionManager.generateSessionId();
      isNewSession = true;

      // Get user profile for initial session creation
      const userProfile = await this.getUserProfile(userId);
      sessionData = await this.sessionManager.createOrUpdateSession(sessionId, userId, {
        retention: userProfile.retention,
        externalRetention: userProfile.externalRetention,
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
          // CW31: a cookie the browser has not been given yet says nothing, and nothing means consenting,
          // the same default createOrUpdateSession itself uses. Only an explicit 'false' withholds.
          // Before this, a first visit was stored as having refused both, which nothing honoured until CW31.
          trackingConsent: cookies.trackingConsent !== 'false',
          personalizationEnabled: cookies.personalizationEnabled !== 'false',
          cookieConsent: true
        }
      }, undefined, defer);
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
  async getSessionPersonalizationConfig(sessionId: string, resolvedSession?: SessionData, selectedConfig?: ReflexConfig): Promise<PersonalizationConfig | null> {
    const sessionData = resolvedSession ?? (this.principal
      ? (await this.sessionManager.readOwnedConsent(sessionId)).data : await this.sessionManager.getSession(sessionId));
    if (!sessionData) {
      if (!this.principal) await this.ensureSeeded();
      return null;
    }
    if (this.principal) assertSessionTarget(this.principal, sessionData.userId, sessionId);
    if (this.principal && !personalizes(consentOf(sessionData))) return this.getPersonalizationConfig(sessionData, sessionId);
    pinProfileRetention(this.env, sessionData, this.tenant);
    await this.ensureSeeded(resolveSurface({ surface: sessionData.surface }));

    const odp = await projectOdpState(this.env, this.tenant, sessionData);
    const rejectedSeed = sessionData.odpSeed?.some(s => !odp.odpSeed.includes(s));
    const current = sessionData.profileEnrichment === undefined && sessionData.odpSeed === undefined ? sessionData : {
      ...sessionData, segments: await this.enrichedSegments(sessionData, selectedConfig),
      metadata: rejectedSeed ? { ...sessionData.metadata, journeyStage: deriveStage(this.buildQualificationContext(
        sessionData.userId, sessionData.anonymousId, sessionData.attributes, projectedOdpSegments(sessionData.segments, sessionData, odp))) } : sessionData.metadata,
    };
    return this.getPersonalizationConfig(withConsent(current, consentOf(sessionData)), sessionId, selectedConfig);
  }

  /**
   * Update session preferences
   */
  async updateSessionPreferences(
    sessionId: string,
    preferences: Partial<SessionData['preferences']>,
    cookieHeader?: string | null,
  ): Promise<SessionData | null> {
    return this.sessionManager.updateUserPreferences(sessionId, preferences, cookieHeader);
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
    cookieHeader: string | null,
    ctx?: { waitUntil(p: Promise<unknown>): void },
  ): Promise<{
    update: PersonalizationUpdate | null;
    sessionId: string;
    cookieHeaders: string[];
    consent: Consent;
    interestApplied?: boolean;
    dropped?: string;
  }> {
    if (!validEntry(event.entry) || (event.processing === 'buffered' && !this.principal)) throw new SessionAccessError();
    this.keepAlive = ctx ? (p) => { try { ctx.waitUntil(p); } catch { /* no execution context */ } } : undefined;
    const sessionId = this.principal?.sessionId ?? (await this.getOrCreateSessionFromCookies(cookieHeader, event.userId)).sessionId;
    const result = await this.processAction(event, sessionId, cookieHeader);
    if (event.processing === 'buffered') return { update: null, sessionId, cookieHeaders: [], consent: result.consent,
      interestApplied: result.interestApplied, ...(result.dropped ? { dropped: result.dropped } : {}) };
    const cookieHeaders = personalizes(result.consent)
      ? this.sessionManager.createCookieHeaders(this.sessionManager.generateSessionCookies(result.sessionData, sessionId))
      : this.sessionManager.generateConsentCookieHeaders(result.sessionData.preferences, result.consent);

    return {
      update: result.update,
      sessionId,
      cookieHeaders,
      consent: result.consent,
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
