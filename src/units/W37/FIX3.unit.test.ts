// src/units/W37/FIX3.unit.test.ts
// W37 fix round 3 — the export's continuation at scale. The re-review of
// f9ab778 (_evidence/W37-delivery/fix2/reviewer/REPORT.md, probes Q1/Q4) failed
// T5: the export carries the browsers it finds in the client's cursor, and
//   1. it refuses its own continuation: the encoder issues up to 16,384
//      characters but the decoder takes at most 400 browsers (401 unlisted
//      short ids: 200, 200, then 400 "cursor not recognised");
//   2. a person with more unlisted browsers than the cursor holds gets no
//      export at all (503 "Operation outcome unavailable", nothing of her
//      returned): about 60 browsers at the 200-character ids validVisitorId
//      allows (src/identity/link.ts:57), about 280 in the SDK's vis-<uuid>
//      format (src/sdk/identity.ts:35) — while the erasure, whose discovery
//      stays server-side, reaches every one.
// The gated FIX2 tests (FIX2.unit.test.ts, one unlisted browser) are too small
// to see either. One `describe('unit:W37.T5.<nn>')` per requirement, one `it`
// per host and scale.
//
// AUTHORITY: document 35 §5 row W37 (:444); the frozen work order, criterion
// T5 — "Per-shopper export and erasure work for shoppers of two non-default
// brands and reach every store that holds that tenant's shopper data (decision
// D2)." LEAD RULINGS (2026-09-30, _evidence/step3/AMENDMENTS.md, the last two
// W37 entries): the export must reach the browsers the erasure reaches; the
// export must follow its own continuations to completion for any number of
// unlisted browsers.
//
// ONE REPRESENTATION with FIX2.unit.test.ts and LEDGER.unit.test.ts: the same
// fixture stamp (acme and globex registered, no default tenant), the kit's
// Coach taxonomy with an unknown category and a cross-category occasion list,
// her first browser's journey and her sign-in through the public link route,
// fifty later browsers so her person record (at most 50) no longer lists the
// first, another acme person, her first browser at globex; the same ruled
// export data per id ("as stored", or as the documented operator read answers
// it) and the same carry rule (a datum is exported when the answer carries it
// at any depth and under any name). Paging is the export's own: `complete:false`
// with `next`, continued with `cursor: next`, until `complete: true`. Nothing
// here reads a cursor's contents or the export's internals; every assertion is
// on HTTP answers and the exported data.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import type { Env } from '@/types/env';
import { tenantMiddleware } from '@/tenancy/middleware';
import { sdkKey, operatorWrites } from '@/middleware/edgeAccess';
import { errorHandler } from '@/middleware/error';
import realtimeRoutes from '@/routes/realtime';
import { identityRoutes } from '@/routes/identity';
import { decisionRoutes } from '@/routes/decisions';
import { sortRoutes } from '@/routes/sort';
import { authRoutes } from '@/routes/auth';
import { operatorRoutes } from '@/routes/operator';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { RegionTrend } from '@/durable-objects/RegionTrend';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { newAnonymousSession, issueSessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { storedConsent } from '@/content/consent';
import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { invalidateTrendCache } from '@/reflex/regionTrend';
import { shopperObjectName } from '@/tenancy/objects';
import type { RetentionPolicy } from '@/retention';
import { signAssertion } from '@/identity/assertion';
import { isShopperId } from '@/identity/shopperId';

// ===========================================================================
// The fixture stamp (as FIX2.unit.test.ts:84-108).
// ===========================================================================

const ACME = 'acme', GLOBEX = 'globex';
const DAY = 86_400_000, HOUR = 3_600_000;
const SECRET = 'w37-fix3-synthetic-signing-material-only';
const policy = (durationMs = 365 * DAY): RetentionPolicy => ({ id: 'w37-fix3-fixture-policy', revision: 1, durationMs, basis: 'admitted', renewal: 'new-record-only' });
const categories = () => ({ profile: policy(), identity: policy(), ledger: policy(), online: policy(), hourly: policy() });
const registry = (tenants: string[]) => JSON.stringify({ provisioned: tenants });

/** The kit's Coach taxonomy (docs/kit/03-payload-schemas.md:19), with an unknown and a cross-category value. */
const TABBY_VIEW = { productId: 'W37-TABBY-26', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags', silhouette: 'shoulder', occasion: ['evening', 'work'], price_usd: 395 };
const UNKNOWN_VIEW = { productId: 'W37-UNFILED', line: 'Unfiled', category: 'Unknown Category', occasion: ['evening', 'travel', 'gift'], price_usd: 12 };

/** The tenant's published configuration: publication is the only configuration authority (src/config/publication.ts:19). */
function publicationFor(tenant: string, learn: unknown): PublicationBaseline[] {
  const revision = (value: unknown) => ({ revision: 1, at: 1, actor: 'w37-fix3-fixture', note: '', value });
  return [
    { kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant), revision: revision({ ...DEFAULT_REFLEX_CONFIG, version: `w37-${tenant}`, eventAttributes: 'event-when-unknown' as const }) },
    { kind: CONTENT_KIND, scope: tenant, revision: revision({ pieces: [
      { id: 'tabby-evening', customerContentId: 'CMS-TABBY-EVENING', type: 'editorial', title: 'Tabby, after six', tags: { line: ['Tabby'], occasion: ['evening'] }, slotTypes: ['hero'] },
      { id: 'rogue-work', customerContentId: 'CMS-ROGUE-WORK', type: 'video', title: 'The Rogue, at work', tags: { line: ['Rogue'], occasion: ['work'] }, slotTypes: ['hero'] },
    ] }) },
    { kind: SLOTS_KIND, scope: tenant, revision: revision({ pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1, occasion: 0.5 } }] } }) },
    { kind: LEARN_KIND, scope: tenant, revision: revision(learn) },
  ];
}

// ===========================================================================
// The in-process host: the mounted routes behind the ingress chain of
// src/index.ts, over KV/R2/queue doubles, and the REAL Durable Object classes
// addressed by name — FIX2.unit.test.ts:294-421 (the harness of
// LEDGER.unit.test.ts, itself the shape of src/routes/realtime.sdkContract.test.ts).
// ===========================================================================

class MemoryKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) : type === 'stream' ? new Response(v).body : v; }
  async put(key: string, value: string) { this.data.set(key, String(value)); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}
class MemoryR2 {
  data = new Map<string, string>(); versions = new Map<string, number>(); metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.data.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length, customMetadata: this.metadata.get(key),
      body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.data.has(key) ? { key, etag: 'v' + this.versions.get(key), size: this.data.get(key)!.length } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const text = typeof raw === 'string' ? raw : await new Response(raw as BodyInit).text();
    const old = this.data.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : (condition as R2Conditional | undefined)?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : (condition as R2Conditional | undefined)?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.data.set(key, text); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(text).length };
  }
  async delete(key: string | string[]) { for (const k of typeof key === 'string' ? [key] : key) this.data.delete(k); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.data.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

interface Item { data: Map<string, unknown>; alarms: number[]; state: DurableObjectState; instance: { fetch(r: Request): Promise<Response>; alarm?(): Promise<void> } }

function objectStorage(item: { data: Map<string, unknown>; alarms: number[] }) {
  const { data, alarms } = item;
  return {
    get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
    put: async (k: string | Record<string, unknown>, v?: unknown) => {
      if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
    },
    delete: async (k: string | string[]) => { const keys = typeof k === 'string' ? [k] : k; let n = 0; for (const key of keys) if (data.delete(key)) n++; return typeof k === 'string' ? n > 0 : n; },
    list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
      structuredClone(new Map([...data].filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
        .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
    transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
      const candidate = structuredClone(data); let deleteAlarm = false, nextAlarm: number | undefined;
      const tx = {
        list: async (options?: { prefix?: string }) => structuredClone(new Map([...candidate].filter(([key]) => key.startsWith(options?.prefix ?? '')))),
        get: async (key: string) => structuredClone(candidate.get(key)),
        delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
        put: async (values: string | Record<string, unknown>, value?: unknown) => {
          if (typeof values === 'string') candidate.set(values, structuredClone(value)); else for (const [key, v] of Object.entries(values)) candidate.set(key, structuredClone(v));
        },
        deleteAlarm: async () => { deleteAlarm = true; }, setAlarm: async (at: number) => { nextAlarm = at; }, getAlarm: async () => alarms.at(-1) ?? null,
      } as unknown as DurableObjectTransaction;
      const result = await run(tx);
      data.clear(); for (const [key, value] of candidate) data.set(key, value);
      if (deleteAlarm) alarms.length = 0;
      if (nextAlarm !== undefined) alarms.push(nextAlarm);
      return result;
    },
    deleteAll: async () => data.clear(),
    setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null, deleteAlarm: async () => { alarms.length = 0; },
  };
}

function host(kind: 'session' | 'do', options: { retention: string; extra?: Record<string, unknown> }) {
  const queued: unknown[] = [], pending: Promise<unknown>[] = [];
  const cache = new MemoryKV(), sessions = new MemoryKV(), storage = new MemoryR2();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', REFLEX_HOST: kind, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
    CACHE: cache, SESSIONS: sessions, STORAGE: storage, JWT_SECRET: SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    TENANTS: registry([ACME, GLOBEX]), RETENTION: options.retention,
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); }, sendBatch: async (bodies: Array<{ body: unknown }>) => { for (const b of bodies) queued.push(b.body); } },
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true, meta: { changes: 1 } }), first: async () => null, all: async () => ({ success: true, results: [] }) }) }) },
    ...options.extra,
  } as unknown as Env;
  const objects = new Map<string, Item>();
  const namespace = (binding: string, make: (state: DurableObjectState) => Item['instance']) => ({
    idFromName: (name: string) => name,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const id = binding + '|' + name;
      let item = objects.get(id);
      if (!item) {
        const data = new Map<string, unknown>(), alarms: number[] = [], sockets: WebSocket[] = [];
        const state = { id: { toString: () => name, name } as unknown as DurableObjectId, storage: objectStorage({ data, alarms }), getWebSockets: () => sockets,
          waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, alarms, state, instance: make(state) };
        objects.set(id, item);
      }
      return item.instance.fetch(new Request(input, init));
    } }),
  });
  env.SHOPPER_REFLEX = namespace('SHOPPER_REFLEX', state => new ShopperReflex(state, env)) as unknown as DurableObjectNamespace;
  env.REGION_TREND = namespace('REGION_TREND', state => new RegionTrend(state, env)) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespace('DECISION_RING', state => new DecisionRing(state, env)) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespace('LEARN_STATS', state => new LearnStats(state, env)) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.use('/realtime/*', sdkKey()); app.use('/v1/:tenant/*', sdkKey()); app.use('/operator/*', operatorWrites());
  app.onError(errorHandler);
  app.route('/auth', authRoutes); app.route('/operator', operatorRoutes); app.route('/sort', sortRoutes);
  app.route('/realtime', realtimeRoutes); app.route('/v1', decisionRoutes); app.route('/v1', identityRoutes);

  const call = async (path: string, opts: { grant?: { capability: string }; body?: unknown; tenant?: string; headers?: Record<string, string>; cf?: unknown } = {}) => {
    const request = new Request(`https://w37.synthetic.invalid${path}`, {
      method: opts.body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(opts.tenant ? { 'X-Tenant': opts.tenant } : {}),
        ...(opts.grant ? { [SHOPPER_HEADER]: opts.grant.capability } : {}), ...opts.headers },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    if (opts.cf) Object.defineProperty(request, 'cf', { value: opts.cf });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
  };
  const drain = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  const item = (binding: string, name: string) => objects.get(binding + '|' + name);
  const restart = (binding: string, name: string) => {
    const it = item(binding, name)!;
    if (binding === 'SHOPPER_REFLEX') it.instance = new ShopperReflex(it.state, env);
    return it;
  };
  return { env, call, drain, cache, sessions, storage, queued, objects, item, restart };
}
type Host = ReturnType<typeof host>;
type Grant = Awaited<ReturnType<typeof newAnonymousSession>>;

/** The SDK's explicit choice (D06-W05): the only consent that grants a purpose (src/content/consent.ts:6-8). */
async function choose(h: Host, grant: Grant, tracking: boolean, personalization: boolean) {
  const current = h.item('SHOPPER_REFLEX', shopperObjectName(grant.tenant, grant.subject))?.data.get('consent');
  const response = await h.call(`/realtime/session/${grant.sessionId}/preferences`, { grant, tenant: grant.tenant, body: {
    trackingConsent: tracking, personalizationEnabled: personalization,
    choice: { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp },
  } });
  expect(response.status, `explicit choice for ${grant.tenant}: ${await response.clone().text()}`).toBe(200);
}

// ===========================================================================
// THE CROWDED WORLD (per host and scale) — FIX2's capped world, scaled up.
//
// At acme, her first browser shops the day before (the kit's Coach taxonomy
// with an unknown category and a cross-category occasion list; a rendered
// decision on the durable basis, its impression and a click; a purchase; a
// manual segment; a product sort), signs in with her account id through the
// public link route, and shops once more as the linked shopper
// (FIX2.unit.test.ts:508-522). Then MANY browsers are linked to her through the
// tenant's `identity:visitor:` links without being listed on her person record:
//
//   · 'sdk'   — 400 more browsers in the SDK's own format (vis-<uuid>,
//               src/sdk/identity.ts:35) sign in to her account through the same
//               public link route with their own signed assertions, before
//               fifty later ones: with her first browser, 401 SDK-format
//               browsers linked to her that her record (the last fifty,
//               src/identity/store.ts `slice(-50)`; ShopperReflex
//               `identityMembers` the same) does not list. The three of them
//               whose ids sort last (the link scan reaches them last) shop
//               before they sign in (an explicit choice and product views), so
//               browsers found late in the scan hold data of their own.
//   · 'long'  — 70 browsers whose ids are 200 characters, the most
//               validVisitorId allows (src/identity/link.ts:57): a site's
//               own device ids, which sort before the SDK-format ids, so the
//               tenant's link scan finds them before it has read the rest.
//   · 'short' — 401 browsers with 5-character ids.
//
// The public link route admits only the SDK's anonymous subject (vis-<uuid>,
// src/identity/sessionCapability.ts:42), so the 'long' and 'short' browsers'
// links are written as the link store writes hers: her first browser's stored
// link with the id changed (and no own-session pointer). They are ids the
// export and the erase routes accept, and the erasure's link scan reaches them
// (src/identity/erase.ts discoverPage; the reviewer's probe Q4 erased all 70
// long ones).
//
// Fifty later browsers then sign in to her account, so her record lists them
// and none of the browsers above.
//
// THE BOUNDARY (FIX2.unit.test.ts:533-543, scaled): another person at acme (his
// browser, a product view, a rendered decision, a sign-in with another
// account) and 200 more SDK-format browsers linked to HIM (his stored link, id
// changed) that interleave with hers in the tenant's link scan; her first
// browser at globex, the second non-default brand, signed in there with the
// same account; and a browser linked to her ACME person id that exists only in
// globex's namespace (the reviewer's probe Q1). None of them is ever hers at
// acme.
// ===========================================================================

type Scale = 'sdk' | 'long' | 'short';
const SCALES: Record<Scale, { label: string; unlisted: number }> = {
  sdk: { label: '401 unlisted SDK-format browsers (vis-<uuid>), signed in through the public link route', unlisted: 401 },
  long: { label: '71 unlisted browsers, 70 of them with 200-character ids', unlisted: 71 },
  short: { label: '402 unlisted browsers, 401 of them with 5-character ids', unlisted: 402 },
};
const SDK_MIDDLE = 400, LONG_IDS = 70, SHORT_IDS = 401, LATER_BROWSERS = 50, HIS_CROWD = 200;
/** The export's own continuations, followed until `complete: true`; a bound on calls, far above any bounded slice's need. */
const EXPORT_CALLS = 1000;
/** Resumes of the documented erasure with the same selector while it answers pending. */
const ERASE_RESUMES = 4000;

/** A site's own device id of 200 characters; they sort before the SDK's vis-<uuid> ids in the tenant's link scan. */
const longId = (n: number) => `ACME.DEVICE.${String(n).padStart(4, '0')}.`.padEnd(200, '0123456789abcdef');
const shortId = (n: number) => `c${String(n).padStart(4, '0')}`;

const T5_RETENTION = JSON.stringify({ version: 1, tenants: Object.fromEntries([ACME, GLOBEX].map(tenant => [tenant, { ...categories(), recovery: policy(), quarantine: policy() }])) });
const T5_LEARN = (tenant: string) => ({ holdout: { share: 0, salt: `w37-${tenant}`, arms: ['default'] }, slots: { hero: { reward: 'click', measurementBasis: 'rendered-v1' } } });
const HER_ACCOUNT = 'w37-person-account-0042', OTHER_ACCOUNT = 'w37-other-person-account-0077';
const T5_STREAMS = ['decision', 'outcome', 'product-sort', 'behavior'] as const;

interface T5Answer { status: number; body: Record<string, any> }
interface T5Entry { store: string; member: string; value: unknown; raw?: string }
type Selector = { visitorId?: string; shopperId?: string };

async function crowdedWorld(kind: 'session' | 'do', scale: Scale) {
  invalidateCache(); invalidateTrendCache();
  const today = Math.floor(Date.now() / DAY) * DAY, served = today - DAY + 12 * HOUR, exportedAt = today + 12 * HOUR;
  vi.setSystemTime(served);
  const h = host(kind, { retention: T5_RETENTION, extra: { LEDGER_RECOVERY_ENABLED: 'true', IDENTITY_SALT: 'w37-fix3-synthetic-identity-salt',
    IDENTITY_SECRETS: `${ACME}:${ACME}-identity-material,${GLOBEX}:${GLOBEX}-identity-material` } });
  for (const tenant of [ACME, GLOBEX]) await initializePublicationSet(h.env, publicationFor(tenant, T5_LEARN(tenant)), '0:' + crypto.randomUUID());
  const cf = { country: 'US', regionCode: 'NY' };
  const act = async (grant: Grant, type: string, data: Record<string, unknown>) => {
    const response = await h.call('/realtime/action', { grant, tenant: grant.tenant, cf, body: { type, userId: grant.subject, sessionId: grant.sessionId, source: 'sdk', timestamp: Date.now(), eventId: crypto.randomUUID(), data } });
    const text = await response.text(); expect(response.status, `${kind} ${grant.tenant} ${type}: ${text}`).toBe(200); // G21 class (R-P108(2)): the body is read once; a read clone collected by GC during the drain cancels the original's body under Node's undici ("Body is unusable")
    await h.drain();
    return JSON.parse(text) as Record<string, unknown>;
  };
  const page = async (grant: Grant, pageInstance: string) => {
    const response = await h.call(`/v1/${grant.tenant}/decisions/snapshot?page=home&pageInstance=${pageInstance}`, { grant, tenant: grant.tenant, cf });
    const piece = (await response.json() as { decisions?: Array<{ contentId: string; decisionId: string; renderOffer?: string }> }).decisions?.[0];
    await h.drain();
    expect(piece?.renderOffer, `${kind} ${grant.tenant}: the rendered basis offers an acknowledgement`).toBeTruthy();
    const ack = await act(grant, 'content_impression', { contentId: piece!.contentId, decisionId: piece!.decisionId, renderOffer: piece!.renderOffer, page: 'home', pageInstance, slot: 'hero', position: 0 });
    expect(ack.render, `${kind} ${grant.tenant}: the render is durably acknowledged`).toMatchObject({ version: 1, decisionId: piece!.decisionId, status: 'durable' });
    await act(grant, 'content_click', { contentId: piece!.contentId, slot: 'hero', decisionId: piece!.decisionId, contentType: 'editorial' });
    return piece!.decisionId;
  };
  /** The public sign-in: POST /v1/{tenant}/identity/link with the browser's grant and the site's signed assertion. */
  const signIn = async (grant: Grant, account: string) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const linked = await h.call(`/v1/${grant.tenant}/identity/link`, { grant, tenant: grant.tenant, body: { visitorId: grant.subject, accountId: account, exp,
      assertion: await signAssertion(`${grant.tenant}-identity-material`, grant.tenant, grant.subject, account, exp) } });
    const body = await linked.json() as { shopperId: string; outcome: string; session: Grant };
    expect(linked.status, `${kind} ${grant.tenant}: the signed link of ${grant.subject}: ${JSON.stringify(body).slice(0, 200)}`).toBe(200);
    await h.drain();
    return body;
  };
  const linkKey = (tenant: string, visitorId: string) => `t:${tenant}:identity:visitor:${visitorId}`;
  /** A link as the link store wrote `template`'s, for another browser id (no own-session pointer). */
  const storeLinkLike = (tenant: string, template: string, visitorId: string) => {
    const { ownSessionId: _own, ...link } = JSON.parse(h.sessions.data.get(linkKey(tenant, template))!) as Record<string, unknown>;
    h.sessions.data.set(linkKey(tenant, visitorId), JSON.stringify({ ...link, visitorId }));
  };

  // Her first browser: her shopping, then her sign-in, then her shopping as the linked person.
  const first = await newAnonymousSession(h.env, ACME);
  await choose(h, first, true, true);
  await act(first, 'product_view', TABBY_VIEW);
  await act(first, 'product_view', UNKNOWN_VIEW);
  const firstDecision = await page(first, 'w37-fix3-first-anonymous');
  await act(first, 'purchase', { orderId: 'W37-FIX3-ACME-ORDER-7731', value: 395, currency: 'USD', items: [{ productId: TABBY_VIEW.productId, quantity: 1, price: 395 }] });
  for (const [path, body] of [[`/realtime/segments/${first.subject}`, { segment: 'w37-manual' }], [`/realtime/personalization/${first.subject}`, undefined],
    ['/sort', { userId: first.subject, sessionId: first.sessionId, candidates: [{ id: 'tabby', line: 'Tabby' }, { id: 'rogue', line: 'Rogue' }, { id: 'unfiled', line: 'Unfiled' }] }]] as Array<[string, unknown]>) {
    const response = await h.call(path, { grant: first, tenant: ACME, body, cf });
    expect(response.status, `${kind} acme ${path}: ${await response.clone().text()}`).toBe(200);
  }
  const her = await signIn(first, HER_ACCOUNT);
  await act(her.session, 'product_view', TABBY_VIEW);
  await page(her.session, 'w37-fix3-signed-in');

  // The scale: many browsers linked to her before the fifty later ones.
  const middle: string[] = [], shoppers: string[] = [];
  if (scale === 'sdk') {
    const grants: Grant[] = [];
    for (let n = 0; n < SDK_MIDDLE; n++) grants.push(await newAnonymousSession(h.env, ACME));
    const last = [...grants].sort((a, b) => (a.subject < b.subject ? -1 : 1)).slice(-3);
    for (const [n, grant] of last.entries()) {
      await choose(h, grant, true, true);
      for (const view of [[TABBY_VIEW], [UNKNOWN_VIEW], [TABBY_VIEW, UNKNOWN_VIEW]][n]!) await act(grant, 'product_view', view);
      shoppers.push(grant.subject);
    }
    for (const grant of grants) {
      const linked = await signIn(grant, HER_ACCOUNT);
      expect(linked.shopperId, `${kind}: an SDK-format browser signs in as her`).toBe(her.shopperId);
      middle.push(grant.subject);
    }
  } else {
    for (let n = 0; n < (scale === 'long' ? LONG_IDS : SHORT_IDS); n++) {
      const id = scale === 'long' ? longId(n) : shortId(n);
      storeLinkLike(ACME, first.subject, id);
      middle.push(id);
    }
  }

  // Fifty later browsers sign in to her account: her record keeps the last fifty.
  const later: string[] = [];
  for (let n = 0; n < LATER_BROWSERS; n++) {
    const browser = await newAnonymousSession(h.env, ACME);
    const linked = await signIn(browser, HER_ACCOUNT);
    expect(linked.shopperId, `${kind}: later browser ${n + 1} signs in as her`).toBe(her.shopperId);
    later.push(browser.subject);
  }

  // Another person at acme, with a crowd of browsers linked to him; her first browser at globex.
  const otherBrowser = await newAnonymousSession(h.env, ACME);
  await choose(h, otherBrowser, true, true);
  await act(otherBrowser, 'product_view', TABBY_VIEW);
  const otherDecision = await page(otherBrowser, 'w37-fix3-other-person');
  const other = await signIn(otherBrowser, OTHER_ACCOUNT);
  const crowd: string[] = [];
  for (let n = 0; n < HIS_CROWD; n++) { const id = `vis-${crypto.randomUUID()}`; storeLinkLike(ACME, otherBrowser.subject, id); crowd.push(id); }
  const atGlobex = await issueSessionCapability(h.env, { tenant: GLOBEX, subject: first.subject, sessionId: first.sessionId, kind: 'anonymous' }) as Grant;
  await choose(h, atGlobex, true, true);
  await act(atGlobex, 'product_view', TABBY_VIEW);
  const globexDecision = await page(atGlobex, 'w37-fix3-globex');
  const globexPerson = await signIn(atGlobex, HER_ACCOUNT);
  // A browser linked to her ACME person id that exists only in globex's namespace.
  const globexOnly = `vis-${crypto.randomUUID()}`;
  const { ownSessionId: _own, ...herLink } = JSON.parse(h.sessions.data.get(linkKey(ACME, first.subject))!) as Record<string, unknown>;
  h.sessions.data.set(linkKey(GLOBEX, globexOnly), JSON.stringify({ ...herLink, visitorId: globexOnly }));
  h.queued.length = 0; // transport copies of what the managed path already stored (as the gated T5 world)

  vi.setSystemTime(exportedAt);
  const date = new Date(served).toISOString().slice(0, 10);
  const operatorToken = () => new SignJWT({ sub: 'w37-operator', type: 'service', roles: ['admin'], permissions: ['*'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
  const operator = async (tenant: string, path: string, body?: unknown): Promise<T5Answer> => {
    const response = await h.call(`/v1/${tenant}${path}`, { tenant, body, headers: { Authorization: `Bearer ${await operatorToken()}` } });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
  };
  const rowId = (row: Record<string, any>) => String(row.decision_id ?? row.outcome_id ?? row.record_id ?? row.behavior_id ?? row.event_id ?? JSON.stringify(row));

  /** The ruled export data of these ids at this tenant, each labelled with the store that holds it (FIX2.unit.test.ts:556-588). */
  const exportTruth = async (tenant: string, ids: string[]): Promise<T5Entry[]> => {
    const entries: T5Entry[] = [], wanted = new Set(ids);
    const add = (store: string, member: string, value: unknown, raw?: string) => { if (value !== undefined && value !== null) entries.push({ store, member, value, ...(raw === undefined ? {} : { raw }) }); };
    for (const id of ids) {
      if (isShopperId(id)) {
        const person = await operator(tenant, `/identity/shopper/${id}`);
        if (person.status === 200) add('SESSIONS', `GET identity/shopper/${id}`, person.body.shopper);
      } else add('SESSIONS', `GET identity/visitor/${id} link`, (await operator(tenant, `/identity/visitor/${id}`)).body.link);
      for (const receipt of (await operator(tenant, `/visitors/${id}/receipts`)).body.receipts ?? []) {
        add('DECISION_RING', `GET visitors/${id}/receipts ${receipt.decision_id}`, receipt);
        const record = await operator(tenant, `/ledger/${encodeURIComponent(receipt.decision_id)}`);
        if (record.status === 200) add('STORAGE', `GET ledger/${receipt.decision_id}`, record.body.record);
      }
      for (const entry of (await operator(tenant, `/visitors/${id}/recent`)).body.ring ?? []) add('DECISION_RING', `GET visitors/${id}/recent ${entry.decision_id}`, entry);
    }
    for (const stream of T5_STREAMS) for (const object of ((await operator(tenant, `/ledger/batches?date=${date}&stream=${stream}`)).body.objects ?? []) as Array<{ key: string }>)
      for (const line of (h.storage.data.get(object.key) ?? '').split('\n').filter(Boolean)) {
        const row = JSON.parse(line) as Record<string, any>;
        if (wanted.has(row.visitor_id)) add('STORAGE', `GET ledger/batches ${stream} ${object.key} ${rowId(row)}`, row);
      }
    for (const id of ids) {
      const name = shopperObjectName(tenant, id), object = h.item('SHOPPER_REFLEX', name);
      for (const key of ['affinity', 'consent', 'pipeline']) add('SHOPPER_REFLEX', `${name} ${key}`, object?.data.get(key));
    }
    for (const [store, data, prefix] of [['SESSIONS', h.sessions.data, `t:${tenant}:session:`], ['CACHE', h.cache.data, `t:${tenant}:profile:`]] as const)
      for (const [key, raw] of data) {
        if (!key.startsWith(prefix)) continue;
        const value = JSON.parse(raw) as { userId?: string };
        if (wanted.has(value?.userId ?? '')) add(store, key, value, raw);
      }
    return entries;
  };
  /** An export followed page by page from `cursor` (none: the first call): `complete:false` with `next` is continued with `cursor: next`. */
  const exportPages = async (tenant: string, selector: Selector, cursor?: string) => {
    const pages: T5Answer[] = [];
    for (let call = 0; call < EXPORT_CALLS; call++) {
      const answer = await operator(tenant, '/identity/export', { ...selector, ...(cursor ? { cursor } : {}) });
      pages.push(answer);
      if (answer.status !== 200 || answer.body.complete !== false || typeof answer.body.next !== 'string') break;
      cursor = answer.body.next;
    }
    return pages;
  };
  /** The tenant's browser links as stored: visitor id → the shopper id the link names. */
  const links = (tenant: string) => new Map([...h.sessions.data].filter(([key]) => key.startsWith(`t:${tenant}:identity:visitor:`))
    .map(([key, raw]) => [key.slice(`t:${tenant}:identity:visitor:`.length), (JSON.parse(raw) as { shopperId?: string }).shopperId]));
  /** Erase her through the documented route, resumed with the same selector while it is pending, with the object alarms it arms (FIX2.unit.test.ts:605-616). */
  const erase = async (selector: Selector) => {
    let answer = await operator(ACME, '/identity/erase', selector), resumes = 0;
    for (; answer.body.status === 'pending' && resumes < ERASE_RESUMES; resumes++) answer = await operator(ACME, '/identity/erase', selector);
    await h.drain();
    for (let round = 0; round < 3; round++) for (const [id, it] of h.objects) {
      if (!id.startsWith(`SHOPPER_REFLEX|${shopperObjectName(ACME, '')}`) || !it.alarms.length) continue;
      it.alarms.length = 0;
      await (h.restart('SHOPPER_REFLEX', id.slice('SHOPPER_REFLEX|'.length)).instance as ShopperReflex).alarm();
      await h.drain();
    }
    return { answer, resumes };
  };
  const unlisted = [first.subject, ...middle];
  return { h, kind, scale, date, operator, exportTruth, exportPages, links, erase,
    her: { shopperId: her.shopperId, first: first.subject, middle, later, shoppers, unlisted, firstDecision, all: [her.shopperId, ...unlisted, ...later] },
    other: { shopperId: other.shopperId, visitorId: otherBrowser.subject, decision: otherDecision, crowd },
    globex: { shopperId: globexPerson.shopperId, decision: globexDecision, only: globexOnly } };
}
type World = Awaited<ReturnType<typeof crowdedWorld>>;

/** A value's canonical JSON: object keys sorted at every depth, array order kept (FIX2.unit.test.ts:624). */
const canonical = (value: unknown) => JSON.stringify(value, (_key, v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v);
/** Every value an answer carries, at any depth and under any name, in canonical form. */
function carried(answer: unknown): Set<string> {
  const seen = new Set<string>();
  const walk = (value: unknown) => { seen.add(canonical(value)); if (value && typeof value === 'object') for (const child of Object.values(value)) walk(child); };
  walk(answer);
  return seen;
}
const carries = (seen: Set<string>, entry: T5Entry) => seen.has(canonical(entry.value)) || (entry.raw !== undefined && seen.has(canonical(entry.raw)));
/** The ruled data an answer omits: each entry of `before` it carries neither as it was before nor as the same member stands after. */
function exportGaps(seen: Set<string>, before: T5Entry[], after: T5Entry[]): string[] {
  const now = new Map(after.map(entry => [`${entry.store} ${entry.member}`, entry]));
  return before.filter(entry => !carries(seen, entry) && !(now.has(`${entry.store} ${entry.member}`) && carries(seen, now.get(`${entry.store} ${entry.member}`)!)))
    .map(entry => `${entry.store} ${entry.member}`);
}
/** The entries of `theirs` an answer carries that are not also equal to an entry of `own`. */
function foreignCarried(seen: Set<string>, theirs: T5Entry[], own: T5Entry[]): string[] {
  const mine = new Set(own.map(entry => canonical(entry.value)));
  return theirs.filter(entry => !mine.has(canonical(entry.value)) && carries(seen, entry)).map(entry => `${entry.store} ${entry.member}`);
}
/** Each unlisted browser's link as the documented read answers it (GET identity/visitor/{id}), from the ruled data. */
const linkRead = (truth: T5Entry[], visitorId: string) => truth.find(entry => entry.member === `GET identity/visitor/${visitorId} link`)?.value;
/** The first answer of a paged export that is not a 200 `ok` page, named for the failure message. */
const firstRefusal = (pages: T5Answer[]) => {
  const at = pages.findIndex(page => page.status !== 200 || page.body.ok !== true);
  return at < 0 ? 'none' : `call ${at + 1} of ${pages.length} answered ${pages[at]!.status} ${JSON.stringify(pages[at]!.body.error ?? pages[at]!.body).slice(0, 120)}`;
};
/** Nothing of the other acme person and nothing of globex's: the boundary FIX2 keeps (FIX2.unit.test.ts:678-684), with his crowd and the globex-only browser. */
function boundary(w: World, label: string, bodies: unknown, own: T5Entry[], otherTruth: T5Entry[], globexTruth: T5Entry[]) {
  const seen = carried(bodies), text = JSON.stringify(bodies);
  expect(foreignCarried(seen, otherTruth, own), `${label}: nothing of another person at acme`).toEqual([]);
  expect([w.other.visitorId, w.other.shopperId, w.other.decision, ...w.other.crowd].filter(id => text.includes(id)), `${label}: no browser or identifier of another person at acme (his ${HIS_CROWD + 1} browsers)`).toEqual([]);
  expect(foreignCarried(seen, globexTruth, own), `${label}: nothing of globex's`).toEqual([]);
  expect([w.globex.shopperId, w.globex.decision, w.globex.only].filter(id => text.includes(id)), `${label}: no identifier of her globex person, and never the browser linked to her only in globex's namespace`).toEqual([]);
  expect(text.includes(HER_ACCOUNT), `${label}: never the account id (kit 02 :350)`).toBe(false);
}
/** The fixture's premise: her record lists the fifty later browsers and none of the unlisted ones; every unlisted browser's link names her. */
async function premise(w: World) {
  const person = await w.operator(ACME, `/identity/shopper/${w.her.shopperId}`);
  expect(person.status, `${w.kind}: her person record`).toBe(200);
  expect(person.body.shopper.visitors.map((v: { visitorId: string }) => v.visitorId).sort(), `${w.kind}: her record lists the fifty later browsers only`).toEqual([...w.her.later].sort());
  const links = w.links(ACME);
  expect(w.her.unlisted.length, `${w.kind}: ${SCALES[w.scale].label}`).toBe(SCALES[w.scale].unlisted);
  expect(w.her.unlisted.filter(id => links.get(id) !== w.her.shopperId), `${w.kind}: every unlisted browser's identity:visitor: link names her (what the erasure's link scan reads)`).toEqual([]);
  expect(w.other.crowd.filter(id => links.get(id) !== w.other.shopperId), `${w.kind}: his crowd is linked to him`).toEqual([]);
}

const HOSTS = ['session', 'do'] as const;
const EXPORT_SCALES: Scale[] = ['sdk', 'long', 'short'];

// ===========================================================================
// unit:W37.T5.03 — her export, followed through its own continuations,
// completes and returns every browser linked to her with its data.
// ===========================================================================

describe('unit:W37.T5.03', () => {
  for (const kind of HOSTS) for (const scale of EXPORT_SCALES) {
    it(`host (${kind}, ${scale}): POST /v1/{tenant}/identity/export for a person with ${SCALES[scale].label} accepts every continuation it issues, reaches complete:true, and returns every one of those browsers with its link and every ruled datum it holds — by her shopper id and by one of those browsers — and never anything of another acme person or of globex`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const w = await crowdedWorld(kind, scale);
        await premise(w);
        const before = await w.exportTruth(ACME, w.her.all);
        if (scale === 'sdk') for (const id of w.her.shoppers) expect(before.some(entry => entry.store === 'SHOPPER_REFLEX' && entry.member.startsWith(`${shopperObjectName(ACME, id)} `)),
          `${kind}: the unlisted browser ${id}, which the link scan reaches last, holds data of its own`).toBe(true);
        const otherTruth = await w.exportTruth(ACME, [w.other.visitorId, w.other.shopperId]);
        const globexTruth = await w.exportTruth(GLOBEX, [w.her.first, w.globex.shopperId]);
        expect(otherTruth.length && globexTruth.length, `${kind}: the other person and the other brand hold data of their own to protect`).toBeGreaterThan(0);

        const lastInScan = [...w.her.unlisted].sort().at(-1)!;
        const runs: Array<{ label: string; pages: T5Answer[] }> = [];
        for (const selector of [{ shopperId: w.her.shopperId }, { visitorId: lastInScan }] as Selector[]) {
          const label = `W37.T5 export at scale — ${kind} ${scale} ${selector.shopperId ? 'shopperId' : 'visitorId (the unlisted browser her tenant\'s link scan reaches last)'}`;
          const pages = await w.exportPages(ACME, selector);
          runs.push({ label, pages });
          expect(pages.map(page => [page.status, page.body.ok]), `${label}: every continuation the export issues is accepted and answered — ${firstRefusal(pages)}`).toEqual(pages.map(() => [200, true]));
          expect(pages.at(-1)!.body.complete, `${label}: following next, the export reaches complete:true within ${EXPORT_CALLS} calls (${pages.length} made)`).toBe(true);
        }
        const after = await w.exportTruth(ACME, w.her.all);
        for (const { label, pages } of runs) {
          const bodies = pages.map(page => page.body), seen = carried(bodies);
          const missing = w.her.unlisted.filter(id => !seen.has(canonical(linkRead(before, id))));
          expect({ exported: w.her.unlisted.length - missing.length, of: w.her.unlisted.length }, `${label}: the export returns every browser linked to her that her record does not list (its link as GET identity/visitor answers it); first missing: ${missing.slice(0, 3).map(id => id.slice(0, 48)).join(', ')}`)
            .toEqual({ exported: w.her.unlisted.length, of: w.her.unlisted.length });
          expect(exportGaps(seen, before, after), `${label}: the export returns every ruled datum of hers — each browser's link and everything it holds, in every store`).toEqual([]);
          boundary(w, label, bodies, before, otherTruth, globexTruth);
        }
      } finally { vi.useRealTimers(); }
    }, 600_000);
  }
});

// ===========================================================================
// unit:W37.T5.04 — parity at scale: every browser the erasure deletes for her
// selector is one her export returned.
// ===========================================================================

describe('unit:W37.T5.04', () => {
  for (const kind of HOSTS) for (const scale of EXPORT_SCALES) {
    it(`host (${kind}, ${scale}): for a person with ${SCALES[scale].label}, every browser the erasure deletes for her selector is one her export returned — the parity of the export's subject and the erasure's at scale, measured on the same stores`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const w = await crowdedWorld(kind, scale), selector = { shopperId: w.her.shopperId };
        await premise(w);
        const linksBefore = w.links(ACME);
        // Each browser's link as the documented read answers it (GET identity/visitor/{id}), before anything is erased.
        const read = new Map<string, unknown>();
        for (const visitorId of linksBefore.keys()) read.set(visitorId, (await w.operator(ACME, `/identity/visitor/${visitorId}`)).body.link);
        const pages = await w.exportPages(ACME, selector);

        const { answer, resumes } = await w.erase(selector);
        expect(answer, `${kind} ${scale}: the documented erasure completes its local steps (${resumes} resumes)`).toMatchObject({ status: 200, body: { ok: true, status: 'local_complete', tenant: ACME, shopperId: w.her.shopperId } });
        const linksAfter = w.links(ACME);
        const deleted = [...linksBefore.keys()].filter(visitorId => !linksAfter.has(visitorId)).sort();
        // CONTROL (the witness, measured): the erasure deletes every browser linked to her, the unlisted ones included, and leaves another person's.
        expect(deleted, `${kind} ${scale}: the erasure deletes all of her browsers`).toEqual([...w.her.unlisted, ...w.her.later].sort());
        expect([w.other.visitorId, ...w.other.crowd].filter(id => linksAfter.get(id) !== w.other.shopperId), `${kind} ${scale}: the erasure leaves another person's browsers`).toEqual([]);

        const seen = carried(pages.map(page => page.body));
        const unreturned = deleted.filter(visitorId => !seen.has(canonical(read.get(visitorId))));
        expect({ unreturned: unreturned.length, deleted: deleted.length }, `W37.T5 parity at scale — ${kind} ${scale}: every browser the erasure deletes for her selector is one her export returned (its link as GET identity/visitor answers it); first unreturned: ${unreturned.slice(0, 3).map(id => id.slice(0, 48)).join(', ')}`)
          .toEqual({ unreturned: 0, deleted: deleted.length });
      } finally { vi.useRealTimers(); }
    }, 600_000);
  }
});

// ===========================================================================
// unit:W37.T5.05 — a forged continuation exports nothing that is not hers.
//
// A continuation is the export's own; a client can still send any cursor. The
// cursor may name another person's browser (the reviewer's probe Q1), or be one
// the export issued for another person, or one issued for her and sent with
// his selector. Whatever the export answers — one of its documented answers
// (kit 02 :499: a page, `404` when nothing of hers is held and nothing is left
// to scan, or the erase route's `400` refusal; never an error) — it answers
// nothing of the person the selector does not name, and never a browser linked
// to her only in globex's namespace.
//
//   · named: a cursor naming his browsers and the globex-only browser, in the
//     encoding f9ab778's export issued (base64url JSON, v2; its link scan
//     unfinished and finished). A build that keeps that encoding must not
//     trust the browsers it names; a build that changes it refuses it.
//   · his:   every continuation the export issues for HIS export (his 201
//     browsers), sent with HER selector and followed to its end.
//   · hers:  every continuation the export issues for HER export, sent with
//     HIS selector and followed to its end — nothing of hers.
// ===========================================================================

const asBuiltCursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

describe('unit:W37.T5.05', () => {
  for (const kind of HOSTS) {
    it(`host (${kind}, short): a forged continuation — one naming another person's browsers, one the export issued for him, one issued for her sent with his selector — exports nothing of the person the selector does not name, and never a browser linked to her only in globex's namespace`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const w = await crowdedWorld(kind, 'short');
        await premise(w);
        const own = await w.exportTruth(ACME, w.her.all);
        const otherTruth = await w.exportTruth(ACME, [w.other.visitorId, w.other.shopperId]);
        const globexTruth = await w.exportTruth(GLOBEX, [w.her.first, w.globex.shopperId]);
        const herSelector = { shopperId: w.her.shopperId }, hisSelector = { shopperId: w.other.shopperId };
        const answered = (label: string, pages: T5Answer[]) => expect(pages.filter(page => ![200, 400, 404].includes(page.status)).map(page => page.status),
          `${label}: each answer is one the export documents (a page, 404, or its 400 refusal; kit 02 :499)`).toEqual([]);

        const named = [w.other.visitorId, ...w.other.crowd.slice(0, 40), w.globex.only];
        for (const [form, cursor] of [
          ['links unfinished', { v: 2, links: null, browsers: named, answered: false, sessions: null, ledger: null }],
          ['links finished', { v: 2, links: 'done', browsers: named, answered: false, sessions: null, ledger: null }],
        ] as Array<[string, unknown]>) {
          const label = `W37.T5 forged cursor — ${kind}: a cursor naming his browsers and the globex-only browser (${form}), with her selector`;
          const pages = await w.exportPages(ACME, herSelector, asBuiltCursor(cursor));
          answered(label, pages);
          boundary(w, label, pages.map(page => page.body), own, otherTruth, globexTruth);
        }

        const his = await w.exportPages(ACME, hisSelector);
        for (const [n, next] of his.flatMap(page => (page.status === 200 && typeof page.body.next === 'string' ? [page.body.next as string] : [])).entries()) {
          const label = `W37.T5 forged cursor — ${kind}: continuation ${n + 1} of HIS export, with her selector`;
          const pages = await w.exportPages(ACME, herSelector, next);
          answered(label, pages);
          boundary(w, label, pages.map(page => page.body), own, otherTruth, globexTruth);
        }

        const hers = await w.exportPages(ACME, herSelector);
        const hisOwn = await w.exportTruth(ACME, [w.other.visitorId, w.other.shopperId, ...w.other.crowd]);
        for (const [n, next] of hers.flatMap(page => (page.status === 200 && typeof page.body.next === 'string' ? [page.body.next as string] : [])).entries()) {
          const label = `W37.T5 forged cursor — ${kind}: continuation ${n + 1} of HER export, with his selector`;
          const pages = await w.exportPages(ACME, hisSelector, next);
          answered(label, pages);
          const bodies = pages.map(page => page.body), seen = carried(bodies), text = JSON.stringify(bodies);
          expect(foreignCarried(seen, own, hisOwn), `${label}: nothing of hers`).toEqual([]);
          expect([w.her.shopperId, w.her.first, w.her.firstDecision, ...w.her.later].filter(id => text.includes(id)), `${label}: no identifier of hers`).toEqual([]);
        }
      } finally { vi.useRealTimers(); }
    }, 600_000);
  }
});
