// Lane E4: the per-event KV lists, read once per window instead of once per action.
//
// On the OH rig with hosted-like KV latency, every action listed the tenant's audiences (qualification)
// and every action that built an update listed the shopper's feature-variable overrides: two KV lists,
// about 120 ms each, in front of the answer. A KV list is never served from the edge cache, so on a
// hosted worker each one is a round trip to central storage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types/env';
import type { AudienceDef } from './types';
import { AUDIENCE_LIST_MS, KvAudienceStore, forgetListedAudiences } from './AudienceStore';
import { MockSegmentProvider } from './SegmentProvider';
import { MockAudienceAuthoring } from './AudienceAuthoring';
import { getConnectors } from '@/connectors';
import { FeatureVariableManager, OVERRIDES_LIST_MS, forgetListedOverrides } from '@/services/FeatureVariableManager';
import { forgetRememberedDatafiles } from '@/services/OptimizelyService';
import { ownerEnvironment, runOwnerOperation } from '@/identity/sessionAuthority';

class KV {
  data = new Map<string, string>(); calls: string[] = []; gate?: Promise<void>;
  async get(key: string, type?: string) { this.calls.push('get:' + key); const v = this.data.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; }
  async put(key: string, value: string) { this.calls.push('put:' + key); this.data.set(key, value); }
  async delete(key: string) { this.calls.push('delete:' + key); this.data.delete(key); }
  async list(o?: { prefix?: string }) {
    this.calls.push('list:' + (o?.prefix ?? ''));
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).map(name => ({ name }));
    if (this.gate) await this.gate;
    return { keys, list_complete: true };
  }
}
const audience = (key: string, value = 1): AudienceDef => ({ key, name: key, description: 'synthetic', conditions: { attribute: 'product_views', operator: 'gte', value },
  evaluation: 'realtime', source: 'manual', status: 'published', createdAt: 1 } as AudienceDef);
const lists = (kv: KV) => kv.calls.filter(c => c.startsWith('list:')).length;
const env = (cache: KV) => ({ CACHE: cache, DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', TENANTS: JSON.stringify({ provisioned: ['oh', 'meridian'] }) } as unknown as Env);
const qualify = (e: Env, views: number) => getConnectors(e, 'oh').segments.fetchQualifiedSegments('visitor', { userId: 'visitor', attributes: { product_views: views }, segments: [] });

let now = 5_000_000;
beforeEach(() => { forgetListedAudiences(); forgetListedOverrides(); forgetRememberedDatafiles(); now = 5_000_000; vi.spyOn(Date, 'now').mockImplementation(() => now); });
afterEach(() => { vi.restoreAllMocks(); });

describe('E4 the tenant\'s published audiences', () => {
  it('are listed once per AUDIENCE_LIST_MS for qualification, and qualify exactly as a fresh list does', async () => {
    const cache = new KV(), e = env(cache);
    await new KvAudienceStore(e, 'oh').publish(audience('viewer'));
    expect(await qualify(e, 1)).toEqual(['viewer']);
    expect(await qualify(e, 0)).toEqual([]);
    now += AUDIENCE_LIST_MS - 1;
    expect(await qualify(e, 2)).toEqual(['viewer']);
    expect(lists(cache)).toBe(1);
    now += 1;
    expect(await qualify(e, 2)).toEqual(['viewer']);
    expect(lists(cache)).toBe(2);
  });

  it('are listed again at once after a write through this isolate, so a new audience qualifies on the next event', async () => {
    const cache = new KV(), e = env(cache);
    expect(await qualify(e, 3)).toEqual([]);
    // Authored through the authoring adapter, the door Opal and the console use, over the same KV.
    await new MockAudienceAuthoring(new KvAudienceStore(e, 'oh')).createAudience(audience('authored', 3));
    expect(await qualify(e, 3)).toEqual(['authored']);
    await new KvAudienceStore(e, 'oh').publish(audience('heavy', 3));
    expect((await qualify(e, 3)).sort()).toEqual(['authored', 'heavy']);
    await new KvAudienceStore(e, 'oh').archive('heavy');
    expect(await qualify(e, 3)).toEqual(['authored']);
    await new KvAudienceStore(e, 'oh').rename('authored', 'Renamed');
    expect((await new KvAudienceStore(e, 'oh').listPublished()).map(a => a.name)).toEqual(['Renamed']);
    await new KvAudienceStore(e, 'oh').setPinned('authored', true);
    expect((await new KvAudienceStore(e, 'oh').listPublished()).map(a => a.pinned)).toEqual([true]);
    expect(lists(cache)).toBe(6);
  });

  it('is never remembered from a list that a write overtook, and hands out copies', async () => {
    const cache = new KV(), e = env(cache), store = new KvAudienceStore(e, 'oh');
    let release!: () => void; cache.gate = new Promise<void>(r => { release = r; });
    const reading = store.listPublished();
    await new KvAudienceStore(e, 'oh').publish(audience('late'));
    release(); await reading; cache.gate = undefined;
    expect((await store.listPublished()).map(a => a.key)).toEqual(['late']);
    const copy = await store.listPublished(); copy[0]!.status = 'archived'; copy.push(audience('injected'));
    expect((await store.listPublished()).map(a => [a.key, a.status])).toEqual([['late', 'published']]);
  });

  it('are remembered per backing binding and tenant, across owner operations', async () => {
    const cache = new KV(), e = env(cache);
    await new KvAudienceStore(e, 'oh').publish(audience('oh-only'));
    await new KvAudienceStore(e, 'meridian').publish(audience('meridian-only'));
    const owner = {}, other = {};
    await runOwnerOperation(owner, e, async () => { expect(await new MockSegmentProvider(new KvAudienceStore(ownerEnvironment(owner, e), 'oh'))
      .fetchQualifiedSegments('visitor', { userId: 'visitor', attributes: { product_views: 1 }, segments: [] })).toEqual(['oh-only']); });
    await runOwnerOperation(other, e, async () => { expect(await new MockSegmentProvider(new KvAudienceStore(ownerEnvironment(other, e), 'oh'))
      .fetchQualifiedSegments('visitor', { userId: 'visitor', attributes: { product_views: 1 }, segments: [] })).toEqual(['oh-only']); });
    expect(lists(cache)).toBe(1);
    expect((await new KvAudienceStore(e, 'meridian').listPublished()).map(a => a.key)).toEqual(['meridian-only']);
    const separate = new KV(); separate.data = new Map(cache.data);
    await new KvAudienceStore(env(separate), 'oh').listPublished();
    expect(lists(separate)).toBe(1);
  });
});

describe('E4 a shopper\'s feature-variable overrides', () => {
  it('are listed once per OVERRIDES_LIST_MS for the per-event probes; a set or a removal through this isolate is seen at once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined); vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const cache = new KV(), e = env(cache);
    const session = { userId: 'visitor', segments: [], attributes: {}, metadata: { firstSeen: 0, lastSeen: 0, sessionCount: 1, engagementScore: 0, lastSegmentUpdate: 0 },
      preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true } } as never;
    const probes = () => new FeatureVariableManager(e, 'oh').getSessionFeatureVariables(session);
    await probes(); await probes();
    expect(cache.calls.filter(c => c.startsWith('list:t:oh:override:'))).toHaveLength(1);
    await new FeatureVariableManager(e, 'oh').setUserOverride({ userId: 'visitor', featureKey: 'hero_content', variableKey: 'title', value: 'pinned' });
    expect((await probes()).hero_content).toMatchObject({ source: 'override', variables: { title: 'pinned' } });
    await new FeatureVariableManager(e, 'oh').removeUserOverride('visitor', 'hero_content', 'title');
    expect((await probes()).hero_content?.source).not.toBe('override');
    now += OVERRIDES_LIST_MS;
    await probes();
    // Every other read (a direct getUserOverrides, analytics) still asks KV each time.
    const before = cache.calls.length;
    await new FeatureVariableManager(e, 'oh').getUserOverrides('visitor');
    expect(cache.calls.slice(before).filter(c => c.startsWith('list:'))).toHaveLength(1);
  });
});
