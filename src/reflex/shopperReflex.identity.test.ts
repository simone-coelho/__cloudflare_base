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
import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { REFLEX_KIND, reflexScopeForTenant } from './configStore';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from '@/content/kinds';
import type { RetentionPolicy } from '@/retention';
import { issueSessionCapability, verifySessionCapability, SHOPPER_HEADER, type SessionCapability } from '@/identity/sessionCapability';
import { chooseConsent, storedConsent } from '@/content/consent';

const CFG = DEFAULT_REFLEX_CONFIG;
const TABBY_ID = 'COA-CH857'; // real catalog product: line Tabby
const TABBY = audienceKey('line', 'Tabby');
const t0 = 1_750_000_000_000;
// Capability subjects are validated shapes, so the browsers carry real
// anonymous ids (src/identity/sessionCapability.ts:37-47).
const PHONE = 'vis-00000000-0000-4000-8000-000000000001';
const LAPTOP = 'vis-00000000-0000-4000-8000-000000000002';
const RESETTER = 'vis-00000000-0000-4000-8000-000000000003';
const KATE = 'vis-00000000-0000-4000-8000-000000000004';
const STAGE = 'vis-00000000-0000-4000-8000-000000000005';

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
  async deleteAll(): Promise<void> { this.map.clear(); this.alarm = null; }
  async setAlarm(t: number | Date): Promise<void> { this.alarm = typeof t === 'number' ? t : t.getTime(); }
  async getAlarm(): Promise<number | null> { return this.alarm; }
  async deleteAlarm(): Promise<void> { this.alarm = null; }
  async list(options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }): Promise<Map<string, unknown>> {
    return structuredClone(new Map([...this.map]
      .filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
      .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit)));
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
}

/**
 * R2 honouring the strengthened publication put/get contract (`get` reports
 * etag/size/body, `put` returns key/etag/size and honours the conditional
 * headers): src/config/publication.ts:225-237, :293-295. Same shape as the
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
 * Configuration publication is the only configuration authority
 * (src/config/publication.ts:19, :150-152, :204-206): the object resolves its
 * Reflex config through it on ingest, absorb, import and snapshot. Explicit
 * test-authored W11 baseline, never a re-admitted KV fallback.
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

/** A first record needs the retention registry before it may be born
 * (src/retention.ts:39, :72-89; ShopperReflex.ts:1034). */
const fixturePolicy: RetentionPolicy = { id: 'explicit-identity-fixture', revision: 1, durationMs: 30 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
const retentionRegistry = (tenants: string[]) => JSON.stringify({ version: 1, tenants: Object.fromEntries(tenants.map((tenant) => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'].map((category) => [category, fixturePolicy]))])) });

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
      const state = { id: name, storage, acceptWebSocket: () => undefined, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => void p } as unknown as DurableObjectState;
      o = { shopper: new ShopperReflex(state, this.env()), storage };
      this.objects.set(name, o);
    }
    return o;
  }
}

let env: Env;
let ns: FakeNamespace;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(t0);
  ns = new FakeNamespace(() => env);
  grants.clear();
  env = { CACHE: new FakeKV(), SESSIONS: new FakeKV(), STORAGE: new FixtureR2(), ENVIRONMENT: 'test', CONNECTOR_MODE: 'mock', REFLEX_HOST: 'do', SHOPPER_REFLEX: ns,
    DEPLOYMENT_PROFILE: 'demo', TENANTS: JSON.stringify({ provisioned: ['coach', 'kate-spade'] }), RETENTION: retentionRegistry(['coach', 'kate-spade']),
    JWT_SECRET: 'cw25-synthetic-local-signing-material', JWT_ISSUER: 'cw25', JWT_AUDIENCE: 'cw25' } as unknown as Env;
  for (const tenant of ['coach', 'kate-spade']) await seedPublication(env, tenant);
});
afterEach(() => { vi.useRealTimers(); });

const view = (userId: string, pid = TABBY_ID) => ({ type: 'product_view', userId, data: { productId: pid, action: 'product_view' }, source: 'test',
  ...(grants.has(userId) ? { sessionId: grants.get(userId)!.principal.sessionId } : {}) });

/** The object name carries the brand prefix; the doors take the pair apart. */
function contextOf(name: string): { tenant: string; subject: string } {
  const parts = name.split(':');
  return parts.length === 3 && parts[0] === 't' ? { tenant: parts[1]!, subject: parts[2]! } : { tenant: 'coach', subject: name };
}

/**
 * The identity doors are internal owner-to-owner calls and now demand an
 * internal context or a signed capability; a bare request is refused
 * (ShopperReflex.ts:357-365). linkVisitor sends exactly these headers
 * (src/identity/link.ts:85).
 */
function headersFor(name: string, path: string): Record<string, string> {
  const context = contextOf(name), grant = grants.get(context.subject);
  // An adopted object refuses a legacy internal writer (ShopperReflex.ts:1692-1694),
  // historical import refuses a principal (:687-689), and an object that already
  // forwards is no longer owner-addressable (:2497), so the internal hop reads it.
  const forwarded = ns.objects.get(name)?.storage.map.has('forwardTo') ?? false;
  if (grant && !path.startsWith('/identity/import') && !forwarded) return { [SHOPPER_HEADER]: grant.capability, 'X-Tenant': context.tenant };
  return { 'X-Reflex-Tenant': context.tenant, 'X-Reflex-Subject': context.subject };
}

const grants = new Map<string, { capability: string; principal: SessionCapability }>();

/**
 * An explicit stored consent choice, made by the owner through the real door:
 * absence is OFF and nothing is written without it (src/content/consent.ts:139-163;
 * ShopperReflex.ts:1019-1024; D06-W05). No legacy preference grants anything.
 */
async function owned(name: string, tracking = true, personalization = true) {
  const { tenant, subject } = contextOf(name);
  const issued = await issueSessionCapability(env, { tenant, subject, sessionId: 's-' + crypto.randomUUID(), kind: subject.startsWith('sh_') ? 'recognized' : 'anonymous' });
  const principal = await verifySessionCapability(env, issued.capability, tenant);
  grants.set(subject, { capability: issued.capability, principal });
  const stored = ns.object(name).storage.map.get('consent');
  const chosen = await post(name, '/consent', { tracking, personalization, choice: { id: crypto.randomUUID(),
    expectedRevision: storedConsent(stored).instruction?.revision ?? null, grantId: principal.grantId, iat: principal.iat, exp: principal.exp } });
  expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
  return principal;
}

/**
 * A person's object is created by the link receipt, so a recognized grant may
 * not adopt an empty one (ShopperReflex.ts:1756-1763) and the door is closed to
 * it. The explicit choice it would have stored is written with the product's own
 * constructor (src/content/consent.ts:92-113) — the same record, never a legacy
 * preference and never an implied grant.
 */
async function personConsent(name: string) {
  const { tenant, subject } = contextOf(name);
  const issued = await issueSessionCapability(env, { tenant, subject, sessionId: 's-' + crypto.randomUUID(), kind: 'recognized' });
  const principal = await verifySessionCapability(env, issued.capability, tenant);
  const instruction = chooseConsent(undefined, { tracking: true, personalization: true },
    { id: crypto.randomUUID(), expectedRevision: null, grantId: principal.grantId!, iat: principal.iat, exp: principal.exp }, principal);
  ns.object(name).storage.map.set('consent', instruction);
  return principal;
}

async function post(name: string, path: string, body: unknown) {
  const res = await ns.get(name).fetch(`https://do${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headersFor(name, path) }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}
async function get(name: string, path: string) {
  const res = await ns.get(name).fetch(`https://do${path}`, { headers: headersFor(name, path) });
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}

async function browseTabby(name: string, times = 3, from = t0) {
  // The grant is issued at the clock the browsing starts on: a capability whose
  // iat is in the future of the request is not valid (sessionCapability.ts:45-47).
  vi.setSystemTime(from);
  if (!grants.has(contextOf(name).subject)) await owned(name);
  for (let i = 0; i < times; i++) {
    vi.setSystemTime(from + i * 5_000);
    const r = await post(name, '/ingest', view(name));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
}

describe('the doors', () => {
  it('export → absorb: the person carries what the browser learned, under the person’s id', async () => {
    await browseTabby(PHONE);
    const exported = await get(PHONE, '/identity/export');
    expect(exported.body.affinity.shopperId).toBe(PHONE);
    expect(exported.body.forwardTo).toBeNull();

    const sh = 'sh_' + 'a'.repeat(32);
    await personConsent(sh);
    const absorbed = await post(sh, '/identity/absorb', { shopperId: sh, now: t0 + 12_000, affinity: exported.body.affinity, pipeline: exported.body.pipeline });
    expect(absorbed.status).toBe(200);
    expect(absorbed.body.audiences).toContain(TABBY);
    const person = ns.object(sh).storage.map.get('affinity') as AffinityRecord;
    expect(person.shopperId).toBe(sh);
    expect((ns.object(sh).storage.map.get('pipeline') as { visitorId?: string }).visitorId).toBe(sh);
  });

  it('absorb twice, from two devices: counters add and the vector is the sum', async () => {
    // Two views on each device, interleaved in time; neither device alone crosses θ_in.
    await browseTabby(PHONE, 2, t0);
    await browseTabby(LAPTOP, 2, t0 + 2_000);
    const sh = 'sh_' + 'b'.repeat(32);
    await personConsent(sh);
    const a = (await get(PHONE, '/identity/export')).body;
    const b = (await get(LAPTOP, '/identity/export')).body;
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
    await personConsent(sh);
    await browseTabby(PHONE, 1);
    const e = (await get(PHONE, '/identity/export')).body;
    await post(sh, '/identity/absorb', { shopperId: sh, now: t0 + 6_000, affinity: e.affinity, pipeline: e.pipeline });
    await post(PHONE, '/identity/forward', { to: sh });

    vi.setSystemTime(t0 + 7_000);
    // Only the snapshot is handed on. Ingest enforces THIS object's ownership
    // before any effect, so a linked browser cannot forward an unsigned
    // mutation (ShopperReflex.ts:606-617, :2497, :2524-2532).
    const personBefore = structuredClone(ns.object(sh).storage.map.get('affinity'));
    const browserBefore = structuredClone(ns.object(PHONE).storage.map.get('affinity'));
    const r = await post(PHONE, '/ingest', view(PHONE));
    expect(r.status).toBe(401);
    expect(ns.object(sh).storage.map.get('affinity')).toEqual(personBefore);
    expect(ns.object(PHONE).storage.map.get('affinity')).toEqual(browserBefore);
    const snap = await get(PHONE, '/snapshot');
    expect(snap.headers.get('X-Forwarded-Shopper')).toBe(sh);
    // The person carries exactly what was folded in — one view at weight 1 — and
    // the browser's own object did not grow.
    const person = ns.object(sh).storage.map.get('affinity') as AffinityRecord;
    expect(person.reflex.dims.line.Tabby.s).toBe(1);
    const browser = ns.object(PHONE).storage.map.get('affinity') as AffinityRecord;
    expect(browser.reflex.dims.line.Tabby.s).toBeLessThanOrEqual(1);
    // The identity doors themselves are never forwarded.
    expect((await get(PHONE, '/identity/export')).body.forwardTo).toBe(sh);
  });

  it('import: rows at their own time, evaluated now', async () => {
    const sh = 'sh_' + 'd'.repeat(32);
    await personConsent(sh);
    // History lands on a person the object already holds: without a profile the
    // import answers 'profile_missing' and applies nothing (ShopperReflex.ts:2724-2726),
    // and the operation is admitted before it is applied (:687-689, :2643-2650).
    await browseTabby(PHONE, 1);
    const carried = (await get(PHONE, '/identity/export')).body;
    expect((await post(sh, '/identity/absorb', { shopperId: sh, now: t0, affinity: carried.affinity, pipeline: carried.pipeline })).status).toBe(200);
    const seenBefore = (ns.object(sh).storage.map.get('affinity') as AffinityRecord).lastSeen;
    const operation = { shopperId: sh, now: t0, operationId: crypto.randomUUID(), rows: [
      { action: 'purchase', at: t0 - 20_000, touches: [{ dim: 'line', value: 'Rogue' }] },
      { action: 'purchase', at: t0 - 10_000, touches: [{ dim: 'line', value: 'Rogue' }] },
    ] };
    const admitted = await post(sh, '/identity/import/admission', operation);
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(200);
    const r = await post(sh, '/identity/import', operation);
    expect(r.body.applied).toBe(2);
    expect(r.body.audiences).toContain(audienceKey('line', 'Rogue'));
    const person = ns.object(sh).storage.map.get('affinity') as AffinityRecord;
    expect(person.reflex.dims.line.Rogue.t).toBe(t0 - 10_000);
    // The import touches nothing about visits or lastSeen (ShopperReflex.ts:2625-2628).
    expect(person.lastSeen).toBe(seenBefore);
  });

  it('reset clears a forward with everything else', async () => {
    await post(RESETTER, '/identity/forward', { to: 'sh_' + 'e'.repeat(32) });
    await post(RESETTER, '/reset', {});
    expect((await get(RESETTER, '/identity/export')).body.forwardTo).toBeNull();
  });
});

describe('linkVisitor on the object host', () => {
  it('does the whole thing: export, absorb, forward, and answers the person’s audiences', async () => {
    await browseTabby(PHONE);
    vi.setSystemTime(t0 + 12_000);
    const r = await linkVisitor(env, 'coach', { visitorId: PHONE, accountId: 'acct-1001', source: 'login', assurance: 'site' });
    const sh = await shopperIdFor(env, 'coach', 'acct-1001');
    expect(r.shopperId).toBe(sh);
    expect(r.outcome).toBe('linked');
    expect(r.audiences).toContain(TABBY);
    expect(r.sessionId).toBe((ns.object(r.shopperId).storage.map.get('pipeline') as { sessionId: string }).sessionId);
    expect((await get(PHONE, '/identity/export')).body.forwardTo).toBe(sh); // default brand: bare name
    // Linking again from the same browser folds nothing and reports the person.
    const folded = structuredClone(ns.object(sh).storage.map.get('pipeline'));
    const foldedAffinity = structuredClone(ns.object(sh).storage.map.get('affinity'));
    const again = await linkVisitor(env, 'coach', { visitorId: PHONE, accountId: 'acct-1001', source: 'login', assurance: 'site' });
    // The object host answers every idempotent commit with the same durable
    // receipt, whose outcome is pinned to 'linked' (ShopperReflex.ts:222, :2452);
    // "folds nothing" is proved by the person's own counters, not by a word.
    expect(again.shopperId).toBe(sh);
    expect(again.outcome).toBe('linked');
    expect(again.audiences).toContain(TABBY);
    expect(ns.object(sh).storage.map.get('pipeline')).toEqual(folded);
    expect(ns.object(sh).storage.map.get('affinity')).toEqual(foldedAffinity);
  });

  it('names the person’s object under the brand prefix for a non-default brand', async () => {
    const r = await linkVisitor(env, 'kate-spade', { visitorId: KATE, accountId: 'acct-1', source: 'login', assurance: 'site' });
    expect((await get('t:kate-spade:' + KATE, '/identity/export')).body.forwardTo).toBe(`t:kate-spade:${r.shopperId}`);
  });
});

describe('CW29: the snapshot says the stage', () => {
  it('reports the journey stage the object last derived, and null before any event', async () => {
    expect((await get(STAGE, '/snapshot')).body.journeyStage).toBeNull();
    await browseTabby(STAGE, 2);
    const snap = await get(STAGE, '/snapshot');
    expect(['early', 'mid', 'late']).toContain(snap.body.journeyStage);
  });
});
