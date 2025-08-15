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

      this.initialized = true;
      console.log('Optimizely client initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Optimizely:', error);
      throw error;
    }
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