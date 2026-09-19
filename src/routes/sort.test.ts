// src/routes/sort.test.ts
//
// The pure sorter is covered in sortCandidates.test.ts. This proves the route:
// the shape a commerce platform gets back, parity through the wire, and the two
// refusals.

import { describe, it, expect, vi } from 'vitest';
import { affinityFor, sortRoutes } from '@/routes/sort';
import { newAnonymousSession, requireShopper, SHOPPER_HEADER } from '@/identity/sessionCapability';
import type { Env } from '@/types/env';
import { Hono } from 'hono';
import realtimeRoutes from './realtime';
import { searchRoutes } from './search';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { shopperObjectName } from '@/tenancy/objects';
import { chooseConsent, CONSENTING, storedConsent } from '@/content/consent';
import { initializePublication, invalidatePublicationCache } from '@/config/publication';
import { DEFAULT_REFLEX_CONFIG, type ReflexConfig } from '@/reflex/core';
import { invalidateConfigCache, reflexScopeForTenant, REFLEX_KIND } from '@/reflex/configStore';
import { searchCandidates, type SearchResult } from '@/reflex/searchCandidates';
import { tenantKey } from '@/tenancy/tenant';
import { productSortIdentity, scheduleProductSort, type ProductSortPersistence } from '@/ledger/productSort';
import { isProductSortRecord, PRODUCT_SORT_MAX_BYTES, type ProductSortRecord } from '@/ledger/records';
import { writeTombstone } from '@/ledger/erasure';
import { DELIVERY_FIELD } from '@/ledger/delivery';
import { findById } from '@/ledger/writer';
import { eraseSubject } from '@/identity/erase';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) { const r = this.store.get(key); return r === undefined ? null : (type === 'json' ? JSON.parse(r) : r); }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list(o?: { prefix?: string;cursor?:string;limit?:number }) { const keys=[...this.store.keys()].filter(k=>k.startsWith(o?.prefix??'')).sort(),start=Number(o?.cursor??0),end=start+(o?.limit??1000);
    return {keys:keys.slice(start,end).map(name=>({name})),list_complete:end>=keys.length,...(end<keys.length?{cursor:String(end)}:{})}; }
}

class SortR2 {
  store = new Map<string, string>(); etags = new Map<string,string>(); metadata = new Map<string,Record<string,string>>();
  events: string[] = []; sequence=0; fail=false;
  beforeRead: (key:string) => Promise<void> = async () => undefined;
  async get(key: string) {
    this.events.push('get:'+key); await this.beforeRead(key);
    const body = this.store.get(key); return body === undefined ? null : { key,etag:this.etags.get(key),size:new TextEncoder().encode(body).length,
      customMetadata:this.metadata.get(key),body:new Response(body).body,text:async()=>body,json:async()=>JSON.parse(body) as unknown };
  }
  async head(key:string){const value=await this.get(key);return value?{key,etag:value.etag,size:value.size}:null;}
  async put(key:string,body:string,options?:R2PutOptions){
    if(this.fail)throw new Error('Synthetic storage refusal');const condition=options?.onlyIf;
    if(condition instanceof Headers?condition.get('If-None-Match')==='*'&&this.store.has(key)
      :condition?.etagDoesNotMatch==='*'&&this.store.has(key)||condition?.etagMatches!==undefined&&condition.etagMatches!==this.etags.get(key))return null;
    this.events.push('put:'+key);this.store.set(key,body);this.etags.set(key,'r'+(++this.sequence));this.metadata.set(key,{...options?.customMetadata});
    return {key,etag:this.etags.get(key),size:new TextEncoder().encode(body).length};
  }
  async list(options?:{prefix?:string;limit?:number;cursor?:string}){const keys=[...this.store.keys()].filter(k=>k.startsWith(options?.prefix??'')).sort(),start=Number(options?.cursor??0),end=start+(options?.limit??1000);
    return {objects:keys.slice(start,end).map(key=>({key,etag:this.etags.get(key),size:new TextEncoder().encode(this.store.get(key)!).length})),truncated:end<keys.length,cursor:end<keys.length?String(end):undefined};}
  async delete(keys:string|string[]){for(const key of typeof keys==='string'?[keys]:keys){this.store.delete(key);this.etags.delete(key);}}
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    CACHE: new FakeKV(), SESSIONS: new FakeKV(),
    ENVIRONMENT: 'test', CONNECTOR_MODE: 'mock',
    JWT_SECRET: 'w0402-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    ...overrides,
  } as unknown as Record<string, unknown>;
}

const FEED = [
  { id: 'P1', line: 'Rogue', price_usd: 795 },
  { id: 'P2', line: 'Tabby', price_usd: 380 },
  { id: 'P3', line: 'Tabby', price_usd: 350 },
];

/**
 * POST /sort is owner-dispatched: requireShopper verifies the capability and
 * forwards the request to the shopper's own object, and ownedRequestPath only
 * recognizes the mounted path `/sort` (src/identity/sessionCapability.ts:141-176;
 * src/identity/sessionAuthority.ts:478-490, :525-537). So the fixture mounts the
 * real app and binds a real ShopperReflex namespace; `snapshot` may still answer
 * the object's own projection read for the cases that probe it.
 */
function sortHost(overrides: Record<string, unknown> = {}, snapshot?: (url: string, init?: RequestInit) => Response) {
  const asked: Array<{ url: string; headers: Headers }> = [];
  const names: string[] = [];
  const pending: Promise<unknown>[] = [];
  const policy = { id: 'explicit-sort-route-fixture', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' };
  const e = env({
    STORAGE: new SortR2(), DEPLOYMENT_PROFILE: 'demo', LEDGER_RECOVERY_ENABLED: 'true',
    TENANTS: JSON.stringify({ provisioned: ['coach'] }),
    // A first record needs the retention registry (src/retention.ts:39, :72-89).
    RETENTION: JSON.stringify({ version: 1, tenants: { coach: Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'].map((category) => [category, policy])) } }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    ...overrides,
  }) as unknown as Env;
  const objects = new Map<string, { data: Map<string, unknown>; shopper: ShopperReflex }>();
  if (!('SHOPPER_REFLEX' in overrides)) e.SHOPPER_REFLEX = { idFromName: (name: string) => { names.push(name); return name; }, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname !== '/authority/request') { asked.push({ url: String(input), headers: new Headers(init?.headers) }); if (snapshot) return snapshot(String(input), init); }
    let item = objects.get(name);
    if (!item) {
      const data = new Map<string, unknown>();
      let alarm: number | null = null;
      const storage = {
        get: async (key: string | string[]) => structuredClone(Array.isArray(key) ? new Map(key.map(k => [k, data.get(k)])) : data.get(key)),
        put: async (key: string | Record<string, unknown>, value?: unknown) => { if (typeof key === 'string') data.set(key, structuredClone(value)); else for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v)); },
        delete: async (key: string | string[]) => { const list = typeof key === 'string' ? [key] : key; for (const k of list) data.delete(k); return list.length; },
        deleteAll: async () => data.clear(),
        list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) => structuredClone(new Map([...data]
          .filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
          .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
        getAlarm: async () => alarm, setAlarm: async (at: number) => { alarm = at; }, deleteAlarm: async () => { alarm = null; },
        transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
          const candidate = structuredClone(data);
          const result = await run({ list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
            delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
            put: async (values: string | Record<string, unknown>, value?: unknown) => { if (typeof values === 'string') candidate.set(values, structuredClone(value)); else for (const [key, item] of Object.entries(values)) candidate.set(key, structuredClone(item)); },
            deleteAlarm: async () => { alarm = null; }, setAlarm: async (at: number) => { alarm = at; } } as unknown as DurableObjectTransaction);
          data.clear(); for (const [key, value] of candidate) data.set(key, value); return result;
        },
      };
      const state = { id: name, storage, getWebSockets: () => [], waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as DurableObjectState;
      item = { data, shopper: new ShopperReflex(state, e) };
      objects.set(name, item);
    }
    return item.shopper.fetch(new Request(input, init));
  } }) } as unknown as DurableObjectNamespace;
  const app = new Hono<{ Bindings: Env }>();
  // The mounted app as src/index.ts serves it: the shopper's own doors live
  // under /realtime, which is where an owned consent choice is made.
  app.use('*', tenantMiddleware()); app.route('/sort', sortRoutes); app.route('/realtime', realtimeRoutes);
  return { env: e, app, asked, names, objects, pending };
}

/**
 * RETAINED probe driver for the two cases that inject the object's own snapshot
 * projection. On the real owner path the object serves its own projection:
 * dispatchOwnedRequest rewires SHOPPER_REFLEX.get(this object) to a local fetch
 * (src/identity/sessionAuthority.ts:616-626), so a namespace-level double is
 * unreachable and those two cases still drive the sub-router directly.
 */
async function postDirect(body: unknown, e: Record<string, unknown>) {
  const session = await newAnonymousSession(e as unknown as Env, 'coach');
  const input = body as { userId?: string };
  const target = input.userId && !input.userId.startsWith('t:') ? { ...input, userId: session.subject } : input;
  const res = await sortRoutes.request('/', {
    method: 'POST', headers: { 'Content-Type': 'application/json', [SHOPPER_HEADER]: session.capability }, body: JSON.stringify(target),
  }, e);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function post(body: unknown, host = sortHost()) {
  // Configuration publication is the only configuration authority
  // (src/config/publication.ts:19, :150-152, :204-206). Explicit authored
  // baseline, never a KV fallback.
  invalidatePublicationCache();
  if (!(host.env.STORAGE as unknown as SortR2).store.has('config-publication/v2/coach/head.json')) {
    await initializePublication(host.env, REFLEX_KIND, reflexScopeForTenant('coach'),
      { revision: 1, value: DEFAULT_REFLEX_CONFIG, actor: 'synthetic-fixture', note: '', at: 1 }, '0:' + crypto.randomUUID());
  }
  const session = await newAnonymousSession(host.env, 'coach');
  const input = body as { userId?: string };
  const target = input.userId && !input.userId.startsWith('t:') ? { ...input, userId: session.subject } : input;
  const res = await host.app.request('https://sort.invalid/sort', {
    method: 'POST', headers: { 'Content-Type': 'application/json', [SHOPPER_HEADER]: session.capability }, body: JSON.stringify(target),
  }, host.env);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /sort', () => {
  it('returns the ids in an order, plus the receipt a commerce team can read', async () => {
    const { status, body } = await post({ userId: 'vis-new', candidates: FEED });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.order).toEqual(['P1', 'P2', 'P3']);       // no history: the platform's order stands
    expect(body.tenant).toBe('coach');
    expect(typeof body.configVersion).toBe('string');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('reproduces the feed order at affinity 0, through the wire', async () => {
    const { body } = await post({ userId: 'vis-new', candidates: FEED, weights: { affinity: 0 } });
    expect(body.order).toEqual(['P1', 'P2', 'P3']);
    expect(body.affinityWeight).toBe(0);
  });

  it('refuses a malformed body with 400, not 500', async () => {
    expect((await post({ candidates: FEED })).status).toBe(400);
    expect((await post({ userId: 'v', candidates: 'nope' })).status).toBe(400);
    expect((await post({ userId: 'v', candidates: [{ line: 'x' }] })).status).toBe(400);
    for (const consent of [null, false, [], { tracking: 'false' }, { personalization: 0 }]) {
      expect((await post({ userId: 'v', candidates: FEED, consent })).status).toBe(400);
    }
  });

  /**
   * unit:W05.BASE.05 — the sort route validates the Durable Object consent
   * envelope before it returns a ranked receipt: a reply that is not ok, or that
   * carries no consent, or a consent that is not two real booleans, refuses the
   * request; and a real object whose stored choice is absent or refuses never
   * contributes a vector to the receipt (src/routes/sort.ts:79-88;
   * src/content/consent.ts:139-152, :176).
   */
  describe('unit:W05.BASE.05 the sort route validates the Durable Object consent envelope before returning a ranked receipt', () => {
    /** A raw request the real requireShopper has admitted, so the exported
     * validator runs with a genuine owned principal, as the route gives it. */
    async function ownedRequest(e: Record<string, unknown>) {
      const session = await newAnonymousSession(e as unknown as Env, 'coach');
      let raw: Request | undefined;
      const app = new Hono<{ Bindings: Env }>();
      app.use('*', tenantMiddleware());
      app.get('/sort', requireShopper({ forward: false }), (c) => { raw = c.req.raw; return c.json({ ok: true }); });
      const answer = await app.request('https://sort.invalid/sort', { headers: { [SHOPPER_HEADER]: session.capability } }, e);
      expect(answer.status).toBe(200);
      return { raw: raw!, subject: session.subject, session };
    }

    it('logic: every malformed envelope the object could answer is refused before a receipt', async () => {
      for (const reply of [
        { status: 503, body: { ok: false } }, { status: 200, body: { ok: false } },
        { status: 200, body: { ok: true } }, { status: 200, body: { ok: true, consent: null } },
        { status: 200, body: { ok: true, consent: {} } }, { status: 200, body: { ok: true, consent: { tracking: 'false', personalization: true } } },
      ]) {
        const e = env({ REFLEX_HOST: 'do', SHOPPER_REFLEX: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json(reply.body, { status: reply.status }) }) } });
        const owned = await ownedRequest(e);
        const context = { env: e as unknown as Env, get: () => 'coach', req: { raw: owned.raw, header: (name: string) => owned.raw.headers.get(name) ?? undefined } };
        await expect(affinityFor(context, owned.subject, undefined, { ...CONSENTING })).rejects.toThrow();
      }
      // Positive control: the envelope a real object answers — an explicit
      // stored choice, built by the product's own constructor
      // (src/content/consent.ts:92-113) — is accepted and yields its vector.
      const answered: { consent?: unknown } = {};
      const valid = env({ REFLEX_HOST: 'do', STORAGE: new SortR2(), SHOPPER_REFLEX: { idFromName: (n: string) => n, get: () => ({ fetch: async () =>
        Response.json({ ok: true, consent: answered.consent, affinity: { dims: { line: { Tabby: 0.8 } } } }) }) } });
      await initializePublication(valid as unknown as Env, REFLEX_KIND, reflexScopeForTenant('coach'),
        { revision: 1, value: DEFAULT_REFLEX_CONFIG, actor: 'synthetic-fixture', note: '', at: 1 }, '0:' + crypto.randomUUID());
      const owned = await ownedRequest(valid);
      answered.consent = chooseConsent(undefined, { tracking: true, personalization: true },
        { id: crypto.randomUUID(), expectedRevision: null, grantId: owned.session.grantId!, iat: owned.session.iat, exp: owned.session.exp },
        { tenant: 'coach', subject: owned.subject, grantId: owned.session.grantId, authorityEpoch: owned.session.authorityEpoch, iat: owned.session.iat, exp: owned.session.exp });
      const accepted = await affinityFor({ env: valid as unknown as Env, get: () => 'coach',
        req: { raw: owned.raw, header: (name: string) => owned.raw.headers.get(name) ?? undefined } }, owned.subject, undefined, { ...CONSENTING });
      expect(accepted.dims).toEqual({ line: { Tabby: 0.8 } });
      expect(accepted.consent).toMatchObject({ tracking: true, personalization: true });
    });

    it('host: a real object whose stored choice is absent or refusing never contributes a vector', async () => {
      const host = sortHost({ REFLEX_HOST: 'do' });
      invalidatePublicationCache();
      await initializePublication(host.env, REFLEX_KIND, reflexScopeForTenant('coach'),
        { revision: 1, value: DEFAULT_REFLEX_CONFIG, actor: 'synthetic-fixture', note: '', at: 1 }, '0:' + crypto.randomUUID());
      const grant = await newAnonymousSession(host.env, 'coach');
      const ask = (path: string, body?: unknown) => host.app.request('https://sort.invalid' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant': 'coach', [SHOPPER_HEADER]: grant.capability },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, host.env);
      const stored = () => host.objects.get(shopperObjectName('coach', grant.subject))?.data.get('consent');
      const choose = (tracking: boolean, personalization: boolean) => ask('/realtime/session/' + grant.sessionId + '/preferences',
        { trackingConsent: tracking, personalizationEnabled: personalization, choice: { id: crypto.randomUUID(),
          expectedRevision: storedConsent(stored()).instruction?.revision ?? null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp } });
      const sorted = () => ask('/sort', { userId: grant.subject, sessionId: grant.sessionId, candidates: FEED });

      // No stored choice at all: the object answers a refusing envelope and the
      // receipt carries no vector (src/content/consent.ts:139-140).
      const cold = await sorted();
      expect(cold.status).toBe(200);
      const coldBody = await cold.json() as { order: string[]; items: Array<{ score: number; drivers: unknown[] }> };
      expect(coldBody.order).toEqual(['P1', 'P2', 'P3']);
      expect(coldBody.items.every((item) => item.score === 0 && item.drivers.length === 0)).toBe(true);

      // Positive control: with an explicit consenting choice and a real vector
      // the same feed IS reordered, so the neutral receipts above are not vacuous.
      expect((await choose(true, true)).status).toBe(200);
      for (let n = 0; n < 3; n++) expect((await ask('/realtime/action', { type: 'product_view', source: 'sdk', eventId: crypto.randomUUID(),
        timestamp: Date.now(), userId: grant.subject, sessionId: grant.sessionId, data: { productId: 'COA-CH857', action: 'product_view' } })).status).toBe(200);
      const warm = await sorted();
      expect(warm.status).toBe(200);
      const warmBody = await warm.json() as { order: string[]; items: Array<{ score: number; drivers: unknown[] }> };
      // The vector contributes: every candidate now carries a positive affinity
      // score and its explain drivers, where the neutral receipts carried none.
      expect(warmBody.items.every((item) => item.score > 0 && item.drivers.length > 0)).toBe(true);
      expect(warmBody.order).toEqual(['P1', 'P2', 'P3']);

      // The shopper then refuses personalization: the same object, the same
      // vector, and a receipt that is neutral again.
      expect((await choose(true, false)).status).toBe(200);
      const refused = await sorted();
      expect(refused.status).toBe(200);
      const refusedBody = await refused.json() as { order: string[]; items: Array<{ score: number; drivers: unknown[] }> };
      expect(refusedBody.order).toEqual(['P1', 'P2', 'P3']);
      expect(refusedBody.items.every((item) => item.score === 0 && item.drivers.length === 0)).toBe(true);
    });
  });

  it('W05.03 uses the existing signed snapshot projection and never lets a zero dial substitute for an empty refused vector', async () => {
    const asked: Array<{ url: string; headers: Headers }> = [];
    const e = env({ REFLEX_HOST: 'do', SHOPPER_REFLEX: { idFromName: (n: string) => n, get: () => ({ fetch: async (url: string, init: RequestInit) => {
      asked.push({ url, headers: new Headers(init.headers) });
      return Response.json({ ok: true, consent: { tracking: false, personalization: true }, affinity: { dims: { line: { Tabby: 0.8 } } } });
    } }) } });
    for (const affinity of [0, 4]) {
      const { status, body } = await postDirect({ userId: 'v', candidates: [...FEED, { id: ' P2 ', line: 'Rogue' }, { id: ' ' }], consent: { personalization: false }, weights: { affinity } }, e);
      expect(status).toBe(200); expect(body.order).toEqual(['P1', 'P2', 'P3']); expect(body.dropped).toBe(2); expect(body.affinityWeight).toBe(affinity);
      expect((body.items as any[]).every(item => item.score === 0 && item.drivers.length === 0)).toBe(true);
    }
    expect(asked).toHaveLength(2);
    for (const request of asked) {
      expect(request.url).toBe('https://shopper-reflex/snapshot?projection=sort');
      expect(request.headers.get(SHOPPER_HEADER)).toMatch(/^ss1\./);
      expect(request.headers.get('x-tenant')).toBe('coach');
      expect(request.headers.get('cookie')).toBe('opt_personalization_enabled=false');
    }
  });

  it('bounds the candidate set, because a page of results is not a catalog', async () => {
    const huge = Array.from({ length: 501 }, (_, i) => ({ id: `P${i}` }));
    expect((await post({ userId: 'v', candidates: huge })).status).toBe(400);
  });

  it('refuses a visitor id that addresses another brand, on the DO host', async () => {
    const host = sortHost({ REFLEX_HOST: 'do' }, () => new Response(JSON.stringify({ affinity: { dims: {} } })));
    const { status } = await post({ userId: 't:kate-spade:vis-victim', candidates: FEED }, host);
    expect(status).toBe(401);
    expect(host.names).toEqual([]);
  });
});

// W05/W06/W09/W11 supersede the old implicit-consent/fire-and-forget fixture.
// These are actual owner instances with explicit choices, conditional authored
// state and canonical durable receipts. Native workerd is separately in K5.
describe('W14.01 POST /sort/intent', () => {
  type Grant=Awaited<ReturnType<typeof newAnonymousSession>>;
  type Receipt=SearchResult&{ok:boolean;tenant:string;configVersion:string;persistence:ProductSortPersistence};
  const specs=[{tenant:'meridian',dimension:'fabric',source:'weave',favorite:'Silk',values:['Linen','Silk'],winner:'p2'},
    {tenant:'brighthour',dimension:'tone',source:'hue',favorite:'Ocean',values:['Ocean','Sand'],winner:'p1'}];
  const feed=[{id:'p1',inStock:true,weave:'Linen',hue:'Ocean',uses:['work'],amount:45},
    {id:'p2',inStock:true,weave:'Silk',hue:'Sand',uses:['work','travel'],amount:45}];
  const config=(index=0):ReflexConfig=>({...DEFAULT_REFLEX_CONFIG,version:'w1401-'+specs[index]!.tenant,tauMs:1e9,eventAttributes:'event-when-unknown',weights:{product_view:3},dimensions:[
    {key:specs[index]!.dimension,source:specs[index]!.source},{key:'occasion',source:'uses',multi:true},
    {key:'priceBand',source:'amount',derive:'band',cuts:index?[5,15]:[30,100],labels:['low','middle','high']}]});
  async function configured(host='session', suppliedConfig?:ReflexConfig){
    invalidateConfigCache();const r2=new SortR2(),pending:Promise<unknown>[]=[],wires:unknown[]=[];
    const forbidden=vi.fn(()=>{throw new Error('Unexpected learning effect');});
    const policy={id:'explicit-sort-fixture',revision:1,durationMs:86400000,basis:'admitted',renewal:'new-record-only'};
    const e=env({STORAGE:r2,REFLEX_HOST:host,DEPLOYMENT_PROFILE:'demo',DECISION_SOURCE:'mock',LEDGER_RECOVERY_ENABLED:'true',IDENTITY_SALT:'local-sort-fixture',
      TENANTS:JSON.stringify({provisioned:specs.map(s=>s.tenant)}),
      RETENTION:JSON.stringify({version:1,tenants:Object.fromEntries(specs.map(s=>[s.tenant,Object.fromEntries(['profile','identity','ledger','online','hourly','recovery','quarantine'].map(c=>[c,policy]))]))}),
      EVENT_QUEUE:{send:async(body:unknown)=>{wires.push(structuredClone(body));}},DECISION_RING:{idFromName:forbidden},LEARN_STATS:{idFromName:forbidden},ANALYTICS:{writeDataPoint:forbidden},
      PERSONALIZATION_WEBSOCKET:{idFromName:(name:string)=>name,get:()=>({fetch:async()=>Response.json({connections:0})})}}) as unknown as Env&{CACHE:FakeKV;SESSIONS:FakeKV};
    const objects=new Map<string,{data:Map<string,unknown>;state:DurableObjectState;shopper:ShopperReflex}>();
    e.SHOPPER_REFLEX={idFromName:(name:string)=>name,get:(name:string)=>({fetch:async(input:RequestInfo|URL,init?:RequestInit)=>{
      let item=objects.get(name);if(!item){const data=new Map<string,unknown>();let alarm:number|null=null;
        const storage={get:async(key:string|string[])=>structuredClone(Array.isArray(key)?new Map(key.map(k=>[k,data.get(k)])):data.get(key)),
          put:async(key:string|Record<string,unknown>,value?:unknown)=>{if(typeof key==='string')data.set(key,structuredClone(value));else for(const[k,v]of Object.entries(key))data.set(k,structuredClone(v));},
          list:async(o?:{prefix?:string;startAfter?:string;limit?:number})=>structuredClone(new Map([...data].filter(([k])=>k.startsWith(o?.prefix??'')&&(!o?.startAfter||k>o.startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,o?.limit))),
          delete:async(keys:string|string[])=>{for(const k of typeof keys==='string'?[keys]:keys)data.delete(k);},deleteAll:async()=>data.clear(),
          getAlarm:async()=>alarm,setAlarm:async(value:number)=>{alarm=value;},deleteAlarm:async()=>{alarm=null;},
          transaction:async(work:(tx:unknown)=>Promise<unknown>)=>{const saved=structuredClone(data),at=alarm;try{return await work(storage);}catch(error){data.clear();for(const[k,v]of saved)data.set(k,v);alarm=at;throw error;}}};
        const state={id:name,storage,getWebSockets:()=>[],waitUntil:(p:Promise<unknown>)=>pending.push(p)} as unknown as DurableObjectState;
        item={data,state,shopper:new ShopperReflex(state,e)};objects.set(name,item);}
      return item.shopper.fetch(new Request(input,init));}})} as unknown as DurableObjectNamespace;
    const app=new Hono<{Bindings:Env}>();app.use('*',tenantMiddleware());app.route('/sort',sortRoutes);app.route('/search',searchRoutes);app.route('/realtime',realtimeRoutes);
    const request=(path:string,grant:Grant,body?:unknown,headers:Record<string,string>={})=>app.request('https://sort.invalid'+path,{method:body===undefined?'GET':'POST',
      headers:{'Content-Type':'application/json','X-Tenant':grant.tenant,[SHOPPER_HEADER]:grant.capability,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})},e,
      {waitUntil:p=>pending.push(p),passThroughOnException(){return;},props:{}});
    const choice=async(grant:Grant,tracking=true,personalization=true)=>request('/realtime/session/'+grant.sessionId+'/preferences',grant,{trackingConsent:tracking,personalizationEnabled:personalization,
      choice:{id:crypto.randomUUID(),expectedRevision:storedConsent(objects.get(shopperObjectName(grant.tenant,grant.subject))?.data.get('consent')).instruction?.revision??null,grantId:grant.grantId,iat:grant.iat,exp:grant.exp}});
    const drain=async()=>{while(pending.length)await Promise.all(pending.splice(0));};
    for(let i=0;i<specs.length;i++)await initializePublication(e,REFLEX_KIND,reflexScopeForTenant(specs[i]!.tenant),{revision:1,value:suppliedConfig??config(i),actor:'fixture',at:1,note:''},'0:'+crypto.randomUUID());
    e.CACHE.store.set('reflex:config:brighthour:current','private-demo-config-marker');
    return {env:e,r2,objects,wires,forbidden,request,choice,drain,app};
  }
  type Fixture=Awaited<ReturnType<typeof configured>>;
  async function warm(f:Fixture,index=0){const s=specs[index]!,g=await newAnonymousSession(f.env,s.tenant),chosen=await f.choice(g);expect(chosen.status,await chosen.clone().text()).toBe(200);
    const action=await f.request('/realtime/action',g,{type:'product_view',source:'sdk',eventId:crypto.randomUUID(),timestamp:Date.now(),userId:g.subject,sessionId:g.sessionId,data:{[s.source]:s.favorite}});
    expect(action.status,await action.clone().text()).toBe(200);
    await f.drain();return g;}
  const requestBody=(g:Grant,o:Record<string,unknown>={})=>({userId:g.subject,sessionId:g.sessionId,candidates:feed,intent:{filters:[]},...o});
  async function call(f:Fixture,g:Grant,o:Record<string,unknown>={},headers:Record<string,string>={}){const response=await f.request('/sort/intent',g,requestBody(g,o),headers);return{response,body:await response.json() as Receipt};}
  const records=(f:Fixture)=>[...f.r2.store].filter(([k])=>k.includes('/product-sort/')&&k.includes('-managed-')).flatMap(([key,text])=>text.trim().split('\n').map(line=>{
    const raw=JSON.parse(line);expect(raw[DELIVERY_FIELD]).toMatchObject({id:expect.any(String),ordinal:expect.any(Number)});
    const record={...raw};delete record[DELIVERY_FIELD];return{key,text,record:record as ProductSortRecord};}));
  const stateOf=(f:Fixture,g:Grant)=>{const data=f.objects.get(shopperObjectName(g.tenant,g.subject))!.data;
    return structuredClone({affinity:data.get('affinity'),pipeline:data.get('pipeline'),
      projection:data.get('sessionProjection:'+tenantKey(g.tenant,'session:'+g.sessionId)),
      session:f.env.REFLEX_HOST==='session'?JSON.parse(f.env.SESSIONS.store.get(tenantKey(g.tenant,'session:'+g.sessionId))!):undefined,
      behavior:[...f.r2.store].filter(([k])=>k.includes('/behavior/'))});};
  function seedPrivate(f:Fixture,g:Grant){const item=f.objects.get(shopperObjectName(g.tenant,g.subject))!,pipeline=item.data.get('pipeline') as {attributes:Record<string,unknown>};
    pipeline.attributes.privateFixture='private-profile-marker';item.data.set('pipeline',structuredClone(pipeline));
    const key=tenantKey(g.tenant,'session:'+g.sessionId),projection=item.data.get('sessionProjection:'+key) as {value:string}|undefined;
    if(projection){const session=JSON.parse(projection.value);session.attributes.privateFixture='private-profile-marker';projection.value=JSON.stringify(session);item.data.set('sessionProjection:'+key,structuredClone(projection));f.env.SESSIONS.store.set(key,projection.value);}
    item.shopper=new ShopperReflex(item.state,f.env);
  }

  async function searchConfiguration(f:Fixture,index=0){
    const s=specs[index]!,{configuredDestinations}=await import('@/connectors/config');
    const search={version:1,enabled:true,provider:'google',baseURL:'https://generativelanguage.googleapis.com/v1beta',apiKeyRef:'CONNECTOR_SECRET_SEARCH',model:'fixture-model',
      approval:{egress:'fixture',metering:'fixture',providerRetention:'fixture'},timeoutMs:10000,requestBytes:65536,responseBytes:65536,maxOutputTokens:1024,
      taxonomy:[{dimension:s.dimension,meaning:'Actual authored product characteristic',values:s.values.map(value=>({value,meaning:value}))}],currency:'USD',priceMinorUnits:2,priceSource:'amount',giftMeaning:'Feed-authorized gift service'};
    const catalogSearch={version:1,enabled:true,url:'https://catalog.invalid/search',tokenRef:'CONNECTOR_SECRET_CATALOG',approval:search.approval,mappingRevision:'feed-v1',timeoutMs:10000,responseBytes:65536,maxPages:2,maxCandidates:10,maxAgeMs:60000};
    f.env.TENANT_CONNECTORS=JSON.stringify({version:1,tenants:{[s.tenant]:{search,catalogSearch}}});
    Object.assign(f.env,{CONNECTOR_SECRET_SEARCH:'local-model-only',CONNECTOR_SECRET_CATALOG:'local-feed-only'});
    const policies=JSON.parse(f.env.RETENTION!);for(const d of await configuredDestinations(f.env,s.tenant,()=>undefined))policies.tenants[s.tenant][d.category]={id:'search-fixture',revision:1,durationMs:60000,basis:'admitted',renewal:'new-record-only'};
    f.env.RETENTION=JSON.stringify(policies);
    const intent={supported:true,filters:[],exclusions:[],price:null,gift:'any',unsupported:[]};
    const model=()=>Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify(intent)}]},finishReason:'STOP'}]});
    const catalog=()=>Response.json({schema:'commerce-candidates/v1',tenant:s.tenant,mappingRevision:'feed-v1',revision:'actual-feed-v1',asOf:Date.now(),complete:true,next:null,
      candidates:feed.map(p=>({id:p.id,inStock:true,entitled:true,price:{currency:'USD',minor:4500},giftEligible:true,attributes:{[s.dimension]:[p[s.source as 'weave'|'hue']]}}))});
    return{model,catalog};
  }
  it('W14.07 executes signed generic search for both actual hosts/two tenants without profile egress or fabricated IDs',async()=>{
    const clone=Request.prototype.clone,diagnostic=vi.spyOn(Request.prototype,'clone').mockImplementation(function(this:Request){
      try{return clone.call(this);}catch(error){console.info('W14 closed clone failure',JSON.stringify({bodyUsed:this.bodyUsed,locked:this.body?.locked,stack:new Error().stack?.split('\n').slice(1,7)}));throw error;}});
    try{for(const host of ['session','do'])for(let index=0;index<specs.length;index++){
      const f=await configured(host),g=await warm(f,index),replies=await searchConfiguration(f,index),calls:Array<{url:string;body:string}>=[];
      const remote=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{calls.push({url:String(input),body:String(init?.body)});expect(init?.redirect).toBe('manual');
        return String(input).startsWith('https://catalog.invalid/')?replies.catalog():replies.model();});
      try{const response=await f.request('/search',g,{query:'Show suitable products',limit:2}),body=await response.json() as Receipt&{complete:boolean};
        expect(response.status,JSON.stringify(body)).toBe(200);expect(body.complete).toBe(true);expect(body.order[0]).toBe(specs[index]!.winner);
        expect(new Set(body.order)).toEqual(new Set(['p1','p2']));expect(body.persistence.status).toBe('durable');expect(calls).toHaveLength(2);
        expect(calls[0]!.body).toContain('Show suitable products');expect(calls[0]!.body).not.toContain(g.subject);expect(calls[0]!.body).not.toContain(g.sessionId);expect(calls[0]!.body).not.toContain('affinity');
        expect([...f.r2.store.values()].join('')).not.toContain('Show suitable products');expect(records(f).at(-1)!.record.search?.catalogRevision).toBe('actual-feed-v1');
        const before=calls.length;expect((await f.request('/search',g,{query:'x',affinity:{fabric:{Silk:1}}})).status).toBe(400);expect(calls).toHaveLength(before);
      }finally{remote.mockRestore();await f.drain();}
    }}finally{diagnostic.mockRestore();}
  });
  it('W14.07 releases owner serialization across model waits and refuses revoked/erased/config-changed late results before catalog egress',async()=>{
    for(const host of ['session','do'])for(const cause of ['consent','cutoff','owner-erasure','configuration']){
      const f=await configured(host),g=await warm(f),replies=await searchConfiguration(f);let release!:()=>void,entered!:()=>void;
      const gate=new Promise<void>(r=>{release=r;}),seen=new Promise<void>(r=>{entered=r;});let catalogCalls=0;
      const remote=vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{if(String(input).startsWith('https://catalog.invalid/')){catalogCalls++;return replies.catalog();}entered();await gate;return replies.model();});
      try{const count=records(f).length,pending=Promise.resolve(f.request('/search',g,{query:'Private query during held model'}));
        await Promise.race([seen,pending.then(async response=>{throw new Error('Search completed before held transport: '+response.status+' '+await response.text());})]);
        const ordinary=await f.request('/realtime/action',g,{type:'product_view',source:'sdk',eventId:crypto.randomUUID(),timestamp:Date.now(),userId:g.subject,sessionId:g.sessionId,data:{weave:'Linen'}});expect(ordinary.status).toBe(200);
        if(cause==='consent')expect((await f.choice(g,false,false)).status).toBe(200);
        else if(cause==='cutoff')await writeTombstone(f.r2,g.tenant,g.subject,'fixture',Date.now());
        else if(cause==='owner-erasure'){
          const privacyReset=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const request=new Request(input,init);expect(request.method).toBe('POST');expect(new URL(request.url).pathname).toBe('/erase');return Response.json({ok:true,reset:true});});
          f.env.DECISION_RING={idFromName:(name:string)=>{expect(name).toBe(g.tenant+':'+g.subject);return name;},get:()=>({fetch:privacyReset})} as unknown as DurableObjectNamespace;
          let receipt=await eraseSubject(f.env,g.tenant,{visitorId:g.subject},'fixture');
          for(let i=0;i<20&&receipt.status==='pending';i++)receipt=await eraseSubject(f.env,g.tenant,{visitorId:g.subject},'fixture');
          expect(receipt.httpStatus,JSON.stringify({host,cause,status:receipt.status,local:receipt.localCompleted})).toBeLessThan(400);
          expect(privacyReset).toHaveBeenCalled();
          expect((await f.request('/realtime/action',g,{type:'product_view',source:'sdk',userId:g.subject,sessionId:g.sessionId,data:{weave:'Silk'}})).status,host+':'+cause).toBe(401);
        }
        else delete f.env.TENANT_CONNECTORS;
        release();expect((await pending).status,host+':'+cause).toBeGreaterThanOrEqual(400);expect(catalogCalls).toBe(0);expect(records(f)).toHaveLength(count);
      }finally{release();remote.mockRestore();await f.drain();}
    }
  });
  it('W14.07 bounds actual search preprocessing before owner/provider despite missing or false length and stalled streams',async()=>{
    const f=await configured(),g=await warm(f);await searchConfiguration(f);const remote=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Forbidden egress'));
    try{for(const length of [undefined,'1']){
      const response=await f.app.request(new Request('https://sort.invalid/search',{method:'POST',headers:{'Content-Type':'application/json','X-Tenant':g.tenant,[SHOPPER_HEADER]:g.capability,...(length?{'Content-Length':length}:{})},body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(8193)));c.close();}}),duplex:'half'} as RequestInit&{duplex:string}),undefined,f.env);
      expect(response.status).toBe(413);
    }
      let cancelled=false;
      const pending=f.app.request(new Request('https://sort.invalid/search',{method:'POST',headers:{'Content-Type':'application/json','X-Tenant':g.tenant,[SHOPPER_HEADER]:g.capability},body:new ReadableStream({pull(){return new Promise<void>(()=>undefined);},cancel(){cancelled=true;}}),duplex:'half'} as RequestInit&{duplex:string}),undefined,f.env);
      expect((await pending).status).toBe(401);await new Promise(r=>setTimeout(r,0));expect(cancelled).toBe(true);expect(remote).not.toHaveBeenCalled();
    }finally{remote.mockRestore();await f.drain();}
  },15000);

  it('W14.02 persists exact responses for both modes, actual hosts and two tenant registries before durable ACK without learning',async()=>{
    for(const host of ['session','do']){const f=await configured(host);for(let index=0;index<specs.length;index++){const g=await warm(f,index),s=specs[index]!;
      seedPrivate(f,g);const before=stateOf(f,g);
      for(const path of ['/sort','/sort/intent']){const input={userId:g.subject,sessionId:g.sessionId,candidates:[...feed.map(p=>({...p,unused:'private-candidate-marker'})),{...feed[0]!,id:' p1 '}],weights:{affinity:0,dims:{[s.dimension]:2.123456}},surface:'private-surface-marker',
        ...(path.endsWith('intent')?{intent:{filters:[{dimension:s.dimension,values:[...s.values,' '+s.values[0]!.toUpperCase()+' ']}]},limit:1}:{})};
        const response=await f.request(path,g,input,{'User-Agent':'private-user-agent-marker'}),body=await response.json() as Receipt;
        expect(response.status,JSON.stringify(body)).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(body.persistence.status).toBe('durable');
        if(body.persistence.status!=='durable')throw new Error('Missing durable receipt');expect(body.persistence.receipt).toMatchObject({durable:true,source:{state:'recovered'}});
        const persistence=body.persistence;
        expect(body.order).toEqual(path.endsWith('intent')?['p1']:['p1','p2']);
        const saved=records(f).find(v=>v.record.record_id===persistence.recordId)!;expect(saved).toBeDefined();expect(isProductSortRecord(saved.record)).toBe(true);
        expect(saved.record).toMatchObject({tenant:g.tenant,visitor_id:g.subject,session_id:g.sessionId,configVersion:body.configVersion,mode:path.endsWith('intent')?'intent':'sort',
          order:body.order,items:body.items,affinityWeight:body.affinityWeight,inputCount:3,dropped:1,eligibleCount:2,filteredCount:0,returnedCount:body.order.length,consent:{tracking:true,personalization:true}});
        expect(saved.record.weights.dims[s.dimension]).toBe(2.123456);expect(saved.text).not.toMatch(/private-(?:profile|candidate|surface|user-agent)-marker|ss1\./);
        expect(saved.record.intent).toEqual(path.endsWith('intent')?{filters:[{dimension:s.dimension,values:s.values.map(v=>v.toLowerCase())}]}:null);
      }
      const after=stateOf(f,g);expect(after.affinity).toEqual(before.affinity);expect(after.pipeline).toEqual(before.pipeline);expect(after.behavior).toEqual(before.behavior);
      expect(after.projection).toEqual(before.projection);
      if(host==='session'){expect(after.session.reflex).toEqual(before.session.reflex);expect(after.session.metadata).toEqual(before.session.metadata);}
    }expect(records(f)).toHaveLength(4);expect(f.forbidden).not.toHaveBeenCalled();await f.drain();}
  });
  it('W14.02 keeps refusals, whole-size bounds, storage failure and the pre-affinity erasure cutoff explicit',async()=>{
    for(const host of ['session','do']){const f=await configured(host),g=await warm(f);
      for(const path of ['/sort','/sort/intent'])for(const mode of ['stored','body','cookie']){const current=await warm(f);if(mode==='stored')expect((await f.choice(current,false,true)).status).toBe(200);
        const count=records(f).length,response=await f.request(path,current,requestBody(current,mode==='body'?{consent:{tracking:false}}:{}),mode==='cookie'?{Cookie:'opt_tracking_consent=false'}:{}),body=await response.json() as Receipt;
        expect(response.status).toBe(200);expect(body.persistence).toEqual({status:'not_scheduled',reason:'tracking_refused'});expect(body.items.every(v=>v.score===0&&v.drivers.length===0)).toBe(true);expect(records(f)).toHaveLength(count);}
      for(const path of ['/sort','/sort/intent']){const current=await warm(f);expect((await f.choice(current,true,false)).status).toBe(200);
        const response=await f.request(path,current,requestBody(current)),body=await response.json() as Receipt;expect(response.status).toBe(200);expect(body.persistence.status).toBe('durable');
        expect(body.items.every(v=>v.score===0&&v.drivers.length===0)).toBe(true);expect(records(f).at(-1)!.record.consent).toEqual({tracking:true,personalization:false});}
      const count=records(f).length;f.r2.fail=true;const failed=await call(f,g);expect(failed.response.status).toBe(200);expect(failed.body.persistence).toMatchObject({status:'durable',receipt:{source:{state:'pending'}}});f.r2.fail=false;expect(records(f)).toHaveLength(count);
      const owner=f.objects.get(shopperObjectName(g.tenant,g.subject))!,transaction=vi.spyOn(owner.state.storage,'transaction').mockRejectedValue(new Error('Synthetic owner transaction unavailable'));
      try{const rejected=await f.request('/sort/intent',g,requestBody(g));expect(rejected.status).toBeGreaterThanOrEqual(400);expect(await rejected.text()).not.toContain('"order"');expect(records(f)).toHaveLength(count);}finally{transaction.mockRestore();}
      const oversized=await f.request('/sort',g,{userId:g.subject,candidates:[{id:'é'.repeat(PRODUCT_SORT_MAX_BYTES/2)}]});
      expect(oversized.status).toBe(503);expect(await oversized.json()).toMatchObject({persistence:{status:'not_scheduled',reason:'record_too_large'}});
      const identity=productSortIdentity(g,f.env),empty={order:[],items:[],affinityWeight:1,dropped:0};
      for(const result of [{...empty,affinityWeight:NaN},{...empty,items:[1n]}])expect(await scheduleProductSort(f.r2,()=>{throw new Error('Not needed');},identity,{tracking:true,personalization:true},config(),result as never,0,undefined)).toEqual({status:'not_scheduled',reason:'invalid_record'});
      const unicode='İ'.repeat(128),out=await call(f,g,{intent:{filters:[{dimension:'fabric',values:[unicode]}]}});expect(out.response.status).toBe(200);
      expect(records(f).at(-1)!.record.intent?.filters[0]!.values).toEqual([unicode.toLowerCase()]);
      // Source admission has its original pre-affinity timestamp. A tombstone
      // installed during a held config read must prevent later persistence.
      const at=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(at);let tripped=false;
      try{const cutoff=await warm(f);f.r2.beforeRead=async key=>{if(!tripped&&key.includes('/head.json')){tripped=true;await writeTombstone(f.r2,cutoff.tenant,cutoff.subject,'fixture',at+1);clock.mockReturnValue(at+5000);}};
        invalidateConfigCache();invalidatePublicationCache();const n=records(f).length,late=await call(f,cutoff);expect(tripped).toBe(true);expect(late.response.status).toBeGreaterThanOrEqual(400);expect(records(f)).toHaveLength(n);}finally{f.r2.beforeRead=async()=>undefined;clock.mockRestore();}
      expect(f.forbidden).not.toHaveBeenCalled();await f.drain();}
  });
  it('uses two nondefault registries and live owned profiles on both actual hosts',async()=>{
    for(const host of ['session','do']){const f=await configured(host);for(let i=0;i<specs.length;i++){const g=await warm(f,i),s=specs[i]!;
      const out=await call(f,g,{surface:'brighthour',intent:{filters:[{dimension:s.dimension,values:s.values}]}});
      expect(out.response.status).toBe(200);expect(out.body).toMatchObject({source:'structured-intent',tenant:s.tenant,configVersion:'w1401-'+s.tenant,eligibleCount:2});
      expect(out.body.order[0]).toBe(s.winner);expect(out.body.items[0]!.drivers).toEqual([expect.objectContaining({dim:s.dimension,value:s.favorite})]);
      expect((await call(f,g,{weights:{affinity:0}})).body.order).toEqual(['p1','p2']);const cold=await newAnonymousSession(f.env,s.tenant);expect((await call(f,cold)).body.order).toEqual(['p1','p2']);}
      expect(f.env.CACHE.store.get('reflex:config:brighthour:current')).toBe('private-demo-config-marker');await f.drain();}
  });
  it('W14.07 preserves all 500 items and eight drivers through oversized-queue durable fallback and owner restart',async()=>{
    const dimensions=Array.from({length:8},(_,i)=>({key:'dimension'+i,source:'source'+i})),attributes=Object.fromEntries(dimensions.map(d=>[d.source,'fixture-value-12345678']));
    for(const host of ['session','do'])for(const path of ['/sort','/sort/intent']){
      const f=await configured(host,{...config(),dimensions}),g=await newAnonymousSession(f.env,'meridian');expect((await f.choice(g)).status).toBe(200);
      expect((await f.request('/realtime/action',g,{type:'product_view',source:'sdk',userId:g.subject,sessionId:g.sessionId,eventId:crypto.randomUUID(),timestamp:Date.now(),data:attributes})).status).toBe(200);await f.drain();
      const candidates=Array.from({length:500},(_,i)=>({id:'complete-'+i,inStock:true,...attributes})),start=Date.now(),queueBefore=f.wires.length;
      const put=f.r2.put.bind(f.r2);const held=vi.spyOn(f.r2,'put').mockImplementation(async(key,body,options)=>{if(key.includes('/product-sort/')&&key.includes('-managed-'))throw new Error('Synthetic canonical sink unavailable');return put(key,body,options);});
      const response=await f.request(path,g,requestBody(g,{candidates,limit:500})),body=await response.json() as Receipt;
      expect(response.status,JSON.stringify(body)).toBe(200);expect(body.persistence.status).toBe('durable');if(body.persistence.status!=='durable')throw new Error('Durable receipt missing');
      const persistence=body.persistence;
      expect(body.items).toHaveLength(500);expect(body.items.every(item=>item.drivers.length===8)).toBe(true);expect(body.order).toEqual(candidates.map(p=>p.id));
      const item=f.objects.get(shopperObjectName(g.tenant,g.subject))!,operation=body.persistence.receipt.operation;
      const meta=item.data.get('recoveryOperation:'+operation) as {chunks:number;expiresAt:number;occurredAt:number};
      const admitted=JSON.parse(Array.from({length:meta.chunks},(_,i)=>item.data.get('recoveryBody:'+operation+':'+i)).join('')).input.record as ProductSortRecord;
      const bytes=new TextEncoder().encode(JSON.stringify(admitted)+'\n').length;expect(bytes).toBeGreaterThan(120000);expect(bytes).toBeLessThanOrEqual(PRODUCT_SORT_MAX_BYTES);
      expect(admitted.items).toEqual(body.items);expect(admitted.order).toEqual(body.order);expect(admitted.ts).toBeGreaterThanOrEqual(start);expect(admitted.retention!.ledger!.bornAt).toBe(admitted.ts);
      expect(f.wires).toHaveLength(queueBefore);expect(body.persistence.receipt.source.state).toBe('pending');expect(records(f)).toHaveLength(0);
      held.mockRestore();item.shopper=new ShopperReflex(item.state,f.env);await item.shopper.alarm();await f.drain();
      const saved=records(f).find(r=>r.record.record_id===persistence.recordId)!;expect(saved.record).toEqual(admitted);
      expect(item.data.get('recoveryOperation:'+operation)).toMatchObject({expiresAt:meta.expiresAt,occurredAt:meta.occurredAt,receipt:{source:{state:'recovered'}}});
      const again=await findById<ProductSortRecord>(f.r2,body.persistence.recordId,'product-sort');expect(again?.record).toMatchObject(saved.record);
      expect(again?.record.retention).toEqual(saved.record.retention);expect(again?.record.record_id).toBe(body.persistence.recordId);
      expect(f.forbidden).not.toHaveBeenCalled();await f.drain();
    }
  },30000);
  it('keeps first-ID eligibility, exact AND/OR filters, bands, original ranks and truthful prelimit counts', async () => {
    const e = await configured(), grant = await warm(e);
    const candidates = [
      { ...feed[1]!, id: ' unavailable ', inStock: false },
      { ...feed[1]!, id: 'unavailable' },
      { ...feed[0]!, id: 'filtered', uses: ['evening'] },
      { ...feed[1]!, id: ' filtered ' },
      { ...feed[0]!, id: 'linen', weave: ' LINEN ' },
      { ...feed[1]!, id: 'silk' },
      { ...feed[1]!, id: 'tie' },
      { ...feed[1]!, id: 'wrong-band', amount: 120 },
      { ...feed[1]!, id: 'not-substring', uses: ['workshop'] },
    ];
    const intent = { filters: [
      { dimension: 'fabric', values: [' linen ', 'SILK'] },
      { dimension: 'occasion', values: [' WORK ', 'travel'] },
      { dimension: 'priceBand', values: ['Middle'] },
    ] };
    const { response, body } = await call(e, grant, { candidates, intent, limit: 1 });
    expect(response.status).toBe(200); expect(body.order).toEqual(['silk']);
    expect(body).toMatchObject({ inputCount: 9, dropped: 2, filteredCount: 4, eligibleCount: 3 });
    expect(body.items[0]).toMatchObject({ id: 'silk', feedRank: 5, rank: 0 });
    const all = (await call(e, grant, { candidates, intent, limit: 500 })).body;
    expect(all.order).toEqual(['silk', 'tie', 'linen']);
    expect(all.items.map(item => item.feedRank)).toEqual([5, 6, 4]);
    const parity = (await call(e, grant, { candidates, intent, weights: { affinity: 0 } })).body;
    expect(parity.order).toEqual(['linen', 'silk', 'tie']);
    expect(parity.items.map(item => item.feedRank)).toEqual([4, 5, 6]);
    const none = (await call(e, grant, { candidates, intent: { filters: [{ dimension: 'occasion', values: ['missing'] }] } })).body;
    expect(none).toMatchObject({ order: [], items: [], eligibleCount: 0, filteredCount: 7, dropped: 2 });
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...feed[0]!, id: `id-${i}` }));
    expect((await call(e, grant, { candidates: ten })).body).toMatchObject({ eligibleCount: 10, order: ten.slice(0, 9).map(p => p.id) });
    for (const filters of [
      [{ dimension: 'unknown', values: ['x'] }],
      [{ dimension: 'Fabric', values: ['Silk'] }],
      [{ dimension: 'fabric', values: ['Silk'] }, { dimension: ' fabric ', values: ['Linen'] }],
    ]) {
      const failed = await call(e, grant, { intent: { filters } });
      expect(failed.response.status).toBe(400); expect(failed.body).toEqual({ ok: false, error: 'Invalid intent filters' });
    }
    // Internal helper also fails stock closed and accounts for unusable IDs.
    expect(searchCandidates([{ id: ' ' }, { id: 'missing' }, { id: 'false', inStock: false }, { id: 'yes', inStock: true }], { filters: [] }, {}, config()))
      .toMatchObject({ order: ['yes'], inputCount: 4, dropped: 1, filteredCount: 2, eligibleCount: 1, items: [expect.objectContaining({ feedRank: 3 })] });
  });


  it('enforces owned targets, malformed/filter and actual streamed byte bounds without granting behavior',async()=>{
    const f=await configured(),g=await warm(f);seedPrivate(f,g);const before=stateOf(f,g),count=records(f).length;
    for(const invalid of [{affinity:{fabric:{Silk:1}}},{query:'silk'},{priceMax:20},{intent:{filters:[],query:'silk'}},{candidates:[{id:'x'}]},
      {candidates:[{id:' ',inStock:true}]},{candidates:[{id:'x',inStock:'true'}]},{candidates:[{id:'x',inStock:true,nested:{secret:true}}]},
      {candidates:Array.from({length:501},(_,i)=>({id:String(i),inStock:true}))},{weights:{affinity:-1}},{weights:{dims:{fabric:11}}},{limit:0},{limit:501},{limit:1.5},{consent:{tracking:'false'}},
      {intent:{filters:Array.from({length:17},()=>({dimension:'fabric',values:['Silk']}))}},{intent:{filters:[{dimension:'fabric',values:[]}] }},
      {intent:{filters:[{dimension:'fabric',values:Array.from({length:9},(_,i)=>String(i))}]}},
      {intent:{filters:[{dimension:'fabric',values:['x'.repeat(129)]}]}},{intent:{filters:[{dimension:'x'.repeat(65),values:['Silk']}]}}]){
      const out=await call(f,g,invalid);expect(out.response.status).toBe(400);expect(out.body).toEqual({ok:false,error:'Invalid intent request'});}
    for(const input of [{userId:'vis-victim'},{sessionId:'s-victim'}])expect((await call(f,g,input)).response.status).toBe(401);
    expect((await call(f,g,{}, {'X-Tenant':'brighthour'})).response.status).toBe(401);
    let pulls=0;const unauthorized=new ReadableStream({pull(){pulls++;throw new Error('Unauthenticated body was read');}},{highWaterMark:0});
    expect((await f.app.request(new Request('https://sort.invalid/sort/intent',{method:'POST',headers:{'X-Tenant':g.tenant},body:unauthorized,duplex:'half'} as RequestInit&{duplex:string}),undefined,f.env)).status).toBe(401);expect(pulls).toBe(0);
    expect((await f.app.request('https://sort.invalid/sort/intent',{method:'POST',headers:{'Content-Type':'application/json','X-Tenant':g.tenant,[SHOPPER_HEADER]:g.capability},body:'{bad'},f.env)).status).toBe(400);
    for(const length of [undefined,'1']){let cancelled=false;const bytes=new TextEncoder().encode(JSON.stringify(requestBody(g,{candidates:[{id:'x',inStock:true,padding:'é'.repeat(128*1024)}]})));
      const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(bytes);},cancel(){cancelled=true;}},{highWaterMark:0});
      const response=await f.app.request(new Request('https://sort.invalid/sort/intent',{method:'POST',headers:{'Content-Type':'application/json','X-Tenant':g.tenant,[SHOPPER_HEADER]:g.capability,...(length?{'Content-Length':length}:{})},body:stream,duplex:'half'} as RequestInit&{duplex:string}),undefined,f.env);
      expect(response.status).toBe(413);await new Promise(r=>setTimeout(r,0));expect(cancelled).toBe(true);}
    expect(stateOf(f,g)).toEqual(before);expect(records(f)).toHaveLength(count);
    const empty=JSON.stringify(requestBody(g,{candidates:[{id:'x',inStock:true,padding:''}]})),atLimit=empty.replace('"padding":""','"padding":"'+'x'.repeat(256*1024-new TextEncoder().encode(empty).length)+'"');
    expect((await f.app.request('https://sort.invalid/sort/intent',{method:'POST',headers:{'Content-Type':'application/json','X-Tenant':g.tenant,[SHOPPER_HEADER]:g.capability},body:atLimit},f.env)).status).toBe(200);
    expect(f.forbidden).not.toHaveBeenCalled();await f.drain();
  });
});

describe('W14.07 real catalog contract and grounded search constraints',()=>{
  async function configured(){
    const {configuredDestinations}=await import('@/connectors/config');
    const search={version:1 as const,enabled:true as const,provider:'google' as const,baseURL:'https://generativelanguage.googleapis.com/v1beta' as const,
      apiKeyRef:'CONNECTOR_SECRET_SEARCH',model:'fixture-model',approval:{egress:'fixture',metering:'fixture',providerRetention:'fixture'},timeoutMs:2000,requestBytes:65536,responseBytes:65536,maxOutputTokens:512,
      taxonomy:[{dimension:'line',meaning:'Product line',values:[{value:'Tabby',meaning:'Tabby line'},{value:'Rogue',meaning:'Rogue line'}]},
        {dimension:'priceBand',meaning:'Actual price in the configured currency',values:[{value:'entry',meaning:'Below 150'},{value:'core',meaning:'150 to below 400'},{value:'elevated',meaning:'400 and above'}]}],
      currency:'USD',priceMinorUnits:2,priceSource:'price_usd',giftMeaning:'Eligible for the approved gift service'};
    const catalogSearch={version:1 as const,enabled:true as const,url:'https://catalog.invalid/search',tokenRef:'CONNECTOR_SECRET_CATALOG',approval:search.approval,mappingRevision:'feed-v1',
      timeoutMs:2000,responseBytes:65536,maxPages:3,maxCandidates:10,maxAgeMs:60000};
    const e={TENANTS:JSON.stringify({provisioned:['coach']}),TENANT_CONNECTORS:JSON.stringify({version:1,tenants:{coach:{search,catalogSearch}}}),
      CONNECTOR_SECRET_SEARCH:'local-model',CONNECTOR_SECRET_CATALOG:'local-feed'} as unknown as Env;
    e.RETENTION=JSON.stringify({version:1,tenants:{coach:Object.fromEntries((await configuredDestinations(e,'coach',()=>undefined)).map(d=>[d.category,{id:'fixture',revision:1,durationMs:60000,basis:'admitted',renewal:'new-record-only'}]))}});
    const intent={supported:true,filters:[{dimension:'line',values:['Tabby']},{dimension:'priceBand',values:['core']}],exclusions:[],price:{currency:'USD',minMinor:15000,maxMinor:39999},gift:'required' as const,unsupported:[]};
    const registry={...DEFAULT_REFLEX_CONFIG,dimensions:DEFAULT_REFLEX_CONFIG.dimensions.filter(d=>['line','priceBand'].includes(d.key))};
    const item=(id:string)=>({id,inStock:true,entitled:true,price:{currency:'USD',minor:25000},giftEligible:true,attributes:{line:['Tabby']}});
    return{e,search,catalogSearch,intent,registry,item};
  }
  it('uses complete stable real pages and numeric feed price/gift/stock/entitlement gates before deterministic ranking',async()=>{
    const f=await configured(),{retrieveSearchCatalog,groundSearchCandidates}=await import('@/connectors/catalogSearch'),{connectorDeadline}=await import('@/connectors/model');
    const {validateSearchIntent}=await import('@/reflex/searchIntent'),seen:unknown[]=[],at=Date.now();let authorized=0;
    const items=[f.item('actual-1'),{...f.item('not-stock'),inStock:false},{...f.item('not-entitled'),entitled:false},{...f.item('not-gift'),giftEligible:false},
      {...f.item('expensive'),price:{currency:'USD',minor:40000}},f.item('actual-2')];
    const remote=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
      expect(String(input)).toBe(f.catalogSearch.url);expect(init?.redirect).toBe('manual');const body=JSON.parse(String(init?.body));seen.push(body);
      const last=body.cursor==='page2';return Response.json({schema:'commerce-candidates/v1',tenant:'coach',mappingRevision:'feed-v1',revision:'r1',asOf:at,complete:last,next:last?null:'page2',candidates:last?items.slice(3):items.slice(0,3)});
    });
    try{
      const intent=validateSearchIntent(f.intent,f.search,f.registry),catalog=await connectorDeadline(2000,deadline=>retrieveSearchCatalog(f.e,'coach',intent,deadline,async()=>{authorized++;}));
      expect(catalog.candidates).toHaveLength(6);expect(seen).toHaveLength(2);expect(authorized).toBe(4);
      expect(groundSearchCandidates(catalog.candidates,intent,f.search,f.registry).map(p=>p.id)).toEqual(['actual-1','actual-2']);
      expect(groundSearchCandidates([{...f.item('edge'),price:{currency:'USD',minor:39999}}],intent,f.search,f.registry)).toHaveLength(1);
      expect(()=>groundSearchCandidates([{...f.item('lie'),attributes:{line:['Tabby'],priceBand:['entry']}}],intent,f.search,f.registry)).toThrow();
      expect(()=>groundSearchCandidates([{...f.item('foreign-currency'),price:{currency:'EUR',minor:25000}}],intent,f.search,f.registry)).toThrow();
      expect(()=>validateSearchIntent({...f.intent,filters:[{dimension:'invented',values:['x']}]},f.search,f.registry)).toThrow();
      expect(groundSearchCandidates(items,{...intent,exclusions:[{dimension:'line',values:['Tabby']}]},f.search,f.registry)).toEqual([]);
    }finally{remote.mockRestore();}
  });
  it('counts actual padded bytes across pages, refuses unstable/incomplete pages and prevents post-expiry egress after a held final gate',async()=>{
    const f=await configured(),{retrieveSearchCatalog}=await import('@/connectors/catalogSearch'),{connectorDeadline}=await import('@/connectors/model');
    const remote=vi.spyOn(globalThis,'fetch');
    try{
      const page={schema:'commerce-candidates/v1',tenant:'coach',mappingRevision:'feed-v1',revision:'r1',asOf:Date.now(),complete:false,next:'page2',candidates:[f.item('one')]};
      remote.mockImplementation(async()=>new Response(JSON.stringify(page)+' '.repeat(40000),{headers:{'Content-Length':'1'}}));
      await expect(connectorDeadline(2000,deadline=>retrieveSearchCatalog(f.e,'coach',f.intent,deadline,async()=>undefined))).rejects.toThrow();
      expect(remote).toHaveBeenCalledTimes(2);
      remote.mockClear();let count=0;
      remote.mockImplementation(async()=>Response.json({...page,revision:++count===1?'r1':'changed',complete:count===2,next:count===2?null:'page2',candidates:[f.item(String(count))]}));
      await expect(connectorDeadline(2000,deadline=>retrieveSearchCatalog(f.e,'coach',f.intent,deadline,async()=>undefined))).rejects.toThrow();
      remote.mockClear();const at=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(at);
      try{await expect(connectorDeadline(120000,deadline=>retrieveSearchCatalog(f.e,'coach',f.intent,deadline,async()=>{clock.mockReturnValue(at+60000);}))).rejects.toThrow();expect(remote).not.toHaveBeenCalled();}finally{clock.mockRestore();}
    }finally{remote.mockRestore();}
  });
});
