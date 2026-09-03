// src/durable-objects/ShopperReflex.ts
// ─────────────────────────────────────────────────────────────────────────────
// ShopperReflex — the per-shopper hot Durable Object (doc 16 §6, P2).
//
// A SQLite-backed DO (wrangler migration v4, `new_sqlite_classes`) that owns BOTH
// the WebSocket and the affinity state, so state and compute are co-located and
// hot: event → decay+add → evaluate audiences → changed? → push, all inside one
// object, no KV session round-trip, no cross-object hop on the push.
//
//   • One object per shopper, keyed on the STABLE visitor id
//     (SHOPPER_REFLEX.idFromName(opt_visitor_id)) — every tab/device carrying the
//     same id lands on the same object and receives the same pushes.
//   • WebSocket Hibernation API (`state.acceptWebSocket` / `webSocketMessage`):
//     objects park at near-zero cost between events and survive eviction. The
//     socket attachment carries ONLY `{shopperId}` — the ~2KB attachment cap is a
//     hard rule; ALL state lives in `ctx.storage` and rehydrates on wake.
//   • Two ingest doors, ONE handler: `webSocketMessage` (`{type:'action', …}`
//     frames) and `fetch POST /ingest` (no-WS clients, sendBeacon on unload, and
//     the existing POST /realtime/action which forwards here when
//     REFLEX_HOST='do'). Both call the same `ingest(event)`; the DO stamps
//     `Date.now()` on arrival — client timestamps are advisory only (§4).
//   • Closed-form alarms: core's `nextCrossing()` solves the exact instant the
//     earliest current membership decays below θ_out; `alarm()` re-evaluates
//     lazily (decay is read-time math — the alarm never mutates scores), pushes
//     the exits, and schedules the next crossing. No polling, exact-time exits.
//   • Retention lifecycle (§12): an object idle past REFLEX_RETENTION_DAYS
//     (default 30) self-expires via `ctx.storage.deleteAll()`.
//
// ENGINE REUSE, NOT REIMPLEMENTATION — the design decision, recorded:
// RealtimeSegmentEngine is session-coupled by construction (SessionManager/KV
// sessions, cookie headers, and a broadcast that hops to the relay DO), so it is
// NOT instantiated in here. Instead this DO hosts a THIN pipeline that calls the
// SAME modules the request path calls — zero math or policy is copied:
//   ReflexCore (@/reflex/core)      → apply/tick/snapshot/attributesFrom/nextCrossing
//   attribute accrual + engagement  → applyEventToAttributes / calculateEngagementScore
//                                     (exported verbatim from RealtimeSegmentEngine)
//   qualification                   → getConnectors(env).segments — KvAudienceStore +
//                                     evaluateCondition via MockSegmentProvider,
//                                     seeded by the shared ensureAudiencesSeeded
//   journey stage                   → deriveStage (@/services/JourneyStage)
//   ODP loop                        → updateOdpRing / refreshOdpSeedIfDue /
//                                     forwardEventToOdp / upsertOdpProfile (@/services/odpLoop)
//   decisions                       → getConnectors(env).decisions.decideAll over
//                                     CATALOG_FLAG_KEYS (Mock or Live per DECISION_SOURCE)
//
// Identity note: the ODP vuid remains SESSION-derived (SHA-256 of the DO-held
// sessionId, minted once per shopper object) until the identity cutover maps
// vuid ⇄ stable shopperId (doc 16 §8). "New shopper" rotates the client's
// visitor id → a fresh object → a fresh sessionId → a fresh vuid.
// ─────────────────────────────────────────────────────────────────────────────

import type { Env } from '@/types/env';
import type { PersonalizationUpdate } from './PersonalizationWebSocket';
import {
  apply as applyReflex,
  attributesFrom as reflexAttributes,
  emptyState,
  extractTouches,
  touchesForEvent,
  nextCrossing,
  snapshot as reflexSnapshot,
  tick as tickReflex,
  type ReflexConfig,
  type ReflexResult,
  type ReflexState,
} from '@/reflex/core';
import { getConnectors, type Connectors } from '@/connectors';
import { CATALOG_FLAG_KEYS } from '@/connectors/DecisionProvider';
import { CatalogService } from '@/services/CatalogService';
import { deriveStage } from '@/services/JourneyStage';
import {
  RETAIL_SIGNAL_DEFAULTS,
  applyEventToAttributes,
  calculateEngagementScore,
  ensureAudiencesSeeded,
  hasSegmentChanges,
  type ActionEvent,
} from '@/services/RealtimeSegmentEngine';
import {
  forwardEventToOdp,
  mapActionToOdp,
  odpEnabled,
  refreshOdpSeedIfDue,
  updateOdpRing,
  upsertOdpProfile,
} from '@/services/odpLoop';
import {
  DEFAULT_SURFACE,
  audienceKeyPrefixFor,
  catalogServiceFor,
  resolveReflexConfig,
  resolveSurface,
  type DemoSurface,
} from '@/demos/registry';

/**
 * Storage key `'affinity'` — exactly the record doc 16 §6 / the P2 spec mandates.
 * `reflex` is raw (R, tLast) per dimension·value — NEVER pre-decayed (§4).
 */
export interface AffinityRecord {
  shopperId: string;
  reflex: ReflexState;
  odpSeed: string[];
  odpSeedAt: number;
  odpRecentEvents: Array<Record<string, unknown>>;
  lastSeen: number;
  configVersion: string;
}

/**
 * Storage key `'pipeline'` — the DO-side companion record that lets ingest() run
 * the SAME pipeline as the request path (behavioral counters → journey stage →
 * qualification → decisions). Kept under a SEPARATE key so `'affinity'` stays
 * byte-shaped to the spec. (Documented deviation: doc 16 §6 lists only the
 * affinity record; without these the DO could not qualify the counter-based seed
 * audiences or derive the journey stage the request path derives.)
 */
export interface PipelineRecord {
  attributes: Record<string, any>;
  segments: string[];
  journeyStage: 'early' | 'mid' | 'late';
  /** DO-held session id. No longer what the ODP vuid derives from — see visitorId. */
  sessionId: string;
  /**
   * The stable first-party visitor id (`opt_visitor_id`), which is also the name
   * this object is keyed on. Persisted for the same reason `surface` is: the
   * alarm and snapshot paths run with no event to resolve it from, and the ODP
   * vuid must not change just because a write happened on one of those paths.
   * ABSENT on records written before the CW7b cutover; those fall back to the
   * session id and keep exactly the identity they already had.
   */
  visitorId?: string;
  firstSeen: number;
  sessionCount: number;
  /** Demo surface this shopper object belongs to (@/demos/registry). ABSENT ⇒
      'coach' — every record written before the multi-surface split is retail's.
      Persisted because the alarm/snapshot paths have no event to resolve from. */
  surface?: DemoSurface;
}

interface IngestOutcome {
  status: number;
  body: Record<string, unknown>;
  update: PersonalizationUpdate | null;
}

/** Event types accepted by the doors — keep in sync with `actionEventSchema` in src/routes/realtime.ts. */
const ACTION_EVENT_TYPES: ReadonlySet<string> = new Set([
  'email_open', 'form_submit', 'page_view', 'button_click', 'custom',
  'product_view', 'add_to_cart', 'wishlist_add',
]);

/** Never set an alarm in the past; give the current event a beat to settle. */
const MIN_ALARM_DELAY_MS = 50;

/** Cheap per-minute in-DO rate limit (doc 16 §12) — override with REFLEX_RATE_LIMIT_PER_MIN. */
const DEFAULT_RATE_LIMIT_PER_MIN = 240;

const DEFAULT_RETENTION_DAYS = 30;

/**
 * Closed-form alarm time (doc 16 §6): the earlier of
 *   • the exact instant the earliest CURRENT membership decays below θ_out
 *     (core's nextCrossing — t* = tLast + τ·ln(R·(1−θ_out)/(K·θ_out))), and
 *   • the retention horizon (lastSeen + retentionMs — idle self-expiry, §12),
 * clamped to now+MIN_ALARM_DELAY_MS so a boundary crossing fires immediately but
 * never busy-loops. Pure — exported for the P2 test suite.
 */
export function computeNextAlarm(
  reflex: ReflexState,
  lastSeen: number,
  now: number,
  config: ReflexConfig,
  retentionMs: number
): number {
  const crossing = nextCrossing(reflex, now, config);
  const retentionAt = lastSeen + retentionMs;
  const at = crossing === null ? retentionAt : Math.min(crossing, retentionAt);
  return Math.max(at, now + MIN_ALARM_DELAY_MS);
}

// One catalog per isolate — the item-item graph precompute never runs per event.
let _catalog: CatalogService | null = null;
function catalog(): CatalogService {
  return (_catalog = _catalog ?? new CatalogService());
}

/**
 * The catalog a surface scores against. The default surface keeps the isolate-wide
 * instance above (same object, same graph); other surfaces resolve their own
 * memoized CatalogService from the registry — this is what makes the trust gate
 * below surface-aware instead of dropping every foreign product id (P4).
 */
async function catalogFor(surface: DemoSurface): Promise<CatalogService> {
  return surface === DEFAULT_SURFACE ? catalog() : catalogServiceFor(surface);
}

export class ShopperReflex {
  private state: DurableObjectState;
  private env: Env;

  /** In-memory mirrors of storage; rehydrated from ctx.storage on wake. */
  private affinity: AffinityRecord | null = null;
  private pipeline: PipelineRecord | null = null;
  private loaded = false;
  private seeded = new Set<DemoSurface>();

  /** Serializes ingest/alarm runs — the reducer is strictly sequential even when
      awaits on KV/ODP would otherwise let events interleave. */
  private chain: Promise<unknown> = Promise.resolve();

  /** Cheap per-minute rate limit. In-memory by design (zero storage writes): a
      hibernation wake resets it, but sustained bursts — the abuse case — keep the
      object alive, so the window holds exactly when it matters. */
  private rate = { windowStart: 0, count: 0 };
  private dropped = { rateLimited: 0, unknownProduct: 0, invalid: 0 };

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // ── HTTP surface ────────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleUpgrade(url);
    }

    if (request.method === 'POST' && url.pathname === '/ingest') {
      return this.handleIngest(request);
    }
    if (request.method === 'GET' && url.pathname === '/snapshot') {
      return this.handleSnapshot();
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      await this.load();
      return json({
        status: 'healthy',
        shopperId: this.affinity?.shopperId ?? null,
        sockets: this.state.getWebSockets().length,
        audiences: this.affinity?.reflex.audiences ?? [],
        lastSeen: this.affinity?.lastSeen ?? null,
        dropped: this.dropped,
      });
    }
    // Erasure door (§12 privacy/lifecycle): wipes the vector + memberships.
    // GDPR/CCPA path and the operator's hard reset; retention uses the same wipe.
    if (request.method === 'POST' && url.pathname === '/reset') {
      await this.serialize(async () => {
        await this.state.storage.deleteAll();
        this.affinity = null;
        this.pipeline = null;
        this.loaded = true;
      });
      return json({ ok: true });
    }

    return new Response('Not Found', { status: 404 });
  }

  // ── Door 1: the WebSocket (Hibernation API) ─────────────────────────────────

  private async handleUpgrade(url: URL): Promise<Response> {
    const shopperId = url.searchParams.get('userId');
    if (!shopperId) {
      return new Response('Missing userId parameter', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation accept: the runtime may evict this object between messages and
    // wake it on the next frame — near-zero idle cost, sockets stay connected.
    this.state.acceptWebSocket(server);
    // HARD RULE: the attachment carries ONLY {shopperId} (~2KB cap). All affinity
    // state lives in ctx.storage and rehydrates via load() on wake.
    server.serializeAttachment({ shopperId });

    // Same welcome frame the relay DO sends — client transport code is unchanged.
    server.send(
      JSON.stringify({
        type: 'connected',
        connectionId: crypto.randomUUID(),
        userId: shopperId,
        timestamp: Date.now(),
      })
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Hibernation handler — wakes the object on any client frame. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let frame: any;
    try {
      frame = JSON.parse(message);
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object') return;

    if (frame.type === 'heartbeat') {
      try {
        ws.send(JSON.stringify({ type: 'heartbeat_response', timestamp: Date.now() }));
      } catch { /* dying socket — close handler cleans up */ }
      return;
    }

    if (frame.type !== 'action') return; // subscribe/unsubscribe etc. — no-ops here

    const attachment = (safeAttachment(ws) ?? {}) as { shopperId?: string };
    const event = this.normalizeEvent(frame, attachment.shopperId);
    if (!event) {
      this.dropped.invalid++;
      return;
    }
    // Same reducer as POST /ingest; the outcome reaches the client as the push
    // this ingest emits over the DO's own sockets (no HTTP response on this door).
    await this.serialize(() => this.ingest(event));
  }

  async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // Nothing to clean: connection bookkeeping IS state.getWebSockets(); shopper
    // state persists in storage; the pending alarm keeps decay-out + retention live.
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error('ShopperReflex webSocketError:', error);
  }

  // ── Door 2: POST /ingest ────────────────────────────────────────────────────

  private async handleIngest(request: Request): Promise<Response> {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: 'invalid JSON body' }, 400);
    }
    const event = this.normalizeEvent(body, undefined);
    if (!event) {
      this.dropped.invalid++;
      return json({ success: false, error: 'invalid action event' }, 400);
    }
    const outcome = await this.serialize(() => this.ingest(event));
    return json(outcome.body, outcome.status);
  }

  /**
   * Accept either a bare ActionEvent (the POST /realtime/action body shape) or a
   * WS frame `{type:'action', event:{…}}` / flattened `{type:'action', action, data}`.
   */
  private normalizeEvent(raw: any, fallbackShopperId?: string): ActionEvent | null {
    const src = raw && typeof raw === 'object' && raw.event && typeof raw.event === 'object' ? raw.event : raw;
    if (!src || typeof src !== 'object') return null;

    const type =
      typeof src.type === 'string' && ACTION_EVENT_TYPES.has(src.type)
        ? src.type
        : typeof src.action === 'string' && ACTION_EVENT_TYPES.has(src.action)
          ? src.action
          : null;
    if (!type) return null;

    const userId = typeof src.userId === 'string' && src.userId ? src.userId : fallbackShopperId;
    if (!userId) return null;

    return {
      type: type as ActionEvent['type'],
      userId,
      ...(typeof src.anonymousId === 'string' ? { anonymousId: src.anonymousId } : {}),
      data: src.data && typeof src.data === 'object' ? src.data : {},
      source: typeof src.source === 'string' ? src.source : 'ws',
      ...(typeof src.surface === 'string' ? { surface: src.surface } : {}),
      // Advisory only — ingest() stamps its own arrival time (§4).
      timestamp: typeof src.timestamp === 'number' ? src.timestamp : Date.now(),
    };
  }

  // ── THE reducer: one handler behind both doors ──────────────────────────────

  private async ingest(event: ActionEvent): Promise<IngestOutcome> {
    // The ENGINE clock is authoritative — a forged/skewed client clock cannot
    // inflate affinity (doc 16 §4). Everything downstream uses this stamp.
    const now = Date.now();

    if (!this.allowIngest(now)) {
      this.dropped.rateLimited++;
      return {
        status: 429,
        body: { success: false, error: 'rate_limited', retryAfterMs: this.rate.windowStart + 60_000 - now },
        update: null,
      };
    }

    // Which demo posted this — resolved from the event alone (explicit field, else
    // `source`, else coach), so the trust gate below can consult the RIGHT catalog
    // before any storage read.
    const surface = resolveSurface({
      source: event.source,
      surface: event.surface ?? (event.data as Record<string, unknown> | undefined)?.surface as string | undefined,
    });
    const surfaceCatalog = await catalogFor(surface);
    const cfg = await resolveReflexConfig(this.env, surface);

    // Trust & abuse (§12): validate referenced products against the in-memory
    // catalog index — an unknown productId is dropped and counted, never scored.
    const data = event.data ?? {};
    const pid = data.productId ?? data.product_id ?? data.sku;
    const product = pid != null ? surfaceCatalog.getProduct(String(pid)) : undefined;
    // CW24: where the scope scores event-carried attributes, an unknown id with
    // registry attributes on it is a customer's product, not an abuse attempt.
    const eventTouches = !product && cfg.eventAttributes === 'event-when-unknown'
      ? touchesForEvent(data as Record<string, unknown>, undefined, cfg) : [];
    if (pid != null && !product && eventTouches.length === 0) {
      this.dropped.unknownProduct++;
      return {
        status: 200,
        body: {
          success: true,
          message: 'Action ignored: unknown productId',
          dropped: 'unknown_product',
          sessionId: this.pipeline?.sessionId ?? null,
          cookiesUpdated: false,
        },
        update: null,
      };
    }

    await this.load();
    await this.ensureSeeded(surface);
    const connectors = getConnectors(this.env); // fresh per run — mirrors the per-request triad

    const aff: AffinityRecord = this.affinity ?? {
      shopperId: event.userId,
      reflex: emptyState(cfg),
      odpSeed: [],
      odpSeedAt: 0,
      odpRecentEvents: [],
      lastSeen: now,
      configVersion: cfg.version,
    };
    const pipe: PipelineRecord = this.pipeline ?? {
      attributes: {},
      segments: [],
      journeyStage: 'early',
      sessionId: crypto.randomUUID(),
      firstSeen: now,
      sessionCount: 0,
      // Only non-default surfaces are tagged, so a retail record's stored bytes
      // are exactly what they were before the split.
      ...(surface === DEFAULT_SURFACE ? {} : { surface }),
    };

    // The stable id rides in on every event as `userId`. Recorded once and kept,
    // so a later alarm or snapshot resolves the same vuid as a live event would.
    if (!pipe.visitorId && typeof event.userId === 'string' && event.userId !== '') {
      pipe.visitorId = event.userId;
    }

    // 1. Behavioral counters — the SAME accrual the request path runs.
    const attributes = { ...pipe.attributes };
    applyEventToAttributes(attributes, event, surfaceCatalog);
    const engagementScore = calculateEngagementScore(attributes);

    // 2. The pure core (§4): decay-then-accumulate + hysteresis evaluation.
    const reflexOn = (this.env.REFLEX_ENABLED ?? 'true') !== 'false';
    let reflex: ReflexResult | null = null;
    if (reflexOn) {
      const action = String(data.action ?? data.eventName ?? event.type);
      reflex = applyReflex(
        aff.reflex,
        {
          action,
          touches: product ? extractTouches(product as unknown as Record<string, unknown>, cfg) : eventTouches,
        },
        now,
        cfg
      );
    }

    // 3. Local qualification through the ODP seam (KvAudienceStore + evaluateCondition).
    const ctxAttrs: Record<string, any> = { ...RETAIL_SIGNAL_DEFAULTS, ...attributes };
    const qualCtx = {
      userId: aff.shopperId,
      anonymousId: event.anonymousId,
      attributes: ctxAttrs,
      segments: pipe.segments,
      surface, // qualification evaluates only THIS surface's audiences
    };
    const journeyStage = deriveStage(qualCtx);
    ctxAttrs.journey_stage = journeyStage;
    // Reflex scores are computed FRESH into the context (they decay by construction —
    // never persisted), so store-published affinity audiences can gte them.
    if (reflex) Object.assign(ctxAttrs, reflexAttributes(reflex.state, now, cfg));
    let localSegments: string[] = [];
    try {
      localSegments = await connectors.segments.fetchQualifiedSegments(aff.shopperId, qualCtx);
    } catch (e) {
      console.error('ShopperReflex qualification failed (degrading to reflex-only):', e);
    }

    // 4. ODP loop (§8) — same ring + seed policy as the request path (shared fns).
    let odpSeed = aff.odpSeed;
    let odpSeedAt = aff.odpSeedAt;
    let odpRing = aff.odpRecentEvents.slice();
    let odpReceipt: { receiptId: string; type: string; action?: string; product_id?: string } | undefined;
    const membershipChanged = !!reflex && (reflex.changes.entered.length > 0 || reflex.changes.exited.length > 0);
    if (odpEnabled(this.env)) {
      odpRing = updateOdpRing(odpRing, event, now);
      ({ seed: odpSeed, seedAt: odpSeedAt } = await refreshOdpSeedIfDue(
        this.env,
        { visitorId: pipe.visitorId, sessionId: pipe.sessionId },
        odpRing,
        { seed: odpSeed, seedAt: odpSeedAt },
        now,
        membershipChanged
      ));
      // Forward to the memory OFF the hot path. Fire-and-forget: a DO stays alive
      // while I/O is in flight, and forwardEventToOdp never throws. The receipt
      // lands over THIS object's own sockets — no relay hop.
      const mapped = mapActionToOdp(event);
      if (mapped) {
        odpReceipt = {
          receiptId: crypto.randomUUID(),
          type: mapped.type,
          ...(mapped.action ? { action: mapped.action } : {}),
          ...(typeof mapped.data.product_id === 'string' ? { product_id: mapped.data.product_id } : {}),
        };
        void forwardEventToOdp(this.env, event, { visitorId: pipe.visitorId, sessionId: pipe.sessionId }, odpReceipt.receiptId, (receipt) =>
          this.pushFrame({ type: 'odp_receipt', userId: aff.shopperId, data: receipt })
        );
      }
    }

    // 5. Union (local ∪ reflex ∪ ODP seed) + change detection — same triggers.
    // The surface namespace is applied to the core's membership keys here so they
    // match the generated audience keys (prefix '' for coach ⇒ same array).
    const prefix = audienceKeyPrefixFor(surface);
    const reflexAudiences = reflex
      ? prefix
        ? reflex.state.audiences.map((k) => prefix + k)
        : reflex.state.audiences
      : [];
    const newSegments = Array.from(
      new Set([...localSegments, ...reflexAudiences, ...odpSeed])
    );
    const segmentsChanged = hasSegmentChanges(pipe.segments, newSegments);
    const stageChanged = pipe.journeyStage !== journeyStage;

    // 6. Commit the new records to the in-memory mirrors.
    this.affinity = {
      shopperId: aff.shopperId,
      reflex: reflex ? reflex.state : aff.reflex,
      odpSeed,
      odpSeedAt,
      odpRecentEvents: odpRing,
      lastSeen: now,
      configVersion: cfg.version,
    };
    this.pipeline = {
      attributes,
      segments: newSegments,
      journeyStage,
      sessionId: pipe.sessionId,
      firstSeen: pipe.firstSeen,
      sessionCount: pipe.sessionCount + 1,
      ...(surface === DEFAULT_SURFACE ? {} : { surface }),
    };

    // 7. Changed? → decide + push over the DO's OWN sockets, in the same object.
    let update: PersonalizationUpdate | null = null;
    if (segmentsChanged || stageChanged) {
      update = await this.buildUpdate(connectors, now, event.source, reflex, engagementScore);
      this.pushFrame({ ...update, serverTimestamp: Date.now() });
      // §4 score upsert: on membership changes, persist the reflex's live scores
      // onto the ODP profile (the memory carrying the edge's numbers).
      const affPayload = update.data.affinity;
      if (odpEnabled(this.env) && affPayload && membershipChanged) {
        void upsertOdpProfile(this.env, { visitorId: pipe.visitorId, sessionId: pipe.sessionId }, affPayload, journeyStage);
      }
    }

    // 8. Persist (single coalesced SQLite write, output-gated) + closed-form alarm.
    await this.state.storage.put({ affinity: this.affinity, pipeline: this.pipeline });
    await this.scheduleNextCrossing(now);

    return {
      status: 200,
      body: {
        success: true,
        message: update
          ? 'Action processed and personalization updated'
          : 'Action processed, no personalization changes needed',
        ...(update ? { update } : {}),
        sessionId: this.pipeline.sessionId,
        cookiesUpdated: false, // identity is the stable visitor id — no session cookies on this host
        ...(odpReceipt ? { odp: odpReceipt } : {}),
      },
      update,
    };
  }

  // ── The push envelope (same PersonalizationUpdate shape as the request path) ─

  private async buildUpdate(
    connectors: Connectors,
    now: number,
    source: string,
    reflex: ReflexResult | null,
    engagementScore: number
  ): Promise<PersonalizationUpdate> {
    const aff = this.affinity!;
    const pipe = this.pipeline!;
    const surface = this.surface();
    const cfg = await resolveReflexConfig(this.env, surface);
    const surfaceCatalog = await catalogFor(surface);
    const reflexOn = (this.env.REFLEX_ENABLED ?? 'true') !== 'false';

    const attributes: Record<string, any> = { ...RETAIL_SIGNAL_DEFAULTS, ...pipe.attributes };
    if (reflexOn) Object.assign(attributes, reflexAttributes(aff.reflex, now, cfg));

    const userAttributes = {
      segments: pipe.segments,
      ...attributes,
      engagement_score: engagementScore,
      session_count: pipe.sessionCount,
      journey_stage: pipe.journeyStage,
      days_since_first_seen: Math.floor((now - pipe.firstSeen) / (24 * 60 * 60 * 1000)),
      // No cookie-consent surface on this host (no PII either) — mirrors the
      // session path's defaults for a consenting shopper.
      tracking_consent: true,
      personalization_enabled: true,
    };

    const decisions = await connectors.decisions.decideAll(
      CATALOG_FLAG_KEYS,
      aff.shopperId,
      pipe.segments,
      userAttributes
    );
    const featureVariables: Record<string, any> = {};
    for (const [flagKey, decision] of Object.entries(decisions)) {
      featureVariables[flagKey] = decision.variables;
    }

    const anchorLine =
      typeof pipe.attributes.viewed_product_line === 'string'
        ? pipe.attributes.viewed_product_line
        : undefined;
    const recommendations = surfaceCatalog.getRecommendations({ line: anchorLine }, pipe.segments, 8);
    const sortOrder = surfaceCatalog
      .sortForSegments(null, pipe.segments, pipe.attributes)
      .slice(0, 24)
      .map((p) => p.id);

    return {
      type: 'personalization_update',
      userId: aff.shopperId,
      data: {
        segments: pipe.segments,
        decisions,
        featureVariables,
        recommendations,
        sortOrder,
        journeyStage: pipe.journeyStage,
        // Live affinity payload for the Affinity Instrument: dims (original catalog
        // value names) + memberships + this event's EXPLAIN records (§12 glass box)
        // + the ODP-confirmed subset — the exact shape the request path pushes.
        affinity: reflexOn
          ? {
              ...reflexSnapshot(aff.reflex, now, cfg),
              changed: reflex ? reflex.changes.explain : [],
              odpConfirmed: aff.odpSeed,
            }
          : undefined,
        sessionId: pipe.sessionId,
        engagementScore,
        timestamp: now,
        source,
      } as PersonalizationUpdate['data'],
    };
  }

  /** Push to every socket THIS object holds — never a cross-object hop. */
  private pushFrame(frame: unknown): void {
    const message = JSON.stringify(frame);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        /* runtime reaps dead hibernated sockets */
      }
    }
  }

  // ── Closed-form alarm: exit-by-decay without polling + retention ────────────

  private retentionMs(): number {
    const days = Number(this.env.REFLEX_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
    return (Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
  }

  private async scheduleNextCrossing(now: number): Promise<void> {
    if (!this.affinity) return;
    const at = computeNextAlarm(
      this.affinity.reflex,
      this.affinity.lastSeen,
      now,
      await resolveReflexConfig(this.env, this.surface()),
      this.retentionMs()
    );
    await this.state.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    await this.serialize(async () => {
      await this.load();
      if (!this.affinity) return; // already erased
      const now = Date.now();
      const surface = this.surface();
      const cfg = await resolveReflexConfig(this.env, surface);

      // Retention (§12): idle past N days with no live sockets → self-expire.
      if (now - this.affinity.lastSeen >= this.retentionMs() && this.state.getWebSockets().length === 0) {
        await this.state.storage.deleteAll();
        this.affinity = null;
        this.pipeline = null;
        return;
      }

      // Lazy re-evaluation: tick() NEVER accumulates — decay is read-time math, so
      // the alarm never mutates scores; it only re-reads them at `now` and applies
      // the θ_out exits the closed form predicted.
      const res = tickReflex(this.affinity.reflex, now, cfg);
      this.affinity = { ...this.affinity, reflex: res.state, configVersion: cfg.version };

      const exited = res.changes.exited.length > 0 || res.changes.entered.length > 0;
      if (exited && this.pipeline) {
        await this.ensureSeeded(surface);
        const connectors = getConnectors(this.env);
        // Re-run the qualification tail with the decayed memberships — the union
        // shrinks, decisions revert, and the "they wandered off" push goes out.
        const ctxAttrs: Record<string, any> = { ...RETAIL_SIGNAL_DEFAULTS, ...this.pipeline.attributes };
        const qualCtx = {
          userId: this.affinity.shopperId,
          attributes: ctxAttrs,
          segments: this.pipeline.segments,
          surface,
        };
        const journeyStage = deriveStage(qualCtx);
        ctxAttrs.journey_stage = journeyStage;
        Object.assign(ctxAttrs, reflexAttributes(res.state, now, cfg));
        let localSegments: string[] = [];
        try {
          localSegments = await connectors.segments.fetchQualifiedSegments(this.affinity.shopperId, qualCtx);
        } catch (e) {
          console.error('ShopperReflex alarm qualification failed:', e);
        }
        let odpSeed = this.affinity.odpSeed;
        let odpSeedAt = this.affinity.odpSeedAt;
        if (odpEnabled(this.env)) {
          ({ seed: odpSeed, seedAt: odpSeedAt } = await refreshOdpSeedIfDue(
            this.env,
            { visitorId: this.pipeline?.visitorId, sessionId: this.pipeline?.sessionId ?? '' },
            this.affinity.odpRecentEvents,
            { seed: odpSeed, seedAt: odpSeedAt },
            now,
            true // membership changed — instant read, same policy as the ingest path
          ));
          this.affinity = { ...this.affinity, odpSeed, odpSeedAt };
        }
        const prefix = audienceKeyPrefixFor(surface);
        const newSegments = Array.from(
          new Set([
            ...localSegments,
            ...(prefix ? res.state.audiences.map((k) => prefix + k) : res.state.audiences),
            ...odpSeed,
          ])
        );
        const changed =
          hasSegmentChanges(this.pipeline.segments, newSegments) ||
          this.pipeline.journeyStage !== journeyStage;
        this.pipeline = { ...this.pipeline, segments: newSegments, journeyStage };

        if (changed) {
          const engagementScore = calculateEngagementScore(this.pipeline.attributes);
          const update = await this.buildUpdate(connectors, now, 'reflex_alarm', res, engagementScore);
          this.pushFrame({ ...update, serverTimestamp: Date.now() });
        }
      }

      await this.state.storage.put({
        affinity: this.affinity,
        ...(this.pipeline ? { pipeline: this.pipeline } : {}),
      });
      await this.scheduleNextCrossing(now); // next exit, or the retention horizon
    });
  }

  // ── Snapshot door (same shape as GET /realtime/reflex) ─────────────────────

  private async handleSnapshot(): Promise<Response> {
    await this.load();
    const cfg = await resolveReflexConfig(this.env, this.surface());
    const now = Date.now();
    return json({
      ok: true,
      now,
      // Shape mirrors the session-path handler in src/routes/realtime.ts (the
      // client's honest drain animation reads these) — keep the two in sync.
      config: {
        tauMs: cfg.tauMs,
        K: cfg.K,
        thetaIn: cfg.thetaIn,
        thetaOut: cfg.thetaOut,
        dims: Object.fromEntries(
          cfg.dimensions
            .filter((d) => d.tauMs || d.K || d.thetaIn || d.thetaOut)
            .map((d) => [d.key, { tauMs: d.tauMs, K: d.K, thetaIn: d.thetaIn, thetaOut: d.thetaOut }])
        ),
      },
      affinity: this.affinity
        ? {
            ...reflexSnapshot(this.affinity.reflex, now, cfg),
            odpConfirmed: this.affinity.odpSeed ?? [],
          }
        : null,
    });
  }

  // ── Plumbing ────────────────────────────────────────────────────────────────

  /** Rehydrate the in-memory mirrors from ctx.storage (one read for both keys). */
  private async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.state.storage.get(['affinity', 'pipeline']);
    this.affinity = (stored.get('affinity') as AffinityRecord | undefined) ?? null;
    this.pipeline = (stored.get('pipeline') as PipelineRecord | undefined) ?? null;
    this.loaded = true;
  }

  /** Same audiences the request path seeds (idempotent; version-gated to one KV read). */
  private async ensureSeeded(surface: DemoSurface = DEFAULT_SURFACE): Promise<void> {
    if (this.seeded.has(surface)) return;
    try {
      await ensureAudiencesSeeded(this.env, await catalogFor(surface), surface);
      this.seeded.add(surface);
    } catch (error) {
      console.error('ShopperReflex: audience seeding failed:', error);
    }
  }

  /** The surface this shopper object belongs to (persisted; absent ⇒ coach). */
  private surface(): DemoSurface {
    return this.pipeline?.surface ?? DEFAULT_SURFACE;
  }

  private allowIngest(now: number): boolean {
    const limitRaw = Number(this.env.REFLEX_RATE_LIMIT_PER_MIN ?? DEFAULT_RATE_LIMIT_PER_MIN);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_RATE_LIMIT_PER_MIN;
    if (now - this.rate.windowStart >= 60_000) {
      this.rate = { windowStart: now, count: 0 };
    }
    this.rate.count++;
    return this.rate.count <= limit;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

function safeAttachment(ws: WebSocket): unknown {
  try {
    return ws.deserializeAttachment();
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
