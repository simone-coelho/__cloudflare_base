// @vitest-environment node
// src/reflex/shopperReflex.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// ShopperReflex DO (doc 16 §6, P2) — pure-logic tests, NO miniflare:
//   • computeNextAlarm — the closed-form alarm math (crossing vs retention).
//   • state serialization round-trip — the 'affinity' record survives storage.
//   • the ingest reducer — driven through POST /ingest and the WS door against
//     a mocked DurableObjectState (in-memory storage + fake sockets) and a
//     mocked Env (in-memory KV; mock connector triad; ODP disabled).
// The DO is a thin host around the fully-tested ReflexCore — these tests pin
// the HOSTING contract: stamping, validation, rate limit, alarm scheduling,
// push envelope shape, hibernation rehydrate, retention wipe.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ShopperReflex,
  computeNextAlarm,
  type AffinityRecord,
} from '@/durable-objects/ShopperReflex';
import {
  DEFAULT_REFLEX_CONFIG,
  apply,
  extractTouches,
  nextCrossing,
  snapshot,
  type ReflexState,
} from '@/reflex/core';
import type { Env } from '@/types/env';

const CFG = DEFAULT_REFLEX_CONFIG; // τ=60s · K=1.8 · θ 0.6/0.45 · priceBand τ=150s
const DAY = 24 * 60 * 60 * 1000;
const RETENTION_30D = 30 * DAY;
const TABBY_ID = 'COA-CH857'; // real catalog product: line Tabby · elevated band
const t0 = 1_750_000_000_000;

// ── Fakes ─────────────────────────────────────────────────────────────────────

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
  async delete(k: string): Promise<boolean> {
    return this.map.delete(k);
  }
  async deleteAll(): Promise<void> {
    this.map.clear();
    this.alarm = null;
  }
  async setAlarm(t: number | Date): Promise<void> {
    this.alarm = typeof t === 'number' ? t : t.getTime();
  }
  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }
}

class FakeSocket {
  sent: string[] = [];
  attachment: unknown = null;
  send(m: string): void {
    this.sent.push(m);
  }
  serializeAttachment(a: unknown): void {
    this.attachment = a;
  }
  deserializeAttachment(): unknown {
    return this.attachment;
  }
  frames(): any[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

/** Minimal KV namespace — enough for KvAudienceStore + the audgen version marker. */
class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<any> {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list(opts?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
    const prefix = opts?.prefix ?? '';
    return {
      keys: [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
    };
  }
}

interface Harness {
  shopper: ShopperReflex;
  storage: FakeStorage;
  sockets: FakeSocket[];
  env: Env;
}

function makeDO(envOverrides: Record<string, unknown> = {}, opts: { sharedEnv?: Env; sharedStorage?: FakeStorage; withSocket?: boolean } = {}): Harness {
  const storage = opts.sharedStorage ?? new FakeStorage();
  const sockets: FakeSocket[] = [];
  if (opts.withSocket ?? true) {
    const ws = new FakeSocket();
    ws.serializeAttachment({ shopperId: 'vis-TEST' });
    sockets.push(ws);
  }
  const state = {
    storage,
    acceptWebSocket: (ws: unknown) => sockets.push(ws as FakeSocket),
    getWebSockets: () => sockets,
  } as unknown as DurableObjectState;
  const env =
    opts.sharedEnv ??
    ({
      CACHE: new FakeKV(),
      SESSIONS: new FakeKV(),
      ENVIRONMENT: 'test',
      CONNECTOR_MODE: 'mock',
      ...envOverrides,
    } as unknown as Env);
  return { shopper: new ShopperReflex(state, env), storage, sockets, env };
}

function viewEvent(pid: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'product_view',
    userId: 'vis-TEST',
    data: { productId: pid, action: 'product_view' },
    source: 'test',
    timestamp: 1, // deliberately bogus — the DO must stamp its OWN arrival time
    ...overrides,
  };
}

async function post(shopper: ShopperReflex, event: unknown): Promise<{ status: number; body: any }> {
  const res = await shopper.fetch(
    new Request('https://do/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
  );
  return { status: res.status, body: await res.json() };
}

/** Three brisk Tabby views 5s apart — the golden entry sequence from core.test. */
async function driveToMembership(h: Harness): Promise<any> {
  vi.setSystemTime(t0);
  await post(h.shopper, viewEvent(TABBY_ID));
  vi.setSystemTime(t0 + 5_000);
  await post(h.shopper, viewEvent(TABBY_ID));
  vi.setSystemTime(t0 + 10_000);
  return post(h.shopper, viewEvent(TABBY_ID));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(t0);
});
afterEach(() => {
  vi.useRealTimers();
});

// ── 1. Closed-form alarm math ────────────────────────────────────────────────

describe('computeNextAlarm — closed-form crossing vs retention horizon', () => {
  /** State with one 60s-τ line membership: R raw score s touched at tLast. */
  function memberState(s: number, tLast: number): ReflexState {
    return {
      v: 1,
      dims: { line: { Tabby: { s, t: tLast } } },
      audiences: ['line_tabby_affinity'],
      configVersion: CFG.version,
    };
  }

  it('with a membership, the alarm is the exact θ_out crossing (hand-derived formula)', () => {
    const s = 2.766526; // ≈ three views 5s apart
    const state = memberState(s, t0);
    // t* = tLast + τ·ln( R·(1−θ_out) / (K·θ_out) )
    const expected = t0 + CFG.tauMs * Math.log((s * (1 - CFG.thetaOut)) / (CFG.K * CFG.thetaOut));
    expect(nextCrossing(state, t0, CFG)).toBeCloseTo(expected, 6);
    const alarm = computeNextAlarm(state, t0, t0, CFG, RETENTION_30D);
    expect(alarm).toBeCloseTo(expected, 6);
    expect(alarm).toBeLessThan(t0 + RETENTION_30D); // crossing wins over retention
  });

  it('with no memberships, the alarm is the retention horizon', () => {
    const state: ReflexState = { v: 1, dims: {}, audiences: [], configVersion: CFG.version };
    expect(nextCrossing(state, t0, CFG)).toBeNull();
    expect(computeNextAlarm(state, t0, t0, CFG, RETENTION_30D)).toBe(t0 + RETENTION_30D);
  });

  it('a crossing already in the past clamps to (just after) now — fires immediately, never busy-loops', () => {
    const state = memberState(0.5, t0 - 600_000); // long-decayed, still nominally a member
    const now = t0;
    const alarm = computeNextAlarm(state, t0 - 600_000, now, CFG, RETENTION_30D);
    expect(alarm).toBeGreaterThan(now);
    expect(alarm).toBeLessThanOrEqual(now + 100);
  });

  it('per-dimension τ overrides are respected (priceBand crosses later than line)', () => {
    const s = 2.766526;
    const state: ReflexState = {
      v: 1,
      dims: {
        line: { Tabby: { s, t: t0 } },
        priceBand: { elevated: { s, t: t0 } },
      },
      audiences: ['line_tabby_affinity', 'priceband_elevated_affinity'],
      configVersion: CFG.version,
    };
    const lineStar = t0 + 60_000 * Math.log((s * 0.55) / (1.8 * 0.45));
    const bandStar = t0 + 150_000 * Math.log((s * 0.55) / (1.8 * 0.45));
    expect(bandStar).toBeGreaterThan(lineStar);
    // min over memberships = the line crossing
    expect(computeNextAlarm(state, t0, t0, CFG, RETENTION_30D)).toBeCloseTo(lineStar, 6);
  });
});

// ── 2. State serialization round-trip ────────────────────────────────────────

describe("the 'affinity' record — spec shape + serialization round-trip", () => {
  it('holds exactly the doc-16 §6 fields and survives a JSON storage round-trip', async () => {
    const h = makeDO();
    await driveToMembership(h);

    const rec = h.storage.map.get('affinity') as AffinityRecord;
    expect(Object.keys(rec).sort()).toEqual([
      'configVersion',
      'lastSeen',
      'odpRecentEvents',
      'odpSeed',
      'odpSeedAt',
      'reflex',
      'shopperId',
    ]);
    expect(rec.shopperId).toBe('vis-TEST');
    expect(rec.lastSeen).toBe(t0 + 10_000); // DO-stamped — the bogus client ts (1) never leaks in
    expect(rec.configVersion).toBe(CFG.version);

    // Round-trip through JSON (stricter than the structured clone storage uses):
    const revived = JSON.parse(JSON.stringify(rec)) as AffinityRecord;
    expect(revived).toEqual(rec);
    // The revived raw state reads to the identical live snapshot at any instant.
    const now = t0 + 30_000;
    expect(snapshot(revived.reflex, now, CFG)).toEqual(snapshot(rec.reflex, now, CFG));
  });
});

// ── 3. The ingest reducer (mocked storage/socket/env) ────────────────────────

describe('ingest — one reducer behind both doors', () => {
  it('three brisk views enter the affinity audiences and push the full envelope over the DO’s own socket', async () => {
    const h = makeDO();
    const r3 = await driveToMembership(h);

    // Response envelope (what POST /realtime/action returns verbatim in DO mode).
    expect(r3.status).toBe(200);
    expect(r3.body.success).toBe(true);
    expect(typeof r3.body.sessionId).toBe('string');
    expect(r3.body.cookiesUpdated).toBe(false);
    const update = r3.body.update;
    expect(update.type).toBe('personalization_update');
    expect(update.userId).toBe('vis-TEST');

    // Membership + explain records (the glass box) in the affinity payload.
    const aff = update.data.affinity;
    expect(aff.audiences).toContain('line_tabby_affinity');
    expect(aff.dims.line.Tabby).toBeGreaterThanOrEqual(CFG.thetaIn);
    const enter = (aff.changed as any[]).find((c) => c.audience === 'line_tabby_affinity');
    expect(enter).toMatchObject({ direction: 'enter', dim: 'line', value: 'Tabby' });
    expect(enter.score).toBeGreaterThanOrEqual(CFG.thetaIn);
    expect(aff.odpConfirmed).toEqual([]); // ODP disabled in this harness

    // The choreography: live line membership wins the hero + the sort.
    expect(update.data.decisions.hero_module.variationKey).toBe('affinity_hero');
    expect(update.data.decisions.hero_module.variables.anchorLine).toBe('Tabby');
    expect(update.data.decisions.plp_sort.variables.anchorLine).toBe('Tabby');
    expect(update.data.segments).toContain('line_tabby_affinity');
    expect(update.data.segments).toContain('high_intent_tabby_browser'); // counter-based seed audience qualified too
    expect(Array.isArray(update.data.recommendations)).toBe(true);
    expect(Array.isArray(update.data.sortOrder)).toBe(true);
    expect(update.data.journeyStage).toBe('mid');

    // Pushed over the DO's OWN socket with the same server timestamp (client dedupe key).
    const pushes = h.sockets[0].frames().filter((f) => f.type === 'personalization_update');
    expect(pushes.length).toBeGreaterThanOrEqual(1);
    const last = pushes[pushes.length - 1];
    expect(last.data.timestamp).toBe(update.data.timestamp);
    expect(last.serverTimestamp).toBeDefined();

    // Closed-form alarm scheduled for the stored state (crossing, not retention).
    const rec = h.storage.map.get('affinity') as AffinityRecord;
    const expected = computeNextAlarm(rec.reflex, rec.lastSeen, t0 + 10_000, CFG, RETENTION_30D);
    expect(h.storage.alarm).toBe(expected);
    expect(expected).toBeLessThan(t0 + 10_000 + 120_000); // the demo's ~40s-idle exit, not a 30-day park
  });

  it('a no-change event persists state but returns (and pushes) no update — request-path parity', async () => {
    const h = makeDO();
    await driveToMembership(h);
    const pushesBefore = h.sockets[0].sent.length;

    vi.setSystemTime(t0 + 15_000);
    const r4 = await post(h.shopper, viewEvent(TABBY_ID));
    expect(r4.body.success).toBe(true);
    expect(r4.body.update).toBeUndefined();
    expect(r4.body.message).toMatch(/no personalization changes/);
    expect(h.sockets[0].sent.length).toBe(pushesBefore); // no redundant push
    const rec = h.storage.map.get('affinity') as AffinityRecord;
    expect(rec.lastSeen).toBe(t0 + 15_000); // activity still persisted
  });

  it('drops events referencing unknown productIds (catalog-index validation) without creating state', async () => {
    const h = makeDO();
    const r = await post(h.shopper, viewEvent('NOT-A-REAL-SKU'));
    expect(r.status).toBe(200);
    expect(r.body.dropped).toBe('unknown_product');
    expect(h.storage.map.has('affinity')).toBe(false);
    expect(h.storage.alarm).toBeNull();
  });

  it('rate-limits per minute in-object (429), then admits again in the next window', async () => {
    const h = makeDO({ REFLEX_RATE_LIMIT_PER_MIN: '2' });
    expect((await post(h.shopper, viewEvent(TABBY_ID))).status).toBe(200);
    vi.setSystemTime(t0 + 1_000);
    expect((await post(h.shopper, viewEvent(TABBY_ID))).status).toBe(200);
    vi.setSystemTime(t0 + 2_000);
    const limited = await post(h.shopper, viewEvent(TABBY_ID));
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ success: false, error: 'rate_limited' });
    vi.setSystemTime(t0 + 61_000); // next window
    expect((await post(h.shopper, viewEvent(TABBY_ID))).status).toBe(200);
  });

  it('the WS door drives the SAME reducer; identity falls back to the socket attachment', async () => {
    const h = makeDO();
    const ws = new FakeSocket();
    ws.serializeAttachment({ shopperId: 'vis-WS-ONLY' }); // ONLY {shopperId} rides the attachment
    h.sockets.length = 0;
    h.sockets.push(ws);

    // Canonical frame: {type:'action', event:{…}} with NO userId — attachment supplies it.
    await h.shopper.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({
        type: 'action',
        event: { type: 'product_view', data: { productId: TABBY_ID }, source: 'beacon' },
      })
    );
    // Flattened variant: {type:'action', action:'…', data:{…}}.
    vi.setSystemTime(t0 + 5_000);
    await h.shopper.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({ type: 'action', action: 'product_view', data: { productId: TABBY_ID } })
    );

    const rec = h.storage.map.get('affinity') as AffinityRecord;
    expect(rec.shopperId).toBe('vis-WS-ONLY');
    expect(rec.reflex.dims.line.Tabby.s).toBeGreaterThan(1); // both frames scored
    // Heartbeat frames answer without touching state.
    await h.shopper.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'heartbeat' }));
    expect(ws.frames().some((f) => f.type === 'heartbeat_response')).toBe(true);
  });

  it('GET /snapshot returns the GET /realtime/reflex shape', async () => {
    const h = makeDO();
    await driveToMembership(h);
    const res = await h.shopper.fetch(new Request('https://do/snapshot'));
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.config).toMatchObject({ tauMs: 60_000, K: 1.8, thetaIn: 0.6, thetaOut: 0.45 });
    expect(body.config.dims.priceBand.tauMs).toBe(150_000); // per-dimension override surfaced
    expect(body.affinity.audiences).toContain('line_tabby_affinity');
    expect(body.affinity.dims.line.Tabby).toBeGreaterThan(0);
    expect(body.affinity.odpConfirmed).toEqual([]);
  });
});

// ── 4. The alarm: exact-time decay-out + retention wipe ─────────────────────

describe('alarm — lazy re-evaluation, exits pushed, retention deleteAll', () => {
  it('fires at the crossing, pushes the exit envelope (hero reverts), re-arms for the slower dimension', async () => {
    const h = makeDO();
    await driveToMembership(h);
    const armedAt = h.storage.alarm!;
    expect(armedAt).toBeGreaterThan(t0 + 10_000);

    // Wake just past the scheduled crossing: the 60s-τ dims are below θ_out;
    // priceBand (τ=150s) still holds — hysteresis is per-dimension.
    vi.setSystemTime(armedAt + 1_000);
    await h.shopper.alarm();

    const rec = h.storage.map.get('affinity') as AffinityRecord;
    expect(rec.reflex.audiences).not.toContain('line_tabby_affinity');
    expect(rec.reflex.audiences).toContain('priceband_elevated_affinity');
    // The alarm NEVER mutates raw scores — (s, tLast) for the surviving entry are untouched.
    expect(rec.reflex.dims.priceBand.elevated.t).toBe(t0 + 10_000);

    // The "they wandered off" push: full envelope, exit explain, hero no longer affinity-driven.
    const frames = h.sockets[0].frames().filter((f) => f.type === 'personalization_update');
    const exitPush = frames[frames.length - 1];
    const exits = (exitPush.data.affinity.changed as any[]).filter((c) => c.direction === 'exit');
    expect(exits.map((c) => c.audience)).toContain('line_tabby_affinity');
    expect(exitPush.data.affinity.audiences).not.toContain('line_tabby_affinity');
    expect(exitPush.data.decisions.hero_module.variationKey).not.toBe('affinity_hero');
    // Counter-based audiences do NOT decay — parity with the request path.
    expect(exitPush.data.segments).toContain('high_intent_tabby_browser');

    // Re-armed at the NEXT crossing (the surviving priceBand membership), not retention.
    const expected = computeNextAlarm(rec.reflex, rec.lastSeen, armedAt + 1_000, CFG, RETENTION_30D);
    expect(h.storage.alarm).toBe(expected);
    expect(expected).toBeLessThan(rec.lastSeen + RETENTION_30D);
  });

  it('a fresh instance rehydrates from storage (hibernation wake) and still exits on alarm', async () => {
    const h = makeDO();
    await driveToMembership(h);

    // Simulate eviction: a brand-new object instance over the SAME storage.
    const woken = makeDO({}, { sharedStorage: h.storage, sharedEnv: h.env, withSocket: true });
    vi.setSystemTime(t0 + 10_000 + 300_000); // long past every crossing
    await woken.shopper.alarm();
    const rec = woken.storage.map.get('affinity') as AffinityRecord;
    expect(rec.reflex.audiences).toEqual([]); // everything decayed out, from rehydrated state
    const push = woken.sockets[0].frames().find((f) => f.type === 'personalization_update');
    expect(push).toBeDefined();
  });

  it('retention: idle past N days with no sockets → storage.deleteAll()', async () => {
    const h = makeDO({ REFLEX_RETENTION_DAYS: '30' });
    await driveToMembership(h);
    expect(h.storage.map.size).toBeGreaterThan(0);

    const idle = makeDO({}, { sharedStorage: h.storage, sharedEnv: h.env, withSocket: false });
    vi.setSystemTime(t0 + 10_000 + RETENTION_30D + 1);
    await idle.shopper.alarm();
    expect(idle.storage.map.size).toBe(0);
    expect(idle.storage.alarm).toBeNull();

    // And a live socket DEFERS the wipe (the shopper is not idle).
    const h2 = makeDO();
    await driveToMembership(h2);
    vi.setSystemTime(t0 + 10_000 + RETENTION_30D + 1);
    await h2.shopper.alarm(); // socket present in this harness
    expect(h2.storage.map.size).toBeGreaterThan(0);
  });
});

// ── 5. Reducer determinism: the DO hosts the same core math ─────────────────

describe('hosting invariant — the DO state equals a pure-core replay of the same stream', () => {
  it('storage reflex state === ReflexCore.apply replay with the DO’s stamped times', async () => {
    const h = makeDO();
    await driveToMembership(h);
    const rec = h.storage.map.get('affinity') as AffinityRecord;

    // Replay the identical stream through the pure core (the P0 request path).
    const product = {
      id: TABBY_ID, line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
      silhouette: 'shoulder', occasion: ['work', 'everyday', 'evening'], price_usd: 475,
    };
    const input = { action: 'product_view', touches: extractTouches(product, CFG) };
    let s = apply(undefined, input, t0, CFG);
    s = apply(s.state, input, t0 + 5_000, CFG);
    s = apply(s.state, input, t0 + 10_000, CFG);

    expect(rec.reflex).toEqual(s.state); // same math, same state — never a copy
  });
});
