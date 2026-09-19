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
import { shopperObjectName } from '@/tenancy/objects';
import { issueSessionCapability, verifySessionCapability, SHOPPER_HEADER, type SessionCapability } from '@/identity/sessionCapability';
import { initializePublicationSet, pinPublication, type PublicationBaseline } from '@/config/publication';
import { REFLEX_KIND, reflexScopeForTenant } from './configStore';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from '@/content/kinds';
import { storedConsent } from '@/content/consent';
import type { RetentionPolicy } from '@/retention';

const CFG = DEFAULT_REFLEX_CONFIG; // τ=60s · K=1.8 · θ 0.6/0.45 · priceBand τ=150s
const DAY = 24 * 60 * 60 * 1000;
const RETENTION_30D = 30 * DAY;
const TABBY_ID = 'COA-CH857'; // real catalog product: line Tabby · elevated band
const t0 = 1_750_000_000_000;
// A capability subject is a validated shape (src/identity/sessionCapability.ts:37-47).
const SUBJECT = 'vis-00000000-0000-4000-8000-000000000108';

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
  async delete(k: string | string[]): Promise<boolean | number> {
    if (Array.isArray(k)) { let n = 0; for (const key of k) if (this.map.delete(key)) n++; return n; }
    return this.map.delete(k);
  }
  async list(options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }): Promise<Map<string, unknown>> {
    return structuredClone(new Map([...this.map]
      .filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
      .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit)));
  }
  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
  /** The object erases and re-arms inside one transaction (ShopperReflex.ts:1803, :1470). */
  async transaction(run: (tx: unknown) => Promise<unknown>): Promise<unknown> {
    const candidate = structuredClone(this.map);
    let alarm = this.alarm;
    const result = await run({
      list: async () => structuredClone(candidate),
      get: async (key: string) => structuredClone(candidate.get(key)),
      put: async (values: string | Record<string, unknown>, value?: unknown) => {
        if (typeof values === 'string') candidate.set(values, structuredClone(value));
        else for (const [key, item] of Object.entries(values)) candidate.set(key, structuredClone(item));
      },
      delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
      deleteAlarm: async () => { alarm = null; },
      setAlarm: async (at: number) => { alarm = at; },
    });
    this.map = candidate; this.alarm = alarm; return result;
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
  closed: Array<{ code: number; reason: string }> = [];
  send(m: string): void {
    this.sent.push(m);
  }
  /** The object closes a socket whose authority is gone (ShopperReflex.ts:810, :817). */
  close(code = 1000, reason = ''): void {
    this.closed.push({ code, reason });
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
  subject: string;
  capability?: string;
  principal?: SessionCapability;
}

/**
 * R2 honouring the strengthened publication put/get contract
 * (src/config/publication.ts:225-237, :293-295), the shape the working double in
 * src/routes/realtime.sdkContract.test.ts uses.
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
 * Configuration publication is the only configuration authority
 * (src/config/publication.ts:19, :150-152, :204-206): the object resolves its
 * Reflex config through it on every ingest, snapshot and alarm. Explicit
 * test-authored W11 baseline, never a re-admitted KV fallback.
 */
const seedPublication = (env: Env, tenant: string) => {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'synthetic-fixture', note: '', value } });
  return initializePublicationSet(env, [
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }),
    baseline(LEARN_KIND, { holdout: { share: 0, salt: 'fixture', arms: ['default'] } }),
  ], '0:' + crypto.randomUUID());
};

/** A first record needs the retention registry (src/retention.ts:39, :72-89; ShopperReflex.ts:1034). */
const fixturePolicy: RetentionPolicy = { id: 'explicit-reflex-fixture', revision: 1, durationMs: 30 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
const RETENTION_REGISTRY = JSON.stringify({ version: 1, tenants: { coach:
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'].map((category) => [category, fixturePolicy])) } });

const SIGNING = { JWT_SECRET: 'w0108-synthetic-demo-signing-material', JWT_ISSUER: 'w0108', JWT_AUDIENCE: 'w0108' };

async function makeDO(envOverrides: Record<string, unknown> = {}, opts: { sharedEnv?: Env; sharedStorage?: FakeStorage; withSocket?: boolean; subject?: string; capability?: string; principal?: SessionCapability } = {}): Promise<Harness> {
  const storage = opts.sharedStorage ?? new FakeStorage();
  const sockets: FakeSocket[] = [];
  const subject = opts.subject ?? SUBJECT;
  if (opts.withSocket ?? true) {
    const ws = new FakeSocket();
    ws.serializeAttachment({ shopperId: subject, ...(opts.principal ? { principal: opts.principal } : {}) });
    sockets.push(ws);
  }
  const state = {
    id: shopperObjectName('coach', subject),
    storage,
    acceptWebSocket: (ws: unknown) => sockets.push(ws as FakeSocket),
    getWebSockets: () => sockets,
    waitUntil: (promise: Promise<unknown>) => void promise,
  } as unknown as DurableObjectState;
  const env =
    opts.sharedEnv ??
    ({
      DEPLOYMENT_PROFILE: 'demo',
      SHOPPER_REFLEX: { idFromName: (name: string) => name },
      CACHE: new FakeKV(),
      SESSIONS: new FakeKV(),
      STORAGE: new FixtureR2(),
      TENANTS: JSON.stringify({ provisioned: ['coach'] }),
      RETENTION: RETENTION_REGISTRY,
      ENVIRONMENT: 'test',
      CONNECTOR_MODE: 'mock',
      ...SIGNING,
      ...envOverrides,
    } as unknown as Env);
  if (!opts.sharedEnv) await seedPublication(env, 'coach');
  return { shopper: new ShopperReflex(state, env), storage, sockets, env, subject, capability: opts.capability, principal: opts.principal };
}

/**
 * Nothing is kept without an explicit stored choice: absence is OFF
 * (src/content/consent.ts:139-163; ShopperReflex.ts:1019-1024; D06-W05). The
 * choice is made through the object's own door by the owner of the grant the
 * first signed request adopts (ShopperReflex.ts:694-716, :1756-1767).
 */
async function consenting(h: Harness, tracking = true, personalization = true): Promise<Harness> {
  const issued = await issueSessionCapability(h.env, { tenant: 'coach', subject: h.subject, sessionId: 'w0108-' + crypto.randomUUID(), kind: 'anonymous' });
  const principal = await verifySessionCapability(h.env, issued.capability, 'coach');
  const res = await h.shopper.fetch(new Request('https://do/consent', { method: 'POST',
    headers: { 'Content-Type': 'application/json', [SHOPPER_HEADER]: issued.capability, 'X-Tenant': 'coach' },
    body: JSON.stringify({ tracking, personalization, choice: { id: crypto.randomUUID(),
      expectedRevision: storedConsent(h.storage.map.get('consent')).instruction?.revision ?? null,
      grantId: principal.grantId, iat: principal.iat, exp: principal.exp } }) }));
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
  h.capability = issued.capability; h.principal = principal;
  if (h.sockets[0]) h.sockets[0].serializeAttachment({ shopperId: h.subject, principal });
  return h;
}

/** A consenting owned object: the shape every kept-state case starts from. */
async function ownedDO(envOverrides: Record<string, unknown> = {}, opts: Parameters<typeof makeDO>[1] = {}): Promise<Harness> {
  return consenting(await makeDO(envOverrides, opts));
}

function viewEvent(pid: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'product_view',
    userId: SUBJECT,
    data: { productId: pid, action: 'product_view' },
    source: 'test',
    timestamp: 1, // deliberately bogus — the DO must stamp its OWN arrival time
    ...overrides,
  };
}

async function post(shopper: ShopperReflex, event: unknown, capability?: string): Promise<{ status: number; body: any }> {
  const res = await shopper.fetch(
    new Request('https://do/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(capability ? { 'X-Shopper-Session': capability, 'X-Tenant': 'coach' } : {}) },
      body: JSON.stringify(event),
    })
  );
  return { status: res.status, body: await res.json() };
}

/** Three brisk Tabby views 5s apart — the golden entry sequence from core.test. */
async function driveToMembership(h: Harness): Promise<any> {
  const event = () => viewEvent(TABBY_ID, { userId: h.subject, ...(h.principal ? { sessionId: h.principal.sessionId } : {}) });
  vi.setSystemTime(t0);
  await post(h.shopper, event(), h.capability);
  vi.setSystemTime(t0 + 5_000);
  await post(h.shopper, event(), h.capability);
  vi.setSystemTime(t0 + 10_000);
  return post(h.shopper, event(), h.capability);
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
    const h = await ownedDO();
    await driveToMembership(h);

    const rec = h.storage.map.get('affinity') as AffinityRecord;
    // The record also carries the retention stamp its own policy gave it at
    // birth, the external-copy retention map and the ODP context
    // (src/durable-objects/ShopperReflex.ts:127-138; src/retention.ts:32-41, :88-92).
    expect(Object.keys(rec).sort()).toEqual([
      'configVersion',
      'externalRetention',
      'lastSeen',
      'odpContext',
      'odpRecentEvents',
      'odpSeed',
      'odpSeedAt',
      'reflex',
      'retention',
      'shopperId',
    ]);
    expect(rec.retention).toMatchObject({ version: 1, tenant: 'coach', category: 'profile', policyId: 'explicit-reflex-fixture', basis: 'admitted' });
    expect(rec.retention!.expiresAt).toBe(rec.retention!.bornAt + 30 * DAY);
    expect(rec.shopperId).toBe(SUBJECT);
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
    // Current native pushes require the same durable grant as ingest. The
    // first genuine signed request adopts it; no authority verdict is mocked.
    const h = await ownedDO();
    const capability = h.capability!;
    const event = () => viewEvent(TABBY_ID, { userId: h.subject, sessionId: h.principal!.sessionId });
    expect((await post(h.shopper, event(), capability)).status).toBe(200);
    vi.setSystemTime(t0 + 5_000);
    expect((await post(h.shopper, event(), capability)).status).toBe(200);
    vi.setSystemTime(t0 + 10_000);
    const r3 = await post(h.shopper, event(), capability);

    // Response envelope (what POST /realtime/action returns verbatim in DO mode).
    expect(r3.status).toBe(200);
    expect(r3.body.success).toBe(true);
    expect(typeof r3.body.sessionId).toBe('string');
    expect(r3.body.cookiesUpdated).toBe(false);
    const update = r3.body.update;
    expect(update.type).toBe('personalization_update');
    expect(update.userId).toBe(h.subject);

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
    const h = await ownedDO();
    await driveToMembership(h);
    const pushesBefore = h.sockets[0].sent.length;

    vi.setSystemTime(t0 + 15_000);
    const r4 = await post(h.shopper, viewEvent(TABBY_ID, { sessionId: h.principal!.sessionId }), h.capability);
    expect(r4.body.success).toBe(true);
    expect(r4.body.update).toBeUndefined();
    expect(r4.body.message).toMatch(/no personalization changes/);
    expect(h.sockets[0].sent.length).toBe(pushesBefore); // no redundant push
    const rec = h.storage.map.get('affinity') as AffinityRecord;
    expect(rec.lastSeen).toBe(t0 + 15_000); // activity still persisted
  });

  it('drops events referencing unknown productIds (catalog-index validation) without creating state', async () => {
    const h = await ownedDO();
    // The explicit choice itself arms the consent-expiry alarm before any event
    // (ShopperReflex.ts:708, :1679-1685); a dropped event must not move it.
    const armed = h.storage.alarm;
    const r = await post(h.shopper, viewEvent('NOT-A-REAL-SKU', { sessionId: h.principal!.sessionId }), h.capability);
    expect(r.status).toBe(200);
    expect(r.body.dropped).toBe('unknown_product');
    expect(h.storage.map.has('affinity')).toBe(false);
    expect(h.storage.alarm).toBe(armed);
  });

  it('rate-limits per minute in-object (429), then admits again in the next window', async () => {
    const h = await makeDO({ REFLEX_RATE_LIMIT_PER_MIN: '2' });
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
    const h = await ownedDO();
    const ws = new FakeSocket();
    // The attachment carries the shopper and the grant the socket was accepted
    // under; a socket without live authority is closed (ShopperReflex.ts:810-824).
    ws.serializeAttachment({ shopperId: h.subject, principal: h.principal });
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
    expect(rec.shopperId).toBe(h.subject);
    expect(rec.reflex.dims.line.Tabby.s).toBeGreaterThan(1); // both frames scored
    // Heartbeat frames answer without touching state.
    await h.shopper.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'heartbeat' }));
    expect(ws.frames().some((f) => f.type === 'heartbeat_response')).toBe(true);
  });

  it('GET /snapshot returns the GET /realtime/reflex shape', async () => {
    const h = await ownedDO();
    await driveToMembership(h);
    const res = await h.shopper.fetch(new Request('https://do/snapshot', { headers: { [SHOPPER_HEADER]: h.capability!, 'X-Tenant': 'coach' } }));
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
    const h = await ownedDO();
    await driveToMembership(h);
    const armedAt = h.storage.alarm!;
    expect(armedAt).toBeGreaterThan(t0 + 10_000);

    // Wake just past the scheduled crossing: the 60s-τ dims are below θ_out;
    // priceBand (τ=150s) still holds — hysteresis is per-dimension. The runtime
    // clears a delivered alarm before the handler runs, and the object then
    // re-arms at the minimum of the live deadlines (ShopperReflex.ts:3187-3201).
    vi.setSystemTime(armedAt + 1_000);
    h.storage.alarm = null;
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
    const h = await ownedDO();
    await driveToMembership(h);

    // Simulate eviction: a brand-new object instance over the SAME storage.
    const woken = await makeDO({}, { sharedStorage: h.storage, sharedEnv: h.env, withSocket: true, capability: h.capability, principal: h.principal });
    vi.setSystemTime(t0 + 10_000 + 300_000); // long past every crossing
    await woken.shopper.alarm();
    const rec = woken.storage.map.get('affinity') as AffinityRecord;
    expect(rec.reflex.audiences).toEqual([]); // everything decayed out, from rehydrated state
    const push = woken.sockets[0].frames().find((f) => f.type === 'personalization_update');
    expect(push).toBeDefined();
  });

  it('retention: idle past N days with no sockets → storage.deleteAll()', async () => {
    const h = await ownedDO({ REFLEX_RETENTION_DAYS: '30' });
    await driveToMembership(h);
    expect(h.storage.map.size).toBeGreaterThan(0);

    const idle = await makeDO({}, { sharedStorage: h.storage, sharedEnv: h.env, withSocket: false, capability: h.capability, principal: h.principal });
    vi.setSystemTime(t0 + 10_000 + RETENTION_30D + 1);
    idle.storage.alarm = null;
    await idle.shopper.alarm();
    // Everything the shopper owned is gone; only the empty grant-authority
    // barrier survives the erasure, which is what keeps a later legacy writer
    // out (ShopperReflex.ts:1796-1801, :1692-1694) — the same record
    // shopperReflex.consent.test.ts pins after an expiry.
    expect([...idle.storage.map.keys()]).toEqual(['grantAuthority']);
    expect(idle.storage.map.get('grantAuthority')).toMatchObject({ grants: {} });
    expect(idle.storage.alarm).toBeNull();

    // And a live socket DEFERS the wipe (the shopper is not idle).
    const h2 = await ownedDO();
    await driveToMembership(h2);
    vi.setSystemTime(t0 + 10_000 + RETENTION_30D + 1);
    await h2.shopper.alarm(); // socket present in this harness
    expect(h2.storage.map.size).toBeGreaterThan(0);
  });
});

// ── 5. Reducer determinism: the DO hosts the same core math ─────────────────

describe('hosting invariant — the DO state equals a pure-core replay of the same stream', () => {
  it('storage reflex state === ReflexCore.apply replay with the DO’s stamped times', async () => {
    const h = await ownedDO();
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

// ── CW24: a customer's product, scored against their attributes, per scope ───
import { writeReflexConfig } from './configStore';
import { invalidateCache } from '@/config/versionedStore';
import { DEFAULT_REFLEX_CONFIG as BASE_CFG } from './core';

describe('event-carried attributes (CW24)', () => {
  const theirs = (h: Harness) => new Request('https://do/ingest', {
    method: 'POST', headers: { 'Content-Type': 'application/json', [SHOPPER_HEADER]: h.capability!, 'X-Tenant': 'coach' },
    body: JSON.stringify({ type: 'product_view', userId: h.subject, sessionId: h.principal!.sessionId, source: 'coach-storefront', timestamp: Date.now(),
      data: { productId: 'their-sku-9', line: 'Drover', category: 'Outerwear', occasion: ['everyday'], price_usd: 420 } }),
  });

  it('is dropped as unknown while the scope is catalog-only, exactly as before', async () => {
    invalidateCache();
    const h = await ownedDO();
    const res = await h.shopper.fetch(theirs(h));
    expect(((await res.json()) as { dropped?: string }).dropped).toBe('unknown_product');
  });

  it('scores the event once the scope says event-when-unknown', async () => {
    invalidateCache();
    const h = await ownedDO();
    // A configuration write carries the authored document revision and the
    // coherent publication identity (src/config/publication.ts:66-73, :76-88);
    // without them the write is refused with 428 precondition_required.
    const pin = await pinPublication(h.env, 'coach');
    const revision = pin.refs['reflex:' + reflexScopeForTenant('coach')]!.revision;
    const w = await writeReflexConfig(h.env, 'coach', { ...BASE_CFG, eventAttributes: 'event-when-unknown' },
      { actor: 'test', note: 'cw24', expectedRevision: revision, expectedPublication: { revision: pin.revision, digest: pin.digest },
        operationId: revision + ':' + crypto.randomUUID() });
    expect(w.ok).toBe(true);
    for (let i = 0; i < 3; i++) {
      const res = await h.shopper.fetch(theirs(h));
      expect(((await res.json()) as { dropped?: string }).dropped).toBeUndefined();
    }
    const snap = (await (await h.shopper.fetch(new Request('https://do/snapshot', { headers: { [SHOPPER_HEADER]: h.capability!, 'X-Tenant': 'coach' } }))).json()) as { affinity: { dims: Record<string, Record<string, number>> } };
    expect(snap.affinity.dims.line?.Drover).toBeGreaterThan(0);
    expect(snap.affinity.dims.priceBand?.elevated).toBeGreaterThan(0);
    invalidateCache();
  });
});
