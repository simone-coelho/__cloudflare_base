import type { Env } from '@/types/env';
import { importUnderOwner, ownerOperationActive, sessionAuthorityKV, currentOwnerConsent, restrictOwnerConsent, requireConsentPurpose } from '@/identity/sessionAuthority';
import { mergeOdpState, projectOdpState, projectedOdpSegments } from './odpLoop';
import { deriveStage } from './JourneyStage';
import { tick, type ReflexChanges, type ReflexConfig, type ReflexState, type Touch } from '@/reflex/core';
import { applyHistorical, mergeReflexStates } from '@/reflex/identityMerge';
import { z } from 'zod';
import { assertSessionTarget, SessionAccessError, type SessionCapability } from '@/identity/sessionCapability';
import { consentOf, consentFromCookies, intersectConsent, withConsent, REFUSING, type Consent } from '@/content/consent';
import { isShopperId } from '@/identity/shopperId';
import { applyProfileSnapshot, enrichmentInputs, mergeEnrichment, profileEnrichmentSchema, readEnrichment, type ImportOutcome, type ProfileEnrichment, type ProfileSnapshotRow } from '@/identity/profileEnrichment';
import { retentionBirth, externalRetentionBirths, requireRetention, type ExternalRetention, type RetentionStamp } from '@/retention';
import { pinProfileRetention } from '@/identity/sessionAuthority';

import {
  liveVisit, mergeVisits, validEntry,
  type ChannelSignals, type EntryChannel,
} from '@/services/visit';
import { DEFAULT_TENANT, TenantKV, type KVLike, type TenantId } from '@/tenancy/tenant';

export interface SessionData {
  retention?: RetentionStamp;
  externalRetention?: ExternalRetention;
  /** Request-only owner projection; never part of the persisted schema. */
  consent?: Consent;
  userId: string;
  anonymousId?: string;
  segments: string[];
  attributes: Record<string, any>;
  /** Demo surface this session belongs to (@/demos/registry). ABSENT ⇒ 'coach' —
      every session written before the multi-surface split is the retail demo's. */
  surface?: string;
  /** Edge Affinity Reflex state (doc 16) — raw (R, tLast) per dimension·value.
      P0 hosting: rides the session; relocates into the ShopperReflex DO in P2. */
  reflex?: ReflexState;
  /** External source snapshots: local qualification only, separate from behavior. */
  profileEnrichment?: ProfileEnrichment;
  /** ODP loop (doc 16 §8): the session's last-seeded qualified ODP audiences + when. */
  odpContext?: string;
  odpSeed?: string[];
  odpSeedAt?: number;
  /** Ring of the session's recent events in the FLAT recent_events shape (≤10, ≤55min)
      — injected inline into the GraphQL read for instant (~200ms) qualification. */
  odpRecentEvents?: Array<Record<string, unknown>>;
  /**
   * CW25. Set on a record whose visitor was linked to a person: reads and
   * writes addressed to this session land on the person's session instead. The
   * record keeps its old content underneath, so if the target ever expires the
   * browser still has what it had. One hop, never chained.
   */
  forwardTo?: string;
  /**
   * CW25. Present on the PERSON's session. Its userId is the shopper id, and a
   * write arriving with a browser's visitor id must not overwrite it, or the
   * ODP vuid and the identity anchor would flap between devices.
   */
  identity?: { shopperId: string; linkedAt: number };
  metadata: {
    firstSeen: number;
    lastSeen: number;
    /**
     * Interactions, NOT visits. It increments on every createOrUpdateSession
     * call, which is what it has always done; the name is misleading and the
     * field is kept because it is persisted and read. For "how many times has
     * this shopper been here", use visitCount.
     */
    sessionCount: number;
    /**
     * Visits, counted on an idle-gap boundary (see @/services/visit). Optional
     * because records written before this field existed must still parse:
     * getSession() runs the schema and swallows a failure as null, so a required
     * field here would silently wipe every live session on deploy.
     */
    visitCount?: number;
    /** When the current visit began. */
    lastVisitAt?: number;
    /** How this visit was entered. Classified once per visit, then carried. */
    entryChannel?: EntryChannel;
    engagementScore: number;
    lastSegmentUpdate: number;
    journeyStage?: 'early' | 'mid' | 'late';
  };
  preferences: {
    trackingConsent: boolean;
    personalizationEnabled: boolean;
    cookieConsent: boolean;
  };
}
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface CookieConfig {
  name: string;
  value: string;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  domain?: string;
  path?: string;
}

export interface SessionCookies {
  sessionId: string;
  segments: string;
  userId?: string;
  anonymousId?: string;
  engagementScore: string;
  lastUpdate: string;
  trackingConsent: string;
  personalizationEnabled: string;
}

export const sessionDataSchema = z.object({
  retention: z.custom<RetentionStamp>().optional(),
  externalRetention: z.custom<ExternalRetention>().optional(),
  userId: z.string(),
  anonymousId: z.string().optional(),
  segments: z.array(z.string()),
  attributes: z.record(z.string(), z.any()),
  // Declared or .parse() silently STRIPS it on every read/write (same trap as reflex).
  surface: z.string().optional(),
  // Reflex state must be declared or .parse() silently STRIPS it on every read/write.
  reflex: z.any().optional(),
  profileEnrichment: profileEnrichmentSchema.optional(),
  odpContext: z.string().optional(),
  odpSeed: z.array(z.string()).optional(),
  odpSeedAt: z.number().optional(),
  odpRecentEvents: z.array(z.any()).optional(),
  // CW25. Declared or .parse() silently STRIPS them, same trap as reflex.
  forwardTo: z.string().optional(),
  identity: z.object({ shopperId: z.string(), linkedAt: z.number() }).optional(),
  metadata: z.object({
    firstSeen: z.number(),
    lastSeen: z.number(),
    sessionCount: z.number(),
    // Optional, deliberately: see the note on the interface above. A required
    // field would fail .parse() on every record written before this deploy, and
    // getSession() turns a parse failure into null.
    visitCount: z.number().optional(),
    lastVisitAt: z.number().optional(),
    // An enum, so the parsed type matches the interface, with .catch so an
    // unrecognised stored value degrades to undefined instead of failing the
    // parse and taking the whole session with it.
    entryChannel: z
      .enum(['direct', 'paid_social', 'paid_search', 'email', 'organic', 'referral'])
      .optional()
      .catch(undefined),
    engagementScore: z.number(),
    lastSegmentUpdate: z.number(),
    journeyStage: z.enum(['early', 'mid', 'late']).optional()
  }),
  preferences: z.object({
    trackingConsent: z.boolean(),
    personalizationEnabled: z.boolean(),
    cookieConsent: z.boolean()
  })
});

/** Import must not let the historical reducer treat a corrupt vector as empty. */
export const historicalReflexSchema = z.object({
  v: z.literal(1),
  dims: z.record(z.string(), z.record(z.string(), z.object({
    s: z.number().finite().nonnegative(), t: z.number().int().nonnegative(),
  }))),
  audiences: z.array(z.string()), configVersion: z.string(),
});

/**
 * CW25. Attributes that count events, which add across a person's devices. The
 * names are RETAIL_SIGNAL_DEFAULTS' (RealtimeSegmentEngine); anything not here
 * is a latest-value attribute, on which the person's record wins.
 */
/** How often a forwarding record has its TTL renewed under a browser that keeps using it. */
const FORWARD_REFRESH_MS = 24 * 60 * 60 * 1000;

const COUNTER_ATTRIBUTES = new Set(['product_views', 'cart_adds', 'wishlist_adds', 'page_views', 'category_dwell_ms', 'purchases']);

export class SessionManager {
  private env: Env;
  readonly tenant: TenantId;
  private sessionTTL: number = SESSION_TTL_SECONDS;
  private cookieDomain: string;
  private isSecure: boolean;

  /**
   * Sessions scoped to one brand (CW1). A visitor on Kate Spade and a visitor on
   * Coach who happen to share a session id are two different people, and without
   * this they were one: `session:{id}` was a global key.
   *
   * The default tenant is unprefixed, so an existing `new SessionManager(env)`
   * reads and writes exactly the keys it always did and no live session moves.
   */
  private readonly kv: KVLike;

  readonly principal?: SessionCapability;

  constructor(env: Env, options?: { domain?: string; secure?: boolean; tenant?: TenantId; principal?: SessionCapability }) {
    this.env = env;
    this.tenant = options?.tenant ?? DEFAULT_TENANT;
    this.principal = options?.principal;
    if (this.principal && this.principal.tenant !== this.tenant) throw new SessionAccessError();
    this.kv = new TenantKV(sessionAuthorityKV(env, this.principal), this.tenant);
    this.cookieDomain = options?.domain || '';
    this.isSecure = options?.secure ?? true;
  }

  /**
   * Create a new session or update existing one
   */
  async createOrUpdateSession(
    sessionId: string,
    userId: string,
    data: Partial<SessionData>,
    /**
     * How this request arrived: utm tags and referrer. Only consulted when this
     * call opens a new visit, because entry is a property of the visit and not
     * of every event inside it. Optional, so no existing call site changes.
     */
    entry?: ChannelSignals,
    /**
     * CW37. Where the KV writes go instead of being awaited. A decision does not
     * depend on the session having been STORED -- it is computed from the record
     * this call returns -- and a KV write costs half a second or more from a
     * Worker, which doc 32 measured as the whole of a new shopper's 627 ms. Hand
     * this a sink (the request's `waitUntil`) and the write leaves the response
     * path. Omit it and nothing changes: every existing caller still awaits.
     */
    defer?: (p: Promise<unknown>) => void,
    ownedSnapshot?: { sessionId: string; data: SessionData | null },
    observedLive = true,
  ): Promise<SessionData> {
    if (!validEntry(entry)) throw new SessionAccessError();
    if (this.principal) {
      assertSessionTarget(this.principal, userId, sessionId);
      if (data.forwardTo || (data.identity && (this.principal.kind !== 'recognized' || data.identity.shopperId !== userId))) throw new SessionAccessError();
    }
    try {
      // CW25. A browser that was linked to a person writes to the person's
      // session; the id on the cookie stays what it was, the record it names
      // forwards. Resolved once here, for the read below and the write at the end.
      const target = ownedSnapshot
        ? { id: sessionId, data: this.checkedSnapshot(sessionId, ownedSnapshot) }
        : await this.resolveRecord(sessionId);
      sessionId = target.id;
      const existingSession = target.data;
      // A person's session keeps the person's id whatever browser is writing.
      if (existingSession?.identity && existingSession.userId !== userId) userId = existingSession.userId;

      const now = Date.now();

      // THE VISIT BOUNDARY. Read lastSeen from the STORED record, never from the
      // incoming data: a caller that passes `metadata.lastSeen: Date.now()` would
      // otherwise close the gap it is being measured against, and every event
      // would look like a new visit.
      const priorLastSeen = existingSession?.metadata.lastSeen;
      const visit = observedLive ? liveVisit(existingSession?.metadata, priorLastSeen, now, entry) : {
        visitCount: existingSession?.metadata.visitCount, lastVisitAt: existingSession?.metadata.lastVisitAt,
        entryChannel: existingSession?.metadata.entryChannel,
      };
      // A record written before visitCount existed resolves to visit 1. That
      // under-counts a returning shopper once, which is honest; seeding from
      // sessionCount would import its wrongness instead.

      const sessionData: SessionData = {
        retention: existingSession ? existingSession.retention : data.retention,
        externalRetention: existingSession ? existingSession.externalRetention : data.externalRetention,
        userId,
        anonymousId: data.anonymousId || existingSession?.anonymousId,
        segments: data.segments || existingSession?.segments || ['new_user'],
        attributes: {
          ...existingSession?.attributes,
          ...data.attributes
        },
        surface: data.surface ?? existingSession?.surface,
        reflex: data.reflex ?? existingSession?.reflex,
        profileEnrichment: existingSession?.profileEnrichment,
        odpContext: data.odpContext ?? existingSession?.odpContext,
        odpSeed: data.odpSeed ?? existingSession?.odpSeed,
        odpSeedAt: data.odpSeedAt ?? existingSession?.odpSeedAt,
        odpRecentEvents: data.odpRecentEvents ?? existingSession?.odpRecentEvents,
        identity: data.identity ?? existingSession?.identity,
        metadata: {
          firstSeen: existingSession?.metadata.firstSeen || now,
          lastSeen: observedLive ? now : existingSession?.metadata.lastSeen ?? now,
          sessionCount: observedLive ? (existingSession ? existingSession.metadata.sessionCount + 1 : 1) : existingSession?.metadata.sessionCount ?? 0,
          ...visit,
          engagementScore: data.metadata?.engagementScore || existingSession?.metadata.engagementScore || 0,
          lastSegmentUpdate: data.segments ? now : existingSession?.metadata.lastSegmentUpdate || now,
          journeyStage: data.metadata?.journeyStage ?? existingSession?.metadata.journeyStage
        },
        preferences: {
          trackingConsent: data.preferences?.trackingConsent ?? existingSession?.preferences.trackingConsent ?? true,
          personalizationEnabled: data.preferences?.personalizationEnabled ?? existingSession?.preferences.personalizationEnabled ?? true,
          cookieConsent: data.preferences?.cookieConsent ?? existingSession?.preferences.cookieConsent ?? true
        }
      };

      // Validate the session data
      const resolvedConsent = await currentOwnerConsent() ?? consentOf(existingSession);
      if (resolvedConsent.tracking) {
        // Preserve a producer's first birth through awaited catalog/provider work.
        // A stored untagged profile is not a new record and cannot be enrolled here.
        if (!existingSession && !sessionData.retention) {
          sessionData.retention = retentionBirth(this.env, this.tenant, 'profile', now, now);
          sessionData.externalRetention = externalRetentionBirths(this.env, this.tenant, now, now);
        }
        pinProfileRetention(this.env, sessionData, this.tenant);
      }
      sessionData.preferences.trackingConsent = resolvedConsent.tracking;
      sessionData.preferences.personalizationEnabled = resolvedConsent.personalization;
      const validatedData = withConsent(sessionDataSchema.parse(sessionData), resolvedConsent);
      if (resolvedConsent.tracking) requireConsentPurpose(resolvedConsent, 'tracking');

      // CW31 (BTIE D10). A shopper who withheld tracking consent is still
      // ANSWERED, from the state that is already stored, and nothing this
      // request learned is kept. This is the object host's rule exactly
      // (ShopperReflex step 8, where the record is restored to what it was):
      // the two hosts must never disagree about the same shopper, because
      // REFLEX_HOST decides which one a brand runs on and consent is not a
      // property of that choice.
      //
      // Necessary explicit instructions are separate owner records. Neither a
      // missing instruction nor an old profile preference enables behavior.
      if (!validatedData.preferences.trackingConsent) {
        // Necessary choice authority lives separately on the owner. A refused
        // request neither creates nor refreshes a behavioral profile or pointer.
        return withConsent(existingSession ?? { ...validatedData, segments: [], attributes: {},
          metadata: { firstSeen: now, lastSeen: now, sessionCount: 0, engagementScore: 0, lastSegmentUpdate: now } }, resolvedConsent);
      }

      // The record, and the pointer that finds it by user id. These were two
      // awaits in sequence, which paid for two round trips where one would do;
      // neither depends on the other.
      const writes = Promise.all([
        this.kv.put(`session:${sessionId}`, JSON.stringify(validatedData), { expiration: Math.floor(Math.min(now + this.sessionTTL * 1000, validatedData.retention!.expiresAt) / 1000) }),
        this.kv.put(`user:${userId}`, sessionId, { expiration: Math.floor(Math.min(now + this.sessionTTL * 1000, validatedData.retention!.expiresAt) / 1000) }),
      ]);
      if (defer) defer(writes); else await writes;

      return validatedData;

    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      console.error('Error creating/updating session');
      throw error;
    }
  }

  /** One strict read for erasure: parsing must not discard the original byte witness. */
  async readSnapshot(sessionId: string): Promise<{ data: SessionData; serialized: string } | null> {
    if (this.principal) throw new SessionAccessError(); // Internal erasure only, never a capability bypass.
    try {
      const serialized = await new TenantKV(this.env.SESSIONS as unknown as KVLike, this.tenant).get(`session:${sessionId}`);
      if (serialized === null) return null;
      if (typeof serialized !== 'string') throw new SessionAccessError();
      return { data: sessionDataSchema.parse(JSON.parse(serialized)), serialized };
    } catch { throw new SessionAccessError(); }
  }

  /** The record exactly as stored, forward and all. */
  async readRaw(sessionId: string, strict = false): Promise<SessionData | null> {
    if (this.principal) assertSessionTarget(this.principal, undefined, sessionId);
    let raw: SessionData | null;
    try {
      const stored = await this.kv.get(`session:${sessionId}`, strict ? undefined : 'json');
      const sessionData = strict && stored !== null && typeof stored === 'string' ? JSON.parse(stored) : stored;
      raw = strict ? (stored === null ? null : sessionDataSchema.parse(sessionData)) : (sessionData ? sessionDataSchema.parse(sessionData) : null);
    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      if (this.principal || strict) throw new SessionAccessError();
      console.error('Error retrieving session');
      return null;
    }
    if (this.principal) {
      assertSessionTarget(this.principal);
      if (raw ? raw.userId !== this.principal.subject || !!raw.forwardTo
        || (this.principal.kind === 'anonymous' ? !!raw.identity : raw.identity?.shopperId !== this.principal.subject)
        : this.principal.kind === 'recognized') throw new SessionAccessError();
    }
    if (raw) {
      const consent = await currentOwnerConsent();
      if (consent?.instruction && (consent.instruction.tenant !== this.tenant || consent.instruction.subject !== raw.userId)) throw new SessionAccessError();
      if (consent) withConsent(raw, consent);
    }
    return raw;
  }

  /**
   * The session a request for `sessionId` actually lands on: the record itself,
   * or the person's session it forwards to. One hop. If the target has expired
   * the browser's own record is returned, which is what it had before the link.
   */
  async resolveRecord(sessionId: string): Promise<{ id: string; data: SessionData | null }> {
    const raw = await this.readRaw(sessionId);
    if (this.principal) return { id: sessionId, data: raw };
    if (raw?.forwardTo && raw.forwardTo !== sessionId) {
      const target = await this.readRaw(raw.forwardTo);
      if (target) {
        // The browser's record and its `user:` pointer are never rewritten by
        // the writes that now land on the person, so they would expire under a
        // browser that kept coming back. Refreshed once a day, off the hot path.
        const now = Date.now();
        if (now - raw.metadata.lastSeen > FORWARD_REFRESH_MS) {
          const refreshed = { ...raw, metadata: { ...raw.metadata, lastSeen: now } };
          await Promise.all([
            this.kv.put(`session:${sessionId}`, JSON.stringify(refreshed), { expirationTtl: this.sessionTTL }),
            this.kv.put(`user:${raw.userId}`, raw.forwardTo, { expirationTtl: this.sessionTTL }),
          ]);
        }
        return { id: raw.forwardTo, data: target };
      }
    }
    return { id: sessionId, data: raw };
  }

  /**
   * Get session data by session ID. Follows a link (CW25), so a browser that
   * was recognised reads the person's profile from its old cookie.
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    return (await this.resolveRecord(sessionId)).data;
  }

  /** Request-local owned read: cookies only restrict, and refusal is durable before use. */
  async readOwnedConsent(sessionId: string, cookieHeader?: string | null): Promise<{ sessionId: string; data: SessionData | null; consent: Consent }> {
    if (!this.principal) throw new SessionAccessError();
    let data = await this.readRaw(sessionId, true);
    const consent = intersectConsent(await currentOwnerConsent() ?? consentOf(data), consentFromCookies(cookieHeader));
    if (!consent.tracking || !consent.personalization) {
      await this.restrictConsent(sessionId, consent, { sessionId, data });
      if (data) data = withConsent({ ...data, preferences: { ...data.preferences, trackingConsent: consent.tracking, personalizationEnabled: consent.personalization } }, consent);
    }
    assertSessionTarget(this.principal, undefined, sessionId);
    if (data && consent.tracking && consent.personalization) pinProfileRetention(this.env, data, this.tenant);
    return { sessionId, data, consent };
  }

  /** Buffered actions require an existing exact signed record, never a pointer or cold profile. */
  async readBufferedSession(): Promise<SessionData> {
    if (!this.principal) throw new SessionAccessError();
    const sessionId = this.principal.sessionId;
    assertSessionTarget(this.principal, undefined, sessionId);
    try {
      const text = await this.kv.get(`session:${sessionId}`);
      if (typeof text !== 'string') throw new SessionAccessError();
      const data = JSON.parse(text) as SessionData;
      this.checkedSnapshot(sessionId, { sessionId, data });
      if (data.forwardTo !== undefined) throw new SessionAccessError();
      if (data.reflex !== undefined) historicalReflexSchema.parse(data.reflex);
      // Validate with the schema, but retain original unrelated fields verbatim.
      const consent = await currentOwnerConsent() ?? { tracking: false, personalization: false };
      if (consent.tracking) pinProfileRetention(this.env, data, this.tenant);
      return withConsent(data, consent);
    } catch { throw new SessionAccessError(); }
  }

  /** Narrow non-atomic write: preserve the exact key's observed absolute lifetime and metadata. */
  async writeBufferedSession(previous: SessionData, patch: Pick<SessionData, 'preferences'> & Partial<Pick<SessionData, 'reflex' | 'segments'>>): Promise<void> {
    if (!this.principal) throw new SessionAccessError();
    const sessionId = this.principal.sessionId, key = `session:${sessionId}`;
    this.checkedSnapshot(sessionId, { sessionId, data: previous });
    const page = await this.kv.list({ prefix: key, limit: 1 });
    const row = page?.keys?.length === 1 ? page.keys[0] as { name: string; expiration?: unknown; metadata?: unknown } : undefined;
    if (!row || row.name !== key) throw new SessionAccessError();
    const options: { expiration?: number; metadata?: unknown } = {};
    if (Object.hasOwn(row, 'expiration')) {
      if (typeof row.expiration !== 'number' || !Number.isSafeInteger(row.expiration)
        || row.expiration < Math.ceil(Date.now() / 1000) + 60) throw new SessionAccessError();
      options.expiration = row.expiration;
    }
    if (Object.hasOwn(row, 'metadata')) {
      if (row.metadata === undefined || JSON.stringify(row.metadata) === undefined) throw new SessionAccessError();
      options.metadata = row.metadata;
    }
    const next = { ...previous, ...patch };
    this.checkedSnapshot(sessionId, { sessionId, data: next });
    await this.kv.put(key, JSON.stringify(next), options);
  }

  /** Necessary refusal storage only: no visit, profile merge, or user-pointer write. */
  async restrictConsent(sessionId: string, hints: Consent, ownedSnapshot?: { sessionId: string; data: SessionData | null }): Promise<Consent> {
    const previous = ownedSnapshot ? this.checkedSnapshot(sessionId, ownedSnapshot) : await this.readRaw(sessionId, true);
    const consent = intersectConsent(await currentOwnerConsent() ?? consentOf(previous), hints);
    // Do not renew an existing full-profile TTL merely to remember a restriction.
    return await restrictOwnerConsent(consent) ?? consent;
  }

  /** Request-local state already read by the owned action lane, never a caller payload. */
  private checkedSnapshot(sessionId: string, snapshot: { sessionId: string; data: SessionData | null }): SessionData | null {
    if (!this.principal || snapshot.sessionId !== sessionId) throw new SessionAccessError();
    assertSessionTarget(this.principal, undefined, sessionId);
    const raw = snapshot.data === null ? null : withConsent(sessionDataSchema.parse(snapshot.data), consentOf(snapshot.data));
    if (raw ? raw.userId !== this.principal.subject || !!raw.forwardTo
      || (this.principal.kind === 'anonymous' ? !!raw.identity : raw.identity?.shopperId !== this.principal.subject)
      : this.principal.kind === 'recognized') throw new SessionAccessError();
    return raw;
  }

  /**
   * CW25. Fold a browser's session into a person's, and leave the browser's
   * record forwarding there.
   *
   * The person's session is `user:{shopperId}`'s, created here on the first
   * link. The reflex vectors merge on the decay invariant (identityMerge.ts);
   * visits add, because two devices' visits are one person's visits; first seen
   * is the earliest, last seen the latest, the counters sum, and on anything
   * else the person's existing record wins over the browser's. Segments are
   * unioned and the reflex memberships re-evaluated, so the returned changes
   * are exactly what the link did to this person's audiences.
   */
  async absorbIntoShopper(input: {
    shopperId: string;
    /** The browser being linked. Its `user:` key is pointed at the person even when it had no session yet. */
    visitorId?: string;
    from: SessionData | null;
    fromSessionId: string | null;
    config: ReflexConfig;
    now?: number;
    /**
     * `merge` folds the browser's profile in (a first link). `repoint` only moves
     * the browser: it was linked to someone else before, its profile already
     * went there, and a shared computer's second account must not inherit it.
     */
    mode?: 'merge' | 'repoint';
    /** Public identity transitions intersect, never upgrade, the source switches. */
    consent?: Consent;
  }): Promise<{ sessionId: string; data: SessionData; changes: ReflexChanges; created: boolean }> {
    const now = input.now ?? Date.now();
    const { shopperId } = input;
    const browserId = input.visitorId ?? input.from?.userId;
    // THE GUARD. Only a browser's own record is ever folded or forwarded: one
    // that carries no identity and is named by the browser being linked. A
    // person's session handed in here by mistake (the `user:` key of a linked
    // browser points at the person, not the browser) must never be forwarded to
    // another person, which would hand one shopper's profile to another.
    const from = input.from && !input.from.identity && input.from.userId === browserId ? input.from : null;

    let canonicalId = (await this.kv.get(`user:${shopperId}`)) as string | null;
    const base: SessionData | null = canonicalId ? await this.readRaw(canonicalId, input.consent !== undefined) : null;
    const created = !base;
    if (!base) canonicalId = this.generateSessionId();
    // A browser already forwarding here, or one being repointed, has nothing to fold in.
    const fold = input.mode !== 'repoint' && from && from.forwardTo !== canonicalId && from.userId !== shopperId ? from : null;

    const merged = mergeReflexStates(base?.reflex, fold?.reflex, now, input.config);
    const profileEnrichment = mergeEnrichment(base?.profileEnrichment, fold?.profileEnrichment);
    const previousExternal = new Set([...enrichmentInputs(base?.profileEnrichment).audiences, ...enrichmentInputs(fold?.profileEnrichment).audiences]);
    const counters: Record<string, unknown> = { ...(fold?.attributes ?? {}), ...(base?.attributes ?? {}) };
    for (const k of Object.keys(fold?.attributes ?? {})) {
      const a = base?.attributes?.[k]; const b = fold?.attributes?.[k];
      if (typeof a === 'number' && typeof b === 'number' && COUNTER_ATTRIBUTES.has(k)) counters[k] = a + b;
    }

    const odp = await mergeOdpState(this.env, this.tenant, base, fold);
    const oldOdp = new Set([...(base?.odpSeed ?? []), ...(fold?.odpSeed ?? [])]);
    const data: SessionData = {
      userId: shopperId,
      anonymousId: base?.anonymousId ?? fold?.anonymousId,
      segments: [...new Set([...[
        ...(base?.segments ?? []).filter(s => !base?.odpSeed?.includes(s)),
        ...(fold?.segments ?? []).filter(s => !fold?.odpSeed?.includes(s)),
      ].filter(segment => !previousExternal.has(segment)), ...merged.state.audiences, ...enrichmentInputs(profileEnrichment).audiences, ...odp.odpSeed])].sort(),
      attributes: counters,
      surface: base?.surface ?? fold?.surface,
      reflex: merged.state,
      profileEnrichment,
      ...odp,
      identity: base?.identity ?? { shopperId, linkedAt: now },
      metadata: {
        firstSeen: Math.min(base?.metadata.firstSeen ?? now, fold?.metadata.firstSeen ?? now),
        lastSeen: Math.max(base?.metadata.lastSeen ?? 0, fold?.metadata.lastSeen ?? 0) || now,
        sessionCount: (base?.metadata.sessionCount ?? 0) + (fold?.metadata.sessionCount ?? 0),
        ...mergeVisits(base?.metadata, fold?.metadata),
        engagementScore: Math.max(base?.metadata.engagementScore ?? 0, fold?.metadata.engagementScore ?? 0),
        lastSegmentUpdate: now,
        journeyStage: base?.metadata.journeyStage ?? fold?.metadata.journeyStage,
      },
      preferences: base?.preferences ?? fold?.preferences ?? { trackingConsent: false, personalizationEnabled: false, cookieConsent: true },
    };
    if (oldOdp.size) data.metadata.journeyStage = deriveStage({ userId: shopperId, attributes: counters, segments: data.segments });
    if (input.consent) {
      const consent = intersectConsent(consentOf(data), input.consent);
      data.preferences = { ...data.preferences, trackingConsent: consent.tracking, personalizationEnabled: consent.personalization };
    }
    const validated = sessionDataSchema.parse(data);

    await this.kv.put(`session:${canonicalId}`, JSON.stringify(validated), { expirationTtl: this.sessionTTL });
    await this.kv.put(`user:${shopperId}`, canonicalId!, { expirationTtl: this.sessionTTL });
    if (browserId && browserId !== shopperId) {
      await this.kv.put(`user:${browserId}`, canonicalId!, { expirationTtl: this.sessionTTL });
    }
    if (from) {
      if (input.fromSessionId && input.fromSessionId !== canonicalId) {
        // The browser's record stays as it was, plus the pointer: roll forward, never rewind.
        const tomb = sessionDataSchema.parse({ ...from, forwardTo: canonicalId });
        await this.kv.put(`session:${input.fromSessionId}`, JSON.stringify(tomb), { expirationTtl: this.sessionTTL });
      }
    }
    return { sessionId: canonicalId!, data: validated, changes: merged.changes, created };
  }

  /**
   * Fold history into the current, explicitly consenting canonical profile.
   * Backend import cannot create consent or follow a stale forwarding record.
   * This KV read/write is not a cross-isolate transaction.
   */
  async applyImport(input: {
    userId: string;
    rows: Array<{ action: string; at: number; touches: Touch[] } | ProfileSnapshotRow>;
    config: ReflexConfig;
    now?: number;
  }): Promise<{ applied: false; reason: 'profile_missing' | 'consent_missing' | 'consent_refused' }
    | { applied: true; sessionId: string; data: SessionData; created: false; outcomes: ImportOutcome[] }> {
    if (!ownerOperationActive(this.env)) {
      const result = await importUnderOwner(this.env, this.tenant, input.userId, { rows: input.rows, now: input.now ?? Date.now() }) as {
        ok?: boolean; reason?: 'profile_missing' | 'consent_missing' | 'consent_refused'; data?: SessionData; sessionId?: string; outcomes?: ImportOutcome[];
      };
      if (result.ok !== true) throw new SessionAccessError();
      if (result.reason) return { applied: false, reason: result.reason };
      if (!result.data || !result.sessionId || !Array.isArray(result.outcomes)) throw new SessionAccessError();
      return { applied: true, data: sessionDataSchema.parse(result.data), sessionId: result.sessionId, outcomes: result.outcomes, created: false };
    }
    const now = input.now ?? Date.now();
    const sessionId = await this.kv.get(`user:${input.userId}`);
    if (sessionId === null) return { applied: false, reason: 'profile_missing' };
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(sessionId)) throw new SessionAccessError();
    const stored = await this.kv.get(`session:${sessionId}`);
    if (stored === null) return { applied: false, reason: 'profile_missing' };
    if (typeof stored !== 'string') throw new SessionAccessError();
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(stored);
      sessionDataSchema.omit({ preferences: true }).parse(raw);
      if (raw.reflex !== undefined) historicalReflexSchema.parse(raw.reflex);
    } catch { throw new SessionAccessError(); }
    if (raw.userId !== input.userId || raw.forwardTo !== undefined
      || (isShopperId(input.userId)
        ? (raw.identity as SessionData['identity'])?.shopperId !== input.userId : raw.identity !== undefined)) throw new SessionAccessError();
    if (raw.preferences === undefined) return { applied: false, reason: 'consent_missing' };
    if (!raw.preferences || typeof raw.preferences !== 'object' || Array.isArray(raw.preferences)) throw new SessionAccessError();
    const preferences = raw.preferences as Partial<SessionData['preferences']>;
    for (const value of [preferences.trackingConsent, preferences.personalizationEnabled]) {
      if (value !== undefined && typeof value !== 'boolean') throw new SessionAccessError();
    }
    if (preferences.trackingConsent === undefined || preferences.personalizationEnabled === undefined) return { applied: false, reason: 'consent_missing' };
    let existing: SessionData;
    try { existing = sessionDataSchema.parse(raw); } catch { throw new SessionAccessError(); }
    const consent = await currentOwnerConsent();
    if (!consent?.tracking || !consent.personalization) return { applied: false, reason: 'consent_refused' };
    requireConsentPurpose(consent, 'personalization');
    const retention = pinProfileRetention(this.env, existing, this.tenant);
    let state = existing.reflex ?? null;
    let profileEnrichment = readEnrichment(existing.profileEnrichment);
    let behavioral = false;
    const outcomes: ImportOutcome[] = [];
    for (const [index, row] of input.rows.entries()) {
      if ('kind' in row) {
        const next = applyProfileSnapshot(profileEnrichment, row, now);
        profileEnrichment = next.state;
        outcomes.push(next.reason ? { index, applied: false, reason: next.reason } : { index, applied: true });
      } else {
        state = applyHistorical(state, { action: row.action, touches: row.touches }, row.at, input.config);
        behavioral = true;
        outcomes.push({ index, applied: true });
      }
    }
    // A replay is a read, not a TTL refresh or a behavioral tick.
    if (!outcomes.some(outcome => outcome.applied)) return { applied: true, sessionId, data: existing, created: false, outcomes };
    const reflex = behavioral ? tick(state, now, input.config).state : existing.reflex;
    const oldExternal = new Set(enrichmentInputs(existing.profileEnrichment).audiences);
    const data: SessionData = {
      ...existing, reflex, profileEnrichment,
      segments: [...new Set([...existing.segments.filter(segment => !oldExternal.has(segment)), ...(reflex?.audiences ?? []), ...enrichmentInputs(profileEnrichment).audiences])].sort(),
      metadata: { ...existing.metadata, lastSegmentUpdate: now },
    };
    const validated = sessionDataSchema.parse(data);
    const key = `session:${sessionId}`, listed = await this.kv.list({ prefix: key, limit: 2 });
    const entry = listed.keys.find(entry => entry.name === key) as { name: string; expiration?: number; metadata?: unknown } | undefined;
    if (!entry) throw new SessionAccessError();
    const expiration = Math.min(Math.floor(retention.expiresAt / 1000), entry.expiration ?? Infinity);
    if (expiration < Math.ceil(Date.now() / 1000) + 60) throw new SessionAccessError();
    pinProfileRetention(this.env, existing, this.tenant);
    await this.kv.put(key, JSON.stringify(validated), { expiration, ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }) });
    return { applied: true, sessionId, data: validated, created: false, outcomes };
  }

  /**
   * CW28. Forget a browser entirely: its `user:` pointer, and its own record
   * when the link remembered one (after a link the pointer names the person, so
   * the browser's pre-link record is reachable only this way).
   */
  async forgetVisitor(userId: string, ownSessionId?: string | null): Promise<void> {
    try {
      if (ownSessionId) await this.kv.delete(`session:${ownSessionId}`);
      await this.kv.delete(`user:${userId}`);
    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      console.error('Error forgetting visitor');
    }
  }

  /**
   * Get session data by user ID
   */
  async getSessionByUserId(userId: string): Promise<SessionData | null> {
    if (this.principal) {
      assertSessionTarget(this.principal, userId);
      return this.getSession(this.principal.sessionId);
    }
    try {
      const sessionId = (await this.kv.get(`user:${userId}`)) as string | null;
      if (!sessionId) {
        return null;
      }

      return this.getSession(sessionId);
    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      console.error('Error retrieving session by user ID');
      return null;
    }
  }

  /**
   * Resolve the current sessionId for a stable userId (anon vuid), if any.
   * Used as a continuity fallback when the session cookie is absent or blocked.
   */
  async resolveSessionIdByUserId(userId: string): Promise<string | null> {
    if (this.principal) {
      assertSessionTarget(this.principal, userId);
      return this.principal.sessionId;
    }
    try {
      return (await this.kv.get(`user:${userId}`)) as string | null;
    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      console.error('Error resolving session id by user ID');
      return null;
    }
  }

  /**
   * Update user segments in session
   */
  async updateUserSegments(
    sessionId: string,
    segments: string[],
    engagementScore?: number
  ): Promise<SessionData | null> {
    try {
      const existingSession = await this.getSession(sessionId);
      if (!existingSession) {
        return null;
      }

      const updatedSession = await this.createOrUpdateSession(sessionId, existingSession.userId, {
        ...existingSession,
        segments,
        metadata: {
          ...existingSession.metadata,
          engagementScore: engagementScore ?? existingSession.metadata.engagementScore,
          lastSegmentUpdate: Date.now()
        }
      }, undefined, undefined, undefined, false);

      return updatedSession;
    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      console.error('Error updating user segments');
      return null;
    }
  }

  /**
   * Generate secure cookies for client-side persistence
   */
  generateSessionCookies(sessionData: SessionData, sessionId: string): CookieConfig[] {
    const consent = consentOf(sessionData);
    const cookieOptions: Partial<CookieConfig> = {
      maxAge: Math.max(0, Math.min(this.sessionTTL, Math.floor(((sessionData.retention?.expiresAt ?? 0) - Date.now()) / 1000))),
      httpOnly: false, // Need to be accessible to JavaScript for personalization
      secure: this.isSecure,
      sameSite: 'Lax',
      path: '/',
      ...(this.cookieDomain && { domain: this.cookieDomain })
    };

    const cookies: CookieConfig[] = [
      {
        name: 'opt_session_id',
        value: sessionId,
        ...cookieOptions,
        httpOnly: true // Session ID should be HTTP-only for security
      },
      {
        name: 'opt_user_id',
        value: sessionData.userId,
        ...cookieOptions
      },
      {
        name: 'opt_segments',
        value: sessionData.segments.join(','),
        ...cookieOptions
      },
      {
        name: 'opt_engagement_score',
        value: sessionData.metadata.engagementScore.toString(),
        ...cookieOptions
      },
      {
        name: 'opt_last_update',
        value: sessionData.metadata.lastSegmentUpdate.toString(),
        ...cookieOptions
      },
      {
        name: 'opt_tracking_consent',
        value: consent.tracking.toString(),
        ...cookieOptions, maxAge: Math.max(0, Math.floor(((consent.instruction?.tracking?.expiresAt ?? 0) - Date.now()) / 1000))
      },
      {
        name: 'opt_personalization_enabled',
        value: consent.personalization.toString(),
        ...cookieOptions, maxAge: Math.max(0, Math.floor(((consent.instruction?.personalization?.expiresAt ?? 0) - Date.now()) / 1000))
      }
    ];

    // Add anonymous ID cookie if available
    if (sessionData.anonymousId) {
      cookies.push({
        name: 'opt_anonymous_id',
        value: sessionData.anonymousId,
        ...cookieOptions
      });
    }

    return cookies;
  }

  /** Necessary preference mirrors only; never inspect or serialize a behavioral profile. */
  generateConsentCookieHeaders(preferences: Pick<SessionData['preferences'], 'trackingConsent' | 'personalizationEnabled'>, consent: Consent = REFUSING): string[] {
    return this.createCookieHeaders([
      { name: 'opt_tracking_consent', value: String(preferences.trackingConsent) },
      { name: 'opt_personalization_enabled', value: String(preferences.personalizationEnabled) },
    ].map((cookie, index) => ({ ...cookie, maxAge: Math.max(0, Math.floor(((consent.instruction?.[index === 0 ? 'tracking' : 'personalization']?.expiresAt ?? 0) - Date.now()) / 1000)), secure: this.isSecure, sameSite: 'Lax', path: '/', ...(this.cookieDomain && { domain: this.cookieDomain }) })));
  }

  /**
   * Parse session cookies from request headers
   */
  parseSessionCookies(cookieHeader: string | null): Partial<SessionCookies> {
    if (!cookieHeader) {
      return {};
    }

    const cookies: Record<string, string> = {};
    
    cookieHeader.split(';').forEach(cookie => {
      const [name, ...value] = cookie.trim().split('=');
      if (name && value.length > 0) {
        cookies[name] = decodeURIComponent(value.join('='));
      }
    });

    return {
      sessionId: cookies['opt_session_id'],
      userId: cookies['opt_user_id'],
      anonymousId: cookies['opt_anonymous_id'],
      segments: cookies['opt_segments'],
      engagementScore: cookies['opt_engagement_score'],
      lastUpdate: cookies['opt_last_update'],
      trackingConsent: cookies['opt_tracking_consent'],
      personalizationEnabled: cookies['opt_personalization_enabled']
    };
  }

  /**
   * Create cookie header string for HTTP response
   */
  /**
   * Private identity/profile mirrors only. Refusal cookies must survive logout/reset.
   * `maxAge` 0 is rendered by hand because createCookieHeaders treats 0 as unset.
   */
  clearCookieHeaders(): string[] {
    const names = ['opt_session_id', 'opt_user_id', 'opt_anonymous_id', 'opt_segments',
      'opt_engagement_score', 'opt_last_update'];
    const domain = this.cookieDomain ? `; Domain=${this.cookieDomain}` : '';
    return names.map((n) => `${n}=; Max-Age=0; Path=/${domain}; SameSite=Lax`);
  }

  createCookieHeaders(cookies: CookieConfig[]): string[] {
    return cookies.map(cookie => {
      let header = `${cookie.name}=${encodeURIComponent(cookie.value)}`;
      
      if (cookie.maxAge) {
        header += `; Max-Age=${cookie.maxAge}`;
      }
      
      if (cookie.domain) {
        header += `; Domain=${cookie.domain}`;
      }
      
      if (cookie.path) {
        header += `; Path=${cookie.path}`;
      }
      
      if (cookie.secure) {
        header += '; Secure';
      }
      
      if (cookie.httpOnly) {
        header += '; HttpOnly';
      }
      
      if (cookie.sameSite) {
        header += `; SameSite=${cookie.sameSite}`;
      }
      
      return header;
    });
  }

  /**
   * Generate a new session ID
   */
  generateSessionId(): string {
    return crypto.randomUUID();
  }

  /**
   * Delete session and clear cookies
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    if (this.principal) assertSessionTarget(this.principal, undefined, sessionId);
    try {
      // The record as stored, NOT what it forwards to: deleting a linked
      // browser's session detaches that browser; only the person's own session
      // id erases the person.
      const sessionData = await this.readRaw(sessionId);
      
      // Delete session data
      await this.kv.delete(`session:${sessionId}`);
      
      // Delete user ID mapping
      if (sessionData) {
        await this.kv.delete(`user:${sessionData.userId}`);
      }

      return true;
    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      console.error('Error deleting session');
      return false;
    }
  }

  /**
   * Clear expired sessions (to be called by scheduled worker)
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      // KV automatically handles TTL expiration, but we can manually clean up if needed
      // This is more for logging/metrics purposes
      console.log('Session cleanup scheduled - KV TTL handles automatic expiration');
      return 0;
    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      console.error('Error during session cleanup');
      return 0;
    }
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
    try {
      const sessionData = await this.getSession(sessionId);
      if (!sessionData) {
        return null;
      }

      const sessionDuration = Date.now() - sessionData.metadata.firstSeen;
      pinProfileRetention(this.env, sessionData, this.tenant);
      
      return {
        sessionDuration,
        pageViews: sessionData.attributes.page_views || 0,
        engagementScore: sessionData.metadata.engagementScore,
        segmentHistory: projectedOdpSegments(sessionData.segments, sessionData, await projectOdpState(this.env, this.tenant, sessionData))
      };
    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      console.error('Error retrieving session analytics');
      return null;
    }
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(
    sessionId: string,
    preferences: Partial<SessionData['preferences']>,
    cookieHeader?: string | null,
  ): Promise<SessionData | null> {
    if (this.principal) {
      const existing = await this.readRaw(sessionId, true);
      const restricted = intersectConsent(await currentOwnerConsent() ?? consentOf(existing), consentFromCookies(cookieHeader));
      const effective = {
        trackingConsent: restricted.tracking && preferences.trackingConsent !== false,
        personalizationEnabled: restricted.personalization && preferences.personalizationEnabled !== false,
        cookieConsent: preferences.cookieConsent ?? existing?.preferences.cookieConsent ?? true,
      };
      // Anonymous absence is not a visit. Only an instruction to refuse may create it.
      if (!existing) return null;
      const now = Date.now();
      const updated = sessionDataSchema.parse({
        ...(existing ?? { userId: this.principal.subject, segments: [], attributes: {},
          metadata: { firstSeen: now, lastSeen: now, sessionCount: 0, engagementScore: 0, lastSegmentUpdate: now } }),
        preferences: effective,
      });
      assertSessionTarget(this.principal, undefined, sessionId);
      await this.writeBufferedSession(existing, { preferences: updated.preferences });
      assertSessionTarget(this.principal, undefined, sessionId);
      return withConsent(updated, restricted);
    }
    try {
      const existingSession = await this.getSession(sessionId);
      if (!existingSession) {
        return null;
      }

      return this.createOrUpdateSession(sessionId, existingSession.userId, {
        ...existingSession,
        preferences: {
          ...existingSession.preferences,
          ...preferences
        }
      }, undefined, undefined, undefined, false);
    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      console.error('Error updating user preferences');
      return null;
    }
  }
}
