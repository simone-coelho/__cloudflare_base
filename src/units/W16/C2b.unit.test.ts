// src/units/W16/C2b.unit.test.ts
// W16 criterion C2, batch W16-B3 — the C2 follow-ups the W16-B1 build review and
// build report named: source aliases, country-code networks, a bare paid medium,
// site-host acceptance, trailing-dot hosts and the documentation of the shipped
// entry contract.
//
// One `describe('unit:W16.C2.1N')` per unit, one `it` per ruled leg. Every
// expected value comes from the W16-B3 ruling table in
// `docs/remediation/LANE-LOG.md` (rulings R14, R18, R19, R20, R24, R25 and R27),
// the admitted
// C2 text in `docs/handover/HANDOFF-2026-09-18.md` §5, document 35 §5 W16 / §2
// F13 and the customer's Cross-Channel Awareness row
// (`docs/architecture/tapestry_requirements.txt`:157) — never from what the
// engine returns today. The W16-B1 build classifies `www.google.co.uk` as
// `referral`, `facebook_ads` + `cpc` as `paid_search` and refuses a ported site
// host at the public boundary; those are the behaviors these units rule out.
//
// The host leg drives the real mounted app and the real ShopperReflex class in
// process on BOTH hosts through the routes production serves (R19), in the
// pattern of `src/units/W16/C2.unit.test.ts` and
// `src/routes/realtime.sdkContract.test.ts`; neither suite is imported.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';

import {
  VISIT_GAP_MS, classifyEntryChannel, liveVisit, projectVisit, snapshotEntry, validEntry,
  type ChannelSignals,
} from '@/services/visit';

import type { Env } from '@/types/env';
import realtimeRoutes from '@/routes/realtime';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent, type ConsentInstruction } from '@/content/consent';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { initializePublicationSet, pinPublication, publishSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { configuredDestinations } from '@/connectors/config';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

// ---------------------------------------------------------------------------
// Customer-shaped fixtures. Coach's own storefront host, the markets the
// customer's Cross-Channel Awareness row cares about (a UK shopper arriving from
// google.co.uk, a Japanese shopper from search.yahoo.co.jp) and the campaign
// source spellings a real Meta/TikTok campaign builder emits; lookalike and
// unknown inputs are part of the fixture, not an afterthought.
// ---------------------------------------------------------------------------

const SITE = 'shop.coach.com';
const T0 = 1_725_000_000_000;

/** The same storefront, reported with its port — `location.host`, not `location.hostname`. */
const PORTED = `${SITE}:8080`;
/** An internationalized storefront host; URL parsing normalizes it to `xn--80aairftm.coach.xn--p1ai`. */
const IDN = 'магазин.coach.рф';
/** That host's ASCII form, which the entry contract already accepts today. */
const IDN_ASCII = 'xn--80aairftm.coach.xn--p1ai';

/** A prior visit to roll over from, so the storing path's answer is observable. */
const PRIOR = { visitCount: 2, lastVisitAt: T0, entryChannel: undefined };
const ROLLOVER = T0 + VISIT_GAP_MS;

// ---------------------------------------------------------------------------
// Host fixture — the real app, the real SessionManager path and the real
// ShopperReflex class, one construction per host.
// ---------------------------------------------------------------------------

const TENANT = 'meridian';

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w16-b3-fixture-policy', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' };
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
  { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b3-fixture', note: '', value: { pieces: [
    { id: 'tabby-editorial', customerContentId: 'cms-tabby', type: 'editorial', title: 'Tabby', tags: { line: ['Tabby'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
  ] } } },
  { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b3-fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1 } }] } } } },
  { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b3-fixture', note: '', value: {
    holdout: { share: 0, salt: 'w16-b3', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} } } },
];

async function fixturePublication(env: Env, tenant: string, changes: PublicationBaseline[] = []) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w16-b3-fixture', note: '', value } });
  const defaults = [baseline(REFLEX_KIND, { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' }, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }), baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w16-b3', arms: ['default'] } })];
  if (!await env.STORAGE.get('config-publication/v2/' + tenant + '/head.json')) {
    return initializePublicationSet(env, defaults.map(base => changes.find(change => change.kind.name === base.kind.name && change.scope === base.scope) ?? base), '0:' + crypto.randomUUID());
  }
  if (!changes.length) return;
  const pin = await pinPublication(env, tenant), first = changes[0]!, revision = pin.refs[first.kind.name + ':' + first.scope]!.revision;
  const result = await publishSet(env, changes.map(change => ({ kind: change.kind, scope: change.scope, request: change.revision.value, candidate: () => change.revision.value })),
    { actor: 'w16-b3-fixture', expectedRevision: revision, expectedPublication: { revision: pin.revision, digest: pin.digest }, operationId: revision + ':' + crypto.randomUUID() });
  expect(result.ok).toBe(true);
}

function boundary(host: string) {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: 'w16-b3-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'meridian:backend-proof',
    TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'] }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
  } as unknown as Env;
  cache.data.set(`reflex:config:${reflexScopeForTenant(TENANT)}:current`,
    JSON.stringify({ revision: 1, at: 1, actor: 'w16-b3-fixture', note: '', value: { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' } }));
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
  /**
   * R19: the mounted route production serves — `GET /v1/:tenant/decisions/snapshot`
   * behind `requireShopper`, which enforces `ENTRY_QUERY_LIMIT` and
   * `validEntry(…, true)` before deciding.
   */
  snapshot: (request?: { entry?: ChannelSignals }) => Promise<{ status: number; ok: unknown; state: unknown; decisions: unknown }>;
  /** A real accepted page view through the mounted app, on whichever host this fixture runs. */
  action: (entry?: ChannelSignals) => Promise<number>;
  /** The SDK-visible hydrate projection (`GET /realtime/reflex`), R20's `visit` shape. */
  projection: () => Promise<unknown>;
}

async function hostFixture(host: 'session' | 'do'): Promise<HostFixture> {
  invalidateCache(); invalidateLiftCache();
  const f = boundary(host);
  const grant = await newAnonymousSession(f.env, TENANT);
  await fixturePublication(f.env, TENANT, documentChanges(TENANT));
  await explicitChoice(f, grant);
  const snapshot = async (request: { entry?: ChannelSignals } = {}) => {
    // No visitorId/sessionId selectors: the route reads the shopper from the
    // capability (`principal.subject` / `principal.sessionId`).
    const query = '?page=home' + (request.entry === undefined ? '' : `&entry=${encodeURIComponent(JSON.stringify(request.entry))}`);
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
  return { f, grant, snapshot, action, projection };
}

/** What `documentChanges` publishes for /home: one hero slot, take 1, one live piece. */
const HOME_DECISIONS = 1;
/** The ruled public-route answer for a served home page on the host under test. */
const served = (host: 'session' | 'do') => ({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS });

/**
 * A repository document, read with inline code ticks removed so that `siteHost`
 * and siteHost are the same statement and the ruled phrase is about content, not
 * markup style.
 */
const prose = (relative: string) => readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8').replace(/`/g, '');

// ---------------------------------------------------------------------------

describe('unit:W16.C2.10', () => {
  it('logic: known networks on country-code and multi-label public suffixes classify as organic, and their lookalikes stay referral', () => {
    // The W16-B3 ruled set: the same networks as SEARCH_HOSTS, reached from the
    // markets the customer's Cross-Channel Awareness row covers
    // (tapestry_requirements.txt:157). A UK shopper's google.co.uk arrival is
    // organic search, not a referral from a stranger's site.
    for (const referrer of [
      'https://www.google.co.uk/search?q=coach%20tabby%20handbag',
      'https://google.com.co/search?q=coach',
      'https://google.de/search?q=coach+tasche',
      'https://search.yahoo.co.jp/search?p=coach',
      'https://yandex.ru/search/?text=coach+bags',
    ]) expect(classifyEntryChannel({ referrer, siteHost: SITE }), referrer).toBe('organic');

    // The same arrivals as bare hosts, and as dot-boundary subdomains of the
    // same ruled patterns — the matcher contract visit.ts already states for
    // google.com (units W16.C2.01 and W16.C2.02).
    for (const referrer of ['google.co.uk', 'www.google.co.uk', 'images.google.co.uk', 'www.google.com.co',
      'www.google.de', 'search.yahoo.co.jp', 'www.yandex.ru']) {
      expect(classifyEntryChannel({ referrer, siteHost: SITE }), referrer).toBe('organic');
    }

    // An explicit per-network pattern list, never a generic "strip the last two
    // or three labels" suffix rule: a stranger who registers the pattern as a
    // prefix, as a subdomain or on the same public suffix is still a referral.
    for (const referrer of ['https://google.com.co.evil.example/search?q=coach', 'https://evilgoogle.co.uk/',
      'https://google.co.uk.attacker.example/', 'https://notgoogle.co.uk/', 'https://yandex.ru.attacker.example/',
      'https://coach-outlet.co.uk/', 'https://yahoo.co.jp.evil.example/']) {
      expect(classifyEntryChannel({ referrer, siteHost: SITE }), referrer).toBe('referral');
    }
  });
});

describe('unit:W16.C2.11', () => {
  it('logic: a bare paid or cpm medium with no recognized network source stays unknown and never defaults to paid_search', () => {
    // "Unknown" is the representation unit W16.C2.04 already fixed: the reader
    // projects a null entry channel and the writer records none. A bare `paid`
    // or `cpm` names no network, so there is no paid cell it can honestly join.
    for (const entry of [
      { utmMedium: 'paid' },
      { utmMedium: 'cpm' },
      { utmMedium: 'paid', siteHost: SITE },
      { utmMedium: 'cpm', siteHost: SITE },
      { utmMedium: 'paid', utmSource: 'some-unknown-affiliate' },
      { utmMedium: 'cpm', utmSource: 'wombat-network', siteHost: SITE },
      { utmMedium: ' Paid ', utmSource: '' },
    ] satisfies ChannelSignals[]) {
      expect(projectVisit(PRIOR, T0, ROLLOVER, entry), JSON.stringify(entry)).toEqual({ visitNumber: 3, entryChannel: null });
      expect(liveVisit(PRIOR, T0, ROLLOVER, entry), JSON.stringify(entry))
        .toEqual({ visitCount: 3, lastVisitAt: ROLLOVER, entryChannel: undefined });
    }

    // The contrast the ruling turns on (R27(b)): a RECOGNIZED network source is
    // what makes a bare paid click attributable, and the two paid cells stay
    // discriminated. A recognized SEARCH network name as the source token — the
    // same networks as SEARCH_HOSTS — is paid search; a recognized social
    // network or alias is paid social; no recognized network stays unknown.
    expect(projectVisit(PRIOR, T0, ROLLOVER, { utmMedium: 'paid', utmSource: 'facebook', siteHost: SITE }))
      .toEqual({ visitNumber: 3, entryChannel: 'paid_social' });
    expect(projectVisit(PRIOR, T0, ROLLOVER, { utmMedium: 'cpm', utmSource: 'instagram', siteHost: SITE }))
      .toEqual({ visitNumber: 3, entryChannel: 'paid_social' });
    expect(projectVisit(PRIOR, T0, ROLLOVER, { utmMedium: 'paid', utmSource: 'google', siteHost: SITE }))
      .toEqual({ visitNumber: 3, entryChannel: 'paid_search' });
    expect(projectVisit(PRIOR, T0, ROLLOVER, { utmMedium: 'paid', utmSource: 'bing', siteHost: SITE }))
      .toEqual({ visitNumber: 3, entryChannel: 'paid_search' });
    expect(projectVisit(PRIOR, T0, ROLLOVER, { utmMedium: 'cpm', utmSource: 'yandex', siteHost: SITE }))
      .toEqual({ visitNumber: 3, entryChannel: 'paid_search' });
    // A medium that declares paid SEARCH still names the cell it declares.
    expect(projectVisit(PRIOR, T0, ROLLOVER, { utmMedium: 'cpc', utmSource: 'google', siteHost: SITE }))
      .toEqual({ visitNumber: 3, entryChannel: 'paid_search' });
  });
});

describe('unit:W16.C2.12', () => {
  it('logic: token-form source aliases identify the network, and a host-form source is judged only by the host rule', () => {
    // The spellings a real Meta/TikTok/Pinterest campaign builder emits. A token
    // equal to a network name or to a listed alias IS that network, so a paid
    // medium puts the click in the paid-social cell (W16-B3 table; F13 §5.H).
    for (const utmSource of ['facebook_ads', 'fb_ads', 'fb', 'ig', 'instagram_stories', 'meta_ads', 'tiktok_ads', 'pinterest_ads']) {
      for (const utmMedium of ['cpc', 'ppc', 'paid', 'paid_social', 'cpm']) {
        expect(classifyEntryChannel({ utmMedium, utmSource, siteHost: SITE }), `${utmSource}/${utmMedium}`).toBe('paid_social');
      }
    }

    // The ruled token split (R27(a)): `_`, `-` and whitespace, on the trimmed,
    // lower-cased source (the normalization W16.C2.03 already relies on). `.` is
    // NOT a token separator: a dotted source is host-form, below.
    for (const utmSource of ['Facebook Ads', 'TikTok-Ads', 'FB_Ads', ' meta ads ', 'pinterest ads']) {
      expect(classifyEntryChannel({ utmMedium: 'cpc', utmSource, siteHost: SITE }), utmSource).toBe('paid_social');
    }

    // The alias identifies the NETWORK, not one medium's special case: the bare
    // `social` medium rule in visit.ts then reads it exactly as it reads the
    // bare network name in unit W16.C2.02.
    expect(classifyEntryChannel({ utmMedium: 'social', utmSource: 'fb_ads', siteHost: SITE })).toBe('paid_social');

    // R27(a): a dotted, HOST-form source is judged ONLY by the host rule (exact
    // or dot-boundary, unit W16.C2.02), never by its tokens — a stranger's host
    // that merely contains a network token is not that network and stays out of
    // the paid-social cell. With an explicitly paid-search medium it is paid
    // search.
    for (const utmSource of ['facebook.attacker.example', 'tiktok-ads.evil.example', 'instagram.com.evil.example']) {
      expect(classifyEntryChannel({ utmMedium: 'cpc', utmSource, siteHost: SITE }), utmSource).toBe('paid_search');
    }

    // …and the genuine host forms keep naming their network.
    for (const utmSource of ['facebook.com', 'l.facebook.com', 'www.tiktok.com']) {
      expect(classifyEntryChannel({ utmMedium: 'cpc', utmSource, siteHost: SITE }), utmSource).toBe('paid_social');
    }
  });
});

describe('unit:W16.C2.13', () => {
  it('logic: the entry contract accepts hostname[:port] and an internationalized site host, ignores the port for the same-site comparison, and still refuses a URL or free text', () => {
    // A storefront that reports `location.host` rather than `location.hostname`,
    // and an internationalized storefront: both are hostnames a real integrator
    // sends, and both must reach the classifier instead of being refused.
    for (const siteHost of [PORTED, IDN, IDN_ASCII, `${SITE}:443`, 'localhost:8787']) {
      expect(validEntry({ siteHost }), `loose ${siteHost}`).toBe(true);
      expect(validEntry({ siteHost }, true), `hostOnly ${siteHost}`).toBe(true);
    }

    // Still refused in both modes: a scheme, a path, a query, free text, and
    // anything that is not the hostname[:port] form — a port URL parsing itself
    // refuses is not a port (unit W16.C2.09 keeps the rest of the contract).
    for (const siteHost of [`https://${SITE}`, `${SITE}/cart`, `${SITE}?utm_source=x`, 'not a host', 'shop coach com',
      `${SITE}:notaport`, `${SITE}:99999`, `${PORTED}/cart`]) {
      expect(validEntry({ siteHost }), `loose ${siteHost}`).toBe(false);
      expect(validEntry({ siteHost }, true), `hostOnly ${siteHost}`).toBe(false);
    }

    // The port is not part of the site's identity: a same-site referrer is
    // internal navigation whether or not the page reported a port (R14's
    // `direct` — a real page view on the site's own host).
    expect(classifyEntryChannel({ referrer: `https://${SITE}/bags/tabby`, siteHost: PORTED })).toBe('direct');
    expect(classifyEntryChannel({ referrer: `https://www.${SITE}/bags/tabby`, siteHost: PORTED })).toBe('direct');
    // An external arrival on a ported site host is still classified as itself.
    expect(classifyEntryChannel({ referrer: 'https://www.google.com/search?q=coach+tabby', siteHost: PORTED })).toBe('organic');

    // The internationalized host is compared in the ASCII form URL parsing
    // produces, so the unicode spelling and the punycode spelling are one site.
    expect(classifyEntryChannel({ referrer: `https://${IDN}/сумки`, siteHost: IDN })).toBe('direct');
    expect(classifyEntryChannel({ referrer: IDN_ASCII, siteHost: IDN })).toBe('direct');
    expect(classifyEntryChannel({ referrer: `https://${IDN}/сумки`, siteHost: IDN_ASCII })).toBe('direct');
    expect(classifyEntryChannel({ referrer: 'https://www.google.com/search?q=coach', siteHost: IDN })).toBe('organic');

    // The storing path records that arrival instead of dropping it as unreadable
    // (the W16-B1 build answers `null` here because the site host is refused).
    expect(projectVisit(PRIOR, T0, ROLLOVER, { referrer: 'https://www.google.com/search?q=coach+tabby', siteHost: PORTED }))
      .toEqual({ visitNumber: 3, entryChannel: 'organic' });
    expect(projectVisit(PRIOR, T0, ROLLOVER, { referrer: '', siteHost: PORTED })).toEqual({ visitNumber: 3, entryChannel: 'direct' });
    expect(projectVisit(PRIOR, T0, ROLLOVER, { referrer: '', siteHost: IDN })).toEqual({ visitNumber: 3, entryChannel: 'direct' });

    // The bounded snapshot contract carries the ported arrival and it round-trips
    // to the same answer (unit W16.C2.09: only the referrer is reduced to a host).
    const carried = snapshotEntry({ referrer: `https://${SITE}/bags/tabby`, siteHost: PORTED });
    expect(typeof carried, 'a ported site host must survive the bounded snapshot contract').toBe('string');
    const round = JSON.parse(carried!) as ChannelSignals;
    expect(validEntry(round, true)).toBe(true);
    expect(classifyEntryChannel(round)).toBe('direct');
  });

  it('host: the public boundary answers 200 for a ported site host and an internationalized site host, on both hosts', async () => {
    for (const host of ['session', 'do'] as const) {
      // The fixture's own control, on the plain hostname the SDK sends today:
      // this is the answer the two ruled site-host forms must also get, so the
      // unit fails on the site host and never on the harness.
      const control = await hostFixture(host);
      expect(await control.action({ referrer: `https://${SITE}/bags/tabby`, siteHost: SITE }), `${host} control action`).toBe(200);
      expect(await control.snapshot({ entry: { referrer: 'www.google.com', siteHost: SITE } }), `${host} control snapshot`).toEqual(served(host));
      expect(await control.projection(), `${host} control hydrate`).toEqual({ visitNumber: 1, entryChannel: 'direct' });
      // The boundary still refuses a site host that is a URL: accepting the
      // hostname[:port] form is not a licence to stop validating entry input.
      expect(await control.action({ referrer: `https://${SITE}/bags/tabby`, siteHost: `https://${SITE}/` }), `${host} URL site host`).toBe(400);
      expect(await control.action({ referrer: `https://${SITE}/bags/tabby`, siteHost: 'not a host' }), `${host} free-text site host`).toBe(400);

      for (const [siteHost, hostname] of [[PORTED, SITE], [IDN, IDN]] as const) {
        const h = await hostFixture(host);
        // A real page view on the shopper's own storefront, reported with the
        // port or in unicode. The live-event door must accept it…
        expect(await h.action({ referrer: `https://${hostname}/bags/tabby`, siteHost }), `${host} action ${siteHost}`).toBe(200);
        // …the decisions snapshot must serve the page with the same site host…
        expect(await h.snapshot({ entry: { referrer: 'www.google.com', siteHost } }), `${host} snapshot ${siteHost}`).toEqual(served(host));
        // …and R20's hydrate must show the visit that arrival opened: the port
        // and the unicode spelling are not part of the site's identity, so the
        // same-site page view is `direct`.
        expect(await h.projection(), `${host} hydrate ${siteHost}`).toEqual({ visitNumber: 1, entryChannel: 'direct' });
      }
    }
  });
});

describe('unit:W16.C2.14', () => {
  it('logic: a trailing-dot fully-qualified host is normalized by stripping the root label, for referrer and site hosts', () => {
    // A browser that reports the fully-qualified form of the same search host.
    for (const referrer of ['https://www.google.com./search?q=coach+tabby', 'www.google.com.', 'google.com.', 'https://duckduckgo.com./?q=coach']) {
      expect(classifyEntryChannel({ referrer, siteHost: SITE }), referrer).toBe('organic');
    }

    // The same normalization on the site host, so a fully-qualified storefront
    // host does not turn internal navigation into an external referral (R14).
    expect(classifyEntryChannel({ referrer: `https://${SITE}/bags/tabby`, siteHost: `${SITE}.` })).toBe('direct');
    expect(classifyEntryChannel({ referrer: `https://${SITE}./bags/tabby`, siteHost: SITE })).toBe('direct');
    expect(classifyEntryChannel({ referrer: `https://${SITE}./bags/tabby`, siteHost: `${SITE}.` })).toBe('direct');
    expect(classifyEntryChannel({ referrer: `https://www.${SITE}./bags/tabby`, siteHost: `${SITE}.` })).toBe('direct');

    // Stripping the root label does not loosen the dot-boundary rule (W16.C2.02).
    for (const referrer of ['https://google.com.evil.example./', 'https://evilgoogle.com./', 'https://notgoogle.com./']) {
      expect(classifyEntryChannel({ referrer, siteHost: SITE }), referrer).toBe('referral');
    }

    // A fully-qualified site host is a hostname at the boundary…
    expect(validEntry({ siteHost: `${SITE}.` }, true)).toBe(true);
    expect(validEntry({ referrer: 'www.google.com.' }, true)).toBe(true);
    // …the bounded snapshot contract carries the arrival to the same answer…
    const carried = snapshotEntry({ referrer: 'https://www.google.com./search?q=coach+tabby', siteHost: SITE });
    expect(typeof carried, 'a fully-qualified referrer must survive the bounded snapshot contract').toBe('string');
    expect(classifyEntryChannel(JSON.parse(carried!) as ChannelSignals)).toBe('organic');
    // …and the storing path records the search arrival it is evidence of.
    expect(projectVisit(PRIOR, T0, ROLLOVER, { referrer: 'https://www.google.com./search?q=coach+tabby', siteHost: SITE }))
      .toEqual({ visitNumber: 3, entryChannel: 'organic' });
    expect(projectVisit(PRIOR, T0, ROLLOVER, { referrer: `https://${SITE}./bags/tabby`, siteHost: SITE }))
      .toEqual({ visitNumber: 3, entryChannel: 'direct' });
  });
});

describe('unit:W16.C2.15', () => {
  it('logic: the REST endpoint reference and the kit API reference state the shipped entry contract', () => {
    const rest = prose('docs/api/01-rest-endpoints.md');

    // 1. R20 and unit W16.C2.07: the hydrate carries the shopper's visit
    // projection, so the row that states the GET /realtime/reflex response shape
    // names both fields of its `visit` object.
    const reflexRow = rest.split('\n').find(line => line.includes('GET /realtime/reflex'));
    expect(typeof reflexRow, 'docs/api/01-rest-endpoints.md must document GET /realtime/reflex').toBe('string');
    for (const field of ['visitNumber', 'entryChannel']) {
      expect(reflexRow!, `the GET /realtime/reflex response shape must name the hydrate visit field ${field}`).toContain(field);
    }

    // 2. Unit W16.C2.13: the site host is a hostname, in the hostname[:port]
    // form the engine now accepts — never a URL, a path or free text.
    expect(rest, 'the entry paragraph must state the siteHost hostname requirement').toContain('siteHost must be a hostname');
    expect(rest, 'the entry paragraph must state the hostname[:port] form unit W16.C2.13 ships').toContain('hostname[:port]');

    // 3. R14 and unit W16.C2.04: an empty or invalid site host carries no
    // page-view evidence, so it is unknown rather than direct. The sentence that
    // speaks about observed empty strings is the one that must say so — pinning
    // the line, not only the phrase, so a reworded false claim in the same
    // sentence cannot survive beside a correct one elsewhere.
    expect(rest, 'the entry paragraph must state R14: an empty or invalid siteHost stays unknown, never direct')
      .toContain('stays unknown, never direct');
    const emptyStrings = rest.split('\n').find(line => line.includes('empty strings'));
    expect(typeof emptyStrings, 'docs/api/01-rest-endpoints.md must still state what an observed empty string does').toBe('string');
    expect(emptyStrings!, 'the sentence about observed empty strings must be the R14 statement')
      .toContain('stays unknown, never direct');
    // The two superseded claims at docs/api/01-rest-endpoints.md:32 are the ones
    // the engine contradicts; the ruled outcome is their removal, and the
    // positive statements above are what this unit is satisfied by.
    expect(rest, 'the superseded "observed empty strings may classify as direct" claim must be gone')
      .not.toContain('may classify as direct');
    expect(rest, 'the superseded "Existing classifier mappings are unchanged." claim must be gone: units W16.C2.10, .11 and .12 change them')
      .not.toContain('Existing classifier mappings are unchanged');

    // 4. R18: `entrySessionId` is a public read-only observable on the SDK core
    // naming the browsing session that produced the cached entry signals, so the
    // integration kit documents it.
    const kit = prose('docs/kit/02-api-reference.md');
    expect(kit, 'docs/kit/02-api-reference.md must document entrySessionId on the SDK core').toContain('entrySessionId');
    expect(kit, 'entrySessionId must be documented as the session that produced the cached entry signals')
      .toContain('browsing session that produced the cached entry');
  });
});
