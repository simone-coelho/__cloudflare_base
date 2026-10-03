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
  it('is never fetched, read or logged for a tenant with no key, which degrades at once', async () => {
    const fetcher = vi.fn(async () => Response.json(datafile(1))); vi.stubGlobal('fetch', fetcher);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cache = new KV(), env = { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', CACHE: cache,
      TENANTS: JSON.stringify({ provisioned: ['oh'] }) } as unknown as Env;
    expect(new OptimizelyService(env, 'oh').hasFxKey()).toBe(false);
    for (let i = 0; i < 3; i++) {
      const decisions = await decideOnce(env);
      expect(Object.keys(decisions)).toEqual(CATALOG_FLAG_KEYS);
      for (const d of Object.values(decisions)) expect(d).toMatchObject({ enabled: false, variationKey: null, reason: 'fallback' });
    }
    expect(fetcher).not.toHaveBeenCalled(); expect(cache.calls).toEqual([]);
    expect(errors.mock.calls.flat().filter(m => String(m).includes('datafile'))).toEqual([]);
    // The legacy demo with no real key and the FX decision source switched on: nothing fetched either.
    const legacy = { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'optimizely', OPTIMIZELY_SDK_KEY: 'your-sdk-key-here', CACHE: new KV() } as unknown as Env;
    expect(Object.keys(await getConnectors(legacy).decisions.decideAll(CATALOG_FLAG_KEYS, 'visitor', [], {}))).toEqual(CATALOG_FLAG_KEYS);
    expect(fetcher).not.toHaveBeenCalled();
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

  it('never remembers an authority refusal raised while fetching, and keeps environments apart', async () => {
    const { env } = customer();
    const fetcher = vi.fn(async (_input?: unknown): Promise<Response> => { throw new SessionAccessError(); }); vi.stubGlobal('fetch', fetcher);
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
