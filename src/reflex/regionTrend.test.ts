// src/reflex/regionTrend.test.ts
// The population's vector: accumulate and decay like the personal one, publish
// shares with the leader at 1, roll regions up into countries and everyone,
// pick the finest level with enough evidence, and blend as a prior that never
// writes to the personal vector.

import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '@/types/env';
import {
  REGION_TAU_MS, applyTrend, blendAffinity, fanInRegionTrend, invalidateTrendCache, lambdaFor, readTrend,
  regionKeyOf, rollupSnapshots, rollupTenant, snapshotOf, trendKey, type RegionState, type TrendSnapshot,
} from './regionTrend';
import { RegionTrend } from '@/durable-objects/RegionTrend';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<unknown> { const raw = this.store.get(key); return raw === undefined ? null : JSON.parse(raw); }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async list(opts: { prefix: string }) { return { keys: [...this.store.keys()].filter((k) => k.startsWith(opts.prefix)).map((name) => ({ name })), list_complete: true }; }
}
class FakeStorage {
  map = new Map<string, unknown>(); alarm: number | null = null;
  async get(k: string) { return this.map.get(k); }
  async put(k: string, v: unknown) { this.map.set(k, v); }
  async deleteAll() { this.map.clear(); }
  async getAlarm() { return this.alarm; }
  async setAlarm(at: number) { this.alarm = at; }
}
const T0 = 1_725_000_000_000;
const fresh = (): RegionState => ({ tenant: 'coach', region: 'US-NY', dims: {}, events: 0, updatedAt: 0 });

describe('the population vector', () => {
  it('accumulates, decays on the long horizon, and publishes shares with the leader at 1', () => {
    let s = fresh();
    for (let i = 0; i < 3; i++) s = applyTrend(s, { touches: [{ dim: 'line', value: 'Drover' }, { dim: 'occasion', value: 'evening' }], w: 1, ts: T0 });
    s = applyTrend(s, { touches: [{ dim: 'line', value: 'Tabby' }], w: 1, ts: T0 });
    const snap = snapshotOf(s, T0, 1);
    expect(snap.r.line).toEqual({ Drover: 3, Tabby: 1 });
    expect(snap.share.line).toEqual({ Drover: 1, Tabby: 0.333 });
    expect(snap.events).toBe(4);
    const later = snapshotOf(s, T0 + REGION_TAU_MS, 2);
    expect(later.r.line?.Drover).toBeCloseTo(3 * Math.exp(-1), 2);
    expect(later.share.line?.Drover).toBe(1);
    expect(applyTrend(s, { touches: [{ dim: 'line', value: 'x' }], w: 0, ts: T0 })).toBe(s);
  });

  it('caps values per dimension by evicting the weakest', () => {
    let s = fresh();
    for (let i = 0; i < 40; i++) s = applyTrend(s, { touches: [{ dim: 'line', value: `v${i}` }], w: 1 + i * 0.01, ts: T0 });
    expect(Object.keys(s.dims.line!).length).toBe(32);
    expect(s.dims.line!.v0).toBeUndefined();
    expect(s.dims.line!.v39).toBeDefined();
  });

  it('region keys, rollups, and the ladder', async () => {
    expect(regionKeyOf({ country: 'us', regionCode: 'ny' })).toBe('US-NY');
    expect(regionKeyOf({ country: 'GB' })).toBe('GB');
    expect(regionKeyOf(null)).toBeNull();
    const ny = snapshotOf(applyTrend(fresh(), { touches: [{ dim: 'line', value: 'Drover' }], w: 2, ts: T0 }), T0, 1);
    const ca = snapshotOf(applyTrend({ ...fresh(), region: 'US-CA' }, { touches: [{ dim: 'line', value: 'Tabby' }], w: 3, ts: T0 }), T0, 1);
    const us = rollupSnapshots([ny, ca], 'coach', 'US', 'country', T0);
    expect(us.r.line).toEqual({ Drover: 2, Tabby: 3 });
    expect(us.share.line).toEqual({ Drover: 0.667, Tabby: 1 });
    expect(us.events).toBe(2);

    const env = { CACHE: new FakeKV() } as unknown as Env;
    await env.CACHE.put(trendKey('coach', 'US-NY'), JSON.stringify({ ...ny, events: 3 }));
    await env.CACHE.put(trendKey('coach', 'US-CA'), JSON.stringify({ ...ca, events: 40 }));
    const r = await rollupTenant(env, 'coach', T0);
    expect(r).toEqual({ countries: ['US'], regions: 2 });
    invalidateTrendCache();
    // NY is too sparse (3 < 30); the ladder climbs to the country, which has 43.
    const read = await readTrend(env, 'coach', 'US-NY', 30, T0);
    expect(read?.level).toBe('country');
    expect(read?.snapshot.events).toBe(43);
    // CA meets the gate itself.
    expect((await readTrend(env, 'coach', 'US-CA', 30, T0))?.level).toBe('region');
    // An unknown region falls to everyone; an unknown tenant to nothing.
    expect((await readTrend(env, 'coach', 'FR-75', 30, T0))?.level).toBe('global');
    expect(await readTrend(env, 'nobody', 'US-NY', 30, T0)).toBeNull();
  });

  it('λ is 1 for a stranger and falls with personal evidence; the blend never writes to the personal view', () => {
    expect(lambdaFor(null, 1)).toBe(1);
    expect(lambdaFor({ line: { Drover: 0.6 } }, 1)).toBe(0.625);
    expect(lambdaFor({ line: { Drover: 0.6, Tabby: 0.6 }, occasion: { evening: 0.6 } }, 1)).toBe(0.357);
    const personal = { line: { Drover: 0.6 } };
    const b = blendAffinity(personal, { line: { Drover: 0.5, Tabby: 1 }, occasion: { evening: 1 } }, 0.5);
    expect(b.dims).toEqual({ line: { Drover: 0.55, Tabby: 0.5 }, occasion: { evening: 0.5 } });
    expect(personal).toEqual({ line: { Drover: 0.6 } });
    expect(blendAffinity(null, null, 1).dims).toEqual({});
  });
});

describe('the region object', () => {
  let kv: FakeKV; let storage: FakeStorage; let obj: RegionTrend;
  beforeEach(() => {
    kv = new FakeKV(); storage = new FakeStorage();
    const state = { storage } as unknown as DurableObjectState;
    obj = new RegionTrend(state, { CACHE: kv } as unknown as Env);
  });

  it('ingests frames, arms one coalescing alarm, and publishes on it', async () => {
    // The object publishes at real time, so the frames are stamped now, not at T0.
    const NOW = Date.now();
    const frame = (touches: Array<{ dim: string; value: string }>) => new Request('https://region-trend/ingest', {
      method: 'POST', body: JSON.stringify({ tenant: 'coach', region: 'US-NY', touches, w: 1, ts: NOW }),
    });
    await obj.fetch(frame([{ dim: 'line', value: 'Drover' }]));
    await obj.fetch(frame([{ dim: 'line', value: 'Drover' }, { dim: 'occasion', value: 'evening' }]));
    expect(storage.alarm).not.toBeNull();
    expect(kv.store.size).toBe(0);                     // nothing published yet: coalesced
    await obj.alarm();
    const published = JSON.parse(kv.store.get(trendKey('coach', 'US-NY'))!) as TrendSnapshot;
    expect(published.r.line?.Drover).toBeGreaterThan(1.9);
    expect(published.share).toMatchObject({ line: { Drover: 1 }, occasion: { evening: 1 } });
    expect(published.events).toBe(2);
    const snap = (await (await obj.fetch(new Request('https://region-trend/snapshot'))).json()) as { snapshot: TrendSnapshot };
    expect(snap.snapshot.events).toBe(2);
    expect(JSON.stringify(published)).not.toContain('vis-');   // no visitor ever appears
  });

  it('fan-in is a no-op without a binding, a region, or a weight, and never throws', async () => {
    await expect(fanInRegionTrend({} as Env, { tenant: 'coach', geo: { country: 'US' }, touches: [{ dim: 'line', value: 'x' }], w: 1, now: T0 })).resolves.toBeUndefined();
    const calls: string[] = []; const bodies: unknown[] = [];
    const env = { REGION_TREND: { idFromName: (n: string) => n, get: (n: string) => ({ fetch: async (u: string, init?: { body?: string }) => { calls.push(`${n} ${u}`); bodies.push(JSON.parse(init?.body ?? '{}')); return new Response('{}'); } }) } } as unknown as Env;
    await fanInRegionTrend(env, { tenant: 'coach', geo: null, touches: [{ dim: 'line', value: 'x' }], w: 1, now: T0 });
    await fanInRegionTrend(env, { tenant: 'coach', geo: { country: 'US', regionCode: 'NY' }, touches: [], w: 1, now: T0 });
    await fanInRegionTrend(env, { tenant: 'coach', geo: { country: 'US', regionCode: 'NY' }, touches: [{ dim: 'line', value: 'x' }], w: 0, now: T0 });
    expect(calls).toEqual([]);
    await fanInRegionTrend(env, { tenant: 'coach', geo: { country: 'US', regionCode: 'NY' }, touches: [{ dim: 'line', value: 'x' }], w: 1, now: T0 });
    expect(calls).toEqual(['coach:US-NY https://region-trend/ingest']);
    // The object learns its name from the frame, so the frame must carry it.
    expect(bodies[0]).toMatchObject({ tenant: 'coach', region: 'US-NY', touches: [{ dim: 'line', value: 'x' }], w: 1, ts: T0 });
  });
});
