import { DEFAULT_TENANT, TenantKV, type KVLike, type TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';
import { OptimizelyService } from './OptimizelyService';
import type { SessionData } from './SessionManager';

export interface FeatureVariable {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  defaultValue: any;
  description?: string;
}

export interface FeatureVariableConfig {
  featureKey: string;
  variables: FeatureVariable[];
  enabled: boolean;
  description: string;
}

export interface FeatureVariableResult {
  featureKey: string;
  enabled: boolean;
  variables: Record<string, any>;
  source: 'optimizely' | 'fallback' | 'override';
  timestamp: number;
}

export interface FeatureVariableOverride {
  userId: string;
  featureKey: string;
  variableKey: string;
  value: any;
  expiresAt?: number;
  reason?: string;
}

export class FeatureVariableManager {
  private env: Env;
  private optimizelyService: OptimizelyService;
  private cache: Map<string, FeatureVariableResult> = new Map();
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  /** KV scoped to one brand (CW1): an override set by one brand's merchandiser is not another's. */
  private readonly kv: KVLike;

  constructor(env: Env, readonly tenant: TenantId = DEFAULT_TENANT) {
    this.env = env;
    this.kv = new TenantKV(env.CACHE as unknown as KVLike, tenant);
    this.optimizelyService = new OptimizelyService(env);
  }

  /**
   * Get feature variables for a user with enhanced caching and fallbacks
   */
  async getFeatureVariables(
    userId: string,
    userAttributes: Record<string, any>,
    featureKeys?: string[]
  ): Promise<Record<string, FeatureVariableResult>> {
    const features = featureKeys || this.getDefaultFeatureKeys();
    const results: Record<string, FeatureVariableResult> = {};

    // Check for user-specific overrides first
    const overrides = await this.getUserOverrides(userId);

    for (const featureKey of features) {
      const cacheKey = `${userId}:${featureKey}:${JSON.stringify(userAttributes)}`;
      
      // Check cache first
      const cached = this.cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        results[featureKey] = this.applyOverrides(cached, overrides, featureKey);
        continue;
      }

      try {
        // Initialize Optimizely if needed
        await this.optimizelyService.initialize();

        // Get feature flag status
        const isEnabled = await this.optimizelyService.isFeatureEnabled(
          featureKey,
          userId,
          userAttributes
        );

        // Get all feature variables
        const variables = await this.optimizelyService.getAllFeatureVariables(
          featureKey,
          userId,
          userAttributes
        );

        const result: FeatureVariableResult = {
          featureKey,
          enabled: isEnabled,
          variables: variables || {},
          source: 'optimizely',
          timestamp: Date.now()
        };

        // Cache the result
        this.cache.set(cacheKey, result);
        
        // Apply any user overrides
        results[featureKey] = this.applyOverrides(result, overrides, featureKey);

      } catch (error) {
        console.error(`Error getting feature variables for ${featureKey}:`, error);
        
        // Return fallback configuration
        results[featureKey] = {
          featureKey,
          enabled: false,
          variables: this.getFallbackVariables(featureKey),
          source: 'fallback',
          timestamp: Date.now()
        };
      }
    }

    return results;
  }

  /**
   * Get feature variables for session data (enhanced session integration)
   */
  async getSessionFeatureVariables(
    sessionData: SessionData
  ): Promise<Record<string, FeatureVariableResult>> {
    const userAttributes = {
      segments: sessionData.segments,
      ...sessionData.attributes,
      email_opens: sessionData.attributes.email_opens || 0,
      form_submissions: sessionData.attributes.form_submissions || 0,
      page_views: sessionData.attributes.page_views || 0,
      engagement_score: sessionData.metadata.engagementScore,
      session_count: sessionData.metadata.sessionCount,
      days_since_first_seen: Math.floor(
        (Date.now() - sessionData.metadata.firstSeen) / (24 * 60 * 60 * 1000)
      ),
      tracking_consent: sessionData.preferences.trackingConsent,
      personalization_enabled: sessionData.preferences.personalizationEnabled
    };

    return this.getFeatureVariables(sessionData.userId, userAttributes);
  }

  /**
   * Set user-specific feature variable override
   */
  async setUserOverride(override: FeatureVariableOverride): Promise<void> {
    const key = `override:${override.userId}:${override.featureKey}:${override.variableKey}`;
    const data = {
      ...override,
      createdAt: Date.now()
    };

    // Store override in KV with optional expiration
    const ttl = override.expiresAt ? 
      Math.max(0, override.expiresAt - Date.now()) / 1000 : 
      24 * 60 * 60; // 24 hours default

    await this.kv.put(key, JSON.stringify(data), { expirationTtl: ttl });
    
    // Clear relevant cache entries
    this.clearUserCache(override.userId);
  }

  /**
   * Remove user-specific feature variable override
   */
  async removeUserOverride(
    userId: string, 
    featureKey: string, 
    variableKey: string
  ): Promise<void> {
    const key = `override:${userId}:${featureKey}:${variableKey}`;
    await this.kv.delete(key);
    this.clearUserCache(userId);
  }

  /**
   * Get all overrides for a user
   */
  async getUserOverrides(userId: string): Promise<FeatureVariableOverride[]> {
    const overrides: FeatureVariableOverride[] = [];
    
    try {
      // List all override keys for this user (limited KV list operation)
      const prefix = `override:${userId}:`;
      const list = await this.kv.list({ prefix });
      
      for (const key of list.keys) {
        const data = await this.kv.get(key.name, 'json') as FeatureVariableOverride;
        if (data && (!data.expiresAt || data.expiresAt > Date.now())) {
          overrides.push(data);
        }
      }
    } catch (error) {
      console.error('Error fetching user overrides:', error);
    }

    return overrides;
  }

  /**
   * Apply overrides to feature variable result
   */
  private applyOverrides(
    result: FeatureVariableResult,
    overrides: FeatureVariableOverride[],
    featureKey: string
  ): FeatureVariableResult {
    const applicableOverrides = overrides.filter(o => o.featureKey === featureKey);
    
    if (applicableOverrides.length === 0) {
      return result;
    }

    const modifiedResult = { ...result };
    modifiedResult.variables = { ...result.variables };
    
    for (const override of applicableOverrides) {
      modifiedResult.variables[override.variableKey] = override.value;
      modifiedResult.source = 'override';
    }

    return modifiedResult;
  }

  /**
   * Get default feature keys for the demo
   */
  private getDefaultFeatureKeys(): string[] {
    return [
      'hero_content',
      'pricing_config', 
      'personalization_settings',
      'ui_theme',
      'content_recommendations',
      'promotional_banners',
      'feature_access',
      'onboarding_flow'
    ];
  }

  /**
   * Get fallback variables when Optimizely is unavailable
   */
  private getFallbackVariables(featureKey: string): Record<string, any> {
    const fallbacks: Record<string, Record<string, any>> = {
      hero_content: {
        title: 'Welcome to Our Platform',
        subtitle: 'Experience the future of personalization',
        cta_text: 'Get Started',
        background_color: '#667eea',
        show_video: false
      },
      pricing_config: {
        show_enterprise: false,
        discount_percentage: 0,
        free_trial_days: 14,
        currency: 'USD',
        highlight_plan: 'professional'
      },
      personalization_settings: {
        recommendation_count: 5,
        enable_real_time: true,
        segment_refresh_rate: 300,
        track_anonymous: true
      },
      ui_theme: {
        primary_color: '#4f46e5',
        secondary_color: '#10b981',
        dark_mode: false,
        font_family: 'Inter',
        border_radius: '8px'
      },
      content_recommendations: {
        algorithm: 'collaborative',
        max_items: 10,
        include_trending: true,
        personalization_weight: 0.7
      },
      promotional_banners: {
        show_banner: false,
        banner_text: 'Special Offer Available',
        banner_type: 'info',
        auto_dismiss: true
      },
      feature_access: {
        advanced_analytics: false,
        api_access: false,
        custom_integrations: false,
        priority_support: false
      },
      onboarding_flow: {
        skip_intro: false,
        steps_count: 5,
        show_tooltips: true,
        auto_progress: false
      }
    };

    return fallbacks[featureKey] || {};
  }

  /**
   * Clear cache entries for a specific user
   */
  private clearUserCache(userId: string): void {
    const keysToDelete: string[] = [];
    
    for (const [key] of this.cache.entries()) {
      if (key.startsWith(`${userId}:`)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Get feature variable configurations for demo purposes
   */
  getFeatureConfigurations(): FeatureVariableConfig[] {
    return [
      {
        featureKey: 'hero_content',
        description: 'Homepage hero section content and styling',
        enabled: true,
        variables: [
          { key: 'title', type: 'string', defaultValue: 'Welcome to Our Platform' },
          { key: 'subtitle', type: 'string', defaultValue: 'Experience the future' },
          { key: 'cta_text', type: 'string', defaultValue: 'Get Started' },
          { key: 'background_color', type: 'string', defaultValue: '#667eea' },
          { key: 'show_video', type: 'boolean', defaultValue: false }
        ]
      },
      {
        featureKey: 'pricing_config',
        description: 'Pricing page configuration and offers',
        enabled: true,
        variables: [
          { key: 'show_enterprise', type: 'boolean', defaultValue: false },
          { key: 'discount_percentage', type: 'number', defaultValue: 0 },
          { key: 'free_trial_days', type: 'number', defaultValue: 14 },
          { key: 'currency', type: 'string', defaultValue: 'USD' }
        ]
      },
      {
        featureKey: 'ui_theme',
        description: 'User interface theme and styling',
        enabled: true,
        variables: [
          { key: 'primary_color', type: 'string', defaultValue: '#4f46e5' },
          { key: 'dark_mode', type: 'boolean', defaultValue: false },
          { key: 'border_radius', type: 'string', defaultValue: '8px' }
        ]
      }
    ];
  }

  /**
   * Create demo feature variable overrides for testing
   */
  async createDemoOverrides(userId: string): Promise<void> {
    const demoOverrides: Omit<FeatureVariableOverride, 'userId'>[] = [
      {
        featureKey: 'hero_content',
        variableKey: 'title',
        value: 'Welcome, VIP Customer!',
        reason: 'High-value segment personalization'
      },
      {
        featureKey: 'pricing_config',
        variableKey: 'discount_percentage',
        value: 25,
        reason: 'Loyalty program discount'
      },
      {
        featureKey: 'ui_theme',
        variableKey: 'primary_color',
        value: '#059669',
        reason: 'Premium user theme'
      }
    ];

    for (const override of demoOverrides) {
      await this.setUserOverride({
        userId,
        ...override,
        expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
      });
    }
  }

  /**
   * Analytics and monitoring
   */
  async getFeatureVariableAnalytics(): Promise<{
    totalFeatures: number;
    activeOverrides: number;
    cacheHitRate: number;
    lastUpdated: number;
  }> {
    try {
      const configs = this.getFeatureConfigurations();
      
      // Count active overrides (simplified)
      const overridesList = await this.kv.list({ prefix: 'override:' });
      
      return {
        totalFeatures: configs.length,
        activeOverrides: overridesList.keys.length,
        cacheHitRate: 0.85, // Placeholder - would need actual metrics
        lastUpdated: Date.now()
      };
    } catch (error) {
      console.error('Error getting feature variable analytics:', error);
      return {
        totalFeatures: 0,
        activeOverrides: 0,
        cacheHitRate: 0,
        lastUpdated: Date.now()
      };
    }
  }
}