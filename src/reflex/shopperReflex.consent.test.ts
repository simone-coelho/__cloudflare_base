// src/reflex/shopperReflex.consent.test.ts
//
// CW31 on the object host. The switches are stored under their own key, said
// on the snapshot and on every ingest envelope, read off an event, and with
// tracking off the object keeps, forwards and persists nothing of a request.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import type { Env } from '@/types/env';

const TABBY_ID = 'COA-CH857';
const t0 = 1_750_000_000_000;

class FakeStorage {
  map = new Map<string, unknown>();
  puts = 0;
  async get(keys: string | string[]): Promise<any> {
    if (Array.isArray(keys)) { const out = new Map<string, unknown>(); for (const k of keys) if (this.map.has(k)) out.set(k, structuredClone(this.map.get(k))); return out; }
    return structuredClone(this.map.get(keys));
  }
  async put(a: any, b?: any): Promise<void> {
    this.puts++;
    if (typeof a === 'string') this.map.set(a, structuredClone(b)); else for (const [k, v] of Object.entries(a)) this.map.set(k, structuredClone(v));
  }
  async delete(k: string) { return this.map.delete(k); }
  async deleteAll() { this.map.clear(); }
  async setAlarm() { /* not exercised here */ }
  async getAlarm() { return null; }
}
class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<any> { const v = this.store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list(o?: { prefix?: string }) { const p = o?.prefix ?? ''; return { keys: [...this.store.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })) }; }
}

let storage: FakeStorage;
let shopper: ShopperReflex;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(t0);
  storage = new FakeStorage();
  const state = { storage, acceptWebSocket: () => undefined, getWebSockets: () => [] } as unknown as DurableObjectState;
  const env = { CACHE: new FakeKV(), SESSIONS: new FakeKV(), ENVIRONMENT: 'test', CONNECTOR_MODE: 'mock' } as unknown as Env;
  shopper = new ShopperReflex(state, env);
});
afterEach(() => { vi.useRealTimers(); });

const post = async (path: string, body: unknown) => {
  const res = await shopper.fetch(new Request(`https://do${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
};
const get = async (path: string) => { const res = await shopper.fetch(new Request(`https://do${path}`)); return (await res.json()) as any; };
const view = (extra: Record<string, unknown> = {}) => ({ type: 'product_view', userId: 'vis-c', data: { productId: TABBY_ID, action: 'product_view', ...extra }, source: 'test' });

describe('the switches', () => {
  it('are consenting when nothing was ever said, on the snapshot and the envelope', async () => {
    expect((await get('/snapshot')).consent).toEqual({ tracking: true, personalization: true });
    const r = await post('/ingest', view());
    expect(r.body.consent).toEqual({ tracking: true, personalization: true });
    expect(storage.map.has('affinity')).toBe(true);
  });

  it('are set through the door, only by an explicit boolean, and remembered', async () => {
    const r = await post('/consent', { personalization: false, tracking: 'no' as never });
    expect(r.body.consent).toEqual({ tracking: true, personalization: false });
    expect(storage.map.get('consent')).toEqual({ tracking: true, personalization: false });
    expect((await get('/snapshot')).consent).toEqual({ tracking: true, personalization: false });
  });

  it('can arrive on an event, under data.consent', async () => {
    const r = await post('/ingest', view({ consent: { tracking: false } }));
    expect(r.body.consent).toEqual({ tracking: false, personalization: true });
    expect(storage.map.get('consent')).toEqual({ tracking: false, personalization: true });
  });
});

describe('tracking off', () => {
  it('answers the request but keeps nothing: no affinity written, the object unchanged', async () => {
    await post('/consent', { tracking: false });
    const putsBefore = storage.puts;
    const r = await post('/ingest', view());
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.consent.tracking).toBe(false);
    expect(storage.map.has('affinity')).toBe(false);
    expect(storage.puts).toBe(putsBefore);          // the switch itself was the last write
    expect((await get('/snapshot')).affinity).toBeNull();
  });

  it('turned back on, the next event is kept', async () => {
    await post('/consent', { tracking: false });
    await post('/ingest', view());
    await post('/consent', { tracking: true });
    await post('/ingest', view());
    expect(storage.map.has('affinity')).toBe(true);
  });

  it('does not survive an erasure: a reset shopper starts consenting', async () => {
    await post('/consent', { tracking: false });
    await post('/reset', {});
    expect((await get('/snapshot')).consent).toEqual({ tracking: true, personalization: true });
  });
});
