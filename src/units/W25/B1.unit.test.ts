// src/units/W25/B1.unit.test.ts
// W25 batch B1 — cold priors: the canonical versioned cell grammar at every
// level, no-event publication, zero reference and unit compatibility, prior
// provenance without phantom rows, and the real import → receipt → ranking
// pipeline (document 35 §5 row W25 :427; §2 N20 :282 and N22 :284;
// `docs/architecture/35-verification-reports/F20.md` §4 items 1–10, §5, §7;
// HANDOFF-2026-09-16 :229 and :359 D09; HANDOFF-2026-09-18 :321, §7 item 7 (C7),
// §8 D09; `docs/kit/03-payload-schemas.md` :423-:427 and `docs/kit/02-api-reference.md` :316).
//
// The ruled outcome, the witness and the residual of each unit are on its row in
// docs/remediation/units.json (batch W25-B1). What is already true at this head
// is LOCKED here as a regression with the line that reverses it named beside it;
// what is absent is RED on the member the batch rules. No file outside
// src/units/** and docs/remediation/units.json is touched by this batch.
//
// The harness pattern (real classes over storage stubs, the mounted app, the
// publication set) is the one `src/units/W22/B2.unit.test.ts`,
// `src/units/W20/B3.unit.test.ts` and `src/units/W16/C5.unit.test.ts` use; none
// of those files is imported or edited, because importing a `.test.ts` would
// register its whole suite a second time.

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { decideContent } from '@/content/decide';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache, serveContentDecisions } from '@/content/service';
import type { Cell, ContentPiece, DecisionRecord, LearnConfig, SlotCatalog, SlotStrategy } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { newAnonymousSession, SHOPPER_HEADER, verifySessionCapability } from '@/identity/sessionCapability';
import { statsName } from '@/learn/fan';
import { DEFAULT_HORIZON_MS, emptyBrand, policiesOf, reportFromHours, SHARDS, type HourAggregate } from '@/learn/hourly';
// `CELL_GRAMMAR` and `priorUnitErrors` are the members this batch RULES; they do
// not exist at the base commit, so every unit that needs them is RED on the
// import until they do (METHOD §3, "if the ruled outcome needs an export that
// does not exist yet, import it by the name the brief rules").
import {
  CELL_GRAMMAR, EMPTY_PRIORS, indexPriors, parsePriorsCsv, PRIORS_KIND, priorUnitErrors, validatePriors,
  type PriorsDoc,
} from '@/learn/priors';
import { receiptOf } from '@/learn/receipts';
import { buildReport, computationBasis, type DayReport } from '@/learn/report';
import {
  buildSnapshot, DEFAULT_STATS, emptyStats, levelKeys, liftFor, recordExposure, recordSuccess,
  type LiftSnapshot, type StatsState,
} from '@/learn/stats';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import { shopperObjectName } from '@/tenancy/objects';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture (docs/architecture/tapestry_requirements.txt A.3.6:
// the Coach line/occasion/category vocabulary), plus the unknown, the
// cross-category and the not-in-the-catalogue rows this batch needs.
// ===========================================================================

const TENANT = 'coach';
const BRAND = 'coach';
const OPERATOR_SECRET = 'w25-b1-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const DAY_MS = 86_400_000;

/**
 * The shopper's cell, in the customer's own vocabulary. Every ladder key below
 * is `levelKeys(COACH_CELL)`, whose order (`src/learn/stats.ts:47-50`) is the
 * canonical one F20 §4.7 names: `c=`, `v=`, `s=`, `r=`, `a=`.
 */
const COACH_CELL: Cell = { channel: 'direct', visit_bucket: '1', stage: 'early', region: 'US-NY', affinity: 'occasion:evening' };
/** A second, disjoint cell: the same shopper arriving from search, later in her journey. */
const SEARCH_CELL: Cell = { channel: 'search', visit_bucket: '2-3', stage: 'mid', region: 'US-CA', affinity: 'line:rogue' };
/** Everything the engine did not recognise records as unknown, never as a guess. */
const UNKNOWN_CELL: Cell = { channel: 'unknown', visit_bucket: 'unknown', stage: 'unknown', region: 'none', affinity: 'none' };

const LADDER = levelKeys(COACH_CELL);
const WARM = 'cnt-tabby-evening';
const COLD = 'cnt-charms-evening';
const CROSS = 'cnt-charms-slg';
/** A prior row for an item the tenant's catalogue does not carry (F20 §4.4). */
const GHOST = 'cnt-not-in-the-catalogue';

const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...over,
});

const W25_PIECES: ContentPiece[] = [
  piece(WARM, { title: 'Tabby, after six', tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'] } }),
  // The COLD item shares the occasion the shopper shows interest in and nothing
  // else, so its base score is real but lower than the warm item's: a
  // multiplicative learned term has something to move (document 35 §2 N20 — an
  // exactly zero base could not be moved by any lift, so a zero-base candidate
  // would make the ranking clause of W25.E1.01 vacuous).
  piece(COLD, { title: 'Charms, after six', tags: { line: ['Rogue'], occasion: ['evening'], category: ['Handbags'] } }),
  // Cross-category and unknown-taxonomy rows are part of the fixture.
  piece(CROSS, { title: 'Charms, across the case', type: 'lookbook',
    tags: { occasion: ['weekend'], category: ['Small Leather Goods', 'Handbags'], unknown_dimension: ['unmapped'] } }),
];
const W25_CATALOGUE = { version: 'w25-b1-coach-catalogue', pieces: W25_PIECES };

const HERO: SlotStrategy = { slot: 'hero', take: 2, weights: { occasion: 0.35, line: 0.25 } };
/** The money slot: W24's objective vocabulary (`src/content/kinds.ts:324-326`). */
const STORY: SlotStrategy = { slot: 'story', take: 1, weights: { occasion: 0.35, line: 0.25 } };
const W25_SLOTS: SlotCatalog = { version: 'w25-b1-coach-slots', pages: { home: [HERO, STORY] } };

/**
 * The tenant's published learning document. `holdout.share: 0` so every fixture
 * decision is `personalized`; `gamma: 1` on `hero` so the learned term is
 * applied in full and the ranking clause is about the prior, not about the
 * trust dial; `story` learns from purchases in `revenue` — the money objective
 * whose unit a `[0,1]` probability prior cannot express (F20 §1.5).
 */
const W25_LEARN = {
  holdout: { share: 0, salt: 'w25-b1', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  stats: DEFAULT_STATS,
  slots: {
    hero: { reward: 'click', objective: 'unit', gamma: 1 },
    story: { reward: 'purchase', objective: 'revenue', gamma: 1 },
  },
} as unknown as LearnConfig;

// ---------------------------------------------------------------------------
// The arithmetic every expected number below is derived from, never read back
// from the engine (doc 22 §5.3; `src/learn/stats.ts:205-258`):
//
//   slotRate(key) = (s + n₀·p₀(parent)) / (n + n₀),  p₀(root) = s/n
//   p̂(item, key)  = (s + n0·target) / (n + n0),  target = prior.p when a prior
//                   applies at that key or any ancestor of it, else slotRate(key)
//   n0            = prior.n when a prior applies, else cfg.n0
//   lift          = clamp(liftMin, liftMax, p̂ / slotRate(key))     when slotRate > 0
//
// WARM_STATE: 100 exposures and 5 clicks on WARM in COACH_CELL, all at NOW.
//   slot root:   n = 100, s = 5      → p₀ = 5/100 = 0.05
//                rate = (5 + 30×0.05)/(100+30) = 6.5/130 = 0.05
//   every child: rate = (5 + 30×0.05)/(100+30) = 0.05     → the reference is 0.05 at EVERY level
//   WARM at level 5: p̂ = (5 + 30×0.05)/(100+30) = 0.05, lift = 0.05/0.05 = 1
//   COLD with prior (0.1, 200) at any ladder key k:
//                n = 0, s = 0, n0 = 200, p̂ = (0 + 200×0.1)/(0+200) = 0.1
//                lift = min(2, max(0.5, 0.1/0.05)) = 2      n + prior.n = 200 ≥ nMin 30
// ---------------------------------------------------------------------------

const P_REFERENCE = 0.05;
const PRIOR_P = 0.1;
const PRIOR_N = 200;

function warmState(cell: Cell = COACH_CELL, exposures = 100, clicks = 5): StatsState {
  const st = emptyStats();
  for (let i = 0; i < exposures; i++) recordExposure(st, WARM, cell, NOW, DEFAULT_STATS);
  for (let i = 0; i < clicks; i++) recordSuccess(st, WARM, cell, 'click', NOW, 1, DEFAULT_STATS);
  return st;
}

const priorsOf = (rows: PriorsDoc['rows'], version = 7) => ({ version, index: indexPriors({ rows }, 'hero') });
const IDS = { tenant: TENANT, brand: BRAND, slot: 'hero' };
const snapshotOf = (st: StatsState, rows: PriorsDoc['rows'] | null, version = 7): LiftSnapshot =>
  buildSnapshot(st, IDS, 'click', NOW, DEFAULT_STATS, rows === null ? null : priorsOf(rows, version));

// ===========================================================================
// The mounted application, in process, the way `src/index.ts` mounts it, with
// the REAL ShopperReflex, DecisionRing and LearnStats classes bound to their
// namespaces, on either shopper host.
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

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w25-b1-fixture-policy', revision: 1, durationMs: 3650 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

interface DurableRegistry { data: Map<string, unknown>; object: { fetch: (request: Request) => Promise<Response> } }

interface Mounted {
  env: Env;
  cache: UnitKV;
  storage: UnitR2;
  stats: Map<string, DurableRegistry>;
  shoppers: Map<string, DurableRegistry>;
  fetch: (input: Request) => Promise<Response>;
  drain: () => Promise<void>;
  operatorToken: string;
}

const HOSTS = ['session', 'do'] as const;

async function mount(host: (typeof HOSTS)[number] = 'session', options: { learn?: LearnConfig; priors?: PriorsDoc } = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const cache = new UnitKV(), sessions = new UnitKV(), storage = new UnitR2();
  const stats = new Map<string, DurableRegistry>(), shoppers = new Map<string, DurableRegistry>(), rings = new Map<string, DurableRegistry>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: cache, SESSIONS: sessions,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host, STORAGE: storage,
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w25-b1-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    LEDGER_RECOVERY_ENABLED: 'false',
    EVENT_QUEUE: { send: async () => undefined },
  } as unknown as Env;
  env.RETENTION = JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) });

  /** One namespace per class, each instance the REAL class over a storage stub. */
  const namespaceFor = (make: (state: DurableObjectState, env: Env) => { fetch: (request: Request) => Promise<Response> }, registry: Map<string, DurableRegistry>) => ({
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

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w25-b1-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, W25_CATALOGUE),
    baseline(SLOTS_KIND, W25_SLOTS),
    baseline(LEARN_KIND, options.learn ?? W25_LEARN),
    // The statistics object reads the tenant's prior document before it can
    // answer a snapshot at all (`src/durable-objects/LearnStats.ts:603-623`).
    baseline(PRIORS_KIND, options.priors ?? EMPTY_PRIORS),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env, {
    waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {},
  } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, cache, storage, stats, shoppers, fetch: fetchOne, drain, operatorToken };
}

type Answer = { status: number; body: Record<string, unknown> };

async function operatorGet(m: Mounted, path: string): Promise<Answer> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, { headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT } }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

async function operatorSend(m: Mounted, method: 'POST' | 'PUT', path: string, body: unknown, contentType = 'application/json', extra: Record<string, string> = {}): Promise<Answer> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method,
    headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT, 'Content-Type': contentType, 'Idempotency-Key': crypto.randomUUID(), ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
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

/** `PUT /content/priors` as an operator: the DS's own import door. */
const putPriors = (m: Mounted, doc: PriorsDoc) =>
  operatorSend(m, 'PUT', `/content/priors?scope=${TENANT}`, doc, 'application/json', authoredHeaders(m, 'prior'));
/** The same door with the CSV a warehouse exports. */
const putPriorsCsv = (m: Mounted, csv: string) =>
  operatorSend(m, 'PUT', `/content/priors?scope=${TENANT}`, csv, 'text/csv', authoredHeaders(m, 'prior'));

/** The statistics object for one slot, in process, through its namespace. */
const statsObject = (m: Mounted, slot: string) =>
  m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(statsName(TENANT, BRAND, slot)));

async function statsCall(m: Mounted, slot: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await statsObject(m, slot).fetch(new Request('https://learn' + path,
    body === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(body) }));
  return await response.json() as Record<string, unknown>;
}

/** The slot's configuration exactly as the published learning document states it. */
const slotConfig = (slot: 'hero' | 'story') => ({
  reward: slot === 'hero' ? 'click' as const : 'purchase' as const,
  stats: DEFAULT_STATS,
  objective: slot === 'hero' ? 'unit' as const : 'revenue' as const,
  measurementBasis: 'served-v1' as const,
});

/** Live exposures and credits into the real statistics object, as the fan does. */
async function feed(m: Mounted, slot: 'hero' | 'story', item: string, cell: Cell, exposures: number, credits = 0): Promise<void> {
  const config = slotConfig(slot);
  await statsCall(m, slot, '/exposures', { tenant: TENANT, brand: BRAND, slot, config,
    exposures: Array.from({ length: exposures }, () => ({ item, cell, ts: Date.now() })) });
  if (credits > 0) {
    await statsCall(m, slot, '/credits', { tenant: TENANT, brand: BRAND, slot, config,
      credits: Array.from({ length: credits }, (_, i) => ({ decision_id: `w25-${item}-${i}`, slot, item, cell,
        reward: config.reward, event: config.reward, ts: Date.now(), weight: 1 })) });
  }
}

const CSV_HEADER = 'slot,item,cell,p_prior,n_equiv';
const csvRow = (r: { slot: string; item: string; cell: string; p_prior: number; n_equiv: number }) =>
  `${r.slot},${r.item},"${r.cell}",${r.p_prior},${r.n_equiv}`;
const warehouseCsv = (rows: Array<{ slot: string; item: string; cell: string; p_prior: number; n_equiv: number }>) =>
  [CSV_HEADER, ...rows.map(csvRow)].join('\n') + '\n';

// ===========================================================================
// unit:W25.G1.01 — the canonical, versioned cell grammar at every supported level
// ===========================================================================

describe('unit:W25.G1.01', () => {
  it('logic: a prior at every ladder depth reaches a cold item and the finer overrides the coarser, and the grammar accepts only `*` or a prefix of the canonical ladder order, refusing a wrong order, an unknown key, a skipped level and a document exported under an older order', () => {
    const st = warmState();

    // ── LOCKED (F20 §7's regression cases; reverses if the structured index of
    // `src/learn/priors.ts:69-82` is replaced by a flat key the reader splits).
    for (const [level, key] of LADDER.entries()) {
      const snap = snapshotOf(st, [{ slot: 'hero', item: COLD, cell: key, p_prior: PRIOR_P, n_equiv: PRIOR_N }]);
      expect(Object.keys(snap.items).sort(), `depth ${level}: the real item ids, no phantom`).toEqual([COLD, WARM]);
      expect(Object.keys(snap.items[COLD]!), `depth ${level}: the prior materializes at its own key`).toEqual([key]);
      expect(snap.slotRates, `depth ${level}: no fragment of a cell key becomes a slot rate`).not.toHaveProperty('v=1');
      const look = liftFor(snap, COLD, COACH_CELL)!;
      expect(look, `depth ${level}: the cold item has an estimate from its prior`)
        .toMatchObject({ level, n: 0, s: 0, n0: PRIOR_N, prior: { p: PRIOR_P, n: PRIOR_N } });
      expect(look.p0).toBeCloseTo(P_REFERENCE, 12);      // (5 + 30×0.05)/(100+30)
      expect(look.p_hat).toBeCloseTo(PRIOR_P, 12);       // (0 + 200×0.1)/(0+200)
      expect(look.lift).toBeCloseTo(2, 12);              // min(2, 0.1/0.05)
    }
    // A finer prior overrides the coarser one, in either import order (F20 §4.1).
    const coarse = { slot: 'hero', item: COLD, cell: 'c=direct', p_prior: 0.12, n_equiv: 50 };
    const fine = { ...coarse, cell: 'c=direct|v=1', p_prior: 0.02, n_equiv: 400 };
    for (const rows of [[coarse, fine], [fine, coarse]]) {
      const snap = snapshotOf(st, rows);
      // p̂ = (0 + 400×0.02)/400 = 0.02; lift = max(0.5, 0.02/0.05 = 0.4) = 0.5
      expect(liftFor(snap, COLD, COACH_CELL)).toMatchObject({ level: 2, n: 0, n0: 400, prior: { p: 0.02, n: 400 }, lift: 0.5 });
      // Outside the finer prior's cell the coarser one answers: p̂ = 0.12, lift = min(2, 0.12/0.05) = 2
      expect(liftFor(snap, COLD, { ...COACH_CELL, visit_bucket: '2-3' })).toMatchObject({ level: 1, prior: { p: 0.12, n: 50 }, lift: 2 });
    }
    // A warm item whose live evidence is in another cell still receives its
    // prior in the cell the prior names (F20 §4.2). Slot root: n = 40, s = 2 →
    // p₀ = 0.05; rate = (2 + 30×0.05)/(40+30) = 3.5/70 = 0.05 at every key.
    const elsewhere = emptyStats();
    for (let i = 0; i < 40; i++) recordExposure(elsewhere, CROSS, SEARCH_CELL, NOW, DEFAULT_STATS);
    for (let i = 0; i < 2; i++) recordSuccess(elsewhere, CROSS, SEARCH_CELL, 'click', NOW, 1, DEFAULT_STATS);
    const wrongCell = snapshotOf(elsewhere, [{ slot: 'hero', item: CROSS, cell: 'c=direct|v=1', p_prior: 0.2, n_equiv: 100 }]);
    const inDirect = liftFor(wrongCell, CROSS, COACH_CELL)!;
    expect(inDirect, 'the prior applies in the cell it names, not nowhere').toMatchObject({ level: 2, n: 0, n0: 100, prior: { p: 0.2, n: 100 } });
    expect(inDirect.p_hat).toBeCloseTo(0.2, 12);         // (0 + 100×0.2)/100
    expect(inDirect.lift).toBeCloseTo(2, 12);            // min(2, 0.2/0.05 = 4)
    expect(liftFor(wrongCell, CROSS, SEARCH_CELL)).toMatchObject({ level: 5, n0: DEFAULT_STATS.n0 });

    // ── RED: the cell grammar is the LADDER grammar, and it is versioned.
    // F20 §4.7 and §7: "reject any cell that is not '*' or a prefix of the
    // canonical ladder key order c=, v=, s=, r=, a="; the kit already states it
    // (docs/kit/03-payload-schemas.md:425-426, "pairs in the ladder's order").
    expect(CELL_GRAMMAR, 'src/learn/priors.ts exports CELL_GRAMMAR: the canonical ladder key order, versioned, with its migration named').toBeDefined();
    expect(CELL_GRAMMAR.order, 'F20 §4.7: the canonical ladder key order').toEqual(['c', 'v', 's', 'r', 'a']);
    expect(Number.isInteger(CELL_GRAMMAR.version) && CELL_GRAMMAR.version >= 1, 'the order carries a version').toBe(true);
    expect(typeof CELL_GRAMMAR.migration === 'string' && CELL_GRAMMAR.migration.length > 0, 'and names its migration').toBe(true);
    // The grammar and the ladder the snapshot builds are the SAME order.
    expect(LADDER.slice(1).map(key => key.split('|').map(pair => pair.split('=')[0]).join(','))
      .map(prefix => prefix.split(',')))
      .toEqual((CELL_GRAMMAR.order as readonly string[]).map((_key: string, i: number) => (CELL_GRAMMAR.order as readonly string[]).slice(0, i + 1)));

    const rows = (cell: string) => [{ slot: 'hero', item: COLD, cell, p_prior: PRIOR_P, n_equiv: PRIOR_N }];
    for (const key of LADDER) {
      expect(validatePriors({ rows: rows(key) }).ok, `${key} is '*' or a prefix of the canonical order`).toBe(true);
    }
    for (const [cell, why] of [
      ['v=1|c=direct', 'the wrong order'],
      ['zzz=1', 'an unknown key'],
      ['c=direct|v=1|r=US-NY', 'a skipped level'],
      ['stage=early', 'a key that is not a ladder key'],
      ['c=direct|v=1|s=early|r=US-NY|a=occasion:evening|x=1', 'a level past the ladder'],
    ] as const) {
      const result = validatePriors({ rows: rows(cell) });
      expect(result.ok, `${cell} (${why}) is refused`).toBe(false);
      const errors = result.ok ? [] : result.errors;
      expect(errors.join(' '), `${cell}: the error names the row`).toMatch(/rows\[0\]/);
      expect(errors.join(' '), `${cell}: the error names the expected order`).toMatch(/c=.*v=.*s=.*r=.*a=/);
    }
    // The document declares the grammar it was exported under; the pre-CW29
    // order (`c=|v=|r=|a=`, F20 §4.7) is refused with the migration named,
    // never silently dead.
    const older = { name: CELL_GRAMMAR.name, version: CELL_GRAMMAR.version - 1, order: ['c', 'v', 'r', 'a'] };
    const stale = validatePriors({ cellGrammar: older, rows: rows('c=direct') });
    expect(stale.ok, 'a file exported under the older ladder order is refused').toBe(false);
    const staleErrors = (stale.ok ? [] : stale.errors).join(' ');
    expect(staleErrors, 'the refusal names the document field').toMatch(/cellGrammar/);
    expect(staleErrors, 'and the order this engine supports').toMatch(/c=.*v=.*s=.*r=.*a=/);
    expect(staleErrors, 'and the migration by name').toContain(CELL_GRAMMAR.migration);
    // Declaring the current grammar is accepted and retained on the document.
    const current = { name: CELL_GRAMMAR.name, version: CELL_GRAMMAR.version, order: [...CELL_GRAMMAR.order] };
    const fresh = validatePriors({ cellGrammar: current, rows: rows('c=direct|v=1') });
    expect(fresh.ok, 'a file exported under the current order is accepted').toBe(true);
    expect(fresh.ok && fresh.value.cellGrammar, 'and the document keeps what it declared').toEqual(current);
  });

  it('host: the import door refuses a cell that is not a prefix of the canonical ladder order and a file exported under an older order, as JSON rows and as the CSV a warehouse exports, and accepts every ladder prefix', async () => {
    const m = await mount();
    // LOCKED: every canonical prefix is importable through the shipped door.
    for (const key of LADDER) {
      const ok = await putPriors(m, { rows: [{ slot: 'hero', item: COLD, cell: key, p_prior: PRIOR_P, n_equiv: PRIOR_N }] });
      expect(ok.status, `${key} imports`).toBe(200);
      expect(ok.body).toMatchObject({ ok: true, document: { rows: [{ slot: 'hero', item: COLD, cell: key }] } });
    }
    const csvOk = await putPriorsCsv(m, warehouseCsv([{ slot: 'hero', item: COLD, cell: 'c=direct|v=1', p_prior: PRIOR_P, n_equiv: PRIOR_N }]));
    expect(csvOk.status, 'the warehouse CSV of a depth-2 prior imports').toBe(200);
    expect(csvOk.body).toMatchObject({ ok: true, document: { rows: [{ cell: 'c=direct|v=1', p_prior: PRIOR_P, n_equiv: PRIOR_N }] } });

    // RED: the same door refuses the three silent-no-op grammars F20 §4.7 names.
    for (const cell of ['v=1|c=direct', 'zzz=1', 'c=direct|v=1|r=US-NY']) {
      const bad = await putPriors(m, { rows: [{ slot: 'hero', item: COLD, cell, p_prior: PRIOR_P, n_equiv: PRIOR_N }] });
      expect(bad.status, `${cell} is refused at import`).toBe(422);
      expect(JSON.stringify(bad.body.errors), `${cell}: the refusal names the expected order`).toMatch(/c=.*v=.*s=.*r=.*a=/);
    }
    const badCsv = await putPriorsCsv(m, warehouseCsv([{ slot: 'hero', item: COLD, cell: 'c=direct|v=1|r=US-NY', p_prior: PRIOR_P, n_equiv: PRIOR_N }]));
    expect(badCsv.status, 'the CSV import obeys the same rule').toBe(422);
    expect(JSON.stringify(badCsv.body.errors)).toMatch(/c=.*v=.*s=.*r=.*a=/);

    const stale = await putPriors(m, { cellGrammar: { name: CELL_GRAMMAR.name, version: CELL_GRAMMAR.version - 1, order: ['c', 'v', 'r', 'a'] },
      rows: [{ slot: 'hero', item: COLD, cell: 'c=direct', p_prior: PRIOR_P, n_equiv: PRIOR_N }] } as unknown as PriorsDoc);
    expect(stale.status, 'a pre-CW29 export is refused at the door').toBe(422);
    expect(JSON.stringify(stale.body.errors), 'with the migration named').toContain(CELL_GRAMMAR.migration);
  });
});

// ===========================================================================
// unit:W25.N1.01 — no-event publication
// ===========================================================================

describe('unit:W25.N1.01', () => {
  it('host-internal: a slot whose only evidence is an imported prior publishes a snapshot carrying the prior-derived estimate, an unprior\'d empty slot publishes nothing, and `/reset-item` restarts an item from its depth-2 prior', async () => {
    const m = await mount('session', { priors: { version: 'w25-warehouse', rows: [
      { slot: 'hero', item: COLD, cell: 'c=direct|v=1', p_prior: PRIOR_P, n_equiv: PRIOR_N },
    ] } });

    // LOCKED: the gate stays for a slot with neither events nor priors
    // (`src/durable-objects/LearnStats.ts:558`). `story` carries no prior row.
    expect(await statsCall(m, 'story', '/publish'), 'an unprior\'d, eventless slot publishes nothing')
      .toEqual({ ok: true, published: false, snapshot: null });

    // RED: the prior'd slot publishes. Doc 22 §8 and F20 §4.5: "an item with a
    // prior and no live events yet has an estimate" must hold END TO END, so
    // the snapshot reaches KV before the slot has recorded a single exposure.
    const published = await statsCall(m, 'hero', '/publish');
    expect(published.published, 'a slot with imported priors and zero live events publishes').toBe(true);
    const snap = published.snapshot as LiftSnapshot;
    expect(snap.events, 'and states that it has no live events').toBe(0);
    const stat = snap.items[COLD]!['c=direct|v=1']!;
    expect(stat, 'the prior-derived estimate, with the prior strength as n₀ and no observed exposure')
      .toMatchObject({ level: 2, key: 'c=direct|v=1', n: 0, s: 0, n0: PRIOR_N, prior: { p: PRIOR_P, n: PRIOR_N } });
    expect(stat.p_hat).toBeCloseTo(PRIOR_P, 12);          // (0 + 200×0.1)/(0+200)
    expect(snap.priorVersion, 'built from the tenant\'s published prior revision').toBe(1);
    // The slot has no rate in any cell yet, so this estimate has NO reference:
    // the one representation W25.Z1.01 rules, asserted here on the same fixture.
    expect(stat.liftReference, 'a prior-only slot has no reference to compare against').toBe('none');

    // LOCKED (measured green at the base commit once the slot is past the
    // publish gate): `/reset-item` at depth ≥ 2 (F20 §4.6) restarts the item
    // FROM the prior — doc 22 §12.2 — instead of deleting it from the lift
    // table. Reverses with the union of prior keys at `src/learn/stats.ts:236-239`.
    await feed(m, 'hero', COLD, COACH_CELL, 40, 4);
    const warm = (await statsCall(m, 'hero', '/snapshot')).snapshot as LiftSnapshot;
    expect(warm.items[COLD]!['c=direct|v=1']!.n, 'the item now has live evidence').toBeGreaterThan(0);
    expect(await statsCall(m, 'hero', '/reset-item', { item: COLD, tenant: TENANT, brand: BRAND, slot: 'hero' }))
      .toMatchObject({ ok: true, item: COLD, had: true });
    const after = (await statsCall(m, 'hero', '/snapshot')).snapshot as LiftSnapshot;
    expect(after.items[COLD]?.['c=direct|v=1'], 'after the reset the item starts again from its prior')
      .toMatchObject({ n: 0, s: 0, n0: PRIOR_N, prior: { p: PRIOR_P, n: PRIOR_N } });
  });

  it('host: after the warehouse CSV is imported into a slot that has never been served, the operator\'s publish answers published and the lift rows show the prior-derived estimate with no observed exposure', async () => {
    const m = await mount();
    expect((await putPriorsCsv(m, warehouseCsv([{ slot: 'hero', item: COLD, cell: 'c=direct|v=1', p_prior: PRIOR_P, n_equiv: PRIOR_N }]))).status).toBe(200);

    const publish = await operatorSend(m, 'POST', `/v1/${TENANT}/learn/publish`, { slot: 'hero', brand: BRAND });
    expect(publish.status).toBe(200);
    expect(publish.body, 'the slot publishes on its priors alone').toMatchObject({ ok: true, published: true });

    const rows = await operatorGet(m, `/v1/${TENANT}/lift/rows?slot=hero&level=cells&brand=${BRAND}`);
    expect(rows.status).toBe(200);
    expect(rows.body).toMatchObject({ ok: true, published: true });
    const row = (rows.body.rows as Array<Record<string, unknown>>).find(r => r.item === COLD && r.key === 'c=direct|v=1');
    expect(row, 'the cold item is on the operator\'s lift grid').toMatchObject({
      item: COLD, key: 'c=direct|v=1', level: 2, n: 0, s: 0, n0: PRIOR_N, prior: { p: PRIOR_P, n: PRIOR_N }, evidence: 0,
    });
  });
});

// ===========================================================================
// unit:W25.Z1.01 — zero reference and unit compatibility (MECHANISM only;
// every VALUE belongs to W25.P1.01, D09)
// ===========================================================================

describe('unit:W25.Z1.01', () => {
  it('logic: an exactly zero pre-lift base stays zero under a prior-derived lift, a slot with no rate in the cell answers that its reference is undefined instead of a lift of one, and a probability prior on a money-objective slot is refused with the unit named', () => {
    // ── LOCKED (W16.C7, settled HANDOFF-2026-09-18 §7 item 7; the observable is
    // W16.C7.01's ruled member `explain.lift.applied`, reused by name and not
    // re-specified here). Reverses at `src/content/decide.ts:335`.
    const priored = snapshotOf(warmState(), [{ slot: 'hero', item: COLD, cell: '*', p_prior: PRIOR_P, n_equiv: PRIOR_N }]);
    const zeroBase = decideContent({
      tenant: TENANT, brand: BRAND, page: 'home', visitorId: 'w25-z1', sessionId: 's', identityAnchor: 'visitor',
      nowMs: NOW, pieces: [W25_PIECES[1]!], slots: [{ ...HERO, take: 1 }],
      // No interest in anything this piece carries: the final pre-lift base is
      // exactly zero, and a multiplicative term cannot move it (N20).
      affinity: { dims: {} }, cell: COACH_CELL, arm: 'personalized',
      versions: { config: 1, catalog: 2, slots: 3, learn: 4, lift: priored.version, prior: 7, policy: 4 }, configLabel: 'w25',
      learning: { snapshots: { hero: priored }, gammaOf: () => 1 },
    }).records[0]!;
    expect(zeroBase.explain.score_base, 'nothing the shopper is interested in').toBe(0);
    expect(zeroBase.explain.lift, 'the prior-derived lift IS reported').toMatchObject({ lift: 2, prior: { p: PRIOR_P, n: PRIOR_N } });
    expect(zeroBase.explain.lift!.applied, 'and it moved the ranking by exactly nothing').toBe(0);
    expect(zeroBase.explain.score_final).toBe(0);

    // ── RED: an undefined reference is answered as undefined. A slot served 100
    // times that has never converted has s = 0, so p₀ = 0 at every level and
    // `src/learn/stats.ts:249` reports lift = 1 — a number no evidence supports.
    const served = emptyStats();
    for (let i = 0; i < 100; i++) recordExposure(served, WARM, COACH_CELL, NOW, DEFAULT_STATS);
    const noReference = snapshotOf(served, [{ slot: 'hero', item: COLD, cell: 'c=direct|v=1', p_prior: PRIOR_P, n_equiv: PRIOR_N }]);
    expect(noReference.slotRates['*']!.rate, 'the slot has no rate to compare against').toBe(0);
    for (const [item, key] of [[WARM, '*'], [COLD, 'c=direct|v=1']] as const) {
      expect(noReference.items[item]![key]!.liftReference, `${item}/${key}: the answer says the reference is undefined`).toBe('none');
    }
    expect(liftFor(noReference, COLD, COACH_CELL)!.liftReference, 'and the lookup the decision path reads says it too').toBe('none');
    // The reversing control: the same prior on a slot that HAS a rate.
    const withReference = snapshotOf(warmState(), [{ slot: 'hero', item: COLD, cell: 'c=direct|v=1', p_prior: PRIOR_P, n_equiv: PRIOR_N }]);
    expect(withReference.items[COLD]!['c=direct|v=1']!.liftReference, 'a slot rate IS the reference when there is one').toBe('slot-rate');
    expect(liftFor(withReference, COLD, COACH_CELL)!.liftReference).toBe('slot-rate');

    // ── RED: unit compatibility. `p_prior` is constrained to a probability
    // (`src/learn/priors.ts:39`), the kit promises "the rate your team estimated
    // elsewhere in the selected objective unit" (kit 03:426) and `story` learns
    // in `revenue` (F20 §1.5: today the incompatible prior is applied silently
    // and demotes the item to the lift floor). The platform must refuse to guess
    // what a probability means on a money slot; what it SHOULD mean is D09 and
    // belongs to W25.P1.01.
    const money: PriorsDoc = { rows: [
      { slot: 'story', item: COLD, cell: '*', p_prior: 0.05, n_equiv: PRIOR_N },
      { slot: 'hero', item: COLD, cell: '*', p_prior: 0.05, n_equiv: PRIOR_N },
    ] };
    const objectiveOf = (slot: string) => (slot === 'story' ? 'revenue' as const : 'unit' as const);
    const refusals = priorUnitErrors(money, objectiveOf);
    expect(refusals, 'exactly the money row is refused').toHaveLength(1);
    expect(refusals[0], 'the refusal names the row').toMatch(/rows\[0\]/);
    expect(refusals[0], 'the slot').toContain('story');
    expect(refusals[0], 'its objective').toContain('revenue');
    expect(refusals[0], 'and the unit the prior is in').toMatch(/probability|0\.\.1/);
    // The control: the same probability prior on a unit-objective slot is
    // compatible and is not refused.
    expect(priorUnitErrors({ rows: [money.rows[1]!] }, objectiveOf)).toEqual([]);
  });

  it('host: the import door refuses a probability prior for the money-objective slot with the unit named and accepts the same prior for the unit-objective slot, and the operator grid states that a slot with no rate has no reference', async () => {
    const m = await mount();
    // RED: the money slot refuses at the door the DS actually uses.
    const money = await putPriors(m, { rows: [{ slot: 'story', item: COLD, cell: '*', p_prior: 0.05, n_equiv: PRIOR_N }] });
    expect(money.status, 'a [0,1] prior on a revenue slot is refused as unit-incompatible').toBe(422);
    const said = JSON.stringify(money.body.errors);
    expect(said, 'naming the slot').toContain('story');
    expect(said, 'its objective').toContain('revenue');
    expect(said, 'and the unit the prior is in').toMatch(/probability|0\.\.1/);
    // The control: the unit-objective slot takes the same row.
    expect((await putPriors(m, { rows: [{ slot: 'hero', item: COLD, cell: '*', p_prior: 0.05, n_equiv: PRIOR_N }] })).status).toBe(200);

    // RED: a slot served and never converted publishes rows whose reference is
    // undefined, and the operator surface says so rather than showing lift 1.
    await feed(m, 'hero', WARM, COACH_CELL, 100, 0);
    expect((await operatorSend(m, 'POST', `/v1/${TENANT}/learn/publish`, { slot: 'hero', brand: BRAND })).body).toMatchObject({ published: true });
    const rows = await operatorGet(m, `/v1/${TENANT}/lift/rows?slot=hero&brand=${BRAND}`);
    const pooled = (rows.body.rows as Array<Record<string, unknown>>).find(r => r.item === WARM);
    expect(pooled, 'the item the slot has served').toMatchObject({ item: WARM, key: '*', p0: 0 });
    expect(pooled!.liftReference, 'with its reference named as undefined, not a lift of one').toBe('none');
  });
});

// ===========================================================================
// unit:W25.V1.01 — prior provenance without phantom rows
// ===========================================================================

describe('unit:W25.V1.01', () => {
  it('logic: the snapshot and the row keep observed n apart from prior strength n0, and the receipt names the terms of a prior-derived lift — the prior, its strength and the prior document revision — without calling prior-only information observed exposures', () => {
    // ── LOCKED (kit 02:316, "raw snapshot/decision n and s remain observed
    // counts, while n0, prior {p,n} and the prior revision identify imported
    // strength"). Reverses at `src/learn/stats.ts:247-250`.
    const st = warmState();
    for (let i = 0; i < 10; i++) recordExposure(st, COLD, COACH_CELL, NOW, DEFAULT_STATS);
    const snap = snapshotOf(st, [{ slot: 'hero', item: COLD, cell: 'c=direct|v=1', p_prior: PRIOR_P, n_equiv: PRIOR_N }], 12);
    const stat = snap.items[COLD]!['c=direct|v=1']!;
    expect(stat.n, 'ten observed exposures, and only ten').toBeCloseTo(10, 12);
    expect(stat.n0, 'the prior\'s strength is not an observation').toBe(PRIOR_N);
    expect(stat.prior).toEqual({ p: PRIOR_P, n: PRIOR_N });
    expect(snap.priorVersion, 'the snapshot names the prior document revision it was built with').toBe(12);
    // p̂ = (0 + 200×0.1)/(10 + 200) = 20/210
    expect(stat.p_hat).toBeCloseTo(20 / 210, 12);

    // ── RED: the receipt names the terms of the lift it reports. The receipt's
    // `why` array is locked verbatim by `src/learn/receipts.test.ts:39-51`, so
    // the numbers are a MEMBER — `lift_terms`, W23.X1.02's ruled member, reused
    // by name — never a new sentence (ruling R127).
    const look = liftFor(snap, COLD, COACH_CELL)!;
    const record = decideContent({
      tenant: TENANT, brand: BRAND, page: 'home', visitorId: 'w25-v1', sessionId: 's', identityAnchor: 'visitor',
      nowMs: NOW, pieces: [W25_PIECES[1]!], slots: [{ ...HERO, take: 1 }],
      affinity: { dims: { occasion: { evening: 0.8 } } }, cell: COACH_CELL, arm: 'personalized',
      versions: { config: 1, catalog: 2, slots: 3, learn: 4, lift: snap.version, prior: 12, policy: 4 }, configLabel: 'w25',
      learning: { snapshots: { hero: snap }, gammaOf: () => 1 },
    }).records[0]!;
    const receipt = receiptOf(record, new Map([[COLD, { customerContentId: 'CMS-CHARMS-EVENING', title: 'Charms, after six' }]]));
    expect(receipt.lift_terms, 'the receipt carries the terms of the lift as numbers')
      .toMatchObject({ n: look.n, n0: PRIOR_N, prior: { p: PRIOR_P, n: PRIOR_N }, prior_version: 12 });
    // N22: prior-only strength is never presented as observed exposure, so a
    // reader of the sentence can see where the estimate came from.
    const sentence = receipt.why.find(line => /Learned lift/.test(line))!;
    expect(sentence, 'the sentence names the imported prior').toMatch(/prior/i);
    expect(sentence, 'and its strength, beside the observed exposures').toContain(String(PRIOR_N));
  });

  it('host: a prior for an item the catalogue does not carry never counts as an item the slot has learned about, and the lift grid and its CSV carry the prior document revision', async () => {
    const m = await mount();
    expect((await putPriors(m, { rows: [
      { slot: 'hero', item: COLD, cell: 'c=direct|v=1', p_prior: PRIOR_P, n_equiv: PRIOR_N },
      { slot: 'hero', item: GHOST, cell: '*', p_prior: 0.3, n_equiv: PRIOR_N },
    ] })).status).toBe(200);
    await feed(m, 'hero', WARM, COACH_CELL, 100, 5);
    const publish = await operatorSend(m, 'POST', `/v1/${TENANT}/learn/publish`, { slot: 'hero', brand: BRAND });
    expect(publish.body).toMatchObject({ ok: true, published: true });
    const priorVersion = (publish.body.snapshot as LiftSnapshot).priorVersion;
    expect(priorVersion, 'the published snapshot names the prior revision').toBe(2);

    // RED: `evidence.items` counts catalogue items only (F20 §4.4).
    const slots = await operatorGet(m, `/v1/${TENANT}/learn/slots?brand=${BRAND}&evidence=1`);
    const pages = slots.body.pages as Array<{ slots: Array<Record<string, unknown>> }>;
    const hero = pages.flatMap(p => p.slots).find(s => s.slot === 'hero')!;
    expect(hero.evidence, 'two catalogue items are known to this slot: the warm one and the prior\'d cold one')
      .toMatchObject({ items: 2, events: 100 });

    // LOCKED: the rows keep observed n apart from the prior's strength.
    const rows = await operatorGet(m, `/v1/${TENANT}/lift/rows?slot=hero&level=cells&brand=${BRAND}`);
    const row = (rows.body.rows as Array<Record<string, unknown>>).find(r => r.item === COLD && r.key === 'c=direct|v=1')!;
    expect(row).toMatchObject({ n: 0, n0: PRIOR_N, prior: { p: PRIOR_P, n: PRIOR_N }, evidence: 0 });
    // RED: and the grid states WHICH prior document those numbers came from, so
    // the export a data scientist downloads carries the revision too.
    expect(rows.body.priorVersion, 'the lift grid names the prior document revision').toBe(priorVersion);
    const shipped = readFileSync(new URL('../../../public/learning.js', import.meta.url), 'utf8');
    const gridCsvHeader = shipped.slice(shipped.indexOf('function gridCsv()'), shipped.indexOf('function gridCsv()') + 600);
    expect(gridCsvHeader, 'and the shipped grid CSV exports it as a column').toContain('prior_version');
  });
});

// ===========================================================================
// unit:W25.E1.01 — the actual import → receipt → ranking pipeline
// ===========================================================================

describe('unit:W25.E1.01', () => {
  it('host: on both hosts, the warehouse CSV imported through the shipped door ranks a cold item by its depth-2 prior on the decision path, its receipt says the estimate is prior-derived with no observed exposure, and the same shopper without the prior is served the other order', async () => {
    for (const host of HOSTS) {
      for (const withPrior of [true, false]) {
        const m = await mount(host);
        const grant = await newAnonymousSession(m.env, TENANT);
        const call = async (path: string, body?: unknown) => {
          const request = new Request(`https://synthetic.invalid${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const response = await m.fetch(request);
          const parsed = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
          await m.drain();
          return { status: response.status, body: parsed };
        };
        // The shopper says yes to tracking and personalization, so the engine
        // may count her visit and derive her cell at all.
        const preferences = await call(`/realtime/session/${grant.sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true,
          choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp } });
        expect(preferences.status, `${host}: the shopper's own consent choice`).toBe(200);
        // Three real Coach product views, so her interest in `occasion evening`
        // and `line Tabby` is strictly above zero and nothing else is.
        for (let i = 0; i < 3; i++) {
          const action = await call('/realtime/action', { type: 'product_view', source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
            timestamp: Date.now(), eventId: crypto.randomUUID(), data: { productId: `COA-CW62${i}`, line: 'Tabby', category: 'Handbags', occasion: ['evening'], price_usd: 575 } });
          expect(action.status, `${host}: her own event is accepted`).toBe(200);
        }
        // The warm item has been served and clicked; the cold one never has.
        await feed(m, 'hero', WARM, COACH_CELL, 100, 5);
        if (withPrior) {
          expect((await putPriorsCsv(m, warehouseCsv([{ slot: 'hero', item: COLD, cell: 'c=direct|v=1', p_prior: PRIOR_P, n_equiv: 400 }]))).status).toBe(200);
        }
        expect((await operatorSend(m, 'POST', `/v1/${TENANT}/learn/publish`, { slot: 'hero', brand: BRAND })).body).toMatchObject({ published: true });

        const snapshot = await call(`/v1/${TENANT}/decisions/snapshot?page=home&channel=direct`);
        expect(snapshot.status, `${host}: the shopper is served`).toBe(200);
        const decisions = (snapshot.body.decisions as Array<{ slot: string; order: number; contentId: string }>) ?? [];
        const heroItems = decisions.filter(d => d.slot === 'hero').sort((a, b) => a.order - b.order).map(d => d.contentId);
        expect(heroItems, `${host}: both eligible pieces are ranked`).toHaveLength(2);
        // LOCKED (measured green at the base commit, on BOTH hosts): the
        // ranking half of the pipeline already holds — a depth-2 prior imported
        // as CSV does reach the decision path. It reverses with `priorFor`
        // (`src/learn/stats.ts:228-234`) or the union at `:236-239`.
        // Her base score is 0.35×a(evening) for the cold piece and
        // 0.35×a(evening) + 0.25×a(Tabby) for the warm one, so without a prior
        // the warm piece leads. The imported prior gives the cold piece
        // p̂ = 0.1 against a reference of 0.05, i.e. lift 2 at γ = 1, and
        // 2 × 0.35a > 0.35a + 0.25a for every positive interest she can hold:
        // the prior, and only the prior, reverses the order.
        expect(heroItems[0], `${host}: ${withPrior ? 'the prior ranks the cold item first' : 'without the prior the served item leads'}`)
          .toBe(withPrior ? COLD : WARM);

        if (withPrior) {
          // The same decision one layer in, because the shopper-facing route
          // answers in OFFER mode, where a `served-v1` decision captures no
          // record at all (`src/content/service.ts:500-502`) and the body omits
          // `records` (`src/routes/decisions.ts`): no public route exposes a
          // decision receipt (the residual W16.C7.01 already names). This is the
          // owner operation production runs — `requireShopper` →
          // `forwardShopperRequest` → the object's owned operation — so the
          // ring, and the operator's receipt read off it, are the real ones.
          const live = await verifySessionCapability(m.env, grant.capability, TENANT);
          const owner = {};
          const out = await runOwnerOperation(owner, m.env, async () => {
            admitOwnerPrincipal(owner, live);
            return serveContentDecisions(m.env, { tenant: TENANT, page: 'home', visitorId: live.subject, sessionId: live.sessionId,
              channel: 'direct', cf: null, cookieHeader: null, stateTenant: TENANT, principal: live, capability: grant.capability });
          }, m.env.SESSIONS as unknown as Parameters<typeof runOwnerOperation>[3], undefined,
            (async () => m.shoppers.get(shopperObjectName(TENANT, live.subject))?.data.get('consent')) as unknown as Parameters<typeof runOwnerOperation>[5]);
          await out.afterResponse;
          await m.drain();
          const receipts = await operatorGet(m, `/v1/${TENANT}/visitors/${grant.subject}/receipts`);
          expect(receipts.status, `${host}: the operator can read her receipts`).toBe(200);
          const receipt = (receipts.body.receipts as Array<Record<string, unknown>>).find(r => r.item === COLD)!;
          expect(receipt, `${host}: the cold item has a receipt`).toBeTruthy();
          expect(receipt.lift_terms, `${host}: the receipt says the estimate is prior-derived, with no observed exposure`)
            .toMatchObject({ n: 0, n0: 400, prior: { p: PRIOR_P, n: 400 }, prior_version: 1 });
        }
      }
    }
  });
});

// ===========================================================================
// unit:W25.O1.01 — the offline grids and the live table
// ===========================================================================

describe('unit:W25.O1.01', () => {
  it('logic: the day report built from records and the day report built from folded hours both state that their lift grids are prior-free, so a data scientist reconciling them against the live table sees the difference declared instead of two different numbers for the same item', () => {
    const learn = W25_LEARN;
    const record: DecisionRecord = {
      tenant: TENANT, brand: BRAND, decision_id: `${TENANT}:w25:v1:hero`, visitor_id: 'w25-o1', session_id: 's', ts: NOW,
      page: 'home', slot: 'hero', position: 0, item_id: WARM, customer_item_id: 'CMS-TABBY-EVENING',
      arm: 'personalized', explored: false, authority: 'engine', cell: COACH_CELL,
      versions: { config: 1, catalog: 2, slots: 3, learn: 4, lift: 0, prior: 0, policy: 4 }, config_label: 'w25',
      explain: { drivers: [], score_base: 0.28, score_final: 0.28, lift: null },
    } as unknown as DecisionRecord;
    record.retention = captureRetention({ TENANTS: JSON.stringify({ provisioned: [TENANT] }),
      RETENTION: JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) }) } as Env, TENANT, record.ts);

    const raw: DayReport = buildReport({
      tenant: TENANT, brand: BRAND, date: '2026-09-03', learn,
      learning: { name: 'learning', scope: 'session', match: 'direct', credit: 'last', windowsMs: { click: 1_800_000 } },
      reporting: [], decisions: [record], outcomes: [], now: NOW, truncated: false,
    } as unknown as Parameters<typeof buildReport>[0]);
    // RED: the report SAYS what its grid was built with. `src/learn/report.ts:932`
    // and `src/learn/hourly.ts:743` both pass `null` for the priors; W22's fold
    // carries no prior document and its hour aggregates are compared by a
    // computation basis that has no prior revision in it (`src/learn/report.ts:92`,
    // `src/learn/hourly.ts:685-705`), so the honest statement is the declaration,
    // not a silently prior-free number (F20 §4.10, §7: prior-aware offline grids
    // are the M part and are not what closes the failure).
    expect(raw.gridPriors, 'the record-built report declares its grid prior-free').toEqual({ applied: false, priorVersion: 0 });

    const policies = policiesOf(learn);
    const hourStats = warmState();
    const brand = { ...emptyBrand(), decisions: 1, visitorsDay: 1,
      computation: computationBasis(learn, policies.map(p => ({ name: p.name, role: p.role, policy: p })), ['hero'],
        { source: 'hourly-ring', horizonMs: DEFAULT_HORIZON_MS, ringCap: 200 }),
      policies: Object.fromEntries(policies.map(p => [p.name, { policy: p, role: p.role, credits: 0, armCredits: {}, stats: { hero: hourStats } }])),
      arms: { hero: { personalized: 1 } }, exploration: { hero: { decisions: 1, explored: 0 } } };
    const hour: HourAggregate = { version: 1, tenant: TENANT, date: '2026-09-03', hour: 12,
      from: Date.UTC(2026, 8, 3, 12), to: Date.UTC(2026, 8, 3, 13), builtAt: NOW, objects: 1, objectsRead: 1,
      truncated: false, horizonMs: DEFAULT_HORIZON_MS, shards: SHARDS, ringsFolded: true, brands: { [BRAND]: brand } };
    const folded = reportFromHours([hour], { tenant: TENANT, brand: BRAND, date: '2026-09-03' }, learn, NOW, { pending: 0, missing: [] });
    expect(folded.gridPriors, 'the fold-built report declares it too').toEqual({ applied: false, priorVersion: 0 });

    // The declaration matches the grid: no prior term in it — while the live
    // table built from the SAME counts with the tenant's prior document carries
    // the prior, its strength and a different estimate. That difference is now
    // stated rather than silent.
    const offline = folded.grids.hero!.learning!.items[WARM]!['*']!;
    const live = snapshotOf(hourStats, [{ slot: 'hero', item: WARM, cell: '*', p_prior: PRIOR_P, n_equiv: PRIOR_N }], 12).items[WARM]!['*']!;
    expect(offline.n0, 'the offline grid shrinks toward the slot with the configured n₀').toBe(DEFAULT_STATS.n0);
    expect(live.n0, 'the live table shrinks toward the imported prior').toBe(PRIOR_N);
    expect(live.prior, 'and names it').toEqual({ p: PRIOR_P, n: PRIOR_N });
  });
});

// The unknown cell is part of every fixture above by construction: `levelKeys`
// materializes `s=unknown`, `r=none` and `a=none` for a shopper the engine could
// not place, and W25.G1.01's grammar cases below the ladder use it.
void UNKNOWN_CELL;
