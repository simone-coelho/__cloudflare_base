// src/reflex/regionTrend.test.ts
// The population's vector: accumulate and decay like the personal one, publish
// shares with the leader at 1, roll regions up into countries and everyone,
// pick the finest level with enough evidence, and blend as a prior that never
// writes to the personal vector.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Env } from '@/types/env';
import {
  REGION_GENERATION, REGION_STATE_KEY, REGION_TAU_MS, applyTrend, blendAffinity, fanInRegionTrend, invalidateTrendCache, lambdaFor, readTrend, objectName,
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
  async delete(k: string) { return this.map.delete(k); }
  async getAlarm() { return this.alarm; }
  async setAlarm(at: number) { this.alarm = at; }
}
const T0 = 1_725_000_000_000;
const fresh = (): RegionState => ({ generation: REGION_GENERATION, tenant: 'coach', region: 'US-NY', dims: {}, events: 0, updatedAt: 0 });

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

  it('W23.02 preserves retained mass across permutations and compares cap candidates at the latest time', () => {
    type Contribution = { w: number; ts: number };
    const permutations = (frames: Contribution[]): Contribution[][] => frames.length === 0 ? [[]]
      : frames.flatMap((frame, i) => permutations(frames.filter((_, j) => j !== i)).map(rest => [frame, ...rest]));
    const touches = [{ dim: 'line', value: 'Drover' }, { dim: 'occasion', value: 'evening' }];
    const cases = [
      [{ w: 1, ts: T0 }, { w: 1, ts: T0 + REGION_TAU_MS }],
      [{ w: 0.123456789, ts: T0 }, { w: 2.125, ts: T0 + REGION_TAU_MS / 2 }, { w: 0.75, ts: T0 + REGION_TAU_MS }],
      [{ w: 0.000123456789, ts: T0 }, { w: 0.25, ts: T0 }, { w: 1.5, ts: T0 }],
      [{ w: 2, ts: 0 }, { w: 3, ts: REGION_TAU_MS }, { w: 0.5, ts: 2 * REGION_TAU_MS }],
    ];
    for (const frames of cases) {
      const latest = Math.max(...frames.map(frame => frame.ts));
      const expected = frames.reduce((sum, frame) => sum + frame.w * Math.exp(-(latest - frame.ts) / REGION_TAU_MS), 0);
      for (const order of permutations(frames)) {
        let state = fresh(); let seenAt = 0;
        for (const frame of order) {
          const previousTime = state.dims.line?.Drover?.t ?? 0;
          seenAt = Math.max(seenAt, frame.ts);
          state = applyTrend(state, { ...frame, touches });
          expect(state.updatedAt).toBe(seenAt);
          expect(state.dims.line!.Drover!.t).toBeGreaterThanOrEqual(previousTime);
        }
        expect(state.events).toBe(frames.length); // Count frames, not touches.
        for (const touch of touches) {
          expect(state.dims[touch.dim]![touch.value]!.t).toBe(latest);
          expect(state.dims[touch.dim]![touch.value]!.s).toBeCloseTo(expected, 12);
        }
        expect(snapshotOf(state, latest, 1).r.line!.Drover).toBe(Math.round(expected * 1000) / 1000);
      }
    }
    const guarded = applyTrend(fresh(), { touches, w: 1, ts: T0 });
    const before = structuredClone(guarded);
    for (const ts of [undefined, null, '0', -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 8_640_000_000_000_001, {}, []]) {
      expect(applyTrend(guarded, { touches, w: 2, ts: ts as number })).toBe(guarded);
      expect(guarded).toEqual(before);
    }
    for (const ts of [0, 8_640_000_000_000_000]) {
      const state = applyTrend(fresh(), { touches, w: 0.123456789, ts });
      expect(state.dims.line!.Drover).toEqual({ s: 0.123456789, t: ts });
      expect(state).toMatchObject({ events: 1, updatedAt: ts });
    }
    // At the old incoming time recent looks weaker (0.5 < 1). At the latest
    // common time ancient is actually weakest (1/e < 0.5), so evict ancient.
    const capped = { ...fresh(), updatedAt: T0 + REGION_TAU_MS, dims: { line: {
      ancient: { s: 1, t: T0 }, recent: { s: 0.5, t: T0 + REGION_TAU_MS },
      ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`strong${i}`, { s: 10, t: T0 + REGION_TAU_MS }])),
    } } };
    const result = applyTrend(capped, { touches: [{ dim: 'line', value: 'late' }], w: 2, ts: T0 });
    expect(Object.keys(result.dims.line!)).toHaveLength(32);
    expect(result.dims.line!.ancient).toBeUndefined();
    expect(result.dims.line!.recent).toEqual({ s: 0.5, t: T0 + REGION_TAU_MS });
    expect(result.dims.line!.late).toEqual({ s: 2, t: T0 });
    expect(result).toMatchObject({ events: 1, updatedAt: T0 + REGION_TAU_MS });
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
    const state = { storage, id: objectName('coach', 'US-NY') } as unknown as DurableObjectState;
    obj = new RegionTrend(state, { CACHE: kv, REGION_TREND: { idFromName: (name: string) => name } } as unknown as Env);
  });

  it('ingests frames, arms one coalescing alarm, and publishes on it', async () => {
    // The object publishes at real time, so the frames are stamped now, not at T0.
    const NOW = Date.now();
    const frame = (touches: Array<{ dim: string; value: string }>) => new Request('https://region-trend/ingest', {
      method: 'POST', body: JSON.stringify({ generation: REGION_GENERATION, tenant: 'coach', region: 'US-NY', touches, w: 1, ts: NOW }),
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

  it('W23.02 refuses invalid timestamps without effects and preserves late mass through recreation and publication', async () => {
    const get = vi.spyOn(storage, 'get'), put = vi.spyOn(storage, 'put');
    const getAlarm = vi.spyOn(storage, 'getAlarm'), setAlarm = vi.spyOn(storage, 'setAlarm');
    const publish = vi.spyOn(kv, 'put');
    const env = { CACHE: kv, REGION_TREND: { idFromName: (name: string) => name } } as unknown as Env;
    const make = (store: FakeStorage) => new RegionTrend({ id: objectName('coach', 'US-NY'), storage: store } as unknown as DurableObjectState, env);
    const base = { generation: REGION_GENERATION, tenant: 'coach', region: 'US-NY', touches: [{ dim: 'line', value: 'Drover' }], w: 1 };
    const request = (frame: object) => new Request('https://region-trend/ingest', { method: 'POST', body: JSON.stringify(frame) });
    for (const ts of [undefined, null, 'PRIVATE_TIMESTAMP', '0', -1, 0.5, Number.MAX_SAFE_INTEGER + 1, 8_640_000_000_000_001, {}, []]) {
      const response = await obj.fetch(request({ ...base, ts }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: 'invalid event timestamp' });
    }
    // JSON numeric overflow represents nonfinite input without JSON.stringify
    // silently converting Infinity to null first.
    for (const ts of ['1e400', '-1e400']) {
      const body = JSON.stringify({ ...base, ts: 0 }).replace('"ts":0', `"ts":${ts}`);
      expect((await obj.fetch(new Request('https://region-trend/ingest', { method: 'POST', body }))).status).toBe(400);
    }
    for (const effect of [get, put, getAlarm, setAlarm, publish]) expect(effect).not.toHaveBeenCalled();
    expect([...storage.map]).toEqual([]); expect(storage.alarm).toBeNull(); expect(kv.store.size).toBe(0);

    const latest = T0 + REGION_TAU_MS;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(latest);
    try {
      for (const ts of [0, 8_640_000_000_000_000]) {
        const isolated = new FakeStorage();
        expect((await make(isolated).fetch(request({ ...base, ts }))).status).toBe(200);
        expect(isolated.map.get(REGION_STATE_KEY)).toEqual({ ...fresh(), events: 1, updatedAt: ts, dims: { line: { Drover: { s: 1, t: ts } } } });
        expect(isolated.alarm).toBe(latest + 30_000);
      }
      expect((await obj.fetch(request({ ...base, ts: latest }))).status).toBe(200);
      expect((await obj.fetch(request({ ...base, touches: [...base.touches, { dim: 'line', value: 'Tabby' }], w: 2, ts: T0 }))).status).toBe(200);
      const stored = structuredClone(storage.map.get(REGION_STATE_KEY)) as RegionState;
      expect(stored).toEqual({ ...fresh(), events: 2, updatedAt: latest, dims: { line: {
        Drover: { s: 1 + 2 * Math.exp(-1), t: latest }, Tabby: { s: 2, t: T0 },
      } } });
      expect(get).toHaveBeenCalledTimes(1); expect(put).toHaveBeenCalledTimes(2);
      expect(getAlarm).toHaveBeenCalledTimes(2); expect(setAlarm).toHaveBeenCalledTimes(1);
      expect(storage.alarm).toBe(latest + 30_000); expect(kv.store.size).toBe(0);
      // Recreate from independent persisted bytes, with no in-memory dirty flag.
      storage.map.set(REGION_STATE_KEY, structuredClone(stored));
      obj = make(storage); await obj.alarm();
      const drover = Math.round((1 + 2 * Math.exp(-1)) * 1000) / 1000;
      const tabby = Math.round(2 * Math.exp(-1) * 1000) / 1000;
      const expected: TrendSnapshot = { generation: REGION_GENERATION, tenant: 'coach', region: 'US-NY', level: 'region', events: 2, updatedAt: latest, version: latest,
        r: { line: { Drover: drover, Tabby: tabby } }, share: { line: { Drover: 1, Tabby: Math.round(tabby / drover * 1000) / 1000 } } };
      expect(JSON.parse(kv.store.get(trendKey('coach', 'US-NY'))!)).toEqual(expected);
      expect(await (await obj.fetch(new Request('https://region-trend/snapshot'))).json()).toEqual({ ok: true, snapshot: expected });
      expect(storage.map.get(REGION_STATE_KEY)).toEqual(stored);
      expect(get).toHaveBeenCalledTimes(2); expect(put).toHaveBeenCalledTimes(2); expect(publish).toHaveBeenCalledTimes(1);
    } finally { clock.mockRestore(); }
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
    expect(calls).toEqual(['trend:v2:coach:US-NY https://region-trend/ingest']);
    expect(bodies[0]).toMatchObject({ generation: 2, tenant: 'coach', region: 'US-NY', touches: [{ dim: 'line', value: 'x' }], w: 1, ts: T0 });
  });

  it('W37.02 binds current frames/state to the actual object and preserves old bytes through alarms, reads, rollups and reset', async () => {
    const now = Date.now();
    const owned = { ...fresh(), tenant: 'brighthour' };
    const counted = applyTrend(owned, { touches: [{ dim: 'line', value: 'current' }], w: 1, ts: now });
    const current = snapshotOf(counted, now, now);
    const legacy = { ...counted, generation: undefined, events: 900 };
    const env = { CACHE: kv, REGION_TREND: { idFromName: (name: string) => name } } as unknown as Env;
    const make = (name: string, store: FakeStorage) => new RegionTrend({ id: name, storage: store } as unknown as DurableObjectState, env);
    const ingest = (value: object) => new Request('https://region-trend/ingest', { method: 'POST', body: JSON.stringify(value) });
    const frame = { generation: 2, tenant: 'brighthour', region: 'US-NY', touches: [{ dim: 'line', value: 'current' }], w: 1, ts: now };
    // A pre-cutover object can wake with a pending alarm, but can neither publish
    // nor accept a fresh frame, even if current-looking bytes are placed there.
    const oldStorage = new FakeStorage();
    oldStorage.map.set('trend', legacy); oldStorage.map.set(REGION_STATE_KEY, structuredClone(counted)); oldStorage.alarm = now;
    const oldBefore = structuredClone([...oldStorage.map]);
    const old = make('brighthour:US-NY', oldStorage);
    await old.alarm(); await old.fetch(new Request('https://region-trend/publish'));
    expect((await old.fetch(ingest(frame))).status).toBe(409);
    await old.fetch(new Request('https://region-trend/reset'));
    expect([...oldStorage.map]).toEqual(oldBefore); expect(kv.store.size).toBe(0);
    // Reject legacy generation, another tenant and another region before writes.
    storage.map.set('trend', legacy);
    obj = make(objectName('brighthour', 'US-NY'), storage);
    for (const patch of [{ generation: undefined }, { generation: 1 }, { tenant: 'meridian' }, { region: 'US-CA' }]) {
      expect((await obj.fetch(ingest({ ...frame, ...patch }))).status).toBe(409);
    }
    expect([...storage.map]).toEqual([['trend', legacy]]); expect(storage.alarm).toBeNull();
    expect((await obj.fetch(ingest(frame))).status).toBe(200);
    // Restart publication loads only the bound v2 state, never the old count.
    obj = make(objectName('brighthour', 'US-NY'), storage); await obj.alarm();
    expect(JSON.parse(kv.store.get(trendKey('brighthour', 'US-NY'))!)).toMatchObject({ generation: 2, events: 1, tenant: 'brighthour', region: 'US-NY' });
    for (const patch of [{ generation: undefined }, { generation: 1 }, { tenant: 'meridian' }, { region: 'US-CA' }]) {
      const bad = new FakeStorage(); bad.map.set(REGION_STATE_KEY, { ...counted, ...patch });
      const before = structuredClone([...bad.map]); const invalid = make(objectName('brighthour', 'US-NY'), bad);
      const kvBefore = [...kv.store]; await invalid.alarm(); await invalid.fetch(new Request('https://region-trend/publish'));
      expect(await (await invalid.fetch(new Request('https://region-trend/snapshot'))).json()).toEqual({ ok: true, snapshot: null });
      expect((await invalid.fetch(ingest(frame))).status).toBe(409);
      expect([...bad.map]).toEqual(before); expect([...kv.store]).toEqual(kvBefore);
    }
    kv.store.clear();
    kv.store.set('trend:brighthour:US-NY', JSON.stringify({ ...current, generation: undefined, events: 900 }));
    const oldKv = kv.store.get('trend:brighthour:US-NY');
    invalidateTrendCache(); expect(await readTrend(env, 'brighthour', 'US-NY', 1, now)).toBeNull();
    for (const patch of [{ generation: undefined }, { generation: 1 }, { tenant: 'meridian' }, { region: 'US-CA' }]) {
      kv.store.set(trendKey('brighthour', 'US-NY'), JSON.stringify({ ...current, ...patch }));
      invalidateTrendCache(); expect(await readTrend(env, 'brighthour', 'US-NY', 1, now)).toBeNull();
      expect(await rollupTenant(env, 'brighthour', now)).toEqual({ countries: [], regions: 0 });
      expect(JSON.parse(kv.store.get(trendKey('brighthour', '*'))!).events).toBe(0);
      kv.store.delete(trendKey('brighthour', '*'));
    }
    kv.store.set(trendKey('brighthour', 'US-NY'), JSON.stringify(current));
    expect(await rollupTenant(env, 'brighthour', now)).toEqual({ countries: ['US'], regions: 1 });
    expect((await readTrend(env, 'brighthour', 'US-NY', 1, now))?.snapshot.events).toBe(1);
    expect(JSON.parse(kv.store.get(trendKey('brighthour', '*'))!).events).toBe(1);
    expect(kv.store.get('trend:brighthour:US-NY')).toBe(oldKv);
    await obj.fetch(new Request('https://region-trend/reset'));
    expect([...storage.map]).toEqual([['trend', legacy]]);
  });
});
