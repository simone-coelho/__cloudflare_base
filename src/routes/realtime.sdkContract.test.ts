// src/routes/realtime.sdkContract.test.ts
// The SDK's wire table against the server's own validator: every event the SDK
// can send must parse through actionEventSchema exactly as POST /realtime/action
// would parse it. When the server learns a new first-class type, the SDK row
// changes and this test is what says the two still agree.

import { describe, it, expect, vi } from 'vitest';
import { actionEventSchema } from './realtime';
import { createCore } from '../sdk/core';
import { createEmit } from '../sdk/emit';
import { createListen } from '../sdk/listen';
import { memoryHost } from '../sdk/memoryHost';
import { authorityLocks } from '../sdk/testHost';
import { WIRE } from '../sdk/wire';
import type { SdkEventType } from '../sdk/types';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import realtimeRoutes from './realtime';
import { identityRoutes } from './identity';
import { decisionRoutes } from './decisions';
import { sortRoutes } from './sort';
import { tenantMiddleware } from '@/tenancy/middleware';
import { SessionManager, type SessionData } from '@/services/SessionManager';
import { ShopperReflex, type AffinityRecord, type PipelineRecord } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, issueSessionCapability, signSessionCapability, SHOPPER_HEADER, verifySessionCapability, SessionAccessError, type SessionCapability } from '@/identity/sessionCapability';
import { SignJWT } from 'jose';
import { shopperObjectName } from '@/tenancy/objects';
import { signAssertion } from '@/identity/assertion';
import { tenantKey } from '@/tenancy/tenant';
import { createIdentity } from '@/sdk/identify';
import { invalidateCache, write } from '@/config/versionedStore';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import { trackingRoutes } from './tracking';
import * as requestContext from '@/utils/context';
import { optimizelyRoutes } from './optimizely';
import { OptimizelyService } from '@/services/OptimizelyService';
import optimizelySdk from '@optimizely/optimizely-sdk/lite';
import { MockSegmentProvider } from '@/connectors/SegmentProvider';
import { LiveDecisionProvider, MockDecisionProvider } from '@/connectors/DecisionProvider';
import { KvAudienceStore } from '@/connectors/AudienceStore';
import { FeatureVariableManager } from '@/services/FeatureVariableManager';
import * as demoRegistry from '@/demos/registry';
import operatorRoutes from './operator';
import { operatorWrites } from '@/middleware/edgeAccess';
import { getConnectors, type AudienceDef } from '@/connectors';
import { RealtimeSegmentEngine, ensureAudiencesSeeded } from '@/services/RealtimeSegmentEngine';
import { CatalogService } from '@/services/CatalogService';
import { RegionTrend } from '@/durable-objects/RegionTrend';
import { objectName as regionObjectName, trendKey, readTrend, invalidateTrendCache, type IngestFrame } from '@/reflex/regionTrend';
import { DEFAULT_REFLEX_CONFIG, emptyState, audienceKey, nextCrossing, tick as tickReflex, type ReflexConfig } from '@/reflex/core';
import { reflexScopeForTenant, writeReflexConfig, readReflexConfigRevision, REFLEX_KIND, ReflexConfigUnavailableError } from '@/reflex/configStore';
import { applyHistory, parseHistoryCsv, type HistoryReport } from '@/identity/history';
import { memoryStore, type OperationAuditDetail, type AuditEntry } from '@/auth/store';
import * as historyModule from '@/identity/history';
import { linkVisitor } from '@/identity/link';
import { type ProfileRow, readEnrichment } from '@/identity/profileEnrichment';
import { eraseSubject, erasureJobKey } from '@/identity/erase';
import { outcomeFromAction, parseId, type OutcomeRecord } from '@/ledger/records';
import { initializePublication, initializePublicationSet, pinPublication, publicationScope, publishSet, PublicationError, type PublicationBaseline } from '@/config/publication';
import { VISIT_GAP_MS } from '@/services/visit';
import { shopperIdFor } from '@/identity/shopperId';
import * as odpLoop from '@/services/odpLoop';
import { admitOwnerPrincipal, ownerEnvironment, ownerFetch, runOwnerOperation, sessionAuthorityKV } from '@/identity/sessionAuthority';
import { CONSENT_LIFETIME_MS, CONSENT_SWITCHES, storedConsent, type Consent, type ConsentInstruction } from '@/content/consent';
import { configuredDestinations } from '@/connectors/config';
import { retentionBirth, externalRetentionBirths, type RetentionPolicy, type RetentionCategory } from '@/retention';
import { PersonalizationWebSocket } from '@/durable-objects/PersonalizationWebSocket';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import type { OwnerRecovery } from '@/ledger/recovery';

const fixtureRetentionPolicy: RetentionPolicy = { id: 'explicit-fixture-policy', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

class BoundaryKV {
  data = new Map<string, string>();
  calls: string[] = [];
  failRead = false; failWrite = false;
  async get(key: string, type?: string) { this.calls.push(`get:${key}`); if (this.failRead) throw new Error('synthetic read failure'); const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v; }
  async put(key: string, value: string) { this.calls.push(`put:${key}`); if (this.failWrite) throw new Error('synthetic write failure'); this.data.set(key, value); }
  async delete(key: string) { this.calls.push(`delete:${key}`); this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) { this.calls.push('list');
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) }; }
}
class BoundaryR2 {
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
// Explicit test-authored W11 baseline, never promotion of mutable compatibility KV.
async function fixturePublication(env: Env, tenant: string, changes: PublicationBaseline[] = []) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'synthetic-fixture', note: '', value } });
  const defaults = [baseline(REFLEX_KIND, { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' }, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }), baseline(LEARN_KIND, { holdout: { share: 0, salt: 'fixture', arms: ['default'] } })];
  if (!await env.STORAGE.get('config-publication/v2/' + tenant + '/head.json')) {
    return initializePublicationSet(env, defaults.map(base => changes.find(change => change.kind.name === base.kind.name && change.scope === base.scope) ?? base), '0:' + crypto.randomUUID());
  }
  if (!changes.length) return;
  const pin = await pinPublication(env, tenant), first = changes[0]!, revision = pin.refs[first.kind.name + ':' + first.scope]!.revision;
  const result = await publishSet(env, changes.map(change => ({ kind: change.kind, scope: change.scope, request: change.revision.value, candidate: () => change.revision.value })),
    { actor: 'synthetic-fixture', expectedRevision: revision, expectedPublication: { revision: pin.revision, digest: pin.digest }, operationId: revision + ':' + crypto.randomUUID() });
  expect(result.ok).toBe(true);
}
// Every configuration write is preconditioned on the authored document revision
// and the coherent publication identity (src/config/publication.ts:66-73, :76-88).
async function fixtureMeta(env: Env, kind: { name: string }, scope: string, actor: string) {
  const pin = await pinPublication(env, publicationScope(kind, scope)), revision = pin.refs[kind.name + ':' + scope]!.revision;
  return { actor, expectedRevision: revision, expectedPublication: { revision: pin.revision, digest: pin.digest },
    operationId: revision + ':' + crypto.randomUUID() };
}
function boundary(host = 'session') {
  const cache = new BoundaryKV(), sessions = new BoundaryKV(), effects: string[] = [];
  // Explicit authored compatibility fixtures keep earlier safety positives on
  // event-carried customer attributes. W37.04/05 replace these for their policies.
  for (const tenant of ['meridian', 'kate-spade', 'brighthour', 'harbor']) cache.data.set(
    `reflex:config:${reflexScopeForTenant(tenant)}:current`,
    JSON.stringify({ revision: 1, at: 1, actor: 'synthetic-compatibility', note: '', value: { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' } }),
  );
  const pending: Promise<unknown>[] = [];
  const faults: { read: boolean; write: boolean; audienceWrite: boolean; refusedAudienceWrites: number; recoveryPut?: () => Promise<void> } = { read: false, write: false, audienceWrite: false, refusedAudienceWrites: 0 };
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    // Learning requires an explicit erasure-state read; this synthetic store has no tombstones.
    STORAGE: new BoundaryR2(),
    JWT_SECRET: 'w0402-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'meridian:backend-proof',
    TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'] }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => { effects.push('capture'); return { bind: () => ({ run: async () => ({ success: true }) }) }; } },
  } as unknown as Env;
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories(['coach', 'meridian']) });
  env.RETENTION = automaticRetention;
  // Explicit synthetic configuration before the real producer's birth. Never
  // attach stamps to a received/raw profile or override a case's chosen policy.
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => {})) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      automaticRetention = JSON.stringify({ version: 1, tenants: policies }); env.RETENTION = automaticRetention;
    } catch { /* A malformed registry/config still reaches the production refusal. */ }
  };
  const ns = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      effects.push(`object:${name}`);
      let item = objects.get(name);
      if (!item) {
        const data = new Map<string, unknown>();
        const alarms: number[] = [], sockets: WebSocket[] = [];
        const storage = {
          get: async (k: string | string[]) => { if (faults.read) throw new Error('synthetic read failure'); return structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)); },
          put: async (k: string | Record<string, unknown>, v?: unknown) => {
            const keys = typeof k === 'string' ? [k] : Object.keys(k); effects.push(...keys.map(key => 'store:' + key));
            if (faults.audienceWrite && keys.includes('affinity') && keys.includes('pipeline')) {
              faults.refusedAudienceWrites++; throw new Error('synthetic audience commit failure');
            }
            if (faults.write) throw new Error('synthetic write failure');
            if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
          },
          list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) => { if (faults.read) throw new Error('synthetic read failure');
            return structuredClone(new Map([...data].filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
              .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))); },
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            if (faults.read || faults.write) throw new Error('synthetic transaction failure');
            const candidate = structuredClone(data);
            let deleteAlarm = false, nextAlarm: number | undefined;
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => {
                if (typeof values === 'string') candidate.set(values, structuredClone(value));
                else for (const [key, item] of Object.entries(values)) candidate.set(key, structuredClone(item));
                if (typeof values === 'string' && values.startsWith('recoveryLogical:')) await faults.recoveryPut?.();
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
          deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k), setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null,
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
  app.use('*', tenantMiddleware()); app.route('/realtime', realtimeRoutes); app.route('/v1', identityRoutes); app.route('/v1', decisionRoutes); app.route('/sort', sortRoutes); app.route('/track', trackingRoutes); app.route('/optimizely', optimizelyRoutes);
  const call = async (path: string, capability?: string, body?: unknown, tenant = 'meridian', cookie?: string, geo?: { country: string; regionCode: string }, method?: 'HEAD', extraHeaders?: Record<string, string>) => {
    await configureRetention();
    // Deliberate fixture preference choices use the same current-grant metadata
    // as the SDK. Ordinary actions are never assigned implicit authority.
    const patch = body as { choice?: unknown; trackingConsent?: unknown; personalizationEnabled?: unknown } | undefined;
    if (/^\/realtime\/session\/[^/]+\/preferences$/.test(path) && capability && patch && !patch.choice
      && (typeof patch.trackingConsent === 'boolean' || typeof patch.personalizationEnabled === 'boolean')) {
      try {
        const grant = await verifySessionCapability(env, capability, tenant);
        const current = objects.get(shopperObjectName(tenant, grant.subject))?.data.get('consent');
        body = { ...patch, choice: { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null,
          grantId: grant.grantId, iat: grant.iat, exp: grant.exp } };
      } catch { /* Send the original invalid request to the real refusal boundary. */ }
    }
    const request = new Request(`https://synthetic.invalid${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { ...extraHeaders, 'X-Tenant': tenant, ...(capability === undefined ? {} : { [SHOPPER_HEADER]: capability }), ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (geo) Object.defineProperty(request, 'cf', { value: geo });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} });
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 10)); };
  return { env, app, cache, sessions, effects, objects, call, faults, drain, configureRetention };
}

// Retained-state fixtures seed the actual durable source AND its acknowledged
// compatibility bytes. They do not promote arbitrary KV bytes into authority.
function retainedSession(f: ReturnType<typeof boundary>, tenant: string, subject: string, sid: string, data: SessionData) {
  const item = f.objects.get(shopperObjectName(tenant, subject))!, key = tenantKey(tenant, 'session:' + sid);
  const text = JSON.stringify(data), projection = 'sessionProjection:' + key;
  f.sessions.data.set(key, text);
  item.data.set(projection, { ...(item.data.get(projection) as object), value: text, pending: false });
  item.data.set('affinity', { ...item.data.get('affinity') as AffinityRecord, reflex: data.reflex,
    odpContext: data.odpContext, odpSeed: data.odpSeed ?? [], odpSeedAt: data.odpSeedAt ?? 0, odpRecentEvents: data.odpRecentEvents ?? [], lastSeen: data.metadata.lastSeen });
  item.data.set('pipeline', { ...item.data.get('pipeline') as PipelineRecord, segments: data.segments, attributes: data.attributes,
    profileEnrichment: data.profileEnrichment, journeyStage: data.metadata.journeyStage ?? 'early' });
  item.shopper = new ShopperReflex(item.state, f.env);
}

async function explicitChoice(f: ReturnType<typeof boundary>, grant: Awaited<ReturnType<typeof newAnonymousSession>>,
  tracking: boolean | undefined, personalization: boolean | undefined, id = crypto.randomUUID(), expectedRevision?: string | null) {
  const current = f.objects.get(shopperObjectName(grant.tenant, grant.subject))?.data.get('consent');
  const choice = { id, expectedRevision: expectedRevision === undefined ? storedConsent(current).instruction?.revision ?? null : expectedRevision,
    grantId: grant.grantId, iat: grant.iat, exp: grant.exp };
  const body = { ...(tracking === undefined ? {} : { trackingConsent: tracking }), ...(personalization === undefined ? {} : { personalizationEnabled: personalization }), choice };
  const response = await f.call(`/realtime/session/${grant.sessionId}/preferences`, grant.capability, body, grant.tenant);
  const text = await response.clone().text();
  return { response, body, text, value: (response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : {}) as { consent?: { tracking: boolean; personalization: boolean; instruction?: ConsentInstruction } } };
}

// A corrupt compatibility copy is not the W04 owner authority. These retained
// refusal controls corrupt the actual current source, preserving strict target
// and malformed-state refusal rather than demanding authority from raw KV.
function corruptOwner(f: ReturnType<typeof boundary>, g: { tenant: string; subject: string }, failure: unknown) {
  const item = f.objects.get(shopperObjectName(g.tenant, g.subject))!;
  if (failure === 'owner') item.data.set('affinity', { ...(item.data.get('affinity') as object), shopperId: 'victim' });
  else if (failure === 'forward') item.data.set('forwardTo', 'unowned');
  else item.data.set('consent', failure === 'malformed' ? null : failure);
  item.shopper = new ShopperReflex(item.state, f.env);
}
function expectColdOff(f: ReturnType<typeof boundary>, g: { tenant: string; subject: string; sessionId: string }) {
  expect(f.sessions.data.has(tenantKey(g.tenant, 'session:' + g.sessionId))).toBe(false);
  expect(f.sessions.data.has(tenantKey(g.tenant, 'user:' + g.subject))).toBe(false);
  const item = f.objects.get(shopperObjectName(g.tenant, g.subject))!;
  expect([...item.data.keys()]).toEqual(['grantAuthority']);
  expect(item.data.get('grantAuthority')).toMatchObject({ grants: expect.any(Object) });
  expect(storedConsent(item.data.get('consent'))).toEqual({ tracking: false, personalization: false });
}

async function positiveChoice(f: ReturnType<typeof boundary>, grant: Awaited<ReturnType<typeof newAnonymousSession>>) {
  await fixturePublication(f.env, grant.tenant);
  if (!storedConsent(f.objects.get(shopperObjectName(grant.tenant, grant.subject))?.data.get('consent')).instruction) {
    const chosen = await explicitChoice(f, grant, true, true); expect(chosen.response.status, chosen.text).toBe(200);
  }
}

describe('W15 actual read-only offers and durable rendered admission', () => {
  async function ready(host: string, tenant = 'meridian') {
    const f = boundary(host); f.env.TENANTS = JSON.stringify({ provisioned: ['meridian', 'harbor'] }); await f.configureRetention();
    const policies = JSON.parse(f.env.RETENTION!);
    for (const categories of Object.values(policies.tenants) as Record<string, unknown>[]) for (const key of ['recovery', 'quarantine']) categories[key] = fixtureRetentionPolicy;
    f.env.RETENTION = JSON.stringify(policies); f.env.LEDGER_RECOVERY_ENABLED = 'true';
    const stores = new Map<string, Map<string, unknown>>();
    function state(name: string) {
      const data = new Map<string, unknown>(); stores.set(name, data); let alarm: number | null = null;
      const operations = (target: Map<string, unknown>) => ({
        get: async (key: string) => structuredClone(target.get(key)),
        put: async (key: string | Record<string, unknown>, value?: unknown) => { if (typeof key === 'string') target.set(key, structuredClone(value)); else for (const [k, v] of Object.entries(key)) target.set(k, structuredClone(v)); },
        delete: async (key: string) => target.delete(key),
        list: async (o?: { prefix?: string }) => structuredClone(new Map([...target].filter(([key]) => key.startsWith(o?.prefix ?? '')))),
        getAlarm: async () => alarm, setAlarm: async (at: number) => { alarm = at; }, deleteAlarm: async () => { alarm = null; },
      });
      return { storage: { ...operations(data), transaction: async (work: (tx: unknown) => Promise<unknown>) => {
        const candidate = structuredClone(data), result = await work(operations(candidate)); data.clear(); for (const [k, v] of candidate) data.set(k, v); return result;
      } } } as unknown as DurableObjectState;
    }
    for (const [binding, Class] of [['DECISION_RING', DecisionRing], ['LEARN_STATS', LearnStats]] as const) {
      const instances = new Map<string, DecisionRing | LearnStats>();
      f.env[binding] = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: (url: string, init?: RequestInit) => {
        let instance = instances.get(name); if (!instance) { instance = new Class(state(binding + ':' + name), f.env); instances.set(name, instance); }
        return instance.fetch(new Request(url, init));
      } }) } as unknown as DurableObjectNamespace;
    }
    const changes: PublicationBaseline[] = [
      { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { pieces: [
        { id: 'render-piece', customerContentId: 'cms-original', type: 'editorial', title: 'Fixture', tags: { line: ['Tabby'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
      ] } } },
      { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1 } }] } } } },
      { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { holdout: { share: 0, salt: 'fixture', arms: ['default'] }, slots: { hero: { measurementBasis: 'rendered-v1', gamma: 0 } } } } },
    ];
    await fixturePublication(f.env, tenant, changes); const g = await newAnonymousSession(f.env, tenant); await positiveChoice(f, g);
    expect((await f.call('/realtime/action', g.capability, { type: 'product_view', source: 'sdk', userId: g.subject, sessionId: g.sessionId,
      timestamp: Date.now(), eventId: crypto.randomUUID(), data: { line: 'Tabby', productId: 'fixture' } }, tenant)).status).toBe(200); await f.drain();
    const owner = f.objects.get(shopperObjectName(tenant, g.subject))!, storage = f.env.STORAGE as unknown as BoundaryR2;
    const rows = (stream: string) => [...storage.data].filter(([key]) => key.includes('/' + stream + '/') && key.endsWith('.ndjson')).flatMap(([, raw]) => raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>));
    const recovery = () => [...owner.data].filter(([key]) => key.startsWith('recovery')).map(([key, value]) => [key, structuredClone(value)]);
    const snapshot = async () => {
      const pageInstance = crypto.randomUUID(), response = await f.call(`/v1/${tenant}/decisions/snapshot`, g.capability, { page: 'home', pageInstance }, tenant);
      expect(response.status).toBe(200); const body = await response.json() as { records?: unknown; decisions: Array<{ contentId: string; decisionId: string; renderOffer: string }> };
      expect(body.records).toBeUndefined(); expect(body.decisions).toHaveLength(1); expect(body.decisions[0]!.renderOffer).toMatch(/^ro1\./);
      const piece = body.decisions[0]!;
      return { body, event: { type: 'content_impression', source: 'sdk', userId: g.subject, sessionId: g.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID(),
        data: { contentId: piece.contentId, decisionId: piece.decisionId, renderOffer: piece.renderOffer, page: 'home', pageInstance, slot: 'hero', position: 0 } } };
    };
    return { f, g, owner, storage, stores, rows, recovery, snapshot, changes };
  }
  it('W15 polls do not capture; actual render ACK and identical retry/restart retain one original decision on both hosts and tenants', async () => {
    for (const host of ['session', 'do']) for (const tenant of ['meridian', 'harbor']) {
      const r = await ready(host, tenant), learned = () => [...r.stores].map(([key, value]) => [key, [...value]] as const).filter(([, value]) => value.length);
      const before = JSON.stringify({ recovery: r.recovery(), rows: r.rows('behavior'), learning: learned() });
      const { event } = await r.snapshot(); await r.snapshot(); await r.f.drain();
      expect(JSON.stringify({ recovery: r.recovery(), rows: r.rows('behavior'), learning: learned() })).toBe(before); expect(r.rows('decision')).toEqual([]);
      const wire = host === 'session' ? { ...event, processing: 'buffered', browsingSessionId: r.g.sessionId } : event;
      const response = await r.f.call('/realtime/action', r.g.capability, wire, tenant); expect(response.status).toBe(200);
      const result = await response.json() as { render: unknown }; expect(result.render).toMatchObject({ version: 1, status: 'durable', eventId: event.eventId, decisionId: event.data.decisionId, pageInstance: event.data.pageInstance });
      await r.f.drain(); const rows = r.rows('decision'); expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ decision_id: event.data.decisionId, measurementBasis: 'rendered-v1', rendered: { eventId: event.eventId, at: event.timestamp, pageInstance: event.data.pageInstance } });
      const ringStates = [...r.stores].filter(([name]) => name.startsWith('DECISION_RING:')).map(([, data]) => data.get('ring')) as Array<{ ring: unknown[] }>;
      const ringRows = rows.map(({ _ledger_delivery, ...record }) => {
        expect(_ledger_delivery).toEqual({ id: expect.any(String), ordinal: 0 });
        return record;
      });
      expect(ringStates.flatMap(state => state?.ring ?? [])).toEqual(ringRows);
      const stats = [...r.stores].filter(([name]) => name.startsWith('LEARN_STATS:')).map(([, data]) => data.get('learn')).filter(Boolean);
      expect(stats).toHaveLength(1);
      expect(stats[0]).toMatchObject({ tenant, brand: tenant, slot: 'hero', config: { measurementBasis: 'rendered-v1' },
        stats: { events: 1, updatedAt: event.timestamp, items: { 'render-piece': { '*': { n: { s: 1, t: event.timestamp } } } } } });
      expect(JSON.stringify(r.rows('behavior'))).not.toContain(event.data.renderOffer);
      const original = r.recovery(), originalLearning = structuredClone(learned()); r.owner.shopper = new ShopperReflex(r.owner.state, r.f.env);
      const retry = await r.f.call('/realtime/action', r.g.capability, wire, tenant); expect(retry.status).toBe(200); expect((await retry.json() as { render: unknown }).render).toEqual(result.render);
      await r.f.drain(); expect(r.rows('decision')).toEqual(rows); expect(r.recovery()).toEqual(original); expect(learned()).toEqual(originalLearning);
    }
  }, 30000);
  it('W15 rejects missing original render identity, tampered placement, foreign grant, withdrawn consent and changed publication before capture', async () => {
    for (const host of ['session', 'do']) {
      const r = await ready(host), { event } = await r.snapshot(), baseline = r.recovery();
      for (const altered of [{ ...event, eventId: undefined }, { ...event, timestamp: undefined },
        { ...event, data: { ...event.data, slot: 'foreign' } }, { ...event, data: { ...event.data, pageInstance: crypto.randomUUID() } },
        { ...event, data: { ...event.data, renderOffer: event.data.renderOffer.slice(0, -2) + 'AA' } }]) {
        expect((await r.f.call('/realtime/action', r.g.capability, altered)).status).toBeGreaterThanOrEqual(400); expect(r.recovery()).toEqual(baseline);
      }
      const foreign = await newAnonymousSession(r.f.env, 'meridian'); await positiveChoice(r.f, foreign);
      expect((await r.f.call('/realtime/action', foreign.capability, { ...event, userId: foreign.subject, sessionId: foreign.sessionId })).status).toBeGreaterThanOrEqual(400);
      expect(r.recovery()).toEqual(baseline);
      await fixturePublication(r.f.env, 'meridian', [r.changes[0]!]);
      expect((await r.f.call('/realtime/action', r.g.capability, event)).status).toBeGreaterThanOrEqual(400); expect(r.rows('decision')).toEqual([]);
      const next = await r.snapshot(); expect((await explicitChoice(r.f, r.g, false, false)).response.status).toBe(200);
      expect((await r.f.call('/realtime/action', r.g.capability, next.event)).status).toBeGreaterThanOrEqual(400); expect(r.rows('decision')).toEqual([]);
    }
  }, 30000);
  it('W15 original offer deadline rolls back the entire first transaction; already admitted recovery retains its independent original lifetime', async () => {
    for (const mode of ['first-transaction', 'admitted-restart']) {
      const at = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(at); let release: (() => void) | undefined;
      try {
        const r = await ready('do'), { event } = await r.snapshot(), before = r.recovery();
        if (mode === 'first-transaction') {
          let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
          r.f.faults.recoveryPut = async () => { entered(); await held; };
          const pending = r.f.call('/realtime/action', r.g.capability, event); await started; clock.mockReturnValue(at + 300001); release!();
          expect((await pending).status).toBeGreaterThanOrEqual(400); expect(r.recovery()).toEqual(before); expect(r.rows('decision')).toEqual([]);
        } else {
          const put = r.storage.put.bind(r.storage); let refuse = true;
          r.storage.put = async (key, body, options) => { if (refuse && key.includes('-managed-')) throw new Error('Synthetic canonical write unavailable'); return put(key, body, options); };
          const response = await r.f.call('/realtime/action', r.g.capability, event); expect(response.status).toBe(200);
          expect((await response.json() as { render: unknown }).render).toMatchObject({ status: 'durable', source: 'pending' });
          const meta = [...r.owner.data].filter(([key]) => key.startsWith('recoveryOperation:')).map(([, v]) => v as OwnerRecovery).find(v => v.learning)!;
          expect(meta.expiresAt).toBeGreaterThan(at + 300001); const original = structuredClone(meta);
          refuse = false; clock.mockReturnValue(at + 300001); r.owner.shopper = new ShopperReflex(r.owner.state, r.f.env); await r.owner.shopper.alarm(); await r.f.drain();
          expect(r.rows('decision')).toHaveLength(1); expect(r.rows('decision')[0]).toMatchObject({ decision_id: event.data.decisionId, ts: at, rendered: { at: event.timestamp, eventId: event.eventId } });
          expect(r.owner.data.get('recoveryOperation:' + meta.id)).toMatchObject({ expiresAt: original.expiresAt, retention: original.retention, receipt: { source: { state: 'recovered' } } });
        }
      } finally { release?.(); clock.mockRestore(); }
    }
  }, 30000);
});

it('W09.09 rework alarm strips all expired owner bodies before unrelated KV and first remote cleanup', async () => {
  const clone = Request.prototype.clone;
  const cloneDiagnostic = vi.spyOn(Request.prototype, 'clone').mockImplementation(function(this: Request) {
    try { return clone.call(this); }
    catch (error) {
      // Closed local-fixture diagnostics only: never URL, header, body or error text.
      const sites = (new Error().stack ?? '').split('\n').flatMap(line => {
        const match = line.match(/(realtime\.ts|ShopperReflex\.ts|sessionCapability\.ts|sessionAuthority\.ts):(\d+):(\d+)/);
        return match ? [{ file: match[1], line: Number(match[2]), column: Number(match[3]) }] : [];
      }).slice(0, 5);
      console.info('W14 closed clone refusal', { bodyUsed: this.bodyUsed, locked: this.body?.locked ?? false, sites });
      throw error;
    }
  });
  try {
  for (const fault of ['projection', 'first-recovery']) {
    const at = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(at);
    let release: (() => void) | undefined;
    try {
      const f = boundary(), g = await newAnonymousSession(f.env, 'meridian'); await positiveChoice(f, g);
      const owner = f.objects.get(shopperObjectName(g.tenant, g.subject))!, policies = JSON.parse(f.env.RETENTION!);
      policies.tenants.meridian.recovery = { ...fixtureRetentionPolicy, durationMs: 1000 };
      f.env.RETENTION = JSON.stringify(policies); f.env.LEDGER_RECOVERY_ENABLED = 'true';
      f.env.DECISION_RING = { idFromName: (name: string) => name, get: () => ({ fetch: async () => { throw new Error('preparation unavailable'); } }) } as unknown as DurableObjectNamespace;
      for (const eventId of ['first-expired', 'second-expired']) await f.call('/realtime/action', g.capability,
        { type: 'purchase', userId: g.subject, sessionId: g.sessionId, timestamp: at, eventId, source: 'sdk', data: { value: 1 } });
      await f.drain();
      const operations = [...owner.data].filter(([key]) => key.startsWith('recoveryOperation:'));
      expect(operations).toHaveLength(4); expect(operations.filter(([,value])=>(value as OwnerRecovery).learning)).toHaveLength(2);
      expect([...owner.data.keys()].filter(key => key.startsWith('recoveryBody:'))).toHaveLength(4);
      const physical = tenantKey(g.tenant, 'session:' + g.sessionId), raw = f.sessions.data.get(physical)!;
      if (fault === 'projection') {
        const session = JSON.parse(raw), category = 'external.odp.' + 'a'.repeat(64);
        session.externalRetention = { [category]: { version: 1, tenant: g.tenant, category, policyId: 'expired-copy', policyRevision: 1, basis: 'admitted', bornAt: at, expiresAt: at + 1000 } };
        const value = JSON.stringify(session); f.sessions.data.set(physical, value);
        owner.data.set('sessionProjection:' + physical, { value, expires: at + 60_000, pending: false });
      }
      clock.mockReturnValue(at + 1001); owner.shopper = new ShopperReflex(owner.state, f.env);
      if (fault === 'projection') {
        f.sessions.calls.length = 0; f.sessions.failRead = true;
        await owner.shopper.alarm().catch(() => undefined);
        expect(f.sessions.calls).toContain('get:' + physical);
      } else {
        let entered!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
        f.env.STORAGE = { get: async () => { entered(); await gate; throw new Error('held cleanup unavailable'); } } as unknown as R2Bucket;
        const pending = owner.shopper.alarm().catch(() => undefined);
        try { await started; expect.soft([...owner.data.keys()].filter(key => key.startsWith('recoveryBody:')), fault).toEqual([]); }
        finally { release?.(); await pending; }
      }
      expect.soft([...owner.data.keys()].filter(key => key.startsWith('recoveryBody:')), fault).toEqual([]);
      for (const [key, original] of operations) {
        const debt = owner.data.get(key) as OwnerRecovery;
        expect.soft(debt).toMatchObject({ cleanup: 'expired', chunks: 0, expiresAt: (original as OwnerRecovery).expiresAt });
        expect.soft(debt.receipt.source.state).toBe((original as OwnerRecovery).receipt.source.state === 'recovered' ? 'recovered' : 'expired_unrecovered');
      }
    } finally { release?.(); clock.mockRestore(); }
  }
  } finally { cloneDiagnostic.mockRestore(); }
});

it('W14.07 retains actual SDK dwell milliseconds and typed product items through durable fallback and owner restart without private data or coercion', async()=>{
  for(const host of ['session','do'])for(const tenant of ['meridian','harbor']){
    const f=boundary(host),raw=new Map<string,string>(),meta=new Map<string,Record<string,string>>();let revision=0;
    const etags=new Map<string,string>();f.env.TENANTS=JSON.stringify({provisioned:['meridian','harbor']});await f.configureRetention();
    const policies=JSON.parse(f.env.RETENTION!);for(const value of Object.values(policies.tenants) as Record<string,unknown>[])
      for(const category of ['recovery','quarantine'])value[category]={...fixtureRetentionPolicy,durationMs:60000};
    f.env.RETENTION=JSON.stringify(policies);f.env.LEDGER_RECOVERY_ENABLED='true';
    f.env.STORAGE={get:async(key:string)=>raw.has(key)?{key,etag:etags.get(key),size:new TextEncoder().encode(raw.get(key)!).length,customMetadata:meta.get(key),text:async()=>raw.get(key)!,body:new Response(raw.get(key)!).body}:null,
      list:async({prefix}:{prefix:string})=>({objects:[...raw.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key})),truncated:false}),
      put:async(key:string,body:string,options?:R2PutOptions)=>{const condition=options?.onlyIf;
        if(condition instanceof Headers?raw.has(key):condition?.etagDoesNotMatch==='*'&&raw.has(key)||condition?.etagMatches!==undefined&&condition.etagMatches!==etags.get(key))return null;
        raw.set(key,body);meta.set(key,{...options?.customMetadata});etags.set(key,'v'+(++revision));return{key,etag:etags.get(key),size:new TextEncoder().encode(body).length};},
      delete:async(key:string)=>{raw.delete(key);},
    } as unknown as R2Bucket;
    const wires:unknown[]=[];f.env.EVENT_QUEUE={send:async(body:unknown)=>{wires.push(structuredClone(body));throw new Error('Synthetic unavailable queue');}} as unknown as Queue;
    const g=await newAnonymousSession(f.env,tenant);await positiveChoice(f,g);
    const learning:unknown[]=[],ringData=new Map<string,unknown>();let ringAlarm:number|null=null;
    const ring=new DecisionRing({storage:{get:async(key:string)=>structuredClone(ringData.get(key)),put:async(key:string,value:unknown)=>{ringData.set(key,structuredClone(value));},
      list:async(o:{prefix?:string})=>structuredClone(new Map([...ringData].filter(([key])=>key.startsWith(o.prefix??'')))),
      delete:async(key:string)=>ringData.delete(key),getAlarm:async()=>ringAlarm,setAlarm:async(at:number)=>{ringAlarm=at;}}} as unknown as DurableObjectState,f.env);
    f.env.DECISION_RING={idFromName:(name:string)=>name,get:()=>({fetch:async(url:string,init?:RequestInit)=>{
      const input=JSON.parse(String(init?.body));learning.push({path:new URL(url).pathname,input});
      if(!['/outcome/prepare','/outcome'].includes(new URL(url).pathname)||!input.outcome||input.outcome.type!=='dwell')throw Error('Unexpected non-outcome learning work');
      return ring.fetch(new Request(url,init));
    }})} as unknown as DurableObjectNamespace;
    let event!: {type:string;source:string;userId:string;sessionId:string;eventId:string;timestamp:number;data:Record<string,unknown>};
    const sdkHost=memoryHost({acquireAuthorityLock:authorityLocks(),uuid:()=>crypto.randomUUID(),now:()=>Date.now(),
      fetch:async(url,init)=>{const path=new URL(url).pathname,body=init?.body?JSON.parse(init.body):undefined;
        if(path==='/realtime/action')event=structuredClone(body);
        const response=await f.call(path,init?.headers?.[SHOPPER_HEADER]??g.capability,body,tenant);
        expect(response.status,path).toBe(200);
        return {ok:response.ok,status:response.status,json:()=>response.json()};}});
    const core=createCore({tenant,endpoint:'https://synthetic.invalid',source:'sdk'},sdkHost),emit=createEmit(core,createListen(core));
    try{expect(await core.ready()).toBe(true);
      await emit.contentDwell('retained-content','hero',1234.5,{PRIVATE:'never-persist',items:[{sku:'sku-1',quantity:2,price:42,currency:'USD',privateProfile:'never-persist'}]});
    }finally{core.disconnect();}
    expect(event.data.ms).toBe(1234.5);expect(event.data).not.toHaveProperty('dwellMs');await f.drain();
    const behavior=()=>[...raw].filter(([key])=>key.includes('/behavior/')&&key.endsWith('.ndjson')).flatMap(([,body])=>body.trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>));
    const rows=behavior();expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({tenant,event:'content_dwell',event_id:event.eventId,ts:event.timestamp,data:{ms:1234.5,items:[{sku:'sku-1',quantity:2,price:42,currency:'USD'}]}});
    expect(JSON.stringify(rows)).not.toContain('PRIVATE');expect(JSON.stringify(rows)).not.toContain('never-persist');
    const owner=f.objects.get(shopperObjectName(tenant,g.subject))!,operation=[...owner.data].filter(([key])=>key.startsWith('recoveryOperation:')).map(([,v])=>v as OwnerRecovery).find(v=>!v.learning)!;
    expect([...owner.data].filter(([key])=>key.startsWith('recoveryOperation:')).map(([,v])=>v as OwnerRecovery).filter(v=>!v.learning)).toEqual([operation]);
    expect(operation.receipt.learning).toBeUndefined();expect(learning).toHaveLength(2);
    expect(learning).toEqual(['/outcome/prepare','/outcome'].map(path=>expect.objectContaining({path,input:expect.objectContaining({outcome:expect.objectContaining({event:'content_dwell',type:'dwell',event_id:event.eventId})})})));
    expect(operation.receipt).toMatchObject({durable:true,source:{state:'recovered'}});const original=structuredClone(operation),count=wires.length;
    owner.shopper=new ShopperReflex(owner.state,f.env);expect((await f.call('/realtime/action',g.capability,event,tenant)).status).toBe(200);await f.drain();
    expect(behavior()).toEqual(rows);expect(wires).toHaveLength(count);expect(owner.data.get('recoveryOperation:'+original.id)).toMatchObject({expiresAt:original.expiresAt,payloadDigest:original.payloadDigest});
    for(const ms of ['1234.5',-1]){expect((await f.call('/realtime/action',g.capability,{...event,eventId:crypto.randomUUID(),data:{ms}},tenant)).status).toBeGreaterThanOrEqual(400);expect(behavior()).toEqual(rows);}
  }
});

it('W09.09 both actual hosts durably admit before effects, drain held queue I/O and reuse original outcome identity/config/lifetime after restart', async () => {
  for (const host of ['session', 'do']) {
    const at = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(at);
    let release!: () => void;
    try {
      const f = boundary(host), grant = await newAnonymousSession(f.env, 'meridian'); await positiveChoice(f, grant);
      const owner = f.objects.get(shopperObjectName(grant.tenant, grant.subject))!;
      const policies = JSON.parse(f.env.RETENTION!);
      for (const tenant of Object.keys(policies.tenants)) for (const category of ['recovery', 'quarantine']) policies.tenants[tenant][category] = { ...fixtureRetentionPolicy, durationMs: 60_000 };
      f.env.RETENTION = JSON.stringify(policies); f.env.LEDGER_RECOVERY_ENABLED = 'true';
      const raw = new Map<string, string>(), metadata = new Map<string, Record<string, string>>(), etags = new Map<string, string>(); let seq = 0;
      f.env.STORAGE = { get: async (key: string) => raw.has(key) ? { key, etag: etags.get(key), size: new TextEncoder().encode(raw.get(key)!).length,
        customMetadata: metadata.get(key), text: async () => raw.get(key)!, json: async () => JSON.parse(raw.get(key)!) as unknown, body: new Response(raw.get(key)!).body } : null,
        list: async ({ prefix }: { prefix: string }) => ({ objects: [...raw.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false }),
        put: async (key: string, body: string, options?: R2PutOptions) => {
          const condition = options?.onlyIf;
          if (condition instanceof Headers ? raw.has(key) : condition?.etagDoesNotMatch === '*' && raw.has(key) || condition?.etagMatches && condition.etagMatches !== etags.get(key)) return null;
          raw.set(key, body); metadata.set(key, { ...options?.customMetadata }); const etag = 'v' + (++seq); etags.set(key, etag);
          return { key, etag, size: new TextEncoder().encode(body).length };
        } } as unknown as R2Bucket;
      await fixturePublication(f.env, grant.tenant);
      const ringData = new Map<string, unknown>(); let alarm: number | null = null;
      const ringStorage = { get: async (key: string) => structuredClone(ringData.get(key)), put: async (key: string, value: unknown) => { ringData.set(key, structuredClone(value)); },
        list: async (o: { prefix?: string }) => structuredClone(new Map([...ringData].filter(([key]) => key.startsWith(o.prefix ?? '')))),
        delete: async (key: string) => ringData.delete(key), getAlarm: async () => alarm, setAlarm: async (at: number) => { alarm = at; } };
      const ring = new DecisionRing({ storage: ringStorage } as unknown as DurableObjectState, f.env);
      f.env.DECISION_RING = { idFromName: (name: string) => name, get: () => ({ fetch: (url: string, init?: RequestInit) => ring.fetch(new Request(url, init)) }) } as unknown as DurableObjectNamespace;
      const wires: unknown[] = []; let entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
      f.env.EVENT_QUEUE = { send: async (body: unknown) => {
        const metas = [...owner.data].filter(([key]) => key.startsWith('recoveryOperation:'));
        expect(metas).toHaveLength(wires.length+1); expect([...owner.data.keys()].some(key => key.startsWith('recoveryBody:'))).toBe(true);
        expect([...raw.keys()].filter(key=>key.includes('-managed-'))).toHaveLength(wires.length); wires.push(structuredClone(body)); entered(); await gate;
        throw new Error('synthetic lost queue acknowledgement');
      } } as unknown as Queue;
      const action = { type: 'purchase', userId: grant.subject, sessionId: grant.sessionId, timestamp: at,
        eventId: 'w0909-one', source: 'sdk', data: { orderId: 'synthetic-order', value: 1 } };
      let returned = false;
      const pending = f.call('/realtime/action', grant.capability, action).then(result => { returned = true; return result; });
      await started; await new Promise(resolve => setTimeout(resolve, 10)); expect(returned).toBe(false);
      release(); expect((await pending).status).toBe(200); await f.drain();
      const operations = [...owner.data].filter(([key]) => key.startsWith('recoveryOperation:')).map(([,value])=>value as OwnerRecovery);
      const saved = operations.find(value=>value.learning)!;
      expect(operations.find(value=>!value.learning)!.receipt).toMatchObject({durable:true,source:{state:'recovered',expected:1}});
      expect(saved.receipt).toMatchObject({ durable: true, source: { state: 'recovered', expected: 1 }, ledger: { total: 1, unknown: 0, notAttempted: 0 } });
      expect(wires).toHaveLength(2); expect([...raw.keys()].filter(key => key.includes('-managed-'))).toHaveLength(2);
      const original = structuredClone(saved), originalRing = structuredClone(ringData);
      owner.shopper = new ShopperReflex(owner.state, f.env); clock.mockReturnValue(at + 1000);
      expect((await f.call('/realtime/action', grant.capability, action)).status).toBe(200); await f.drain();
      const retry = owner.data.get('recoveryOperation:' + saved.id) as OwnerRecovery;
      expect(retry.expiresAt).toBe(original.expiresAt); expect(retry.payloadDigest).toBe(original.payloadDigest); expect(wires).toHaveLength(2); expect(ringData).toEqual(originalRing);
      // The actual content route uses the same owner admission, not an already
      // started fan-out promise or a synthetic admission-only callback.
      const statsData = new Map<string, unknown>(); let statsAlarm: number | null = null;
      const statsStorage = { get: async (key: string) => structuredClone(statsData.get(key)),
        put: async (key: string, value: unknown) => { statsData.set(key, structuredClone(value)); },
        delete: async (key: string) => statsData.delete(key), getAlarm: async () => statsAlarm, setAlarm: async (value: number) => { statsAlarm = value; },
        transaction: async (work: (tx: { get: (key: string) => Promise<unknown>; put: (key: string, value: unknown) => Promise<void> }) => Promise<unknown>) => {
          const candidate = structuredClone(statsData);
          const result = await work({ get: async key => structuredClone(candidate.get(key)), put: async (key, value) => { candidate.set(key, structuredClone(value)); } });
          statsData.clear(); for (const [key, value] of candidate) statsData.set(key, value); return result;
        } };
      const stats = new LearnStats({ storage: statsStorage } as unknown as DurableObjectState, f.env);
      f.env.LEARN_STATS = { idFromName: (name: string) => name, get: () => ({ fetch: (url: string, init?: RequestInit) => stats.fetch(new Request(url, init)) }) } as unknown as DurableObjectNamespace;
      invalidateCache(); invalidateLiftCache();
      await fixturePublication(f.env,grant.tenant,[{kind:CONTENT_KIND,scope:grant.tenant,revision:{ revision: 1, at: 1, actor: 'fixture', note: '', value: { pieces: [
        { id: 'admitted-content', customerContentId: 'cms-admitted', type: 'editorial', title: 'Synthetic', tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' as const } },
      ] } }}, {kind:SLOTS_KIND,scope:grant.tenant,revision:{revision:1,at:1,actor:'fixture',note:'',value:{pages:{home:[{slot:'hero',take:1,weights:{}}]}}}},
      {kind:LEARN_KIND,scope:grant.tenant,revision:{revision:1,at:1,actor:'fixture',note:'',value:{holdout:{share:0,salt:'fixture',arms:['default']}}}}]);
      f.env.EVENT_QUEUE = { send: async (body: unknown) => {
        const operations = [...owner.data].filter(([key]) => key.startsWith('recoveryOperation:'));
        expect(operations).toHaveLength(3); expect(statsData.has('learn')).toBe(false);
        expect([...raw.keys()].filter(key => key.includes('-managed-'))).toHaveLength(2);
        wires.push(structuredClone(body));
      } } as unknown as Queue;
      const decisionResponse = await f.call(`/v1/${grant.tenant}/decisions/snapshot?page=home&visitorId=${grant.subject}&sessionId=${grant.sessionId}`, grant.capability);
      expect(decisionResponse.status).toBe(200); const decisions = await decisionResponse.json() as { records: Array<{ decision_id: string }> };
      await f.drain(); expect(decisions.records).toHaveLength(1); expect(wires).toHaveLength(3);
      const decisionOperation = [...owner.data].filter(([key]) => key.startsWith('recoveryOperation:')).map(([, value]) => value as OwnerRecovery).find(value => value.learning && value.id !== saved.id)!;
      expect(decisionOperation.receipt).toMatchObject({ source: { expected: 1, state: 'recovered' }, ledger: { total: 1, newlyStored: 1 }, learning: { exposures: { newlyApplied: 1 } } });
      const learned = statsData.get('learn') as { stats: { events: number }; effects: Record<string, { digest: string }> };
      expect(learned.stats.events).toBe(1); expect(Object.keys(learned.effects)).toHaveLength(1);
      expect([...raw.values()].filter(value => value.includes(decisions.records[0]!.decision_id)).length).toBeGreaterThan(0);
      expect((await explicitChoice(f, grant, false, false)).response.status).toBe(200);
      expect([...owner.data.keys()].filter(key => key.startsWith('recoveryBody:'))).toEqual([]);
      expect(owner.data.get('recoveryOperation:' + saved.id)).toMatchObject({ cleanup: 'retired', chunks: 0 });
      console.info('W09.09 actual owner callers', JSON.stringify({ host, heldBeforeReply: true, durableOperations: 3, queueAttempts: wires.length, canonicalObjects: 3, originalDeadlinePreserved: true, decisionEffects: Object.keys(learned.effects).length }));
    } finally { release?.(); clock.mockRestore(); }
  }
});

describe.each(['session', 'do'])('W06.12 physical profile lifetime on %s', host => {
  it('births cold manual behavior once under its owner and refuses unproven cache or tracking-off capture', async () => {
    const at = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(at);
    try {
      const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await positiveChoice(f, g);
      const owner = f.objects.get(shopperObjectName(g.tenant, g.subject))!, grant = structuredClone(owner.data.get('grantAuthority'));
      const assign = (segment: string) => f.call('/realtime/segments/' + g.subject, g.capability, { segment, source: 'manual-fixture' });
      expect((await assign('first-manual')).status).toBe(200); await f.drain();
      const original = structuredClone((owner.data.get('affinity') as AffinityRecord).retention);
      expect(original).toEqual(retentionBirth(f.env, g.tenant, 'profile', at, at));
      clock.mockReturnValue(at + 1000);
      expect((await assign('second-manual')).status).toBe(200); await f.drain();
      expect((owner.data.get('affinity') as AffinityRecord).retention).toEqual(original);
      expect((owner.data.get('pipeline') as PipelineRecord).segments).toEqual(expect.arrayContaining(['first-manual', 'second-manual']));
      expect(owner.data.get('grantAuthority')).toEqual(grant);
      if (host === 'session') expect(JSON.parse(f.cache.data.get(tenantKey(g.tenant, 'profile:' + g.subject))!).retention).toEqual(original);
      expect((await explicitChoice(f, g, false, true)).response.status).toBe(200);
      const before = { owner: structuredClone([...owner.data]), cache: [...f.cache.data], sessions: [...f.sessions.data] };
      expect((await assign('tracking-off')).status).toBe(403);
      expect({ owner: [...owner.data], cache: [...f.cache.data], sessions: [...f.sessions.data] }).toEqual(before);
      if (host === 'session') for (const raw of ['not JSON', JSON.stringify({ userId: 'foreign', segments: ['old'] }), JSON.stringify({ segments: ['legacy'] })]) {
        const cold = await newAnonymousSession(f.env, 'meridian'); await positiveChoice(f, cold);
        const item = f.objects.get(shopperObjectName(cold.tenant, cold.subject))!, key = tenantKey(cold.tenant, 'profile:' + cold.subject);
        f.cache.data.set(key, raw); const state = structuredClone([...item.data]), sessions = [...f.sessions.data];
        expect((await f.call('/realtime/segments/' + cold.subject, cold.capability, { segment: 'never-adopt' })).status).toBe(401);
        expect([...item.data]).toEqual(state); expect([...f.sessions.data]).toEqual(sessions); expect(f.cache.data.get(key)).toBe(raw);
      }
    } finally { clock.mockRestore(); }
  });
  it('keeps one original birth through updates and removes expired behavioral destinations without erasing choices or grants', async () => {
    const at = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(at);
    try {
      const f = boundary(host), categories = fixtureCategories(['coach', 'meridian']);
      categories.meridian!.profile = { ...fixtureRetentionPolicy, durationMs: 120000 };
      f.env.RETENTION = JSON.stringify({ version: 1, tenants: categories });
      const g = await newAnonymousSession(f.env, 'meridian'), other = await newAnonymousSession(f.env, 'coach');
      await positiveChoice(f, g); await positiveChoice(f, other);
      const action = { type: 'product_view', source: 'sdk', userId: g.subject, sessionId: g.sessionId, data: { line: 'Tabby', productId: 'fixture-tabby' } };
      expect((await f.call('/realtime/action', g.capability, action)).status).toBe(200); await f.drain();
      const owner = f.objects.get(shopperObjectName(g.tenant, g.subject))!, foreign = f.objects.get(shopperObjectName(other.tenant, other.subject))!;
      const stamp = (owner.data.get('affinity') as AffinityRecord).retention;
      expect(stamp).toEqual(retentionBirth(f.env, 'meridian', 'profile', at, at));
      const choice = structuredClone(owner.data.get('consent')), authority = structuredClone(owner.data.get('grantAuthority')), untouched = structuredClone([...foreign.data]);
      clock.mockReturnValue(at + 1000);
      expect((await f.call('/realtime/action', g.capability, action)).status).toBe(200); await f.drain();
      expect((owner.data.get('affinity') as AffinityRecord).retention).toEqual(stamp);
      const key = tenantKey('meridian', 'session:' + g.sessionId), pointer = tenantKey('meridian', 'user:' + g.subject);
      if (host === 'session') {
        expect(JSON.parse(f.sessions.data.get(key)!).retention).toEqual(stamp);
        expect((owner.data.get('sessionProjection:' + key) as { expires: number }).expires).toBe(Math.floor(stamp!.expiresAt / 1000) * 1000);
      } else expect(f.sessions.data.has(key)).toBe(false);
      clock.mockReturnValue(stamp!.expiresAt + 1);
      await owner.shopper.alarm();
      expect(owner.data.has('affinity')).toBe(false); expect(owner.data.has('pipeline')).toBe(false);
      expect(f.sessions.data.has(key)).toBe(false); expect(f.sessions.data.has(pointer)).toBe(false);
      expect(owner.data.get('consent')).toEqual(choice); expect(owner.data.get('grantAuthority')).toEqual(authority);
      expect([...foreign.data]).toEqual(untouched);
      const analytics = await f.call('/realtime/session/' + g.sessionId + '/analytics', g.capability);
      expect(await analytics.text()).not.toContain('Tabby');
      expect((await explicitChoice(f, g, false, false)).response.status).toBe(200);
      expect(owner.data.get('grantAuthority')).toEqual(authority); expect(owner.data.has('affinity')).toBe(false);
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
  });

  it('missing retention blocks positive behavioral capture but leaves explicit refusal and grant operations available', async () => {
    const f = boundary(host); f.env.RETENTION = undefined;
    const g = await newAnonymousSession(f.env, 'meridian');
    expect((await explicitChoice(f, g, true, true)).response.status).toBe(200);
    const owner = f.objects.get(shopperObjectName(g.tenant, g.subject))!, grants = structuredClone(owner.data.get('grantAuthority'));
    const result = await f.call('/realtime/action', g.capability, { type: 'product_view', source: 'sdk', userId: g.subject, sessionId: g.sessionId, data: { line: 'PRIVATE_RETENTION' } });
    expect(result.ok).toBe(false); expect(owner.data.has('affinity')).toBe(false); expect(f.sessions.data.size).toBe(0);
    expect(owner.data.get('grantAuthority')).toEqual(grants);
    expect((await explicitChoice(f, g, false, false)).response.status).toBe(200);
    expect((await f.call('/v1/meridian/identity/detach', g.capability, {})).status).toBe(200);
  });

  it('quiet alarms prune earlier provider copies in projections, completed imports and transfer receipts without resetting grants or choices', async () => {
    const at = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(at), remote = vi.fn(async () => Response.json({ data: { customer: { audiences: { edges: [{ node: { name: 'remote_late', state: 'qualified' } }] } } } }));
    vi.stubGlobal('fetch', remote);
    try {
      const f = boundary(host);
      f.env.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: { meridian: { odp: {
        apiHost: 'https://odp-copy.invalid', publicKeyRef: 'CONNECTOR_SECRET_COPY_ODP', identityNamespace: 'copy-test',
        actions: { product_view: { type: 'product', action: 'detail', fields: { product_id: 'productId' } } },
        audiences: { remote_late: 'late_journey_ready_to_buy' }, profile: {},
      } } } });
      (f.env as unknown as Record<string, unknown>).CONNECTOR_SECRET_COPY_ODP = 'synthetic-odp-copy';
      const categories = fixtureCategories(['coach', 'meridian']);
      for (const destination of await configuredDestinations(f.env, 'meridian')) categories.meridian![destination.category] = { ...fixtureRetentionPolicy, durationMs: 120000 };
      f.env.RETENTION = JSON.stringify({ version: 1, tenants: categories });
      const g = await newAnonymousSession(f.env, 'meridian'); await positiveChoice(f, g);
      expect((await f.call('/realtime/action', g.capability, { type: 'product_view', source: 'sdk', userId: g.subject, sessionId: g.sessionId, data: { productId: 'copy-product', line: 'Tabby' } })).status).toBe(200);
      await f.drain(); expect(remote.mock.calls.length).toBeGreaterThan(0);
      const source = f.objects.get(shopperObjectName(g.tenant, g.subject))!;
      expect(source.alarms.at(-1)).toBeLessThanOrEqual(at + 120000);
      const operationId = crypto.randomUUID(), payload = { operationId, shopperId: g.subject, now: at, rows: [] };
      const invoke = (path: string) => source.shopper.fetch(new Request('https://owner' + path, { method: 'POST', headers: { 'X-Reflex-Tenant': g.tenant, 'X-Reflex-Subject': g.subject }, body: JSON.stringify(payload) }));
      expect((await invoke('/identity/import/admission')).status).toBe(200);
      const imported = await invoke('/identity/import'); expect(imported.status).toBe(200); expect(await imported.json()).toMatchObject({ applied: 0 });
      expect(source.data.get('identityImport:' + operationId)).toMatchObject({ published: true, result: { data: host === 'session' ? expect.any(Object) : undefined } });
      const accountId = 'w0612-copy-person', exp = Math.floor(at / 1000) + 120, assertion = await signAssertion('backend-proof', g.tenant, g.subject, accountId, exp);
      const linkBody = { visitorId: g.subject, accountId, exp, assertion };
      const linked = await f.call('/v1/meridian/identity/link', g.capability, linkBody); expect(linked.status).toBe(200);
      const body = await linked.json() as { session: { subject: string } }, target = f.objects.get(shopperObjectName(g.tenant, body.session.subject))!;
      const transfer = structuredClone(source.data.get('identityTransfer')) as { transfer: { profileDigest: string }; status: string };
      expect(transfer.status).toBe('complete');
      const receiptKey = [...target.data.keys()].find(key => key.startsWith('identityReceipt:'))!;
      expect(target.data.get(receiptKey)).toHaveProperty('retention');
      const targetOperation = crypto.randomUUID(), targetPayload = { operationId: targetOperation, shopperId: body.session.subject, now: at, rows: [] };
      for (const path of ['/identity/import/admission', '/identity/import']) {
        const response = await target.shopper.fetch(new Request('https://owner' + path, { method: 'POST', headers: { 'X-Reflex-Tenant': g.tenant, 'X-Reflex-Subject': body.session.subject }, body: JSON.stringify(targetPayload) }));
        expect(response.status).toBe(200);
      }
      expect(target.data.get('identityImport:' + targetOperation)).toMatchObject({ published: true, result: { data: host === 'session' ? expect.any(Object) : undefined } });
      const sourceGrant = structuredClone(source.data.get('grantAuthority')), targetGrant = structuredClone(target.data.get('grantAuthority'));
      const sourceChoice = structuredClone(source.data.get('consent')), targetChoice = structuredClone(target.data.get('consent'));
      clock.mockReturnValue(at + 120000);
      source.shopper = new ShopperReflex(source.state, f.env); target.shopper = new ShopperReflex(target.state, f.env);
      await source.shopper.alarm(); await target.shopper.alarm();
      expect(source.data.get('identityTransfer')).toMatchObject({ scrubbed: true, transfer: { profileDigest: transfer.transfer.profileDigest, affinity: null, pipeline: null } });
      expect(target.data.get(receiptKey)).toMatchObject({ scrubbed: true, result: { audiences: [], cookieHeaders: [] } });
      const savedImport = source.data.get('identityImport:' + operationId) as { result: object; scrubbed: boolean } | undefined;
      if (savedImport) { expect(savedImport.scrubbed).toBe(true); expect(savedImport.result).not.toHaveProperty('data'); }
      const targetImport = target.data.get('identityImport:' + targetOperation) as { result: object; scrubbed: boolean };
      expect(targetImport.scrubbed).toBe(true); expect(targetImport.result).not.toHaveProperty('data');
      expect(source.data.get('grantAuthority')).toEqual(sourceGrant); expect(target.data.get('grantAuthority')).toEqual(targetGrant);
      expect(storedConsent(source.data.get('consent'))).toEqual(storedConsent(sourceChoice)); expect(storedConsent(target.data.get('consent'))).toEqual(storedConsent(targetChoice));
      expect((target.data.get('affinity') as AffinityRecord).odpSeed).toEqual([]);
      expect((target.data.get('pipeline') as PipelineRecord).segments).not.toContain('late_journey_ready_to_buy');
      for (const [key, value] of target.data) if (key.startsWith('sessionProjection:') && typeof (value as { value?: unknown }).value === 'string') {
        expect((value as { value: string }).value).not.toContain('late_journey_ready_to_buy');
      }
    } finally { clock.mockRestore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('retains expired committed unpublished import debt through alarm and restart without re-admitting or applying it', async () => {
    const at = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(at);
    try {
      const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await positiveChoice(f, g);
      expect((await f.call('/realtime/action', g.capability, { type: 'product_view', source: 'sdk', userId: g.subject, sessionId: g.sessionId, data: { line: 'Tabby' } })).status).toBe(200);
      const accountId = 'w0612-held-import', exp = Math.floor(at / 1000) + 120, assertion = await signAssertion('backend-proof', g.tenant, g.subject, accountId, exp);
      const response = await f.call('/v1/meridian/identity/link', g.capability, { visitorId: g.subject, accountId, exp, assertion }); expect(response.status).toBe(200);
      const { session } = await response.json() as { session: { subject: string } }, target = f.objects.get(shopperObjectName(g.tenant, session.subject))!;
      const operationId = crypto.randomUUID(), key = 'identityImport:' + operationId, payload = { operationId, shopperId: session.subject, now: at, history: true,
        rows: [{ action: 'product_view', at: at - 1000, touches: [{ dim: 'line', value: 'SYNTHETIC_HELD_IMPORT' }] }] };
      const invoke = (path: string) => target.shopper.fetch(new Request('https://owner' + path, { method: 'POST', headers: { 'X-Reflex-Tenant': g.tenant, 'X-Reflex-Subject': session.subject }, body: JSON.stringify(payload) }));
      expect((await invoke('/identity/import/admission')).status).toBe(200);
      const put = f.sessions.put.bind(f.sessions), failed = vi.spyOn(f.sessions, 'put').mockImplementation(async (physical, value) => {
        if (physical === tenantKey(g.tenant, 'identity:shopper:' + session.subject)) throw new Error('synthetic committed import publication failure');
        return put(physical, value);
      });
      await expect(invoke('/identity/import')).rejects.toThrow(); failed.mockRestore();
      const debt = structuredClone(target.data.get(key)) as { expires: number; result: { applied: number }; published: boolean };
      expect(debt).toMatchObject({ published: false, result: { applied: 1 } });
      const grant = structuredClone(target.data.get('grantAuthority')), choice = storedConsent(target.data.get('consent'));
      expect(choice.instruction!.tracking!.expiresAt).toBeLessThanOrEqual(debt.expires);
      clock.mockReturnValue(debt.expires + 1); target.alarms.length = 0;
      target.shopper = new ShopperReflex(target.state, f.env); await target.shopper.alarm();
      expect(target.data.get(key)).toEqual(debt); expect(target.data.get('grantAuthority')).toEqual(grant);
      expect(storedConsent(target.data.get('consent'))).toMatchObject({ tracking: false, personalization: false });
      expect(storedConsent(target.data.get('consent')).instruction).toBeUndefined();
      expect(target.alarms.every(deadline => deadline > Date.now())).toBe(true);
      const before = structuredClone([...target.data]), kv = [...f.sessions.data]; target.shopper = new ShopperReflex(target.state, f.env);
      const reads = vi.spyOn(target.state.storage, 'get');
      await expect(invoke('/identity/import')).rejects.toThrow(); await expect(invoke('/identity/import/admission')).rejects.toThrow();
      // Backend authority is independent of the old bearer. Exact saved expiry
      // refuses before any consent read, so expired choice is not this oracle.
      expect(reads.mock.calls.some(([key]) => (key as unknown) === 'consent' || (Array.isArray(key) && key.includes('consent')))).toBe(false); reads.mockRestore();
      expect([...target.data]).toEqual(before); expect([...f.sessions.data]).toEqual(kv); expect(target.data.get(key)).toEqual(debt);
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
  });
});

it('W06.12 propagates the original profile deadline into the actual delayed relay send boundary', async () => {
  const at = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(at);
  vi.stubGlobal('WebSocket', { READY_STATE_OPEN: 1 });
  try {
    const f = boundary('session'), categories = fixtureCategories(['coach', 'meridian']); categories.meridian!.profile = { ...fixtureRetentionPolicy, durationMs: 60000 };
    f.env.RETENTION = JSON.stringify({ version: 1, tenants: categories });
    const g = await newAnonymousSession(f.env, 'meridian'); await positiveChoice(f, g);
    const principal = await verifySessionCapability(f.env, g.capability, g.tenant), sent = vi.fn(), closed = vi.fn();
    const name = shopperObjectName(g.tenant, g.subject), state = { id: name, blockConcurrencyWhile: (run: () => Promise<void>) => run(), storage: { get: async () => undefined, put: async () => undefined } } as unknown as DurableObjectState;
    const relay = new PersonalizationWebSocket(state, f.env), internals = relay as unknown as { connections: Map<string, unknown>; userConnections: Map<string, Set<string>>; principals: Map<string, SessionCapability> };
    internals.connections.set('connection', { readyState: 1, send: sent, close: closed }); internals.userConnections.set(g.subject, new Set(['connection'])); internals.principals.set('connection', principal);
    let delayed = false, broadcasts = 0;
    f.env.PERSONALIZATION_WEBSOCKET = { idFromName: (value: string) => value, get: () => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), body = await request.clone().json() as { consentExpiresAt?: number };
      if (new URL(request.url).pathname === '/owner/broadcast') { broadcasts++; expect(body.consentExpiresAt).toBe(at + 60000); if (delayed) clock.mockReturnValue(at + 60000); }
      return relay.fetch(request);
    } }) } as unknown as DurableObjectNamespace;
    const action = { type: 'product_view', source: 'sdk', userId: g.subject, sessionId: g.sessionId, data: { line: 'Tabby' } };
    expect((await f.call('/realtime/action', g.capability, action)).status).toBe(200); await f.drain(); expect(sent).toHaveBeenCalled();
    sent.mockClear(); delayed = true; const response = await f.call('/realtime/action', g.capability, action);
    expect(response.ok).toBe(false); expect(broadcasts).toBe(2); expect(sent).not.toHaveBeenCalled();
    expect(principal.exp * 1000).toBeGreaterThan(Date.now()); expect(storedConsent(f.objects.get(name)!.data.get('consent')).tracking).toBe(true);
  } finally { clock.mockRestore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

describe.each(['session', 'do'])('W05.10 explicit timed authority on %s', host => {
  it('W07.05 admits body snapshots and principal preferences while refusing ambiguity before owner effects', async () => {
    const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian');
    const documents = new Map<string, { text: string; etag: string }>(); let revision = 0;
    f.env.STORAGE = { get: async (key: string) => { const value = documents.get(key); return value ? { ...value, size: value.text.length, body: new Response(value.text).body, text: async () => value.text } : null; },
      put: async (key: string, text: string, options?: R2PutOptions) => { const condition = options?.onlyIf;
        if (condition instanceof Headers ? documents.has(key) : condition && condition.etagMatches !== documents.get(key)?.etag) return null;
        const etag = String(++revision); documents.set(key, { text, etag }); return { key, etag, size: text.length }; } } as unknown as R2Bucket;
    await fixturePublication(f.env, 'meridian', [
      { kind: CONTENT_KIND, scope: 'meridian', revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { pieces: [
        { id: 'public', customerContentId: 'cms-public', type: 'editorial', title: 'Public', tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' } }] } } },
      { kind: SLOTS_KIND, scope: 'meridian', revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: {} }] } } } },
      { kind: LEARN_KIND, scope: 'meridian', revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { holdout: { share: 0, salt: '', arms: ['default'] }, slots: { hero: { gamma: 1 } } } } }]);
    const raw = (path: string, body: string) => f.app.request('https://synthetic.invalid' + path, { method: 'POST',
      headers: { [SHOPPER_HEADER]: g.capability, 'X-Tenant': g.tenant, 'Content-Type': 'application/json' }, body }, f.env);
    const rejectedContexts: Array<{ legacy?: boolean; query?: string; tenant?: unknown; duplicateTenant?: boolean }> = [
      { query: '?tenant=harbor' }, { tenant: 'harbor' },
      { legacy: true, query: '?tenant=harbor' }, { legacy: true, tenant: 'harbor' },
      { tenant: null }, { tenant: ' meridian' },
      { query: '?tenant=meridian&tenant=meridian' }, { duplicateTenant: true },
    ];
    const observed = [];
    for (const context of rejectedContexts) {
      const cold = boundary(host), grant = await newAnonymousSession(cold.env, 'meridian');
      const snapshot = () => JSON.stringify({ objects: [...cold.objects].map(([key, value]) => [key, [...value.data]]),
        sessions: [...cold.sessions.data], cache: [...cold.cache.data], effects: cold.effects });
      const before = snapshot(), body = JSON.stringify({ trackingConsent: true, personalizationEnabled: true,
        choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp },
        ...(Object.hasOwn(context, 'tenant') ? { tenant: context.tenant } : {}) });
      const response = await cold.app.request('https://synthetic.invalid/realtime/session/'
        + (context.legacy ? grant.sessionId + '/' : '') + 'preferences' + (context.query ?? ''), {
        method: 'POST', headers: { [SHOPPER_HEADER]: grant.capability, 'X-Tenant': grant.tenant, 'Content-Type': 'application/json' },
        body: context.duplicateTenant ? body.replace('{', '{"tenant":"harbor","tenant":"meridian",') : body,
      }, cold.env);
      await cold.drain();
      observed.push({ status: response.status, unchanged: snapshot() === before });
    }
    expect(observed).toEqual(rejectedContexts.map(() => ({ status: 401, unchanged: true })));
    for (const [path, body] of [
      ['/v1/meridian/decisions/snapshot?tenant=harbor', '{}'], ['/v1/meridian/decisions/snapshot?visitorId=' + g.subject, '{}'],
      ['/v1/meridian/decisions/snapshot', '{"trackingConsent":"false","trackingConsent":"true"}'],
      ['/v1/meridian/decisions/snapshot', '{"trackingConsent":"false","trackingConsen\\u0074":"true"}'],
      ['/v1/meridian/decisions/snapshot', '{"userId":"' + g.subject + '"}'],
      ['/realtime/session/preferences', '{"trackingConsent":false,"trackingConsent":true}'],
    ]) {
      const before = JSON.stringify({ objects: [...f.objects].map(([k, v]) => [k, [...v.data]]), sessions: [...f.sessions.data], cache: [...f.cache.data], effects: f.effects });
      expect((await raw(path!, body!)).status).toBe(401);
      expect(JSON.stringify({ objects: [...f.objects].map(([k, v]) => [k, [...v.data]]), sessions: [...f.sessions.data], cache: [...f.cache.data], effects: f.effects })).toBe(before);
    }
    const choice = { trackingConsent: true, personalizationEnabled: true, choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: g.grantId, iat: g.iat, exp: g.exp } };
    const chosen = await raw('/realtime/session/preferences', JSON.stringify(choice));
    expect(chosen.status).toBe(200); expect(await chosen.json()).toMatchObject({ sessionId: g.sessionId, consent: { tracking: true, personalization: true } });
    const item = f.objects.get(shopperObjectName(g.tenant, g.subject))!, instruction = structuredClone(item.data.get('consent')) as ConsentInstruction;
    const selectors = { tenant: g.tenant, userId: g.subject, visitorId: g.subject, sessionId: g.sessionId };
    for (const path of ['/realtime/session/preferences', `/realtime/session/${g.sessionId}/preferences`]) {
      const retry = await raw(path + '?' + new URLSearchParams(selectors), JSON.stringify({ ...choice, ...selectors }));
      expect(retry.status).toBe(200); expect(await retry.json()).toMatchObject({ sessionId: g.sessionId, consent: { tracking: true, personalization: true } });
      expect(item.data.get('consent')).toEqual(instruction);
    }
    const refused = await raw('/v1/meridian/decisions/snapshot', JSON.stringify({ page: 'home', trackingConsent: 'false', personalizationEnabled: 'false' }));
    expect(refused.status).toBe(200); expect(await refused.json()).toMatchObject({ ok: true, arm: 'default', sources: { consent: { tracking: false, personalization: false } } });
    const stored = item.data.get('consent') as ConsentInstruction;
    expect(stored.tracking).toEqual({ ...instruction.tracking, value: false }); expect(stored.personalization).toEqual({ ...instruction.personalization, value: false });
    expect(f.effects).not.toContain('capture'); await f.drain();
  });
  it('retains necessary-copy deadlines across failed choice/activation/reset and projection scheduling, then prunes only expired choice payloads', async () => {
    const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian');
    expect((await f.call('/realtime/action', g.capability, { type: 'page_view', source: 'sdk', userId: g.subject, sessionId: g.sessionId, data: {} })).status).toBe(200);
    const item = f.objects.get(shopperObjectName(g.tenant, g.subject))!, authority = structuredClone(item.data.get('grantAuthority'));
    f.faults.write = true;
    expect((await explicitChoice(f, g, true, true)).response.ok).toBe(false);
    f.faults.write = false;
    expect(item.alarms.at(-1)).toBeGreaterThan(Date.now()); expect(item.data.get('grantAuthority')).toEqual(authority);
    expect([...item.data.keys()]).toEqual(['grantAuthority']); expect(f.sessions.data.size).toBe(0);
    expect((await explicitChoice(f, g, false, false)).response.status).toBe(200);
    const deadline = Date.now() + 10000, instruction = structuredClone(item.data.get('consent')) as ConsentInstruction;
    for (const key of ['tracking', 'personalization'] as const) instruction[key] = { value: false, chosenAt: deadline - CONSENT_LIFETIME_MS, expiresAt: deadline };
    item.data.set('consent', instruction); item.shopper = new ShopperReflex(item.state, f.env); item.alarms.length = 0;
    const activation = () => item.shopper.fetch(new Request('https://owner/identity/activate', { method: 'POST',
      headers: { [SHOPPER_HEADER]: g.capability, 'X-Tenant': g.tenant }, body: JSON.stringify({ consent: storedConsent(instruction) }) }));
    const put = vi.spyOn(item.state.storage, 'put').mockRejectedValueOnce(new Error('synthetic activation choice write failure'));
    expect((await activation()).status).toBe(401); put.mockRestore();
    expect(item.alarms.at(-1)).toBe(deadline); expect(item.data.get('consent')).toEqual(instruction);
    if (host === 'session') {
      const restrict = vi.spyOn(SessionManager.prototype, 'restrictConsent').mockRejectedValueOnce(new Error('synthetic activation compatibility read failure'));
      expect((await activation()).status).toBe(401); restrict.mockRestore();
      expect(item.alarms.at(-1)).toBe(deadline); expect(storedConsent(item.data.get('consent')).instruction?.tracking).toEqual(instruction.tracking);
    }
    // A reset commits its retained barrier/deadline even if subsequent relay
    // revocation fails. The choice alarm must survive that lost response.
    if (host === 'session') f.env.PERSONALIZATION_WEBSOCKET = { idFromName: (name: string) => name,
      get: () => ({ fetch: async () => { throw new Error('synthetic post-reset relay failure'); } }) } as unknown as DurableObjectNamespace;
    const reset = await f.call('/realtime/session/reset', g.capability, {});
    expect(reset.status).toBe(host === 'session' ? 500 : 200);
    const receiptKey = 'grantRotation:' + g.grantId, receipt = structuredClone(item.data.get(receiptKey)) as Record<string, unknown>;
    const barrier = structuredClone(item.data.get('grantAuthority'));
    expect(receipt).toMatchObject({ operation: 'reset', status: 'complete' });
    expect(barrier).toMatchObject({ grants: {} }); expect(item.alarms.at(-1)).toBe(deadline);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline + 1);
    try { item.alarms.length = 0; await item.shopper.alarm(); } finally { clock.mockRestore(); }
    expect(item.data.get('grantAuthority')).toEqual(barrier); expect(item.data.has('consent')).toBe(false);
    expect(item.data.get(receiptKey)).toEqual({ ...receipt, consent: { tracking: false, personalization: false } });
    expect(item.data.has('affinity')).toBe(false); expect(item.data.has('pipeline')).toBe(false);

    // A real signed transfer gives the target a dated receipt alongside a warm
    // profile. Expiring the former must not erase or refresh the latter.
    const linked = boundary(host), source = await newAnonymousSession(linked.env, 'meridian'); await positiveChoice(linked, source);
    expect((await linked.call('/realtime/action', source.capability, { type: 'product_view', source: 'sdk', userId: source.subject,
      sessionId: source.sessionId, data: { line: 'Tabby', productId: 'fixture-tabby' } })).status).toBe(200);
    const origin = linked.objects.get(shopperObjectName(source.tenant, source.subject))!, end = Date.now() + 10000;
    const dated = structuredClone(origin.data.get('consent')) as ConsentInstruction;
    for (const key of ['tracking', 'personalization'] as const) dated[key] = { value: true, chosenAt: end - CONSENT_LIFETIME_MS, expiresAt: end };
    origin.data.set('consent', dated); origin.shopper = new ShopperReflex(origin.state, linked.env);
    const accountId = 'w0510-copy-cleanup', exp = Math.floor(Date.now() / 1000) + 120;
    const assertion = await signAssertion('backend-proof', source.tenant, source.subject, accountId, exp);
    const response = await linked.call('/v1/meridian/identity/link', source.capability, { visitorId: source.subject, accountId, exp, assertion });
    expect(response.status).toBe(200); const targetGrant = (await response.json() as { session: SessionCapability }).session;
    const target = linked.objects.get(shopperObjectName(source.tenant, targetGrant.subject))!;
    expect(target.alarms.at(-1)).toBeLessThanOrEqual(end);
    const beforeAlarm = target.alarms.at(-1), get = target.state.storage.get.bind(target.state.storage), list = target.state.storage.list.bind(target.state.storage);
    let projectionRead = false, faultReached = false;
    const listed = vi.spyOn(target.state.storage, 'list').mockImplementation(async options => {
      if (options?.prefix === 'sessionProjection:') projectionRead = true;
      return list(options);
    });
    const read = vi.spyOn(target.state.storage, 'get').mockImplementation((async (key: string | string[]) => {
      if (key === 'consent' && projectionRead) { faultReached = true; throw new Error('synthetic consent alarm read failure'); }
      return Array.isArray(key) ? get(key) : get(key);
    }) as typeof target.state.storage.get);
    await expect(target.shopper.alarm()).rejects.toThrow('synthetic consent alarm read failure');
    read.mockRestore(); listed.mockRestore(); expect(faultReached).toBe(true); expect(target.alarms.at(-1)).toBe(beforeAlarm);
    const kept = structuredClone(target.data), physical = [...linked.sessions.data];
    const expiry = vi.spyOn(Date, 'now').mockReturnValue(end + 1);
    try { target.alarms.length = 0; await target.shopper.alarm(); } finally { expiry.mockRestore(); }
    expect(target.data.has('consent')).toBe(false);
    for (const [key, value] of kept) {
      if (key === 'consent') continue;
      if (key.startsWith('identityReceipt:')) {
        const row = value as { result: Record<string, unknown> };
        expect(target.data.get(key)).toEqual({ ...row, result: { ...row.result, consent: { tracking: false, personalization: false } } });
      } else expect(target.data.get(key), key).toEqual(value);
    }
    expect([...linked.sessions.data]).toEqual(physical);
  });
  it('keeps buffered interest positively authorized without live activity, provider work or retention renewal', async () => {
    const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await positiveChoice(f, g);
    const event = { type: 'product_view', userId: g.subject, sessionId: g.sessionId, source: 'sdk', data: { line: 'Tabby', productId: 'fixture-tabby' } };
    expect((await f.call('/realtime/action', g.capability, event)).status).toBe(200); await f.drain();
    const item = f.objects.get(shopperObjectName(g.tenant, g.subject))!;
    const before = structuredClone(item.data), beforeSession = f.sessions.data.get(tenantKey(g.tenant, 'session:' + g.sessionId));
    const transport = vi.fn(async () => { throw new Error('Buffered provider call forbidden'); }); vi.stubGlobal('fetch', transport);
    const buffered = { ...event, processing: 'buffered', timestamp: Date.now() - 1, eventId: crypto.randomUUID(), browsingSessionId: 'w0510-buffered' };
    try {
      const response = await f.call('/realtime/action', g.capability, buffered); expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ interestApplied: true, processing: 'buffered' }); await f.drain(); expect(transport).not.toHaveBeenCalled();
      if (host === 'do') {
        expect((item.data.get('affinity') as AffinityRecord).lastSeen).toBe((before.get('affinity') as AffinityRecord).lastSeen);
        expect((item.data.get('pipeline') as PipelineRecord).sessionCount).toBe((before.get('pipeline') as PipelineRecord).sessionCount);
        expect((item.data.get('affinity') as AffinityRecord).reflex.dims.line.Tabby.s).toBeGreaterThan((before.get('affinity') as AffinityRecord).reflex.dims.line.Tabby.s);
      } else {
        const after = JSON.parse(f.sessions.data.get(tenantKey(g.tenant, 'session:' + g.sessionId))!) as SessionData;
        expect(after.metadata).toEqual(JSON.parse(beforeSession!).metadata);
        const key = 'sessionProjection:' + tenantKey(g.tenant, 'session:' + g.sessionId);
        expect((item.data.get(key) as { expires: number }).expires).toBe(Math.floor((before.get(key) as { expires: number }).expires / 1000) * 1000);
        expect(after.reflex!.dims.line.Tabby.s).toBeGreaterThan(JSON.parse(beforeSession!).reflex.dims.line.Tabby.s);
      }
      expect((await explicitChoice(f, g, false, false)).response.status).toBe(200);
      const refused = structuredClone(item.data), kv = [...f.sessions.data];
      const rejected = await f.call('/realtime/action', g.capability, { ...buffered, eventId: crypto.randomUUID() });
      expect(await rejected.json()).toMatchObject({ interestApplied: false }); expect(item.data).toEqual(refused); expect([...f.sessions.data]).toEqual(kv);
    } finally { vi.unstubAllGlobals(); }
  });
  it('keeps signed absorb consent-bound while preserving the positively authorized merge and legacy-writer fence', async () => {
    const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian');
    await positiveChoice(f, g);
    expect((await f.call('/realtime/action', g.capability, { type: 'product_view', userId: g.subject, sessionId: g.sessionId,
      source: 'sdk', data: { line: 'Tabby', productId: 'fixture-tabby' } })).status).toBe(200);
    const item = f.objects.get(shopperObjectName(g.tenant, g.subject))!;
    const body = { shopperId: g.subject, affinity: structuredClone(item.data.get('affinity')), pipeline: structuredClone(item.data.get('pipeline')) };
    const request = (signed = true) => new Request('https://owner/identity/absorb', { method: 'POST', headers: signed
      ? { [SHOPPER_HEADER]: g.capability, 'X-Tenant': g.tenant }
      : { 'X-Reflex-Tenant': g.tenant, 'X-Reflex-Subject': g.subject }, body: JSON.stringify(body) });
    expect((await item.shopper.fetch(request())).status).toBe(200);
    expect((item.data.get('pipeline') as PipelineRecord).attributes.product_views).toBe(2);
    const positive = structuredClone(item.data);
    await expect(item.shopper.fetch(request(false))).rejects.toThrow(); expect(item.data).toEqual(positive);
    expect((await explicitChoice(f, g, false, false)).response.status).toBe(200);
    const before = structuredClone(item.data), kv = [...f.sessions.data];
    await expect(item.shopper.fetch(request())).rejects.toThrow();
    expect(item.data).toEqual(before); expect([...f.sessions.data]).toEqual(kv);
  });
  it('starts OFF, permits a cold necessary-only explicit choice, and enforces all four combinations without cookie authority', async () => {
    for (const tracking of [false, true]) for (const personalization of [false, true]) {
      const f = boundary(host), grant = await newAnonymousSession(f.env, 'meridian');
      await fixturePublication(f.env, 'meridian');
      const action = { type: 'product_view', userId: grant.subject, sessionId: grant.sessionId, source: 'sdk', data: { line: 'Tabby' } };
      expect((await f.call('/realtime/action', grant.capability, action)).status).toBe(200);
      const item = f.objects.get(shopperObjectName('meridian', grant.subject))!;
      expect(item.data.has('affinity')).toBe(false); expect(f.sessions.data.size).toBe(0);
      const chosen = await explicitChoice(f, grant, tracking, personalization);
      expect(chosen.response.status).toBe(200);
      expect(chosen.value.consent).toMatchObject({ tracking, personalization });
      expect([...item.data.keys()].sort()).toEqual(['consent', 'grantAuthority']);
      expect(f.sessions.data.size).toBe(0);
      const saved = structuredClone(item.data.get('consent')) as ConsentInstruction;
      expect(saved.tracking!.expiresAt - saved.tracking!.chosenAt).toBe(CONSENT_LIFETIME_MS);
      let privateUpdate = false;
      for (let view = 0; view < 3; view++) {
        const response = await f.call('/realtime/action', grant.capability, action);
        expect(response.status).toBe(200); await f.drain();
        const body = await response.json() as { consent: unknown; update?: unknown };
        expect(body.consent).toMatchObject({ tracking, personalization }); privateUpdate ||= !!body.update;
      }
      expect(host === 'session' ? f.sessions.data.has(tenantKey(grant.tenant, 'session:' + grant.sessionId)) : item.data.has('affinity')).toBe(tracking);
      if (!tracking) expect(f.sessions.data.size).toBe(0);
      expect(item.data.get('consent')).toEqual(saved);
      expect(privateUpdate).toBe(tracking && personalization);
    }
  });
  it('keeps partial/retried clocks, rejects changed retries and failed enablement, and physically expires only necessary records', async () => {
    const f = boundary(host), grant = await newAnonymousSession(f.env, 'meridian');
    const first = await explicitChoice(f, grant, true, false);
    expect(first.response.status).toBe(200);
    const item = f.objects.get(shopperObjectName('meridian', grant.subject))!;
    const original = structuredClone(item.data.get('consent')) as ConsentInstruction;
    const retry = await f.call(`/realtime/session/${grant.sessionId}/preferences`, grant.capability, first.body);
    expect(retry.status).toBe(200); expect(item.data.get('consent')).toEqual(original);
    const changed = await f.call(`/realtime/session/${grant.sessionId}/preferences`, grant.capability, { ...first.body, personalizationEnabled: true });
    expect(changed.status).toBe(409); expect(item.data.get('consent')).toEqual(original);
    const second = await explicitChoice(f, grant, undefined, true);
    expect(second.response.status).toBe(200);
    const partial = structuredClone(item.data.get('consent')) as ConsentInstruction;
    expect(partial.tracking).toEqual(original.tracking);
    expect((await f.call(`/realtime/session/${grant.sessionId}/preferences`, grant.capability, first.body)).status).toBe(409);
    f.faults.write = true;
    expect((await explicitChoice(f, grant, true, true)).response.ok).toBe(false);
    f.faults.write = false; expect(item.data.get('consent')).toEqual(partial);
    const authority = structuredClone(item.data.get('grantAuthority'));
    const time = vi.spyOn(Date, 'now').mockReturnValue(Math.max(partial.tracking!.expiresAt, partial.personalization!.expiresAt) + 1);
    try { await item.shopper.alarm(); }
    finally { time.mockRestore(); }
    expect(item.data.has('consent')).toBe(false);
    expect(item.data.get('grantAuthority')).toEqual(authority);
    expect(item.data.has('affinity')).toBe(false); expect(f.sessions.data.size).toBe(0);
  });
  describe('unit:W11.BASE.01 a typed owner or consent refusal raised inside a publication storage read propagates as the 401 refusal on both hosts; it is never rewritten into a configuration-authority error', () => {
  it('rechecks the choice at the actual post-config behavioral commit', async () => {
    const f = boundary(host), grant = await newAnonymousSession(f.env, 'meridian');
    await fixturePublication(f.env, 'meridian');
    expect((await explicitChoice(f, grant, true, true)).response.status).toBe(200);
    const item = f.objects.get(shopperObjectName('meridian', grant.subject))!, now = Date.now(), deadline = now + 10000;
    const record = structuredClone(item.data.get('consent')) as ConsentInstruction;
    for (const key of ['tracking', 'personalization'] as const) record[key] = { value: true, chosenAt: deadline - CONSENT_LIFETIME_MS, expiresAt: deadline };
    item.data.set('consent', record); item.shopper = new ShopperReflex(item.state, f.env);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), reached = new Promise<void>(resolve => { entered = resolve; });
    // Configuration is served by the publication authority, never by the retained
    // KV copy (src/config/publication.ts:19; src/reflex/configStore.ts:408-415):
    // hold the in-flight request at the actual configuration read.
    const storage = f.env.STORAGE as unknown as BoundaryR2, read = storage.get.bind(storage);
    let gated = false;
    storage.get = async (key: string) => { if (!gated && key.startsWith('config-publication/')) { gated = true; entered(); await held; } return read(key); };
    const before = structuredClone(item.data), kvBefore = [...f.sessions.data];
    const pending = f.call('/realtime/action', grant.capability, { type: 'page_view', userId: grant.subject, sessionId: grant.sessionId, source: 'sdk', data: {} });
    await reached;
    const time = vi.spyOn(Date, 'now').mockReturnValue(deadline + 1);
    try {
      release(); const refused = await pending;
      // An expired choice is not consent, so the post-config commit is refused
      // (src/content/consent.ts:139-152). Both hosts owe the same owned-state
      // refusal this file already pins for W05.05 and W05.07.
      expect(refused.status, host).toBe(401);
      expect(await refused.json()).toMatchObject({ ok: false, error: 'Shopper session unavailable' });
      await f.drain().catch(() => undefined);
    } finally { time.mockRestore(); }
    expect(item.data).toEqual(before); expect([...f.sessions.data]).toEqual(kvBefore);
  });
  });
});

describe('W04.03 serialized shopper authority', () => {
  it('preserves trusted coarse edge geography through both owner-dispatched action hosts without accepting body/header geo or refusal effects', async () => {
    for (const host of ['session', 'do']) {
      const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'), frames: Array<{ name: string; frame: IngestFrame }> = [];
      await fixturePublication(f.env, 'meridian');
      expect((await explicitChoice(f, g, true, true)).response.status).toBe(200);
      f.env.REGION_TREND = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (url: RequestInfo, init?: RequestInit) => {
        frames.push({ name, frame: await new Request(url, init).json() as IngestFrame }); return Response.json({ ok: true });
      } }) } as unknown as DurableObjectNamespace;
      const event = { userId: g.subject, sessionId: g.sessionId, type: 'custom', source: 'sdk', geo: { country: 'XX', regionCode: 'FORGED' }, data: { event: 'content_click', contentType: 'video' } };
      const forged = { 'X-Owner-Coarse-CF': JSON.stringify({ country: 'XX', regionCode: 'FORGED', latitude: 12 }) };
      expect((await f.call('/realtime/action', g.capability, event, 'meridian', undefined, { country: 'US', regionCode: 'NY' }, undefined, forged)).status).toBe(200);
      await f.drain(); expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({ name: regionObjectName('meridian', 'US-NY'), frame: { tenant: 'meridian', region: 'US-NY', touches: [{ dim: 'contentType', value: 'video' }] } });
      expect((await f.call('/realtime/action', g.capability, event, 'meridian', undefined, undefined, undefined, forged)).status).toBe(200);
      expect((await f.call('/realtime/action', g.capability, event, 'meridian', 'opt_tracking_consent=false; opt_personalization_enabled=false', { country: 'US', regionCode: 'NY' })).status).toBe(200);
      await f.drain(); expect(frames).toHaveLength(1);
    }
  });
  const warm = async (f: ReturnType<typeof boundary>, g: any) => {
    // Configuration publication is the only configuration authority; a provisioned
    // tenant fixture carries a published head (src/config/publication.ts:19, :204-206).
    await fixturePublication(f.env, g.tenant);
    if (!storedConsent(f.objects.get(shopperObjectName(g.tenant, g.subject))?.data.get('consent')).instruction) expect((await explicitChoice(f, g, true, true)).response.status).toBe(200);
    return f.call('/realtime/action', g.capability, { userId: g.subject, sessionId: g.sessionId, type: 'page_view', source: 'sdk', data: {} });
  };
  const linked = async (f: ReturnType<typeof boundary>, g: any) => {
    const accountId = 'w0403-shared-account', exp = Math.floor(Date.now() / 1000) + 120;
    const assertion = await signAssertion('backend-proof', 'meridian', g.subject, accountId, exp);
    const response = await f.call('/v1/meridian/identity/link', g.capability, { visitorId: g.subject, accountId, exp, assertion });
    expect(response.status).toBe(200); return (await response.json() as any).session;
  };
  it('orders per-grant detach, retained HEAD reads and owner reset on both hosts without reopening old cookies', async () => {
    for (const host of ['session', 'do']) {
      const f = boundary(host), first = await newAnonymousSession(f.env, 'meridian'), second = await newAnonymousSession(f.env, 'meridian');
      expect((await warm(f, first)).status).toBe(200); const a = await linked(f, first);
      expect((await warm(f, second)).status).toBe(200); const b = await linked(f, second);
      expect(a.subject).toBe(b.subject); expect(a.sessionId).toBe(b.sessionId); expect(a.grantId).not.toBe(b.grantId);
      for (const path of [`/realtime/session/${a.sessionId}/analytics`, `/realtime/segments/${a.subject}`, `/realtime/connections/${a.subject}`]) {
        const head = await f.call(path, a.capability, undefined, 'meridian', undefined, undefined, 'HEAD');
        expect(head.status, host + path).toBe(200); expect(await head.text()).toBe('');
      }
      expect((await f.call('/v1/meridian/identity/detach', a.capability, { visitorId: a.subject })).status).toBe(200);
      expect((await f.call(`/realtime/segments/${a.subject}`, a.capability, undefined, 'meridian', `opt_session_id=${a.sessionId}; opt_user_id=${a.subject}`)).status).toBe(401);
      expect((await f.call(`/realtime/segments/${b.subject}`, b.capability)).status).toBe(200);
      expect((await f.call('/realtime/session/reset', b.capability, {})).status).toBe(200);
      expect((await f.call(`/realtime/segments/${b.subject}`, b.capability)).status).toBe(401);
      await f.drain();
    }
  });
  it('keeps necessary refusal config-free, serializes accepted projection writes, and preserves import fields/pointer expiry', async () => {
    const cold = boundary(); cold.cache.data.clear();
    const boot = await cold.call('/v1/meridian/identity/session', undefined, { consent: { tracking: false, personalization: false } });
    expect(boot.status).toBe(200); const refused = (await boot.json() as any).session;
    const state = cold.objects.get(shopperObjectName('meridian', refused.subject))!.data;
    expect(state.has('affinity')).toBe(false); expect(state.has('pipeline')).toBe(false); expect(cold.cache.calls).toEqual([]);
    expect([...cold.sessions.data.keys()].some(key => key.includes('user:'))).toBe(false);
    const f = boundary(), g = await newAnonymousSession(f.env, 'meridian'); expect((await warm(f, g)).status).toBe(200);
    expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, { cookieConsent: false })).status).toBe(200);
    const key = tenantKey('meridian', 'session:' + g.sessionId), before = JSON.parse(f.sessions.data.get(key)!);
    const imported = await new SessionManager(f.env, { tenant: 'meridian' }).applyImport({ userId: g.subject,
      config: DEFAULT_REFLEX_CONFIG, rows: [{ action: 'product_view', at: Date.now() - 1000, touches: [{ dim: 'line', value: 'Tabby' }] }] });
    expect(imported.applied).toBe(true);
    const after = JSON.parse(f.sessions.data.get(key)!); expect(after.preferences).toEqual(before.preferences);
    expect(after.anonymousId).toEqual(before.anonymousId); expect(after.identity).toEqual(before.identity);
    expect(after.metadata.lastSeen).toBe(before.metadata.lastSeen);
    const item = f.objects.get(shopperObjectName('meridian', g.subject))!;
    const pointer = 'sessionProjection:' + tenantKey('meridian', 'user:' + g.subject);
    item.data.set(pointer, { ...(item.data.get(pointer) as object), expires: Date.now() - 1 });
    await item.shopper.alarm(); expect(item.data.has('affinity')).toBe(true); expect((await f.call(`/realtime/segments/${g.subject}`, g.capability)).status).toBe(200);
    let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const put = f.sessions.put.bind(f.sessions); let paused = false;
    f.sessions.put = async (selected, value) => { if (selected === key && !paused) { paused = true; entered(); await held; } return put(selected, value); };
    const preferences = f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, { cookieConsent: true });
    await started; let detached = false;
    const detach = Promise.resolve(f.call('/v1/meridian/identity/detach', g.capability, { visitorId: g.subject })).then(response => { detached = true; return response; });
    await Promise.resolve(); expect(detached).toBe(false); release();
    expect((await preferences).status).toBe(200); expect((await detach).status).toBe(200);
    expect((await f.call(`/realtime/segments/${g.subject}`, g.capability)).status).toBe(401);
  });
  it('fences actual decision and sort sinks after their tombstone awaits on both hosts', async () => {
    for (const host of ['session', 'do']) for (const selected of ['decision', 'sort', 'intent']) {
      invalidateCache(); invalidateLiftCache();
      const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian');
      expect((await warm(f, g)).status).toBe(200); await f.drain();
      const documents = new Map<string, { text: string; etag: string }>(); let revision = 0, expired = false, barrierReads = 0;
      const afterExpiry: string[] = [];
      const clock = vi.spyOn(Date, 'now');
      try {
        f.env.STORAGE = {
          get: async (key: string) => {
            if (key.startsWith('erasures/')) { barrierReads++; expired = true; clock.mockReturnValue((g.exp + 1) * 1000); return null; }
            const v = documents.get(key); return v ? { etag: v.etag, size: v.text.length, body: new Response(v.text).body,
              text: async () => v.text, json: async () => JSON.parse(v.text) as unknown } : null;
          },
          put: async (key: string, text: string, options?: R2PutOptions) => {
            if (expired) afterExpiry.push('r2:' + key);
            const condition = options?.onlyIf;
            if (condition instanceof Headers ? documents.has(key) : condition && condition.etagMatches !== documents.get(key)?.etag) return null;
            const etag = String(++revision); documents.set(key, { text, etag }); return { key, etag, size: text.length };
          },
        } as unknown as R2Bucket;
        await fixturePublication(f.env, 'meridian', [
          { kind: CONTENT_KIND, scope: 'meridian', revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { pieces: [
            { id: 'a', customerContentId: 'cms-a', type: 'editorial', title: 'A', tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' } }] } } },
          { kind: SLOTS_KIND, scope: 'meridian', revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: {} }] } } } },
          { kind: LEARN_KIND, scope: 'meridian', revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { holdout: { share: 0, salt: '', arms: ['default'] }, slots: { hero: { gamma: 1 } } } } }]);
        const namespace = (kind: string) => ({ idFromName: (name: string) => name, get: () => ({ fetch: async (url: string, init?: RequestInit) => {
          if (expired) afterExpiry.push(kind + ':' + new URL(url).pathname);
          return Response.json({}, { status: init?.method === 'POST' ? 200 : 404 });
        } }) });
        Object.assign(f.env, { DECISION_RING: namespace('ring'), LEARN_STATS: namespace('exposure'),
          EVENT_QUEUE: { send: async () => { if (expired) afterExpiry.push('queue'); } },
          ANALYTICS: { writeDataPoint: () => { if (expired) afterExpiry.push('analytics'); } } });
        const response = selected === 'decision'
          ? await f.call(`/v1/meridian/decisions/snapshot?page=home&visitorId=${g.subject}&sessionId=${g.sessionId}`, g.capability)
          : await f.call(selected === 'sort' ? '/sort' : '/sort/intent', g.capability,
            { userId: g.subject, sessionId: g.sessionId, candidates: [{ id: 'synthetic', inStock: true }], ...(selected === 'intent' ? { intent: { filters: [] }, limit: 1 } : {}) });
        expect(barrierReads, host + ':' + selected).toBeGreaterThan(0);
        expect(response.status, host + ':' + selected).toBe(401); expect(afterExpiry).toEqual([]);
        expect(await response.text()).not.toContain('cms-a');
      } finally { clock.mockRestore(); }
    }
  });
  it('binds backend imports to existing owner SID witnesses, prepared bytes and current epochs without requiring a live bearer', async () => {
    const f = boundary(), g = await newAnonymousSession(f.env, 'meridian'); expect((await warm(f, g)).status).toBe(200);
    const item = f.objects.get(shopperObjectName('meridian', g.subject))!, key = tenantKey('meridian', 'session:' + g.sessionId);
    const raw = f.sessions.data.get(key)!;
    item.data.delete('affinity'); item.data.delete('pipeline');
    const authority = structuredClone(item.data.get('grantAuthority')) as { epoch: string; grants: Record<string, SessionCapability> };
    authority.grants[g.grantId!].exp = Math.floor(Date.now() / 1000) - 1;
    authority.grants[g.grantId!].iat = authority.grants[g.grantId!].exp - 3600;
    item.data.set('grantAuthority', authority); item.shopper = new ShopperReflex(item.state, f.env);
    const invoke = (path: string, body: unknown) => item.shopper.fetch(new Request('https://shopper-reflex' + path,
      { method: 'POST', headers: { 'X-Reflex-Tenant': 'meridian', 'X-Reflex-Subject': g.subject }, body: JSON.stringify(body) }));
    const payload = { operationId: crypto.randomUUID(), shopperId: g.subject, now: Date.now(), rows: [{ action: 'product_view', at: Date.now() - 1000, touches: [{ dim: 'line', value: 'Tabby' }] }] };
    expect((await invoke('/identity/import/admission', payload)).status).toBe(200);
    expect(item.alarms.length).toBeGreaterThan(0);
    const expiredKey = 'identityImport:' + crypto.randomUUID();
    item.data.set(expiredKey, { epoch: authority.epoch, digest: 'synthetic-expired-prepared', expires: Date.now() - 1 });
    await item.shopper.alarm(); expect(item.data.has(expiredKey)).toBe(false);
    expect(item.data.has('identityImport:' + payload.operationId)).toBe(true); expect(item.data.has('affinity')).toBe(false);
    const prepared = structuredClone([...item.data]);
    item.data.set('consent', { tracking: false, personalization: false });
    const refusedState = structuredClone([...item.data]);
    expect(await (await invoke('/identity/import', payload)).json()).toMatchObject({ applied: 0, reason: 'consent_refused' });
    expect([...item.data]).toEqual(refusedState); expect(f.sessions.data.get(key)).toBe(raw);
    item.data.set('consent', new Map(prepared).get('consent'));
    f.sessions.data.set(key, JSON.stringify({ ...JSON.parse(raw), attributes: { changed: true } }));
    await expect(invoke('/identity/import', payload)).rejects.toThrow(); expect([...item.data]).toEqual(prepared);
    f.sessions.data.set(key, raw);
    const accepted = await invoke('/identity/import', payload); expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ applied: 1, sessionId: g.sessionId });
    const committed = structuredClone([...item.data]), retained = f.sessions.data.get(key);
    expect((await invoke('/identity/import', payload)).status).toBe(200); expect([...item.data]).toEqual(committed); expect(f.sessions.data.get(key)).toBe(retained);
    item.shopper = new ShopperReflex(item.state, f.env);
    expect((await invoke('/identity/import/result', { operationId: payload.operationId })).status).toBe(200);
    const namespace = f.env.SHOPPER_REFLEX, lost = new Set<string>(), recovery: string[] = [];
    f.env.SHOPPER_REFLEX = { idFromName: namespace.idFromName.bind(namespace), get: (id: DurableObjectId) => {
      const stub = namespace.get(id); return { fetch: async (url: string, init?: RequestInit) => {
        const response = await stub.fetch(url, init), path = new URL(url).pathname; recovery.push(path);
        if (['/identity/import/admission', '/identity/import'].includes(path) && !lost.has(path)) { lost.add(path); throw new Error('synthetic accepted response loss'); }
        return response;
      } }; },
    } as unknown as DurableObjectNamespace;
    const recovered = await new SessionManager(f.env, { tenant: 'meridian' }).applyImport({ userId: g.subject, config: DEFAULT_REFLEX_CONFIG,
      rows: [{ action: 'purchase', at: payload.now, touches: [{ dim: 'line', value: 'Rogue' }] }] });
    expect(recovered.applied).toBe(true);
    expect(recovery).toEqual(['/identity/import/admission', '/identity/import/admission/result', '/identity/import', '/identity/import/result']);
    expect(JSON.parse(f.sessions.data.get(key)!).reflex.dims.line.Rogue.s).toBe(5);
    item.data.set(expiredKey, { epoch: authority.epoch, digest: 'synthetic-expired-committed', expires: Date.now() - 1, result: { ok: true } });
    await item.shopper.alarm(); expect(item.data.has(expiredKey)).toBe(false); expect(item.data.has('affinity')).toBe(true);
    f.env.SHOPPER_REFLEX = namespace;
    const next = { ...payload, operationId: crypto.randomUUID(), now: payload.now + 1 };
    expect((await invoke('/identity/import/admission', next)).status).toBe(200);
    expect((await invoke('/identity/erase/object', { erasureId: crypto.randomUUID() })).status).toBe(200);
    const barrier = structuredClone([...item.data]), rawAfter = [...f.sessions.data];
    await expect(invoke('/identity/import', next)).rejects.toThrow();
    await expect(invoke('/identity/import/result', { operationId: payload.operationId })).rejects.toThrow();
    expect([...item.data]).toEqual(barrier); expect([...f.sessions.data]).toEqual(rawAfter);
    // Exact-looking KV with no retained ownership is not an import/migration grant.
    f.sessions.data.set(key, raw); f.sessions.data.set(tenantKey('meridian', 'user:' + g.subject), g.sessionId);
    await expect(invoke('/identity/import/admission', { ...next, operationId: crypto.randomUUID() })).rejects.toThrow();
    expect([...item.data]).toEqual(barrier);
  });
  it('drains actual FX dispatcher and ODP query transports with bounded cancellation before queued detach', async () => {
    for (const provider of ['fx', 'odp']) {
      const f = boundary(), g = await newAnonymousSession(f.env, 'meridian');
      expect((await warm(f, g)).status).toBe(200); await f.drain();
      let started!: () => void; const entered = new Promise<void>(resolve => { started = resolve; });
      const attempts: string[] = [], cancelled: string[] = [];
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
        if (url === 'https://synthetic.invalid/datafile') return Promise.resolve(Response.json({ revision: 'w0403', audiences: [], experiments: [], featureFlags: [] }));
        attempts.push(url); started();
        return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => {
          cancelled.push(url); reject(new Error('synthetic bounded transport cancellation'));
        }, { once: true }));
      });
      try {
        if (provider === 'fx') {
          Object.assign(f.env, { OPTIMIZELY_SDK_KEY: 'w0403-synthetic', OPTIMIZELY_DATAFILE_URL: 'https://synthetic.invalid/datafile' });
          vi.spyOn(optimizelySdk, 'createInstance').mockImplementation((options: any) => ({ onReady: async () => undefined,
            track: () => options.eventDispatcher.dispatchEvent({ url: 'https://synthetic.invalid/fx-event', params: { synthetic: true } }),
          } as never));
        } else Object.assign(f.env, { TENANT_CONNECTORS: JSON.stringify({ version: 1, tenants: { meridian: { odp: {
          apiHost: 'https://odp-meridian.invalid', publicKeyRef: 'CONNECTOR_SECRET_ODP', identityNamespace: 'customer',
          actions: {}, audiences: { remote: 'ODP_ALLOWED' }, profile: {},
        } } } }), CONNECTOR_SECRET_ODP: 'synthetic' });
        const pending = provider === 'fx' ? f.call('/optimizely/track', g.capability, { userId: g.subject, eventKey: 'synthetic' }) : warm(f, g);
        await entered;
        let detached = false;
        const detach = Promise.resolve(f.call('/v1/meridian/identity/detach', g.capability, {})).then(response => { detached = true; return response; });
        await Promise.resolve(); expect(detached).toBe(false);
        expect((await pending).status).toBe(200); expect(cancelled).toEqual(attempts);
        expect(attempts).toEqual([provider === 'fx' ? 'https://synthetic.invalid/fx-event' : 'https://odp-meridian.invalid/v3/graphql']);
        expect((await detach).status).toBe(200);
        expect((await f.call(`/realtime/segments/${g.subject}`, g.capability)).status).toBe(401);
      } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
    }
  }, 20_000);
  it('drains unawaited private I/O, fences post-await egress expiry and cancels actual provider transport', async () => {
    const f = boundary(), principal = await newAnonymousSession(f.env, 'meridian'), owner = {};
    let release!: () => void, ended = false; const held = new Promise<void>(resolve => { release = resolve; });
    const committed: string[] = [];
    let retained!: ReturnType<typeof sessionAuthorityKV>;
    const operation = runOwnerOperation(owner, f.env, async () => {
      admitOwnerPrincipal(owner, principal); retained = sessionAuthorityKV(f.env, principal);
      void retained.put('session:synthetic', 'private');
    }, { get: async () => null, put: async () => { await held; committed.push('put'); }, delete: async () => {}, list: async () => ({ keys: [] }) }).then(() => { ended = true; });
    await Promise.resolve(); expect(ended).toBe(false); release(); await operation; expect(committed).toEqual(['put']);
    expect(() => retained.get('session:synthetic')).toThrow(SessionAccessError);
    const effects: string[] = [];
    Object.assign(f.env, { STORAGE: { get: async () => { vi.spyOn(Date, 'now').mockReturnValue((principal.exp + 1) * 1000); return null; }, put: async () => effects.push('r2') },
      ANALYTICS: { writeDataPoint: () => effects.push('analytics') }, EVENT_QUEUE: { send: async () => effects.push('queue') } });
    try { await expect(runOwnerOperation(owner, f.env, async () => {
      admitOwnerPrincipal(owner, principal); const scoped = ownerEnvironment(owner, f.env);
      await scoped.STORAGE.get('synthetic-tombstone'); await scoped.EVENT_QUEUE.send({}); scoped.ANALYTICS!.writeDataPoint({ indexes: ['synthetic'] });
    })).rejects.toBeInstanceOf(SessionAccessError); expect(effects).toEqual([]); }
    finally { vi.restoreAllMocks(); }
    let aborted = false;
    vi.stubGlobal('fetch', (_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('synthetic transport abort')); }, { once: true });
    }));
    try { await runOwnerOperation(owner, f.env, async () => { admitOwnerPrincipal(owner, principal); void ownerFetch('https://provider.invalid/synthetic', {}, 2).catch(() => undefined); }); expect(aborted).toBe(true); }
    finally { vi.unstubAllGlobals(); }
  });
});

describe('W35.03 recoverable identity transfer', () => {
  type Grant = Awaited<ReturnType<typeof newAnonymousSession>>;
  type Fixture = ReturnType<typeof boundary>;
  const event = (g: Grant) => ({ userId: g.subject, sessionId: g.sessionId, type: 'page_view', source: 'sdk', data: {},
    entry: { utmMedium: 'paid_social', utmSource: 'tiktok', referrer: 'tiktok.com', siteHost: 'shop.invalid' } });
  const item = (f: Fixture, subject: string) => f.objects.get(shopperObjectName('meridian', subject))!;
  const restart = (f: Fixture, subject: string) => { const o = item(f, subject); o.shopper = new ShopperReflex(o.state, f.env); return o; };
  const internal = (f: Fixture, subject: string, path: string, body?: unknown, tenant = 'meridian') =>
    f.env.SHOPPER_REFLEX.get(f.env.SHOPPER_REFLEX.idFromName(shopperObjectName('meridian', subject))).fetch('https://shopper-reflex' + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': tenant, 'X-Reflex-Subject': subject },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const link = (f: Fixture, g: Grant, accountId = 'w3503-person', cookieHeader?: string) => linkVisitor(f.env, g.tenant,
    { visitorId: g.subject, accountId, source: 'login', assurance: 'signed', principal: g, capability: g.capability, cookieHeader });
  const pipe = (f: Fixture, subject: string) => item(f, subject).data.get('pipeline') as PipelineRecord;
  // Explicit synthetic successor setup: unsigned absorb cannot bypass a retained barrier.
  const seedSuccessor = (f: Fixture, subject: string, tagged = false) => {
    const target = item(f, subject), now = Date.now();
    target.data.set('affinity', { shopperId: subject, reflex: emptyState(DEFAULT_REFLEX_CONFIG), odpSeed: [],
      odpSeedAt: 0, odpRecentEvents: [], lastSeen: now, configVersion: DEFAULT_REFLEX_CONFIG.version,
      ...(tagged ? { retention: retentionBirth(f.env, 'meridian', 'profile', now, now) } : {}) } satisfies AffinityRecord);
    target.data.set('pipeline', { attributes: {}, segments: [], journeyStage: 'early', sessionId: crypto.randomUUID(),
      visitorId: subject, firstSeen: now, sessionCount: 0 } satisfies PipelineRecord);
    target.data.set('audienceOwner', null); restart(f, subject);
  };
  async function warm(f: Fixture) {
    const g = await newAnonymousSession(f.env, 'meridian');
    await positiveChoice(f, g);
    expect((await f.call('/realtime/action', g.capability, event(g))).status).toBe(200);
    expect((await f.call('/realtime/action', g.capability, event(g))).status).toBe(200);
    expect((await f.call('/realtime/action', g.capability, { ...event(g), type: 'custom', data: { event: 'content_click', contentType: 'video' } })).status).toBe(200);
    const p = pipe(f, g.subject);
    item(f, g.subject).data.set('pipeline', { ...p, profileEnrichment: readEnrichment({ version: 1,
      sources: { crm: { at: Date.now(), fields: {}, audiences: { vip: 'Synthetic membership' } } } }) });
    restart(f, g.subject); await f.drain(); return g;
  }
  const gate = () => { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; };

  it('W35.07 binds cutoff receipts to exact session generations across source retirement, SID reuse and restart', async () => {
    try {
      for (const retired of [false, true]) {
        invalidateCache(); const f = boundary('do'), g = await warm(f), linked = await link(f, g), target = linked.shopperId;
        const source = item(f, g.subject), destination = item(f, target), erasureId = crypto.randomUUID();
        const registration = [...destination.data].find(([key]) => key.startsWith('identityRegistration:'))![1];
        const session = (subject: string, sessionId: string) => internal(f, subject, '/identity/erase/session', { erasureId, sessionId });
        const before = structuredClone([...destination.data]);
        const transaction = destination.state.storage.transaction.bind(destination.state.storage);
        const fail = vi.spyOn(destination.state.storage, 'transaction').mockRejectedValueOnce(new Error('synthetic transaction rollback'));
        await expect(internal(f, target, '/identity/erase/begin', { erasureId })).rejects.toThrow();
        expect([...destination.data]).toEqual(before);
        fail.mockImplementationOnce(async (...args: Parameters<typeof destination.state.storage.transaction>) => {
          await transaction(...args); throw new Error('synthetic committed barrier acknowledgement');
        });
        await expect(internal(f, target, '/identity/erase/begin', { erasureId })).rejects.toThrow(); fail.mockRestore();
        restart(f, target);
        expect(await (await internal(f, target, '/identity/erase/begin', { erasureId })).json()).toEqual({ ok: true, highWater: 1 });
        expect((await session(target, linked.sessionId!)).status).toBe(200);
        await expect(session(target, 'unwitnessed-session')).rejects.toThrow();
        await expect(session(g.subject, g.sessionId)).rejects.toThrow();
        if (retired) {
          await internal(f, g.subject, '/reset', {});
          seedSuccessor(f, g.subject);
        }
        const successor = retired ? structuredClone(source.data.get('pipeline')) : null;
        const sourceTransaction = source.state.storage.transaction.bind(source.state.storage);
        const lost = vi.spyOn(source.state.storage, 'transaction').mockImplementationOnce(async (...args: Parameters<typeof source.state.storage.transaction>) => {
          await sourceTransaction(...args); throw new Error('synthetic committed source acknowledgement');
        });
        await expect(internal(f, g.subject, '/identity/erase/source', { erasureId, registration })).rejects.toThrow(); lost.mockRestore();
        restart(f, g.subject);
        expect((await internal(f, g.subject, '/identity/erase/source', { erasureId, registration })).status).toBe(200);
        expect((await session(g.subject, g.sessionId)).status).toBe(200);
        if (retired) expect(source.data.get('pipeline')).toEqual(successor);
        const witnessKey = 'identitySessionErasure:' + erasureId + ':' + g.sessionId;
        expect(source.data.get(witnessKey)).toMatchObject({ sessionId: g.sessionId, epoch: g.authorityEpoch, witness: expect.any(String) });
        await internal(f, g.subject, '/reset', {}); restart(f, g.subject);
        expect((await session(g.subject, g.sessionId)).status).toBe(200);
        const exact = structuredClone(source.data.get(witnessKey)); source.data.delete(witnessKey);
        // A valid generic/current receipt without the exact SID witness is insufficient.
        expect((await internal(f, g.subject, '/identity/erase/object', { erasureId })).status).toBe(200);
        await expect(session(g.subject, g.sessionId)).rejects.toThrow(); source.data.set(witnessKey, exact);
        const fresh = await warm(f), next = await link(f, fresh);
        expect(destination.data.get('identitySequence')).toBe(2);
        expect(next.sessionId).not.toBe(linked.sessionId);
        const latest = structuredClone([...destination.data]);
        expect((await internal(f, target, '/identity/erase/object', { erasureId })).status).toBe(200);
        await expect(session(target, next.sessionId!)).rejects.toThrow();
        expect([...destination.data]).toEqual(latest);
        // Observable same-SID reuse must fail even if the serialized KV record is identical.
        const authority = destination.data.get('grantAuthority') as { epoch: string; grants: Record<string, { sessionId: string }> };
        const reused = structuredClone(authority); for (const grant of Object.values(reused.grants)) grant.sessionId = linked.sessionId!;
        destination.data.set('grantAuthority', reused); restart(f, target);
        await expect(session(target, linked.sessionId!)).rejects.toThrow(); destination.data.set('grantAuthority', authority);
        const pipeline = pipe(f, target); destination.data.set('pipeline', { ...pipeline, sessionId: linked.sessionId }); restart(f, target);
        await expect(session(target, linked.sessionId!)).rejects.toThrow(); destination.data.set('pipeline', pipeline); restart(f, target);
        expect((await session(target, linked.sessionId!)).status).toBe(200);
        // Generic cleanup captures only grants present in its atomic pre-barrier state.
        const generic = await warm(f), genericId = crypto.randomUUID();
        expect((await internal(f, generic.subject, '/identity/erase/object', { erasureId: genericId })).status).toBe(200);
        restart(f, generic.subject);
        expect((await internal(f, generic.subject, '/identity/erase/session', { erasureId: genericId, sessionId: generic.sessionId })).status).toBe(200);
        await expect(internal(f, generic.subject, '/identity/erase/session', { erasureId: genericId, sessionId: 'fresh-unwitnessed' })).rejects.toThrow();
        await f.drain();
      }
      // Actual controller: freeze H, then expose an H+1 canonical session under
      // the old receipt. Registered sources finish first, but no KV copy is deleted.
      invalidateCache(); const f = boundary('do'), old = await warm(f), linked = await link(f, old);
      const bucket = new BoundaryR2(), records = bucket.data;
      // readObject/put require whole-object results (src/config/publication.ts:225-237, :295).
      const storage = { get: (key: string) => bucket.get(key), put: (key: string, body: string, options?: R2PutOptions) => bucket.put(key, body, options),
        delete: (key: string) => bucket.delete(key), list: (options: { prefix?: string }) => bucket.list(options) };
      f.env.STORAGE = storage as unknown as R2Bucket;
      const key = await erasureJobKey('meridian', { shopperId: linked.shopperId }), put = storage.put.bind(storage);
      const stop = vi.spyOn(storage, 'put').mockImplementation(async (path, body, options) => {
        const result = await put(path, body, options);
        if (path === key && JSON.parse(body).sources?.highWater === 1) throw new Error('synthetic cutoff checkpoint');
        return result;
      });
      expect((await eraseSubject(f.env, 'meridian', { shopperId: linked.shopperId }, 'w3507')).httpStatus).toBe(503); stop.mockRestore();
      const shopperKey = tenantKey('meridian', 'identity:shopper:' + linked.shopperId), originalProjection = f.sessions.data.get(shopperKey)!;
      const later = await warm(f), successor = await link(f, later);
      // Exact synthetic historical bytes, not a cold consent-protected write.
      f.sessions.data.set(tenantKey('meridian', 'session:' + successor.sessionId), JSON.stringify({ userId: successor.shopperId,
        identity: { shopperId: successor.shopperId, linkedAt: 1 }, segments: [], attributes: {}, metadata: { firstSeen: 1, lastSeen: 1,
          sessionCount: 1, engagementScore: 0, lastSegmentUpdate: 1 }, preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true } }));
      // Keep captured ownership projections stable while exposing the new session.
      f.sessions.data.delete(tenantKey('meridian', 'user:' + successor.shopperId));
      f.sessions.data.set(shopperKey, originalProjection);
      const before = [...f.sessions.data], cache = [...f.cache.data], remove = vi.spyOn(f.sessions, 'delete');
      const result = await eraseSubject(f.env, 'meridian', { shopperId: linked.shopperId }, 'w3507');
      expect(result).toMatchObject({ httpStatus: 503, localComplete: false, discovery: { registeredSourceComplete: true } });
      expect(remove).not.toHaveBeenCalled(); expect([...f.sessions.data]).toEqual(before); expect([...f.cache.data]).toEqual(cache);
      expect(item(f, old.subject).data.has('identityTransfer')).toBe(false);
      expect(item(f, later.subject).data.has('identityTransfer')).toBe(true);
      expect(item(f, successor.shopperId).data.has('pipeline')).toBe(true);
      await f.drain();
    } finally { vi.restoreAllMocks(); }
  });

  it('W35.06 preserves intent registration and generation witnesses through checkpointed paged source erasure', async () => {
    try {
      for (const phase of ['intent', 'admission']) {
        invalidateCache(); const f = boundary('do'), g = await warm(f), target = await shopperIdFor(f.env, g.tenant, 'w3503-person');
        await internal(f, target, '/identity/export');
        const owner = item(f, phase === 'intent' ? g.subject : target), put = owner.state.storage.put.bind(owner.state.storage);
        const fail = vi.spyOn(owner.state.storage, 'put').mockImplementationOnce(async (...args: Parameters<typeof owner.state.storage.put>) => {
          await put(...args); throw new Error('synthetic lost durable acknowledgement');
        });
        await expect(link(f, g)).rejects.toThrow(); fail.mockRestore();
        const intent = structuredClone(item(f, g.subject).data.get('identityIntent'));
        expect(intent).toMatchObject({ visitorId: g.subject, sourceEpoch: g.authorityEpoch, shopperId: target });
        expect(item(f, g.subject).data.has('identityTransfer')).toBe(false);
        restart(f, g.subject); expect((await f.call('/realtime/action', g.capability, event(g))).status).toBe(401);
        await expect(internal(f, g.subject, '/identity/import', { shopperId: g.subject, rows: [] })).rejects.toThrow();
        await expect(link(f, g, 'another-account')).rejects.toThrow();
        if (phase === 'admission') {
          const first = await (await internal(f, target, '/identity/admission', { intent })).json();
          await internal(f, target, '/reset', {}); restart(f, target);
          expect(await (await internal(f, target, '/identity/admission', { intent })).json()).toEqual(first);
          await expect(link(f, g)).rejects.toThrow();
          expect(item(f, target).data.has('affinity')).toBe(false);
          expect(item(f, target).data.get('identitySequence')).toBe(1);
        } else await link(f, g);
        expect(item(f, g.subject).data.get('identityIntent')).toEqual(intent);
        const registration = [...item(f, target).data].find(([key]) => key.startsWith('identityRegistration:'))![1] as { intent: Record<string, unknown> };
        if (phase === 'intent') {
          item(f, target).data.delete('identityRegistration:0000000000000001');
          const withoutRegistration = structuredClone([...item(f, target).data]);
          await expect(link(f, g)).rejects.toThrow(); expect([...item(f, target).data]).toEqual(withoutRegistration);
          item(f, target).data.set('identityRegistration:0000000000000001', registration);
        }
        const erasureId = crypto.randomUUID();
        item(f, target).data.set('identitySequence', 0);
        const malformedHighWater = structuredClone([...item(f, target).data]);
        await expect(internal(f, target, '/identity/erase/begin', { erasureId })).rejects.toThrow();
        expect([...item(f, target).data]).toEqual(malformedHighWater); item(f, target).data.set('identitySequence', 1);
        expect(await (await internal(f, target, '/identity/erase/begin', { erasureId })).json()).toEqual({ ok: true, highWater: 1 });
        const source = item(f, g.subject), original = structuredClone([...source.data]);
        source.data.set('identityIntent', { ...registration.intent, sourceSessionId: 'not-the-registered-session' });
        const corrupt = structuredClone([...source.data]);
        await expect(internal(f, g.subject, '/identity/erase/source', { erasureId, registration })).rejects.toThrow();
        expect([...source.data]).toEqual(corrupt); source.data.clear(); for (const [key, value] of original) source.data.set(key, value);
        restart(f, g.subject);
        expect((await internal(f, g.subject, '/identity/erase/source', { erasureId, registration })).status).toBe(200);
        expect(source.data.has('affinity')).toBe(false); expect(source.data.has('pipeline')).toBe(false);
        expect(source.data.has('identityTransfer')).toBe(false); expect(source.data.has('forwardTo')).toBe(false);
        expect((await f.call('/realtime/action', g.capability, event(g))).status).toBe(401);
        expect((await internal(f, target, '/identity/erase/ack', { erasureId, registration })).status).toBe(200);
        const ack = [...item(f, target).data].find(([key]) => key.startsWith('identityRegistration:'))![1];
        expect(JSON.stringify(ack)).not.toContain(g.subject); expect(JSON.stringify(ack)).not.toContain(g.sessionId);
        if (phase === 'intent') { await internal(f, target, '/reset', {}); await internal(f, g.subject, '/reset', {}); }
        else {
          const oldPolicy = f.env.RETENTION, categories = fixtureCategories(['coach', 'meridian']);
          categories.meridian!.profile = { ...fixtureRetentionPolicy, durationMs: 60000 };
          f.env.RETENTION = JSON.stringify({ version: 1, tenants: categories });
          const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
          for (const subject of [target, g.subject]) {
            seedSuccessor(f, subject, true);
            const original = (item(f, subject).data.get('affinity') as AffinityRecord).retention!;
            clock.mockReturnValue(original.expiresAt);
            restart(f, subject); await item(f, subject).shopper.alarm(); expect(item(f, subject).data.has('affinity')).toBe(false);
          }
          clock.mockRestore(); f.env.RETENTION = oldPolicy;
        }
        const fresh = await warm(f), linked = await link(f, fresh);
        seedSuccessor(f, g.subject);
        const newTarget = structuredClone([...item(f, target).data]), newSource = structuredClone([...source.data]);
        restart(f, target); restart(f, g.subject);
        expect(await (await internal(f, target, '/identity/erase/begin', { erasureId })).json()).toEqual({ ok: true, highWater: 1 });
        expect((await internal(f, target, '/identity/erase/object', { erasureId })).status).toBe(200);
        expect((await internal(f, g.subject, '/identity/erase/source', { erasureId, registration })).status).toBe(200);
        expect((await internal(f, g.subject, '/identity/erase/object', { erasureId })).status).toBe(200);
        expect([...item(f, target).data]).toEqual(newTarget); expect([...source.data]).toEqual(newSource);
        expect(linked.grant?.authorityEpoch).not.toBe((registration as unknown as { targetEpoch: string }).targetEpoch);
        const page = await (await internal(f, target, '/identity/erase/page', { erasureId, after: 0, limit: 32 })).json() as { entries: unknown[]; next: number; complete: boolean };
        expect(page).toMatchObject({ next: 1, complete: true }); expect(page.entries).toEqual([ack]);
        await f.drain();
      }
    } finally { vi.restoreAllMocks(); }
    // The same protocol through the actual erasure controller, including >50 sources.
    try {
      for (const phase of ['wide', 'barrier', 'source', 'ack', 'page', 'root', 'repeat-source', 'post-cutoff']) {
        invalidateCache(); const f = boundary('do'), bucket = new BoundaryR2(), records = bucket.data;
        // readObject/put require whole-object results (src/config/publication.ts:225-237, :295).
        const storage = { get: (key: string) => bucket.get(key), put: (key: string, body: string, options?: R2PutOptions) => bucket.put(key, body, options),
          delete: (key: string) => bucket.delete(key), list: (options: { prefix?: string }) => bucket.list(options) };
        f.env.STORAGE = storage as unknown as R2Bucket;
        const target = await shopperIdFor(f.env, 'meridian', 'w3503-person'); await internal(f, target, '/identity/export');
        const destination = item(f, target), sources: Grant[] = [];
        for (let n = 0; n < (phase === 'wide' ? 52 : 2); n++) {
          const repeated = phase === 'repeat-source' && n === 1, g = repeated ? sources[0] : await warm(f); sources.push(g);
          if (repeated) {
            const epoch = (item(f, g.subject).data.get('identityIntent') as { sourceEpoch: string }).sourceEpoch;
            await internal(f, g.subject, '/reset', {}); restart(f, g.subject);
            expect(item(f, g.subject).data.has('identityRetired:' + epoch)).toBe(true);
            seedSuccessor(f, g.subject);
          }
          const put = destination.state.storage.put.bind(destination.state.storage), indexPut = f.sessions.put.bind(f.sessions);
          const failure = n === 0 ? vi.spyOn(destination.state.storage, 'put').mockImplementation(async (...args: Parameters<typeof destination.state.storage.put>) => {
            if (typeof args[0] === 'object' && 'identityMembers' in args[0]) throw new Error('synthetic precommit source');
            return put(...args);
          }) : n === 1 ? vi.spyOn(f.sessions, 'put').mockImplementation(async (key, value) => {
            if (key.includes('identity:shopper:')) throw new Error('synthetic unpublished source'); return indexPut(key, value);
          }) : null;
          const linking = repeated ? linkVisitor(f.env, g.tenant,
            { visitorId: g.subject, accountId: 'w3503-person', source: 'login', assurance: 'signed' }) : link(f, g);
          if (failure) { await expect(linking).rejects.toThrow(); failure.mockRestore(); } else await linking;
        }
        const registrations = [...destination.data].filter(([name]) => name.startsWith('identityRegistration:')).map(([, value]) => structuredClone(value));
        expect(sources.slice(0, 2).every(g => !f.sessions.data.has(tenantKey(g.tenant, 'identity:visitor:' + g.subject)))).toBe(true);
        if (phase === 'wide') expect((destination.data.get('identityMembers') as { visitors: unknown[] }).visitors).toHaveLength(50);
        const foreign = await newAnonymousSession(f.env, 'kate-spade');
        const foreignObject = f.env.SHOPPER_REFLEX.get(f.env.SHOPPER_REFLEX.idFromName(shopperObjectName(foreign.tenant, foreign.subject)));
        await foreignObject.fetch('https://shopper-reflex/identity/export', { headers: { 'X-Reflex-Tenant': foreign.tenant, 'X-Reflex-Subject': foreign.subject } });
        const foreignState = structuredClone([...f.objects.get(shopperObjectName(foreign.tenant, foreign.subject))!.data]);
        const key = await erasureJobKey('meridian', { shopperId: target }), fetch = destination.shopper.fetch.bind(destination.shopper);
        if (phase === 'post-cutoff') {
          const put = storage.put.bind(storage);
          const pause = vi.spyOn(storage, 'put').mockImplementation(async (path, body, options) => {
            const result = await put(path, body, options), value = JSON.parse(body);
            if (path === key && value.sources?.highWater === sources.length) throw new Error('synthetic pause after cutoff checkpoint');
            return result;
          });
          expect((await eraseSubject(f.env, 'meridian', { shopperId: target }, 'w3506-synthetic')).httpStatus).toBe(503); pause.mockRestore();
          const cutoff = JSON.parse(records.get(key)!).sources;
          expect(cutoff.highWater).toBe(sources.length);
          const later = await warm(f); await link(f, later);
          expect(destination.data.get('identitySequence')).toBe(cutoff.highWater + 1);
          // A historical compatibility copy under this already recognized SID;
          // DO live capture itself does not publish an anonymous KV session.
          f.sessions.data.set(tenantKey(later.tenant, 'session:' + later.sessionId), JSON.stringify({ userId: later.subject, segments: [], attributes: {},
            metadata: { firstSeen: 1, lastSeen: 1, sessionCount: 1, engagementScore: 0, lastSegmentUpdate: 1 },
            preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true } }));
          f.sessions.data.set(tenantKey(later.tenant, 'user:' + later.subject), later.sessionId);
          const get = f.sessions.get.bind(f.sessions), list = f.sessions.list.bind(f.sessions);
          // KV point reads expose the extra source/session while independent projections/LIST lag.
          vi.spyOn(f.sessions, 'get').mockImplementation((name, type) => name === tenantKey(later.tenant, 'identity:shopper:' + target) ? Promise.resolve(null) : get(name, type));
          vi.spyOn(f.sessions, 'list').mockImplementation(options => options?.prefix === tenantKey(later.tenant, 'session:')
            ? Promise.resolve({ keys: [], list_complete: true }) : list(options));
          const fresh = item(f, later.subject), before = structuredClone([...fresh.data]), kv = [...f.sessions.data], cache = [...f.cache.data];
          const calls = f.sessions.calls.length;
          const stopped = await eraseSubject(f.env, 'meridian', { shopperId: target }, 'w3506-synthetic');
          expect(stopped).toMatchObject({ httpStatus: 503, localComplete: false, localCompleted: [], discovery: { phase: 'extra_cleanup' } });
          expect([...fresh.data]).toEqual(before); expect(fresh.data.has('identityErasure:' + cutoff.erasureId)).toBe(false);
          const captured = [...records.values()].map(value => JSON.parse(value)).find(value => value.plan?.targets.some((t: { id: string }) => t.id === later.subject));
          expect(captured.plan.next).toBe(0); expect(captured.plan.sessions).toContainEqual(expect.objectContaining({ sid: later.sessionId }));
          // Reset cannot turn a registered source into an unguarded historical fallback.
          await internal(f, later.subject, '/reset', {});
          expect([...fresh.data.keys()].some(name => name.startsWith('identityRetired:'))).toBe(true);
          seedSuccessor(f, later.subject);
          const successor = structuredClone([...fresh.data]); restart(f, later.subject);
          expect((await eraseSubject(f.env, 'meridian', { shopperId: target }, 'w3506-synthetic')).httpStatus).toBe(503);
          expect([...fresh.data]).toEqual(successor); expect(fresh.data.has('identityErasure:' + cutoff.erasureId)).toBe(false);
          expect([...f.sessions.data]).toEqual(kv); expect([...f.cache.data]).toEqual(cache);
          expect(f.sessions.calls.slice(calls).filter(call => call.startsWith('delete:'))).toEqual([]);
          vi.restoreAllMocks(); await f.drain(); continue;
        }
        let hit = false;
        const targetFault = vi.spyOn(destination.shopper, 'fetch').mockImplementation(async request => {
          const response = await fetch(request), path = new URL(request.url).pathname;
          if (!hit && ((phase === 'barrier' && path.endsWith('/erase/begin')) || (phase === 'ack' && path.endsWith('/erase/ack')))) {
            hit = true; throw new Error('synthetic target acknowledgement');
          }
          return response;
        });
        const source = item(f, sources[0].subject), sourceFetch = source.shopper.fetch.bind(source.shopper);
        const sourceFault = vi.spyOn(source.shopper, 'fetch').mockImplementation(async request => {
          const retry = request.clone(), isSource = new URL(request.url).pathname.endsWith('/erase/source');
          const body = phase === 'repeat-source' && isSource ? await request.clone().json() as { erasureId: string; registration: { sequence: number } } : null;
          const response = await sourceFetch(request);
          if (body?.registration.sequence === 1) {
            expect(source.data.has('affinity')).toBe(true); expect(source.data.has('identityTransfer')).toBe(true);
            // Resume the first artifact's single receipt without losing the second generation.
            const exact = [...source.data].find(([name]) => name.startsWith('identitySourceErasure:'))!;
            source.data.set('identityErasure:' + body.erasureId, exact[1]); source.data.delete(exact[0]);
            const retained = structuredClone([...source.data]);
            expect((await sourceFetch(retry)).status).toBe(200); expect([...source.data]).toEqual(retained);
          }
          if (!hit && isSource && (phase === 'source' || body?.registration.sequence === 2)) { hit = true; throw new Error('synthetic source acknowledgement'); }
          return response;
        });
        const put = storage.put.bind(storage);
        const checkpointFault = vi.spyOn(storage, 'put').mockImplementation(async (path, body, options) => {
          const value = JSON.parse(body), page = value.sources?.page;
          const matches = path === key && value.version === 7 && page && (phase === 'page' ? page.processed === 0 : phase === 'root' && page.processed > 0);
          if (!hit && matches) { hit = true; await put(path, body, options); throw new Error('synthetic source-page checkpoint acknowledgement'); }
          return put(path, body, options);
        });
        let result!: Awaited<ReturnType<typeof eraseSubject>>, calls = 0, failed = false;
        do {
          result = await eraseSubject(f.env, 'meridian', { shopperId: target }, 'w3506-synthetic'); calls++;
          expect(result.attempted).toBeLessThanOrEqual(32);
          const root = JSON.parse(records.get(key)!);
          if (root.sources?.page) expect(root.sources.page.entries.length).toBeLessThanOrEqual(32);
          if (result.httpStatus === 503) {
            expect(hit, JSON.stringify({ phase, calls, result, sources: root.sources })).toBe(true); expect(result.localComplete).toBe(false); failed = true;
            targetFault.mockRestore(); sourceFault.mockRestore(); checkpointFault.mockRestore();
            restart(f, target); for (const g of sources) restart(f, g.subject);
            if (phase === 'root') {
              const savedRoot = records.get(key)!, invalid = JSON.parse(savedRoot), state = structuredClone([...destination.data]);
              invalid.sources.completed = 0; records.set(key, JSON.stringify(invalid));
              expect((await eraseSubject(f.env, 'meridian', { shopperId: target }, 'w3506-synthetic')).httpStatus).toBe(503);
              expect([...destination.data]).toEqual(state); records.set(key, savedRoot);
            }
          } else expect([200, 202]).toContain(result.httpStatus);
          expect(calls).toBeLessThan(35);
        } while (result.httpStatus !== 200);
        expect(failed).toBe(phase !== 'wide'); expect(result.complete).toBe(false);
        expect(result.discovery).toMatchObject({ registeredSourceHighWater: sources.length, registeredSourcesCompleted: sources.length, registeredSourceComplete: true });
        expect(JSON.parse(records.get(key)!)).toMatchObject({ version: 7, state: 'local_complete' });
        for (const g of sources) {
          const source = item(f, g.subject);
          for (const name of ['affinity', 'pipeline', 'identityIntent', 'identityTransfer', 'forwardTo']) expect(source.data.has(name), name).toBe(false);
          expect((await f.call('/realtime/action', g.capability, event(g))).status).toBe(401);
          expect(JSON.stringify([...destination.data])).not.toContain(g.subject);
        }
        expect(destination.data.has('affinity')).toBe(false); expect(destination.data.has('pipeline')).toBe(false);
        if (phase === 'repeat-source') {
          expect(registrations).toHaveLength(2);
          expect([...destination.data].filter(([name]) => name.startsWith('identityRegistration:')).map(([, value]) => value))
            .toEqual([expect.objectContaining({ sequence: 1, erasureId: expect.any(String) }), expect.objectContaining({ sequence: 2, erasureId: expect.any(String) })]);
          const erasureId = [...source.data.keys()].find(name => name.startsWith('identityErasure:'))!.slice('identityErasure:'.length);
          await internal(f, sources[0].subject, '/reset', {});
          seedSuccessor(f, sources[0].subject);
          const fresh = structuredClone([...source.data]); restart(f, sources[0].subject);
          for (const registration of registrations) expect((await internal(f, sources[0].subject, '/identity/erase/source', { erasureId, registration })).status).toBe(200);
          expect((await internal(f, sources[0].subject, '/identity/erase/object', { erasureId })).status).toBe(200);
          expect([...source.data]).toEqual(fresh);
        }
        if (phase === 'wide') {
          const operations = targetFault.mock.calls.map(([request]) => new URL(request.url).pathname);
          expect(operations.filter(path => path.endsWith('/erase/begin'))).toHaveLength(1);
          expect(operations.filter(path => path.endsWith('/erase/page'))).toHaveLength(2);
          expect(operations.filter(path => path.endsWith('/erase/ack'))).toHaveLength(52);
          expect(operations.filter(path => path.endsWith('/erase/object'))).toHaveLength(1);
        }
        expect([...f.objects.get(shopperObjectName(foreign.tenant, foreign.subject))!.data]).toEqual(foreignState);
        expect(result.notReached.some(limit => limit.includes('historical unregistered'))).toBe(true);
        vi.restoreAllMocks(); await f.drain();
      }
    } finally { vi.restoreAllMocks(); }
  });

  it('W35.05 pins prepared transfers to serialized target authority across erasure admission failures and restart', async () => {
    const authority = (f: Fixture, target: string) => item(f, target).data.get('grantAuthority') as { version: number; epoch: string; grants: Record<string, unknown> };
    const prepared = (f: Fixture, g: Grant) => item(f, g.subject).data.get('identityTransfer') as { status: string; transfer: Record<string, unknown> };
    try {
      for (const barrier of ['reset', 'erase', 'retention']) for (const committed of [false, true]) {
        invalidateCache(); const f = boundary('do'), clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
        if (barrier === 'retention') {
          const categories = fixtureCategories(['coach', 'meridian']); categories.meridian!.profile = { ...fixtureRetentionPolicy, durationMs: 60000 };
          f.env.RETENTION = JSON.stringify({ version: 1, tenants: categories });
        }
        const seed = await warm(f), existing = await link(f, seed), g = await warm(f);
        const target = existing.shopperId, destination = item(f, target), epoch = authority(f, target).epoch;
        const targetPut = destination.state.storage.put.bind(destination.state.storage), indexPut = f.sessions.put.bind(f.sessions);
        const failure = committed ? vi.spyOn(f.sessions, 'put').mockImplementation(async (key, value) => {
          if (key.includes('identity:shopper:')) throw new Error('synthetic unpublished committed transfer');
          return indexPut(key, value);
        }) : vi.spyOn(destination.state.storage, 'put').mockImplementation(async (...args: Parameters<typeof destination.state.storage.put>) => {
          if (typeof args[0] === 'object' && 'identityMembers' in args[0]) throw new Error('synthetic uncommitted transfer');
          return targetPut(...args);
        });
        await expect(link(f, g)).rejects.toThrow(); failure.mockRestore();
        expect(prepared(f, g)).toMatchObject({ status: 'prepared', transfer: { targetEpoch: epoch } });
        expect(pipe(f, target).attributes.page_views).toBe(committed ? 4 : 2);
        const sourceBefore = structuredClone([...item(f, g.subject).data]);
        const originalAuthority = structuredClone(authority(f, target)), originalChoice = storedConsent(destination.data.get('consent'));
        if (barrier === 'reset') {
          const person = await signSessionCapability(f.env, existing.grant!);
          expect((await f.call('/realtime/session/reset', person.capability, {})).status).toBe(200);
        } else if (barrier === 'erase') expect((await internal(f, target, '/reset', {})).status).toBe(200);
        else {
          const captured = prepared(f, g).transfer.affinity as AffinityRecord;
          clock.mockReturnValue(Math.max(captured.retention!.expiresAt, (destination.data.get('affinity') as AffinityRecord).retention!.expiresAt));
          restart(f, target); await destination.shopper.alarm();
        }
        restart(f, target); restart(f, g.subject);
        if (barrier === 'retention') {
          expect(authority(f, target)).toEqual(originalAuthority); expect(storedConsent(destination.data.get('consent'))).toEqual(originalChoice);
          expect(destination.data.has('identityMembers')).toBe(true);
        } else {
          expect(authority(f, target)).toMatchObject({ grants: {} }); expect(authority(f, target).epoch).not.toBe(epoch);
          expect(destination.data.has('identityMembers')).toBe(false);
          expect([...destination.data.keys()].filter(key => key.startsWith('identityReceipt:'))).toEqual([]);
        }
        expect(destination.data.has('affinity')).toBe(false); expect(destination.data.has('pipeline')).toBe(false);
        const deniedState = structuredClone([...destination.data]), deniedIndex = [...f.sessions.data];
        const fetched = vi.spyOn(destination.shopper, 'fetch');
        await expect(link(f, g)).rejects.toThrow();
        expect(fetched.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual(barrier === 'retention' ? [] : ['/identity/transfer']); fetched.mockRestore();
        expect([...destination.data]).toEqual(deniedState); expect([...f.sessions.data]).toEqual(deniedIndex);
        expect([...item(f, g.subject).data]).toEqual(sourceBefore);
        const fresh = await warm(f);
        if (barrier === 'retention') {
          const [receiptKey, receipt] = [...destination.data].find(([key, value]) => key.startsWith('identityReceipt:')
            && (value as { result: { grant: { grantId: string } } }).result.grant.grantId === existing.grant!.grantId)!;
          for (const failure of ['missing', 'mismatched']) {
            if (failure === 'missing') destination.data.delete(receiptKey);
            else destination.data.set(receiptKey, { ...receipt as object, transfer: { ...(receipt as { transfer: object }).transfer, fingerprint: '0'.repeat(64) } });
            restart(f, target); const state = structuredClone([...destination.data]), kv = [...f.sessions.data];
            await expect(link(f, fresh)).rejects.toThrow(); expect([...destination.data]).toEqual(state); expect([...f.sessions.data]).toEqual(kv);
            destination.data.set(receiptKey, receipt); restart(f, target);
          }
        }
        const linked = await link(f, fresh);
        expect(linked.grant?.authorityEpoch).toBe(authority(f, target).epoch);
        expect(prepared(f, fresh).transfer.targetEpoch).toBe(authority(f, target).epoch);
        expect(pipe(f, target).attributes.page_views).toBe(2);
        if (barrier === 'retention') {
          expect(linked.sessionId).toBe(existing.sessionId); expect(linked.grant!.sessionId).toBe(existing.grant!.sessionId);
          const retained = await signSessionCapability(f.env, existing.grant!);
          expect((await f.call('/realtime/action', retained.capability, event(retained))).status).toBe(200);
          expect(pipe(f, target).sessionId).toBe(existing.sessionId);
        }
        const freshState = structuredClone([...destination.data]), freshIndex = [...f.sessions.data];
        restart(f, g.subject); await expect(link(f, g)).rejects.toThrow();
        expect([...destination.data]).toEqual(freshState); expect([...f.sessions.data]).toEqual(freshIndex);
        expect([...item(f, g.subject).data]).toEqual(sourceBefore); await f.drain(); clock.mockRestore();
      }

      // The admission read can finish before erasure while its response is delayed.
      {
        invalidateCache(); const f = boundary('do'), g = await warm(f), target = await shopperIdFor(f.env, g.tenant, 'w3503-person');
        await internal(f, target, '/identity/export'); const destination = item(f, target), entered = gate(), release = gate();
        const fetch = destination.shopper.fetch.bind(destination.shopper);
        const held = vi.spyOn(destination.shopper, 'fetch').mockImplementation(async request => {
          const response = await fetch(request);
          if (new URL(request.url).pathname === '/identity/admission') { entered.release(); await release.wait; }
          return response;
        });
        const linking = link(f, g), rejected = expect(linking).rejects.toThrow(); await entered.wait;
        const oldEpoch = authority(f, target).epoch;
        expect((await internal(f, target, '/reset', {})).status).toBe(200);
        const after = structuredClone([...destination.data]), index = [...f.sessions.data];
        release.release(); await rejected; held.mockRestore();
        expect(prepared(f, g)).toMatchObject({ status: 'prepared', transfer: { targetEpoch: oldEpoch } });
        expect([...destination.data]).toEqual(after); expect([...f.sessions.data]).toEqual(index);
        // Missing, malformed or substituted persisted epoch cannot trigger reacquisition.
        const original = structuredClone(prepared(f, g));
        for (const epoch of [undefined, 'invalid-epoch', authority(f, target).epoch]) {
          const altered = structuredClone(original);
          if (epoch === undefined) delete altered.transfer.targetEpoch; else altered.transfer.targetEpoch = epoch;
          item(f, g.subject).data.set('identityTransfer', altered); restart(f, g.subject);
          const requests = vi.spyOn(destination.shopper, 'fetch');
          await expect(link(f, g)).rejects.toThrow(); expect(requests).not.toHaveBeenCalled(); requests.mockRestore();
          expect(prepared(f, g)).toEqual(altered); expect([...destination.data]).toEqual(after); expect([...f.sessions.data]).toEqual(index);
        }
        await f.drain();
      }

      // Initialization is serialized and recovers accepted or rejected storage writes.
      for (const phase of ['concurrent', 'rejected', 'ambiguous', 'pre-authority']) {
        invalidateCache(); const f = boundary('do'), g = await warm(f), target = await shopperIdFor(f.env, g.tenant, 'w3503-person');
        const intent = { version: 1, id: crypto.randomUUID(), tenant: g.tenant, visitorId: g.subject, sourceSessionId: g.sessionId,
          sourceEpoch: g.authorityEpoch, shopperId: target, at: Date.now(), assurance: 'signed', source: 'login', salted: false };
        if (phase === 'pre-authority') {
          await link(f, g); const destination = item(f, target);
          for (const key of [...destination.data.keys()]) if (!['affinity', 'pipeline', 'audienceOwner', 'consent'].includes(key)) destination.data.delete(key);
          destination.data.set('consent', { tracking: false, personalization: true }); restart(f, target);
          const before = structuredClone([...destination.data]), alarms = [...destination.alarms], index = [...f.sessions.data];
          expect((await internal(f, target, '/identity/admission', { intent })).status).toBe(200);
          const epoch = authority(f, target).epoch;
          expect(await (await internal(f, target, '/identity/admission', { intent })).json()).toMatchObject({ ok: true, epoch });
          expect(authority(f, target)).toEqual({ version: 1, epoch, grants: {} });
          expect([...destination.data].filter(([key]) => ['affinity', 'pipeline', 'audienceOwner', 'consent'].includes(key))).toEqual(before);
          expect(destination.alarms).toEqual(alarms); expect([...f.sessions.data]).toEqual(index); await f.drain(); continue;
        }
        await internal(f, target, '/identity/export'); const destination = item(f, target), put = destination.state.storage.put.bind(destination.state.storage);
        if (phase === 'concurrent') {
          const entered = gate(), release = gate();
          const held = vi.spyOn(destination.state.storage, 'put').mockImplementationOnce(async (...args: Parameters<typeof destination.state.storage.put>) => {
            entered.release(); await release.wait; return put(...args);
          });
          const first = internal(f, target, '/identity/admission', { intent }); await entered.wait;
          const second = internal(f, target, '/identity/admission', { intent }); release.release();
          const one = await (await first).json(), two = await (await second).json();
          expect(one).toEqual(two); expect(held).toHaveBeenCalledTimes(1); held.mockRestore();
          expect(destination.data.get('identitySequence')).toBe(1); expect(authority(f, target).grants).toEqual({});
          expect(destination.data.has('affinity')).toBe(false); expect(destination.data.has('pipeline')).toBe(false);
          expect(item(f, g.subject).data.has('identityTransfer')).toBe(false);
          expect((await item(f, g.subject).shopper.fetch(new Request('https://shopper-reflex/identity/admission', {
            method: 'POST', headers: { [SHOPPER_HEADER]: g.capability, 'X-Tenant': g.tenant },
          }))).status).toBe(401);
        } else {
          const failure = vi.spyOn(destination.state.storage, 'put').mockImplementationOnce(async (...args: Parameters<typeof destination.state.storage.put>) => {
            if (phase === 'ambiguous') await put(...args);
            throw new Error('synthetic admission write acknowledgement');
          });
          await expect(link(f, g)).rejects.toThrow(); failure.mockRestore();
          expect(item(f, g.subject).data.has('identityTransfer')).toBe(false);
          const epoch = authority(f, target)?.epoch; expect(destination.data.size).toBe(phase === 'ambiguous' ? 4 : 0);
          restart(f, target); const result = await link(f, g);
          if (epoch) expect(result.grant?.authorityEpoch).toBe(epoch);
          expect(prepared(f, g).transfer.targetEpoch).toBe(result.grant?.authorityEpoch);
        }
        await f.drain();
      }

      // A missing/corrupt authority beside prior state is never a cold admission.
      for (const marker of ['identityReceipt:old', 'grantRotation:old', 'identityTransfer', 'forwardTo', 'erasureBarrier', 'pipeline', 'grantAuthority', 'mismatched-grant']) {
        invalidateCache(); const f = boundary('do'), g = await warm(f), target = await shopperIdFor(f.env, g.tenant, 'w3503-person');
        await internal(f, target, '/identity/export'); const destination = item(f, target);
        if (marker === 'mismatched-grant') destination.data.set('grantAuthority', { version: 1, epoch: g.authorityEpoch, grants: { [g.grantId!]: {
          tenant: g.tenant, subject: g.subject, sessionId: g.sessionId, kind: g.kind, grantId: g.grantId, authorityEpoch: g.authorityEpoch, iat: g.iat, exp: g.exp,
        } } });
        else destination.data.set(marker, marker === 'forwardTo' ? shopperObjectName(g.tenant, target) : {});
        const before = structuredClone([...destination.data]), index = [...f.sessions.data]; restart(f, target);
        await expect(link(f, g)).rejects.toThrow(); expect(item(f, g.subject).data.has('identityTransfer')).toBe(false);
        expect([...destination.data]).toEqual(before); expect([...f.sessions.data]).toEqual(index); await f.drain();
      }
    } finally { vi.restoreAllMocks(); }
  });

  it('W35.04 rotates one device grant recoverably without reopening it or a subsequently revoked replacement', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      invalidateCache(); const f = boundary('do'), sourceA = await warm(f), sourceB = await warm(f);
      const a = await signSessionCapability(f.env, (await link(f, sourceA)).grant!);
      const b = await signSessionCapability(f.env, (await link(f, sourceB)).grant!);
      expect(a.subject).toBe(b.subject); expect(a.sessionId).toBe(b.sessionId); expect(a.iat).toBe(b.iat);
      expect(a.grantId).not.toBe(b.grantId); expect(a.capability).not.toBe(b.capability);
      const destination = item(f, a.subject), before = structuredClone({ affinity: destination.data.get('affinity'), pipeline: destination.data.get('pipeline') });
      const socket = (g: Awaited<ReturnType<typeof verifySessionCapability>>) => ({ deserializeAttachment: () => ({ shopperId: g.subject, principal: g }), send: vi.fn(), close: vi.fn() });
      // Attach the verified descriptor, as the upgrade door does, not its response wrapper.
      const wsA = socket(await verifySessionCapability(f.env, a.capability, a.tenant));
      const wsB = socket(await verifySessionCapability(f.env, b.capability, b.tenant));
      destination.sockets.push(wsA as unknown as WebSocket, wsB as unknown as WebSocket);
      expect((await f.call(`/realtime/session/${a.sessionId}/preferences`, a.capability, { trackingConsent: false })).status).toBe(200);
      const put = destination.state.storage.put.bind(destination.state.storage);
      const lost = vi.spyOn(destination.state.storage, 'put').mockImplementation(async (...args: Parameters<typeof destination.state.storage.put>) => {
        const value = args[0];
        if (typeof value === 'object' && 'grantAuthority' in value && ('grantRotation:' + a.grantId) in value) {
          await put(...args); throw new Error('synthetic lost detach acknowledgement');
        }
        return put(...args);
      });
      const failed = await f.call('/v1/meridian/identity/detach', a.capability, {});
      expect(failed.status).toBeGreaterThanOrEqual(400); expect(failed.headers.has('set-cookie')).toBe(false); lost.mockRestore();
      restart(f, a.subject);
      const response = await f.call('/v1/meridian/identity/detach', a.capability, {}); expect(response.status).toBe(200);
      const fresh = (await response.json() as { session: Grant & { consent: { tracking: boolean; personalization: boolean } } }).session;
      expect(fresh.consent).toMatchObject({ tracking: false, personalization: true });
      expect((fresh.consent as Consent).instruction?.tracking).toEqual((destination.data.get('consent') as Consent).instruction?.tracking);
      expect((fresh.consent as Consent).instruction?.personalization).toEqual((destination.data.get('consent') as Consent).instruction?.personalization);
      expect({ affinity: destination.data.get('affinity'), pipeline: destination.data.get('pipeline') }).toEqual(before);
      expect(wsA.close).toHaveBeenCalled(); expect(wsB.close).not.toHaveBeenCalled();
      expect((await f.call('/realtime/action', a.capability, event(a))).status).toBe(401);
      expect((await f.call(`/realtime/session/${b.sessionId}/analytics`, b.capability)).status).toBe(200);
      expect((await destination.shopper.fetch(new Request(`https://shopper-reflex/?userId=${a.subject}`, { headers: { Upgrade: 'websocket', 'X-Tenant': a.tenant, [SHOPPER_HEADER]: a.capability } }))).status).toBe(401);
      await destination.shopper.webSocketMessage(wsA as unknown as WebSocket, JSON.stringify({ type: 'heartbeat' })); expect(wsA.send).not.toHaveBeenCalled();
      await expect(link(f, sourceA)).rejects.toThrow();
      expect((await f.call(`/realtime/session/${b.sessionId}/preferences`, b.capability, { personalizationEnabled: false })).status).toBe(200);
      const retry = await f.call('/v1/meridian/identity/detach', a.capability, {}); expect(retry.status).toBe(200);
      const recovered = (await retry.json() as { session: Grant & { consent: { tracking: boolean; personalization: boolean } } }).session;
      expect(recovered.capability).toBe(fresh.capability); expect(recovered.consent).toMatchObject({ tracking: false, personalization: false });
      expect(storedConsent(item(f, fresh.subject).data.get('consent'))).toEqual(recovered.consent);
      expect((await f.call('/realtime/session/reset', fresh.capability, {})).status).toBe(200);
      restart(f, a.subject); restart(f, fresh.subject);
      const erased = structuredClone([...item(f, fresh.subject).data]);
      expect((await f.call('/v1/meridian/identity/detach', a.capability, {})).status).toBe(401);
      expect([...item(f, fresh.subject).data]).toEqual(erased); await f.drain();
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
  });

  it('W35.04 binds link grants and atomically retains reset erasure and retention barriers through restart and failed commits', async () => {
    try {
      for (const phase of ['reset-interrupted', 'reset-ambiguous', 'erase', 'retention']) {
        invalidateCache(); const f = boundary('do'), clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
        if (phase === 'retention') {
          const categories = fixtureCategories(['coach', 'meridian']); categories.meridian!.profile = { ...fixtureRetentionPolicy, durationMs: 60000 };
          f.env.RETENTION = JSON.stringify({ version: 1, tenants: categories });
        }
        const source = await warm(f), linked = await link(f, source);
        const person = await signSessionCapability(f.env, linked.grant!);
        const retry = await signSessionCapability(f.env, (await link(f, source)).grant!);
        expect(retry.capability).toBe(person.capability);
        const target = item(f, person.subject), before = structuredClone([...target.data]);
        if (phase.startsWith('reset')) {
          const transaction = target.state.storage.transaction.bind(target.state.storage);
          const injected = vi.spyOn(target.state.storage, 'transaction').mockImplementationOnce(async run => {
            if (phase === 'reset-ambiguous') { await transaction(run); throw new Error('synthetic committed reset acknowledgement lost'); }
            return transaction(async tx => { await run(tx); expect(target.data.get('affinity')).toEqual(before.find(([k]) => k === 'affinity')![1]); throw new Error('synthetic interrupted cleanup'); });
          });
          const failure = await f.call('/realtime/session/reset', person.capability, {});
          expect(failure.status).toBeGreaterThanOrEqual(400); expect(failure.headers.has('set-cookie')).toBe(false); injected.mockRestore();
          if (phase === 'reset-interrupted') expect(target.data.has('affinity')).toBe(true);
          else { expect(target.data.has('affinity')).toBe(false); expect(target.data.get('grantAuthority')).toMatchObject({ grants: {} }); }
          restart(f, person.subject);
          const completed = await f.call('/realtime/session/reset', person.capability, {}); expect(completed.status).toBe(200);
          const fresh = (await completed.json() as { session: Grant }).session;
          const again = await f.call('/realtime/session/reset', person.capability, {});
          expect((await again.json() as { session: Grant }).session.capability).toBe(fresh.capability);
          expect((await f.call('/realtime/action', fresh.capability, event(fresh))).status).toBe(200);
        } else if (phase === 'erase') {
          const transaction = target.state.storage.transaction.bind(target.state.storage);
          const lost = vi.spyOn(target.state.storage, 'transaction').mockImplementationOnce(async run => { await transaction(run); throw new Error('synthetic erased acknowledgement lost'); });
          await expect(internal(f, person.subject, '/reset', {})).rejects.toThrow(); lost.mockRestore();
        } else {
          const captured = (item(f, source.subject).data.get('identityTransfer') as { transfer: { affinity: AffinityRecord } }).transfer.affinity;
          clock.mockReturnValue(Math.max(captured.retention!.expiresAt, (target.data.get('affinity') as AffinityRecord).retention!.expiresAt));
          restart(f, person.subject); await target.shopper.alarm();
          restart(f, source.subject); await item(f, source.subject).shopper.alarm();
        }
        restart(f, person.subject); restart(f, source.subject);
        expect(target.data.has('affinity')).toBe(false); expect(target.data.has('pipeline')).toBe(false);
        if (phase === 'retention') {
          expect(target.data.get('grantAuthority')).toEqual(before.find(([key]) => key === 'grantAuthority')![1]);
          expect(storedConsent(target.data.get('consent'))).toEqual(storedConsent(before.find(([key]) => key === 'consent')![1]));
          const kept = structuredClone([...target.data]), index = [...f.sessions.data], recovered = await link(f, source);
          expect(recovered.grant).toEqual(linked.grant); expect(recovered.audiences).toEqual([]);
          expect([...target.data]).toEqual(kept); expect([...f.sessions.data]).toEqual(index);
          expect((await f.call('/realtime/action', person.capability, event(person))).status).toBe(200);
          expect((target.data.get('affinity') as AffinityRecord).retention!.bornAt).toBe(Date.now());
        } else {
          expect(target.data.get('grantAuthority')).toMatchObject({ grants: {} });
          expect((await f.call('/realtime/action', person.capability, event(person))).status).toBe(401);
          await expect(link(f, source)).rejects.toThrow();
        }
        expect((await internal(f, source.subject, '/reset', {})).status).toBe(200); restart(f, source.subject);
        expect((await f.call('/realtime/action', source.capability, event(source))).status).toBe(401);
        await expect(link(f, source)).rejects.toThrow();
        const boot = await f.call('/v1/meridian/identity/session', undefined, {}); expect(boot.status).toBe(200);
        const fresh = (await boot.json() as { session: Grant }).session;
        expect((await f.call('/realtime/action', fresh.capability, event(fresh))).status).toBe(200);
        // Neither missing nor malformed authority on a retained transition is cold.
        const saved = structuredClone([...target.data]); target.data.delete('grantAuthority'); restart(f, person.subject);
        expect((await f.call('/realtime/action', person.capability, event(person))).status).toBe(401);
        if (phase.startsWith('reset')) expect((await f.call('/realtime/session/reset', person.capability, {})).status).toBe(401);
        target.data.clear(); for (const [key, value] of saved) target.data.set(key, value);
        target.data.set('grantAuthority', { version: 1, epoch: person.authorityEpoch, grants: null }); restart(f, person.subject);
        expect((await f.call('/realtime/action', person.capability, event(person))).status).toBe(401);
        if (phase.startsWith('reset')) expect((await f.call('/realtime/session/reset', person.capability, {})).status).toBeGreaterThanOrEqual(400);
        await f.drain(); clock.mockRestore();
      }
      for (const host of ['session', 'do']) {
        const f = boundary(host), issued = await newAnonymousSession(f.env, 'meridian');
        const legacy = await signSessionCapability(f.env, { tenant: issued.tenant, subject: issued.subject, sessionId: issued.sessionId,
          kind: issued.kind, iat: issued.iat, exp: issued.exp });
        expect((await f.call('/realtime/action', legacy.capability, event(legacy))).status).toBe(401);
        await f.drain();
      }
    } finally { vi.restoreAllMocks(); }
  });

  it('W35.04 serializes HTTP buffered socket heartbeat and synchronous or deferred pushes against revocation', async () => {
    try {
      invalidateCache(); const f = boundary('do'), sourceA = await warm(f), sourceB = await warm(f);
      const a = await signSessionCapability(f.env, (await link(f, sourceA)).grant!);
      const b = await signSessionCapability(f.env, (await link(f, sourceB)).grant!);
      const target = item(f, a.subject), aPrincipal = await verifySessionCapability(f.env, a.capability, a.tenant), bPrincipal = await verifySessionCapability(f.env, b.capability, b.tenant);
      const wsA = { deserializeAttachment: () => ({ shopperId: a.subject, principal: aPrincipal }), send: vi.fn(), close: vi.fn() };
      const wsB = { deserializeAttachment: () => ({ shopperId: b.subject, principal: bPrincipal }), send: vi.fn(), close: vi.fn() };
      target.sockets.push(wsA as unknown as WebSocket, wsB as unknown as WebSocket);
      let receipt: Parameters<typeof odpLoop.forwardEventToOdp>[5];
      vi.spyOn(odpLoop, 'odpEnabled').mockReturnValue(true);
      vi.spyOn(odpLoop, 'mapActionToOdp').mockReturnValue({ type: 'pageview', data: {} });
      vi.spyOn(odpLoop, 'refreshOdpSeedIfDue').mockResolvedValue({ seed: [], seedAt: Date.now() });
      vi.spyOn(odpLoop, 'upsertOdpProfile').mockResolvedValue(undefined);
      vi.spyOn(odpLoop, 'forwardEventToOdp').mockImplementation(async (...args) => { receipt = args[5]; });
      const entered = gate(), release = gate(), put = target.state.storage.put.bind(target.state.storage);
      const held = vi.spyOn(target.state.storage, 'put').mockImplementationOnce(async (...args: Parameters<typeof target.state.storage.put>) => { entered.release(); await release.wait; return put(...args); });
      const action = f.call('/realtime/action', a.capability, event(a)); await entered.wait;
      const detach = f.call('/v1/meridian/identity/detach', a.capability, {});
      release.release(); expect((await action).status).toBe(200); held.mockRestore();
      expect((await detach).status).toBe(200); expect(receipt).toBeTypeOf('function');
      const before = structuredClone({ affinity: target.data.get('affinity'), pipeline: target.data.get('pipeline') });
      wsA.send.mockClear(); wsB.send.mockClear();
      receipt!({ receiptId: 'synthetic', status: 202, ts: Date.now(), source: 'odp' }); await f.drain();
      expect(wsA.send).not.toHaveBeenCalled(); expect(wsB.send).toHaveBeenCalled();
      expect(JSON.parse(wsB.send.mock.calls.at(-1)![0])).toMatchObject({ type: 'odp_receipt' });
      wsA.send.mockClear(); wsB.send.mockClear();
      await target.shopper.webSocketMessage(wsA as unknown as WebSocket, JSON.stringify({ type: 'heartbeat' }));
      await target.shopper.webSocketMessage(wsA as unknown as WebSocket, JSON.stringify({ type: 'action', event: event(a) }));
      expect(wsA.send).not.toHaveBeenCalled(); expect(wsA.close).toHaveBeenCalled();
      expect((await f.call('/realtime/action', a.capability, { ...event(a), processing: 'buffered', eventId: crypto.randomUUID(), timestamp: Date.now() - 1000, browsingSessionId: 'w3504-browser' })).status).toBe(401);
      for (const path of [`/realtime/personalization/${a.subject}`, `/realtime/segments/${a.subject}`, `/realtime/reflex?userId=${a.subject}`, `/realtime/connections/${a.subject}`]) {
        expect((await f.call(path, a.capability)).status).toBe(401);
      }
      expect({ affinity: target.data.get('affinity'), pipeline: target.data.get('pipeline') }).toEqual(before);
      expect((await f.call(`/realtime/segments/${b.subject}`, b.capability, { segment: 'still-owned' })).status).toBe(200);
      expect(wsA.send).not.toHaveBeenCalled(); expect(wsB.send).toHaveBeenCalled();
      await target.shopper.webSocketMessage(wsB as unknown as WebSocket, JSON.stringify({ type: 'heartbeat' }));
      expect(JSON.parse(wsB.send.mock.calls.at(-1)![0])).toMatchObject({ type: 'heartbeat_response' }); await f.drain();
    } finally { vi.restoreAllMocks(); }
  });

  it('recovers prepare, absorb, publication and completion failures after restart without another merge', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      for (const phase of ['prepare', 'prepare-ambiguous', 'absorb', 'absorb-ambiguous', 'shopper-index', 'visitor-index', 'complete', 'complete-ambiguous', 'lost-response']) {
        invalidateCache(); const f = boundary('do'), g = await warm(f), target = await shopperIdFor(f.env, g.tenant, 'w3503-person');
        await internal(f, target, '/identity/export');
        const source = item(f, g.subject), destination = item(f, target), original = structuredClone(pipe(f, g.subject));
        const beforeAffinity = structuredClone(source.data.get('affinity') as AffinityRecord);
        const sourcePut = source.state.storage.put.bind(source.state.storage), targetPut = destination.state.storage.put.bind(destination.state.storage);
        let hit = false;
        const sourceFault = vi.spyOn(source.state.storage, 'put').mockImplementation(async (...args: Parameters<typeof source.state.storage.put>) => {
          const key = args[0] as string | Record<string, unknown>, matches = phase.startsWith('prepare') ? key === 'identityTransfer'
            : phase.startsWith('complete') && typeof key === 'object' && 'forwardTo' in key;
          if (matches && !hit) { hit = true; if (phase.endsWith('ambiguous')) await sourcePut(...args); throw new Error('synthetic transition failure'); }
          return sourcePut(...args);
        });
        const targetFault = vi.spyOn(destination.state.storage, 'put').mockImplementation(async (...args: Parameters<typeof destination.state.storage.put>) => {
          if (phase.startsWith('absorb') && !hit && typeof args[0] === 'object' && 'identityMembers' in args[0]) {
            hit = true; if (phase.endsWith('ambiguous')) await targetPut(...args); throw new Error('synthetic receipt failure');
          }
          return targetPut(...args);
        });
        const indexPut = f.sessions.put.bind(f.sessions);
        const indexFault = vi.spyOn(f.sessions, 'put').mockImplementation(async (key, value) => {
          if (!hit && ((phase === 'shopper-index' && key.includes('identity:shopper:')) || (phase === 'visitor-index' && key.includes('identity:visitor:')))) {
            hit = true; throw new Error('synthetic projection failure');
          }
          return indexPut(key, value);
        });
        let lost: Awaited<ReturnType<typeof link>> | undefined;
        if (phase === 'lost-response') lost = await link(f, g);
        else { await expect(link(f, g), phase).rejects.toThrow(); expect(hit, phase).toBe(true); }
        sourceFault.mockRestore(); targetFault.mockRestore(); indexFault.mockRestore();
        if (source.data.has('identityTransfer')) {
          const saved = structuredClone([...source.data]);
          expect((await f.call('/realtime/action', g.capability, event(g))).status).toBe(401);
          expect([...source.data]).toEqual(saved);
        }
        restart(f, g.subject); restart(f, target);
        const recovered = await link(f, g), accepted = structuredClone([...destination.data]);
        expect(recovered).toMatchObject({ shopperId: target, visitorId: g.subject, outcome: 'linked', sessionId: pipe(f, target).sessionId });
        expect(recovered.sessionId).not.toBe(g.sessionId);
        if (lost) expect(recovered).toEqual(lost);
        expect(pipe(f, target)).toMatchObject({ attributes: original.attributes, visitCount: original.visitCount,
          lastVisitAt: original.lastVisitAt, entryChannel: original.entryChannel, profileEnrichment: original.profileEnrichment });
        expect((destination.data.get('affinity') as AffinityRecord).reflex).toEqual(beforeAffinity.reflex);
        expect([...destination.data.keys()].filter(key => key.startsWith('identityReceipt:'))).toHaveLength(1);
        expect(source.data.get('identityTransfer')).toMatchObject({ status: 'complete' });
        expect(source.data.get('forwardTo')).toBe(shopperObjectName(g.tenant, target));
        clock.mockReturnValue(Date.now() + 1);
        expect(await link(f, g)).toEqual(recovered); expect([...destination.data]).toEqual(accepted);
        const stored = JSON.parse(f.sessions.data.get(tenantKey(g.tenant, 'identity:shopper:' + target))!);
        expect(stored.visitors.map((value: { visitorId: string }) => value.visitorId)).toEqual([g.subject]);
        const visitor = JSON.parse(f.sessions.data.get(tenantKey(g.tenant, 'identity:visitor:' + g.subject))!);
        expect(visitor.linkedAt).toBe(stored.visitors[0].linkedAt); await f.drain();
      }
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
  });

  it('serializes source events and competing links and republishes current membership under delayed KV reads', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      invalidateCache(); const f = boundary('do'), a = await warm(f), b = await warm(f);
      const target = await shopperIdFor(f.env, 'meridian', 'w3503-person'); await internal(f, target, '/identity/export');
      const source = item(f, a.subject), destination = item(f, target), entered = gate(), release = gate();
      const originalPut = source.state.storage.put.bind(source.state.storage);
      const held = vi.spyOn(source.state.storage, 'put').mockImplementationOnce(async (...args: Parameters<typeof source.state.storage.put>) => {
        entered.release(); await release.wait; return originalPut(...args);
      });
      const live = f.call('/realtime/action', a.capability, event(a)); await entered.wait;
      const first = link(f, a), duplicate = link(f, a), second = link(f, b);
      release.release(); expect((await live).status).toBe(200); held.mockRestore();
      const [one, two, three] = await Promise.all([first, duplicate, second]);
      expect(one).toEqual(two); expect(one.sessionId).toBe(three.sessionId);
      expect(pipe(f, target).attributes.page_views).toBe(5);
      expect(pipe(f, target).visitCount).toBe(2);
      expect([...destination.data.keys()].filter(key => key.startsWith('identityReceipt:'))).toHaveLength(2);
      const expectedMembers = [a.subject, b.subject].sort(), accepted = structuredClone([...destination.data]);
      const firstMember = (destination.data.get('identityMembers') as { visitors: Array<{ visitorId: string }> }).visitors[0].visitorId;
      const older = firstMember === a.subject ? a : b, olderResult = firstMember === a.subject ? one : three;
      const originalGet = f.sessions.get.bind(f.sessions);
      const stale = vi.spyOn(f.sessions, 'get').mockImplementation((key, type) => key.includes('identity:') ? Promise.resolve(null) : originalGet(key, type));
      f.sessions.data.set(tenantKey('meridian', 'identity:shopper:' + target), JSON.stringify({ shopperId: target, visitors: [] }));
      restart(f, older.subject); restart(f, target); expect(await link(f, older)).toEqual(olderResult);
      expect(JSON.parse(f.sessions.data.get(tenantKey('meridian', 'identity:shopper:' + target))!).visitors.map((v: { visitorId: string }) => v.visitorId).sort()).toEqual(expectedMembers);
      expect([...destination.data]).toEqual(accepted); stale.mockRestore();
      const sourceSaved = structuredClone([...source.data]);
      expect((await f.call('/realtime/action', a.capability, event(a))).status).toBe(401);
      expect((await f.call(`/realtime/segments/${a.subject}`, a.capability, { segment: 'stale' })).status).toBe(401);
      const ws = { deserializeAttachment: () => ({ shopperId: a.subject, principal: a }), send: vi.fn(), close: vi.fn() };
      await source.shopper.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'action', event: event(a) })); expect(ws.close).toHaveBeenCalled();
      expect((await f.call('/realtime/action', a.capability, { ...event(a), processing: 'buffered', eventId: crypto.randomUUID(), timestamp: Date.now() - 1, browsingSessionId: 'w3503-browse' })).status).toBe(401);
      for (const path of ['/identity/import', '/identity/absorb', '/identity/forward']) await expect(internal(f, a.subject, path,
        path.endsWith('forward') ? { to: target } : { shopperId: a.subject, rows: [] })).rejects.toThrow();
      await source.shopper.alarm(); expect([...source.data]).toEqual(sourceSaved); expect([...destination.data]).toEqual(accepted);
      await expect(link(f, a, 'w3503-other')).rejects.toThrow(); expect([...destination.data]).toEqual(accepted);

      // The fence also persists when the destination has not accepted anything yet.
      const c = await warm(f), put = vi.spyOn(destination.state.storage, 'put').mockRejectedValueOnce(new Error('synthetic pending transfer'));
      await expect(link(f, c)).rejects.toThrow(); put.mockRestore(); restart(f, c.subject);
      const pending = structuredClone([...item(f, c.subject).data]);
      expect((await f.call('/realtime/action', c.capability, event(c))).status).toBe(401);
      await expect(link(f, c, 'w3503-other')).rejects.toThrow(); expect([...item(f, c.subject).data]).toEqual(pending);
      await link(f, c); expect(pipe(f, target).attributes.page_views).toBe(7); await f.drain();
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
  });

  it('binds transfer authority and intersects current consent without replaying an accepted merge', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      for (const refusal of ['source', 'target', 'retry']) {
        invalidateCache(); const f = boundary('do'), g = await warm(f), target = await shopperIdFor(f.env, g.tenant, 'w3503-person');
        await internal(f, target, '/identity/export'); const destination = item(f, target);
        if (refusal === 'source') expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, { trackingConsent: false })).status).toBe(200);
        if (refusal === 'target') destination.data.set('consent', { tracking: true, personalization: false });
        const accepted = await link(f, g), profile = structuredClone({ affinity: destination.data.get('affinity'), pipeline: destination.data.get('pipeline') });
        if (refusal !== 'retry') {
          expect(accepted.consent).toEqual(refusal === 'source' ? { tracking: false, personalization: true } : { tracking: true, personalization: false });
          expect(pipe(f, target).attributes.page_views).toBeUndefined(); expect(pipe(f, target).profileEnrichment).toBeUndefined();
        } else {
          expect(pipe(f, target).attributes.page_views).toBe(2);
          expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, { personalizationEnabled: false })).status).toBe(200);
          restart(f, g.subject); restart(f, target);
          const again = await link(f, g);
          expect(again).toEqual({ ...accepted, consent: { tracking: true, personalization: false } });
          expect({ affinity: destination.data.get('affinity'), pipeline: destination.data.get('pipeline') }).toEqual(profile);
        }
        const source = item(f, g.subject), saved = structuredClone([...destination.data]);
        const wrongSid = await issueSessionCapability(f.env, { tenant: g.tenant, subject: g.subject, sessionId: 'wrong-session', kind: 'anonymous' });
        await expect(link(f, wrongSid)).rejects.toThrow();
        const prepared = source.data.get('identityTransfer') as { transfer: Record<string, unknown> };
        const altered = structuredClone(prepared.transfer); altered.profileDigest = 'f'.repeat(64);
        await expect(internal(f, target, '/identity/transfer', { transfer: altered, consent: { tracking: true, personalization: true } })).rejects.toThrow();
        expect((await internal(f, target, '/identity/transfer', { transfer: prepared.transfer, consent: { tracking: true, personalization: true } }, 'coach')).status).toBe(401);
        expect([...destination.data]).toEqual(saved);
        const exp = Math.floor(Date.now() / 1000) + 120;
        const assertion = await signAssertion('backend-proof', g.tenant, g.subject, 'w3503-person', exp);
        const response = await f.call('/v1/meridian/identity/link', g.capability, { visitorId: g.subject, accountId: 'w3503-person', exp, assertion });
        expect(response.status).toBe(200);
        const linked = await response.json() as { session: Grant };
        expect(await verifySessionCapability(f.env, linked.session.capability, g.tenant)).toMatchObject({ subject: target, sessionId: accepted.sessionId, kind: 'recognized' });
        expect((await internal(f, target, '/reset', {})).status).toBe(200);
        restart(f, g.subject); restart(f, target);
        await expect(link(f, g)).rejects.toThrow(); expect(destination.data.has('affinity')).toBe(false); expect(destination.data.has('pipeline')).toBe(false);
        expect([...destination.data.keys()].filter(key => key.startsWith('identityRegistration:'))).toHaveLength(1);
        expect(destination.data.get('grantAuthority')).toMatchObject({ grants: {} });
        await f.drain();
      }
      // Refusing a first transfer must not tick an existing target or refresh its activity/timer.
      for (const refusal of ['source', 'target']) {
        invalidateCache(); const f = boundary('do'), existing = await warm(f), prior = await link(f, existing);
        const g = await warm(f), destination = item(f, prior.shopperId), membership = audienceKey('line', 'Tabby');
        const affinity = structuredClone(destination.data.get('affinity') as AffinityRecord);
        affinity.lastSeen = 0; affinity.configVersion = 'prior-config';
        affinity.reflex.dims.line = { Tabby: { s: 1, t: 0 } };
        affinity.reflex.audiences = [membership]; affinity.reflex.configVersion = 'prior-config';
        const pipeline = structuredClone(pipe(f, prior.shopperId)); pipeline.segments.push(membership);
        const owner = { tenant: 'meridian', subject: prior.shopperId, sessionId: prior.sessionId };
        destination.data.set('affinity', affinity); destination.data.set('pipeline', pipeline); destination.data.set('audienceOwner', owner);
        expect(tickReflex(affinity.reflex, Date.now(), DEFAULT_REFLEX_CONFIG).changes.exited).toContain(membership);
        if (refusal === 'source') expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, { trackingConsent: false })).status).toBe(200);
        else destination.data.set('consent', { tracking: true, personalization: false });
        restart(f, prior.shopperId); const alarms = [...destination.alarms];
        const linked = await link(f, g);
        expect(linked.consent).toEqual(refusal === 'source' ? { tracking: false, personalization: true } : { tracking: true, personalization: false });
        expect({ affinity: destination.data.get('affinity'), pipeline: destination.data.get('pipeline'), owner: destination.data.get('audienceOwner'), alarms: destination.alarms })
          .toEqual({ affinity, pipeline, owner, alarms });
        expect(linked).toMatchObject({ sessionId: prior.sessionId, changes: { entered: [], exited: [], explain: [] }, audiences: [membership] });
        expect([...destination.data.keys()].filter(key => key.startsWith('identityReceipt:'))).toHaveLength(2);
        expect((destination.data.get('identityMembers') as { visitors: Array<{ visitorId: string }> }).visitors.map(member => member.visitorId)).toEqual([existing.subject, g.subject]);
        await f.drain();
      }
      // Strict bootstrap refuses malformed legacy membership before target state/receipt writes.
      const f = boundary('do'), g = await warm(f), target = await shopperIdFor(f.env, 'meridian', 'w3503-person');
      f.sessions.data.set(tenantKey('meridian', 'identity:shopper:' + target), 'null');
      const index = [...f.sessions.data];
      await expect(link(f, g)).rejects.toThrow();
      const admittedEpoch = (item(f, g.subject).data.get('identityTransfer') as { transfer: { targetEpoch: string } }).transfer.targetEpoch;
      expect(admittedEpoch).toMatch(/^[0-9a-f-]{36}$/);
      const targetState = item(f, target).data, intent = item(f, g.subject).data.get('identityIntent') as { id: string };
      expect([...targetState.keys()].sort()).toEqual(['grantAuthority', 'identityAdmission:' + intent.id, 'identityRegistration:0000000000000001', 'identitySequence'].sort());
      expect(targetState.get('grantAuthority')).toEqual({ version: 1, epoch: admittedEpoch, grants: {} });
      expect(targetState.get('identitySequence')).toBe(1);
      expect(targetState.get('identityRegistration:0000000000000001')).toEqual({ version: 1, intent, targetEpoch: admittedEpoch, sequence: 1 });
      expect([...f.sessions.data]).toEqual(index);
      f.sessions.data.set(tenantKey('meridian', 'identity:shopper:' + target), JSON.stringify({ shopperId: target, createdAt: 1, salted: false,
        visitors: [{ visitorId: 'legacy-member', linkedAt: 1, assurance: 'signed', source: 'login' }] }));
      await link(f, g);
      expect((item(f, target).data.get('identityMembers') as { visitors: Array<{ visitorId: string }> }).visitors.map(member => member.visitorId)).toEqual(['legacy-member', g.subject]);
      await f.drain();
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
  });
});

describe('W35.02 visit context', () => {
  const paid = { utmMedium: 'paid_social', utmSource: 'tiktok', referrer: 'www.tiktok.com', siteHost: 'shop.invalid' };
  const direct = { utmMedium: '', utmSource: '', referrer: '', siteHost: 'shop.invalid' };
  const event = (g: Awaited<ReturnType<typeof newAnonymousSession>>, entry?: unknown) => ({ userId: g.subject, sessionId: g.sessionId,
    type: 'page_view', source: 'sdk', data: {}, ...(entry === undefined ? {} : { entry }) });
  async function fixture(host: string) {
    invalidateCache(); invalidateLiftCache();
    const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian');
    const docs = new Map<string, { text: string; etag: string }>(); let revision = 0;
    f.env.STORAGE = { get: async (key: string) => { const v = docs.get(key); return v ? { key, etag: v.etag,
      size: v.text.length, body: new Response(v.text).body, text: async () => v.text, json: async () => JSON.parse(v.text) as unknown } : null; },
    put: async (key: string, text: string, options?: R2PutOptions) => { const condition = options?.onlyIf;
      if (condition instanceof Headers ? docs.has(key) : condition && condition.etagMatches !== docs.get(key)?.etag) return null;
      const etag = String(++revision); docs.set(key, { text, etag }); return { key, etag, size: text.length }; } } as unknown as R2Bucket;
    await fixturePublication(f.env, 'meridian', [
      { kind: CONTENT_KIND, scope: 'meridian', revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { pieces: [
        { id: 'a', customerContentId: 'cms-a', type: 'editorial', title: 'A', tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' } }] } } },
      { kind: SLOTS_KIND, scope: 'meridian', revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: {} }] } } } }]);
    // The demo default scope is published too: the engine resolves it through the
    // same authority, with no KV fallback (src/reflex/configStore.ts:408-415).
    await fixturePublication(f.env, 'coach');
    // Consent is fail-closed: an explicit stored choice precedes every tracked
    // effect (src/content/consent.ts:139-152).
    await positiveChoice(f, g);
    const queued: Array<{ records?: Array<{ cell: unknown }> }> = [];
    f.env.EVENT_QUEUE = { send: async (v: { records?: Array<{ cell: unknown }> }) => { queued.push(v); } } as unknown as Queue;
    const state = () => host === 'session' ? f.sessions.data.get(tenantKey('meridian', `session:${g.sessionId}`))
      : JSON.stringify([...f.objects.get(shopperObjectName('meridian', g.subject))?.data ?? []]);
    const snapshot = (entry?: unknown, extra = '') => f.call(`/v1/meridian/decisions/snapshot?page=home&visitorId=${g.subject}&sessionId=${g.sessionId}`
      + (entry === undefined ? '' : `&entry=${encodeURIComponent(JSON.stringify(entry))}`) + extra, g.capability);
    return { ...f, g, queued, state, snapshot };
  }

  describe('unit:W06.BASE.01 a cold /realtime/personalization/:subject read on a consent-only owned record serves without write activity instead of answering 500 for a missing retention birth', () => {
  it('carries first-paint and live return context into actual both-host cells without read activity', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    // `meridian` is not the legacy demo tenant (src/connectors/config.ts:106), so
    // getConnectors builds a LiveDecisionProvider (src/connectors/index.ts:29-36).
    // Spy the provider the request path actually calls.
    const decide = vi.spyOn(LiveDecisionProvider.prototype, 'decideAll');
    try {
      for (const host of ['session', 'do']) {
        const f = await fixture(host), before = f.state();
        // A public snapshot is an offer: "Only a subsequent authenticated render may
        // capture them" (src/content/service.ts:35). The route always passes an offer
        // (src/routes/decisions.ts:465), so it returns no private replay inputs
        // (src/routes/decisions.ts:478) and captures nothing. Those three are what it
        // can be held to here; the visit context the engine derived is read below
        // through the real personalization path and its decision provider.
        const offer = async (entry?: unknown, extra = '') => { const queued = f.queued.length, r = await f.snapshot(entry, extra);
          expect(r.status).toBe(200);
          expect((await r.json() as { records?: unknown }).records).toBeUndefined();
          await f.drain(); expect(f.queued).toHaveLength(queued); return r; };
        await offer(paid); expect(f.state()).toBe(before);
        const cold = await f.call(`/realtime/personalization/${f.g.subject}`, f.g.capability);
        expect(cold.status).toBe(200); expect(cold.headers.get('set-cookie')).toBeNull(); expect(f.state()).toBe(before);
        expect((await f.call('/realtime/action', f.g.capability, event(f.g, paid))).status).toBe(200); await f.drain();
        const sessionKey = tenantKey('meridian', `session:${f.g.sessionId}`);
        const item = f.objects.get(shopperObjectName('meridian', f.g.subject));
        if (host === 'session') {
          const legacy = JSON.parse(f.sessions.data.get(sessionKey)!) as SessionData;
          delete legacy.metadata.visitCount; delete legacy.metadata.lastVisitAt; delete legacy.metadata.entryChannel;
          f.sessions.data.set(sessionKey, JSON.stringify(legacy));
        } else {
          const legacy = item!.data.get('pipeline') as PipelineRecord;
          delete legacy.visitCount; delete legacy.lastVisitAt; delete legacy.entryChannel;
          item!.shopper = new ShopperReflex(item!.state, f.env);
        }
        const legacyState = f.state(); await offer(); expect(f.state()).toBe(legacyState);
        expect((await f.call('/realtime/action', f.g.capability, event(f.g, paid))).status).toBe(200); await f.drain();
        const live = f.state(); await offer(direct); await offer(direct, '&channel=email'); expect(f.state()).toBe(live);
        const legacyRead = await f.call(`/realtime/personalization/${f.g.subject}`, f.g.capability);
        expect(legacyRead.headers.get('set-cookie')).toBeNull(); expect(f.state()).toBe(live);
        // HANDOFF-2026-09-18 §5 C2: an established owned visit entry channel takes
        // precedence over a request-supplied fallback channel (src/content/service.ts:241),
        // so neither a `direct` entry nor `&channel=email` above may relabel it.
        expect(decide.mock.calls.at(-1)?.[3]).toMatchObject({ visit_number: 1, visit_bucket: '1', entry_channel: 'paid_social' });
        clock.mockReturnValue(Date.now() + VISIT_GAP_MS);
        await offer(); await offer({ utmMedium: 'email' }); expect(f.state()).toBe(live);
        await f.call(`/realtime/personalization/${f.g.subject}`, f.g.capability);
        expect(decide.mock.calls.at(-1)?.[3]).toMatchObject({ visit_number: 2, visit_bucket: '2-3', entry_channel: 'unknown' });
        const activity = () => { const s = host === 'session' ? (JSON.parse(f.sessions.data.get(sessionKey)!) as SessionData).metadata : item!.data.get('pipeline') as PipelineRecord;
          return { visitCount: s.visitCount, lastVisitAt: s.lastVisitAt, entryChannel: s.entryChannel, sessionCount: s.sessionCount,
            lastSeen: host === 'session' ? (s as SessionData['metadata']).lastSeen : (item!.data.get('affinity') as AffinityRecord).lastSeen }; };
        const beforeManual = activity(); expect((await f.call(`/realtime/segments/${f.g.subject}`, f.g.capability, { segment: 'manual-after-gap' })).status).toBe(200);
        expect(activity()).toEqual(beforeManual);
        expect((await f.call('/realtime/action', f.g.capability, event(f.g))).status).toBe(200); await f.drain();
        await offer();
        expect((await f.call('/realtime/action', f.g.capability, event(f.g, direct))).status).toBe(200); await f.drain();
        await offer();
        await f.call(`/realtime/personalization/${f.g.subject}`, f.g.capability);
        expect(decide.mock.calls.at(-1)?.[3]).toMatchObject({ visit_number: 2, visit_bucket: '2-3', entry_channel: 'direct' });
        const record = host === 'session' ? JSON.parse(f.state()!) as SessionData : f.objects.get(shopperObjectName('meridian', f.g.subject))!.data.get('pipeline') as PipelineRecord;
        expect('metadata' in record ? record.metadata.visitCount : record.visitCount).toBe(2);
        const saved = f.state();
        for (const entry of [null, [], { utmMedium: 7 }, { utmSource: 'x'.repeat(257) }, { unknown: 'x' }]) {
          expect((await f.call('/realtime/action', f.g.capability, { ...event(f.g, entry), data: { consent: { tracking: false } } })).status).toBe(400);
          expect((await f.snapshot(entry)).status).toBe(400); expect(f.state()).toBe(saved);
        }
        expect((await f.snapshot({ referrer: 'https://private.invalid/path?secret=1' })).status).toBe(400);
        const stateBeforeRefusals = f.state();
        await offer(paid, '&personalizationEnabled=false'); await offer(paid, '&trackingConsent=false');
        // A withdrawal hint is a consent write, not behavioural activity: this same file pins
        // the positive for W37.04 at :3908-3911 (a trackingConsent=false snapshot must leave the
        // owner's stored consent matching { tracking: false }), and settled decision D06-W05
        // makes an explicit choice the only thing that changes a consent record
        // (docs/remediation/decisions/D06-W05-explicit-choice-approved-2026-09-16.json;
        // src/content/consent.ts:139-152). So exactly the consent instruction may move: every
        // other record — affinity, pipeline, grantAuthority, audienceOwner and the session
        // projection's non-consent fields — stays byte-identical, and the instruction itself
        // now reads both switches off. `offer` already proves neither read queued anything.
        const withoutConsent = (state: string | undefined) => host === 'session'
          ? JSON.stringify(Object.fromEntries(Object.entries((JSON.parse(state ?? 'null') ?? {}) as Record<string, unknown>)
            .filter(([key]) => key !== 'preferences' && key !== 'consent')))
          : JSON.stringify((JSON.parse(state ?? '[]') as Array<[string, unknown]>).filter(([key]) => key !== 'consent'));
        expect(withoutConsent(f.state())).toBe(withoutConsent(stateBeforeRefusals));
        // This shopper chose positively and then withdrew, so the withdrawn instruction is
        // still stored and the projection carries it (src/content/consent.ts:69-73): both
        // switches read off and the stored instruction is this subject's withdrawal, never absent.
        const projection = storedConsent(f.objects.get(shopperObjectName('meridian', f.g.subject))!.data.get('consent'));
        expect(projection).toMatchObject({ tracking: false, personalization: false });
        expect(projection.instruction).toMatchObject({ tenant: 'meridian', subject: f.g.subject,
          tracking: { value: false }, personalization: { value: false } });
      }
    } finally { vi.restoreAllMocks(); }
  });
  });

  it('preserves object visit identity through sockets restart non-live changes merge and rejected commits', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      const f = await fixture('do'); expect((await f.call('/realtime/action', f.g.capability, event(f.g, paid))).status).toBe(200); await f.drain();
      const item = f.objects.get(shopperObjectName('meridian', f.g.subject))!;
      const context = () => { const p = item.data.get('pipeline') as PipelineRecord; return { visitCount: p.visitCount, lastVisitAt: p.lastVisitAt, entryChannel: p.entryChannel, visitorId: p.visitorId }; };
      const first = context(); expect(first).toMatchObject({ visitCount: 1, entryChannel: 'paid_social', visitorId: f.g.subject });
      const principal = await verifySessionCapability(f.env, f.g.capability, 'meridian');
      const socket = { deserializeAttachment: () => ({ shopperId: f.g.subject, principal }), send: vi.fn(), close: vi.fn() };
      const invalidBefore = JSON.stringify([...item.data]);
      await item.shopper.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ type: 'action', event: event(f.g, { utmSource: 'x'.repeat(257) }) }));
      expect(JSON.stringify([...item.data])).toBe(invalidBefore);
      await item.shopper.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ type: 'action', event: event(f.g, direct) })); expect(context()).toEqual(first);
      item.shopper = new ShopperReflex(item.state, f.env); expect((await f.snapshot()).status).toBe(200); expect(context()).toEqual(first);
      expect((await f.call(`/realtime/segments/${f.g.subject}`, f.g.capability, { segment: 'manual' })).status).toBe(200); expect(context()).toEqual(first);
      const internal = (path: string, body: unknown) => item.shopper.fetch(new Request('https://shopper-reflex' + path, { method: 'POST',
        headers: { 'X-Reflex-Tenant': 'meridian', 'X-Reflex-Subject': f.g.subject }, body: JSON.stringify(body) }));
      const signed = (path: string, body: unknown) => item.shopper.fetch(new Request('https://shopper-reflex' + path, { method: 'POST',
        headers: { [SHOPPER_HEADER]: f.g.capability, 'X-Tenant': 'meridian' }, body: JSON.stringify(body) }));
      await item.shopper.fetch(new Request('https://shopper-reflex/consent', { method: 'POST', headers: { [SHOPPER_HEADER]: f.g.capability, 'X-Tenant': 'meridian' }, body: JSON.stringify({ tracking: true, personalization: true }) }));
      const importBody = { operationId: crypto.randomUUID(), shopperId: f.g.subject, rows: [{ kind: 'profile', version: 1, source: 'crm', at: Date.now(), fields: {}, audiences: {} }], now: Date.now() };
      expect((await internal('/identity/import/admission', importBody)).status).toBe(200);
      expect((await internal('/identity/import', importBody)).status).toBe(200);
      expect(context()).toEqual(first); await item.shopper.alarm(); expect(context()).toEqual(first);
      clock.mockReturnValue(Date.now() + VISIT_GAP_MS);
      const put = vi.spyOn(item.state.storage, 'put').mockRejectedValueOnce(new Error('synthetic rejected context'));
      expect((await f.call('/realtime/action', f.g.capability, event(f.g, { utmMedium: 'email' }))).status).toBe(500);
      expect((await f.snapshot()).status).toBe(200); expect(context()).toEqual(first); put.mockRestore();
      await item.shopper.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ type: 'action', event: event(f.g, { utmMedium: 'email' }) }));
      expect(context()).toMatchObject({ visitCount: 2, entryChannel: 'email', visitorId: f.g.subject });
      const from = { ...(item.data.get('pipeline') as PipelineRecord), visitCount: 3, lastVisitAt: Date.now() + 1, entryChannel: 'referral' };
      expect((await signed('/identity/absorb', { shopperId: f.g.subject, pipeline: from, affinity: item.data.get('affinity') })).status).toBe(200);
      expect(context()).toEqual({ visitCount: 5, lastVisitAt: from.lastVisitAt, entryChannel: 'referral', visitorId: f.g.subject });
      const saved = JSON.stringify([...item.data]);
      expect((await signed('/identity/absorb', { shopperId: f.g.subject, pipeline: { ...from, visitCount: -1 } })).status).toBe(400); expect(JSON.stringify([...item.data])).toBe(saved);
    } finally { vi.restoreAllMocks(); }
  });
});

async function bufferedBoundary(host: string, tenant = 'meridian', profileDurationMs?: number) {
  invalidateCache();
  const f = boundary(host), now = Date.now(), tau = 60_000;
  Object.assign(f.env, { ODP_API_HOST: 'https://odp.synthetic.invalid', ODP_PUBLIC_KEY: 'synthetic-only' });
  await f.configureRetention();
  if (profileDurationMs !== undefined) {
    const policy = JSON.parse(f.env.RETENTION!); policy.tenants[tenant].profile.durationMs = profileDurationMs; f.env.RETENTION = JSON.stringify(policy);
  }
  const retention = retentionBirth(f.env, tenant, 'profile', now, now), externalRetention = await externalRetentionBirths(f.env, tenant, now, now);
  const config: ReflexConfig = { ...DEFAULT_REFLEX_CONFIG, version: 'w2207', tauMs: tau, K: 1, thetaIn: 0.6, thetaOut: 0.45,
    dimensions: [{ key: 'line', source: 'line' }], eventAttributes: 'event-when-unknown', weights: { ...DEFAULT_REFLEX_CONFIG.weights, purchase: 5 } };
  // Publication is the only configuration authority; the retained KV copy below is
  // compatibility history, never a fallback (src/config/publication.ts:19;
  // src/reflex/configStore.ts:408-415).
  await fixturePublication(f.env, tenant, [{ kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant),
    revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: config } }]);
  const g = await newAnonymousSession(f.env, tenant); await positiveChoice(f, g);
  f.cache.data.set(`reflex:config:${reflexScopeForTenant(tenant)}:current`, JSON.stringify({ revision: 1, at: 1, actor: 'fixture', note: '', value: config }));
  const enrichment = readEnrichment({ version: 1, sources: { crm: { at: now - tau, fields: {}, audiences: { vip: 'Synthetic authorized audience' } } } })!;
  const reflex = { v: 1 as const, configVersion: 'w2207', dims: { line: { Tabby: { s: 2, t: now - 10_000 }, Old: { s: 5, t: now - 10 * tau } } }, audiences: [audienceKey('line', 'Old')] };
  const attributes = { purchases: 3, page_views: 4, last_activity: 'unchanged-old-activity', viewed_product_line: 'Old' };
  const segments = ['stale_derived', 'local_old', 'external.crm.vip', 'ODP_ALLOWED'];
  const session: SessionData = { userId: g.subject, attributes, segments, reflex, profileEnrichment: enrichment, retention, externalRetention,
    odpSeed: ['ODP_ALLOWED'], odpSeedAt: now - tau, odpRecentEvents: [{ type: 'old-odp', at: now - tau }],
    metadata: { firstSeen: now - 10 * tau, lastSeen: now - 10_000, sessionCount: 8, visitCount: 2, lastVisitAt: now - tau,
      entryChannel: 'email', engagementScore: 7, lastSegmentUpdate: now - tau, journeyStage: 'mid' },
    preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true } };
  const key = tenantKey(tenant, `session:${g.sessionId}`);
  f.sessions.data.set(key, JSON.stringify({ ...session, preservedExtra: { value: 'untouched' } }));
  f.sessions.data.set(tenantKey(tenant, `user:${g.subject}`), g.sessionId);
  await f.env.SHOPPER_REFLEX.get(f.env.SHOPPER_REFLEX.idFromName(shopperObjectName(tenant, g.subject))).fetch('https://shopper-reflex/unused');
  const item = f.objects.get(shopperObjectName(tenant, g.subject))!;
  item.data.set('affinity', { shopperId: g.subject, reflex, odpSeed: session.odpSeed, odpSeedAt: session.odpSeedAt,
    odpRecentEvents: session.odpRecentEvents, lastSeen: session.metadata.lastSeen, configVersion: reflex.configVersion, retention, externalRetention });
  item.data.set('pipeline', { attributes, segments, profileEnrichment: enrichment, sessionId: g.sessionId, visitorId: g.subject,
    firstSeen: session.metadata.firstSeen, sessionCount: session.metadata.sessionCount, journeyStage: 'mid',
    visitCount: session.metadata.visitCount, lastVisitAt: session.metadata.lastVisitAt, entryChannel: session.metadata.entryChannel });
  item.data.set('audienceOwner', { tenant, subject: g.subject, sessionId: g.sessionId });
  // The fixture seeds retained behavior after opening the object. Rehydrate and
  // adopt its genuine signed grant before measuring subsequent buffered effects.
  item.shopper = new ShopperReflex(item.state, f.env);
  if (host === 'do') expect((await f.call('/realtime/session/' + g.sessionId + '/analytics', g.capability, undefined, tenant)).status).toBe(200);
  item.alarms.push(now + 120_000);
  const expiration = Math.ceil(now / 1000) + 3600, metadata = { purpose: 'existing', nested: [1, null] };
  if (host === 'session') {
    const principal = await verifySessionCapability(f.env, g.capability, tenant);
    item.data.set('grantAuthority', { version: 1, epoch: principal.authorityEpoch, grants: { [principal.grantId!]: principal } });
    item.data.set('sessionProjection:' + key, { value: f.sessions.data.get(key), expires: expiration * 1000, pending: false, metadata });
    item.data.set('sessionProjection:' + tenantKey(tenant, `user:${g.subject}`), { value: g.sessionId, expires: expiration * 1000, pending: false });
  }
  let listing: unknown = { keys: [{ name: key, expiration, metadata }], list_complete: true };
  const lists: unknown[] = [], puts: Array<{ key: string; options: unknown }> = [];
  const ownerList = item.state.storage.list.bind(item.state.storage);
  vi.spyOn(item.state.storage, 'list').mockImplementation(async options => {
    if (host !== 'session' || options?.prefix !== 'sessionProjection:' + key) return ownerList(options);
    lists.push({ prefix: key, limit: options.limit });
    const rows = (listing as { keys: Array<{ name: string; expiration?: unknown; metadata?: unknown }> }).keys;
    return new Map(rows.map(row => ['sessionProjection:' + row.name, { value: f.sessions.data.get(key), pending: false,
      expires: Object.hasOwn(row, 'expiration') ? typeof row.expiration === 'number' ? row.expiration * 1000 : row.expiration : null,
      ...(Object.hasOwn(row, 'metadata') ? { metadata: row.metadata } : {}) }])) as Awaited<ReturnType<typeof item.state.storage.list>>;
  });
  const put = f.sessions.put.bind(f.sessions);
  vi.spyOn(f.sessions, 'list').mockImplementation(async options => { lists.push(options); return listing as Awaited<ReturnType<typeof f.sessions.list>>; });
  vi.spyOn(f.sessions, 'put').mockImplementation(async (name, text, options?: unknown) => { puts.push({ key: name, options }); await put(name, text); });
  for (const [name, attribute, value] of [['local_tabby', 'line_affinity.tabby', 0.7], ['local_old', 'line_affinity.old', 0.6]] as const) {
    await new KvAudienceStore(f.env, tenant).publish({ key: name, name, description: 'Synthetic local qualification', createdAt: 1,
      status: 'published', source: 'manual', evaluation: 'realtime', conditions: { attribute, operator: 'gte', value } });
  }
  const queued: OutcomeRecord[] = [], learned: OutcomeRecord[] = [], regional: unknown[] = [];
  Object.assign(f.env, { AUTH_MODE: 'open', ENVIRONMENT: 'development', DEMO_EVENT_CAPTURE: 'true', ODP_API_HOST: 'https://odp.synthetic.invalid', ODP_PUBLIC_KEY: 'synthetic-only',
    EVENT_QUEUE: { send: async (body: { record: OutcomeRecord }) => { queued.push(body.record); } },
    DECISION_RING: { idFromName: (name: string) => name, get: () => ({ fetch: async (_url: string, init: RequestInit) => {
      learned.push(JSON.parse(String(init.body)).outcome); return Response.json({ ok: true }); } }) },
    REGION_TREND: { idFromName: (name: string) => name, get: () => ({ fetch: async (_url: string, init: RequestInit) => { regional.push(init.body); return Response.json({ ok: true }); } }) },
  });
  const event = { type: 'purchase', userId: g.subject, sessionId: g.sessionId, source: 'sdk', processing: 'buffered',
    eventId: 'buffered-original', timestamp: now - tau, browsingSessionId: 'original-browsing', data: { line: 'Tabby', orderId: 'historical-order', value: 7 } };
  const record = () => host === 'session' ? JSON.parse(f.sessions.data.get(key)!) as SessionData
    : { ...(item.data.get('pipeline') as PipelineRecord), ...(item.data.get('affinity') as AffinityRecord) };
  const bytes = () => host === 'session' ? f.sessions.data.get(key) : JSON.stringify([...item.data]);
  const send = (patch: Record<string, unknown> = {}, cookie?: string) => f.call('/realtime/action', g.capability, { ...event, ...patch }, tenant, cookie, { country: 'US', regionCode: 'NY' });
  f.effects.length = 0; f.sessions.calls.length = 0; f.cache.calls.length = 0;
  return { ...f, g, now, tau, config, key, item, event, expiration, metadata, lists, puts, queued, learned, regional, record, bytes, send,
    setListing: (value: unknown) => { listing = value; } };
}

it('W22.07 applies age-decayed interest on both hosts with fresh local membership and unchanged live activity', async () => {
  const remote = vi.fn(async () => { throw new Error('Unexpected external request'); }); vi.stubGlobal('fetch', remote);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  try {
    for (const host of ['session', 'do']) for (const tenant of ['meridian', 'coach']) {
      const f = await bufferedBoundary(host, tenant), before = structuredClone(f.record());
      const response = await f.send(); expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ processing: 'buffered', interestApplied: true, cookiesUpdated: false });
      expect(response.headers.get('set-cookie')).toBeNull(); await f.drain();
      const after = f.record();
      expect(after.reflex!.dims.line!.Tabby!.t).toBe(f.now - 10_000);
      expect(after.reflex!.dims.line!.Tabby!.s).toBeCloseTo(2 + 5 * Math.exp(-50_000 / f.tau), 12);
      expect(after.reflex!.audiences).toContain(audienceKey('line', 'Tabby'));
      expect(after.reflex!.audiences).not.toContain(audienceKey('line', 'Old'));
      expect(after.segments).toContain('local_tabby'); expect(after.segments).not.toContain('local_old'); expect(after.segments).not.toContain('stale_derived');
      expect(after.segments).toContain('external.crm.vip'); expect(after.segments.includes('ODP_ALLOWED')).toBe(tenant === 'coach');
      expect(after.attributes).toEqual(before.attributes);
      for (const field of ['metadata', 'firstSeen', 'lastSeen', 'sessionCount', 'visitCount', 'lastVisitAt', 'entryChannel', 'visitorId', 'journeyStage', 'odpSeed', 'odpSeedAt', 'odpRecentEvents', 'profileEnrichment'] as const) {
        expect((after as unknown as Record<string, unknown>)[field]).toEqual((before as unknown as Record<string, unknown>)[field]);
      }
      expect(f.queued).toHaveLength(1); expect(f.learned).toEqual(f.queued); expect(f.queued[0]).toMatchObject({ ts: f.event.timestamp, session_id: 'original-browsing', event_id: f.event.eventId });
      expect(f.regional).toEqual([]); expect(f.effects).not.toContain('capture'); expect(f.cache.calls.filter(call => call.startsWith('put:'))).toEqual([]);
    }
    expect(remote).not.toHaveBeenCalled();
  } finally { clock.mockRestore(); vi.unstubAllGlobals(); }
});

it('W22.07 validates explicit buffered context before effects and transports zero or very old original outcomes without websocket processing', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  try {
    for (const host of ['session', 'do']) {
      const f = await bufferedBoundary(host);
      for (const patch of [{ processing: 'other' }, { eventId: undefined }, { eventId: '' }, { timestamp: undefined }, { timestamp: null },
        { timestamp: '0' }, { timestamp: -1 }, { timestamp: 0.5 }, { timestamp: Infinity }, { timestamp: 8_640_000_000_000_001 },
        { timestamp: f.now + 1 }, { browsingSessionId: undefined }, { browsingSessionId: '' }, { browsingSessionId: ' original ' },
        { browsingSessionId: 'x'.repeat(129) }, { browsingSessionId: 7 }, { data: { decisionId: 'not-a-decision' } }]) {
        const before = host === 'session' ? f.bytes() : JSON.stringify([...f.item.data].filter(([key]) => key !== 'consent'));
        const originalChoice = structuredClone(storedConsent(f.item.data.get('consent')).instruction);
        f.effects.length = 0; f.sessions.calls.length = 0;
        expect((await f.send(patch, 'opt_tracking_consent=false')).status).toBe(400);
        expect(host === 'session' ? f.bytes() : JSON.stringify([...f.item.data].filter(([key]) => key !== 'consent'))).toBe(before);
        const nextChoice = storedConsent(f.item.data.get('consent')).instruction;
        expect(nextChoice).toEqual({ ...originalChoice, tracking: originalChoice?.tracking && { ...originalChoice.tracking, value: false } });
        // Owner admission may persist a restrictive cookie before the route
        // rejects syntax. No behavioral/profile/provider destination is touched.
        expect(f.effects.every(value => value === 'object:' + shopperObjectName(f.g.tenant, f.g.subject) || value === 'store:consent')).toBe(true);
        expect(f.sessions.calls).toEqual([]); expect(f.queued).toEqual([]); expect(f.learned).toEqual([]);
      }
      expect((await f.send({ userId: 'other-subject' })).status).toBe(401);
      expect(f.queued).toEqual([]); expect(f.learned).toEqual([]);
      expect((await explicitChoice(f, f.g, true, true)).response.status).toBe(200);
      for (const [timestamp, browsingSessionId] of [[0, null], [1, 'original-browsing']] as const) {
        const decisionId = `meridian:0:${f.g.subject}:home:hero:0`;
        expect((await f.send({ timestamp, browsingSessionId, eventId: `old-${timestamp}`, data: { ...f.event.data, decisionId } })).status).toBe(200);
        await f.drain(); expect(f.queued.at(-1)).toMatchObject({ ts: timestamp, session_id: browsingSessionId, event_id: `old-${timestamp}`, decision_id: decisionId });
        expect(f.learned).toEqual(f.queued);
      }
      const before = f.bytes(), effects = [...f.effects], close = vi.fn(), send = vi.fn();
      const ws = { close, send, deserializeAttachment: () => ({ shopperId: f.g.subject, principal: f.g }) } as unknown as WebSocket;
      await f.item.shopper.webSocketMessage(ws, JSON.stringify({ type: 'action', event: f.event }));
      expect(close).toHaveBeenCalledWith(1008, 'Buffered actions require HTTP'); expect(send).not.toHaveBeenCalled(); expect(f.bytes()).toBe(before); expect(f.effects).toEqual(effects);
      const direct = new Request('https://shopper-reflex/ingest', { method: 'POST', headers: { [SHOPPER_HEADER]: f.g.capability, 'X-Tenant': f.g.tenant, Cookie: 'opt_tracking_consent=false' }, body: JSON.stringify({ ...f.event, timestamp: f.now + 1 }) });
      expect((await f.item.shopper.fetch(direct)).status).toBe(400); expect(f.effects).toEqual(effects);
      const nested = new Request('https://shopper-reflex/ingest', { method: 'POST', headers: { [SHOPPER_HEADER]: f.g.capability, 'X-Tenant': f.g.tenant },
        body: JSON.stringify({ ...f.event, event: { ...f.event, data: { decisionId: 'bad-nested' } } }) });
      expect((await f.item.shopper.fetch(nested)).status).toBe(400); expect(f.effects).toEqual(effects); expect(f.bytes()).toBe(before);
    }
  } finally { clock.mockRestore(); }
});

it('W22.07 gates both hosts on owned profiles consent and observed erasure barriers before interest or destinations', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  try {
    for (const host of ['session', 'do']) {
      for (const [tracking, personalization] of [[false, true], [true, false], [false, false]]) {
        const f = await bufferedBoundary(host), before = f.record();
        const response = await f.send({ data: { ...f.event.data, consent: { tracking, personalization } } }); expect(response.status).toBe(200); await f.drain();
        expect(await response.json()).toMatchObject({ interestApplied: false, consent: { tracking, personalization } });
        expect(f.record().reflex).toEqual(before.reflex); expect(f.record().segments).toEqual(before.segments); expect(f.record().attributes).toEqual(before.attributes);
        expect(f.queued).toHaveLength(tracking ? 1 : 0); expect(f.learned).toEqual(f.queued); expect(f.regional).toEqual([]); expect(f.effects).not.toContain('capture');
        expect(f.puts).toEqual([]); expect(storedConsent(f.item.data.get('consent'))).toMatchObject({ tracking, personalization });
      }
      for (const failure of ['missing', 'corrupt', 'forwarded', 'erased', 'corrupt-barrier', 'unavailable-barrier', 'qualification']) {
        const f = await bufferedBoundary(host);
        if (failure === 'missing') { f.sessions.data.delete(f.key); f.item.data.delete('affinity'); f.item.data.delete('pipeline'); }
        if (failure === 'corrupt') { f.sessions.data.set(f.key, '{broken'); f.item.data.set('affinity', { broken: true }); }
        if (failure === 'forwarded') { f.sessions.data.set(f.key, JSON.stringify({ ...f.record(), forwardTo: 'another-session' })); f.item.data.set('forwardTo', 'another-object'); }
        if (failure.includes('barrier') || failure === 'erased') f.env.STORAGE = { get: async () => {
          if (failure === 'unavailable-barrier') throw new Error('PRIVATE_BARRIER');
          return { text: async () => failure === 'corrupt-barrier' ? '{}' : JSON.stringify({ tenant: f.g.tenant, visitor_id: f.g.subject, erased_at: f.event.timestamp,
            actor: 'fixture', rows_removed: 0, objects_rewritten: 0, objects_deleted: 0 }) };
        } } as unknown as R2Bucket;
        if (failure === 'qualification') {
          const get = f.cache.get.bind(f.cache);
          vi.spyOn(f.cache, 'get').mockImplementation(async (key, type) => {
            if (key.startsWith('t:meridian:audience:')) throw new Error('Synthetic qualification read failure');
            return get(key, type);
          });
        }
        const before = f.bytes(), response = await f.send(); await f.drain();
        const body = await response.json() as { dropped?: string; interestApplied?: boolean };
        expect(response.status >= 400 || !!body.dropped).toBe(true); expect(body.interestApplied).not.toBe(true);
        expect(f.bytes()).toBe(before); expect(f.queued).toEqual([]); expect(f.learned).toEqual([]); expect(f.regional).toEqual([]); expect(f.effects).not.toContain('capture');
      }
    }
    const unsigned = await bufferedBoundary('session');
    await expect(new RealtimeSegmentEngine(unsigned.env).processActionEventWithSession({ ...unsigned.event, processing: 'buffered', type: 'purchase' }, null)).rejects.toBeInstanceOf(SessionAccessError);
    expect(unsigned.sessions.calls).toEqual([]); expect(unsigned.puts).toEqual([]);
    const limited = await bufferedBoundary('do'); limited.env.REFLEX_RATE_LIMIT_PER_MIN = '1';
    expect((await limited.send()).status).toBe(200); await limited.drain();
    const before = limited.bytes(), read = vi.spyOn(limited.item.state.storage, 'get');
    expect((await limited.send({ eventId: 'limited' })).status).toBe(429);
    expect(read.mock.calls).toEqual([['identityTransfer'], ['identityIntent'], ['grantAuthority'], ['grantAuthority'], ['identityTransfer'], ['identityIntent']]);
    expect(limited.bytes()).toBe(before); expect(limited.queued).toHaveLength(1);
    const delayed = await bufferedBoundary('do'), saved = delayed.bytes(), delayedRead = vi.spyOn(delayed.item.state.storage, 'get');
    const serialized = delayed.item.shopper as unknown as { serialize: (fn: () => Promise<unknown>) => Promise<unknown> };
    const serialize = serialized.serialize.bind(serialized);
    vi.spyOn(serialized, 'serialize').mockImplementation(fn => serialize(async () => { clock.mockReturnValue(delayed.g.exp * 1000); return fn(); }));
    expect((await delayed.send()).status).toBe(401); expect(delayedRead).not.toHaveBeenCalled(); expect(delayed.bytes()).toBe(saved); expect(delayed.queued).toEqual([]);
    clock.mockReturnValue(delayed.now);
  } finally { clock.mockRestore(); }
});

it('W22.07 preserves exact session expiry metadata and DO commit mirrors with bounded audience and retention alarms', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  try {
    for (const mode of ['expiring', 'nonexpiring', 'missing', 'neighbor', 'bad-expiry', 'too-soon', 'bad-metadata']) {
      const f = await bufferedBoundary('session');
      const row = { name: f.key, expiration: f.expiration, metadata: f.metadata };
      if (mode === 'nonexpiring') {
        f.setListing({ keys: [{ name: f.key, metadata: null }] });
        const projection = 'sessionProjection:' + f.key;
        f.item.data.set(projection, { ...f.item.data.get(projection) as object, expires: null, metadata: null });
      }
      if (mode === 'missing') f.setListing({ keys: [] });
      if (mode === 'neighbor') f.setListing({ keys: [{ ...row, name: f.key + ':other' }] });
      if (mode === 'bad-expiry') f.setListing({ keys: [{ ...row, expiration: String(f.expiration) }] });
      if (mode === 'too-soon') f.setListing({ keys: [{ ...row, expiration: Math.floor(f.now / 1000) + 59 }] });
      if (mode === 'bad-metadata') f.setListing({ keys: [{ ...row, metadata: undefined }] });
      const before = f.bytes(), pointers = [...f.sessions.data].filter(([key]) => key !== f.key), response = await f.send(); await f.drain();
      expect(f.lists).toEqual([{ prefix: f.key, limit: 1 }]); expect(response.headers.get('set-cookie')).toBeNull();
      expect([...f.sessions.data].filter(([key]) => key !== f.key)).toEqual(pointers);
      if (mode === 'expiring' || mode === 'nonexpiring') {
        expect(response.status).toBe(200); expect(f.puts).toEqual([{ key: f.key, options: mode === 'expiring' ? { expiration: f.expiration, metadata: f.metadata }
          : { expiration: Math.floor((f.record() as SessionData).retention!.expiresAt / 1000), metadata: null } }]);
        expect(JSON.parse(f.sessions.data.get(f.key)!)).toHaveProperty('preservedExtra.value', 'untouched');
      } else { expect(response.status).toBeGreaterThanOrEqual(400); expect(f.bytes()).toBe(before); expect(f.puts).toEqual([]); expect(f.queued).toEqual([]); }
    }
    for (const owner of ['missing', 'null', 'valid'] as const) {
      const f = await bufferedBoundary('do', 'meridian', 86400000);
      if (owner === 'missing') f.item.data.delete('audienceOwner'); else if (owner === 'null') f.item.data.set('audienceOwner', null);
      const before = f.bytes(), oldAffinity = structuredClone(f.item.data.get('affinity'));
      f.faults.write = true; expect((await f.send()).status).toBe(503); expect(f.bytes()).toBe(before);
      expect((f.item.shopper as unknown as { affinity: AffinityRecord }).affinity).toEqual(oldAffinity); expect(f.queued).toEqual([]);
      f.faults.write = false; expect((await f.send()).status).toBe(200); await f.drain();
      expect(f.item.data.has('audienceOwner')).toBe(owner !== 'missing');
      if (owner === 'null') expect(f.item.data.get('audienceOwner')).toBeNull();
      if (owner === 'valid') expect(f.item.data.get('audienceOwner')).toEqual({ tenant: f.g.tenant, subject: f.g.subject, sessionId: f.g.sessionId });
      const affinity = f.item.data.get('affinity') as AffinityRecord;
      const crossing = affinity.reflex.dims.line!.Tabby!.t + f.tau * Math.log(affinity.reflex.dims.line!.Tabby!.s * (1 - f.config.thetaOut) / (f.config.K * f.config.thetaOut));
      expect(f.item.alarms.at(-1)).toBeCloseTo(crossing, 3); expect(f.item.alarms.at(-1)).toBeLessThanOrEqual(affinity.retention!.expiresAt);
      const saved = f.bytes(); f.item.shopper = new ShopperReflex(f.item.state, f.env);
      expect((await f.item.shopper.fetch(new Request('https://shopper-reflex/unused'))).status).toBe(404); expect(f.bytes()).toBe(saved);
      const authority = structuredClone(f.item.data.get('grantAuthority')), choice = storedConsent(f.item.data.get('consent'));
      clock.mockReturnValue(affinity.retention!.expiresAt);
      await f.item.shopper.alarm();
      for (const key of ['affinity', 'pipeline', 'audienceOwner']) expect(f.item.data.has(key)).toBe(false);
      expect(f.item.data.get('grantAuthority')).toEqual(authority);
      const { operation: _expiredRetry, ...originalChoice } = choice.instruction!;
      expect(storedConsent(f.item.data.get('consent'))).toEqual({ ...choice, instruction: originalChoice });
      clock.mockReturnValue(f.now);
    }
  } finally { clock.mockRestore(); }
});

it('W19.02 resolves content formats under exact tenant ownership on both hosts with guarded fallback', async () => {
  const remote = vi.fn(async () => { throw new Error('Unexpected external request'); }); vi.stubGlobal('fetch', remote);
  try {
    for (const host of ['session', 'do']) {
      invalidateCache();
      const f = boundary(host), objects = new Map<string, { text: string; etag: string }>(), reads: string[] = [];
      let serial = 0, failCatalog = false;
      f.env.TENANTS = JSON.stringify({ provisioned: ['coach', 'meridian', 'brighthour'] });
      f.env.STORAGE = {
        get: async (key: string) => {
          reads.push(key); if (failCatalog && key.startsWith('config-publication/')) throw new Error('private storage detail');
          const value = objects.get(key);
          return value ? { key, etag: value.etag, size: new TextEncoder().encode(value.text).length,
            body: new Response(value.text).body, text: async () => value.text, json: async () => JSON.parse(value.text) as unknown } : null;
        },
        put: async (key: string, text: string, options?: R2PutOptions) => {
          const condition = options?.onlyIf;
          if (condition instanceof Headers ? objects.has(key) : condition && condition.etagMatches !== objects.get(key)?.etag) return null;
          const etag = 'w1902-' + (++serial); objects.set(key, { text, etag }); return { key, etag, size: new TextEncoder().encode(text).length };
        },
      } as unknown as R2Bucket;
      const formats = { meridian: ['video', 'custom-format'], brighthour: ['on-model'] };
      for (const [tenant, values] of Object.entries(formats)) {
        await initializePublication(f.env, CONTENT_KIND, tenant, { revision: 1, at: 1, actor: 'fixture', note: '', value: { pieces: [
          { id: 'same', customerContentId: 'cms', type: 'film', title: 'same', tags: { contentType: values }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
        ] } }, '0:' + crypto.randomUUID());
      }
      const frames: Array<{ name: string; frame: IngestFrame }> = [];
      f.env.REGION_TREND = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        frames.push({ name, frame: await new Request(input, init).json() as IngestFrame }); return Response.json({ ok: true });
      } }) } as unknown as DurableObjectNamespace;
      const a = await newAnonymousSession(f.env, 'meridian');
      const b = await issueSessionCapability(f.env, { tenant: 'brighthour', subject: a.subject, sessionId: a.sessionId, kind: 'anonymous' });
      const event = (g: typeof a, data: Record<string, unknown> = {}) => ({ type: 'custom', userId: g.subject, sessionId: g.sessionId, source: 'sdk', surface: 'brighthour',
        data: { event: 'content_click', contentId: 'same', contentType: 'film', ...data } });
      const send = (g: typeof a, data?: Record<string, unknown>) => f.call('/realtime/action', g.capability, event(g, data), g.tenant, undefined, { country: 'US', regionCode: 'NY' });
      const record = (g: typeof a) => host === 'session'
        ? JSON.parse(f.sessions.data.get(tenantKey(g.tenant, `session:${g.sessionId}`))!) as { reflex: { dims: Record<string, Record<string, { s: number }>> } }
        : f.objects.get(shopperObjectName(g.tenant, g.subject))!.data.get('affinity') as { reflex: { dims: Record<string, Record<string, { s: number }>> } };
      const catalogReads = () => reads.filter(key => key.startsWith('config-publication/'));
      invalidateCache(); reads.length = 0;
      for (const g of [a, b]) {
        const before = catalogReads().length;
        expect((await send(g)).status).toBe(200); await f.drain();
        expect(catalogReads().length).toBeGreaterThan(before);
        expect(catalogReads().slice(before).every(key => key.startsWith(`config-publication/v1/${g.tenant}/content/`))).toBe(true);
        expect(frames.at(-1)).toMatchObject({ name: regionObjectName(g.tenant, 'US-NY'), frame: { tenant: g.tenant, w: 1,
          touches: formats[g.tenant as keyof typeof formats].map(value => ({ dim: 'contentType', value })) } });
        for (const value of formats[g.tenant as keyof typeof formats]) expect(record(g).reflex.dims.contentType![value]!.s).toBe(1);
        expect(record(g).reflex.dims.contentType!.film).toBeUndefined();
        const cold = catalogReads().length;
        expect((await send(g)).status).toBe(200); await f.drain(); expect(catalogReads()).toHaveLength(cold);
      }
      const saved = JSON.stringify(record(a)), population = frames.length, beforeInvalid = catalogReads().length;
      for (const contentId of [null, '', ' ', 12, [], {}]) {
        const response = await send(a, { contentId }); expect(response.status).toBe(500);
        expect(await response.text()).not.toContain('private');
      }
      expect(catalogReads()).toHaveLength(beforeInvalid); expect(JSON.stringify(record(a))).toBe(saved); expect(frames).toHaveLength(population);
      invalidateCache(); failCatalog = true;
      const failure = await send(a); expect(failure.status).toBe(500);
      expect(await failure.text()).toContain('Content catalog unavailable'); await f.drain();
      expect(JSON.stringify(record(a))).toBe(saved); expect(frames).toHaveLength(population);
      // Retry on the exact same DO instance: refusal cannot poison its owner.
      failCatalog = false; expect((await send(a)).status).toBe(200); await f.drain();
      expect(record(a).reflex.dims.contentType!.video!.s).toBeGreaterThan(2.9);
      expect((await send(a, { contentId: 'unknown', contentType: 'wire-miss' })).status).toBe(200); await f.drain();
      expect(record(a).reflex.dims.contentType!['wire-miss']!.s).toBe(1);
      const idless = event(a, { contentType: 'wire-idless' }); delete (idless.data as Record<string, unknown>).contentId;
      const beforeIdless = catalogReads().length;
      expect((await f.call('/realtime/action', a.capability, idless, a.tenant)).status).toBe(200); await f.drain();
      expect(catalogReads()).toHaveLength(beforeIdless); expect(record(a).reflex.dims.contentType!['wire-idless']!.s).toBe(1);
      const headKey = 'config-publication/v1/meridian/content/head.json', head = objects.get(headKey)!, beforeMissing = frames.length;
      objects.delete(headKey); invalidateCache();
      expect((await send(a)).status).toBe(500); await f.drain(); expect(frames).toHaveLength(beforeMissing);
      objects.set(headKey, head);
      invalidateCache(); failCatalog = true; f.env.REFLEX_ENABLED = 'false';
      const beforeDisabled = catalogReads().length;
      expect((await send(a)).status).toBe(200); await f.drain(); expect(catalogReads()).toHaveLength(beforeDisabled);
      f.env.REFLEX_ENABLED = 'true';
      expect((await f.call(`/realtime/session/${a.sessionId}/preferences`, a.capability, { trackingConsent: false, personalizationEnabled: false }, a.tenant)).status).toBe(200);
      const beforeRefused = catalogReads().length;
      expect((await send(a)).status).toBe(200); await f.drain(); expect(catalogReads()).toHaveLength(beforeRefused);
      expect((await f.call('/realtime/action', undefined, event(b), b.tenant)).status).toBe(401);
      expect(catalogReads()).toHaveLength(beforeRefused);
    }
    expect(remote).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); invalidateCache(); }
});

describe('W14.05 typed source snapshots', () => {
  const identitySecret = (tenant: string) => 'FixtureIdentity-' + tenant + '-0123456789-abcdef';
  type Grant = Awaited<ReturnType<typeof newAnonymousSession>>;
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const row = (g: Grant, source = 'crm', at = Date.now() - 1000): ProfileRow => ({ kind: 'profile', version: 1, source, visitorId: g.subject, at,
    fields: { tier: { type: 'string', meaning: 'Synthetic loyalty tier', value: 'gold' },
      spend: { type: 'number', meaning: 'Synthetic unitless total', value: 42 },
      active: { type: 'boolean', meaning: 'Synthetic activity flag', value: true },
      tags: { type: 'string-set', meaning: 'Synthetic declared interests', value: ['b', 'a'] } },
    audiences: { vip: 'Synthetic provider VIP membership' } });
  async function fixture(host: string, audited = false) {
    invalidateCache();
    const f = boundary(host);
    const accounts = memoryStore();
    f.env.IDENTITY_SECRETS=['coach','meridian','kate-spade'].map(tenant=>tenant+':'+identitySecret(tenant)).join(',');
    if (audited) Object.assign(f.env, { AUTH_MODE: 'enforced', IDENTITY_SALT: 'FixtureAuditSalt-0123456789-abcdef', ACCOUNTS: accounts });
    f.env.TENANTS = JSON.stringify({ provisioned: ['coach', 'meridian', 'kate-spade'], operatorGrants: { 'w1405-synthetic': ['meridian', 'kate-spade'] } });
    const storage = new BoundaryR2(), objects = storage.data;
    f.env.STORAGE = storage as unknown as R2Bucket;
    for (const tenant of ['coach', 'meridian', 'kate-spade']) await fixturePublication(f.env, tenant);
    await f.configureRetention();
    for (const kv of [f.sessions, f.cache]) kv.list = async (options?: { prefix?: string }) => ({
      keys: [...kv.data.keys()].filter(name => name.startsWith(options?.prefix ?? '')).sort().map(name => ({ name })), list_complete: true,
    });
    const token = await new SignJWT({ sub: 'w1405-synthetic', ...(audited ? { type: 'service', roles: ['admin'] } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a')
      .setExpirationTime('5m').sign(new TextEncoder().encode(f.env.JWT_SECRET));
    const app = new Hono<{ Bindings: Env }>(); app.use('*', tenantMiddleware()); app.route('/v1', identityRoutes); app.route('/v1', decisionRoutes);
    const post = (rows: unknown[], tenant = 'meridian', raw?: string, bearer = token) => app.request(`https://synthetic.invalid/v1/${tenant}/identity/events`, {
      method: 'POST', headers: { 'X-Tenant': tenant, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify({ rows }),
    }, f.env);
    const csv = (body: BodyInit, tenant = 'meridian', headers: Record<string, string> = {}) => {
      const init: RequestInit & { duplex: string } = { method: 'POST', headers: { 'X-Tenant': tenant, Authorization: `Bearer ${token}`, 'Content-Type': 'text/csv', ...headers }, body, duplex: 'half' };
      return app.request(`https://synthetic.invalid/v1/${tenant}/identity/events`, init, f.env);
    };
    const auditPage = (tenant: string) => app.request(`https://synthetic.invalid/v1/${tenant}/audit`, { headers: { Authorization: `Bearer ${token}` } }, f.env);
    return { ...f, post, csv, r2: objects, accounts, auditPage };
  }
  const item = (f: Fixture, g: Grant) => f.objects.get(shopperObjectName(g.tenant, g.subject))!;
  const profile = (f: Fixture, g: Grant): SessionData | PipelineRecord => f.env.REFLEX_HOST === 'do'
    ? structuredClone(item(f, g).data.get('pipeline')) as PipelineRecord
    : JSON.parse(f.sessions.data.get(tenantKey(g.tenant, `session:${g.sessionId}`))!) as SessionData;
  const writes = (f: Fixture) => [...f.sessions.calls.filter(c => /^(put|delete):/.test(c)), ...f.effects.filter(c => c.startsWith('store:'))];
  const noBehavior = (f: Fixture, transfer = false) => ({ sessions: [...f.sessions.data], cache: [...f.cache.data],
    objects: [...f.objects].map(([name, owner]) => [name, [...owner.data].filter(([key]) => !key.startsWith('identityImport:')
      && !(transfer && (['identityIntent','identityTransfer','identitySequence'].includes(key) || key.startsWith('identityRegistration:') || key.startsWith('identityAdmission:'))))]) });
  const checkpoints = new WeakMap<Fixture, ReturnType<typeof noBehavior>>();
  const clear = (f: Fixture) => { checkpoints.set(f, structuredClone(noBehavior(f))); f.sessions.calls.length = 0; f.effects.length = 0; };
  const expectReplayOnly = (f: Fixture) => {
    expect(writes(f).every(key => key === 'store:grantAuthority' || /^store:identityImport:[a-f0-9-]{36}$/.test(key))).toBe(true);
    expect(noBehavior(f)).toEqual(checkpoints.get(f));
  };
  async function warm(f: Fixture, g: Grant) {
    await positiveChoice(f, g);
    expect((await f.call('/realtime/action', g.capability, { userId: g.subject, sessionId: g.sessionId, source: 'sdk', type: 'page_view', data: {} }, g.tenant)).status).toBe(200);
    await f.drain();
  }
  async function link(f: Fixture, g: Grant, accountId: string) {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const assertion = await signAssertion(identitySecret(g.tenant), g.tenant, g.subject, accountId, exp);
    return f.call(`/v1/${g.tenant}/identity/link`, g.capability, { visitorId: g.subject, accountId, exp, assertion }, g.tenant);
  }
  async function eraseLocal(f: Fixture, g: Grant, subject: Parameters<typeof eraseSubject>[2]) {
    let receipt = await eraseSubject(f.env, g.tenant, subject, 'w1405-synthetic');
    for (let attempt = 0; attempt < 20 && receipt.status === 'pending'; attempt++) {
      receipt = await eraseSubject(f.env, g.tenant, subject, 'w1405-synthetic');
    }
    expect(receipt, JSON.stringify({ host: f.env.REFLEX_HOST, status: receipt.status, progress: receipt.discovery }))
      .toMatchObject({ httpStatus: 200, status: 'local_complete', localComplete: true, complete: false });
    expect((await f.call(`/realtime/segments/${g.subject}`, g.capability, undefined, g.tenant)).status).toBe(401);
    return receipt;
  }
  const csvCell = (value: string | number) => '"' + String(value).replace(/"/g, '""') + '"';
  const csvProfiles = (rows: ProfileRow[], delimiter = '\n') => 'kind,version,source,at,visitor_id,shopper_id,account_id,fields,audiences' + delimiter
    + rows.map(r => [r.kind, r.version, r.source, r.at, r.visitorId ?? '', r.shopperId ?? '', r.accountId ?? '', JSON.stringify(r.fields, null, 2), JSON.stringify(r.audiences)].map(csvCell).join(',')).join(delimiter);

  it('W03.06 audits actual mixed JSON and typed CSV target aggregates on both tenant hosts without payload or fabricated row mappings', async () => {
    for (const host of ['session', 'do']) {
      const f = await fixture(host, true), acknowledged: OperationAuditDetail[] = [];
      const append = f.accounts.auditOperations.bind(f.accounts);
      const phases = vi.spyOn(f.accounts, 'auditOperations').mockImplementation(async rows => {
        await append(rows); acknowledged.push(...rows.map(r => JSON.parse(r.detail!) as OperationAuditDetail));
      });
      let watching = false;
      const readSpies = [f.cache, f.sessions].map(kv => {
        const get = kv.get.bind(kv);
        return vi.spyOn(kv, 'get').mockImplementation(async (...args) => {
          if (watching) expect(acknowledged.at(-1)?.phase).toBe('admitted');
          return get(...args);
        });
      });
      const getR2 = f.env.STORAGE.get.bind(f.env.STORAGE);
      const r2Spy = vi.spyOn(f.env.STORAGE, 'get').mockImplementation((...args: Parameters<R2Bucket['get']>) => {
        if (watching) expect(acknowledged.at(-1)?.phase).toBe('admitted');
        return getR2(...args);
      });
      for (const tenant of ['meridian', 'kate-spade']) {
        const g = await newAnonymousSession(f.env, tenant), browser = await newAnonymousSession(f.env, tenant);
        await warm(f, g); await warm(f, browser);
        const linked = await link(f, browser, 'w0306-account'); expect(linked.status).toBe(200);
        const person = (await linked.json() as { session: Grant }).session;
        await positiveChoice(f, person);
        const input = row(g), personInput = row(person), start = acknowledged.length;
        watching = true;
        const response = await f.post([input, personInput, { accountId: 'w0306-account', action: 'purchase', at: input.at, product: { line: 'Tabby' } },
          { ...input, visitorId: 'invalid visitor' }, { ...input, visitorId: undefined, shopperId: 'invalid-shopper' },
          { visitorId: g.subject, action: 'caller"\nprivate-action', at: input.at }], tenant);
        watching = false;
        expect(response.status).toBe(200);
        const receipt = await response.json() as HistoryReport;
        expect(receipt).toMatchObject({ received: 6, applied: 3, shoppers: 2 });
        expect(receipt.perShopper.map(p => p.rows)).toEqual([1, 2]);
        const details = acknowledged.slice(start), result = details.at(-1)!;
        expect(details.map(d => d.phase)).toEqual(['admitted', 'admitted', 'result']);
        expect(result).toMatchObject({ selector: { kind: 'history_results', format: 'json', total: 6 },
          result: { outcome: 'identity_import', received: 6, applied: 3, skipped: 3, shoppers: 2 } });
        if (result.selector.kind !== 'history_results') throw new Error('Expected import result');
        expect(result.selector.members).toEqual([
          { kind: 'subject', subjectKind: 'visitor', subjectRef: expect.stringMatching(/^[a-f0-9]{64}$/), rows: 1 },
          { kind: 'subject', subjectKind: 'shopper', subjectRef: expect.stringMatching(/^[a-f0-9]{64}$/), rows: 2 },
          { kind: 'skipped', ordinal: 3, reason: 'invalid_visitor' }, { kind: 'skipped', ordinal: 4, reason: 'invalid_shopper' },
          { kind: 'skipped', ordinal: 5, reason: 'unweighted_action' },
        ]);
        const material = JSON.stringify(details);
        for (const privateValue of [g.subject, person.subject, 'w0306-account', 'private-action', 'crm', 'gold', 'Synthetic loyalty tier', 'Tabby']) expect(material).not.toContain(privateValue);
        expect(profile(f, g).profileEnrichment?.sources.crm.fields.tier.value).toBe('gold');
        clear(f);
        expect(await (await f.csv(csvProfiles([input]), tenant)).json()).toMatchObject({ applied: 0, skipped: [{ index: 0, reason: 'replayed_profile' }] });
        expectReplayOnly(f);
        expect(acknowledged.at(-1)).toMatchObject({ selector: { format: 'csv', members: [{ kind: 'skipped', ordinal: 0, reason: 'replayed_profile' }] } });
        const empty = { ...input, at: input.at + 1, fields: {}, audiences: {} };
        expect((await f.csv(csvProfiles([empty]), tenant)).status).toBe(200);
        expect(profile(f, g).profileEnrichment?.sources.crm.fields).toEqual({});
        const page = await f.auditPage(tenant); expect(page.status).toBe(200);
        const body = await page.json() as { entries: Array<{ tenant: string; detail: { operation: string } }> };
        expect(body.entries.some(e => e.detail.operation === 'identity_import')).toBe(true);
        expect(body.entries.every(e => e.tenant === tenant)).toBe(true);
      }
      expect((await f.accounts.recentAudit(1000)).filter(r => r.action === 'subject_operation')).toEqual([]);
      phases.mockRestore(); readSpies.forEach(spy => spy.mockRestore()); r2Spy.mockRestore(); await f.drain();
    }
  });

  it.each(['session', 'do'])('W03.06 bounds all 1000 supplied-selector memberships and preserves admission refusal, partial effects and uncertain terminals (%s)', async host => {
    const started = performance.now(); let phase = 'setup';
    try {
      const f = await fixture(host, true), browser = await newAnonymousSession(f.env, 'meridian'); await warm(f, browser);
      const linked = await link(f, browser, 'w0306-max-account'); expect(linked.status).toBe(200);
      const person = (await linked.json() as { session: Grant }).session;
      await positiveChoice(f, person);
      const input = { ...row(person), visitorId: browser.subject, shopperId: person.subject, accountId: 'w0306-max-account', fields: {}, audiences: {} };
      const rows = Array.from({ length: 1000 }, () => input), phaseRows: AuditEntry[][] = [];
      const append = f.accounts.auditOperations.bind(f.accounts);
      const audit = vi.spyOn(f.accounts, 'auditOperations').mockImplementation(async entries => { await append(entries); phaseRows.push(structuredClone(entries)); });
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      const derive = vi.spyOn(crypto.subtle, 'digest').mockImplementation((...args: Parameters<SubtleCrypto['digest']>) => {
        expect(phaseRows).toHaveLength(1); expect(phaseRows[0]).toHaveLength(200); return digest(...args);
      });
      phase = 'full-import';
      const response = await f.post(rows); derive.mockRestore();
      console.info('W14 bounded import phase', { host, phase, elapsedMs: Math.round(performance.now() - started) });
      phase = 'readback-and-faults';
      expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ received: 1000, applied: 1, shoppers: 1, skipped: expect.any(Array) });
      expect(phaseRows.map(p => p.length)).toEqual([200, 100]); expect(audit).toHaveBeenCalledTimes(2);
      const details = phaseRows.flat().map(e => JSON.parse(e.detail!) as OperationAuditDetail);
      expect(new Set(details.map(d => d.requestId)).size).toBe(1);
      expect(phaseRows.every(p => new TextEncoder().encode(JSON.stringify(p)).byteLength <= 1024 * 1024)).toBe(true);
      expect(phaseRows.flat().every(e => new TextEncoder().encode(e.detail!).byteLength <= 2048)).toBe(true);
      const members = details.flatMap(d => d.selector.kind === 'history_inputs' ? d.selector.members : []);
      expect(members.map(m => m.ordinal)).toEqual(Array.from({ length: 1000 }, (_, i) => i));
      expect(members.every(m => m.accountRef && m.shopperRef && m.visitorRef)).toBe(true);
      const before = structuredClone(profile(f, person)); clear(f); f.cache.calls.length = 0;
      audit.mockRejectedValueOnce(new Error('PRIVATE_ADMISSION'));
      const denied = await f.post([input]); expect(denied.status).toBe(503);
      expect(await denied.json()).toMatchObject({ operationMayHaveApplied: false, auditStatus: 'unavailable' });
      expect(f.sessions.calls).toEqual([]); expect(f.cache.calls).toEqual([]); expect(profile(f, person)).toEqual(before);
      const g = await newAnonymousSession(f.env, 'meridian'), h = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); await warm(f, h);
      const first = row(g), second = row(h); expect((await f.post([second])).status).toBe(200);
      phaseRows.length = 0;
      const partial = await f.post([first, { ...second, audiences: {} }]);
      expect(partial.status).toBe(503); expect(await partial.json()).toMatchObject({ outcome: 'outcome_unknown', operationMayHaveApplied: true, auditStatus: 'recorded' });
      expect(profile(f, g).profileEnrichment?.sources.crm.fields.tier.value).toBe('gold');
      expect(phaseRows.map(p => p.length)).toEqual([1, 1]);
      expect(JSON.parse(phaseRows[1]![0]!.detail!)).toMatchObject({ selector: { kind: 'history_unknown', format: 'json', total: 2 }, result: { outcome: 'outcome_unknown', operationMayHaveApplied: true } });
      expect(phaseRows[1]![0]!.detail).not.toContain('members');
      audit.mockImplementation(async entries => {
        if ((JSON.parse(entries[0]!.detail!) as OperationAuditDetail).phase === 'result') throw new Error('PRIVATE_TERMINAL');
        await append(entries);
      });
      const replacement = { ...first, at: first.at + 1, fields: {}, audiences: {} };
      const terminal = await f.post([replacement]); expect(terminal.status).toBe(503);
      expect(await terminal.json()).toMatchObject({ operationMayHaveApplied: true, auditStatus: 'unconfirmed', requestId: expect.any(String) });
      expect(profile(f, g).profileEnrichment?.sources.crm.fields).toEqual({});
      audit.mockImplementation(async entries => { await append(entries); });
      const history = vi.spyOn(historyModule, 'applyHistory');
      for (const bad of [
        { received: 2, applied: 0, shoppers: 0, skipped: [{ index: 0, reason: 'profile_missing' }], perShopper: [] },
        { received: 1, applied: 1, shoppers: 1, skipped: [], perShopper: [{ shopperId: g.subject, rows: 0 }] },
        { received: 1, applied: 0, shoppers: 0, skipped: [{ index: 0, reason: 'PRIVATE_UNKNOWN_REASON' }], perShopper: [] },
      ]) {
        history.mockResolvedValueOnce(bad as HistoryReport);
        const malformed = await f.post([first]); expect(malformed.status).toBe(503); expect(await malformed.text()).not.toContain('PRIVATE');
      }
      history.mockRestore(); audit.mockRestore(); await f.drain(); phase = 'complete';
    } finally {
      vi.restoreAllMocks();
      console.info('W14 bounded import phase', { host, phase, elapsedMs: Math.round(performance.now() - started) });
    }
  }, 120000); // Each actual host retains the full 1000-row protocol; not a request/SLO claim.

  it('W14.06 strictly maps typed CSV and rejects malformed grammar, headings, cells and limits without effects while preserving behavioral CSV', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      const f = await fixture('session'), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g);
      const input: ProfileRow = { ...row(g), fields: { label: { type: 'string', meaning: 'Quoted, "meaning"\nline', value: '  café, "quoted"\nvalue  ' } } };
      for (const delimiter of ['\r\n', '\n', '\r']) {
        const csv = csvProfiles([input], delimiter).replace(',at,', ', Timestamp ,').replace('visitor_id', 'VISITORID');
        expect((await f.csv(delimiter + csv + delimiter)).status).toBe(200);
        expect(profile(f, g).profileEnrichment?.sources.crm.fields.label).toEqual(input.fields.label);
      }
      const columns = ['kind', 'version', 'source', 'at', 'visitor_id', 'fields', 'audiences'];
      const values = ['profile', '1', 'crm', String(input.at), g.subject, JSON.stringify(input.fields), JSON.stringify(input.audiences)];
      const table = (header = columns, cells = values) => header.join(',') + '\n' + cells.map(csvCell).join(',');
      const invalid = [
        table().slice(0, -1), columns.join(',') + '\npro"file,1,crm,0,v,{},{}', table().replace('"profile"', '"profile"garbage'),
        table([...columns, ' VISITORID '], [...values, g.subject]), table([...columns, 'time'], [...values, String(input.at)]),
        ...['', '__proto__', 'constructor', 'prototype', 'action'].map(name => table([...columns, name], [...values, 'purchase'])),
        ...columns.map((_, index) => table(columns.filter((_, i) => i !== index), values.filter((_, i) => i !== index))),
        table(columns, values.slice(0, -1)), table(columns, [...values, 'extra']),
        table(columns, values.map((v, i) => i === 0 ? '' : v)), table(columns, values.map((v, i) => i === 0 ? 'event' : v)),
        ...['', '01', '2'].map(version => table(columns, values.map((v, i) => i === 1 ? version : v))),
        ...['', 'null', '[]', '"secret-untyped"', '{bad}', '{"x":{"type":"number","meaning":"Declared","value":"42"}}'].map(fields => table(columns, values.map((v, i) => i === 5 ? fields : v))),
        table(columns, values.map((v, i) => i === 6 ? 'null' : v)),
        table() + '\n,,,,,,', table() + '\n""', table() + '\n ',
      ];
      const before = [...f.sessions.data];
      for (const csv of invalid) {
        clear(f); const response = await f.csv(csv); expect(response.status).toBe(400);
        expect(await response.text()).not.toContain('secret-untyped'); expect(writes(f)).toEqual([]); expect([...f.sessions.data]).toEqual(before);
      }
      for (const body of [new Uint8Array([0xc3, 0x28]), new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('synthetic read failure')); } })]) {
        clear(f); expect((await f.csv(body)).status).toBe(400); expect(writes(f)).toEqual([]);
      }
      const csv = csvProfiles([input]), bytes = new TextEncoder().encode(csv);
      const exact = '\n'.repeat(1024 * 1024 - bytes.byteLength) + csv;
      clear(f); expect((await f.csv(exact, g.tenant, { 'Content-Length': '1' })).status).toBe(200); expectReplayOnly(f);
      const oversized = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(exact)); controller.enqueue(new Uint8Array([10])); controller.close(); } });
      clear(f); expect((await f.csv(oversized, g.tenant, { 'Content-Length': '1' })).status).toBe(413); expect(writes(f)).toEqual([]);
      clear(f); expect(await (await f.csv(csvProfiles(Array.from({ length: 1000 }, () => input)))).json()).toMatchObject({ received: 1000, applied: 0 }); expectReplayOnly(f);
      clear(f); expect((await f.csv(csvProfiles(Array.from({ length: 1001 }, () => input)))).status).toBe(413); expect(writes(f)).toEqual([]);
      const legacy = 'visitor_id,action,timestamp,line,price_usd,source\n' + g.subject + ',purchase,' + Math.floor(input.at / 1000) + ',"Tabby",395,warehouse';
      expect(parseHistoryCsv(legacy)[0]).toMatchObject({ product: { line: 'Tabby', price_usd: 395, source: 'warehouse' } });
      expect(await (await f.csv(legacy)).json()).toMatchObject({ applied: 1 });
      await f.drain();
    } finally { clock.mockRestore(); }
  }, 120000); // Includes the exact 1MiB/1000-row accepted boundary and all refusal cases.

  it('W14.06 feeds both tenant hosts through CSV reads, JSON replay, replacement and withdrawal with existing consent and erasure guards', async () => {
    const started = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(started);
    try {
      for (const host of ['session', 'do']) {
        const f = await fixture(host), a = await newAnonymousSession(f.env, 'meridian');
        const b = await issueSessionCapability(f.env, { tenant: 'kate-spade', subject: a.subject, sessionId: a.sessionId, kind: 'anonymous' });
        for (const g of [a, b]) {
          await new KvAudienceStore(f.env, g.tenant).publish({ key: 'csv_and_live', name: 'CSV plus live', description: 'Synthetic', createdAt: 1, status: 'published', source: 'manual', evaluation: 'realtime',
            conditions: ['and', { attribute: 'external.crm.tier', operator: 'eq', value: 'gold' }, { attribute: 'page_views', operator: 'gte', value: 1 }] });
          await warm(f, g);
          const input: ProfileRow = { ...row(g), fields: { tier: { type: 'string', meaning: 'Synthetic tier', value: g === a ? 'gold' : 'silver' } }, audiences: g === a ? { vip: 'Synthetic VIP' } : { basic: 'Synthetic basic' } };
          expect(await (await f.csv(csvProfiles([input]), g.tenant)).json()).toMatchObject({ received: 1, applied: 1 });
          expect(profile(f, g).profileEnrichment?.sources.crm.fields.tier.value).toBe(g === a ? 'gold' : 'silver');
          expect([...f.sessions.data.keys()].filter(key => key.includes('identity:shopper:'))).toEqual([]);
          const expected = g === a ? ['csv_and_live', 'external.crm.vip'] : ['external.crm.basic'];
          for (const path of [`/realtime/segments/${g.subject}`, `/realtime/personalization/${g.subject}`]) {
            const body = await (await f.call(path, g.capability, undefined, g.tenant)).json() as { segments?: string[]; config?: { segments: string[] } };
            expect(body.segments ?? body.config?.segments).toEqual(expected);
          }
          clear(f); expect(await (await f.post([input], g.tenant)).json()).toMatchObject({ applied: 0, skipped: [{ index: 0, reason: 'replayed_profile' }] }); expectReplayOnly(f);
          await warm(f, g); expect(profile(f, g).profileEnrichment?.sources.crm.fields.tier).toEqual(input.fields.tier);
          const replacement: ProfileRow = { ...input, at: input.at + 1, fields: {}, audiences: { replacement: 'Synthetic replacement' } };
          expect((await f.post([replacement], g.tenant)).status).toBe(200);
          clear(f); expect(await (await f.csv(csvProfiles([replacement]), g.tenant)).json()).toMatchObject({ applied: 0, skipped: [{ reason: 'replayed_profile' }] }); expectReplayOnly(f);
          expect(await (await f.call(`/realtime/segments/${g.subject}`, g.capability, undefined, g.tenant)).json()).toMatchObject({ segments: ['external.crm.replacement'] });
          const empty: ProfileRow = { ...replacement, at: replacement.at + 1, audiences: {} };
          expect((await f.csv(csvProfiles([empty]), g.tenant)).status).toBe(200);
          for (const path of [`/realtime/segments/${g.subject}`, `/realtime/personalization/${g.subject}`]) {
            const body = await (await f.call(path, g.capability, undefined, g.tenant)).json() as { segments?: string[]; config?: { segments: string[] } };
            expect(body.segments ?? body.config?.segments).toEqual([]);
          }
          clear(f); expect(await (await f.csv(csvProfiles([{ ...empty, accountId: 'another-synthetic-person' }]), g.tenant)).json()).toMatchObject({ applied: 0, skipped: [{ reason: 'identity selectors disagree' }] }); expect(writes(f)).toEqual([]);
          const cold = await newAnonymousSession(f.env, g.tenant);
          clear(f); expect(await (await f.csv(csvProfiles([row(cold)]), g.tenant)).json()).toMatchObject({ applied: 0, skipped: [{ reason: 'profile_missing' }] }); expect(writes(f)).toEqual([]);
          expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, { trackingConsent: false, personalizationEnabled: false }, g.tenant)).status).toBe(200);
          clear(f); expect(await (await f.csv(csvProfiles([input]), g.tenant)).json()).toMatchObject({ applied: 0, skipped: [{ reason: 'consent_refused' }] }); expect(writes(f)).toEqual([]);
          await eraseLocal(f, g, { visitorId: g.subject });
          clear(f); expect(await (await f.csv(csvProfiles([input]), g.tenant)).json()).toMatchObject({ applied: 0, skipped: [{ reason: 'event is at or before subject erasure' }] }); expect(writes(f)).toEqual([]);
        }
        await f.drain();
      }
    } finally { clock.mockRestore(); }
  });

  it('W14.05 validates bounded typed rows and performs deterministic replacement/replay with behavioral-only accounting', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      for (const host of ['session', 'do']) {
        const f = await fixture(host), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g);
        const input = row(g), original = profile(f, g);
        const originalReflex = host === 'do' ? structuredClone((item(f, g).data.get('affinity') as AffinityRecord).reflex) : (original as SessionData).reflex;
        for (const bad of [ { ...input, version: 2 }, { ...input, source: '__proto__' }, { ...input, at: Date.now() + 1 },
          { ...input, fields: { x: { type: 'number', meaning: 'wrong type', value: '42' } } },
          { ...input, fields: { x: { type: 'string', meaning: '', value: 'bad' } } },
          { ...input, fields: { x: { type: 'string', meaning: 'too long', value: 'x'.repeat(257) } } },
          { ...input, fields: Object.fromEntries(Array.from({ length: 33 }, (_, n) => ['f' + n, input.fields.tier])) },
          { ...input, consent: { tracking: true, personalization: true } },
        ]) { clear(f); expect((await f.post([bad])).status).toBe(400); expect(writes(f)).toEqual([]); }
        clear(f); expect((await f.post([], 'meridian', ' '.repeat(1024 * 1024 + 1))).status).toBe(413); expect(writes(f)).toEqual([]);
        expect((await f.post([input], 'meridian', undefined, 'invalid')).status).toBe(401);
        clear(f); expect(await (await f.post([input])).json()).toMatchObject({ applied: 1, shoppers: 1 });
        const stored = profile(f, g);
        expect(stored.profileEnrichment?.sources.crm.fields.tags.value).toEqual(['a', 'b']);
        expect(stored.attributes).toEqual(original.attributes);
        expect(host === 'do' ? (item(f, g).data.get('affinity') as AffinityRecord).reflex : (stored as SessionData).reflex).toEqual(originalReflex);
        if (host === 'session') expect((stored as SessionData).metadata).toEqual({ ...(original as SessionData).metadata, lastSegmentUpdate: Date.now() });
        expect([...f.sessions.data.keys()].filter(key => key.includes('identity:shopper:'))).toEqual([]);
        if(host==='session'){
          const projectionGrant=await newAnonymousSession(f.env,g.tenant);await warm(f,projectionGrant);
          const owner=item(f,projectionGrant),originalRetention=structuredClone((owner.data.get('affinity') as AffinityRecord).retention),projected=profile(f,projectionGrant);
          f.sessions.failWrite=true;
          try{expect((await f.post([row(projectionGrant,'projection')])).status).toBe(500);}finally{f.sessions.failWrite=false;}
          expect((owner.data.get('pipeline') as PipelineRecord).profileEnrichment?.sources.projection).toBeDefined();expect(profile(f,projectionGrant)).toEqual(projected);
          const [operationKey,debt]=[...owner.data].find(([key,value])=>key.startsWith('identityImport:')&&(value as {published?:boolean}).published===false)!;
          expect(debt).toMatchObject({published:false,retention:originalRetention,result:{applied:1}});
          owner.shopper=new ShopperReflex(owner.state,f.env);
          const retry=()=>owner.shopper.fetch(new Request('https://owner/identity/import/result',{method:'POST',headers:{'X-Reflex-Tenant':projectionGrant.tenant,'X-Reflex-Subject':projectionGrant.subject},body:JSON.stringify({operationId:operationKey.slice('identityImport:'.length)})}));
          expect((await retry()).status).toBe(200);expect(profile(f,projectionGrant).profileEnrichment?.sources.projection).toBeDefined();
          expect(owner.data.get(operationKey)).toMatchObject({published:true,retention:originalRetention,expires:(debt as {expires:number}).expires});
          const once=structuredClone(owner.data.get('pipeline'));expect((await retry()).status).toBe(200);expect(owner.data.get('pipeline')).toEqual(once);
        }
        for (const mixed of [false, true]) {
          const replacement = { ...input, at: input.at + 1, audiences: { uncommitted: 'Must never appear after a failed write' } };
          const pending = mixed ? [replacement, { visitorId: g.subject, action: 'purchase', at: input.at, product: { line: 'Tabby' } }] : [replacement];
          const persisted = structuredClone(noBehavior(f));
          const mirrors = () => {
            const object = item(f, g).shopper as unknown as { affinity: unknown; pipeline: unknown; audienceOwner: unknown };
            return structuredClone({ affinity: object.affinity, pipeline: object.pipeline, audienceOwner: object.audienceOwner });
          };
          const beforeMirrors = host === 'do' ? mirrors() : null;
          const alarm = item(f, g).alarms.at(-1), refused = f.faults.refusedAudienceWrites;
          f.faults.audienceWrite = true;
          // importUnderOwner reconciles the rejected write, then closes an
          // unavailable result as SessionAccessError; it cannot report success.
          try { expect((await f.post(pending)).status).toBe(401); } finally { f.faults.audienceWrite = false; }
          expect(f.faults.refusedAudienceWrites).toBe(refused + 1);
          expect(noBehavior(f)).toEqual(persisted);
          if (host === 'do') expect(mirrors()).toEqual(beforeMirrors);
          expect(item(f, g).alarms.at(-1)).toBe(alarm);
          expect(profile(f, g)).toEqual(stored);
        }
        for (const [snapshot, reason] of [[{ ...input, fields: { ...input.fields, tags: { ...input.fields.tags, value: ['a', 'b', 'a'] } } }, 'replayed_profile'], [{ ...input, at: input.at - 1 }, 'stale_profile']] as const) {
          clear(f); const alarm = item(f, g).alarms.at(-1);
          expect(await (await f.post([snapshot])).json()).toMatchObject({ applied: 0, skipped: [{ index: 0, reason }] });
          expect(profile(f, g)).toEqual(stored); expectReplayOnly(f);
          expect(item(f, g).alarms.at(-1)).toBe(alarm);
        }
        clear(f); expect((await f.post([{ ...input, audiences: {} }])).status).toBe(401); expectReplayOnly(f);
        expect((await f.post([{ ...input, at: input.at + 1, fields: {}, audiences: {} }])).status).toBe(200);
        expect(profile(f, g).profileEnrichment?.sources.crm).toEqual({ at: input.at + 1, fields: {}, audiences: {} });
        const linked = await link(f, g, 'w1405-account'); expect(linked.status).toBe(200);
        const person = (await linked.json() as { session: Grant }).session;
        await positiveChoice(f, person);
        const mixed = await f.post([row(person, 'crm', input.at + 2), { visitorId: person.subject, action: 'purchase', at: input.at, product: { line: 'Tabby' } }]);
        expect(await mixed.json()).toMatchObject({ applied: 2 });
        const identity = JSON.parse(f.sessions.data.get(tenantKey(g.tenant, `identity:shopper:${person.subject}`))!) as { history: { rows: number } };
        expect(identity.history.rows).toBe(1);
        clear(f); expect(await (await f.post([row(person, 'crm', input.at + 2)])).json()).toMatchObject({ applied: 0 }); expectReplayOnly(f);
        const many = Array.from({ length: 8 }, (_, n) => ({ ...row(person, 'source' + n), fields: {}, audiences: {} }));
        clear(f); expect((await f.post(many)).status).toBe(401); expectReplayOnly(f);
        const full = { ...row(person, 'large'), fields: Object.fromEntries(Array.from({ length: 32 }, (_, n) => ['f' + n,
          { type: 'string-set', meaning: 'large', value: Array.from({ length: 32 }, (_, j) => String(j) + 'x'.repeat(250)) }])) };
        clear(f); expect((await f.post([full])).status).toBe(401); expectReplayOnly(f);
        expect(() => readEnrichment({ version: 1, sources: Object.create({ inherited: {} }) })).toThrow();
        expect(() => readEnrichment({ version: 1, sources: { crm: { at: Number.MAX_SAFE_INTEGER, fields: {}, audiences: {} } } })).toThrow();
        await f.drain();
      }
    } finally { clock.mockRestore(); }
  });

  it('W14.05 consumes current typed and precomputed membership on both tenant hosts through reads, live events and restarted alarms without raw-value decision egress', async () => {
    const started = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(started);
    const decisions = vi.spyOn(LiveDecisionProvider.prototype, 'decideAll');
    const remote = vi.fn(async () => { throw new Error('Unexpected external request'); }); vi.stubGlobal('fetch', remote);
    try {
      for (const host of ['session', 'do']) {
        clock.mockReturnValue(started);
        const f = await fixture(host), a = await newAnonymousSession(f.env, 'meridian');
        const b = await issueSessionCapability(f.env, { tenant: 'kate-spade', subject: a.subject, sessionId: a.sessionId, kind: 'anonymous' });
        for (const g of [a, b]) {
          const cfg = { ...DEFAULT_REFLEX_CONFIG, version: 'w1405-synthetic', tauMs: 1000, K: 2, thetaIn: 0.4, thetaOut: 0.2,
            weights: { content_click: 2 }, dimensions: [{ key: 'taste', source: 'taste' }] };
          const scope = reflexScopeForTenant(g.tenant), base = await readReflexConfigRevision(f.env, scope);
          expect((await writeReflexConfig(f.env, scope, cfg, { actor: 'synthetic', expectedRevision: base!.revision, expectedPublication: base!.publication, operationId: base!.revision + ':' + crypto.randomUUID() })).ok).toBe(true);
          await new KvAudienceStore(f.env, g.tenant).publish({ key: 'typed_and_live', name: 'Synthetic typed plus live', description: 'Test only', createdAt: 1, status: 'published', source: 'manual', evaluation: 'realtime',
            conditions: ['and', { attribute: 'external.crm.tier', operator: 'eq', value: g === a ? 'gold' : 'silver' }, { attribute: 'page_views', operator: 'gte', value: 1 }] });
          await new KvAudienceStore(f.env, g.tenant).publish({ key: 'late_journey_external', name: 'Synthetic external late key', description: 'Test only', createdAt: 1, status: 'published', source: 'manual', evaluation: 'realtime',
            conditions: { attribute: 'external.crm.tier', operator: 'eq', value: g === a ? 'gold' : 'silver' } });
          await new KvAudienceStore(f.env, g.tenant).publish({ key: 'late_journey_stage', name: 'Synthetic stage rule', description: 'Test only', createdAt: 1, status: 'published', source: 'manual', evaluation: 'realtime',
            conditions: { attribute: 'journey_stage', operator: 'eq', value: 'late' } });
          await warm(f, g);
          expect((await f.call('/realtime/action', g.capability, { userId: g.subject, sessionId: g.sessionId, source: 'sdk', type: 'custom', data: { event: 'content_click', taste: 'red' } }, g.tenant)).status).toBe(200);
          await f.drain();
          const owner = host === 'do' ? structuredClone(item(f, g).data.get('audienceOwner')) : undefined;
          const imported = g === a ? [row(g), { visitorId: g.subject, action: 'content_click', at: started - 1000, attributes: { taste: 'red' } }] : [row(g)];
          expect((await f.post(imported, g.tenant)).status).toBe(200);
          if (host === 'do') expect(item(f, g).data.get('audienceOwner')).toEqual(owner);
          const expected = ['external.crm.vip', ...(g === a ? ['late_journey_external', 'typed_and_live'] : [])];
          clear(f);
          for (const path of [`/realtime/segments/${g.subject}`, `/realtime/personalization/${g.subject}`]) {
            const response = await f.call(path, g.capability, undefined, g.tenant); expect(response.status).toBe(200);
            const body = await response.json() as { segments?: string[]; config?: { segments: string[] } };
            expect(body.segments ?? body.config?.segments).toEqual(expect.arrayContaining(expected));
            if (g === b) expect(body.segments ?? body.config?.segments).not.toContain('typed_and_live');
          }
          expect(writes(f)).toEqual([]);
          const call = decisions.mock.calls.filter((call,index) => (decisions.mock.instances[index] as unknown as {opti:{tenant:string}}).opti.tenant === g.tenant && call[1] === g.subject).at(-1)!; expect(call).toBeDefined(); expect(call[2]).toEqual(expect.arrayContaining(expected));
          expect(Object.keys(call[3]).filter(key => key.startsWith('external.'))).toEqual([]);
          expect(call[3]).not.toHaveProperty('profileEnrichment');
        }
        clock.mockReturnValue(started + 10000);
        for (const g of [a, b]) {
          const expected = ['external.crm.vip', ...(g === a ? ['late_journey_external', 'typed_and_live'] : [])];
          clear(f);
          expect(await (await f.call(`/realtime/segments/${g.subject}`, g.capability, undefined, g.tenant)).json()).toMatchObject({ segments: expected });
          expect(writes(f)).toEqual([]);
          if (host === 'do') {
            const current = item(f, g); current.shopper = new ShopperReflex(current.state, f.env);
            await current.shopper.alarm();
            expect([...profile(f, g).segments].sort()).toEqual(expected);
            expect((current.data.get('affinity') as AffinityRecord).reflex.audiences).toEqual([]);
          }
          await warm(f, g); expect(profile(f, g).profileEnrichment?.sources.crm.fields.tier.value).toBe('gold');
          const empty = { ...row(g), fields: {}, audiences: {} };
          expect((await f.post([empty], g.tenant)).status).toBe(200);
          for (const path of [`/realtime/segments/${g.subject}`, `/realtime/personalization/${g.subject}`]) {
            const body = await (await f.call(path, g.capability, undefined, g.tenant)).json() as { segments?: string[]; config?: { segments: string[] } };
            expect(body.segments ?? body.config?.segments).toEqual([]);
          }
          expect(profile(f, g).attributes).not.toHaveProperty('external.crm.tier');
          await warm(f, g);
          expect(profile(f, g).segments).toEqual([]);
          expect(host === 'do' ? (profile(f, g) as PipelineRecord).journeyStage : (profile(f, g) as SessionData).metadata.journeyStage).toBe('early');
        }
        await f.drain();
      }
      expect(remote).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('W14.05 preserves signed identity merge/repoint, refuses conflicting or oversized merges before link writes, and honors consent and erasure', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      for (const host of ['session', 'do']) {
        const f = await fixture(host), a = await newAnonymousSession(f.env, 'meridian'), b = await newAnonymousSession(f.env, 'meridian');
        await warm(f, a); await warm(f, b);
        const first = row(a, 'crm'), second = row(b, 'warehouse');
        expect((await f.post([first, second])).status).toBe(200);
        const linkedA = await link(f, a, 'w1405-person'); expect(linkedA.status).toBe(200);
        const person = (await linkedA.json() as { session: Grant }).session;
        expect((await link(f, b, 'w1405-person')).status).toBe(200);
        expect(Object.keys(profile(f, person).profileEnrichment!.sources)).toEqual(['crm', 'warehouse']);
        const c = await newAnonymousSession(f.env, 'meridian'); await warm(f, c);
        expect((await f.post([{ ...row(c, 'crm', first.at), audiences: {} }])).status).toBe(200);
        const before = [...f.sessions.data], originalState = structuredClone(noBehavior(f, true)); clear(f);
        expect((await link(f, c, 'w1405-person')).status).toBe(500); expect(noBehavior(f, true)).toEqual(originalState); expect([...f.sessions.data]).toEqual(before);
        expect(item(f,c).data.get('identityTransfer')).toMatchObject({status:'prepared',transfer:{tenant:c.tenant,visitorId:c.subject,shopperId:person.subject}});
        expect(item(f,c).data.get('forwardTo')).toBeUndefined();
        if (host === 'session') {
          for (const cookieSessionId of ['w1405-expired-cookie', person.sessionId]) {
            clear(f);
            await expect(linkVisitor(f.env, 'meridian', { visitorId: c.subject, accountId: 'w1405-person', source: 'import', assurance: 'signed', cookieSessionId }))
              .rejects.toThrow('Conflicting profile snapshot');
            expect(noBehavior(f, true)).toEqual(originalState); expect([...f.sessions.data]).toEqual(before);
          }
        }
        const d = await newAnonymousSession(f.env, 'meridian'); await warm(f, d);
        expect((await f.post(Array.from({ length: 7 }, (_, n) => ({ ...row(d, 'extra' + n), fields: {}, audiences: {} })))).status).toBe(200);
        const beforeOversized = structuredClone(noBehavior(f,true)); clear(f); expect((await link(f, d, 'w1405-person')).status).toBe(500); expect(noBehavior(f,true)).toEqual(beforeOversized); expect(item(f,d).data.get('identityTransfer')).toMatchObject({status:'prepared'}); expect(item(f,d).data.get('forwardTo')).toBeUndefined();
        if (host === 'session') {
          // Retain the trusted legacy session-repoint contract. It never
          // transfers the previous person's enrichment to the new person.
          const moved = await linkVisitor(f.env, 'meridian', { visitorId: a.subject, accountId: 'w1405-other-person', source: 'import', assurance: 'signed' });
          expect(moved.outcome).toBe('relinked');
          const other = { ...person, subject: moved.shopperId, sessionId: moved.sessionId! };
          expect(profile(f, other).profileEnrichment).toBeUndefined();
        } else {
          // A completed native transfer is immutable authority, not a reusable
          // command to move that old browser grant into another person's state.
          const original = structuredClone(noBehavior(f, true));
          const originalSource = structuredClone([...item(f, a).data]), originalPerson = structuredClone([...item(f, person).data]);
          await expect(linkVisitor(f.env, 'meridian', { visitorId: a.subject, accountId: 'w1405-other-person', source: 'import', assurance: 'signed' }))
            .rejects.toThrow('Shopper session unavailable');
          expect(noBehavior(f, true)).toEqual(original);
          expect([...item(f, a).data]).toEqual(originalSource); expect([...item(f, person).data]).toEqual(originalPerson);
          const fresh = await newAnonymousSession(f.env, 'meridian'); await warm(f, fresh);
          const linkedOther = await link(f, fresh, 'w1405-other-person'); expect(linkedOther.status).toBe(200);
          const other = (await linkedOther.json() as { session: Grant }).session;
          expect(profile(f, other).profileEnrichment).toBeUndefined();
        }
        expect(Object.keys(profile(f, person).profileEnrichment!.sources)).toEqual(['crm', 'warehouse']);
        const refused = await newAnonymousSession(f.env, 'meridian'); await warm(f, refused);
        expect((await f.call(`/realtime/session/${refused.sessionId}/preferences`, refused.capability, { trackingConsent: false, personalizationEnabled: false })).status).toBe(200);
        clear(f); expect(await (await f.post([row(refused)])).json()).toMatchObject({ applied: 0, skipped: [{ reason: 'consent_refused' }] }); expect(writes(f)).toEqual([]);
        if (host === 'do') {
          clear(f); expect((await item(f, c).shopper.fetch(new Request('https://shopper-reflex/identity/import', { method: 'POST', headers: { [SHOPPER_HEADER]: c.capability, 'X-Tenant': c.tenant }, body: 'not JSON' }))).status).toBe(401); expect(writes(f)).toEqual([]);
        }
        // The repoint scenario deliberately retains the old link inventory;
        // use a coherent separately linked subject for the erasure positive.
        const erasedBrowser = await newAnonymousSession(f.env, 'meridian'); await warm(f, erasedBrowser);
        const erasedRow = row(erasedBrowser, 'erase_source'); expect((await f.post([erasedRow])).status).toBe(200);
        const erasedLink = await link(f, erasedBrowser, 'w1405-erased-person'); expect(erasedLink.status).toBe(200);
        const erased = (await erasedLink.json() as { session: Grant }).session;
        expect(profile(f, erased).profileEnrichment?.sources.erase_source).toBeDefined();
        await eraseLocal(f, erased, { shopperId: erased.subject });
        expect(f.sessions.data.has(tenantKey(erased.tenant, `session:${erased.sessionId}`))).toBe(false);
        for (const key of ['affinity', 'pipeline', 'audienceOwner']) expect(item(f, erased).data.has(key)).toBe(false);
        expect(item(f, erased).data.get('grantAuthority')).toMatchObject({ grants: {} });
        clear(f); expect(await (await f.post([{ ...erasedRow, visitorId: erased.subject }])).json()).toMatchObject({ applied: 0, skipped: [{ reason: 'event is at or before subject erasure' }] }); expect(writes(f)).toEqual([]);
        clock.mockReturnValue(Date.now() + 1);
        clear(f); expect(await (await f.post([{ ...erasedRow, visitorId: erased.subject, at: Date.now() }])).json()).toMatchObject({ applied: 0, skipped: [{ reason: 'profile_missing' }] }); expect(writes(f)).toEqual([]);
        await f.drain();
      }
    } finally { clock.mockRestore(); }
  });
});

describe('W03.07 configured ODP provenance on both hosts', () => {
  it('isolates two same-identity tenants across writes, reads, sockets and restarted alarms; stale labels cannot pin journey or manual updates', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const decisions = vi.spyOn(LiveDecisionProvider.prototype, 'decideAll');
    const remote = vi.fn(async (input: RequestInfo | URL) => {
      const tenant = String(input).includes('meridian') ? 'meridian' : 'brighthour';
      return Response.json({ data: { customer: { audiences: { edges: [{ node: { name: 'remote_' + tenant, state: 'qualified' } }] } } } });
    }); vi.stubGlobal('fetch', remote);
    try {
      for (const host of ['session', 'do']) {
        invalidateCache(); const f = boundary(host);
        const tenants = Object.fromEntries(['meridian', 'brighthour'].map(tenant => [tenant, { odp: {
          apiHost: 'https://odp-' + tenant + '.invalid', publicKeyRef: 'CONNECTOR_SECRET_' + tenant.toUpperCase(), identityNamespace: 'customer',
          actions: { product_view: { type: 'product', action: 'detail', fields: { product_id: 'productId' } } },
          audiences: { ['remote_' + tenant]: 'owned_' + tenant }, profile: { stage: { journey: true } },
        } }]));
        Object.assign(f.env, { DEPLOYMENT_PROFILE: 'customer', IDENTITY_SALT: 'w0307-Synthetic-Identity-Salt-9bQx5Zr2Fv8Lm6Kp', TENANTS: JSON.stringify({ provisioned: Object.keys(tenants) }),
          TENANT_CONNECTORS: JSON.stringify({ version: 1, tenants }), CONNECTOR_SECRET_MERIDIAN: 'synthetic-a', CONNECTOR_SECRET_BRIGHTHOUR: 'synthetic-b' });
        const documents = new Map<string, { text: string; etag: string }>(); let revision = 0;
        f.env.STORAGE = { get: async (key: string) => { const doc = documents.get(key); return doc ? { key, etag: doc.etag,
          size: doc.text.length, body: new Response(doc.text).body, text: async () => doc.text, json: async () => JSON.parse(doc.text) } : null; },
          put: async (key: string, text: string, options?: R2PutOptions) => {
            const condition = options?.onlyIf;
            if (condition instanceof Headers ? documents.has(key) : condition && condition.etagMatches !== documents.get(key)?.etag) return null;
            const etag = String(++revision); documents.set(key, { text, etag }); return { key, etag, size: text.length };
          } } as unknown as R2Bucket;
        for (const tenant of Object.keys(tenants)) {
          // One coherent published set per tenant; legacy KV is never an authority
          // fallback (src/config/publication.ts:19; src/reflex/configStore.ts:408-415).
          await fixturePublication(f.env, tenant, [
            { kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant), revision: { revision: 1, at: 1, actor: 'synthetic', note: '', value: { ...DEFAULT_REFLEX_CONFIG, version: 'w0307-' + tenant,
              dimensions: [{ key: 'taste', source: 'line' }], weights: { product_view: 2 }, tauMs: 1000, K: 1, thetaIn: 0.4, thetaOut: 0.2,
              eventAttributes: 'event-when-unknown' } } },
            { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { pieces: [
              { id: 'a', customerContentId: 'cms-a', type: 'editorial', title: 'A', tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' } },
            ] } } },
            { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: {} }] } } } },
          ]);
          await getConnectors(f.env, tenant).audiences.createAudience({ key: 'local_late', name: 'Late only', description: 'Synthetic', source: 'manual',
            status: 'published', evaluation: 'realtime', createdAt: Date.now(), conditions: { attribute: 'journey_stage', operator: 'eq', value: 'late' } });
        }
        const a = await newAnonymousSession(f.env, 'meridian');
        const b = await issueSessionCapability(f.env, { tenant: 'brighthour', subject: a.subject, sessionId: a.sessionId, kind: 'anonymous' });
        for (const g of [a, b]) {
          const key = tenantKey(g.tenant, 'session:' + g.sessionId);
          const item = () => f.objects.get(shopperObjectName(g.tenant, g.subject))!;
          const state = () => host === 'do' ? item().data.get('affinity') as AffinityRecord : JSON.parse(f.sessions.data.get(key)!) as SessionData;
          const event = { userId: g.subject, sessionId: g.sessionId, type: 'product_view', source: 'sdk', data: { productId: 'customer-only', line: 'blue' } };
          await positiveChoice(f, g);
          const first = await f.call('/realtime/action', g.capability, event, g.tenant); expect(first.status).toBe(200);
          expect((await first.json() as any).update.data.segments).toContain('owned_' + g.tenant);
          await f.drain();
          expect(state().odpContext).toMatch(/^[0-9a-f]{64}$/);
          const other = g.tenant === 'meridian' ? 'brighthour' : 'meridian';
          expect(state().odpSeed).not.toContain('owned_' + other);
          const originalPin = state().odpContext;
          const poison = (enriched = false) => {
            const seed = ['late_journey_ready_to_buy', 'manual-overlap'], segments = [...seed, 'manual-kept'];
            if (host === 'do') {
              item().data.set('affinity', { ...state(), odpContext: 'foreign-unproven', odpSeed: seed, odpRecentEvents: [{ foreign: true }], odpSeedAt: Date.now() });
              item().data.set('pipeline', { ...item().data.get('pipeline') as PipelineRecord, attributes: {}, segments, journeyStage: 'late',
                ...(enriched ? { profileEnrichment: { version: 1, sources: {} } } : {}) });
              item().shopper = new ShopperReflex(item().state, f.env);
            } else {
              const old = state() as SessionData;
              retainedSession(f, g.tenant, g.subject, g.sessionId, { ...old, attributes: {}, segments, odpContext: 'foreign-unproven', odpSeed: seed,
                odpRecentEvents: [{ foreign: true }], odpSeedAt: Date.now(), metadata: { ...old.metadata, journeyStage: 'late' },
                ...(enriched ? { profileEnrichment: { version: 1, sources: {} } } : {}) });
            }
          };
          poison();
          const readBytes = () => host === 'do' ? JSON.stringify([...item().data]) : f.sessions.data.get(key);
          const beforeRead = readBytes();
          const beforeNetwork = remote.mock.calls.length;
          const analytics = await f.call('/realtime/session/' + g.sessionId + '/analytics', g.capability, undefined, g.tenant);
          expect(analytics.status).toBe(200); expect((await analytics.json() as any).analytics.segmentHistory).toEqual(['manual-kept']);
          const personalization = await f.call('/realtime/personalization/' + g.subject, g.capability, undefined, g.tenant);
          expect(personalization.status).toBe(200); expect(JSON.stringify(await personalization.json())).not.toMatch(/late_journey_ready_to_buy|local_late/);
          expect(decisions.mock.calls.at(-1)![3].journey_stage).toBe('early');
          const segments = await f.call('/realtime/segments/' + g.subject, g.capability, undefined, g.tenant);
          expect((await segments.json() as any).segments).not.toContain('late_journey_ready_to_buy');
          const reflex = await f.call('/realtime/reflex?userId=' + g.subject, g.capability, undefined, g.tenant);
          expect(reflex.status).toBe(200);
          if (host === 'do') expect(await reflex.json()).toMatchObject({ journeyStage: 'early' });
          const content = await f.call('/v1/' + g.tenant + '/decisions/snapshot?page=home&visitorId=' + g.subject + '&sessionId=' + g.sessionId,
            g.capability, undefined, g.tenant);
          expect(content.status).toBe(200); expect((await content.json() as any).cell.stage).toBe('early');
          await f.drain(); expect(readBytes()).toBe(beforeRead);
          expect(remote).toHaveBeenCalledTimes(beforeNetwork);
          if (host === 'do') {
            poison(true);
            const principal = await verifySessionCapability(f.env, g.capability, g.tenant);
            const ws = { deserializeAttachment: () => ({ shopperId: g.subject, principal }), send: vi.fn(), close: vi.fn() };
            item().sockets.push(ws as unknown as WebSocket);
            expect((await f.call('/realtime/segments/' + g.subject, g.capability, { segment: 'new-manual' }, g.tenant)).status).toBe(200);
            const manual = JSON.parse(ws.send.mock.calls.at(-1)![0]);
            expect(manual.data.segments).toContain('new-manual'); expect(manual.data.segments).not.toContain('late_journey_ready_to_buy');
            expect(manual.data.journeyStage).toBe('early');
            poison(); ws.send.mockClear();
            await item().shopper.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'action', event }));
            expect(ws.close).not.toHaveBeenCalled();
            const frame = ws.send.mock.calls.map(c => JSON.parse(c[0])).find(c => c.type === 'personalization_update');
            expect(frame.data.segments).toContain('owned_' + g.tenant); expect(frame.data.segments).not.toContain('local_late');
            expect(frame.data.journeyStage).toBe('early');
            poison(); ws.send.mockClear();
            const crossing = nextCrossing(state().reflex!, Date.now(), { ...DEFAULT_REFLEX_CONFIG, version: 'w0307-' + g.tenant,
              dimensions: [{ key: 'taste', source: 'line' }], weights: { product_view: 2 }, tauMs: 1000, K: 1, thetaIn: 0.4, thetaOut: 0.2,
              eventAttributes: 'event-when-unknown' });
            expect(crossing).not.toBeNull(); expect(item().alarms.some(at => at <= Math.ceil(crossing!))).toBe(true);
            clock.mockReturnValue(Math.ceil(crossing!) + 5);
            await item().shopper.alarm();
            expect(state().odpSeed).toEqual(['owned_' + g.tenant]);
            expect((item().data.get('pipeline') as PipelineRecord).journeyStage).toBe('early');
            poison();
            const refused = await f.call('/realtime/action', g.capability, { ...event, data: { ...event.data, consent: { tracking: true, personalization: false } } }, g.tenant);
            await f.drain();
            expect(refused.status).toBe(200);
            expect(state()).toMatchObject({ odpSeed: [], odpRecentEvents: [] });
            expect((item().data.get('pipeline') as PipelineRecord).segments).not.toContain('late_journey_ready_to_buy');
            expect((item().data.get('pipeline') as PipelineRecord).journeyStage).toBe('early');
            expect(state().odpContext).toBe(originalPin);
            expect(JSON.stringify(state().odpRecentEvents)).not.toContain('foreign');
          } else {
            const next = await f.call('/realtime/action', g.capability, event, g.tenant); expect(next.status).toBe(200);
            const update = (await next.json() as any).update;
            expect(update.data.segments).toContain('owned_' + g.tenant); expect(update.data.segments).not.toContain('local_late');
            expect(update.data.journeyStage).toBe('early');
            expect(state().odpContext).toBe(originalPin);
            expect(JSON.stringify(state().odpRecentEvents)).not.toContain('foreign');
            poison();
            const refused = await f.call('/realtime/action', g.capability, { ...event, data: { ...event.data, consent: { tracking: true, personalization: false } } }, g.tenant);
            expect(refused.status).toBe(200);
            const cookies = refused.headers.get('set-cookie') ?? '';
            expect(cookies).toContain('opt_personalization_enabled=false');
            expect(cookies).not.toMatch(/opt_segments|late_journey_ready_to_buy|manual-overlap|opt_journey/);
            await f.drain();
          }
          expect((await f.call('/realtime/session/' + g.sessionId + '/preferences', g.capability,
            { trackingConsent: true, personalizationEnabled: true }, g.tenant)).status).toBe(200);
          const prior = await newAnonymousSession(f.env, g.tenant);
          await positiveChoice(f, prior);
          expect((await f.call('/realtime/action', prior.capability, { ...event, userId: prior.subject, sessionId: prior.sessionId, type: 'page_view', data: {} }, g.tenant)).status).toBe(200);
          const existing = await linkVisitor(f.env, g.tenant, { visitorId: prior.subject, accountId: 'w0307-person', source: 'login', assurance: 'signed',
            principal: await verifySessionCapability(f.env, prior.capability, g.tenant), capability: prior.capability });
          if (host === 'do') {
            const owned = f.objects.get(shopperObjectName(g.tenant, existing.shopperId))!;
            owned.data.set('affinity', { ...owned.data.get('affinity') as AffinityRecord, odpSeed: [], odpRecentEvents: [] });
            owned.data.set('pipeline', { ...owned.data.get('pipeline') as PipelineRecord, segments: ['manual-overlap'], attributes: {}, journeyStage: 'early' });
            owned.shopper = new ShopperReflex(owned.state, f.env);
          } else {
            const ownedKey = tenantKey(g.tenant, 'session:' + existing.sessionId), owned = JSON.parse(f.sessions.data.get(ownedKey)!) as SessionData;
            retainedSession(f, g.tenant, existing.shopperId, existing.sessionId!, { ...owned, odpSeed: [], odpRecentEvents: [], segments: ['manual-overlap'], attributes: {},
              metadata: { ...owned.metadata, journeyStage: 'early' } });
          }
          poison();
          const linked = await linkVisitor(f.env, g.tenant, { visitorId: g.subject, accountId: 'w0307-person', source: 'login',
            assurance: 'signed', principal: await verifySessionCapability(f.env, g.capability, g.tenant), capability: g.capability });
          const target = host === 'do' ? f.objects.get(shopperObjectName(g.tenant, linked.shopperId))! : null;
          const merged = target ? { ...(target.data.get('affinity') as AffinityRecord), ...(target.data.get('pipeline') as PipelineRecord) }
            : JSON.parse(f.sessions.data.get(tenantKey(g.tenant, 'session:' + linked.sessionId))!) as SessionData;
          expect(merged.odpSeed).toEqual([]); expect(merged.odpRecentEvents).toEqual([]);
          expect(merged.segments).not.toContain('late_journey_ready_to_buy');
          expect(merged.segments).toContain('manual-overlap');
          expect('metadata' in merged ? merged.metadata.journeyStage : merged.journeyStage).toBe('early');
        }
        await f.drain();
      }
      expect(remote.mock.calls.every(([url]) => /^https:\/\/odp-(meridian|brighthour)\.invalid\/v3\//.test(String(url)))).toBe(true);
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('does not add configured provider network or retained activity to buffered processing', async () => {
    const network = vi.fn(async () => { throw new Error('Buffered provider network'); }); vi.stubGlobal('fetch', network);
    try {
      for (const host of ['session', 'do']) {
        const f = await bufferedBoundary(host), before = structuredClone(f.record());
        Object.assign(f.env, { DEPLOYMENT_PROFILE: 'customer', CONNECTOR_SECRET_ODP: 'synthetic', TENANT_CONNECTORS: JSON.stringify({ version: 1, tenants: {
          meridian: { odp: { apiHost: 'https://odp-meridian.invalid', publicKeyRef: 'CONNECTOR_SECRET_ODP', identityNamespace: 'customer',
            actions: {}, audiences: { remote: 'ODP_ALLOWED' }, profile: {} } },
        } }) });
        expect((await f.send()).status).toBe(200);
        expect(f.record().segments).not.toContain('ODP_ALLOWED');
        expect(f.record().odpSeed).toEqual(before.odpSeed); expect(f.record().odpRecentEvents).toEqual(before.odpRecentEvents);
        expect(f.record().attributes).toEqual(before.attributes); await f.drain();
      }
      expect(network).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('W37.06 tenant-owned audience names and legacy ODP boundary', () => {
  it('contains global ODP and retained seeds across two same-identity tenants, both hosts, reads, sockets and restarted alarms', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const remote = vi.fn(async () => { throw new Error('Unexpected remote call'); }); vi.stubGlobal('fetch', remote);
    const product = vi.spyOn(CatalogService.prototype, 'getProduct');
    try {
      for (const host of ['session', 'do']) {
        invalidateCache(); const f = boundary(host);
        Object.assign(f.env, { TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian', 'brighthour'] }),
          ODP_API_HOST: 'https://odp.synthetic.invalid', ODP_PUBLIC_KEY: 'synthetic-only' });
        for (const tenant of ['meridian', 'brighthour']) {
          // Publication is the only configuration authority (src/config/publication.ts:19).
          await fixturePublication(f.env, tenant, [{ kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant), revision: { revision: 1, at: 1, actor: 'synthetic', note: '', value: {
            ...DEFAULT_REFLEX_CONFIG, version: `w3706-${tenant}`, dimensions: [{ key: 'taste', source: 'line' }],
            weights: { product_view: 2 }, tauMs: 1000, K: 1, thetaIn: 0.4, thetaOut: 0.2, eventAttributes: 'event-when-unknown',
          } } }]);
          await getConnectors(f.env, tenant).audiences.createAudience({ key: 'line_tabby_affinity', name: 'Customer-authored same-name audience',
            description: 'Synthetic owner rule', status: 'published', evaluation: 'realtime', source: 'manual', createdAt: Date.now(),
            conditions: { attribute: 'product_views', operator: 'gte', value: 1 } });
        }
        const a = await newAnonymousSession(f.env, 'meridian');
        const b = await issueSessionCapability(f.env, { tenant: 'brighthour', subject: a.subject, sessionId: a.sessionId, kind: 'anonymous' });
        for (const g of [a, b]) {
          const key = tenantKey(g.tenant, `session:${g.sessionId}`);
          const item = () => f.objects.get(shopperObjectName(g.tenant, g.subject))!;
          const state = () => host === 'do' ? item().data.get('affinity') as AffinityRecord
            : JSON.parse(f.sessions.data.get(key)!) as AffinityRecord;
          const bytes = () => host === 'do' ? structuredClone([...item().data]) : f.sessions.data.get(key);
          const event = (line: string, surface: string) => ({ userId: g.subject, sessionId: g.sessionId, type: 'product_view',
            source: surface === 'coach' ? 'coach-storefront' : 'brighthour', surface, data: { productId: 'COA-CH857', line } });
          const assertUpdate = (body: { odp?: unknown; update?: { data: { segments: string[]; affinity?: { odpConfirmed?: string[] } } } }, expected: string[]) => {
            expect(body.odp).toBeUndefined(); expect(body.update?.data.segments.slice().sort()).toEqual(expected.slice().sort());
            expect(body.update?.data.affinity?.odpConfirmed).toEqual([]);
          };
          const initial = await f.call('/realtime/action', g.capability, event('owned', 'brighthour'), g.tenant);
          expect(initial.status).toBe(200);
          assertUpdate(await initial.json(), ['line_tabby_affinity', 'taste_owned_affinity']);
          const poison = () => {
            const poisoned = { ...state(), odpSeed: ['legacy-only', 'line_tabby_affinity'], odpSeedAt: Date.now(),
              odpRecentEvents: [{ type: 'product', product_line: 'Tabby', ts: Math.floor(Date.now() / 1000) }] };
            if (host === 'do') { item().data.set('affinity', poisoned); item().shopper = new ShopperReflex(item().state, f.env); }
            else f.sessions.data.set(key, JSON.stringify(poisoned));
          };
          poison(); const retained = bytes();
          const snapshot = await f.call(`/realtime/reflex?userId=${g.subject}`, g.capability, undefined, g.tenant);
          expect(snapshot.status).toBe(200); expect(await snapshot.json()).toMatchObject({ affinity: { odpConfirmed: [] } });
          expect((await f.call(`/realtime/personalization/${g.subject}`, g.capability, undefined, g.tenant)).status).toBe(200);
          expect(bytes()).toEqual(retained);
          if (host === 'do') {
            const principal = await verifySessionCapability(f.env, g.capability, g.tenant);
            const ws = { deserializeAttachment: () => ({ shopperId: g.subject, principal }), send: vi.fn(), close: vi.fn() };
            item().sockets.push(ws as unknown as WebSocket);
            const manual = await f.call(`/realtime/segments/${g.subject}`, g.capability, { segment: 'manual-kept', source: 'w3706-manual' }, g.tenant);
            expect(manual.status).toBe(200);
            const manualFrame = JSON.parse(ws.send.mock.calls.at(-1)![0]);
            expect(manualFrame.data).toMatchObject({ segments: expect.arrayContaining(['manual-kept', 'line_tabby_affinity']), affinity: { odpConfirmed: [] } });
            expect(state().odpSeed).toEqual(['legacy-only', 'line_tabby_affinity']);
            ws.send.mockClear();
            await item().shopper.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'action', event: event('socket', 'coach') }));
            expect(ws.close).not.toHaveBeenCalled();
            const frames = ws.send.mock.calls.map(call => JSON.parse(call[0]));
            expect(frames.some(frame => frame.type === 'odp_receipt')).toBe(false);
            assertUpdate({ update: frames.find(frame => frame.type === 'personalization_update') }, ['line_tabby_affinity', 'taste_owned_affinity', 'taste_socket_affinity']);
            expect(state()).toMatchObject({ odpSeed: [], odpSeedAt: 0, odpRecentEvents: [] });
            poison(); ws.send.mockClear();
            const crossing = item().alarms.at(-1)!; expect(crossing).toBeGreaterThan(Date.now()); clock.mockReturnValue(Math.ceil(crossing) + 5);
            await item().shopper.alarm();
            const alarm = ws.send.mock.calls.map(call => JSON.parse(call[0])).find(frame => frame.data?.source === 'reflex_alarm');
            assertUpdate({ update: alarm }, ['line_tabby_affinity']);
          } else {
            const next = await f.call('/realtime/action', g.capability, event('next', 'coach'), g.tenant);
            expect(next.status).toBe(200); assertUpdate(await next.json(), ['line_tabby_affinity', 'taste_owned_affinity', 'taste_next_affinity']);
          }
          expect(state()).toMatchObject({ odpSeed: [], odpSeedAt: 0, odpRecentEvents: [] });
        }
        await f.drain();
      }
      expect(product).not.toHaveBeenCalled(); expect(remote).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });
});

describe('W37.05 tenant-owned demo catalog boundary', () => {
  type Grant = Awaited<ReturnType<typeof newAnonymousSession>>;
  const specs = [{ tenant: 'meridian', dim: 'taste', value: 'customer-red' }, { tenant: 'brighthour', dim: 'mood', value: 'customer-blue' }];
  const configure = async (f: ReturnType<typeof boundary>, eventAttributes: 'catalog-only' | 'event-when-unknown') => {
    f.env.TENANTS = JSON.stringify({ provisioned: ['coach', ...specs.map(s => s.tenant)] });
    // Publication is the only configuration authority (src/config/publication.ts:19).
    for (const s of specs) await fixturePublication(f.env, s.tenant, [{ kind: REFLEX_KIND, scope: reflexScopeForTenant(s.tenant), revision: { revision: 1, at: 1, actor: 'synthetic', note: '', value: {
      ...DEFAULT_REFLEX_CONFIG, version: `w3705-${s.tenant}`, dimensions: [{ key: s.dim, source: 'line' }],
      weights: { product_view: 2 }, tauMs: 1000, K: 1, thetaIn: 0.4, thetaOut: 0.2, eventAttributes,
    } } }]);
  };
  const event = (g: Grant, productId: string, line: string, surface: string) => ({
    userId: g.subject, sessionId: g.sessionId, type: 'product_view', source: surface === 'coach' ? 'coach-storefront' : 'brighthour', surface,
    data: { productId, line, price_usd: 7 },
  });
  const raw = (f: ReturnType<typeof boundary>, g: Grant) => (f.env.REFLEX_HOST === 'do'
    ? f.objects.get(shopperObjectName(g.tenant, g.subject))!.data.get('affinity')
    : JSON.parse(f.sessions.data.get(tenantKey(g.tenant, `session:${g.sessionId}`))!)) as { reflex: AffinityRecord['reflex']; attributes?: Record<string, unknown> };
  const observeCatalog = () => [vi.spyOn(demoRegistry, 'catalogServiceFor'),
    ...(['getProduct', 'getAllProducts', 'getRecommendations', 'sortForSegments'] as const).map(key => vi.spyOn(CatalogService.prototype, key))];
  const noCatalog = (spies: ReturnType<typeof observeCatalog>) => { for (const spy of spies) expect(spy).not.toHaveBeenCalled(); };
  const emptyLists = (value: unknown) => expect(value).toMatchObject({ recommendations: [], sortOrder: [] });
  const products = async () => Promise.all((['coach', 'brighthour'] as const).map(async surface => ({
    surface, product: (await demoRegistry.catalogServiceFor(surface)).getAllProducts()[0]!,
  })));

  it('uses authored customer attributes despite both demo SKU collisions and keeps catalog-only free of demo affinity on both hosts', async () => {
    const demos = await products();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const remote = vi.fn(async () => { throw new Error('Unexpected external request'); }); vi.stubGlobal('fetch', remote);
    const access = observeCatalog();
    try {
      for (const host of ['session', 'do']) for (const policy of ['event-when-unknown', 'catalog-only'] as const) {
        invalidateCache(); const f = boundary(host); await configure(f, policy);
        for (const { surface, product } of demos) {
          const a = await newAnonymousSession(f.env, specs[0]!.tenant);
          const b = await issueSessionCapability(f.env, { tenant: specs[1]!.tenant, subject: a.subject, sessionId: a.sessionId, kind: 'anonymous' });
          for (const [i, g] of [a, b].entries()) {
            const s = specs[i]!;
            const response = await f.call('/realtime/action', g.capability, event(g, product.id, s.value, surface), g.tenant);
            expect(response.status).toBe(200);
            const body = await response.json() as { dropped?: string; update?: { data: unknown } };
            if (policy === 'catalog-only') {
              if (host === 'do') { expect(body.dropped).toBe('unknown_product'); expect(raw(f, g)).toBeUndefined(); }
              else { expect(raw(f, g).reflex.dims).toEqual({}); expect(raw(f, g).attributes).toMatchObject({ product_views: 1, viewed_product_line: s.value, price_band_viewed: 'entry' }); }
              continue;
            }
            expect(body.dropped).toBeUndefined(); emptyLists(body.update?.data);
            expect(raw(f, g).reflex.dims).toEqual({ [s.dim]: { [s.value]: { s: 2, t: Date.now() } } });
            const attributes = host === 'do' ? (f.objects.get(shopperObjectName(g.tenant, g.subject))!.data.get('pipeline') as PipelineRecord).attributes : raw(f, g).attributes;
            expect(attributes).toMatchObject({ product_views: 1, viewed_product_line: s.value, price_band_viewed: 'entry' });
            const personal = await f.call(`/realtime/personalization/${g.subject}`, g.capability, undefined, g.tenant);
            expect(personal.status).toBe(200); expect(await personal.json()).toMatchObject({ userId: g.subject, sessionId: g.sessionId });
            // This HTTP projection omits product lists; the event envelope above
            // carries them, and the actual personalization tail must also avoid the catalog.
            noCatalog(access);
            const sorted = await f.call('/sort', g.capability, { userId: g.subject, sessionId: g.sessionId, surface,
              candidates: [{ id: 'other', line: 'not-owned' }, { id: 'owned', line: s.value }] }, g.tenant);
            expect(sorted.status).toBe(200);
            expect(await sorted.json()).toMatchObject({ order: ['owned', 'other'], items: [{ id: 'owned', score: 0.6667 }, { id: 'other', score: 0 }] });
          }
        }
        await f.drain();
      }
      noCatalog(access); expect(remote).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('keeps explicit tenant ownership through DO socket, manual, personalization and restarted owner-alarm tails', async () => {
    const demos = await products(); invalidateCache(); const f = boundary('do'); await configure(f, 'event-when-unknown');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const remote = vi.fn(async () => { throw new Error('Unexpected external request'); }); vi.stubGlobal('fetch', remote);
    const access = observeCatalog(), resolve = vi.spyOn(demoRegistry, 'resolveTenantCatalog');
    try {
      for (const s of specs) {
        const g = await newAnonymousSession(f.env, s.tenant), demo = demos[1]!;
        expect((await f.call('/realtime/action', g.capability, event(g, demo.product.id, s.value, demo.surface), g.tenant)).status).toBe(200);
        const item = f.objects.get(shopperObjectName(g.tenant, g.subject))!;
        const ws = { deserializeAttachment: () => ({ shopperId: g.subject, principal: g }), send: vi.fn(), close: vi.fn() };
        item.sockets.push(ws as unknown as WebSocket);
        const pushed = (source: string) => {
          const frames = ws.send.mock.calls.map(call => JSON.parse(call[0]));
          const frame = frames.find(value => value.type === 'personalization_update' && value.data.source === source);
          expect(frame).toBeDefined(); emptyLists(frame.data);
        };
        await item.shopper.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'action', event: event(g, demos[0]!.product.id, 'customer-socket', 'coach') }));
        expect(ws.close).not.toHaveBeenCalled(); pushed('coach-storefront');
        ws.send.mockClear();
        const manual = await f.call(`/realtime/segments/${g.subject}`, g.capability, { segment: 'w3705-manual', source: 'w3705-manual' }, g.tenant);
        expect(manual.status).toBe(200); pushed('w3705-manual');
        resolve.mockClear();
        expect((await f.call(`/realtime/personalization/${g.subject}`, g.capability, undefined, g.tenant)).status).toBe(200);
        expect(resolve).toHaveBeenCalledWith(g.tenant, 'coach');
        ws.send.mockClear(); item.shopper = new ShopperReflex(item.state, f.env);
        const crossing = item.alarms.at(-1)!; expect(crossing).toBeGreaterThan(Date.now()); clock.mockReturnValue(crossing + 5);
        resolve.mockClear(); await item.shopper.alarm(); pushed('reflex_alarm');
        expect(resolve).toHaveBeenCalledWith(g.tenant, 'coach');
        expect((item.data.get('affinity') as AffinityRecord).reflex.audiences).toEqual([]);
        expect(item.data.get('audienceOwner')).toEqual({ tenant: g.tenant, subject: g.subject, sessionId: g.sessionId });
        noCatalog(access);
      }
      expect(remote).not.toHaveBeenCalled();
    } finally { await f.drain(); clock.mockRestore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('retains lazy memoized Coach and BrightHour product lookup and nonempty valid demo lists on both hosts', async () => {
    const demos = await products();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      for (const host of ['session', 'do']) {
        invalidateCache(); const f = boundary(host);
        for (const { surface, product } of demos) {
          const service = await demoRegistry.catalogServiceFor(surface);
          expect(await demoRegistry.resolveTenantCatalog('coach', surface)).toBe(service);
          const g = await newAnonymousSession(f.env, 'coach');
          let update: { data: { recommendations: Array<{ id: string }>; sortOrder: string[] } } | undefined;
          for (let n = 0; n < 4; n++) {
            const response = await f.call('/realtime/action', g.capability, event(g, product.id, 'caller-must-not-win', surface), g.tenant);
            expect(response.status).toBe(200);
            const body = await response.json() as { dropped?: string; update?: typeof update };
            expect(body.dropped).toBeUndefined(); update = body.update ?? update;
          }
          const state = raw(f, g).reflex;
          expect(Object.keys(state.dims).length).toBeGreaterThan(0);
          expect(Object.values(state.dims).some(values => Object.hasOwn(values, 'caller-must-not-win'))).toBe(false);
          expect(state.dims.category).toHaveProperty(product.category);
          expect(update?.data.recommendations.length).toBeGreaterThan(0); expect(update?.data.sortOrder.length).toBeGreaterThan(0);
          const ids = new Set(service.getAllProducts().map(p => p.id));
          expect(update!.data.recommendations.every(p => ids.has(p.id))).toBe(true);
          expect(update!.data.sortOrder.every(id => ids.has(id))).toBe(true);
          expect((await f.call(`/realtime/personalization/${g.subject}`, g.capability, undefined, g.tenant)).status).toBe(200);
        }
        await f.drain();
      }
    } finally { clock.mockRestore(); }
  });
});

describe('W37.04 tenant-owned runtime configuration', () => {
  const specs = [
    { tenant: 'meridian', dim: 'taste', value: 'red', weight: 2, tau: 1000, K: 2, winner: 'a' },
    { tenant: 'brighthour', dim: 'mood', value: 'blue', weight: 5, tau: 5000, K: 1, winner: 'b' },
  ];
  const configured = async (f: ReturnType<typeof boundary>) => {
    f.env.TENANTS = JSON.stringify({ provisioned: ['coach', ...specs.map(s => s.tenant)] });
    // Poison the ambiguous demo document: real BrightHour must not consult it.
    f.cache.data.set('reflex:config:brighthour:current', 'legacy-demo-sentinel');
    for (const s of specs) {
      const cfg: ReflexConfig = { ...DEFAULT_REFLEX_CONFIG, version: `w3704-${s.tenant}`, tauMs: s.tau, K: s.K,
        thetaIn: 0.4, thetaOut: 0.2, weights: { content_click: s.weight }, dimensions: [{ key: s.dim, source: s.dim }] };
      // Publication is the only configuration authority (src/config/publication.ts:19):
      // the tenant's coherent baseline exists before its own authored revision.
      await fixturePublication(f.env, s.tenant);
      expect((await writeReflexConfig(f.env, reflexScopeForTenant(s.tenant), cfg,
        await fixtureMeta(f.env, REFLEX_KIND, reflexScopeForTenant(s.tenant), 'synthetic'))).ok).toBe(true);
    }
    f.cache.calls.length = 0;
  };
  type Grant = Awaited<ReturnType<typeof newAnonymousSession>>;
  const event = (g: Grant, surface = 'brighthour') => ({ userId: g.subject, sessionId: g.sessionId, surface, source: 'brighthour', type: 'custom',
    data: { event: 'content_click', taste: 'red', mood: 'blue' } });
  const raw = (f: ReturnType<typeof boundary>, g: Pick<Grant, 'tenant' | 'subject' | 'sessionId'>) => (f.env.REFLEX_HOST === 'do'
    ? f.objects.get(shopperObjectName(g.tenant, g.subject))!.data.get('affinity')
    : JSON.parse(f.sessions.data.get(tenantKey(g.tenant, `session:${g.sessionId}`))!)) as { reflex: AffinityRecord['reflex']; configVersion?: string };
  const internal = (f: ReturnType<typeof boundary>, target: Pick<Grant, 'tenant' | 'subject'>, path: string, body?: unknown, context = target) =>
    f.env.SHOPPER_REFLEX.get(f.env.SHOPPER_REFLEX.idFromName(shopperObjectName(target.tenant, target.subject))).fetch(`https://shopper-reflex${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': context.tenant, 'X-Reflex-Subject': context.subject },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it('uses incompatible two-tenant numeric configs through event/read/WS/restarted alarms, sort and content receipts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const remote = vi.fn(async () => { throw new Error('Unexpected external request'); }); vi.stubGlobal('fetch', remote);
    try {
      for (const host of ['session', 'do']) {
        invalidateCache(); const f = boundary(host); await configured(f);
        const a = await newAnonymousSession(f.env, specs[0]!.tenant);
        const b = await issueSessionCapability(f.env, { tenant: specs[1]!.tenant, subject: a.subject, sessionId: a.sessionId, kind: 'anonymous' });
        const resolver = vi.spyOn(demoRegistry, 'resolveTenantReflexConfig');
        for (const [i, g] of [a, b].entries()) {
          const s = specs[i]!; resolver.mockClear();
          expect((await f.call('/realtime/action', g.capability, event(g), g.tenant)).status).toBe(200);
          expect(resolver).toHaveBeenCalledTimes(1);
          expect(raw(f, g).reflex).toMatchObject({ configVersion: `w3704-${g.tenant}+r2`, dims: { [s.dim]: { [s.value]: { s: s.weight } } } });
          expect(Object.keys(raw(f, g).reflex.dims)).toEqual([s.dim]);
          if (host === 'do') {
            const item = f.objects.get(shopperObjectName(g.tenant, g.subject))!;
            const ws = { deserializeAttachment: () => ({ shopperId: g.subject, principal: g }), send: vi.fn(), close: vi.fn() };
            item.sockets.push(ws as unknown as WebSocket); resolver.mockClear();
            await item.shopper.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'action', event: event(g, 'coach') }));
            expect(ws.close).not.toHaveBeenCalled(); expect(resolver).toHaveBeenCalledTimes(1);
          } else expect((await f.call('/realtime/action', g.capability, event(g, 'coach'), g.tenant)).status).toBe(200);
          expect(raw(f, g).reflex.dims[s.dim]![s.value]!.s).toBe(s.weight * 2);
          const response = await f.call('/realtime/reflex?surface=brighthour', g.capability, undefined, g.tenant);
          expect(response.status).toBe(200);
          const score = Math.round((s.weight * 2 / (s.weight * 2 + s.K)) * 10000) / 10000;
          expect(await response.json()).toMatchObject({ config: { version: `w3704-${g.tenant}+r2`, K: s.K, tauMs: s.tau }, affinity: { dims: { [s.dim]: { [s.value]: score } } } });
          resolver.mockClear();
          const sorted = await f.call('/sort', g.capability, { userId: g.subject, sessionId: g.sessionId, surface: 'brighthour',
            candidates: [{ id: 'a', taste: 'red', mood: 'plain' }, { id: 'b', taste: 'dull', mood: 'blue' }] }, g.tenant);
          expect(sorted.status).toBe(200);
          expect(await sorted.json()).toMatchObject({ configVersion: `w3704-${g.tenant}+r2`, order: [s.winner, s.winner === 'a' ? 'b' : 'a'], items: [{ score }, { score: 0 }] });
          expect(resolver).toHaveBeenCalledTimes(host === 'do' ? 2 : 1);
          const pieces = [{ id: 'a', customerContentId: 'cms-a', title: 'A', type: 'editorial', tags: { taste: ['red'], mood: ['plain'] }, slotTypes: ['hero'] },
            { id: 'b', customerContentId: 'cms-b', title: 'B', type: 'editorial', tags: { taste: ['dull'], mood: ['blue'] }, slotTypes: ['hero'] }];
          expect((await write(f.env, CONTENT_KIND, g.tenant, { pieces }, await fixtureMeta(f.env, CONTENT_KIND, g.tenant, 'synthetic'))).ok).toBe(true);
          expect((await write(f.env, SLOTS_KIND, g.tenant, { pages: { home: [{ slot: 'hero', take: 1, weights: { [s.dim]: 1 } }] } }, await fixtureMeta(f.env, SLOTS_KIND, g.tenant, 'synthetic'))).ok).toBe(true);
          expect((await write(f.env, LEARN_KIND, g.tenant, { holdout: { share: 0, salt: 'synthetic', arms: ['default'] } }, await fixtureMeta(f.env, LEARN_KIND, g.tenant, 'synthetic'))).ok).toBe(true);
          const content = await f.call(`/v1/${g.tenant}/decisions/snapshot?page=home&visitorId=${g.subject}&sessionId=${g.sessionId}`, g.capability, undefined, g.tenant);
          expect(content.status).toBe(200);
          expect(await content.json()).toMatchObject({ sources: { config: { label: `w3704-${g.tenant}+r2`, revision: 2 } },
            records: [{ item_id: s.winner, versions: { config: 2 }, inputs: { affinity: { [s.dim]: { [s.value]: score } } } }] });
          await f.drain();
        }
        resolver.mockRestore();
        if (host === 'do') for (const [i, g] of [a, b].entries()) {
          const s = specs[i]!, item = f.objects.get(shopperObjectName(g.tenant, g.subject))!;
          const lastSeen = (item.data.get('affinity') as AffinityRecord).lastSeen;
          const expected = lastSeen + s.tau * Math.log((2 * s.weight) * (1 - 0.2) / (s.K * 0.2));
          expect(item.alarms.at(-1)).toBeCloseTo(expected, 0);
          item.shopper = new ShopperReflex(item.state, f.env); clock.mockReturnValue(Math.ceil(expected) + 5);
          const peer = [a, b][1 - i]!, peerBefore = structuredClone(raw(f, peer));
          await item.shopper.alarm();
          expect(raw(f, g).reflex.audiences).toEqual([]); expect(raw(f, peer)).toEqual(peerBefore);
          expect(raw(f, g).reflex.configVersion).toBe(`w3704-${g.tenant}+r2`);
        }
        expect(f.cache.data.get('reflex:config:brighthour:current')).toBe('legacy-demo-sentinel');
        expect(f.cache.calls).not.toContain('get:reflex:config:brighthour:current');
      }
      expect(remote).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('uses tenant config for historical import and link/absorb, with actual internal object context before effects', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      for (const host of ['session', 'do']) {
        invalidateCache(); const f = boundary(host); await configured(f);
        for (const s of specs) {
          const visitor = { tenant: s.tenant, subject: 'w3704-shared-history' };
          const sid = 's-w3704-history-' + s.tenant, now = Date.now();
          const reflex: AffinityRecord['reflex'] = { v: 1, dims: {}, audiences: [], configVersion: `w3704-${s.tenant}+r2` };
          if (host === 'session') {
            await new SessionManager(f.env, { tenant: s.tenant }).createOrUpdateSession(sid, visitor.subject, {
              reflex, preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true },
            });
          } else {
            await internal(f, visitor, '/identity/export');
            const item = f.objects.get(shopperObjectName(s.tenant, visitor.subject))!;
            item.data.set('affinity', { shopperId: visitor.subject, reflex, odpSeed: [], odpSeedAt: 0, odpRecentEvents: [], lastSeen: 0, configVersion: reflex.configVersion });
            item.data.set('pipeline', { attributes: {}, segments: [], journeyStage: 'early', sessionId: sid, visitorId: visitor.subject, firstSeen: now, sessionCount: 0 });
            item.data.set('consent', { tracking: true, personalization: true });
            item.shopper = new ShopperReflex(item.state, f.env);
          }
          const report = await applyHistory(f.env, s.tenant, [{ visitorId: visitor.subject, action: 'content_click', at: Date.now(), attributes: { taste: 'red', mood: 'blue' } }]);
          expect(report).toMatchObject({ applied: 1, shoppers: 1 });
          const before = host === 'do' ? f.objects.get(shopperObjectName(s.tenant, visitor.subject))!.data.get('affinity') as AffinityRecord
            : (await new SessionManager(f.env, { tenant: s.tenant }).getSession((await new SessionManager(f.env, { tenant: s.tenant }).resolveSessionIdByUserId(visitor.subject))!))!;
          expect(before.reflex?.dims[s.dim]![s.value]!.s).toBe(s.weight);
          const linked = await linkVisitor(f.env, s.tenant, { visitorId: visitor.subject, accountId: 'same-synthetic-account', source: 'import', assurance: 'signed' });
          expect(linked.outcome).toBe('linked');
          expect(raw(f, { tenant: s.tenant, subject: linked.shopperId, sessionId: linked.sessionId! }).reflex)
            .toMatchObject({ configVersion: `w3704-${s.tenant}+r2`, dims: { [s.dim]: { [s.value]: { s: s.weight } } } });
          const again = await linkVisitor(f.env, s.tenant, { visitorId: visitor.subject, accountId: 'same-synthetic-account', source: 'import', assurance: 'signed' });
          expect(again.outcome).toBe('already');
          if (host === 'do') {
            const person = { tenant: s.tenant, subject: linked.shopperId }, item = f.objects.get(shopperObjectName(person.tenant, person.subject))!;
            expect(item.data.get('audienceOwner')).toBeNull();
            const snap = await internal(f, visitor, '/snapshot'); expect(snap.status).toBe(200);
            expect(await snap.json()).toMatchObject({ config: { version: `w3704-${s.tenant}+r2` }, affinity: { dims: { [s.dim]: expect.any(Object) } } });
            const state = structuredClone([...item.data]); f.cache.calls.length = 0;
            for (const context of [{ ...person, tenant: s.tenant === 'meridian' ? 'brighthour' : 'meridian' }, { ...person, subject: 'wrong-subject' }]) {
              for (const path of ['/identity/import', '/identity/absorb']) expect((await internal(f, person, path, {
                shopperId: person.subject, config: DEFAULT_REFLEX_CONFIG, audienceOwner: context,
                rows: [{ action: 'content_click', at: Date.now(), touches: [{ dim: 'foreign', value: 'bad' }] }],
              }, context)).status).toBe(401);
            }
            expect([...item.data]).toEqual(state); expect(f.cache.calls).toEqual([]);
          }
        }
        await f.drain();
      }
    } finally { clock.mockRestore(); }
  });

  describe('unit:W37.BASE.01 with the configuration publication authority absent, invalid or unreadable, every shopper route including /realtime/personalization/:subject and /realtime/action answers a 4xx/5xx refusal; none serves', () => {
  it('fails explicitly on missing/invalid/outage tenant config before behavior/link/import, preserving refusal and retention', async () => {
    for (const host of ['session', 'do']) for (const failure of ['missing', 'invalid', 'outage']) {
      invalidateCache(); const f = boundary(host); await configured(f);
      const g = await newAnonymousSession(f.env, 'meridian');
      expect((await f.call('/realtime/action', g.capability, event(g), g.tenant)).status).toBe(200); await f.drain();
      // Ruling R38: consent handling does not depend on the reflex configuration, so a
      // tracking-refused action answers 200 whatever the authority's state; only a
      // tracking-ON shopper reaches the behavioural work the absent authority must refuse.
      // This shopper records its explicit positive choice while the authority still serves.
      const tracked = await newAnonymousSession(f.env, g.tenant); await positiveChoice(f, tracked);
      expect((await f.call('/realtime/action', tracked.capability, event(tracked), tracked.tenant)).status).toBe(200); await f.drain();
      const sessionBefore = [...f.sessions.data], objectBefore = host === 'do' ? structuredClone([...f.objects.get(shopperObjectName(g.tenant, g.subject))!.data]) : null;
      const trackedBefore = host === 'do' ? structuredClone([...f.objects.get(shopperObjectName(tracked.tenant, tracked.subject))!.data]) : null;
      // Configuration publication is the only authority: the outage must be injected
      // there, never into the retained KV copy (src/config/publication.ts:19, :204-206;
      // src/reflex/configStore.ts:408-415).
      const storage = f.env.STORAGE as unknown as BoundaryR2, owner = publicationScope(REFLEX_KIND, reflexScopeForTenant(g.tenant));
      const headKey = 'config-publication/v2/' + owner + '/head.json';
      if (failure === 'missing') for (const key of [...storage.data.keys()]) { if (key.startsWith('config-publication/v2/' + owner + '/')) storage.data.delete(key); }
      else if (failure === 'invalid') storage.data.set(headKey, JSON.stringify({ schema: 'configuration-head/v1', scope: owner,
        committed: { revision: 1, digest: '0'.repeat(64) }, pending: null, digest: '0'.repeat(64) }));
      else { const readHead = storage.get.bind(storage); storage.get = async (key: string) => {
        if (key.startsWith('config-publication/')) throw new Error('synthetic configuration storage outage'); return readHead(key); }; }
      invalidateCache();
      const cold = await newAnonymousSession(f.env, g.tenant);
      expect((await f.call(`/realtime/personalization/${cold.subject}`, cold.capability, undefined, cold.tenant)).status).toBeGreaterThanOrEqual(400);
      // Ruling R28: with the configuration publication authority uninitialized or unavailable the
      // contract is a TYPED refusal of either class, never an untyped throw: PublicationError
      // (src/config/publication.ts:15; 'Coherent configuration publication is uninitialized' at :205,
      // 'Configuration publication authority unavailable' at :19) or ReflexConfigUnavailableError
      // (src/reflex/configStore.ts:67, 'Reflex configuration unavailable for scope ...'), whose message
      // names the unavailable or uninitialized authority. The three expectations below accept either.
      if (host === 'do') {
        await expect(f.objects.get(shopperObjectName(cold.tenant, cold.subject))!.shopper.fetch(new Request('https://shopper-reflex/snapshot?projection=sort', {
          headers: { [SHOPPER_HEADER]: cold.capability, 'X-Tenant': cold.tenant },
        }))).rejects.toSatisfy((error: unknown) => (error instanceof ReflexConfigUnavailableError || error instanceof PublicationError) && /unavailable|uninitialized/i.test(error.message), `${host}:${failure}:snapshot`);
      }
      // Ruling R38: with tracking ON, every route that processes behaviour or serves
      // decisions refuses before any behavioural effect when the authority is absent,
      // invalid or unreadable.
      for (const [path, body] of [['/realtime/action', event(tracked)], ['/realtime/reflex?surface=coach', undefined],
        ['/sort', { userId: tracked.subject, candidates: [{ id: 'a', taste: 'red' }] }],
        [`/v1/${tracked.tenant}/decisions/snapshot?page=home&visitorId=${tracked.subject}&sessionId=${tracked.sessionId}`, undefined]] as const) {
        expect((await f.call(path, tracked.capability, body, tracked.tenant)).status, `${host}:${failure}:${path}`).toBeGreaterThanOrEqual(400);
      }
      // Ruling R28 as above: either typed class, message naming the unavailable/uninitialized authority.
      await expect(applyHistory(f.env, g.tenant, [{ visitorId: g.subject, action: 'content_click', at: Date.now(), attributes: { taste: 'red' } }])).rejects.toSatisfy((error: unknown) => (error instanceof ReflexConfigUnavailableError || error instanceof PublicationError) && /unavailable|uninitialized/i.test(error.message), `${host}:${failure}:applyHistory`);
      await expect(linkVisitor(f.env, g.tenant, { visitorId: g.subject, accountId: 'unlinked-account', source: 'login', assurance: 'signed', principal: g, capability: g.capability })).rejects.toSatisfy((error: unknown) => (error instanceof ReflexConfigUnavailableError || error instanceof PublicationError) && /unavailable|uninitialized/i.test(error.message), `${host}:${failure}:linkVisitor`);
      expect([...f.sessions.data]).toEqual(sessionBefore);
      if (host === 'do') {
        expect([...f.objects.get(shopperObjectName(g.tenant, g.subject))!.data]).toEqual(objectBefore);
        // Ruling R38(a) with settled decision D06-W05: `g` never chose, so it wrote nothing
        // and holds only `grantAuthority` (src/content/consent.ts:139-152). The owner that
        // holds an affinity record and a retention alarm is the tracking-on shopper, so the
        // quiet alarm is measured there.
        const item = f.objects.get(shopperObjectName(tracked.tenant, tracked.subject))!;
        expect([...item.data]).toEqual(trackedBefore); item.shopper = new ShopperReflex(item.state, f.env);
        const qualified = vi.spyOn(MockSegmentProvider.prototype, 'fetchQualifiedSegments');
        // R46(g): the refused alarm re-arms the owner's retention alarm, and
        // scheduleProjectionAlarm keeps the nearest already-armed alarm, so the harness drops
        // the decay alarm this fixture armed earlier and leaves the retention one to observe.
        item.alarms.length = 0;
        // Ruling R28: the owner's alarm is a consuming path, so with the authority
        // uninitialized or unavailable it owes the same typed refusal the two calls above
        // already pin — PublicationError (src/config/publication.ts:15, :19, :205) or
        // ReflexConfigUnavailableError (src/reflex/configStore.ts:67) naming the
        // unavailable or uninitialized authority — and it must write nothing.
        await expect(item.shopper.alarm()).rejects.toSatisfy((error: unknown) => (error instanceof ReflexConfigUnavailableError || error instanceof PublicationError) && /unavailable|uninitialized/i.test(error.message), `${host}:${failure}:alarm`);
        expect(qualified).not.toHaveBeenCalled(); qualified.mockRestore();
        expect([...item.data]).toEqual(trackedBefore);
        // Rulings R46(g) and R46(i): clearing the nearer decay alarm above makes the re-arm
        // observable, and after a refused alarm the object's armed alarm is the nearest deadline
        // it owns — `scheduleProjectionAlarm` keeps the minimum of the retention expiry, the
        // consent expiry and the decay crossings. Here that minimum is the consent expiry: an
        // explicit choice lasts CONSENT_LIFETIME_MS from its own `chosenAt`
        // (src/content/consent.ts:17, :19, :112), and this owner's choice was made a few
        // milliseconds before the action that set `lastSeen`, while its retention expiry is the
        // fixture's 365-day policy. Both deadlines are read from the records themselves.
        const armed = item.data.get('consent') as ConsentInstruction;
        const consentExpiry = Math.min(...CONSENT_SWITCHES.flatMap(key => armed[key] ? [armed[key]!.chosenAt + CONSENT_LIFETIME_MS] : []));
        const retentionExpiry = (item.data.get('affinity') as AffinityRecord).retention!.expiresAt;
        expect(item.alarms.at(-1)).toBe(Math.min(consentExpiry, retentionExpiry));
      }
      const refused = await f.call(`/v1/${g.tenant}/decisions/snapshot?page=home&visitorId=${g.subject}&sessionId=${g.sessionId}&trackingConsent=false`, g.capability, undefined, g.tenant);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      // Settled decision D06-W05 (docs/remediation/decisions/D06-W05-explicit-choice-approved-2026-09-16.json;
      // src/content/consent.ts:139-152): an explicit choice is the only consent and a
      // missing or expired record returns to off, so a refusal by a shopper who never
      // chose mints no record. The projection is off and nothing is written.
      expect(storedConsent(f.objects.get(shopperObjectName(g.tenant, g.subject))?.data.get('consent'))).toEqual({ tracking: false, personalization: false });
      expect([...f.sessions.data]).toEqual(sessionBefore);
      // Ruling R38, positive control: the refused-tracking action still answers 200 with
      // no behavioural effect while the configuration authority is unavailable.
      expect((await f.call('/realtime/action', g.capability, { ...event(g), data: { consent: { tracking: false } } }, g.tenant)).status).toBe(200);
      expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, { trackingConsent: false, personalizationEnabled: false }, g.tenant)).status).toBe(200);
      await f.drain();
    }
  });
  });
});

it('W37.02 sends scored content to two verified tenant populations on both hosts with server geo and excludes demo/unsigned/client geo', async () => {
  const remote = vi.fn(async () => { throw new Error('Unexpected external request'); }); vi.stubGlobal('fetch', remote);
  try {
    for (const host of ['session', 'do']) {
      invalidateCache(); invalidateTrendCache();
      const f = boundary(host);
      f.env.TENANTS = JSON.stringify({ provisioned: ['coach', 'meridian', 'brighthour'] });
      const frames: Array<{ name: string; frame: IngestFrame }> = [];
      const regions = new Map<string, { data: Map<string, unknown>; object: RegionTrend }>();
      f.env.REGION_TREND = {
        idFromName: (name: string) => name,
        get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          frames.push({ name, frame: await request.clone().json() as IngestFrame });
          let item = regions.get(name);
          if (!item) {
            const data = new Map<string, unknown>(); let alarm: number | null = null;
            const storage = { get: async (key: string) => structuredClone(data.get(key)),
              put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); },
              getAlarm: async () => alarm, setAlarm: async (at: number) => { alarm = at; } };
            item = { data, object: new RegionTrend({ id: name, storage } as unknown as DurableObjectState, f.env) }; regions.set(name, item);
          }
          return item.object.fetch(request);
        } }),
      } as unknown as DurableObjectNamespace;
      const a = await newAnonymousSession(f.env, 'meridian');
      const b = await issueSessionCapability(f.env, { tenant: 'brighthour', subject: a.subject, sessionId: a.sessionId, kind: 'anonymous' });
      const legacy = 'old mixed population sentinel'; f.cache.data.set('trend:brighthour:US-NY', legacy);
      const content = (g: typeof a, type = 'video') => ({ userId: g.subject, sessionId: g.sessionId, type: 'custom', surface: 'coach', source: 'sdk',
        geo: { country: 'XX', regionCode: 'FORGED' }, data: { event: 'content_click', contentType: type } });
      for (const [g, type] of [[a, 'video'], [b, 'editorial']] as const) {
        const response = await f.call('/realtime/action', g.capability, content(g, type), g.tenant, undefined, { country: 'US', regionCode: 'NY' });
        expect(response.status).toBe(200); await f.drain();
        const sent = frames.at(-1)!;
        expect(sent).toMatchObject({ name: regionObjectName(g.tenant, 'US-NY'), frame: { generation: 2, tenant: g.tenant, region: 'US-NY', w: 1, touches: [{ dim: 'contentType', value: type }] } });
        const record = host === 'session' ? JSON.parse(f.sessions.data.get(tenantKey(g.tenant, `session:${g.sessionId}`))!)
          : f.objects.get(shopperObjectName(g.tenant, g.subject))!.data.get('affinity') as { reflex: { dims: Record<string, Record<string, { s: number }>> } };
        expect(record.reflex.dims.contentType[type].s).toBe(1);
        expect(record.geo).toBeUndefined();
        await regions.get(sent.name)!.object.alarm();
        const prior = await readTrend(f.env, g.tenant, 'US-NY', 1);
        expect(prior?.snapshot).toMatchObject({ generation: 2, tenant: g.tenant, events: 1, share: { contentType: { [type]: 1 } } });
        expect(Object.keys(prior!.snapshot.share.contentType!)).toEqual([type]);
      }
      // Missing edge geography must remain a no-op despite body-supplied geo.
      expect((await f.call('/realtime/action', a.capability, content(a), a.tenant)).status).toBe(200);
      if (host === 'do') {
        const item = f.objects.get(shopperObjectName(a.tenant, a.subject))!;
        const socket = { deserializeAttachment: () => ({ shopperId: a.subject, principal: a }), close: vi.fn() };
        await item.shopper.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ type: 'action', event: content(a) }));
        expect(socket.close).not.toHaveBeenCalled();
        expect((item.data.get('affinity') as { reflex: { dims: Record<string, Record<string, { s: number }>> } }).reflex.dims.contentType!.video!.s).toBeGreaterThan(2.9);
        // W37.03 refuses unsigned actions against an owned non-default object.
        const beforeUnsigned = structuredClone([...item.data]);
        expect((await item.shopper.fetch(new Request('https://shopper-reflex/ingest', { method: 'POST', body: JSON.stringify(content(a)) }))).status).toBe(401);
        expect([...item.data]).toEqual(beforeUnsigned);
      }
      expect((await f.call('/realtime/action', undefined, content(a), a.tenant, undefined, { country: 'US', regionCode: 'NY' })).status).toBe(401);
      await new RealtimeSegmentEngine(f.env).processActionEvent({ type: 'custom', userId: 'w3702-unsigned', source: 'sdk', timestamp: Date.now(), data: { event: 'content_click', contentType: 'video' }, geo: { country: 'US', regionCode: 'NY' } });
      await f.drain(); expect(frames).toHaveLength(2);
      // The real tenant carries a registered customer category; the default
      // tenant still looks up its demo product and has no population reader.
      const product = (await demoRegistry.catalogServiceFor('brighthour')).getAllProducts()[0]!;
      const c = await newAnonymousSession(f.env, 'coach');
      for (const g of [b, c]) {
        expect((await f.call('/realtime/action', g.capability, { userId: g.subject, sessionId: g.sessionId, type: 'product_view', source: 'sdk', surface: 'brighthour', data: { productId: product.id, ...(g.tenant === 'coach' ? {} : { category: 'customer-regional' }) } }, g.tenant, undefined, { country: 'US', regionCode: 'NY' })).status).toBe(200);
      }
      await f.drain(); expect(frames).toHaveLength(3);
      expect(frames[2]!.name).toBe(regionObjectName('brighthour', 'US-NY')); expect(frames[2]!.frame.touches).toEqual([{ dim: 'category', value: 'customer-regional' }]);
      // Signed default Coach traffic remains a positive, while stored refusal
      // stops further events for a non-default tenant.
      expect((await f.call('/realtime/action', c.capability, content(c), c.tenant, undefined, { country: 'US', regionCode: 'NY' })).status).toBe(200);
      expect((await f.call(`/realtime/session/${a.sessionId}/preferences`, a.capability, { trackingConsent: false, personalizationEnabled: false }, a.tenant)).status).toBe(200);
      expect((await f.call('/realtime/action', a.capability, content(a), a.tenant, undefined, { country: 'US', regionCode: 'NY' })).status).toBe(200);
      await f.drain(); expect(frames).toHaveLength(4); expect(frames[3]!.name).toBe(regionObjectName('coach', 'US-NY'));
      expect([...regions.keys()].sort()).toEqual(['brighthour', 'coach', 'meridian'].map(t => regionObjectName(t, 'US-NY')));
      expect(f.cache.data.get('trend:brighthour:US-NY')).toBe(legacy);
      expect([...f.cache.data.keys()].filter(k => k.startsWith('trend:'))).toEqual(expect.arrayContaining([trendKey('meridian', 'US-NY'), trendKey('brighthour', 'US-NY')]));
    }
    expect(remote).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

describe('W37.03 tenant-owned DO audiences', () => {
  type Grant = Awaited<ReturnType<typeof newAnonymousSession>>;
  const owner = (g: Grant) => ({ tenant: g.tenant, subject: g.subject, sessionId: g.sessionId });
  const itemFor = (f: ReturnType<typeof boundary>, g: Grant) => f.objects.get(shopperObjectName(g.tenant, g.subject))!;
  const restart = (f: ReturnType<typeof boundary>, g: Grant) => {
    const item = itemFor(f, g); item.shopper = new ShopperReflex(item.state, f.env); return item;
  };
  const event = (g: Grant, surface = 'brighthour') => ({ userId: g.subject, sessionId: g.sessionId, type: 'page_view', source: 'sdk', surface, data: {} });
  const direct = (item: ReturnType<typeof itemFor>, path: string, body?: unknown, g?: Grant) => item.shopper.fetch(new Request(`https://shopper-reflex${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(g ? { [SHOPPER_HEADER]: g.capability, 'X-Tenant': g.tenant } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const internal = (item: ReturnType<typeof itemFor>, g: Grant, path: string, body: unknown) => item.shopper.fetch(new Request(`https://shopper-reflex${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': g.tenant, 'X-Reflex-Subject': g.subject }, body: JSON.stringify(body),
  }));
  const socket = (g: Grant) => ({ deserializeAttachment: () => ({ shopperId: g.subject, principal: g }), send: vi.fn(), close: vi.fn() });
  const audience = (views: number, surface?: 'coach' | 'brighthour'): AudienceDef => ({
    key: 'w3703_shared', name: 'Synthetic authored rule', description: 'Same key, divergent tenant rule',
    conditions: { attribute: 'page_views', operator: 'eq', value: views }, evaluation: 'realtime', source: 'manual', status: 'published', createdAt: 1,
    ...(surface ? { surface } : {}),
  });

  it('W35.01 publishes accepted candidates and recovers actual storage across failures and serialized actions', async () => {
    invalidateCache();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const f = boundary('do'), g = await newAnonymousSession(f.env, 'meridian');
    const gate = () => { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; };
    try {
      await getConnectors(f.env, g.tenant).audiences.createAudience(audience(2));
      expect((await f.call('/realtime/action', g.capability, event(g), g.tenant)).status).toBe(200);
      const item = itemFor(f, g), ws = socket(g); item.sockets.push(ws as unknown as WebSocket);
      expect((await direct(item, '/consent', { tracking: true, personalization: true }, g)).status).toBe(200);
      const storage = item.state.storage as unknown as { put(key: string | Record<string, unknown>, value?: unknown): Promise<void> };
      const originalPut = storage.put.bind(storage), put = vi.spyOn(storage, 'put');
      const view = async () => {
        const response = await direct(item, '/identity/export', undefined, g); expect(response.status).toBe(200);
        return await response.json() as { affinity: AffinityRecord; pipeline: PipelineRecord };
      };
      const before = await view(), baseline = structuredClone([...item.data]);
      const restore = async () => {
        put.mockImplementation(originalPut); f.faults.read = false; f.faults.write = false;
        item.data.clear(); for (const [key, value] of structuredClone(baseline)) item.data.set(key, value);
        restart(f, g); ws.send.mockClear(); await view(); put.mockClear();
      };
      // A fallible decision tail must not leak even the aliased visitorId/segments.
      const decisions = vi.spyOn(MockDecisionProvider.prototype, 'decideAll').mockRejectedValueOnce(new Error('synthetic derivation failure'));
      await expect(direct(item, '/ingest', event(g), g)).rejects.toThrow('synthetic derivation failure');
      expect(await view()).toEqual(before); expect(put).not.toHaveBeenCalled(); expect(ws.send).not.toHaveBeenCalled(); decisions.mockRestore();

      const entered = gate(), release = gate(), publishedCounts: unknown[] = [];
      ws.send.mockImplementation(() => { publishedCounts.push((item.data.get('pipeline') as PipelineRecord).attributes.page_views); });
      put.mockImplementationOnce(async (key, value) => { entered.release(); await release.wait; await originalPut(key, value); });
      clock.mockReturnValue(Date.now() + 100);
      const first = direct(item, '/ingest', event(g), g); await entered.wait;
      const second = direct(item, '/ingest', event(g), g);
      let readDone = false;
      const queuedRead = view().then(value => { readDone = true; return value; });
      const health = await (await direct(item, '/health')).json() as { lastSeen: number };
      expect(health.lastSeen).toBe(before.affinity.lastSeen); expect([...item.data]).toEqual(baseline);
      expect(readDone).toBe(false); expect(ws.send).not.toHaveBeenCalled();
      release.release(); expect((await first).status).toBe(200); expect((await second).status).toBe(200);
      expect((await queuedRead).pipeline.attributes.page_views).toBe(3); expect(publishedCounts).toEqual([2, 3]);

      // Application write-then-reject: never guess rollback, retry, or trust warm old bytes.
      for (const path of ['/ingest', '/segments', '/identity/absorb', '/identity/import']) {
        await restore();
        put.mockImplementationOnce(async (key, value) => { await originalPut(key, value); throw new Error('synthetic ambiguous write'); });
        const call = path === '/ingest' ? direct(item, path, event(g), g)
          : path === '/segments' ? direct(item, path, { segment: 'accepted-manual' }, g)
          : internal(item, g, path, path.endsWith('absorb') ? { shopperId: g.subject, affinity: before.affinity, pipeline: before.pipeline }
            : { shopperId: g.subject, rows: [{ action: 'content_click', at: Date.now(), touches: [{ dim: 'contentType', value: 'video' }] }] });
        await expect(call).rejects.toThrow('synthetic ambiguous write'); expect(ws.send).not.toHaveBeenCalled();
        const saved = structuredClone([...item.data]); expect(saved).not.toEqual(baseline);
        f.faults.read = true;
        expect((await direct(item, '/snapshot?projection=content', undefined, g)).status).toBe(401);
        f.faults.read = false;
        const recovered = await view(); expect(recovered.affinity).toEqual(item.data.get('affinity')); expect(recovered.pipeline).toEqual(item.data.get('pipeline'));
        expect([...item.data]).toEqual(saved); expect(put).toHaveBeenCalledTimes(1);
        expect((await direct(item, '/ingest', event(g), g)).status).toBe(200);
        expect((await view()).pipeline.attributes.page_views).toBe(Number(recovered.pipeline.attributes.page_views) + 1);
      }

      await restore();
      put.mockRejectedValueOnce(new Error('synthetic rejected write'));
      await expect(direct(item, '/segments', { segment: 'never-committed' }, g)).rejects.toThrow('synthetic rejected write');
      const malformed = { ...before.pipeline, profileEnrichment: { invalid: true } };
      item.data.set('affinity', { ...before.affinity, lastSeen: Date.now() + 50 }); item.data.set('pipeline', malformed);
      expect((await direct(item, '/snapshot?projection=sort', undefined, g)).status).toBe(401);
      expect((item.shopper as unknown as { affinity: AffinityRecord }).affinity).toEqual(before.affinity);
      item.data.set('affinity', before.affinity); item.data.set('pipeline', before.pipeline);
      expect(await view()).toEqual(before); expect(ws.send).not.toHaveBeenCalled();

      // A crossing alarm also stages its membership and push until accepted.
      await restore();
      for (let n = 0; n < 3; n++) expect((await direct(item, '/ingest', { ...event(g), type: 'custom',
        data: { event: 'content_click', contentType: 'video' } }, g)).status).toBe(200);
      const enteredMembership = await view(); expect(enteredMembership.affinity.reflex.audiences.length).toBeGreaterThan(0);
      clock.mockReturnValue(Math.ceil(item.alarms.at(-1)!) + 5); ws.send.mockClear();
      put.mockRejectedValueOnce(new Error('synthetic alarm write'));
      await expect(item.shopper.alarm()).rejects.toThrow('synthetic alarm write');
      expect(ws.send).not.toHaveBeenCalled(); expect(await view()).toEqual(enteredMembership);
      await item.shopper.alarm();
      expect((await view()).affinity.reflex.audiences).toEqual([]); expect(ws.send).toHaveBeenCalled();

      await restore();
      const alarm = vi.spyOn(item.state.storage, 'setAlarm').mockRejectedValueOnce(new Error('synthetic scheduling failure'));
      await expect(direct(item, '/ingest', event(g), g)).rejects.toThrow('synthetic scheduling failure');
      expect((await view()).pipeline.attributes.page_views).toBe(2); expect(ws.send).toHaveBeenCalledTimes(1);
      expect(item.data.get('audienceOwner')).toEqual(owner(g)); alarm.mockRestore();
      await f.drain();

      // The already-staged buffered writer uses the same ambiguous recovery without an owner write.
      const buffered = await bufferedBoundary('do'), bufferedStorage = buffered.item.state.storage as unknown as typeof storage;
      const bufferedPut = bufferedStorage.put.bind(bufferedStorage);
      vi.spyOn(bufferedStorage, 'put').mockImplementationOnce(async (key, value) => {
        expect(key).not.toHaveProperty('audienceOwner'); await bufferedPut(key, value); throw new Error('synthetic buffered ambiguity');
      });
      expect((await buffered.send()).status).toBe(503); expect(buffered.queued).toEqual([]);
      const recovered = await buffered.item.shopper.fetch(new Request('https://shopper-reflex/identity/export', {
        headers: { [SHOPPER_HEADER]: buffered.g.capability, 'X-Tenant': buffered.g.tenant },
      }));
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({ affinity: buffered.item.data.get('affinity'), pipeline: buffered.item.data.get('pipeline') });
      await buffered.drain();
    } finally { f.faults.read = false; f.faults.write = false; await f.drain(); vi.restoreAllMocks(); }
  });

  it('qualifies signed HTTP/read/WS and real restarted crossing alarms in two physical non-default stores', async () => {
    invalidateCache();
    const f = boundary('do'); f.env.TENANTS = JSON.stringify({ provisioned: ['coach', 'meridian', 'kate-spade'] });
    const remote = vi.fn(async () => { throw new Error('Unexpected external request'); }); vi.stubGlobal('fetch', remote);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const seed = vi.spyOn(KvAudienceStore.prototype, 'seed'), qualified = vi.spyOn(MockSegmentProvider.prototype, 'fetchQualifiedSegments');
    const config = vi.spyOn(demoRegistry, 'resolveReflexConfig'), catalog = vi.spyOn(demoRegistry, 'catalogServiceFor');
    try {
      await getConnectors(f.env).audiences.createAudience(audience(99));
      await getConnectors(f.env, 'meridian').audiences.createAudience(audience(1));
      await getConnectors(f.env, 'kate-spade').audiences.createAudience(audience(2, 'coach'));
      const authored = [...f.cache.data];
      const a = await newAnonymousSession(f.env, 'meridian');
      const b = await issueSessionCapability(f.env, { ...owner(a), tenant: 'kate-spade', kind: 'anonymous' });
      for (const g of [a, b]) {
        config.mockClear(); catalog.mockClear();
        const cold = await f.call(`/realtime/segments/${g.subject}`, g.capability, undefined, g.tenant);
        expect(cold.status).toBe(200); expect(await cold.json()).toMatchObject({ segments: [] });
        expect(itemFor(f, g).data.size).toBe(0);
        expect(config).not.toHaveBeenCalled(); expect(catalog).not.toHaveBeenCalled();
        const put = vi.spyOn(itemFor(f, g).state.storage, 'put');
        expect((await f.call('/realtime/action', g.capability, { ...event(g), audienceOwner: owner(b) }, g.tenant)).status).toBe(200);
        expect(put).toHaveBeenCalledTimes(1); expect(put).toHaveBeenCalledWith(expect.objectContaining({ audienceOwner: owner(g), affinity: expect.any(Object), pipeline: expect.any(Object) }));
        expect(itemFor(f, g).data.get('audienceOwner')).toEqual(owner(g));
        expect((itemFor(f, g).data.get('pipeline') as PipelineRecord).segments).toEqual(g === a ? ['w3703_shared'] : []);
        const ws = socket(g); itemFor(f, g).sockets.push(ws as unknown as WebSocket);
        await itemFor(f, g).shopper.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'action', event: event(g) }));
        expect(ws.close).not.toHaveBeenCalled();
        expect((itemFor(f, g).data.get('pipeline') as PipelineRecord).segments).toEqual(g === a ? [] : ['w3703_shared']);
        const read = await f.call(`/realtime/segments/${g.subject}`, g.capability, undefined, g.tenant);
        expect(await read.json()).toMatchObject({ segments: g === a ? [] : ['w3703_shared'] });
      }
      const aBefore = structuredClone([...itemFor(f, a).data]);
      expect((await direct(itemFor(f, a), '/ingest', event(b), b)).status).toBe(401);
      const crossed = socket(b);
      await itemFor(f, a).shopper.webSocketMessage(crossed as unknown as WebSocket, JSON.stringify({ type: 'action', event: event(b) }));
      expect(crossed.close).toHaveBeenCalledWith(1008, 'Shopper session unavailable'); expect([...itemFor(f, a).data]).toEqual(aBefore);

      for (const g of [a, b]) {
        const peer = g === a ? b : a, peerBefore = structuredClone([...itemFor(f, peer).data]);
        for (let n = 0; n < 3; n++) expect((await f.call('/realtime/action', g.capability, {
          ...event(g, 'coach'), type: 'custom', data: { event: 'content_click', contentType: 'video' },
        }, g.tenant)).status).toBe(200);
        const item = restart(f, g), before = item.data.get('affinity') as AffinityRecord;
        expect(before.reflex.audiences.length).toBeGreaterThan(0);
        const crossing = item.alarms.at(-1)!;
        expect(crossing).toBeGreaterThan(Date.now()); expect(crossing).toBeLessThan(before.lastSeen + 30 * 86400000);
        clock.mockReturnValue(Math.ceil(crossing) + 5); qualified.mockClear();
        const ws = item.sockets[0] as unknown as ReturnType<typeof socket>; ws.send.mockClear();
        await item.shopper.alarm();
        expect(qualified).toHaveBeenCalledTimes(1);
        expect(qualified.mock.calls[0]![1]).not.toHaveProperty('surface');
        expect((item.data.get('affinity') as AffinityRecord).reflex.audiences).toEqual([]);
        expect((item.data.get('pipeline') as PipelineRecord).segments).toEqual(g === a ? [] : ['w3703_shared']);
        expect(ws.send).toHaveBeenCalled();
        expect(JSON.parse(ws.send.mock.calls.at(-1)![0])).toMatchObject({ data: { source: 'reflex_alarm', segments: g === a ? [] : ['w3703_shared'] } });
        expect(item.data.get('audienceOwner')).toEqual(owner(g)); expect([...itemFor(f, peer).data]).toEqual(peerBefore);
      }
      expect([...f.cache.data]).toEqual(authored); expect(f.sessions.data.size).toBe(0);
      expect(seed).not.toHaveBeenCalled(); expect(remote).not.toHaveBeenCalled();
    } finally { await f.drain(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('contains unbound/corrupt/forwarded/refused alarms and preserves consent, signed adoption, reset and retention', async () => {
    invalidateCache();
    const f = boundary('do'), g = await newAnonymousSession(f.env, 'meridian');
    expect((await f.call('/realtime/action', g.capability, event(g), g.tenant)).status).toBe(200);
    const item = itemFor(f, g), baseline = structuredClone([...item.data]);
    const seed = vi.spyOn(KvAudienceStore.prototype, 'seed'), qualified = vi.spyOn(MockSegmentProvider.prototype, 'fetchQualifiedSegments');
    const config = vi.spyOn(demoRegistry, 'resolveReflexConfig');
    try {
      for (const condition of ['missing', 'null', 'invalid', 'foreign', 'subject', 'sid', 'visitor', 'actual-object', 'forward', 'refusal'] as const) {
        item.data.clear(); for (const [k, v] of structuredClone(baseline)) item.data.set(k, v);
        if (condition === 'missing') item.data.delete('audienceOwner');
        else if (condition === 'null') item.data.set('audienceOwner', null);
        else if (condition === 'invalid') item.data.set('audienceOwner', { tenant: 17 });
        else if (condition === 'foreign') item.data.set('audienceOwner', { ...owner(g), tenant: 'coach' });
        else if (condition === 'subject') item.data.set('audienceOwner', { ...owner(g), subject: 'different' });
        else if (condition === 'sid') item.data.set('audienceOwner', { ...owner(g), sessionId: 'different' });
        else if (condition === 'visitor') (item.data.get('pipeline') as PipelineRecord).visitorId = 'different';
        else if (condition === 'forward') item.data.set('forwardTo', 'linked-person');
        else if (condition === 'refusal') item.data.set('consent', { tracking: true, personalization: false });
        restart(f, g);
        if (condition === 'actual-object') item.shopper = new ShopperReflex({ ...item.state, id: 'wrong-object' } as unknown as DurableObjectState, f.env);
        const before = structuredClone([...item.data]);
        qualified.mockClear(); seed.mockClear(); config.mockClear(); item.alarms.length = 0;
        await item.shopper.alarm();
        expect([...item.data], condition).toEqual(before); expect(item.alarms, condition).toHaveLength(1);
        expect(qualified, condition).not.toHaveBeenCalled(); expect(seed, condition).not.toHaveBeenCalled(); expect(config, condition).not.toHaveBeenCalled();
        if (['invalid', 'foreign', 'subject', 'sid'].includes(condition)) {
          expect((await direct(item, '/segments', undefined, g)).status).toBe(401);
          expect((await direct(item, '/consent/refusal', { tracking: false }, g)).status).toBe(200);
          expect(item.data.get('audienceOwner')).toEqual(before.find(([k]) => k === 'audienceOwner')![1]);
        }
      }
      for (const marker of [undefined, null]) {
        item.data.clear(); for (const [k, v] of structuredClone(baseline)) item.data.set(k, v);
        if (marker === undefined) item.data.delete('audienceOwner'); else item.data.set('audienceOwner', marker);
        restart(f, g);
        const before = structuredClone([...item.data]);
        expect((await direct(item, '/segments', undefined, g)).status).toBe(200); expect([...item.data]).toEqual(before);
        const put = vi.spyOn(item.state.storage, 'put'); put.mockClear();
        expect((await direct(item, '/segments', { segment: 'manual-owned', audienceOwner: { tenant: 'coach' } }, g)).status).toBe(200);
        expect(put).toHaveBeenCalledTimes(1); expect(item.data.get('audienceOwner')).toEqual(owner(g));
        expect((item.data.get('pipeline') as PipelineRecord).segments).toContain('manual-owned');
      }
      expect((await direct(item, '/reset', {}, g)).status).toBe(200);
      expect([...item.data.keys()]).toEqual(['grantAuthority']);
      expect((await direct(item, '/segments', { segment: 'after-reset' }, g)).status).toBe(401);
      const retained = await newAnonymousSession(f.env, 'meridian');
      expect((await f.call('/realtime/action', retained.capability, event(retained), retained.tenant)).status).toBe(200);
      const retainedItem = itemFor(f, retained);
      f.env.REFLEX_RETENTION_DAYS = '0.00000001';
      (retainedItem.data.get('affinity') as AffinityRecord).lastSeen = Date.now() - 1000; restart(f, retained);
      await retainedItem.shopper.alarm(); expect([...retainedItem.data.keys()]).toEqual(['grantAuthority']);
      expect((await direct(retainedItem, '/segments', { segment: 'after-retention' }, retained)).status).toBe(401);

      const cold = await newAnonymousSession(f.env, 'meridian');
      expect((await f.call('/realtime/action', cold.capability, { ...event(cold), data: { consent: { tracking: false } } }, cold.tenant)).status).toBe(200);
      const coldItem = itemFor(f, cold);
      expect(coldItem.data.get('consent')).toEqual({ tracking: false, personalization: true });
      expect([...coldItem.data.keys()].sort()).toEqual(['consent', 'grantAuthority']);
      expect((await direct(coldItem, '/segments', { segment: 'refused' }, cold)).status).toBe(403);
      expect(coldItem.data.has('audienceOwner')).toBe(false);
    } finally { await f.drain(); vi.restoreAllMocks(); }
  });

  it('W35.08 fences adopted legacy writers while retaining signed absorb, operator import and absent-authority compatibility', async () => {
    invalidateCache();
    const f = boundary('do'), g = await newAnonymousSession(f.env, 'coach');
    await positiveChoice(f, g);
    expect((await f.call('/realtime/action', g.capability, event(g, 'coach'), g.tenant)).status).toBe(200);
    const item = itemFor(f, g);
    await f.drain();
    const baseline = structuredClone([...item.data]);
    const qualified = vi.spyOn(MockSegmentProvider.prototype, 'fetchQualifiedSegments'), seed = vi.spyOn(KvAudienceStore.prototype, 'seed');
    try {
      const legacyState = baseline.filter(([key]) => !['audienceOwner', 'grantAuthority'].includes(key));
      const restore = (values: Array<[string, unknown]>) => {
        item.data.clear(); for (const [key, value] of structuredClone(values)) item.data.set(key, value); restart(f, g);
      };
      const writers = [
        ['/ingest', event(g, 'coach')], ['/consent', { tracking: false, personalization: false }],
        ['/identity/absorb', { shopperId: g.subject, affinity: null, pipeline: null, now: Date.now() }],
        ['/identity/forward', { to: 'w3508-legacy-target' }],
      ] as const;
      const writeLegacy = (path: string, body: unknown) => path.startsWith('/identity/')
        ? internal(item, g, path, body) : direct(item, path, body);
      const refuses = async (pending: Promise<Response>, readFailure = false) => {
        const status = await pending.then(response => response.status, (error: unknown) => {
          if (readFailure) expect(error).toMatchObject({ message: 'synthetic read failure' });
          else expect(error).toBeInstanceOf(SessionAccessError);
          return 401;
        });
        expect(status).toBe(401);
      };
      // Presence, not schema validity or cached owner/profile markers, is the boundary.
      for (const [path, body] of writers) {
        restore(legacyState);
        const unownedBefore = structuredClone([...item.data]);
        expect((await writeLegacy(path, body)).status).toBe(path === '/consent' ? 401 : 200);
        // W05 requires a current owned explicit choice even before adoption;
        // the other retained legacy writers still exercise their positive lane.
        if (path === '/consent') expect([...item.data]).toEqual(unownedBefore);
        expect(item.data.has('grantAuthority')).toBe(false); await f.drain();
        for (const mode of ['adopted', 'null', 'malformed', 'erased', 'read-failure']) {
          restore(legacyState);
          if (mode === 'erased') expect((await internal(item, g, '/reset', {})).status).toBe(200);
          else if (mode !== 'read-failure') item.data.set('grantAuthority', mode === 'adopted'
            ? new Map(baseline).get('grantAuthority') : mode === 'null' ? null : { grants: [] });
          restart(f, g);
          const before = structuredClone([...item.data]), alarms = [...item.alarms];
          const get = vi.spyOn(item.state.storage, 'get');
          f.effects.length = 0; f.cache.calls.length = 0; f.sessions.calls.length = 0;
          qualified.mockClear(); seed.mockClear(); f.faults.read = mode === 'read-failure';
          await refuses(writeLegacy(path, body), f.faults.read); f.faults.read = false;
          expect(get.mock.calls).toEqual([['grantAuthority']]); get.mockRestore();
          expect([...item.data]).toEqual(before); expect(item.alarms).toEqual(alarms);
          expect(f.effects).toEqual([]); expect(f.cache.calls).toEqual([]); expect(f.sessions.calls).toEqual([]);
          expect(qualified).not.toHaveBeenCalled(); expect(seed).not.toHaveBeenCalled();
        }
        // A writer queued while signed adoption is uncommitted must check after it commits.
        restore(legacyState);
        let entered!: () => void, release!: () => void;
        const entering = new Promise<void>(resolve => { entered = resolve; });
        const waiting = new Promise<void>(resolve => { release = resolve; });
        const store = item.state.storage as unknown as {
          get(key: string | string[]): Promise<unknown>;
          put(key: string | Record<string, unknown>, value?: unknown): Promise<void>;
        };
        const put = store.put.bind(store), get = vi.spyOn(store, 'get');
        const paused = vi.spyOn(store, 'put').mockImplementation(async (...args: Parameters<typeof store.put>) => {
          if (args[0] === 'grantAuthority') { entered(); await waiting; }
          return put(...args);
        });
        const adopted = direct(item, '/identity/activate', { consent: storedConsent(new Map(legacyState).get('consent')) }, g);
        await entering;
        const rejected = refuses(writeLegacy(path, body));
        await new Promise(resolve => setTimeout(resolve, 0));
        const readsBeforeCommit = get.mock.calls.filter(([key]) => key === 'grantAuthority').length;
        f.effects.length = 0; f.cache.calls.length = 0; f.sessions.calls.length = 0;
        release(); expect((await adopted).status).toBe(200); await rejected;
        paused.mockRestore(); get.mockRestore();
        expect(readsBeforeCommit).toBe(1);
        const carried = legacyState.map(([key, value]) => [key, key === 'consent' ? { ...value as ConsentInstruction, operation: undefined } : value]);
        expect([...item.data]).toEqual([...carried, ['grantAuthority', new Map(baseline).get('grantAuthority')]]);
        expect(f.effects).toEqual(['store:grantAuthority', 'store:consent']); expect(f.cache.calls).toEqual([]); expect(f.sessions.calls).toEqual([]);
      }
      // A necessary refusal remains OFF on an empty barrier without inventing
      // an undated choice or refreshing any original explicit deadline.
      expect((await internal(item, g, '/reset', {})).status).toBe(200);
      const barrier = structuredClone(item.data.get('grantAuthority'));
      const refusal = await internal(item, g, '/consent/refusal', { tracking: false, personalization: false });
      expect(refusal.status).toBe(200); expect(await refusal.json()).toEqual({ ok: true, consent: { tracking: false, personalization: false } });
      expect(item.data.get('grantAuthority')).toEqual(barrier);
      expect(storedConsent(item.data.get('consent'))).toEqual({ tracking: false, personalization: false });
      expect([...item.data]).toEqual([['grantAuthority', barrier]]);
      for (const path of ['/identity/import', '/identity/absorb']) for (const fails of [false, true]) {
        item.data.clear(); for (const [k, v] of structuredClone(baseline)) item.data.set(k, v); restart(f, g);
        const body = path.endsWith('import') ? { operationId: crypto.randomUUID(), now: Date.now(), shopperId: g.subject, rows: [{ action: 'content_click', at: Date.now(), touches: [{ dim: 'contentType', value: 'video' }] }], audienceOwner: owner(g) }
          : { shopperId: g.subject, affinity: item.data.get('affinity'), pipeline: { ...(item.data.get('pipeline') as PipelineRecord), audienceOwner: owner(g) }, audienceOwner: owner(g) };
        if (path.endsWith('import')) {
          expect((await internal(item, g, '/identity/import/admission', body)).status).toBe(200);
        }
        const beforeCommit = structuredClone([...item.data]);
        f.faults.write = fails;
        const write = () => path.endsWith('import') ? internal(item, g, path, body) : direct(item, path, body, g);
        if (fails) await expect(write()).rejects.toThrow('synthetic write failure');
        else expect((await write()).status).toBe(200);
        f.faults.write = false;
        if (fails) expect([...item.data]).toEqual(beforeCommit);
        else {
          expect(item.data.get('audienceOwner')).toBeNull();
          if (path.endsWith('import')) expect((item.data.get('affinity') as AffinityRecord).reflex.dims.contentType!.video!.s).toBe(1);
          else expect((item.data.get('pipeline') as PipelineRecord).attributes.page_views).toBe(2);
        }
        qualified.mockClear(); seed.mockClear();
        const before = structuredClone([...item.data]);
        await item.shopper.alarm();
        expect([...item.data]).toEqual(before); expect(qualified).not.toHaveBeenCalled(); expect(seed).not.toHaveBeenCalled();
        expect((await direct(item, '/ingest', event(g, 'coach'))).status).toBe(401);
        restart(f, g);
        expect((await direct(item, '/ingest', event(g, 'coach'))).status).toBe(401);
        expect((await direct(item, '/segments', { segment: 'owned-again' }, g)).status).toBe(200);
        expect(item.data.get('audienceOwner')).toEqual(owner(g));
      }
      // A failed signed event/manual write reloads the actual committed owner.
      for (const path of ['/ingest', '/segments']) {
        item.data.clear(); for (const [k, v] of structuredClone(baseline)) item.data.set(k, v); restart(f, g);
        f.faults.write = true;
        await expect(direct(item, path, path === '/ingest' ? event(g, 'coach') : { segment: 'uncommitted' }, g)).rejects.toThrow('synthetic write failure');
        f.faults.write = false; expect([...item.data]).toEqual(baseline);
        qualified.mockClear(); const before = structuredClone([...item.data]); await item.shopper.alarm();
        expect(qualified).not.toHaveBeenCalled(); expect([...item.data]).toEqual(before);
        expect((await direct(item, '/segments', undefined, g)).status).toBe(200);
        restart(f, g); expect((await direct(item, '/segments', undefined, g)).status).toBe(200);
      }
      // Only genuinely old default records retain the unsigned compatibility door.
      item.data.delete('audienceOwner'); item.data.delete('grantAuthority'); restart(f, g);
      expect((await direct(item, '/ingest', { ...event(g, 'coach'), audienceOwner: owner(g) })).status).toBe(200);
      expect(item.data.has('audienceOwner')).toBe(false);
      qualified.mockClear(); const legacy = structuredClone([...item.data]); await item.shopper.alarm();
      expect([...item.data]).toEqual(legacy); expect(qualified).not.toHaveBeenCalled();
      const other = await newAnonymousSession(f.env, 'meridian');
      expect((await f.call(`/realtime/segments/${other.subject}`, other.capability, undefined, other.tenant)).status).toBe(200);
      const otherBefore = structuredClone([...itemFor(f, other).data]);
      expect([...itemFor(f, other).data.keys()]).toEqual(['grantAuthority']);
      expect((await direct(itemFor(f, other), '/ingest', event(other))).status).toBe(401);
      expect([...itemFor(f, other).data]).toEqual(otherBefore);

      // The forwarding door must not bypass the source object's unsigned gate.
      const target = await newAnonymousSession(f.env, 'coach');
      expect((await f.call(`/realtime/segments/${target.subject}`, target.capability, undefined, target.tenant)).status).toBe(200);
      const targetBefore = structuredClone([...itemFor(f, target).data]);
      expect([...itemFor(f, target).data.keys()]).toEqual(['grantAuthority']);
      expect((await direct(item, '/segments', { segment: 'bind-source' }, g)).status).toBe(200);
      for (const [source, grant] of [[item, g], [itemFor(f, other), other]] as const) {
        const body = { to: shopperObjectName(target.tenant, target.subject) };
        expect((await direct(source, '/identity/forward', body, grant)).status).toBe(200);
        const before = structuredClone([...source.data]); f.effects.length = 0; f.cache.calls.length = 0;
        expect((await direct(source, '/ingest', event(target, 'coach'))).status).toBe(401);
        expect(f.effects).toEqual([]); expect(f.cache.calls).toEqual([]);
        expect([...source.data]).toEqual(before); expect([...itemFor(f, target).data]).toEqual(targetBefore);
      }
      item.data.delete('audienceOwner'); item.data.delete('grantAuthority'); restart(f, g);
      const forwardedLegacy = structuredClone([...item.data]); f.effects.length = 0;
      expect((await direct(item, '/ingest', event(g, 'coach'))).status).toBe(401);
      expect([...item.data]).toEqual(forwardedLegacy); expect(f.effects).toEqual([]);
    } finally { f.faults.read = false; f.faults.write = false; await f.drain(); vi.restoreAllMocks(); }
  });

  it('retains signed default Coach and BrightHour demo generation and separate surface qualification', async () => {
    invalidateCache();
    const f = boundary('do');
    await getConnectors(f.env).audiences.createAudience({ ...audience(1), key: 'w3703_coach', surface: 'coach' });
    await getConnectors(f.env).audiences.createAudience({ ...audience(1), key: 'w3703_brighthour', surface: 'brighthour' });
    const seed = vi.spyOn(KvAudienceStore.prototype, 'seed');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      for (const surface of ['coach', 'brighthour'] as const) {
        const g = await newAnonymousSession(f.env, 'coach');
        expect((await f.call('/realtime/action', g.capability, event(g, surface), g.tenant)).status).toBe(200);
        const item = restart(f, g);
        expect(item.data.get('audienceOwner')).toEqual(owner(g));
        expect((item.data.get('pipeline') as PipelineRecord).segments.filter(k => k.startsWith('w3703_'))).toEqual([`w3703_${surface}`]);
        const read = await direct(item, '/segments', undefined, g); expect(read.status).toBe(200);
        expect((await read.json() as { segments: string[] }).segments.filter(k => k.startsWith('w3703_'))).toEqual([`w3703_${surface}`]);
        const before = structuredClone([...item.data]);
        expect((await direct(item, '/ingest', event(g, surface))).status).toBe(401); expect([...item.data]).toEqual(before);
        const product = (await demoRegistry.catalogServiceFor(surface)).getAllProducts()[0]!;
        for (let n = 0; n < 4; n++) expect((await direct(item, '/ingest', { ...event(g, surface), type: 'product_view', data: { productId: product.id } }, g)).status).toBe(200);
        const memberships = [...(item.data.get('affinity') as AffinityRecord).reflex.audiences];
        expect(memberships.length).toBeGreaterThan(0);
        restart(f, g);
        const ws = socket(g); item.sockets.push(ws as unknown as WebSocket);
        const crossing = item.alarms.at(-1)!; expect(crossing).toBeGreaterThan(Date.now());
        clock.mockReturnValue(crossing + 5);
        const qualified = vi.spyOn(MockSegmentProvider.prototype, 'fetchQualifiedSegments'); qualified.mockClear();
        await item.shopper.alarm();
        expect(qualified).toHaveBeenCalledTimes(1); expect(qualified.mock.calls[0]![1]).toHaveProperty('surface', surface);
        expect(memberships.some(k => !(item.data.get('affinity') as AffinityRecord).reflex.audiences.includes(k))).toBe(true);
        expect((item.data.get('pipeline') as PipelineRecord).segments.filter(k => k.startsWith('w3703_'))).toEqual([`w3703_${surface}`]);
        expect(ws.send).toHaveBeenCalled(); expect(JSON.parse(ws.send.mock.calls.at(-1)![0])).toMatchObject({ data: { source: 'reflex_alarm' } });
      }
      expect(seed).toHaveBeenCalled();
      expect([...f.cache.data.keys()].some(k => k === 'reflex:audgen:v1')).toBe(true);
      expect([...f.cache.data.keys()].some(k => k.includes('audgen') && k.includes('brighthour'))).toBe(true);
      expect([...f.cache.data.keys()].some(k => k.startsWith('t:'))).toBe(false);
    } finally { await f.drain(); vi.restoreAllMocks(); }
  });
});

describe('W37.01 tenant-owned local audiences', () => {
  const audience = (views: number): AudienceDef => ({
    key: 'w3701_shared_key', name: `Owned audience at ${views} views`, description: 'Synthetic tenant-owned rule',
    conditions: { attribute: 'page_views', operator: 'eq', value: views },
    evaluation: 'realtime', source: 'manual', status: 'draft', createdAt: 1,
  });

  it('publishes through the authenticated operator router and qualifies two non-default tenants in their own physical stores despite demo hints', async () => {
    const f = boundary();
    f.env.TENANTS = JSON.stringify({ provisioned: ['coach', 'meridian', 'kate-spade'] });
    f.env.AUTH_MODE = 'enforced'; f.env.REFLEX_ENABLED = 'false';
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', tenantMiddleware()); app.use('/operator/*', operatorWrites()); app.route('/operator', operatorRoutes);
    const token = await new SignJWT({ sub: 'w3701-synthetic-operator', type: 'service', roles: ['operator'], permissions: ['write'] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a').setExpirationTime('5m')
      .sign(new TextEncoder().encode(f.env.JWT_SECRET));
    const operator = (tenant: string, path: string, body?: unknown, bearer?: string) => app.request(`https://synthetic.invalid/operator/${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'X-Tenant': tenant, 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, f.env);
    const remote = vi.fn(async () => { throw new Error('Unexpected external request'); }); vi.stubGlobal('fetch', remote);
    const seed = vi.spyOn(KvAudienceStore.prototype, 'seed');
    try {
      for (const bearer of [undefined, 'invalid']) {
        expect((await operator('meridian', 'audiences/publish', { audience: audience(1) }, bearer)).status).toBe(401);
      }
      expect((await operator('meridian', 'audiences/publish', { audience: audience(1) }, token)).status).toBe(403);
      expect(f.cache.calls).toEqual([]); expect(f.sessions.calls).toEqual([]);
      f.env.TENANTS = JSON.stringify({ provisioned: ['coach', 'meridian', 'kate-spade'],
        operatorGrants: { 'w3701-synthetic-operator': ['meridian', 'kate-spade'] } });
      // Same key and same shopper/session IDs make an accidental default or peer
      // store visible; the default audience also must not be overwritten.
      await getConnectors(f.env).audiences.createAudience(audience(99));
      const defaultAudience = f.cache.data.get('audience:w3701_shared_key');
      const a = await newAnonymousSession(f.env, 'meridian');
      const b = await issueSessionCapability(f.env, { tenant: 'kate-spade', subject: a.subject, sessionId: a.sessionId, kind: 'anonymous' });
      f.sessions.data.set(`session:${a.sessionId}`, 'default-session-sentinel');
      f.sessions.data.set(`user:${a.subject}`, 'default-pointer-sentinel');
      const defaultSessions = [...f.sessions.data];
      for (const [tenant, views] of [['meridian', 1], ['kate-spade', 2]] as const) {
        const published = await operator(tenant, 'audiences/publish', { audience: audience(views) }, token);
        expect(published.status).toBe(200); expect(await published.json()).toMatchObject({ success: true, audience: { key: 'w3701_shared_key', status: 'published' } });
        const listed = await operator(tenant, 'audiences', undefined, token);
        expect(listed.status).toBe(200);
        expect(await listed.json()).toMatchObject({ count: 1, audiences: [{ name: audience(views).name, conditions: audience(views).conditions }] });
        expect(JSON.parse(f.cache.data.get(tenantKey(tenant, 'audience:w3701_shared_key'))!)).toMatchObject({ conditions: audience(views).conditions, status: 'published' });
      }
      const authored = [...f.cache.data];
      const suggestion = await operator('meridian', 'audiences/suggest', { nlPrompt: 'cart abandoned' }, token);
      expect(suggestion.status).toBe(200); expect([...f.cache.data]).toEqual(authored);
      // This proves local authored rules only. Generic catalog/reflex/ODP and
      // operator membership/broadcast discovery remain outside this contract.
      for (const [grant, peer, views, qualifies] of [[a, b, 1, true], [b, a, 1, false], [b, a, 2, true], [a, b, 2, false]] as const) {
        const peerKey = tenantKey(peer.tenant, `session:${peer.sessionId}`), peerBefore = f.sessions.data.get(peerKey);
        const action = await f.call('/realtime/action', grant.capability, { userId: grant.subject, sessionId: grant.sessionId,
          type: 'page_view', source: 'sdk', surface: 'brighthour', data: {} }, grant.tenant);
        expect(action.status).toBe(200); await f.drain();
        const expected = qualifies ? ['w3701_shared_key'] : [];
        expect(await action.json()).toMatchObject({ success: true, update: { data: { segments: expected } } });
        const read = await f.call(`/realtime/segments/${grant.subject}`, grant.capability, undefined, grant.tenant);
        expect(read.status).toBe(200); expect(await read.json()).toMatchObject({ segments: expected });
        const stored = JSON.parse(f.sessions.data.get(tenantKey(grant.tenant, `session:${grant.sessionId}`))!);
        expect(stored).toMatchObject({ userId: grant.subject, attributes: { page_views: views }, segments: expected, surface: 'brighthour' });
        expect(f.sessions.data.get(peerKey)).toBe(peerBefore);
        for (const [key, value] of defaultSessions) expect(f.sessions.data.get(key)).toBe(value);
      }
      expect([...f.cache.data]).toEqual(authored); expect(f.cache.data.get('audience:w3701_shared_key')).toBe(defaultAudience);
      expect([...f.cache.data.keys()].filter(key => key.includes('audience:')).sort()).toEqual([
        'audience:w3701_shared_key', 't:kate-spade:audience:w3701_shared_key', 't:meridian:audience:w3701_shared_key',
      ]);
      expect([...f.cache.data.keys()].some(key => key.includes('audgen'))).toBe(false);
      expect(seed).not.toHaveBeenCalled(); expect(remote).not.toHaveBeenCalled();
    } finally { await f.drain(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('uses tenant-scoped default constructors and returns from non-default seeding before any environment or catalog access', async () => {
    const f = boundary();
    const remote = vi.fn(async () => { throw new Error('Unexpected external request'); }); vi.stubGlobal('fetch', remote);
    try {
      await getConnectors(f.env).audiences.createAudience(audience(99));
      await getConnectors(f.env, 'meridian').audiences.createAudience(audience(0));
      await getConnectors(f.env, 'kate-spade').audiences.createAudience(audience(1));
      const ctx = { userId: 'synthetic', attributes: { page_views: 0 }, segments: [] };
      expect(await getConnectors(f.env).segments.fetchQualifiedSegments('synthetic', ctx)).toEqual([]);
      expect(await getConnectors(f.env, 'meridian').segments.fetchQualifiedSegments('synthetic', ctx)).toEqual(['w3701_shared_key']);
      expect(await getConnectors(f.env, 'kate-spade').segments.fetchQualifiedSegments('synthetic', ctx)).toEqual([]);
      const a = await newAnonymousSession(f.env, 'meridian'), b = await newAnonymousSession(f.env, 'kate-spade');
      for (const grant of [a, b]) {
        await new SessionManager(f.env, { tenant: grant.tenant, principal: grant }).createOrUpdateSession(grant.sessionId, grant.subject, { surface: 'brighthour', attributes: { page_views: 0 } });
      }
      const resolveCatalog = vi.spyOn(demoRegistry, 'catalogServiceFor');
      const resolveConfig = vi.spyOn(demoRegistry, 'resolveReflexConfig');
      const products = vi.spyOn(CatalogService.prototype, 'getAllProducts');
      const seed = vi.spyOn(KvAudienceStore.prototype, 'seed');
      const before = [...f.cache.data];
      expect(await new RealtimeSegmentEngine(f.env, undefined, { tenant: a.tenant, principal: a }).getUserSegments(a.subject)).toEqual(['w3701_shared_key']);
      expect(await new RealtimeSegmentEngine(f.env, undefined, { tenant: b.tenant, principal: b }).getUserSegments(b.subject)).toEqual([]);
      const access = vi.fn((_: object, key: PropertyKey): never => { throw new Error(`Unexpected seed access: ${String(key)}`); });
      for (const tenant of ['meridian', 'kate-spade']) for (const surface of ['coach', 'brighthour'] as const) {
        await ensureAudiencesSeeded(new Proxy({}, { get: access }) as Env, new Proxy({}, { get: access }) as CatalogService, surface, tenant);
      }
      expect(access).not.toHaveBeenCalled(); expect(resolveCatalog).not.toHaveBeenCalled(); expect(resolveConfig).not.toHaveBeenCalled();
      expect(products).not.toHaveBeenCalled(); expect(seed).not.toHaveBeenCalled(); expect(remote).not.toHaveBeenCalled();
      expect([...f.cache.data]).toEqual(before);
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });
});

describe('W05.08 owned preferences and reads', () => {
  const prefs = (tracking: boolean, personalization: boolean) => ({ trackingConsent: tracking, personalizationEnabled: personalization });
  const preferencePath = (g: any) => `/realtime/session/${g.sessionId}/preferences`;
  const reads = (g: any) => [`/realtime/personalization/${g.subject}`, `/realtime/segments/${g.subject}`, '/realtime/reflex'];
  const record = (f: ReturnType<typeof boundary>, g: any, host: string): any => host === 'session'
    ? JSON.parse(f.sessions.data.get(tenantKey('meridian', `session:${g.sessionId}`)) ?? 'null')
    : Object.fromEntries(structuredClone([...f.objects.get(shopperObjectName('meridian', g.subject))?.data ?? []]));
  const behavior = (f: ReturnType<typeof boundary>, g: any, host: string) => {
    const r = record(f, g, host); if (r) { delete r.preferences; delete r.consent; } return r;
  };
  const warm = async (f: ReturnType<typeof boundary>, g: any) => {
    await positiveChoice(f, g);
    expect((await f.call('/realtime/action', g.capability, { userId: g.subject, sessionId: g.sessionId, type: 'product_view', source: 'sdk', data: { productId: 'COA-CH857', line: 'Tabby' } })).status).toBe(200); await f.drain();
  };
  function observe(f: ReturnType<typeof boundary>) {
    // Spies retain the actual local seed, qualification, decision and enhanced-variable implementations.
    const calls = [vi.spyOn(KvAudienceStore.prototype, 'seed'), vi.spyOn(MockSegmentProvider.prototype, 'fetchQualifiedSegments'),
      vi.spyOn(LiveDecisionProvider.prototype, 'decideAll'), vi.spyOn(FeatureVariableManager.prototype, 'getSessionFeatureVariables')];
    const remote = vi.fn(async () => { throw new Error('Unexpected external request'); }); vi.stubGlobal('fetch', remote);
    return { calls, clear() { calls.forEach(v => v.mockClear()); remote.mockClear(); f.cache.calls.length = 0; f.sessions.calls.length = 0; f.effects.length = 0; },
      quiet() { calls.forEach(v => expect(v).not.toHaveBeenCalled()); expect(remote).not.toHaveBeenCalled(); expect(f.cache.calls.filter(v => v.startsWith('put:'))).toEqual([]); } };
  }
  function neutral(path: string, body: any) {
    if (path.includes('/personalization/')) expect(body.config).toEqual({ segments: [], featureFlags: {}, featureVariables: {}, experiments: {} });
    else if (path.includes('/segments/')) expect(body.segments).toEqual([]);
    else expect(body).toMatchObject({ ok: true, affinity: null, journeyStage: null });
  }

  it('keeps preference writes necessary-only and gates populated reads/assignment under every switch combination, with real consenting positives', async () => {
    for (const host of ['session', 'do']) {
      try {
        const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian');
        await new KvAudienceStore(f.env, 'meridian').publish({
          key: 'W0508_TENANT_AUTHORED', name: 'Owned consenting shopper', description: 'Synthetic tenant-owned rule',
          conditions: { attribute: 'product_views', operator: 'gte', value: 1 }, evaluation: 'realtime', source: 'manual', status: 'published', createdAt: 1,
        });
        await warm(f, g); const io = observe(f);
        for (const tracking of [false, true]) for (const personalization of [false, true]) {
          const before = behavior(f, g, host), pointer = f.sessions.data.get(tenantKey('meridian', `user:${g.subject}`)); io.clear();
          const changed = await f.call(preferencePath(g), g.capability, prefs(tracking, personalization));
          expect(changed.status).toBe(200); expect(await changed.json()).toMatchObject({ preferences: prefs(tracking, personalization), cookiesUpdated: true });
          expect(changed.headers.get('set-cookie')).toContain(`opt_tracking_consent=${tracking}`);
          expect(changed.headers.get('set-cookie')).toContain(`opt_personalization_enabled=${personalization}`);
          expect(changed.headers.get('set-cookie')).not.toMatch(/opt_(session_id|user_id|segments|engagement_score|last_update|anonymous_id)=/);
          expect(behavior(f, g, host)).toEqual(before); expect(f.sessions.data.get(tenantKey('meridian', `user:${g.subject}`))).toBe(pointer); io.quiet();
          expect(f.sessions.calls.filter(v => v.startsWith('put:'))).toEqual([]);
          expect(f.effects.filter(v => v.startsWith('store:'))).toEqual(['store:consent']);
          io.clear(); const snapshot = record(f, g, host);
          for (const path of reads(g)) {
            const r = await f.call(path, g.capability, undefined, 'meridian', 'opt_tracking_consent=true; opt_personalization_enabled=true');
            expect(r.status).toBe(200); const body = await r.json() as any;
            if (!tracking || !personalization) { neutral(path, body); expect(r.headers.get('set-cookie')).toBeNull(); }
            else if (path.includes('/personalization/')) expect(Object.keys(body.config.featureFlags).length).toBeGreaterThan(0);
            else if (path.includes('/segments/')) {
              expect(body.segments.length).toBeGreaterThan(0);
              expect(body.segments).toContain('W0508_TENANT_AUTHORED');
            }
            else expect(body.affinity.dims.line.Tabby).toBeGreaterThan(0);
          }
          expect(record(f, g, host)).toEqual(snapshot);
          expect(f.sessions.calls.filter(v => v.startsWith('put:'))).toEqual([]); expect(f.effects.filter(v => v.startsWith('store:'))).toEqual([]);
          if (!tracking || !personalization) io.quiet();
          else { expect(io.calls[1]).toHaveBeenCalled(); expect(io.calls[2]).toHaveBeenCalled(); if (host === 'session') { expect(io.calls[0]).not.toHaveBeenCalled(); expect(io.calls[3]).toHaveBeenCalled(); } }
          io.clear();
          const analytics = await f.call(`/realtime/session/${g.sessionId}/analytics`, g.capability);
          expect(analytics.status).toBe(200); expect(await analytics.json()).toMatchObject({ sessionId: g.sessionId, analytics: { segmentHistory: expect.any(Array) } }); io.quiet();
          const assigned = await f.call(`/realtime/segments/${g.subject}`, g.capability, { segment: 'W0508_OWNED' });
          expect(assigned.status).toBe(tracking && personalization ? 200 : 403);
          if (!tracking || !personalization) { io.quiet(); expect(record(f, g, host)).toEqual(snapshot); }
          else { const r = await f.call(reads(g)[0], g.capability); expect((await r.json() as any).config.segments).toContain('W0508_OWNED'); }
        }
        await f.call(preferencePath(g), g.capability, prefs(false, false)); io.clear();
        if (host === 'do') {
          const item = f.objects.get(shopperObjectName('meridian', g.subject))!;
          const internal = await item.shopper.fetch(new Request('https://shopper-reflex/snapshot', {
            headers: { 'X-Reflex-Tenant': g.tenant, 'X-Reflex-Subject': g.subject },
          }));
          expect(internal.status).toBe(200);
          expect(await internal.json()).toMatchObject({ affinity: null, journeyStage: null });
          expect((item.data.get('affinity') as AffinityRecord).reflex.dims.line.Tabby.s).toBeGreaterThan(0);
          Object.defineProperty((item.shopper as any).affinity, 'reflex', { get() { throw new Error('private projection forbidden'); } });
          const owned = await f.call('/realtime/reflex', g.capability); expect(owned.status).toBe(200); neutral('/realtime/reflex', await owned.json()); io.quiet();
        }
      } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
    }
  });

  it('persists only cold refusal instructions, merges omitted-cookie switches and permits deliberate enable without stale mirrors', async () => {
    for (const host of ['session', 'do']) {
      try {
        const f = boundary(host); await fixturePublication(f.env, 'meridian'); const io = observe(f);
        const absent = await newAnonymousSession(f.env, 'meridian');
        expect((await f.call(preferencePath(absent), absent.capability, prefs(true, true))).status).toBe(200);
        expect(f.sessions.data.size).toBe(0);
        expect([...f.objects.get(shopperObjectName('meridian', absent.subject))!.data.keys()].sort()).toEqual(['consent', 'grantAuthority']); io.quiet();
        for (const pathKind of ['preferences', 'personalization', 'segments', 'reflex', 'assignment']) for (const switchName of ['tracking', 'personalization']) {
          const g = await newAnonymousSession(f.env, 'meridian'); io.clear();
          const cookie = `${switchName === 'tracking' ? 'opt_tracking_consent' : 'opt_personalization_enabled'}=false`;
          const path = pathKind === 'preferences' ? preferencePath(g) : pathKind === 'reflex' ? '/realtime/reflex' : `/realtime/${pathKind === 'assignment' ? 'segments' : pathKind}/${g.subject}`;
          const result = await f.call(path, g.capability, pathKind === 'preferences' ? {} : pathKind === 'assignment' ? { segment: 'FORBIDDEN' } : undefined, 'meridian', cookie);
          expect(result.status).toBe(pathKind === 'assignment' ? 403 : pathKind === 'preferences' ? 400 : 200);
          if (!['preferences', 'assignment'].includes(pathKind)) neutral(path, await result.json());
          io.quiet(); const stored = record(f, g, host);
          expect(f.sessions.data.has(tenantKey('meridian', `session:${g.sessionId}`))).toBe(false);
          expect(f.sessions.data.has(tenantKey('meridian', `user:${g.subject}`))).toBe(false);
          expect([...f.objects.get(shopperObjectName('meridian', g.subject))!.data.keys()]).toEqual(['grantAuthority']);
          const before = behavior(f, g, host); io.clear();
          for (const read of reads(g)) { const r = await f.call(read, g.capability); expect(r.status).toBe(200); neutral(read, await r.json()); }
          expect(record(f, g, host)).toEqual(stored); io.quiet();
          const enabled = await f.call(preferencePath(g), g.capability, prefs(true, true), 'meridian', 'opt_tracking_consent=false; opt_personalization_enabled=false');
          expect(enabled.status).toBe(200); expect(await enabled.json()).toMatchObject({ preferences: prefs(true, true) }); expect(behavior(f, g, host)).toEqual(before); io.quiet();
        }
        const g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); io.clear();
        const partial = await f.call(preferencePath(g), g.capability, { trackingConsent: true }, 'meridian', 'opt_tracking_consent=false; opt_personalization_enabled=false');
        expect(await partial.json()).toMatchObject({ preferences: prefs(true, false) }); io.quiet();
        // No choice is not consent: cold reads cannot seed/evaluate/create a profile.
        const cold = await newAnonymousSession(f.env, 'meridian'); io.clear();
        const positive = await f.call(reads(cold)[0], cold.capability); expect(positive.status).toBe(200);
        expect((await positive.json() as any).config.featureFlags).toEqual({}); io.quiet();
        expect(f.sessions.data.has(tenantKey('meridian', `session:${cold.sessionId}`))).toBe(false);
      } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
    }
  });

  it('fails strict owned reads and preference writes before effects or acknowledgment', async () => {
    for (const host of ['session', 'do']) for (const failure of ['read', 'malformed', 'write', 'recognized-missing', 'forward']) {
      try {
        const f = boundary(host); let g = await newAnonymousSession(f.env, 'meridian');
        if (failure === 'recognized-missing') g = await issueSessionCapability(f.env, { tenant: 'meridian', subject: `sh_${crypto.randomUUID().replaceAll('-', '')}`, sessionId: g.sessionId, kind: 'recognized' });
        else await warm(f, g);
        const io = observe(f);
        if (failure === 'read') { f.sessions.failRead = true; f.faults.read = true; if (host === 'do') (f.objects.get(shopperObjectName('meridian', g.subject))!.shopper as any).loaded = false; }
        if (failure === 'write') { f.sessions.failWrite = true; f.faults.write = true; }
        if (failure === 'malformed' || failure === 'forward') {
          if (host === 'session') {
            const key = tenantKey('meridian', `session:${g.sessionId}`), stored = JSON.parse(f.sessions.data.get(key)!);
            f.sessions.data.set(key, JSON.stringify(failure === 'malformed' ? null : { ...stored, forwardTo: 'unowned' }));
          } else {
            const item = f.objects.get(shopperObjectName('meridian', g.subject))!;
            if (failure === 'malformed') { item.data.set('consent', null); (item.shopper as any).consent = undefined; }
            else { item.data.set('forwardTo', 'unowned'); (item.shopper as any).forwardTo = undefined; }
          }
          corruptOwner(f, g, failure);
        }
        for (const path of [...reads(g), preferencePath(g)]) {
          io.clear(); const body = path === preferencePath(g) ? prefs(false, false) : undefined;
          const r = await f.call(path, g.capability, body, 'meridian', 'opt_tracking_consent=false');
          expect(r.status).toBeGreaterThanOrEqual(400); expect(r.headers.get('set-cookie')).toBeNull(); io.quiet();
        }
        io.clear(); const denied = await f.call(`/realtime/segments/${g.subject}`, g.capability, { segment: 'FORBIDDEN' }, 'meridian', 'opt_tracking_consent=false');
        expect(denied.status).toBeGreaterThanOrEqual(400); io.quiet();
      } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
    }
    // A still-owned grant may expire while permitted configuration work awaits.
    for (const host of ['session', 'do']) {
      try {
        const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); const io = observe(f);
        const resolve = demoRegistry.resolveTenantReflexConfig;
        vi.spyOn(demoRegistry, 'resolveTenantReflexConfig').mockImplementationOnce(async (...args) => {
          const cfg = await resolve(...args); vi.spyOn(Date, 'now').mockReturnValue((g.exp + 1) * 1000); return cfg;
        });
        io.clear(); const expired = await f.call(reads(g)[0], g.capability);
        expect(expired.status).toBeGreaterThanOrEqual(400); expect(expired.headers.get('set-cookie')).toBeNull();
        expect(io.calls[2]).not.toHaveBeenCalled(); expect(io.calls[3]).not.toHaveBeenCalled();
      } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
    }
  });
});

describe('W05.07 owned Optimizely ingress', () => {
  const prefs = (tracking: boolean, personalization: boolean) => ({ trackingConsent: tracking, personalizationEnabled: personalization });
  const metric = (g: any, consent?: unknown) => ({ userId: g.subject, eventKey: 'synthetic-purchase', userAttributes: { plan: 'synthetic' }, eventTags: { value: 7 }, ...(consent === undefined ? {} : { consent }) });
  const decision = (g: any, consent?: unknown) => ({ userId: g.subject, experiments: ['experiment', '__proto__', 'constructor'], features: ['feature', '__proto__', 'constructor'], ...(consent === undefined ? {} : { consent }) });
  const warm = async (f: ReturnType<typeof boundary>, g: any) => {
    await positiveChoice(f, g);
    expect((await f.call('/realtime/action', g.capability, { userId: g.subject, sessionId: g.sessionId, type: 'page_view', source: 'sdk', data: {} })).status).toBe(200); await f.drain();
  };
  function service(f: ReturnType<typeof boundary>) {
    // Actual OptimizelyService initialize/cache/fetch dispatcher. SDK creation
    // alone is synthetic: this proves route/service delivery, not FX bucketing.
    f.env.OPTIMIZELY_SDK_KEY = 'w0507-synthetic';
    f.env.OPTIMIZELY_DATAFILE_URL = 'https://synthetic.invalid/datafile';
    const sent: any[] = [], calls: any[] = [];
    const datafile = { revision: 'synthetic', audiences: [], experiments: [{ key: 'cached-experiment' }], featureFlags: [{ key: 'cached-feature' }] };
    const remote = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === f.env.OPTIMIZELY_DATAFILE_URL) return Response.json(datafile);
      if (url !== 'https://synthetic.invalid/fx-event') throw new Error('Unexpected external request');
      sent.push(JSON.parse(String(init?.body))); return new Response('', { status: 202 });
    });
    vi.stubGlobal('fetch', remote);
    const creation = vi.spyOn(optimizelySdk, 'createInstance').mockImplementation((options: any) => {
      const dispatch = (type: string, key: string, subject: string, attributes: unknown, tags?: unknown) => {
        calls.push({ type, key, subject, attributes, tags });
        options.eventDispatcher.dispatchEvent({ url: 'https://synthetic.invalid/fx-event', params: { type, key, subject, attributes, ...(tags ? { tags } : {}) } });
      };
      return { onReady: async () => undefined,
        track: (key: string, subject: string, attributes: unknown, tags: unknown) => dispatch('metric', key, subject, attributes, tags),
        getVariation: () => 'synthetic-variation',
        isFeatureEnabled: (key: string, subject: string, attributes: unknown) => { dispatch('impression', key, subject, attributes); return true; },
        getAllFeatureVariables: () => ({ label: 'synthetic' }),
      } as never;
    });
    const initialize = vi.spyOn(OptimizelyService.prototype, 'initialize');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    return { sent, calls, creation, initialize, remote, clear() { sent.length = 0; calls.length = 0; creation.mockClear(); initialize.mockClear(); remote.mockClear(); f.cache.calls.length = 0; f.sessions.calls.length = 0; f.effects.length = 0; } };
  }
  const noFx = (io: ReturnType<typeof service>, f: ReturnType<typeof boundary>) => {
    expect(io.initialize).not.toHaveBeenCalled(); expect(io.creation).not.toHaveBeenCalled(); expect(io.calls).toEqual([]); expect(io.sent).toEqual([]); expect(io.remote).not.toHaveBeenCalled(); expect(f.cache.calls).toEqual([]);
  };
  const neutral = (body: any, tracking: boolean, personalization: boolean) => {
    expect(body).toMatchObject({ status: 'default', personalized: false, reason: tracking ? 'personalization_refused' : 'tracking_refused', consent: { tracking, personalization }, segments: [] });
    for (const key of ['experiment', '__proto__', 'constructor']) { expect(Object.hasOwn(body.experiments, key)).toBe(true); expect(body.experiments[key]).toBeNull(); }
    for (const key of ['feature', '__proto__', 'constructor']) { expect(Object.hasOwn(body.features, key)).toBe(true); expect(body.features[key]).toEqual({ enabled: false, variables: {} }); }
  };

  it('honors all switches before actual service/cache/dispatcher work, preserving tracking-only delivery and safe own-key defaults', async () => {
    for (const host of ['session', 'do']) {
      try {
        const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); const io = service(f);
        for (const tracking of [false, true]) for (const personalization of [false, true]) {
          expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(tracking, personalization))).status).toBe(200);
          // The preference setup may initialize FX on its permitted path. Make
          // this measured route's cache genuinely cold, not dependent on setup.
          f.cache.data.delete('optimizely-datafile-w0507-synthetic');
          io.clear();
          const r = await f.call('/optimizely/track', g.capability, metric(g, { tracking: true, personalization: true }), 'meridian', 'opt_tracking_consent=true; opt_personalization_enabled=true');
          expect(r.status).toBe(200);
          if (!tracking) { expect(await r.json()).toMatchObject({ success: true, status: 'skipped', tracked: false, reason: 'tracking_refused', consent: { tracking, personalization } }); noFx(io, f); }
          else {
            expect(await r.json()).toMatchObject({ success: true, userId: g.subject, eventKey: 'synthetic-purchase' });
            expect(io.creation).toHaveBeenCalledOnce(); expect(io.sent).toEqual([{ type: 'metric', key: 'synthetic-purchase', subject: g.subject, attributes: { plan: 'synthetic' }, tags: { value: 7 } }]);
            expect(f.cache.calls).toContain('get:optimizely-datafile-w0507-synthetic');
            expect(io.remote.mock.calls.map(v => v[0])).toEqual(['https://synthetic.invalid/datafile', 'https://synthetic.invalid/fx-event']); expect(f.cache.calls).toContain('put:optimizely-datafile-w0507-synthetic');
          }
          io.clear();
          const d = await f.call('/optimizely/decisions', g.capability, decision(g, { tracking: true, personalization: true }));
          expect(d.status).toBe(200); const body = await d.json() as any;
          if (!tracking || !personalization) {
            neutral(body, tracking, personalization); noFx(io, f);
            const empty = await f.call('/optimizely/decisions', g.capability, { userId: g.subject });
            expect(await empty.json()).toMatchObject({ status: 'default', experiments: {}, features: {}, segments: [] }); noFx(io, f);
          } else {
            expect(body).not.toHaveProperty('status'); expect(body.features.feature.enabled).toBe(true);
            expect(Object.hasOwn(body.features, '__proto__')).toBe(true); expect(body.experiments.__proto__).toBe('synthetic-variation');
            expect(body.segments).toEqual(['experiment_cached-experiment_synthetic-variation', 'feature_cached-feature_enabled']);
            expect(io.creation).toHaveBeenCalledOnce(); expect(io.sent).toHaveLength(4); expect(io.sent.every(v => v.type === 'impression' && v.subject === g.subject)).toBe(true);
            expect(io.remote.mock.calls.every(v => v[0] === 'https://synthetic.invalid/fx-event')).toBe(true); expect(f.cache.calls).toEqual(['get:optimizely-datafile-w0507-synthetic']);
          }
        }
      } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
    }
  });

  it('persists body/cookie refusal, permits deliberate preferences, and preserves necessary-only anonymous absence', async () => {
    for (const host of ['session', 'do']) {
      try {
        const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'), io = service(f);
        expect((await f.call('/optimizely/track', g.capability, metric(g))).status).toBe(200); expect(io.sent).toEqual([]);
        expectColdOff(f, g);
        io.clear(); const cold = await f.call('/optimizely/decisions', g.capability, decision(g, { tracking: false }));
        neutral(await cold.json(), false, false); noFx(io, f); expectColdOff(f, g);
        for (const mode of ['body', 'cookie']) for (const tracking of [false, true]) {
          expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(true, true))).status).toBe(200); io.clear();
          const hint = tracking ? { personalization: false } : { tracking: false };
          const cookie = mode === 'cookie' ? `${tracking ? 'opt_personalization_enabled' : 'opt_tracking_consent'}=false` : undefined;
          const r = await f.call('/optimizely/decisions', g.capability, decision(g, mode === 'body' ? hint : undefined), 'meridian', cookie);
          neutral(await r.json(), tracking, !tracking); noFx(io, f);
          const repeated = await f.call('/optimizely/decisions', g.capability, decision(g, { tracking: true, personalization: true }));
          neutral(await repeated.json(), tracking, !tracking); noFx(io, f);
        }
        expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(true, true))).status).toBe(200); io.clear();
        expect((await f.call('/optimizely/decisions', g.capability, decision(g))).status).toBe(200); expect(io.sent.length).toBeGreaterThan(0);
      } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
    }
  });

  it('denies capability/subject/schema and strict owned-state failures before Optimizely effects', async () => {
    for (const host of ['session', 'do']) {
      try {
        const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'), io = service(f);
        await positiveChoice(f, g);
        const expired = await issueSessionCapability(f.env, { tenant: 'meridian', subject: g.subject, sessionId: g.sessionId, kind: 'anonymous' }, Math.floor(Date.now() / 1000) - 10, 1);
        for (const path of ['/optimizely/track', '/optimizely/decisions']) {
          for (const [token, subject, tenant] of [[undefined, g.subject, 'meridian'], ['invalid', g.subject, 'meridian'], [expired.capability, g.subject, 'meridian'], [g.capability, 'victim', 'meridian'], [g.capability, g.subject, 'coach'], [g.capability, g.subject, 'unprovisioned']]) {
            io.clear(); const r = await f.call(path, token, { ...metric(g), userId: subject }, tenant);
            expect(r.status).toBe(tenant === 'unprovisioned' ? 403 : 401);
            expect(await r.json()).toMatchObject({ error: tenant === 'unprovisioned' ? 'Tenant unavailable' : 'Shopper session unavailable' });
            noFx(io, f); expect(f.sessions.calls).toEqual([]); expect(f.effects).toEqual([]);
          }
          for (const consent of [null, false, [], { tracking: 'false' }, { personalization: 1 }]) {
            io.clear(); const before = structuredClone(f.objects.get(shopperObjectName(g.tenant, g.subject))!.data);
            expect((await f.call(path, g.capability, metric(g, consent))).status).toBe(500); noFx(io, f);
            expect(f.sessions.calls).toEqual([]); expect(f.effects.filter(v => !v.startsWith('object:'))).toEqual([]);
            expect(f.objects.get(shopperObjectName(g.tenant, g.subject))!.data).toEqual(before);
          }
        }
      } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
      for (const failure of ['read', 'write', 'owner', 'forward', 'recognized-missing', null, false, 0]) {
        try {
          const f = boundary(host); let g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); const io = service(f), item = f.objects.get(shopperObjectName('meridian', g.subject));
          if (failure === 'read') { f.sessions.failRead = true; f.faults.read = true; if (item) (item.shopper as any).consent = undefined; }
          else if (failure === 'write') { f.sessions.failWrite = true; f.faults.write = true; }
          else if (failure === 'recognized-missing') g = await issueSessionCapability(f.env, { tenant: 'meridian', subject: `sh_${'a'.repeat(32)}`, sessionId: 's-missing', kind: 'recognized' });
          else if (host === 'session') { const key = tenantKey('meridian', `session:${g.sessionId}`), previous = JSON.parse(f.sessions.data.get(key)!); f.sessions.data.set(key, JSON.stringify(failure === 'owner' ? { ...previous, userId: 'victim' } : failure === 'forward' ? { ...previous, forwardTo: 's-other' } : failure)); }
          else if (failure === 'owner') (item!.shopper as any).affinity.shopperId = 'victim';
          else if (failure === 'forward') (item!.shopper as any).forwardTo = 'other-object';
          else { item!.data.set('consent', failure); (item!.shopper as any).consent = undefined; }
          if (!['read', 'write', 'recognized-missing'].includes(failure as string)) corruptOwner(f, g, failure);
          for (const path of ['/optimizely/track', '/optimizely/decisions']) {
            io.clear(); const r = await f.call(path, g.capability, metric(g, { tracking: false })); expect(r.status).toBe(401); expect(await r.json()).toMatchObject({ ok: false, error: 'Shopper session unavailable' }); noFx(io, f); expect(f.effects).not.toContain('store:behavior');
          }
        } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
      }
    }
  });
});

describe('W05.06 SDK collection and transport', () => {
  it('honors actual two-host consent, preserves defaults, and resumes only acknowledged tracking-only measurement with blocked cookies', async () => {
    for (const selected of ['session', 'do']) {
      const f = boundary(selected), requests: Array<{ path: string; body: any }> = [], reads: string[] = [];
      // This consent control uses the real snapshot path and its current catalog authority.
      const catalog = new Map<string, { text: string; etag: string }>(); let serial = 0;
      f.env.STORAGE = {
        get: async (key: string) => {
          const value = catalog.get(key);
          return value ? { key, etag: value.etag, size: new TextEncoder().encode(value.text).length,
            body: new Response(value.text).body, text: async () => value.text, json: async () => JSON.parse(value.text) as unknown } : null;
        },
        put: async (key: string, text: string, options?: R2PutOptions) => {
          const condition = options?.onlyIf;
          if (condition instanceof Headers ? catalog.has(key) : condition && condition.etagMatches !== catalog.get(key)?.etag) return null;
          const etag = 'w2602-consent-' + (++serial); catalog.set(key, { text, etag }); return { key, etag, size: new TextEncoder().encode(text).length };
        },
      } as unknown as R2Bucket;
      await initializePublication(f.env, CONTENT_KIND, 'meridian', { revision: 1, at: 1, actor: 'fixture', note: '', value: { pieces: [] } }, '0:' + crypto.randomUUID());
      let failPreferences = false;
      const host = memoryHost({
        acquireAuthorityLock: authorityLocks(), cookie: { get: () => null, set: () => {} },
        location: { protocol: 'https:', host: 'owned.invalid', hostname: 'owned.invalid', get href() { reads.push('href'); return 'https://owned.invalid/'; }, get search() { reads.push('search'); return '?utm_source=synthetic'; } },
        fetch: async (url, init) => {
          const u = new URL(url), body = init?.body === undefined ? undefined : JSON.parse(init.body);
          requests.push({ path: u.pathname, body });
          if (failPreferences && u.pathname.endsWith('/preferences')) return { ok: false, status: 503, json: async () => ({ success: false }) };
          const r = await f.call(u.pathname + u.search, init?.headers?.[SHOPPER_HEADER], body, init?.headers?.['X-Tenant']);
          return { ok: r.ok, status: r.status, json: () => r.json() };
        },
      });
      Object.defineProperty(host, 'referrer', { get() { reads.push('referrer'); return 'https://synthetic.invalid/'; } });
      const core = createCore({ tenant: 'meridian' }, host), listen = createListen(core), emit = createEmit(core, listen);
      expect(reads).toEqual([]); await core.ready();
      // Warm the existing session-host preference record, as in the accepted boundary fixture.
      await emit.pageView(); await f.drain();
      const path = `/realtime/session/${core.profileSessionId}/preferences`;
      for (const tracking of [false, true]) for (const personalization of [false, true]) {
        expect((await core.postJson(path, { trackingConsent: tracking, personalizationEnabled: personalization })).ok).toBe(true);
        reads.length = 0; requests.length = 0;
        const before = host.storage.get('opt_session');
        await emit.purchase({ get orderId() { reads.push('payload'); return 'w0506-synthetic-order'; }, value: 1 }); await f.drain();
        expect(requests.filter(r => r.path === '/realtime/action')).toHaveLength(tracking ? 1 : 0);
        if (!tracking) { expect(reads).toEqual([]); expect(host.storage.get('opt_session')).toBe(before); }
        expect(core.consent).toEqual({ tracking, personalization });
      }
      failPreferences = true;
      expect((await core.postJson(path, { personalizationEnabled: false })).ok).toBe(false);
      requests.length = 0; reads.length = 0;
      await emit.productView('synthetic-product', { get category() { reads.push('payload'); return 'synthetic'; } });
      expect(requests).toEqual([]); expect(reads).toEqual([]);
      failPreferences = false;
      expect(await listen.hydrate({ page: 'home' })).not.toBeNull();
      expect(core.consent).toEqual({ tracking: true, personalization: false });
      expect(listen.current()?.arm).toBe('default');
      requests.length = 0; await emit.purchase({ orderId: 'after-ack', value: 1 }); await f.drain();
      expect(requests.filter(r => r.path === '/realtime/action')).toHaveLength(1);
      expect((await core.postJson(path, { trackingConsent: false })).ok).toBe(true);
      requests.length = 0; const before = host.storage.get('opt_session');
      expect(await listen.hydrate({ page: 'home', channel: 'private' })).not.toBeNull();
      expect(listen.current()?.arm).toBe('default'); expect(host.storage.get('opt_session')).toBe(before);
      expect(requests.filter(r => r.path === '/realtime/action')).toEqual([]);
    }
  });
});

describe('W05.05 owned generic tracking', () => {
  const event = (g: any, id = '00000000-0000-4000-8000-000000000001') => ({ eventId: id, eventType: 'track', event: 'synthetic-purchase', source: 'synthetic', timestamp: 1,
    user: { userId: g.subject, anonymousId: g.subject, email: 'synthetic@example.invalid', traits: { clientAsserted: true } },
  });
  const prefs = (tracking: boolean, personalization: boolean) => ({ trackingConsent: tracking, personalizationEnabled: personalization });
  const warm = async (f: ReturnType<typeof boundary>, g: any) => {
    await positiveChoice(f, g);
    expect((await f.call('/realtime/action', g.capability, { userId: g.subject, sessionId: g.sessionId, type: 'page_view', source: 'sdk', data: {} })).status).toBe(200); await f.drain();
  };
  const state = (f: ReturnType<typeof boundary>, g: any, host: string) => host === 'session'
    ? f.sessions.data.get(tenantKey('meridian', `session:${g.sessionId}`)) : structuredClone([...f.objects.get(shopperObjectName('meridian', g.subject))!.data]);
  function configured(f: ReturnType<typeof boundary>) {
    const sent: any[] = [], queued: any[] = [];
    f.env.WEBHOOK_ENDPOINTS = JSON.stringify([{ name: 'synthetic-retry', type: 'custom', url: 'https://synthetic.invalid/tracking', enabled: true, retryConfig: { maxRetries: 1, backoffMs: 1 } }]);
    f.env.EVENT_QUEUE = { send: async (v: unknown) => { queued.push(v); } } as never;
    Object.defineProperty(f.env, 'ANALYTICS', { get() { throw new Error('AE must remain withdrawn'); } });
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response('', { status: 200 }); }));
    return { sent, queued, clear() { sent.length = 0; queued.length = 0; f.effects.length = 0; f.sessions.calls.length = 0; } };
  }

  it('gates all four stored switch combinations before context collection, with actual HTTP acknowledgement and one consent read per batch', async () => {
    const page = vi.spyOn(requestContext, 'getPageContext');
    try {
      for (const host of ['session', 'do']) {
        const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); const io = configured(f);
        for (const tracking of [false, true]) for (const personalization of [false, true]) {
          expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(tracking, personalization))).status).toBe(200);
          const before = state(f, g, host); io.clear(); page.mockClear();
          const hints = { tracking: true, personalization: true };
          const single = await f.call('/track/event', g.capability, { ...event(g), consent: hints }); expect(single.status).toBe(200);
          const batch = await f.call('/track/batch', g.capability, { events: [{ ...event(g), consent: hints }, event(g, '00000000-0000-4000-8000-000000000002')], context: { sessionId: g.sessionId }, consent: hints }, 'meridian', 'opt_tracking_consent=true; opt_personalization_enabled=true');
          expect(batch.status).toBe(200); await f.drain();
          if (!tracking) {
            expect(await single.json()).toMatchObject({ success: true, status: 'skipped', dispatched: false, reason: 'tracking_refused', consent: { tracking, personalization } });
            expect(await batch.json()).toMatchObject({ processed: 0, skipped: 2, dispatched: false, results: [{ status: 'skipped' }, { status: 'skipped' }] });
          } else {
            expect(await single.json()).toMatchObject({ success: true, eventId: event(g).eventId }); expect(await batch.json()).toMatchObject({ processed: 2, results: [{ status: 'success' }, { status: 'success' }] });
          }
          expect(page).toHaveBeenCalledTimes(tracking ? 3 : 0); expect(io.sent).toHaveLength(tracking ? 3 : 0); expect(io.queued).toEqual([]);
          for (const payload of io.sent) { expect(payload.user.anonymousId).toBe(g.subject); expect(payload.user.userId).toBe(g.subject); expect(payload).not.toHaveProperty('consent'); expect(payload.user.traits).toEqual({ clientAsserted: true }); }
          expect(state(f, g, host)).toEqual(before); expect(f.sessions.calls.filter(v => v.startsWith('put:'))).toEqual([]); expect(f.effects.filter(v => v.startsWith('store:'))).toEqual([]);
          expect(f.effects.filter(v => v.startsWith('object:'))).toHaveLength(2);
        }
      }
    } finally { page.mockRestore(); vi.unstubAllGlobals(); }
  });

  it('prevalidates all identities, SID and strict hints before any batch member, while persisting restrictive hints before acknowledgement', async () => {
    const page = vi.spyOn(requestContext, 'getPageContext');
    try {
      for (const host of ['session', 'do']) {
        const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); const io = configured(f);
        for (const mode of ['single', 'batch', 'last-event', 'cookie', 'personalization']) {
          await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(true, true)); io.clear(); page.mockClear();
          const hints = mode === 'personalization' ? { personalization: false } : { tracking: false };
          const body = mode === 'single' ? { ...event(g), consent: hints } : { events: [event(g), { ...event(g), ...(mode === 'last-event' || mode === 'personalization' ? { consent: hints } : {}) }], ...(mode === 'batch' ? { consent: hints } : {}) };
          const response = await f.call(mode === 'single' ? '/track/event' : '/track/batch', g.capability, body, 'meridian', mode === 'cookie' ? 'opt_tracking_consent=false' : undefined);
          expect(response.status).toBe(200); await f.drain();
          if (mode !== 'personalization') { expect(await response.json()).toMatchObject({ dispatched: false, reason: 'tracking_refused' }); expect(io.sent).toEqual([]); expect(io.queued).toEqual([]); expect(page).not.toHaveBeenCalled(); }
          else expect(io.sent).toHaveLength(2);
          io.clear(); const repeated = await f.call('/track/event', g.capability, event(g)); expect(repeated.status).toBe(200);
          if (mode !== 'personalization') { expect(await repeated.json()).toHaveProperty('dispatched', false); expect(io.sent).toEqual([]); }
          else {
            const instruction = f.objects.get(shopperObjectName('meridian', g.subject))!.data.get('consent');
            expect(storedConsent(instruction)).toMatchObject({ tracking: true, personalization: false });
          }
        }
        await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(true, true)); io.clear();
        expect((await f.call('/track/event', g.capability, event(g))).status).toBe(200); expect(io.sent).toHaveLength(1);
        const invalid = [
          { ...event(g), user: { ...event(g).user, userId: 'victim' } }, { ...event(g), user: { ...event(g).user, anonymousId: '' } },
          { ...event(g), recipientId: 'victim' }, { ...event(g), recipientId: '' }, { ...event(g), context: { sessionId: 'victim' } },
          { ...event(g), eventId: 'not-a-uuid' }, ...[null, false, [], { tracking: 'false' }].map(consent => ({ ...event(g), consent })),
        ];
        for (const last of invalid) {
          io.clear(); page.mockClear(); const response = await f.call('/track/batch', g.capability, { events: [event(g), last] });
          expect(response.status).toBeGreaterThanOrEqual(400); expect(io.sent).toEqual([]); expect(io.queued).toEqual([]); expect(page).not.toHaveBeenCalled(); expect(f.sessions.calls).toEqual([]); expect(f.effects.filter(v => !v.startsWith('object:'))).toEqual([]);
        }
        for (const body of [{ events: [event(g)], context: { sessionId: '' } }, { events: [event(g)], consent: { personalization: 'true' } }]) {
          io.clear(); expect((await f.call('/track/batch', g.capability, body)).status).toBeGreaterThanOrEqual(400); expect(io.sent).toEqual([]); expect(f.effects.filter(v => !v.startsWith('object:'))).toEqual([]); expect(f.sessions.calls).toEqual([]);
        }
        for (const capability of [undefined, 'invalid', (await issueSessionCapability(f.env, { tenant: 'meridian', subject: g.subject, sessionId: g.sessionId, kind: 'anonymous' }, Math.floor(Date.now() / 1000) - 10, 1)).capability]) {
          io.clear(); expect((await f.call('/track/event', capability, event(g))).status).toBe(401); expect(io.sent).toEqual([]); expect(f.effects).toEqual([]); expect(f.sessions.calls).toEqual([]);
        }
      }
    } finally { page.mockRestore(); vi.unstubAllGlobals(); }
  });

  it('keeps cold state necessary-only and denies owned-state/envelope/read/refusal-write failures before configured dispatch', async () => {
    try {
      for (const host of ['session', 'do']) {
        const cold = boundary(host), grant = await newAnonymousSession(cold.env, 'meridian'), io = configured(cold); io.clear();
        expect((await cold.call('/track/event', grant.capability, event(grant))).status).toBe(200); expect(io.sent).toEqual([]);
        expectColdOff(cold, grant);
        io.clear(); const refusal = await cold.call('/track/event', grant.capability, { ...event(grant), consent: { tracking: false } }); expect(refusal.status).toBe(200); expect(await refusal.json()).toHaveProperty('dispatched', false);
        expect(io.sent).toEqual([]); expect(io.queued).toEqual([]);
        expectColdOff(cold, grant); expect(cold.sessions.calls.filter(v => v.startsWith('put:'))).toEqual([]);
        for (const failure of ['read', 'write', 'owner', 'forward', 'recognized-missing', null, false, 0]) {
          const f = boundary(host); let g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); const egress = configured(f), item = f.objects.get(shopperObjectName('meridian', g.subject));
          if (failure === 'read') { f.sessions.failRead = true; f.faults.read = true; if (item) (item.shopper as any).consent = undefined; }
          else if (failure === 'write') { f.sessions.failWrite = true; f.faults.write = true; }
          else if (failure === 'recognized-missing') g = await issueSessionCapability(f.env, { tenant: 'meridian', subject: `sh_${'a'.repeat(32)}`, sessionId: 's-missing', kind: 'recognized' });
          else if (host === 'session') { const key = tenantKey('meridian', `session:${g.sessionId}`), previous = JSON.parse(f.sessions.data.get(key)!); f.sessions.data.set(key, JSON.stringify(failure === 'owner' ? { ...previous, userId: 'victim' } : failure === 'forward' ? { ...previous, forwardTo: 's-other' } : failure)); }
          else if (failure === 'owner') (item!.shopper as any).affinity.shopperId = 'victim';
          else if (failure === 'forward') (item!.shopper as any).forwardTo = 'other-object';
          else { item!.data.set('consent', failure); (item!.shopper as any).consent = undefined; }
          if (!['read', 'write', 'recognized-missing'].includes(failure as string)) corruptOwner(f, g, failure);
          egress.clear(); const response = await f.call('/track/event', g.capability, { ...event(g), consent: { tracking: false } });
          expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ ok: false, error: 'Shopper session unavailable' }); expect(egress.sent).toEqual([]); expect(egress.queued).toEqual([]); expect(f.effects).not.toContain('store:behavior');
        }
      }
      for (const reply of [null, {}, { ok: true }, { ok: false }, { ok: true, consent: {} }, { ok: true, consent: { tracking: 'false', personalization: true } }, { ok: true, consent: { tracking: true, personalization: true } }, 'http-error']) {
        const f = boundary('do'), g = await newAnonymousSession(f.env, 'meridian'), io = configured(f);
        expect((await f.call('/realtime/action', g.capability, { type: 'page_view', source: 'sdk', userId: g.subject, sessionId: g.sessionId, data: {} })).status).toBe(200);
        const item = f.objects.get(shopperObjectName(g.tenant, g.subject))!, fetch = item.shopper.fetch.bind(item.shopper), before = structuredClone(item.data);
        // Fault only the consent response. The current owner dispatch and route
        // must still execute rather than returning a replacement stub verbatim.
        vi.spyOn(item.shopper, 'fetch').mockImplementation(request => new URL(request.url).pathname === '/consent/refusal'
          ? Promise.resolve(Response.json(reply, { status: reply === 'http-error' ? 503 : 200 })) : fetch(request));
        const response = await f.call('/track/event', g.capability, { ...event(g), consent: { tracking: false } }); expect(response.status).toBe(401); expect(io.sent).toEqual([]); expect(io.queued).toEqual([]);
        expect(item.data).toEqual(before);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('preserves occurrence time for delayed, repeated and out-of-order events through synchronous HTTP dispatch', async () => {
    const receivedAt = Date.now(), clock = vi.spyOn(Date, 'now');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const host of ['session', 'do']) {
        clock.mockReturnValue(receivedAt);
        const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); const io = configured(f);
        const original = { ...event(g), timestamp: 946_684_800_000 }, receipts = [receivedAt, receivedAt + 60_000];
        const before = state(f, g, host); io.clear();
        for (const receipt of receipts) {
          clock.mockReturnValue(receipt);
          const response = await f.call('/track/event', g.capability, original);
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ success: true, eventId: original.eventId, timestamp: original.timestamp });
        }
        const batch = [
          { ...event(g, '00000000-0000-4000-8000-000000000002'), timestamp: 1_262_304_000_000 },
          { ...event(g, '00000000-0000-4000-8000-000000000003'), timestamp: 0 },
          original,
          { ...event(g, '00000000-0000-4000-8000-000000000004'), timestamp: 8_640_000_000_000_000 },
        ];
        const batchReceipt = receivedAt + 120_000;
        clock.mockReturnValue(batchReceipt);
        const response = await f.call('/track/batch', g.capability, { events: batch, context: { sessionId: g.sessionId } });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, processed: batch.length,
          results: batch.map(value => ({ eventId: value.eventId, status: 'success' })) });
        const accepted = [original, original, ...batch];
        expect(io.sent).toMatchObject(accepted.map((value, i) => ({ ...value, source: i < 2 ? 'api' : 'batch' })));
        accepted.forEach((value, i) => expect(io.sent[i].timestamp).toBe(value.timestamp));
        expect(io.queued).toEqual([]);
        expect(state(f, g, host)).toEqual(before);
        expect(f.sessions.calls.filter(value => value.startsWith('put:'))).toEqual([]);
        expect(f.effects.filter(value => value.startsWith('store:'))).toEqual([]);
      }
    } finally { clock.mockRestore(); errors.mockRestore(); vi.unstubAllGlobals(); }
  });

  it('refuses invalid occurrence times before owned state, consent hints, context or dispatch for single and whole batches', async () => {
    const page = vi.spyOn(requestContext, 'getPageContext');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const host of ['session', 'do']) {
        const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); const io = configured(f);
        const before = state(f, g, host), valid = { ...event(g), consent: { tracking: false } };
        io.clear(); page.mockClear(); f.cache.calls.length = 0;
        const refused = (response: Response) => {
          expect(response.status).toBe(400); expect(page).not.toHaveBeenCalled();
          expect(io.sent).toEqual([]); expect(io.queued).toEqual([]);
          expect(f.sessions.calls).toEqual([]); expect(f.effects.filter(v => !v.startsWith('object:'))).toEqual([]); expect(f.cache.calls).toEqual([]);
          expect(state(f, g, host)).toEqual(before);
        };
        for (const timestamp of [undefined, null, '1', -1, 0.5, Number.MAX_SAFE_INTEGER + 1, 8_640_000_000_000_001]) {
          const invalid = { ...valid, timestamp };
          refused(await f.call('/track/event', g.capability, invalid));
          refused(await f.call('/track/batch', g.capability, { events: [valid, invalid] }));
        }
        // JSON.stringify(Infinity) is null; raw overflow tokens exercise parsed nonfinite numbers.
        for (const token of ['1e400', '-1e400']) {
          const invalid = JSON.stringify({ ...valid, timestamp: 'overflow' }).replace('"timestamp":"overflow"', `"timestamp":${token}`);
          expect(JSON.parse(invalid).timestamp).toBe(token === '1e400' ? Infinity : -Infinity);
          const app = new Hono<{ Bindings: Env }>(); app.use('*', tenantMiddleware()); app.route('/track', trackingRoutes);
          for (const path of ['/event', '/batch']) refused(await app.request('/track' + path, {
            method: 'POST', headers: { 'X-Tenant': g.tenant, [SHOPPER_HEADER]: g.capability, 'Content-Type': 'application/json' },
            body: path === '/event' ? invalid : `{"events":[${JSON.stringify(valid)},${invalid}]}`,
          }, f.env));
        }
      }
    } finally { page.mockRestore(); errors.mockRestore(); vi.unstubAllGlobals(); }
  });

  it('W22.06 returns safe single-event acknowledgement receipts without accessing a queue on either host', async () => {
    const secret = 'W2206_PRIVATE_DESTINATION';
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const destination = { name: secret, type: 'custom', url: 'https://synthetic.invalid/' + secret, enabled: true,
      headers: { Authorization: secret }, retryConfig: { maxRetries: 1, backoffMs: 1 } };
    try {
      for (const host of ['session', 'do']) {
        const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); const io = configured(f);
        let queueReads = 0;
        Object.defineProperty(f.env, 'EVENT_QUEUE', { get() { queueReads++; throw new Error(secret); } });
        const original = { ...event(g), timestamp: 946_684_800_000 };
        for (const variant of ['acknowledged', 'partial', 'unconfirmed', 'network']) {
          f.env.WEBHOOK_ENDPOINTS = JSON.stringify([destination, { ...destination, name: 'second', url: 'https://synthetic.invalid/second' }]);
          const sent: unknown[] = [];
          const remote = vi.fn(async (_url: unknown, init?: RequestInit) => {
            sent.push(JSON.parse(String(init?.body)));
            if (variant === 'network') throw new Error(secret);
            return new Response(secret, { status: variant === 'acknowledged' || (variant === 'partial' && sent.length === 1) ? 200 : 503, statusText: secret });
          });
          vi.stubGlobal('fetch', remote);
          const response = await f.call('/track/event', g.capability, original), text = await response.text();
          expect(response.status).toBe(variant === 'acknowledged' ? 200 : 502);
          expect(JSON.parse(text)).toEqual(variant === 'acknowledged'
            ? { success: true, eventId: original.eventId, timestamp: original.timestamp }
            : { success: false, eventId: original.eventId, timestamp: original.timestamp, error: 'Event delivery not confirmed',
              delivery: { status: variant === 'partial' ? 'partial' : 'unconfirmed', attempted: 2, acknowledged: variant === 'partial' ? 1 : 0 } });
          expect(text).not.toContain(secret); expect(response.headers.has('Retry-After')).toBe(false);
          expect(sent).toMatchObject([{ ...original, source: 'api' }, { ...original, source: 'api' }]); expect(remote).toHaveBeenCalledTimes(2);
        }
        const invalid = [undefined, '', '[]', JSON.stringify([{ ...destination, enabled: false }]), '{' + secret,
          'null', '{}', '[null]', JSON.stringify([destination, null]), JSON.stringify([destination, { ...destination, name: '' }]),
          ...[{ url: '' }, { enabled: 'true' }, { type: 'unknown' }, { type: ['custom'] }, { headers: [] }, { headers: null },
            { headers: { Authorization: 1 } }, { transform: secret }].map(value => JSON.stringify([destination, { ...destination, ...value }]))];
        for (const config of invalid) {
          f.env.WEBHOOK_ENDPOINTS = config;
          const remote = vi.fn(async () => { throw new Error(secret); }); vi.stubGlobal('fetch', remote);
          const response = await f.call('/track/event', g.capability, original);
          expect(response.status).toBe(503); expect(await response.json()).toEqual({ success: false, eventId: original.eventId,
            timestamp: original.timestamp, error: 'Event delivery not confirmed', delivery: { status: 'unconfigured', attempted: 0, acknowledged: 0 } });
          expect(remote).not.toHaveBeenCalled();
        }
        expect(queueReads).toBe(0); expect(io.queued).toEqual([]);
      }
      expect(JSON.stringify(errors.mock.calls)).not.toContain(secret);
    } finally { errors.mockRestore(); vi.unstubAllGlobals(); }
  });

  it('W22.06 preserves batch order and later attempts with truthful mixed, failed, empty and unconfigured responses', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const host of ['session', 'do']) {
        const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); const io = configured(f);
        let queueReads = 0;
        Object.defineProperty(f.env, 'EVENT_QUEUE', { get() { queueReads++; throw new Error('W2206_PRIVATE_QUEUE'); } });
        const events = [event(g), event(g, '00000000-0000-4000-8000-000000000002'), event(g, '00000000-0000-4000-8000-000000000003')];
        for (const variant of ['mixed', 'failed', 'acknowledged', 'unconfigured', 'empty']) {
          f.env.WEBHOOK_ENDPOINTS = variant === 'unconfigured' || variant === 'empty' ? undefined
            : JSON.stringify([{ name: 'synthetic', type: 'custom', url: 'https://synthetic.invalid/tracking', enabled: true }]);
          const sent: unknown[] = [];
          const remote = vi.fn(async (_url: unknown, init?: RequestInit) => {
            sent.push(JSON.parse(String(init?.body)));
            return new Response('', { status: variant === 'failed' || (variant === 'mixed' && sent.length === 2) ? 503 : 200 });
          });
          vi.stubGlobal('fetch', remote);
          const members = variant === 'empty' ? [] : events;
          const response = await f.call('/track/batch', g.capability, { events: members });
          expect(response.status).toBe(variant === 'unconfigured' ? 503 : variant === 'mixed' || variant === 'failed' ? 502 : 200);
          expect(await response.json()).toEqual({ success: variant === 'acknowledged' || variant === 'empty', processed: members.length,
            results: members.map((value, index) => variant === 'acknowledged' || (variant === 'mixed' && index !== 1)
              ? { eventId: value.eventId, status: 'success' }
              : { eventId: value.eventId, status: 'error', error: 'Event delivery not confirmed',
                delivery: { status: variant === 'unconfigured' ? 'unconfigured' : 'unconfirmed', attempted: variant === 'unconfigured' ? 0 : 1, acknowledged: 0 } }) });
          expect(sent).toMatchObject(variant === 'unconfigured' || variant === 'empty' ? [] : events.map(value => ({ ...value, source: 'batch' })));
          expect(remote).toHaveBeenCalledTimes(variant === 'unconfigured' || variant === 'empty' ? 0 : 3);
        }
        expect(queueReads).toBe(0); expect(io.queued).toEqual([]);
      }
    } finally { errors.mockRestore(); vi.unstubAllGlobals(); }
  });
});

describe('W05.04 owned content decisions', () => {
  const prefs = (tracking: boolean, personalization: boolean) => ({ trackingConsent: tracking, personalizationEnabled: personalization });
  const snapshot = (f: ReturnType<typeof boundary>, g: any, query = '', cookie?: string) => f.call(
    `/v1/meridian/decisions/snapshot?page=home&visitorId=${g.subject}&sessionId=${g.sessionId}&channel=email${query}`,
    g.capability, undefined, 'meridian', cookie, { country: 'US', regionCode: 'NY' });
  const warm = async (f: ReturnType<typeof boundary>, g: any) => {
    await positiveChoice(f, g);
    expect((await f.call('/realtime/action', g.capability, { userId: g.subject, sessionId: g.sessionId, type: 'add_to_cart', source: 'sdk', data: { productId: 'COA-CH857', line: 'Tabby' } })).status).toBe(200);
    await f.drain();
  };
  const state = (f: ReturnType<typeof boundary>, g: any, host: string) => host === 'session'
    ? f.sessions.data.get(tenantKey('meridian', `session:${g.sessionId}`)) : structuredClone([...f.objects.get(shopperObjectName('meridian', g.subject))!.data]);
  async function configured(f: ReturnType<typeof boundary>) {
    invalidateCache(); invalidateLiftCache();
    const documents = new Map<string, { text: string; etag: string }>(); let serial = 0;
    f.env.STORAGE = {
      get: async (key: string) => { const value = documents.get(key); return value ? { key, etag: value.etag,
        size: new TextEncoder().encode(value.text).length, body: new Response(value.text).body, text: async () => value.text,
        json: async () => JSON.parse(value.text) as unknown } : null; },
      put: async (key: string, text: string, options?: R2PutOptions) => {
        const condition = options?.onlyIf;
        if (condition instanceof Headers ? documents.has(key) : condition && condition.etagMatches !== documents.get(key)?.etag) return null;
        const etag = 'w0510-catalog-' + (++serial); documents.set(key, { text, etag }); return { key, etag, size: new TextEncoder().encode(text).length };
      },
    } as unknown as R2Bucket;
    const pieces = ['Rogue', 'Tabby'].map((line, i) => ({ id: i ? 'b' : 'a', customerContentId: `cms-${i ? 'b' : 'a'}`, type: 'editorial', title: line, tags: { line: [line] }, slotTypes: ['hero'], lifecycle: { status: 'live' as const } }));
    const revision = <T>(value: T) => ({ revision: 1, at: 1, actor: 'synthetic', note: '', value });
    await fixturePublication(f.env, 'meridian', [{ kind: CONTENT_KIND, scope: 'meridian', revision: revision({ pieces }) },
      { kind: SLOTS_KIND, scope: 'meridian', revision: revision({ pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1 } }] } }) },
      { kind: LEARN_KIND, scope: 'meridian', revision: revision({ holdout: { share: 0, salt: 'synthetic', arms: ['default'] } }) }]);
    const sent: Record<'ring' | 'exposure' | 'analytics' | 'queue', any[]> = { ring: [], exposure: [], analytics: [], queue: [] };
    const ns = (kind: 'ring' | 'exposure') => ({ idFromName: (n: string) => n, get: () => ({ fetch: async (_u: unknown, init?: RequestInit) => {
      sent[kind].push(JSON.parse(String(init?.body ?? '{}'))); return Response.json({ ok: true });
    } }) });
    Object.assign(f.env, { DECISION_RING: ns('ring'), LEARN_STATS: ns('exposure'), ANALYTICS: { writeDataPoint: (v: unknown) => { sent.analytics.push(v); } }, EVENT_QUEUE: { send: async (v: unknown) => { sent.queue.push(v); } } });
    const clear = () => { for (const values of Object.values(sent)) values.length = 0; f.effects.length = 0; f.sessions.calls.length = 0; f.cache.calls.length = 0; invalidateLiftCache(); };
    return { sent, clear };
  }
  function neutral(out: any, tracking: boolean) {
    expect(out.arm).toBe('default'); expect(out.records).toHaveLength(1); expect(out.records[0].item_id).toBe('a');
    expect(out.cell).toEqual({ channel: tracking ? 'email' : 'unknown', region: tracking ? 'US-NY' : null, affinity: null, stage: 'unknown', visit_bucket: 'unknown' });
    for (const record of out.records) {
      expect(record.cell).toEqual(out.cell); expect(record.inputs.affinity).toEqual({});
      expect(record.explain.drivers).toEqual([]); expect(record.explain.score_base).toBe(0); expect(record.explain.score_final).toBe(0);
    }
  }

  it('uses all stored switches, real ranking and configured destinations; consenting randomized defaults keep their cohort context', async () => {
    for (const host of ['session', 'do']) {
      const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g);
      const { sent, clear } = await configured(f);
      for (const tracking of [false, true]) for (const personalization of [false, true]) {
        expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(tracking, personalization))).status).toBe(200);
        const before = state(f, g, host); clear();
        for (const cookie of [undefined, 'opt_tracking_consent=true; opt_personalization_enabled=true']) {
          const response = await snapshot(f, g, cookie ? '&trackingConsent=true&personalizationEnabled=true' : '', cookie); expect(response.status).toBe(200);
          const out = await response.json() as any;
          expect(out.sources.consent).toMatchObject({ tracking, personalization, personalized: tracking && personalization });
          expect(out.sources.consent.instruction).toEqual(storedConsent(f.objects.get(shopperObjectName(g.tenant, g.subject))!.data.get('consent')).instruction);
          if (!tracking || !personalization) {
            neutral(out, tracking); expect(out.records[0].explain.note).toContain(!tracking && !personalization ? 'tracking and personalization are off' : !tracking ? 'tracking is off' : 'personalization is off');
          } else {
            expect(out.arm).toBe('personalized'); expect(out.records[0].item_id).toBe('b'); expect(out.records[0].explain.score_final).toBeGreaterThan(0);
            expect(out.records[0].explain.drivers.some((v: any) => v.dim === 'line' && v.value === 'Tabby')).toBe(true);
            expect(out.cell.affinity).not.toBeNull(); expect(out.cell.stage).not.toBe('unknown');
          }
          await f.drain();
        }
        expect(sent.ring).toHaveLength(tracking ? 2 : 0); expect(sent.queue).toHaveLength(tracking ? 2 : 0); expect(sent.analytics).toHaveLength(tracking ? 2 : 0);
        expect(sent.exposure).toHaveLength(tracking && personalization ? 2 : 0);
        if (tracking && !personalization) for (const request of [...sent.ring, ...sent.queue]) expect(request.records[0].cell).toEqual({ channel: 'email', region: 'US-NY', affinity: null, stage: 'unknown', visit_bucket: 'unknown' });
        expect(state(f, g, host)).toEqual(before); expect(f.sessions.calls.filter(v => v.startsWith('put:'))).toEqual([]); expect(f.effects.filter(v => v.startsWith('store:'))).toEqual([]);
        expect(f.effects.filter(v => v.startsWith('object:'))).toHaveLength(2);
        expect(f.cache.calls.some(v => v.startsWith('get:lift:'))).toBe(tracking && personalization);
      }
      expect((await write(f.env, LEARN_KIND, 'meridian', { holdout: { share: 1, salt: 'synthetic', arms: ['default'] } }, await fixtureMeta(f.env, LEARN_KIND, 'meridian', 'synthetic'))).ok).toBe(true);
      clear(); const holdout = await (await snapshot(f, g)).json() as any; await f.drain();
      expect(holdout.arm).toBe('default'); expect(holdout.records[0].item_id).toBe('a'); expect(holdout.records[0].explain.note ?? '').not.toContain('shopper');
      expect(holdout.cell.affinity).not.toBeNull(); expect(holdout.cell.stage).not.toBe('unknown'); expect(holdout.cell.channel).toBe('email'); expect(holdout.cell.region).toBe('US-NY');
      expect(holdout.records[0].cell).toEqual(holdout.cell); expect(sent.ring).toHaveLength(1); expect(sent.queue).toHaveLength(1); expect(sent.exposure).toEqual([]);
      expect(f.cache.calls.some(v => v.startsWith('get:lift:'))).toBe(false);
      if (host === 'do') {
        await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(false, false));
        Object.defineProperty((f.objects.get(shopperObjectName('meridian', g.subject))!.shopper as any).affinity, 'reflex', { get() { throw new Error('private computation forbidden'); } });
        clear(); const response = await snapshot(f, g); expect(response.status).toBe(200); neutral(await response.json(), false); await f.drain();
        expect(Object.values(sent).every(v => v.length === 0)).toBe(true);
      }
    }
  });

  it('persists false cookie/query hints, permits explicit preference updates and keeps cold reads behavior-free', async () => {
    for (const host of ['session', 'do']) {
      const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); await configured(f);
      for (const mode of ['cookie', 'query']) for (const tracking of [false, true]) {
        expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(true, true))).status).toBe(200);
        const cookie = mode === 'cookie' ? `${tracking ? 'opt_personalization_enabled' : 'opt_tracking_consent'}=false` : undefined;
        const query = mode === 'query' ? `&${tracking ? 'personalizationEnabled' : 'trackingConsent'}=false` : '';
        const first = await snapshot(f, g, query, cookie); expect(first.status).toBe(200); neutral(await first.json(), tracking); await f.drain();
        const repeated = await snapshot(f, g); expect(repeated.status).toBe(200); neutral(await repeated.json(), tracking); await f.drain();
      }
      expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(true, true))).status).toBe(200);
      expect((await (await snapshot(f, g)).json() as any).records[0].item_id).toBe('b'); await f.drain();
      for (const value of ['', '0', 'FALSE', 'null', 'false&trackingConsent=true']) {
        const before = state(f, g, host); f.effects.length = 0; f.sessions.calls.length = 0;
        expect((await snapshot(f, g, `&trackingConsent=${value}`)).status).toBe(400);
        expect(state(f, g, host)).toEqual(before); expect(f.effects.filter(v => !v.startsWith('object:'))).toEqual([]); expect(f.sessions.calls).toEqual([]);
      }
      const cold = boundary(host), grant = await newAnonymousSession(cold.env, 'meridian'), { clear } = await configured(cold); clear();
      const out = await (await snapshot(cold, grant, '&trackingConsent=true')).json() as any; await cold.drain();
      expect(out.records).toHaveLength(1); expect(out.records[0].item_id).toBe('a'); expect(out.cell.visit_bucket).toBe('unknown');
      expectColdOff(cold, grant); expect(cold.effects.filter(v => v.startsWith('object:'))).toHaveLength(1);
      clear(); const refused = await snapshot(cold, grant, '&trackingConsent=false'); expect(refused.status).toBe(200); neutral(await refused.json(), false); await cold.drain();
      expectColdOff(cold, grant); expect(cold.sessions.calls.filter(v => v.startsWith('put:'))).toEqual([]);
    }
  });

  it('denies malformed/read/refusal-write and exact ownership failures before receipt or configured fanout', async () => {
    for (const host of ['session', 'do']) for (const failure of ['read', 'write', 'owner', 'forward', 'recognized-missing', null, false, 0]) {
      const f = boundary(host); let g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g); const { sent, clear } = await configured(f);
      const item = f.objects.get(shopperObjectName('meridian', g.subject));
      if (failure === 'read') { f.sessions.failRead = true; f.faults.read = true; if (item) (item.shopper as any).consent = undefined; }
      else if (failure === 'write') { f.sessions.failWrite = true; f.faults.write = true; }
      else if (failure === 'recognized-missing') g = await issueSessionCapability(f.env, { tenant: 'meridian', subject: `sh_${'a'.repeat(32)}`, sessionId: 's-missing', kind: 'recognized' });
      else if (host === 'session') {
        const key = tenantKey('meridian', `session:${g.sessionId}`), record = JSON.parse(f.sessions.data.get(key)!);
        f.sessions.data.set(key, JSON.stringify(failure === 'owner' ? { ...record, userId: 'not-owner' } : failure === 'forward' ? { ...record, forwardTo: 's-other' } : failure));
      } else if (failure === 'owner') (item!.shopper as any).affinity.shopperId = 'not-owner';
      else if (failure === 'forward') (item!.shopper as any).forwardTo = 'other-object';
      else { item!.data.set('consent', failure); (item!.shopper as any).consent = undefined; }
      if (!['read', 'write', 'recognized-missing'].includes(failure as string)) corruptOwner(f, g, failure);
      clear(); const response = await snapshot(f, g, '&trackingConsent=false'); expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await response.json()).not.toHaveProperty('records'); await f.drain(); expect(Object.values(sent).every(v => v.length === 0)).toBe(true);
      expect(f.effects).not.toContain('store:behavior');
    }
  });
});

describe('W05.03 consent-safe product sorting', () => {
  const feed = [{ id: 'A', line: 'Rogue' }, { id: 'B', line: 'Tabby' }, { id: 'C', line: 'Willow' }];
  const preferences = (tracking: boolean, personalization: boolean) => ({ trackingConsent: tracking, personalizationEnabled: personalization });
  const sort = (f: ReturnType<typeof boundary>, g: any, extra: Record<string, unknown> = {}, cookie?: string) => f.call('/sort', g.capability, { userId: g.subject, sessionId: g.sessionId, candidates: feed, ...extra }, 'meridian', cookie);
  const neutral = (body: any) => { expect(body.order).toEqual(['A', 'B', 'C']); expect(body.items.every((v: any) => v.score === 0 && v.drivers.length === 0)).toBe(true); };
  const warm = async (f: ReturnType<typeof boundary>, g: any) => {
    await positiveChoice(f, g);
    const response = await f.call('/realtime/action', g.capability, { userId: g.subject, sessionId: g.sessionId, type: 'add_to_cart', source: 'sdk', data: { productId: 'COA-CH857', line: 'Tabby' } });
    expect(response.status).toBe(200); expect(await response.json()).not.toHaveProperty('dropped');
  };
  const stored = (f: ReturnType<typeof boundary>, g: any, host: string) => host === 'session'
    ? f.sessions.data.get(tenantKey('meridian', `session:${g.sessionId}`)) : structuredClone([...f.objects.get(shopperObjectName('meridian', g.subject))!.data]);

  it('gates ranking and drivers on both switches, preserves true parity and persists only restrictive cookie/body hints', async () => {
    for (const host of ['session', 'do']) {
      const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await warm(f, g);
      for (const tracking of [false, true]) for (const personalization of [false, true]) {
        await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, preferences(tracking, personalization));
        const before = stored(f, g, host); f.effects.length = 0; f.sessions.calls.length = 0;
        for (const affinity of [0, 3]) for (const cookie of [undefined, 'opt_tracking_consent=true; opt_personalization_enabled=true']) {
          const res = await sort(f, g, { weights: { affinity }, ...(cookie ? { consent: { tracking: true, personalization: true } } : {}) }, cookie);
          expect(res.status).toBe(200); const body = await res.json() as any;
          if (!tracking || !personalization) neutral(body);
          else { expect(body.order).toEqual(affinity ? ['B', 'A', 'C'] : ['A', 'B', 'C']); expect(body.items.find((v: any) => v.id === 'B').drivers.length).toBeGreaterThan(0); }
        }
        expect(stored(f, g, host)).toEqual(before);
        expect(f.effects.filter(v => v.startsWith('store:'))).toEqual([]);
        expect(f.sessions.calls.filter(v => v.startsWith('put:'))).toEqual([]);
        expect(f.effects.filter(v => v.startsWith('object:'))).toHaveLength(4);
      }
      for (const mode of ['cookie', 'body']) for (const switchName of ['tracking', 'personalization']) {
        await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, preferences(true, true));
        const cookie = mode === 'cookie' ? `${switchName === 'tracking' ? 'opt_tracking_consent' : 'opt_personalization_enabled'}=false` : undefined;
        const extra = { consent: mode === 'body' ? { [switchName]: false } : { tracking: true, personalization: true } };
        const first = await sort(f, g, extra, cookie); expect(first.status).toBe(200); neutral(await first.json());
        const repeated = await sort(f, g); expect(repeated.status).toBe(200); neutral(await repeated.json());
      }
      await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, preferences(true, true));
      expect((await (await sort(f, g)).json() as any).order).toEqual(['B', 'A', 'C']);
      if (host === 'do') {
        await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, preferences(false, false));
        // W05.08 also makes the ordinary owned snapshot consent-safe.
        const ordinary = await f.env.SHOPPER_REFLEX.get(f.env.SHOPPER_REFLEX.idFromName(shopperObjectName('meridian', g.subject))).fetch('https://shopper-reflex/snapshot', { headers: { [SHOPPER_HEADER]: g.capability, 'X-Tenant': 'meridian' } });
        expect((await ordinary.json() as any).affinity).toBeNull();
        const item = f.objects.get(shopperObjectName('meridian', g.subject))!;
        Object.defineProperty((item.shopper as any).affinity, 'reflex', { get() { throw new Error('private reflex must not be computed'); } });
        const refused = await sort(f, g); expect(refused.status).toBe(200); neutral(await refused.json());
      }
    }
  });

  it('is behavior-read-only when cold and fails closed on strict state, necessary-write and ownership errors even with false hints', async () => {
    for (const host of ['session', 'do']) {
      const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'); await fixturePublication(f.env, 'meridian');
      const cold = await sort(f, g, { consent: { tracking: true } }); expect(cold.status).toBe(200); neutral(await cold.json());
      expectColdOff(f, g); expect(f.effects.filter(v => v.startsWith('object:'))).toHaveLength(1);
      expect(f.sessions.calls.filter(v => v.startsWith('put:'))).toEqual([]); expect(f.effects.filter(v => v.startsWith('store:'))).toEqual(['store:grantAuthority']);
      f.effects.length = 0; f.sessions.calls.length = 0;
      const refusal = await sort(f, g, { consent: { tracking: false } }); expect(refusal.status).toBe(200); neutral(await refusal.json());
      expectColdOff(f, g); expect(f.sessions.calls.filter(v => v.startsWith('put:'))).toEqual([]);
      for (const failure of ['read', 'write', 'owner', 'forward', 'recognized-missing', null, false, 0]) {
        const x = boundary(host); let grant = await newAnonymousSession(x.env, 'meridian'); await warm(x, grant);
        const item = x.objects.get(shopperObjectName('meridian', grant.subject));
        if (failure === 'read') { x.sessions.failRead = true; x.faults.read = true; if (item) (item.shopper as any).consent = undefined; }
        else if (failure === 'write') { x.sessions.failWrite = true; x.faults.write = true; }
        else if (failure === 'recognized-missing') grant = await issueSessionCapability(x.env, { tenant: 'meridian', subject: `sh_${'a'.repeat(32)}`, sessionId: 's-missing', kind: 'recognized' });
        else if (host === 'session') {
          const key = tenantKey('meridian', `session:${grant.sessionId}`), record = JSON.parse(x.sessions.data.get(key)!);
          x.sessions.data.set(key, JSON.stringify(failure === 'owner' ? { ...record, userId: 'not-owner' } : failure === 'forward' ? { ...record, forwardTo: 's-other' } : failure));
        } else if (failure === 'owner') (item!.shopper as any).affinity.shopperId = 'not-owner';
        else if (failure === 'forward') (item!.shopper as any).forwardTo = 'other-object';
        else { item!.data.set('consent', failure); (item!.shopper as any).consent = undefined; }
        if (!['read', 'write', 'recognized-missing'].includes(failure as string)) corruptOwner(x, grant, failure);
        x.effects.length = 0;
        const res = await sort(x, grant, {}, 'opt_tracking_consent=false');
        expect(res.status).toBeGreaterThanOrEqual(400); const body = await res.json() as any; expect(body).not.toHaveProperty('items');
        expect(x.effects).not.toContain('store:behavior');
      }
    }
  });
});

describe('W05.02 resolved action consent', () => {
  function destinations(f: ReturnType<typeof boundary>) {
    const outbound: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname; outbound.push(path);
      return path.endsWith('/graphql')
        ? Response.json({ data: { customer: { audiences: { edges: [{ node: { name: 'synthetic-qualified', state: 'qualified' } }] } } } })
        : new Response('{}', { status: 202 });
    });
    vi.stubGlobal('fetch', fetcher);
    const ns = (label: string) => ({ idFromName: (n: string) => n, get: () => ({ fetch: async () => { f.effects.push(label); return Response.json({ ok: true }); } }) });
    Object.assign(f.env, {
      DEMO_EVENT_CAPTURE: 'true', ODP_API_HOST: 'https://odp.synthetic.invalid', ODP_PUBLIC_KEY: 'synthetic-only',
      EVENT_QUEUE: { send: async () => { f.effects.push('outcome'); } },
      DECISION_RING: ns('learning'), REGION_TREND: ns('region'),
      PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async (_u: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')); f.effects.push(`push:${body.type}`); return Response.json({ ok: true });
      } }) },
    });
    return outbound;
  }
  const prefs = (tracking: boolean, personalization: boolean) => ({ trackingConsent: tracking, personalizationEnabled: personalization });
  const action = (g: Pick<Awaited<ReturnType<typeof newAnonymousSession>>, 'subject' | 'sessionId'>, consent?: unknown) => ({ userId: g.subject, sessionId: g.sessionId, type: 'add_to_cart', source: 'sdk', data: { productId: 'COA-CH857', line: 'Tabby', ...(consent ? { consent } : {}) } });
  const behavior = (f: ReturnType<typeof boundary>, g: Pick<Awaited<ReturnType<typeof newAnonymousSession>>, 'tenant' | 'subject' | 'sessionId'>, host: string) => host === 'session'
    ? f.sessions.data.get(tenantKey(g.tenant, `session:${g.sessionId}`))
    : structuredClone([...f.objects.get(shopperObjectName(g.tenant, g.subject))!.data]);
  const selectedEffects = (f: ReturnType<typeof boundary>) => f.effects.filter(v => ['capture', 'outcome', 'learning', 'region', 'store:behavior'].includes(v) || v === 'push:personalization_update');

  it('uses stored switches for both hosts with ledger/learning and ODP positives; event/cookie true cannot override refusal', async () => {
    try {
      for (const host of ['session', 'do']) for (const tenant of ['meridian', 'coach']) for (const tracking of [false, true]) for (const personalization of [false, true]) {
        const f = boundary(host), g = await newAnonymousSession(f.env, tenant), legacyOdp = tenant === 'coach';
        const outbound = destinations(f);
        // Seed a real owned profile once, then withdraw through the actual preference route.
        await positiveChoice(f, g);
        expect((await f.call('/realtime/action', g.capability, { ...action(g), type: 'page_view', data: {} }, tenant)).status).toBe(200);
        expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(tracking, personalization), tenant)).status).toBe(200);
        await f.drain(); const before = behavior(f, g, host); outbound.length = 0;
        f.effects.length = 0; f.sessions.calls.length = 0;
        let privateUpdate = false;
        for (const cookie of [undefined, 'opt_tracking_consent=true; opt_personalization_enabled=true']) {
          const res = await f.call('/realtime/action', g.capability, action(g, { tracking: true, personalization: true }), tenant, cookie, { country: 'US', regionCode: 'NY' });
          expect(res.status).toBe(200);
          const body = await res.json() as any;
          expect(body.consent).toMatchObject({ tracking, personalization });
          expect(!!body.odp).toBe(tracking && legacyOdp); privateUpdate ||= !!body.update;
        }
        await f.drain();
        // Capture still requires an explicit open development-demo environment.
        expect(f.effects.filter(v => v === 'capture')).toHaveLength(0);
        expect(f.effects.filter(v => v === 'outcome')).toHaveLength(tracking ? 2 : 0);
        expect(f.effects.filter(v => v === 'learning')).toHaveLength(tracking ? 2 : 0);
        expect(outbound.filter(v => v === '/v3/events')).toHaveLength(tracking && legacyOdp ? 2 : 0);
        expect(outbound.includes('/v3/graphql')).toBe(tracking && personalization && legacyOdp);
        expect(privateUpdate).toBe(tracking && personalization);
        if (!personalization || !tracking || !legacyOdp) expect(outbound).not.toContain('/v3/profiles');
        else expect(outbound).toContain('/v3/profiles');
        // Both signed HTTP hosts retain the route's server geography.
        expect(f.effects.filter(v => v === 'region')).toHaveLength(tracking ? 2 : 0);
        if (!tracking) { expect(behavior(f, g, host)).toEqual(before); expect(selectedEffects(f)).toEqual([]); }
        if (host === 'session') {
          expect(f.effects.filter(v => v.startsWith('object:'))).toHaveLength(2);
          expect(f.sessions.calls.filter(v => v.startsWith('put:'))).toHaveLength(tracking ? 4 : 0);
          console.info('W05.02 action I/O', JSON.stringify({ tracking, personalization, requests: 2, ownerReads: 2, writes: tracking ? 4 : 0 }));
        }
        // Explicit successful preferences can enable subsequent actions.
        expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(true, true), tenant)).status).toBe(200);
        f.effects.length = 0;
        expect((await f.call('/realtime/action', g.capability, action(g), tenant)).status).toBe(200);
        await f.drain(); expect(f.effects).toContain('outcome'); expect(f.effects).toContain('learning');
        expect(f.effects).not.toContain('capture');
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('W06.10 uses canonical tenant and both host consent results for demo capture while denied capture preserves outcomes', async () => {
    try {
      for (const host of ['session', 'do']) {
        for (const [tenant, auth, captures] of [
          ['coach', 'open', true], ['coach', 'enforced', false],
          ['meridian', 'open', false], ['harbor', 'open', false],
        ] as const) {
          const f = boundary(host);
          f.env.TENANTS = JSON.stringify({ provisioned: ['coach', 'meridian', 'harbor'] });
          destinations(f);
          Object.assign(f.env, { AUTH_MODE: auth, ENVIRONMENT: 'development' });
          const rows: unknown[][] = [];
          const prepare = vi.fn(() => ({ bind: (...values: unknown[]) => ({ run: async () => { rows.push(values); return { success: true }; } }) }));
          f.env.DB = { prepare } as unknown as D1Database;
          const g = await newAnonymousSession(f.env, tenant), browsingSessionId = 'browse-' + tenant;
          await positiveChoice(f, g);
          // Body and demo-surface hints cannot select the tenant for capture.
          const payload = { ...action(g), browsingSessionId, tenant: 'coach', surface: 'coach' };
          const post = () => f.call('/realtime/action', g.capability, payload, tenant, 'opt_tracking_consent=true; opt_personalization_enabled=true');
          const result = await post();
          expect(result.status).toBe(200); expect((await result.json() as any).consent.tracking).toBe(true);
          await f.drain();
          expect(f.effects.filter(v => v === 'outcome')).toHaveLength(1);
          expect(f.effects.filter(v => v === 'learning')).toHaveLength(1);
          expect(prepare).toHaveBeenCalledTimes(captures ? 1 : 0); expect(rows).toHaveLength(captures ? 1 : 0);
          if (!captures) continue;
          expect(prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO demo_events'));
          expect(rows[0]!.slice(1, 6)).toEqual([g.subject, browsingSessionId, browsingSessionId, 'add_to_cart', 'COA-CH857']);
          // Exercise real withdrawal and re-enablement while the capture policy stays enabled.
          for (const tracking of [false, true]) {
            expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, prefs(tracking, true), tenant)).status).toBe(200);
            prepare.mockClear(); rows.length = 0; f.effects.length = 0;
            const response = await post(); expect(response.status).toBe(200);
            expect((await response.json() as any).consent.tracking).toBe(tracking); await f.drain();
            expect(prepare).toHaveBeenCalledTimes(tracking ? 1 : 0); expect(rows).toHaveLength(tracking ? 1 : 0);
            expect(f.effects.filter(v => v === 'outcome')).toHaveLength(tracking ? 1 : 0);
            expect(f.effects.filter(v => v === 'learning')).toHaveLength(tracking ? 1 : 0);
          }
          // Capture storage remains best-effort within the explicitly enabled demo.
          for (const DB of [undefined, { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('Synthetic D1 failure'); } }) }) }]) {
            f.env.DB = DB as unknown as D1Database; f.effects.length = 0;
            const response = await post(); expect(response.status).toBe(200); await f.drain();
            expect(f.effects.filter(v => v === 'outcome')).toHaveLength(1);
            expect(f.effects.filter(v => v === 'learning')).toHaveLength(1);
          }
        }
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('persists only necessary cold refusal hints and fails on unreadable/malformed state or failed refusal persistence before configured effects', async () => {
    try {
      for (const host of ['session', 'do']) {
        for (const via of ['cookie', 'event']) {
          const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian'), outbound = destinations(f);
          const res = await f.call('/realtime/action', g.capability, action(g, via === 'event' ? { tracking: false } : undefined), 'meridian', via === 'cookie' ? 'opt_tracking_consent=false' : undefined);
          expect(res.status).toBe(200); expect((await res.json() as any).consent.tracking).toBe(false);
          await f.drain(); expect(selectedEffects(f)).toEqual([]); expect(outbound).toEqual([]);
          expectColdOff(f, g); expect(f.sessions.calls.filter(v => v.startsWith('put:'))).toEqual([]);
        }
        for (const failure of ['read', 'write', null, false, 0, {}]) {
          const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian');
          await positiveChoice(f, g);
          await f.call('/realtime/action', g.capability, action(g));
          if (failure === 'read') {
            if (host === 'do') (f.objects.get(shopperObjectName('meridian', g.subject))!.shopper as any).consent = undefined;
            f.faults.read = true; f.sessions.failRead = true;
          }
          else if (failure === 'write') { f.faults.write = true; f.sessions.failWrite = true; }
          else if (host === 'session') f.sessions.data.set(tenantKey('meridian', `session:${g.sessionId}`), JSON.stringify(failure));
          else {
            const item = f.objects.get(shopperObjectName('meridian', g.subject))!;
            item.data.set('consent', failure); (item.shopper as any).consent = undefined;
          }
          if (failure !== 'read' && failure !== 'write') corruptOwner(f, g, failure);
          const outbound = destinations(f); f.effects.length = 0;
          const res = await f.call('/realtime/action', g.capability, action(g, { tracking: false }));
          expect(res.status).toBeGreaterThanOrEqual(400); await f.drain();
          expect(selectedEffects(f)).toEqual([]); expect(outbound).toEqual([]);
        }
      }
      for (const envelope of [{ success: true }, { success: true, consent: {} }, { success: false, consent: { tracking: true, personalization: true } }, { success: true, dropped: 'unknown_product', consent: { tracking: true, personalization: true } }]) {
        const f = boundary('do'), g = await newAnonymousSession(f.env, 'meridian'); destinations(f);
        f.env.SHOPPER_REFLEX = { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json(envelope) }) } as unknown as DurableObjectNamespace;
        await f.call('/realtime/action', g.capability, action(g)); await f.drain(); expect(selectedEffects(f)).toEqual([]);
      }
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('W04.02 owned shopper lane', () => {
  it('rejects missing, forged and conflicting target credentials before any protected effect', async () => {
    const f = boundary(), grant = await newAnonymousSession(f.env, 'meridian');
    const victim = await newAnonymousSession(f.env, 'meridian');
    const routes: Array<[string, unknown?]> = [
      ['/realtime/action', { userId: victim.subject, sessionId: victim.sessionId, type: 'page_view', data: {}, source: 'sdk' }],
      [`/realtime/personalization/${victim.subject}`], [`/realtime/reflex?userId=${victim.subject}`],
      [`/realtime/session/${victim.sessionId}/analytics`], [`/realtime/session/${victim.sessionId}/preferences`, { trackingConsent: false }],
      [`/realtime/segments/${victim.subject}`], [`/realtime/segments/${victim.subject}`, { segment: 'private' }], [`/realtime/connections/${victim.subject}`],
      [`/v1/meridian/decisions/snapshot?visitorId=${victim.subject}&userId=${grant.subject}`],
      ['/sort', { userId: victim.subject, candidates: [] }], ['/v1/meridian/identity/link', { visitorId: victim.subject, accountId: 'other' }],
    ];
    for (const [path, body] of routes) for (const token of [undefined, 'ss1.forged.invalid', grant.capability]) {
      f.cache.calls.length = 0; f.sessions.calls.length = 0; f.effects.length = 0;
      expect((await f.call(path, token, body)).status, path).toBe(401);
      expect([...f.cache.calls, ...f.sessions.calls, ...f.effects], path).toEqual([]);
    }
    for (const path of ['/realtime/session/reset', '/v1/meridian/identity/detach']) {
      expect((await f.call(path, undefined, {})).status).toBe(401);
    }
    expect((await f.call(`/realtime/reflex?userId=${grant.subject}`, grant.capability, undefined, 'coach')).status).toBe(401);
    const boot = await (await f.call('/v1/meridian/identity/session', undefined, { visitorId: victim.subject, sessionId: victim.sessionId })).json() as any;
    expect(boot.session.subject).not.toBe(victim.subject); expect(boot.session.sessionId).not.toBe(victim.sessionId);
    expect(await verifySessionCapability(f.env, boot.session.capability, 'meridian')).toMatchObject({ subject: boot.session.subject, kind: 'anonymous' });
    await expect(verifySessionCapability(f.env, boot.session.capability, 'coach')).rejects.toBeInstanceOf(SessionAccessError);
    const expired = await issueSessionCapability(f.env, { tenant: grant.tenant, subject: grant.subject, sessionId: grant.sessionId, kind: 'anonymous' }, Math.floor(Date.now() / 1000) - 10, 1);
    const jwt = await new SignJWT({ sub: grant.subject, roles: ['operator'] }).setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(f.env.JWT_SECRET));
    for (const token of [expired.capability, jwt, grant.capability + '.extra']) {
      f.cache.calls.length = 0; f.sessions.calls.length = 0; f.effects.length = 0;
      expect((await f.call(`/realtime/reflex?userId=${grant.subject}`, token)).status).toBe(401);
      expect([...f.cache.calls, ...f.sessions.calls, ...f.effects]).toEqual([]);
    }
    f.env.JWT_SECRET = '';
    expect((await f.call(`/realtime/reflex?userId=${grant.subject}`, grant.capability)).status).toBe(503);
    expect([...f.cache.calls, ...f.sessions.calls, ...f.effects]).toEqual([]);
  });

  describe('unit:W09.BASE.02 /sort answers 200 read-only for a linked non-default-tenant owned profile; recovery admission while durable recovery is disabled never surfaces as an untyped 500 on a read path', () => {
  it('preserves working non-default-tenant profiles on both hosts, signed upgrade, actual SIDs and owned operation counts', async () => {
    for (const host of ['session', 'do']) {
      const f = boundary(host), anon = await newAnonymousSession(f.env, 'meridian');
      const documents = new Map<string, { text: string; etag: string }>(); let version = 0;
      f.env.STORAGE = { get: async (key: string) => { const v = documents.get(key); return v ? { etag: v.etag,
        size: v.text.length, body: new Response(v.text).body, text: async () => v.text, json: async () => JSON.parse(v.text) as unknown } : null; },
        put: async (key: string, text: string, options?: R2PutOptions) => {
          const condition = options?.onlyIf;
          if (condition instanceof Headers ? documents.has(key) : condition && condition.etagMatches !== documents.get(key)?.etag) return null;
          const etag = String(++version); documents.set(key, { text, etag }); return { key, etag, size: text.length };
        } } as unknown as R2Bucket;
      await fixturePublication(f.env, 'meridian', [{ kind: CONTENT_KIND, scope: 'meridian', revision: { revision: 1, at: 1, actor: 'fixture', note: '', value: { pieces: [] } } }]);
      // Consent is fail-closed: the owned lane's grant records an explicit positive
      // choice before any tracked effect (src/content/consent.ts:139-152).
      await positiveChoice(f, anon);
      if (host === 'do') {
        const cold = await newAnonymousSession(f.env, 'meridian');
        const refused = await f.call('/realtime/action', cold.capability, { userId: cold.subject, sessionId: cold.sessionId, type: 'page_view', data: {}, source: 'sdk' }, 'meridian', 'opt_tracking_consent=false; opt_personalization_enabled=false; opt_segments=private-stale; opt_session_id=victim');
        expect(refused.status).toBe(200);
        expect(await refused.json()).toMatchObject({ consent: { tracking: false, personalization: false } });
        const data = f.objects.get(shopperObjectName('meridian', cold.subject))!.data;
        // Settled decision D06-W05 (docs/remediation/decisions/D06-W05-explicit-choice-approved-2026-09-16.json;
        // src/content/consent.ts:139-152): an explicit choice is the only consent and "missing or
        // expired records return to off", so a shopper who never chose mints no record. Only the
        // grant authority is stored and the refusal is the projection — the representation this
        // file already uses in `expectColdOff`.
        expect([...data.keys()].sort()).toEqual(['grantAuthority']);
        expect(storedConsent(data.get('consent'))).toEqual({ tracking: false, personalization: false });
        const necessary = structuredClone([...data]);
        expect((await f.call(`/realtime/segments/${cold.subject}`, cold.capability, { segment: 'refused' }, 'meridian', 'opt_tracking_consent=true; opt_personalization_enabled=true')).status).toBe(403);
        expect([...data]).toEqual(necessary);
      }
      expect((await f.call('/realtime/action', anon.capability, { userId: anon.subject, sessionId: anon.sessionId, browsingSessionId: 'browsing-only', type: 'page_view', data: {}, source: 'sdk' })).status).toBe(200);
      if (host === 'session') expect((await f.call(`/realtime/segments/${anon.subject}`, anon.capability, { segment: 'W0402_OWNED_SEGMENT' })).status).toBe(200);
      f.sessions.calls.length = 0;
      const analytics = await f.call(`/realtime/session/${anon.sessionId}/analytics`, anon.capability);
      expect(analytics.status).toBe(200);
      const analyticsBody = await analytics.json() as any;
      expect(analyticsBody.sessionId).toBe(anon.sessionId);
      if (host === 'session') expect(analyticsBody.analytics.segmentHistory).toContain('W0402_OWNED_SEGMENT');
      else expect(analyticsBody.analytics.pageViews).toBe(1);
      const analyticsCalls = [...f.sessions.calls];
      f.sessions.calls.length = 0;
      expect((await f.call(`/realtime/session/${anon.sessionId}/preferences`, anon.capability, { userId: anon.subject, trackingConsent: false, personalizationEnabled: false, cookieConsent: false })).status).toBe(200);
      const preferenceCalls = [...f.sessions.calls];
      if (host === 'session') {
        // Authoritative reads stay in the held owner's durable projection;
        // only the acknowledged compatibility write crosses back to KV.
        expect(analyticsCalls.filter(v => v.startsWith('get:'))).toHaveLength(0);
        expect(preferenceCalls.filter(v => v.startsWith('get:'))).toHaveLength(0);
        expect(preferenceCalls.filter(v => v.startsWith('put:'))).toHaveLength(1);
      } else {
        // The owner answers analytics from its own durable projection. A preferences POST
        // carrying cookieConsent reaches updateUserPreferences → readRaw, and on a projection
        // miss `src/durable-objects/ShopperReflex.ts:3074-3077` deliberately reads the real
        // SESSIONS binding exactly once for the owner's own session key — "no historical KV
        // value acquires authority merely by being readable" — and writes nothing back.
        expect(analyticsCalls).toEqual([]);
        expect(preferenceCalls).toEqual([`get:${tenantKey('meridian', 'session:' + anon.sessionId)}`]);
      }
      console.info('W04.02 owned operation counts', JSON.stringify({ host, analyticsReads: analyticsCalls.filter(v => v.startsWith('get:')).length, preferencesReads: preferenceCalls.filter(v => v.startsWith('get:')).length, preferencesWrites: preferenceCalls.filter(v => v.startsWith('put:')).length }));
      if (host === 'do') {
        const store = f.objects.get(shopperObjectName('meridian', anon.subject))!.data;
        const before = structuredClone([...store]);
        expect((await f.call(`/realtime/segments/${anon.subject}`, anon.capability, { segment: 'refused' })).status).toBe(403);
        expect([...store]).toEqual(before);
      }
      expect((await f.call(`/realtime/session/${anon.sessionId}/preferences`, anon.capability, { trackingConsent: true, personalizationEnabled: true, cookieConsent: true })).status).toBe(200);
      const exp = Math.floor(Date.now() / 1000) + 120, accountId = 'synthetic-account';
      const assertion = await signAssertion('backend-proof', 'meridian', anon.subject, accountId, exp);
      const linked = await f.call('/v1/meridian/identity/link', anon.capability, { visitorId: anon.subject, accountId, exp, assertion });
      expect(linked.status).toBe(200);
      const person = (await linked.json() as any).session;
      if (host === 'do') expect((f.objects.get(shopperObjectName('meridian', person.subject))!.data.get('pipeline') as { sessionId: string }).sessionId).toBe(person.sessionId);
      for (const [path, body] of [
        [`/realtime/personalization/${person.subject}`], [`/realtime/session/${person.sessionId}/analytics`],
        [`/realtime/segments/${person.subject}`], [`/realtime/segments/${person.subject}`, { segment: 'owned-manual' }],
        [`/realtime/reflex?userId=${person.subject}`], ['/sort', { userId: person.subject, sessionId: person.sessionId, candidates: [] }],
        [`/v1/meridian/decisions/snapshot?visitorId=${person.subject}&sessionId=${person.sessionId}&browsingSessionId=browsing-only`],
      ] as Array<[string, unknown?]>) {
        const res = await f.call(path, person.capability, body);
        expect(res.status, `${host}:${path}`).toBe(200);
        const data = await res.json() as any;
        if (path.includes('/personalization/') || path.includes('/analytics')) expect(data.sessionId).toBe(person.sessionId);
        if (path.includes('/segments/') || path.includes('/personalization/')) expect(data.userId).toBe(person.subject);
        if (path === '/sort') expect(data.order).toEqual([]);
        // The snapshot payload carries exactly ok, tenant, brand, page, ts, arm, versions,
        // config_label, decisions and sources (src/routes/decisions.ts:476-480). `visitor_id`
        // and `session_id` are decision-record fields, and the route serves `records` only
        // inside a trusted synthetic operation (src/routes/decisions.ts:478). This fixture
        // publishes an empty catalog and binds no EVENT_QUEUE or DECISION_RING, so no
        // decision record exists in process: the browsing-session attribution is owed a
        // capture leg (the render-offer path this file's W15 fixture drives).
        if (path.includes('/decisions/snapshot')) {
          expect(Object.keys(data).sort()).toEqual(['arm', 'brand', 'config_label', 'decisions', 'ok', 'page', 'sources', 'tenant', 'ts', 'versions']);
          expect(data).toMatchObject({ ok: true, tenant: 'meridian', decisions: [] });
        }
      }
      expect((await f.call(`/realtime/reflex?userId=${anon.subject}`, anon.capability)).status).toBe(401);
      const attempted = await f.call('/v1/meridian/identity/link', anon.capability, { visitorId: anon.subject, accountId, exp, assertion });
      // This exact operation is recoverable, not ordinary old-account access.
      expect(attempted.status, host).toBe(200);
      expect((await attempted.json() as any).session).toEqual(person);
      const beforeRetryRefusal = structuredClone([...f.objects].map(([key, value]) => [key, [...value.data]]));
      const otherAccount = 'different-account', changedProof = await signAssertion('backend-proof', 'meridian', anon.subject, otherAccount, exp);
      expect((await f.call('/v1/meridian/identity/link', anon.capability, { visitorId: anon.subject, accountId: otherAccount, exp, assertion: changedProof })).status).toBe(401);
      expect([...f.objects].map(([key, value]) => [key, [...value.data]])).toEqual(beforeRetryRefusal);
      expect((await f.call('/v1/meridian/identity/detach', person.capability, {})).status).toBe(200);
      const revoked = structuredClone([...f.objects].map(([key, value]) => [key, [...value.data]]));
      expect((await f.call('/v1/meridian/identity/link', anon.capability, { visitorId: anon.subject, accountId, exp, assertion })).status).toBe(401);
      expect([...f.objects].map(([key, value]) => [key, [...value.data]])).toEqual(revoked);
    }
  });
  });
});

describe('W05.01 withdrawal continuity', () => {
  const preferences = (c: { tracking: boolean; personalization: boolean }) => ({ trackingConsent: c.tracking, personalizationEnabled: c.personalization });
  const bootstrap = async (f: ReturnType<typeof boundary>, consent?: unknown, cookie?: string) => {
    const response = await f.call('/v1/meridian/identity/session', undefined, consent === undefined ? {} : { consent }, 'meridian', cookie);
    expect(response.status).toBe(200); return (await response.json() as any).session;
  };
  const assertEmpty = (f: ReturnType<typeof boundary>, host: string, grant: any, consent: { tracking: boolean; personalization: boolean }) => {
    const record = f.sessions.data.get(tenantKey('meridian', `session:${grant.sessionId}`));
    const object = f.objects.get(shopperObjectName('meridian', grant.subject))?.data;
    expect(record).toBeUndefined();
    expect([...object!.keys()].sort()).toEqual(grant.consent?.instruction ? ['consent', 'grantAuthority'] : ['grantAuthority']);
    expect(storedConsent(object!.get('consent'))).toMatchObject(consent);
    expect(object!.get('grantAuthority')).toMatchObject({ epoch: grant.authorityEpoch, grants: { [grant.grantId]: { subject: grant.subject } } });
    expect(f.sessions.data.has(tenantKey('meridian', `user:${grant.subject}`))).toBe(false);
  };
  const signIn = async (f: ReturnType<typeof boundary>, grant: any, accountId: string) => {
    const exp = Math.floor(Date.now() / 1000) + 120;
    const assertion = await signAssertion('backend-proof', 'meridian', grant.subject, accountId, exp);
    const response = await f.call('/v1/meridian/identity/link', grant.capability, { visitorId: grant.subject, accountId, exp, assertion });
    expect(response.status).toBe(200); return (await response.json() as any).session;
  };

  it('preserves all four switch combinations through both-host detach/reset and existing-account link without prior profile restoration', async () => {
    for (const host of ['session', 'do']) for (const tracking of [false, true]) for (const personalization of [false, true]) {
      const consent = { tracking, personalization };
      for (const path of ['/v1/meridian/identity/detach', '/realtime/session/reset']) {
        const f = boundary(host), anon = await bootstrap(f);
        await positiveChoice(f, anon);
        const person = await signIn(f, anon, 'prior-account');
        expect((await f.call('/realtime/action', person.capability, { userId: person.subject, sessionId: person.sessionId, type: 'page_view', data: {}, source: 'sdk' })).status).toBe(200);
        expect((await f.call(`/realtime/session/${person.sessionId}/preferences`, person.capability, preferences(consent))).status).toBe(200);
        const response = await f.call(path, person.capability, {}); expect(response.status).toBe(200);
        expect(response.headers.get('set-cookie')).not.toContain('opt_tracking_consent'); expect(response.headers.get('set-cookie')).not.toContain('opt_personalization_enabled');
        const fresh = (await response.json() as any).session;
        expect(fresh.subject).not.toBe(person.subject); expect(fresh.consent).toMatchObject(consent); assertEmpty(f, host, fresh, consent);
        const resumed = await f.call('/v1/meridian/identity/session', fresh.capability, {});
        expect((await resumed.json() as any).session.consent).toEqual(fresh.consent);
        if (path.endsWith('detach')) {
          const destination = await signIn(f, await bootstrap(f), 'existing-account');
          const linked = await signIn(f, fresh, 'existing-account');
          expect(linked.subject).toBe(destination.subject); expect(linked.consent).toMatchObject(consent);
          const analytics = await (await f.call(`/realtime/session/${linked.sessionId}/analytics`, linked.capability)).json() as any;
          expect(analytics.analytics.pageViews).toBe(0);
          expect((await f.call(`/realtime/session/${linked.sessionId}/preferences`, linked.capability, { trackingConsent: true, personalizationEnabled: true })).status).toBe(200);
          const enabled = await (await f.call('/v1/meridian/identity/session', linked.capability, {})).json() as any;
          expect(enabled.session.consent).toMatchObject({ tracking: true, personalization: true });
        }
      }
      const f = boundary(host);
      const cookie = `opt_tracking_consent=${tracking}; opt_personalization_enabled=${personalization}; opt_segments=OLD_PRIVATE; opt_user_id=OLD_ACCOUNT`;
      const off = { tracking: false, personalization: false };
      const cookieOnly = await bootstrap(f, undefined, cookie); expect(cookieOnly.consent).toEqual(off); assertEmpty(f, host, cookieOnly, off);
      const hinted = await bootstrap(f, consent); expect(hinted.consent).toEqual(off); assertEmpty(f, host, hinted, off);
      const cookieSource = await bootstrap(f);
      const cookieDetached = await f.call('/v1/meridian/identity/detach', cookieSource.capability, {}, 'meridian', cookie);
      expect(cookieDetached.status).toBe(200);
      const cookieFresh = (await cookieDetached.json() as any).session;
      expect(cookieFresh.consent).toEqual(off); assertEmpty(f, host, cookieFresh, off);
    }
  });

  it('fails transitions on malformed/unreadable state or failed replacement persistence without clearing refusal or issuing a grant', async () => {
    for (const host of ['session', 'do']) {
      for (const malformed of [null, false, 0, {}]) {
        const f = boundary(host), grant = await bootstrap(f, { tracking: false, personalization: false });
        // Consent authority is now durable on BOTH hosts; corrupt that actual
        // current source, not a non-authoritative compatibility copy.
        f.objects.get(shopperObjectName('meridian', grant.subject))!.data.set('consent', malformed);
        const current = f.objects.get(shopperObjectName('meridian', grant.subject))!;
        current.shopper = new ShopperReflex(current.state, f.env);
        const response = await f.call('/v1/meridian/identity/detach', grant.capability, {});
        expect(response.status).toBeGreaterThanOrEqual(400); expect(response.headers.has('set-cookie')).toBe(false);
      }
      for (const failure of ['read', 'write']) {
        const f = boundary(host), grant = await bootstrap(f, { tracking: false, personalization: true });
        const before = host === 'session' ? f.sessions.data.get(tenantKey('meridian', `session:${grant.sessionId}`)) : structuredClone([...f.objects.get(shopperObjectName('meridian', grant.subject))!.data]);
        f.faults[failure as 'read' | 'write'] = true;
        for (const path of ['/v1/meridian/identity/detach', '/realtime/session/reset']) {
          const response = await f.call(path, grant.capability, {});
          expect(response.status).toBeGreaterThanOrEqual(400); expect(response.headers.has('set-cookie')).toBe(false);
        }
        const after = host === 'session' ? f.sessions.data.get(tenantKey('meridian', `session:${grant.sessionId}`)) : [...f.objects.get(shopperObjectName('meridian', grant.subject))!.data];
        expect(after).toEqual(before);
      }
    }
  });

  it('actual SDK with blocked cookies recovers failed logout restrictively before activity and account switching on both hosts', async () => {
    for (const selected of ['session', 'do']) {
      const f = boundary(selected), requests: Array<{ path: string; body: any }> = []; let failDetach = false;
      const host = memoryHost({ acquireAuthorityLock: authorityLocks(), cookie: { get: () => null, set: () => {} }, location: { protocol: 'https:', host: 'owned.invalid', hostname: 'owned.invalid', href: 'https://owned.invalid/', search: '' },
        fetch: async (url, init) => {
          const path = new URL(url).pathname, body = JSON.parse(init?.body ?? '{}'); requests.push({ path, body });
          if (failDetach && path.endsWith('/identity/detach')) return { ok: false, status: 503, json: async () => ({ ok: false }) };
          const response = await f.call(path, init?.headers?.[SHOPPER_HEADER], body, init?.headers?.['X-Tenant']);
          return { ok: response.ok, status: response.status, json: () => response.json() };
        },
      });
      const core = createCore({ tenant: 'meridian' }, host), identity = createIdentity(core); await core.ready();
      const getAssertion = async ({ tenant, visitorId, accountId }: { tenant: string; visitorId: string; accountId: string }) => {
        const exp = Math.floor(Date.now() / 1000) + 120; return { exp, assertion: await signAssertion('backend-proof', tenant, visitorId, accountId, exp) };
      };
      expect((await identity.identify('account-a', { getAssertion })).ok).toBe(true);
      expect((await f.call(`/realtime/session/${core.profileSessionId}/preferences`, core.headers()[SHOPPER_HEADER], { trackingConsent: false, personalizationEnabled: false })).status).toBe(200);
      failDetach = true; expect((await identity.logout()).ok).toBe(false); expect(core.visitorId).toBe('');
      failDetach = false; expect(await core.ready()).toBe(true);
      expect(requests.at(-1)!.body).toEqual({ consent: { tracking: false, personalization: false } });
      const recovered = await (await f.call('/v1/meridian/identity/session', core.headers()[SHOPPER_HEADER], {})).json() as any;
      assertEmpty(f, selected, recovered.session, { tracking: false, personalization: false });
      expect((await identity.identify('account-b', { getAssertion })).ok).toBe(true);
      const linked = await (await f.call('/v1/meridian/identity/session', core.headers()[SHOPPER_HEADER], {})).json() as any;
      expect(linked.session.consent).toMatchObject({ tracking: false, personalization: false });
    }
  });
});

describe('SDK ↔ /realtime/action contract', () => {
  const core = createCore({ tenant: 'coach', source: 'sdk', surface: 'coach' }, memoryHost({ uuid: () => 'u' }));

  it('every SDK event type produces an envelope the server accepts', () => {
    for (const type of Object.keys(WIRE) as SdkEventType[]) {
      const env = core.envelope(type, { productId: 'SKU-1', contentId: 'c1', slot: 'hero' });
      const parsed = actionEventSchema.safeParse(env);
      expect(parsed.success, `${type} → ${env.type}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });

  it('the conversion event and the content interactions travel under their own names, with no alias in the payload', async () => {
    // The SDK empties an unconsented payload (src/sdk/core.ts:569), so the wire
    // table is read through a real consenting session on the real host path.
    const f = boundary(), g = await newAnonymousSession(f.env, 'coach'); await positiveChoice(f, g);
    const consenting = createCore({ tenant: 'coach', endpoint: 'https://synthetic.invalid', source: 'sdk', surface: 'coach' },
      memoryHost({ acquireAuthorityLock: authorityLocks(), uuid: () => crypto.randomUUID(), now: () => Date.now(),
        fetch: async (url, init) => {
          const path = new URL(url).pathname, body = init?.body ? JSON.parse(init.body) as unknown : undefined;
          const response = await f.call(path, init?.headers?.[SHOPPER_HEADER] ?? g.capability, body, 'coach');
          return { ok: response.ok, status: response.status, json: () => response.json() };
        } }));
    try {
      expect(await consenting.ready()).toBe(true);
      expect(consenting.consent).toMatchObject({ tracking: true, personalization: true });
      for (const type of ['purchase', 'content_impression', 'content_click', 'content_dwell', 'video_complete'] as const) {
        const env = consenting.envelope(type, { contentId: 'c1', slot: 'hero' });
        expect(env.type).toBe(type);
        expect(env.data).not.toHaveProperty('event');
        expect(env.data).toMatchObject({ contentId: 'c1', slot: 'hero' });
      }
    } finally { consenting.disconnect(); }
  });

  it('W26.02 refuses malformed decision references before either host and preserves explicit or absent outcome identity', async () => {
    for (const host of ['session', 'do']) {
      invalidateCache(); const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian');
      const queued: OutcomeRecord[] = [], learned: OutcomeRecord[] = [];
      Object.assign(f.env, {
        EVENT_QUEUE: { send: async (body: { record: OutcomeRecord }) => { queued.push(body.record); } },
        DECISION_RING: { idFromName: (name: string) => name, get: () => ({ fetch: async (_url: string, init: RequestInit) => {
          learned.push(JSON.parse(String(init.body)).outcome); return Response.json({ ok: true });
        } }) },
      });
      const now = Date.now(), decisionId = `meridian:${(now - 1).toString(36)}:${g.subject}:home:hero:0`;
      const action = { type: 'purchase', userId: g.subject, sessionId: g.sessionId, source: 'sdk', timestamp: now,
        data: { orderId: 'order-1', value: 1, decisionId } };
      const exact = decisionId + ':'.repeat(2048 - decisionId.length);
      for (const malformed of ['', ' ', null, 7, {}, [], 'not-a-receipt', ' ' + decisionId, decisionId + ' ',
        decisionId.replace(':home:', ':\nhome:') + 'x'.repeat(2048), decisionId + 'é'.repeat(1024), exact + 'x',
        'meridian:zzzzzzzzzzzzzzzz:' + g.subject + ':home:hero:0']) {
        const before = { effects: [...f.effects], sessions: [...f.sessions.calls] };
        const invalid = { ...action, data: { ...action.data, decisionId: malformed } };
        expect((await f.call('/realtime/action', g.capability, invalid)).status).toBe(400);
        expect(f.effects).toEqual(before.effects); expect(f.sessions.calls).toEqual(before.sessions);
        expect(() => outcomeFromAction(invalid, g.tenant)).toThrow('Invalid decision reference');
        expect(queued).toEqual([]); expect(learned).toEqual([]);
      }
      for (const reference of [decisionId, exact]) {
        expect((await f.call('/realtime/action', g.capability, { ...action, data: { ...action.data, decisionId: reference } })).status).toBe(200);
        await f.drain(); expect(queued.at(-1)).toMatchObject({ decision_id: reference, tenant: g.tenant, visitor_id: g.subject });
        expect(learned).toEqual(queued);
      }
      const legacy = { ...action, data: { orderId: 'legacy', value: 1 } };
      expect((await f.call('/realtime/action', g.capability, legacy)).status).toBe(200); await f.drain();
      expect(queued.at(-1)).not.toHaveProperty('decision_id'); expect(learned).toEqual(queued);
      expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, { trackingConsent: false, personalizationEnabled: false })).status).toBe(200);
      await f.drain(); const count = queued.length;
      expect((await f.call('/realtime/action', g.capability, action)).status).toBe(200); await f.drain();
      expect(queued).toHaveLength(count); expect(learned).toHaveLength(count);
    }
  });

  it('W09.05 preserves provided logical identity through both hosts and destinations, with strict boundary and consent-gated legacy fallback', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
    for (const host of ['session', 'do']) {
      invalidateCache();
      const f = boundary(host), g = await newAnonymousSession(f.env, 'meridian');
      await positiveChoice(f, g);
      for (const token of [undefined, 'invalid-synthetic-capability', g.capability]) {
        const before = { effects: [...f.effects], sessions: [...f.sessions.calls] };
        const invalid = new Request('https://fixture/realtime/action', { method: 'POST',
          body: token === g.capability ? JSON.stringify({ type: 'purchase', userId: g.subject, eventId: '', timestamp: Date.now(), source: 'sdk', data: {} }) : '{',
          headers: { 'X-Tenant': g.tenant, 'Content-Type': 'application/json', ...(token ? { [SHOPPER_HEADER]: token } : {}) } });
        const response = await f.app.request(invalid, undefined, f.env);
        expect(response.status).toBe(token === g.capability ? 400 : 401);
        expect(f.effects).toEqual(before.effects); expect(f.sessions.calls).toEqual(before.sessions);
      }
      const queued: OutcomeRecord[] = [], learned: OutcomeRecord[] = [];
      Object.assign(f.env, {
        EVENT_QUEUE: { send: async (body: { record: OutcomeRecord }) => { queued.push(body.record); } },
        DECISION_RING: { idFromName: (name: string) => name, get: () => ({ fetch: async (_url: string, init: RequestInit) => {
          learned.push(JSON.parse(String(init.body)).outcome); return Response.json({ ok: true });
        } }) },
      });
      const action = { type: 'purchase', userId: g.subject, sessionId: g.sessionId, source: 'sdk', data: { orderId: 'same', value: 1 }, timestamp: Date.now() };
      for (const eventId of ['base36-1', 'base36-2', 'base36-1']) {
        expect((await f.call('/realtime/action', g.capability, { ...action, eventId })).status).toBe(200);
        await f.drain();
      }
      expect(queued).toHaveLength(3); expect(learned).toEqual(queued);
      expect(queued[0]!.outcome_id).not.toBe(queued[1]!.outcome_id); expect(queued[0]).toEqual(queued[2]);
      expect(queued[0]).toMatchObject({ event_id: 'base36-1', event_id_source: 'provided', ts: action.timestamp });
      expect(parseId(queued[0]!.outcome_id)).toMatchObject({ tenant: g.tenant, ts: action.timestamp });
      for (const malformed of [
        { eventId: '' }, { eventId: 'abc\n' }, { eventId: null }, { eventId: 'x'.repeat(129) },
        { eventId: 'valid', timestamp: undefined }, { eventId: 'valid', timestamp: -1 },
        { eventId: 'valid', timestamp: 1.5 }, { eventId: 'valid', timestamp: 8_640_000_000_000_001 },
        { timestamp: -1 }, { timestamp: 1.5 }, { timestamp: 8_640_000_000_000_001 },
      ]) {
        const before = { effects: [...f.effects], sessions: [...f.sessions.calls] };
        expect((await f.call('/realtime/action', g.capability, { ...action, ...malformed })).status).toBe(400);
        expect(f.effects).toEqual(before.effects); expect(f.sessions.calls).toEqual(before.sessions);
      }
      expect((await f.call('/realtime/action', g.capability, { ...action, eventId: 'epoch-zero', timestamp: 0 })).status).toBe(200);
      await f.drain(); expect(queued.at(-1)).toMatchObject({ event_id: 'epoch-zero', ts: 0 });
      expect((await f.call('/realtime/action', g.capability, { ...action, timestamp: 0 })).status).toBe(200);
      await f.drain(); expect(queued.at(-1)).toMatchObject({ event_id_source: 'request', ts: 0 });
      for (let i = 0; i < 2; i++) { expect((await f.call('/realtime/action', g.capability, action)).status).toBe(200); await f.drain(); }
      expect(queued.at(-1)).toMatchObject({ event_id_source: 'request' });
      expect(queued.at(-1)!.outcome_id).not.toBe(queued.at(-2)!.outcome_id); expect(learned).toEqual(queued);
      const legacy = outcomeFromAction(action, g.tenant)!;
      expect(legacy).not.toHaveProperty('event_id'); expect(legacy.outcome_id).not.toContain(':n1:');
      expect((await f.call(`/realtime/session/${g.sessionId}/preferences`, g.capability, { trackingConsent: false, personalizationEnabled: false })).status).toBe(200);
      await f.drain(); const count = queued.length;
      const uuid = vi.spyOn(crypto, 'randomUUID');
      try {
        expect((await f.call('/realtime/action', g.capability, action)).status).toBe(200); await f.drain();
        expect(queued).toHaveLength(count); expect(learned).toHaveLength(count); expect(uuid).not.toHaveBeenCalled();
      } finally { uuid.mockRestore(); }
    }
    } finally { clock.mockRestore(); }
  });
});


describe('W04.03 history metadata owner ordering', () => {
  type Grant = SessionCapability & { capability: string };
  const gate = () => {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
  };
  const setup = async (host: string) => {
    invalidateCache();
    const f = boundary(host), storage = new BoundaryR2(), records = storage.data;
    f.env.TENANTS = JSON.stringify({ provisioned: ['coach', 'meridian', 'harbor'] });
    f.env.IDENTITY_SECRETS = 'meridian:backend-proof,harbor:backend-proof';
    // The publication authority reads and writes whole R2 objects: readObject
    // requires key/etag/size/body and put requires key/etag/size
    // (src/config/publication.ts:225-237, :295). Reuse the file's complete double.
    f.env.STORAGE = storage as unknown as R2Bucket;
    const mint = async (tenant = 'meridian') => {
      const visitor = await newAnonymousSession(f.env, tenant), accountId = 'w0403-history-person';
      await positiveChoice(f, visitor);
      const warm = await f.call('/realtime/action', visitor.capability,
        { userId: visitor.subject, sessionId: visitor.sessionId, type: 'page_view', source: 'sdk', data: {} }, tenant);
      expect(warm.status).toBe(200);
      const exp = Math.floor(Date.now() / 1000) + 120, assertion = await signAssertion('backend-proof', tenant, visitor.subject, accountId, exp);
      const response = await f.call('/v1/' + tenant + '/identity/link', visitor.capability,
        { visitorId: visitor.subject, accountId, exp, assertion }, tenant);
      expect(response.status).toBe(200);
      const person = (await response.json() as { session: Grant }).session;
      expect(person.kind).toBe('recognized');
      await f.drain();
      return { visitor, person };
    };
    const own = await mint(), foreign = await mint('harbor');
    records.set('synthetic/harbor/retained', 'foreign exact bytes');
    const owner = f.objects.get(shopperObjectName('meridian', own.person.subject))!;
    const metadataKey = tenantKey('meridian', 'identity:shopper:' + own.person.subject);
    const now = Date.now(), rows = [
      { shopperId: own.person.subject, action: 'purchase', at: now, product: { line: 'Tabby' } },
      { shopperId: own.person.subject, action: 'product_view', at: now, product: { line: 'Rogue' } },
    ];
    const foreignState = () => ({
      kv: [...f.sessions.data].filter(([key]) => key.startsWith(tenantKey('harbor', ''))),
      cache: [...f.cache.data].filter(([key]) => key.startsWith(tenantKey('harbor', ''))),
      objects: [foreign.visitor.subject, foreign.person.subject].map(subject => structuredClone([
        ...f.objects.get(shopperObjectName('harbor', subject))!.data])),
      r2: [...records].filter(([key]) => key.includes('/harbor/')),
    });
    const protectedBefore = foreignState();
    const erase = async () => {
      for (let page = 0; page < 12; page++) {
        const result = await eraseSubject(f.env, 'meridian', { shopperId: own.person.subject }, 'w0403-history', now + 1);
        if (result.httpStatus !== 202) return result;
      }
      throw new Error('Synthetic erasure exceeded its bounded fixture pages');
    };
    const absent = () => {
      expect(f.sessions.data.has(metadataKey)).toBe(false);
      for (const grant of [own.visitor, own.person]) {
        expect(f.sessions.data.has(tenantKey('meridian', 'session:' + grant.sessionId))).toBe(false);
        expect(f.sessions.data.has(tenantKey('meridian', 'user:' + grant.subject))).toBe(false);
        const object = f.objects.get(shopperObjectName('meridian', grant.subject))!;
        for (const key of ['affinity', 'pipeline', 'identityMembers']) expect(object.data.has(key)).toBe(false);
        expect([...object.data.keys()].filter(key => key.startsWith('identityImport:'))).toEqual([]);
        expect(object.data.get('grantAuthority')).toMatchObject({ grants: {} });
        expect((object.data.get('grantAuthority') as { epoch: string }).epoch).not.toBe(grant.authorityEpoch);
      }
      expect([...owner.data.keys()].some(key => key.startsWith('identityErasure:'))).toBe(true);
      expect([...records.keys()].some(key => key.startsWith('erasures/meridian/pending/') && key.includes(own.person.subject))).toBe(true);
      expect(foreignState()).toEqual(protectedBefore);
    };
    const internal = (path: string, body: unknown) => owner.shopper.fetch(new Request('https://shopper-reflex' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': 'meridian', 'X-Reflex-Subject': own.person.subject },
      body: JSON.stringify(body),
    }));
    return { f, records, own, owner, metadataKey, now, rows, mint, foreignState, protectedBefore, erase, absent, internal };
  };

  it.each([{ host: 'session', phase: 'metadata' }, { host: 'do', phase: 'metadata' }, { host: 'session', phase: 'profile' }])(
    'holds queued erasure behind actual pending history metadata publication on $host ($phase)', async ({ host, phase }) => {
    const s = await setup(host), entered = gate(), release = gate(), queued = gate();
    const before = s.f.sessions.data.get(s.metadataKey)!;
    const expected = JSON.stringify({ ...JSON.parse(before), history: { rows: 2, latestAt: s.now, appliedAt: s.now } });
    const profileKey = tenantKey('meridian', 'session:' + s.own.person.sessionId), oldProfile = s.f.sessions.data.get(profileKey);
    const put = s.f.sessions.put.bind(s.f.sessions), publications: string[] = [], profiles: string[] = [];
    let paused = false, erased = false;
    s.f.sessions.put = async (key, value) => {
      if (key === s.metadataKey) publications.push(value);
      if (key === profileKey) profiles.push(value);
      if (key === (phase === 'metadata' ? s.metadataKey : profileKey) && !paused) { paused = true; entered.release(); await release.promise; }
      return put(key, value);
    };
    const namespace = s.f.env.SHOPPER_REFLEX;
    s.f.env.SHOPPER_REFLEX = { idFromName: namespace.idFromName.bind(namespace), get: (id: DurableObjectId) => {
      const stub = namespace.get(id);
      return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname === '/identity/erase/begin') queued.release();
        return stub.fetch(request);
      } };
    } } as unknown as DurableObjectNamespace;
    const imported = applyHistory(s.f.env, 'meridian', s.rows, s.now);
    await entered.promise;
    expect(publications).toEqual(phase === 'metadata' ? [expected] : []); expect(s.f.sessions.data.get(s.metadataKey)).toBe(before);
    if (phase === 'profile') expect(s.f.sessions.data.get(profileKey)).toBe(oldProfile);
    expect(s.owner.data.get('identityMembers')).toEqual(JSON.parse(expected));
    expect((s.owner.data.get('affinity') as AffinityRecord).reflex.dims.line.Tabby.s).toBe(5);
    const erasure = s.erase().then(result => { erased = true; return result; });
    await queued.promise; await Promise.resolve();
    expect(erased).toBe(false);
    release.release();
    expect(await imported).toMatchObject({ applied: 2, shoppers: 1 });
    expect(publications).toEqual([expected]);
    const result = await erasure;
    expect(result, JSON.stringify(result)).toMatchObject({ httpStatus: 200, localComplete: true });
    s.absent();
    const receipt = [...s.owner.data].find(([key]) => key.startsWith('identityErasure:'))![1] as {
      continuationEpoch: string; canonical: { subject: string; epoch: string; shopperHash: string; pointer: string | null; session: { serializedDigest: string } | null };
    };
    expect(receipt.canonical).toMatchObject({ subject: s.own.person.subject, epoch: s.own.person.authorityEpoch,
      pointer: host === 'session' ? s.own.person.sessionId : null });
    expect(receipt.continuationEpoch).toBe((s.owner.data.get('grantAuthority') as { epoch: string }).epoch);
    if (host === 'session') {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(profiles.at(-1)!));
      expect(receipt.canonical.session?.serializedDigest).toBe([...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join(''));
      expect(JSON.stringify(receipt)).not.toContain(profiles.at(-1)!);
    } else { expect(profiles).toEqual([]); expect(receipt.canonical.session).toBeNull(); }
    const barrier = structuredClone([...s.owner.data]), kv = [...s.f.sessions.data], r2 = [...s.records];
    await s.f.drain();
    expect([...s.owner.data]).toEqual(barrier); expect([...s.f.sessions.data]).toEqual(kv); expect([...s.records]).toEqual(r2);
  });

  it.each(['session', 'do'])('refuses prepared history metadata after erasure and preserves a real successor on %s', async host => {
    const s = await setup(host), entered = gate(), release = gate(), namespace = s.f.env.SHOPPER_REFLEX;
    let captured: Record<string, unknown> | undefined;
    s.f.env.SHOPPER_REFLEX = { idFromName: namespace.idFromName.bind(namespace), get: (id: DurableObjectId) => {
      const stub = namespace.get(id);
      return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname === '/identity/import') {
          captured = await request.clone().json() as Record<string, unknown>;
          entered.release(); await release.promise;
        }
        return stub.fetch(request);
      } };
    } } as unknown as DurableObjectNamespace;
    const imported = applyHistory(s.f.env, 'meridian', s.rows, s.now).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    expect(captured).toMatchObject({ shopperId: s.own.person.subject, history: true });
    expect(s.owner.data.get('identityImport:' + captured!.operationId)).not.toHaveProperty('result');
    expect(await s.erase()).toMatchObject({ httpStatus: 200, localComplete: true }); s.absent();
    const barrier = structuredClone([...s.owner.data]), kv = [...s.f.sessions.data], r2 = [...s.records];
    release.release(); expect(await imported).toHaveProperty('error');
    expect([...s.owner.data]).toEqual(barrier); expect([...s.f.sessions.data]).toEqual(kv); expect([...s.records]).toEqual(r2);
    s.f.env.SHOPPER_REFLEX = namespace;
    const successor = await s.mint();
    expect(successor.person.subject).toBe(s.own.person.subject);
    expect(successor.person.authorityEpoch).not.toBe(s.own.person.authorityEpoch);
    const current = structuredClone([...s.owner.data]), currentKV = [...s.f.sessions.data];
    await expect(s.internal('/identity/import', captured)).rejects.toThrow();
    await expect(s.internal('/identity/import/result', { operationId: captured!.operationId })).rejects.toThrow();
    expect([...s.owner.data]).toEqual(current); expect([...s.f.sessions.data]).toEqual(currentKV);
    expect(s.foreignState()).toEqual(s.protectedBefore);
  });

  it.each(['session', 'do'])('recovers exact history metadata once after lost publication acknowledgement and never after erasure on %s', async host => {
    const s = await setup(host), namespace = s.f.env.SHOPPER_REFLEX, original = s.f.sessions.data.get(s.metadataKey)!;
    const operations: Array<Record<string, unknown>> = [], publications: string[] = [];
    let fault: 'accepted' | 'pending' | null = 'accepted', blockRecovery = true;
    s.f.env.SHOPPER_REFLEX = { idFromName: namespace.idFromName.bind(namespace), get: (id: DurableObjectId) => {
      const stub = namespace.get(id);
      return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init), path = new URL(request.url).pathname;
        if (path === '/identity/import') operations.push(await request.clone().json() as Record<string, unknown>);
        if (path === '/identity/import/result' && blockRecovery) throw new Error('Synthetic unavailable result acknowledgement');
        return stub.fetch(request);
      } };
    } } as unknown as DurableObjectNamespace;
    const put = s.f.sessions.put.bind(s.f.sessions);
    s.f.sessions.put = async (key, value) => {
      if (key === s.metadataKey) {
        publications.push(value);
        if (fault) { const selected = fault; fault = null; if (selected === 'accepted') await put(key, value); throw new Error('Synthetic metadata publication acknowledgement'); }
      }
      return put(key, value);
    };
    await expect(applyHistory(s.f.env, 'meridian', s.rows, s.now)).rejects.toThrow();
    const first = operations[0], expected = JSON.stringify({ ...JSON.parse(original), history: { rows: 2, latestAt: s.now, appliedAt: s.now } });
    expect(first).toMatchObject({ history: true, shopperId: s.own.person.subject });
    expect(s.f.sessions.data.get(s.metadataKey)).toBe(expected);
    expect(s.owner.data.get('identityImport:' + first.operationId)).toMatchObject({ published: false, history: true, result: { applied: 2 } });
    s.owner.shopper = new ShopperReflex(s.owner.state, s.f.env);
    blockRecovery = false;
    expect(await (await s.internal('/identity/import/result', { operationId: first.operationId })).json()).toMatchObject({ applied: 2 });
    expect(s.f.sessions.data.get(s.metadataKey)).toBe(expected);
    expect(publications).toEqual([expected, expected]);
    const accepted = structuredClone([...s.owner.data]), acceptedKV = [...s.f.sessions.data];
    expect((await s.internal('/identity/import/result', { operationId: first.operationId })).status).toBe(200);
    expect([...s.owner.data]).toEqual(accepted); expect([...s.f.sessions.data]).toEqual(acceptedKV); expect(publications).toHaveLength(2);
    fault = 'pending'; blockRecovery = true;
    await expect(applyHistory(s.f.env, 'meridian', s.rows, s.now + 1)).rejects.toThrow();
    const second = operations[1];
    expect(second.operationId).not.toBe(first.operationId);
    expect(s.owner.data.get('identityMembers')).toMatchObject({ history: { rows: 4 } });
    expect(s.f.sessions.data.get(s.metadataKey)).toBe(expected);
    expect(await s.erase()).toMatchObject({ httpStatus: 200, localComplete: true }); s.absent();
    s.owner.shopper = new ShopperReflex(s.owner.state, s.f.env);
    const barrier = structuredClone([...s.owner.data]), erasedKV = [...s.f.sessions.data], attempts = publications.length;
    for (const operation of operations) await expect(s.internal('/identity/import/result', { operationId: operation.operationId })).rejects.toThrow();
    expect([...s.owner.data]).toEqual(barrier); expect([...s.f.sessions.data]).toEqual(erasedKV); expect(publications).toHaveLength(attempts);
    s.f.env.SHOPPER_REFLEX = namespace;
    const successor = await s.mint(), current = structuredClone([...s.owner.data]), currentKV = [...s.f.sessions.data], currentAttempts = publications.length;
    expect(successor.person.authorityEpoch).not.toBe(s.own.person.authorityEpoch);
    await expect(s.internal('/identity/import', second)).rejects.toThrow();
    expect([...s.owner.data]).toEqual(current); expect([...s.f.sessions.data]).toEqual(currentKV); expect(publications).toHaveLength(currentAttempts);
    expect(s.foreignState()).toEqual(s.protectedBefore);
  });

  it.each(['session', 'do'])('retains immutable history metadata cutoff receipts across lost begin replies and root CAS recovery on %s', async host => {
    for (const fault of ['begin-reply', 'root-reject', 'root-lost-ack']) {
      const s = await setup(host);
      expect(await applyHistory(s.f.env, 'meridian', s.rows, s.now)).toMatchObject({ applied: 2 });
      const jobKey = await erasureJobKey('meridian', { shopperId: s.own.person.subject }), namespace = s.f.env.SHOPPER_REFLEX;
      const storage = s.f.env.STORAGE as unknown as { put: (key: string, body: string, options?: unknown) => Promise<unknown> };
      const put = storage.put.bind(storage);
      let hit = false, adopted: string | undefined, beginBody: Record<string, unknown> | undefined;
      s.f.env.SHOPPER_REFLEX = { idFromName: namespace.idFromName.bind(namespace), get: (id: DurableObjectId) => {
        const stub = namespace.get(id);
        return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          if (new URL(request.url).pathname === '/identity/erase/begin') beginBody ??= await request.clone().json() as Record<string, unknown>;
          const response = await stub.fetch(request);
          if (fault === 'begin-reply' && !hit && new URL(request.url).pathname === '/identity/erase/begin') {
            hit = true; throw new Error('Synthetic accepted begin reply loss');
          }
          return response;
        } };
      } } as unknown as DurableObjectNamespace;
      storage.put = async (key, value, options) => {
        if (key === jobKey && JSON.parse(value).sources?.highWater !== null && JSON.parse(value).sources?.highWater !== undefined) {
          adopted = value;
          if (!hit && fault !== 'begin-reply') {
            hit = true; if (fault === 'root-lost-ack') await put(key, value, options);
            throw new Error('Synthetic canonical root CAS acknowledgement');
          }
        }
        return put(key, value, options);
      };
      expect(await s.erase(), fault).toMatchObject({ httpStatus: 503, localComplete: false }); expect(hit).toBe(true);
      const [receiptKey, receipt] = [...s.owner.data].find(([key]) => key.startsWith('identityErasure:'))!;
      const originalReceipt = structuredClone(receipt), erasureId = receiptKey.slice('identityErasure:'.length);
      s.owner.shopper = new ShopperReflex(s.owner.state, s.f.env);
      const calls = [...s.f.sessions.calls];
      expect(beginBody).toMatchObject({ erasureId, canonical: 1 });
      const replay = await (await s.internal('/identity/erase/begin', beginBody)).json();
      expect(replay).toEqual({ ok: true, highWater: 1, canonical: (receipt as { canonical: unknown }).canonical });
      expect(s.f.sessions.calls).toEqual(calls); expect(s.owner.data.get(receiptKey)).toEqual(originalReceipt);
      const changed = structuredClone(beginBody!) as { discovered: { shopperHash: string } };
      changed.discovered.shopperHash = '0'.repeat(64);
      const preserved = structuredClone([...s.owner.data]), preservedKV = [...s.f.sessions.data];
      await expect(s.internal('/identity/erase/begin', changed)).rejects.toThrow();
      expect([...s.owner.data]).toEqual(preserved); expect([...s.f.sessions.data]).toEqual(preservedKV);
      if (adopted) expect(JSON.parse(adopted).base.canonical).toEqual((receipt as { canonical: unknown }).canonical);
      // New digest authority is not a legacy cursor format. Corruption must be
      // rejected before an object call, KV write, or controller checkpoint.
      const root = s.records.get(jobKey)!, parsed = JSON.parse(root);
      const canonical = (receipt as { canonical: { session: unknown } }).canonical;
      const base = { ...parsed.base, canonical, ...(canonical.session ? { sessions: [canonical.session] } : {}) };
      for (const version of [1, 2, 3, 4, 5]) {
        const malformed = structuredClone(version < 3 ? { ...base, version } : { ...parsed, version, base });
        if (version === 1) { delete malformed.cacheKeys; delete malformed.bindings.cache; }
        if (version === 3) for (const key of ['sources', 'sessionScan', 'nextSessionPage', 'sessionCleanupCursor', 'sessionSteps', 'sessionCompacting']) delete malformed[key];
        if (version === 4) delete malformed.sources;
        expect((version < 3 ? malformed : malformed.base).bindings.cache).toBe(version === 1 ? undefined : true);
        expect(base.bindings.cache).toBe(true); // v1 shaping cannot invalidate later legacy controls
        s.records.set(jobKey, JSON.stringify(malformed));
        const objects = structuredClone([...s.owner.data]), kv = [...s.f.sessions.data], r2 = [...s.records], effects = [...s.f.effects];
        expect(await s.erase(), host + ':' + version).toMatchObject({ httpStatus: 503, localComplete: false });
        expect([...s.owner.data]).toEqual(objects); expect([...s.f.sessions.data]).toEqual(kv);
        expect([...s.records]).toEqual(r2); expect(s.f.effects).toEqual(effects);
      }
      s.records.set(jobKey, root);
      expect(await s.erase(), fault).toMatchObject({ httpStatus: 200, localComplete: true }); s.absent();
      expect(s.owner.data.get(receiptKey)).toEqual(originalReceipt);
      const old = structuredClone(s.owner.data.get(receiptKey)) as { canonical?: unknown };
      delete old.canonical; s.owner.data.set(receiptKey, old);
      const without = structuredClone([...s.owner.data]), remaining = [...s.f.sessions.data];
      await expect(s.internal('/identity/erase/begin', beginBody)).rejects.toThrow();
      expect([...s.owner.data]).toEqual(without); expect([...s.f.sessions.data]).toEqual(remaining);
      s.owner.data.set(receiptKey, originalReceipt);
      const successor = await s.mint(), current = structuredClone([...s.owner.data]), currentKV = [...s.f.sessions.data];
      expect(successor.person.authorityEpoch).not.toBe(s.own.person.authorityEpoch);
      expect(await (await s.internal('/identity/erase/begin', beginBody)).json()).toEqual(replay);
      expect([...s.owner.data]).toEqual(current); expect([...s.f.sessions.data]).toEqual(currentKV);
      expect(s.foreignState()).toEqual(s.protectedBefore);
    }
  });

  it('rejects changed raw bytes, forged aliases, scanned digests and byte-identical successor history metadata authority before effects', async () => {
    const s = await setup('session');
    expect(await applyHistory(s.f.env, 'meridian', s.rows, s.now)).toMatchObject({ applied: 2 });
    const jobKey = await erasureJobKey('meridian', { shopperId: s.own.person.subject });
    const storage = s.f.env.STORAGE as unknown as { put: (key: string, value: string, options?: unknown) => Promise<unknown> };
    const put = storage.put.bind(storage);
    let hit = false;
    storage.put = async (key, value, options) => {
      const result = await put(key, value, options);
      if (!hit && key === jobKey && JSON.parse(value).sources?.highWater === 1) { hit = true; throw new Error('Synthetic held root checkpoint'); }
      return result;
    };
    expect(await s.erase()).toMatchObject({ httpStatus: 503 }); expect(hit).toBe(true);
    const root = JSON.parse(s.records.get(jobKey)!), session = root.base.sessions.find((row: { userId: string }) => row.userId === s.own.person.subject);
    const key = tenantKey('meridian', 'session:' + session.sid), raw = s.f.sessions.data.get(key)!;
    expect(session.serialized).toBeUndefined(); expect(session.serializedDigest).toMatch(/^[0-9a-f]{64}$/);
    const effect = { job: root.base, erasureId: root.sources.erasureId, index: 0,
      step: { kind: 'session', id: session.sourceId, key: 'session:' + session.sid } };
    const unchanged = async (candidate: unknown) => {
      const data = structuredClone([...s.owner.data]), kv = [...s.f.sessions.data], r2 = [...s.records];
      await expect(s.internal('/identity/erase/effect', candidate)).rejects.toThrow();
      expect([...s.owner.data]).toEqual(data); expect([...s.f.sessions.data]).toEqual(kv); expect([...s.records]).toEqual(r2);
    };
    s.f.sessions.data.set(key, raw + ' '); // same parsed owner/SID, different exact bytes
    await unchanged(effect); s.f.sessions.data.set(key, raw);
    for (const change of ['digest', 'owner', 'receipt']) {
      const candidate = structuredClone(effect), row = candidate.job.sessions.find((value: { sid: string }) => value.sid === session.sid);
      if (change === 'digest') row.serializedDigest = '0'.repeat(64);
      if (change === 'owner') row.userId = 'sh_' + 'e'.repeat(32);
      if (change === 'receipt') candidate.job.canonical.erasureId = crypto.randomUUID();
      await unchanged(candidate);
    }
    const receiptKey = 'identityErasure:' + root.sources.erasureId, saved = s.owner.data.get(receiptKey)!;
    s.owner.data.set(receiptKey, { ...saved as object, canonical: { ...root.base.canonical, shopperHash: '0'.repeat(64) } });
    await unchanged(effect); s.owner.data.set(receiptKey, saved);
    // A valid-looking scanned capsule cannot introduce the new digest authority
    // before /erase/object. Its real scanner counterpart always has literal bytes.
    let pageKey: string | undefined;
    storage.put = async (selected, value, options) => {
      const result = await put(selected, value, options), page = JSON.parse(value);
      if (!pageKey && page.kind === 'sessions' && page.state === 'discovered') { pageKey = selected; throw new Error('Synthetic held session page'); }
      return result;
    };
    expect(await s.erase()).toMatchObject({ httpStatus: 503 }); expect(pageKey).toBeDefined();
    const pageBytes = s.records.get(pageKey!)!, page = JSON.parse(pageBytes);
    page.sessions = [{ owner: root.base.targets.find((target: { id: string }) => target.id === s.own.person.subject),
      session: { ...session, sid: 'a-extra-sid', sourceId: s.own.person.subject } }];
    s.records.set(pageKey!, JSON.stringify(page));
    const effects = [...s.f.effects], data = structuredClone([...s.owner.data]), kv = [...s.f.sessions.data], records = [...s.records];
    expect(await s.erase()).toMatchObject({ httpStatus: 503, localComplete: false });
    expect(s.f.effects).toEqual(effects); expect([...s.owner.data]).toEqual(data);
    expect([...s.f.sessions.data]).toEqual(kv); expect([...s.records]).toEqual(records);
    s.records.set(pageKey!, pageBytes);
    expect(await s.erase()).toMatchObject({ httpStatus: 200, localComplete: true }); s.absent();
    const successor = await s.mint();
    const replacement = await issueSessionCapability(s.f.env, { tenant: 'meridian', subject: successor.person.subject,
      sessionId: session.sid, kind: 'recognized', grantId: crypto.randomUUID(), authorityEpoch: successor.person.authorityEpoch });
    const principal = await verifySessionCapability(s.f.env, replacement.capability, 'meridian');
    s.owner.data.set('grantAuthority', { version: 1, epoch: principal.authorityEpoch, grants: { [principal.grantId!]: principal } });
    s.owner.data.set('pipeline', { ...s.owner.data.get('pipeline') as PipelineRecord, sessionId: session.sid });
    s.f.sessions.data.set(key, raw);
    s.f.sessions.data.set(tenantKey('meridian', 'user:' + successor.person.subject), session.sid);
    s.owner.shopper = new ShopperReflex(s.owner.state, s.f.env);
    await unchanged(effect);
    s.f.sessions.data.delete(key); // absence also cannot authorize the old epoch's effect
    await unchanged(effect);
    expect(s.foreignState()).toEqual(s.protectedBefore);
  });
});
