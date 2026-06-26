import type { Env } from '@/types/env';
import { z } from 'zod';

export interface SessionData {
  userId: string;
  anonymousId?: string;
  segments: string[];
  attributes: Record<string, any>;
  metadata: {
    firstSeen: number;
    lastSeen: number;
    sessionCount: number;
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
  metadata: z.object({
    firstSeen: z.number(),
    lastSeen: z.number(),
    sessionCount: z.number(),
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

export class SessionManager {
  private env: Env;
  private sessionTTL: number = 30 * 24 * 60 * 60; // 30 days in seconds
  private cookieDomain: string;
  private isSecure: boolean;

  constructor(env: Env, options?: { domain?: string; secure?: boolean }) {
    this.env = env;
    this.cookieDomain = options?.domain || '';
    this.isSecure = options?.secure ?? true;
  }

  /**
   * Create a new session or update existing one
   */
  async createOrUpdateSession(
    sessionId: string,
    userId: string,
    data: Partial<SessionData>
  ): Promise<SessionData> {
    try {
      // Get existing session data
      const existingSession = await this.getSession(sessionId);
      
      const now = Date.now();
      const sessionData: SessionData = {
        userId,
        anonymousId: data.anonymousId || existingSession?.anonymousId,
        segments: data.segments || existingSession?.segments || ['new_user'],
        attributes: {
          ...existingSession?.attributes,
          ...data.attributes
        },
        metadata: {
          firstSeen: existingSession?.metadata.firstSeen || now,
          lastSeen: now,
          sessionCount: existingSession ? existingSession.metadata.sessionCount + 1 : 1,
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
      await this.env.SESSIONS.put(
        `session:${sessionId}`,
        JSON.stringify(validatedData),
        { expirationTtl: this.sessionTTL }
      );

      // Also store by userId for quick lookup
      await this.env.SESSIONS.put(
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

  /**
   * Get session data by session ID
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const sessionData = await this.env.SESSIONS.get(`session:${sessionId}`, 'json');
      if (!sessionData) {
        return null;
      }

      return sessionDataSchema.parse(sessionData);
    } catch (error) {
      console.error('Error retrieving session:', error);
      return null;
    }
  }

  /**
   * Get session data by user ID
   */
  async getSessionByUserId(userId: string): Promise<SessionData | null> {
    try {
      const sessionId = await this.env.SESSIONS.get(`user:${userId}`);
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
      return await this.env.SESSIONS.get(`user:${userId}`);
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
      // Get session to find user ID
      const sessionData = await this.getSession(sessionId);
      
      // Delete session data
      await this.env.SESSIONS.delete(`session:${sessionId}`);
      
      // Delete user ID mapping
      if (sessionData) {
        await this.env.SESSIONS.delete(`user:${sessionData.userId}`);
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