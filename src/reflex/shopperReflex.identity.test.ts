// src/reflex/shopperReflex.identity.test.ts
//
// CW25 on the object host: the three identity doors on ShopperReflex, and the
// forward. Two objects share a fake namespace so a forward from the browser's
// object reaches the person's. Same fakes as shopperReflex.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopperReflex, type AffinityRecord } from '@/durable-objects/ShopperReflex';
import { DEFAULT_REFLEX_CONFIG, audienceKey } from '@/reflex/core';
import { linkVisitor } from '@/identity/link';
import { shopperIdFor } from '@/identity/shopperId';
import type { Env } from '@/types/env';

const CFG = DEFAULT_REFLEX_CONFIG;
const TABBY_ID = 'COA-CH857'; // real catalog product: line Tabby
const TABBY = audienceKey('line', 'Tabby');
const t0 = 1_750_000_000_000;

class FakeStorage {
  map = new Map<string, unknown>();
  alarm: number | null = null;
  async get(keys: string | string[]): Promise<any> {
    if (Array.isArray(keys)) {
      const out = new Map<string, unknown>();
      for (const k of keys) if (this.map.has(k)) out.set(k, structuredClone(this.map.get(k)));
      return out;
    }
    return structuredClone(this.map.get(keys));
  }
  async put(a: any, b?: any): Promise<void> {
    if (typeof a === 'string') this.map.set(a, structuredClone(b));
    else for (const [k, v] of Object.entries(a)) this.map.set(k, structuredClone(v));
  }
  async delete(k: string): Promise<boolean> { return this.map.delete(k); }
  async deleteAll(): Promise<void> { this.map.clear(); this.alarm = null; }
  async setAlarm(t: number | Date): Promise<void> { this.alarm = typeof t === 'number' ? t : t.getTime(); }
  async getAlarm(): Promise<number | null> { return this.alarm; }
}

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<any> { const v = this.store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
  async list(opts?: { prefix?: string }) { const p = opts?.prefix ?? ''; return { keys: [...this.store.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })) }; }
}

/** A namespace of shopper objects, created on first use, addressed by name. */
class FakeNamespace {
  objects = new Map<string, { shopper: ShopperReflex; storage: FakeStorage }>();
  constructor(private env: () => Env) {}
  idFromName(name: string) { return name; }
  get(name: string) {
    return { fetch: (input: RequestInfo | URL, init?: RequestInit) => this.object(name).shopper.fetch(new Request(input as string, init)) };
  }
  object(name: string) {
    let o = this.objects.get(name);
    if (!o) {
      const storage = new FakeStorage();
      const state = { storage, acceptWebSocket: () => undefined, getWebSockets: () => [] } as unknown as DurableObjectState;
      o = { shopper: new ShopperReflex(state, this.env()), storage };
      this.objects.set(name, o);
    }
    return o;
  }
}

let env: Env;
let ns: FakeNamespace;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(t0);
  ns = new FakeNamespace(() => env);
  env = { CACHE: new FakeKV(), SESSIONS: new FakeKV(), ENVIRONMENT: 'test', CONNECTOR_MODE: 'mock', REFLEX_HOST: 'do', SHOPPER_REFLEX: ns } as unknown as Env;
});
afterEach(() => { vi.useRealTimers(); });

const view = (userId: string, pid = TABBY_ID) => ({ type: 'product_view', userId, data: { productId: pid, action: 'product_view' }, source: 'test' });

async function post(name: string, path: string, body: unknown) {
  const res = await ns.get(name).fetch(`https://do${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}
async function get(name: string, path: string) {
  const res = await ns.get(name).fetch(`https://do${path}`);
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}

async function browseTabby(name: string, times = 3, from = t0) {
  for (let i = 0; i < times; i++) {
    vi.setSystemTime(from + i * 5_000);
    await post(name, '/ingest', view(name));
  }
}

describe('the doors', () => {
  it('export → absorb: the person carries what the browser learned, under the person’s id', async () => {
    await browseTabby('vis-phone');
    const exported = await get('vis-phone', '/identity/export');
    expect(exported.body.affinity.shopperId).toBe('vis-phone');
    expect(exported.body.forwardTo).toBeNull();

    const sh = 'sh_' + 'a'.repeat(32);
    const absorbed = await post(sh, '/identity/absorb', { shopperId: sh, now: t0 + 12_000, affinity: exported.body.affinity, pipeline: exported.body.pipeline });
    expect(absorbed.status).toBe(200);
    expect(absorbed.body.audiences).toContain(TABBY);
    const person = ns.object(sh).storage.map.get('affinity') as AffinityRecord;
    expect(person.shopperId).toBe(sh);
    expect((ns.object(sh).storage.map.get('pipeline') as { visitorId?: string }).visitorId).toBe(sh);
  });

  it('absorb twice, from two devices: counters add and the vector is the sum', async () => {
    // Two views on each device, interleaved in time; neither device alone crosses θ_in.
    await browseTabby('vis-phone', 2, t0);
    await browseTabby('vis-laptop', 2, t0 + 2_000);
    const sh = 'sh_' + 'b'.repeat(32);
    const a = (await get('vis-phone', '/identity/export')).body;
    const b = (await get('vis-laptop', '/identity/export')).body;
    expect(a.affinity.reflex.audiences).toEqual([]);
    expect(b.affinity.reflex.audiences).toEqual([]);
    await post(sh, '/identity/absorb', { shopperId: sh, now: t0 + 10_000, affinity: a.affinity, pipeline: a.pipeline });
    const second = await post(sh, '/identity/absorb', { shopperId: sh, now: t0 + 10_000, affinity: b.affinity, pipeline: b.pipeline });
    expect(second.body.audiences).toContain(TABBY);
    const pipe = ns.object(sh).storage.map.get('pipeline') as { attributes: Record<string, number>; sessionCount: number };
    expect(pipe.attributes.product_views).toBe(4);
  });

  it('forward: the browser’s object hands ingest and snapshot to the person’s', async () => {
    const sh = 'sh_' + 'c'.repeat(32);
    await browseTabby('vis-phone', 1);
    const e = (await get('vis-phone', '/identity/export')).body;
    await post(sh, '/identity/absorb', { shopperId: sh, now: t0 + 6_000, affinity: e.affinity, pipeline: e.pipeline });
    await post('vis-phone', '/identity/forward', { to: sh });

    vi.setSystemTime(t0 + 7_000);
    const r = await post('vis-phone', '/ingest', view('vis-phone'));
    expect(r.status).toBe(200);
    expect(r.headers.get('X-Forwarded-Shopper')).toBe(sh);
    const snap = await get('vis-phone', '/snapshot');
    expect(snap.headers.get('X-Forwarded-Shopper')).toBe(sh);
    // The person got the view; the browser's own object did not grow.
    const person = ns.object(sh).storage.map.get('affinity') as AffinityRecord;
    expect(person.reflex.dims.line.Tabby.s).toBeGreaterThan(1);
    const browser = ns.object('vis-phone').storage.map.get('affinity') as AffinityRecord;
    expect(browser.reflex.dims.line.Tabby.s).toBeLessThanOrEqual(1);
    // The identity doors themselves are never forwarded.
    expect((await get('vis-phone', '/identity/export')).body.forwardTo).toBe(sh);
  });

  it('import: rows at their own time, evaluated now', async () => {
    const sh = 'sh_' + 'd'.repeat(32);
    const r = await post(sh, '/identity/import', { shopperId: sh, now: t0, rows: [
      { action: 'purchase', at: t0 - 20_000, touches: [{ dim: 'line', value: 'Rogue' }] },
      { action: 'purchase', at: t0 - 10_000, touches: [{ dim: 'line', value: 'Rogue' }] },
    ] });
    expect(r.body.applied).toBe(2);
    expect(r.body.audiences).toContain(audienceKey('line', 'Rogue'));
    const person = ns.object(sh).storage.map.get('affinity') as AffinityRecord;
    expect(person.reflex.dims.line.Rogue.t).toBe(t0 - 10_000);
    expect(person.lastSeen).toBe(0);
  });

  it('reset clears a forward with everything else', async () => {
    await post('vis-x', '/identity/forward', { to: 'sh_' + 'e'.repeat(32) });
    await post('vis-x', '/reset', {});
    expect((await get('vis-x', '/identity/export')).body.forwardTo).toBeNull();
  });
});

describe('linkVisitor on the object host', () => {
  it('does the whole thing: export, absorb, forward, and answers the person’s audiences', async () => {
    await browseTabby('vis-phone');
    vi.setSystemTime(t0 + 12_000);
    const r = await linkVisitor(env, 'coach', { visitorId: 'vis-phone', accountId: 'acct-1001', source: 'login', assurance: 'site' });
    const sh = await shopperIdFor(env, 'coach', 'acct-1001');
    expect(r.shopperId).toBe(sh);
    expect(r.outcome).toBe('linked');
    expect(r.audiences).toContain(TABBY);
    expect(r.sessionId).toBeNull();
    expect((await get('vis-phone', '/identity/export')).body.forwardTo).toBe(sh); // default brand: bare name
    // Linking again from the same browser folds nothing and reports the person.
    const again = await linkVisitor(env, 'coach', { visitorId: 'vis-phone', accountId: 'acct-1001', source: 'login', assurance: 'site' });
    expect(again.outcome).toBe('already');
    expect(again.audiences).toContain(TABBY);
  });

  it('names the person’s object under the brand prefix for a non-default brand', async () => {
    const r = await linkVisitor(env, 'kate-spade', { visitorId: 'vis-ks', accountId: 'acct-1', source: 'login', assurance: 'site' });
    expect((await get('t:kate-spade:vis-ks', '/identity/export')).body.forwardTo).toBe(`t:kate-spade:${r.shopperId}`);
  });
});
