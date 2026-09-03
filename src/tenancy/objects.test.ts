// src/tenancy/objects.test.ts
//
// The per-shopper Durable Object holds the interest vector every decision is made
// from, so a name collision across brands is not a stale read: it is one merged
// shopper. And unlike KV, a DO namespace cannot be listed, so an object orphaned
// by a naming change is invisible.

import { describe, it, expect } from 'vitest';
import { DEFAULT_TENANT } from '@/tenancy/tenant';
import { shopperObject, shopperObjectName, singletonObject, type DONamespaceLike } from '@/tenancy/objects';

/** Records every name it is asked for, and hands back the name as the stub. */
function fakeNamespace(): DONamespaceLike<string, string> & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    idFromName(name: string) { asked.push(name); return name; },
    get(id: string) { return id; },
  };
}

describe('per-shopper object names', () => {
  it('leaves the default tenant on the bare visitor id, so no existing object is orphaned', () => {
    expect(shopperObjectName(DEFAULT_TENANT, 'vis-abc')).toBe('vis-abc');
  });

  it('namespaces every other brand', () => {
    expect(shopperObjectName('kate-spade', 'vis-abc')).toBe('t:kate-spade:vis-abc');
  });

  it('gives ONE shopper on two brands two different objects', () => {
    // Before this, both resolved to `vis-abc`: one object, one merged affinity
    // profile, decisions for Coach made partly from Kate Spade behaviour.
    const coach = shopperObjectName(DEFAULT_TENANT, 'vis-abc');
    const ks = shopperObjectName('kate-spade', 'vis-abc');
    const sw = shopperObjectName('stuart-weitzman', 'vis-abc');
    expect(new Set([coach, ks, sw]).size).toBe(3);
  });

  it('refuses a visitor id that addresses a namespace directly', () => {
    // `userId` arrives on every action, so this is wire input. Under the default
    // tenant the name would otherwise be handed through verbatim and resolve to
    // another brand's shopper object.
    expect(() => shopperObjectName(DEFAULT_TENANT, 't:kate-spade:vis-victim')).toThrow(/may not start with/);
    expect(() => shopperObjectName('stuart-weitzman', 't:kate-spade:vis-victim')).toThrow(/may not start with/);
  });
});

describe('resolving a stub', () => {
  it('asks the namespace for the scoped name', () => {
    const ns = fakeNamespace();
    shopperObject(ns, 'vis-abc', 'kate-spade');
    expect(ns.asked).toEqual(['t:kate-spade:vis-abc']);
  });

  it('defaults to the default tenant, so an unconverted call site is unchanged', () => {
    const ns = fakeNamespace();
    shopperObject(ns, 'vis-abc');
    expect(ns.asked).toEqual(['vis-abc']);
  });

  it('never lets a malicious id reach another brand through the stub', () => {
    const ns = fakeNamespace();
    expect(() => shopperObject(ns, 't:kate-spade:vis-victim')).toThrow();
    expect(ns.asked).toEqual([]);
  });
});

describe('singletons are deliberately not per-brand', () => {
  it('passes the name through untouched', () => {
    const ns = fakeNamespace();
    singletonObject(ns, 'admin');
    singletonObject(ns, 'health-check');
    expect(ns.asked).toEqual(['admin', 'health-check']);
  });
});
