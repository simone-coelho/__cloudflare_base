// src/tenancy/storeIsolation.test.ts
//
// tenant.test.ts proves the primitive. This proves the two stores that actually
// hold per-brand data, because a correct primitive nobody calls is worth nothing
// and §1.7 promises "hard data isolation between brands", not a helper that could
// provide it.
//
// Every test here also asserts the physical KV keys, not just the reads. Reads
// can agree for the wrong reason -- two brands both returning null looks like
// isolation -- so the assertions that matter are about where the bytes landed.

import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '@/types/env';
import type { AudienceDef } from '@/connectors/types';
import { KvAudienceStore } from '@/connectors/AudienceStore';
import { SessionManager } from '@/services/SessionManager';
import { DEFAULT_TENANT } from '@/tenancy/tenant';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    return type === 'json' ? JSON.parse(raw) : raw;
  }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
  async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
    const p = options?.prefix ?? '';
    return { keys: [...this.store.keys()].filter((k) => k.startsWith(p)).sort().map((name) => ({ name })) };
  }
}

const audience = (key: string, name: string): AudienceDef => ({
  key, name, description: '', conditions: ['and'] as never,
  evaluation: 'realtime', source: 'catalog', createdAt: 0, status: 'published',
});

let cache: FakeKV;
let sessions: FakeKV;
let env: Env;

beforeEach(() => {
  cache = new FakeKV();
  sessions = new FakeKV();
  env = { CACHE: cache, SESSIONS: sessions } as unknown as Env;
});

describe('audiences are isolated per brand', () => {
  it('two brands can hold the SAME audience key without colliding', async () => {
    const coach = new KvAudienceStore(env, DEFAULT_TENANT);
    const ks = new KvAudienceStore(env, 'kate-spade');

    await coach.publish(audience('line_tabby_affinity', 'Tabby Affinity'));
    await ks.publish(audience('line_tabby_affinity', 'Spade Flower Affinity'));

    expect((await coach.get('line_tabby_affinity'))!.name).toBe('Tabby Affinity');
    expect((await ks.get('line_tabby_affinity'))!.name).toBe('Spade Flower Affinity');
  });

  it('writes the DEFAULT tenant to the key it has always used, so nothing migrates', async () => {
    await new KvAudienceStore(env, DEFAULT_TENANT).publish(audience('a', 'A'));
    expect([...cache.store.keys()]).toEqual(['audience:a']);
  });

  it('namespaces every other brand', async () => {
    await new KvAudienceStore(env, 'kate-spade').publish(audience('a', 'A'));
    expect([...cache.store.keys()]).toEqual(['t:kate-spade:audience:a']);
  });

  it('listPublished never returns another brand, in either direction', async () => {
    await new KvAudienceStore(env, DEFAULT_TENANT).publish(audience('coach-one', 'C'));
    await new KvAudienceStore(env, 'kate-spade').publish(audience('ks-one', 'K'));
    await new KvAudienceStore(env, 'stuart-weitzman').publish(audience('sw-one', 'S'));

    // The default tenant's prefix is empty, so this is the direction that leaks
    // if logicalKey() ever stops rejecting namespaced keys.
    expect((await new KvAudienceStore(env, DEFAULT_TENANT).listPublished()).map((d) => d.key)).toEqual(['coach-one']);
    expect((await new KvAudienceStore(env, 'kate-spade').listPublished()).map((d) => d.key)).toEqual(['ks-one']);
    expect((await new KvAudienceStore(env, 'stuart-weitzman').listPublished()).map((d) => d.key)).toEqual(['sw-one']);
  });

  it('seeding one brand does not seed another', async () => {
    await new KvAudienceStore(env, DEFAULT_TENANT).seed([audience('seeded', 'S')]);
    expect(await new KvAudienceStore(env, 'kate-spade').get('seeded')).toBeNull();
  });

  it('archiving in one brand leaves the other published', async () => {
    await new KvAudienceStore(env, DEFAULT_TENANT).publish(audience('shared-key', 'C'));
    await new KvAudienceStore(env, 'kate-spade').publish(audience('shared-key', 'K'));

    await new KvAudienceStore(env, 'kate-spade').archive('shared-key');
    expect((await new KvAudienceStore(env, 'kate-spade').get('shared-key'))!.status).toBe('archived');
    expect((await new KvAudienceStore(env, DEFAULT_TENANT).get('shared-key'))!.status).toBe('published');
  });

  it('a rename in one brand does not rename the other', async () => {
    await new KvAudienceStore(env, DEFAULT_TENANT).publish(audience('shared-key', 'Coach name'));
    await new KvAudienceStore(env, 'kate-spade').publish(audience('shared-key', 'Spade name'));

    await new KvAudienceStore(env, 'kate-spade').rename('shared-key', 'Renamed by Spade');
    expect((await new KvAudienceStore(env, DEFAULT_TENANT).get('shared-key'))!.name).toBe('Coach name');
  });
});

describe('sessions are isolated per brand', () => {
  it('the same session id in two brands is two different people', async () => {
    // Without tenancy `session:{id}` was global, so a collision merged two
    // shoppers' interest profiles across brands.
    const coach = new SessionManager(env, { tenant: DEFAULT_TENANT });
    const ks = new SessionManager(env, { tenant: 'kate-spade' });

    await coach.createOrUpdateSession('s1', 'u1', { segments: ['coach_seg'] });
    await ks.createOrUpdateSession('s1', 'u1', { segments: ['spade_seg'] });

    expect((await coach.getSession('s1'))!.segments).toEqual(['coach_seg']);
    expect((await ks.getSession('s1'))!.segments).toEqual(['spade_seg']);
  });

  it('writes the DEFAULT tenant to the keys it has always used', async () => {
    await new SessionManager(env, { tenant: DEFAULT_TENANT }).createOrUpdateSession('s1', 'u1', {});
    expect([...sessions.store.keys()].sort()).toEqual(['session:s1', 'user:u1']);
  });

  it('namespaces every other brand', async () => {
    await new SessionManager(env, { tenant: 'kate-spade' }).createOrUpdateSession('s1', 'u1', {});
    expect([...sessions.store.keys()].sort()).toEqual(['t:kate-spade:session:s1', 't:kate-spade:user:u1']);
  });

  it('the user lookup does not cross brands', async () => {
    await new SessionManager(env, { tenant: 'kate-spade' }).createOrUpdateSession('s-ks', 'shared-user', {});
    expect(await new SessionManager(env, { tenant: DEFAULT_TENANT }).getSessionByUserId('shared-user')).toBeNull();
  });

  it('deleting a session in one brand leaves the other intact', async () => {
    await new SessionManager(env, { tenant: DEFAULT_TENANT }).createOrUpdateSession('s1', 'u1', {});
    await new SessionManager(env, { tenant: 'kate-spade' }).createOrUpdateSession('s1', 'u1', {});

    await new SessionManager(env, { tenant: 'kate-spade' }).deleteSession('s1');
    // The deleted one is gone...
    expect(await new SessionManager(env, { tenant: 'kate-spade' }).getSession('s1')).toBeNull();
    // ...and the other brand's session of the same id is untouched.
    expect(await new SessionManager(env, { tenant: DEFAULT_TENANT }).getSession('s1')).not.toBeNull();
    expect([...sessions.store.keys()]).toContain('session:s1');
  });

  it('the visit count is per brand, which is what makes visit 2 mean anything', async () => {
    // A shopper's second visit to Coach is not her second visit to Kate Spade.
    const coach = new SessionManager(env, { tenant: DEFAULT_TENANT });
    await coach.createOrUpdateSession('s1', 'u1', {});
    const ks = await new SessionManager(env, { tenant: 'kate-spade' }).createOrUpdateSession('s1', 'u1', {});
    expect(ks.metadata.visitCount).toBe(1);
  });
});

describe('an unconverted caller still works, because CW1 lands store by store', () => {
  it('a store built without a tenant is the default tenant', async () => {
    await new KvAudienceStore(env).publish(audience('a', 'A'));
    expect([...cache.store.keys()]).toEqual(['audience:a']);
    expect(new KvAudienceStore(env).tenant).toBe(DEFAULT_TENANT);
  });

  it('a SessionManager built without a tenant is the default tenant', () => {
    expect(new SessionManager(env).tenant).toBe(DEFAULT_TENANT);
  });
});
