// Lane E4: a tenant's Feature Experimentation datafile is fetched once per window, not once per action.
//
// getConnectors builds a LiveDecisionProvider per request, and createFreshClient fetched the datafile
// no-store every time an action built an update; a datafile that failed made every such action wait for
// the failure (800 ms on the lane's rig, twice: the decision seam and the feature-variable probes).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import optimizely from '@optimizely/optimizely-sdk/lite';
import type { Env } from '@/types/env';
import { getConnectors } from '@/connectors';
import { CATALOG_FLAG_KEYS } from '@/connectors/DecisionProvider';
import { FAILED_DATAFILE_MS, FRESH_DATAFILE_MS, OptimizelyService, forgetRememberedDatafiles } from './OptimizelyService';
import { FeatureVariableManager, forgetListedOverrides } from './FeatureVariableManager';
import { SessionAccessError } from '@/identity/sessionCapability';
import { RetentionUnavailable, retentionBirth } from '@/retention';
import { pinRetention, runOwnerOperation } from '@/identity/sessionAuthority';

class KV {
  data = new Map<string, string>(); calls: string[] = [];
  async get(key: string, type?: string) { this.calls.push('get:' + key); const v = this.data.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; }
  async put(key: string, value: string) { this.calls.push('put:' + key); this.data.set(key, value); }
  async delete(key: string) { this.calls.push('delete:' + key); this.data.delete(key); }
  async list(o?: { prefix?: string }) { this.calls.push('list:' + (o?.prefix ?? '')); return { keys: [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).map(name => ({ name })), list_complete: true }; }
}
const DATAFILE_HOST = 'https://cdn.optimizely.com/datafiles/';
/** A customer tenant with an FX connector (its own key, account and project). */
function customer(): { env: Env; cache: KV } {
  const cache = new KV();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', CACHE: cache,
    TENANTS: JSON.stringify({ provisioned: ['oh'] }),
    // A one-second profile lifetime, so a shopper's pinned stamp can lapse while a fetch is in flight.
    RETENTION: JSON.stringify({ version: 1, tenants: { oh: { profile: { id: 'e4-profile', revision: 1, durationMs: 1_000, basis: 'admitted', renewal: 'new-record-only' } } } }),
    TENANT_CONNECTORS: JSON.stringify({ version: 1, tenants: { oh: { fx: { sdkKeyRef: 'CONNECTOR_SECRET_E4_FX', datafileUrl: DATAFILE_HOST + '{sdkKey}.json',
      eventsUrl: 'https://logx.optimizely.com/v1/events', accountId: 'account-e4', projectId: 'project-e4', identityNamespace: 'e4' } } } }),
    CONNECTOR_SECRET_E4_FX: 'e4-synthetic-sdk-key',
  } as unknown as Env;
  return { env, cache };
}
const datafile = (revision: number) => ({ version: '4', accountId: 'account-e4', projectId: 'project-e4', revision: String(revision),
  featureFlags: [{ key: 'hero_module' }], experiments: [], audiences: [], attributes: [], events: [], rollouts: [], groups: [], typedAudiences: [], layers: [] });
/** One action's decision seam, built the way the request path builds it: a fresh provider every time. */
const decideOnce = (env: Env) => getConnectors(env, 'oh').decisions.decideAll(CATALOG_FLAG_KEYS, 'visitor', ['segment'], {});
const datafileFetches = (fetcher: { mock: { calls: unknown[][] } }) => fetcher.mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).startsWith(DATAFILE_HOST)).length;

let now = 1_000_000;
beforeEach(() => {
  forgetRememberedDatafiles(); forgetListedOverrides(); now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(optimizely, 'createInstance').mockImplementation((() => ({
    onReady: async () => ({ success: true }),
    createUserContext: () => ({ decide: (key: string) => ({ flagKey: key, enabled: true, variationKey: 'live', ruleKey: 'rule', variables: { from: 'datafile' } }) }),
  })) as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('E4 the Feature Experimentation datafile', () => {
  it('is never fetched, read or logged for a tenant with no key, whose decisions and probes answer as before', async () => {
    const fetcher = vi.fn(async () => Response.json(datafile(1))); vi.stubGlobal('fetch', fetcher);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const cache = new KV(), env = { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', CACHE: cache,
      TENANTS: JSON.stringify({ provisioned: ['oh'] }) } as unknown as Env;
    expect(new OptimizelyService(env, 'oh').hasFxKey()).toBe(false);
    for (let i = 0; i < 3; i++) {
      const decisions = await decideOnce(env);
      expect(Object.keys(decisions)).toEqual(CATALOG_FLAG_KEYS);
      for (const d of Object.values(decisions)) expect(d).toMatchObject({ enabled: false, variationKey: null, reason: 'fallback' });
    }
    // The feature-variable probes an update action runs: the same answers the inert client always gave
    // (not enabled, no variables), and the overrides list still read as before.
    const session = { userId: 'visitor', segments: [], attributes: {}, metadata: { firstSeen: 0, lastSeen: 0, sessionCount: 1, engagementScore: 0, lastSegmentUpdate: 0 },
      preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true } } as never;
    const probes = await new FeatureVariableManager(env, 'oh').getSessionFeatureVariables(session);
    expect(Object.keys(probes)).toHaveLength(8);
    for (const p of Object.values(probes)) expect(p).toMatchObject({ enabled: false, variables: {}, source: 'optimizely' });
    const service = new OptimizelyService(env, 'oh');
    expect([await service.getVariation('x', 'visitor'), await service.isFeatureEnabled('x', 'visitor'), await service.getFeatureVariable('x', 'y', 'visitor'),
      await service.getAllFeatureVariables('x', 'visitor'), await service.decide('x', 'visitor'), await service.track('x', 'visitor')]).toEqual([null, false, null, {}, null, undefined]);
    expect(fetcher).not.toHaveBeenCalled(); expect(cache.calls.filter(c => !c.startsWith('list:t:oh:override:'))).toEqual([]);
    // Nothing at all is logged: the four lines the hosted tail showed for this tenant are gone.
    expect(errors).not.toHaveBeenCalled(); expect(logs).not.toHaveBeenCalled();
    // The legacy demo with no real key and the FX decision source switched on: nothing fetched or logged either,
    // and its inert client answers as it always did ('control' for a variation, the demo's own mock).
    const legacy = { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'optimizely', OPTIMIZELY_SDK_KEY: 'your-sdk-key-here', CACHE: new KV() } as unknown as Env;
    expect(Object.keys(await getConnectors(legacy).decisions.decideAll(CATALOG_FLAG_KEYS, 'visitor', [], {}))).toEqual(CATALOG_FLAG_KEYS);
    expect(await new OptimizelyService(legacy).getVariation('x', 'visitor')).toBe('control');
    expect(fetcher).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled(); expect(logs).not.toHaveBeenCalled();
  });

  it('remembers a failed fetch for a minute: later actions degrade at once, the same way, then it is asked again', async () => {
    const { env } = customer();
    const fetcher = vi.fn(async () => new Response('unavailable', { status: 503 })); vi.stubGlobal('fetch', fetcher);
    vi.spyOn(console, 'error').mockImplementation(() => undefined); vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const first = await decideOnce(env);
    expect(datafileFetches(fetcher)).toBe(1);
    for (const d of Object.values(first)) expect(d).toMatchObject({ enabled: false, reason: 'fallback' });
    now += FAILED_DATAFILE_MS - 1;
    expect(await decideOnce(env)).toEqual(first);
    // The feature-variable probes (initialize, the KV-cached path) do not wait for it either.
    await new FeatureVariableManager(env, 'oh').getFeatureVariables('visitor', {}, ['hero_module']);
    await expect(new OptimizelyService(env, 'oh').createFreshClient()).rejects.toThrow('Failed to fetch datafile: 503');
    expect(datafileFetches(fetcher)).toBe(1);
    now += 1;
    await decideOnce(env);
    expect(datafileFetches(fetcher)).toBe(2);
  });

  it('reuses a fresh datafile for FRESH_DATAFILE_MS, then fetches it again; the datafile webhook forgets it at once', async () => {
    const { env } = customer();
    let revision = 1;
    const fetcher = vi.fn(async () => Response.json(datafile(revision))); vi.stubGlobal('fetch', fetcher);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const live = await decideOnce(env);
    expect(live.hero_module).toMatchObject({ enabled: true, variationKey: 'live', variables: { from: 'datafile' } });
    expect(datafileFetches(fetcher)).toBe(1);
    now += FRESH_DATAFILE_MS - 1;
    expect(await decideOnce(env)).toEqual(live);
    expect((await new OptimizelyService(env, 'oh').createFreshClient()).revision).toBe('1');
    expect(datafileFetches(fetcher)).toBe(1);
    now += 1;
    await decideOnce(env);
    expect(datafileFetches(fetcher)).toBe(2);
    // Optimizely signals a change: the refresh fetches it, and the next decision builds from it.
    revision = 2;
    expect(await new OptimizelyService(env, 'oh').refreshDatafileCache()).toMatchObject({ revision: '2' });
    expect((await new OptimizelyService(env, 'oh').createFreshClient()).revision).toBe('2');
    expect(datafileFetches(fetcher)).toBe(4);
  });

  it('never remembers what the owner fence raises around one shopper\'s fetch, whatever its type (review R6, finding 1)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { env } = customer();
    let fetches = 0, expiresAt = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetches += 1;
      if (fetches === 1) now = expiresAt + 1; // shopper A's pinned profile retention lapses while the fetch is in flight
      return new Response('unavailable', { status: 503 });
    }));
    // Shopper A, inside its owner operation with its profile retention pinned: the fence's recheck after
    // the fetch refuses with RetentionUnavailable (not a 401), and A's operation rejects with it.
    const ownerA = {};
    const errA = await runOwnerOperation(ownerA, env, async () => {
      const stamp = retentionBirth(env, 'oh', 'profile', now); expiresAt = stamp.expiresAt;
      pinRetention(env, stamp, 'oh', 'profile');
      return new OptimizelyService(env, 'oh').createFreshClient();
    }).then(() => null, (error: unknown) => error);
    expect(errA).toBeInstanceOf(RetentionUnavailable);
    expect(fetches).toBe(1);
    // Shopper B, 59 s later, outside any owner operation and with nothing lapsed: A's refusal was not
    // remembered for the tenant, so B fetches and meets the datafile's own answer.
    now += 59_000;
    const errB = await new OptimizelyService(env, 'oh').createFreshClient().then(() => null, (error: unknown) => error);
    expect(errB).not.toBeInstanceOf(RetentionUnavailable);
    expect(String(errB)).toContain('Failed to fetch datafile: 503');
    expect(fetches).toBe(2);
    // The same for the KV-cached path the feature-variable probes take.
    forgetRememberedDatafiles(); fetches = 0;
    const ownerC = {};
    await runOwnerOperation(ownerC, env, async () => {
      const stamp = retentionBirth(env, 'oh', 'profile', now); expiresAt = stamp.expiresAt;
      pinRetention(env, stamp, 'oh', 'profile');
      await new OptimizelyService(env, 'oh').initialize();
    }).catch(() => undefined);
    expect(fetches).toBe(1);
    await expect(new OptimizelyService(env, 'oh').createFreshClient()).rejects.toThrow('Failed to fetch datafile: 503');
    expect(fetches).toBe(2);
  });

  it('remembers a network failure met inside a healthy owner operation: the datafile\'s own failure, not the fence\'s', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { env } = customer();
    const network = new TypeError('Network connection lost');
    const fetcher = vi.fn(async (_input?: unknown): Promise<Response> => { void _input; throw network; }); vi.stubGlobal('fetch', fetcher);
    const owner = {};
    const err = await runOwnerOperation(owner, env, async () => {
      pinRetention(env, retentionBirth(env, 'oh', 'profile', now), 'oh', 'profile');
      return new OptimizelyService(env, 'oh').createFreshClient();
    }).then(() => null, (error: unknown) => error);
    expect(err).toBe(network);
    now += FAILED_DATAFILE_MS - 1;
    await expect(new OptimizelyService(env, 'oh').createFreshClient()).rejects.toBe(network);
    expect(datafileFetches(fetcher)).toBe(1);
  });

  it('never remembers an HTTP 401 refusal, wherever it is raised, and keeps environments apart', async () => {
    const { env } = customer();
    const fetcher = vi.fn(async (_input?: unknown): Promise<Response> => { void _input; throw new SessionAccessError(); }); vi.stubGlobal('fetch', fetcher);
    await expect(new OptimizelyService(env, 'oh').createFreshClient()).rejects.toBeInstanceOf(SessionAccessError);
    fetcher.mockImplementation(async () => Response.json(datafile(1)));
    expect((await new OptimizelyService(env, 'oh').createFreshClient()).revision).toBe('1');
    expect(datafileFetches(fetcher)).toBe(2);
    // Another environment (another backing KV binding) remembers nothing of this one.
    const other = customer();
    fetcher.mockImplementation(async () => new Response('unavailable', { status: 503 }));
    await expect(new OptimizelyService(other.env, 'oh').createFreshClient()).rejects.toThrow('503');
    expect((await new OptimizelyService(env, 'oh').createFreshClient()).revision).toBe('1');
    expect(datafileFetches(fetcher)).toBe(3);
  });
});
