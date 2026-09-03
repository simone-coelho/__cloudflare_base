// src/tenancy/tenant.test.ts
//
// The default tenant is unprefixed so nothing already stored is orphaned, and
// that choice creates one specific hazard: code which ignores the tenant entirely
// still looks correct for Coach. Tenancy would read as finished while the core is
// still hardcoded, and the failure would surface only when a second brand is
// provisioned -- the exact moment §1.7 promises is "a provisioning exercise
// rather than another build".
//
// So the isolation tests below always involve a pair that cannot both pass by
// accident: default against non-default, AND non-default against non-default.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_TENANT,
  TenantKV,
  isValidTenantId,
  logicalKey,
  resolveTenant,
  tenantKey,
  tenantPrefix,
  type KVLike,
} from '@/tenancy/tenant';

class FakeKV implements KVLike {
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

let kv: FakeKV;
beforeEach(() => { kv = new FakeKV(); });

describe('tenant ids', () => {
  it('accepts the shapes a brand slug takes', () => {
    for (const ok of ['coach', 'kate-spade', 'stuart-weitzman', 'brand2']) {
      expect(isValidTenantId(ok)).toBe(true);
    }
  });

  it('rejects anything that could escape a key namespace', () => {
    // A tenant id becomes part of a KV key, so a colon or a slash in one is a
    // way to read another tenant's data.
    for (const bad of ['', 'a:b', 'a/b', '../x', 'UPPER', '-leading', 'x'.repeat(40), null, 42, undefined]) {
      expect(isValidTenantId(bad)).toBe(false);
    }
  });
});

describe('resolution', () => {
  it('prefers explicit, then header, then host', () => {
    expect(resolveTenant({ explicit: 'kate-spade', header: 'a', host: 'b.com' })).toBe('kate-spade');
    expect(resolveTenant({ header: 'kate-spade', host: 'b.com', hostMap: { 'b.com': 'other' } })).toBe('kate-spade');
    expect(resolveTenant({ host: 'shop.katespade.com', hostMap: { 'shop.katespade.com': 'kate-spade' } })).toBe('kate-spade');
  });

  it('falls back to the default rather than throwing or inventing one', () => {
    // The failure mode of a bad tenant id must be "you got Coach", never "you got
    // another brand's data" and never a 500 on the decision path.
    expect(resolveTenant({})).toBe(DEFAULT_TENANT);
    expect(resolveTenant({ explicit: 'not a tenant!' })).toBe(DEFAULT_TENANT);
    expect(resolveTenant({ host: 'unknown.com', hostMap: { 'other.com': 'x' } })).toBe(DEFAULT_TENANT);
    expect(resolveTenant({ explicit: null, header: null, host: null })).toBe(DEFAULT_TENANT);
  });

  it('is case and whitespace insensitive', () => {
    expect(resolveTenant({ explicit: '  Kate-Spade ' })).toBe('kate-spade');
  });
});

describe('key spacing', () => {
  it('leaves the default tenant UNPREFIXED, so nothing already stored is orphaned', () => {
    expect(tenantKey(DEFAULT_TENANT, 'audience:tabby')).toBe('audience:tabby');
    expect(tenantPrefix(DEFAULT_TENANT)).toBe('');
  });

  it('namespaces every other tenant', () => {
    expect(tenantKey('kate-spade', 'audience:tabby')).toBe('t:kate-spade:audience:tabby');
  });

  it('maps a physical key back, and refuses one belonging to someone else', () => {
    expect(logicalKey('kate-spade', 't:kate-spade:audience:x')).toBe('audience:x');
    expect(logicalKey('kate-spade', 't:other:audience:x')).toBeNull();
    expect(logicalKey('kate-spade', 'audience:x')).toBeNull();
  });

  it('does NOT let the default tenant claim a namespaced key', () => {
    // The leak the unprefixed default invites: without this, Coach owns
    // everything, including every other brand's data.
    expect(logicalKey(DEFAULT_TENANT, 't:kate-spade:audience:x')).toBeNull();
    expect(logicalKey(DEFAULT_TENANT, 'audience:x')).toBe('audience:x');
  });
});

describe('hard data isolation, which is what §1.7 actually promises', () => {
  it('two NON-DEFAULT tenants cannot read each other', async () => {
    // The pair that cannot pass by accident. If the tenant were ignored entirely,
    // this is the assertion that fails.
    const ks = new TenantKV(kv, 'kate-spade');
    const sw = new TenantKV(kv, 'stuart-weitzman');
    await ks.put('audience:evening', 'kate');
    await sw.put('audience:evening', 'stuart');

    expect(await ks.get('audience:evening')).toBe('kate');
    expect(await sw.get('audience:evening')).toBe('stuart');
  });

  it('the default tenant cannot read another brand, and is not read by one', async () => {
    const coach = new TenantKV(kv, DEFAULT_TENANT);
    const ks = new TenantKV(kv, 'kate-spade');
    await coach.put('audience:evening', 'coach');
    await ks.put('audience:evening', 'kate');

    expect(await coach.get('audience:evening')).toBe('coach');
    expect(await ks.get('audience:evening')).toBe('kate');
  });

  it('a delete in one brand does not touch another', async () => {
    const ks = new TenantKV(kv, 'kate-spade');
    const coach = new TenantKV(kv, DEFAULT_TENANT);
    await coach.put('audience:x', 'coach');
    await ks.put('audience:x', 'kate');

    await ks.delete('audience:x');
    expect(await ks.get('audience:x')).toBeNull();
    expect(await coach.get('audience:x')).toBe('coach');
  });

  it('list is scoped, and returns LOGICAL names so callers see no difference', async () => {
    const ks = new TenantKV(kv, 'kate-spade');
    await ks.put('audience:a', '1');
    await ks.put('audience:b', '2');
    await new TenantKV(kv, 'stuart-weitzman').put('audience:c', '3');

    const listed = await ks.list({ prefix: 'audience:' });
    expect(listed.keys.map((k) => k.name)).toEqual(['audience:a', 'audience:b']);
  });

  it("the default tenant's list does NOT sweep up other brands", async () => {
    // Its physical prefix is empty, so an unfiltered list would return every
    // namespaced key in the store. This is the single most likely isolation leak
    // in the whole design.
    const coach = new TenantKV(kv, DEFAULT_TENANT);
    await coach.put('audience:a', '1');
    await new TenantKV(kv, 'kate-spade').put('audience:b', '2');
    await new TenantKV(kv, 'stuart-weitzman').put('audience:c', '3');

    const listed = await coach.list({ prefix: 'audience:' });
    expect(listed.keys.map((k) => k.name)).toEqual(['audience:a']);
  });

  it('an unprefixed list from the default tenant still excludes other brands', async () => {
    const coach = new TenantKV(kv, DEFAULT_TENANT);
    await coach.put('session:1', 'a');
    await new TenantKV(kv, 'kate-spade').put('session:2', 'b');

    const listed = await coach.list();
    expect(listed.keys.map((k) => k.name)).toEqual(['session:1']);
  });
});

describe('adoption is safe one store at a time', () => {
  it('an unconverted call site sharing the raw KV still sees the default tenant', async () => {
    // A half-converted key space has to keep working, because CW1 lands store by
    // store rather than in one sweep.
    const coach = new TenantKV(kv, DEFAULT_TENANT);
    await coach.put('audience:x', 'written-through-the-wrapper');
    expect(await kv.get('audience:x')).toBe('written-through-the-wrapper');

    await kv.put('audience:y', 'written-directly');
    expect(await coach.get('audience:y')).toBe('written-directly');
  });

  it('but an unconverted call site can never reach a non-default brand', async () => {
    await new TenantKV(kv, 'kate-spade').put('audience:x', 'kate');
    expect(await kv.get('audience:x')).toBeNull();
  });
});

describe('the namespace cannot be addressed directly', () => {
  it('refuses a logical key that starts with the marker, on the DEFAULT tenant', async () => {
    // The one-directional hole: for the default tenant tenantKey() is the
    // identity function, so without this guard a Coach caller asking for
    // `t:kate-spade:audience:x` is handed exactly Kate Spade's physical key.
    expect(() => tenantKey(DEFAULT_TENANT, 't:kate-spade:audience:x')).toThrow(/may not start with/);
  });

  it('refuses it on a namespaced tenant too, so the rule is one rule', () => {
    expect(() => tenantKey('kate-spade', 't:coach:audience:x')).toThrow(/may not start with/);
  });

  it('blocks it through the store, where user input actually arrives', async () => {
    // Visitor ids come in as `userId` on every action and become object names
    // and session keys. This is wire input, not an internal invariant.
    const coach = new TenantKV(kv, DEFAULT_TENANT);
    await new TenantKV(kv, 'kate-spade').put('audience:secret', 'kate');

    // Synchronous, deliberately: the wrapper adds no microtask of its own, because
    // live.ts's per-visitor ingestion chain is sensitive to exactly that.
    expect(() => coach.get('t:kate-spade:audience:secret')).toThrow(/may not start with/);
    expect(() => coach.put('t:kate-spade:audience:secret', 'stolen')).toThrow();
    expect(() => coach.delete('t:kate-spade:audience:secret')).toThrow();

    // and the target is untouched
    expect(await new TenantKV(kv, 'kate-spade').get('audience:secret')).toBe('kate');
  });

  it('still allows every ordinary key, including ones merely containing a colon', () => {
    expect(() => tenantKey(DEFAULT_TENANT, 'audience:tabby')).not.toThrow();
    expect(() => tenantKey(DEFAULT_TENANT, 'reflex:config:coach:current')).not.toThrow();
    expect(() => tenantKey('kate-spade', 'session:abc')).not.toThrow();
    // 'to:' and 'tt:' are not the marker
    expect(() => tenantKey(DEFAULT_TENANT, 'to:x')).not.toThrow();
  });
});
