// src/units/W28/B1.unit.test.ts
// =============================================================================
// W28-B1 — the Thompson withdrawal complete and consistent; share zero means no
// exploration-induced reorder; the `explored` flag and the recorded candidate
// support truthful; merchandiser controls honoured; the true defaults and the
// documented-but-absent `cooldown` dial.
//
// WITNESSES
//   document 35 §5 row W28 (:430) — "Withdraw unsupported Thompson offers across
//     validator/UI/kit … Share zero means no exploration-induced reorder …
//     Document true defaults."; §2 N25 (:287) — documentation says exploration
//     on by default while shipped documents configure it off.
//   docs/architecture/35-verification-reports/F23.md §2.1 (the share gate inert
//     for Thompson, live for the others), §4.1 (the flag lies twice: position 0
//     only, and `explore.ts` answering null when the draw agrees with the score
//     order — "a decision that WAS made by a random draw is recorded as not
//     explored"; report.ts/hourly.ts count position 0 only, so the
//     realized-against-configured table doc 22 §7 promises is blind), §4.2 (the
//     candidate set sliced AFTER the reorder — "the logged candidate support is
//     already corrupted"), §4.3 (merchandiser reject/freeze bypassed by a mode
//     that ranks on learned counters, and the receipt sentence untrue), §4.6
//     (the documented `cooldown` dial exists in no mode), §4.7 (the one
//     `share: 1` test that cannot observe the gate), §5 (NOT defects: holdout
//     arms protected, pinned slots protected), §7 (withdraw rather than repair;
//     the regression test this suite still lacks: `explorationPick` null for
//     every visitor whose `bucketOf(...) >= share`, parameterised over modes).
//   docs/architecture/22-outcome-learning-design.md §7 (the settings table and
//     "the console reports them separately so the exploration share can be
//     verified rather than trusted"), the ownership table at :676.
//   docs/kit/02-api-reference.md:308-310, docs/kit/03-payload-schemas.md.
//   HANDOFF-2026-09-16 :232 (the withdrawal is implemented; only an approved
//     offered-capability decision re-enables it), HANDOFF-2026-09-18 §7/§8 D05.
//
// RULINGS reused by name: R10, R14, R19-R22, R101, R129, R153(e), R159 (W27's
// replay: an ABSENT historical marker replays the old sampler, a PRESENT
// unknown marker refuses — reused, never re-specified here), R160.
//
// MEASURED PRESENT AND LOCKED (GREEN-AT-SPEC), each with the line that reverses
// it, so a build that undoes the withdrawal fails here:
//   - src/content/kinds.ts:538   — new writes refuse `thompson`.
//   - src/learn/explore.ts:88    — live `explorationPick` refuses `thompson`
//                                  unless the caller holds HISTORICAL_EXPLORATION.
//   - src/learn/explore.ts:107   — the share gate, live for rotation/epsilon.
//   - src/routes/decisions.ts:288 — `learn/exploring` reports the EFFECTIVE mode.
//   - src/learn/rows.ts:201      — the slots page reports the EFFECTIVE mode.
//   - public/console/views.js:413, public/learning.js:522 — neither select
//                                  offers `thompson` (frozen W28.01 tests).
//
// RULED AND ABSENT TODAY (the RED of this batch), by unit:
//   W28.W1.01 — `buildReport`'s exploration row still names the WITHDRAWN mode
//               as the slot's mode with its configured share; the shipped
//               learning console's Exploring panel still prints it as the live
//               mode with a share and a floor.
//   W28.S1.01 — `DEFAULT_EXPLORE`, the compiled default, says rotation at 0.1
//               while every shipped document, the kit and the console say off.
//   W28.C1.01 — a decision the exploration policy DID make is recorded as not
//               explored whenever the draw agreed with the score order; the
//               recorded candidate support is truncated after the reorder.
//   W28.M1.01 — an item a merchandiser `reject`ed or `freeze`d is promoted to
//               first position by rotation, which ranks it on the very learned
//               counters the control removed from its treatment.
//   W28.D1.01 — doc 22 still offers `cooldown` as a per-slot dial with a default
//               of `session`, and still states the exploration default as
//               `rotation, 0.10, 50`.
//
// FIXTURE: one world for the whole batch (Coach's own dimensions and values,
// docs/architecture/tapestry_requirements.txt A.3.6 / :564 occasion_tags), with
// an unknown-value, cross-category piece in it from the start. Every unit of
// this batch scores the same six pieces the same way, so the batch can be green
// at once on one product.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { Hono } from 'hono';
import * as jose from 'jose';

import {
  DEFAULT_EXPLORE, HISTORICAL_EXPLORATION, bucketOf, explorationPick, hourKeyOf,
  type ExploreConfig, type ExploreMode,
} from '@/learn/explore';
import { decideContent } from '@/content/decide';
import { receiptOf } from '@/learn/receipts';
import { buildReport, type ExploreRow } from '@/learn/report';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND, validateLearnConfig } from '@/content/kinds';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { tenantMiddleware } from '@/tenancy/middleware';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { DEFAULT_POLICY } from '@/learn/policy';
import type { Env } from '@/types/env';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotStrategy } from '@/content/types';
import type { LiftSnapshot } from '@/learn/stats';

// ---------------------------------------------------------------------------
// The customer's fixture.
// ---------------------------------------------------------------------------

const TENANT = 'coach';
/** Pinned, so `hourKeyOf` and therefore every bucket in this file is a constant. */
const T0 = Date.parse('2026-09-19T12:00:00.000Z');
const HOUR_KEY = hourKeyOf(T0);
const DAY_MS = 86_400_000;

const piece = (id: string, tags: Record<string, string[]>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial', title: id,
  tags, slotTypes: ['hero'], lifecycle: { status: 'live' },
});

/**
 * Six pieces in catalogue order. The last two are the inputs a real feed carries
 * and a fixture usually forgets: `cnt-rogue` matches only a weakly-held line, and
 * `cnt-unknown` carries an occasion value and a line value this shopper's affinity
 * has never seen, in a category the slot does not weigh at all — it scores zero
 * and is the piece exploration reaches for.
 */
const PIECES: ContentPiece[] = [
  piece('cnt-evening-tabby', { occasion: ['evening'], line: ['Tabby'], category: ['Handbags'], contentType: ['editorial'] }),
  piece('cnt-solo-evening', { occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] }),
  piece('cnt-weekend-tabby', { occasion: ['weekend'], line: ['Tabby'], category: ['Handbags'], contentType: ['editorial'] }),
  piece('cnt-weekend', { occasion: ['weekend'], category: ['Handbags'], contentType: ['editorial'] }),
  piece('cnt-rogue', { line: ['Rogue'], category: ['Handbags'], contentType: ['editorial'] }),
  piece('cnt-unknown', { occasion: ['special-event'], line: ['Willow'], category: ['Footwear'], contentType: ['video'] }),
];

const AFFINITY = { dims: { occasion: { evening: 0.8, weekend: 0.4 }, line: { Tabby: 0.6, Rogue: 0.2 } } };
const HERO: SlotStrategy = { slot: 'hero', take: 1, weights: { occasion: 0.5, line: 0.25 } };

/**
 * Hand-computed from the slot's weights and the shopper's affinity — the sum of
 * `affinity[dim][value] × weight[dim]` over the piece's tags, rounded to three
 * decimals the way the ledger rounds a candidate score:
 *   cnt-evening-tabby  0.8×0.5 + 0.6×0.25 = 0.400 + 0.150 = 0.550
 *   cnt-solo-evening   0.8×0.5                             = 0.400
 *   cnt-weekend-tabby  0.4×0.5 + 0.6×0.25 = 0.200 + 0.150 = 0.350
 *   cnt-weekend        0.4×0.5                             = 0.200
 *   cnt-rogue                    0.2×0.25                  = 0.050
 *   cnt-unknown        no weighted dimension carries a value it holds = 0
 * `category` and `contentType` carry no weight on this slot, so the two
 * cross-category tags move nothing — which is the point of including them.
 */
const SCORE: Record<string, number> = {
  'cnt-evening-tabby': 0.55, 'cnt-solo-evening': 0.4, 'cnt-weekend-tabby': 0.35,
  'cnt-weekend': 0.2, 'cnt-rogue': 0.05, 'cnt-unknown': 0,
};
/** The order the merchandiser's ranking serves without any exploration. */
const SCORED_ORDER = ['cnt-evening-tabby', 'cnt-solo-evening', 'cnt-weekend-tabby', 'cnt-weekend', 'cnt-rogue', 'cnt-unknown'];

/** A lift snapshot carrying only what exploration reads: the root observation count. */
const snapshotOf = (observations: Record<string, number>): LiftSnapshot => ({
  tenant: TENANT, brand: TENANT, slot: 'hero', reward: 'click', version: 11, publishedAt: T0, events: 2000,
  n0: 30, nMin: 30, liftMin: 0.5, liftMax: 2,
  items: Object.fromEntries(Object.entries(observations).map(([id, n]) => [id,
    { '*': { level: 0 as const, key: '*', n, s: 0, p0: 0.1, p_hat: 0.1, lift: 1 } }])),
  slotRates: { '*': { n: 2000, s: 200, rate: 0.1 } },
});

/** Every piece well past any floor this file uses. */
const WELL_OBSERVED = snapshotOf(Object.fromEntries(PIECES.map(p => [p.id, 500])));

const RANKED = SCORED_ORDER.map(id => ({ id, score: SCORE[id]! }));

/** The bucket `explorationPick` itself compares against the share (`explore.ts:90`). */
const bucketAt = (visitorId: string, slot = 'hero') => Math.round(bucketOf(visitorId, slot, HOUR_KEY) * 1000) / 1000;
const SHOPPERS = Array.from({ length: 400 }, (_, i) => `shopper-${i}`);
const insideShare = (share: number) => SHOPPERS.find(v => bucketAt(v) < share)!;

const BASE_DECIDE = {
  tenant: TENANT, brand: TENANT, page: 'home', visitorId: SHOPPERS[0]!, sessionId: 'session-1',
  identityAnchor: 'visitor' as const, nowMs: T0, pieces: PIECES, slots: [HERO], affinity: AFFINITY,
  cell: { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: 'occasion:evening' },
  arm: 'personalized' as const, versions: { config: 1, lift: 11, prior: 0, policy: 0 }, configLabel: 'w28-b1',
};

/** The learning seam as the service builds it (`src/content/service.ts:461-470`), at γ = 0. */
const learningWith = (cfg: ExploreConfig | null, snapshot: LiftSnapshot = WELL_OBSERVED,
  controls: Record<string, { mode: 'reject' | 'freeze'; lift?: number }> = {}) => ({
  snapshots: { hero: snapshot }, gammaOf: () => 0, exploreOf: () => cfg,
  controlOf: (_slot: string, item: string) => controls[item] ?? null,
});

const servedOrder = (set: { records: DecisionRecord[] }) => set.records.filter(r => r.slot === 'hero').map(r => r.item_id);

// ---------------------------------------------------------------------------
// Document witnesses, read from the repository.
// ---------------------------------------------------------------------------

const repoFile = (relative: string) => readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8');
const DOC22 = repoFile('docs/architecture/22-outcome-learning-design.md');
const KIT_PAYLOADS = repoFile('docs/kit/03-payload-schemas.md');
const KIT_API = repoFile('docs/kit/02-api-reference.md');

// ---------------------------------------------------------------------------
// RULED, ABSENT TODAY (R21) and TYPECHECK-VISIBLE: the two members the report's
// exploration row owes when the slot's retained dial names a withdrawn mode.
// They are the words `learn/exploring` already answers with
// (`src/routes/decisions.ts:289`), so the operator reads ONE representation of
// this fact wherever it is reported.
// ---------------------------------------------------------------------------
const configuredModeMember = (row: ExploreRow): ExploreMode | undefined => row.configuredMode;
const unsupportedMember = (row: ExploreRow): boolean | undefined => row.unsupported;

/** One day report over records this file produced, for the §7 exploration table. */
const reportOver = (records: DecisionRecord[], learn: LearnConfig) => buildReport({
  tenant: TENANT, brand: TENANT, date: '2026-09-19', learning: { name: 'learning', ...DEFAULT_POLICY },
  reporting: [], learn, decisions: records, outcomes: [], now: T0 + 3 * 3_600_000, truncated: false,
});

// ---------------------------------------------------------------------------
// The mounted application: the real routes over real Durable Object classes.
// Trimmed from src/units/W20/B3.unit.test.ts's harness, session host.
// ---------------------------------------------------------------------------

const OPERATOR_SECRET = 'w28-b1-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'https://operator.invalid';

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) {
    const v = this.data.get(key);
    return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort();
    const start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      customMetadata: this.metadata.get(key), body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort();
    const start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w28-b1-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = () => ({ [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(c => [c, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy> });

interface Mounted {
  env: Env;
  fetch: (request: Request) => Promise<Response>;
  drain: () => Promise<void>;
  operatorToken: string;
}

async function mount(): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: new UnitKV(), SESSIONS: new UnitKV(), STORAGE: new UnitR2(),
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: 'session',
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w28-b1-proof`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    RETENTION: JSON.stringify({ version: 1, tenants: fixtureCategories() }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => undefined },
  } as unknown as Env;

  const namespaceFor = <T extends { fetch: (request: Request) => Response | Promise<Response> }>(make: (state: DurableObjectState, env: Env) => T) => {
    const registry = new Map<string, T>();
    return {
      idFromName: (n: string) => n,
      get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        let held = registry.get(name);
        if (!held) {
          const data = new Map<string, unknown>(); const alarms: number[] = []; const sockets: WebSocket[] = [];
          const storage = {
            get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
            put: async (k: string | Record<string, unknown>, v?: unknown) => {
              if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
            },
            list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
              structuredClone(new Map([...data].filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
                .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit))),
            transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
              const candidate = structuredClone(data); let deleteAlarm = false; let nextAlarm: number | undefined;
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
          };
          const state = { id: name, storage, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
          held = make(state, env); registry.set(name, held);
        }
        return await held.fetch(new Request(input, init));
      } }),
    };
  };
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e)) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e)) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e)) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));

  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env,
    { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 20)); };
  return { env, fetch: fetchOne, drain, operatorToken };
}

/** The tenant's published documents, with one learn document under test. */
async function publish(m: Mounted, learn: LearnConfig): Promise<void> {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w28-b1-fixture', note: 'fixture', value } });
  await initializePublicationSet(m.env, [
    baseline(CONTENT_KIND, { pieces: PIECES }),
    baseline(SLOTS_KIND, { pages: { home: [HERO] } }),
    baseline(LEARN_KIND, learn),
    baseline(REFLEX_KIND, { ...DEFAULT_REFLEX_CONFIG, version: 'w28-b1-coach-registry' }, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
}

const operatorGet = async (m: Mounted, path: string) => {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, { headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT } }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
};

/** One shopper on the mounted application, consented, asking for the home page. */
async function shopperOn(m: Mounted) {
  const grant = await newAnonymousSession(m.env, TENANT);
  const call = (path: string, body?: unknown) => m.fetch(new Request(`https://synthetic.invalid${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const preferences = await call(`/realtime/session/${grant.sessionId}/preferences`, {
    trackingConsent: true, personalizationEnabled: true,
    choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp },
  });
  expect(preferences.status, await preferences.clone().text()).toBe(200);
  await m.drain();
  return {
    visitorId: grant.subject,
    snapshot: async () => {
      invalidatePublicationCache();
      const response = await call(`/v1/${TENANT}/decisions/snapshot?page=home`);
      const raw = await response.text();
      const body = (() => { try { return JSON.parse(raw) as { decisions?: Array<{ slot: string; contentId: string }> }; } catch { return {}; } })();
      await m.drain();
      return { status: response.status, raw, served: (body.decisions ?? []).filter(d => d.slot === 'hero').map(d => d.contentId) };
    },
  };
}

// ---------------------------------------------------------------------------
// The shipped learning console, rendered in jsdom against a fake platform
// (the harness src/console/learning.render.test.ts uses).
// ---------------------------------------------------------------------------

const pub = (f: string) => readFileSync(new URL(`../../../public/${f}`, import.meta.url), 'utf8');

const CONSOLE_SNAPSHOT = {
  tenant: TENANT, brand: TENANT, slot: 'hero', reward: 'click', objective: 'unit', version: 1_788_000_000_000,
  publishedAt: 1_788_000_000_000, events: 2000, n0: 30, nMin: 30, liftMin: 0.5, liftMax: 2, priorVersion: 0,
  items: { 'cnt-evening-tabby': { '*': { level: 0, key: '*', n: 500, s: 50, p0: 0.1, n0: 30, p_hat: 0.1, lift: 1 } } },
  slotRates: { '*': { n: 2000, s: 200, rate: 0.1 } },
};

async function openConsole(learn: Record<string, unknown>, report: Record<string, unknown>) {
  const okJson = (body: unknown, status = 200) => {
    const value = body as Record<string, unknown>;
    return Response.json(value && value.revision ? { ...value, publication: { revision: 7, digest: 'a'.repeat(64) } } : body, { status });
  };
  const platform = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const u = new URL(url, 'http://console.test'), p = u.pathname + u.search;
    const signed = Boolean(init?.headers?.authorization);
    if (p === '/auth/login') {
      const token = 'h.' + Buffer.from(JSON.stringify({ sub: 'ops-1', exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url') + '.s';
      return okJson({ accessToken: token, refreshToken: 'r', user: { id: 'ops-1', email: 'ops@brand.test', name: 'Test Operator', roles: ['operator'] }, mustChangePassword: false, expiresIn: 900 });
    }
    if (p.startsWith('/content/slots')) return okJson({ ok: true, source: 'stored', revision: 3, document: { pages: { home: [{ slot: 'hero', take: 1, weights: { occasion: 0.5, line: 0.25 } }] } } });
    if (p.startsWith('/content/catalog')) return okJson({ ok: true, revision: 4, document: { pieces: PIECES.map(x => ({ id: x.id, customerContentId: x.customerContentId, title: x.title })) } });
    if (p.startsWith('/content/learn/history')) return okJson({ ok: true, revisions: [{ revision: 2, at: 1_788_000_000_000, actor: 'ops', note: 'first' }] });
    if (p.startsWith('/content/priors/history')) return okJson({ ok: true, revisions: [] });
    if (p.startsWith('/content/learn/validate')) return okJson({ ok: true, valid: true, errors: [] });
    if (p.startsWith('/content/learn')) return okJson({ ok: true, source: 'stored', revision: 2, document: learn });
    if (p.startsWith(`/v1/${TENANT}/lift/history`)) return signed ? okJson({ ok: true, versions: [] }) : okJson({ ok: false }, 401);
    if (p.startsWith(`/v1/${TENANT}/lift`)) return signed ? okJson({ ok: true, snapshot: CONSOLE_SNAPSHOT }) : okJson({ ok: false }, 401);
    if (p.startsWith(`/v1/${TENANT}/learn/proposals`)) return signed ? okJson({ ok: true, proposals: [] }) : okJson({ ok: false }, 401);
    if (u.pathname.endsWith('/learn/report')) return okJson({ ok: true, report: { ...structuredClone(report), tenant: TENANT, brand: TENANT, date: '2026-09-19' } });
    return okJson({ ok: false, error: `unstubbed ${p}` }, 404);
  };
  const dom = new JSDOM(pub('legacy/learning.html'), { url: `http://console.test/learning.html?scope=${TENANT}&slot=hero`, pretendToBeVisual: true, runScripts: 'outside-only' });
  type El = { value: string; click: () => void; textContent: string | null; dispatchEvent: (e: unknown) => boolean };
  const w = dom.window as unknown as Record<string, unknown> & { document: { body: { textContent: string | null }; getElementById: (id: string) => unknown }; eval: (s: string) => unknown; close: () => void };
  w.fetch = platform; w.Headers = Headers; w.TextEncoder = TextEncoder; w.confirm = () => true;
  w.eval(pub('operator-session.js'));
  w.eval(pub('learning.js'));
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 15)); };
  await settle();
  const $ = (id: string) => w.document.getElementById(id) as unknown as El;
  $('sign-in').click(); await settle();
  $('si-email').value = 'ops@brand.test'; $('si-password').value = 'right-password';
  ($('sign-in-form') as unknown as El).dispatchEvent(new (w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
  await settle(); await settle();
  return {
    close: () => w.close(),
    panel: (id: string) => ($(id).textContent ?? '').replace(/\s+/g, ' ').trim(),
    page: () => (w.document.body.textContent ?? '').replace(/\s+/g, ' ').trim(),
  };
}

// ===========================================================================
// unit:W28.W1.01 — the withdrawal complete and consistent.
// ===========================================================================

describe('unit:W28.W1.01', () => {
  const RETAINED: LearnConfig = { version: 'retained-thompson', holdout: { share: 0, salt: '', arms: ['default'] },
    slots: { hero: { gamma: 0, exploration: { mode: 'thompson', share: 0.1, floor: 50 } } } };

  it('logic: a withdrawn mode is refused on write, inert on the decision path, replayable only under the historical marker, and reported by the day report as the mode the engine actually ran', () => {
    // LOCKED (src/content/kinds.ts:538): a new write naming the withdrawn mode is refused by name.
    const refused = validateLearnConfig({ ...RETAINED });
    expect(refused.ok, 'src/content/kinds.ts:538 — a new learn document naming Thompson is refused').toBe(false);
    expect(refused.ok ? '' : refused.errors.join(' '),
      'and the refusal names the supported replacements, so an operator can act on it').toContain('Thompson is unsupported; choose off, rotation or epsilon');
    for (const mode of ['rotation', 'epsilon', 'off'] as const) {
      expect(validateLearnConfig({ ...RETAINED, slots: { hero: { gamma: 0, exploration: { mode, share: 0.1, floor: 50 } } } }).ok,
        `${mode} is a supported mode and stays writable`).toBe(true);
    }

    // LOCKED (src/learn/explore.ts:88): live, the withdrawn sampler never answers …
    const cfg: ExploreConfig = { mode: 'thompson', share: 1, floor: 50 };
    for (const visitor of SHOPPERS.slice(0, 40)) {
      expect(explorationPick({ visitorId: visitor, slot: 'hero', nowMs: T0, ranked: RANKED, snapshot: WELL_OBSERVED, cfg }),
        `src/learn/explore.ts:88 — live exploration refuses the withdrawn mode for ${visitor}`).toBeNull();
    }
    // … and R159's retained historical replay still reproduces the old sampler, by the marker's own name.
    const historical = SHOPPERS.slice(0, 40)
      .map(v => explorationPick({ visitorId: v, slot: 'hero', nowMs: T0, ranked: RANKED, snapshot: snapshotOf({ 'cnt-evening-tabby': 1000, 'cnt-solo-evening': 4, 'cnt-weekend-tabby': 1000 }), cfg }, HISTORICAL_EXPLORATION))
      .filter(p => p !== null);
    expect(historical.length, 'R159 — the retained sampler still answers for an explicitly identified historical replay').toBeGreaterThan(0);
    expect(historical[0]!.mode, 'and it answers as the mode it was').toBe('thompson');

    // LOCKED: a RETAINED document serves the merchandiser's own ranking, unflagged.
    const retained = decideContent({ ...BASE_DECIDE, learning: learningWith({ mode: 'thompson', share: 1, floor: 50 }) });
    expect(servedOrder(retained), 'a retained Thompson dial serves the scored order').toEqual([SCORED_ORDER[0]]);
    expect(retained.records.every(r => r.explored === false), 'and flags nothing').toBe(true);

    // RULED, ABSENT TODAY: doc 22 §7 promises the console "reports them separately so the
    // exploration share can be verified rather than trusted". For a retained withdrawn dial the
    // day report still names `thompson` as the slot's mode and publishes its configured share,
    // so an operator reads "configured 10%, realized 0%" for a policy that is not running at all.
    // The row must state the EFFECTIVE mode and name the retained setting the way
    // `learn/exploring` already does (src/routes/decisions.ts:288-289).
    const records = SHOPPERS.slice(0, 8).flatMap(v => decideContent({ ...BASE_DECIDE, visitorId: v, sessionId: v,
      learning: learningWith({ mode: 'thompson', share: 0.1, floor: 50 }) }).records);
    const row = reportOver(records, RETAINED).exploration.find(e => e.slot === 'hero')!;
    expect(row, 'doc 22 §7 — the exploration table reports the mode the engine RAN, names the retained setting, and publishes no share for a policy that cannot explore')
      .toEqual({ slot: 'hero', decisions: 8, explored: 0, realized: 0, configured: null, mode: 'off', configuredMode: 'thompson', unsupported: true });
    expect(configuredModeMember(row)).toBe('thompson');
    expect(unsupportedMember(row)).toBe(true);
    // The control: a supported mode keeps the row it has today, unqualified.
    const supported: LearnConfig = { ...RETAINED, slots: { hero: { gamma: 0, exploration: { mode: 'rotation', share: 0.1, floor: 50 } } } };
    expect(reportOver(records, supported).exploration.find(e => e.slot === 'hero'),
      'a supported mode is reported exactly as it is configured')
      .toEqual({ slot: 'hero', decisions: 8, explored: 0, realized: 0, configured: 0.1, mode: 'rotation' });
  });

  it('sdk: the shipped learning console presents a retained withdrawn dial as inactive everywhere it presents exploration, not only in the editor', async () => {
    const learn = { holdout: { share: 0, salt: '', arms: ['default'] },
      slots: { hero: { gamma: 0, reward: 'click', exploration: { mode: 'thompson', share: 0.1, floor: 50 } } } };
    // The ruled row of unit W28.W1.01's logic leg, rendered: one representation in both places.
    const report = { date: '2026-09-19', builtAt: 1_788_000_000_000, counts: { decisions: 8, outcomes: 0, visitors: 8, truncated: false },
      policies: [{ name: 'learning', credits: 0 }], holdout: {}, grids: {},
      exploration: [{ slot: 'hero', decisions: 8, explored: 0, realized: 0, configured: null, mode: 'off', configuredMode: 'thompson', unsupported: true }] };
    const c = await openConsole(learn, report);
    try {
      const exploring = c.panel('exploring');
      expect(exploring, 'the Exploring panel states the mode the engine runs for this slot, which is off')
        .toMatch(/Mode\s*off\b/);
      expect(exploring, 'and names the retained setting in the words the editor already uses, so the two pages agree')
        .toContain('Stored Thompson — inactive');
      expect(c.page(), 'the console never presents a withdrawn mode as the live one').not.toMatch(/Mode\s*thompson/);
    } finally { c.close(); }
  });
});

// ===========================================================================
// unit:W28.S1.01 — share zero, the gate, and the true defaults.
// ===========================================================================

describe('unit:W28.S1.01', () => {
  const REMAINING: readonly ExploreMode[] = ['rotation', 'epsilon', 'off'];

  it('logic: no visitor outside the configured share is ever explored in any supported mode, share zero reorders nothing, and the compiled default states what a document with no exploration block actually does', () => {
    // F23 §7's regression test, the one the suite lacks — parameterised over every supported
    // mode and over shares the gate can actually discriminate, never `share: 1` (F23 §4.7).
    for (const mode of REMAINING) for (const share of [0, 0.1, 0.5]) {
      const cfg: ExploreConfig = { mode, share, floor: 50 };
      const under = snapshotOf(Object.fromEntries(PIECES.map(p => [p.id, p.id === 'cnt-unknown' ? 4 : 500])));
      for (const visitor of SHOPPERS) {
        if (bucketAt(visitor) < share) continue;
        expect(explorationPick({ visitorId: visitor, slot: 'hero', nowMs: T0, ranked: RANKED, snapshot: under, cfg }),
          `F23 §7 — ${mode} at share ${share}: bucket ${bucketAt(visitor)} is outside the share, so nothing may explore`).toBeNull();
      }
    }
    // The control, so the sweep above is not vacuous: inside the share, rotation does explore.
    const inside = insideShare(0.5);
    const picked = explorationPick({ visitorId: inside, slot: 'hero', nowMs: T0, ranked: RANKED,
      snapshot: snapshotOf(Object.fromEntries(PIECES.map(p => [p.id, p.id === 'cnt-unknown' ? 4 : 500]))),
      cfg: { mode: 'rotation', share: 0.5, floor: 50 } });
    expect(picked?.pieceId, 'the control: inside the share the under-observed piece is chosen').toBe('cnt-unknown');

    // Share zero: the served order IS the scored order, and no record is flagged, in every mode.
    const plain = decideContent({ ...BASE_DECIDE, visitorId: inside, learning: learningWith(null) });
    expect(servedOrder(plain)).toEqual([SCORED_ORDER[0]]);
    for (const mode of REMAINING) {
      const set = decideContent({ ...BASE_DECIDE, visitorId: inside, candidateLimit: 6,
        learning: learningWith({ mode, share: 0, floor: 50 }, snapshotOf(Object.fromEntries(PIECES.map(p => [p.id, p.id === 'cnt-unknown' ? 4 : 500])))) });
      expect(servedOrder(set), `${mode} at share zero serves the merchandiser's ranking`).toEqual([SCORED_ORDER[0]]);
      expect(set.records.map(r => r.candidates.map(c => c.contentId)).flat(),
        `${mode} at share zero records the scored support in score order`).toEqual(SCORED_ORDER);
      expect(set.records.every(r => r.explored === false), `${mode} at share zero flags nothing`).toBe(true);
    }

    // N25: the compiled default names itself the default. Every shipped statement of the default
    // — doc 22 §7's settings table, docs/kit/03-payload-schemas.md's published value, the kit's
    // "Exploration is off by default" and both editors — says off with no active share. The
    // constant still says rotation at 0.10, so the code's own default contradicts all of them.
    expect(KIT_API, 'the kit states the default').toContain('Exploration is off by default');
    expect(DEFAULT_EXPLORE, 'N25 — the compiled default must state the truth the kit, doc 22 §7 and both editors state: off, with no active share')
      .toEqual({ mode: 'off', share: 0, floor: 50 });
  });

  it('host: on the mounted application a learn document with no exploration block explores nothing, and the exploration answer states the compiled default', async () => {
    const m = await mount();
    await publish(m, { version: 'no-exploration', holdout: { share: 0, salt: '', arms: ['default'] }, slots: { hero: { gamma: 0 } } });
    const shopper = await shopperOn(m);
    const served = await shopper.snapshot();
    expect(served.status, `the page load succeeded: ${served.raw.slice(0, 400)}`).toBe(200);
    expect(served.served, 'with no exploration block the slot serves the merchandiser’s ranking').toEqual([SCORED_ORDER[0]]);

    const answer = await operatorGet(m, `/v1/${TENANT}/learn/exploring?slot=hero`);
    expect(answer.status).toBe(200);
    expect(answer.body.mode, 'src/routes/decisions.ts:288 — a document with no exploration block runs off').toBe('off');
    expect(answer.body.share, 'and reserves no share').toBe(0);
    expect(answer.body.floor, 'the answer falls back to the compiled default floor').toBe(DEFAULT_EXPLORE.floor);
    expect({ mode: DEFAULT_EXPLORE.mode, share: DEFAULT_EXPLORE.share },
      'N25 — the compiled default must be the default the mounted engine actually serves, which is off with no share')
      .toEqual({ mode: answer.body.mode, share: answer.body.share });
  }, 60_000);
});

// ===========================================================================
// unit:W28.C1.01 — the flag, the counts and the recorded candidate support.
// ===========================================================================

describe('unit:W28.C1.01', () => {
  /** Only `cnt-evening-tabby`, the piece the score already ranks first, is under the floor. */
  const LEADER_UNDER_FLOOR = snapshotOf(Object.fromEntries(PIECES.map(p => [p.id, p.id === 'cnt-evening-tabby' ? 4 : 500])));
  /** Only `cnt-unknown`, the lowest-scored piece, is under the floor. */
  const TAIL_UNDER_FLOOR = snapshotOf(Object.fromEntries(PIECES.map(p => [p.id, p.id === 'cnt-unknown' ? 4 : 500])));

  it('logic: a decision the exploration policy made is recorded as the exploration it was even when the draw agreed with the ranking, the realized share can therefore reach the configured one, and the recorded candidate support is the scored support rather than what the reorder left in the slice', () => {
    const inside = insideShare(0.5);
    const bucket = bucketAt(inside);

    // F23 §4.1, second lie: rotation's under-observed piece IS the score leader here, so the
    // policy spent one of its budgeted exploration decisions and the draw agreed with the
    // ranking. The decision was made by the exploration rule; the ledger records it as an
    // ordinary personalized decision, which is what makes the §7 realized share unverifiable.
    const agreed = decideContent({ ...BASE_DECIDE, visitorId: inside, candidateLimit: 6,
      learning: learningWith({ mode: 'rotation', share: 0.5, floor: 50 }, LEADER_UNDER_FLOOR) });
    const agreedRecord = agreed.records.find(r => r.slot === 'hero')!;
    expect(servedOrder(agreed), 'the piece served is the one the exploration rule chose').toEqual(['cnt-evening-tabby']);
    expect(agreedRecord.explored,
      'F23 §4.1 — the exploration rule chose this piece inside the configured share; a draw that agreed with the ranking is still the draw it was').toBe(true);
    expect(agreedRecord.explain.exploration, 'and the record says which rule made it and on what bucket')
      .toMatchObject({ mode: 'rotation', bucket });
    expect(receiptOf(agreedRecord, new Map()).why.join(' '), 'and the receipt says so in the operator’s own words')
      .toContain('Served on purpose to explore (rotation)');

    // The same for epsilon, whose uniform draw lands on the leader for this visitor.
    const uniformLeader = SHOPPERS.find(v => Math.floor(bucketAt(v) * RANKED.length) % RANKED.length === 0 && bucketAt(v) < 1)!;
    const epsilon = decideContent({ ...BASE_DECIDE, visitorId: uniformLeader, candidateLimit: 6,
      learning: learningWith({ mode: 'epsilon', share: 1, floor: 50 }, WELL_OBSERVED) });
    expect(epsilon.records[0]!.explored,
      'F23 §4.1 — epsilon drew uniformly and the draw named the leader; the decision was still randomized').toBe(true);
    expect(epsilon.records[0]!.explain.exploration).toMatchObject({ mode: 'epsilon', bucket: bucketAt(uniformLeader) });

    // doc 22 §7: "so the exploration share can be verified rather than trusted" — with the flag
    // truthful, the realized share is the share of decisions the rule actually decided, which is
    // the hash's own count of visitors inside the share, computed here from `bucketOf` itself.
    const population = SHOPPERS.slice(0, 60);
    const expected = population.filter(v => bucketAt(v) < 0.5).length;
    const records = population.flatMap(v => decideContent({ ...BASE_DECIDE, visitorId: v, sessionId: v, candidateLimit: 6,
      learning: learningWith({ mode: 'rotation', share: 0.5, floor: 50 }, LEADER_UNDER_FLOOR) }).records);
    const learn: LearnConfig = { version: 'rotation-half', holdout: { share: 0, salt: '', arms: ['default'] },
      slots: { hero: { gamma: 0, exploration: { mode: 'rotation', share: 0.5, floor: 50 } } } };
    expect(reportOver(records, learn).exploration.find(e => e.slot === 'hero'),
      'doc 22 §7 — every decision the rule made is counted, so realized can be compared with configured')
      .toEqual({ slot: 'hero', decisions: population.length, explored: expected,
        realized: Math.round((expected / population.length) * 1000) / 1000, configured: 0.5, mode: 'rotation' });

    // F23 §4.2: the recorded support is sliced AFTER the reorder, so the third-highest scored
    // candidate falls out of the record and a replay or an offline estimator reads a support the
    // ranking never had. The limit bounds the SCORED support; a served piece is never dropped.
    const limited = decideContent({ ...BASE_DECIDE, visitorId: inside, candidateLimit: 3,
      learning: learningWith({ mode: 'rotation', share: 0.5, floor: 50 }, TAIL_UNDER_FLOOR) });
    const record = limited.records.find(r => r.slot === 'hero')!;
    expect(servedOrder(limited), 'the exploration served the under-observed piece').toEqual(['cnt-unknown']);
    expect(record.candidates,
      'F23 §4.2 — the top three BY SCORE are the support, whatever the exploration reordered, and the served piece is recorded with them')
      .toEqual([
        { contentId: 'cnt-unknown', score: SCORE['cnt-unknown'] },
        { contentId: 'cnt-evening-tabby', score: SCORE['cnt-evening-tabby'] },
        { contentId: 'cnt-solo-evening', score: SCORE['cnt-solo-evening'] },
        { contentId: 'cnt-weekend-tabby', score: SCORE['cnt-weekend-tabby'] },
      ]);

    // LOCKED: the bucket on the receipt is the one that governed the decision (F23's two smaller
    // notes). Every live pick passes the gate, so the bucket it records is the gate's own input.
    expect(record.explain.exploration!.bucket, 'the recorded bucket is the one the gate compared').toBe(bucket);
    expect(bucket < 0.5, 'and it governed: it is inside the configured share').toBe(true);
  });

  /**
   * MEASURED, and a residual for the lead: the public decision route does not expose the ledger
   * to an ordinary caller. `src/routes/decisions.ts:539` always passes `offer: { pageInstance }`,
   * so `src/content/service.ts:500`'s `captureRecords` is empty for every caller without a
   * trusted synthetic scope and `fanDecisions` never reaches the ring. The record-level clauses
   * of this unit therefore live in the logic leg; this leg proves on the mounted application the
   * one thing the route does answer — that the exploration rule ran, chose, and served — and
   * LOCKS the exploration answer the operator reads for the same slot.
   */
  it('host: on the mounted application the exploration rule runs on the real page load and the operator answer states the rule that ran', async () => {
    const m = await mount();
    await publish(m, { version: 'rotation-live', holdout: { share: 0, salt: '', arms: ['default'] },
      slots: { hero: { gamma: 0, exploration: { mode: 'rotation', share: 1, floor: 50 } } } });
    const shopper = await shopperOn(m);
    const served = await shopper.snapshot();
    expect(served.status, served.raw.slice(0, 400)).toBe(200);
    // This shopper has shown nothing yet and no snapshot is published, so every piece is equally
    // unobserved and the slot ranks in catalogue order. Rotation's rule — fewest observations,
    // ties by id — chooses `cnt-evening-tabby`, which is also what the ranking would have served:
    // the exploration rule made this decision and the draw agreed with the order.
    expect(served.served, 'the exploration rule chose the least-observed piece, which is also the ranking’s leader here').toEqual(['cnt-evening-tabby']);
    // The control, on a second mounted application with no exploration configured: the ranking
    // alone serves the same piece, so the page load above is the rule's decision, not the order's.
    const off = await mount();
    await publish(off, { version: 'rotation-off', holdout: { share: 0, salt: '', arms: ['default'] }, slots: { hero: { gamma: 0 } } });
    const withoutRule = await shopperOn(off);
    expect((await withoutRule.snapshot()).served, 'with no exploration configured the ranking serves the same piece').toEqual(['cnt-evening-tabby']);

    const answer = await operatorGet(m, `/v1/${TENANT}/learn/exploring?slot=hero`);
    expect(answer.status).toBe(200);
    expect({ mode: answer.body.mode, share: answer.body.share, floor: answer.body.floor },
      'the operator answer states the rule that ran on that page load, unqualified: it is a supported mode')
      .toEqual({ mode: 'rotation', share: 1, floor: 50 });
  }, 60_000);
});

// ===========================================================================
// unit:W28.M1.01 — merchandiser controls honoured by every remaining mode.
// ===========================================================================

describe('unit:W28.M1.01', () => {
  it('logic: a piece whose learned treatment a merchandiser took control of is not promoted by exploration on the strength of that same learned evidence, and the receipt sentence stays true', () => {
    const inside = insideShare(0.5);
    // Two pieces are under the floor: `cnt-unknown`, which a merchandiser rejected, and
    // `cnt-rogue`, which is free. Rotation ranks the under-observed by their LEARNED
    // observation counts (`explore.ts:115`, `observationsOf`), and `cnt-unknown` has the fewer,
    // so today it is served first — ranked by the very counters `reject` removed from its
    // treatment (F23 §4.3), while its receipt says it "competes on its base score alone".
    const snapshot = snapshotOf({ ...Object.fromEntries(PIECES.map(p => [p.id, 500])), 'cnt-unknown': 2, 'cnt-rogue': 7 });

    for (const control of [{ mode: 'reject' as const }, { mode: 'freeze' as const, lift: 1.4 }]) {
      const set = decideContent({ ...BASE_DECIDE, visitorId: inside, candidateLimit: 6,
        learning: learningWith({ mode: 'rotation', share: 0.5, floor: 50 }, snapshot, { 'cnt-unknown': control }) });
      expect(servedOrder(set),
        `F23 §4.3 — a ${control.mode}ed piece is not promoted past the merchandiser by the exploration rule; the free under-observed piece is`)
        .toEqual(['cnt-rogue']);
      const record = set.records.find(r => r.slot === 'hero')!;
      expect(record.explored, 'the exploration that did happen is still recorded').toBe(true);
      expect(record.explain.exploration, 'and names the rule and the bucket').toMatchObject({ mode: 'rotation', bucket: bucketAt(inside) });
    }

    // And the sentence the receipt prints for the controlled piece is true of the decision it
    // describes: the piece competed on its base score and nothing promoted it.
    const rejected = decideContent({ ...BASE_DECIDE, visitorId: inside, candidateLimit: 6, slots: [{ ...HERO, take: 6 }],
      learning: learningWith({ mode: 'rotation', share: 0.5, floor: 50 }, snapshot, { 'cnt-unknown': { mode: 'reject' } }) });
    const row = rejected.records.find(r => r.item_id === 'cnt-unknown')!;
    expect(row.explain.control, 'the control is on the record').toBe('reject');
    expect(receiptOf(row, new Map()).why.join(' '),
      'receipts.ts:59 — and the sentence it prints is true: nothing but its base score placed it')
      .toContain('A merchandiser rejected the learned lift for this piece; it competes on its base score alone.');
    expect(row.explored, 'a controlled piece is never recorded as an exploration pick').toBe(false);
    expect(row.position, 'and it kept the position its base score earned it: last of the six').toBe(5);

    // The control: with no merchandiser control the same fixture explores the same piece, so the
    // unit measures the control and not the floor.
    const free = decideContent({ ...BASE_DECIDE, visitorId: inside, candidateLimit: 6,
      learning: learningWith({ mode: 'rotation', share: 0.5, floor: 50 }, snapshot) });
    expect(servedOrder(free), 'uncontrolled, the least-observed piece is the one exploration serves').toEqual(['cnt-unknown']);
  });
});

// ===========================================================================
// unit:W28.D1.01 — the documented dial that does not exist, and the reward-free
// supported modes.
// ===========================================================================

describe('unit:W28.D1.01', () => {
  it('logic: no published document offers a dial the engine does not implement, the exploration defaults are the shipped ones, and the supported modes are stated as the reward-free rules they are', () => {
    // F23 §4.6: `cooldown` is documented with a default of "Session" and exists in no mode —
    // not in `ExploreConfig`, not in the validator, nowhere in src/. Every mention of it in a
    // published document must therefore be struck or marked not delivered.
    for (const [name, text] of [['docs/architecture/22-outcome-learning-design.md', DOC22],
      ['docs/kit/03-payload-schemas.md', KIT_PAYLOADS], ['docs/kit/02-api-reference.md', KIT_API]] as const) {
      for (const [index, line] of text.split('\n').entries()) {
        if (!/cooldown/i.test(line)) continue;
        expect(line, `F23 §4.6 — ${name}:${index + 1} offers \`cooldown\`, which no mode implements; strike it or mark it not delivered`)
          .toMatch(/not delivered|not implemented|not offered/i);
      }
    }

    // N25 / document 35 §5 W28 "Document true defaults": the ownership table still publishes the
    // exploration default as `rotation, 0.10, 50, session`, while the shipped learn document
    // configures no exploration at all and §7's own settings table says `off`.
    const ownership = DOC22.split('\n').find(line => /^\|\s*Exploration\s*\|/.test(line));
    expect(ownership, 'doc 22 names who owns the exploration settings').toBeTypeOf('string');
    expect(ownership!, 'N25 — the ownership table states the shipped default, which is off')
      .toMatch(/\boff\b/);
    expect(DOC22, 'N25 — no published line may state the exploration default as rotation at 0.10')
      .not.toMatch(/rotation,\s*0\.10,\s*50/);

    // F23 §3.3 and document 35 §5 W28 ("Unit rewards with repeated successes require valid
    // modeling too"): the modes that remain model no reward at all — rotation ranks on
    // observation counts and epsilon is uniform — so the reward and objective dials do not enter
    // exploration. §7 must say that, so nobody reads the withdrawal as "the reward model was
    // fixed"; the evaluated-exploration contract is W28.P1.01's owner decision.
    const section = DOC22.slice(DOC22.indexOf('## 7 · Exploration'), DOC22.indexOf('## 8 ·'));
    expect(section, 'doc 22 §7 is the section under test').toContain('Rotation');
    expect(section, 'doc 22 §7 states that the supported rules model no reward, so the slot’s reward and objective do not change what explores')
      .toMatch(/no reward model|model no reward|neither models the reward|reward-free/i);
  });
});

// ===========================================================================
// unit:W28.P1.01 — no-witness. The offered-capability decision is the owner's
// (HANDOFF-2026-09-18 §8 D05, DS/C): whether an EVALUATED exploration is offered
// at all, and if so its share/prior/reward/control/cooldown/propensity contract
// and the quality validation it must pass. No document in this repository
// determines those values, and HANDOFF-2026-09-16 :232 forbids re-enabling the
// withdrawn one "to make the list look complete". Declared in units.json as
// `no-witness`; nothing is specified here.
// ===========================================================================
