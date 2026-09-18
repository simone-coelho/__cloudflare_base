// src/units/W16/C2.unit.test.ts
// W16 criterion C2 — validated visit number and entry channel.
//
// One `describe('unit:W16.C2.0N')` per unit of batch W16-B1, one `it` per ruled
// leg. Every expected value comes from the W16-B1 ruling table in
// `docs/remediation/LANE-LOG.md`, the admitted C2 text in
// `docs/handover/HANDOFF-2026-09-18.md` §5, `docs/architecture/35-…` §5 W16 and
// the six-value channel vocabulary declared in `src/services/visit.ts` — never
// from what the engine returns today.
//
// The host legs drive the real mounted app and the real ShopperReflex class in
// process on BOTH hosts, in the pattern of `src/routes/realtime.sdkContract.test.ts`.
// The sdk leg drives the real `src/sdk` entry through the memory host, in the
// pattern of `src/sdk/core.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

import {
  ENTRY_QUERY_LIMIT, VISIT_GAP_MS, classifyEntryChannel, entryChannelOf, liveVisit, projectVisit,
  snapshotEntry, validEntry, type ChannelSignals, type EntryChannel,
} from '@/services/visit';

import type { Env } from '@/types/env';
import realtimeRoutes from '@/routes/realtime';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, verifySessionCapability, SHOPPER_HEADER, type SessionCapability } from '@/identity/sessionCapability';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent, type ConsentInstruction } from '@/content/consent';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { initializePublicationSet, pinPublication, publishSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache, serveContentDecisions } from '@/content/service';
import { configuredDestinations } from '@/connectors/config';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

import { createCore } from '@/sdk/core';
import { preferenceAck, testHost } from '@/sdk/testHost';
import { DEFAULT_SESSION_IDLE_MS } from '@/sdk/identity';

// ---------------------------------------------------------------------------
// Customer-shaped fixtures. Coach's own site host and taxonomy-bearing search
// terms (docs/architecture/tapestry_requirements.txt §3.2 Return Visit
// Recognition / Cross-Channel Awareness); unknown and lookalike inputs are part
// of the fixture, not an afterthought.
// ---------------------------------------------------------------------------

const SITE = 'shop.coach.com';
const T0 = 1_725_000_000_000;

/** One canonical host per family named in the W16-B1 ruling for W16.C2.01. */
const SEARCH_REFERRERS: Array<[string, string]> = [
  ['google', 'https://www.google.com/search?q=coach%20tabby%20handbag'],
  ['bing', 'https://www.bing.com/search?q=coach+small+leather+goods'],
  ['duckduckgo', 'https://duckduckgo.com/?q=coach+accessories'],
  ['yahoo', 'https://search.yahoo.com/search?p=coach+handbags'],
  ['ecosia', 'https://www.ecosia.org/search?q=coach+tabby'],
  ['baidu', 'https://www.baidu.com/s?wd=coach'],
  ['yandex', 'https://yandex.com/search/?text=coach+bags'],
  ['brave', 'https://search.brave.com/search?q=coach+wallet'],
  ['startpage', 'https://www.startpage.com/sp/search?q=coach+belt+bag'],
];

/** The paid-social declarations the ruling for W16.C2.03 names, as a full cross product. */
const SOCIAL_SOURCES = ['facebook', 'instagram', 'meta', 'tiktok', 'pinterest'];
const PAID_MEDIUMS = ['cpc', 'ppc', 'paid', 'paid_social', 'cpm'];

// ---------------------------------------------------------------------------
// Host fixture — the real app, the real SessionManager path and the real
// ShopperReflex class, one construction per host. Pattern reused from
// `src/routes/realtime.sdkContract.test.ts`; that suite is never imported.
// ---------------------------------------------------------------------------

const TENANT = 'meridian';

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w16-b1-fixture-policy', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  data = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.data.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      customMetadata: this.metadata.get(key), body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.data.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.data.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.data.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.data.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

/** One live editorial piece and one home slot, so a decision set actually resolves. */
const documentChanges = (tenant: string): PublicationBaseline[] => [
  { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b1-fixture', note: '', value: { pieces: [
    { id: 'tabby-editorial', customerContentId: 'cms-tabby', type: 'editorial', title: 'Tabby', tags: { line: ['Tabby'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
  ] } } },
  { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b1-fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1 } }] } } } },
  { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b1-fixture', note: '', value: {
    holdout: { share: 0, salt: 'w16-b1', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} } } },
];

async function fixturePublication(env: Env, tenant: string, changes: PublicationBaseline[] = []) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w16-b1-fixture', note: '', value } });
  const defaults = [baseline(REFLEX_KIND, { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' }, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }), baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w16-b1', arms: ['default'] } })];
  if (!await env.STORAGE.get('config-publication/v2/' + tenant + '/head.json')) {
    return initializePublicationSet(env, defaults.map(base => changes.find(change => change.kind.name === base.kind.name && change.scope === base.scope) ?? base), '0:' + crypto.randomUUID());
  }
  if (!changes.length) return;
  const pin = await pinPublication(env, tenant), first = changes[0]!, revision = pin.refs[first.kind.name + ':' + first.scope]!.revision;
  const result = await publishSet(env, changes.map(change => ({ kind: change.kind, scope: change.scope, request: change.revision.value, candidate: () => change.revision.value })),
    { actor: 'w16-b1-fixture', expectedRevision: revision, expectedPublication: { revision: pin.revision, digest: pin.digest }, operationId: revision + ':' + crypto.randomUUID() });
  expect(result.ok).toBe(true);
}

function boundary(host: string) {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: 'w16-b1-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'meridian:backend-proof',
    TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'] }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
  } as unknown as Env;
  cache.data.set(`reflex:config:${reflexScopeForTenant(TENANT)}:current`,
    JSON.stringify({ revision: 1, at: 1, actor: 'w16-b1-fixture', note: '', value: { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' } }));
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories(['coach', 'meridian']) });
  env.RETENTION = automaticRetention;
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => {})) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      automaticRetention = JSON.stringify({ version: 1, tenants: policies }); env.RETENTION = automaticRetention;
    } catch { /* a malformed registry still reaches the production refusal */ }
  };
  const ns = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = objects.get(name);
      if (!item) {
        const data = new Map<string, unknown>();
        const alarms: number[] = [], sockets: WebSocket[] = [];
        const storage = {
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
                else for (const [key, item] of Object.entries(values)) candidate.set(key, structuredClone(item));
              },
              deleteAlarm: async () => { deleteAlarm = true; },
              setAlarm: async (at: number) => { nextAlarm = at; },
            } as unknown as DurableObjectTransaction;
            const result = await run(tx);
            data.clear(); for (const [key, value] of candidate) data.set(key, value);
            if (deleteAlarm) alarms.length = 0;
            if (nextAlarm !== undefined) alarms.push(nextAlarm);
            return result;
          },
          deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
          setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null,
        };
        const state = { id: name, storage, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, state, alarms, sockets, shopper: new ShopperReflex(state, env) };
        objects.set(name, item);
      }
      return item.shopper.fetch(new Request(input, init));
    } }),
  };
  env.SHOPPER_REFLEX = ns as unknown as DurableObjectNamespace;
  const app = new Hono<{ Bindings: Env }>();
  // R19: the routes production serves, mounted as `src/index.ts` mounts them.
  app.use('*', tenantMiddleware()); app.route('/realtime', realtimeRoutes); app.route('/v1', decisionRoutes);
  const call = async (path: string, capability?: string, body?: unknown, tenant = TENANT) => {
    await configureRetention();
    const request = new Request(`https://synthetic.invalid${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Tenant': tenant, ...(capability === undefined ? {} : { [SHOPPER_HEADER]: capability }), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} });
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 10)); };
  return { env, app, cache, sessions, objects, call, drain, configureRetention };
}

async function explicitChoice(f: ReturnType<typeof boundary>, grant: Awaited<ReturnType<typeof newAnonymousSession>>) {
  const current = f.objects.get(shopperObjectName(grant.tenant, grant.subject))?.data.get('consent');
  const choice = { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null,
    grantId: grant.grantId, iat: grant.iat, exp: grant.exp };
  const response = await f.call(`/realtime/session/${grant.sessionId}/preferences`,
    grant.capability, { trackingConsent: true, personalizationEnabled: true, choice }, grant.tenant);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { consent?: { tracking: boolean; personalization: boolean; instruction?: ConsentInstruction } };
}

interface HostFixture {
  f: ReturnType<typeof boundary>;
  grant: Awaited<ReturnType<typeof newAnonymousSession>>;
  principal: SessionCapability;
  /**
   * R19: the mounted route production serves — `GET /v1/:tenant/decisions/snapshot`
   * behind `requireShopper`, which enforces `ENTRY_QUERY_LIMIT` and
   * `validEntry(…, true)` and forwards to the shopper's owner before deciding.
   */
  snapshot: (request?: { entry?: ChannelSignals; channel?: string | null })
    => Promise<{ status: number; ok: unknown; state: unknown; decisions: unknown }>;
  /**
   * The same decision one layer in, because no public route exposes the cell:
   * `/v1/:tenant/decisions/snapshot` omits `cell` and `records` in offer mode
   * (`src/routes/decisions.ts:478`). Named `host-internal` per R19; the missing
   * public observable is the `residual` on each row in units.json.
   */
  decide: (request?: { entry?: ChannelSignals; channel?: string | null }) => Promise<{ channel: string; visit_bucket: string }>;
  /** A real accepted page view through the mounted app, on whichever host this fixture runs. */
  action: (entry?: ChannelSignals) => Promise<number>;
  /** The SDK-visible hydrate projection (`GET /realtime/reflex`). */
  projection: () => Promise<unknown>;
}

async function hostFixture(host: 'session' | 'do'): Promise<HostFixture> {
  invalidateCache(); invalidateLiftCache();
  const f = boundary(host);
  const grant = await newAnonymousSession(f.env, TENANT);
  await fixturePublication(f.env, TENANT, documentChanges(TENANT));
  await explicitChoice(f, grant);
  const principal = await verifySessionCapability(f.env, grant.capability, TENANT);
  const decide = async (request: { entry?: ChannelSignals; channel?: string | null } = {}) => {
    // Production reaches this function inside the shopper owner's invocation
    // (requireShopper → forwardShopperRequest → the object's owned operation);
    // the same admission is established here so the real guards run.
    const owner = {};
    const out = await runOwnerOperation(owner, f.env, async () => {
      admitOwnerPrincipal(owner, principal);
      return serveContentDecisions(f.env, {
        tenant: TENANT, page: 'home', visitorId: grant.subject, sessionId: grant.sessionId, cookieHeader: null,
        stateTenant: TENANT, principal, capability: grant.capability, cf: null,
        channel: request.channel ?? null, ...(request.entry === undefined ? {} : { entry: request.entry }),
      });
    }, f.sessions as unknown as Parameters<typeof runOwnerOperation>[3],
    undefined,
    // The owner's own consent source, exactly as ShopperReflex supplies it: the
    // explicit choice this shopper's object actually stored.
    (async () => f.objects.get(shopperObjectName(TENANT, grant.subject))?.data.get('consent')) as unknown as Parameters<typeof runOwnerOperation>[5]);
    await f.drain();
    return { channel: out.cell.channel, visit_bucket: out.cell.visit_bucket };
  };
  const snapshot = async (request: { entry?: ChannelSignals; channel?: string | null } = {}) => {
    // No visitorId/sessionId selectors: the route reads the shopper from the
    // capability (`principal.subject` / `principal.sessionId`).
    const query = '?page=home'
      + (request.entry === undefined ? '' : `&entry=${encodeURIComponent(JSON.stringify(request.entry))}`)
      + (request.channel == null ? '' : `&channel=${encodeURIComponent(request.channel)}`);
    const response = await f.call(`/v1/${TENANT}/decisions/snapshot${query}`, grant.capability);
    const body = await response.clone().json().catch(() => ({})) as { ok?: unknown; decisions?: unknown[]; sources?: { state?: unknown } };
    await f.drain();
    // `state` is the host that actually answered (src/content/service.ts:109,
    // returned at src/routes/decisions.ts:477); `decisions` is how many the
    // route returned, so an empty set cannot pass for a served page.
    return { status: response.status, ok: body.ok, state: body.sources?.state, decisions: body.decisions?.length };
  };
  const action = async (entry?: ChannelSignals) => {
    const response = await f.call('/realtime/action', grant.capability, {
      type: 'page_view', source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
      timestamp: Date.now(), eventId: crypto.randomUUID(), data: {}, ...(entry === undefined ? {} : { entry }),
    });
    await f.drain();
    return response.status;
  };
  const projection = async () => {
    const response = await f.call('/realtime/reflex', grant.capability);
    expect(response.status, await response.clone().text()).toBe(200);
    return ((await response.json()) as { visit?: unknown }).visit;
  };
  return { f, grant, principal, snapshot, decide, action, projection };
}

/** The paid-social arrival the customer's Cross-Channel Awareness row describes. */
const PAID_SOCIAL_ENTRY: ChannelSignals = { utmMedium: 'cpc', utmSource: 'facebook', referrer: 'l.facebook.com', siteHost: SITE };
/** An ordinary organic search return, host-only referrer for the request boundary. */
const SEARCH_ENTRY: ChannelSignals = { utmMedium: '', utmSource: '', referrer: 'www.google.com', siteHost: SITE };
/**
 * A campaign tag nobody in the vocabulary recognises, with no referrer evidence
 * at all: absent, not an empty referrer reported by a real page view. The entry
 * must stay unknown.
 */
const UNKNOWN_ENTRY: ChannelSignals = { utmMedium: 'wombat-unrecognized' };

/** What `documentChanges` publishes for /home: one hero slot, take 1, one live piece. */
const HOME_DECISIONS = 1;
/** The ruled public-route answer for a served home page on the host under test. */
const served = (host: 'session' | 'do') => ({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS });

// ---------------------------------------------------------------------------

describe('unit:W16.C2.01', () => {
  it('logic: an ordinary search referrer with no UTM classifies as organic, for every SEARCH_HOSTS family', () => {
    for (const [family, referrer] of SEARCH_REFERRERS) {
      expect(classifyEntryChannel({ referrer, siteHost: SITE }), `${family}: ${referrer}`).toBe('organic');
    }
    // The same arrival as a bare host, which ChannelSignals.referrer also accepts.
    for (const host of ['www.google.com', 'google.com', 'm.google.com', 'www.bing.com', 'duckduckgo.com']) {
      expect(classifyEntryChannel({ referrer: host, siteHost: SITE }), host).toBe('organic');
    }
  });
});

describe('unit:W16.C2.02', () => {
  it('logic: a lookalike host never classifies as search or social; matching is exact or dot-boundary suffix, never substring or prefix', () => {
    for (const referrer of ['https://google.com.evil.example/search?q=coach', 'https://notgoogle.com/', 'https://evilgoogle.co/',
      'https://www.google.com.evil.example/', 'https://bing.com.attacker.example/', 'https://tiktok.com.evil.example/']) {
      expect(classifyEntryChannel({ referrer, siteHost: SITE }), referrer).toBe('referral');
    }
    // classifyEntryChannel matches the declared utm_source as a host too, so the
    // same boundary rule holds there: a prefixed lookalike is not that network.
    for (const utmSource of ['tiktok.evil.example', 'facebook.attacker.example', 'instagram.evil.example', 'pinterest-lookalike.example']) {
      expect(classifyEntryChannel({ utmMedium: 'social', utmSource, siteHost: SITE }), utmSource).toBe('referral');
    }
    // The genuine exact and dot-boundary matches keep working.
    expect(classifyEntryChannel({ utmMedium: 'social', utmSource: 'tiktok', siteHost: SITE })).toBe('paid_social');
    expect(classifyEntryChannel({ utmMedium: 'social', utmSource: 'facebook', siteHost: SITE })).toBe('paid_social');
  });
});

describe('unit:W16.C2.03', () => {
  it('logic: a social source with a paid medium classifies as paid_social before any paid-search rule', () => {
    for (const utmSource of SOCIAL_SOURCES) {
      for (const utmMedium of PAID_MEDIUMS) {
        expect(classifyEntryChannel({ utmMedium, utmSource, siteHost: SITE }), `${utmSource}/${utmMedium}`).toBe('paid_social');
        // Same declaration, arriving with the network's own referrer.
        expect(classifyEntryChannel({ utmMedium, utmSource, referrer: `https://l.${utmSource}.com/`, siteHost: SITE }),
          `${utmSource}/${utmMedium} with referrer`).toBe('paid_social');
      }
    }
    // A paid medium with a search source is still paid search: the social rule
    // takes precedence only for a social source.
    expect(classifyEntryChannel({ utmMedium: 'cpc', utmSource: 'google', siteHost: SITE })).toBe('paid_search');
  });
});

describe('unit:W16.C2.04', () => {
  it('logic: absent or unrecognized arrival context stays unknown and fabricates no first visit; direct only for an empty or same-site referrer', () => {
    // Nothing known at all: no channel, and no invented visit 1 on the read path.
    expect(projectVisit(undefined, undefined, T0)).toEqual({ visitNumber: null, entryChannel: null });
    expect(projectVisit(null, null, T0)).toEqual({ visitNumber: null, entryChannel: null });
    // Lead ruling R14, both halves: a site host that is empty OR not a valid
    // hostname carries no page-view evidence, so the entry stays unknown —
    // including the SDK's all-empty placeholder. `direct` needs a present,
    // valid site host with an empty or same-site referrer.
    for (const siteHost of ['', 'https://shop.coach.com/', `${SITE}/cart`, 'not a host']) {
      expect(projectVisit(null, null, T0, { utmMedium: '', utmSource: '', referrer: '', siteHost }), `siteHost ${JSON.stringify(siteHost)}`)
        .toEqual({ visitNumber: null, entryChannel: null });
    }
    // An unrecognized medium or source is not evidence of a direct arrival.
    const prior = { visitCount: 2, lastVisitAt: T0, entryChannel: undefined };
    for (const entry of [{ utmMedium: 'wombat-unrecognized' }, { utmSource: 'some-unknown-affiliate' },
      { utmMedium: 'wombat-unrecognized', utmSource: 'some-unknown-affiliate' }] satisfies ChannelSignals[]) {
      expect(projectVisit(prior, T0, T0 + VISIT_GAP_MS, entry), JSON.stringify(entry)).toEqual({ visitNumber: 3, entryChannel: null });
      // The writer opens the visit it is told about and records no entry for it.
      expect(liveVisit(prior, T0, T0 + VISIT_GAP_MS, entry), JSON.stringify(entry))
        .toEqual({ visitCount: 3, lastVisitAt: T0 + VISIT_GAP_MS, entryChannel: undefined });
    }
    // `direct` is reserved for a real page view with an empty or same-site referrer.
    expect(classifyEntryChannel({ referrer: '', siteHost: SITE })).toBe('direct');
    expect(classifyEntryChannel({ referrer: `https://${SITE}/bags/tabby`, siteHost: SITE })).toBe('direct');
    expect(classifyEntryChannel({ referrer: `https://www.${SITE}/bags/tabby`, siteHost: SITE })).toBe('direct');
    expect(liveVisit(prior, T0, T0 + VISIT_GAP_MS, { referrer: '', siteHost: SITE }).entryChannel).toBe('direct');
  });

  it('host: the mounted snapshot route serves an unrecognized arrival instead of refusing it, on both hosts', async () => {
    for (const host of ['session', 'do'] as const) {
      const h = await hostFixture(host);
      // An unrecognized campaign tag is a well-formed arrival context: the
      // public boundary must accept and decide on it. Refusing it at the door
      // is not a way to keep the entry unknown.
      expect(await h.snapshot({ entry: UNKNOWN_ENTRY }), host).toEqual(served(host));
      expect(await h.action(UNKNOWN_ENTRY), host).toBe(200);
      expect(await h.snapshot({ entry: UNKNOWN_ENTRY }), host).toEqual(served(host));
    }
  });

  it('host-internal: an unrecognized arrival leaves the decision cell unknown on both hosts, with no fabricated visit 1', async () => {
    for (const host of ['session', 'do'] as const) {
      const h = await hostFixture(host);
      // Cold shopper, nothing owned: neither dimension may be invented.
      expect(await h.decide({ entry: UNKNOWN_ENTRY }), host).toEqual({ channel: 'unknown', visit_bucket: 'unknown' });
      // A real accepted event carrying the same unrecognized tag must not store
      // a direct entry that the rest of the visit then inherits.
      expect(await h.action(UNKNOWN_ENTRY), host).toBe(200);
      expect(await h.decide({ entry: UNKNOWN_ENTRY }), host).toEqual({ channel: 'unknown', visit_bucket: '1' });
      expect(await h.decide(), host).toEqual({ channel: 'unknown', visit_bucket: '1' });
    }
  });
});

describe('unit:W16.C2.05', () => {
  it('host: the mounted snapshot route serves a request channel, valid or not, on both hosts', async () => {
    for (const host of ['session', 'do'] as const) {
      const h = await hostFixture(host);
      // The channel is a bounded fallback the public route accepts and
      // neutralises internally; it is never a reason to refuse the decision.
      for (const channel of ['email', 'not-a-channel', 'coach-spring-campaign']) {
        expect(await h.snapshot({ channel }), `${host} ${channel}`).toEqual(served(host));
      }
      expect(await h.action(PAID_SOCIAL_ENTRY), host).toBe(200);
      expect(await h.snapshot({ channel: 'email' }), host).toEqual(served(host));
    }
  });

  it('host-internal: an established owned entry channel beats a request-supplied fallback channel on both hosts', async () => {
    for (const host of ['session', 'do'] as const) {
      const h = await hostFixture(host);
      // With nothing owned, the bounded request fallback is all there is — and
      // a fallback outside the six-value vocabulary is not a channel at all.
      expect(await h.decide({ channel: 'email' }), host).toEqual({ channel: 'email', visit_bucket: 'unknown' });
      expect(await h.decide({ channel: 'not-a-channel' }), host).toEqual({ channel: 'unknown', visit_bucket: 'unknown' });
      // The visit's real entry is established by an accepted event.
      expect(await h.action(PAID_SOCIAL_ENTRY), host).toBe(200);
      // From here the caller cannot relabel the visit, by channel or by a later
      // arrival context that belongs to the same visit.
      expect(await h.decide({ channel: 'email' }), host).toEqual({ channel: 'paid_social', visit_bucket: '1' });
      expect(await h.decide({ channel: 'direct', entry: SEARCH_ENTRY }), host).toEqual({ channel: 'paid_social', visit_bucket: '1' });
      expect(await h.decide({ channel: 'not-a-channel' }), host).toEqual({ channel: 'paid_social', visit_bucket: '1' });
    }
  });
});

// The rollover clauses of this unit (the next visit number at the boundary, and
// both dimensions unchanged inside the gap) are GREEN AT SPEC: `projectVisit`
// already advances the read-time boundary. Only the "freshly classified entry
// channel" clause is RED, on the same SEARCH_HOSTS matcher as W16.C2.01. The
// green clauses are the regression guard around the fix.
describe('unit:W16.C2.06', () => {
  it('logic: after VISIT_GAP_MS the next read yields the next visit number and a freshly classified channel; inside the gap both are unchanged', () => {
    const prior = { visitCount: 3, lastVisitAt: T0, entryChannel: 'email' as EntryChannel };
    // Inside the gap the established visit keeps its number and its entry.
    expect(projectVisit(prior, T0, T0 + VISIT_GAP_MS - 1, { referrer: 'https://www.google.com/search?q=coach+tabby', siteHost: SITE }))
      .toEqual({ visitNumber: 3, entryChannel: 'email' });
    expect(projectVisit(prior, T0, T0 + 1, PAID_SOCIAL_ENTRY)).toEqual({ visitNumber: 3, entryChannel: 'email' });
    // At the boundary the read rolls the visit over and classifies the new arrival.
    expect(projectVisit(prior, T0, T0 + VISIT_GAP_MS, { referrer: 'https://www.google.com/search?q=coach+tabby', siteHost: SITE }))
      .toEqual({ visitNumber: 4, entryChannel: 'organic' });
    expect(projectVisit(prior, T0, T0 + VISIT_GAP_MS, PAID_SOCIAL_ENTRY)).toEqual({ visitNumber: 4, entryChannel: 'paid_social' });
    // A rolled-over visit with no arrival context has no entry to inherit.
    expect(projectVisit(prior, T0, T0 + 2 * VISIT_GAP_MS)).toEqual({ visitNumber: 4, entryChannel: null });
    // Reading does not write: the projection is pure and repeatable.
    expect(projectVisit(prior, T0, T0 + VISIT_GAP_MS, PAID_SOCIAL_ENTRY)).toEqual({ visitNumber: 4, entryChannel: 'paid_social' });
    expect(prior).toEqual({ visitCount: 3, lastVisitAt: T0, entryChannel: 'email' });
  });

  it('host: the mounted snapshot route serves the returning arrival on both sides of the gap, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        expect(await h.action(PAID_SOCIAL_ENTRY), host).toBe(200);
        // A read is a read on both sides of the boundary: the public route
        // serves the return visit without a fresh event and without refusing
        // the new arrival context.
        clock.mockReturnValue(T0 + VISIT_GAP_MS - 1);
        expect(await h.snapshot({ entry: SEARCH_ENTRY }), host).toEqual(served(host));
        clock.mockReturnValue(T0 + VISIT_GAP_MS);
        expect(await h.snapshot({ entry: SEARCH_ENTRY }), host).toEqual(served(host));
      }
    } finally { clock.mockRestore(); }
  });

  it('host-internal: both hosts roll the visit over at read time and classify the new arrival', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        expect(await h.action(PAID_SOCIAL_ENTRY), host).toBe(200);
        expect(await h.decide(), host).toEqual({ channel: 'paid_social', visit_bucket: '1' });
        // Inside the gap nothing moves.
        clock.mockReturnValue(T0 + VISIT_GAP_MS - 1);
        expect(await h.decide({ entry: SEARCH_ENTRY }), host).toEqual({ channel: 'paid_social', visit_bucket: '1' });
        // Past the gap the read itself reports the next visit and the new entry.
        clock.mockReturnValue(T0 + VISIT_GAP_MS);
        expect(await h.decide({ entry: SEARCH_ENTRY }), host).toEqual({ channel: 'organic', visit_bucket: '2-3' });
        expect(await h.decide(), host).toEqual({ channel: 'unknown', visit_bucket: '2-3' });
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C2.07', () => {
  /** One identical event sequence per host: a paid-social arrival, then a second page view inside the same visit. */
  async function sameSequence(host: 'session' | 'do', clock: { mockReturnValue: (value: number) => unknown }) {
    clock.mockReturnValue(T0);
    const h = await hostFixture(host);
    expect(await h.action(PAID_SOCIAL_ENTRY), host).toBe(200);
    clock.mockReturnValue(T0 + 60_000);
    expect(await h.action(), host).toBe(200);
    return h;
  }

  it('host: the SDK-visible hydrate snapshot carries the same visit number and entry channel on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const seen: Record<string, unknown> = {};
      for (const host of ['session', 'do'] as const) seen[host] = await (await sameSequence(host, clock)).projection();
      // R20: the public snapshot carries the `projectVisit` shape. The Durable
      // Object's internal `projection=content` shape
      // ({ visitCount, lastVisitAt, entryChannel, lastSeen }) stays internal and
      // never crosses the SDK boundary.
      for (const host of ['session', 'do'] as const) {
        expect(seen[host], host).toEqual({ visitNumber: 1, entryChannel: 'paid_social' });
      }
      expect(seen.session).toEqual(seen.do);
    } finally { clock.mockRestore(); }
  });

  it('host-internal: the SessionManager path and the ShopperReflex path put the same visit number and entry channel on the decision cell', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const seen: Record<string, { channel: string; visit_bucket: string }> = {};
      for (const host of ['session', 'do'] as const) seen[host] = await (await sameSequence(host, clock)).decide();
      // The ruled values for that sequence: the visit the shopper is actually in,
      // and the channel she actually arrived on.
      for (const host of ['session', 'do'] as const) {
        expect(seen[host], host).toEqual({ channel: 'paid_social', visit_bucket: '1' });
      }
      expect(seen.session).toEqual(seen.do);
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C2.08', () => {
  it('sdk: the cached entry is cleared on consent transition, identity-generation change and browsing-session rollover, and entrySessionId names the session that produced it', async () => {
    const f = testHost();
    const core = createCore({ tenant: 'coach' }, f.host);
    expect(await core.ready()).toBe(true);
    // R18: `entrySessionId` is a public read-only member of the `Core` interface
    // (`src/sdk/core.ts:80-116`, beside `readonly entry`), exposed in the
    // regenerated `public/sdk` bundles. It names the browsing session that
    // produced the CACHED entry signals, so a getter returning the current
    // session id does not satisfy it — the rollover step below distinguishes the
    // two. Read directly, with no cast: until the member exists this unit is RED
    // at runtime and the app typecheck reports the ruled missing member.
    const named = () => core.entrySessionId;

    // The arrival this page load actually carries, and the session that produced it.
    expect(core.entry).toEqual({ utmMedium: 'paid_social', utmSource: 'tiktok', referrer: 'https://www.tiktok.com/', siteHost: 'shop.example' });
    expect(named()).toBe(core.sessionId);

    // A later in-page navigation changes the document; the cached entry is the
    // visit's, so it does not follow the URL until something resets it.
    const arrive = (search: string, referrer: string) => {
      f.host.location = { href: `https://shop.example/home${search}`, host: 'shop.example', hostname: 'shop.example', protocol: 'https:', search };
      f.host.referrer = referrer;
    };
    arrive('?utm_source=klaviyo&utm_medium=email', 'https://mail.example/');
    expect(core.entry.utmSource).toBe('tiktok');

    // 1. Consent transition: withdrawn and then chosen again is a new state, and
    // the entry is recomputed from the document that is current at that moment.
    const path = `/realtime/session/${core.profileSessionId}/preferences`;
    const acknowledge = (preferences: Record<string, unknown>, init: Parameters<typeof f.host.fetch>[1]) =>
      ({ ok: true, status: 200, json: async () => preferenceAck(f.host, init, preferences) });
    f.host.fetch = async (_url, init) => acknowledge({ trackingConsent: false, personalizationEnabled: false }, init);
    await core.postJson(path, { trackingConsent: false, personalizationEnabled: false });
    f.host.fetch = async (_url, init) => acknowledge({ trackingConsent: true, personalizationEnabled: true }, init);
    await core.postJson(path, { trackingConsent: true, personalizationEnabled: true });
    expect(core.trackingAllowed).toBe(true);
    expect(core.entry).toEqual({ utmMedium: 'email', utmSource: 'klaviyo', referrer: 'https://mail.example/', siteHost: 'shop.example' });
    expect(named()).toBe(core.sessionId);

    // 2. Identity generation change: a new grant is a new subject's entry.
    arrive('?utm_source=facebook&utm_medium=cpc', 'https://l.facebook.com/');
    const generation = core.beginTransition();
    core.finishTransition(generation);
    expect(core.entry).toEqual({ utmMedium: 'cpc', utmSource: 'facebook', referrer: 'https://l.facebook.com/', siteHost: 'shop.example' });
    expect(named()).toBe(core.sessionId);

    // 3. Browsing-session rollover: an idle gap mints the next browsing session,
    // and the entry belongs to the session that produced it, not to the new one.
    const before = core.sessionId;
    arrive('?utm_source=google&utm_medium=organic', 'https://www.google.com/');
    f.tick(DEFAULT_SESSION_IDLE_MS + 1);
    // Read first, before anything asks for the session id: the cached entry is
    // still the previous session's, so entrySessionId still names it. A member
    // that simply returns the current browsing session fails here.
    expect(named()).toBe(before);
    // The next entry read notices the rollover, clears the cache and recomputes
    // from the document that is current now.
    expect(core.entry).toEqual({ utmMedium: 'organic', utmSource: 'google', referrer: 'https://www.google.com/', siteHost: 'shop.example' });
    const after = core.sessionId;
    expect(after).not.toBe(before);
    expect(named()).toBe(after);
  });
});

describe('unit:W16.C2.09', () => {
  it('logic: the channel vocabulary, the hostname contract and the ENTRY_QUERY_LIMIT are enforced, never truncated into a wrong channel', () => {
    // The six-value vocabulary, and nothing else, is a channel.
    for (const channel of ['direct', 'paid_social', 'paid_search', 'email', 'organic', 'referral'] satisfies EntryChannel[]) {
      expect(entryChannelOf(channel)).toBe(channel);
      expect(entryChannelOf(` ${channel.toUpperCase()} `)).toBe(channel);
    }
    for (const value of ['acceptance', 'monitor', 'unknown', 'social', 'paid', 'organic_search', 'not-a-channel-at-all',
      '', 'direct,email', 'coach-spring-campaign', null, undefined, 7, {}, ['direct']]) {
      expect(entryChannelOf(value), JSON.stringify(value)).toBeNull();
    }

    // A host field carries a hostname. A URL, a path or free text is not one, in
    // either mode, because a bad site host relabels a real arrival.
    expect(validEntry({ referrer: SITE }, true)).toBe(true);
    expect(validEntry({ referrer: `https://www.google.com/search?q=x` }, true)).toBe(false);
    expect(validEntry({ referrer: 'not a host' }, true)).toBe(false);
    expect(validEntry({ siteHost: SITE }, true)).toBe(true);
    expect(validEntry({ siteHost: SITE })).toBe(true);
    for (const siteHost of [`https://${SITE}/`, `${SITE}/cart`, 'not a host', 'shop coach com']) {
      expect(validEntry({ siteHost }, true), `hostOnly ${siteHost}`).toBe(false);
      expect(validEntry({ siteHost }), siteHost).toBe(false);
    }

    // Shapes and field sizes are refused outright, never trimmed into something
    // that would classify.
    for (const value of [null, [], 'entry', { utmMedium: 7 }, { unknown: 'x' }, { utmSource: 'x'.repeat(257) },
      { utmMedium: 'x'.repeat(129) }, { referrer: 'https://x.invalid/' + 'a'.repeat(2048) }]) {
      expect(validEntry(value), JSON.stringify(value)).toBe(false);
    }
    expect(validEntry({ utmSource: 'x'.repeat(256) })).toBe(true);

    // The bounded snapshot contract: within the limit it round-trips host-only;
    // beyond ENTRY_QUERY_LIMIT it is refused rather than truncated.
    const carried = snapshotEntry({ utmMedium: 'cpc', utmSource: 'facebook', referrer: 'https://l.facebook.com/campaign', siteHost: SITE });
    expect(carried).toBeDefined();
    expect(carried!.length).toBeLessThanOrEqual(ENTRY_QUERY_LIMIT);
    expect(JSON.parse(carried!)).toEqual({ utmMedium: 'cpc', utmSource: 'facebook', referrer: 'l.facebook.com', siteHost: SITE });
    expect(snapshotEntry({ referrer: 'a'.repeat(ENTRY_QUERY_LIMIT + 1) })).toBeUndefined();
    expect(validEntry({ referrer: 'a'.repeat(ENTRY_QUERY_LIMIT + 1) }, true)).toBe(false);
  });
});
