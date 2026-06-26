import optimizely from '@optimizely/optimizely-sdk';
import type { Env } from '@/types/env';

export interface OptimizelyConfig {
  sdkKey: string;
  datafileUrl?: string;
  pollInterval?: number;
}

export interface UserAttributes {
  [key: string]: string | number | boolean;
}

export interface EventTags {
  [key: string]: string | number | boolean;
}

export class OptimizelyService {
  private env: Env;
  private optimizelyClient: any = null;
  private datafile: any = null;
  private initialized = false;

  constructor(env: Env) {
    this.env = env;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Check if we have a real SDK key or just a placeholder
      const isPlaceholderKey = !this.env.OPTIMIZELY_SDK_KEY || 
                               this.env.OPTIMIZELY_SDK_KEY === 'your-sdk-key-here';
      
      if (isPlaceholderKey) {
        console.log('Using mock Optimizely client (no SDK key configured)');
        this.initializeMockClient();
      } else {
        this.datafile = await this.fetchDatafile();
        
        this.optimizelyClient = optimizely.createInstance({
          datafile: this.datafile,
          errorHandler: {
            handleError: (error: any) => {
              console.error('Optimizely error:', error);
            },
          },
          logger: optimizely.logging.createLogger({
            logLevel: optimizely.enums.LOG_LEVEL.ERROR,
          }),
        });
        
        console.log('Optimizely client initialized successfully');
      }
      
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize Optimizely, falling back to mock client:', error);
      this.initializeMockClient();
      this.initialized = true;
    }
  }
  
  private initializeMockClient(): void {
    // Create a mock client for development without a real SDK key
    this.optimizelyClient = {
      getVariation: () => 'control',
      isFeatureEnabled: () => false,
      getFeatureVariable: () => null,
      getAllFeatureVariables: () => ({}),
      track: () => {},
      onReady: () => Promise.resolve(),
    };
    
    // Mock datafile for development
    this.datafile = {
      version: '4',
      rollouts: [],
      typedAudiences: [],
      anonymizeIP: false,
      projectId: 'mock_project',
      variables: [],
      featureFlags: [],
      experiments: [],
      audiences: [],
      groups: [],
      attributes: [],
      accountId: 'mock_account',
      layers: [],
      events: [],
      revision: '1',
    };
  }

  private async fetchDatafile(): Promise<any> {
    try {
      const cacheKey = `optimizely-datafile-${this.env.OPTIMIZELY_SDK_KEY}`;
      
      const cachedDatafile = await this.env.CACHE.get(cacheKey, 'json');
      if (cachedDatafile) {
        console.log('Using cached Optimizely datafile');
        return cachedDatafile;
      }

      let datafileUrl = this.env.OPTIMIZELY_DATAFILE_URL;
      if (!datafileUrl) {
        datafileUrl = `https://cdn.optimizely.com/datafiles/${this.env.OPTIMIZELY_SDK_KEY}.json`;
      }

      const response = await fetch(datafileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch datafile: ${response.status} ${response.statusText}`);
      }

      const datafile = await response.json();
      
      await this.env.CACHE.put(cacheKey, JSON.stringify(datafile), {
        expirationTtl: 300,
      });

      console.log('Fetched and cached new Optimizely datafile');
      return datafile;
    } catch (error) {
      console.error('Error fetching datafile:', error);
      throw error;
    }
  }

  /**
   * Build a FRESH Optimizely client from an on-demand, no-store datafile fetch —
   * doc 09 §6 option 1 ("within seconds" freshness, bypassing the SDK poll + the KV
   * cache used by initialize()). Used by LiveDecisionProvider (Mode B). Returns the
   * client plus the parsed datafile so callers can check flag presence / revision
   * before deciding.
   *
   * The event dispatcher is a no-op: at the edge we only READ decisions here, so we
   * skip impression-event delivery (no waitUntil dependency, no extra latency).
   */
  async createFreshClient(): Promise<{ client: any; datafile: any; revision: string | null }> {
    const url = `https://cdn.optimizely.com/datafiles/${this.env.OPTIMIZELY_SDK_KEY}.json`;
    // No-store freshness (doc 09 §6.1). NOTE: the standard `cache: 'no-store'` field
    // is NOT implemented by workerd (it throws "'cache' field ... is not implemented"),
    // so we use the Cloudflare-native equivalent — `cf.cacheTtl: 0` +
    // `cacheEverything: false` + a no-cache request header — to bypass the edge cache.
    const response = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch datafile: ${response.status} ${response.statusText}`);
    }
    const datafile = (await response.json()) as any;

    const client = optimizely.createInstance({
      datafile,
      eventDispatcher: { dispatchEvent: () => {} },
      errorHandler: { handleError: () => {} },
      logger: optimizely.logging.createLogger({
        logLevel: optimizely.enums.LOG_LEVEL.ERROR,
      }),
    });

    // With a static datafile this resolves immediately; guard for SDK shape drift.
    if (client && typeof (client as any).onReady === 'function') {
      try {
        await (client as any).onReady({ timeout: 5000 });
      } catch {
        /* fall through — caller checks the datafile/flags directly */
      }
    }

    const revision =
      datafile && datafile.revision != null ? String(datafile.revision) : null;
    return { client, datafile, revision };
  }

  /**
   * Fetch the datafile no-store and (re)write the KV cache that initialize()/fetchDatafile read.
   * Called by the datafile webhook (POST /webhook/optimizely-datafile) when Optimizely signals a
   * change — so steady-state edge decisions stay KV-FAST (<50ms, no per-decision CDN fetch) AND
   * fresh-on-change. The 24h TTL is just a safety floor; the webhook keeps it current.
   */
  async refreshDatafileCache(): Promise<{ revision: string | null; flags: number }> {
    const url = `https://cdn.optimizely.com/datafiles/${this.env.OPTIMIZELY_SDK_KEY}.json`;
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, cf: { cacheTtl: 0, cacheEverything: false } });
    if (!res.ok) throw new Error(`datafile fetch failed: ${res.status} ${res.statusText}`);
    const datafile = (await res.json()) as any;
    await this.env.CACHE.put(`optimizely-datafile-${this.env.OPTIMIZELY_SDK_KEY}`, JSON.stringify(datafile), { expirationTtl: 86400 });
    return {
      revision: datafile?.revision != null ? String(datafile.revision) : null,
      flags: Array.isArray(datafile?.featureFlags) ? datafile.featureFlags.length : 0,
    };
  }

  async getVariation(
    experimentKey: string,
    userId: string,
    userAttributes: UserAttributes = {}
  ): Promise<string | null> {
    await this.initialize();
    
    try {
      const variation = this.optimizelyClient.getVariation(
        experimentKey,
        userId,
        userAttributes
      );
      
      console.log(`Variation for experiment ${experimentKey}, user ${userId}:`, variation);
      return variation;
    } catch (error) {
      console.error('Error getting variation:', error);
      return null;
    }
  }

  async isFeatureEnabled(
    featureKey: string,
    userId: string,
    userAttributes: UserAttributes = {}
  ): Promise<boolean> {
    await this.initialize();
    
    try {
      const isEnabled = this.optimizelyClient.isFeatureEnabled(
        featureKey,
        userId,
        userAttributes
      );
      
      console.log(`Feature ${featureKey} enabled for user ${userId}:`, isEnabled);
      return isEnabled;
    } catch (error) {
      console.error('Error checking feature flag:', error);
      return false;
    }
  }

  async getFeatureVariable(
    featureKey: string,
    variableKey: string,
    userId: string,
    userAttributes: UserAttributes = {}
  ): Promise<any> {
    await this.initialize();
    
    try {
      const variable = this.optimizelyClient.getFeatureVariable(
        featureKey,
        variableKey,
        userId,
        userAttributes
      );
      
      console.log(`Variable ${variableKey} for feature ${featureKey}, user ${userId}:`, variable);
      return variable;
    } catch (error) {
      console.error('Error getting feature variable:', error);
      return null;
    }
  }

  async getAllFeatureVariables(
    featureKey: string,
    userId: string,
    userAttributes: UserAttributes = {}
  ): Promise<Record<string, any>> {
    await this.initialize();
    
    try {
      const variables = this.optimizelyClient.getAllFeatureVariables(
        featureKey,
        userId,
        userAttributes
      );
      
      console.log(`All variables for feature ${featureKey}, user ${userId}:`, variables);
      return variables || {};
    } catch (error) {
      console.error('Error getting all feature variables:', error);
      return {};
    }
  }

  async track(
    eventKey: string,
    userId: string,
    userAttributes: UserAttributes = {},
    eventTags: EventTags = {}
  ): Promise<void> {
    await this.initialize();
    
    try {
      this.optimizelyClient.track(eventKey, userId, userAttributes, eventTags);
      console.log(`Tracked event ${eventKey} for user ${userId}`);
    } catch (error) {
      console.error('Error tracking event:', error);
    }
  }

  getExperiments(): any[] {
    if (!this.datafile) return [];
    return this.datafile.experiments || [];
  }

  getFeatureFlags(): any[] {
    if (!this.datafile) return [];
    return this.datafile.featureFlags || [];
  }

  getEvents(): any[] {
    if (!this.datafile) return [];
    return this.datafile.events || [];
  }

  getAudiences(): any[] {
    if (!this.datafile) return [];
    return this.datafile.audiences || [];
  }

  getDatafile(): any {
    return this.datafile;
  }

  async getSegments(userId: string, userAttributes: UserAttributes = {}): Promise<string[]> {
    await this.initialize();
    
    try {
      const segments: string[] = [];
      const audiences = this.getAudiences();
      
      for (const audience of audiences) {
        if (this.evaluateAudience(audience, userAttributes)) {
          segments.push(audience.name || audience.id);
        }
      }
      
      const experiments = this.getExperiments();
      for (const experiment of experiments) {
        const variation = await this.getVariation(experiment.key, userId, userAttributes);
        if (variation) {
          segments.push(`experiment_${experiment.key}_${variation}`);
        }
      }
      
      const featureFlags = this.getFeatureFlags();
      for (const feature of featureFlags) {
        const isEnabled = await this.isFeatureEnabled(feature.key, userId, userAttributes);
        if (isEnabled) {
          segments.push(`feature_${feature.key}_enabled`);
        }
      }
      
      return segments;
    } catch (error) {
      console.error('Error getting segments:', error);
      return [];
    }
  }

  private evaluateAudience(audience: any, userAttributes: UserAttributes): boolean {
    try {
      if (!audience.conditions) return false;
      
      const conditions = JSON.parse(audience.conditions);
      return this.evaluateConditions(conditions, userAttributes);
    } catch (error) {
      console.error('Error evaluating audience:', error);
      return false;
    }
  }

  private evaluateConditions(conditions: any, userAttributes: UserAttributes): boolean {
    if (Array.isArray(conditions)) {
      const [operator, ...operands] = conditions;
      
      switch (operator) {
        case 'and':
          return operands.every(operand => this.evaluateConditions(operand, userAttributes));
        case 'or':
          return operands.some(operand => this.evaluateConditions(operand, userAttributes));
        case 'not':
          return !this.evaluateConditions(operands[0], userAttributes);
        default:
          return false;
      }
    }
    
    if (typeof conditions === 'string') {
      const audienceId = conditions;
      const audience = this.datafile.audiences?.find((a: any) => a.id === audienceId);
      if (audience) {
        return this.evaluateAudience(audience, userAttributes);
      }
    }
    
    return false;
  }

  async refreshDatafile(): Promise<boolean> {
    try {
      const cacheKey = `optimizely-datafile-${this.env.OPTIMIZELY_SDK_KEY}`;
      await this.env.CACHE.delete(cacheKey);
      
      this.datafile = await this.fetchDatafile();
      this.initialized = false;
      await this.initialize();
      
      return true;
    } catch (error) {
      console.error('Error refreshing datafile:', error);
      return false;
    }
  }
}