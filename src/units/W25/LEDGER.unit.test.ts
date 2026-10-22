// src/units/W25/LEDGER.unit.test.ts
// W25 — the later W25 unit of LANE-LOG R183, as the frozen work order
// (docs/remediation/delivery-control/program.json, ticket W25) states it:
//
//   R1  A slot stopped by the publish-time money-prior refusal raises an
//       operator monitor or health signal.
//   R2  CELL_GRAMMAR.order in src/learn/priors.ts is derived from levelKeys.
//   R3  The snapshot route answers for a never-written prior-only slot.
//   R4  The priors input of buildReport has a production caller or is removed.
//   R5  The kit admitted-limitations text matches the build.
//
// G1, N1, Z1, V1, E1 and O1 are proven by src/units/W25/B1.unit.test.ts and
// are not re-specified here. LG1 is the acceptance command's second part.
//
// Witnesses: document 35 §5 row W25 (:427); LANE-LOG R148 (the W25 readings),
// R183 (the merge ruling that accepted the publish-time refusal as the
// fail-closed half of R148(d) and routed its consequence, with "a monitor/health
// signal so the stopped slot is never silent to an operator", and the four other
// residuals to this unit); the W25-B1 build review
// (/home/simonecoelho/rem/_evidence/W25-B1/reviewer-build/REPORT.md, findings 1-3
// and its residuals); docs/architecture/35-verification-reports/F20.md §7.
//
// Every expected number is derived in a comment beside it from the estimator's
// own arithmetic (doc 22 §5.3), never read back from the engine. The harness is
// the one src/units/W25/B1.unit.test.ts uses (real classes over storage stubs,
// the mounted routes, the publication set); that file is not imported, because
// importing a `.test.ts` registers its whole suite a second time.

import { readFileSync } from 'node:fs';

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { configuredOperationalDestinations } from '@/connectors/config';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { Cell, ContentPiece, DecisionRecord, LearnConfig, SlotCatalog, SlotStrategy } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { consumeLedger } from '@/ledger/consume';
import { enqueueDecisions } from '@/ledger/enqueue';
import { ts36 } from '@/ledger/records';
import { statsName } from '@/learn/fan';
import { CELL_GRAMMAR, EMPTY_PRIORS, PRIORS_KIND, type PriorsDoc } from '@/learn/priors';
import type { DayReport } from '@/learn/report';
import { DEFAULT_STATS, levelKeys, type LiftSnapshot } from '@/learn/stats';
import type { MonitorResult } from '@/ops/monitor';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture: Coach's own vocabulary (tapestry_requirements A.3.6),
// the same one src/units/W25/B1.unit.test.ts is written in, so every unit of
// the ticket reads one world.
// ===========================================================================

const TENANT = 'coach';
const BRAND = 'coach';
const OPERATOR_SECRET = 'w25-ledger-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const DAY_MS = 86_400_000;
/** The checkout this file lives in, whatever the working directory (the 2026-09-20 W29-B1 lesson). */
const ROOT = new URL('../../../', import.meta.url);
const kit = (name: string) => readFileSync(new URL(`docs/kit/${name}`, ROOT), 'utf8');

const COACH_CELL: Cell = { channel: 'direct', visit_bucket: '1', stage: 'early', region: 'US-NY', affinity: 'occasion:evening' };
/** A shopper the engine could not place: every component unknown or none. */
const UNKNOWN_CELL: Cell = { channel: 'unknown', visit_bucket: 'unknown', stage: 'unknown', region: 'none', affinity: 'none' };

const WARM = 'cnt-tabby-evening';
const COLD = 'cnt-charms-evening';
const CROSS = 'cnt-charms-slg';

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...over,
});
const PIECES: ContentPiece[] = [
  piece(WARM, { title: 'Tabby, after six', tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'] } }),
  piece(COLD, { title: 'Charms, after six', tags: { line: ['Rogue'], occasion: ['evening'], category: ['Handbags'] } }),
  // Cross-category and unknown-taxonomy rows are part of the fixture.
  piece(CROSS, { title: 'Charms, across the case', type: 'lookbook',
    tags: { occasion: ['weekend'], category: ['Small Leather Goods', 'Handbags'], unknown_dimension: ['unmapped'] } }),
];
const CATALOGUE = { version: 'w25-ledger-coach-catalogue', pieces: PIECES };
const HERO: SlotStrategy = { slot: 'hero', take: 2, weights: { occasion: 0.35, line: 0.25 } };
/** The money slot: it learns from purchases in `revenue` (F20 §1.5). */
const STORY: SlotStrategy = { slot: 'story', take: 1, weights: { occasion: 0.35, line: 0.25 } };
const SLOTS: SlotCatalog = { version: 'w25-ledger-coach-slots', pages: { home: [HERO, STORY] } };
const LEARN = {
  holdout: { share: 0, salt: 'w25-ledger', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  stats: DEFAULT_STATS,
  slots: {
    hero: { reward: 'click', objective: 'unit', gamma: 1 },
    story: { reward: 'purchase', objective: 'revenue', gamma: 1 },
  },
} as unknown as LearnConfig;

// The arithmetic (doc 22 §5.3; `src/learn/stats.ts`), never read back from the
// engine:
//   p̂(item, key) = (s + n0·target) / (n + n0), target = prior.p where a prior
//                  applies at the key or an ancestor, n0 = prior.n there.
//   A prior-only slot (no exposure anywhere): n = 0, s = 0, so p̂ = prior.p,
//   and the slot has no rate in any cell, so its reference is `none` (the one
//   representation W25.Z1.01 and W25.N1.01 already demand on this fixture).
const PRIOR_P = 0.1;
const PRIOR_N = 200;

// ===========================================================================
// The mounted application, in process, as `src/index.ts` mounts it, with the
// REAL ShopperReflex, DecisionRing and LearnStats classes on their namespaces.
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) as unknown : v; }
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
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: new TextEncoder().encode(this.objects.get(key) ?? '').length, uploaded: new Date(0) })),
      truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w25-ledger-fixture-policy', revision: 1, durationMs: 3650 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

/**
 * The tenant's own telemetry configuration, so a monitor run is KEPT and read
 * back by `GET /v1/:tenant/monitor`: `runMonitor` writes its result only under
 * an admitted operational `monitor` destination (`src/ops/monitor.ts` `admit` /
 * `eligible`). Fixture data in the registry's own schema
 * (`src/connectors/config.ts`), the arrangement src/units/W20/B3.unit.test.ts
 * uses for the same read.
 */
const TELEMETRY_ENVIRONMENT = 'test';
const telemetryRegistry = () => JSON.stringify({
  version: 1,
  tenants: { [TENANT]: { telemetry: { environment: TELEMETRY_ENVIRONMENT, schema: 'ops-v1',
    monitor: { binding: 'CACHE', namespace: 'monitor', accessPolicy: 'w25-ledger-ops' } } } },
});

interface DurableRegistry { data: Map<string, unknown>; object: { fetch: (request: Request) => Promise<Response>; alarm?: () => Promise<void> } }

interface Mounted {
  env: Env;
  cache: UnitKV;
  storage: UnitR2;
  queued: unknown[];
  stats: Map<string, DurableRegistry>;
  fetch: (input: Request) => Promise<Response>;
  drain: () => Promise<void>;
}

interface MountOptions { priors?: PriorsDoc; retainedPriors?: boolean }

async function mount(options: MountOptions = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const queued: unknown[] = [];
  const cache = new UnitKV(), sessions = new UnitKV(), storage = new UnitR2();
  const stats = new Map<string, DurableRegistry>(), shoppers = new Map<string, DurableRegistry>(), rings = new Map<string, DurableRegistry>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: TELEMETRY_ENVIRONMENT, CACHE: cache, SESSIONS: sessions,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: 'session', STORAGE: storage,
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w25-ledger-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    TENANT_CONNECTORS: telemetryRegistry(),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    LEDGER_RECOVERY_ENABLED: 'false',
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); },
      sendBatch: async (messages: Array<{ body: unknown }>) => { for (const message of messages) queued.push(message.body); } },
  } as unknown as Env;
  const policies = fixtureCategories([TENANT]);
  // The operational destination carries its own per-destination retention
  // category, which is what lets a monitor run be admitted, kept and read back.
  for (const destination of await configuredOperationalDestinations(env, TENANT)) policies[TENANT]![destination.category as RetentionCategory] = fixtureRetentionPolicy;
  env.RETENTION = JSON.stringify({ version: 1, tenants: policies });

  const namespaceFor = (make: (state: DurableObjectState, env: Env) => DurableRegistry['object'], registry: Map<string, DurableRegistry>) => ({
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = registry.get(name);
      if (!item) {
        const data = new Map<string, unknown>();
        const alarms: number[] = [];
        const storageStub = {
          get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
          put: async (k: string | Record<string, unknown>, v?: unknown) => {
            if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
          },
          list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
            structuredClone(new Map([...data].filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
              .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit))),
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            const candidate = structuredClone(data);
            let deleteAlarm = false, nextAlarm: number | undefined;
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => {
                if (typeof values === 'string') candidate.set(values, structuredClone(value));
                else for (const [key, entry] of Object.entries(values)) candidate.set(key, structuredClone(entry));
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
        };
        const state = { id: name, storage: storageStub, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, object: make(state, env) };
        registry.set(name, item);
      }
      return item.object.fetch(new Request(input, init));
    } }),
  });
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e), shoppers) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e), rings) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e), stats) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT, retainedValue = false): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w25-ledger-fixture', note: 'fixture', value }, ...(retainedValue ? { retainedValue: true as const } : {}) });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, CATALOGUE),
    baseline(SLOTS_KIND, SLOTS),
    baseline(LEARN_KIND, LEARN),
    // `retainedValue` is the publication's own mechanism for "explicit reviewed
    // historical bytes" (`src/config/publication.ts`): a prior document a tenant
    // already holds from before the import door refused money-slot rows.
    baseline(PRIORS_KIND, options.priors ?? EMPTY_PRIORS, TENANT, options.retainedPriors === true),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env, {
    waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {},
  } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, cache, storage, queued, stats, fetch: fetchOne, drain };
}

type Answer = { status: number; body: Record<string, unknown> };

async function operatorToken(): Promise<string> {
  return new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));
}

async function operator(m: Mounted, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, contentType = 'application/json', extra: Record<string, string> = {}): Promise<Answer> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method, headers: { Authorization: `Bearer ${await operatorToken()}`, 'X-Tenant': TENANT, 'Content-Type': contentType, ...extra },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/** The publication preconditions every authored write carries (kit 02: If-Match plus Idempotency-Key). */
function authoredHeaders(m: Mounted, name: string): Record<string, string> {
  const head = JSON.parse(m.storage.objects.get(`config-publication/v2/${TENANT}/head.json`)!) as { committed: { revision: number; digest: string } };
  const set = JSON.parse(m.storage.objects.get(`config-publication/v2/${TENANT}/set/${head.committed.revision}.json`)!) as { refs: Record<string, { revision: number }> };
  const revision = set.refs[`${name}:${TENANT}`]!.revision;
  return { 'If-Match': `"${revision}/${head.committed.revision}/${head.committed.digest}"`, 'Idempotency-Key': `${revision}:${crypto.randomUUID()}` };
}

/** `PUT /content/priors` as an operator: the data scientist's own import door. */
const putPriors = (m: Mounted, doc: PriorsDoc) =>
  operator(m, 'PUT', `/content/priors?scope=${TENANT}`, doc, 'application/json', authoredHeaders(m, 'prior'));

/** The statistics object for one slot, in process, through its namespace. */
const statsObject = (m: Mounted, slot: string) =>
  m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(statsName(TENANT, BRAND, slot)));

async function statsCall(m: Mounted, slot: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await statsObject(m, slot).fetch(new Request('https://learn' + path,
    body === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

/** Live exposures into the real statistics object, as the fan does, under the slot's published configuration. */
async function feed(m: Mounted, slot: 'hero' | 'story', item: string, cell: Cell, exposures: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const config = { reward: slot === 'hero' ? 'click' : 'purchase', stats: DEFAULT_STATS,
    objective: slot === 'hero' ? 'unit' : 'revenue', measurementBasis: 'served-v1' };
  return statsCall(m, slot, '/exposures', { tenant: TENANT, brand: BRAND, slot, config,
    exposures: Array.from({ length: exposures }, () => ({ item, cell, ts: Date.now() })) });
}

/**
 * Every entry of a monitor answer that names a stopped slot: any object in it
 * carrying a `slot` string whose own members say why in words that name the
 * prior. The member that carries it is the implementer's to name (R183 rules the
 * signal, not its spelling); what an operator must be able to read off it is
 * the brand, the slot and that the imported prior is the cause, which is the
 * vocabulary every per-slot row of the monitor already uses (`SinkDisagreement`
 * is `{ brand, slot, … }`).
 */
function stoppedSlotSignals(value: unknown): Array<{ brand: unknown; slot: unknown }> {
  const found: Array<{ brand: unknown; slot: unknown }> = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.slot === 'string') {
      const said = JSON.stringify(Object.fromEntries(Object.entries(o).filter(([key]) => key !== 'slot' && key !== 'brand')));
      if (/prior/i.test(said)) found.push({ brand: o.brand, slot: o.slot });
    }
    for (const x of Object.values(o)) walk(x);
  };
  walk(value);
  return found;
}

// ===========================================================================
// unit:W25.R1 — a slot stopped by the publish-time money-prior refusal is never
// silent to an operator
// ===========================================================================

describe('unit:W25.R1', () => {
  /**
   * LANE-LOG R183: the builder's publish-time refusal (a retained probability
   * prior for a money-objective slot is never silently applied) is ACCEPTED as
   * the fail-closed half of R148(d), and its consequence — "that slot stops
   * publishing until its prior document is re-exported, the write door still
   * recording exposures, the shopper served the last snapshot" — goes "with a
   * monitor/health signal so the stopped slot is never silent to an operator".
   * The W25-B1 build review (finding 1) measured the silence: the alarm wraps
   * `publish()` in `try … finally` with no catch, and the operator's own publish
   * answers the generic 503 "statistics acknowledgement unavailable".
   *
   * The signal is asked of the MONITOR: it is the operator surface the platform
   * raises unasked, every five minutes (`src/index.ts` → `runMonitor`), and whose
   * kept result an operator reads back (`GET /v1/:tenant/monitor`). A per-slot
   * status read tells an operator nothing about a slot they do not already
   * suspect, which is the silence R183 rules out.
   */
  it('host: a retained money-slot probability prior stops the slot publishing, and the operator\'s monitor run and its kept result name that brand and slot and the prior as the cause, while a tenant whose prior document publishes raises no such signal', async () => {
    // The tenant's retained prior document: a probability row for `story`,
    // whose objective is `revenue` (F20 §1.5), exported before the import door
    // refused such rows, and a compatible row for the unit-objective `hero`.
    const retained: PriorsDoc = { version: 'w25-ledger-retained', rows: [
      { slot: 'story', item: COLD, cell: '*', p_prior: 0.05, n_equiv: PRIOR_N },
      { slot: 'hero', item: COLD, cell: 'c=direct|v=1', p_prior: PRIOR_P, n_equiv: PRIOR_N },
    ] };
    const m = await mount({ priors: retained, retainedPriors: true });

    // The write door still records exposures for the money slot (R183).
    expect((await feed(m, 'story', WARM, COACH_CELL, 10)).status, 'the write door records the money slot\'s exposures').toBe(200);
    // PRECONDITION, the behaviour R183 accepted: publication is refused, naming
    // the unit, both where the object publishes and where its alarm does.
    const refused = await statsCall(m, 'story', '/publish');
    expect(refused.status, 'PRECONDITION: the money slot\'s publication is refused (LearnStats `priorsFor`)').toBe(409);
    expect(String(refused.body.error), 'PRECONDITION: and the refusal names the prior unit').toMatch(/prior unit incompatible/);
    const registry = m.stats.get(statsName(TENANT, BRAND, 'story'))!;
    await registry.object.alarm!().catch(() => undefined);
    await operator(m, 'POST', `/v1/${TENANT}/learn/publish`, { slot: 'story', brand: BRAND });
    await m.drain();

    // RED: the operator's monitor run names the stopped slot.
    const run = await operator(m, 'POST', `/v1/${TENANT}/monitor`);
    expect(run.status, `the monitor run answers: ${JSON.stringify(run.body).slice(0, 300)}`).toBe(200);
    const result = (run.body as { result: MonitorResult }).result;
    expect(stoppedSlotSignals(result),
      'W25.R1: the monitor run must name the brand and slot whose publication the money-slot prior stopped, and say the imported prior is why (LANE-LOG R183)')
      .toContainEqual({ brand: BRAND, slot: 'story' });
    // The slot whose prior is compatible is not named as stopped.
    expect(stoppedSlotSignals(result).filter(signal => signal.slot === 'hero'), 'the compatible slot is not reported as stopped').toEqual([]);

    // RED: and so does the kept result an operator reads afterwards — the
    // scheduled run's only operator surface, rebuilt member by member by
    // `projectMonitor`, which drops whatever it does not copy.
    const kept = await operator(m, 'GET', `/v1/${TENANT}/monitor`);
    expect(kept.status).toBe(200);
    expect((kept.body.last ?? null) === null ? `absent: GET /v1/${TENANT}/monitor answered ${JSON.stringify(kept.body).slice(0, 200)}` : 'kept',
      'PRECONDITION: the run just made is kept and read back (the tenant\'s monitor destination is admitted)').toBe('kept');
    expect(stoppedSlotSignals(kept.body.last),
      'W25.R1: the operator\'s later read of the kept monitor result must still name the stopped slot (LANE-LOG R183: "never silent to an operator")')
      .toContainEqual({ brand: BRAND, slot: 'story' });

    // The control: the same tenant whose prior document carries no money-slot
    // row publishes both slots, and its monitor names no stopped slot, so the
    // signal is derived from the refusal and is never a stamped constant.
    const clean = await mount({ priors: { version: 'w25-ledger-clean', rows: [retained.rows[1]!] }, retainedPriors: true });
    expect((await feed(clean, 'story', WARM, COACH_CELL, 10)).status).toBe(200);
    expect((await statsCall(clean, 'story', '/publish')).body, 'the control\'s money slot publishes').toMatchObject({ ok: true, published: true });
    const quiet = await operator(clean, 'POST', `/v1/${TENANT}/monitor`);
    expect(quiet.status).toBe(200);
    expect(stoppedSlotSignals((quiet.body as { result: MonitorResult }).result), 'a tenant with no stopped slot is told of none').toEqual([]);
  });
});

// ===========================================================================
// unit:W25.R2 — the import grammar's order is DERIVED from the ladder
// ===========================================================================

describe('unit:W25.R2', () => {
  /**
   * LANE-LOG R183: "`CELL_GRAMMAR.order` derived from `levelKeys` (restated
   * today, bound only by the unit)". The W25-B1 build review (finding 2):
   * `src/learn/priors.ts` writes `order: ['c','v','s','r','a']` a second time,
   * so a future ladder reorder desynchronizes the import grammar at runtime and
   * only a test notices. Derived means the grammar follows the ladder: reorder
   * `levelKeys` and the order — and what the import door accepts — follow it.
   */
  it('logic: CELL_GRAMMAR.order is the key order levelKeys builds, and a ladder whose order changes carries into the grammar and into what validatePriors accepts and refuses', async () => {
    // LOCKED: today the two agree (W25.G1.01 asserts the same at B1:454-456).
    const ladder = (levelKeys(COACH_CELL).at(-1) ?? '').split('|').map(pair => pair.split('=')[0]);
    expect([...CELL_GRAMMAR.order], 'the grammar and the ladder name the same order today').toEqual(ladder);
    expect(levelKeys(UNKNOWN_CELL).at(-1)!.split('|').map(pair => pair.split('=')[0]), 'for every cell, including an unplaced shopper').toEqual(ladder);

    // RED: the same stats module with its ladder reordered — the journey stage
    // and the region swapped, `c, v, r, s, a` — and a fresh priors module
    // loaded against it. A grammar derived from `levelKeys` follows; a grammar
    // that restates the letters does not.
    const reordered = (keys: string[]): string[] => {
      const pairs = (keys.at(-1) ?? '').split('|');
      const order = [pairs[0]!, pairs[1]!, pairs[3]!, pairs[2]!, pairs[4]!];
      return ['*', ...order.map((_, i) => order.slice(0, i + 1).join('|'))];
    };
    vi.doMock('@/learn/stats', async (importOriginal) => {
      const real = await importOriginal<typeof import('@/learn/stats')>();
      return { ...real, levelKeys: (cell: Cell) => reordered(real.levelKeys(cell)) };
    });
    try {
      // A fresh instance of the priors module, loaded against the reordered
      // ladder: the query makes it a module of its own, so the instance every
      // other unit imports is untouched and no module registry is reset.
      const specifier = '@/learn/priors?w25-r2-reordered-ladder';
      const fresh = await import(/* @vite-ignore */ specifier) as typeof import('@/learn/priors');
      expect([...fresh.CELL_GRAMMAR.order],
        'W25.R2: CELL_GRAMMAR.order must be derived from levelKeys, so a reordered ladder is the grammar\'s order too (LANE-LOG R183)')
        .toEqual(['c', 'v', 'r', 's', 'a']);
      const rows = (cell: string) => ({ rows: [{ slot: 'hero', item: COLD, cell, p_prior: PRIOR_P, n_equiv: PRIOR_N }] });
      expect(fresh.validatePriors(rows('c=direct|v=1|r=US-NY')).ok,
        'W25.R2: a prefix of the reordered ladder is importable').toBe(true);
      expect(fresh.validatePriors(rows('c=direct|v=1|r=US-NY|s=early|a=occasion:evening')).ok,
        'W25.R2: the reordered ladder\'s full key is importable').toBe(true);
      const old = fresh.validatePriors(rows('c=direct|v=1|s=early'));
      expect(old.ok, 'W25.R2: a key in the order the ladder no longer builds is refused').toBe(false);
      expect((old.ok ? [] : old.errors).join(' '), 'and the refusal names the order the ladder now has').toMatch(/c=.*v=.*r=.*s=.*a=/);
    } finally {
      vi.doUnmock('@/learn/stats');
    }
  });
});

// ===========================================================================
// unit:W25.R3 — the snapshot route answers for a never-written prior-only slot
// ===========================================================================

describe('unit:W25.R3', () => {
  /**
   * LANE-LOG R183: "`/snapshot` null for a never-written prior-only slot". The
   * W25-B1 build review: only `/publish` cold-starts the identity
   * (`priorOnlyIdentity`); `/snapshot` has no fallback, so a slot W25.N1.01 made
   * publishable answers "nothing" to every reader of the object's own snapshot
   * — the monitor's sink reconciliation among them (`src/ops/monitor.ts`
   * `reconcileSinks`).
   */
  it('host-internal: a slot that has never recorded an event and holds an imported prior answers its prior-derived snapshot on /snapshot, the same estimate /publish publishes, while a slot with neither events nor priors still answers none', async () => {
    const m = await mount({ priors: { version: 'w25-ledger-warehouse', rows: [
      { slot: 'hero', item: COLD, cell: 'c=direct|v=1', p_prior: PRIOR_P, n_equiv: PRIOR_N },
    ] } });

    // LOCKED: the slot with nothing at all answers nothing, as its publish does
    // (W25.N1.01's gate; the monitor's own objects probe reads this answer).
    expect((await statsCall(m, 'story', '/snapshot')).body, 'an unprior\'d, never-written slot answers no snapshot').toEqual({ ok: true, snapshot: null });

    // RED: the prior-only slot answers.
    const read = await statsCall(m, 'hero', '/snapshot');
    expect(read.status).toBe(200);
    const snap = read.body.snapshot as LiftSnapshot | null;
    expect(snap === null ? 'null' : 'a snapshot',
      'W25.R3: /snapshot must answer for a never-written slot whose only evidence is an imported prior (LANE-LOG R183)').toBe('a snapshot');
    expect(snap, 'the slot it IS, with no live events').toMatchObject({ tenant: TENANT, brand: BRAND, slot: 'hero', events: 0, priorVersion: 1 });
    const stat = snap!.items[COLD]!['c=direct|v=1']!;
    // p̂ = (0 + 200 × 0.1)/(0 + 200) = 0.1; no observed exposure; no rate in any cell, so no reference.
    expect(stat).toMatchObject({ level: 2, key: 'c=direct|v=1', n: 0, s: 0, n0: PRIOR_N, prior: { p: PRIOR_P, n: PRIOR_N }, liftReference: 'none' });
    expect(stat.p_hat).toBeCloseTo(PRIOR_P, 12);

    // The same builder: what /publish then publishes carries the same estimates,
    // and the object still answers them after publication, with no event recorded.
    const published = await statsCall(m, 'hero', '/publish');
    expect(published.body).toMatchObject({ ok: true, published: true });
    expect((published.body.snapshot as LiftSnapshot).items, 'the published estimates are the ones /snapshot answered').toEqual(snap!.items);
    const after = (await statsCall(m, 'hero', '/snapshot')).body.snapshot as LiftSnapshot | null;
    expect(after?.items ?? null, 'and /snapshot keeps answering them').toEqual(snap!.items);
  });
});

// ===========================================================================
// unit:W25.R4 — buildReport's priors input has a production caller
// ===========================================================================

describe('unit:W25.R4', () => {
  /**
   * LANE-LOG R183: "`buildReport`'s `priors` input without a production
   * caller". The W25-B1 build review: the sole production caller
   * (`runReport`, `src/learn/report.ts`) passes none, so every production day
   * report declares `gridPriors: { applied: false }` and the `applied: true`
   * branch W25.O1.01 specified lives only in that unit.
   *
   * The frozen criterion offers "has a production caller OR is removed". The
   * second branch is not open inside this ticket: W25.O1.01
   * (`src/units/W25/B1.unit.test.ts:903-910`) calls `buildReport` WITH the
   * input and requires `{ applied: true, priorVersion: 12 }` and the prior in
   * the grid, and every test of the ticket must be green at once. So the unit
   * asks for the production caller, on the operator's own report route.
   */
  it('host: the day report an operator builds from the ledger records for a tenant whose published prior document has a row for the slot is built with that prior and declares the revision it applied, on the answer and on the stored report', async () => {
    const m = await mount();
    // The warehouse's prior for the WARM item, through the shipped door. The
    // revision is read off the door's own answer, never restated.
    const imported = await putPriors(m, { rows: [{ slot: 'hero', item: WARM, cell: '*', p_prior: PRIOR_P, n_equiv: PRIOR_N }] });
    expect(imported.status, JSON.stringify(imported.body).slice(0, 300)).toBe(200);
    const priorRevision = imported.body.revision as number;
    expect(Number.isSafeInteger(priorRevision) && priorRevision >= 2, 'the import is a new revision of the prior document').toBe(true);

    // One served decision of WARM in `hero` today, through the real producer
    // and the real ledger consumer.
    const ts = Date.now() - 60_000;
    const date = new Date(ts).toISOString().slice(0, 10);
    const record = {
      decision_id: `${TENANT}:${ts36(ts)}:v-w25-r4:home:hero:0`,
      tenant: TENANT, brand: BRAND, visitor_id: 'v-w25-r4', session_id: 's-w25-r4', identity_anchor: 'visitor', ts,
      page: 'home', slot: 'hero', position: 0, item_id: WARM, customer_item_id: 'CMS-TABBY-EVENING', candidates: [],
      cell: COACH_CELL, arm: 'personalized', explored: false, authority: 'engine',
      versions: { config: 1, lift: 0, prior: priorRevision, policy: 1 }, config_label: 'w25-ledger',
      explain: { drivers: [], score_base: 0.28, score_final: 0.28, lift: null },
      retention: captureRetention(m.env as never, TENANT, ts, ts),
    } as unknown as DecisionRecord;
    await enqueueDecisions(m.env, [record]);
    const written = await consumeLedger(m.env, m.queued.splice(0), Date.now());
    expect(written, 'PRECONDITION: the real consumer writes the day').toMatchObject({ ok: true });

    // RED: the operator's report route (`POST /v1/:tenant/learn/report` →
    // `runDayReport` → `runReport` → `buildReport`) builds the grid with the
    // tenant's prior document and declares it.
    const built = await operator(m, 'POST', `/v1/${TENANT}/learn/report`, { date, brand: BRAND });
    expect(built.status, JSON.stringify(built.body).slice(0, 300)).toBe(200);
    const report = (built.body as { report: DayReport }).report;
    expect(report.gridPriors,
      'W25.R4: a production day report built for a tenant with a prior document must be built with it and declare its revision (LANE-LOG R183)')
      .toEqual({ applied: true, priorVersion: priorRevision });
    // One exposure, no credit, the `*` prior (0.1, 200):
    //   p̂ = (0 + 200 × 0.1)/(1 + 200) = 20/201 at n0 = 200 — the live table's
    //   estimate — never the prior-free (0 + 30 × 0)/(1 + 30) = 0 at n0 = 30.
    const grid = report.grids.hero!.learning!.items[WARM]!['*']!;
    expect(grid, 'W25.R4: and the grid really is built with the prior').toMatchObject({ n0: PRIOR_N, prior: { p: PRIOR_P, n: PRIOR_N } });
    expect(grid.n).toBeCloseTo(1, 3);
    expect(grid.p_hat).toBeCloseTo(20 / 201, 5);

    // The stored report the console and the monitor read says the same.
    const stored = await operator(m, 'GET', `/v1/${TENANT}/learn/report?date=${date}&brand=${BRAND}`);
    expect(stored.status, JSON.stringify(stored.body).slice(0, 300)).toBe(200);
    expect((stored.body as { report: DayReport }).report.gridPriors, 'W25.R4: the stored day report keeps the declaration')
      .toEqual({ applied: true, priorVersion: priorRevision });
  });
});

// ===========================================================================
// unit:W25.R5 — the kit's admitted limitations match the build
// ===========================================================================

/** The paragraphs of a document, as a reader meets them. */
const paragraphs = (text: string): string[] => text.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);

describe('unit:W25.R5', () => {
  /**
   * LANE-LOG R183: "the kit's admitted-limitations edit re-read". The W25-B1
   * build review (finding 3): `docs/kit/02-api-reference.md` says a money prior
   * is "refused at import and at publication" but states NOT the consequence a
   * customer needs — the slot stops publishing until the prior document is
   * re-exported, the write door still records its exposures, the shopper keeps
   * the last published snapshot — and R183 routes the operator signal (W25.R1)
   * with it. And the kit's "the offline grids" limitation must say what the
   * build now does with a record-built day (W25.R4), beside what the fold still
   * does not do.
   */
  it('logic: the kit states the publication-time consequence of a retained money-slot prior and where an operator sees it, and states which day report is built with the prior and which declares it is not', () => {
    const text = paragraphs(kit('02-api-reference.md') + '\n\n' + kit('03-payload-schemas.md'));

    // LOCKED: the refusal itself is stated (kit 02, the W25 paragraph).
    const refusal = text.filter(p => /refused at import[^.]*publication/i.test(p));
    expect(refusal.length, 'the kit states the money-slot refusal at publication').toBeGreaterThan(0);

    // RED: the consequence, in the paragraph that states the refusal or beside it.
    const sentences = (p: string) => p.split(/(?<=\.)\s+/);
    const stops = /(stops? publishing|no longer publishes|does not publish|is not published|(stops|halts) (its |the )?publication|publication (stops|halts))/i;
    const consequence = text.find(p => sentences(p).some(s => /(revenue|margin|money)/i.test(s) && stops.test(s)));
    expect(consequence ?? 'no paragraph states that the slot stops publishing',
      'W25.R5: the kit must state that a slot holding a retained money-slot probability prior stops publishing (LANE-LOG R183)')
      .toMatch(/re-?export/i);
    expect(consequence ?? '', 'W25.R5: that its exposures are still recorded').toMatch(/(still|continue[sd]? to|keeps?) record|exposures (are )?still (recorded|counted)/i);
    expect(consequence ?? '', 'W25.R5: that the shopper keeps being served the last published snapshot').toMatch(/last (published )?snapshot/i);
    expect(consequence ?? '', 'W25.R5: and where an operator is told of the stopped slot (W25.R1)').toMatch(/monitor/i);

    // RED: which day report is built with the prior (W25.R4), and — LOCKED —
    // that the day summed from folded hours still declares that it is not.
    const grids = text.filter(p => /gridPriors/.test(p)).join(' ');
    expect(grids, 'W25.R5: the kit must state that a day report built from the ledger records is built with the tenant\'s prior document and declares `applied: true`')
      .toMatch(/applied: ?true/);
    expect(grids, 'the fold\'s declaration stays stated').toMatch(/folded hours[^.]*applied: ?false/);
  });
});
