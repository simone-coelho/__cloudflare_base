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
import { HTTPException } from 'hono/http-exception';
import type { Env } from '@/types/env';
import { ownerEffect, ownerFetch, currentOwnerConsent, currentOwnerIdentity, currentProfileBirth, requireConsentPurpose, ownerBindingIdentity } from '@/identity/sessionAuthority';
import { currentExternalRetention } from '@/identity/sessionAuthority';
import { destinationRetentionCategory } from '@/retention';
import { DEFAULT_TENANT } from '@/tenancy/tenant';
import { connectorConfiguration, connectorDigest, connectorIdentity, connectorSecret, legacyConnectors, ConnectorConfigurationError, type FxConfiguration } from '@/connectors/config';

/**
 * A logger that records fixed SDK failure labels, never callback payloads.
 *
 * `FeatureVariableManager` probes eight demo feature keys (hero_content,
 * ui_theme, …) that intentionally do not exist in this project — it owns local
 * fallback values for exactly that case, and has always relied on the answer
 * being "not enabled, no variables". Under the old (broken) mock client those
 * probes were silent; against the real datafile the SDK logs a red ERROR per
 * probe per request, which on a demo night is a console full of alarming lines
 * describing normal, designed behaviour. The absence is expected, so it is
 * suppressed on the ordinary client. The fresh client retains its ERROR-only
 * threshold without that suppression. Neither path logs SDK message content.
 */
function quietLogger(minimumLevel = 3, suppressMissing = true): { log: (level: number, message: string) => void } {
  return {
    log: (level: number, message: string) => {
      if (suppressMissing && typeof message === 'string' && /is not in datafile/i.test(message)) return;
      if (typeof level === 'number' && level >= minimumLevel) console.error('[optimizely] SDK error');
    },
  };
}

/**
 * Deliver impressions/conversions with `fetch`, since the lite build ships a
 * no-op dispatcher by default. Fire-and-forget on purpose: measurement must
 * never sit in front of a decision the shopper is waiting on.
 */
function fetchEventDispatcher(destination?: string, accountId?: string, admit?: (at: number) => Promise<void>): {
  dispatchEvent: (event: any, callback?: (response: { statusCode: number }) => void) => void;
} {
  return {
    dispatchEvent: (event: any, callback?: (response: { statusCode: number }) => void) => {
      if (accountId && String(event.params?.account_id) !== accountId) { callback?.({ statusCode: 0 }); return; }
      const at = Date.now();
      void ownerEffect(async () => { if (!admit) throw new Error('FX retention authority unavailable'); await admit(at); return ownerFetch(destination ?? event.url, {
        redirect: 'error',
        method: event.httpVerb || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event.params),
      }); })
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

/**
 * Lane E4: what this isolate last learned about a tenant's datafile, and for how long it trusts it.
 *
 * `getConnectors` builds a `LiveDecisionProvider` per request, so `createFreshClient` used to fetch
 * the datafile no-store on EVERY action that built an update, and the action waited for it; when the
 * datafile failed, every such action waited for the failure, and `initialize()` (the feature-variable
 * probes) waited for it a second time. Now:
 *
 *   • a fresh client is reused for FRESH_DATAFILE_MS. Freshness stays "within seconds" (doc 09 §6.1),
 *     and the datafile webhook's refresh drops the remembered client at once;
 *   • a failed fetch is remembered for FAILED_DATAFILE_MS, and every caller in that minute gets the
 *     same failure at once and degrades exactly as it did after waiting for it.
 *
 * Remembered per backing KV binding (stable across owner fences, `ownerBindingIdentity`, and distinct
 * per environment) and per the tenant's datafile identity (the key its KV copy lives under): a
 * tenant's datafile, never a shopper's anything. So only the datafile's own failures are remembered:
 * the network round trip, the response, the validation (`fetchedDatafile`). A refusal the owner fence
 * raises around the fetch, of whatever type, is that one shopper's answer and is never remembered.
 */
export const FRESH_DATAFILE_MS = 10_000;
export const FAILED_DATAFILE_MS = 60_000;
export interface FreshClient { client: any; datafile: any; revision: string | null }
interface Remembered { at: number; fresh?: FreshClient; failure?: unknown }
let remembered = new WeakMap<object, Map<string, Remembered>>();
/** Tests: forget everything this isolate remembers (the webhook's refresh forgets its own tenant). */
export function forgetRememberedDatafiles(): void { remembered = new WeakMap(); }
const within = (at: number, now: number, ms: number) => Number.isFinite(now) && now >= at && now - at < ms;
const refusal = (error: unknown) => error instanceof HTTPException && error.status === 401;
interface Memory { map: Map<string, Remembered>; key: string }
/**
 * Whether the owner fence refuses the operation this code runs in, now (never, outside one). The fence
 * checks only conditions that stay failed once they fail: an ended operation, or a lapsed grant,
 * consent, recovery deadline or pinned retention stamp. So a refusal it raised during a fetch is
 * still raised here, whatever its type.
 */
function ownerFenceRefuses(): boolean {
  try { currentOwnerIdentity(); return false; } catch { return true; }
}
/** A failure of the datafile's own, remembered for FAILED_DATAFILE_MS; never an authority refusal. */
function rememberFailure(memory: Memory | null, error: unknown): void {
  if (memory && !refusal(error)) memory.map.set(memory.key, { at: Date.now(), failure: error });
}

export class OptimizelyService {
  private env: Env;
  private optimizelyClient: any = null;
  private datafile: any = null;
  private initialized = false;

  /**
   * `retentionTenant` (G19): the tenant of the shopper whose data an FX dispatch sends, whose
   * pinned external retention admits it. A route that serves her through another tenant's
   * connector names her tenant; by default it is the connector's tenant, as before.
   */
  constructor(env: Env, readonly tenant: string = DEFAULT_TENANT, private readonly retentionTenant: string = tenant) {
    this.env = env;
  }

  get demo(): boolean { return legacyConnectors(this.env, this.tenant); }
  private settings(): { sdkKey: string; datafileUrl: string; configuration?: FxConfiguration } {
    if (this.demo) {
      const sdkKey = this.env.OPTIMIZELY_SDK_KEY;
      return { sdkKey, datafileUrl: this.env.OPTIMIZELY_DATAFILE_URL || `https://cdn.optimizely.com/datafiles/${sdkKey}.json` };
    }
    const configuration = connectorConfiguration(this.env, this.tenant).fx;
    if (!configuration) throw new ConnectorConfigurationError();
    const sdkKey = connectorSecret(this.env, configuration.sdkKeyRef);
    return { sdkKey, datafileUrl: configuration.datafileUrl.replace('{sdkKey}', encodeURIComponent(sdkKey)), configuration };
  }

  /**
   * Whether this tenant has a Feature Experimentation key at all: a configured `fx` connector (a
   * customer tenant), or a real OPTIMIZELY_SDK_KEY (the legacy demo). Without one nothing is fetched.
   */
  hasFxKey(): boolean {
    try { const { sdkKey } = this.settings(); return !!sdkKey && sdkKey !== 'your-sdk-key-here'; } catch { return false; }
  }

  /** Lane E4: this tenant's remembered datafile outcomes, or null where nothing can be remembered. */
  private async memory(): Promise<Memory | null> {
    const binding = ownerBindingIdentity(this.env.CACHE as unknown as object | undefined);
    if (!binding) return null;
    let map = remembered.get(binding);
    if (!map) { map = new Map(); remembered.set(binding, map); }
    return { map, key: `${await this.cacheKey()}|${this.settings().datafileUrl}` };
  }

  /**
   * Lane E4 (second build): the id the SDK client is given. A tenant with no key only ever has the inert
   * client (`initialize`), which reads no id, so nothing is derived for it and nothing refuses; every
   * other tenant's client sees the external identity, as before.
   */
  private async identityFor(subject: string): Promise<string> {
    return this.hasFxKey() ? this.externalIdentity(subject) : subject;
  }

  /**
   * Lane E4 (second build, review R6 finding 1): fetch and validate the tenant's datafile, and remember
   * a failure only when it is the datafile's own: the network round trip, the response or the
   * validation. `ownerFetch` runs inside the owner fence, which rechecks the shopper's grant, consent,
   * recovery deadlines and pinned retention before and after the fetch; whatever it raises there is
   * that shopper's refusal and reaches the caller unremembered.
   */
  private async fetchedDatafile(url: string, init: RequestInit, memory: Memory | null) {
    let response: Response;
    try { response = await ownerFetch(url, init); }
    catch (error) {
      // The network's failure, or the fence's refusal: the fence still refusing now says which.
      if (!ownerFenceRefuses()) rememberFailure(memory, error);
      throw error;
    }
    try {
      if (!response.ok) throw new Error(`Failed to fetch datafile: ${response.status} ${response.statusText}`);
      return this.validateDatafile(await response.json());
    } catch (error) { rememberFailure(memory, error); throw error; }
  }

  async externalIdentity(subject: string): Promise<string> {
    if (this.demo) return subject;
    const config = this.settings().configuration!;
    return connectorIdentity(this.tenant, config.identityNamespace, subject);
  }

  private async cacheKey(): Promise<string> {
    const settings = this.settings();
    return this.demo ? `optimizely-datafile-${settings.sdkKey}`
      : `t:${this.tenant}:connector:fx:${await connectorDigest(settings)}`;
  }

  private validateDatafile(datafile: any): any {
    const config = this.settings().configuration;
    if (config && (String(datafile?.accountId) !== config.accountId || String(datafile?.projectId) !== config.projectId)) throw new ConnectorConfigurationError();
    return datafile;
  }

  async initialize(): Promise<void> {
    const consent = await currentOwnerConsent();
    if (consent) requireConsentPurpose(consent, 'tracking');
    if (this.initialized) return;
    // Lane E4 (second build, review R6 finding 2): a tenant with no key gets the inert client at once,
    // with nothing read, fetched or logged. Its probes answer exactly what they answered before (the
    // mock's false, null and {}), now without a configuration error logged on every action.
    if (!this.hasFxKey()) { this.initializeMockClient(); this.initialized = true; return; }

    try {
      // Check if we have a real SDK key or just a placeholder
      const settings = this.settings();
      const isPlaceholderKey = !settings.sdkKey || settings.sdkKey === 'your-sdk-key-here';
      
      if (isPlaceholderKey) {
        console.log('Using mock Optimizely client (no SDK key configured)');
        this.initializeMockClient();
      } else {
        this.datafile = await this.fetchDatafile();
        
        this.optimizelyClient = optimizely.createInstance({
          datafile: this.datafile,
          eventDispatcher: fetchEventDispatcher(settings.configuration?.eventsUrl, settings.configuration?.accountId, async at => {
            const descriptor = settings.configuration ?? { eventsUrl: 'https://logx.optimizely.com/v1/events', accountId: String(this.datafile?.accountId), projectId: String(this.datafile?.projectId) };
            const category = await destinationRetentionCategory('fx', descriptor);
            currentExternalRetention(this.env, this.retentionTenant, category);
          }),
          errorHandler: {
            handleError: (error: any) => {
              console.error('Optimizely error');
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
      console.error('Failed to initialize Optimizely, falling back to mock client');
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
      getVariation: () => this.demo ? 'control' : null,
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
      const cacheKey = await this.cacheKey();
      
      const cachedDatafile = await this.env.CACHE.get(cacheKey, 'json');
      if (cachedDatafile) {
        console.log('Using cached Optimizely datafile');
        return this.validateDatafile(cachedDatafile);
      }

      const datafileUrl = this.settings().datafileUrl;
      // Lane E4: a fetch that failed in the last minute is not waited for again.
      const memory = await this.memory(), held = memory?.map.get(memory.key);
      if (held?.failure !== undefined && within(held.at, Date.now(), FAILED_DATAFILE_MS)) throw held.failure;

      const datafile = await this.fetchedDatafile(datafileUrl, { redirect: 'error' }, memory);
      
      await this.env.CACHE.put(cacheKey, JSON.stringify(datafile), {
        expirationTtl: 300,
      });

      console.log('Fetched and cached new Optimizely datafile');
      return datafile;
    } catch (error) {
      console.error('Error fetching datafile');
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
   *
   * Lane E4: a client this isolate built in the last FRESH_DATAFILE_MS is reused, and a
   * fetch that failed in the last FAILED_DATAFILE_MS fails again at once (see `remembered`).
   * A tenant with no key still throws before anything is read or fetched.
   */
  async createFreshClient(): Promise<FreshClient> {
    const url = this.settings().datafileUrl;
    const memory = await this.memory(), held = memory?.map.get(memory.key), now = Date.now();
    if (held?.fresh && within(held.at, now, FRESH_DATAFILE_MS)) return held.fresh;
    if (held?.failure !== undefined && within(held.at, now, FAILED_DATAFILE_MS)) throw held.failure;
    // No-store freshness (doc 09 §6.1). NOTE: the standard `cache: 'no-store'` field
    // is NOT implemented by workerd (it throws "'cache' field ... is not implemented"),
    // so we use the Cloudflare-native equivalent — `cf.cacheTtl: 0` +
    // `cacheEverything: false` + a no-cache request header — to bypass the edge cache.
    const datafile = await this.fetchedDatafile(url, {
      redirect: 'error',
      headers: { 'Cache-Control': 'no-cache' },
      cf: { cacheTtl: 0, cacheEverything: false },
    } as RequestInit, memory);
    const fresh = await this.clientFor(datafile);
    memory?.map.set(memory.key, { at: Date.now(), fresh });
    return fresh;
  }

  /** The decision-only client for a validated datafile: no event dispatch, ERROR-level logging. */
  private async clientFor(datafile: FreshClient['datafile']): Promise<FreshClient> {
    const client = optimizely.createInstance({
      datafile,
      eventDispatcher: { dispatchEvent: () => {} },
      errorHandler: { handleError: () => {} },
      logger: quietLogger(optimizely.enums.LOG_LEVEL.ERROR, false),
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
    const url = this.settings().datafileUrl;
    const res = await ownerFetch(url, { redirect: 'error', headers: { 'Cache-Control': 'no-cache' }, cf: { cacheTtl: 0, cacheEverything: false } });
    if (!res.ok) throw new Error(`datafile fetch failed: ${res.status} ${res.statusText}`);
    const datafile = this.validateDatafile(await res.json());
    await this.env.CACHE.put(await this.cacheKey(), JSON.stringify(datafile), { expirationTtl: 86400 });
    // Lane E4: the datafile changed; nothing this isolate remembers about it still holds.
    const memory = await this.memory(); memory?.map.delete(memory.key);
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
        await this.identityFor(userId),
        userAttributes
      );
      
      return variation;
    } catch (error) {
      console.error('Error getting variation');
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
        await this.identityFor(userId),
        userAttributes
      );
      
      return isEnabled;
    } catch (error) {
      console.error('Error checking feature flag');
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
        await this.identityFor(userId),
        userAttributes
      );
      
      return variable;
    } catch (error) {
      console.error('Error getting feature variable');
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
        await this.identityFor(userId),
        userAttributes
      );
      
      return variables || {};
    } catch (error) {
      console.error('Error getting all feature variables');
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
      const user = this.optimizelyClient.createUserContext(await this.identityFor(userId), userAttributes);
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
      console.error('Error deciding flag');
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
      this.optimizelyClient.track(eventKey, await this.identityFor(userId), userAttributes, eventTags);
    } catch (error) {
      console.error('Error tracking event');
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
      console.error('Error getting segments');
      return [];
    }
  }

  private evaluateAudience(audience: any, userAttributes: UserAttributes): boolean {
    try {
      if (!audience.conditions) return false;
      
      const conditions = JSON.parse(audience.conditions);
      return this.evaluateConditions(conditions, userAttributes);
    } catch (error) {
      console.error('Error evaluating audience');
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
      const cacheKey = await this.cacheKey();
      await this.env.CACHE.delete(cacheKey);
      // Lane E4: an explicit refresh asks the network again, whatever was remembered.
      const memory = await this.memory(); memory?.map.delete(memory.key);

      this.datafile = await this.fetchDatafile();
      this.initialized = false;
      await this.initialize();
      
      return true;
    } catch (error) {
      console.error('Error refreshing datafile');
      return false;
    }
  }
}
