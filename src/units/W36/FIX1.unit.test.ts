// src/units/W36/FIX1.unit.test.ts
//
// W36 fix 1 — S1: the Bright Hour page never composes one visitor's page from
// another visitor's stored state, even when the read that would tell them apart
// fails once.
//
// CRITERION (docs/remediation/delivery-control/program.json, ticket W36, S1):
// "Every production event route acts on the session its signed capability
// carries, and a page that falls back when the pointer read misses uses the
// session its client sent (the Bright Hour page, src/routes/live.ts around line
// 277, is the gap)." The session its client sent is used because it is HERS; the
// id of someone else's session is never a way into that someone's state.
//
// WITNESS: the W36 delivery review at e2030e7
// (_evidence/W36-delivery/reviewer/REPORT.md, probe PROBE.unit.test.ts, logs
// probe-head.log / probe-base.log). Visitor A's page request carries visitor B's
// session id; when the first, owner-bound read of B's id throws or misses once,
// A's page is composed from B's stored interest vector: 4 of 4 cases at e2030e7,
// 0 of 4 at its base 3c68192. B's record was never written.
//   · a throw is swallowed to "absent" (src/services/SessionManager.ts:390-394);
//   · the claimed id survives, since only `foreign` clears it
//     (src/services/RealtimeSegmentEngine.ts:1223-1226);
//   · it names the session created for A (:1252, :1257), which reads B's record
//     again WITHOUT the owner check (SessionManager.ts:259);
//   · and the branch that refuses tracking returns that record (:349).
//
// WHAT IS MEASURED (on the served page and the stores, never on internals):
//   1. A's page serves exactly the interests A's page serves when her client sends
//      no session id at all, under the same pointer condition — B's id changes
//      nothing she is shown. A read that throws may instead be refused; a refusal
//      carries no page.
//   2. B's record is not written: no put or delete on `session:<B>`, its bytes
//      unchanged, B's owner object untouched.
//   3. No session is named with B's id on A's behalf: the only pointer that names
//      B's session is B's own. (The page's own `sessionId` field echoes the id the
//      client sent, src/routes/live.ts:405; the review ruled that echo no W36
//      defect — it serves no stored state — so it is not asserted here.)
// The positive case — her own id is used when her pointer misses — is the gated
// test src/units/W36/LEDGER.unit.test.ts:350 and must stay green beside these.
// unit:W36.S1.07 pins the guard's remaining boundary: B's id readable.
//
// The storage is the ticket's synthetic model (LEDGER.unit.test.ts:106-157): a KV
// whose next read of a named key misses once (F14 R8) or throws once (a KV GET
// failure). Routes, the engine, the session manager and the shopper object are
// the product's own, mounted as the gated S1 tests mount them.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, SlotCatalog } from '@/content/types';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { BRIGHTHOUR_REFLEX_CONFIG } from '@/demos/brighthour/reflexConfig';
import { decisionRoutes } from '@/routes/decisions';
import { identityRoutes } from '@/routes/identity';
import realtimeRoutes from '@/routes/realtime';
import { contentRoutes } from '@/routes/content';
import { configRoutes } from '@/routes/config';
import { sortRoutes } from '@/routes/sort';
import { liveRoutes } from '@/routes/live';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { issueSessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { CatalogService } from '@/services/CatalogService';
import { catalogProductsFor } from '@/demos/registry';
import type { RetentionCategory, RetentionPolicy } from '@/retention';
import type { Env } from '@/types/env';

const TENANT = 'coach';
const OPERATOR_SECRET = 'w36-fix1-synthetic-operator-signing-material';
const IDENTITY_SECRET = 'w36-fix1-identity-assertion-material';
const ORIGIN = 'https://synthetic.invalid';

// ─── the Coach fixture, as the gated W36 tests publish it ───

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...over,
});
const PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening-edit', { tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] } }),
  piece('cnt-rogue-work-edit', { tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] } }),
];
const SLOTS: SlotCatalog = { version: 'w36-slots', pages: { home: [{ slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } }] } };
const LEARN = { holdout: { share: 0, salt: 'w36', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: { hero: { reward: 'click' } } };
/** A product the bundled Coach catalog carries (src/services/CatalogService.ts), so the event is placed. */
const firstCatalogProduct = (): string => String((new CatalogService().getAllProducts()[0] as { id: string }).id);

// ─── storage ─────────────────────────────────────────────────────────────────

type Op = { op: 'get' | 'put' | 'delete' | 'list'; key: string; seq: number };
type ReadFailure = 'miss' | 'throw';

/**
 * The gated tests' synthetic KV (LEDGER.unit.test.ts:113-157) with one addition:
 * `failNext` makes the NEXT read of a key fail once — 'miss' reads as absent, as
 * a read that has not seen a committed write does (F14 R8; the `missing` set of
 * the gated tests), and 'throw' rejects, as a KV GET that fails does.
 */
class EventualKV {
  committed = new Map<string, string>();
  ops: Op[] = [];
  failNext = new Map<string, ReadFailure>();
  private seq = 0;
  async get(key: string, type?: string) {
    this.ops.push({ op: 'get', key, seq: ++this.seq });
    const failure = this.failNext.get(key);
    if (failure) {
      this.failNext.delete(key);
      if (failure === 'throw') throw new Error('KV GET failed: 503 (synthetic)');
      return null;
    }
    const v = this.committed.get(key);
    return v === undefined ? null : type === 'json' ? JSON.parse(v) as unknown : type === 'stream' ? new Response(v).body : v;
  }
  async getWithMetadata(key: string, type?: string) { return { value: await this.get(key, type), metadata: null }; }
  async put(key: string, value: string) { this.ops.push({ op: 'put', key, seq: ++this.seq }); this.committed.set(key, value); }
  async delete(key: string) { this.ops.push({ op: 'delete', key, seq: ++this.seq }); this.committed.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    this.ops.push({ op: 'list', key: o?.prefix ?? '', seq: ++this.seq });
    const keys = [...this.committed.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}
class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string, options?: R2GetOptions) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    const bytes = new TextEncoder().encode(raw), range = options?.range;
    const selected = range && 'length' in range ? bytes.slice(0, range.length ?? bytes.length) : bytes;
    return { key, etag: 'v' + this.versions.get(key), size: bytes.length, customMetadata: this.metadata.get(key),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(selected); c.close(); } }),
      text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if ((absent && old !== null) || (match != null && match !== old && match !== JSON.stringify(old))) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number; startAfter?: string } = {}) {
    const all = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '') && (options.startAfter === undefined || k > options.startAfter)).sort();
    const start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: all.slice(start, end).map(key => ({ key, size: (this.objects.get(key) ?? '').length, uploaded: new Date(0) })),
      truncated: end < all.length, ...(end < all.length ? { cursor: String(end) } : {}) };
  }
}

const fixturePolicy: RetentionPolicy = { id: 'w36-fix1-fixture-policy', revision: 1, durationMs: 365 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
const retention = () => JSON.stringify({ version: 1, tenants: { [TENANT]:
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy> } });

interface Mounted {
  env: Env; sessions: EventualKV;
  objects: Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>;
  fetch: (request: Request) => Promise<Response>; drain: () => Promise<void>;
}

/** The session host, mounted as the gated S1 tests mount it (LEDGER.unit.test.ts:198-288). */
async function mount(): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const storage = new UnitR2(), cache = new EventualKV(), sessions = new EventualKV();
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>();
  const stub = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('{}') }) };
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
    REFLEX_HOST: 'session', STORAGE: storage,
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:${IDENTITY_SECRET}`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: stub, DECISION_RING: stub, LEARN_STATS: stub, REGION_TREND: stub,
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) }) },
    EVENT_QUEUE: { send: async () => undefined },
    RETENTION: retention(),
  } as unknown as Env;
  env.SHOPPER_REFLEX = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = objects.get(name);
      if (!item) {
        const data = new Map<string, unknown>(), alarms: number[] = [], sockets: WebSocket[] = [];
        const state = { id: name, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p), storage: {
          get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
          put: async (k: string | Record<string, unknown>, v?: unknown) => {
            if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
          },
          list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
            structuredClone(new Map([...data].filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
              .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            const candidate = structuredClone(data);
            let deleteAlarm = false, nextAlarm: number | undefined;
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => {
                if (typeof values === 'string') candidate.set(values, structuredClone(value));
                else for (const [key, v] of Object.entries(values)) candidate.set(key, structuredClone(v));
              },
              deleteAlarm: async () => { deleteAlarm = true; }, setAlarm: async (at: number) => { nextAlarm = at; },
            } as unknown as DurableObjectTransaction;
            const result = await run(tx);
            data.clear(); for (const [key, value] of candidate) data.set(key, value);
            if (deleteAlarm) alarms.length = 0;
            if (nextAlarm !== undefined) alarms.push(nextAlarm);
            return result;
          },
          deleteAll: async () => data.clear(), delete: async (k: string | string[]) => { for (const key of Array.isArray(k) ? k : [k]) data.delete(key); return true; },
          setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null, deleteAlarm: async () => { alarms.length = 0; },
        } } as unknown as DurableObjectState;
        item = { data, shopper: new ShopperReflex(state, env) };
        objects.set(name, item);
      }
      return item.shopper.fetch(new Request(input, init));
    } }),
  } as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/config', configRoutes);
  app.route('/content', contentRoutes);
  app.route('/sort', sortRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  app.route('/v1', identityRoutes);
  app.route('/live/api', liveRoutes);

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w36-fix1-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, { version: 'w36-catalogue', pieces: PIECES }),
    baseline(SLOTS_KIND, SLOTS),
    baseline(LEARN_KIND, LEARN),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
    // The Bright Hour surface's own tuning, a member of the coach publication (src/config/publication.ts:65-69).
    baseline(REFLEX_KIND, BRIGHTHOUR_REFLEX_CONFIG, reflexScopeForTenant(TENANT, 'brighthour')),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env, {
    waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {},
  } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, sessions, objects, fetch: fetchOne, drain };
}

const visitorOf = (index: number) => `vis-00000036-0000-4000-8000-${String(index).padStart(12, '0')}`;

/** A consenting anonymous shopper whose client carries her capability (LEDGER.unit.test.ts:291-309). */
async function shopper(m: Mounted, index: number) {
  const visitor = visitorOf(index), sessionId = `s-${visitor.slice(4)}`, browsing = `bs-w36-fix1-${index}`;
  const grant = await issueSessionCapability(m.env, { tenant: TENANT, subject: visitor, sessionId, kind: 'anonymous' });
  const call = (method: string, path: string, body?: unknown) => m.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const consent = await call('POST', `/realtime/session/${sessionId}/preferences`, {
    trackingConsent: true, personalizationEnabled: true,
    choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp },
  });
  expect(consent.status, `fixture: her explicit consent choice is accepted: ${await consent.clone().text()}`).toBe(200);
  await m.drain();
  const action = (type: string, data: Record<string, unknown>, surface?: 'brighthour') => call('POST', '/realtime/action', {
    type, userId: visitor, sessionId, browsingSessionId: browsing, eventId: crypto.randomUUID(), timestamp: Date.now(), data,
    ...(surface ? { source: surface, surface, entry: { utmMedium: '', utmSource: '', referrer: '', siteHost: 'live.brighthour.test' } }
      : { source: 'sdk', entry: { utmMedium: '', utmSource: '', referrer: '', siteHost: 'shop.coach.test' } }),
  });
  return { visitor, sessionId, action };
}

type PageBody = { ok?: unknown; error?: unknown; sessionId?: unknown; sessionMission?: unknown;
  affinitySnapshot?: { dims?: Record<string, unknown>; memberships?: unknown } };

/** POST /live/api/page as the Bright Hour client sends it: no capability, no cookie, the visitor id and optionally a session id. */
async function page(m: Mounted, visitorId: string, sessionId?: string): Promise<{ status: number; body: PageBody }> {
  const res = await m.fetch(new Request(`${ORIGIN}/live/api/page`, { method: 'POST', headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorId, ...(sessionId === undefined ? {} : { sessionId }), page: 'home' }) }));
  const body = await res.json() as PageBody;
  await m.drain();
  return { status: res.status, body };
}

/** What the served page is composed from the visitor's stored state: her interest vector, its memberships and the layout it selects. */
const served = (body: PageBody) => ({ affinitySnapshot: body.affinitySnapshot, sessionMission: body.sessionMission });
const sessionStore = (m: Mounted) => new Map([...m.sessions.committed].filter(([k]) => /^(session|user):/.test(k)));
const objectState = (m: Mounted, visitor: string) =>
  [...([...m.objects.entries()].find(([name]) => name.includes(visitor))?.[1].data ?? new Map<string, unknown>())]
    .map(([k, v]) => [k, JSON.stringify(v)] as [string, string]).sort(([a], [b]) => a.localeCompare(b));

type Visitor = 'fresh' | 'consented, pointer misses';

/**
 * B: a consenting shopper with a Bright Hour interest vector (two cart adds on the
 * shared pipeline, src/routes/live.ts:571-588). A: a visitor the platform has never
 * seen, or a consenting returning shopper whose `user:` pointer read misses. A's
 * page request carries B's session id, and the first read of B's id fails as told
 * ('none' leaves it readable: the guard's own boundary, unit:W36.S1.07).
 */
async function crossVisitorPage(visitor: Visitor, failure: ReadFailure | 'none', index: number) {
  const m = await mount();
  const b = await shopper(m, index);
  const product = String(((await catalogProductsFor('brighthour'))[0] as unknown as { id: string }).id);
  for (let n = 0; n < 2; n++) expect((await b.action('add_to_cart', { product_id: product }, 'brighthour')).status, `fixture: B's cart add ${n + 1}`).toBe(200);
  await m.drain();
  const own = await page(m, b.visitor, b.sessionId);
  expect(own.status, `fixture: B's own page: ${JSON.stringify(own.body).slice(0, 200)}`).toBe(200);
  expect(Object.keys(own.body.affinitySnapshot?.dims ?? {}).length, 'fixture: B\'s own page is composed from her stored Bright Hour interest vector').toBeGreaterThan(0);

  let a: { visitor: string; sessionId?: string };
  if (visitor === 'fresh') a = { visitor: visitorOf(index + 1) };
  else {
    const s = await shopper(m, index + 1);
    expect((await s.action('product_view', { product_id: firstCatalogProduct() })).status, 'fixture: A is a returning shopper').toBe(200);
    await m.drain();
    expect(m.sessions.committed.get(`user:${s.visitor}`), 'fixture: A\'s pointer names her own session').toBe(s.sessionId);
    a = s;
  }
  const pointerMisses = () => { if (visitor !== 'fresh') m.sessions.failNext.set(`user:${a.visitor}`, 'miss'); };

  // What A is served when her client sends no session id, under the same pointer condition.
  pointerMisses();
  const control = await page(m, a.visitor);
  expect(control.status, `fixture: A's page without a session id: ${JSON.stringify(control.body).slice(0, 200)}`).toBe(200);

  // A's page carries B's id.
  const before = sessionStore(m), bObject = objectState(m, b.visitor), mark = m.sessions.ops.length;
  expect(typeof before.get(`session:${b.sessionId}`), 'fixture: B\'s record is stored under her session id').toBe('string');
  expect(before.get(`user:${b.visitor}`), 'fixture: B\'s pointer names her session').toBe(b.sessionId);
  pointerMisses();
  if (failure !== 'none') m.sessions.failNext.set(`session:${b.sessionId}`, failure);
  const crossed = await page(m, a.visitor, b.sessionId);
  m.sessions.failNext.clear();
  const after = sessionStore(m);
  const readsOfB = m.sessions.ops.slice(mark).filter(o => o.op === 'get' && o.key === `session:${b.sessionId}`).length;
  const note = `(A ${visitor}; first read of B's id: ${failure}; reads of B's id: ${readsOfB})`;

  // 1. The page.
  if (failure !== 'throw' || crossed.status === 200) {
    expect(crossed.status, `S1 — A's page is answered ${note}: ${JSON.stringify(crossed.body).slice(0, 200)}`).toBe(200);
    expect(served(crossed.body), `S1 — A's page is not composed from B's stored state: B's session id changes nothing A is served ${note}`)
      .toEqual(served(control.body));
  } else {
    // A read that failed may be refused; the refusal carries no page.
    expect(Object.keys(crossed.body).sort(), `S1 — a refusal carries no composed page ${note}`).toEqual(['error', 'ok']);
    expect(crossed.body.ok, `S1 — the refusal says so ${note}`).toBe(false);
  }
  // 2. B's record.
  expect(m.sessions.ops.slice(mark).filter(o => o.key === `session:${b.sessionId}` && o.op !== 'get' && o.op !== 'list').map(o => o.op),
    `S1 — nothing is written over B's record ${note}`).toEqual([]);
  expect(after.get(`session:${b.sessionId}`), `S1 — B's record is byte-identical ${note}`).toBe(before.get(`session:${b.sessionId}`));
  expect(objectState(m, b.visitor), `S1 — B's owner object is untouched ${note}`).toEqual(bObject);
  // 3. No session named with B's id on A's behalf.
  expect([...after].filter(([k, v]) => k.startsWith('user:') && v === b.sessionId).map(([k]) => k),
    `S1 — the only pointer naming B's session is B's own ${note}`).toEqual([`user:${b.visitor}`]);
  if (a.sessionId) expect(after.get(`user:${a.visitor}`), `S1 — A's pointer still names her own session ${note}`).toBe(a.sessionId);
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// =============================================================================
// unit:W36.S1.03 – S1.06 — the review's four cases: another visitor's session id,
// whose first owner-bound read throws or misses once, never composes the page.
// =============================================================================

describe('unit:W36.S1.03', () => {
  it('host (session): a fresh visitor whose page carries another shopper\'s session id is not served that shopper\'s interests when the first read of that id throws, and nothing is written or named with it', async () => {
    await crossVisitorPage('fresh', 'throw', 41);
  });
});

describe('unit:W36.S1.04', () => {
  it('host (session): a fresh visitor whose page carries another shopper\'s session id is not served that shopper\'s interests when the first read of that id misses once, and nothing is written or named with it', async () => {
    await crossVisitorPage('fresh', 'miss', 43);
  });
});

describe('unit:W36.S1.05', () => {
  it('host (session): a consenting returning shopper whose pointer read misses and whose page carries another shopper\'s session id is not served that shopper\'s interests when the first read of that id throws, and nothing is written or named with it', async () => {
    await crossVisitorPage('consented, pointer misses', 'throw', 45);
  });
});

describe('unit:W36.S1.06', () => {
  it('host (session): a consenting returning shopper whose pointer read misses and whose page carries another shopper\'s session id is not served that shopper\'s interests when the first read of that id misses once, and nothing is written or named with it', async () => {
    await crossVisitorPage('consented, pointer misses', 'miss', 47);
  });
});

// =============================================================================
// unit:W36.S1.07 — the guard's remaining boundary: B's id readable. The exception
// (her own id is used) must not reach a record whose owner is someone else.
// =============================================================================

describe('unit:W36.S1.07', () => {
  it('host (session): a fresh visitor whose page carries another shopper\'s readable session id is not served that shopper\'s interests', async () => {
    await crossVisitorPage('fresh', 'none', 49);
  });
  it('host (session): a consenting returning shopper whose pointer read misses and whose page carries another shopper\'s readable session id is not served that shopper\'s interests', async () => {
    await crossVisitorPage('consented, pointer misses', 'none', 51);
  });
});
