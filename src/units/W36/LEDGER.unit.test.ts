// src/units/W36/LEDGER.unit.test.ts
//
// W36 — "Session containment on event routes".
//
// AUTHORITY (docs/remediation/delivery-control/program.json, ticket W36, quoting
// document 35 §5 row W36, line 443): "Thread client session through event
// routes, use successful create/update results without stale rereads, make sort
// a real read-only path and reuse catalog work. Test delayed writes and
// fresh/returning SDK flows. Explicitly retain the unresolved KV race and
// profile-authority finding until W35 passes."
//
// WITNESSES
//   · document 35 §2 F14 — "Threading the client session, using a successful
//     write's result, making sort read-only, and memoizing catalog work are
//     useful containment. They do not make KV read-modify-write atomic."
//   · docs/architecture/35-verification-reports/F14.md — the reproductions the
//     containment answers: R5 (a KV that acknowledges a put and shows it later
//     turns a reread into HTTP 500 and a dropped outcome), R6 (with propagation
//     lag the decision and the event name different sessions), R8 (one missed
//     pointer read repoints the shopper at an empty record), R9 (a deferred
//     write lands last and erases state committed after it); §5 "The smallest
//     safe fix", items 1-3 and 5.
//   · HANDOFF-2026-09-18 §6 W36 row — "Client SID threading, successful
//     write-result reuse, read-only sort and catalog reuse already exist. Verify
//     original containment proportionately; preserve unresolved F14 until W35
//     passes." Decision D1: W36 does not close F14.
//
// WHAT "THE CLIENT'S SESSION" IS ON EACH ROUTE (measured at 4fbdddc):
//   · Every /realtime route runs under the shopper's signed capability
//     (requireShopper, src/routes/realtime.ts:38-68); the engine takes the
//     capability's session (src/services/RealtimeSegmentEngine.ts:1142-1144,
//     :1324, :432-434), and the browsing session the SDK keeps (`browsingSessionId`,
//     src/sdk/core.ts:744) names the outcome and the decision record
//     (src/routes/realtime.ts:188-190, src/content/service.ts:466).
//   · The Bright Hour page composition (/live/api/page) has no capability: its
//     client session is the body's `sessionId` (src/routes/live.ts:331), and the
//     engine is called without it (src/routes/live.ts:276-277).
// Passing the idle-rule browsing session as the engine's `clientSessionId` on a
// capability route would be refused by assertSessionTarget
// (src/identity/sessionCapability.ts:199-203); see the report.
//
// The storage is synthetic: a KV that acknowledges a write before it is visible
// (the documented KV behaviour F14 R5 used) and whose commits can be delayed
// (R9). Routes, the engine, both hosts, the shopper object and the SDK are the
// product's own.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';
import { JSDOM } from 'jsdom';

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
const OPERATOR_SECRET = 'w36-ledger-synthetic-operator-signing-material';
const IDENTITY_SECRET = 'w36-ledger-identity-assertion-material';
const ORIGIN = 'https://synthetic.invalid';
const HOSTS = ['session', 'do'] as const;

// ─── the Coach fixture: the kit's taxonomy, and a product the bundled catalog carries ───

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
/** Candidates a commerce platform sends to /sort, with the attributes the registry reads (src/routes/sort.ts:1-16). */
const CANDIDATES = [
  { id: 'COACH-TABBY-26', line: 'Tabby', category: 'Handbags', occasion: 'evening' },
  { id: 'COACH-ROGUE-25', line: 'Rogue', category: 'Handbags', occasion: 'work' },
  { id: 'COACH-CHARTER-CROSSBODY', line: 'Charter', category: 'Crossbody', occasion: 'weekend' },
];
/** A product the bundled Coach catalog carries (src/services/CatalogService.ts), so the event is placed. */
const firstCatalogProduct = (): string => String((new CatalogService().getAllProducts()[0] as { id: string }).id);

// ─── storage ─────────────────────────────────────────────────────────────────

type Op = { op: 'get' | 'put' | 'delete' | 'list'; key: string; seq: number };

/**
 * KV with the two behaviours F14 measured. With `lag` on, a put is ACKNOWLEDGED
 * at once and becomes visible to reads only at `propagate()` (R5, R6, R8).
 * `commitDelays` makes the n-th put commit after that many milliseconds, so a
 * write dispatched first can land last (R9); a caller that awaits its put waits
 * for the commit.
 */
class EventualKV {
  committed = new Map<string, string>();
  private pending = new Map<string, string | null>();
  lag = false;
  commitDelays: number[] = [];
  ops: Op[] = [];
  private seq = 0;
  private puts = 0;
  private inflight: Promise<void>[] = [];
  /** Keys whose next read misses once, as a read that has not seen a committed write does (F14 R8). */
  missing = new Set<string>();
  async get(key: string, type?: string) {
    this.ops.push({ op: 'get', key, seq: ++this.seq });
    if (this.missing.delete(key)) return null;
    const v = this.committed.get(key);
    return v === undefined ? null : type === 'json' ? JSON.parse(v) as unknown : type === 'stream' ? new Response(v).body : v;
  }
  async getWithMetadata(key: string, type?: string) { return { value: await this.get(key, type), metadata: null }; }
  async put(key: string, value: string) {
    this.ops.push({ op: 'put', key, seq: ++this.seq });
    const delay = this.commitDelays[this.puts++] ?? 0;
    const commit = async () => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (this.lag) this.pending.set(key, value); else this.committed.set(key, value);
    };
    const p = commit(); this.inflight.push(p); await p;
  }
  async delete(key: string) {
    this.ops.push({ op: 'delete', key, seq: ++this.seq });
    if (this.lag) this.pending.set(key, null); else this.committed.delete(key);
  }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    this.ops.push({ op: 'list', key: o?.prefix ?? '', seq: ++this.seq });
    const keys = [...this.committed.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
  /** Every acknowledged write becomes visible, in the order it committed. */
  async propagate() {
    await Promise.all(this.inflight.splice(0));
    for (const [key, value] of this.pending) { if (value === null) this.committed.delete(key); else this.committed.set(key, value); }
    this.pending.clear();
  }
  keys(prefix: string): string[] { return [...this.committed.keys()].filter(k => k.startsWith(prefix)).sort(); }
  json<T>(key: string): T | null { const v = this.committed.get(key); return v === undefined ? null : JSON.parse(v) as T; }
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

const fixturePolicy: RetentionPolicy = { id: 'w36-ledger-fixture-policy', revision: 1, durationMs: 365 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
const retention = () => JSON.stringify({ version: 1, tenants: { [TENANT]:
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy> } });

interface Mounted {
  env: Env; storage: UnitR2; cache: EventualKV; sessions: EventualKV; queued: unknown[];
  objects: Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; ops: Op[] }>;
  fetch: (request: Request) => Promise<Response>; drain: () => Promise<void>; operatorToken: string;
}

async function mount(host: 'session' | 'do'): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [], queued: unknown[] = [];
  const storage = new UnitR2(), cache = new EventualKV(), sessions = new EventualKV();
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; ops: Op[] }>();
  let objectSeq = 0;
  const stub = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('{}') }) };
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
    REFLEX_HOST: host, STORAGE: storage,
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:${IDENTITY_SECRET}`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: stub, DECISION_RING: stub, LEARN_STATS: stub, REGION_TREND: stub,
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) }) },
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(structuredClone(body)); } },
    RETENTION: retention(),
  } as unknown as Env;
  env.SHOPPER_REFLEX = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = objects.get(name);
      if (!item) {
        const data = new Map<string, unknown>(), alarms: number[] = [], sockets: WebSocket[] = [], ops: Op[] = [];
        const note = (op: Op['op'], keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) ops.push({ op, key, seq: ++objectSeq }); };
        const state = { id: name, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p), storage: {
          get: async (k: string | string[]) => { note('get', k); return structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)); },
          put: async (k: string | Record<string, unknown>, v?: unknown) => {
            note('put', typeof k === 'string' ? k : Object.keys(k));
            if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
          },
          list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
            structuredClone(new Map([...data].filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
              .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            const candidate = structuredClone(data);
            let deleteAlarm = false, nextAlarm: number | undefined;
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => { note('get', key); return structuredClone(candidate.get(key)); },
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => {
                note('put', typeof values === 'string' ? values : Object.keys(values));
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
        item = { data, ops, shopper: new ShopperReflex(state, env) };
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

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
    .setIssuer('i').setAudience('a').setExpirationTime('2h').sign(new TextEncoder().encode(OPERATOR_SECRET));
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w36-ledger-fixture', note: 'fixture', value } });
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
  return { env, storage, cache, sessions, queued, objects, fetch: fetchOne, drain, operatorToken };
}

/** A consenting anonymous shopper whose client carries her capability and a browsing session. */
async function shopper(m: Mounted, index: number, browsing = `bs-w36-${index}`) {
  const visitor = `vis-00000036-0000-4000-8000-${String(index).padStart(12, '0')}`, sessionId = `s-${visitor.slice(4)}`;
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
  const event = (type: string, data: Record<string, unknown>) => call('POST', '/realtime/action', {
    type, userId: visitor, sessionId, browsingSessionId: browsing, eventId: crypto.randomUUID(), timestamp: Date.now(),
    data, source: 'sdk', entry: { utmMedium: '', utmSource: '', referrer: '', siteHost: 'shop.coach.test' },
  });
  return { visitor, sessionId, browsing, grant, call, event };
}

const outcomes = (queued: unknown[]) => queued.flatMap(body => {
  const m = body as { type?: string; record?: { session_id?: unknown; visitor_id?: string } };
  return m?.type === 'outcome' && m.record ? [m.record] : [];
});
const sessionKeys = (m: Mounted) => m.sessions.keys('session:');
const doData = (m: Mounted, visitor: string) => [...m.objects.entries()].find(([name]) => name.includes(visitor))?.[1].data;

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// =============================================================================
// unit:W36.S1 — every production event route lands the shopper on the session her client carries
// =============================================================================

describe('unit:W36.S1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): under KV propagation lag, a fresh shopper's decision, events and hydrate reads all land on the one session her client carries (F14 R6)`, async () => {
      const m = await mount(host);
      const s = await shopper(m, host === 'session' ? 1 : 2);
      m.sessions.lag = true; // writes are acknowledged now and visible only at propagate()
      const decision = await s.call('POST', `/v1/${TENANT}/decisions/snapshot`, { page: 'home', browsingSessionId: s.browsing });
      expect(decision.status, await decision.clone().text()).toBe(200);
      const answers: Array<[string, Response]> = [];
      for (const type of ['product_view', 'add_to_cart']) answers.push([type, await s.event(type, { product_id: firstCatalogProduct() })]);
      answers.push(['reflex', await s.call('GET', '/realtime/reflex')]);
      answers.push(['personalization', await s.call('GET', `/realtime/personalization/${s.visitor}`)]);
      await m.drain(); await m.sessions.propagate();
      for (const [label, response] of answers) {
        const body = await response.clone().json() as { sessionId?: unknown };
        expect(response.status, `${label}: ${JSON.stringify(body).slice(0, 200)}`).toBe(200);
        if (body.sessionId !== undefined) expect(body.sessionId, `S1 — ${label} names the session her capability carries`).toBe(s.sessionId);
      }
      const events = outcomes(m.queued).filter(o => o.visitor_id === s.visitor);
      expect(events.length, 'fixture: the reward-bearing event reached the ledger as an outcome').toBe(1);
      expect(events.map(o => o.session_id), 'S1/CW39 — the outcome carries the browsing session her client keeps').toEqual([s.browsing]);
      expect(sessionKeys(m).filter(k => k !== `session:${s.sessionId}`), 'S1 (F14 R6/R8) — no second session record was created for her').toEqual([]);
      for (const key of m.sessions.keys('user:')) expect(m.sessions.committed.get(key), `S1 (F14 R8) — ${key} points at her one session`).toBe(s.sessionId);
    });
  }

  it('host (session): the Bright Hour page composition finds her session by the one its client sends, even when the pointer read misses (src/routes/live.ts:277; F14 R8)', async () => {
    const m = await mount('session');
    const s = await shopper(m, 3);
    // She shops the Bright Hour surface on the shared pipeline (src/routes/live.ts:571-588): two cart adds.
    const product = String(((await catalogProductsFor('brighthour'))[0] as unknown as { id: string }).id);
    for (let n = 0; n < 2; n++) {
      const added = await s.call('POST', '/realtime/action', { type: 'add_to_cart', userId: s.visitor, sessionId: s.sessionId, browsingSessionId: s.browsing,
        eventId: crypto.randomUUID(), timestamp: Date.now(), data: { product_id: product }, source: 'brighthour', surface: 'brighthour',
        entry: { utmMedium: '', utmSource: '', referrer: '', siteHost: 'live.brighthour.test' } });
      expect(added.status, `fixture: cart add ${n + 1}`).toBe(200);
    }
    await m.drain(); await m.sessions.propagate();
    const reflex = await s.call('GET', '/realtime/reflex?surface=brighthour');
    const expected = Object.keys(((await reflex.json()) as { affinity?: { dims?: Record<string, unknown> } }).affinity?.dims ?? {}).sort();
    expect(expected.length, 'fixture: her own session holds a Bright Hour interest vector').toBeGreaterThan(0);

    // The page request carries the session her client holds; the pointer read that would find it misses once.
    m.sessions.missing.add(`user:${s.visitor}`);
    const mark = m.sessions.ops.length;
    const page = await m.fetch(new Request(`${ORIGIN}/live/api/page`, { method: 'POST', headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: s.visitor, sessionId: s.sessionId, page: 'home' }) }));
    const body = await page.json() as { sessionId?: unknown; affinitySnapshot?: { dims?: Record<string, unknown> } };
    expect(page.status, JSON.stringify(body).slice(0, 200)).toBe(200);
    await m.drain(); await m.sessions.propagate();
    expect(Object.keys(body.affinitySnapshot?.dims ?? {}).sort(), 'S1 (F14 R8) — the page is composed from the session her client sent, not an empty minted one').toEqual(expected);
    expect(m.sessions.ops.slice(mark).some(o => o.op === 'get' && o.key === `session:${s.sessionId}`), 'S1 — the engine looked her session up by the client\'s id').toBe(true);
    expect(body.sessionId, 'S1 — the page answers on that session').toBe(s.sessionId);
    expect(sessionKeys(m).filter(k => k !== `session:${s.sessionId}`), 'S1 (F14 R8) — no second session was created for her').toEqual([]);
    expect(m.sessions.committed.get(`user:${s.visitor}`), 'S1 (F14 R8) — her pointer still names her session').toBe(s.sessionId);
  });
});

// =============================================================================
// unit:W36.S2 — a successful write's result is used without a reread; a delayed write brings back no stale state
// =============================================================================

describe('unit:W36.S2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with KV that acknowledges a write before showing it, each event answers from its own write, never rereads it, and its outcome is recorded (F14 R5)`, async () => {
      const m = await mount(host);
      const s = await shopper(m, host === 'session' ? 11 : 13);
      m.sessions.lag = true;
      const product = firstCatalogProduct();
      // The records a write of hers lands in: the owner's projection and its KV publication on the
      // session host (src/durable-objects/ShopperReflex.ts:3338-3378), the object's own state on the object host.
      const watched = host === 'session' ? [`sessionProjection:session:${s.sessionId}`, `session:${s.sessionId}`] : ['affinity', 'pipeline'];
      for (const [n, type] of ['add_to_cart', 'wishlist_add', 'add_to_cart'].entries()) {
        const owner = [...m.objects.values()][0]!, ownerMark = owner.ops.length, kvMark = m.sessions.ops.length;
        const response = await s.event(type, { product_id: product });
        const body = await response.clone().json() as { success?: unknown };
        expect(response.status, `S2 (R5) — event ${n + 1} is answered, not refused, while its own write is not yet visible: ${JSON.stringify(body).slice(0, 200)}`).toBe(200);
        expect(body.success, `S2 — event ${n + 1} reports success`).toBe(true);
        const ops = [...owner.ops.slice(ownerMark), ...m.sessions.ops.slice(kvMark)].filter(o => watched.includes(o.key)).sort((a, b) => a.seq - b.seq);
        for (const key of watched) {
          const own = ops.filter(o => o.key === key), firstPut = own.findIndex(o => o.op === 'put');
          expect(firstPut < 0 ? [] : own.slice(firstPut).filter(o => o.op === 'get').map(o => `${o.op} ${o.key}`),
            `S2 — event ${n + 1} never rereads ${key} after writing it; it answers from the write's result`).toEqual([]);
        }
      }
      await m.drain();
      expect(outcomes(m.queued).filter(o => o.visitor_id === s.visitor).length, 'S2 (R5) — no outcome is dropped because a reread missed the write').toBe(3);
    });
  }

  it('host (session): a write dispatched first and committed last does not bring back the state it replaced (F14 R9)', async () => {
    const product = firstCatalogProduct();
    const run = async (delays: number[]) => {
      const m = await mount('session');
      const s = await shopper(m, 12);
      m.sessions.commitDelays = delays;
      const decision = await s.call('POST', `/v1/${TENANT}/decisions/snapshot`, { page: 'home', browsingSessionId: s.browsing });
      expect(decision.status).toBe(200);
      for (const type of ['product_view', 'product_view']) expect((await s.event(type, { product_id: product })).status).toBe(200);
      await m.drain(); await m.sessions.propagate();
      return m.sessions.json<{ metadata: { sessionCount: number }; attributes: { product_views?: number } }>(`session:${s.sessionId}`);
    };
    const ordered = await run([]);
    expect(ordered?.metadata.sessionCount, 'fixture: the ordered run stores her record').toBeGreaterThan(0);
    expect(ordered?.attributes.product_views, 'fixture: the ordered run counts both views').toBe(2);
    // The first write of the flow commits 120 ms after it is dispatched; every later write commits at once.
    const delayed = await run([120]);
    expect(delayed?.metadata.sessionCount, 'S2 (R9) — the late-landing first write does not roll her record back').toBe(ordered!.metadata.sessionCount);
    expect(delayed?.attributes.product_views, 'S2 (R9) — both views survive the late write').toBe(2);
  });
});

// =============================================================================
// unit:W36.S3 — sort reads strictly, creates nothing, writes nothing but a consent restriction
// =============================================================================

describe('unit:W36.S3', () => {
  const sortBody = (visitor: string, consent?: { tracking?: boolean; personalization?: boolean }) =>
    ({ userId: visitor, candidates: CANDIDATES, ...(consent ? { consent } : {}) });
  const shopperState = (m: Mounted, visitor: string) => ({ kv: [...m.sessions.committed].filter(([k]) => /^(session|user):/.test(k)).sort(),
    object: [...(doData(m, visitor) ?? new Map())].map(([k, v]) => [k, JSON.stringify(v)] as [string, string]).sort(([a], [b]) => a.localeCompare(b)) });
  const changedKeys = (before: ReturnType<typeof shopperState>, after: ReturnType<typeof shopperState>) => {
    const diff = (a: Array<[string, string]>, b: Array<[string, string]>) => {
      const am = new Map(a), bm = new Map(b);
      return [...new Set([...am.keys(), ...bm.keys()])].filter(k => am.get(k) !== bm.get(k)).sort();
    };
    return { kv: diff(before.kv, after.kv), object: diff(before.object, after.object) };
  };

  for (const host of HOSTS) {
    it(`host (${host}): a fresh shopper's sort creates no profile, pointer or session, and a returning shopper's sort leaves her record byte-identical`, async () => {
      const m = await mount(host);
      const s = await shopper(m, host === 'session' ? 21 : 22);
      await m.sessions.propagate();
      const fresh = shopperState(m, s.visitor);
      const cold = await s.call('POST', '/sort', sortBody(s.visitor));
      expect(cold.status, await cold.clone().text()).toBe(200);
      await m.drain(); await m.sessions.propagate();
      expect(changedKeys(fresh, shopperState(m, s.visitor)), 'S3 (F14 §5 item 3) — the cold sort created and wrote nothing').toEqual({ kv: [], object: [] });

      expect((await s.event('add_to_cart', { product_id: firstCatalogProduct() })).status, 'fixture: she becomes a returning shopper').toBe(200);
      await m.drain(); await m.sessions.propagate();
      const returning = shopperState(m, s.visitor);
      const warm = await s.call('POST', '/sort', sortBody(s.visitor));
      expect(warm.status, await warm.clone().text()).toBe(200);
      await m.drain(); await m.sessions.propagate();
      expect(changedKeys(returning, shopperState(m, s.visitor)), 'S3 — the returning sort read her state and wrote none of it back (no visit advance)').toEqual({ kv: [], object: [] });
    });

    it(`host (${host}): a sort that carries a refusal writes nothing but the consent restriction`, async () => {
      const m = await mount(host);
      const s = await shopper(m, host === 'session' ? 23 : 24);
      expect((await s.event('add_to_cart', { product_id: firstCatalogProduct() })).status).toBe(200);
      await m.drain(); await m.sessions.propagate();
      const before = shopperState(m, s.visitor);
      const refused = await s.call('POST', '/sort', sortBody(s.visitor, { tracking: false }));
      expect(refused.status, await refused.clone().text()).toBe(200);
      await m.drain(); await m.sessions.propagate();
      const changed = changedKeys(before, shopperState(m, s.visitor));
      expect(changed.kv, 'S3 — no profile or pointer write').toEqual([]);
      expect(changed.object.filter(k => k !== 'consent' && !k.startsWith('recovery') && !k.startsWith('consentAlarm')),
        'S3 — the only object write is the consent restriction').toEqual([]);
      expect(changed.object, 'fixture: the refusal was recorded as the restriction').toContain('consent');
    });
  }

  it('host (session): a record that cannot be read strictly refuses the sort instead of treating her as new', async () => {
    const m = await mount('session');
    const s = await shopper(m, 25);
    expect((await s.event('add_to_cart', { product_id: firstCatalogProduct() })).status).toBe(200);
    await m.drain(); await m.sessions.propagate();
    // Her record as the owner holds it and as KV publishes it, replaced by one no session schema admits.
    const data = doData(m, s.visitor)!, projected = `sessionProjection:session:${s.sessionId}`;
    expect(data.has(projected), 'fixture: the shopper owner holds her session record').toBe(true);
    const corrupt = JSON.stringify({ userId: s.visitor, segments: 'not-a-list', metadata: null });
    data.set(projected, typeof data.get(projected) === 'string' ? corrupt : JSON.parse(corrupt));
    m.sessions.committed.set(`session:${s.sessionId}`, corrupt);
    const before = shopperState(m, s.visitor);
    const refused = await s.call('POST', '/sort', sortBody(s.visitor));
    expect(refused.status >= 400, `S3 (strict read) — an unreadable record is a refusal, not a cold answer (${refused.status}: ${(await refused.clone().text()).slice(0, 120)})`).toBe(true);
    await m.drain(); await m.sessions.propagate();
    expect(changedKeys(before, shopperState(m, s.visitor)), 'S3 — and nothing was written over it').toEqual({ kv: [], object: [] });
  });
});

// =============================================================================
// unit:W36.S4 — catalog work is reused per isolate
// =============================================================================

describe('unit:W36.S4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the item-item catalog graph is built at most once per isolate across events, decisions and sorts`, async () => {
      const m = await mount(host);
      const s = await shopper(m, host === 'session' ? 31 : 32);
      const product = firstCatalogProduct();
      expect((await s.event('product_view', { product_id: product })).status, 'warm-up event').toBe(200);
      await m.drain();
      const build = vi.spyOn(CatalogService.prototype as unknown as { buildAffinityGraph: () => unknown }, 'buildAffinityGraph');
      for (let n = 0; n < 3; n++) {
        expect((await s.event('product_view', { product_id: product })).status).toBe(200);
        expect((await s.call('POST', `/v1/${TENANT}/decisions/snapshot`, { page: 'home', browsingSessionId: s.browsing })).status).toBe(200);
        expect((await s.call('POST', '/sort', { userId: s.visitor, candidates: CANDIDATES })).status).toBe(200);
        await m.drain();
      }
      expect(build.mock.calls.length, 'S4 (F14 §5 item 5) — no request rebuilds the catalog graph').toBe(0);
    });
  }
});

// =============================================================================
// unit:W36.S5 — fresh and returning SDK flows keep one session across event, decision and sort calls
// =============================================================================

describe('unit:W36.S5', () => {
  /**
   * The SDK entry, src/sdk/index.ts, loaded at run time. It is DOM code, typechecked by
   * src/sdk/tsconfig.json; a static import would pull src/sdk/host.ts into the Worker
   * program, which has no DOM library.
   */
  interface SdkClient {
    readonly visitorId: string; readonly sessionId: string; destroy(): void;
    core: { ready(): Promise<boolean>; readonly profileSessionId: string; send(type: string, data?: Record<string, unknown>): Promise<unknown>;
      postJson(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }> };
    listen: { hydrate(opts: { page: string }): Promise<{ page?: string } | null> };
  }
  async function sdkEntry(): Promise<{ createClient(config: Record<string, unknown>): SdkClient }> {
    const entry = '@/sdk/' + 'index';
    return await import(/* @vite-ignore */ entry) as { createClient(config: Record<string, unknown>): SdkClient };
  }
  /** The shipped SDK entry under a real DOM: `createClient` with its default `browserHost()`. */
  async function page(m: Mounted, dom: JSDOM) {
    // The Worker program has no DOM library, so the window is typed by what this page uses of it.
    const win = dom.window as unknown as { document: unknown; location: unknown; localStorage: unknown; CustomEvent: unknown; navigator: { userAgent: string };
      addEventListener: (...args: unknown[]) => void; removeEventListener: (...args: unknown[]) => void; dispatchEvent: (event: unknown) => boolean };
    vi.stubGlobal('document', win.document);
    vi.stubGlobal('location', win.location);
    vi.stubGlobal('localStorage', win.localStorage);
    vi.stubGlobal('addEventListener', win.addEventListener.bind(win));
    vi.stubGlobal('removeEventListener', win.removeEventListener.bind(win));
    vi.stubGlobal('dispatchEvent', win.dispatchEvent.bind(win));
    vi.stubGlobal('CustomEvent', win.CustomEvent);
    // Web Locks, which every browser the SDK supports provides and jsdom does not
    // (browserHost binds it at src/sdk/host.ts:41-43; core refuses without it, src/sdk/core.ts:658).
    vi.stubGlobal('navigator', { userAgent: win.navigator.userAgent, locks: webLocks() });
    const traffic: Array<{ path: string; capability: string | null; body: Record<string, unknown> | null; status: number; answer: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const request = new Request(url, init);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      const response = await m.fetch(request);
      const text = await response.clone().text();
      let answer: unknown = null; try { answer = JSON.parse(text); } catch { answer = text; }
      traffic.push({ path: new URL(url).pathname, capability: request.headers.get(SHOPPER_HEADER), body, status: response.status, answer });
      return response;
    });
    const client = (await sdkEntry()).createClient({ tenant: TENANT, endpoint: ORIGIN, source: 'sdk' });
    return { client, traffic };
  }
  /** Exclusive Web Locks per name: the lock is held until the callback's promise settles. */
  function webLocks() {
    const tails = new Map<string, Promise<unknown>>();
    return { request(name: string, _options: unknown, callback: (lock: { name: string; mode: string }) => Promise<unknown>) {
      const run = (tails.get(name) ?? Promise.resolve()).then(() => callback({ name, mode: 'exclusive' }));
      tails.set(name, run.catch(() => undefined));
      return run;
    } };
  }
  const capabilitySession = (capability: string | null): string | null => {
    if (!capability) return null;
    try { return (JSON.parse(atob(capability.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { sessionId?: string }).sessionId ?? null; } catch { return null; }
  };

  for (const host of HOSTS) {
    it(`sdk (${host}): a fresh and then a returning page keep one session across event, decision and sort calls`, async () => {
      const m = await mount(host);
      const dom = new JSDOM('<main><section data-op-slot="hero"></section></main>', { url: 'https://shop.coach.test/home' });
      const product = firstCatalogProduct();

      // The fresh page.
      const fresh = await page(m, dom);
      expect(await fresh.client.core.ready(), 'fixture: the SDK obtains her session').toBe(true);
      const choice = await fresh.client.core.postJson('/realtime/session/preferences', { trackingConsent: true, personalizationEnabled: true });
      expect(choice.ok, 'fixture: her explicit consent choice is accepted').toBe(true);
      await m.drain();
      const visitor = fresh.client.visitorId, profileSession = fresh.client.core.profileSessionId, browsing = fresh.client.sessionId;
      expect(visitor, 'fixture: a visitor id').toMatch(/^vis-/);
      await fresh.client.core.send('add_to_cart', { product_id: product });
      const decided = await fresh.client.listen.hydrate({ page: 'home' });
      expect(decided?.page, 'fixture: the decision snapshot answered for her page').toBe('home');
      const sorted = await fresh.client.core.postJson('/sort', { userId: visitor, candidates: CANDIDATES });
      expect(sorted.status, 'fixture: the sort answered').toBe(200);
      await m.drain(); await m.sessions.propagate();

      const shopperCalls = fresh.traffic.filter(t => ['/realtime/action', `/v1/${TENANT}/decisions/snapshot`, '/sort'].includes(t.path));
      expect(new Set(shopperCalls.map(t => t.path)), 'fixture: the flow made an event, a decision and a sort call').toEqual(new Set(['/realtime/action', `/v1/${TENANT}/decisions/snapshot`, '/sort']));
      expect(shopperCalls.map(t => capabilitySession(t.capability)), 'S5 — every call of the fresh flow carries her one session')
        .toEqual(shopperCalls.map(() => profileSession));
      for (const t of shopperCalls) expect(t.status, `S5 — ${t.path} is served on that session`).toBe(200);
      const firstOutcomes = outcomes(m.queued).filter(o => o.visitor_id === visitor);
      expect(firstOutcomes.map(o => o.session_id), 'S5 — the event is attributed to the browsing session the SDK keeps').toEqual([browsing]);
      expect(sessionKeys(m).filter(k => k !== `session:${profileSession}`), 'S5 — the fresh flow holds one session record').toEqual([]);

      // The returning page: the same browser, reloaded.
      fresh.client.destroy();
      const back = await page(m, dom);
      expect(await back.client.core.ready(), 'fixture: the SDK recovers her session').toBe(true);
      expect(back.client.visitorId, 'S5 — the returning page is the same visitor').toBe(visitor);
      expect(back.client.core.profileSessionId, 'S5 — on the same session').toBe(profileSession);
      await back.client.core.send('add_to_cart', { product_id: product });
      const decidedAgain = await back.client.listen.hydrate({ page: 'home' });
      expect(decidedAgain?.page, 'fixture: the decision snapshot answered for her returning page').toBe('home');
      const again = await back.client.core.postJson('/sort', { userId: visitor, candidates: CANDIDATES });
      expect(again.status).toBe(200);
      await m.drain(); await m.sessions.propagate();
      const returningCalls = back.traffic.filter(t => ['/realtime/action', `/v1/${TENANT}/decisions/snapshot`, '/sort'].includes(t.path));
      expect(new Set(returningCalls.map(t => t.path)), 'fixture: the returning flow made an event, a decision and a sort call').toEqual(new Set(['/realtime/action', `/v1/${TENANT}/decisions/snapshot`, '/sort']));
      expect(returningCalls.map(t => capabilitySession(t.capability)), 'S5 — every call of the returning flow carries the same session')
        .toEqual(returningCalls.map(() => profileSession));
      for (const t of returningCalls) expect(t.status, `S5 — ${t.path} is served on that session on the returning page`).toBe(200);
      expect(sessionKeys(m).filter(k => k !== `session:${profileSession}`), 'S5 — the returning flow created no second session record').toEqual([]);
      expect(outcomes(m.queued).filter(o => o.visitor_id === visitor).length, 'S5 — both pages\' events reached her one ledger identity').toBe(2);
      back.client.destroy();
      (dom.window as unknown as { close(): void }).close();
    });
  }
});
