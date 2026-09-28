// src/units/W34/LEDGER.unit.test.ts
//
// W34 — "External-model policy: off makes zero calls".
//
// AUTHORITY (docs/remediation/delivery-control/program.json, ticket W34, quoting
// document 35 §5 row W34, line 436): "Deployment-enforced external-model policy
// with off making zero calls. A service name does not waive
// no-runtime-inference. Restrict authorized destinations/data/candidates/budgets
// where any external seam is accepted, and deliver controlled immutable
// offline-table publication if promised. Verify fallback, cancellation where
// supported, replay and privacy."
//
// WITNESSES
//   · document 35 §2 F30 — "Configuration can send shopper context and an
//     unfiltered catalog to a runtime URL/model … A deployment-enforced off
//     switch, tested to make zero calls, is containment. Restricting a name to
//     'service' does not prove no runtime inference."
//   · HANDOFF-2026-09-18 §6 W34 row — "Preserve off→zero calls and no runtime
//     inference." Decision D1 (owner, 2026-09-24): the policy stays off; a
//     learned runtime model or an offline table would be new scope.
//
// CRITERIA SPECIFIED HERE: E1–E5. LG1 is the legacy W34.01 describe block of
// src/content/consent.test.ts (:1059), which the ticket's acceptance command
// runs as its second command. It proves E1 for the content decision on the
// object host (every kind) and replay for the table kind only; the sort, the
// session host and replay for every kind are specified here.
//
// RULED MEMBER: the deployment setting is named `EXTERNAL_MODEL_POLICY`
// (declared in src/types/env.ts and in every `vars` table of wrangler.toml).
// `off` is its only deployed value and the only value in scope (D1); any other
// value, and absence, is off.
//
// ONE WORLD: every learn document carrying an `external` model below is
// published as a RETAINED value (`retainedValue: true`), because E3 refuses
// such a document as a new write. The legacy W34.01 fixture is corrected the
// same way in this ticket's commit (STALE arrangement: envWith's fifth
// parameter, consent.test.ts:103), so E3's refusal may live in LEARN_KIND's
// new-document validator (every E3 door calls it) and LG1 still passes.

import { readFileSync } from 'node:fs';

import { afterEach, describe, it, expect, vi, type Mock } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';
import { parse as parseToml } from 'smol-toml';

import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotCatalog } from '@/content/types';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { decisionRoutes } from '@/routes/decisions';
import { identityRoutes } from '@/routes/identity';
import realtimeRoutes from '@/routes/realtime';
import { contentRoutes } from '@/routes/content';
import { configRoutes } from '@/routes/config';
import { sortRoutes } from '@/routes/sort';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { issueSessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { serveContentDecisions } from '@/content/service';
import { CONSENT_LIFETIME_MS } from '@/content/consent';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { replayDecision } from '@/learn/replay';
import { invalidateExternalCache, referenceScore, extTableKey, type ExternalRequest } from '@/learn/external';
import type { RetentionCategory, RetentionPolicy } from '@/retention';
import type { Env } from '@/types/env';

// ===========================================================================
// The tenant's published fixture: the Coach taxonomy the kit documents.
// ===========================================================================

const TENANT = 'coach';
const OPERATOR_SECRET = 'w34-ledger-synthetic-operator-signing-material';
const IDENTITY_SECRET = 'w34-ledger-identity-assertion-material';
const ORIGIN = 'https://synthetic.invalid';
const HOSTS = ['session', 'do'] as const;
const DISABLED = 'external scoring disabled by deployment policy';

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...over,
});
const PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening-edit', { tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] } }),
  piece('cnt-rogue-work-edit', { tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] } }),
];
const SLOTS: SlotCatalog = { version: 'w34-slots', pages: { home: [{ slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } }] } };
/** Every external kind the stored schema admitted, each with a positive-weight term (consent.test.ts:1062-1067). */
const EXTERNALS: NonNullable<LearnConfig['external']>[] = [
  { kind: 'service', ref: 'https://model.synthetic.invalid/score', timeoutMs: 50, fallback: 'omit' },
  { kind: 'service', ref: 'MODEL', timeoutMs: 50, fallback: 'omit' },
  { kind: 'workers_ai', ref: 'synthetic-model', timeoutMs: 50, fallback: 'omit' },
  { kind: 'table', ref: 'synthetic-table', timeoutMs: 50, fallback: 'omit' },
];
const learnWith = (external?: NonNullable<LearnConfig['external']>) => ({
  holdout: { share: 0, salt: 'w34', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  ...(external ? { external } : {}),
  slots: { hero: { reward: 'click', ...(external ? { external: { weight: 0.5 } } : {}) } },
});

// ===========================================================================
// Stores and the mounted application, in process, the way src/index.ts mounts
// it (harness pattern of src/units/W21/B3.unit.test.ts; nothing imported from it).
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  reads: string[] = [];
  async get(key: string, type?: string) {
    this.reads.push(key);
    const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) as unknown : v;
  }
  async getWithMetadata(key: string, type?: string) { return { value: await this.get(key, type), metadata: null }; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}
class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  reads: string[] = [];
  async get(key: string, options?: R2GetOptions) {
    this.reads.push(key);
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

const fixturePolicy: RetentionPolicy = { id: 'w34-ledger-fixture-policy', revision: 1, durationMs: 365 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
const retention = () => JSON.stringify({ version: 1, tenants: { [TENANT]:
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy> } });

/** Every egress the external seam could use, observed. */
interface Egress { fetch: Mock<unknown[], Promise<Response>>; model: Mock<unknown[], unknown>; ai: Mock<unknown[], unknown>; policyReads: number }
interface Mounted {
  env: Env; storage: UnitR2; cache: UnitKV; sessions: UnitKV; queued: unknown[]; egress: Egress;
  fetch: (request: Request) => Promise<Response>; drain: () => Promise<void>; operatorToken: string;
}

/** `policy`: the value the deployment setting answers; `absent` leaves it undeclared. */
async function mount(host: 'session' | 'do', learn: unknown, policy: string | 'absent' = 'off', authMode?: 'open' | 'enforced'): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache(); invalidateExternalCache();
  const pending: Promise<unknown>[] = [], queued: unknown[] = [];
  const storage = new UnitR2(), cache = new UnitKV(), sessions = new UnitKV();
  const objects = new Map<string, ShopperReflex>();
  const stub = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('{}') }) };
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
    REFLEX_HOST: host, STORAGE: storage, ...(authMode ? { AUTH_MODE: authMode } : {}),
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:${IDENTITY_SECRET}`,
    TENANTS: JSON.stringify({ provisioned: [TENANT, 'meridian'], operatorGrants: { ops: [TENANT], elsewhere: ['meridian'] } }),
    PERSONALIZATION_WEBSOCKET: stub, DECISION_RING: stub, LEARN_STATS: stub,
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) }) },
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); } },
    RETENTION: retention(),
  } as unknown as Env;
  // The seam's egress: a URL model (global fetch), a named service binding and the Workers AI binding.
  const answer = { version: 'synthetic-v1', scores: { 'cnt-rogue-work-edit': 1 } };
  const egress: Egress = {
    fetch: vi.fn<unknown[], Promise<Response>>(async () => Response.json(answer)),
    model: vi.fn<unknown[], unknown>(() => ({ fetch: async () => Response.json(answer) })),
    ai: vi.fn<unknown[], unknown>(() => ({ run: async () => answer })),
    policyReads: 0,
  };
  vi.stubGlobal('fetch', egress.fetch);
  Object.defineProperties(env, {
    MODEL: { get: egress.model, enumerable: true, configurable: true },
    AI: { get: egress.ai, enumerable: true, configurable: true },
    ...(policy === 'absent' ? {} : { EXTERNAL_MODEL_POLICY: { get: () => { egress.policyReads += 1; return policy; }, enumerable: true, configurable: true } }),
  });
  // A published table sits in KV under the key the table kind reads (src/learn/external.ts:35).
  cache.data.set(extTableKey(TENANT, TENANT), JSON.stringify(answer));
  env.SHOPPER_REFLEX = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let shopper = objects.get(name);
      if (!shopper) {
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
                else for (const [key, item] of Object.entries(values)) candidate.set(key, structuredClone(item));
              },
              deleteAlarm: async () => { deleteAlarm = true; }, setAlarm: async (at: number) => { nextAlarm = at; },
            } as unknown as DurableObjectTransaction;
            const result = await run(tx);
            data.clear(); for (const [key, value] of candidate) data.set(key, value);
            if (deleteAlarm) alarms.length = 0;
            if (nextAlarm !== undefined) alarms.push(nextAlarm);
            return result;
          },
          deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
          setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null,
        } } as unknown as DurableObjectState;
        shopper = new ShopperReflex(state, env); objects.set(name, shopper);
      }
      return shopper.fetch(new Request(input, init));
    } }),
  } as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/config', configRoutes);
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/sort', sortRoutes);
  app.route('/v1', decisionRoutes);
  app.route('/v1', identityRoutes);

  const operatorToken = await operatorCredential('ops');
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT, retained = false): PublicationBaseline =>
    ({ kind, scope, ...(retained ? { retainedValue: true as const } : {}), revision: { revision: 1, at: 1, actor: 'w34-ledger-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, { version: 'w34-catalogue', pieces: PIECES }),
    baseline(SLOTS_KIND, SLOTS),
    // RETAINED: a stored document from before E3, the only way one carrying `external` can exist.
    baseline(LEARN_KIND, learn, TENANT, true),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
  // Counters start after the fixture is in place.
  egress.fetch.mockClear(); egress.model.mockClear(); egress.ai.mockClear(); egress.policyReads = 0; cache.reads.length = 0;

  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env, {
    waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {},
  } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, storage, cache, sessions, queued, egress, fetch: fetchOne, drain, operatorToken };
}

async function operatorCredential(subject: string): Promise<string> {
  return new jose.SignJWT({ sub: subject, type: 'service' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
    .setIssuer('i').setAudience('a').setExpirationTime('2h').sign(new TextEncoder().encode(OPERATOR_SECRET));
}

/** A consenting anonymous shopper, through the routes the SDK calls. */
async function shopper(m: Mounted, index: number) {
  const visitor = `vis-00000034-0000-4000-8000-${String(index).padStart(12, '0')}`, sessionId = `s-${visitor.slice(4)}`;
  const grant = await issueSessionCapability(m.env, { tenant: TENANT, subject: visitor, sessionId, kind: 'anonymous' });
  const call = (path: string, body?: unknown) => m.fetch(new Request(`${ORIGIN}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const consent = await call(`/realtime/session/${sessionId}/preferences`, {
    trackingConsent: true, personalizationEnabled: true,
    choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp },
  });
  expect(consent.status, `fixture: her explicit consent choice is accepted: ${await consent.clone().text()}`).toBe(200);
  await m.drain();
  return { visitor, sessionId, call, grant };
}

/**
 * The served decision records, from the service the snapshot route runs
 * (src/routes/decisions.ts:571), inside the owner operation every shopper route
 * runs in. The snapshot answer itself carries no records (a render offer
 * captures them later), and the operator replay route runs replayDecision on a
 * stored record (src/routes/decisions.ts:856-868).
 */
async function servedRecords(m: Mounted, s: Awaited<ReturnType<typeof shopper>>): Promise<DecisionRecord[]> {
  const now = Date.now(), owner = {};
  const choice = { tracking: true, personalization: true, instruction: { version: 1 as const, tenant: TENANT, subject: s.visitor, revision: 'w34-fixture-choice',
    tracking: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS }, personalization: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS } } };
  return runOwnerOperation(owner, m.env, async () => {
    admitOwnerPrincipal(owner, s.grant);
    const out = await serveContentDecisions(m.env, { tenant: TENANT, page: 'home', visitorId: s.visitor, sessionId: s.sessionId, channel: 'direct',
      cf: null, cookieHeader: null, stateTenant: TENANT, principal: s.grant, capability: s.grant.capability });
    await out.afterResponse;
    return out.records;
  }, m.sessions as never, undefined, async () => choice as never);
}

function expectZeroEgress(m: Mounted, label: string) {
  expect(m.egress.fetch.mock.calls, `${label}: zero fetches to a URL model`).toEqual([]);
  expect(m.egress.model.mock.calls, `${label}: zero acquisitions of the named service binding`).toEqual([]);
  expect(m.egress.ai.mock.calls, `${label}: zero acquisitions of the Workers AI binding`).toEqual([]);
  expect(m.cache.reads.filter(key => key.startsWith('ext:')), `${label}: no ext: key is read`).toEqual([]);
  expect(m.sessions.reads.filter(key => key.startsWith('ext:')), `${label}: no ext: key is read from the session store`).toEqual([]);
  expect(m.storage.reads.filter(key => key.startsWith('ext:') || key.includes('/ext:')), `${label}: no ext: object is read`).toEqual([]);
}

afterEach(() => { vi.unstubAllGlobals(); });

// =============================================================================
// unit:W34.E1 — with the policy off, a decision, a sort and a replay make zero external calls, on both hosts
// =============================================================================

describe('unit:W34.E1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a content decision, a product sort and the replay make zero fetch, binding or AI calls and read no ext: key, for every stored external kind`, async () => {
      for (const [index, external] of EXTERNALS.entries()) {
        const label = `${host} / ${external.kind} ${external.ref}`;
        const m = await mount(host, learnWith(external), 'off');
        const s = await shopper(m, index + 1);

        const decision = await s.call(`/v1/${TENANT}/decisions/snapshot?page=home`);
        expect(decision.status, `${label}: ${await decision.clone().text()}`).toBe(200);
        const body = await decision.json() as { arm: string; sources: { external: unknown } };
        await m.drain();
        expect(body.arm, `${label}: fixture — the personalized arm, where the term would apply`).toBe('personalized');
        expect(body.sources.external, `${label}: the weighted term is withdrawn and says why (src/content/service.ts:445-449)`)
          .toEqual({ kind: external.kind, ref: external.ref, ok: false, ms: 0, version: null, reason: DISABLED });

        const sort = await s.call('/sort', { userId: s.visitor, candidates: PIECES.map(p => ({ id: p.id, ...p.tags })) });
        expect(sort.status, `${label}: ${await sort.clone().text()}`).toBe(200);
        await m.drain();

        const records = await servedRecords(m, s);
        expect(records.length, `${label}: fixture — the service served a decision record`).toBeGreaterThan(0);
        expect(records[0]!.explain.external, `${label}: fixture — the record carries the withdrawn term`).toEqual({ kind: external.kind, ref: external.ref, status: 'unavailable', reason: DISABLED });
        for (const record of records) {
          const replayed = await replayDecision(m.env, JSON.parse(JSON.stringify(record)) as DecisionRecord);
          expect(replayed, `${label}: the replay reproduces the served decision from its retained inputs`).toMatchObject({ ok: true, equal: true });
        }
        await m.drain();

        expectZeroEgress(m, label);
      }
    });
  }
});

// =============================================================================
// unit:W34.E2 — the policy is a deployment setting; absent or invalid is off
// =============================================================================

describe('unit:W34.E2', () => {
  const root = new URL('../../../', import.meta.url);

  it('logic: src/types/env.ts declares EXTERNAL_MODEL_POLICY', () => {
    const source = readFileSync(new URL('src/types/env.ts', root), 'utf8');
    expect(source, 'E2 — the deployment setting is part of the Worker environment contract')
      .toMatch(/^\s*EXTERNAL_MODEL_POLICY\??\s*:/m);
  });

  it('logic: every vars table of wrangler.toml deploys EXTERNAL_MODEL_POLICY = "off"', () => {
    // A TOML reader, not wrangler itself: importing wrangler in this process replaces the
    // runtime's Request/fetch globals the mounted routes below depend on.
    const config = parseToml(readFileSync(new URL('wrangler.toml', root), 'utf8')) as { vars?: Record<string, unknown>; env?: Record<string, { vars?: Record<string, unknown> }> };
    const tables: Array<[string, Record<string, unknown> | undefined]> = [['[vars]', config.vars],
      ...Object.entries(config.env ?? {}).map(([name, e]) => [`[env.${name}.vars]`, e.vars] as [string, Record<string, unknown> | undefined])];
    expect(tables.map(([name]) => name), 'fixture: the manifest declares the top-level, staging and production vars').toEqual(expect.arrayContaining(['[vars]', '[env.staging.vars]', '[env.production.vars]']));
    for (const [name, vars] of tables) expect(vars?.EXTERNAL_MODEL_POLICY, `E2/D1 — ${name} deploys the policy off`).toBe('off');
  });

  for (const host of HOSTS) {
    it(`host (${host}): the decision path reads the deployment setting, and an absent or invalid value is off`, async () => {
      for (const [index, value] of (['absent', 'off', 'OFF', 'on', 'true', 'enabled', 'service', 'table', 'workers_ai', ''] as const).entries()) {
        const external = EXTERNALS[index % EXTERNALS.length]!, label = `${host} / EXTERNAL_MODEL_POLICY=${value === 'absent' ? '(absent)' : JSON.stringify(value)} / ${external.kind}`;
        const m = await mount(host, learnWith(external), value);
        const s = await shopper(m, 100 + index);
        const decision = await s.call(`/v1/${TENANT}/decisions/snapshot?page=home`);
        expect(decision.status, label).toBe(200);
        const body = await decision.json() as { sources: { external: unknown } };
        await m.drain();
        if (value !== 'absent') expect(m.egress.policyReads, `E2 — ${label}: the policy is the deployment setting, not a code constant: the decision path reads it`).toBeGreaterThan(0);
        expect(body.sources.external, `E2 — ${label}: off, so the term is withdrawn`).toEqual({ kind: external.kind, ref: external.ref, ok: false, ms: 0, version: null, reason: DISABLED });
        expectZeroEgress(m, `E2 — ${label}`);
      }
    });
  }
});

// =============================================================================
// unit:W34.E3 — the content schema refuses an external term the deployment policy does not enable
// =============================================================================

describe('unit:W34.E3', () => {
  /** The operator's own write through the console's route: GET for the preconditions, then the write. */
  async function operatorWrite(m: Mounted, kind: 'learn' | 'slots', body: unknown) {
    const read = await m.fetch(new Request(`${ORIGIN}/content/${kind}?scope=${TENANT}`, { headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}` } }));
    expect(read.status, 'fixture: the published document reads').toBe(200);
    const head = await read.json() as { revision: number; publication: { revision: number; digest: string } };
    const response = await m.fetch(new Request(`${ORIGIN}/content/${kind}?scope=${TENANT}`, {
      method: 'PUT',
      headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}`, 'Content-Type': 'application/json',
        'If-Match': `"${head.revision}/${head.publication.revision}/${head.publication.digest}"`, 'Idempotency-Key': `${head.revision}:${crypto.randomUUID()}` },
      body: JSON.stringify(body),
    }));
    invalidatePublicationCache(); invalidateCache();
    return { status: response.status, text: await response.text(), revision: head.revision };
  }
  async function learnRevision(m: Mounted): Promise<number> {
    const read = await m.fetch(new Request(`${ORIGIN}/content/learn?scope=${TENANT}`, { headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}` } }));
    return (await read.json() as { revision: number }).revision;
  }

  it('host: a new learn document carrying an external term is refused by the dry run, the write and a related-set write, under every non-enabling policy value', async () => {
    for (const value of ['absent', 'off', 'on', 'service'] as const) {
      for (const external of EXTERNALS) {
        const label = `EXTERNAL_MODEL_POLICY=${value} / ${external.kind} ${external.ref}`;
        const m = await mount('session', learnWith(), value);
        const document = learnWith(external);

        const dry = await m.fetch(new Request(`${ORIGIN}/content/learn/validate?scope=${TENANT}`, {
          method: 'POST', headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ document }) }));
        const dryText = await dry.text();
        expect(dry.status, `E3 — ${label}: the dry run runs the write path's validator and refuses (${dryText.slice(0, 200)})`).toBe(422);
        expect(dryText, `E3 — ${label}: the refusal names the external term`).toMatch(/external/);

        const write = await operatorWrite(m, 'learn', { document, note: 'w34 external term' });
        expect(write.status, `E3 — ${label}: the write is refused (${write.text.slice(0, 200)})`).toBe(422);
        expect(write.text, `E3 — ${label}: the refusal names the external term`).toMatch(/external/);

        const related = await operatorWrite(m, 'slots', { document: SLOTS, note: 'w34 related', publicationChanges: [{ kind: 'learn', document }] });
        expect(related.status, `E3 — ${label}: nor can it ride a related-set publication (${related.text.slice(0, 200)})`).toBe(422);
        expect(await learnRevision(m), `E3 — ${label}: nothing was published`).toBe(write.revision);
      }
    }
  });

  it('host: the same writes without the external term are accepted (the refusal is the term, not the route)', async () => {
    const m = await mount('session', learnWith(), 'off');
    const write = await operatorWrite(m, 'learn', { document: learnWith(), note: 'w34 control' });
    expect(write.status, `control: ${write.text.slice(0, 200)}`).toBe(200);
    const related = await operatorWrite(m, 'slots', { document: SLOTS, note: 'w34 related control', publicationChanges: [{ kind: 'learn', document: { ...learnWith(), holdout: { share: 0, salt: 'w34-b', arms: ['default'] } } }] });
    expect(related.status, `control: ${related.text.slice(0, 200)}`).toBe(200);
  });
});

// =============================================================================
// unit:W34.E4 — POST /:tenant/models/reference carries the learn write routes' operator authentication and tenant scope
// =============================================================================

describe('unit:W34.E4', () => {
  const contract: Partial<ExternalRequest> = { page: 'home', slots: ['hero'], affinity: { line: { Tabby: 0.9 } },
    candidates: PIECES.map(p => ({ id: p.id, tags: p.tags })) };

  for (const mode of ['open', 'enforced'] as const) {
    it(`host (AUTH_MODE=${mode}): the model-reference route answers exactly what a learn write route answers for every caller, and serves only an operator of the tenant`, async () => {
      const m = await mount('session', learnWith(), 'off', mode);
      const grant = await issueSessionCapability(m.env, { tenant: TENANT, subject: 'vis-00000034-0000-4000-8000-00000000e404', sessionId: 's-00000034-0000-4000-8000-00000000e404', kind: 'anonymous' });
      const callers: Array<[string, Record<string, string>]> = [
        ['no credential', {}],
        ['a site key only', { 'X-SDK-Key': 'demo-site' }],
        ['a shopper session capability', { [SHOPPER_HEADER]: grant.capability }],
        ['a malformed bearer', { Authorization: 'Bearer not-a-token' }],
        ['an operator of another tenant', { Authorization: `Bearer ${await operatorCredential('elsewhere')}` }],
      ];
      const post = (path: string, headers: Record<string, string>, body: unknown) => m.fetch(new Request(`${ORIGIN}/v1/${TENANT}${path}`, {
        method: 'POST', headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
      for (const [who, headers] of callers) {
        const learnWrite = await post('/learn/cycle', headers, {});
        const reference = await post('/models/reference', headers, contract);
        // In open mode the operator gate authenticates without a tenant grant
        // (src/middleware/operatorAuth.ts:35-41), so another tenant's operator
        // passes it there, exactly as on every learn write route.
        const refused = !(mode === 'open' && who === 'an operator of another tenant');
        if (refused) {
          expect([401, 403], `fixture (${mode}): the learn write route refuses ${who}`).toContain(learnWrite.status);
          expect(reference.status, `E4 (${mode}) — ${who}: the model-reference route refuses exactly as POST learn/cycle does (${learnWrite.status})`).toBe(learnWrite.status);
        } else {
          expect(reference.status, `E4 (${mode}) — ${who}: past the same gate, the reference is served`).toBe(200);
        }
      }
      const served = await post('/models/reference', { Authorization: `Bearer ${m.operatorToken}` }, contract);
      expect(served.status, `E4 (${mode}) — an operator of the tenant is served`).toBe(200);
      expect(await served.json(), 'E4 — with the reference implementation of the contract').toEqual(referenceScore({ tenant: TENANT, brand: TENANT, cell: { channel: 'unknown', visit_bucket: 'unknown', region: null, affinity: null }, ...contract } as ExternalRequest));
    });
  }
});

// =============================================================================
// unit:W34.E5 — the kit states that no offline external table is published and that off is the only deployed state
// =============================================================================

describe('unit:W34.E5', () => {
  // The WO's proof admits "a document sentence the reviewer reading it". This
  // leg pins only what a mechanical reader can: the kit files in this ticket's
  // write boundary name the deployment setting beside its only deployed value,
  // and say an offline table is not published. The reviewer reads the meaning.
  const kit = ['01-integration-guide.md', '03-payload-schemas.md']
    .map(file => readFileSync(new URL(`../../../docs/kit/${file}`, import.meta.url), 'utf8')).join('\n');
  const paragraphs = kit.split(/\n\s*\n|\n(?=\|)/);

  it('logic: the kit names EXTERNAL_MODEL_POLICY with off as the only deployed state', () => {
    expect(paragraphs.filter(p => p.includes('EXTERNAL_MODEL_POLICY') && /`off`|"off"/.test(p)).length,
      'E5 — a kit paragraph names the deployment setting with its only deployed value').toBeGreaterThan(0);
  });

  it('logic: the kit states that no offline external table is published', () => {
    expect(paragraphs.filter(p => /offline/i.test(p) && /table/i.test(p) && /not published|no offline|is not offered|not offered|never published/i.test(p)).length,
      'E5 — a kit paragraph states that no offline external table is published').toBeGreaterThan(0);
  });
});
