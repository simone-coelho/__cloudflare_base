// Lane E4: the per-event KV lists, read once per window instead of once per action.
//
// R10 (P105, R-P644 (1)): the tenant's published audiences are now one member of its configuration
// publication (P105, E30), read through the operation's pin and never listed from KV once the tenant is
// moved. The four audience tests below keep lane E4's behaviours on a tenant that holds the member (its
// publication in STORAGE): published audiences qualify exactly as a fresh read does; a write through any
// store of this isolate is read on the next read; a write through another binding is read on the next read
// with no clock moved; no read lists KV; a caller cannot change what the next caller reads; the member is
// read once per committed set per binding and tenant, across owner operations. The ten-second list counts
// they pinned (:48, :51, :68, :91, :95 before) belonged to the copy P105 replaces. A read that is an owner
// operation (every request-path reader) reads the head each time; a bare store over the worker's own binding
// may answer from that handle's serving entry (publication.ts pinPublication, the identical handle).
//
// On the OH rig with hosted-like KV latency, every action listed the tenant's audiences (qualification)
// and every action that built an update listed the shopper's feature-variable overrides: two KV lists,
// about 120 ms each, in front of the answer. A KV list is never served from the edge cache, so on a
// hosted worker each one is a round trip to central storage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types/env';
import type { AudienceDef } from './types';
import { KvAudienceStore } from './AudienceStore';
import { initializePublicationSet, invalidatePublicationCache } from '@/config/publication';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { MockSegmentProvider } from './SegmentProvider';
import { MockAudienceAuthoring } from './AudienceAuthoring';
import { getConnectors } from '@/connectors';
import { FeatureVariableManager } from '@/services/FeatureVariableManager';
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
/** The configuration publication's bucket: conditional writes on an etag, as R2 answers them (src/units/_parity.ts UnitR2). */
class R2 {
  objects = new Map<string, string>(); versions = new Map<string, number>(); calls: string[] = [];
  async get(key: string) {
    this.calls.push('get:' + key);
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length, body: new Response(raw).body, text: async () => raw };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if ((absent && old !== null) || (match != null && match !== old)) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key); }
  async list(options: { prefix?: string } = {}) {
    return { objects: [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort().map(key => ({ key })), truncated: false };
  }
}
const env = (cache: KV, storage?: R2) => ({ CACHE: cache, ...(storage ? { STORAGE: storage } : {}), DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', TENANTS: JSON.stringify({ provisioned: ['oh', 'meridian'] }) } as unknown as Env);
const qualify = (e: Env, views: number) => getConnectors(e, 'oh').segments.fetchQualifiedSegments('visitor', { userId: 'visitor', attributes: { product_views: views }, segments: [] });
/** Each tenant's configuration publication, and the tenant moved: one audience published and archived, so its set carries the (empty) audiences member. */
async function moved(cache: KV, storage: R2, tenants = ['oh', 'meridian']): Promise<Env> {
  const e = env(cache, storage);
  for (const tenant of tenants) {
    await initializePublicationSet(e, [{ kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant), revision: { revision: 1, at: 1, actor: 'e4-fixture', note: '', value: DEFAULT_REFLEX_CONFIG } }], '0:' + crypto.randomUUID());
    await new KvAudienceStore(e, tenant).publish(audience('placeholder', 99));
    await new KvAudienceStore(e, tenant).archive('placeholder');
  }
  invalidatePublicationCache(); cache.calls.length = 0; storage.calls.length = 0;
  return e;
}
/** Another isolate: its own binding objects over the same KV records and the same bucket. */
const elsewhere = (cache: KV, storage: R2) => env(Object.create(cache) as KV, Object.create(storage) as R2);
const memberReads = (storage: R2, tenant: string) => storage.calls.filter(c => c.startsWith(`get:config-publication/v1/${tenant}/audiences/rev/`)).length;

let now = 5_000_000;
beforeEach(() => { invalidatePublicationCache(); forgetRememberedDatafiles(); now = 5_000_000; vi.spyOn(Date, 'now').mockImplementation(() => now); });
afterEach(() => { vi.restoreAllMocks(); });

describe('E4 the tenant\'s published audiences', () => {
  it('are read through the tenant\'s publication for qualification and qualify exactly as a fresh read does; no read lists KV, whatever the time', async () => {
    const cache = new KV(), storage = new R2(), e = await moved(cache, storage);
    await new KvAudienceStore(e, 'oh').publish(audience('viewer'));
    expect(await qualify(e, 1)).toEqual(['viewer']);
    expect(await qualify(e, 0)).toEqual([]);
    now += 3_600_000;
    expect(await qualify(e, 2)).toEqual(['viewer']);
    expect(lists(cache)).toBe(0);
  });

  it('are read again at once after a write through this isolate, so a new audience qualifies on the next event', async () => {
    const cache = new KV(), storage = new R2(), e = await moved(cache, storage);
    expect(await qualify(e, 3)).toEqual([]);
    // Authored through the authoring adapter, the door Opal and the console use, over the same bindings.
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
    expect(lists(cache)).toBe(0);
  });

  it('are read on the next read after a write through another binding, with no clock moved, and a caller cannot change what the next caller reads', async () => {
    const cache = new KV(), storage = new R2(), e = await moved(cache, storage);
    // Each read is an owner operation, as every request-path reader is: its own handle, the publication's head read each time.
    const read = () => { const owner = {}; return runOwnerOperation(owner, e, async () => new KvAudienceStore(ownerEnvironment(owner, e), 'oh').listPublished()); };
    expect(await read()).toEqual([]);
    await new KvAudienceStore(elsewhere(cache, storage), 'oh').publish(audience('late'));
    expect((await read()).map(a => a.key)).toEqual(['late']);
    const copy = await read();
    try { copy[0]!.status = 'archived'; copy.push(audience('injected')); } catch { /* a frozen list refuses the change */ }
    expect((await read()).map(a => [a.key, a.status])).toEqual([['late', 'published']]);
    expect(lists(cache)).toBe(0);
  });

  it('are read per backing binding and tenant, once per committed set, across owner operations', async () => {
    const cache = new KV(), storage = new R2(), e = await moved(cache, storage);
    await new KvAudienceStore(e, 'oh').publish(audience('oh-only'));
    await new KvAudienceStore(e, 'meridian').publish(audience('meridian-only'));
    storage.calls.length = 0;
    const owner = {}, other = {};
    await runOwnerOperation(owner, e, async () => { expect(await new MockSegmentProvider(new KvAudienceStore(ownerEnvironment(owner, e), 'oh'))
      .fetchQualifiedSegments('visitor', { userId: 'visitor', attributes: { product_views: 1 }, segments: [] })).toEqual(['oh-only']); });
    await runOwnerOperation(other, e, async () => { expect(await new MockSegmentProvider(new KvAudienceStore(ownerEnvironment(other, e), 'oh'))
      .fetchQualifiedSegments('visitor', { userId: 'visitor', attributes: { product_views: 1 }, segments: [] })).toEqual(['oh-only']); });
    expect(memberReads(storage, 'oh')).toBe(1);
    expect((await new KvAudienceStore(e, 'meridian').listPublished()).map(a => a.key)).toEqual(['meridian-only']);
    const separate = new R2(); separate.objects = new Map(storage.objects); separate.versions = new Map(storage.versions);
    expect((await new KvAudienceStore(env(cache, separate), 'oh').listPublished()).map(a => a.key)).toEqual(['oh-only']);
    expect(memberReads(separate, 'oh')).toBe(1);
    expect(lists(cache)).toBe(0);
  });
});

describe('E4 a shopper\'s feature-variable overrides', () => {
  // R10 (P105 AL7, R-P652): the visitor's per-event override read is gone from the request path (no route writes an
  // override and no answer used one), and with it the per-event probes' remembered list (OVERRIDES_LIST_MS). What
  // remains are the direct reads, which ask KV on each read and read a set or a removal through this isolate at once.
  it('are read from KV by each direct read, with no copy between them; a set or a removal through this isolate is read at once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined); vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const cache = new KV(), e = env(cache), manager = new FeatureVariableManager(e, 'oh');
    const read = () => manager.getFeatureVariables('visitor', {}, ['hero_content']);
    const listed = () => cache.calls.filter(c => c.startsWith('list:t:oh:override:')).length;
    const plain = (await read()).hero_content; await read();
    expect(plain).toMatchObject({ featureKey: 'hero_content' });
    expect(listed()).toBe(2);
    await new FeatureVariableManager(e, 'oh').setUserOverride({ userId: 'visitor', featureKey: 'hero_content', variableKey: 'title', value: 'pinned' });
    expect((await read()).hero_content).toMatchObject({ source: 'override', variables: { title: 'pinned' } });
    await new FeatureVariableManager(e, 'oh').removeUserOverride('visitor', 'hero_content', 'title');
    // The removal read at once: the read answers exactly what it answered before the override was set.
    expect((await read()).hero_content).toEqual(plain);
    const before = cache.calls.length;
    await new FeatureVariableManager(e, 'oh').getUserOverrides('visitor');
    expect(cache.calls.slice(before).filter(c => c.startsWith('list:'))).toHaveLength(1);
  });
});
