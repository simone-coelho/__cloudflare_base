import type { Env } from '@/types/env';
import type { Event } from '@/types/events';
import { OptimizelyService } from './OptimizelyService';
import { SessionManager, type SessionData, type CookieConfig } from './SessionManager';
import { FeatureVariableManager, type FeatureVariableResult } from './FeatureVariableManager';
import type { PersonalizationUpdate } from '@/durable-objects/PersonalizationWebSocket';

export interface ActionEvent {
  type: 'email_open' | 'form_submit' | 'page_view' | 'button_click' | 'custom';
  userId: string;
  anonymousId?: string;
  data: Record<string, any>;
  timestamp: number;
  source: string;
}

export interface SegmentRule {
  id: string;
  name: string;
  condition: (event: ActionEvent, userProfile?: UserProfile) => boolean;
  segment: string;
  priority: number;
  cooldown?: number; // Minutes before rule can fire again
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
  featureFlags: Record<string, boolean>;
  featureVariables: Record<string, any>;
  enhancedFeatureVariables: Record<string, FeatureVariableResult>;
  cookieUpdates: Record<string, string>;
  cookieHeaders: string[];
  segments: string[];
  experiments: Record<string, string>;
  sessionData: SessionData;
}

export class RealtimeSegmentEngine {
  private env: Env;
  private optimizelyService: OptimizelyService;
  private sessionManager: SessionManager;
  private featureVariableManager: FeatureVariableManager;
  private segmentRules: SegmentRule[];

  constructor(env: Env, options?: { domain?: string; secure?: boolean }) {
    this.env = env;
    this.optimizelyService = new OptimizelyService(env);
    this.sessionManager = new SessionManager(env, options);
    this.featureVariableManager = new FeatureVariableManager(env);
    this.segmentRules = this.getDefaultSegmentRules();
  }

  async processActionEvent(event: ActionEvent, sessionId?: string): Promise<PersonalizationUpdate | null> {
    try {
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
            engagementScore: this.calculateEngagementScore(userProfile.attributes),
            lastSegmentUpdate: userProfile.lastUpdated
          },
          preferences: {
            trackingConsent: true,
            personalizationEnabled: true,
            cookieConsent: true
          }
        });
      }
      
      // 2. Evaluate segment rules with session data
      const userProfile = this.sessionDataToUserProfile(sessionData, event);
      const newSegments = await this.evaluateSegmentRules(event, userProfile);
      
      // 3. Check if segments changed
      if (!this.hasSegmentChanges(sessionData.segments, newSegments)) {
        // Update session with event but no segment changes
        await this.sessionManager.createOrUpdateSession(currentSessionId, event.userId, {
          ...sessionData,
          metadata: {
            ...sessionData.metadata,
            lastSeen: Date.now()
          }
        });
        return null; // No segment changes, no update needed
      }
      
      // 4. Calculate new engagement score
      const newAttributes = { ...sessionData.attributes };
      this.updateAttributesWithEvent(newAttributes, event);
      const newEngagementScore = this.calculateEngagementScore(newAttributes);
      
      // 5. Update session with new segments and data
      const updatedSessionData = await this.sessionManager.updateUserSegments(
        currentSessionId,
        newSegments,
        newEngagementScore
      );
      
      if (!updatedSessionData) {
        throw new Error('Failed to update session data');
      }
      
      // 6. Get new Optimizely decisions with enhanced session data
      const personalizationConfig = await this.getPersonalizationConfig(updatedSessionData, currentSessionId);
      
      // 7. Create personalization update with enhanced data
      const update: PersonalizationUpdate = {
        type: 'personalization_update',
        userId: event.userId,
        data: {
          segments: newSegments,
          featureVariables: personalizationConfig.featureVariables,
          cookies: personalizationConfig.cookieUpdates,
          cookieHeaders: personalizationConfig.cookieHeaders,
          sessionId: currentSessionId,
          engagementScore: newEngagementScore,
          timestamp: Date.now(),
          source: event.source
        }
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
    
    // Create new profile
    return {
      userId,
      segments: ['new_user'],
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
   * Convert SessionData to UserProfile for compatibility with existing methods
   */
  private sessionDataToUserProfile(sessionData: SessionData, event: ActionEvent): UserProfile {
    return {
      userId: sessionData.userId,
      anonymousId: sessionData.anonymousId,
      segments: sessionData.segments,
      attributes: sessionData.attributes,
      lastUpdated: sessionData.metadata.lastSegmentUpdate,
      events: [event], // Current event only for rule evaluation
      metadata: {
        firstSeen: sessionData.metadata.firstSeen,
        lastSeen: sessionData.metadata.lastSeen,
        sessionCount: sessionData.metadata.sessionCount,
        emailOpens: sessionData.attributes.email_opens || 0,
        formSubmissions: sessionData.attributes.form_submissions || 0,
        pageViews: sessionData.attributes.page_views || 0
      }
    };
  }

  /**
   * Update attributes based on action event
   */
  private updateAttributesWithEvent(attributes: Record<string, any>, event: ActionEvent): void {
    switch (event.type) {
      case 'email_open':
        attributes.email_opens = (attributes.email_opens || 0) + 1;
        if (event.data.campaignId) {
          attributes.last_email_campaign = event.data.campaignId;
        }
        break;
      case 'form_submit':
        attributes.form_submissions = (attributes.form_submissions || 0) + 1;
        if (event.data.formType) {
          attributes.last_form_type = event.data.formType;
        }
        break;
      case 'page_view':
        attributes.page_views = (attributes.page_views || 0) + 1;
        if (event.data.path) {
          attributes.last_page_path = event.data.path;
        }
        break;
      case 'button_click':
        attributes.button_clicks = (attributes.button_clicks || 0) + 1;
        if (event.data.buttonId) {
          attributes.last_button_clicked = event.data.buttonId;
        }
        break;
      case 'custom':
        attributes.custom_events = (attributes.custom_events || 0) + 1;
        if (event.data.eventName) {
          attributes.last_custom_event = event.data.eventName;
        }
        break;
    }
    
    attributes.last_activity = Date.now();
  }

  private async evaluateSegmentRules(event: ActionEvent, userProfile: UserProfile): Promise<string[]> {
    const segments = new Set(userProfile.segments);
    
    // Remove 'new_user' if user has any activity
    if (userProfile.events.length > 0) {
      segments.delete('new_user');
    }
    
    // Evaluate rules in priority order
    const sortedRules = this.segmentRules.sort((a, b) => b.priority - a.priority);
    
    for (const rule of sortedRules) {
      try {
        if (this.shouldEvaluateRule(rule, event, userProfile)) {
          if (rule.condition(event, userProfile)) {
            segments.add(rule.segment);
            console.log(`Added segment: ${rule.segment} via rule: ${rule.name}`);
          }
        }
      } catch (error) {
        console.error(`Error evaluating rule ${rule.id}:`, error);
      }
    }
    
    return Array.from(segments);
  }

  private shouldEvaluateRule(rule: SegmentRule, event: ActionEvent, userProfile: UserProfile): boolean {
    // Check cooldown
    if (rule.cooldown && userProfile.segments.includes(rule.segment)) {
      const lastEventTime = userProfile.events
        .filter(e => e.type === event.type)
        .map(e => e.timestamp)
        .sort((a, b) => b - a)[0];
      
      if (lastEventTime && Date.now() - lastEventTime < rule.cooldown * 60 * 1000) {
        return false; // Still in cooldown
      }
    }
    
    return true;
  }

  private hasSegmentChanges(oldSegments: string[], newSegments: string[]): boolean {
    if (oldSegments.length !== newSegments.length) {
      return true;
    }
    
    const oldSet = new Set(oldSegments);
    return newSegments.some(segment => !oldSet.has(segment));
  }

  private updateMetadata(profile: UserProfile, event: ActionEvent): void {
    switch (event.type) {
      case 'email_open':
        profile.metadata.emailOpens++;
        break;
      case 'form_submit':
        profile.metadata.formSubmissions++;
        break;
      case 'page_view':
        profile.metadata.pageViews++;
        break;
    }
  }

  private async getPersonalizationConfig(sessionData: SessionData, sessionId: string): Promise<PersonalizationConfig> {
    await this.optimizelyService.initialize();
    
    const userAttributes = {
      segments: sessionData.segments,
      ...sessionData.attributes,
      email_opens: sessionData.attributes.email_opens || 0,
      form_submissions: sessionData.attributes.form_submissions || 0,
      page_views: sessionData.attributes.page_views || 0,
      engagement_score: sessionData.metadata.engagementScore,
      session_count: sessionData.metadata.sessionCount,
      days_since_first_seen: Math.floor((Date.now() - sessionData.metadata.firstSeen) / (24 * 60 * 60 * 1000)),
      tracking_consent: sessionData.preferences.trackingConsent,
      personalization_enabled: sessionData.preferences.personalizationEnabled
    };
    
    // Get feature flag decisions
    const experiments = await this.getExperimentDecisions(sessionData.userId, userAttributes);
    const featureFlags = await this.getFeatureFlagDecisions(sessionData.userId, userAttributes);
    
    // Get enhanced feature variables using FeatureVariableManager
    const enhancedFeatureVariables = await this.featureVariableManager.getSessionFeatureVariables(sessionData);
    
    // Get legacy feature variables for backward compatibility
    const featureVariables = await this.getFeatureVariables(sessionData.userId, userAttributes);
    
    // Generate legacy cookie updates for backward compatibility
    const cookieUpdates = this.generateCookieUpdates(sessionData.segments, userAttributes);
    
    // Generate enhanced secure cookies using SessionManager
    const sessionCookies = this.sessionManager.generateSessionCookies(sessionData, sessionId);
    const cookieHeaders = this.sessionManager.createCookieHeaders(sessionCookies);
    
    return {
      featureFlags,
      featureVariables,
      enhancedFeatureVariables,
      cookieUpdates,
      cookieHeaders,
      segments: sessionData.segments,
      experiments,
      sessionData
    };
  }

  private async getExperimentDecisions(userId: string, attributes: Record<string, any>): Promise<Record<string, string>> {
    const experimentKeys = ['hero_cta_test', 'pricing_display_test', 'onboarding_flow_test'];
    const decisions: Record<string, string> = {};
    
    for (const experimentKey of experimentKeys) {
      try {
        const variation = await this.optimizelyService.getVariation(experimentKey, userId, attributes);
        if (variation) {
          decisions[experimentKey] = variation;
        }
      } catch (error) {
        console.error(`Error getting experiment decision for ${experimentKey}:`, error);
      }
    }
    
    return decisions;
  }

  private async getFeatureFlagDecisions(userId: string, attributes: Record<string, any>): Promise<Record<string, boolean>> {
    const featureKeys = ['premium_content', 'advanced_features', 'beta_access', 'vip_support'];
    const decisions: Record<string, boolean> = {};
    
    for (const featureKey of featureKeys) {
      try {
        const isEnabled = await this.optimizelyService.isFeatureEnabled(featureKey, userId, attributes);
        decisions[featureKey] = isEnabled;
      } catch (error) {
        console.error(`Error getting feature flag decision for ${featureKey}:`, error);
        decisions[featureKey] = false;
      }
    }
    
    return decisions;
  }

  private async getFeatureVariables(userId: string, attributes: Record<string, any>): Promise<Record<string, any>> {
    const featureKeys = ['hero_content', 'pricing_config', 'personalization_settings'];
    const variables: Record<string, any> = {};
    
    for (const featureKey of featureKeys) {
      try {
        const featureVariables = await this.optimizelyService.getAllFeatureVariables(featureKey, userId, attributes);
        variables[featureKey] = featureVariables;
      } catch (error) {
        console.error(`Error getting feature variables for ${featureKey}:`, error);
        variables[featureKey] = {};
      }
    }
    
    return variables;
  }

  private generateCookieUpdates(segments: string[], attributes: Record<string, any>): Record<string, string> {
    return {
      'opt_segments': segments.join(','),
      'opt_last_update': Date.now().toString(),
      'opt_email_opens': attributes.email_opens?.toString() || '0',
      'opt_form_submissions': attributes.form_submissions?.toString() || '0',
      'opt_engagement_score': this.calculateEngagementScore(attributes).toString()
    };
  }

  private calculateEngagementScore(attributes: Record<string, any>): number {
    const emailOpens = attributes.email_opens || 0;
    const formSubmissions = attributes.form_submissions || 0;
    const pageViews = attributes.page_views || 0;
    
    // Simple engagement scoring formula
    return Math.min(100, (emailOpens * 10) + (formSubmissions * 25) + (pageViews * 2));
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

  private getDefaultSegmentRules(): SegmentRule[] {
    return [
      {
        id: 'email_opener',
        name: 'Email Opener',
        condition: (event) => event.type === 'email_open',
        segment: 'email_engaged',
        priority: 100,
        cooldown: 60 // 1 hour cooldown
      },
      {
        id: 'form_submitter',
        name: 'Form Submitter',
        condition: (event) => event.type === 'form_submit',
        segment: 'lead_qualified',
        priority: 200,
        cooldown: 1440 // 24 hour cooldown
      },
      {
        id: 'multiple_email_opens',
        name: 'Multiple Email Opens',
        condition: (event, profile) => 
          event.type === 'email_open' && (profile?.metadata.emailOpens || 0) >= 3,
        segment: 'highly_engaged',
        priority: 150
      },
      {
        id: 'pricing_page_visitor',
        name: 'Pricing Page Visitor',
        condition: (event) => 
          event.type === 'page_view' && event.data.path?.includes('/pricing'),
        segment: 'price_interested',
        priority: 120
      },
      {
        id: 'high_value_prospect',
        name: 'High Value Prospect',
        condition: (event, profile) => {
          const emailOpens = profile?.metadata.emailOpens || 0;
          const formSubmissions = profile?.metadata.formSubmissions || 0;
          return emailOpens >= 2 && formSubmissions >= 1;
        },
        segment: 'high_value',
        priority: 300
      },
      {
        id: 'demo_request',
        name: 'Demo Request',
        condition: (event) => 
          event.type === 'form_submit' && event.data.formType === 'demo_request',
        segment: 'sales_qualified',
        priority: 400
      },
      {
        id: 'custom_event',
        name: 'Custom Event User',
        condition: (event) => event.type === 'custom',
        segment: 'custom_engaged',
        priority: 150
      },
      {
        id: 'button_clicker',
        name: 'Button Click Tracker',
        condition: (event) => event.type === 'button_click',
        segment: 'interactive_user',
        priority: 150
      }
    ];
  }

  // Public method to add custom segment rules
  addSegmentRule(rule: SegmentRule): void {
    this.segmentRules.push(rule);
  }

  // Get user segments for external API calls
  async getUserSegments(userId: string): Promise<string[]> {
    const profile = await this.getUserProfile(userId);
    return profile.segments;
  }

  // Manual segment assignment
  async assignSegment(userId: string, segment: string, source: string = 'manual'): Promise<void> {
    const profile = await this.getUserProfile(userId);
    
    if (!profile.segments.includes(segment)) {
      profile.segments.push(segment);
      profile.lastUpdated = Date.now();
      await this.saveUserProfile(profile);
      
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

    // If no valid session, create new one
    if (!sessionData) {
      sessionId = this.sessionManager.generateSessionId();
      isNewSession = true;
      
      // Get user profile for initial session creation
      const userProfile = await this.getUserProfile(userId);
      sessionData = await this.sessionManager.createOrUpdateSession(sessionId, userId, {
        anonymousId: cookies.anonymousId,
        segments: cookies.segments ? cookies.segments.split(',') : userProfile.segments,
        attributes: userProfile.attributes,
        metadata: {
          firstSeen: userProfile.metadata.firstSeen,
          lastSeen: Date.now(),
          sessionCount: userProfile.metadata.sessionCount,
          engagementScore: parseInt(cookies.engagementScore || '0') || this.calculateEngagementScore(userProfile.attributes),
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
    const { sessionId, sessionData, isNewSession } = await this.getOrCreateSessionFromCookies(
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
        }
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
        }
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