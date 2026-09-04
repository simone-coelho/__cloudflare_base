import type { Env } from '@/types/env';
import type { ReflexChanges, ReflexConfig, ReflexState } from '@/reflex/core';
import { mergeReflexStates } from '@/reflex/identityMerge';
import { z } from 'zod';

import {
  classifyEntryChannel, isNewVisit, nextVisitCount,
  type ChannelSignals, type EntryChannel,
} from '@/services/visit';
import { DEFAULT_TENANT, TenantKV, type KVLike, type TenantId } from '@/tenancy/tenant';

export interface SessionData {
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
  /** ODP loop (doc 16 §8): the session's last-seeded qualified ODP audiences + when. */
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

const sessionDataSchema = z.object({
  userId: z.string(),
  anonymousId: z.string().optional(),
  segments: z.array(z.string()),
  attributes: z.record(z.string(), z.any()),
  // Declared or .parse() silently STRIPS it on every read/write (same trap as reflex).
  surface: z.string().optional(),
  // Reflex state must be declared or .parse() silently STRIPS it on every read/write.
  reflex: z.any().optional(),
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
  private sessionTTL: number = 30 * 24 * 60 * 60; // 30 days in seconds
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

  constructor(env: Env, options?: { domain?: string; secure?: boolean; tenant?: TenantId }) {
    this.env = env;
    this.tenant = options?.tenant ?? DEFAULT_TENANT;
    this.kv = new TenantKV(env.SESSIONS as unknown as KVLike, this.tenant);
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
  ): Promise<SessionData> {
    try {
      // CW25. A browser that was linked to a person writes to the person's
      // session; the id on the cookie stays what it was, the record it names
      // forwards. Resolved once here, for the read below and the write at the end.
      const target = await this.resolveRecord(sessionId);
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
      const openingNewVisit = isNewVisit(priorLastSeen, now);
      const visitCount = nextVisitCount(existingSession?.metadata.visitCount, priorLastSeen, now);
      // A record written before visitCount existed resolves to visit 1. That
      // under-counts a returning shopper once, which is honest; seeding from
      // sessionCount would import its wrongness instead.
      const entryChannel: EntryChannel = openingNewVisit && entry
        ? classifyEntryChannel(entry)
        : (existingSession?.metadata.entryChannel ?? (entry ? classifyEntryChannel(entry) : 'direct'));

      const sessionData: SessionData = {
        userId,
        anonymousId: data.anonymousId || existingSession?.anonymousId,
        segments: data.segments || existingSession?.segments || ['new_user'],
        attributes: {
          ...existingSession?.attributes,
          ...data.attributes
        },
        surface: data.surface ?? existingSession?.surface,
        reflex: data.reflex ?? existingSession?.reflex,
        odpSeed: data.odpSeed ?? existingSession?.odpSeed,
        odpSeedAt: data.odpSeedAt ?? existingSession?.odpSeedAt,
        odpRecentEvents: data.odpRecentEvents ?? existingSession?.odpRecentEvents,
        identity: data.identity ?? existingSession?.identity,
        metadata: {
          firstSeen: existingSession?.metadata.firstSeen || now,
          lastSeen: now,
          sessionCount: existingSession ? existingSession.metadata.sessionCount + 1 : 1,
          visitCount,
          lastVisitAt: openingNewVisit ? now : (existingSession?.metadata.lastVisitAt ?? now),
          entryChannel,
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
      const validatedData = sessionDataSchema.parse(sessionData);

      // Store session in KV
      await this.kv.put(
        `session:${sessionId}`,
        JSON.stringify(validatedData),
        { expirationTtl: this.sessionTTL }
      );

      // Also store by userId for quick lookup
      await this.kv.put(
        `user:${userId}`,
        sessionId,
        { expirationTtl: this.sessionTTL }
      );

      return validatedData;

    } catch (error) {
      console.error('Error creating/updating session:', error);
      throw error;
    }
  }

  /** The record exactly as stored, forward and all. */
  async readRaw(sessionId: string): Promise<SessionData | null> {
    try {
      const sessionData = await this.kv.get(`session:${sessionId}`, 'json');
      if (!sessionData) return null;
      return sessionDataSchema.parse(sessionData);
    } catch (error) {
      console.error('Error retrieving session:', error);
      return null;
    }
  }

  /**
   * The session a request for `sessionId` actually lands on: the record itself,
   * or the person's session it forwards to. One hop. If the target has expired
   * the browser's own record is returned, which is what it had before the link.
   */
  async resolveRecord(sessionId: string): Promise<{ id: string; data: SessionData | null }> {
    const raw = await this.readRaw(sessionId);
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
    let base: SessionData | null = canonicalId ? await this.readRaw(canonicalId) : null;
    const created = !base;
    if (!base) canonicalId = this.generateSessionId();
    // A browser already forwarding here, or one being repointed, has nothing to fold in.
    const fold = input.mode !== 'repoint' && from && from.forwardTo !== canonicalId && from.userId !== shopperId ? from : null;

    const merged = mergeReflexStates(base?.reflex, fold?.reflex, now, input.config);
    const counters: Record<string, unknown> = { ...(fold?.attributes ?? {}), ...(base?.attributes ?? {}) };
    for (const k of Object.keys(fold?.attributes ?? {})) {
      const a = base?.attributes?.[k]; const b = fold?.attributes?.[k];
      if (typeof a === 'number' && typeof b === 'number' && COUNTER_ATTRIBUTES.has(k)) counters[k] = a + b;
    }
    const laterVisit = (fold?.metadata.lastVisitAt ?? 0) > (base?.metadata.lastVisitAt ?? 0) ? fold : base;

    const data: SessionData = {
      userId: shopperId,
      anonymousId: base?.anonymousId ?? fold?.anonymousId,
      segments: [...new Set([...(base?.segments ?? []), ...(fold?.segments ?? []), ...merged.state.audiences])].sort(),
      attributes: counters,
      surface: base?.surface ?? fold?.surface,
      reflex: merged.state,
      odpSeed: base?.odpSeed ?? fold?.odpSeed,
      odpSeedAt: base?.odpSeedAt ?? fold?.odpSeedAt,
      odpRecentEvents: [...(fold?.odpRecentEvents ?? []), ...(base?.odpRecentEvents ?? [])].slice(-10),
      identity: base?.identity ?? { shopperId, linkedAt: now },
      metadata: {
        firstSeen: Math.min(base?.metadata.firstSeen ?? now, fold?.metadata.firstSeen ?? now),
        lastSeen: Math.max(base?.metadata.lastSeen ?? 0, fold?.metadata.lastSeen ?? 0) || now,
        sessionCount: (base?.metadata.sessionCount ?? 0) + (fold?.metadata.sessionCount ?? 0),
        visitCount: (base?.metadata.visitCount ?? 0) + (fold?.metadata.visitCount ?? 0) || undefined,
        lastVisitAt: laterVisit?.metadata.lastVisitAt,
        entryChannel: laterVisit?.metadata.entryChannel,
        engagementScore: Math.max(base?.metadata.engagementScore ?? 0, fold?.metadata.engagementScore ?? 0),
        lastSegmentUpdate: now,
        journeyStage: base?.metadata.journeyStage ?? fold?.metadata.journeyStage,
      },
      preferences: base?.preferences ?? fold?.preferences ?? { trackingConsent: true, personalizationEnabled: true, cookieConsent: true },
    };
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
   * CW25. Write an imported reflex vector onto a shopper's session, and nothing
   * else about the visit. History informs interest; it does not claim visits the
   * engine never saw, so lastSeen and the visit number are left exactly as they
   * were. A shopper met first through an import gets a record with the identity
   * block and no visit at all.
   */
  async applyImport(input: {
    userId: string;
    reflex: ReflexState;
    identity?: { shopperId: string; linkedAt: number };
    now?: number;
  }): Promise<{ sessionId: string; data: SessionData; created: boolean }> {
    const now = input.now ?? Date.now();
    const sid0 = (await this.kv.get(`user:${input.userId}`)) as string | null;
    const resolved = sid0 ? await this.resolveRecord(sid0) : { id: this.generateSessionId(), data: null };
    const existing = resolved.data;
    const sessionId = resolved.id;
    const data: SessionData = existing
      ? {
          ...existing,
          reflex: input.reflex,
          segments: [...new Set([...existing.segments, ...input.reflex.audiences])].sort(),
          identity: existing.identity ?? input.identity,
          metadata: { ...existing.metadata, lastSegmentUpdate: now },
        }
      : {
          userId: input.userId,
          segments: [...input.reflex.audiences].sort(),
          attributes: {},
          reflex: input.reflex,
          identity: input.identity,
          metadata: { firstSeen: now, lastSeen: 0, sessionCount: 0, engagementScore: 0, lastSegmentUpdate: now },
          preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true },
        };
    const validated = sessionDataSchema.parse(data);
    await this.kv.put(`session:${sessionId}`, JSON.stringify(validated), { expirationTtl: this.sessionTTL });
    await this.kv.put(`user:${validated.userId}`, sessionId, { expirationTtl: this.sessionTTL });
    return { sessionId, data: validated, created: !existing };
  }

  /**
   * Get session data by user ID
   */
  async getSessionByUserId(userId: string): Promise<SessionData | null> {
    try {
      const sessionId = (await this.kv.get(`user:${userId}`)) as string | null;
      if (!sessionId) {
        return null;
      }

      return this.getSession(sessionId);
    } catch (error) {
      console.error('Error retrieving session by user ID:', error);
      return null;
    }
  }

  /**
   * Resolve the current sessionId for a stable userId (anon vuid), if any.
   * Used as a continuity fallback when the session cookie is absent or blocked.
   */
  async resolveSessionIdByUserId(userId: string): Promise<string | null> {
    try {
      return (await this.kv.get(`user:${userId}`)) as string | null;
    } catch (error) {
      console.error('Error resolving session id by user ID:', error);
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
      });

      return updatedSession;
    } catch (error) {
      console.error('Error updating user segments:', error);
      return null;
    }
  }

  /**
   * Generate secure cookies for client-side persistence
   */
  generateSessionCookies(sessionData: SessionData, sessionId: string): CookieConfig[] {
    const cookieOptions: Partial<CookieConfig> = {
      maxAge: this.sessionTTL,
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
        value: sessionData.preferences.trackingConsent.toString(),
        ...cookieOptions
      },
      {
        name: 'opt_personalization_enabled',
        value: sessionData.preferences.personalizationEnabled.toString(),
        ...cookieOptions
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
   * CW25. Every cookie this manager sets, expired. What a detach (logout) sends:
   * the device forgets which session it was on; nothing server-side changes.
   * `maxAge` 0 is rendered by hand because createCookieHeaders treats 0 as unset.
   */
  clearCookieHeaders(): string[] {
    const names = ['opt_session_id', 'opt_user_id', 'opt_anonymous_id', 'opt_segments',
      'opt_engagement_score', 'opt_last_update', 'opt_tracking_consent', 'opt_personalization_enabled'];
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
      console.error('Error deleting session:', error);
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
      console.error('Error during session cleanup:', error);
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
      
      return {
        sessionDuration,
        pageViews: sessionData.attributes.page_views || 0,
        engagementScore: sessionData.metadata.engagementScore,
        segmentHistory: sessionData.segments
      };
    } catch (error) {
      console.error('Error retrieving session analytics:', error);
      return null;
    }
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(
    sessionId: string,
    preferences: Partial<SessionData['preferences']>
  ): Promise<SessionData | null> {
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
      });
    } catch (error) {
      console.error('Error updating user preferences:', error);
      return null;
    }
  }
}