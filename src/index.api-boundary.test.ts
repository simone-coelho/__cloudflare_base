import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { SignJWT, generateKeyPair, exportJWK, decodeJwt } from 'jose';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { outcomeFromAction, ts36 } from '@/ledger/records';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { CUSTOMER_ASSETS, CUSTOMER_OMITTED_BINDINGS, CUSTOMER_ROUTES, customerRequest } from '@/customerBoundary';
import { captureRetention, type RetentionEnv } from '@/retention';
import { shopperObjectName } from '@/tenancy/objects';
import { DEFAULT_STATS, emptyStats, recordExposure } from '@/learn/stats';
import { LEARN_LIMITS } from '@/durable-objects/LearnStats';
import { learningEffectId } from '@/ledger/recovery';
import type { Env } from '@/types/env';

// Exercise the real Worker export, Hono, JWT verifier and StateManager in workerd.
// Bindings/data are synthetic. W09.06 parses only the explicit local manifest;
// no Wrangler binding/secret loading, config redirection or disk stores are used.
const SECRET = 'w0102-local-synthetic-signing-material';
const PRIVATE = 'W0102_PRIVATE_VALUE';
const MARKER = 'W0102_REQUEST_MARKER';
const CACHE_KEY = 't:globex:private:catalog';
const STORAGE_KEY = 'globex/2026-09-06/13/decisions/private.ndjson';
const STATE_KEY = 't:globex:private-state';
const readyIdentity = { identitySecrets: 'acme:0123456789ABCdefghijkLMNOPqrstUVWX,globex:ZYXwvutsRQPONmlkjIHGFedcba98765432', auditSalt: 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuV' };
it('W07.05 declares distinct desired datasets and disables persistent invocation logs without live attestation', () => {
  const manifest = readFileSync('wrangler.toml', 'utf8');
  expect([...manifest.matchAll(/^dataset\s*=\s*"([^"]+)"/gm)].map(match => match[1])).toEqual(['edge_ops_development_v1', 'edge_ops_staging_v1', 'edge_ops_production_v1']);
  expect(manifest).toMatch(/\[observability\]\s*\nenabled = false\s*\nhead_sampling_rate = 0/);
  expect(manifest).toMatch(/\[observability\.logs\]\s*\nenabled = false\s*\ninvocation_logs = false/);
});
const nativeRetention = JSON.stringify({ version: 1, tenants: Object.fromEntries(['acme', 'globex'].map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, { id: 'native-fixture-' + category,
    revision: 1, durationMs: 30 * 86400_000, basis: 'admitted', renewal: 'new-record-only' }]))])) });

type Probe = {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  mode?: string;
  profile?: string;
  absentProfile?: boolean;
  forbiddenBinding?: typeof CUSTOMER_OMITTED_BINDINGS[number];
  mountedRoutes?: boolean;
  seedAudiences?: boolean;
  authoredAudience?: boolean;
  queue?: unknown[];
  queuePositions?: boolean;
  failStoragePut?: boolean;
  failAck?: boolean;
  cachedScene?: boolean;
  scheduled?: string;
  failScheduled?: boolean;
  malformedAggregate?: boolean;
  shopperHost?: 'session' | 'do';
  tenantManifest?: unknown;
  retention?: string;
  absentManifest?: boolean;
  requestHost?: string;
  recoverErasure?: boolean;
  shopperCapability?: { tenant: string; subject: string; sessionId: string };
  sdkKeys?: string;
  identitySecrets?: string;
  identityProof?: { secret: string; tenant: string; accountId: string };
  readBack?: string;
  readBackBody?: string;
  readBackCookie?: string;
  sharedConnectors?: boolean;
  reflexHost?: 'session' | 'do';
  operatorDiagnostics?: boolean;
  sharedDiagnostics?: boolean;
  requestCf?: Record<string, string>;
  subjectAuditFailure?: 'admitted' | 'result' | 'read';
  auditSalt?: string;
  publicationTenant?: string;
  subjectOperations?: boolean;
  customerAuthorityTenant?: string;
  customerCredentialState?: 'revoked' | 'unregistered';
  recovery?: boolean;
  recoveryAfterQueue?: boolean;
  recoveryUnknownPolicy?: boolean;
  recoveryOwner?: boolean;
  recoveryRole?: 'admin' | 'operator' | 'none';
};
type Result = {
  status: number;
  body: string;
  headers: Record<string, string>;
  calls: string[][];
  envAccess: string[];
  logs: string[];
  before: unknown;
  after: unknown;
  pending: number;
  bodyReads?: number;
};

// Kept in this file so independent reviewers can replay the complete fixture.
// This wrapper accepts JSON over the local test transport and then constructs a
// real Request for worker.fetch. It never substitutes an application router.
const wrapper = `
import worker, { StateManager, ShopperReflex as NativeShopperReflex, PersonalizationWebSocket as NativeRelay, RegionTrend as NativeTrend, W0108_MOUNTED_ROUTES } from './src/index.ts';
import { runSynthetic } from './src/ops/synthetic.ts';
import { connectorDigest } from './src/connectors/config.ts';
import { checkProductSchema } from './src/ops/monitor.ts';
import { LearnStats as NativeLearnStats } from './src/durable-objects/LearnStats.ts';
import { DecisionRing as NativeDecisionRing } from './src/durable-objects/DecisionRing.ts';
export { RateLimiter } from './src/durable-objects/RateLimiter.ts';
let w12Mode = '', w12Offset = 0, w12CleanupReject = false, w12Gate, w12ValidationGate, w12ObserveGate, w12ControlGate, w12Deletes = 0;
let w15Hold = false;
const w12Clock = Date.now.bind(Date);
Date.now = () => w12Clock() + w12Offset;
const w12Environments = new WeakMap();
async function w12Wait(gate) { gate.entered = true; await new Promise(resolve => { gate.release = resolve; }); }
function w12State(state, env) {
  if (env.W12_FIXTURE !== 'true' && env.W15_FIXTURE !== 'true') return state;
  if (env.W12_CLOCK_OFFSET) w12Offset = Number(env.W12_CLOCK_OFFSET);
  const alarmTarget = target => new Proxy(target, { get(target, key) {
    if (key === 'put' && env.W15_FIXTURE === 'true') return async (...args) => {
      const result = await target.put(...args);
      if (w15Hold && typeof args[0] === 'string' && args[0].startsWith('recoveryLogical:')) {
        w15Hold = false; await env.W15_OBSERVER.fetch('https://fixture/recovery-transaction', { method: 'POST' });
      }
      return result;
    };
    if (key === 'setAlarm' && env.W12_ALARM_FAILURE === 'set') return async () => { throw new Error('Synthetic alarm persistence unavailable'); };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const storage = new Proxy(state.storage, { get(target, key) {
    if (key === 'get' && env.W12_INIT_FAILURE === 'true') return async (...args) => {
      if (args[0] === 'connections') throw new Error('Synthetic ordinary initialization failure'); return target.get(...args);
    };
    if (key === 'setAlarm' && env.W12_ALARM_FAILURE === 'set') return async () => { throw new Error('Synthetic alarm persistence unavailable'); };
    if (key === 'transaction') return async callback => {
      const old = await target.get('__monitor_authority_v1');
      const value = await target.transaction(tx => callback(alarmTarget(tx)));
      const retained = await target.get('__monitor_authority_v1');
      if (w12Mode === 'replace-after' && old && retained && old.call.value.scope.value.operation !== retained.call.value.scope.value.operation)
        throw new Error('Synthetic replacement committed acknowledgement lost');
      return value;
    };
    if (key === 'put') return async (...args) => {
      const keys = typeof args[0] === 'string' ? [args[0]] : Object.keys(args[0]);
      const sentinel = keys.some(key => key.endsWith('/monitor-sentinel'));
      if (sentinel && w12Mode === 'native-before') throw new Error('Synthetic before native write');
      const value = await target.put(...args);
      if (sentinel && w12Mode === 'native-after') throw new Error('Synthetic committed native acknowledgement lost');
      return value;
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  return new Proxy(state, { get(target, key) { if (key === 'storage') return storage;
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
}
function w12Track(object) {
  object.fixtureWork = 0; object.fixtureResets = 0;
  const boundary = object.synthetic, run = boundary?.run.bind(boundary), reset = boundary?.reset.bind(boundary);
  if (boundary) {
    boundary.run = (request, work) => run(request, () => { object.fixtureWork++; return work(); });
    boundary.reset = () => { object.fixtureResets++; return reset(); };
  }
}
function w12Environment(env) {
  if (env.W12_FIXTURE !== 'true') return env;
  let wrapped = w12Environments.get(env); if (wrapped) return wrapped;
  wrapped = Object.create(env);
  Object.defineProperty(wrapped, 'RETENTION', { get() { return w12Mode === 'revoked' ? undefined : env.RETENTION; } });
  Object.defineProperty(wrapped, 'LEDGER_RECOVERY_ENABLED', { get() { return w12Mode === 'disabled' ? 'false' : env.LEDGER_RECOVERY_ENABLED; } });
  if (env.LEARN_STATS) Object.defineProperty(wrapped, 'LEARN_STATS', { value: {
    idFromName: name => env.LEARN_STATS.idFromName(name), get: id => ({ async fetch(...args) {
      const response = await env.LEARN_STATS.get(id).fetch(...args);
      if (String(args[0]?.url ?? args[0]).endsWith('/monitor-effects') && w12ObserveGate && !w12ObserveGate.entered) {
        await w12Wait(w12ObserveGate);
      }
      return response;
    } }),
  } });
  if (env.EVENT_QUEUE) Object.defineProperty(wrapped, 'EVENT_QUEUE', { value: {
    async send(...args) {
      if (w12Mode === 'queue-rejected') throw new Error('Synthetic source unavailable');
      if (w12Mode === 'queue-empty') return;
      return env.EVENT_QUEUE.send(...args);
    },
    async sendBatch(messages) { for (const message of messages) await this.send(message.body); },
  } });
  for (const binding of ['STORAGE', 'CACHE']) Object.defineProperty(wrapped, binding, { value: new Proxy(env[binding], { get(target, key) {
    if (key === 'get') return async (...args) => {
      if (binding === 'STORAGE' && args[0].startsWith('config-publication/') && w12ValidationGate && !w12ValidationGate.entered) {
        await w12Wait(w12ValidationGate);
      }
      return target.get(...args);
    };
    if (key === 'put') return async (...args) => {
      if (binding === 'STORAGE' && args[0].endsWith('/control.json') && w12ControlGate && !w12ControlGate.entered
        && JSON.parse(args[1]).result?.failedStage === 'observation') {
        await w12Wait(w12ControlGate);
      }
      if (w12Mode === 'dlq-failed' && binding === 'STORAGE' && args[0].includes('/monitor-dlq/')) throw new Error('Synthetic DLQ unavailable');
      if (w12Mode === 'archive' && binding === 'STORAGE' && args[0].includes('/data/') && args[0].includes('/lift/')) throw new Error('Synthetic archive refusal');
      if (w12Mode === 'lift' && binding === 'CACHE' && args[0].includes('/data/') && args[0].includes('/lift:')) throw new Error('Synthetic lift refusal');
      if (binding === 'STORAGE' && args[0].includes('/data/') && w12Gate?.kind === 'write' && !w12Gate.entered) {
        await w12Wait(w12Gate); await target.put(...args); throw new Error('Synthetic committed acknowledgement lost');
      }
      return target.put(...args);
    };
    if (key === 'delete') return async (...args) => {
      const keys = Array.isArray(args[0]) ? args[0] : [args[0]];
      if (keys.some(key => key.includes('/data/'))) {
        if (binding === 'STORAGE') w12Deletes++;
        if (w12CleanupReject || env.W12_CLEANUP_FAILURE === 'true') throw new Error('Synthetic disposal unavailable');
        if (binding === 'STORAGE' && w12Gate?.kind === 'delete' && !w12Gate.entered) {
          await w12Wait(w12Gate);
        }
      }
      return target.delete(...args);
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } }) });
  w12Environments.set(env, wrapped); return wrapped;
}
async function w12NativeFixture(object, request) {
  const path = new URL(request.url).pathname;
  if (path === '/__w12/state') return Response.json({ entries: [...await object.fixtureState.storage.list()], alarm: await object.fixtureState.storage.getAlarm(), work: object.fixtureWork, resets: object.fixtureResets });
  if (path === '/__w12/wake') { await object.fixtureState.storage.setAlarm(w12Clock() + 1); return Response.json({ scheduled: true }); }
  if (path === '/__w12/drop-alarm') { await object.fixtureState.storage.deleteAlarm(); return Response.json({ removed: true }); }
  if (path === '/__w12/write') {
    try { return await object.synthetic.run(request, async () => {
      await object.state.storage.put('monitor-sentinel', await request.json()); return Response.json({ saved: true });
    }); } catch { return Response.json({ saved: false }, { status: 503 }); }
  }
  return null;
}
export class PersonalizationWebSocket extends NativeRelay {
  constructor(state, env) { state = w12State(state, env); super(state, w12Environment(env)); this.fixtureState = state; w12Track(this); }
  async fetch(request) { return await w12NativeFixture(this, request) ?? super.fetch(request); }
}
export class RegionTrend extends NativeTrend {
  constructor(state, env) { state = w12State(state, env); super(state, w12Environment(env)); this.fixtureState = state; w12Track(this); }
  async fetch(request) { return await w12NativeFixture(this, request) ?? super.fetch(request); }
}
async function learningFixture(object, request) {
  const body = await request.json(), storage = object.fixtureState.storage;
  if (body.action === 'seed') { for (const [key, value] of body.entries) await storage.put(key, value); return Response.json({ ok: true }); }
  if (body.action === 'fault') { object.fault.mode = body.mode; return Response.json({ ok: true }); }
  if (body.action === 'limit') {
    try { await storage.put('synthetic-limit-probe', 'x'.repeat(body.bytes)); await storage.delete('synthetic-limit-probe'); return Response.json({ accepted: true }); }
    catch (error) { return Response.json({ accepted: false, error: String(error).slice(0, 400) }); }
  }
  const entries = [...await storage.list()], learn = entries.find(([key]) => key === 'learn')?.[1], ring = entries.find(([key]) => key === 'ring')?.[1];
  return Response.json({ keys: entries.map(([key]) => key), bytes: entries.reduce((n, [key, value]) => n + new TextEncoder().encode(JSON.stringify(value)).length + key.length, 0),
    events: learn?.stats.events, root: learn?.stats.slot['*']?.n.s, items: Object.keys(learn?.stats.items ?? {}).length,
    accounted: Object.values(learn?.stats.items ?? {}).reduce((n, map) => n + (map['*']?.n.s ?? 0), learn?.stats.bounded?.omitted.n.s ?? 0),
    depth: learn?.stats.bounded?.depth, effects: Object.keys(learn?.effects ?? {}).length, retiredEffects: Object.keys(learn?.retiredEffects ?? {}).length,
    ring: ring?.ring.length, index: ring?.index.length });
}
export class LearnStats extends NativeLearnStats {
  constructor(state, env) {
    state = w12State(state, env);
    const fault = { mode: '' }, storage = new Proxy(state.storage, { get(target, key) {
      if (key === 'put') return async (...args) => { const mode = args[0] === 'learn' ? fault.mode : ''; if (mode) fault.mode = '';
        if (mode === 'before') throw new Error('Synthetic before commit'); const result = await target.put(...args);
        if (mode === 'after') throw new Error('Synthetic committed response loss'); return result; };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    super(new Proxy(state, { get(target, key) { if (key === 'storage') return storage; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } }), w12Environment(env));
    this.fixtureState = state; this.fault = fault; w12Track(this);
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const monitoring = await w12NativeFixture(this, request); if (monitoring) return monitoring;
    if (path === '/__learning_fixture') return learningFixture(this, request);
    if (path === '/health' && this.fault.mode === 'hold-health') await new Promise(resolve => setTimeout(resolve, 500));
    return super.fetch(request);
  }
}
export class DecisionRing extends NativeDecisionRing {
  constructor(state, env) { state = w12State(state, env); super(state, w12Environment(env)); this.fixtureState = state; this.fault = { mode: '' }; w12Track(this); }
  async fetch(request) { return await w12NativeFixture(this, request) ?? (new URL(request.url).pathname === '/__learning_fixture' ? learningFixture(this, request) : super.fetch(request)); }
}
import { issueSessionCapability, verifySessionCapability, newAnonymousSession } from './src/identity/sessionCapability.ts';
import { admitOwnerPrincipal, dispatchOwnedRequest, runOwnerOperation, ownerEnvironment } from './src/identity/sessionAuthority.ts';
import { currentLiftWitness } from './src/learn/fan.ts';
import { storedConsent, CONSENT_LIFETIME_MS } from './src/content/consent.ts';
import { signAssertion } from './src/identity/assertion.ts';
import { shopperObjectName } from './src/tenancy/objects.ts';
import { invalidateTrendCache } from './src/reflex/regionTrend.ts';
import { invalidateCache } from './src/config/versionedStore.ts';
import { clearBhExperimentMemo } from './src/demos/brighthour/experiment.ts';
import { writeReflexConfig, reflexScopeForTenant, REFLEX_KIND } from './src/reflex/configStore.ts';
import { DEFAULT_REFLEX_CONFIG } from './src/reflex/core.ts';
import { memoryStore } from './src/auth/store.ts';
import { memoryAuthority } from './src/auth/authority.ts';
import { tokenHash } from './src/auth/accounts.ts';
import { decodeJwt } from 'jose';
import { initializePublication, initializePublicationSet, pinPublication, invalidatePublicationCache } from './src/config/publication.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND, DEFAULT_LEARN } from './src/content/kinds.ts';
import { PRIORS_KIND } from './src/learn/priors.ts';
import { ensureAudiencesSeeded } from './src/services/RealtimeSegmentEngine.ts';
import { eraseVisitorLedger, rewriteTenantErasures, writeTombstone } from './src/ledger/erasure.ts';
import { eraseSubject } from './src/identity/erase.ts';
import { enqueueDecisions } from './src/ledger/enqueue.ts';
function nativeLedgerEnvironment(env) {
  if (!env.W0612_OBSERVER) return env;
  const storage = new Proxy(env.STORAGE, { get(target, key) {
    if (key === 'put') return async (...args) => {
      await env.W0612_OBSERVER.fetch('http://observer/before-put', { method: 'POST', body: JSON.stringify({ key: args[0] }) });
      return target.put(...args);
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { ...env, STORAGE: storage };
}
// Synthetic storage setup only. Every tested socket/frame still enters the
// unchanged native object and its exact durable-grant validation.
export class ShopperReflex extends NativeShopperReflex {
  constructor(state, env) { state = w12State(state, env); super(state, w12Environment(nativeLedgerEnvironment(env))); this.fixtureState = state; w12Track(this); }
  async fetch(request) {
    const monitoring = await w12NativeFixture(this, request); if (monitoring) return monitoring;
    if (new URL(request.url).pathname === '/__fixture_expired_choice') {
      const saved = await this.fixtureState.storage.get('consent');
      if (!saved || saved.version !== 1) throw new Error('Missing explicit choice fixture');
      for (const key of ['tracking', 'personalization']) saved[key] = { value: true, chosenAt: Date.now() - 30 * 86400000 - 1, expiresAt: Date.now() - 1 };
      await this.fixtureState.storage.put('consent', saved); this.consent = undefined;
      return new Response(null, { status: 204 });
    }
    if (new URL(request.url).pathname === '/__fixture_grants') {
      const grants = await request.json();
      const authority = await this.fixtureState.storage.get('grantAuthority');
      if (!authority || grants.some(grant => grant.authorityEpoch !== authority.epoch)) throw new Error('Fixture grant epoch mismatch');
      for (const grant of grants) authority.grants[grant.grantId] = grant;
      await this.fixtureState.storage.put('grantAuthority', authority);
      return new Response(null, { status: 204 });
    }
    return super.fetch(request);
  }
}
export default {
  async queue(batch, env, ctx) {
    const logs = [];
    globalThis.__W0102_LOGS__ = logs;
    if (env.W12_FIXTURE === 'true' && w12Mode === 'queue-paused') batch.messages.forEach(message => message.retry());
    else await worker.queue(batch, w12Environment(env), ctx);
    await env.W0906_OBSERVER.fetch('http://observer/source', { method: 'POST', body: JSON.stringify({
      sink: 'source', queue: batch.queue, logs,
      messages: batch.messages.map(message => ({ body: message.body, attempts: message.attempts })),
    }) });
  },
  async fetch(transport, runtimeEnv, runtimeCtx) {
    if (runtimeEnv.W0108_ASSET_FIXTURE === 'true') return worker.fetch(transport, runtimeEnv, runtimeCtx);
    const input = await transport.json();
    if (input.w15) {
      if (input.w15 === 'hold') { w15Hold = true; return Response.json({ armed: true }); }
      if (input.w15 === 'clock') { w12Offset = input.offset; return Response.json({ offset: w12Offset }); }
      if (input.w15 === 'initialize') {
        for (const tenant of ['acme', 'globex']) {
          const revision = value => ({ revision: 1, value, actor: 'W15-local-fixture', note: '', at: Date.now() });
          await initializePublicationSet(runtimeEnv, [
            { kind: CONTENT_KIND, scope: tenant, revision: revision({ pieces: [{ id: 'native-render', customerContentId: 'cms-native', type: 'editorial', title: 'Local fixture', tags: { taste: ['fixture'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } }] }) },
            { kind: SLOTS_KIND, scope: tenant, revision: revision({ pages: { home: [{ slot: 'hero', take: 1, weights: { taste: 1 } }] } }) },
            { kind: LEARN_KIND, scope: tenant, revision: revision({ ...DEFAULT_LEARN, holdout: { share: 0, salt: 'fixture', arms: ['default'] }, slots: { hero: { measurementBasis: 'rendered-v1', gamma: 0, reward: 'click' } } }) },
            { kind: PRIORS_KIND, scope: tenant, revision: revision({ rows: [] }) },
            { kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant), revision: revision({ ...DEFAULT_REFLEX_CONFIG, dimensions: [{ key: 'taste', source: 'taste' }] }) },
          ], '0:' + crypto.randomUUID());
        }
        return Response.json({ initialized: true });
      }
      if (input.w15 === 'state') {
        const name = input.binding === 'SHOPPER_REFLEX' ? shopperObjectName(input.tenant, input.subject)
          : input.binding === 'DECISION_RING' ? input.tenant + ':' + input.subject : input.tenant + ':' + input.tenant + ':hero';
        return runtimeEnv[input.binding].get(runtimeEnv[input.binding].idFromName(name)).fetch('https://fixture/__w12/state');
      }
      const pending = [], response = await worker.fetch(new Request('https://operator.example' + input.path, {
        method: input.method ?? 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant': input.tenant, ...input.headers },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      }), runtimeEnv, { waitUntil(work) { pending.push(work); }, passThroughOnException() {} });
      const body = await response.text(); await Promise.all(pending);
      return Response.json({ status: response.status, body, headers: Object.fromEntries(response.headers) });
    }
    if (input.w14) {
      if (input.w14 === 'initialize') {
        for (const tenant of ['acme','globex']) await initializePublication(runtimeEnv,REFLEX_KIND,reflexScopeForTenant(tenant),
          {revision:1,value:{...DEFAULT_REFLEX_CONFIG,version:'native-search-'+tenant,eventAttributes:'event-when-unknown',
            dimensions:[{key:'style',source:'style'}]},at:Date.now(),actor:'native-fixture',note:''},'0:'+crypto.randomUUID());
        return Response.json({initialized:true});
      }
      if (input.w14 === 'session') return Response.json(await newAnonymousSession(runtimeEnv,input.tenant));
      if (input.w14 === 'erase') {
        let result=await eraseSubject(runtimeEnv,input.tenant,{visitorId:input.subject},'native-fixture');
        for(let attempt=0;attempt<20&&result.status==='pending';attempt++)result=await eraseSubject(runtimeEnv,input.tenant,{visitorId:input.subject},'native-fixture');
        return Response.json({status:result.httpStatus,localComplete:result.localComplete,complete:result.complete,phase:result.status});
      }
      const pending=[],response=await worker.fetch(new Request('https://'+input.tenant+'.example'+input.path,
        {method:input.body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Tenant':input.tenant,'X-SDK-Key':'native-site',
          'X-Shopper-Session':input.capability},...(input.body===undefined?{}:{body:JSON.stringify(input.body)})}),runtimeEnv,
        {waitUntil(work){pending.push(work);},passThroughOnException(){}});
      const body=await response.text();await Promise.all(pending);return Response.json({status:response.status,body});
    }
    if (input.w12) {
      if (input.w12 === 'gate') {
        if (input.action === 'arm') { const gate = { kind: input.kind, entered: false };
          if (input.kind === 'validation') w12ValidationGate = gate; else if (input.kind === 'observe') w12ObserveGate = gate;
          else if (input.kind === 'control') w12ControlGate = gate; else w12Gate = gate; invalidatePublicationCache(); }
        const selected = input.kind === 'validation' ? w12ValidationGate : input.kind === 'observe' ? w12ObserveGate : input.kind === 'control' ? w12ControlGate : w12Gate;
        if (input.action === 'release') selected?.release();
        if (input.cleanupReject !== undefined) w12CleanupReject = input.cleanupReject;
        return Response.json({ entered: selected?.entered ?? false, deletes: w12Deletes });
      }
      if (input.w12 === 'mode') { w12Mode = input.mode ?? ''; w12Offset = input.offset ?? w12Offset; return Response.json({ configured: true }); }
      if (input.w12 === 'renew') {
        const control = await (await runtimeEnv.STORAGE.get('ops-synthetic-v1/' + input.tenant + '/' + input.host + '/control.json')).json();
        const value = structuredClone(control.scope.value), delta = Date.now() - value.bornAt;
        value.operation = crypto.randomUUID(); value.sessionId = 's-' + value.operation;
        value.bornAt += delta; value.expiresAt += delta;
        for (const stamp of Object.values(value.retention)) { stamp.bornAt += delta; stamp.expiresAt += delta; }
        const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(runtimeEnv.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical(['isolated-monitor/v1', 'scope', runtimeEnv.JWT_ISSUER, runtimeEnv.JWT_AUDIENCE, value]))))].map(v => v.toString(16).padStart(2, '0')).join('');
        return Response.json({ value, signature });
      }
      if (input.w12 === 'native') {
        // Fixture-only signing uses the real operation captured by real serving.
        // Production still has no public synthetic admission/signing endpoint.
        const control = await (await runtimeEnv.STORAGE.get('ops-synthetic-v1/' + input.tenant + '/' + input.host + '/control.json')).json();
        if (input.scope) control.scope = input.scope;
        const scope = control.scope.value, binding = input.binding;
        const name = binding === 'LEARN_STATS' ? scope.tenant + ':' + scope.tenant + ':' + scope.slots[0]
          : binding === 'REGION_TREND' ? 'trend:v2:' + scope.tenant + ':US-NY'
          : binding === 'DECISION_RING' ? scope.tenant + ':' + scope.subject : shopperObjectName(scope.tenant, scope.subject);
        const writing = input.value !== undefined, url = writing ? 'https://native/__w12/write' : 'https://native/health';
        const body = writing ? JSON.stringify(input.value) : '', headers = writing ? { 'Content-Type': 'application/json' } : {};
        const value = { scope: control.scope, binding, name, url, method: writing ? 'POST' : 'GET', body: await connectorDigest(body),
          headers: await connectorDigest(JSON.stringify([...new Headers(headers)])), until: Math.min(scope.expiresAt, Date.now() + 10000) };
        const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(runtimeEnv.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical(['isolated-monitor/v1', 'native', runtimeEnv.JWT_ISSUER, runtimeEnv.JWT_AUDIENCE, value]))))].map(v => v.toString(16).padStart(2, '0')).join('');
        const target = runtimeEnv[binding], physical = 'ops-synthetic-v1/' + input.tenant + '/' + input.host + '/' + binding + '/' + (input.wrongPhysical ? 1 : 0);
        let response; try { response = await target.get(target.idFromName(physical)).fetch(input.wrongUrl ? 'https://native/snapshot' : url, {
          method: value.method, headers: { ...headers, ...(input.wrongOwner ? { 'X-Owner-Request-URL': 'https://native/authority/request' } : {}), 'X-Internal-Monitor': canonical({ value, signature }) }, ...(writing ? { body: input.wrongBody ? JSON.stringify('altered') : body } : {}),
        }); } catch { response = new Response(null, { status: 503 }); }
        return Response.json({ status: response.status });
      }
      if (input.w12 === 'initialize') {
        for (const tenant of ['acme', 'globex']) {
          const revision = value => ({ revision: 1, value, actor: 'W12.02-synthetic', note: '', at: 1 });
          await initializePublicationSet(runtimeEnv, [
            { kind: CONTENT_KIND, scope: tenant, revision: revision({ pieces: [{ id: 'synthetic-item', customerContentId: 'synthetic-item', type: 'editorial', title: 'Synthetic', tags: { taste: ['fixture'] }, slotTypes: ['hero'] }] }) },
            { kind: SLOTS_KIND, scope: tenant, revision: revision({ pages: { home: [{ slot: 'hero', take: 1, weights: { taste: 1 }, fatigue: { weight: 0.1, windowHours: 1, cap: 3 } }] } }) },
            { kind: LEARN_KIND, scope: tenant, revision: revision({ ...DEFAULT_LEARN, holdout: { share: 0.25, salt: 'synthetic', arms: ['default'] }, regional: { enabled: true, minEvents: 1, kBlend: 1 }, slots: { hero: { gamma: 1, reward: 'click' } } }) },
            { kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant), revision: revision({ ...DEFAULT_REFLEX_CONFIG, dimensions: [{ key: 'taste', source: 'taste' }] }) },
            { kind: PRIORS_KIND, scope: tenant, revision: revision({ rows: [] }) },
          ], '0:10000000-0000-4000-8000-000000000012');
        }
        return Response.json({ initialized: true });
      }
      if (input.w12 === 'schema') { try { await checkProductSchema(runtimeEnv); return Response.json({ ok: true }); } catch { return Response.json({ ok: false }); } }
      if (input.w12 === 'run') return Response.json(await runSynthetic(w12Environment(runtimeEnv), input.tenant, input.host));
      if (input.w12 === 'queue') {
        const positions = [];
        await worker.queue({ queue: input.queue, messages: input.bodies.map((body, index) => ({ body, id: 'synthetic-' + index,
          ack() { positions.push(['ack', index]); }, retry() { positions.push(['retry', index]); } })) }, w12Environment(runtimeEnv), runtimeCtx);
        return Response.json({ positions: positions.sort((a, b) => a[1] - b[1]) });
      }
    }
    if (input.learningConfiguration) {
      if (input.learningConfiguration === 'initialize') for (const tenant of ['acme', 'globex']) {
        await initializePublicationSet(runtimeEnv, [
          { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, value: DEFAULT_LEARN, actor: 'synthetic-native-baseline', note: '', at: 1 } },
          { kind: PRIORS_KIND, scope: tenant, revision: { revision: 1, value: { rows: [] }, actor: 'synthetic-native-baseline', note: '', at: 1 } },
        ], '0:10000000-0000-4000-8000-000000000001');
      }
      const set = await pinPublication(runtimeEnv, 'acme');
      return Response.json({ revision: set.revision, digest: set.digest, refs: set.refs });
    }
    if (input.learningRead === 'snapshot' || input.learningRead === 'publish') {
      const ns = runtimeEnv.LEARN_STATS, response = await ns.get(ns.idFromName('acme:acme:hero')).fetch('https://learn/' + input.learningRead, { method: 'POST', body: '{}' });
      const body = await response.text(), parsed = JSON.parse(body);
      return Response.json({ status: response.status, published: parsed.published, events: parsed.snapshot?.events,
        bytes: new TextEncoder().encode(body).length });
    }
    if (input.learningHealth) {
      const owner = {}, start = Date.now();
      const accepted = await runOwnerOperation(owner, runtimeEnv, () => currentLiftWitness(ownerEnvironment(owner, runtimeEnv), 'acme', 'acme', 'hero', input.learningHealth));
      return Response.json({ accepted, elapsedMs: Date.now() - start });
    }
    if (input.nativeLedger) {
      const operation = input.nativeLedger, env = nativeLedgerEnvironment(runtimeEnv), positions = [], pending = [];
      if (operation.action === 'erase') return Response.json(await eraseVisitorLedger(env, operation.tenant, operation.subject, 'native-fixture', operation.now));
      if (operation.action === 'rewrite') return Response.json(await rewriteTenantErasures(env, operation.tenant, { now: operation.now, retentionDays: 1, maxObjects: 100 }));
      if (operation.action === 'fallback') return Response.json(await enqueueDecisions({ ...env, EVENT_QUEUE: undefined, LEDGER_RECOVERY_ENABLED: 'true' }, operation.records));
      await worker.queue({ messages: operation.bodies.map((body, index) => ({ body, ack() { positions.push(['ack', index]); }, retry() { positions.push(['retry', index]); } })) }, env,
        { waitUntil(promise) { pending.push(Promise.resolve(promise)); } });
      for (const task of pending) await task;
      return Response.json({ positions });
    }
    if (input.mountedRoutes) return Response.json(W0108_MOUNTED_ROUTES);
    const calls = [], envAccess = [], logs = [], pending = [];
    const auditStore = memoryStore();
    globalThis.__W0102_LOGS__ = logs;
    const cache = new Map([
      [${JSON.stringify(CACHE_KEY)}, JSON.stringify({ value: ${JSON.stringify(PRIVATE)} })],
      ['t:acme:private:catalog', JSON.stringify({ value: 'ACME_PRIVATE_VALUE' })],
      ['trend:acme:US-NY', JSON.stringify({ tenant: 'acme', region: 'US-NY', level: 'region',
        events: 900, version: 1, updatedAt: Date.now(), r: { interest: { legacy: 900 } },
        share: { interest: { legacy: 1 } } })],
      ['trend:v2:acme:US-NY', JSON.stringify({ generation: 2, tenant: 'acme', region: 'US-NY', level: 'region',
        events: 50, version: 1, updatedAt: Date.now(), r: { interest: { fixture: 5 } },
        share: { interest: { fixture: 1 } } })],
    ]);
    const sessions = new Map([['session:private', ${JSON.stringify(PRIVATE)}]]);
    if (input.seedAudiences || input.authoredAudience) cache.set('audience:authored', JSON.stringify({ key: 'authored', name: 'Customer authored', status: 'published', conditions: ['fixture', 'eq', true] }));
    const storage = new Map([[${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(PRIVATE)}],
      ['acme/2026-09-06/13/decisions/private.ndjson', 'ACME_PRIVATE_VALUE']]);
    const publicationEtags = new Map(); let publicationVersion = 0;
    if (input.operatorDiagnostics) {
      for (const tenant of ['acme', 'globex']) {
        const item = 'W0106_PRIVATE_' + tenant, n = tenant === 'acme' ? 3 : 9;
        const revision = value => JSON.stringify({ revision: 1, value, actor: 'synthetic', note: '', at: 1 });
        cache.set('content:config:' + tenant + ':current', revision({ pieces: [
          { id: item, customerContentId: item, type: 'editorial', title: item, tags: {}, slotTypes: ['hero'] },
        ] }));
        cache.set('slots:config:' + tenant + ':current', revision({ pages: { home: [{ slot: 'hero', take: 1, weights: { taste: 1 } }] } }));
        cache.set('learn:config:' + tenant + ':current', revision({ holdout: { share: 0, arms: ['default'] },
          slots: { hero: { gamma: 0.2, exploration: { mode: 'rotation', share: 0.1, floor: 30 }, items: { [item]: { mode: 'freeze', lift: 1.2 } } } } }));
        const snapshot = { tenant, brand: tenant, slot: 'hero', reward: 'click', objective: 'unit',
          version: 7, publishedAt: 7, events: n, n0: 30, nMin: 30, liftMin: 0.5, liftMax: 2,
          items: { [item]: { '*': { level: 0, key: '*', n, s: 1, p0: 0.2, p_hat: 0.24, lift: 1.2 } } },
          slotRates: { '*': { n, s: 1, rate: 0.2 } } };
        cache.set('lift:' + tenant + ':' + tenant + ':hero', JSON.stringify(snapshot));
        storage.set('lift/' + tenant + '/' + tenant + '/hero/7.json', JSON.stringify(snapshot));
        storage.set('reports/' + tenant + '/' + tenant + '/2026-09-06.json', JSON.stringify({
          tenant, brand: tenant, date: '2026-09-06', builtAt: 7,
          counts: { decisions: n, outcomes: 1, visitors: 1, truncated: false }, policies: [], grids: {}, exploration: [],
          holdout: { hero: [{ arm: 'personalized', decisions: n, credited: 1, rate: 999 }] },
          measurement: { kind: 'W0106_STALE_INFERENCE' }, holdoutComparison: { hero: ['W0106_STALE_INFERENCE'] },
          businessLift: 'W0106_STALE_INFERENCE', hours: { source: 'aggregates', built: [0], missing: [1] },
        }));
      }
    }
    if (input.recoverErasure) {
      const erased = Date.now() - 86400000, day = new Date(erased).toISOString().slice(0, 10);
      for (const tenant of ['acme', 'globex']) {
        storage.set(tenant + '/' + day + '/00/decisions/erasure.ndjson', JSON.stringify({ visitor_id: 'same-subject', ts: erased - 1 }) + '\\n');
        storage.set('erasures/' + tenant + '/pending/same-subject.json', JSON.stringify({ tenant, visitor_id: 'same-subject', erased_at: erased,
          actor: 'synthetic', rows_removed: 0, objects_rewritten: 0, objects_deleted: 0 }));
      }
    }
    if (input.cachedScene) storage.set('scene/live/w0701-subject__w0701-scene.jpg', 'synthetic-image');
    if (input.malformedAggregate) {
      const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      storage.set('aggregates/acme/' + date + '/00.json', JSON.stringify({
        version: 1, tenant: 'acme', date, hour: 0, from: 0, to: 1, builtAt: 1,
        objects: 0, objectsRead: 0, truncated: false, horizonMs: 1, shards: 1, ringsFolded: false,
        brands: { acme: { decisions: 'W0704_PRIVATE_DECISIONS', outcomes: 'W0704_PRIVATE_OUTCOMES',
          visitorsDay: 0, policies: {}, arms: {}, exploration: {}, rows_hidden: 0 } },
      }));
    }
    const state = new Map([[${JSON.stringify(STATE_KEY)}, { value: ${JSON.stringify(PRIVATE)} }]]);
    const queued = [];
    const note = (operation, ...keys) => calls.push([operation, ...keys.map(String)]);
    const kv = (name, data) => ({
      async get(key, type) { note(name + '.get', key); if (input.failScheduled && key === 'monitor-probe') throw new Error('W0704_PRIVATE_FAILURE'); const v = data.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) : type === 'stream' ? new Response(v).body : v; },
      async put(key, value) { note(name + '.put', key); data.set(key, value); },
      async delete(key) { note(name + '.delete', key); data.delete(key); },
      async list(options = {}) { note(name + '.list', options.prefix ?? ''); return { keys: [...data.keys()].filter(key => !options.prefix || key.startsWith(options.prefix)).map(name => ({ name })), list_complete: true }; },
    });
    const stateStorage = {
      async get(key) { note('STATE.storage.get', key); return state.get(key); },
      async put(key, value) { note('STATE.storage.put', key); state.set(key, value); },
      async delete(key) { note('STATE.storage.delete', key); return state.delete(key); },
      async list() { note('STATE.storage.list'); return new Map(state); },
    };
    const queueOwners = new Map();
    const namespace = (name) => ({
      idFromName(key) { note(name + '.idFromName', key); return key; },
      get(key) {
        note(name + '.get', key);
        return { async fetch(request, init) {
          note(name + '.fetch', key);
          if (name === 'SHOPPER_REFLEX' && input.queue) {
            // Actual owner ordering and consumer, with this probe's synthetic
            // observed R2 binding. Never substitute a successful ACK receipt.
            if (!queueOwners.has(key)) {
              const values = new Map(), storage = { async get(k) { return values.get(k); },
                async put(k, value) { if (typeof k === 'string') values.set(k, value); else for (const [name, v] of Object.entries(k)) values.set(name, v); },
                async delete(k) { return values.delete(k); }, async list() { return new Map(values); } };
              queueOwners.set(key, new NativeShopperReflex({ id: { toString: () => key }, storage, getWebSockets: () => [] }, bindings));
            }
            return queueOwners.get(key).fetch(request instanceof Request ? request : new Request(request, init));
          }
          if (name === 'RATE_LIMITER') return Response.json({ allowed: true, remaining: 99 });
          if (name === 'STATE_MANAGER') return new StateManager({ storage: stateStorage }).fetch(
            input.sharedDiagnostics && !(request instanceof Request) ? new Request(request, init) : request);
          if (name === 'SHOPPER_REFLEX' && input.shopperCapability) {
            const incoming = request instanceof Request ? request : new Request(request, init);
            if (new URL(incoming.url).pathname === '/authority/request') {
              // Boundary unit: execute the real owned router after explicit
              // synthetic admission, retaining intercepted local destinations.
              // Actual durable admission/socket proof is the native group.
              const principal = await verifySessionCapability(bindings, incoming.headers.get('X-Shopper-Session'), input.shopperCapability.tenant);
              const owner = {}, now = Date.now(), consent = input.authoredAudience ? storedConsent({ version: 1, tenant: principal.tenant, subject: principal.subject,
                revision: 'explicit-boundary-choice', tracking: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS },
                personalization: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS } }) : { tracking: false, personalization: false };
              const routed = new Request(incoming.headers.get('X-Owner-Request-URL'), incoming);
              return runOwnerOperation(owner, bindings, async () => {
                admitOwnerPrincipal(owner, principal);
                return dispatchOwnedRequest(owner, bindings, routed, principal, async local => {
                  if (new URL(local.url).pathname === '/ingest') {
                    const event = await local.json(); state.set(key, { subject: event.userId, eventType: event.type });
                    return Response.json({ success: true, destination: key, consent });
                  }
                  return Response.json({ ok: true, destination: key, value: state.get(key) ?? null, consent });
                });
              }, bindings.SESSIONS, async () => bindings.PERSONALIZATION_WEBSOCKET.get(bindings.PERSONALIZATION_WEBSOCKET.idFromName(key)).fetch('https://relay/connections'), async () => consent);
            }
            if (new URL(incoming.url).pathname === '/ingest') {
              const event = await incoming.json();
              state.set(key, { subject: event.userId, eventType: event.type });
              return Response.json({ success: true, destination: key, consent: { tracking: false, personalization: false } });
            }
            return Response.json({ ok: true, destination: key, value: state.get(key) ?? null });
          }
          return Response.json({ value: ${JSON.stringify(PRIVATE)} });
        } };
      },
    });
    const fetcher = (name) => ({ async fetch() { note(name + '.fetch'); return new Response(${JSON.stringify(PRIVATE)}); } });
    const bindings = {
      DEPLOYMENT_PROFILE: input.absentProfile ? undefined : input.profile ?? 'demo',
      AUTH_MODE: input.mode === 'unset' ? undefined : input.mode ?? 'enforced',
      ENVIRONMENT: 'w0102-synthetic',
      RETENTION: input.retention ?? ${JSON.stringify(nativeRetention)},
      JWT_SECRET: ${JSON.stringify(SECRET)}, JWT_ISSUER: 'w0102', JWT_AUDIENCE: 'w0102',
      IDENTITY_SALT: input.auditSalt ?? 'w0304-mounted-synthetic-audit-material',
      ...(input.recovery ? { LEDGER_RECOVERY_ENABLED: 'false', LEDGER_RECOVERY_CONFIG: JSON.stringify({ version: 1, sourceQueue: 'source', deadLetterQueue: 'dlq',
        ...(input.recoveryUnknownPolicy === false ? {} : { unknown: { id: 'native-synthetic-unknown', revision: 1, durationMs: 60000, basis: 'admitted', renewal: 'new-record-only', disposal: 'delete-on-expiry' } }) }),
        STAMP_OWNER_SUBJECTS: JSON.stringify(input.recoveryOwner ? ['synthetic-acme-operator'] : []) } : {}),
      IDENTITY_SECRETS: input.identitySecrets,
      SDK_KEYS: input.sdkKeys ?? 'acme:synthetic-acme-key,globex:synthetic-globex-key',
      ...(input.sharedConnectors ? {
        WEBHOOK_ENDPOINTS: JSON.stringify([{ name: 'synthetic-global-webhook', type: 'webhook', enabled: true,
          url: 'https://connector.invalid/events', headers: { Authorization: 'W0102_PRIVATE_VALUE' },
          retryConfig: { maxRetries: 1, backoffMs: 1 } }]),
        CDP_ENDPOINTS: JSON.stringify([{ id: 'synthetic', name: 'Synthetic global destination', type: 'webhook',
          enabled: true, createdAt: 1, config: { url: 'https://connector.invalid/collect', headers: { Authorization: 'W0102_PRIVATE_VALUE' } } }]),
        OPTIMIZELY_SDK_KEY: 'synthetic-global-sdk', OPTIMIZELY_API_TOKEN: 'W0102_PRIVATE_VALUE',
        OPTIMIZELY_PROJECT_ID: 'synthetic-global-project', OPTIMIZELY_WEBHOOK_SECRET: 'synthetic-global-webhook',
        GEMINI_API_KEY: 'W0102_PRIVATE_VALUE', OPTIMIZELY_WRITE_ENABLED: 'true', SHOT_TOKEN: 'W0102_PRIVATE_VALUE',
      } : {}),
      ...(input.shopperCapability ? { REFLEX_HOST: input.reflexHost ?? 'do' } : {}),
      TENANTS: input.absentManifest ? undefined : Object.hasOwn(input, 'tenantManifest') ? input.tenantManifest
        : JSON.stringify({ provisioned: ['acme', 'globex', 'acme'], hosts: { 'acme.example': 'acme', 'globex.example': 'globex' },
          operatorGrants: { 'synthetic-acme-operator': ['acme'], 'synthetic-globex-operator': ['globex'] } }),
      ...(input.recoverErasure ? { LEDGER_RETENTION_DAYS: '1' } : {}),
      ...(input.scheduled ? { TREND_ROLLUP_TENANTS: 'obsolete,acme' } : {}),
      CORS_ORIGINS: 'https://shop.acme.example',
      CACHE: kv('CACHE', cache), SESSIONS: kv('SESSIONS', sessions),
      STORAGE: {
        async get(key) {
          note('STORAGE.get', key); const value = storage.get(key);
          return value === undefined ? null : { body: new Response(value).body,
            ...(input.publicationTenant || input.operatorDiagnostics || input.recovery || input.scheduled || input.shopperHost ? { key, etag: publicationEtags.get(key), size: new TextEncoder().encode(value).length,
              async text() { return value; } } : {}),
            ...(input.operatorDiagnostics ? { async json() { return JSON.parse(value); } } : {}),
            ...(input.scheduled || input.subjectOperations ? { async text() { return value; } } : {}),
            writeHttpMetadata(headers) { headers.set('content-type', 'application/x-fixture'); } };
        },
        async put(key, value, options) {
          note('STORAGE.put', key);
          if (input.failStoragePut) throw new Error('W0701_PRIVATE_FAILURE');
          // The shopper-host case reads and writes the configuration publication,
          // which requires the full put/get contract (src/config/publication.ts:225-237, :293-295).
          if (input.publicationTenant || input.operatorDiagnostics || input.recovery || input.scheduled || input.shopperHost) {
            const condition = options?.onlyIf;
            if (condition instanceof Headers ? storage.has(key) : condition && condition.etagMatches !== publicationEtags.get(key)) return null;
            const text = await new Response(value).text(), etag = 'publication-' + (++publicationVersion);
            storage.set(key, text); publicationEtags.set(key, etag);
            return { key, etag, size: new TextEncoder().encode(text).length };
          }
          const text = await new Response(value).text(); storage.set(key, text);
          return { etag: 'fixture-etag', size: text.length };
        },
        async delete(key) { note('STORAGE.delete', key); storage.delete(key); },
        async head(key) { note('STORAGE.head', key); return storage.has(key) ? { size: storage.get(key).length } : null; },
        async list(options = {}) { note('STORAGE.list', options.prefix ?? ''); if (input.failScheduled) throw new Error('W0704_PRIVATE_FAILURE'); return { objects: [...storage.keys()].filter(key => !options.prefix || key.startsWith(options.prefix)).map(key => ({ key })), truncated: false }; },
      },
      EVENT_QUEUE: {
        async send(value) { note('EVENT_QUEUE.send'); queued.push(value); },
        async sendBatch(values) { note('EVENT_QUEUE.sendBatch'); queued.push(...values); },
      },
      ANALYTICS: { writeDataPoint() { note('ANALYTICS.writeDataPoint'); } },
      ACCOUNTS: {
        async auditOperations(rows) {
          const phase = JSON.parse(rows[0].detail).phase; note('ACCOUNTS.auditOperations', phase, String(rows.length));
          if (input.subjectAuditFailure === phase) throw new Error('PRIVATE_OPERATION_AUDIT');
          await auditStore.auditOperations(rows);
        },
        async audit(entry) {
          const phase = JSON.parse(entry.detail).phase; note('ACCOUNTS.audit', phase);
          if (input.subjectAuditFailure === phase) throw new Error('PRIVATE_AUDIT_FAILURE');
          await auditStore.audit(entry);
        },
        async subjectAudit(tenant, before, limit) {
          note('ACCOUNTS.subjectAudit', tenant);
          if (input.subjectAuditFailure === 'read') throw new Error('PRIVATE_AUDIT_READ');
          return auditStore.subjectAudit(tenant, before, limit);
        },
        async getSession(jti) { note('ACCOUNTS.getSession', jti); return jti === 'synthetic-account-session'
          ? { jti, accountId: 'synthetic-acme-operator', createdAt: Date.now() - 1000, expiresAt: Date.now() + 60_000, tokenHash: 'synthetic-unused-refresh-hash' } : null; },
        async getById(id) { note('ACCOUNTS.getById', id); return { id, email: 'synthetic@example.invalid', name: 'Synthetic', roles: ['operator'], permissions: ['read'] }; },
      },
      DB: { prepare(query) { note('DB.prepare', query); return { bind() { note('DB.bind'); return { async first() { note('DB.first'); return null; }, async all() { note('DB.all'); return { results: [] }; }, async run() { note('DB.run'); return { success: true }; } }; } }; } },
      ASSETS: fetcher('ASSETS'), BROWSER: fetcher('BROWSER'),
      AI: { async run() { note('AI.run'); return {}; } },
    };
    // Opt in to populated shared Coach data without changing other fixtures' D1 spy.
    if (input.sharedDiagnostics) bindings.DB = { prepare(query) {
      note('DB.prepare', query);
      const statement = {
        bind(...values) { note('DB.bind', ...values); return statement; },
        async first() { note('DB.first'); return query.includes('COUNT(DISTINCT t.vuid)') ? { n: 40 } : null; },
        async all() { note('DB.all'); return { results: query.includes('FROM coach_purchase_items')
          ? [{ line: ${JSON.stringify(PRIVATE)}, shoppers: 20 }] : [] }; },
      };
      return statement;
    } };
    for (const name of ['STATE_MANAGER', 'RATE_LIMITER', 'PERSONALIZATION_WEBSOCKET', 'SHOPPER_REFLEX',
      'MERIDIAN_REFLEX', 'REGION_TREND', 'DECISION_RING', 'LEARN_STATS', 'OpalAgent']) bindings[name] = namespace(name);
    if (input.profile === 'customer') {
      for (const name of ['STATE_MANAGER', 'MERIDIAN_REFLEX', 'OpalAgent', 'BROWSER']) delete bindings[name];
      if (input.forbiddenBinding) bindings[input.forbiddenBinding] = namespace(input.forbiddenBinding);
      // Deliberate synthetic registration, separate from the legacy manifest.
      // Production issuance/current-row parsing is covered by native W02.08 D1.
      const authority = memoryAuthority(bindings.ACCOUNTS), token = input.headers?.Authorization?.replace(/^Bearer /, '');
      bindings.AUTHORITY = authority;
      if (token) {
        try {
        const payload = decodeJwt(token), tenant = input.customerAuthorityTenant
          ?? (payload.sub === 'synthetic-globex-operator' ? 'globex' : 'acme');
        if (payload.type === 'service' && payload.jti && input.customerCredentialState !== 'unregistered') authority.services.set(payload.jti,
          { id: payload.jti, subject: payload.sub, tenant, role: payload.roles?.includes('admin') ? 'admin' : 'operator',
            tokenHash: await tokenHash(token), expiresAt: payload.exp, createdAt: Date.now(), createdBy: 'fixture-owner',
            revokedAt: input.customerCredentialState === 'revoked' ? Date.now() : null });
        if (payload.type === 'access' && input.recoveryRole !== 'none') authority.memberships.set(JSON.stringify([payload.sub, tenant]),
          { accountId: payload.sub, tenant, role: input.recoveryRole ?? 'operator', disabled: false, removed: false, revision: 'fixture-membership', updatedAt: Date.now() });
        } catch { /* Malformed bearers stay unregistered; the real verifier handles them. */ }
      }
    }
    if (input.publicationTenant) {
      invalidatePublicationCache();
      await initializePublication(bindings, CONTENT_KIND, input.publicationTenant,
        { revision: 1, at: 1, actor: 'synthetic-baseline', note: '', value: { pieces: [] } }, '0:' + crypto.randomUUID());
      calls.length = 0;
    }
    if (input.scheduled) {
      // W11 serving admission requires one coherent R2 baseline; legacy KV
      // fixture documents alone cannot exercise the retained scheduled jobs.
      const revision = value => ({ revision: 1, value, actor: 'W12-scheduled-fixture', note: '', at: 1 });
      for (const tenant of ['acme', 'globex']) await initializePublicationSet(bindings, [
        { kind: CONTENT_KIND, scope: tenant, revision: revision({ pieces: [] }) },
        { kind: SLOTS_KIND, scope: tenant, revision: revision({ pages: { home: [{ slot: 'hero', take: 1, weights: {} }] } }) },
        { kind: LEARN_KIND, scope: tenant, revision: revision(DEFAULT_LEARN) },
        { kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant), revision: revision(DEFAULT_REFLEX_CONFIG) },
        { kind: PRIORS_KIND, scope: tenant, revision: revision({ rows: [] }) },
      ], '0:' + crypto.randomUUID());
      calls.length = 0;
    }
    if (input.operatorDiagnostics) {
      // Current content reads require conditional R2 authority; legacy KV
      // catalog copies deliberately cannot supply the diagnostic's product data.
      for (const tenant of ['acme', 'globex']) await initializePublication(bindings, CONTENT_KIND, tenant,
        JSON.parse(cache.get('content:config:' + tenant + ':current')), '0:' + crypto.randomUUID());
      calls.length = 0;
    }
    const env = new Proxy(bindings, {
      get(target, key, receiver) { envAccess.push('get:' + String(key)); return Reflect.get(target, key, receiver); },
      has(target, key) { envAccess.push('has:' + String(key)); return Reflect.has(target, key); },
      ownKeys(target) { envAccess.push('enumerate'); return Reflect.ownKeys(target); },
    });
    const snapshot = () => JSON.parse(JSON.stringify({ cache: [...cache], sessions: [...sessions], storage: [...storage], state: [...state], queued }));
    const before = snapshot();
    const originalConsole = {};
    for (const method of ['log', 'warn', 'error', 'info', 'debug']) {
      originalConsole[method] = console[method];
      console[method] = (...values) => logs.push(values.map(String).join(' '));
    }
    invalidateTrendCache();
    invalidateCache(); // Each transport owns fresh synthetic bindings and documents.
    clearBhExperimentMemo();
    try {
      if (input.seedAudiences) {
        await ensureAudiencesSeeded(env, { getAllProducts() { note('catalog.getAllProducts'); return []; } }, undefined, 'coach');
        return Response.json({ status: 200, body: '', headers: {}, calls, envAccess, logs, before, after: snapshot(), pending: pending.length });
      }
      if (input.shopperHost) {
        const scope = reflexScopeForTenant('acme');
        const config = { ...DEFAULT_REFLEX_CONFIG, version: 'w3707-synthetic-native', dimensions: [{ key: 'taste', source: 'taste' }] };
        // Configuration publication is the only configuration authority, and an
        // authored write needs If-Match + Idempotency-Key over an existing head
        // (src/config/publication.ts:19, :66-73, :76-88, :379-397). This scope has
        // no head yet, so the fixture publishes the explicit initial baseline,
        // which is the sanctioned library-only path (:437-441, :492-495) and
        // throws on every failure instead of returning ok:false.
        for (const target of [bindings, runtimeEnv]) {
          await initializePublication(target, REFLEX_KIND, scope,
            { revision: 1, value: config, actor: 'synthetic', note: '', at: 1 }, '0:' + crypto.randomUUID());
        }
        Object.assign(bindings, { REFLEX_HOST: input.shopperHost, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
          SHOPPER_REFLEX: runtimeEnv.SHOPPER_REFLEX, PERSONALIZATION_WEBSOCKET: runtimeEnv.PERSONALIZATION_WEBSOCKET });
        const context = { waitUntil(p) { pending.push(Promise.resolve(p)); }, passThroughOnException() {} };
        const ask = (path, token, body, extra = {}) => worker.fetch(new Request('https://acme.example' + path, {
          method: body === undefined ? 'GET' : 'POST', headers: { 'X-SDK-Key': 'synthetic-acme-key', 'X-Tenant': 'acme',
            ...(token ? { 'X-Shopper-Session': token } : {}), 'Content-Type': 'application/json', ...extra },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }), env, context);
        const denied = await ask('/realtime/session/victim/analytics');
        const boot = await ask('/v1/acme/identity/session', undefined, { visitorId: 'victim', sessionId: 'victim' });
        const grant = (await boot.json()).session;
        const chosen = await ask('/realtime/session/' + grant.sessionId + '/preferences', grant.capability, {
          trackingConsent: true, personalizationEnabled: true, choice: { id: crypto.randomUUID(), expectedRevision: null,
            grantId: grant.grantId, iat: grant.iat, exp: grant.exp },
        });
        if (!chosen.ok) throw new Error('Native explicit choice unavailable: ' + chosen.status);
        const wrong = await ask('/realtime/reflex?userId=victim', grant.capability);
        const named = shopperObjectName('acme', grant.subject);
        const namespace = input.shopperHost === 'do' ? runtimeEnv.SHOPPER_REFLEX : runtimeEnv.PERSONALIZATION_WEBSOCKET;
        const object = namespace.get(namespace.idFromName(named));
        const claims = { tenant: 'acme', subject: grant.subject, sessionId: grant.sessionId, kind: 'anonymous', authorityEpoch: grant.authorityEpoch };
        const short = await issueSessionCapability(bindings, claims, Math.floor(Date.now() / 1000), 3);
        const live = await issueSessionCapability(bindings, claims, Math.floor(Date.now() / 1000), 60);
        {
          const descriptors = [short, live].map(({ capability, ...principal }) => principal);
          const owner = runtimeEnv.SHOPPER_REFLEX.get(runtimeEnv.SHOPPER_REFLEX.idFromName(named));
          const seeded = await owner.fetch('https://private/__fixture_grants', { method: 'POST', body: JSON.stringify(descriptors) });
          if (seeded.status !== 204) throw new Error('Fixture durable grant setup failed');
        }
        const denialStart = calls.length, denialState = snapshot(), denialPending = pending.length;
        const keyDeniedResponse = await worker.fetch(new Request('https://acme.example/realtime/ws?tenant=acme&userId=' + grant.subject + '&sessionId=' + grant.sessionId + '&sdkKey=synthetic-globex-key', {
          headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'shopper-session-v1, ' + live.capability },
        }), env, context);
        const keyDenied = { status: keyDeniedResponse.status, cacheControl: keyDeniedResponse.headers.get('Cache-Control'),
          native: !!keyDeniedResponse.webSocket, calls: calls.slice(denialStart), unchanged: JSON.stringify(snapshot()) === JSON.stringify(denialState),
          pending: pending.length - denialPending };
        if (keyDeniedResponse.webSocket) { keyDeniedResponse.webSocket.accept(); keyDeniedResponse.webSocket.close(1000, 'fixture complete'); }
        const observed = [];
        const sockets = [];
        const waitFor = async (predicate, phase = 'unspecified') => {
          const deadline = Date.now() + 4000;
          while (!predicate()) { if (Date.now() >= deadline) throw new Error('W04.03 socket observation timed out: ' + phase + ' observations=' + JSON.stringify(observed)); await new Promise(r => setTimeout(r, 10)); }
        };
        const open = async (token) => {
          const res = await worker.fetch(new Request('https://acme.example/realtime/ws?tenant=acme', {
            headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'shopper-session-v1, ' + token + ', sdk-key-v1.' + btoa('synthetic-acme-key').replace(/=/g, '') },
          }), env, context);
          const item = { status: res.status, protocol: res.headers.get('Sec-WebSocket-Protocol'), native: !!res.webSocket, frames: [], closed: null };
          observed.push(item);
          if (!res.webSocket) throw new Error('W04.02 expected native upgrade, received ' + res.status + ': ' + await res.text());
          const ws = res.webSocket; sockets.push(ws);
          ws.addEventListener('message', event => { try { item.frames.push(JSON.parse(event.data)); } catch {} });
          ws.addEventListener('close', event => { item.closed = event.code; });
          ws.accept();
          await waitFor(() => item.frames.some(f => f.type === 'connected'), 'welcome');
          ws.send(JSON.stringify({ type: 'heartbeat', userId: grant.subject }));
          await waitFor(() => item.frames.some(f => f.type === 'heartbeat_response'), 'heartbeat');
          return { ws, item };
        };
        try {
          const expiring = await open(short.capability), current = await open(live.capability), bad = await open(live.capability);
          bad.ws.send(JSON.stringify(input.shopperHost === 'do'
            ? { type: 'action', event: { type: 'page_view', userId: 'victim', data: {}, source: 'sdk' } }
            : { type: 'subscribe', userId: 'victim' }));
          await waitFor(() => bad.item.closed !== null, 'bad-target-close');
          const push = async tag => {
            const res = await ask('/realtime/segments/' + grant.subject, live.capability, { segment: tag, source: tag });
            if (!res.ok) throw new Error('W04.02 private push refused ' + res.status);
          };
          await push('w0402-before');
          await waitFor(() => [expiring, current].every(s => s.item.frames.some(f => f.data?.source === 'w0402-before')), 'before-publication');
          let ownedFrame = null;
          if (input.shopperHost === 'do') {
            current.ws.send(JSON.stringify({ type: 'action', event: { type: 'page_view', userId: grant.subject, sessionId: grant.sessionId, data: {}, source: 'w0402-own-frame' } }));
            await waitFor(() => current.item.frames.some(f => f.data?.source === 'w0402-own-frame'), 'owned-action');
            const analyticsResponse = await object.fetch('https://private/analytics', { headers: { 'X-Shopper-Session': live.capability, 'X-Tenant': 'acme' } });
            if (!analyticsResponse.ok) throw new Error('Synthetic owned analytics unavailable');
            const analytics = await analyticsResponse.json();
            ownedFrame = { sessionMatched: analytics.sessionId === grant.sessionId, pageViews: analytics.analytics.pageViews };
          }
          await new Promise(r => setTimeout(r, Math.max(0, short.exp * 1000 - Date.now() + 30)));
          await push('w0402-after');
          await waitFor(() => current.item.frames.some(f => f.data?.source === 'w0402-after'), 'after-publication');
          await waitFor(() => expiring.item.closed !== null, 'expired-close');
          const expired = await ask('/realtime/reflex?userId=' + grant.subject, short.capability);
          const victim = runtimeEnv.SHOPPER_REFLEX.get(runtimeEnv.SHOPPER_REFLEX.idFromName(shopperObjectName('acme', 'victim')));
          const victimResponse = await victim.fetch('https://private/identity/export', { headers: { 'X-Reflex-Tenant': 'acme', 'X-Reflex-Subject': 'victim' } });
          if (!victimResponse.ok) throw new Error('Synthetic victim export unavailable');
          const victimState = await victimResponse.json();
          const owner = runtimeEnv.SHOPPER_REFLEX.get(runtimeEnv.SHOPPER_REFLEX.idFromName(named));
          if ((await owner.fetch('https://private/__fixture_expired_choice')).status !== 204) throw new Error('Choice expiry fixture failed');
          const framesBeforeRefusal = current.item.frames.length;
          const consentExpired = await ask('/realtime/segments/' + grant.subject, live.capability, { segment: 'forbidden-expired-choice' });
          await new Promise(r => setTimeout(r, 30));
          const expiredChoice = { status: consentExpired.status, unchangedFrames: current.item.frames.length === framesBeforeRefusal };
          return Response.json({ status: 200, body: JSON.stringify({ denied: denied.status, bootstrap: boot.status,
            fresh: grant.subject !== 'victim' && grant.sessionId !== 'victim', wrong: wrong.status, expired: expired.status,
            sockets: observed.map(s => ({ status: s.status, native: s.native, protocol: s.protocol, closed: s.closed,
              welcome: s.frames.some(f => f.type === 'connected'), heartbeat: s.frames.some(f => f.type === 'heartbeat_response'),
              before: s.frames.some(f => f.data?.source === 'w0402-before'), after: s.frames.some(f => f.data?.source === 'w0402-after') })),
            victimUntouched: victimState.affinity === null && victimState.pipeline === null, ownedFrame, keyDenied, expiredChoice }), headers: {}, calls, envAccess, logs, before, after: snapshot(), pending: pending.length });
        } finally { for (const ws of sockets) { try { ws.close(1000, 'fixture complete'); } catch {} } }
      }
      if (input.scheduled) {
        let denied;
        if (input.recoverErasure) {
          await worker.scheduled({ cron: input.scheduled, scheduledTime: Date.now() }, env,
            { waitUntil(promise) { pending.push(Promise.resolve(promise)); } });
          for (const promise of pending) await promise;
          denied = { calls: calls.slice(), envAccess: envAccess.slice(), logs: logs.slice(), after: snapshot(), pending: pending.length };
          bindings.TENANTS = JSON.stringify({ provisioned: ['acme', 'acme'] });
          calls.length = 0; envAccess.length = 0; logs.length = 0; pending.length = 0;
        }
        await worker.scheduled({ cron: input.scheduled, scheduledTime: Date.now() }, env,
          { waitUntil(promise) { pending.push(Promise.resolve(promise)); } });
        for (let index = 0; index < pending.length; index++) await pending[index];
        return Response.json({ status: 200, body: denied ? JSON.stringify({ denied }) : '', headers: {}, calls, envAccess, logs,
          before, after: snapshot(), pending: pending.length });
      }
      if (input.queue) {
        await worker.queue({ ...(input.recovery ? { queue: 'dlq' } : {}), messages: input.queue.map((body, index) => ({ body, id: 'w0909-' + index,
          ack() { note('queue.ack', ...(input.queuePositions ? [String(index)] : [])); if (input.failAck) throw new Error('W0701_PRIVATE_FAILURE'); },
          retry() { note('queue.retry', ...(input.queuePositions ? [String(index)] : [])); },
        })) }, env, { waitUntil(promise) { pending.push(Promise.resolve(promise)); } });
        if (!input.recoveryAfterQueue) return Response.json({ status: 200, body: '', headers: {}, calls, envAccess, logs,
          before, after: snapshot(), pending: pending.length });
      }
      const requestHeaders = new Headers(input.headers);
      if (input.shopperCapability) {
        const grant = await issueSessionCapability(bindings, { ...input.shopperCapability, kind: 'anonymous' });
        await verifySessionCapability(bindings, grant.capability, input.shopperCapability.tenant);
        if (requestHeaders.get('Upgrade')?.toLowerCase() === 'websocket') requestHeaders.set('Sec-WebSocket-Protocol', 'shopper-session-v1, ' + grant.capability);
        else requestHeaders.set('X-Shopper-Session', grant.capability);
        if (input.identityProof) {
          const exp = Math.floor(Date.now() / 1000) + 300;
          input.body = JSON.stringify({ visitorId: grant.subject, accountId: input.identityProof.accountId, exp,
            assertion: await signAssertion(input.identityProof.secret, input.identityProof.tenant, grant.subject, input.identityProof.accountId, exp) });
        }
      }
      const request = new Request('https://' + (input.requestHost ?? 'acme.example') + input.path, {
        method: input.method ?? 'GET', headers: requestHeaders, body: input.body,
        ...(input.requestCf ? { cf: input.requestCf } : {}),
      });
      let bodyReads = 0;
      for (const name of ['json', 'text', 'arrayBuffer', 'formData', 'blob']) {
        const original = request[name].bind(request);
        request[name] = (...args) => { bodyReads++; return original(...args); };
      }
      const response = await worker.fetch(request, env, {
        waitUntil(promise) { pending.push(Promise.resolve(promise)); },
        passThroughOnException() { note('context.passThroughOnException'); },
      });
      let body = await response.text();
      if (input.readBack) {
        const readHeaders = new Headers(requestHeaders);
        if (input.readBackCookie !== undefined) readHeaders.set('Cookie', input.readBackCookie);
        const read = await worker.fetch(new Request('https://' + (input.requestHost ?? 'acme.example') + input.readBack,
          { headers: readHeaders, ...(input.readBackBody ? { method: 'POST', body: input.readBackBody } : {}) }),
          env, { waitUntil(p) { pending.push(Promise.resolve(p)); }, passThroughOnException() {} });
        body = JSON.stringify({ write: JSON.parse(body), readStatus: read.status, read: await read.json() });
      }
      for (let index = 0; index < pending.length; index++) await pending[index];
      return Response.json({ status: response.status, body, headers: Object.fromEntries(response.headers),
        calls, envAccess, logs, before, after: snapshot(), pending: pending.length, bodyReads });
    } finally {
      for (const method of Object.keys(originalConsole)) console[method] = originalConsole[method];
    }
  },
};
`;

let runtime: Miniflare;
let runtimeBundle: string;
function nativeRuntime(reflexHost = 'session', ledgerObserver?: (request: Request) => Promise<Response>) {
  return new Miniflare({
    modules: [{ type: 'ESModule', path: 'w0102-worker.mjs', contents: runtimeBundle }],
    compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket' },
    kvNamespaces: ['CACHE', 'SESSIONS'],
    // The configuration publication authority is an R2 bucket and is required
    // by every served request (src/config/publication.ts:19, :180-183), so the
    // native runtime always binds it.
    r2Buckets: ['STORAGE'],
    ...(ledgerObserver ? { serviceBindings: { W0612_OBSERVER: ledgerObserver } } : {}),
    bindings: { DEPLOYMENT_PROFILE: 'demo', REFLEX_HOST: reflexHost, JWT_SECRET: SECRET, JWT_ISSUER: 'w0102', JWT_AUDIENCE: 'w0102', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
      TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'], hosts: { 'acme.example': 'acme' } }), RETENTION: nativeRetention },
    outboundService: () => { outboundAttempts++; throw new Error('W01.02 forbids outbound network'); },
  });
}
let outboundAttempts = 0;
const tokens: Record<string, string | undefined> = { absent: undefined, invalid: 'invalid-synthetic-token' };

beforeAll(async () => {
  for (const role of ['operator', 'admin']) {
    tokens[role] = await new SignJWT({ sub: 'synthetic-acme-operator', type: 'service', roles: [role], permissions: ['read'] })
      .setJti('synthetic-service-' + role)
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('w0102').setAudience('w0102')
      .setExpirationTime('30m').sign(new TextEncoder().encode(SECRET));
    tokens[role + '-access'] = await new SignJWT({ sub: 'synthetic-acme-operator', type: 'access', sid: 'synthetic-account-session', roles: [role], permissions: ['read'] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('w0102').setAudience('w0102')
      .setExpirationTime('30m').sign(new TextEncoder().encode(SECRET));
  }
  tokens.globex = await new SignJWT({ sub: 'synthetic-globex-operator', type: 'service', roles: ['admin'], permissions: ['*'] })
    .setJti('synthetic-globex-service')
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('w0102').setAudience('w0102')
    .setExpirationTime('30m').sign(new TextEncoder().encode(SECRET));
  for (const kind of ['refresh', 'expired']) {
    tokens[kind] = await new SignJWT({ sub: 'synthetic-acme-operator', roles: ['admin'], ...(kind === 'refresh' ? { type: 'refresh' } : {}) })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('w0102').setAudience('w0102')
      .setExpirationTime(kind === 'expired' ? Math.floor(Date.now() / 1000) - 30 : '30m').sign(new TextEncoder().encode(SECRET));
  }
  const bundled = await build({
    stdin: { contents: wrapper, resolveDir: process.cwd(), sourcefile: 'w0102-runtime.ts', loader: 'ts' },
    bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'],
    // Wrangler uses the installed unenv fallback for os before 2025-09-15.
    alias: { path: 'node:path', 'node:os': 'unenv/node/os' },
    // Capture before Hono's logger() closes over console.log during module load.
    banner: { js: `import { createRequire } from 'node:module'; const require = createRequire('/w0102-worker.mjs');
      globalThis.__W0102_LOGS__ = [];
      for (const method of ['log', 'warn', 'error', 'info', 'debug'])
        console[method] = (...values) => globalThis.__W0102_LOGS__.push(values.map(String).join(' '));` },
    // Reproduce the original artifact without restoring either live source file.
    // Both retained text files have one apply_patch-added final newline; pin the
    // exact original bytes after removing that one byte, or refuse the replay.
    plugins: process.env.W01_02_BEFORE === '1' ? [{
      name: 'w0102-original-source',
      setup(builder) {
        builder.onResolve({ filter: /^(\.\/src\/index\.ts|@\/routes\/api)$/ }, args => ({
          path: args.path === './src/index.ts' ? 'index' : 'api', namespace: 'w0102-before',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'w0102-before' }, args => {
          const contents = readFileSync(resolve('docs/remediation/evidence/W01.02', `before-${args.path}.ts.txt`), 'utf8').slice(0, -1);
          const expected = args.path === 'index' ? 'a9ca5ae49c3741d9375bd0245c7e377bfd779021055df9d90671b0f580f9f4f1'
            : '905f2512b23e6639441067a45864fe25634b3fbf2d9fc977b34370fbd90dca58';
          if (createHash('sha256').update(contents).digest('hex') !== expected) throw new Error('Original source hash mismatch');
          return { contents: contents + (args.path === 'index' ? '\nexport const W0108_MOUNTED_ROUTES = app.routes.filter(r => r.method !== "ALL").map(({method,path}) => ({method,path}));' : ''), loader: 'ts', resolveDir: process.cwd() };
        });
      },
    }] : [{ name: 'w0108-actual-mounted-routes', setup(builder) {
      builder.onLoad({ filter: /[\\/]src[\\/]index\.ts$/ }, args => ({
        contents: readFileSync(args.path, 'utf8') + '\nexport const W0108_MOUNTED_ROUTES = app.routes.filter(r => r.method !== "ALL").map(({method,path}) => ({method,path}));',
        loader: 'ts', resolveDir: resolve('src'),
      }));
    } }],
    logLevel: 'silent',
  });
  if (process.env.W01_02_INPUTS === '1') console.log('W01_02_BUILD_INPUTS ' + JSON.stringify(Object.keys(bundled.metafile!.inputs).sort()));
  runtimeBundle = bundled.outputFiles[0]!.text;
  runtime = nativeRuntime();
  await runtime.ready;
}, 60_000);

afterAll(async () => {
  await runtime?.dispose();
  expect(outboundAttempts).toBe(0);
});

async function probe(input: Probe): Promise<Result> {
  const response = await runtime.dispatchFetch('http://w0102.local/probe', { method: 'POST', body: JSON.stringify(input) });
  expect(response.status, response.status === 200 ? undefined : await response.clone().text()).toBe(200);
  return response.json() as Promise<Result>;
}

it('W14.07 native signed search releases both owner hosts, rejects post-wait erasure/consent and retains actual behavior',async()=>{
  const {configuredDestinations}=await import('@/connectors/config');
  for(const host of ['session','do']){
    const search={version:1,enabled:true,provider:'google',baseURL:'https://generativelanguage.googleapis.com/v1beta',apiKeyRef:'CONNECTOR_SECRET_SEARCH',model:'fixture-model',
      approval:{egress:'fixture',metering:'fixture',providerRetention:'fixture'},timeoutMs:15000,requestBytes:65536,responseBytes:65536,maxOutputTokens:1024,
      taxonomy:[{dimension:'style',meaning:'Native fixture style',values:[{value:'First',meaning:'First style'},{value:'Second',meaning:'Second style'}]}],currency:'USD',priceMinorUnits:2,priceSource:'amount',giftMeaning:'Approved feed gift service'};
    const catalogSearch={version:1,enabled:true,url:'https://catalog.invalid/search',tokenRef:'CONNECTOR_SECRET_CATALOG',approval:search.approval,mappingRevision:'native-feed',timeoutMs:15000,responseBytes:65536,maxPages:1,maxCandidates:10,maxAgeMs:60000};
    const bindings={TENANTS:JSON.stringify({provisioned:['acme','globex'],hosts:{'acme.example':'acme','globex.example':'globex'}}),
      TENANT_CONNECTORS:JSON.stringify({version:1,tenants:Object.fromEntries(['acme','globex'].map(t=>[t,{search,catalogSearch}]))}),
      REFLEX_HOST:host,DEPLOYMENT_PROFILE:'customer',AUTH_MODE:'enforced',JWT_SECRET:SECRET,JWT_ISSUER:'w14',JWT_AUDIENCE:'w14',IDENTITY_SALT:'native-warehouse-custody-fixture',
      SDK_KEYS:'acme:native-site,globex:native-site',CONNECTOR_SECRET_SEARCH:'native-local-model',CONNECTOR_SECRET_CATALOG:'native-local-feed',LEDGER_RECOVERY_ENABLED:'true',RETENTION:''};
    const policies=JSON.parse(nativeRetention);for(const tenant of ['acme','globex'])for(const category of ['recovery','quarantine',...(await configuredDestinations(bindings as unknown as Env,tenant,()=>undefined)).map(d=>d.category)])
      policies.tenants[tenant][category]={id:'native-w14',revision:1,durationMs:86400000,basis:'admitted',renewal:'new-record-only'};bindings.RETENTION=JSON.stringify(policies);
    let hold=false,redirectModel=false,redirectCatalog=false,entered:()=>void=()=>undefined,release:()=>void=()=>undefined,catalogCalls=0,forbidden=0,modelOutboundEntered=0;const prompts:string[]=[];
    const native=new Miniflare({cf:false,modules:[{type:'ESModule',path:'w0102-worker.mjs',contents:runtimeBundle}],compatibilityDate:'2025-06-01',compatibilityFlags:['nodejs_compat'],
      durableObjects:{SHOPPER_REFLEX:{className:'ShopperReflex',useSQLite:true},PERSONALIZATION_WEBSOCKET:{className:'PersonalizationWebSocket',useSQLite:true}},
      kvNamespaces:['CACHE','SESSIONS'],r2Buckets:['STORAGE'],bindings,
      outboundService:async(request:Request)=>{
        const url=new URL(request.url);if(url.origin==='https://generativelanguage.googleapis.com'){
          modelOutboundEntered++;
          if(redirectModel)return new Response('Refused redirect',{status:302,headers:{Location:'https://unapproved.invalid/model'}});
          prompts.push(await request.text());if(hold){entered();await new Promise<void>(r=>{release=r;});}
          return Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify({supported:true,filters:[],exclusions:[],price:null,gift:'any',unsupported:[]})}]},finishReason:'STOP'}]});}
        if(url.origin==='https://catalog.invalid'){catalogCalls++;if(redirectCatalog)return new Response('Refused redirect',{status:302,headers:{Location:'https://unapproved.invalid/catalog'}});const body=await request.json() as {tenant:string};return Response.json({schema:'commerce-candidates/v1',tenant:body.tenant,mappingRevision:'native-feed',revision:'native-v1',asOf:Date.now(),complete:true,next:null,
          candidates:['First','Second'].map((style,i)=>({id:'actual-native-'+i,inStock:true,entitled:true,price:{currency:'USD',minor:1000},giftEligible:true,attributes:{style:[style]}}))});}
        forbidden++;throw Error('W14 native fixture forbids nonfixture outbound');
      }});
    try{await native.ready;const send=async(body:unknown)=>{const response=await native.dispatchFetch('http://fixture/',{method:'POST',body:JSON.stringify(body)});expect(response.status).toBe(200);return response.json() as Promise<Record<string,unknown>>;};
      expect(await send({w14:'initialize'})).toEqual({initialized:true});
      const r2=await native.getR2Bucket('STORAGE');
      const productState=async()=>{const page=await r2.list();return Promise.all(page.objects.filter(o=>o.key.includes('/product-sort/')).map(async o=>[o.key,await(await r2.get(o.key))!.text()]));};
      for(const tenant of ['acme','globex'])for(const cause of ['positive','consent','erasure','model-redirect','catalog-redirect']){
        const g=await send({w14:'session',tenant}) as unknown as {tenant:string;subject:string;sessionId:string;capability:string;grantId:string;iat:number;exp:number};
        const call=async(path:string,body:unknown)=>{const out=await send({w14:'request',tenant,path,capability:g.capability,body});return{status:Number(out.status),body:JSON.parse(String(out.body)) as Record<string,unknown>};};
        let revision:null|string=null;const choice=async(enabled:boolean)=>{const r=await call('/realtime/session/preferences',{trackingConsent:enabled,personalizationEnabled:enabled,choice:{id:crypto.randomUUID(),expectedRevision:revision,grantId:g.grantId,iat:g.iat,exp:g.exp}});
          expect(r.status,JSON.stringify(r.body)).toBe(200);revision=(r.body.consent as {instruction:{revision:string}}).instruction.revision;};
        await choice(true);const action=()=>call('/realtime/action',{type:'product_view',source:'sdk',userId:g.subject,sessionId:g.sessionId,eventId:crypto.randomUUID(),timestamp:Date.now(),data:{style:'Second'}});
        expect((await action()).status).toBe(200);const before=catalogCalls,beforeModel=modelOutboundEntered;hold=cause==='consent'||cause==='erasure';
        redirectModel=cause==='model-redirect';redirectCatalog=cause==='catalog-redirect';const beforeProducts=await productState();const seen=new Promise<void>(r=>{entered=r;});
        const pending=call('/search',{query:'Native constrained products',limit:2});
        if(hold){await Promise.race([seen,pending.then(result=>{throw Error('Search completed before native model hold: '+result.status);})]);
          expect((await action()).status).toBe(200);
          if(cause==='consent')await choice(false);else{const receipt=await send({w14:'erase',tenant,subject:g.subject});expect(Number(receipt.status),JSON.stringify(receipt)).toBeLessThan(400);expect(receipt.complete).toBe(false);expect((await action()).status).toBe(401);}hold=false;release();}
        const result=await pending;
        if(cause==='positive'){expect(result.status,JSON.stringify({body:result.body,modelOutboundEntered,prompts:prompts.length,catalogCalls,forbidden})).toBe(200);expect(result.body.order).toEqual(['actual-native-1','actual-native-0']);expect(result.body.persistence).toMatchObject({status:'durable'});expect(catalogCalls).toBe(before+1);}
        else if(redirectModel||redirectCatalog){expect(result.status).toBe(503);expect(result.body).toMatchObject({ok:false,complete:false,code:'transport'});
          expect(modelOutboundEntered).toBe(beforeModel+1);expect(catalogCalls).toBe(before+(redirectCatalog?1:0));expect(forbidden).toBe(0);expect(await productState()).toEqual(beforeProducts);}
        else{expect(result.status,cause).toBeGreaterThanOrEqual(400);expect(catalogCalls).toBe(before);}
        expect(prompts.join('')).not.toContain(g.subject);expect(prompts.join('')).not.toContain(g.capability);
      }
      const page=await r2.list();const rows=[];
      for(const object of page.objects)if(object.key.includes('/behavior/')&&object.key.includes('-managed-'))rows.push(...(await(await r2.get(object.key))!.text()).trim().split('\n').map(line=>JSON.parse(line)));
      expect(rows.length).toBeGreaterThan(0);expect(new Set(rows.map(r=>r.tenant))).toEqual(new Set(['acme','globex']));expect(forbidden).toBe(0);
    }finally{hold=false;release();await native.dispose();}
  }
},90000);

it('W15 native read-only polls, durable rendered sinks, exact retries and transaction deadline rollback on both hosts', async () => {
  for (const host of ['session', 'do']) {
    const policies = JSON.parse(nativeRetention);
    for (const tenant of ['acme', 'globex']) for (const category of ['recovery', 'quarantine']) policies.tenants[tenant][category] = {
      id: 'native-W15', revision: 1, durationMs: 86400000, basis: 'admitted', renewal: 'new-record-only' };
    let release: () => void = () => undefined, entered: () => void = () => undefined, outbound = 0;
    const native = new Miniflare({ cf: false, modules: [{ type: 'ESModule', path: 'w0102-worker.mjs', contents: runtimeBundle }],
      compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'],
      durableObjects: Object.fromEntries(['ShopperReflex', 'DecisionRing', 'LearnStats', 'PersonalizationWebSocket'].map((className, i) =>
        [['SHOPPER_REFLEX', 'DECISION_RING', 'LEARN_STATS', 'PERSONALIZATION_WEBSOCKET'][i]!, { className, useSQLite: true }])),
      kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
      serviceBindings: { W15_OBSERVER: async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return new Response('released'); } },
      bindings: { W15_FIXTURE: 'true', REFLEX_HOST: host, DEPLOYMENT_PROFILE: 'customer', AUTH_MODE: 'enforced',
        TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'], hosts: { 'acme.example': 'acme', 'globex.example': 'globex' } }),
        JWT_SECRET: SECRET, JWT_ISSUER: 'w15', JWT_AUDIENCE: 'w15', SDK_KEYS: 'acme:native-site,globex:native-site',
        RETENTION: JSON.stringify(policies), LEDGER_RECOVERY_ENABLED: 'true', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock' },
      outboundService() { outbound++; throw new Error('W15 refuses external network'); } });
    try {
      await native.ready;
      const send = async (input: unknown) => { const response = await native.dispatchFetch('https://fixture/', { method: 'POST', body: JSON.stringify(input) });
        expect(response.status).toBe(200); return response.json() as Promise<Record<string, unknown>>; };
      expect(await send({ w15: 'initialize' })).toEqual({ initialized: true });
      for (const tenant of ['acme', 'globex']) {
        const g = await send({ w14: 'session', tenant }) as unknown as { capability: string; subject: string; sessionId: string; grantId: string; iat: number; exp: number };
        const call = async (path: string, body: unknown) => { const r = await send({ w14: 'request', tenant, path, capability: g.capability, body });
          return { status: Number(r.status), body: JSON.parse(String(r.body)) as Record<string, unknown> }; };
        expect((await call('/realtime/session/preferences', { trackingConsent: true, personalizationEnabled: true,
          choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: g.grantId, iat: g.iat, exp: g.exp } })).status).toBe(200);
        expect((await call('/realtime/action', { type: 'product_view', source: 'sdk', userId: g.subject, sessionId: g.sessionId,
          timestamp: Date.now(), eventId: crypto.randomUUID(), data: { taste: 'fixture' } })).status).toBe(200);
        const state = async (binding: string) => (await send({ w15: 'state', binding, tenant, subject: g.subject })).entries as Array<[string, unknown]>;
        const recovery = async () => (await state('SHOPPER_REFLEX')).filter(([key]) => key.startsWith('recovery'));
        const before = await recovery(), beforeStats = await state('LEARN_STATS'), beforeRing = await state('DECISION_RING');
        const pageInstance = crypto.randomUUID(), snapshot = await call(`/v1/${tenant}/decisions/snapshot`, { page: 'home', pageInstance });
        expect(snapshot.status, JSON.stringify(snapshot.body)).toBe(200); expect(snapshot.body).not.toHaveProperty('records');
        await call(`/v1/${tenant}/decisions/snapshot`, { page: 'home', pageInstance: crypto.randomUUID() });
        expect(await recovery()).toEqual(before); expect(await state('LEARN_STATS')).toEqual(beforeStats); expect(await state('DECISION_RING')).toEqual(beforeRing);
        const piece = (snapshot.body.decisions as Array<{ contentId: string; decisionId: string; renderOffer: string }>)[0]!;
        expect(piece.renderOffer).toMatch(/^ro1\./);
        const event = { type: 'content_impression', source: 'sdk', userId: g.subject, sessionId: g.sessionId, eventId: crypto.randomUUID(), timestamp: Date.now(),
          ...(host === 'session' ? { processing: 'buffered', browsingSessionId: g.sessionId } : {}),
          data: { ...piece, slot: 'hero', position: 0, page: 'home', pageInstance } };
        const rendered = await call('/realtime/action', event); expect(rendered.status, JSON.stringify(rendered.body)).toBe(200);
        expect(rendered.body.render).toMatchObject({ status: 'durable', eventId: event.eventId, decisionId: piece.decisionId, pageInstance });
        const ring = new Map(await state('DECISION_RING')).get('ring') as { ring: Array<Record<string, unknown>> };
        expect(ring.ring).toHaveLength(1); expect(ring.ring[0]).toMatchObject({ decision_id: piece.decisionId, measurementBasis: 'rendered-v1',
          rendered: { at: event.timestamp, eventId: event.eventId, pageInstance } });
        const learned = await state('LEARN_STATS'); expect(new Map(learned).get('learn')).toMatchObject({ config: { measurementBasis: 'rendered-v1' },
          stats: { events: 1, items: { 'native-render': { '*': { n: { s: 1, t: event.timestamp } } } } } });
        const retained = await recovery(); expect((await call('/realtime/action', event)).body.render).toEqual(rendered.body.render);
        expect(await recovery()).toEqual(retained); expect(await state('LEARN_STATS')).toEqual(learned);
        if (host === 'do' && tenant === 'globex') {
          const nextPage = crypto.randomUUID(), next = await call(`/v1/${tenant}/decisions/snapshot`, { page: 'home', pageInstance: nextPage });
          const offered = (next.body.decisions as typeof piece[])[0]!, original = await recovery(), oldRing = await state('DECISION_RING');
          const arrived = new Promise<void>(resolve => { entered = resolve; }); await send({ w15: 'hold' });
          const pending = call('/realtime/action', { ...event, eventId: crypto.randomUUID(), timestamp: Date.now(), data: { ...event.data, ...offered, pageInstance: nextPage } });
          expect(await Promise.race([arrived.then(() => true), pending.then(() => false)])).toBe(true);
          await send({ w15: 'clock', offset: 300001 }); release(); expect((await pending).status).toBeGreaterThanOrEqual(400);
          expect(await recovery()).toEqual(original); expect(await state('DECISION_RING')).toEqual(oldRing); expect(await state('LEARN_STATS')).toEqual(learned);
          await send({ w15: 'clock', offset: 0 });
        }
      }
      expect(outbound).toBe(0);
    } finally { release(); await native.dispose(); }
  }
}, 90000);

it('W15 native OIDC uses real signed provider claims and D1 provenance with one-use completion and no redirect fallback', async () => {
  const provider = { enabled: true, issuer: 'https://issuer.example', authorizationEndpoint: 'https://issuer.example/authorize', tokenEndpoint: 'https://issuer.example/token',
    jwksUri: 'https://issuer.example/keys', origin: 'https://operator.example/', clientId: 'native-client', clientSecretRef: 'OPERATOR_OIDC_SECRET_FIXTURE',
    algorithms: ['ES256'], transactionMs: 30000, sessionMs: 120000, reauthMs: 180000, timeoutMs: 3000 };
  const keys = await generateKeyPair('ES256'), jwk = { ...await exportJWK(keys.publicKey), kid: 'native-key', use: 'sig', alg: 'ES256' };
  let nonce = '', verifier = '', redirect = false, forbidden = 0; const calls: string[] = [];
  const native = new Miniflare({ cf: false, modules: [{ type: 'ESModule', path: 'w0102-worker.mjs', contents: runtimeBundle }],
    compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], kvNamespaces: ['CACHE'],
    durableObjects: { RATE_LIMITER: { className: 'RateLimiter', useSQLite: true } },
    bindings: { DEPLOYMENT_PROFILE: 'customer', AUTH_MODE: 'enforced', TENANTS: JSON.stringify({ provisioned: ['acme'], hosts: { 'operator.example': 'acme' } }),
      JWT_SECRET: SECRET, JWT_ISSUER: 'native-auth', JWT_AUDIENCE: 'native-console', OPERATOR_OIDC: JSON.stringify({ version: 1, tenants: { acme: provider } }),
      OPERATOR_OIDC_SECRET_FIXTURE: 'w15-native-protected-synthetic-material' },
    outboundService: async (request: Request) => {
      calls.push(request.url); if (request.url === provider.tokenEndpoint) {
        if (redirect) return new Response('refused', { status: 302, headers: { Location: 'https://unapproved.example/steal' } });
        const form = new URLSearchParams(await request.text()); expect(form.get('code_verifier')).toBe(verifier); expect(form.get('client_secret')).toBe('w15-native-protected-synthetic-material');
        const now = Math.floor(Date.now() / 1000), token = await new SignJWT({ iss: provider.issuer, sub: 'native-subject', aud: provider.clientId, nonce,
          auth_time: now, email: 'not-an-authority@example.invalid', groups: ['admin'] }).setProtectedHeader({ alg: 'ES256', kid: 'native-key' }).setIssuedAt(now).setExpirationTime(now + 300).sign(keys.privateKey);
        return Response.json({ id_token: token });
      }
      if (request.url === provider.jwksUri) return Response.json({ keys: [jwk] }); forbidden++; throw new Error('Native OIDC destination refused');
    } });
  try {
    await native.ready; const db = await native.getD1Database('DB');
    for (const name of ['0010_operator_accounts.sql', '0011_operator_audit_tenant.sql', '0012_operator_authority.sql', '0013_operator_oidc.sql'])
      await db.exec(readFileSync(resolve('migrations/product', name), 'utf8').replace(/^\s*--.*$/gm, '').replace(/\s+/g, ' ').trim());
    const at = Date.now();
    await db.prepare("INSERT INTO operator_accounts(id,email,name,roles,permissions,password_hash,must_change_password,disabled,created_at,updated_at,auth_mode) VALUES('native-operator','native@example.invalid','Native','[\"operator\"]','[\"read\"]',NULL,0,0,?,?,'oidc')").bind(at, at).run();
    await db.prepare('INSERT INTO operator_oidc_links VALUES(?,?,?,?,?,?)').bind('native-operator', provider.issuer, 'native-subject', 'native-link', 0, at).run();
    await db.prepare('INSERT INTO operator_memberships VALUES(?,?,?,?,?,?,?)').bind('native-operator', 'acme', 'operator', 0, 0, 'native-member', at).run();
    const send = async (path: string, body?: unknown, headers: Record<string, string> = {}, method = 'POST') => {
      const response = await native.dispatchFetch('https://fixture/', { method: 'POST', body: JSON.stringify({ w15: 'request', tenant: 'acme', path, method, body, headers }) });
      expect(response.status).toBe(200); const r = await response.json() as { status: number; body: string; headers: Record<string, string> };
      return { ...r, data: r.body && r.headers['content-type']?.includes('json') ? JSON.parse(r.body) as Record<string, unknown> : {} };
    };
    const begin = async () => {
      const begun = await send('/auth/oidc/start', { email: 'native@example.invalid' }, { Origin: 'https://operator.example' }); expect(begun.status, begun.body).toBe(200);
      const url = new URL(String(begun.data.authorizationUrl)), state = url.searchParams.get('state')!;
      const tx = await db.prepare('SELECT nonce,verifier FROM operator_oidc_transactions WHERE state=?').bind(state).first<{ nonce: string; verifier: string }>();
      nonce = tx!.nonce; verifier = tx!.verifier; expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBe(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url'));
      return { cookie: begun.headers['set-cookie']!.split(';')[0]!, path: '/auth/oidc/callback/acme?state=' + state + '&code=local-code&iss=' + encodeURIComponent(provider.issuer) };
    };
    const begun = await begin(), callback = await send(begun.path, undefined, { Cookie: begun.cookie }, 'GET');
    expect(callback.status, callback.body).toBe(303); expect(callback.headers.location).toBe('https://operator.example/console?oidc=complete&tenant=acme');
    expect(calls).toEqual([provider.tokenEndpoint, provider.jwksUri]); expect(callback.headers.location).not.toMatch(/token|code=/);
    const completed = await send('/auth/oidc/complete', {}, { Origin: 'https://operator.example', Cookie: begun.cookie }); expect(completed.status, completed.body).toBe(200);
    const claims = decodeJwt(String(completed.data.accessToken)); expect(claims).toMatchObject({ sub: 'native-operator', authMethod: 'oidc' }); expect(claims).not.toHaveProperty('roles');
    const protectedRead = () => send('/auth/authority', undefined, { Authorization: 'Bearer ' + completed.data.accessToken }, 'GET');
    expect((await protectedRead()).data).toMatchObject({ customer: true, tenantRole: 'operator', stampOwner: false });
    expect((await send('/auth/oidc/complete', {}, { Origin: 'https://operator.example', Cookie: begun.cookie })).status).toBe(401);
    await db.prepare('DELETE FROM operator_oidc_sessions WHERE session_id=?').bind(String(claims.sid)).run();
    expect((await protectedRead()).status).toBe(401); expect((await send('/auth/refresh', { refreshToken: completed.data.refreshToken })).status).toBe(401);
    redirect = true; const second = await begin(), previous = calls.length;
    expect((await send(second.path, undefined, { Cookie: second.cookie }, 'GET')).status).toBe(401);
    expect(calls.slice(previous)).toEqual([provider.tokenEndpoint]); expect(forbidden).toBe(0);
  } finally { await native.dispose(); }
}, 60000);

it('W12.02 real native source delivery, both hosts and tenants preserve customer namespaces', async () => {
  const { configuredOperationalDestinations } = await import('@/connectors/config');
  const destinations = ['CACHE', 'SESSIONS', 'STORAGE', 'EVENT_QUEUE', 'SHOPPER_REFLEX', 'DECISION_RING', 'LEARN_STATS', 'REGION_TREND', 'PERSONALIZATION_WEBSOCKET']
    .map(binding => ({ binding, purpose: 'isolated-synthetic-monitor', namespace: 'ops-synthetic-v1', accessPolicy: 'W12-local-only' }));
  const synthetic = { version: 1, enabled: true, lifetimeMs: 120000, stageMs: 10000, decisionMs: 200, eventMs: 300,
    thresholdSource: 'document-32-server-diagnostics', destinations };
  const policyEnv = { TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'] }), ENVIRONMENT: 'test', TENANT_CONNECTORS: JSON.stringify({ version: 1,
    tenants: Object.fromEntries(['acme', 'globex'].map(tenant => [tenant, { telemetry: { environment: 'test', schema: 'ops-v1', synthetic } }])) }) } as Env;
  const policies = JSON.parse(nativeRetention);
  for (const tenant of ['acme', 'globex']) for (const d of await configuredOperationalDestinations(policyEnv, tenant)) policies.tenants[tenant][d.category] = {
    id: 'W12-local-only', revision: 1, durationMs: 120000, basis: 'occurred', renewal: 'new-record-only' };
  const observed: Array<{ queue: string; messages: Array<{ body: unknown }> }> = []; let external = 0;
  const options: ConstructorParameters<typeof Miniflare>[0] = { cf: false, name: 'w1202', modules: [{ type: 'ESModule', path: 'w0102-worker.mjs', contents: runtimeBundle }],
    compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: Object.fromEntries(['ShopperReflex', 'DecisionRing', 'LearnStats', 'RegionTrend', 'PersonalizationWebSocket'].map((className, index) =>
      [['SHOPPER_REFLEX', 'DECISION_RING', 'LEARN_STATS', 'REGION_TREND', 'PERSONALIZATION_WEBSOCKET'][index]!, { className, useSQLite: true }])),
    r2Buckets: ['STORAGE'], kvNamespaces: ['CACHE', 'SESSIONS'], d1Databases: ['DB'],
    queueProducers: { EVENT_QUEUE: 'w1202-source' }, queueConsumers: {
      'w1202-source': { maxBatchTimeout: 0, maxRetries: 1, deadLetterQueue: 'w1202-dlq' }, 'w1202-dlq': { maxBatchTimeout: 0, maxRetries: 1 } },
    serviceBindings: { W0906_OBSERVER: async (request: Request) => { observed.push(await request.json() as typeof observed[number]); return new Response('observed'); } },
    bindings: { ...policyEnv, W12_FIXTURE: 'true', RETENTION: JSON.stringify(policies), DEPLOYMENT_PROFILE: 'customer', AUTH_MODE: 'enforced',
      JWT_SECRET: SECRET, JWT_ISSUER: 'w1202', JWT_AUDIENCE: 'w1202', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
      LEDGER_RECOVERY_ENABLED: 'true', LEDGER_RECOVERY_CONFIG: JSON.stringify({ version: 1, sourceQueue: 'w1202-source', deadLetterQueue: 'w1202-dlq' }) },
    outboundService() { external++; throw new Error('W12 denies outbound network'); },
  };
  const native = new Miniflare(options);
  try {
    await native.ready;
    const send = async (body: unknown) => (await native.dispatchFetch('http://fixture/', { method: 'POST', body: JSON.stringify(body) })).json() as Promise<Record<string, unknown>>;
    expect(await send({ w12: 'initialize' })).toEqual({ initialized: true });
    expect(await send({ w12: 'schema' })).toEqual({ ok: false });
    const database = await native.getD1Database('DB');
    await database.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
    for (const name of ['0010_operator_accounts.sql', '0011_operator_audit_tenant.sql', '0012_operator_authority.sql', '0013_operator_oidc.sql']) {
      // D1.exec treats lines as statements; flatten comments/formatting while
      // keeping the migration's complete SQL (including its trigger) intact.
      await database.exec(readFileSync(resolve('migrations/product', name), 'utf8').replace(/^\s*--.*$/gm, '').replace(/\s+/g, ' ').trim());
      await database.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name).run();
    }
    expect(await send({ w12: 'schema' })).toEqual({ ok: true });
    let cache = await native.getKVNamespace('CACHE'), sessions = await native.getKVNamespace('SESSIONS'), storage = await native.getR2Bucket('STORAGE');
    await cache.put('lift:acme:acme:hero', 'CUSTOMER-CACHE'); await sessions.put('t:globex:session:customer', 'CUSTOMER-SESSION');
    await storage.put('acme/customer-evidence', 'CUSTOMER-LEDGER');
    const ordinary = async () => ({ cache: await Promise.all((await cache.list()).keys.filter(k => !k.name.startsWith('ops-synthetic-v1/')).map(async k => [k.name, await cache.get(k.name)])),
      sessions: await Promise.all((await sessions.list()).keys.filter(k => !k.name.startsWith('ops-synthetic-v1/')).map(async k => [k.name, await sessions.get(k.name)])),
      storage: await Promise.all((await storage.list()).objects.filter(o => !o.key.startsWith('ops-synthetic-v1/')).map(async o => [o.key, await (await storage.get(o.key))!.text()])) });
    const before = await ordinary(), results = [];
    for (const tenant of ['acme', 'globex']) for (const host of ['session', 'do']) {
      const result = await send({ w12: 'run', tenant, host }); results.push({ tenant, host, ...result });
      console.log('W12.02 native result ' + JSON.stringify(results.at(-1)));
      expect(result).toMatchObject({ decision: true, event: true, producer: true, consumer: true, ledger: true, learning: true, dlq: false });
      expect(['complete', 'failed']).toContain(result.state); // Explicit 200/300ms diagnostic thresholds remain visible on cold native runs.
      if (result.state === 'failed') expect(result.latencyExceeded).toBe(true);
    }
    expect(await ordinary()).toEqual(before);
    for (const mode of ['archive', 'lift']) {
      await send({ w12: 'mode', mode });
      const failed = await send({ w12: 'run', tenant: 'acme', host: 'session' });
      expect(failed.state).not.toBe('complete'); expect(failed.learning).toBe(false);
      expect(await ordinary()).toEqual(before);
      await send({ w12: 'mode', mode: '' });
      expect(await send({ w12: 'run', tenant: 'acme', host: 'session' })).toMatchObject({ producer: true, consumer: true, ledger: true, learning: true });
    }
    type Envelope = { kind: string; scope: { value: { tenant: string; host: string } } };
    const envelope = observed.flatMap(batch => batch.messages).map(message => message.body as Envelope)
      .find(body => body.kind === 'ops-synthetic-v1' && body.scope.value.tenant === 'acme' && body.scope.value.host === 'session');
    expect(envelope).toBeDefined();
    const canonicalLedger = async () => Promise.all((await storage.list({ prefix: 'ops-synthetic-v1/acme/session/data/' })).objects
      .filter(object => /\/acme\/\d{4}-\d{2}-\d{2}\//.test(object.key)).map(async object => [object.key, await (await storage.get(object.key))!.text()]));
    const ledgerBefore = await canonicalLedger(); expect(ledgerBefore.length).toBeGreaterThan(0);
    expect(await send({ w12: 'queue', queue: 'w1202-source', bodies: [envelope, envelope] })).toEqual({ positions: [['ack', 0], ['ack', 1]] });
    expect(await canonicalLedger()).toEqual(ledgerBefore);
    const forged = structuredClone(envelope!); forged.scope.value.tenant = 'globex';
    expect(await send({ w12: 'queue', queue: 'w1202-source', bodies: [forged, envelope] })).toEqual({ positions: [['retry', 0], ['ack', 1]] });
    expect(await canonicalLedger()).toEqual(ledgerBefore); expect(await ordinary()).toEqual(before);
    await send({ w12: 'mode', mode: 'dlq-failed' });
    expect(await send({ w12: 'queue', queue: 'w1202-dlq', bodies: [envelope] })).toEqual({ positions: [['retry', 0]] });
    await send({ w12: 'mode', mode: '' });
    expect(await send({ w12: 'queue', queue: 'w1202-dlq', bodies: [envelope] })).toEqual({ positions: [['ack', 0]] });
    const deadLetter = await send({ w12: 'run', tenant: 'acme', host: 'session' });
    expect(deadLetter.state).not.toBe('complete'); expect(deadLetter.dlq).toBe(true);
    expect(await ordinary()).toEqual(before);
    const bindings = ['SHOPPER_REFLEX', 'DECISION_RING', 'LEARN_STATS', 'REGION_TREND', 'PERSONALIZATION_WEBSOCKET'];
    const nativeCall = async (binding: string, path: string) => {
      const namespace = await native.getDurableObjectNamespace(binding);
      return namespace.get(namespace.idFromName('ops-synthetic-v1/acme/session/' + binding + '/0')).fetch('https://native/__w12/' + path);
    };
    type Marker = { terminal?: boolean; call: { value: { scope: { value: { expiresAt: number; operation: string } } } } };
    const markerOf = (entries: Array<[string, unknown]>) => entries.find(([key]) => key === '__monitor_authority_v1')![1] as Marker;
    const state = async (binding: string) => (await nativeCall(binding, 'state')).json() as Promise<{ entries: Array<[string, unknown]>; alarm: number | null; work: number; resets: number }>;
    for (const binding of bindings) {
      const initial = await state(binding);
      await send({ w12: 'native', tenant: 'acme', host: 'session', binding });
      const admitted = await state(binding); expect(admitted.work).toBeGreaterThan(initial.work);
      expect(admitted.entries.some(([key]) => key === '__monitor_authority_v1')).toBe(true);
      const namespace = await native.getDurableObjectNamespace(binding);
      const wrong = namespace.get(namespace.idFromName('ops-synthetic-v1/acme/session/' + binding + '/1'));
      const wrongBefore = await (await wrong.fetch('https://native/__w12/state')).json();
      expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding, wrongPhysical: true })).status).not.toBe(200);
      expect(await (await wrong.fetch('https://native/__w12/state')).json()).toEqual(wrongBefore);
      expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding, wrongUrl: true })).status).not.toBe(200);
      expect(await state(binding)).toEqual(admitted);
      for (const tamper of [{ wrongOwner: true }, { wrongBody: true }]) {
        expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding, value: 'signed-body', ...tamper })).status).not.toBe(200);
        expect(await state(binding)).toEqual(admitted);
      }
      expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding, value: 'prior-live-row' })).status).toBe(200);
      const prior = (await state(binding)).entries;
      await send({ w12: 'mode', mode: 'native-before' });
      expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding, value: 'must-not-replace' })).status).toBe(503);
      expect((await state(binding)).entries).toEqual(prior);
      await send({ w12: 'mode', mode: 'native-after' });
      expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding, value: 'committed-live-row' })).status).toBe(503);
      const retained = (await state(binding)).entries;
      expect(retained.find(([key]) => key.endsWith('/monitor-sentinel'))?.[1]).toBe('committed-live-row');
      expect(retained.filter(([key]) => !key.endsWith('/monitor-sentinel'))).toEqual(prior.filter(([key]) => !key.endsWith('/monitor-sentinel')));
      await send({ w12: 'mode', mode: '' });
    }
    const snapshots = await Promise.all(bindings.map(state));
    expect(snapshots.every(s => s.entries.some(([key]) => key === '__monitor_authority_v1'))).toBe(true);
    // Early alarms under revoked policy must keep original expiry armed.
    await send({ w12: 'mode', mode: 'revoked' });
    for (const binding of bindings) await nativeCall(binding, 'wake');
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const retained of await Promise.all(bindings.map(state))) {
      const deadline = markerOf(retained.entries).call.value.scope.value.expiresAt;
      expect(retained.alarm).toBe(deadline);
    }
    // A real worker restart rehydrates the same native SQLite/R2/KV state.
    const revoked = { ...options.bindings }; delete revoked.RETENTION;
    await nativeCall('PERSONALIZATION_WEBSOCKET', 'drop-alarm');
    await native.setOptions({ ...options, bindings: { ...revoked, W12_RESTART: 'failed-original-alarm', W12_ALARM_FAILURE: 'set', W12_INIT_FAILURE: 'true' } });
    await expect(state('PERSONALIZATION_WEBSOCKET')).rejects.toThrow();
    const ordinaryRelay = await native.getDurableObjectNamespace('PERSONALIZATION_WEBSOCKET');
    await expect(ordinaryRelay.get(ordinaryRelay.idFromName('w12-ordinary-initializer')).fetch('https://native/__w12/state')).rejects.toThrow();
    await native.setOptions({ ...options, bindings: { ...revoked, W12_RESTART: '1' } });
    cache = await native.getKVNamespace('CACHE'); sessions = await native.getKVNamespace('SESSIONS'); storage = await native.getR2Bucket('STORAGE');
    expect(await ordinary()).toEqual(before);
    for (const retained of await Promise.all(bindings.map(state))) {
      const deadline = markerOf(retained.entries).call.value.scope.value.expiresAt;
      expect(retained.alarm).toBe(deadline);
    }
    expect((await state('PERSONALIZATION_WEBSOCKET')).work).toBe(0); // Revoked initialization read no connection rows.
    await send({ w12: 'mode', mode: 'revoked', offset: 130000 });
    for (const binding of bindings) await nativeCall(binding, 'wake');
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await Promise.all(bindings.map(state))).every(s => s.entries.length === 1 && markerOf(s.entries).terminal === true && s.alarm === null)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    for (const retained of await Promise.all(bindings.map(state))) {
      expect(retained.entries).toHaveLength(1); expect(markerOf(retained.entries).terminal).toBe(true); expect(retained.alarm).toBeNull();
    }
    expect((await storage.list({ prefix: 'ops-synthetic-v1/acme/session/data/' })).objects).toEqual([]);
    expect((await storage.list({ prefix: 'ops-synthetic-v1/acme/session/debt/' })).objects).toEqual([]);
    expect((await cache.list({ prefix: 'ops-synthetic-v1/acme/session/data/' })).keys).toEqual([]);
    expect((await sessions.list({ prefix: 'ops-synthetic-v1/acme/session/data/' })).keys).toEqual([]);
    expect(await ordinary()).toEqual(before); // No next monitor invocation manufactures cleanup.
    const expired = markerOf((await state('PERSONALIZATION_WEBSOCKET')).entries).call.value.scope.value;
    const lateKey = 'ops-synthetic-v1/acme/session/data/' + expired.operation + '/late-cleanup-fixture';
    await storage.put(lateKey, 'synthetic-only');
    await native.setOptions({ ...options, bindings: { ...revoked, W12_RESTART: 'failed-retry-alarm', W12_CLOCK_OFFSET: '130000', W12_ALARM_FAILURE: 'set', W12_CLEANUP_FAILURE: 'true' } });
    await expect(state('PERSONALIZATION_WEBSOCKET')).rejects.toThrow();
    await native.setOptions({ ...options, bindings: { ...revoked, W12_RESTART: 'recovered-retry-alarm', W12_CLOCK_OFFSET: '130000' } });
    storage = await native.getR2Bucket('STORAGE'); cache = await native.getKVNamespace('CACHE'); sessions = await native.getKVNamespace('SESSIONS');
    expect((await state('PERSONALIZATION_WEBSOCKET')).alarm).toBeNull(); expect(await storage.get(lateKey)).toBeNull();
    expect(await ordinary()).toEqual(before);
    await native.setOptions({ ...options, bindings: { ...options.bindings, W12_RESTART: '2' } });
    cache = await native.getKVNamespace('CACHE'); sessions = await native.getKVNamespace('SESSIONS'); storage = await native.getR2Bucket('STORAGE');
    let offset = 260000;
    for (const mode of ['disabled', 'queue-rejected', 'queue-empty', 'queue-paused']) {
      const observedBefore = observed.length;
      await send({ w12: 'mode', mode, offset }); offset += 130000;
      const failed = await send({ w12: 'run', tenant: 'acme', host: 'session' });
      expect(failed.state).not.toBe('complete'); expect(failed.consumer).toBe(false);
      if (mode === 'disabled') expect(failed.decision).toBe(false);
      if (mode === 'queue-paused') expect(observed.slice(observedBefore).some(batch => batch.messages.some(message => (message.body as Envelope).scope?.value?.tenant === 'acme'))).toBe(true);
      expect(await ordinary()).toEqual(before);
    }
    // A real R2 commit with a rejected acknowledgement after original expiry
    // leaves exact disposal debt when deletion fails, then survives restart.
    await send({ w12: 'mode', mode: 'disabled', offset });
    await send({ w12: 'run', tenant: 'acme', host: 'session' }); // Dispose prior operation without allocating another.
    await send({ w12: 'mode', mode: '' });
    await send({ w12: 'gate', action: 'arm', kind: 'write' });
    const deferred = send({ w12: 'run', tenant: 'acme', host: 'session' });
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await send({ w12: 'gate', action: 'status' })).entered) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect((await send({ w12: 'gate', action: 'status' })).entered).toBe(true);
    offset += 130000;
    await send({ w12: 'mode', mode: '', offset });
    await send({ w12: 'gate', action: 'release', cleanupReject: true });
    expect((await deferred).state).not.toBe('complete');
    const debts = (await storage.list({ prefix: 'ops-synthetic-v1/acme/session/debt/' })).objects;
    expect(debts.length).toBeGreaterThan(0);
    expect((await Promise.all(debts.map(async object => (await (await storage.get(object.key))!.json() as { phase: string }).phase))).every(phase => phase === 'settled')).toBe(true);
    await native.setOptions({ ...options, bindings: { ...revoked, W12_RESTART: '3' } });
    cache = await native.getKVNamespace('CACHE'); sessions = await native.getKVNamespace('SESSIONS'); storage = await native.getR2Bucket('STORAGE');
    await send({ w12: 'mode', mode: 'revoked', offset });
    for (const binding of bindings) await nativeCall(binding, 'wake');
    for (let attempt = 0; attempt < 60; attempt++) {
      if (!(await storage.list({ prefix: 'ops-synthetic-v1/acme/session/debt/' })).objects.length) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect((await storage.list({ prefix: 'ops-synthetic-v1/acme/session/debt/' })).objects).toEqual([]);
    expect((await storage.list({ prefix: 'ops-synthetic-v1/acme/session/data/' })).objects).toEqual([]);
    expect(await ordinary()).toEqual(before);
    // The same five real SQLite classes reconcile an ambiguous generation
    // replacement, and stale signed requests cannot replace a successor even
    // after that successor's own expiry.
    await native.setOptions({ ...options, bindings: { ...options.bindings, W12_RESTART: '4' } });
    cache = await native.getKVNamespace('CACHE'); sessions = await native.getKVNamespace('SESSIONS'); storage = await native.getR2Bucket('STORAGE');
    offset += 130000; await send({ w12: 'mode', mode: '', offset });
    const operationA = await send({ w12: 'renew', tenant: 'acme', host: 'session' });
    for (const binding of bindings) expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding, scope: operationA, value: 'operation-A' })).status).toBe(200);
    offset += 130000; await send({ w12: 'mode', mode: 'replace-after', offset });
    const operationB = await send({ w12: 'renew', tenant: 'acme', host: 'session' });
    for (const binding of bindings) {
      const prior = await state(binding);
      expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding, scope: operationB, value: 'operation-B' })).status).toBe(503);
      const committed = await state(binding);
      expect(markerOf(committed.entries).call.value.scope).toEqual(operationB);
      expect(committed.entries).toHaveLength(1); expect(committed.resets).toBeGreaterThan(prior.resets);
      expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding, scope: operationB, value: 'operation-B' })).status).toBe(200);
      const successor = await state(binding);
      expect(successor.entries.find(([key]) => key.endsWith('/monitor-sentinel'))?.[1]).toBe('operation-B');
      expect(successor.resets).toBe(committed.resets);
      expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding, scope: operationA, value: 'replay-A' })).status).not.toBe(200);
      expect(await state(binding)).toEqual(successor);
    }
    offset += 130000; await send({ w12: 'mode', mode: '', offset });
    for (const binding of bindings) {
      const expiredSuccessor = await state(binding);
      expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding, scope: operationA, value: 'replay-expired-A' })).status).not.toBe(200);
      expect(await state(binding)).toEqual(expiredSuccessor);
    }
    const operationC = await send({ w12: 'renew', tenant: 'acme', host: 'session' });
    const oldOperation = markerOf((await state('SHOPPER_REFLEX')).entries).call.value.scope.value.operation;
    await storage.put('ops-synthetic-v1/acme/session/data/' + oldOperation + '/held-disposal', 'synthetic-only');
    await send({ w12: 'gate', action: 'arm', kind: 'validation' });
    const admission = send({ w12: 'native', tenant: 'acme', host: 'session', binding: 'SHOPPER_REFLEX', scope: operationC, value: 'operation-C' });
    for (let attempt = 0; attempt < 100 && !(await send({ w12: 'gate', kind: 'validation' })).entered; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    expect((await send({ w12: 'gate', kind: 'validation' })).entered).toBe(true);
    await send({ w12: 'gate', action: 'arm', kind: 'delete' }); await nativeCall('SHOPPER_REFLEX', 'wake');
    for (let attempt = 0; attempt < 100 && !(await send({ w12: 'gate' })).entered; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    expect((await send({ w12: 'gate' })).entered).toBe(true);
    await send({ w12: 'gate', action: 'release', kind: 'validation' });
    expect((await admission).status).not.toBe(200);
    expect(markerOf((await state('SHOPPER_REFLEX')).entries).call.value.scope.value.operation).toBe(oldOperation);
    const deletes = (await send({ w12: 'gate' })).deletes;
    offset += 31000; await send({ w12: 'mode', offset });
    for (let retry = 0; retry < 3; retry++) { await nativeCall('SHOPPER_REFLEX', 'wake'); await new Promise(resolve => setTimeout(resolve, 20)); }
    expect((await send({ w12: 'gate' })).deletes).toBe(deletes);
    expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding: 'SHOPPER_REFLEX', scope: operationC, value: 'still-refused' })).status).not.toBe(200);
    await send({ w12: 'gate', action: 'release' });
    for (let attempt = 0; attempt < 100 && (await state('SHOPPER_REFLEX')).alarm !== null; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    expect((await send({ w12: 'native', tenant: 'acme', host: 'session', binding: 'SHOPPER_REFLEX', scope: operationC, value: 'operation-C' })).status).toBe(200);
    const successor = await state('SHOPPER_REFLEX');
    await new Promise(resolve => setTimeout(resolve, 50)); expect(await state('SHOPPER_REFLEX')).toEqual(successor);
    expect(successor.alarm).toBe(markerOf(successor.entries).call.value.scope.value.expiresAt);
    for (const binding of bindings.slice(1)) await nativeCall(binding, 'wake');
    offset += 130000; await send({ w12: 'mode', offset }); await nativeCall('SHOPPER_REFLEX', 'wake');
    for (let attempt = 0; attempt < 100 && (await state('SHOPPER_REFLEX')).alarm !== null; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    for (const binding of bindings) { const disposed = await state(binding); expect(disposed.entries).toHaveLength(1); expect(disposed.alarm).toBeNull(); }
    expect(await ordinary()).toEqual(before);
    // A late successful observation cannot mutate the private terminal failure
    // while its real control persistence is awaiting acknowledgement.
    await send({ w12: 'gate', action: 'arm', kind: 'observe' });
    await send({ w12: 'gate', action: 'arm', kind: 'control' });
    const lateObservation = send({ w12: 'run', tenant: 'acme', host: 'session' });
    for (let attempt = 0; attempt < 600 && !(await send({ w12: 'gate', kind: 'control' })).entered; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
    expect((await send({ w12: 'gate', kind: 'observe' })).entered).toBe(true);
    expect((await send({ w12: 'gate', kind: 'control' })).entered).toBe(true);
    await send({ w12: 'gate', action: 'release', kind: 'observe' }); await new Promise(resolve => setTimeout(resolve, 50));
    await send({ w12: 'gate', action: 'release', kind: 'control' });
    const terminal = await lateObservation;
    expect(terminal).toMatchObject({ state: 'failed', failedStage: 'observation', learning: false });
    const retainedControl = await (await storage.get('ops-synthetic-v1/acme/session/control.json'))!.json() as { result: unknown };
    expect(retainedControl.result).toEqual(terminal); expect(await ordinary()).toEqual(before);
    const freshEnvelope = observed.flatMap(batch => batch.messages).map(message => message.body as Envelope)
      .filter(body => body.kind === 'ops-synthetic-v1' && body.scope.value.tenant === 'acme' && body.scope.value.host === 'session').at(-1)!;
    await send({ w12: 'gate', action: 'arm', kind: 'validation' });
    const at = Date.now() + offset, visitor = 'vis-w12-ordinary-sibling';
    const ordinaryMessage = { kind: 'ledger', type: 'decisions', records: [{ decision_id: `globex:${ts36(at)}:${visitor}:home:hero:0`,
      tenant: 'globex', brand: 'globex', visitor_id: visitor, session_id: 'ordinary-sibling', ts: at, page: 'home', slot: 'hero', item_id: 'native-item',
      position: 0, arm: 'personalized', retention: captureRetention({ ...policyEnv, RETENTION: JSON.stringify(policies) }, 'globex', at, at) }] };
    const began = Date.now(), classified = send({ w12: 'queue', queue: 'w1202-source', bodies: [freshEnvelope, ordinaryMessage] });
    for (let attempt = 0; attempt < 100 && !(await send({ w12: 'gate', kind: 'validation' })).entered; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    expect((await send({ w12: 'gate', kind: 'validation' })).entered).toBe(true);
    expect(await classified).toEqual({ positions: [['retry', 0], ['ack', 1]] }); expect(Date.now() - began).toBeLessThan(32000);
    const settled = await ordinary();
    await send({ w12: 'gate', action: 'release', kind: 'validation' }); await new Promise(resolve => setTimeout(resolve, 100));
    expect(await ordinary()).toEqual(settled);
    expect((await storage.list({ prefix: 'globex/' })).objects.length).toBeGreaterThan(0);
    expect(await cache.get('lift:acme:acme:hero')).toBe('CUSTOMER-CACHE');
    expect(await sessions.get('t:globex:session:customer')).toBe('CUSTOMER-SESSION');
    expect(observed.some(batch => batch.queue === 'w1202-source')).toBe(true);
    expect(external).toBe(0);
  } finally { await native.dispose(); }
}, 135000); // Existing 90s native work plus the explicit 30s stalled-consumer boundary.

it('W10.03 native SQLite bounded waves, exact repair, ambiguous writes and persisted process restart', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'w1003-native-'));
  const policy = { TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'] }), RETENTION: nativeRetention };
  let native: Miniflare | undefined;
  const open = async () => {
    native = new Miniflare({ name: 'w1003', modules: [{ type: 'ESModule', path: 'w0102-worker.mjs', contents: runtimeBundle }],
      compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'], cf: false,
      durableObjects: { LEARN_STATS: { className: 'LearnStats', useSQLite: true }, DECISION_RING: { className: 'DecisionRing', useSQLite: true } },
      durableObjectsPersist: resolve(directory, 'do'), kvNamespaces: ['CACHE'], kvPersist: resolve(directory, 'kv'),
      r2Buckets: ['STORAGE'], r2Persist: resolve(directory, 'r2'),
      bindings: policy,
      outboundService: () => { outboundAttempts++; throw new Error('W10 offline fixture'); },
    }); await native.ready;
    const ns = await native.getDurableObjectNamespace('LEARN_STATS'), rs = await native.getDurableObjectNamespace('DECISION_RING');
    return { stats: ns.get(ns.idFromName('acme:acme:hero')), legacy: ns.get(ns.idFromName('acme:acme:legacy')),
      limit: ns.get(ns.idFromName('synthetic-native-limit')), ring: rs.get(rs.idFromName('acme:v1')) };
  };
  const ask = async (target: Awaited<ReturnType<typeof open>>['stats'], path: string, body: unknown) => target.fetch('https://learning' + path, { method: 'POST', body: JSON.stringify(body) });
  const at = Date.now(), config = { reward: 'click', stats: DEFAULT_STATS }, cell = { channel: 'direct', visit_bucket: '1' as const, region: null, affinity: null };
  const scope = { tenant: 'acme', brand: 'acme', slot: 'hero' }, records: Array<Record<string, unknown>> = [];
  try {
    let targets = await open(), total = 0;
    const configuration = await (await native!.dispatchFetch('http://w/configuration', {
      method: 'POST', body: JSON.stringify({ learningConfiguration: 'initialize' }),
    })).json();
    console.log('W10.03 native phase limit');
    const ceiling = await (await ask(targets.limit, '/__learning_fixture', { action: 'limit', bytes: 3 * 1024 * 1024 })).json() as { accepted: boolean; error?: string };
    console.log('W10.03 exact native limit response ' + JSON.stringify(ceiling));
    expect(ceiling).toMatchObject({ accepted: false });
    expect(ceiling.error).toMatch(/SQLITE_TOOBIG/);
    expect((await (await ask(targets.limit, '/__learning_fixture', { action: 'summary' })).json() as { keys: string[] }).keys).not.toContain('synthetic-limit-probe');
    console.log('W10.03 native phase waves');
    let firstWave: Record<string, unknown> | undefined;
    const waves = async (start: number, count: number) => {
      for (let wave = start; wave < start + count; wave++) {
        const exposures = Array.from({ length: 100 }, (_, i) => ({ item: 'item' + (wave * 100 + i) % 320,
          cell: { ...cell, region: 'region' + wave, affinity: 'affinity' + i }, ts: at }));
        const generation = await (await ask(targets.stats, '/generation', { items: exposures.map(row => row.item) })).json() as { whole: number; items: Record<string, number> };
        const retention = captureRetention(policy, 'acme', at).online!;
        const managed = await Promise.all(exposures.map(async (row, i) => {
          const decision = `acme:${at.toString(36)}:v1:s1:home:hero:${wave}-${i}`;
          return { ...row, effect: { version: 1, id: await learningEffectId('exposures', 'acme:acme:hero', decision), decision,
            tenant: 'acme', subject: 'v1', generation: { whole: generation.whole, item: generation.items[row.item] ?? 0 },
            retention, consentUntil: retention.expiresAt } };
        }));
        const body = { ...scope, config, version: 2, exposures: managed }; firstWave ??= body;
        const res = await ask(targets.stats, '/exposures', body);
        expect(res.status, await res.clone().text()).toBe(200); total += exposures.length;
        const summary = await (await ask(targets.stats, '/__learning_fixture', { action: 'summary' })).json() as Record<string, number>;
        expect(summary.root).toBe(total); expect(summary.accounted).toBe(total); expect(summary.items).toBeLessThanOrEqual(256);
        expect(summary.effects).toBe((wave + 1) * 100);
        expect(summary.bytes).toBeLessThanOrEqual(LEARN_LIMITS.totalBytes); records.push({ wave, ...summary });
      }
    };
    await waves(0, 8);
    console.log('W10.03 native phase ambiguous writes');
    for (const mode of ['before', 'after']) {
      console.log('W10.03 native fault ' + mode);
      await ask(targets.stats, '/__learning_fixture', { action: 'fault', mode });
      let outcome: number | string;
      try {
        const response = await ask(targets.stats, '/exposures', { ...scope, config, exposures: [{ item: 'item0', cell, ts: at }] });
        outcome = response.status; await response.text();
      } catch (error) { outcome = error instanceof Error ? error.message : String(error); }
      expect(outcome === 503 || String(outcome).includes('terminated')).toBe(true);
      console.log('W10.03 native fault acknowledgement ' + JSON.stringify({ mode, outcome }));
      if (mode === 'after') total++;
      console.log('W10.03 native fault snapshot begin ' + mode);
      const snapshotResponse = await native!.dispatchFetch('http://w/snapshot', { method: 'POST', body: JSON.stringify({ learningRead: 'snapshot' }) });
      const snap = await snapshotResponse.json() as { status: number; events: number };
      expect(snap.status).toBe(200); expect(snap.events).toBe(total);
      console.log('W10.03 native fault durable state ' + JSON.stringify({ mode, ...snap }));
    }
    console.log('W10.03 native phase publication');
    // Consume the production DO response inside native workerd, independently
    // of the Node DO-proxy response stream that terminated in earlier attempts.
    const publicationResponse = await native!.dispatchFetch('http://w/publication', { method: 'POST', body: JSON.stringify({ learningRead: 'publish' }) });
    const publication = await publicationResponse.json();
    console.log('W10.03 native publication response ' + JSON.stringify(publication));
    expect(publication).toMatchObject({ status: 200, published: true, events: total });
    console.log('W10.03 native phase owner health');
    const cache = await native!.getKVNamespace('CACHE'), published = await cache.get('lift:acme:acme:hero', 'json');
    const health = () => native!.dispatchFetch('http://w/owner-health', { method: 'POST', body: JSON.stringify({ learningHealth: published }) });
    const positive = await (await health()).json(); expect(positive).toMatchObject({ accepted: true });
    await ask(targets.stats, '/__learning_fixture', { action: 'fault', mode: 'hold-health' });
    const held = await (await health()).json() as { accepted: boolean; elapsedMs: number };
    expect(held.accepted).toBe(false); expect(held.elapsedMs).toBeLessThan(400);
    await ask(targets.stats, '/__learning_fixture', { action: 'fault', mode: '' });
    const old = emptyStats(); for (let i = 0; i < 300; i++) recordExposure(old, 'old' + i, cell, at, DEFAULT_STATS);
    console.log('W10.03 native phase repair');
    await ask(targets.legacy, '/__learning_fixture', { action: 'seed', entries: [['learn', { ...scope, slot: 'legacy', config, stats: old }]] });
    expect((await ask(targets.legacy, '/snapshot', {})).status).toBe(503);
    const basis = await (await ask(targets.legacy, '/recovery', { ...scope, slot: 'legacy' })).json() as { digest: string; generation: number };
    const intent = { ...scope, slot: 'legacy', ...basis, operationId: 'd'.repeat(32), intent: 'coarsen' };
    expect((await ask(targets.legacy, '/recover', intent)).status).toBe(200);
    const row = { decision_id: `acme:${at.toString(36)}:v1:s1:home:hero:repair`, tenant: 'acme', brand: 'acme', visitor_id: 'v1', session_id: 's1', ts: at,
      page: 'home', slot: 'hero', position: 0, item_id: 'a', customer_item_id: 'cms-a', candidates: [], cell, arm: 'personalized', explored: false,
      versions: { config: 1, lift: 0, prior: 0, policy: 0 }, config_label: 'v1', explain: { drivers: [], score_base: 1, score_final: 1, lift: null },
      retention: captureRetention(policy, 'acme', at) };
    await ask(targets.ring, '/__learning_fixture', { action: 'seed', entries: [['ring', { ring: Array.from({ length: 201 }, () => row), index: [] }]] });
    const rb = await (await ask(targets.ring, '/recovery', { tenant: 'acme', visitorId: 'v1' })).json() as { digest: string; generation: number };
    expect((await ask(targets.ring, '/recover', { tenant: 'acme', visitorId: 'v1', ...rb, intent: 'compact', operationId: 'e'.repeat(32) })).status).toBe(200);
    await native!.dispose(); native = undefined; targets = await open();
    console.log('W10.03 native phase persisted restart');
    expect(await (await native!.dispatchFetch('http://w/configuration', {
      method: 'POST', body: JSON.stringify({ learningConfiguration: 'read' }),
    })).json()).toEqual(configuration);
    expect((await ask(targets.legacy, '/recover', intent)).status).toBe(200);
    expect(await (await ask(targets.ring, '/__learning_fixture', { action: 'summary' })).json()).toMatchObject({ ring: 1, index: 1 });
    const replay = await (await ask(targets.stats, '/exposures', firstWave)).json();
    expect(replay).toMatchObject({ receipt: { newlyApplied: 0, alreadyApplied: 100 } });
    for (let wave = 0; wave < 3; wave++) {
      const rows = Array.from({ length: 80 }, (_, i) => ({ ...row, decision_id: `acme:${at.toString(36)}:v1:s1:home:hero:continued-${wave}-${i}` }));
      expect((await ask(targets.ring, '/append', { version: 2, tenant: 'acme', visitorId: 'v1', records: rows })).status).toBe(200);
    }
    expect(await (await ask(targets.ring, '/__learning_fixture', { action: 'summary' })).json()).toMatchObject({ ring: 200, index: 241 });
    await waves(8, 4);
    console.log('W10.03 native proof ' + JSON.stringify({ moduleSha256: createHash('sha256').update(runtimeBundle).digest('hex'),
      miniflare: JSON.parse(readFileSync('node_modules/miniflare/package.json', 'utf8')).version,
      workerd: JSON.parse(readFileSync('node_modules/workerd/package.json', 'utf8')).version,
      ceilingProbe: { attemptedBytes: 3 * 1024 * 1024, result: ceiling }, waves: records, ownerHealth: { positive, held }, total,
      persistedRestart: true, coherentConfiguration: configuration, outboundAttempts, cleanup: 'finally-dispose-and-remove-isolated-fixture' }));
  } finally { await native?.dispose(); rmSync(directory, { recursive: true, force: true }); }
}, 60_000);

it('W03.07 denies newly signed wildcard cross-brand backend proof before identity state effects', async () => {
  for (const tenant of ['acme', 'globex']) {
    const subject = 'vis-00000000-0000-4000-8000-000000000010';
    const result = await probe({ path: '/v1/' + tenant + '/identity/link', method: 'POST', requestHost: 'shared.example',
      headers: { 'X-Tenant': tenant, 'X-SDK-Key': 'synthetic-' + tenant + '-key', 'Content-Type': 'application/json' },
      shopperCapability: { tenant, subject, sessionId: 'w0307-session' }, identitySecrets: '*:synthetic-wildcard',
      identityProof: { secret: 'synthetic-wildcard', tenant, accountId: 'same-account' } });
    expect(result.status).toBe(401);
    expect(result.body).toContain('identity verification not configured');
    expect(result.calls.filter(call => /\.put$|\.delete$|\.fetch$|DB\./.test(call[0]!))).toEqual([]);
    expect(result.after).toEqual(result.before);
  }
});

it('W03.07 mounted queue retries unknown or malformed registry work with valid sibling positional acknowledgement', async () => {
  const policy = { TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'] }), RETENTION: nativeRetention } as RetentionEnv;
  const messages = ['acme', 'globex'].map(tenant => ({ kind: 'ledger', type: 'outcome', version: 1,
    record: { ...outcomeFromAction({ type: 'purchase', userId: 'same-visitor', timestamp: 1788696000000 }, tenant)!,
      retention: captureRetention(policy, tenant, 1788696000000) } }));
  const result = await probe({ path: '/', queue: messages, queuePositions: true, tenantManifest: JSON.stringify({ provisioned: ['globex'] }),
    retention: JSON.stringify({ version: 1, tenants: { globex: JSON.parse(nativeRetention).tenants.globex } }) });
  expect(result.calls.filter(c => c[0] === 'queue.retry')).toEqual([['queue.retry', '0']]);
  expect(result.calls.filter(c => c[0] === 'queue.ack')).toEqual([['queue.ack', '1']]);
  expect(result.calls.some(c => c[0] === 'STORAGE.put' && c[1]!.startsWith('globex/'))).toBe(true);
  expect(result.calls.filter(c => c[0] === 'STORAGE.put').every(c => c[1]!.startsWith('globex/'))).toBe(true);
  for (const tenantManifest of ['invalid', JSON.stringify({ provisioned: [] })]) {
    const failed = await probe({ path: '/', queue: messages, queuePositions: true, tenantManifest });
    expect(failed.calls).toEqual([['queue.retry', '0'], ['queue.retry', '1']]);
    expect(failed.after).toEqual(failed.before);
  }
});

function credentials(role: string): Record<string, string> {
  return {
    Origin: 'https://shop.acme.example', 'X-Tenant': 'acme',
    ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}),
  };
}

it('W09.09 native DLQ intake ACKs durable quarantine and current-human audited opaque cases never inherit service or tenant-selector authority', async () => {
  const unknown = { privateFixture: ['preserve-exact', 7] }, tenantManifest = JSON.stringify({ provisioned: ['acme', 'globex'], hosts: { 'acme.example': 'acme' } });
  const common = { recovery: true, tenantManifest, profile: 'customer', queue: [unknown], queuePositions: true } satisfies Partial<Probe>;
  for (const failure of ['none', 'storage', 'policy']) {
    const result = await probe({ ...common, path: '/', failStoragePut: failure === 'storage', recoveryUnknownPolicy: failure !== 'policy' });
    expect(result.calls.filter(call => call[0].startsWith('queue.'))).toEqual([[failure === 'none' ? 'queue.ack' : 'queue.retry', '0']]);
    const saved = (result.after as { storage: Array<[string, string]> }).storage.filter(([key]) => key.startsWith('ledger-quarantine/v1/'));
    expect(saved).toHaveLength(failure === 'none' ? 1 : 0);
    if (saved.length) { const value = JSON.parse(saved[0]![1]); expect(value.wire).toBe(JSON.stringify(unknown)); expect(value.tenant).toBeNull(); }
  }
  const list = { ...common, recoveryAfterQueue: true, recoveryOwner: true, recoveryRole: 'none' as const, path: '/operator/ledger-recovery?scope=unassigned', headers: credentials('admin-access') };
  const allowed = await probe(list); expect(allowed.status).toBe(200);
  const item = JSON.parse(allowed.body).items[0]; expect(item).toMatchObject({ tenant: null, safety: 'unsafe_history', state: 'pending', source: { operations: 1, records: null } });
  expect(allowed.body).not.toContain('privateFixture'); expect(allowed.calls.filter(call => call[0] === 'ACCOUNTS.audit').map(call => call[1])).toEqual(['admitted', 'result']);
  for (const change of [{ headers: credentials('admin') }, { recoveryOwner: false }, { headers: credentials('expired') }, { subjectAuditFailure: 'admitted' as const }, { subjectAuditFailure: 'result' as const }]) {
    const result = await probe({ ...list, ...change }); expect(result.status).not.toBe(200); expect(result.body).not.toContain(item.id);
  }
  for (const suffix of ['&tenant=globex', '&tenant=acme', '&scope=tenant', '&after=x&after=y']) {
    const result = await probe({ ...list, path: list.path + suffix }); expect(result.status).toBe(400);
    expect(result.calls.some(call => call[0] === 'ACCOUNTS.audit')).toBe(false);
  }
  const key = createHash('sha256').update(JSON.stringify({ messageId: 'w0909-0', queue: 'dlq', version: 1 })).digest('hex');
  const digest = createHash('sha256').update(JSON.stringify(JSON.stringify(unknown))).digest('hex');
  const resolveCase = { ...list, path: '/operator/ledger-recovery/' + key + '/resolve', method: 'POST',
    body: JSON.stringify({ digest, revision: 1, scope: 'unassigned', disposition: 'irrecoverable' }) };
  const resolved = await probe(resolveCase); expect(resolved.status).toBe(200); expect(JSON.parse(resolved.body).case).toMatchObject({ state: 'irrecoverable', terminalLoss: null });
  const retained = (resolved.after as { storage: Array<[string, string]> }).storage.find(([name]) => name.endsWith(key + '.json'));
  expect(JSON.parse(retained![1]).wire).toBe(JSON.stringify(unknown));
  expect((await probe({ ...resolveCase, path: resolveCase.path + '?tenant=globex' })).status).toBe(400);
  expect((await probe({ ...resolveCase, body: JSON.stringify({ digest, revision: 2, scope: 'unassigned', disposition: 'irrecoverable' }) })).status).toBe(503);
});

describe('W07.05 W04.03 W05.10 native shopper socket capability boundary (retained W04.02 oracles)', () => {
  it.each(['session', 'do'] as const)('owns bootstrap, frames and post-upgrade private delivery on %s', async (shopperHost) => {
    // The owner now redispatches the real route under its deployment bindings.
    // Configure the native object host too, not only the outer request fixture.
    await runtime.dispose(); runtime = nativeRuntime(shopperHost); await runtime.ready;
    const result = await probe({ path: '/', shopperHost });
    const proof = JSON.parse(result.body);
    expect(proof).toMatchObject({ denied: 401, bootstrap: 200, fresh: true, wrong: 401, expired: 401, victimUntouched: true });
    expect(proof.keyDenied).toEqual({ status: 403, cacheControl: 'no-store', native: false, calls: [], unchanged: true, pending: 0 });
    expect(proof.expiredChoice).toEqual({ status: 403, unchangedFrames: true });
    expect(proof.sockets).toHaveLength(3);
    for (const socket of proof.sockets) expect(socket).toMatchObject({ status: 101, native: true, protocol: 'shopper-session-v1', welcome: true, heartbeat: true });
    expect(proof.sockets[0]).toMatchObject({ before: true, after: false, closed: 1008 });
    expect(proof.sockets[1]).toMatchObject({ before: true, after: true, closed: null });
    expect(proof.sockets[2]).toMatchObject({ before: false, after: false, closed: 1008 });
    if (shopperHost === 'do') expect(proof.ownedFrame).toEqual({ sessionMatched: true, pageViews: 1 });
  }, 20_000);
});

const raw: Probe[] = [
  ...['GET', 'PUT', 'DELETE'].map(method => ({ path: '/api/cache/' + encodeURIComponent(CACHE_KEY), method,
    ...(method === 'PUT' ? { body: JSON.stringify({ value: MARKER }) } : {}) })),
  ...['GET', 'PUT', 'DELETE'].map(method => ({ path: '/api/storage/' + encodeURIComponent(STORAGE_KEY), method,
    ...(method === 'PUT' ? { body: MARKER } : {}) })),
  { path: '/api/queue/send', method: 'POST', body: JSON.stringify({ kind: 'ledger', tenant: 'globex', records: [{ value: MARKER }] }) },
  { path: '/api/state/state/' + encodeURIComponent(STATE_KEY), method: 'GET' },
  { path: '/api/state/state/' + encodeURIComponent(STATE_KEY), method: 'PUT', body: JSON.stringify({ value: MARKER }) },
  { path: '/api/analytics/query?query=' + MARKER, method: 'GET' },
];

function assertDenied(result: Result, input: Probe, expectedEnv: string[] = []) {
  // Each oracle remains visible in the red baseline, including successful
  // destination reads/mutations; a status failure does not mask that evidence.
  const label = `${input.method ?? 'GET'} ${input.path}`;
  if (process.env.W01_02_TRACE === '1') console.log(JSON.stringify({
    request: label, status: result.status, calls: result.calls,
    mutated: JSON.stringify(result.after) !== JSON.stringify(result.before),
    privateDisclosed: result.body.includes(PRIVATE), markerDisclosed: result.body.includes(MARKER),
    envAccesses: result.envAccess.length, logCount: result.logs.length,
  }));
  expect.soft(result.status, label + ': status').toBe(404);
  expect.soft(result.calls, label + ': destination attempts').toEqual([]);
  expect.soft(result.after, label + ': destination state').toEqual(result.before);
  expect.soft(result.envAccess, label + ': pre-dispatch environment access').toEqual(expectedEnv.length ? ['get:DEPLOYMENT_PROFILE', ...expectedEnv] : []);
  expect.soft(result.bodyReads, label + ': body reads').toBe(0);
  expect.soft(result.headers['cache-control'], label + ': cache policy').toBe('no-store');
  expect.soft(result.logs, label + ': logs').toEqual([]);
  expect.soft(result.pending, label + ': deferred work').toBe(0);
  expect.soft(result.headers['access-control-allow-origin'], label + ': CORS').toBeUndefined();
  expect.soft(result.headers['set-cookie'], label + ': cookies').toBeUndefined();
  expect.soft(result.headers['x-ratelimit-limit'], label + ': rate limiter').toBeUndefined();
  expect.soft(JSON.stringify({ body: result.body, headers: result.headers }), label + ': disclosure').not.toMatch(/W0102_(PRIVATE_VALUE|REQUEST_MARKER)/);
  if (input.method === 'HEAD') expect.soft(result.body, label + ': HEAD').toBe('');
  else expect.soft(result.body, label + ': generic response').toBe('{"error":"Not Found"}');
}

describe.each(['open', 'enforced', 'unset', 'misspelled'])('raw API boundary, AUTH_MODE=%s', mode => {
  for (const role of ['absent', 'invalid', 'operator', 'admin']) {
    it(`rejects all ten raw operations for ${role}`, async () => {
      for (const operation of raw) {
        const input = { ...operation, mode, headers: credentials(role) };
        assertDenied(await probe(input), input);
      }
    });
  }
});

const variants: Probe[] = [
  ...raw.filter(p => p.method === 'GET').map(p => ({ ...p, method: 'HEAD' })),
  ...raw.map(p => ({ path: p.path, method: 'OPTIONS', headers: { 'Access-Control-Request-Method': p.method!, 'Access-Control-Request-Headers': 'authorization,content-type' } })),
  ...['/api', '/api/', '/api/unknown', '/api//cache/' + encodeURIComponent(CACHE_KEY),
    '/%61pi/cache/' + encodeURIComponent(CACHE_KEY), '/a%70i/storage/' + encodeURIComponent(STORAGE_KEY),
    '/api/../api/cache/' + encodeURIComponent(CACHE_KEY), '/api/cache/%GG', '/%61pi/cache/%GG',
    '/api/cache/' + encodeURIComponent(CACHE_KEY) + '/'].map(path => ({ path })),
  ...['PATCH', 'PROPFIND', 'REPORT'].map(method => ({ path: raw[0]!.path, method, body: '{malformed' })),
  ...['websocket', 'WebSocket'].map(Upgrade => ({ path: raw[0]!.path, headers: { Upgrade, Connection: 'Upgrade' } })),
  { path: '/api/queue/send?token=' + MARKER, method: 'POST', body: '{malformed', headers: { 'X-Request-Id': MARKER } },
];

it('rejects HEAD, OPTIONS, unsupported verbs, normalized aliases, upgrades and malformed input', async () => {
  for (const mode of ['open', 'enforced']) {
    for (const role of ['absent', 'invalid', 'operator', 'admin']) {
      for (const variant of variants) {
        const input = { ...variant, mode, headers: { ...credentials(role), ...variant.headers } };
        assertDenied(await probe(input), input);
      }
    }
  }
});

// Independent reviewers can supply additional denied requests without editing
// the frozen test: W01_02_EXTRA_CASES='[{"path":"/%61pi/cache/x","method":"REPORT"}]'.
// This only adds cases; all required tests above always run.
const extraCases: Probe[] = JSON.parse(process.env.W01_02_EXTRA_CASES ?? '[]');
for (const input of extraCases) {
  it(`independent extra case: ${input.method ?? 'GET'} ${input.path}`, async () => {
    const request = { ...input, headers: { ...credentials('admin'), ...input.headers } };
    assertDenied(await probe(request), request);
  });
}

it('W01.03 withdraws global connector methods and every discovered agent binding before effects', async () => {
  const subject = 'vis-00000000-0000-4000-8000-000000000103';
  const mounted: Probe[] = [
    ...['profile', 'segments', 'identify', 'track', 'forward/synthetic', 'destinations'].map(route => ({ path: '/cdp/' + route, method: 'POST', body: JSON.stringify({ userId: subject, event: 'synthetic', traits: {} }) })),
    ...['destinations', 'health'].map(route => ({ path: '/cdp/' + route })),
    ...['decisions', 'track', 'preview'].map(route => ({ path: '/optimizely/' + route, method: 'POST', body: JSON.stringify({ userId: subject, eventKey: 'synthetic' }) })),
    ...['banner-rules', 'experiments', 'features', 'datafile', 'health'].map(route => ({ path: '/optimizely/' + route })),
    { path: '/webhook/optimizely-datafile', method: 'POST', body: '{"revision":"synthetic"}' },
    ...['state-manager', 'rate-limiter', 'personalization-websocket', 'shopper-reflex', 'meridian-reflex',
      'region-trend', 'decision-ring', 'learn-stats', 'opal-agent'].flatMap(namespace => [
      { path: '/agents/' + namespace + '/' + subject },
      { path: '/agents/' + namespace + '/' + subject, headers: { Upgrade: namespace === 'opal-agent' ? 'WebSocket' : 'websocket' } },
    ]),
  ];
  for (const tenant of ['acme', 'globex']) {
    // These are correctly scoped signed admin, named SDK and verified shopper
    // capabilities. Their valid tenant authority cannot authorize global tools.
    const authorization = 'Bearer ' + tokens[tenant === 'acme' ? 'admin' : 'globex'];
    const headers = { Origin: 'https://shop.acme.example', 'X-Tenant': tenant,
      Authorization: authorization, 'X-SDK-Key': 'synthetic-' + tenant + '-key' };
    const common = { requestHost: 'shared.example', sharedConnectors: true,
      shopperCapability: { tenant, subject, sessionId: 'synthetic-session' } };
    for (const operation of mounted) {
      const input = { ...common, ...operation, headers: { ...headers, ...operation.headers } };
      assertDenied(await probe(input), input, ['get:AUTH_MODE']);
    }
    for (const credential of ['absent', 'invalid', 'operator', 'site', 'shopper']) {
      for (const path of ['/cdp/profile', '/optimizely/preview', '/agents/opal-agent/same-subject', '/webhook/optimizely-datafile']) {
        const input: Probe = { path, method: 'POST', body: MARKER, requestHost: 'shared.example', sharedConnectors: true,
          headers: { 'X-Tenant': tenant, ...(credential === 'operator' ? { Authorization: authorization }
            : credential === 'invalid' ? { Authorization: 'Bearer invalid-synthetic-token' }
            : credential === 'site' ? { 'X-SDK-Key': 'synthetic-' + tenant + '-key' } : {}) },
          ...(credential === 'shopper' ? { shopperCapability: common.shopperCapability } : {}),
        };
        assertDenied(await probe(input), input, ['get:AUTH_MODE']);
      }
    }
  }
}, 20_000);

it('W01.03 covers decoded and empty-segment aliases without withdrawing near-prefix nonroutes', async () => {
  const paths = ['/agents', '/agents/', '/cdp', '/cdp/', '/optimizely', '/optimizely/',
    '/%61gents/opal-agent/session', '/%63dp/profile', '/%6fptimizely/preview',
    '//agents//opal-agent//session', '///cdp//profile', '//optimizely//preview',
    '/removed/../cdp/profile', '/removed/%2e%2e/optimizely/preview', '/agents/unknown-binding/suffix',
    '/webhook/optimizely-datafile/', '/webhook/optimizely-datafile/unknown',
    '//webhook//optimizely-datafile', '/%77ebhook/%6fptimizely-datafile'];
  for (const tenant of ['acme', 'globex']) {
    for (const [index, path] of paths.entries()) {
      const method = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE', 'PROPFIND'][index % 7]!;
      const input = { path, method, requestHost: tenant + '.example', sharedConnectors: true,
        tenantManifest: 'invalid-registry', headers: { Origin: 'https://shop.acme.example', 'X-Tenant': 'wrong-selector' },
        ...(['GET', 'HEAD'].includes(method) ? {} : { body: MARKER }) };
      assertDenied(await probe(input), input, ['get:AUTH_MODE']);
    }
  }
  // decodeURI preserves encoded separators: these are unmounted paths, not
  // aliases of either router. They follow ordinary tenant validation and 404.
  for (const path of ['/agents-extra', '/cdp-extra', '/optimizely-extra',
    '/cdp%2fprofile', '/agents%2fopal-agent%2fsession', '/optimizely%2fpreview', '/webhook%2foptimizely-datafile']) {
    const result = await probe({ path });
    expect(result.status).toBe(404);
    expect(result.envAccess).toContain('get:TENANTS');
    expect(result.envAccess).not.toContain('enumerate');
    expect(result.calls).toEqual([]);
    expect(result.after).toEqual(result.before);
  }
  // W01.04 deliberately extends the earlier datafile-only withdrawal to all webhooks.
  const webhook = { path: '/webhook/health' };
  assertDenied(await probe(webhook), webhook, ['get:AUTH_MODE']);
}, 20_000);

it('W01.03 retains open/unset local connector effects and generic agent dispatch without live upstream operations', async () => {
  for (const mode of ['open', 'unset']) {
    for (const tenant of ['acme', 'globex']) {
      const result = await probe({ path: '/cdp/identify', method: 'POST', mode, requestHost: tenant + '.example',
        body: JSON.stringify({ userId: MARKER, traits: { plan: 'synthetic' } }), readBack: '/cdp/profile',
        readBackBody: JSON.stringify({ userId: MARKER }) });
      expect(result.status).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({ write: { success: true }, readStatus: 200,
        read: { userId: MARKER, traits: { plan: 'synthetic' }, segments: ['plan_synthetic', 'new_user'] } });
      expect(result.calls.filter(call => call[0] === 'CACHE.put')).toEqual([['CACHE.put', 't:' + tenant + ':profile:user:' + MARKER]]);
      expect(result.after).not.toEqual(result.before);
      expect(result.calls.every(call => call[0]!.startsWith('CACHE.') && call[1]!.startsWith('t:' + tenant + ':'))).toBe(true);
    }
    const optimizely = await probe({ path: '/optimizely/experiments', mode, headers: credentials('admin') });
    expect(optimizely.status).toBe(200);
    expect(JSON.parse(optimizely.body)).toEqual({ experiments: [] });
    expect(optimizely.calls).toEqual([]); // Existing no-SDK-key mock; no real project acceptance.
    const agent = await probe({ path: '//agents//rate-limiter//synthetic-room', mode });
    expect(agent.status).toBe(200);
    expect(JSON.parse(agent.body)).toEqual({ allowed: true, remaining: 99 });
    expect(agent.calls).toEqual([['RATE_LIMITER.idFromName', 'synthetic-room'], ['RATE_LIMITER.get', 'synthetic-room'], ['RATE_LIMITER.fetch', 'synthetic-room']]);
    expect(agent.envAccess).toContain('enumerate'); // Deliberately retained open-demo SDK behavior.
    const webhook = await probe({ path: '/webhook/optimizely-datafile', method: 'POST', mode, sharedConnectors: true, body: '{}' });
    expect(webhook.status).toBe(401); // Existing signature guard is reached, not upstream cache refresh.
    expect(webhook.bodyReads).toBe(1);
    expect(webhook.calls).toEqual([]);
    const info = JSON.parse((await probe({ path: '/api-info', mode })).body);
    expect(info.endpoints).toMatchObject({ cdp: '/cdp', optimizely: '/optimizely', opalAgent: '/agents/opal-agent/:session' });
  }
}, 20_000);

it('W01.04 withdraws legacy tracking and every webhook before authority, consent or global dispatch work', async () => {
  const subject = 'vis-00000000-0000-4000-8000-000000000104';
  const event = { eventId: '00000000-0000-4000-8000-000000000104', timestamp: 1, eventType: 'track',
    source: 'fixture', event: MARKER, user: { anonymousId: subject } };
  const operations: Probe[] = [
    { path: '/track/event', method: 'POST', body: JSON.stringify(event) },
    { path: '/track/batch', method: 'POST', body: JSON.stringify({ events: [event] }) },
    ...['optimizely', 'segment', 'custom', 'optimizely-datafile'].map(route => ({ path: '/webhook/' + route,
      method: 'POST', body: JSON.stringify({ source: 'fixture', event_type: 'synthetic', timestamp: 1,
        data: { visitor_uuid: subject }, userId: subject, event: MARKER }) })),
    ...['/track', '/track/', '/track/health', '/track/unknown', '/webhook', '/webhook/', '/webhook/health', '/webhook/unknown',
      '/%74rack/event', '/%77ebhook/custom', '//track//batch', '//webhook//segment',
      '/old/../track/event', '/old/%2e%2e/webhook/custom', '/webhook/optimizely-datafile-extra'].map((path, index) => ({
      path, method: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE', 'PROPFIND'][index % 7],
    })),
    { path: '/track/event', headers: { Upgrade: 'WebSocket' } },
    { path: '/webhook/custom', headers: { Upgrade: 'websocket' } },
  ];
  for (const tenant of ['acme', 'globex']) {
    const shopperCapability = { tenant, subject, sessionId: 'w0104-session' };
    const authorization = 'Bearer ' + tokens[tenant === 'acme' ? 'admin' : 'globex'];
    for (const [index, operation] of operations.entries()) {
      const input: Probe = { ...operation, requestHost: 'shared.example', shopperCapability,
        sharedConnectors: true, reflexHost: index % 2 ? 'session' : 'do',
        headers: { Origin: 'https://shop.acme.example', 'X-Tenant': tenant, Authorization: authorization,
          'X-SDK-Key': 'synthetic-' + tenant + '-key', Cookie: 'opt_tracking_consent=' + Boolean(index % 2), ...operation.headers } };
      assertDenied(await probe(input), input, ['get:AUTH_MODE']);
    }
    for (const credential of ['absent', 'forged', 'operator', 'site', 'shopper']) {
      for (const path of ['/track/event', '/track/batch', '/webhook/segment', '/webhook/custom']) {
        const input: Probe = { path, method: 'POST', body: JSON.stringify(path.endsWith('/batch') ? { events: [event] } : event),
          sharedConnectors: true, requestHost: 'shared.example', headers: { 'X-Tenant': tenant,
            ...(credential === 'operator' ? { Authorization: authorization } : credential === 'forged'
              ? { Authorization: 'Bearer invalid-synthetic-token', 'X-SDK-Key': 'wrong-key', 'X-Shopper-Session': 'forged' }
              : credential === 'site' ? { 'X-SDK-Key': 'synthetic-' + tenant + '-key' } : {}) },
          ...(credential === 'shopper' ? { shopperCapability } : {}) };
        assertDenied(await probe(input), input, ['get:AUTH_MODE']);
      }
    }
    const invalid = { path: '/webhook/segment', method: 'OPTIONS', tenantManifest: 'invalid-registry',
      headers: { 'X-Tenant': tenant, Origin: 'https://shop.acme.example' } };
    assertDenied(await probe(invalid), invalid, ['get:AUTH_MODE']);
  }
}, 20_000);

it('W01.04 retains open/unset unconfigured delivery errors while stored refusal defeats later true cookies', async () => {
  const subject = 'vis-00000000-0000-4000-8000-000000000104';
  const event = { eventId: '00000000-0000-4000-8000-000000000104', timestamp: 1, eventType: 'track',
    source: 'fixture', event: MARKER, user: { anonymousId: subject } };
  for (const mode of ['open', 'unset']) {
    for (const tenant of ['acme', 'globex']) {
      for (const kind of ['event', 'batch']) {
        const path = '/track/' + kind, body = JSON.stringify(kind === 'batch' ? { events: [event] } : event);
        const input: Probe = { path, method: 'POST', body, mode, requestHost: tenant + '.example', reflexHost: 'session',
          shopperCapability: { tenant, subject, sessionId: 'w0104-session' } };
        const accepted = await probe(input);
        expect(accepted.status).toBe(503);
        const failure = { error: 'Event delivery not confirmed', delivery: { status: 'unconfigured', attempted: 0, acknowledged: 0 } };
        expect(JSON.parse(accepted.body)).toEqual(kind === 'batch'
          ? { success: false, processed: 1, results: [{ eventId: event.eventId, status: 'error', ...failure }] }
          : { success: false, eventId: event.eventId, timestamp: event.timestamp, ...failure });
        expect(accepted.calls).toEqual([['SESSIONS.get', 't:' + tenant + ':session:w0104-session']]);
        expect((accepted.after as { queued: unknown[] }).queued).toEqual([]);
        const refused = await probe({ ...input, headers: { Cookie: 'opt_tracking_consent=false; opt_personalization_enabled=false' },
          readBack: path, readBackBody: body, readBackCookie: 'opt_tracking_consent=true; opt_personalization_enabled=true' });
        expect(refused.status).toBe(200);
        expect(JSON.parse(refused.body)).toMatchObject({ write: { dispatched: false, reason: 'tracking_refused' }, readStatus: 200,
          read: { dispatched: false, reason: 'tracking_refused', consent: { tracking: false, personalization: false } } });
        expect(refused.calls).toEqual([['SESSIONS.get', 't:' + tenant + ':session:w0104-session'],
          ['SESSIONS.put', 't:' + tenant + ':session:w0104-session'], ['SESSIONS.get', 't:' + tenant + ':session:w0104-session']]);
        const after = refused.after as { sessions: [string, string][]; queued: unknown[] };
        expect(after.queued).toEqual([]);
        expect(JSON.parse(after.sessions.find(([key]) => key === 't:' + tenant + ':session:w0104-session')![1])).toMatchObject({
          userId: subject, preferences: { trackingConsent: false, personalizationEnabled: false }, metadata: { sessionCount: 0 } });
        expect(refused.logs).toEqual([]);
      }
      for (const route of ['optimizely', 'segment', 'custom']) {
        const result = await probe({ path: '/webhook/' + route, method: 'POST', mode, requestHost: tenant + '.example',
          body: JSON.stringify({ source: 'fixture', event_type: MARKER, timestamp: 1, data: { visitor_uuid: subject },
            anonymousId: subject, userId: subject, event: MARKER }) });
        expect(result.status).toBe(503);
        expect(JSON.parse(result.body)).toEqual({ success: false, eventId: expect.any(String), error: 'Event delivery not confirmed',
          delivery: { status: 'unconfigured', attempted: 0, acknowledged: 0 } });
        expect(result.calls).toEqual([]);
        expect((result.after as { queued: unknown[] }).queued).toEqual([]);
      }
    }
  }
}, 20_000);

it('W01.04 preserves passive pixel generation/image delivery and near-prefix routing without advertising withdrawn ingress', async () => {
  for (const mode of ['enforced', 'open', 'unset']) {
    const generated = await probe({ path: '/pixel/generate', method: 'POST', mode,
      body: JSON.stringify({ campaignId: 'synthetic', emailId: 'synthetic', recipientId: MARKER }) });
    expect(generated.status).toBe(200);
    expect(JSON.parse(generated.body)).toMatchObject({ trackingEnabled: false, data: { recipientId: MARKER } });
    expect(generated.calls).toEqual([]);
    expect(generated.after).toEqual(generated.before);
    const pixel = await probe({ path: '/pixel/track/not-an-encoded-pixel', mode,
      headers: { Cookie: 'opt_tracking_consent=false; opt_personalization_enabled=false' } });
    expect(pixel.status).toBe(200);
    expect(pixel.headers['content-type']).toBe('image/gif');
    expect(pixel.headers['cache-control']).toContain('no-store');
    expect(pixel.body.startsWith('GIF89a')).toBe(true);
    expect(pixel.calls).toEqual([]);
    expect(pixel.after).toEqual(pixel.before);
    expect(pixel.logs).toEqual([]);
    expect(pixel.pending).toBe(0);
    const info = JSON.parse((await probe({ path: '/api-info', mode })).body);
    expect(info.endpoints).toMatchObject({ pixel: '/pixel', realtime: '/realtime', operator: '/operator' });
    if (mode !== 'enforced') expect(info.endpoints).toMatchObject({ tracking: '/track', webhook: '/webhook' });
    else for (const endpoint of ['tracking', 'webhook']) expect(info.endpoints).not.toHaveProperty(endpoint);
  }
  for (const path of ['/track-extra', '/webhook-extra', '/track%2fevent', '/webhook%2fsegment']) {
    const result = await probe({ path });
    expect(result.status).toBe(404);
    expect(result.envAccess).toContain('get:TENANTS');
    expect(result.calls).toEqual([]);
    expect(result.after).toEqual(result.before);
  }
}, 20_000);

it('W01.05 withdraws mounted demo, model and activation operations before configured destination work', async () => {
  const subject = 'vis-00000000-0000-4000-8000-000000000105';
  const post = (path: string, body: unknown): Probe => ({ path, method: 'POST', body: JSON.stringify(body) });
  const scene = { productId: 'w0701-subject', sceneId: 'w0701-scene', sceneContext: MARKER };
  const mounted: Probe[] = [
    post('/ai/search', { query: MARKER }), post('/ai/concierge', { messages: [{ role: 'user', content: MARKER }] }),
    post('/ai/scene', scene), { ...post('/ai/scene', scene), cachedScene: true }, post('/ai/scene', { ...scene, sync: true }),
    { path: '/ai/scene/w0701-subject/w0701-scene', cachedScene: true },
    { path: '/__shot?token=' + PRIVATE + '&path=https://connector.invalid/&js=' + MARKER },
    ...['/funnel', '/funnel/diagnose'].map(path => ({ path })),
    post('/funnel/event', { event_type: 'add_to_cart', vuid: subject }),
    post('/funnel/audience', { name: MARKER, conditions: ['and'] }),
    post('/funnel/sim/tick', { sessions: 1 }), post('/funnel/sim/reset', {}),
    post('/funnel/sim/burst', { brand: 'Coach', cohort: 'all', throughStage: 'purchase', count: 1, convert: true }),
    ...['', '/cmab/decide', '/cmab/matrix', '/scenarios', '/' + MARKER + '/readout'].map(path => ({ path: '/experiment' + path })),
    post('/experiment/launch', { experimentKey: MARKER }),
    { path: '/signals/next' }, post('/signals/ingest', { id: MARKER }),
    ...['geo', 'reflex?visitorId=' + subject, 'experiment/status', 'decisions/export'].map(path => ({ path: '/live/api/' + path })),
    post('/live/api/page', { visitorId: subject }), post('/live/api/event', { visitorId: subject, action: 'product_click' }),
    post('/live/api/events', { visitorId: subject, events: [{ action: 'product_click' }] }), post('/live/api/experiment/launch', {}),
    ...['staged', 'occupants', 'state'].map(path => ({ path: '/live/ops-api/' + path })),
    ...['propose/B123456', 'approve/B123456', 'reset', 'soldout/B123456', 'restock/B123456'].map(path => post('/live/ops-api/' + path, {})),
    ...['catalog', 'funnel', 'coldstart', 'cohort', 'snapshot?visitorId=' + subject, 'scenes', 'experiment/status',
      'opal/vocabulary', 'decisions/export', 'moment/signals', 'wire-check'].map(path => ({ path: '/meridian/api/' + path })),
    { path: '/meridian/api/ws?visitorId=' + subject, headers: { Upgrade: 'websocket' } },
    ...['concierge', 'action', 'vertical', 'reset', 'search', 'experiment/dispatch', 'opal/propose', 'decisions', 'moment/write']
      .map(path => post('/meridian/api/' + path, { visitorId: subject, message: MARKER, query: MARKER, ask: MARKER })),
    post('/realtime/demo/trigger', { scenario: 'pricing_page', userId: subject }),
  ];
  for (const tenant of ['acme', 'globex']) {
    const authority = { 'X-Tenant': tenant, Authorization: 'Bearer ' + tokens[tenant === 'acme' ? 'admin' : 'globex'],
      'X-SDK-Key': 'synthetic-' + tenant + '-key', Origin: 'https://shop.acme.example' };
    const shopperCapability = { tenant, subject, sessionId: 'w0105-session' };
    for (const operation of mounted) {
      const input = { ...operation, requestHost: 'shared.example', sharedConnectors: true, shopperCapability,
        headers: { ...authority, ...operation.headers } };
      assertDenied(await probe(input), input, ['get:AUTH_MODE']);
    }
    for (const credential of ['absent', 'forged', 'operator', 'site', 'shopper']) {
      for (const path of ['/ai/search', '/__shot', '/funnel/audience', '/experiment/launch', '/signals/ingest',
        '/live/api/page', '/live/ops-api/reset', '/meridian/api/action', '/realtime/demo/trigger']) {
        const input: Probe = { path, method: 'POST', body: '{malformed', sharedConnectors: true, requestHost: 'shared.example',
          headers: { 'X-Tenant': tenant, ...(credential === 'operator' ? { Authorization: authority.Authorization }
            : credential === 'site' ? { 'X-SDK-Key': authority['X-SDK-Key'] }
            : credential === 'forged' ? { Authorization: 'Bearer forged', 'X-SDK-Key': 'forged', 'X-Shopper-Session': 'forged' } : {}) },
          ...(credential === 'shopper' ? { shopperCapability } : {}) };
        assertDenied(await probe(input), input, ['get:AUTH_MODE']);
      }
    }
  }
}, 20_000);

it('W01.05 covers family aliases and unsupported methods while retaining sibling routes and truthful API info', async () => {
  const families = ['/ai', '/__shot', '/funnel', '/experiment', '/signals', '/live/api', '/live/ops-api', '/meridian/api', '/realtime/demo'];
  const aliases = [...families.flatMap(path => [path, path + '/', path + '/unknown/descendant']),
    '/%61i/search', '/%5f_shot', '/%66unnel/sim/reset', '/%65xperiment/launch', '/%73ignals/ingest',
    '//live//%61pi//page', '//live//%6fps-api//reset', '//meridian//%61pi//ws', '//realtime//%64emo//trigger',
    '/old/../ai/search', '/old/%2e%2e/meridian/api/reset'];
  for (const [index, path] of aliases.entries()) {
    const method = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE', 'PROPFIND'][index % 7]!;
    const input: Probe = { path, method, sharedConnectors: true, tenantManifest: 'invalid-registry',
      headers: { Origin: 'https://shop.acme.example', 'X-Tenant': 'conflicting-selector',
        ...(method === 'OPTIONS' ? { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } : {}),
        ...(method === 'GET' ? { Upgrade: 'WebSocket' } : {}) },
      ...(['GET', 'HEAD'].includes(method) ? {} : { body: MARKER }) };
    assertDenied(await probe(input), input, ['get:AUTH_MODE']);
  }
  // Static siblings still proceed to the ordinary Worker router; this does not
  // attest Cloudflare's separate static-asset serving policy.
  for (const path of [...families.map(path => path + '-extra'), '/live', '/live/ops.html', '/meridian', '/meridian/meridian.js',
    '/ai%2fsearch', '/live%2fapi/page', '/live/api%2fpage', '/meridian/api%2fws', '/realtime/demo%2ftrigger']) {
    const result = await probe({ path, headers: credentials('admin') });
    expect(result.status, path).toBe(404);
    expect(result.envAccess, path).toContain('get:TENANTS');
    expect(result.envAccess, path).not.toContain('enumerate');
    expect(result.calls, path).toEqual([]);
    expect(result.after, path).toEqual(result.before);
  }
  for (const mode of ['enforced', 'open', 'unset']) {
    const info = JSON.parse((await probe({ path: '/api-info', mode })).body);
    expect(info.endpoints).toMatchObject({ realtime: '/realtime', operator: '/operator', geo: '/geo' });
    const demos = { ai: '/ai', aiScene: '/ai/scene', funnel: '/funnel', experiment: '/experiment', signals: '/signals' };
    if (mode === 'enforced') for (const key of Object.keys(demos)) expect(info.endpoints).not.toHaveProperty(key);
    else expect(info.endpoints).toMatchObject(demos);
  }
}, 20_000);

it('W01.05 retains representative open/unset demo effects without model, browser or upstream execution', async () => {
  for (const mode of ['open', 'unset']) {
    const search = await probe({ mode, path: '/ai/search', method: 'POST', body: JSON.stringify({ query: MARKER }) });
    expect(search.status).toBe(200);
    expect(JSON.parse(search.body)).toMatchObject({ ok: false, source: 'fallback', error: 'GEMINI_API_KEY not configured' });
    expect(search.bodyReads).toBe(1); expect(search.calls).toEqual([]);
    const concierge = await probe({ mode, path: '/ai/concierge', method: 'POST', body: '{}' });
    expect(concierge.status).toBe(503); expect(concierge.calls).toEqual([]);
    const sceneKey = 'scene/live/w0701-subject__w0701-scene.jpg';
    const cached = await probe({ mode, path: '/ai/scene/w0701-subject/w0701-scene', cachedScene: true });
    expect(cached.status).toBe(200); expect(cached.body).toBe('synthetic-image');
    expect(cached.calls).toEqual([['STORAGE.get', sceneKey]]); expect(cached.after).toEqual(cached.before);
    const scene = { productId: 'w0701-subject', sceneId: 'w0701-scene', sceneContext: MARKER };
    const queued = await probe({ mode, path: '/ai/scene', method: 'POST', body: JSON.stringify(scene) });
    expect(queued.status).toBe(200); expect(JSON.parse(queued.body)).toMatchObject({ ok: true, status: 'queued' });
    expect(queued.calls).toEqual([['STORAGE.head', sceneKey], ['EVENT_QUEUE.send']]);
    expect((queued.after as { queued: unknown[] }).queued).toEqual([{ kind: 'scene', ...scene, type: 'search', aspect: '16:9' }]);
    const sync = await probe({ mode, path: '/ai/scene', method: 'POST', body: JSON.stringify({ ...scene, sync: true }) });
    expect(JSON.parse(sync.body)).toEqual({ ok: false, error: 'image model not configured' });
    expect(sync.calls).toEqual([['STORAGE.head', sceneKey], ['STORAGE.head', sceneKey]]);
    const shot = await probe({ mode, path: '/__shot' });
    expect(shot.status).toBe(404); expect(shot.envAccess).toContain('get:SHOT_TOKEN'); expect(shot.calls).toEqual([]);
    const simulator = await probe({ mode, path: '/funnel/sim/reset', method: 'POST', body: '{}' });
    expect(simulator.status).toBe(200); expect(JSON.parse(simulator.body)).toEqual({ ok: true, reset: true });
    // Existing D1 is a call spy: this proves entry to the reset operation, not a SQLite deletion.
    expect(simulator.calls).toEqual([['DB.prepare', 'DELETE FROM funnel_live']]);
    const experiment = await probe({ mode, path: '/experiment/launch', method: 'POST', body: '{"experimentKey":"w0105"}',
      readBack: '/experiment/w0105/readout' });
    expect(experiment.status).toBe(200);
    expect(JSON.parse(experiment.body)).toMatchObject({ write: { experimentKey: 'w0105', status: 'stubbed' },
      readStatus: 200, read: { experimentKey: 'w0105', status: 'stubbed' } });
    expect(experiment.calls.filter(call => call[0] === 'CACHE.put')).toEqual([['CACHE.put', 't:acme:exp:w0105'], ['CACHE.put', 't:acme:exp:index']]);
    expect(experiment.after).not.toEqual(experiment.before);
    const signals = await probe({ mode, path: '/signals/ingest', method: 'POST', body: JSON.stringify({ id: MARKER }), readBack: '/signals/next' });
    expect(signals.status).toBe(200);
    expect(JSON.parse(signals.body)).toMatchObject({ write: { accepted: { id: MARKER, simulated: true } }, readStatus: 200, read: { id: MARKER, simulated: true } });
    const desk = await probe({ mode, path: '/live/ops-api/soldout/B123456', method: 'POST', body: '{}' });
    expect(desk.status).toBe(200); expect(desk.calls).toEqual([['CACHE.put', 'bh:offerdesk:avail:B123456']]);
    expect((desk.after as { cache: [string, string][] }).cache.find(([key]) => key === 'bh:offerdesk:avail:B123456')).toBeDefined();
    const live = await probe({ mode, path: '/live/api/experiment/status' });
    expect(live.status).toBe(200); expect(JSON.parse(live.body)).toMatchObject({ ok: true, launched: false });
    expect(live.calls).toEqual([['CACHE.get', 'bh:experiment:ids']]);
    const meridian = await probe({ mode, path: '/meridian/api/reset', method: 'POST', body: JSON.stringify({ visitorId: MARKER }) });
    expect(meridian.status).toBe(200); expect(JSON.parse(meridian.body)).toEqual({ value: PRIVATE });
    expect(meridian.calls).toEqual([['MERIDIAN_REFLEX.idFromName', MARKER], ['MERIDIAN_REFLEX.get', MARKER], ['MERIDIAN_REFLEX.fetch', MARKER]]);
    const demo = await probe({ mode, path: '/realtime/demo/trigger', method: 'POST', body: '{}' });
    expect(demo.status).toBe(400); expect(JSON.parse(demo.body).error).toBe('Invalid demo trigger format');
    expect(demo.bodyReads).toBe(1); expect(demo.calls).toEqual([]);
  }
}, 20_000);

it('W01.07 withdraws shared cohort and health probes regardless of tenant or caller credentials', async () => {
  const subject = 'vis-00000000-0000-4000-8000-000000000107';
  for (const tenant of ['acme', 'globex']) {
    const authority = { Authorization: 'Bearer ' + tokens[tenant === 'acme' ? 'admin' : 'globex'],
      'X-SDK-Key': 'synthetic-' + tenant + '-key' };
    for (const credential of ['absent', 'forged', 'site', 'operator', 'shopper', 'combined']) {
      for (const path of ['/health', '/geo/cohort', '/geo/cohort?zip=27101&region=NC&city=' + MARKER]) {
        const input: Probe = { path, sharedDiagnostics: true, requestHost: 'shared.example',
          headers: { 'X-Tenant': tenant, Origin: 'https://shop.acme.example',
            ...(credential === 'combined' ? authority : credential === 'operator' ? { Authorization: authority.Authorization }
              : credential === 'site' ? { 'X-SDK-Key': authority['X-SDK-Key'] }
              : credential === 'forged' ? { Authorization: 'Bearer forged', 'X-SDK-Key': 'forged', 'X-Shopper-Session': 'forged' } : {}) },
          ...(['shopper', 'combined'].includes(credential) ? { shopperCapability: { tenant, subject, sessionId: 'w0107-session' } } : {}) };
        assertDenied(await probe(input), input, ['get:AUTH_MODE']);
      }
    }
  }
}, 20_000);

it('W01.07 contains selected aliases and methods before registry work while retaining sibling routing', async () => {
  const methods = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE', 'PROPFIND'];
  const cases: Probe[] = ['/health', '/geo/cohort'].flatMap(path => methods.map(method => ({ path, method })));
  cases.push(...['/health/', '//health//', '/%68ealth', '/old/../health', '/old/%2e%2e/health/',
    '/geo/cohort/', '/geo/cohort/unknown/descendant', '/%67eo/%63ohort', '//geo//cohort//unknown',
    '/old/../geo/cohort', '/old/%2e%2e/geo/cohort'].map((path, index) => ({ path, method: index % 2 ? 'HEAD' : 'GET' })));
  for (const operation of cases) {
    const method = operation.method!;
    const input: Probe = { ...operation, sharedDiagnostics: true, tenantManifest: 'invalid-registry',
      headers: { 'X-Tenant': 'conflicting-selector', Origin: 'https://shop.acme.example',
        ...(method === 'GET' ? { Upgrade: 'WebSocket' } : {}),
        ...(method === 'OPTIONS' ? { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } : {}) },
      ...(['GET', 'HEAD'].includes(method) ? {} : { body: '{malformed' }) };
    assertDenied(await probe(input), input, ['get:AUTH_MODE']);
  }
  for (const path of ['/health-extra', '/health/unknown', '/health/ready/unknown', '/health/live/unknown',
    '/geo/cohort-extra', '/geo/unknown', '/geo%2fcohort', '/geo/cohort%2funknown', '/health%2fready']) {
    const result = await probe({ path });
    expect(result.status, path).toBe(404);
    expect(result.envAccess, path).toContain('get:TENANTS');
    expect(result.envAccess, path).not.toContain('enumerate');
    expect(result.calls, path).toEqual([]);
    expect(result.after, path).toEqual(result.before);
  }
}, 20_000);

it('W01.07 preserves own edge geography, limited health checks and nonexact shared diagnostic behavior', async () => {
  const requestCf = { country: 'AU', region: 'Victoria', regionCode: 'VIC', city: 'Melbourne',
    postalCode: '3000', latitude: '-37.8', longitude: '144.9', timezone: 'Australia/Melbourne', continent: 'OC', colo: 'MEL' };
  for (const mode of ['enforced', 'open', 'unset', 'misspelled']) {
    const geo = await probe({ path: '/geo', mode, requestCf });
    expect(geo.status).toBe(200);
    expect(JSON.parse(geo.body)).toMatchObject({ ...requestCf, hemisphere: 'S', season: expect.stringMatching(/^(summer|autumn|winter|spring)$/) });
    expect(geo.calls).toEqual([]); expect(geo.after).toEqual(geo.before);
    expect(geo.logs).toEqual([]); expect(geo.pending).toBe(0);
    for (const [path, status] of [['/health/live', 'alive'], ['/health/ready', 'ready']]) {
      const health = await probe({ path: path!, mode, ...readyIdentity });
      expect(health.status).toBe(200); expect(JSON.parse(health.body).status).toBe(status);
      expect(health.calls).toEqual([]); expect(health.after).toEqual(health.before);
      expect(health.logs).toEqual([]); expect(health.pending).toBe(0);
      if (status === 'ready') expect(health.headers['cache-control']).toBe('no-store');
    }
    const info = JSON.parse((await probe({ path: '/api-info', mode })).body);
    expect(info.endpoints).toMatchObject({ geo: '/geo', health: mode === 'enforced' ? '/health/ready' : '/health' });
    if (mode === 'enforced') continue;
    for (const tenant of ['acme', 'globex']) {
      for (const path of ['/geo/cohort', '/geo/cohort?zip=27101&region=NC']) {
        const cohort = await probe({ path, mode, sharedDiagnostics: true, requestHost: tenant + '.example' });
        expect(cohort.status).toBe(200);
        expect(JSON.parse(cohort.body)).toMatchObject({ dataSource: 'synthetic', sampleSize: 40,
          geo: { source: path.includes('?') ? 'query' : 'edge' }, topLines: [{ line: PRIVATE, shoppers: 20, share: 0.5 }] });
        expect(cohort.calls).toContainEqual(['DB.all']);
        const queries = cohort.calls.filter(call => call[0] === 'DB.prepare').map(call => call[1]).join('\n');
        for (const table of ['coach_transactions', 'coach_purchase_items', 'coach_odp_profiles', 'geo_census']) expect(queries).toContain(table);
        expect(cohort.calls.every(call => call[0]!.startsWith('DB.'))).toBe(true);
        expect(cohort.after).toEqual(cohort.before); expect(cohort.logs).toEqual([]); expect(cohort.pending).toBe(0);
      }
      const health = await probe({ path: '/health', mode, sharedDiagnostics: true, requestHost: tenant + '.example' });
      expect(health.status).toBe(200);
      expect(JSON.parse(health.body)).toMatchObject({ status: 'healthy', services: { queue: 'bound', analytics: 'held: no stamp-scoped telemetry authority' } });
      // The legacy handler treats a missing StateManager key as healthy. This
      // preserves its global effects; it does not establish operational readiness.
      expect(health.calls).toEqual([['CACHE.get', 'health-check'], ['STORAGE.head', 'health-check'],
        ['STATE_MANAGER.idFromName', 'health-check'], ['STATE_MANAGER.get', 'health-check'],
        ['STATE_MANAGER.fetch', 'health-check'], ['STATE.storage.get', 'health']]);
      expect(health.after).toEqual(health.before); expect(health.logs).toEqual([]); expect(health.pending).toBe(0);
    }
  }
}, 20_000);

it('W07.01 retains /api-info, live/ready health and ordinary missing-path responses without blanket logs', async () => {
  const info = await probe({ path: '/api-info' });
  expect(info.status).toBe(200);
  expect(JSON.parse(info.body)).toMatchObject({ name: 'Edge Platform API', endpoints: { health: '/health/ready', auth: '/auth' } });
  expect(JSON.parse(info.body).endpoints).not.toHaveProperty('api');
  for (const endpoint of ['cdp', 'optimizely', 'opalAgent', 'tracking', 'webhook']) expect(JSON.parse(info.body).endpoints).not.toHaveProperty(endpoint);
  expect(info.calls).toEqual([]);
  expect(info.logs).toEqual([]);
  for (const [path, status] of [['/health/ready', 'ready'], ['/health/live', 'alive']]) {
    const health = await probe({ path: path!, ...readyIdentity });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body).status).toBe(status);
    expect(health.calls).toEqual([]);
  }
  const missing = await probe({ path: '/api-information' });
  expect(missing.status).toBe(404);
  expect(missing.envAccess).not.toContain('enumerate'); // Enforced requests never enter generic agent binding discovery.
});

it('W01.08 classifies actual mounted methods and refuses every unadmitted method or upgrade before effects', async () => {
  const response = await runtime.dispatchFetch('http://w0102.local/probe', { method: 'POST', body: JSON.stringify({ mountedRoutes: true }) });
  expect(response.status).toBe(200);
  const mounted = await response.json() as { path: string; method: string }[];
  for (const route of CUSTOMER_ROUTES) for (const method of route.methods) {
    expect(mounted.some(actual => actual.path === route.path && actual.method === (method === 'HEAD' ? 'GET' : method)),
      method + ' ' + route.path).toBe(true);
  }
  const subject = 'vis-00000000-0000-4000-8000-000000000108';
  const parameters: Record<string, string> = { tenant: 'acme', kind: 'catalog', decision: 'apply', n: '1', userId: subject };
  for (const { path: pattern, method } of mounted) {
    const path = pattern.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => parameters[name] ?? 'fixture');
    const admitted = customerRequest(new Request('https://acme.example' + path, { method }), path);
    const cases: Probe[] = [{ path, method: 'PROPFIND', body: '{malformed' }];
    if (!admitted) cases.push({ path, method, ...(['GET', 'HEAD'].includes(method) ? {} : { body: '{malformed' }) });
    if (path !== '/realtime/ws') cases.push({ path, headers: { Upgrade: 'websocket' } });
    for (const operation of cases) {
      const input = { ...operation, profile: 'customer', sharedConnectors: true, tenantManifest: 'invalid-registry',
        headers: { ...credentials('admin'), 'X-SDK-Key': 'synthetic-acme-key', ...operation.headers } };
      assertDenied(await probe(input), input, ['get:AUTH_MODE']);
    }
  }
  for (const path of ['/realtime/reflex', '/realtime/personalization/' + subject, '/v1/acme/decisions/snapshot']) {
    const input = { profile: 'customer', path, method: 'HEAD' };
    assertDenied(await probe(input), input, ['get:AUTH_MODE']);
  }
}, 30_000);

it('W01.08 refuses shared realtime diagnostics and preserves owned connections in both tenants', async () => {
  const subject = 'vis-00000000-0000-4000-8000-000000000108';
  for (const tenant of ['acme', 'globex']) {
    const headers = { 'X-Tenant': tenant, 'X-SDK-Key': 'synthetic-' + tenant + '-key' };
    for (const path of ['/realtime/connections', '/realtime/health', '//realtime//connections//', '/realtime/%68ealth/']) {
      for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST']) {
        const input = { path, method, headers, requestHost: 'shared.example', ...(method === 'POST' ? { body: '{malformed' } : {}) };
        assertDenied(await probe(input), input, ['get:AUTH_MODE']);
      }
    }
    const common: Probe = { profile: 'customer', path: '/realtime/connections/' + subject, requestHost: 'shared.example',
      headers, reflexHost: 'session', shopperCapability: { tenant, subject, sessionId: 'w0108-owned' } };
    const owned = await probe(common);
    expect(owned.status).toBe(200);
    expect(owned.calls.filter(call => call[0].startsWith('PERSONALIZATION_WEBSOCKET.'))).toEqual([
      ['PERSONALIZATION_WEBSOCKET.idFromName', 't:' + tenant + ':' + subject],
      ['PERSONALIZATION_WEBSOCKET.get', 't:' + tenant + ':' + subject],
      ['PERSONALIZATION_WEBSOCKET.fetch', 't:' + tenant + ':' + subject],
    ]);
    for (const bad of [{ ...common, shopperCapability: undefined }, { ...common, path: '/realtime/connections/other' }]) {
      const denied = await probe(bad); expect(denied.status).toBe(401);
      expect(denied.calls).toEqual([]); expect(denied.after).toEqual(denied.before);
    }
  }
  for (const mode of ['open', 'unset']) {
    const retained = await probe({ path: '/realtime/connections', mode });
    expect(retained.status).toBe(200); expect(retained.calls).toContainEqual(['PERSONALIZATION_WEBSOCKET.fetch', 'admin']);
  }
});

it('W01.08 invalid profiles and customer binding/auth misconfiguration refuse every entry type', async () => {
  const configurations: Partial<Probe>[] = [{ absentProfile: true }, { profile: 'Customer' },
    ...['open', 'unset', 'misspelled'].map(mode => ({ profile: 'customer', mode })),
    ...CUSTOMER_OMITTED_BINDINGS.map(forbiddenBinding => ({ profile: 'customer', forbiddenBinding }))];
  for (const configuration of configurations) {
    for (const path of ['/api-info', '/console/']) {
      const result = await probe({ path, ...configuration });
      expect(result.status).toBe(503); expect(result.calls).toEqual([]); expect(result.after).toEqual(result.before);
      expect(result.logs).toEqual([]); expect(result.pending).toBe(0);
    }
    const queue = await probe({ path: '/', queue: [{ kind: 'scene' }, { kind: 'ledger' }], queuePositions: true, ...configuration });
    expect(queue.calls).toEqual([['queue.retry', '0'], ['queue.retry', '1']]);
    expect(queue.after).toEqual(queue.before); expect(queue.logs).toEqual([]);
    const scheduled = await probe({ path: '/', scheduled: '0 * * * *', ...configuration });
    expect(scheduled.calls).toEqual([]); expect(scheduled.pending).toBe(0); expect(scheduled.after).toEqual(scheduled.before);
  }
});

it('W01.08 customer scene refusal preserves messages and mixed ledger dispositions without model or asset work', async () => {
  const scene = { kind: 'scene', productId: 'W0701_SUBJECT', sceneId: 'W0701_SCENE', sceneContext: 'W0108_PRIVATE_CONTEXT' };
  for (const profile of ['demo', 'customer']) for (const cachedScene of [true, false]) {
    const result = await probe({ path: '/', profile, queue: [scene], cachedScene, sharedConnectors: true });
    expect(result.calls).toEqual([['queue.retry']]); expect(result.after).toEqual(result.before);
    expect(result.logs).toEqual([]); expect(result.pending).toBe(0);
    expect(result.envAccess.some(entry => /STORAGE|ASSETS|GEMINI|EVENT_QUEUE/.test(entry))).toBe(false);
  }
  const record = outcomeFromAction({ type: 'purchase', userId: 'W0108_SUBJECT', timestamp: Date.UTC(2026, 8, 16),
    data: { orderId: 'W0108_ORDER', value: 1 } }, 'acme')!;
  record.retention = captureRetention({ TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'] }), RETENTION: nativeRetention } as RetentionEnv, 'acme', record.ts);
  for (const failStoragePut of [false, true]) {
    const result = await probe({ path: '/', profile: 'customer', queue: [scene, { kind: 'ledger', type: 'outcome', record }],
      queuePositions: true, failStoragePut });
    expect(result.calls.filter(call => call[0].startsWith('queue.'))).toEqual([
      [failStoragePut ? 'queue.retry' : 'queue.ack', '1'], ['queue.retry', '0'],
    ]);
    expect(result.calls.some(call => call[0] === 'STORAGE.head' || call[0] === 'ASSETS.fetch')).toBe(false);
    if (failStoragePut) expect(result.after).toEqual(result.before);
    else expect(JSON.stringify(result.after)).toContain('W0108_ORDER');
  }
  const scheduled = await probe({ path: '/', profile: 'customer', scheduled: '0 * * * *' });
  expect(scheduled.pending).toBe(2); expect(scheduled.calls.some(call => call[0] === 'CACHE.list')).toBe(true);
});

it('W01.08 preserves customer scoped reads and mutations, Coach audiences and required preflights', async () => {
  for (const tenant of ['acme', 'globex']) {
    const headers = { 'X-Tenant': tenant, Authorization: 'Bearer ' + tokens[tenant === 'acme' ? 'admin' : 'globex'], 'Content-Type': 'application/json' };
    const common = { profile: 'customer', requestHost: 'shared.example', headers };
    const write = await probe({ ...common, path: '/config/reflex', method: 'PUT',
      body: JSON.stringify({ config: { ...DEFAULT_REFLEX_CONFIG, version: 'w0108', K: 7 } }), readBack: '/config/reflex' });
    expect(write.status).toBe(200); expect(JSON.parse(write.body).read).toMatchObject({ scope: tenant, config: { K: 7 } });
    expect(write.calls.every(call => call[0].startsWith('CACHE.') && call[1]!.startsWith('reflex:config:' + tenant + ':'))).toBe(true);
    const report = await probe({ ...common, operatorDiagnostics: true, path: '/v1/' + tenant + '/learn/report?date=2026-09-06' });
    expect(report.status).toBe(200); expect(report.calls).toContainEqual(['STORAGE.get', 'reports/' + tenant + '/' + tenant + '/2026-09-06.json']);
    const wrong = await probe({ ...common, path: '/config/reflex?scope=foreign' });
    expect(wrong.status).toBe(403); expect(wrong.calls).toEqual([]); expect(wrong.after).toEqual(wrong.before);
  }
  const coach = { path: '/operator/audiences', requestHost: 'shared.example', customerAuthorityTenant: 'coach', headers: { 'X-Tenant': 'coach', Authorization: 'Bearer ' + tokens.admin },
    tenantManifest: JSON.stringify({ provisioned: ['coach'], operatorGrants: { 'synthetic-acme-operator': ['coach'] } }) };
  const customer = await probe({ ...coach, profile: 'customer' });
  expect(customer.status).toBe(200); expect(JSON.parse(customer.body).audiences).toEqual([]);
  expect(customer.calls).toEqual([['CACHE.list', 'audience:']]); expect(customer.after).toEqual(customer.before);
  const authored = await probe({ ...coach, profile: 'customer', authoredAudience: true });
  expect(authored.status).toBe(200); expect(JSON.parse(authored.body).audiences).toMatchObject([{ key: 'authored', name: 'Customer authored' }]);
  expect(authored.calls).toEqual([['CACHE.list', 'audience:'], ['CACHE.get', 'audience:authored']]);
  expect(authored.after).toEqual(authored.before);
  const suggest = { ...coach, profile: 'customer', path: '/operator/audiences/suggest', method: 'POST', body: '{malformed' };
  assertDenied(await probe(suggest), suggest, ['get:AUTH_MODE']);
  // The actual owned shopper route must qualify authored records without
  // invoking the default-tenant catalog or either demo seeding path.
  const subject = 'vis-00000000-0000-4000-8000-000000000108';
  const shopper = await probe({ ...coach, profile: 'customer', path: '/realtime/segments/' + subject,
    authoredAudience: true, sdkKeys: 'coach:synthetic-coach-key', reflexHost: 'session',
    headers: { 'X-Tenant': 'coach', 'X-SDK-Key': 'synthetic-coach-key' },
    shopperCapability: { tenant: 'coach', subject, sessionId: 'w0108-coach-owned' } });
  expect(shopper.status).toBe(200); expect(JSON.parse(shopper.body)).toMatchObject({ userId: subject, segments: [] });
  expect(shopper.calls).toEqual([
    ['SHOPPER_REFLEX.idFromName', subject], ['SHOPPER_REFLEX.get', subject], ['SHOPPER_REFLEX.fetch', subject], ['SHOPPER_REFLEX.idFromName', subject],
    ['SESSIONS.get', 'session:w0108-coach-owned'], ['CACHE.list', 'audience:'], ['CACHE.get', 'audience:authored']]);
  expect(shopper.after).toEqual(shopper.before); expect(shopper.logs).toEqual([]);
  const sharedHelper = await probe({ path: '/', profile: 'customer', seedAudiences: true });
  expect(sharedHelper.calls).toEqual([]); expect(sharedHelper.envAccess).toEqual(['get:DEPLOYMENT_PROFILE']);
  expect(sharedHelper.after).toEqual(sharedHelper.before); expect(sharedHelper.logs).toEqual([]);
  const demoHelper = await probe({ path: '/', profile: 'demo', seedAudiences: true });
  expect(demoHelper.calls).toContainEqual(['catalog.getAllProducts']);
  expect(demoHelper.calls.some(call => call[0] === 'CACHE.put' && call[1]!.startsWith('audience:'))).toBe(true);
  const authoredRecord = (value: unknown) => (value as { cache: [string, string][] }).cache.find(([key]) => key === 'audience:authored');
  expect(authoredRecord(demoHelper.after)).toEqual(authoredRecord(demoHelper.before));
  const demo = await probe({ ...coach, mode: 'open' });
  expect(demo.status).toBe(200); expect(demo.calls.some(call => call[0] === 'CACHE.put' && call[1]!.startsWith('audience:'))).toBe(true);
  for (const [path, method] of [['/config/reflex', 'PATCH'], ['/content/catalog', 'PUT'], ['/auth/users/fixture', 'PATCH']]) {
    const preflight = await probe({ profile: 'customer', path: path!, method: 'OPTIONS',
      headers: { Origin: 'https://shop.acme.example', 'Access-Control-Request-Method': method!,
        'Access-Control-Request-Headers': 'authorization,content-type,x-tenant,if-match,idempotency-key' } });
    expect(preflight.status).toBe(204); expect(preflight.calls).toEqual([]); expect(preflight.after).toEqual(preflight.before);
    expect(preflight.headers['access-control-allow-methods']).toContain(method);
    expect(preflight.headers['access-control-allow-headers']?.toLowerCase()).toContain('if-match');
    expect(preflight.headers['access-control-allow-headers']?.toLowerCase()).toContain('idempotency-key');
  }
});

it('W02.08 the customer entry requires current registration before catalog, decision or audit effects', async () => {
  for (const path of ['/content/catalog', '/v1/acme/learn/slots', '/v1/acme/visitors/private/recent']) {
    for (const customerCredentialState of ['unregistered', 'revoked'] as const) {
      const denied = await probe({ profile: 'customer', path, headers: credentials('admin'), customerCredentialState });
      expect(denied.status).toBe(401); expect(denied.calls).toEqual([]); expect(denied.after).toEqual(denied.before);
    }
    const crossTenant = await probe({ profile: 'customer', path, headers: credentials('admin'), customerAuthorityTenant: 'globex' });
    expect(crossTenant.status).toBe(403); expect(crossTenant.calls).toEqual([]); expect(crossTenant.after).toEqual(crossTenant.before);
  }
  const allowed = await probe({ profile: 'customer', path: '/content/catalog', headers: credentials('admin'), publicationTenant: 'acme' });
  expect(allowed.status).toBe(200); expect(allowed.calls.some(call => call[0] === 'STORAGE.get')).toBe(true);
  for (const [path, method] of [['/auth/memberships', 'POST'], ['/auth/memberships/member', 'PATCH'], ['/auth/service-credentials', 'POST'], ['/auth/service-credentials/credential', 'DELETE']]) {
    const preflight = await probe({ profile: 'customer', path: path!, method: 'OPTIONS', headers: {
      Origin: 'https://shop.acme.example', 'Access-Control-Request-Method': method!, 'Access-Control-Request-Headers': 'authorization,if-match,x-tenant',
    } });
    expect(preflight.status).toBe(204); expect(preflight.calls).toEqual([]);
    const service = await probe({ profile: 'customer', path: path!, method: method!, headers: credentials('admin'), body: method === 'POST' || method === 'PATCH' ? '{}' : undefined });
    expect(service.status).toBe(401); expect(service.calls).toEqual([]);
  }
});

it('W01.08 actual customer asset routing serves only declared SDK and console files with no SPA or shadow fallback', async () => {
  const { experimental_readRawConfig } = await import('wrangler');
  const config = experimental_readRawConfig({ config: 'wrangler.toml' }).rawConfig;
  for (const name of ['staging', 'production']) {
    const customer = config.env![name]!;
    expect(customer.vars).toMatchObject({ DEPLOYMENT_PROFILE: 'customer', AUTH_MODE: 'enforced' });
    expect(customer.assets).toMatchObject({ directory: 'public', binding: 'ASSETS', run_worker_first: true, html_handling: 'none', not_found_handling: 'none' });
    expect(customer.browser).toBeUndefined();
    for (const binding of CUSTOMER_OMITTED_BINDINGS) expect(customer.durable_objects!.bindings!.some((item: { name: string }) => item.name === binding)).toBe(false);
  }
  const assets = config.env!.staging!.assets!;
  const assetRuntime = new Miniflare({
    modules: [{ type: 'ESModule', path: 'w0102-worker.mjs', contents: runtimeBundle }],
    compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'],
    bindings: { W0108_ASSET_FIXTURE: 'true', DEPLOYMENT_PROFILE: 'customer', AUTH_MODE: 'enforced', ENVIRONMENT: 'w0108-synthetic',
      TENANTS: JSON.stringify({ provisioned: ['acme'], hosts: { 'acme.example': 'acme' } }) },
    assets: { directory: resolve(assets.directory!), binding: assets.binding,
      routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: assets.run_worker_first === true },
      assetConfig: { html_handling: 'none', not_found_handling: 'none' } },
    outboundService: () => { outboundAttempts++; throw new Error('W01.08 forbids outbound network'); },
  });
  try {
    await assetRuntime.ready;
    for (const [path, file] of Object.entries(CUSTOMER_ASSETS)) {
      const result = await assetRuntime.dispatchFetch('https://acme.example' + path);
      expect(result.status, path).toBe(200);
      expect(createHash('sha256').update(Buffer.from(await result.arrayBuffer())).digest('hex'), path)
        .toBe(createHash('sha256').update(readFileSync('public' + file)).digest('hex'));
    }
    const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? files(directory + '/' + entry.name) : [directory + '/' + entry.name]);
    const prohibited = files('public').map(file => file.slice('public'.length)).filter(path => !Object.hasOwn(CUSTOMER_ASSETS, path));
    for (const path of [...prohibited, '/unknown-navigation', '/console/unknown', '/sdk/edge-personalization', '/%63onsole/index.html',
      '/console/%2e%2e/meridian/index.html', '/console%2findex.html', '/api-info.html', '/api/private', '/storefront', '/meridian/', '/live/']) {
      const result = await assetRuntime.dispatchFetch('https://acme.example' + path, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
      expect(result.status, path).toBe(404); expect(await result.text(), path).toBe('{"error":"Not Found"}');
    }
    for (const method of ['POST', 'OPTIONS', 'PROPFIND']) {
      const result = await assetRuntime.dispatchFetch('https://acme.example/console/', { method });
      expect(result.status).toBe(404);
    }
    const head = await assetRuntime.dispatchFetch('https://acme.example/sdk/edge-personalization.js', { method: 'HEAD' });
    expect(head.status).toBe(200); expect(await head.text()).toBe('');
    const info = await assetRuntime.dispatchFetch('https://acme.example/api-info');
    expect(info.status).toBe(200); const body = await info.json() as { endpoints: Record<string, string> };
    expect(body.endpoints).not.toHaveProperty('storefront'); expect(body.endpoints).not.toHaveProperty('pixel');
    const root = await assetRuntime.dispatchFetch('https://acme.example/', { redirect: 'manual' });
    expect(root.status).toBe(302); expect(root.headers.get('location')).toBe('https://acme.example/console/');
  } finally { await assetRuntime.dispose(); }
}, 30_000);

it('W07.01 does not log raw path, query or caller request-ID on actual entry requests', async () => {
  for (const path of ['/W0701_SUBJECT/missing?visitorId=W0701_VISITOR&sessionId=W0701_SESSION',
    '/api-info?visitorId=W0701_VISITOR&sessionId=W0701_SESSION']) {
    const r = await probe({ path, headers: { 'X-Request-Id': 'W0701_REQUEST_ID',
      Cookie: 'opt_tracking_consent=false; opt_personalization_enabled=false' } });
    expect(r.status).toBe(path.startsWith('/api-info') ? 200 : 404);
    expect(r.headers['x-request-id']).toBe('W0701_REQUEST_ID');
    expect(r.logs).toEqual([]);
    expect(r.calls).toEqual([]);
  }
});

it('W07.01 keeps default queue ack and catch retry while logging no bodies or exception detail', async () => {
  const body = { type: 'event', event: { userId: 'W0701_SUBJECT', email: 'w0701@example.invalid', private: 'W0701_PRIVATE_FAILURE' } };
  const ok = await probe({ path: '/', queue: [body] });
  expect(ok.calls).toEqual([['queue.ack']]);
  expect(ok.logs).toEqual([]);
  expect(ok.after).toEqual(ok.before);
  const failure = await probe({ path: '/', queue: [body], failAck: true });
  expect(failure.calls).toEqual([['queue.ack'], ['queue.retry']]);
  expect(failure.logs).toEqual(['Error processing message']);
  expect(failure.after).toEqual(failure.before);
});

it('W07.01 keeps cached-scene success and handled-failure acknowledgements with no scene fields in logs', async () => {
  const scene = { kind: 'scene', productId: 'W0701_SUBJECT', sceneId: 'W0701_SCENE', sceneContext: 'W0701_PRIVATE_CONTEXT' };
  for (const cachedScene of [true, false]) {
    const r = await probe({ path: '/', mode: 'open', queue: [scene], cachedScene });
    expect(r.calls).toEqual([['STORAGE.head', 'scene/live/w0701-subject__w0701-scene.jpg'], ['queue.ack']]);
    expect(r.logs).toEqual(cachedScene ? [] : ['queue scene failed']);
    expect(r.after).toEqual(r.before);
  }
});

it('W07.01 preserves successful ledger writes and retries real R2 failures without logging failure details', async () => {
  const record = outcomeFromAction({ type: 'purchase', userId: 'W0701_SUBJECT', timestamp: Date.UTC(2026, 8, 7),
    data: { orderId: 'W0701_PRIVATE_ORDER', value: 1 } }, 'acme')!;
  record.retention = captureRetention({ TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'] }), RETENTION: nativeRetention } as RetentionEnv, 'acme', record.ts);
  const message = { kind: 'ledger', type: 'outcome', record };
  const ok = await probe({ path: '/', queue: [message] });
  const ownerCalls = ['SHOPPER_REFLEX.idFromName', 'SHOPPER_REFLEX.get', 'SHOPPER_REFLEX.fetch', 'SHOPPER_REFLEX.idFromName']
    .map(op => [op, shopperObjectName('acme', record.visitor_id)]);
  expect(ok.calls.filter(c => c[0].startsWith('SHOPPER_REFLEX.'))).toEqual(ownerCalls);
  expect(ok.calls.filter(c => !c[0].startsWith('SHOPPER_REFLEX.')).map(c => c[0])).toEqual(['STORAGE.list', 'STORAGE.put', 'queue.ack']);
  expect(ok.calls).toContainEqual(['STORAGE.list', 'erasures/acme/pending/']);
  expect(ok.logs).toEqual([]);
  expect(JSON.stringify(ok.after)).toContain('W0701_PRIVATE_ORDER');
  const failed = await probe({ path: '/', queue: [message], failStoragePut: true });
  expect(failed.calls.filter(c => c[0].startsWith('SHOPPER_REFLEX.'))).toEqual(ownerCalls);
  expect(failed.calls.filter(c => !c[0].startsWith('SHOPPER_REFLEX.')).map(c => c[0])).toEqual(['STORAGE.list', 'STORAGE.put', 'queue.retry']);
  expect(failed.calls).toContainEqual(['STORAGE.list', 'erasures/acme/pending/']);
  expect(failed.logs).toEqual(['ledger batch failed']);
  expect(failed.after).toEqual(failed.before);
});

it('W09.03 maps mixed ledger dispositions to exact queue positions without partial acknowledgement or raw diagnostics', async () => {
  const record = outcomeFromAction({ type: 'purchase', userId: 'W0903_PRIVATE_SUBJECT', timestamp: Date.UTC(2026, 8, 11),
    data: { orderId: 'W0903_PRIVATE_ORDER', value: 1 } }, 'acme')!;
  record.retention = captureRetention({ TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'] }), RETENTION: nativeRetention } as RetentionEnv, 'acme', record.ts);
  const valid = { kind: 'ledger', type: 'outcome', record };
  const invalidManaged = { ...valid, version: 1, delivery_id: null };
  const invalidSet = { kind: 'ledger', type: 'decisions', records: [
    { decision_id: `acme:${record.outcome_id.split(':')[1]}:${record.visitor_id}:home:hero:0`, tenant: 'acme', visitor_id: record.visitor_id, ts: record.ts },
    { decision_id: 'W0903_PRIVATE_MALFORMED' },
  ] };
  const queue = [invalidSet, { type: 'unchanged-non-ledger' }, valid, invalidManaged, { ...valid, version: 1 }, { ...valid, version: 2 }];
  // Whole W09 supersedes containment's unknown-message ACK: no silent loss.
  const result = await probe({ path: '/', queue, queuePositions: true });
  expect(result.calls.filter(call => call[0].startsWith('queue.'))).toEqual([
    ['queue.retry', '0'], ['queue.ack', '2'], ['queue.retry', '3'], ['queue.ack', '4'], ['queue.retry', '5'], ['queue.retry', '1'],
  ]);
  expect(result.calls.filter(call => call[0] === 'STORAGE.put')).toHaveLength(1);
  const before = new Map((result.before as { storage: [string, string][] }).storage);
  const stored = (result.after as { storage: [string, string][] }).storage.filter(([key, body]) => before.get(key) !== body);
  expect(stored).toHaveLength(1);
  expect(stored[0]![1].trim().split('\n').map(line => JSON.parse(line))).toEqual([record, record]);
  expect(result.logs).toEqual(['ledger envelopes rejected for retry 3']);
  expect(JSON.stringify(result.logs)).not.toContain('W0903_PRIVATE');
  const failed = await probe({ path: '/', queue, queuePositions: true, failStoragePut: true });
  expect(failed.calls.filter(call => call[0].startsWith('queue.'))).toEqual([
    ['queue.retry', '0'], ['queue.retry', '2'], ['queue.retry', '3'], ['queue.retry', '4'], ['queue.retry', '5'], ['queue.retry', '1'],
  ]);
  expect(failed.logs).toEqual(['ledger batch failed', 'ledger envelopes rejected for retry 3']);
  expect(failed.after).toEqual(failed.before);
});

it('W06.12 native owner/R2 ordering preserves complete envelopes, cutoff replay and bounded cohort capacity', async () => {
  const observed: string[] = []; let released!: () => void, entered!: () => void, gated = false;
  const gate = new Promise<void>(resolve => { released = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
  const local = nativeRuntime('do', async request => {
    const { key } = await request.json() as { key: string }; observed.push(key);
    if (!gated && key.startsWith('acme/') && key.includes('-managed-')) { gated = true; entered(); await gate; }
    return new Response(null, { status: 204 });
  });
  const at = Date.now(), policy = { TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'] }), RETENTION: nativeRetention } as RetentionEnv;
  const row = (tenant: string, visitor: string, ts: number, ordinal = 0) => ({ decision_id: `${tenant}:${ts36(ts)}:${visitor}:home:hero:${ordinal}`,
    tenant, brand: tenant, visitor_id: visitor, session_id: 'native-session', ts, page: 'home', slot: 'hero', item_id: 'native-item',
    position: ordinal, arm: 'personalized', retention: captureRetention(policy, tenant, ts, at) });
  const a = row('acme', 'vis-native-erased', at - 1000), b = row('globex', 'vis-native-other', at - 1000, 1);
  const managed = { kind: 'ledger', type: 'decisions', version: 1, delivery_id: crypto.randomUUID(), records: [a, b] };
  const legacy = { kind: 'ledger', type: 'decisions', records: [row('acme', a.visitor_id, at + 1), row('acme', 'vis-native-legacy', at - 1000)] };
  const request = async (operation: Record<string, unknown>) => {
    const response = await local.dispatchFetch('https://fixture/', { method: 'POST', body: JSON.stringify({ nativeLedger: operation }) });
    expect(response.status).toBe(200); return response.json() as Promise<Record<string, any>>;
  };
  try {
    await local.ready;
    const bucket = await local.getR2Bucket('STORAGE');
    let captureDone = false, eraseDone = false;
    const capture = request({ action: 'capture', bodies: [managed, legacy] }).then(result => { captureDone = true; return result; });
    await waiting;
    const erasing = request({ action: 'erase', tenant: 'acme', subject: a.visitor_id, now: at }).then(result => { eraseDone = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(captureDone).toBe(false); expect(eraseDone).toBe(false);
    expect(observed.some(key => key.startsWith('erasures/acme/pending/'))).toBe(false);
    expect((await bucket.list({ prefix: 'acme/' })).objects).toEqual([]);
    released();
    expect((await capture).positions).toEqual([['ack', 0], ['ack', 1]]);
    expect(await erasing).toMatchObject({ ok: true, tombstone: { erased_at: at }, ring: 'unbound' });
    const originalKeys = (await bucket.list({ prefix: 'acme/' })).objects.map(object => object.key);
    const managedKey = originalKeys.find(key => key.includes('-managed-'))!;
    const beforeClaims = (await bucket.list({ prefix: 'ledger-delivery/' })).objects;
    const claimBytes = await Promise.all(beforeClaims.map(async object => [object.key, await (await bucket.get(object.key))!.text()]));
    const commitment = JSON.parse(claimBytes.find(([key]) => key === 'ledger-delivery/identities/' + managed.delivery_id + '.json')![1]!);
    expect(commitment).toMatchObject({ id: managed.delivery_id, count: 2, digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await request({ action: 'rewrite', tenant: 'acme', now: at + 86400_000 });
    const replay = await request({ action: 'capture', bodies: [managed, { ...managed, delivery_id: crypto.randomUUID() },
      { kind: 'ledger', type: 'decision', record: a }] });
    expect(replay.positions).toEqual([['ack', 0], ['ack', 1], ['ack', 2]]);
    const empty = await bucket.get(managedKey); expect(await empty!.text()).toBe(''); expect(empty!.customMetadata?.ledger_delivery).toBe('1');
    for (const [key, bytes] of claimBytes) expect(await (await bucket.get(key!))!.text()).toBe(bytes);
    const rows = async (tenant: string) => (await Promise.all((await bucket.list({ prefix: tenant + '/' })).objects.map(async object =>
      (await (await bucket.get(object.key))!.text()).split('\n').filter(Boolean).map(line => JSON.parse(line))))).flat();
    expect((await rows('acme')).map(value => [value.visitor_id, value.ts]).sort()).toEqual([[a.visitor_id, at + 1], ['vis-native-legacy', at - 1000]].sort());
    expect((await rows('globex')).every(value => value.visitor_id === b.visitor_id && value._ledger_delivery.ordinal === 1)).toBe(true);
    // Configured100-message traffic exercises actual eight-owner cohorts, not
    // a Map namespace or an asserted native hop limit.
    const capacity = Array.from({ length: 100 }, (_, index) => ({ kind: 'ledger', type: 'decisions', version: 1, delivery_id: crypto.randomUUID(),
      records: [row('acme', 'vis-native-capacity-' + index, at + 2, index)] }));
    expect((await request({ action: 'capture', bodies: capacity })).positions).toEqual(capacity.map((_, index) => ['ack', index]));
    expect((await rows('acme')).filter(value => value.visitor_id.startsWith('vis-native-capacity-'))).toHaveLength(100);
    const indivisible = { kind: 'ledger', type: 'decisions', version: 1, delivery_id: crypto.randomUUID(), records: capacity.map(body => body.records[0]!) };
    expect(new TextEncoder().encode(JSON.stringify(indivisible)).byteLength).toBeLessThan(120000);
    expect((await request({ action: 'capture', bodies: [indivisible] })).positions).toEqual([['ack', 0]]);
    const indivisibleRows = (await rows('acme')).filter(value => value._ledger_delivery?.id === indivisible.delivery_id);
    expect(indivisibleRows).toHaveLength(100);
    expect(indivisibleRows.map(value => value._ledger_delivery.ordinal).sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(JSON.parse(await (await bucket.get('ledger-delivery/identities/' + indivisible.delivery_id + '.json'))!.text()))
      .toMatchObject({ id: indivisible.delivery_id, count: 100 });
    const large = { ...row('acme', 'vis-native-large', at + 3), explain: { note: 'x'.repeat(9 * 1024 * 1024) } };
    expect(await request({ action: 'fallback', records: [large] })).toMatchObject({ code: 'oversized_record', capture: { ok: true, newlyStored: 1, unknown: 0, notAttempted: 0 } });
    expect((await rows('acme')).filter(value => value.visitor_id === 'vis-native-large')).toHaveLength(1);
  } finally { released(); await local.dispose(); }
}, 90000);

it('W09.06 forwards exhausted native retries to the isolated DLQ while a healthy sibling persists once', async () => {
  const { experimental_readRawConfig } = await import('wrangler');
  type QueueConfig = {
    producers: { binding: string; queue: string }[];
    consumers: { queue: string; dead_letter_queue: string; max_batch_size: number;
      max_batch_timeout: number; max_concurrency: number; max_retries: number }[];
  };
  const { rawConfig, redirected } = experimental_readRawConfig({ config: resolve('wrangler.toml') }, { useRedirectIfAvailable: false }) as {
    rawConfig: { queues: QueueConfig; env: Record<string, { queues: QueueConfig }> }; redirected: boolean;
  };
  expect(redirected).toBe(false);
  const configurations = [rawConfig.queues, rawConfig.env.staging!.queues, rawConfig.env.production!.queues];
  const names = ['events', 'events-staging', 'events-production'];
  configurations.forEach((config, index) => {
    expect(config.producers).toEqual([{ binding: 'EVENT_QUEUE', queue: names[index] }]);
    expect(config.consumers).toEqual([{ queue: names[index], dead_letter_queue: names[index] + '-dead-letter',
      max_batch_size: 100, max_batch_timeout: 3, max_concurrency: 6, max_retries: 2 },
    { queue: names[index] + '-dead-letter', max_batch_size: 100, max_batch_timeout: 3, max_concurrency: 6, max_retries: 2 }]);
  });
  expect(new Set(configurations.flatMap(config => config.consumers.flatMap(c => [c.queue, c.dead_letter_queue]).filter(Boolean))).size).toBe(6);

  type Observation = { sink: 'source' | 'dead-letter'; queue: string;
    messages: { body: unknown; attempts: number }[]; logs?: string[] };
  const observed: Observation[] = [];
  const outbound = { source: 0, collector: 0 };
  const observe = async (request: Request) => {
    observed.push(await request.json() as Observation);
    return new Response('observed');
  };
  const source = configurations[0]!.consumers[0]!;
  // This observer consumes the local DLQ: Miniflare does not retain consumerless
  // queue messages or persist its backlog. This proves forwarding only.
  const queues = new Miniflare({ cf: false, workers: [{
    name: 'w0906-source',
    modules: [{ type: 'ESModule', path: 'w0102-worker.mjs', contents: runtimeBundle }],
    compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'],
    r2Buckets: ['STORAGE'], queueProducers: { EVENT_QUEUE: source.queue },
    bindings: { DEPLOYMENT_PROFILE: 'demo', TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'] }), RETENTION: nativeRetention },
    durableObjects: { SHOPPER_REFLEX: 'ShopperReflex' },
    kvNamespaces: ['CACHE', 'SESSIONS'],
    queueConsumers: { [source.queue]: { maxBatchSize: source.max_batch_size, maxBatchTimeout: source.max_batch_timeout,
      maxRetries: source.max_retries, deadLetterQueue: source.dead_letter_queue } },
    serviceBindings: { W0906_OBSERVER: observe },
    outboundService: () => { outbound.source++; throw new Error('W09.06 forbids outbound network'); },
  }, {
    name: 'w0906-collector', modules: true,
    script: `export default { async queue(batch, env) {
      await env.OBSERVER.fetch('http://observer/dead-letter', { method: 'POST', body: JSON.stringify({
        sink: 'dead-letter', queue: batch.queue,
        messages: batch.messages.map(message => ({ body: message.body, attempts: message.attempts })),
      }) });
      batch.ackAll();
    } };`,
    queueConsumers: { [source.dead_letter_queue]: { maxBatchTimeout: 0 } },
    serviceBindings: { OBSERVER: observe },
    outboundService: () => { outbound.collector++; throw new Error('W09.06 forbids outbound network'); },
  }] });
  try {
    await queues.ready;
    const record = outcomeFromAction({ type: 'purchase', userId: 'W0906_PRIVATE_SUBJECT', timestamp: Date.UTC(2026, 8, 14),
      data: { orderId: 'W0906_PRIVATE_ORDER', value: 1 } }, 'acme')!;
    record.retention = captureRetention({ TENANTS: JSON.stringify({ provisioned: ['acme', 'globex'] }), RETENTION: nativeRetention } as RetentionEnv, 'acme', record.ts);
    const healthy = { kind: 'ledger', type: 'outcome', version: 1, record };
    const poison = { ...healthy, version: 2, private: { marker: 'W0906_PRIVATE_PAYLOAD', nested: ['retained', 7] } };
    const queue = await queues.getQueueProducer('EVENT_QUEUE', 'w0906-source');
    await queue.sendBatch([{ body: poison, contentType: 'json' }, { body: healthy, contentType: 'json' }]);
    const deadline = Date.now() + 18_000;
    while (!observed.some(entry => entry.sink === 'dead-letter')) {
      if (Date.now() >= deadline) throw new Error('W09.06 native DLQ forwarding deadline exceeded');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const attempts = observed.filter(entry => entry.sink === 'source');
    expect(attempts.map(entry => entry.queue)).toEqual([source.queue, source.queue, source.queue]);
    expect(attempts.map(entry => entry.messages)).toEqual([
      [{ body: poison, attempts: 1 }, { body: healthy, attempts: 1 }],
      [{ body: poison, attempts: 2 }], [{ body: poison, attempts: 3 }],
    ]);
    expect(attempts.map(entry => entry.logs)).toEqual(Array.from({ length: 3 }, () => ['ledger envelopes rejected for retry 1']));
    expect(JSON.stringify(attempts.map(entry => entry.logs))).not.toContain('W0906_PRIVATE');
    const dead = observed.filter(entry => entry.sink === 'dead-letter');
    expect(dead).toHaveLength(1);
    expect(dead[0]!.queue).toBe(source.dead_letter_queue);
    expect(dead[0]!.messages.map(message => message.body)).toEqual([poison]);
    const bucket = await queues.getR2Bucket('STORAGE', 'w0906-source');
    const listed = await bucket.list();
    expect(listed.truncated).toBe(false);
    expect(listed.objects).toHaveLength(1);
    const stored = await bucket.get(listed.objects[0]!.key);
    expect((await stored!.text()).trim().split('\n').map(line => JSON.parse(line))).toEqual([record]);
    console.log('W09.06_NATIVE ' + JSON.stringify({ bundleSha256: createHash('sha256').update(runtimeBundle).digest('hex'),
      sourceAttempts: [1, 2, 3], healthyAttempts: [1], forwardedBodies: 1, persistedRecords: 1, outbound }));
  } finally {
    await queues.dispose();
    expect(outbound).toEqual({ source: 0, collector: 0 });
  }
}, 30_000);

it('uses real JWT verification for a retained operator account read', async () => {
  for (const role of ['absent', 'invalid', 'operator', 'admin', 'operator-access', 'admin-access']) {
    const result = await probe({ path: '/auth/me', headers: credentials(role) });
    const accepted = role.endsWith('-access');
    expect(result.status).toBe(accepted ? 200 : 401);
    expect(result.calls).toEqual(accepted ? [['ACCOUNTS.getSession', 'synthetic-account-session'],
      ['ACCOUNTS.getById', 'synthetic-acme-operator'], ['ACCOUNTS.getById', 'synthetic-acme-operator']] : []);
    if (accepted) expect(JSON.parse(result.body).user).toMatchObject({ sub: 'synthetic-acme-operator', roles: ['operator'] });
    expect(result.after).toEqual(result.before);
  }
});

it('retains SDK-authorized non-default tenant reads at the intended destination', async () => {
  for (const key of [undefined, 'invalid-synthetic-key', 'synthetic-acme-key']) {
    const result = await probe({ path: '/v1/acme/trend?region=US-NY', headers: key ? { 'X-SDK-Key': key } : {} });
    const accepted = key === 'synthetic-acme-key';
    expect(result.status).toBe(accepted ? 200 : 401);
    expect(result.calls).toEqual(accepted ? [['CACHE.get', 'trend:v2:acme:US-NY']] : []);
    if (accepted) expect(JSON.parse(result.body)).toMatchObject({ tenant: 'acme', snapshot: { generation: 2, tenant: 'acme', region: 'US-NY', events: 50, share: { interest: { fixture: 1 } } } });
    expect(result.after).toEqual(result.before);
  }
});

function diagnosticReads(tenant: string) {
  const item = `W0106_PRIVATE_${tenant}`, n = tenant === 'acme' ? 3 : 9;
  const lift = ['CACHE.get', `lift:${tenant}:${tenant}:hero`];
  const contentHead = ['STORAGE.get', `config-publication/v1/${tenant}/content/head.json`];
  const contentRevision = ['STORAGE.get', `config-publication/v1/${tenant}/content/rev/1.json`];
  const learn = ['CACHE.get', `learn:config:${tenant}:current`];
  const report = ['STORAGE.get', `reports/${tenant}/${tenant}/2026-09-06.json`];
  return [
    { suffix: 'lift/rows?slot=hero', calls: [lift, contentHead, learn, contentRevision], body: { tenant, published: true, total: 1,
      rows: [{ item, title: item, n, control: 'freeze' }] } },
    { suffix: 'brands', calls: [], body: { tenant, brands: [{ id: tenant, default: tenant === 'acme' }] } },
    { suffix: 'learn/slots?evidence=1', calls: [['CACHE.get', `slots:config:${tenant}:current`], contentHead, learn, contentRevision, lift],
      body: { tenant, total: 1, pages: [{ page: 'home', slots: [{ slot: 'hero', pieces: 1, gamma: 0.2, controls: 1,
        exploration: 'rotation', evidence: { items: 1, events: n, publishedAt: 7 } }] }] } },
    { suffix: 'learn/exploring?slot=hero', calls: [lift, contentHead, learn, contentRevision], body: { tenant, published: true,
      total: 1, mode: 'rotation', rows: [{ item, title: item, n, to_floor: 30 - n }] } },
    { suffix: 'lift?slot=hero', calls: [lift], body: { tenant, snapshot: { tenant, events: n, version: 7, items: { [item]: { '*': { n } } } } } },
    { suffix: 'lift?slot=hero&version=7', calls: [['STORAGE.get', `lift/${tenant}/${tenant}/hero/7.json`]],
      body: { tenant, snapshot: { tenant, events: n, version: 7, items: { [item]: { '*': { n } } } } } },
    { suffix: 'lift/history?slot=hero', calls: [['STORAGE.list', `lift/${tenant}/${tenant}/hero/`]], body: { tenant, versions: [{ version: 7 }] } },
    { suffix: 'learn/report/window?from=2026-09-06&to=2026-09-06', calls: [report], body: { report: { tenant,
      days: ['2026-09-06'], missing: [], incomplete: [{ date: '2026-09-06', truncated: false, missingHours: [1] }],
      measurement: { kind: 'attribution_diagnostic', inference: 'unavailable' },
      sourceCounts: [{ date: '2026-09-06', counts: { decisions: n, outcomes: 1, visitors: 1, truncated: false } }],
      // Legacy fixture has no recorded computation basis. Preserve its raw
      // counts without blessing those counts as a compatible pooled arm.
      slots: { hero: { arms: [], comparisons: [], compatibility: { status: 'unknown', reasons: ['unknown_basis'], days: ['2026-09-06'] } } } } } },
    { suffix: 'learn/report?date=2026-09-06', calls: [report], body: { report: { tenant, counts: { decisions: n },
      measurement: { kind: 'attribution_diagnostic', inference: 'unavailable' },
      holdout: { hero: [{ arm: 'personalized', decisions: n, credited: 1, rate: 1 / n }] }, holdoutComparison: { hero: [] } } } },
  ];
}

function assertDiagnosticDenied(result: Result, expected: number, label: string) {
  expect(result.status, label).toBe(expected);
  expect(result.headers['cache-control'], label).toBe('no-store');
  expect(result.calls, label).toEqual([]); expect(result.after, label).toEqual(result.before);
  expect(result.pending, label).toBe(0); expect(result.bodyReads, label).toBe(0); expect(result.logs, label).toEqual([]);
  expect(result.body, label).not.toMatch(/W0106_PRIVATE_|W0106_STALE_INFERENCE/);
}

it('W01.06 requires operator authority before every diagnostic GET and HEAD destination', async () => {
  for (const tenant of ['acme', 'globex']) {
    const sdk = { 'X-SDK-Key': `synthetic-${tenant}-key` };
    const other = tenant === 'acme' ? tokens.globex : tokens.admin;
    const callers = [
      { name: 'absent', headers: {}, status: 401 },
      { name: 'site header', headers: sdk, status: 401 },
      { name: 'site query', headers: {}, query: `sdkKey=synthetic-${tenant}-key`, status: 401 },
      ...['invalid', 'refresh', 'expired'].map(kind => ({ name: kind, headers: { ...sdk, Authorization: `Bearer ${tokens[kind]}` }, status: 401 })),
      { name: 'other operator and target site key', headers: { ...sdk, Authorization: `Bearer ${other}` }, status: 403 },
    ];
    for (const { suffix } of diagnosticReads(tenant)) {
      for (const method of ['GET', 'HEAD']) for (const caller of callers) {
        const path = `/v1/${tenant}/${suffix}${caller.query ? `${suffix.includes('?') ? '&' : '?'}${caller.query}` : ''}`;
        const result = await probe({ path, method, requestHost: 'shared.example', headers: { 'X-Tenant': tenant, ...caller.headers }, operatorDiagnostics: true });
        assertDiagnosticDenied(result, caller.status, `${method} ${path} ${caller.name}`);
        if (method === 'HEAD') expect(result.body).toBe('');
      }
      const alias = suffix.replace(/^[^?]+/, path => path.split('/').map(segment => `%${segment.charCodeAt(0).toString(16)}${segment.slice(1)}`).join('/'));
      const result = await probe({ path: `/%761/${tenant === 'acme' ? '%61cme' : '%67lobex'}/${alias}`, requestHost: 'shared.example', headers: sdk, operatorDiagnostics: true });
      assertDiagnosticDenied(result, 401, alias);
    }
  }
  for (const headers of [{ 'X-Tenant': 'globex' }, { 'X-Tenant': 'acme,globex' }]) {
    const denied = await probe({ path: '/v1/acme/learn/report?date=2026-09-06', requestHost: 'shared.example',
      headers: { ...credentials('admin'), ...headers }, operatorDiagnostics: true });
    assertDiagnosticDenied(denied, 403, 'conflicting tenant selector');
  }
  const shopper = await probe({ path: '/v1/acme/lift?slot=hero', headers: { 'X-SDK-Key': 'synthetic-acme-key' },
    shopperCapability: { tenant: 'acme', subject: 'vis-00000000-0000-4000-8000-000000000006', sessionId: 'synthetic-session' }, operatorDiagnostics: true });
  assertDiagnosticDenied(shopper, 401, 'shopper capability is not operator authority');
}, 20_000);

it('W01.06 retains populated own-tenant diagnostics and only explicitly granted brand discovery', async () => {
  for (const tenant of ['acme', 'globex']) {
    const token = tenant === 'acme' ? tokens.admin : tokens.globex;
    for (const withKey of [false, true]) for (const entry of diagnosticReads(tenant)) {
      const result = await probe({ path: `/v1/${tenant}/${entry.suffix}`, requestHost: 'shared.example', operatorDiagnostics: true,
        headers: { 'X-Tenant': tenant, Authorization: `Bearer ${token}`, ...(withKey ? { 'X-SDK-Key': `synthetic-${tenant}-key` } : {}) } });
      expect(result.status, entry.suffix).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
      expect(result.calls, entry.suffix).toEqual(entry.calls); expect(result.after).toEqual(result.before);
      expect(result.pending).toBe(0); expect(result.bodyReads).toBe(0); expect(result.logs).toEqual([]);
      expect(JSON.parse(result.body)).toMatchObject({ ok: true, ...entry.body });
      expect(result.body).not.toContain(`W0106_PRIVATE_${tenant === 'acme' ? 'globex' : 'acme'}`);
      expect(result.body).not.toContain('W0106_STALE_INFERENCE');
    }
  }
  for (const operatorGrants of [undefined, {}, { 'synthetic-acme-operator': ['*'] }, { 'synthetic-acme-operator': 'acme' }]) {
    for (const suffix of ['brands', 'learn/report?date=2026-09-06']) {
      const result = await probe({ path: `/v1/acme/${suffix}`, headers: { ...credentials('admin'), 'X-SDK-Key': 'synthetic-acme-key' },
        tenantManifest: JSON.stringify({ provisioned: ['acme', 'globex'], operatorGrants }), operatorDiagnostics: true });
      assertDiagnosticDenied(result, 403, 'missing or malformed operator grants');
    }
  }
  const dual = await probe({ path: '/v1/acme/brands', headers: credentials('admin'),
    tenantManifest: JSON.stringify({ provisioned: ['acme', 'initech', 'globex', 'acme'],
      operatorGrants: { 'synthetic-acme-operator': ['globex', 'acme'] } }) });
  expect(dual.status).toBe(200); expect(dual.calls).toEqual([]); expect(dual.after).toEqual(dual.before);
  expect(JSON.parse(dual.body).brands).toEqual([{ id: 'acme', default: true }, { id: 'globex', default: false }]);
  const head = await probe({ path: '/v1/acme/learn/report?date=2026-09-06', method: 'HEAD', headers: credentials('operator'), operatorDiagnostics: true });
  expect(head.status).toBe(200); expect(head.body).toBe(''); expect(head.headers['cache-control']).toBe('no-store');
  expect(head.calls).toEqual([['STORAGE.get', 'reports/acme/acme/2026-09-06.json']]); expect(head.after).toEqual(head.before);
}, 20_000);

it('W01.06 preserves open and unset diagnostics plus existing preflight and unknown-method behavior', async () => {
  for (const mode of ['open', 'unset', 'misspelled']) for (const entry of diagnosticReads('acme')) {
    const result = await probe({ path: `/v1/acme/${entry.suffix}`, mode, operatorDiagnostics: true });
    expect(result.status, `${mode} ${entry.suffix}`).toBe(200); expect(result.calls).toEqual(entry.calls);
    expect(result.after).toEqual(result.before); expect(result.pending).toBe(0); expect(result.bodyReads).toBe(0); expect(result.logs).toEqual([]);
    const body = entry.suffix === 'brands'
      ? { tenant: 'acme', brands: [{ id: 'acme', default: true }, { id: 'globex', default: false }] } : entry.body;
    expect(JSON.parse(result.body)).toMatchObject({ ok: true, ...body });
  }
  const preflight = await probe({ path: '/v1/acme/learn/report', method: 'OPTIONS', requestHost: 'shared.example',
    headers: { Origin: 'https://shop.acme.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,x-tenant' } });
  expect(preflight.status).toBe(204); expect(preflight.calls).toEqual([]); expect(preflight.after).toEqual(preflight.before);
  for (const path of ['/v1/acme/lift', '/v1/acme/learn/report', '/v1/acme/liftish']) {
    const unknown = await probe({ path, method: 'PUT', headers: { 'X-SDK-Key': 'synthetic-acme-key' }, operatorDiagnostics: true });
    expect(unknown.status).toBe(404); expect(unknown.calls).toEqual([]); expect(unknown.after).toEqual(unknown.before);
  }
}, 20_000);

it('W03.02 refuses cross-tenant operator authority at actual SDK, operator, export and erasure boundaries', async () => {
  const noEffects = (r: Result) => {
    expect(r.status).toBe(403); expect(r.headers['cache-control']).toBe('no-store');
    expect(r.calls).toEqual([]); expect(r.after).toEqual(r.before); expect(r.pending).toBe(0); expect(r.bodyReads).toBe(0);
  };
  for (const tenant of ['acme', 'globex']) {
    const otherToken = tenant === 'acme' ? tokens.globex : tokens.admin;
    const headers = { 'X-Tenant': tenant, Authorization: `Bearer ${otherToken}` };
    const path = (suffix: string) => `/v1/${tenant}/${suffix}`;
    const operations = [
      ['GET', 'monitor'], ['POST', 'monitor'], ['GET', 'learn/queue'],
      ['GET', 'visitors/fixture/receipts'], ['GET', 'visitors/fixture/recent'],
      ['POST', 'learn/cycle'], ['GET', 'learn/proposals'], ['POST', 'learn/proposals/fixture/apply'],
      ['POST', 'trend/rollup'], ['GET', 'ledger/batches?date=2026-09-06'], ['GET', 'ledger/erasures'],
      ['POST', 'ledger/erasures'], ['POST', 'ledger/erasures/rewrite'],
      ['GET', `ledger/${tenant}:fixture`], ['GET', `replay/${tenant}:fixture`],
      ['POST', 'learn/items/reset'], ['POST', 'learn/publish'], ['POST', 'learn/report'],
      ['POST', 'identity/resolve'], ['GET', 'identity/visitor/fixture'], ['GET', 'identity/shopper/fixture'],
      ['POST', 'identity/events'], ['POST', 'identity/erase'],
    ];
    for (const [method, suffix] of operations) {
      // A valid target site key cannot bypass the independent operator wrapper.
      noEffects(await probe({ path: path(suffix!), method, requestHost: 'shared.example',
        headers: { ...headers, 'X-SDK-Key': `synthetic-${tenant}-key` }, ...(method === 'POST' ? { body: '{' } : {}) }));
    }
    for (const method of ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']) {
      noEffects(await probe({ path: '/operator/audiences', method, requestHost: 'shared.example', headers }));
    }
    noEffects(await probe({ path: path('trend'), requestHost: 'shared.example', headers }));
    for (const doc of ['/config/reflex', '/content/catalog']) {
      noEffects(await probe({ path: doc, method: 'PUT', body: '{', requestHost: 'shared.example', headers }));
    }
  }
  for (const operatorGrants of [undefined, {}, { 'synthetic-acme-operator': ['*'] }, { 'synthetic-acme-operator': 'acme' }]) {
    const tenantManifest = JSON.stringify({ provisioned: ['acme', 'globex'], operatorGrants });
    noEffects(await probe({ path: '/v1/acme/trend', headers: credentials('admin'), tenantManifest }));
    const shopper = await probe({ path: '/v1/acme/trend?region=US-NY', tenantManifest, headers: { 'X-Tenant': 'acme', 'X-SDK-Key': 'synthetic-acme-key' } });
    expect(shopper.status).toBe(200); expect(shopper.calls).toEqual([['CACHE.get', 'trend:v2:acme:US-NY']]);
  }
});

it('W03.02 retains granted exact destinations and document revisions, rejecting selector disagreement before payload reads', async () => {
  for (const tenant of ['acme', 'globex', 'brighthour']) {
    const subject = tenant === 'globex' ? 'synthetic-globex-operator' : 'synthetic-acme-operator';
    const token = tenant === 'globex' ? tokens.globex : tokens.admin;
    const tenantManifest = JSON.stringify({ provisioned: ['acme', 'globex', 'brighthour'], operatorGrants: { [subject]: [tenant] } });
    const headers = { 'Content-Type': 'application/json', 'X-Tenant': tenant, Authorization: `Bearer ${token}` };
    const common = { tenantManifest, headers, requestHost: 'shared.example' };
    for (const kind of ['config', 'content']) {
      const scope = kind === 'config' && tenant === 'brighthour' ? 'tenant:brighthour' : tenant;
      const path = kind === 'config' ? '/config/reflex' : '/content/catalog';
      const body = kind === 'config' ? { config: { ...DEFAULT_REFLEX_CONFIG, version: 'w0302-synthetic', K: 7 } }
        : { document: { pieces: [{ id: 'w0302', customerContentId: 'synthetic', type: 'editorial', title: 'Scoped', tags: {}, slotTypes: ['hero'] }] } };
      const publication = kind === 'content';
      const result = await probe({ ...common, path, method: 'PUT', body: JSON.stringify(body), readBack: path,
        ...(publication ? { publicationTenant: tenant, headers: { ...headers, 'If-Match': '"1"', 'Idempotency-Key': '1:' + crypto.randomUUID() } } : {}) });
      expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
      const proof = JSON.parse(result.body);
      expect(proof.write).toMatchObject({ ok: true, revision: publication ? 2 : 1 });
      expect(proof.readStatus).toBe(200); expect(proof.read).toMatchObject({ scope, revision: publication ? 2 : 1, actor: subject, source: 'stored' });
      if (kind === 'config') expect(proof.read.config.K).toBe(7);
      else expect(proof.read.document.pieces[0].id).toBe('w0302');
      const prefix = `${kind === 'config' ? 'reflex' : 'content'}:config:${scope}:`;
      if (publication) {
        const authority = `config-publication/v1/${tenant}/content/`;
        expect(result.calls.filter(([op]) => op === 'STORAGE.put')).toEqual([
          ['STORAGE.put', authority + 'head.json'], ['STORAGE.put', authority + 'rev/2.json'], ['STORAGE.put', authority + 'head.json'],
        ]);
        expect(result.calls.filter(([op]) => op.startsWith('STORAGE.')).every(([, key]) => key!.startsWith(authority))).toBe(true);
        // The retained catalog registry advisory reads only this tenant's
        // Reflex document on both write and readback; it is not an R2 write.
        const registryScope = tenant === 'brighthour' ? 'tenant:brighthour' : tenant;
        expect(result.calls.filter(([op]) => !op.startsWith('STORAGE.'))).toEqual([
          ['CACHE.get', `reflex:config:${registryScope}:current`], ['CACHE.get', `reflex:config:${registryScope}:current`],
        ]);
      } else {
        expect(result.calls.filter(([op]) => op === 'CACHE.put')).toEqual([
          ['CACHE.put', prefix + 'rev:1'], ['CACHE.put', prefix + 'current'], ['CACHE.put', prefix + 'index'],
        ]);
        expect(result.calls.every(([op, key]) => op.startsWith('CACHE.') && key!.startsWith(prefix))).toBe(true);
      }
      const other = tenant === 'acme' ? 'globex' : 'acme';
      for (const query of [`scope=${other}`, `tenant=${other}`, 'scope=', `scope=${scope}&scope=${scope}`,
        `tenant=${tenant}&tenant=${tenant}`, `tenant=${tenant}&scope=${other}`,
        ...(tenant === 'brighthour' ? [`scope=${kind === 'config' ? 'brighthour' : 'tenant:brighthour'}`] : [])]) {
        const denied = await probe({ ...common, path: path + '?' + query, method: 'PUT', body: '{' });
        expect(denied.status).toBe(403); expect(denied.headers['cache-control']).toBe('no-store');
        expect(denied.calls).toEqual([]); expect(denied.bodyReads).toBe(0); expect(denied.after).toEqual(denied.before);
      }
    }
    if (tenant === 'brighthour') continue;
    const published = await probe({ ...common, path: '/operator/audiences/publish', method: 'POST',
      body: JSON.stringify({ audience: { key: 'w0302', name: 'Scoped audience', conditions: ['fixture', 'eq', true] } }),
      readBack: '/operator/audiences' });
    expect(published.status).toBe(200);
    expect(JSON.parse(published.body)).toMatchObject({ write: { success: true, notifiedUsers: 0 }, readStatus: 200,
      read: { success: true, audiences: [{ key: 'w0302', status: 'published' }] } });
    expect(published.calls).toEqual([['CACHE.put', `t:${tenant}:audience:w0302`], ['CACHE.list', `t:${tenant}:audience:`], ['CACHE.get', `t:${tenant}:audience:w0302`]]);
    const exportRead = await probe({ ...common, path: `/v1/${tenant}/ledger/batches?date=2026-09-06` });
    expect(exportRead.status).toBe(200);
    expect(JSON.parse(exportRead.body).objects).toEqual([{ key: `${tenant}/2026-09-06/13/decisions/private.ndjson`, uploaded: 'undefined' }]);
    expect(exportRead.calls).toEqual([['ACCOUNTS.audit', 'admitted'], ['STORAGE.list', `${tenant}/2026-09-06/`],
      ['STORAGE.list', `erasures/${tenant}/pending/`], ['ACCOUNTS.audit', 'result']]);
    const identityRead = await probe({ ...common, path: `/v1/${tenant}/identity/visitor/fixture` });
    expect(identityRead.status).toBe(200); expect(identityRead.calls).toEqual([['ACCOUNTS.auditOperations', 'admitted', '1'],
      ['SESSIONS.get', `t:${tenant}:identity:visitor:fixture`], ['ACCOUNTS.auditOperations', 'result', '1']]);
  }
});

it('W03.02 denies granted global account/demo administration and retains selfservice plus open demo administration', async () => {
  for (const [method, path] of [['GET', '/auth/users'], ['HEAD', '/auth/users'], ['POST', '/auth/users'],
    ['PATCH', '/auth/users/fixture'], ['DELETE', '/auth/users/fixture'], ['POST', '/auth/users/fixture/reset'],
    ['GET', '/auth/audit'], ['GET', '/operator/events/stats'], ['POST', '/operator/events/reset']]) {
    const result = await probe({ path: path!, method, headers: credentials('admin'), ...(method === 'POST' || method === 'PATCH' ? { body: '{' } : {}) });
    expect(result.status).toBe(403); expect(result.headers['cache-control']).toBe('no-store');
    expect(result.calls).toEqual([]); expect(result.bodyReads).toBe(0); expect(result.after).toEqual(result.before); expect(result.pending).toBe(0);
  }
  const me = await probe({ path: '/auth/me', headers: credentials('admin-access'), tenantManifest: JSON.stringify({ provisioned: ['acme'] }) });
  expect(me.status).toBe(200); expect(me.calls).toEqual([['ACCOUNTS.getSession', 'synthetic-account-session'],
    ['ACCOUNTS.getById', 'synthetic-acme-operator'], ['ACCOUNTS.getById', 'synthetic-acme-operator']]);
  const open = await probe({ path: '/operator/events/reset', method: 'POST', body: '{"scope":"run","value":"synthetic"}', mode: 'open' });
  expect(open.status).toBe(200); expect(open.calls.some(([operation]) => operation === 'DB.run')).toBe(true);
});

it('W03.05 enforces mounted six-operation authority, HEAD and no-effect admission versus post-effect audit uncertainty', async () => {
  const shopper = 'sh_' + 'a'.repeat(32);
  const operations: Array<{ path: string; method: string; body?: string; status: number }> = [
    { path: '/v1/acme/identity/visitor/vis-mounted-audit', method: 'GET', status: 200 },
    { path: '/v1/acme/identity/shopper/' + shopper, method: 'GET', status: 404 },
    { path: '/v1/acme/identity/resolve', method: 'POST', body: '{"accountIds":["synthetic-account"]}', status: 200 },
    { path: '/v1/acme/identity/erase', method: 'POST', body: '{"visitorId":"vis-mounted-audit"}', status: 503 },
    { path: '/v1/acme/ledger/erasures', method: 'POST', body: '{"visitorId":"vis-mounted-audit"}', status: 200 },
    { path: '/v1/acme/ledger/erasures/rewrite', method: 'POST', body: '{"maxObjects":1}', status: 200 },
    // This minimal mounted fixture has no authored acme reflex config: entry is audited, then truthfully unknown.
    { path: '/v1/acme/identity/events', method: 'POST', body: '{"rows":[{"shopperId":"invalid-shopper","action":"purchase","at":1700000000000}]}', status: 503 },
  ];
  for (const operation of operations) {
    for (const role of ['absent', 'globex']) {
      const denied = await probe({ ...operation, headers: credentials(role), ...(operation.method === 'POST' ? { body: '{' } : {}) });
      expect(denied.status).toBe(role === 'absent' ? 401 : 403); expect(denied.calls).toEqual([]); expect(denied.bodyReads).toBe(0); expect(denied.after).toEqual(denied.before);
    }
    const refused = await probe({ ...operation, headers: credentials('admin'), subjectAuditFailure: 'admitted', subjectOperations: true });
    expect(refused.status).toBe(503); expect(refused.calls).toEqual([['ACCOUNTS.auditOperations', 'admitted', '1']]); expect(refused.after).toEqual(refused.before);
    const allowed = await probe({ ...operation, headers: credentials('admin'), subjectOperations: true });
    expect(allowed.status, operation.path).toBe(operation.status);
    expect(allowed.calls[0]).toEqual(['ACCOUNTS.auditOperations', 'admitted', '1']);
    expect(allowed.calls.at(-1)).toEqual(['ACCOUNTS.auditOperations', 'result', '1']);
    expect(allowed.headers['cache-control']).toBe('no-store');
  }
  const head = await probe({ path: operations[0]!.path, method: 'HEAD', headers: credentials('admin') });
  expect(head.status).toBe(200); expect(head.body).toBe('');
  expect(head.calls.filter(([op]) => op === 'ACCOUNTS.auditOperations')).toHaveLength(2);
  const mutation = await probe({ ...operations[4]!, headers: credentials('admin'), subjectAuditFailure: 'result', subjectOperations: true });
  expect(mutation.status).toBe(503); expect(mutation.after).not.toEqual(mutation.before);
  expect(JSON.parse(mutation.body)).toMatchObject({ operationMayHaveApplied: true, outcome: 'outcome_unknown', auditStatus: 'unconfirmed', requestId: expect.any(String) });
  expect(mutation.body).not.toContain('vis-mounted-audit'); expect(mutation.body).not.toContain('PRIVATE');
  const open = await probe({ ...operations[2]!, headers: credentials('admin'), mode: 'open', auditSalt: '' });
  expect(open.status).toBe(200); expect(open.calls).toEqual([]);
});

it('W03.04 enforces mounted audit admission, result and tenant-admin readback including HEAD and open-mode boundaries', async () => {
  const path = '/v1/acme/ledger/batches?date=2026-09-06', headers = credentials('admin');
  const result = await probe({ path, headers, readBack: '/v1/acme/audit?limit=10' });
  expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
  const proof = JSON.parse(result.body);
  expect(proof.readStatus).toBe(200); expect(proof.read.tenant).toBe('acme');
  expect(proof.read.entries.map((entry: { detail: { operation: string; phase: string } }) => [entry.detail.operation, entry.detail.phase]))
    .toEqual([['audit', 'admitted'], ['batches', 'result'], ['batches', 'admitted']]);
  expect(result.calls.filter(([operation]) => operation === 'ACCOUNTS.audit')).toHaveLength(4);
  expect(result.after).toEqual(result.before);
  for (const subjectAuditFailure of ['admitted', 'result'] as const) {
    const refused = await probe({ path, headers, subjectAuditFailure });
    expect(refused.status).toBe(503); expect(refused.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(refused.body)).toEqual({ ok: false, error: 'Subject audit unavailable' });
    expect(refused.calls.filter(([operation]) => operation === 'STORAGE.list')).toHaveLength(subjectAuditFailure === 'admitted' ? 0 : 2);
    expect(refused.after).toEqual(refused.before);
  }
  const head = await probe({ path, headers, method: 'HEAD' });
  expect(head.status).toBe(200); expect(head.body).toBe('');
  expect(head.calls.filter(([operation]) => operation === 'ACCOUNTS.audit')).toEqual([['ACCOUNTS.audit', 'admitted'], ['ACCOUNTS.audit', 'result']]);
  const noKey = await probe({ path, headers, auditSalt: '' });
  expect(noKey.status).toBe(503); expect(noKey.calls).toEqual([]);
  for (const mode of ['enforced', 'open']) {
    for (const role of ['absent', 'operator', 'globex']) {
      const denied = await probe({ path: '/v1/acme/audit', mode, headers: credentials(role) });
      expect(denied.status).toBe(role === 'absent' ? 401 : 403); expect(denied.calls).toEqual([]); expect(denied.after).toEqual(denied.before);
    }
    const allowed = await probe({ path: '/v1/acme/audit', mode, headers });
    expect(allowed.status).toBe(200); expect(allowed.calls).toEqual([['ACCOUNTS.audit', 'admitted'], ['ACCOUNTS.subjectAudit', 'acme'], ['ACCOUNTS.audit', 'result']]);
  }
  const open = await probe({ path, headers, mode: 'open', auditSalt: '' });
  expect(open.status).toBe(200); expect(open.calls.some(([operation]) => operation === 'ACCOUNTS.audit')).toBe(false);
  const failedRead = await probe({ path: '/v1/acme/audit', headers, subjectAuditFailure: 'read' });
  expect(failedRead.status).toBe(503); expect(failedRead.body).not.toContain('PRIVATE');
  expect(failedRead.calls).toEqual([['ACCOUNTS.audit', 'admitted'], ['ACCOUNTS.subjectAudit', 'acme'], ['ACCOUNTS.audit', 'result']]);
});

it('W37.08 answers shared-host preflight metadata before tenant resolution while actual requests remain strict', async () => {
  for (const Origin of ['https://shop.acme.example', 'https://unlisted.example']) {
    for (const tenantManifest of [JSON.stringify({ provisioned: ['acme', 'globex'] }), 'PRIVATE_INVALID_MANIFEST']) {
      const response = await probe({ path: '/realtime/action', method: 'OPTIONS', requestHost: 'shared.example', tenantManifest,
        headers: { Origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-SDK-Key,X-Tenant,X-Shopper-Session,Content-Type' } });
      expect(response.status).toBe(204); expect(response.body).toBe('');
      expect(response.headers['access-control-allow-origin']).toBe(Origin === 'https://shop.acme.example' ? Origin : undefined);
      expect(response.headers['access-control-allow-headers'].toLowerCase().split(',')).toEqual(expect.arrayContaining(['x-sdk-key', 'x-tenant', 'x-shopper-session']));
      expect(response.calls).toEqual([]); expect(response.after).toEqual(response.before); expect(response.pending).toBe(0);
    }
  }
  const actual = await probe({ path: '/realtime/action', method: 'POST', requestHost: 'shared.example', tenantManifest: 'PRIVATE_INVALID_MANIFEST',
    headers: { Origin: 'https://shop.acme.example', 'X-Tenant': 'acme', 'X-SDK-Key': 'synthetic-acme-key' } });
  expect(actual.status).toBe(503); expect(actual.headers['cache-control']).toBe('no-store');
  expect(actual.calls).toEqual([]); expect(actual.after).toEqual(actual.before);
});

it('W37.08 authorizes both nondefault keys before generic reads, writes and upgrades with valid target capabilities', async () => {
  for (const tenant of ['acme', 'globex']) {
    const other = tenant === 'acme' ? 'globex' : 'acme';
    const shopperCapability = { tenant, subject: 'vis-00000000-0000-4000-8000-000000000008', sessionId: 'w3708-session' };
    const destination = `t:${tenant}:${shopperCapability.subject}`;
    const requests: Probe[] = [
      { path: `/realtime/reflex?userId=${shopperCapability.subject}` },
      { path: '/realtime/action', method: 'POST', body: JSON.stringify({ type: 'page_view', userId: shopperCapability.subject,
        sessionId: shopperCapability.sessionId, data: {}, source: 'sdk' }) },
      { path: `/realtime/ws?tenant=${tenant}&userId=${shopperCapability.subject}&sessionId=${shopperCapability.sessionId}&sdkKey=synthetic-${other}-key`,
        headers: { Upgrade: 'websocket' } },
    ];
    for (const request of requests) {
      const shared = { ...request, requestHost: 'shared.example', shopperCapability };
      const denied = await probe({ ...shared, headers: { 'X-Tenant': tenant,
        ...(request.headers?.Upgrade ? {} : { 'X-SDK-Key': `synthetic-${other}-key` }), ...request.headers } });
      expect(denied.status).toBe(403); expect(denied.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(denied.body)).toEqual({ ok: false, error: 'SDK key is for a different tenant' });
      expect(denied.calls).toEqual([]); expect(denied.after).toEqual(denied.before); expect(denied.pending).toBe(0);
      if (request.headers?.Upgrade) continue; // Native positive upgrades remain in the both-host W04.02 fixture.
      const accepted = await probe({ ...shared, headers: { 'X-Tenant': tenant, 'X-SDK-Key': `synthetic-${tenant}-key` } });
      expect(accepted.status).toBe(200); expect(JSON.parse(accepted.body)).toMatchObject({ destination });
      expect(accepted.calls).toEqual([['SHOPPER_REFLEX.idFromName', destination], ['SHOPPER_REFLEX.get', destination], ['SHOPPER_REFLEX.fetch', destination],
        ['SHOPPER_REFLEX.idFromName', destination], ['SHOPPER_REFLEX.idFromName', destination]]);
      if (request.method === 'POST') {
        expect((accepted.after as { state: unknown[] }).state).toContainEqual([destination, { subject: shopperCapability.subject, eventType: 'page_view' }]);
        expect(accepted.after).not.toEqual(accepted.before);
      } else expect(accepted.after).toEqual(accepted.before);
    }
  }
});

it('W37.09 refuses wildcard grants before tenant effects while retaining explicit named grants', async () => {
  const sdkKeys = '*:synthetic-wide|synthetic-mixed,acme:synthetic-acme-key|synthetic-mixed|synthetic-both,globex:synthetic-globex-key|synthetic-both';
  for (const tenant of ['acme', 'globex']) {
    const shopperCapability = { tenant, subject: 'vis-00000000-0000-4000-8000-000000000009', sessionId: 'w3709-session' };
    const destination = `t:${tenant}:${shopperCapability.subject}`;
    for (const kind of ['read', 'write', 'upgrade']) {
      for (const key of ['synthetic-wide', 'synthetic-mixed', 'synthetic-both']) {
        const upgrade = kind === 'upgrade';
        const accepted = key === 'synthetic-both' || (key === 'synthetic-mixed' && tenant === 'acme');
        if (upgrade && accepted) continue; // Existing both-host fixture exercises actual native named-key upgrades.
        const request: Probe = { sdkKeys, shopperCapability, requestHost: 'shared.example',
          path: upgrade ? `/realtime/ws?tenant=${tenant}&userId=${shopperCapability.subject}&sessionId=${shopperCapability.sessionId}&sdkKey=${key}`
            : kind === 'write' ? '/realtime/action' : `/realtime/reflex?userId=${shopperCapability.subject}`,
          headers: upgrade ? { Upgrade: 'websocket' } : { 'X-Tenant': tenant, 'X-SDK-Key': key },
          ...(kind === 'write' ? { method: 'POST', body: JSON.stringify({ type: 'page_view', userId: shopperCapability.subject,
            sessionId: shopperCapability.sessionId, data: {}, source: 'sdk' }) } : {}),
        };
        const result = await probe(request);
        expect(result.status).toBe(accepted ? 200 : 403);
        if (!accepted) {
          expect(JSON.parse(result.body)).toEqual({ ok: false, error: 'SDK key is for a different tenant' });
          expect(result.headers['cache-control']).toBe('no-store'); expect(result.calls).toEqual([]);
          expect(result.after).toEqual(result.before); expect(result.pending).toBe(0);
        } else {
          expect(JSON.parse(result.body)).toMatchObject({ destination });
          expect(result.calls).toEqual([['SHOPPER_REFLEX.idFromName', destination], ['SHOPPER_REFLEX.get', destination], ['SHOPPER_REFLEX.fetch', destination]]);
          if (kind === 'write') expect((result.after as { state: unknown[] }).state).toContainEqual([destination, { subject: shopperCapability.subject, eventType: 'page_view' }]);
          else expect(result.after).toEqual(result.before);
        }
      }
    }
  }
});

it('W37.07 requires provisioned agreeing request selectors before tenant work and discovers only the manifest', async () => {
  for (const tenant of ['acme', 'globex']) {
    for (const requestHost of [tenant + '.example', 'shared.example']) {
      const result = await probe({ path: `/v1/${tenant}/trend?region=US-NY`, requestHost,
        headers: { 'X-SDK-Key': `synthetic-${tenant}-key`, 'X-Tenant': tenant } });
      expect(result.status).toBe(200);
      expect(result.calls).toEqual((tenant === 'acme' ? ['US-NY'] : ['US-NY', 'US', '*']).map(region => ['CACHE.get', `trend:v2:${tenant}:${region}`]));
      expect(result.after).toEqual(result.before);
    }
  }
  const selectors: Probe[] = [
    { path: '/v1/globex/trend' },
    { path: '/v1/acme/trend', headers: { 'X-Tenant': 'globex' } },
    ...['unknown', 'coach', 'ACME', '%20acme', 'acme%2fglobex', '%GG', '%2561cme'].map(tenant => ({ path: `/v1/${tenant}/brands` })),
    { path: '/realtime/reflex', headers: { 'X-Tenant': 'unknown' } },
    { path: '/realtime/reflex', headers: { 'X-Tenant': '' } },
    { path: '/api-info', requestHost: 'shared.example' },
    { path: '/realtime/ws?tenant=globex', headers: { Upgrade: 'websocket', 'X-Tenant': 'acme' } },
    { path: '/realtime/ws?tenant=globex', headers: { Upgrade: 'websocket' } },
    { path: '/realtime/ws?tenant=acme&tenant=globex', headers: { Upgrade: 'websocket' } },
  ];
  for (const request of selectors) {
    const result = await probe({ ...request, headers: { 'X-SDK-Key': 'synthetic-acme-key', ...request.headers } });
    expect(result.status, request.path).toBe(403);
    expect(JSON.parse(result.body)).toEqual({ ok: false, error: 'Tenant unavailable' });
    expect(result.headers['cache-control']).toBe('no-store'); expect(result.calls).toEqual([]);
    expect(result.after).toEqual(result.before); expect(result.logs).toEqual([]); expect(result.pending).toBe(0);
  }
  const aliases = await probe({ path: '/%761/%61cme/brands', headers: { ...credentials('admin'), 'X-SDK-Key': 'synthetic-acme-key' } });
  expect(aliases.status).toBe(200);
  expect(JSON.parse(aliases.body).brands).toEqual([{ id: 'acme', default: true }]);
  const added = await probe({ path: '/v1/acme/brands', headers: { ...credentials('admin'), 'X-SDK-Key': 'synthetic-acme-key' },
    tenantManifest: JSON.stringify({ provisioned: ['acme', 'globex', 'initech', 'acme'], hosts: { 'acme.example': 'acme' },
      operatorGrants: { 'synthetic-acme-operator': ['acme', 'globex', 'initech'] } }) });
  expect(added.status).toBe(200);
  expect(JSON.parse(added.body).brands).toEqual([{ id: 'acme', default: true }, { id: 'globex', default: false }, { id: 'initech', default: false }]);
  const legacy = await probe({ path: '/api-info', absentManifest: true }); expect(legacy.status).toBe(200);
  const shopper = await probe({ path: '/realtime/reflex', headers: { 'X-SDK-Key': 'synthetic-acme-key' } });
  expect(shopper.status).toBe(401); expect(shopper.calls).toEqual([]);
});

it('W37.07 invalid explicit registries deny Hono and all known crons without tenant work', async () => {
  const invalid: unknown[] = ['', ' ', null, 42, 'PRIVATE_INVALID_MANIFEST', '{}', JSON.stringify({ provisioned: [] }),
    JSON.stringify({ provisioned: ['acme', 'INVALID'] }), JSON.stringify({ provisioned: ['acme'], hosts: { 'acme.example': 'globex' } }),
    JSON.stringify({ provisioned: ['acme', 'globex'], hosts: { 'ACME.example': 'acme', 'acme.example': 'globex' } })];
  for (const tenantManifest of invalid) {
    const result = await probe({ path: '/v1/acme/brands', tenantManifest, headers: { 'X-SDK-Key': 'synthetic-acme-key' } });
    expect(result.status).toBe(503); expect(result.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(result.body)).toEqual({ ok: false, error: 'Tenant configuration unavailable' });
    expect(result.calls).toEqual([]); expect(result.after).toEqual(result.before); expect(result.logs).toEqual([]);
    for (const scheduled of ['*/5 * * * *', '0 3 * * *', '0 * * * *']) {
      const job = await probe({ path: '/', tenantManifest, scheduled });
      expect(job.calls).toEqual([]); expect(job.pending).toBe(0); expect(job.after).toEqual(job.before);
      expect(job.envAccess).toEqual(['get:DEPLOYMENT_PROFILE', 'get:TENANTS']); expect(job.logs).toEqual(['Scheduled tenant configuration unavailable']);
    }
  }
  const unknown = await probe({ path: '/', tenantManifest: 'PRIVATE_INVALID_MANIFEST', scheduled: 'PRIVATE_UNKNOWN_CRON' });
  expect(unknown.calls).toEqual([]); expect(unknown.envAccess).toEqual(['get:DEPLOYMENT_PROFILE']); expect(unknown.pending).toBe(0);
  expect(unknown.logs).toEqual(['Unknown scheduled event']);
});

it('W37.07 preserves pending ledger erasure through registry denial then resumes only the corrected tenant', async () => {
  const result = await probe({ path: '/', scheduled: '0 3 * * *', tenantManifest: 'PRIVATE_INVALID_MANIFEST', recoverErasure: true });
  const { denied } = JSON.parse(result.body);
  expect(denied).toEqual({ calls: [], envAccess: ['get:DEPLOYMENT_PROFILE', 'get:TENANTS'], logs: ['Scheduled tenant configuration unavailable'], after: result.before, pending: 0 });
  expect(result.pending).toBe(2); expect(result.envAccess.filter(key => key === 'get:TENANTS')).toHaveLength(1);
  const before = (result.before as { storage: [string, string][] }).storage;
  const after = (result.after as { storage: [string, string][] }).storage;
  const row = before.find(([key]) => key.startsWith('acme/') && key.endsWith('erasure.ndjson'))!;
  expect(after.some(([key]) => key === row[0])).toBe(false);
  expect(result.calls.filter(([op, key]) => op === 'STORAGE.delete' && key === row[0])).toHaveLength(1);
  expect(JSON.parse(after.find(([key]) => key === 'erasures/acme/pending/same-subject.json')![1])).toMatchObject({
    tenant: 'acme', visitor_id: 'same-subject', rows_removed: 1, objects_deleted: 1, window_days: 1, rewritten_at: expect.any(Number),
  });
  for (const entry of before.filter(([key]) => key.startsWith('globex/') || key.startsWith('erasures/globex/'))) expect(after).toContainEqual(entry);
  expect(result.calls.some(([, key]) => key?.includes('globex') || key?.includes('coach'))).toBe(false);
  expect(result.logs).toContain('erasure rewrite; rows/objects/days/retired/pending/more 1 1 2 1 0 0');
});

it('W07.04 keeps actual scheduled jobs/waitUntil and numeric summaries without tenant/error/cron payloads', async () => {
  const cases = [
    { cron: '*/5 * * * *', pending: 4 },
    { cron: '0 3 * * *', pending: 4 },
    { cron: '0 * * * *', pending: 2 },
  ];
  for (const { cron, pending } of cases) {
    const r = await probe({ path: '/', scheduled: cron });
    expect(r.status).toBe(200); expect(r.pending).toBe(pending);
    expect(r.envAccess.filter(key => key === 'get:TENANTS').length).toBeGreaterThan(0); // Policy admission revalidates canonical configuration.
    expect(r.calls.length).toBeGreaterThan(0);
    expect(r.logs.join(' ')).not.toMatch(/acme|globex|coach|W0[17]0[124]_|PRIVATE|TypeError|first is not a function/);
    if (cron === '*/5 * * * *') {
      expect(r.calls.filter(([op]) => op === 'ANALYTICS.writeDataPoint')).toHaveLength(0);
      expect(r.calls.filter(([op, key]) => op === 'CACHE.put' && key?.startsWith('monitor:'))).toEqual(expect.arrayContaining([
        ['CACHE.put', 'monitor:acme:recovery'], ['CACHE.put', 'monitor:globex:recovery'],
      ]));
      expect(r.calls.filter(([op, key]) => op === 'CACHE.put' && key?.startsWith('monitor:'))).toHaveLength(2);
      for (const tenant of ['acme', 'globex']) {
        expect(r.calls.filter(([op, key]) => op === 'LEARN_STATS.idFromName' && key === `${tenant}:${tenant}:monitor-probe`)).toHaveLength(1);
        expect(r.calls.some(([op, key]) => op === 'STORAGE.list' && key?.startsWith(`aggregates/${tenant}/`))).toBe(true);
      }
      expect(r.calls.some(([, key]) => key?.includes('coach'))).toBe(false);
      expect(r.logs.filter(line => line.startsWith('monitor result; ok/decisionMs/problems '))).toHaveLength(2);
    } else if (cron === '0 3 * * *') {
      expect(r.logs.some(line => line.includes('autonomy cycle'))).toBe(false);
      expect(r.calls.some(([, key]) => key?.startsWith('proposals:config:') || key?.startsWith('slots:config:'))).toBe(false);
      expect(r.logs.filter(line => line.startsWith('day report; decisions/outcomes/unfolded/truncated '))).toHaveLength(2);
      expect(r.calls.filter(([op, key]) => op === 'STORAGE.get' && key?.startsWith('erasures/') && key.endsWith('/rewrite.json')).sort()).toEqual([
        ...Array.from({ length: 5 }, () => ['STORAGE.get', 'erasures/acme/rewrite.json']),
        ...Array.from({ length: 5 }, () => ['STORAGE.get', 'erasures/globex/rewrite.json']),
      ]); // W06 CAS admission/rechecks plus the independent tagged-retention phase.
      for (const tenant of ['acme', 'globex']) expect(r.calls.filter(([op, key]) => op === 'STORAGE.put' && key?.startsWith('reports/' + tenant + '/' + tenant + '/'))).toHaveLength(1);
      expect(r.calls.some(([op]) => op === 'STORAGE.put')).toBe(true);
    } else {
      expect([...r.logs].sort()).toEqual(['trend rollup; regions/countries 0 0', 'trend rollup; regions/countries 1 1']);
      expect(r.calls.filter(([op]) => op === 'CACHE.put')).toEqual(expect.arrayContaining([
        ['CACHE.put', 'trend:v2:acme:US'], ['CACHE.put', 'trend:v2:acme:*'],
        ['CACHE.put', 'trend:v2:globex:*'],
      ]));
      expect(r.calls.filter(([op]) => op === 'CACHE.put')).toHaveLength(3);
      expect(r.calls.some(([, key]) => key?.includes('obsolete') || key?.startsWith('trend:acme:'))).toBe(false);
      const before = (r.before as { cache: [string, string][] }).cache;
      const after = (r.after as { cache: [string, string][] }).cache;
      expect(after).toContainEqual(before.find(([key]) => key === 'trend:acme:US-NY'));
      expect(JSON.parse(after.find(([key]) => key === 'trend:v2:acme:*')![1])).toMatchObject({ generation: 2, events: 50, r: { interest: { fixture: 5 } } });
    }
  }
  const malformed = await probe({ path: '/', scheduled: '0 3 * * *', malformedAggregate: true });
  expect(malformed.status).toBe(200); expect(malformed.pending).toBe(4);
  const before = (malformed.before as { storage: [string, string][] }).storage;
  const after = (malformed.after as { storage: [string, string][] }).storage;
  const originalHour = before.find(([key]) => key.startsWith('aggregates/acme/'))!;
  expect(after).toContainEqual(originalHour);
  expect(JSON.parse(originalHour[1]).brands.acme).toMatchObject({
    decisions: 'W0704_PRIVATE_DECISIONS', outcomes: 'W0704_PRIVATE_OUTCOMES',
  });
  // Current aggregate validation rejects malformed hours before publication.
  expect(after.some(([key]) => key.startsWith('reports/acme/acme/'))).toBe(false);
  expect(malformed.calls.some(([operation, key]) => operation === 'STORAGE.put' && key!.startsWith('reports/acme/acme/'))).toBe(false);
  expect(malformed.logs).toContain('day report failed');
  expect(malformed.logs.join(' ')).not.toMatch(/W0704_PRIVATE|acme|globex|coach/);
  const failed = await probe({ path: '/', scheduled: '*/5 * * * *', failScheduled: true });
  expect(failed.status).toBe(200); expect(failed.pending).toBe(4);
  expect(failed.logs.filter(line => line === 'hourly fold failed')).toHaveLength(2);
  expect(failed.logs.join(' ')).not.toMatch(/W0704_PRIVATE_FAILURE|acme|globex|coach/);
  const unknown = await probe({ path: '/', scheduled: 'W0704_PRIVATE_CRON' });
  expect(unknown.logs).toEqual(['Unknown scheduled event']); expect(unknown.calls).toEqual([]); expect(unknown.pending).toBe(0);
});
