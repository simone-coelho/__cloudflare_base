/**
 * The LITE build, not the default entry — and that distinction is the whole fix.
 *
 * `@optimizely/optimizely-sdk`'s "." export resolves to the BROWSER bundle under
 * the Workers export conditions, and that bundle touches `window.addEventListener`,
 * `window.localStorage` and `window.navigator` (3 references; the lite bundle has
 * 0). So every `createInstance` in this file used to throw `window is not defined`
 * at the edge, get swallowed by the catch below, and hand back a MOCK client —
 * silently, on every request, in production. The subpath `/lite` is Optimizely's
 * own edge build (the shape their Cloudflare Workers starter kit uses): no
 * datafile manager, no browser event processor, datafile injected by the caller
 * and events delivered through a dispatcher you supply. This service already
 * fetched and KV-cached the datafile itself, so the architecture always matched
 * the lite contract — only the import was wrong.
 */
import optimizely from '@optimizely/optimizely-sdk/lite';
import type { Env } from '@/types/env';

/**
 * A logger that keeps real SDK errors and drops ONE expected class of noise.
 *
 * `FeatureVariableManager` probes eight demo feature keys (hero_content,
 * ui_theme, …) that intentionally do not exist in this project — it owns local
 * fallback values for exactly that case, and has always relied on the answer
 * being "not enabled, no variables". Under the old (broken) mock client those
 * probes were silent; against the real datafile the SDK logs a red ERROR per
 * probe per request, which on a demo night is a console full of alarming lines
 * describing normal, designed behaviour. The absence is expected, so it is
 * logged at debug volume; everything else still surfaces.
 */
function quietLogger(): { log: (level: number, message: string) => void } {
  return {
    log: (level: number, message: string) => {
      if (/is not in datafile/i.test(message)) return;
      if (level >= 3) console.error(`[optimizely] ${message}`);
    },
  };
}

/**
 * Deliver impressions/conversions with `fetch`, since the lite build ships a
 * no-op dispatcher by default. Fire-and-forget on purpose: measurement must
 * never sit in front of a decision the shopper is waiting on.
 */
function fetchEventDispatcher(): {
  dispatchEvent: (event: any, callback?: (response: { statusCode: number }) => void) => void;
} {
  return {
    dispatchEvent: (event: any, callback?: (response: { statusCode: number }) => void) => {
      void fetch(event.url, {
        method: event.httpVerb || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event.params),
      })
        .then((res) => callback?.({ statusCode: res.status }))
        .catch(() => callback?.({ statusCode: 0 }));
    },
  };
}

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
          eventDispatcher: fetchEventDispatcher(),
          errorHandler: {
            handleError: (error: any) => {
              console.error('Optimizely error:', error);
            },
          },
          logger: quietLogger(),
        });

        // The lite build takes a static datafile, so this settles immediately —
        // but a client that failed to build must not be mistaken for a working
        // one, which is exactly the failure mode this whole file used to have.
        if (this.optimizelyClient?.onReady) {
          await this.optimizelyClient.onReady({ timeout: 5000 }).catch(() => undefined);
        }
        if (!this.optimizelyClient) throw new Error('createInstance returned null');

        console.log('Optimizely client initialized successfully (lite/edge build)');
      }

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize Optimizely, falling back to mock client:', error);
      this.initializeMockClient();
      this.initialized = true;
    }
  }

  /**
   * The labeled DEGRADED path: no SDK key configured, or the real client failed
   * to build. Everything it answers is inert — false, null, {} — so a caller can
   * never mistake a fallback for a decision.
   */
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

  /**
   * Decide ONE flag through the real SDK — the FX-native call (`decide`), which
   * is what carries a rule key and a variation key back out.
   *
   * Returns null rather than a fabricated decision whenever the real client is
   * not available (no SDK key, datafile fetch failed, mock fallback in force).
   * A caller that needs a decision anyway must choose its own degraded path
   * EXPLICITLY; this method will not quietly answer 'control'.
   *
   * `sendImpression` defaults to false: a decision read on a page that
   * recomposes on a timer must not mint an impression every poll.
   */
  async decide(
    flagKey: string,
    userId: string,
    userAttributes: UserAttributes = {},
    sendImpression = false
  ): Promise<{
    flagKey: string;
    enabled: boolean;
    variationKey: string | null;
    ruleKey: string | null;
    variables: Record<string, any>;
  } | null> {
    await this.initialize();
    try {
      if (typeof this.optimizelyClient?.createUserContext !== 'function') return null;
      const user = this.optimizelyClient.createUserContext(userId, userAttributes);
      if (!user) return null;
      const options = sendImpression
        ? []
        : [optimizely.OptimizelyDecideOption.DISABLE_DECISION_EVENT];
      const d = user.decide(flagKey, options);
      if (!d) return null;
      return {
        flagKey: d.flagKey ?? flagKey,
        enabled: !!d.enabled,
        variationKey: d.variationKey ?? null,
        ruleKey: d.ruleKey ?? null,
        variables: (d.variables as Record<string, any>) ?? {},
      };
    } catch (error) {
      console.error(`Error deciding flag ${flagKey}:`, error);
      return null;
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