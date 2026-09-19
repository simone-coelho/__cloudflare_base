// src/reflex/shopperReflex.consent.test.ts
//
// CW31 on the object host. The switches are stored under their own key, said
// on the snapshot and on every ingest envelope, read off an event, and with
// tracking off the object keeps, forwards and persists nothing of a request.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import type { Env } from '@/types/env';
import { issueSessionCapability, verifySessionCapability, SHOPPER_HEADER, type SessionCapability } from '@/identity/sessionCapability';
import { storedConsent } from '@/content/consent';
import { setTimeout as settle } from 'node:timers/promises';
import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { REFLEX_KIND, reflexScopeForTenant } from './configStore';
import { DEFAULT_REFLEX_CONFIG } from './core';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from '@/content/kinds';
import { configuredDestinations } from '@/connectors/config';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

const TABBY_ID = 'COA-CH857';
const t0 = 1_750_000_000_000;
const subject = 'vis-00000000-0000-4000-8000-000000000050';

class FakeStorage {
  map = new Map<string, unknown>();
  puts = 0;
  alarm: number | null = null;
  async get(keys: string | string[]): Promise<any> {
    if (Array.isArray(keys)) { const out = new Map<string, unknown>(); for (const k of keys) if (this.map.has(k)) out.set(k, structuredClone(this.map.get(k))); return out; }
    return structuredClone(this.map.get(keys));
  }
  async put(a: any, b?: any): Promise<void> {
    this.puts++;
    if (typeof a === 'string') this.map.set(a, structuredClone(b)); else for (const [k, v] of Object.entries(a)) this.map.set(k, structuredClone(v));
  }
  async delete(k: string) { return this.map.delete(k); }
  async deleteAll() { this.map.clear(); this.alarm = null; }
  async setAlarm(at: number) { this.alarm = at; }
  async getAlarm() { return this.alarm; }
  async list(options?: { prefix?: string; limit?: number }) { return structuredClone(new Map([...this.map].filter(([k]) => k.startsWith(options?.prefix ?? '')).sort(([a], [b]) => a.localeCompare(b)).slice(0, options?.limit))); }
  async transaction(run: (tx: unknown) => Promise<unknown>) {
    const next = structuredClone(this.map); let alarm = this.alarm;
    const result = await run({ list: async () => structuredClone(next),
      put: async (values: Record<string, unknown>) => { for (const [k, v] of Object.entries(values)) next.set(k, structuredClone(v)); },
      delete: async (keys: string[]) => { for (const key of keys) next.delete(key); return keys.length; },
      deleteAlarm: async () => { alarm = null; }, setAlarm: async (at: number) => { alarm = at; },
    });
    this.map = next; this.alarm = alarm; return result;
  }
}
class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<any> { const v = this.store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list(o?: { prefix?: string }) { const p = o?.prefix ?? ''; return { keys: [...this.store.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })) }; }
}

/**
 * R2 honouring the strengthened publication put/get contract: `get` reports
 * etag/size/body, `put` returns key/etag/size and honours the conditional
 * headers (src/config/publication.ts:225-237, :293-295). Same shape as the
 * working double in src/routes/realtime.sdkContract.test.ts.
 */
class FixtureR2 {
  data = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string> | undefined>();
  async get(key: string) {
    const raw = this.data.get(key);
    if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      customMetadata: this.metadata.get(key), body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async put(key: string, raw: string, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } | Headers; customMetadata?: Record<string, string> }) {
    const old = this.data.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.data.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.data.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.data.keys()].filter((k) => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map((key) => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

/**
 * The configuration publication is the only configuration authority
 * (src/config/publication.ts:19, :150-152, :204-206); the object resolves its
 * Reflex config through it on every ingest, snapshot and alarm. This is the
 * explicit test-authored W11 baseline, never a re-admitted KV fallback.
 */
const seedPublication = (target: Env, tenant: string) => {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'synthetic-fixture', note: '', value } });
  return initializePublicationSet(target, [
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }),
    baseline(LEARN_KIND, { holdout: { share: 0, salt: 'fixture', arms: ['default'] } }),
  ], '0:' + crypto.randomUUID());
};

/**
 * A first record needs the retention policy registry before it may be born
 * (src/retention.ts:39, :72-89; ShopperReflex.ts:1034). Explicit synthetic
 * policies for the tenant's categories, including every configured external
 * destination (the shape src/routes/realtime.sdkContract.test.ts:73-76 uses).
 */
const fixturePolicy: RetentionPolicy = { id: 'explicit-consent-fixture', revision: 1, durationMs: 30 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
const retentionRegistry = (tenant: string, extra: RetentionCategory[] = []) => JSON.stringify({ version: 1, tenants: { [tenant]:
  Object.fromEntries([...['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'], ...extra].map((category) => [category, fixturePolicy])) } });

let storage: FakeStorage;
let shopper: ShopperReflex;
let env: Env;
let sockets: WebSocket[];
let pending: Promise<unknown>[];
let principal: SessionCapability;
let capability: string;

beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(t0);
  storage = new FakeStorage();
  sockets = []; pending = [];
  const state = { id: subject, storage, acceptWebSocket: () => undefined, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
  env = { DEPLOYMENT_PROFILE: 'demo', REFLEX_HOST: 'do', CACHE: new FakeKV(), SESSIONS: new FakeKV(), STORAGE: new FixtureR2(), ENVIRONMENT: 'test', CONNECTOR_MODE: 'mock', JWT_SECRET: 'w0502-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    TENANTS: JSON.stringify({ provisioned: ['coach'] }), RETENTION: retentionRegistry('coach'),
    SHOPPER_REFLEX: { idFromName: (n: string) => n, get: () => ({ fetch: (request: Request) => shopper.fetch(request) }) },
  } as unknown as Env;
  await seedPublication(env, 'coach');
  shopper = new ShopperReflex(state, env);
  await register();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const post = async (path: string, body: unknown) => {
  if (path === '/consent') body = { ...(body as object), choice: { id: crypto.randomUUID(), expectedRevision: storedConsent(storage.map.get('consent')).instruction?.revision ?? null,
    grantId: principal.grantId, iat: principal.iat, exp: principal.exp } };
  const res = await shopper.fetch(new Request(`https://do${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', [SHOPPER_HEADER]: capability, 'X-Tenant': 'coach' }, body: JSON.stringify(body) }));
  const result = { status: res.status, body: (await res.json()) as any };
  if (path === '/reset' && res.ok) await register();
  return result;
};
async function register() {
  const authority = storage.map.get('grantAuthority') as { epoch: string } | undefined;
  const issued = await issueSessionCapability(env, { tenant: 'coach', subject, sessionId: crypto.randomUUID(), kind: 'anonymous', ...(authority ? { authorityEpoch: authority.epoch } : {}) });
  capability = issued.capability; principal = await verifySessionCapability(env, capability, 'coach');
  storage.map.set('grantAuthority', { version: 1, epoch: principal.authorityEpoch, grants: { [principal.grantId!]: principal } });
}
const get = async (path: string) => { const res = await shopper.fetch(new Request(`https://do${path}`, { headers: { [SHOPPER_HEADER]: capability, 'X-Tenant': 'coach' } })); return (await res.json()) as any; };
const view = (extra: Record<string, unknown> = {}) => ({ type: 'product_view', userId: subject, sessionId: principal.sessionId, data: { productId: TABBY_ID, action: 'product_view', ...extra }, source: 'test' });

describe('W05.02 shared reducer and timer boundaries', () => {
  async function destinations() {
    const calls: string[] = [];
    Object.assign(env, { ODP_API_HOST: 'https://odp.synthetic.invalid', ODP_PUBLIC_KEY: 'synthetic-only',
      REGION_TREND: { idFromName: (n: string) => n, get: () => ({ fetch: async () => { calls.push('region'); return Response.json({ ok: true }); } }) },
    });
    // Each configured destination carries its own retention policy key
    // (src/retention.ts:11-18, :72-89); without it the first external record
    // is refused before the reducer is reached.
    env.RETENTION = retentionRegistry('coach', (await configuredDestinations(env, 'coach', () => undefined)).map((d) => d.category));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname; calls.push(path);
      return path.endsWith('/graphql') ? Response.json({ data: { customer: { audiences: { edges: [] } } } }) : new Response('{}', { status: 202 });
    }));
    return calls;
  }
  async function drain() {
    while (pending.length) await Promise.all(pending.splice(0));
    // Settle the actual fire-and-forget hash/fetch/receipt continuations without
    // moving the fake engine clock or reaching external network.
    await settle(10);
  }
  it('gates actual reducer geo fan and configured ODP, preserving tracking-only storage and measurements', async () => {
    const calls = await destinations();
    for (const tracking of [false, true]) for (const personalization of [false, true]) {
      await post('/reset', {}); await post('/consent', { tracking, personalization });
      calls.length = 0; const before = storage.puts;
      // normalizeEvent intentionally still drops geo; this is explicitly the
      // actual shared reducer, not a claim that the HTTP route supplies geo.
      const out = await (shopper as any).serialize(async () => {
        await (shopper as any).assertOwned(principal);
        return (shopper as any).ingest({ ...view({ consent: { tracking: true, personalization: true } }), timestamp: t0, geo: { country: 'US', regionCode: 'NY' } }, principal);
      });
      await drain();
      expect(out.body.consent).toMatchObject({ tracking, personalization });
      expect(calls.includes('region')).toBe(tracking);
      expect(calls.includes('/v3/events')).toBe(tracking);
      expect(calls.includes('/v3/graphql')).toBe(tracking && personalization);
      expect(!!out.body.update).toBe(tracking && personalization);
      expect(storage.map.has('affinity')).toBe(tracking);
      if (!tracking) { expect(storage.puts).toBe(before); expect(calls).toEqual([]); }
    }
  });

  it('honors withdrawal in serialized socket actions and pending alarms without skipping retention cleanup', async () => {
    const calls = await destinations();
    await post('/consent', { tracking: true, personalization: true });
    for (let i = 0; i < 4; i++) { vi.setSystemTime(t0 + i * 5000); await post('/ingest', { ...view(), userId: subject }); }
    await drain();
    const frames: any[] = [];
    const ws = { deserializeAttachment: () => ({ shopperId: subject, principal }), send: (raw: string) => frames.push(JSON.parse(raw)), close: () => frames.push({ type: 'closed' }) } as unknown as WebSocket;
    sockets.push(ws);
    // A consenting alarm really performs the continuation, not just a no-op stub.
    calls.length = 0;
    vi.setSystemTime(t0 + 300_000); storage.alarm = null; await shopper.alarm(); await drain();
    expect(calls).toContain('/v3/graphql'); expect(frames.some(v => v.type === 'personalization_update')).toBe(true);
    for (const consent of [{ tracking: false, personalization: true }, { tracking: true, personalization: false }]) {
      await post('/consent', consent); const before = structuredClone([...storage.map]);
      const puts = storage.puts; calls.length = 0; frames.length = 0;
      if (!consent.tracking) await shopper.webSocketMessage(ws, JSON.stringify({ type: 'action', event: { ...view({ consent: { tracking: true, personalization: true } }), userId: subject } }));
      storage.alarm = null; await shopper.alarm(); await drain();
      expect([...storage.map]).toEqual(before); expect(storage.puts).toBe(puts);
      expect(calls).toEqual([]); expect(frames).toEqual([]);
      const aff = storage.map.get('affinity') as { lastSeen: number; retention: { expiresAt: number } };
      // The idle expiry is the profile record's own retention expiry: the
      // policy lifetime runs from the record's birth and never renews on
      // activity or on a refusal (src/retention.ts:24-25, :88-92;
      // ShopperReflex.ts:1399-1402, :1487).
      expect(aff.retention.expiresAt).toBe(t0 + 30 * 86_400_000);
      expect(storage.alarm).toBe(aff.retention.expiresAt);
    }
    // The refusal guard does not precede or extend the unchanged idle expiry.
    vi.setSystemTime(t0 + 31 * 86_400_000); sockets.length = 0;
    storage.alarm = null; await shopper.alarm(); expect(storage.map.has('affinity')).toBe(false); expect(storage.map.has('pipeline')).toBe(false);
    expect(storage.map.get('grantAuthority')).toMatchObject({ grants: {} }); expect(storage.alarm).toBeNull();
  });
});

describe('the switches', () => {
  it('W05.01 publishes consent memory only after a successful write, including retry', async () => {
    for (const current of [false, true]) {
      await post('/consent', { tracking: current, personalization: current });
      const writer = vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('synthetic storage failure'));
      await expect(post('/consent', { tracking: !current, personalization: !current })).rejects.toThrow('synthetic storage failure');
      expect((await get('/snapshot')).consent).toMatchObject({ tracking: current, personalization: current });
      expect(storedConsent(storage.map.get('consent'))).toMatchObject({ tracking: current, personalization: current });
      await post('/consent', { tracking: !current, personalization: !current });
      expect(writer).toHaveBeenCalledTimes(2);
      expect((await get('/snapshot')).consent).toMatchObject({ tracking: !current, personalization: !current });
      writer.mockRestore();
    }
  });
  it('are off when nothing was ever said, on the snapshot and the envelope', async () => {
    expect((await get('/snapshot')).consent).toEqual({ tracking: false, personalization: false });
    const r = await post('/ingest', view());
    expect(r.body.consent).toEqual({ tracking: false, personalization: false });
    expect(storage.map.has('affinity')).toBe(false);
  });

  it('are set through the door, only by an explicit boolean, and remembered', async () => {
    const r = await post('/consent', { personalization: false, tracking: 'no' as never });
    expect(r.status).toBe(400); expect(storage.map.has('consent')).toBe(false);
    expect((await post('/consent', { personalization: false })).body.consent).toMatchObject({ tracking: false, personalization: false });
    expect(storedConsent(storage.map.get('consent'))).toMatchObject({ tracking: false, personalization: false });
  });

  it('can arrive on an event, under data.consent', async () => {
    await post('/consent', { tracking: true, personalization: true });
    const r = await post('/ingest', view({ consent: { tracking: false } }));
    expect(r.body.consent).toMatchObject({ tracking: false, personalization: true });
    expect(storedConsent(storage.map.get('consent'))).toMatchObject({ tracking: false, personalization: true });
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

  it('does not survive an erasure: a reset shopper starts off', async () => {
    await post('/consent', { tracking: false });
    await post('/reset', {});
    expect((await get('/snapshot')).consent).toEqual({ tracking: false, personalization: false });
  });
});
