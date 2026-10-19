// src/units/_base52/G21.unit.test.ts
// Baseline-52 product unit G21: the first consent choice of a fresh module graph
// answers 500 "unusable" (ruling R-P86, `_evidence/parity-step3/AMENDMENTS.md:302`;
// the analysis `_evidence/baseline-52/g21/ANALYSIS.md` §1 and §2).
//
// MECHANISM (read at f962fa94; ANALYSIS.md §2)
//   · the shopper's object rebuilds the forwarded request from the incoming stream
//     (ShopperReflex.ts:495-497), then clones it for every preferences path, reads
//     the clone and drops it (ShopperReflex.ts:505-506);
//   · the first owner request of a module graph then waits on the lazy route
//     imports (sessionAuthority.ts:583-588, awaited at :680);
//   · under Node's bundled undici (6.21.2) a clone that is garbage-collected
//     cancels its original's body, so a GC inside that wait leaves the routed
//     request unusable: the owner app's own clone at realtime.ts:56 throws
//     "unusable" and the owner's error handler answers 500
//     (sessionAuthority.ts:590-591 → middleware/error.ts:30-37).
//   R-P86 rules fix shape FS-2: one body read at the owner hop, the routed request
//   rebuilt from that text, the byte and time bounds kept.
//
// THE LEVER (ANALYSIS.md §1). A forced full GC every 5 ms around the choice turns
// the natural 1-in-10 into a deterministic outcome. `v8.setFlagsFromString` is
// PROCESS-WIDE: once set, a new context of any isolate in this vitest process can
// reach `gc`. The 5 ms interval itself runs only in this file's worker and is
// cleared in `finally`. vitest 1.6.1 runs each file in its own worker thread (the
// default pool `threads` with `isolate: true`, vitest/dist/vendor/cli-api.OdDWuB7Y.js
// :9154-9158 and :8203-8205; vitest.config.ts sets neither), so no other file's
// tests run under the interval.
//
// FRESH MODULE GRAPH. Each leg calls `vi.resetModules()` and imports the engine
// anew, so the memo of `shopperRoutes` (sessionAuthority.ts:583-585) is empty and
// the leg's choice is the first owner request of its graph, as the file's first
// test is in a fresh worker. No warm-up choice precedes it: the throwaway choice of
// src/routes/sort.regional.test.ts:153-156 hides the defect (ANALYSIS.md §4).
//
// FIXTURE. One neutral tenant and one anonymous shopper; the real session-side
// app (tenantMiddleware and the realtime routes, mounted as
// src/routes/realtime.sdkContract.test.ts mounts them) and the real ShopperReflex
// class in process over in-memory storage, on each `REFLEX_HOST`. The choice is
// a mixed one (tracking on, personalization off), so the stored record matches
// neither the refusing default nor a blanket consent.
//
// RESIDUAL (named, not pinned here; R-P86). FS-2 leaves the pair realtime.ts:56 →
// sessionCapability.ts:267: a clone read and dropped, then a second clone after the
// crypto.subtle awaits (sessionCapability.ts:198-199); a GC between them would
// answer 401 (sessionCapability.ts:268-271). Under this lever, on a scratch tree
// carrying FS-2, it never fired: 20,504 choices per host (sequential at 5 ms and
// 1 ms, and 16 at a time at 5 ms), all 200, no clone refused. It fires every time
// only when that window is widened by a 10 ms timer (scratch only), so no leg can
// be RED for it on the shipped window.

import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import type { Consent } from '@/content/consent';
import type { Env } from '@/types/env';

v8.setFlagsFromString('--expose-gc');
const forceGc = vm.runInNewContext('gc') as () => void;

const TENANT = 'unit-g21';
const DAY = 86_400_000;

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) as unknown : v; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string }) { return { keys: [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort().map(name => ({ name })), list_complete: true }; }
}
class UnitR2 {
  objects = new Map<string, string>();
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v1', size: raw.length, body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string) { this.objects.set(key, raw); return { key, etag: 'v1', size: raw.length }; }
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key); }
  async list(options: { prefix?: string } = {}) {
    return { objects: [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort().map(key => ({ key, size: 0, uploaded: new Date(0) })), truncated: false };
  }
}

/** The engine, imported from an emptied module registry: a cold graph, as a fresh test file or a new object isolate starts. */
async function freshEngine() {
  vi.resetModules();
  const { Hono } = await import('hono');
  const { default: realtimeRoutes } = await import('@/routes/realtime');
  const { tenantMiddleware } = await import('@/tenancy/middleware');
  const { ShopperReflex } = await import('@/durable-objects/ShopperReflex');
  const { shopperObjectName } = await import('@/tenancy/objects');
  const { newAnonymousSession, SHOPPER_HEADER } = await import('@/identity/sessionCapability');
  const { storedConsent } = await import('@/content/consent');
  return { Hono, realtimeRoutes, tenantMiddleware, ShopperReflex, shopperObjectName, newAnonymousSession, SHOPPER_HEADER, storedConsent };
}

async function world(host: 'session' | 'do') {
  const m = await freshEngine();
  const pending: Promise<unknown>[] = [];
  const policy = { id: 'g21-fixture-policy', revision: 1, durationMs: 365 * DAY, basis: 'admitted', renewal: 'new-record-only' };
  const env = {
    CACHE: new UnitKV(), SESSIONS: new UnitKV(), STORAGE: new UnitR2(), REFLEX_HOST: host, ENVIRONMENT: 'test', CONNECTOR_MODE: 'mock', DEPLOYMENT_PROFILE: 'demo',
    JWT_SECRET: 'g21-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', LEDGER_RECOVERY_ENABLED: 'false', IDENTITY_SALT: 'g21-fixture',
    TENANTS: JSON.stringify({ provisioned: [TENANT] }),
    RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'].map(c => [c, policy])) } }),
    EVENT_QUEUE: { send: async () => undefined },
    PERSONALIZATION_WEBSOCKET: { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
  } as unknown as Env;
  /** Each shopper object's storage, by object name: the real ShopperReflex class answers over it. */
  const objects = new Map<string, Map<string, unknown>>();
  const shoppers = new Map<string, { fetch: (request: Request) => Promise<Response> }>();
  env.SHOPPER_REFLEX = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    let shopper = shoppers.get(name);
    if (!shopper) {
      const data = new Map<string, unknown>(); let alarm: number | null = null;
      const storage = {
        get: async (key: string | string[]) => structuredClone(Array.isArray(key) ? new Map(key.map(k => [k, data.get(k)])) : data.get(key)),
        put: async (key: string | Record<string, unknown>, value?: unknown) => { if (typeof key === 'string') data.set(key, structuredClone(value)); else for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v)); },
        list: async (q?: { prefix?: string; startAfter?: string; limit?: number }) => structuredClone(new Map([...data].filter(([k]) => k.startsWith(q?.prefix ?? '') && (!q?.startAfter || k > q.startAfter)).sort(([a], [b]) => a.localeCompare(b)).slice(0, q?.limit))),
        delete: async (keys: string | string[]) => { for (const k of typeof keys === 'string' ? [keys] : keys) data.delete(k); }, deleteAll: async () => data.clear(),
        getAlarm: async () => alarm, setAlarm: async (value: number) => { alarm = value; }, deleteAlarm: async () => { alarm = null; },
        transaction: async (work: (tx: unknown) => Promise<unknown>) => { const saved = structuredClone(data); try { return await work(storage); } catch (error) { data.clear(); for (const [k, v] of saved) data.set(k, v); throw error; } },
      };
      const state = { id: name, storage, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
      shopper = new m.ShopperReflex(state, env); shoppers.set(name, shopper); objects.set(name, data);
    }
    return shopper.fetch(new Request(input, init));
  } }) } as unknown as DurableObjectNamespace;
  const app = new m.Hono<{ Bindings: Env }>();
  app.use('*', m.tenantMiddleware()); app.route('/realtime', m.realtimeRoutes);
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { return; }, props: {} } as unknown as ExecutionContext;
  const grant = await m.newAnonymousSession(env, TENANT);
  const stored = () => objects.get(m.shopperObjectName(TENANT, grant.subject))?.get('consent');
  // The SDK's explicit choice: the current grant's metadata and the revision the
  // object holds now (none yet, so the engine's own `null`: consent.ts:139-140, checked at :109).
  const sent = { trackingConsent: true, personalizationEnabled: false,
    choice: { id: crypto.randomUUID(), expectedRevision: m.storedConsent(stored()).instruction?.revision ?? null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp } };
  /** POST /realtime/session/:id/preferences through the mounted app, exactly once. */
  const choose = async () => app.request(`https://g21.invalid/realtime/session/${grant.sessionId}/preferences`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant': TENANT, [m.SHOPPER_HEADER]: grant.capability }, body: JSON.stringify(sent),
  }, env, ctx);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  return { m, sent, choose, stored, drain };
}

/** The analysis's lever (ANALYSIS.md §1): a forced full GC every 5 ms while `work` runs, the interval cleared in `finally`. */
async function underForcedGc<T>(work: () => Promise<T>): Promise<T> {
  const timer = setInterval(forceGc, 5);
  try { return await work(); } finally { clearInterval(timer); }
}

describe('unit:G21 the first consent choice of a fresh module graph answers 200 and stores the choice sent, even when a GC runs while the owner loads its routes (R-P86, FS-2)', () => {
  for (const host of ['session', 'do'] as const) {
    it(`host: REFLEX_HOST=${host}, the first choice of a fresh module graph, under a forced GC every 5 ms, answers 200 and the object stores the choice sent`, async () => {
      const w = await world(host);
      const response = await underForcedGc(() => w.choose());
      const text = await response.text();
      // R-P86: the choice is answered (realtime.ts:681-697), never the 500 "unusable" that a dropped clone's GC
      // (ShopperReflex.ts:505-506) produces at the owner's own clone (realtime.ts:56 → middleware/error.ts:30-37).
      expect(response.status, text).toBe(200);
      await w.drain();
      const stored: Consent = w.m.storedConsent(w.stored());
      // R-P86, consent.ts:110-111 (chooseConsent): the stored instruction's revision is the sent choice's id.
      expect(stored.instruction?.revision, JSON.stringify(stored)).toBe(w.sent.choice.id);
      // R-P86, consent.ts:112 and :69-72: the stored switches are the ones sent, tracking on and personalization off.
      expect({ tracking: stored.tracking, personalization: stored.personalization })
        .toEqual({ tracking: w.sent.trackingConsent, personalization: w.sent.personalizationEnabled });
      // R-P86, consent.ts:103-104 and :111: the stored operation is the sent one (its id, its expected revision, its switches).
      expect(stored.instruction?.operation).toMatchObject({ id: w.sent.choice.id, expected: w.sent.choice.expectedRevision,
        tracking: w.sent.trackingConsent, personalization: w.sent.personalizationEnabled });
      // R-P86, realtime.ts:691 and :697, ShopperReflex.ts:948-954: the answer carries the consent the object stored.
      expect((JSON.parse(text) as { consent?: unknown }).consent).toEqual(stored);
    });
  }
});
