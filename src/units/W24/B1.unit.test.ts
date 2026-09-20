// src/units/W24/B1.unit.test.ts
// W24 batch B1 — generations, transitions and units: accumulation semantics
// versioned apart from estimator and presentation settings; an authorized
// generation transition with no stale oscillation and no mixed cached
// snapshots; reset as explicit containment or a trustworthy rebuild; the online
// credit path filtered to the slot's reward; and the money mechanics the
// platform decides, with the policy VALUES left to their owner (D09/DS).
//
// One `describe('unit:W24.<id>')` per unit, one `it` per ruled leg. Every
// expected value comes from a witness or a hand-computed fixture.
//
// WITNESSES
//   · document 35 §5 row W24 (:426): "Version accumulation semantics separately
//     from estimator/presentation settings; authorized generation transition
//     with no stale oscillation or mixed cached snapshots. Implement reset as
//     explicit containment or trustworthy rebuild/promote from retained events.
//     Define reward filter, revenue/margin/currency/refund behavior and
//     denominator transitions; test old callers and partial deployment."
//   · document 35 §2 F19, F08 and N17 (:279).
//   · docs/architecture/35-verification-reports/F19.md §5.1 (a pre-loaded series
//     of another reward contaminates), §5.2 (`margin ?? value` mixes units),
//     §5.3 (currency is never read and a refund never subtracts), §5.7 (a
//     configuration change is never atomic for the reader), §7 the remedy:
//     "Stamp a generation on the counters and start a fresh one when the
//     generation changes … Do not silently keep the counters"; `gen` over
//     `{objective, reward, tauLearnMs, n0, nMin, liftMin, liftMax}` with the
//     ACCUMULATION half deciding the restart; `LiftSnapshot` gains
//     `generation`, `restartedAt` and `exposuresSinceRestart`; `receipts.ts:65`
//     says "learning restarted <when> after a configuration change; N exposures
//     since"; the three gaps in the audit's own remedy — the online credit path
//     filtered to the slot's configured reward as `report.ts` does, the
//     promotion writing `liftKey` (the only key `src/content/service.ts` reads)
//     and archiving the superseded version, and the reset covering `stats.slot`
//     and not only `stats.items` (§7.3, against the retained disposition in
//     HANDOFF-2026-09-16 :228 that "item reset retains the slot denominator").
//   · docs/handover/HANDOFF-2026-09-16.md :228 — what EXISTS (incompatible
//     reward/objective/τ refused in `LearnStats.ts`; `service.ts` checks lift
//     compatibility; hourly snapshots retain their computation basis) and what
//     is OPEN (the authorized rebuild/promote, the stale-caller and cache
//     transition contract, and the money policy, which "needs D09/DS
//     agreement").
//   · rulings R19 (a host leg drives the mounted routes production serves),
//     R21 (a ruled-but-absent member is named), R142 (the readings below).
//
// ONE REPRESENTATION, SHARED BY EVERY UNIT BELOW
//   (i)   THE GENERATION KEY covers ACCUMULATION semantics — objective, the
//         reward filter, τ and the schema — and nothing else. A presentation
//         change (n0, nMin, liftMin/liftMax) keeps the counters; an
//         accumulation change starts a fresh generation. Never a silent
//         reinterpretation, never a silent keep.
//   (ii)  A TRANSITION IS ATOMIC FROM THE READER'S SIDE: one snapshot whole per
//         decision — counters and settings of one generation — and no cache may
//         serve a generation the published head has superseded.
//   (iii) THE PLATFORM NEVER GUESSES A POLICY VALUE. Where the mechanism is the
//         platform's (units never mixed, the currency read, a refund handled by
//         the published rule) the unit asserts the mechanism; where the VALUE is
//         the owner's (D09/DS) it asserts only the refusal to default, and the
//         value goes to W24.P1.01.
//   (iv)  RESET IS CONTAINMENT OR REBUILD, never a half state: an item reset
//         leaves no denominator counting exposures it no longer credits.
//
// SEAMS, NOT CROSSED. W22 owns the ledger, the fold and the online journals;
// W23 owns the reset intent (`intent: 'reset'`), `rebuiltFrom` and the ingest
// clamp — this batch REUSES those observables by name and does not re-specify
// them; W27 owns replay; W30 owns the fold envelope. The W24 build waits for
// W23-B1's merge.
//
// RULED MISSING MEMBERS (R21), by the names this specification rules:
//   1. `LiftSnapshot.generation`, `.restartedAt`, `.exposuresSinceRestart`
//      (F19 §7) — read off the engine's own type, so the compiler names them.
//   2. `POST /v1/:tenant/learn/generation` — the authorized transition, with
//      `{ ok, generation, restartedAt, archivedVersion }`, read off the route's
//      JSON answer.
//   3. `money` on the published learn document and the refusal code
//      `money_policy_unset`, read off the route's JSON answer.

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { JSDOM } from 'jsdom';
import * as jose from 'jose';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { Cell, ContentPiece, DecisionRecord, LearnConfig, SlotCatalog } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { consumeLedger } from '@/ledger/consume';
import { enqueueDecisions, enqueueOutcome } from '@/ledger/enqueue';
import { captureQuarantine, listQuarantine } from '@/ledger/quarantine';
import { outcomeFromAction, ts36, type OutcomeRecord } from '@/ledger/records';
import { fanDecisions, fanOutcome, liftArchiveKey, liftKey, ringName, statsName } from '@/learn/fan';
import { readLift } from '@/content/service';
import { buildHour, catchUp, DEFAULT_HORIZON_MS, hourKey, runDayReport, shardOf } from '@/learn/hourly';
import { attribute, creditWeight, DEFAULT_POLICY } from '@/learn/policy';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { canonicalReportJson, loadDay, reportKey, runReport, type DayReport } from '@/learn/report';
import { buildSnapshot, DEFAULT_STATS, emptyStats, recordExposure, recordSuccess, type LiftSnapshot, type StatsState } from '@/learn/stats';
import { windowReport, type WindowReport } from '@/measure/window';
import type { MonitorResult } from '@/ops/monitor';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import { ledgerRecoveryRoutes } from '@/routes/ledgerRecovery';
import realtimeRoutes from '@/routes/realtime';
import { sortRoutes } from '@/routes/sort';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture (tapestry_requirements A.3.6), plus the unknown and
// cross-category rows this batch needs.
// ===========================================================================

const TENANT = 'coach';
const BRAND = 'coach';
const OPERATOR_SECRET = 'w22-b1-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The day every ledger fixture below is written into, and the hour inside it. */
const DATE = '2026-09-03';
const HOUR = 12;
const T12 = Date.UTC(2026, 8, 3, 12, 0, 0);
/** "Now" for every report: hour 12 and hour 13 are closed, the rest of the day is not. */
const NOW = Date.UTC(2026, 8, 3, 14, 30, 0);

/**
 * The ONLINE fixtures are placed two hours ago, not on the fixed ledger date:
 * the visitor's ring keeps seven days of receipts (`DecisionRing.ts:21`
 * RING_MAX_AGE_MS) and every online count decays against the wall clock, so an
 * online unit dated in the past would measure the retention rule rather than
 * the idempotence rule. The hour is closed, so the same events can also be
 * folded and reported.
 */
const ONLINE_TS = Date.now() - 2 * HOUR_MS;
const ONLINE_DATE = new Date(ONLINE_TS).toISOString().slice(0, 10);

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...over,
});

const W22_PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening', { title: 'Tabby, after six',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] } }),
  piece('cnt-rogue-work', { title: 'The Rogue, at work',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] } }),
  // Cross-category and unknown-taxonomy rows are part of the fixture, not an afterthought.
  piece('cnt-charms-slg', { title: 'Charms, across the case', type: 'lookbook',
    tags: { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'] } }),
];
const W22_CATALOGUE = { version: 'w22-b1-coach-catalogue', pieces: W22_PIECES };
const W22_SLOTS: SlotCatalog = { version: 'w22-b1-coach-slots',
  pages: { home: [
    { slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } },
    // The second slot learns from purchases, the reward whose policy window is
    // seven days: the horizon F17 P4 measures the fold against.
    { slot: 'story', take: 1, weights: { occasion: 0.35, line: 0.25 } },
  ] } };

/**
 * The tenant's published learning document. `holdout.share: 0` so every fixture
 * decision is `personalized` and each count below is exact; the attribution
 * policy is the platform default, whose `purchase` window is seven days
 * (`src/learn/policy.ts` DEFAULT_POLICY.windowsMs.purchase) — the horizon F17
 * P4 measures the batch fold against.
 */
const W22_LEARN: LearnConfig = {
  holdout: { share: 0, salt: 'w22-b1', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: { hero: { reward: 'click' }, story: { reward: 'purchase' } },
} as unknown as LearnConfig;

/** The cell every fixture decision carries: one known Coach cell and one unknown one. */
const COACH_CELL = { channel: 'web', visit_bucket: 'returning', stage: 'consider', region: 'US-NY', affinity: 'evening' };
const UNKNOWN_CELL = { channel: 'web', visit_bucket: 'new', stage: 'unknown', region: 'none', affinity: 'none' };

// ===========================================================================
// The mounted application, in process, the way `src/index.ts` mounts it, with
// the REAL DecisionRing and LearnStats classes bound to their namespaces.
// Harness pattern reused from `src/units/W20/B2.unit.test.ts`,
// `src/learn/holdoutArms.test.ts` (the real-class namespace) and
// `src/routes/sort.test.ts` (the owner-dispatched /sort door); none of those
// files is imported or edited.
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
  /** Set to make the Nth put of a call throw, as F16 §2.2 makes R2 throw mid-batch. */
  failPutFrom: ((key: string) => boolean) | null = null;
  /** Set to make a read THROW — an unreadable object, not an absent one (F17 P3b). */
  failGetFor: ((key: string) => boolean) | null = null;
  async get(key: string, options?: R2GetOptions) {
    if (this.failGetFor?.(key)) throw new Error('Synthetic storage read refusal');
    const raw = this.objects.get(key); if (raw === undefined) return null;
    const bytes = new TextEncoder().encode(raw), range = options?.range;
    const selected = range && 'length' in range ? bytes.slice(0, range.length ?? bytes.length) : bytes;
    return { key, etag: 'v' + this.versions.get(key), size: bytes.length, customMetadata: this.metadata.get(key),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(selected); c.close(); } }),
      text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    if (this.failPutFrom?.(key)) throw new Error('Synthetic storage refusal');
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

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w22-b1-fixture-policy', revision: 1, durationMs: 3650 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

interface DurableRegistry { data: Map<string, unknown>; object: { fetch: (request: Request) => Promise<Response> } }

interface Mounted {
  env: Env;
  storage: UnitR2;
  /** Every body the real producer handed to the queue binding, in order. */
  queued: unknown[];
  rings: Map<string, DurableRegistry>;
  stats: Map<string, DurableRegistry>;
  /** Drop and rebuild every durable object over the SAME storage: a restart. */
  restartObjects: () => void;
  fetch: (input: Request) => Promise<Response>;
  drain: () => Promise<void>;
  operatorToken: string;
}

async function mount(options: { queueFails?: boolean; statsStatus?: () => number | null; learn?: LearnConfig } = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const queued: unknown[] = [];
  const storage = new UnitR2();
  const shoppers = new Map<string, DurableRegistry>(), rings = new Map<string, DurableRegistry>(), stats = new Map<string, DurableRegistry>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: new UnitKV(), SESSIONS: new UnitKV(),
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: 'session', STORAGE: storage,
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w22-b1-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    // The shipped deployment declares `LEDGER_RECOVERY_ENABLED = "false"` in all
    // three environments (wrangler.toml:155, :237, :336), so this fixture runs
    // the configuration the customer would run today, stated and not merely
    // unset. Activating the managed owner-recovery path is a deployment
    // decision, not one this batch takes.
    LEDGER_RECOVERY_ENABLED: 'false',
    // The dead-letter consumer's own configuration, the one `src/index.ts:332`
    // reads before it captures an exhausted message, and the provenance key
    // `src/ledger/quarantine.ts:52` requires (32 characters or more).
    LEDGER_RECOVERY_CONFIG: JSON.stringify({ version: 1, sourceQueue: 'events', deadLetterQueue: 'events-dead-letter',
      unknown: { id: 'w22-b1-quarantine', revision: 1, durationMs: 30 * DAY_MS, basis: 'admitted', renewal: 'new-record-only', disposal: 'delete-on-expiry' } }),
    IDENTITY_SALT: 'w22-b1-synthetic-quarantine-provenance-salt',
    EVENT_QUEUE: { send: async (body: unknown) => {
      if (options.queueFails) throw new Error('Synthetic queue outage');
      queued.push(body);
    } },
  } as unknown as Env;
  env.RETENTION = JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) });

  /** One namespace per class, each instance the REAL class over a storage stub. */
  const namespaceFor = (make: (state: DurableObjectState, env: Env) => { fetch: (request: Request) => Promise<Response> }, registry: Map<string, DurableRegistry>, rebuild: Array<() => void>) => ({
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
        rebuild.push(() => { item!.object = make(state, env); });
      }
      const status = options.statsStatus?.();
      if (status !== undefined && status !== null && registry === stats) {
        // F16 §5(c): a statistics object answering 400 or 500 is "recorded as
        // delivered by every caller" unless the fan-out checks `res.ok`.
        return new Response(JSON.stringify({ ok: false, error: 'synthetic statistics refusal' }), { status });
      }
      return item.object.fetch(new Request(input, init));
    } }),
  });
  const rebuild: Array<() => void> = [];
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e), shoppers, rebuild) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e), rings, rebuild) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e), stats, rebuild) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/sort', sortRoutes);
  app.route('/v1', decisionRoutes);
  // The operator recovery surface, mounted where `src/index.ts:121` mounts it.
  app.route('/operator/ledger-recovery', ledgerRecoveryRoutes);

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w22-b1-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, W22_CATALOGUE),
    baseline(SLOTS_KIND, W22_SLOTS),
    baseline(LEARN_KIND, options.learn ?? W22_LEARN),
    // The statistics object reads the tenant's prior document before it can
    // answer a snapshot at all (`LearnStats.ts:513-514`), so the fixture
    // publishes the empty one the engine ships.
    baseline(PRIORS_KIND, EMPTY_PRIORS),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env, {
    waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {},
  } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, storage, queued, rings, stats, restartObjects: () => { for (const again of rebuild) again(); }, fetch: fetchOne, drain, operatorToken };
}

async function operatorGet(m: Mounted, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, { headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT } }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

async function operatorPost(m: Mounted, path: string, body: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method: 'POST', headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

// ── the fixture's own records, minted the way the engine mints them ─────────

/**
 * A served decision. The id is the engine's own carrier shape
 * (`{tenant}:{ts36}:{visitor}:…`, `src/ledger/writer.ts:40-45`), and the
 * retention stamp is the one `captureRetention` writes on the request path.
 */
function decision(env: Env, visitor: string, ts: number, item: string, slot: 'hero' | 'story' = 'hero', over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    decision_id: `${TENANT}:${ts36(ts)}:${visitor}:home:${slot}:0`,
    tenant: TENANT, brand: BRAND, visitor_id: visitor, session_id: `s-${visitor}`, identity_anchor: 'visitor', ts,
    page: 'home', slot, position: 0, item_id: item, customer_item_id: `CMS-${item}`, candidates: [],
    cell: visitor.startsWith('u-') ? UNKNOWN_CELL : COACH_CELL, arm: 'personalized', explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'w22-b1',
    explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
    retention: captureRetention(env as never, TENANT, ts, ts),
    ...over,
  } as unknown as DecisionRecord;
}

/** A click on the item a visitor was served, with the engine's own event nonce. */
function click(env: Env, d: DecisionRecord, ts: number, nonce: string): OutcomeRecord {
  const outcome = outcomeFromAction({ type: 'content_click', userId: d.visitor_id, sessionId: d.session_id ?? undefined, timestamp: ts,
    eventId: nonce, eventIdSource: 'provided', data: { contentId: d.item_id, slot: d.slot } } as never, TENANT, BRAND)!;
  return { ...outcome, retention: captureRetention(env as never, TENANT, ts, ts) } as OutcomeRecord;
}

/** A purchase: the reward whose policy window is seven days (F17 P4). */
function purchase(env: Env, d: DecisionRecord, ts: number, nonce: string): OutcomeRecord {
  const outcome = outcomeFromAction({ type: 'purchase', userId: d.visitor_id, sessionId: d.session_id ?? undefined, timestamp: ts,
    eventId: nonce, eventIdSource: 'provided', data: { contentId: d.item_id, slot: d.slot, value: 795, currency: 'USD' } } as never, TENANT, BRAND)!;
  return { ...outcome, retention: captureRetention(env as never, TENANT, ts, ts) } as OutcomeRecord;
}

/** Put the fixture on the queue with the real producer and write it with the real consumer. */
async function throughTheLedger(m: Mounted, decisions: DecisionRecord[], outcomes: OutcomeRecord[], now = NOW): Promise<unknown[]> {
  if (decisions.length) await enqueueDecisions(m.env, decisions);
  for (const outcome of outcomes) await enqueueOutcome(m.env, outcome);
  const wire = m.queued.splice(0);
  const result = await consumeLedger(m.env, wire, now);
  expect(result.error, 'the fixture ledger batch must be written by the real consumer').toBeUndefined();
  expect(result.ok, 'the fixture ledger batch must be acknowledged by the real consumer').toBe(true);
  return wire;
}

/** Every ledger row of one stream in the day, as the objects actually hold them. */
function ledgerRows(m: Mounted, stream: 'decision' | 'outcome' | 'product-sort'): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const [key, body] of m.storage.objects) {
    if (!key.startsWith(`${TENANT}/${DATE}/`) || !key.includes(`/${stream}/`)) continue;
    for (const line of body.split('\n')) if (line) rows.push(JSON.parse(line) as Record<string, unknown>);
  }
  return rows;
}

const dayObjects = (m: Mounted, stream: string): string[] =>
  [...m.storage.objects.keys()].filter(key => key.startsWith(`${TENANT}/${DATE}/`) && key.includes(`/${stream}/`)).sort();

/** The sentence a ruled-but-absent member produces, so the failure names it. */
const absent = (what: string, carrier: object): string => `absent: ${what} (the answer carries ${Object.keys(carrier).sort().join(', ')})`;

// ===========================================================================
// The units of batch W24-B1.
// ===========================================================================

/** The real statistics object of a mount, addressed as the engine addresses it. */
const statsOf = (m: Mounted, slot = 'hero', brand = BRAND) =>
  m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(statsName(TENANT, brand, slot)));

const snapshotOf = async (m: Mounted, slot = 'hero'): Promise<LiftSnapshot | null> =>
  (await (await statsOf(m, slot).fetch('https://learn/snapshot')).json() as { snapshot?: LiftSnapshot | null }).snapshot ?? null;

/** One exposure and one credit, through the real fan the request path runs. */
async function serveAndCredit(m: Mounted, config: () => { reward: 'click' | 'purchase'; stats: typeof DEFAULT_STATS; objective: 'unit' | 'revenue' | 'margin'; measurementBasis: 'served-v1' },
  visitor = 'v-tabby', item = 'cnt-tabby-evening', outcome?: (d: DecisionRecord) => OutcomeRecord): Promise<DecisionRecord> {
  const d = decision(m.env, visitor, ONLINE_TS, item);
  await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: visitor, records: [d] }, config);
  const o = outcome ? outcome(d) : click(m.env, d, ONLINE_TS + 60_000, `w24-${visitor}-${item}`);
  await fanOutcome(m.env, TENANT, o, DEFAULT_POLICY, BRAND, { hero: config() }, config());
  await m.drain();
  return d;
}

const estimator = (over: Partial<typeof DEFAULT_STATS> = {}) => ({ ...DEFAULT_STATS, ...over });
const accumulation = (over: { reward?: 'click' | 'purchase'; objective?: 'unit' | 'revenue' | 'margin'; stats?: typeof DEFAULT_STATS } = {}) =>
  () => ({ reward: over.reward ?? 'click' as const, stats: over.stats ?? DEFAULT_STATS, objective: over.objective ?? 'unit' as const, measurementBasis: 'served-v1' as const });

/** RULED, ABSENT TODAY (R21): F19 §7's three members on the published snapshot. */
const generationOf = (snapshot: LiftSnapshot): { generation?: string; restartedAt?: number; exposuresSinceRestart?: number } =>
  ({ generation: snapshot.generation, restartedAt: snapshot.restartedAt, exposuresSinceRestart: snapshot.exposuresSinceRestart });

// ===========================================================================
// unit:W24.G1.01 — accumulation semantics versioned apart from presentation
// ===========================================================================

describe('unit:W24.G1.01', () => {
  /**
   * F19 §7: "Stamp a generation on the counters and start a fresh one when the
   * generation changes … Do not silently keep the counters", where the key is
   * over `{objective, reward, tauLearnMs, n0, nMin, liftMin, liftMax}` and the
   * ACCUMULATION half — objective, reward, τ, schema — decides the restart.
   * Measured first (R142(a)): the engine today REFUSES an accumulation change
   * with 409 `statistics configuration incompatible`
   * (`src/durable-objects/LearnStats.ts:391`) and accepts a presentation change
   * keeping the counters. A refusal is not a silent reinterpretation, and it is
   * not a transition either: the tenant can never change the objective.
   */
  it('logic: a snapshot names the generation that produced its counters, with the moment learning restarted and what has been counted since', () => {
    const state: StatsState = emptyStats();
    recordExposure(state, 'cnt-tabby-evening', COACH_CELL as unknown as Cell, ONLINE_TS, DEFAULT_STATS);
    recordSuccess(state, 'cnt-tabby-evening', COACH_CELL as unknown as Cell, 'click', ONLINE_TS + 60_000, 1, DEFAULT_STATS);
    const builtAt = ONLINE_TS + 120_000;
    const snapshot = buildSnapshot(state, { tenant: TENANT, brand: BRAND, slot: 'hero' }, 'click', builtAt, DEFAULT_STATS, null, 'unit', 'served-v1');
    const stamped = generationOf(snapshot);
    // `restartedAt` is bracketed by the fixture's own clock — the generation
    // cannot have started before its first exposure or after this build — so a
    // stamped constant cannot satisfy it (R147 item 3).
    expect({ generation: stamped.generation, restartedAtInWindow: typeof stamped.restartedAt === 'number' && stamped.restartedAt >= ONLINE_TS && stamped.restartedAt <= builtAt,
      exposuresSinceRestart: stamped.exposuresSinceRestart, objective: snapshot.objective, reward: snapshot.reward },
      'W24.G1.01 — every published snapshot names the generation its counters belong to, when that generation started — a moment no earlier than its first exposure and no later than this build — and how many exposures it has seen, beside the accumulation settings it was built under (F19 §7: `LiftSnapshot` gains `generation`, `restartedAt` and `exposuresSinceRestart`)')
      .toEqual({ generation: expect.any(String), restartedAtInWindow: true, exposuresSinceRestart: 1, objective: 'unit', reward: 'click' });
  });

  it('host-internal: a presentation change keeps the counters and the generation; an accumulation change starts a fresh generation instead of refusing the write', async () => {
    // The operator changes the tenant's PUBLISHED learn document and the next
    // decision resolves it — the way a setting really moves. A second mount
    // over the same store and the same objects is the next isolate to serve.
    // The estimator settings live at the DOCUMENT level, which is where the
    // statistics object reads them (`LearnStats.ts` priorsFor: `learn.value.stats`).
    const learnWith = (slot: Record<string, unknown>, stats?: typeof DEFAULT_STATS) =>
      ({ ...W22_LEARN, ...(stats ? { stats } : {}), slots: { ...W22_LEARN.slots, hero: slot } } as unknown as LearnConfig);
    const first = await mount({ learn: learnWith({ reward: 'click' }) });
    await serveAndCredit(first, accumulation());
    const before = await snapshotOf(first);
    expect(before?.items['cnt-tabby-evening']?.['*']?.n ?? 0,
      'the fixture has one exposure of that item before anything changes').toBeGreaterThan(0);
    // The tenant's document changes and the SAME durable statistics object is
    // served by the next isolate to read it: a fresh mount publishes the new
    // learn document, and the object's stored counters are carried into it, as
    // they are in production where the object outlives the document revision.
    const carried = first.stats.get(statsName(TENANT, BRAND, 'hero'))!.data;
    const withDocument = async (slot: Record<string, unknown>, stats?: typeof DEFAULT_STATS): Promise<Mounted> => {
      const next = await mount({ learn: learnWith(slot, stats) });
      await statsOf(next).fetch('https://learn/snapshot');           // create the object
      const target = next.stats.get(statsName(TENANT, BRAND, 'hero'))!.data;
      for (const [key, value] of carried) target.set(key, structuredClone(value));
      return next;
    };

    // (a) PRESENTATION: n0, nMin and the lift clamps move. The counters stay.
    const presented = await withDocument({ reward: 'click' }, estimator({ n0: 50, nMin: 5, liftMin: 0.25, liftMax: 4 }));
    const presentation = () => ({ reward: 'click' as const, objective: 'unit' as const, measurementBasis: 'served-v1' as const,
      stats: estimator({ n0: 50, nMin: 5, liftMin: 0.25, liftMax: 4 }) });
    const d2 = decision(presented.env, 'v-rogue', ONLINE_TS + 120_000, 'cnt-tabby-evening');
    const kept = await fanDecisions(presented.env, { tenant: TENANT, brand: BRAND, visitor_id: 'v-rogue', records: [d2] }, presentation);
    await presented.drain();
    const after = await snapshotOf(presented);
    expect({ ok: kept.ok, n0: after?.n0, nMin: after?.nMin,
      counted: (after?.items['cnt-tabby-evening']?.['*']?.n ?? 0) > (before?.items['cnt-tabby-evening']?.['*']?.n ?? 0) },
      `W24.G1.01 — an estimator change is presentation, not accumulation: the new settings are in force and the counters carry on (HANDOFF-2026-09-16 :228; F19 §7 keys the generation on the accumulation half only). The object answered: ${JSON.stringify(kept).slice(0, 160)}`)
      .toEqual({ ok: true, n0: 50, nMin: 5, counted: true });
    expect(generationOf(after!).generation ?? absent('`generation` on the published snapshot', after!),
      'W24.G1.01 — and the generation is the same one: a presentation change never restarts learning')
      .toBe(generationOf(before!).generation);

    // (b) ACCUMULATION, UNAUTHORIZED: a changed objective arriving on a write is
    //     refused, and nothing in the object moves. That refusal is part of the
    //     ruled outcome, not a defect: it is the guard against a silent
    //     reinterpretation of counters built under another objective, and
    //     `src/learn/learn.test.ts:525-533` locks it (409 `statistics
    //     configuration incompatible`, `applied: false`, the stored state
    //     unchanged). Ruling R144.
    // A revenue objective needs a value-carrying reward, which the published
    // document enforces (`src/content/kinds.ts:532`), so the accumulation
    // change this fixture makes is the pair the tenant would really publish.
    const moved = await withDocument({ reward: 'purchase', objective: 'revenue' });
    const storedBefore = JSON.stringify(moved.stats.get(statsName(TENANT, BRAND, 'hero'))!.data.get('learn'));
    const d3 = decision(moved.env, 'v-charms', ONLINE_TS + 180_000, 'cnt-tabby-evening');
    const refused = await fanDecisions(moved.env, { tenant: TENANT, brand: BRAND, visitor_id: 'v-charms', records: [d3] },
      accumulation({ reward: 'purchase', objective: 'revenue' }));
    await moved.drain();
    expect({ applied: refused.ok, unchanged: JSON.stringify(moved.stats.get(statsName(TENANT, BRAND, 'hero'))!.data.get('learn')) === storedBefore },
      'W24.G1.01 — an accumulation change that arrives as an ordinary write is REFUSED and changes nothing: counters built under one objective are never reinterpreted under another (the retained safe-incompatibility disposition, HANDOFF-2026-09-16 :228, locked by src/learn/learn.test.ts:525-533)')
      .toEqual({ applied: false, unchanged: true });

    // (c) ACCUMULATION, AUTHORIZED: the operator transition of W24.G1.02 is the
    //     only way past it, and it starts a fresh generation rather than
    //     reinterpreting or silently keeping the counters (F19 §7).
    const promoted = await operatorPost(moved, `/v1/${TENANT}/learn/generation`, { slot: 'hero', brand: BRAND, reward: 'purchase', objective: 'revenue' });
    expect(promoted.status,
      `W24.G1.01 — the authorized transition is the one way past that refusal (W24.G1.02's route); it answered: ${JSON.stringify(promoted.body).slice(0, 160)}`).toBe(200);
    const accepted = await fanDecisions(moved.env, { tenant: TENANT, brand: BRAND, visitor_id: 'v-charms', records: [d3] },
      accumulation({ reward: 'purchase', objective: 'revenue' }));
    await moved.drain();
    const fresh = await snapshotOf(moved);
    // `items[…].n` is a DECAYED accumulator, not a tally: `d3` is stamped
    // `ONLINE_TS + 180_000`, 1.95 h before the snapshot is built, and with
    // `tauLearnMs = 21 days` its mass there is exp(-1.95h/21d) = 0.99614. One
    // exposure and no more is therefore the counter ROUNDED — the form the rest
    // of this batch uses for a decayed counter (W24.T1.02's denominator) —
    // never the bare 1, which would only hold if the counter's reference time
    // were the snapshot's (ruling R182).
    expect(fresh === null ? 'no snapshot: the object still holds the old generation\'s configuration'
      : { applied: accepted.ok, generationChanged: generationOf(fresh).generation !== generationOf(before!).generation,
        objective: fresh.objective, reward: fresh.reward, counters: Math.round(fresh.items['cnt-tabby-evening']?.['*']?.n ?? 0) },
      'W24.G1.01 — after the authorized transition the write is taken under a FRESH generation: the counters start again under the new objective — one exposure, decayed from its own event time — the snapshot names both, and nothing from the old objective is carried into it (F19 §7 "Do not silently keep the counters")')
      .toEqual({ applied: true, generationChanged: true, objective: 'revenue', reward: 'purchase', counters: 1 });
  });
});

// ===========================================================================
// unit:W24.G1.02 — an authorized generation transition
// ===========================================================================

describe('unit:W24.G1.02', () => {
  /**
   * F19 §7, gap 2 of the audit's own remedy: "The promotion must write
   * `liftKey` — the only key `src/content/service.ts` reads — and archive the
   * superseded version". HANDOFF-2026-09-16 :228 names the authorized
   * rebuild/promote as OPEN. The transition is an operator act, so it carries
   * the operator credential the other learning routes carry
   * (`operatorJwt()`); `receipts.ts` says learning restarted when.
   */
  it('host: the transition is an operator act, writes the key the serving path reads and archives the version it supersedes', async () => {
    const m = await mount();
    await serveAndCredit(m, accumulation());
    const published = await operatorPost(m, `/v1/${TENANT}/learn/publish`, { slot: 'hero', brand: BRAND });
    expect(published.status, `the fixture publishes a first snapshot: ${JSON.stringify(published.body).slice(0, 200)}`).toBe(200);
    const first = await m.env.CACHE!.get(liftKey(TENANT, BRAND, 'hero'), 'json') as LiftSnapshot | null;
    expect(first?.version, 'the fixture has a published version to supersede').toEqual(expect.any(Number));

    const unauthenticated = await m.fetch(new Request(`${OPERATOR_ORIGIN}/v1/${TENANT}/learn/generation`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': TENANT },
      body: JSON.stringify({ slot: 'hero', brand: BRAND, objective: 'revenue' }),
    }));
    const t0 = Date.now();
    const promoted = await operatorPost(m, `/v1/${TENANT}/learn/generation`, { slot: 'hero', brand: BRAND, objective: 'revenue' });
    const t1 = Date.now();
    expect({ withoutCredential: unauthenticated.status, withOperator: promoted.status },
      'W24.G1.02 — the transition is an authorized act on a route that exists: refused without an operator credential, answered with one (ruled route: POST /v1/:tenant/learn/generation, beside `learn/publish` and `learn/recovery`)')
      .toEqual({ withoutCredential: 401, withOperator: 200 });
    const answer = promoted.body as { ok?: boolean; generation?: string; restartedAt?: number; archivedVersion?: number };
    // `restartedAt` is bracketed by the promotion itself, so a stamped constant
    // cannot satisfy it (R147 item 3).
    expect({ status: promoted.status, ok: answer.ok, generation: typeof answer.generation,
      restartedAtInWindow: typeof answer.restartedAt === 'number' && answer.restartedAt >= t0 && answer.restartedAt <= t1,
      archivedVersion: answer.archivedVersion },
      `W24.G1.02 — an operator moves the slot to a new accumulation generation and is told which one, when it started — a moment inside this promotion, ${t0}..${t1} — and which version it superseded (ruled route: POST /v1/:tenant/learn/generation). It answered: ${JSON.stringify(promoted.body).slice(0, 220)}`)
      .toEqual({ status: 200, ok: true, generation: 'string', restartedAtInWindow: true, archivedVersion: first!.version });

    const served = await m.env.CACHE!.get(liftKey(TENANT, BRAND, 'hero'), 'json') as LiftSnapshot | null;
    expect({ key: liftKey(TENANT, BRAND, 'hero'), objective: served?.objective, superseded: (served?.version ?? 0) > first!.version },
      'W24.G1.02 — the promotion writes the ONE key the serving path reads (`src/content/service.ts` → `liftKey`), so the next decision serves the new generation')
      .toEqual({ key: liftKey(TENANT, BRAND, 'hero'), objective: 'revenue', superseded: true });
    // The archive must be the SUPERSEDED generation, not merely a copy of
    // whatever was last published: read its body and require the OLD objective
    // and the OLD generation beside the new one on `liftKey` (R147 item 1 — a
    // publish-time archive already exists at `LearnStats.ts:571` and proves
    // nothing about the promotion).
    const archived = await m.storage.objects.get(liftArchiveKey(TENANT, BRAND, 'hero', first!.version));
    const body = archived ? JSON.parse(archived) as LiftSnapshot : null;
    expect(body === null ? `absent: no archive at ${liftArchiveKey(TENANT, BRAND, 'hero', first!.version)}`
      : { version: body.version, objective: body.objective, generation: generationOf(body).generation,
        stillTheOldGeneration: generationOf(body).generation !== generationOf(served!).generation },
      'W24.G1.02 — and what is archived is the generation the promotion SUPERSEDED: the old objective and the old generation stay readable under the superseded version while `liftKey` holds the new one (F19 §7 gap 2)')
      .toEqual({ version: first!.version, objective: 'unit', generation: generationOf(first!).generation, stillTheOldGeneration: true });
  });

  it('host-internal: the statistics object reports the new generation and the moment learning restarted, and a receipt can say so', async () => {
    const m = await mount();
    await serveAndCredit(m, accumulation());
    const before = await snapshotOf(m);
    const t0 = Date.now();
    const promoted = await operatorPost(m, `/v1/${TENANT}/learn/generation`, { slot: 'hero', brand: BRAND, objective: 'revenue' });
    const t1 = Date.now();
    expect(promoted.status,
      `W24.G1.02 — the ruled transition route (POST /v1/:tenant/learn/generation) answers the operator; it answered: ${JSON.stringify(promoted.body).slice(0, 160)}`).toBe(200);
    const after = await snapshotOf(m);
    const restarted = generationOf(after!).restartedAt, restartedBefore = generationOf(before!).restartedAt;
    expect({ generationChanged: generationOf(after!).generation !== generationOf(before!).generation,
      restartedInWindow: typeof restarted === 'number' && restarted >= t0 && restarted <= t1,
      laterThanBefore: typeof restarted === 'number' && typeof restartedBefore === 'number' && restarted > restartedBefore,
      since: generationOf(after!).exposuresSinceRestart },
      'W24.G1.02 — after the transition the object serves the new generation, names when it restarted and counts nothing from before it, so a receipt can say "learning restarted <when> after a configuration change; N exposures since" instead of asserting a unit it cannot vouch for (F19 §7, receipts.ts:65)')
      .toEqual({ generationChanged: true, restartedInWindow: true, laterThanBefore: true, since: 0 });
  });
});

// ===========================================================================
// unit:W24.T1.01 — no stale oscillation, no mixed cached snapshots
// ===========================================================================

describe('unit:W24.T1.01', () => {
  /**
   * F19 §5.7: a configuration change is never atomic for the reader. The rule
   * (R142(c)): the serving path uses ONE snapshot whole — counters and settings
   * of one generation — and a per-isolate cache never serves a generation the
   * published head has superseded. Two mounts are two isolates with their own
   * module-level caches over one shared store, which is the partial-deployment
   * case document 35 §5 row W24 names ("test old callers and partial
   * deployment").
   */
  for (const host of ['session', 'do'] as const) {
    it(`host (${host}): two isolates across a transition never serve the superseded generation, and no decision mixes one generation's counters with another's settings`, async () => {
      const first = await mount();
      await serveAndCredit(first, accumulation());
      expect((await operatorPost(first, `/v1/${TENANT}/learn/publish`, { slot: 'hero', brand: BRAND })).status,
        'the fixture publishes the first generation').toBe(200);
      // The second isolate shares the store and the objects; its own lift cache
      // is the module-level one, warmed by its own first read.
      const second = await mount();
      second.env.STORAGE = first.env.STORAGE; second.env.CACHE = first.env.CACHE;
      second.env.LEARN_STATS = first.env.LEARN_STATS; second.env.DECISION_RING = first.env.DECISION_RING;

      const before = await m24Snapshot(second);
      expect(before?.objective, 'the second isolate reads the published generation').toBe('unit');

      const promoted = await operatorPost(first, `/v1/${TENANT}/learn/generation`, { slot: 'hero', brand: BRAND, objective: 'revenue' });
      expect(promoted.status,
        `W24.T1.01 — the fixture needs the authorized transition W24.G1.02 rules (POST /v1/:tenant/learn/generation); it answered: ${JSON.stringify(promoted.body).slice(0, 160)}`).toBe(200);

      const promotedGeneration = (promoted.body as { generation?: string }).generation
        ?? `absent: no \`generation\` on the transition's answer (${JSON.stringify(promoted.body).slice(0, 160)})`;
      const readings = [await m24Snapshot(second), await m24Snapshot(second), await m24Snapshot(first)];
      expect(readings.map(snapshot => snapshot?.objective ?? 'none'),
        `W24.T1.01 — ${host}: once the head is superseded no isolate serves the old generation again, and none oscillates between them: every later read is the new generation or nothing at all (F19 §5.7)`)
        .toEqual(['revenue', 'revenue', 'revenue']);
      // Anchored to the generation the transition itself returned, and required
      // to differ from what the isolate read before it: a stamped constant or
      // an undefined member cannot satisfy this (R147 item 2).
      expect({ readings: readings.map(snapshot => generationOf(snapshot!).generation ?? 'none'),
        movedOn: generationOf(before!).generation !== promotedGeneration },
        'W24.T1.01 — and each read is ONE generation whole, the very generation the transition published: the counters and the settings a decision uses come from the same one, and it is not the one this isolate was serving before')
        .toEqual({ readings: [promotedGeneration, promotedGeneration, promotedGeneration], movedOn: true });

      // "Test old callers" (document 35 §5 row W24): a caller still holding the
      // superseded snapshot is served consistently or refused explicitly, never
      // a mixture of one generation's counters with another's settings.
      const stale = before!;
      const staleServed = await readLift({ ...first.env, CACHE: {
        get: async (key: string, type?: string) => key === liftKey(TENANT, BRAND, 'hero')
          ? (type === 'json' ? stale : JSON.stringify(stale)) : first.env.CACHE!.get(key, type as never),
        put: async () => undefined, delete: async () => undefined, list: async () => ({ keys: [], list_complete: true }),
      } as unknown as Env['CACHE'] }, TENANT, BRAND, 'hero', Date.now(), { reward: 'click', stats: DEFAULT_STATS, objective: 'unit', measurementBasis: 'served-v1' });
      expect(staleServed === null ? 'refused: the serving path declines a superseded generation'
        : { objective: staleServed.objective, generation: generationOf(staleServed).generation },
        'W24.T1.01 — and an old caller holding the superseded generation is served that generation whole or refused outright: what it must never get is the old counters under the new settings (F19 §5.7; document 35 §5 row W24 "test old callers")')
        .toEqual('refused: the serving path declines a superseded generation');
    });
  }
});

/** What a decision would use: the snapshot the serving path reads for the slot. */
async function m24Snapshot(m: Mounted): Promise<LiftSnapshot | null> {
  const read = await operatorGet(m, `/v1/${TENANT}/lift?slot=hero&brand=${BRAND}`);
  expect(read.status, `GET /v1/:tenant/lift answers: ${JSON.stringify(read.body).slice(0, 200)}`).toBe(200);
  return (read.body as { snapshot?: LiftSnapshot | null }).snapshot ?? null;
}

// ===========================================================================
// unit:W24.T1.02 — reset as containment, or a trustworthy rebuild
// ===========================================================================

describe('unit:W24.T1.02', () => {
  /**
   * F19 §7 gap 3: "The reset it exposes must cover `stats.slot`, not only
   * `stats.items`, or the lift denominator stays mixed (§4.4)". This reverses
   * the retained disposition in HANDOFF-2026-09-16 :228 ("item reset retains
   * the slot denominator"), and R142(d) rules the F19 reading: an item reset
   * must leave no denominator counting exposures it no longer credits. The
   * rebuild half reuses W23.H1.01's observables by name (`intent: 'reset'`,
   * `rebuiltFrom`) and does not re-specify them.
   */
  it('logic: a slot denominator never counts the exposures of an item whose evidence the platform no longer holds', () => {
    // The state an item reset leaves behind: the item's counters are gone, the
    // slot's are not (`LearnStats` resets `stats.items`, HANDOFF-2026-09-16
    // :228 "item reset retains the slot denominator"). F19 §7.3 and §4.4 rule
    // the other way: the denominator must not keep counting what the platform
    // cannot credit. Asserted where the denominator is computed, because the
    // operator route that performs the reset needs an account session this
    // harness cannot mint (`decisions.ts:914`, `user.type === 'access'`).
    const state: StatsState = emptyStats();
    for (const item of ['cnt-tabby-evening', 'cnt-rogue-work']) {
      recordExposure(state, item, COACH_CELL as unknown as Cell, ONLINE_TS, DEFAULT_STATS);
      recordSuccess(state, item, COACH_CELL as unknown as Cell, 'click', ONLINE_TS + 60_000, 1, DEFAULT_STATS);
    }
    const before = buildSnapshot(state, { tenant: TENANT, brand: BRAND, slot: 'hero' }, 'click', ONLINE_TS + 120_000, DEFAULT_STATS, null, 'unit', 'served-v1');
    expect(Math.round(before.slotRates['*']!.n), 'the fixture holds two exposures, one per item').toBe(2);

    delete state.items['cnt-tabby-evening'];                 // what an item reset leaves
    const after = buildSnapshot(state, { tenant: TENANT, brand: BRAND, slot: 'hero' }, 'click', ONLINE_TS + 120_000, DEFAULT_STATS, null, 'unit', 'served-v1');
    expect({ items: Object.keys(after.items).sort(), denominator: Math.round(after.slotRates['*']!.n), credits: Math.round(after.slotRates['*']!.s) },
      'W24.T1.02 — an item reset is containment: with the item\'s evidence gone the slot denominator counts only what remains, so no later lift is computed against exposures the platform can no longer credit (F19 §7.3, §4.4, over the retained "item reset retains slot denominator", HANDOFF-2026-09-16 :228)')
      .toEqual({ items: ['cnt-rogue-work'], denominator: 1, credits: 1 });
  });

  it('host-internal: a whole reset is containment too — the object keeps no counters and no denominator behind', async () => {
    const m = await mount();
    await serveAndCredit(m, accumulation(), 'v-tabby', 'cnt-tabby-evening');
    expect(Math.round((await snapshotOf(m))?.slotRates['*']?.n ?? 0), 'the fixture has one exposure counted').toBe(1);
    const reset = await statsOf(m).fetch('https://learn/reset', { method: 'POST', body: '{}' });
    expect(reset.status, `the object's own reset answers: ${(await reset.clone().text()).slice(0, 160)}`).toBe(200);
    const after = await snapshotOf(m);
    expect(after === null ? { items: [], denominator: 0 } : { items: Object.keys(after.items), denominator: Math.round(after.slotRates['*']?.n ?? 0) },
      'W24.T1.02 — after a whole reset the object holds neither item counters nor a slot denominator: containment is complete, never half a state (F19 §7.3)')
      .toEqual({ items: [], denominator: 0 });
  });

  it('host: a rebuild from retained events produces the counters a hand-computed fold produces, and says what it was rebuilt from', async () => {
    const m = await mount();
    const d1 = decision(m.env, 'v-tabby', T12 + 60_000, 'cnt-tabby-evening');
    const d2 = decision(m.env, 'v-rogue', T12 + 120_000, 'cnt-tabby-evening');
    const o1 = click(m.env, d1, T12 + 300_000, 'w24-rebuild-click');
    await throughTheLedger(m, [d1, d2], [o1]);

    const rebuilt = await operatorPost(m, `/v1/${TENANT}/learn/generation`, { slot: 'hero', brand: BRAND, rebuildFrom: DATE });
    const answer = rebuilt.body as { ok?: boolean; rebuiltFrom?: unknown; intent?: string };
    expect({ status: rebuilt.status, ok: answer.ok, rebuiltFrom: answer.rebuiltFrom },
      `W24.T1.02 — the alternative to containment is a rebuild from the events the platform retained, and the answer says what it was rebuilt from, in W23.H1.01's own vocabulary (\`rebuiltFrom\`). It answered: ${JSON.stringify(rebuilt.body).slice(0, 220)}`)
      .toEqual({ status: 200, ok: true, rebuiltFrom: { date: DATE, decisions: 2, outcomes: 1 } });
    const snapshot = await snapshotOf(m);
    // Hand-computed: two exposures of one item in one cell, one click credited.
    expect({ n: Math.round(snapshot?.items['cnt-tabby-evening']?.['*']?.n ?? 0), s: Math.round(snapshot?.items['cnt-tabby-evening']?.['*']?.s ?? 0) },
      'W24.T1.02 — and the counters it produces are the fold\'s own: two exposures and one credit, the hand-computed result of that day\'s retained events (doc 22 §4.2, F19 §7 "the M piece, reusing report.ts / hourly.ts")')
      .toEqual({ n: 2, s: 1 });
  });
});

// ===========================================================================
// unit:W24.R1.01 — the online credit path is filtered to the slot's reward
// ===========================================================================

describe('unit:W24.R1.01', () => {
  /**
   * F19 §7, gap 1 of the audit's own remedy: the fix "must also filter the
   * online credit path to the slot's configured reward, as the batch path
   * already does (`report.ts:110`) … otherwise §5.1's pre-loaded contamination
   * survives the fix". The fold does it at `src/learn/hourly.ts:407`
   * (`if (c.reward !== reward) continue; // the slot learns against one
   * reward`); the online path weighs by objective and never looks at the
   * reward.
   */
  it('host-internal: a slot that learns from clicks is not credited by a purchase, and a pre-loaded series of another reward never contaminates its lift', async () => {
    const m = await mount();
    const clicks = accumulation({ reward: 'click' });
    const d = await serveAndCredit(m, clicks);
    const afterClick = await snapshotOf(m);
    const credited = afterClick?.items['cnt-tabby-evening']?.['*']?.s ?? 0;
    expect(credited > 0, 'the fixture has one click credited under the slot\'s own reward').toBe(true);

    // The same visitor buys. The slot learns from clicks; the purchase is a
    // different reward and belongs to a different series.
    const bought = purchase(m.env, d, ONLINE_TS + 120_000, 'w24-reward-filter-purchase');
    const receipt = await fanOutcome(m.env, TENANT, bought, DEFAULT_POLICY, BRAND, { hero: clicks() }, clicks());
    await m.drain();
    // Read the object's own counters, not the click snapshot: a purchase series
    // recorded beside the clicks is exactly the contamination F19 §5.1 measured,
    // and a snapshot built for `click` would not show it.
    const stored = m.stats.get(statsName(TENANT, BRAND, 'hero'))!.data.get('learn') as { stats: StatsState };
    const series = Object.keys(stored.stats.items['cnt-tabby-evening']?.['*']?.s ?? {}).sort();
    expect({ series, eligible: receipt.outcome?.eligible ?? 0 },
      'W24.R1.01 — the online credit path is filtered to the slot\'s configured reward, as the fold already filters (hourly.ts:407): a purchase credits a click-learning slot with nothing and starts no second series beside its clicks, so a pre-loaded series of another reward cannot contaminate its lift (F19 §5.1, §7 gap 1)')
      .toEqual({ series: ['click'], eligible: 0 });
    expect(Math.round(((await snapshotOf(m))?.items['cnt-tabby-evening']?.['*']?.s ?? 0) / credited * 1000) / 1000,
      'W24.R1.01 — and the slot\'s own published lift is unmoved by it').toBe(1);
  });
});

// ===========================================================================
// unit:W24.R1.02 — money: the mechanics here, the policy values theirs
// ===========================================================================

describe('unit:W24.R1.02', () => {
  /**
   * F19 §5.2 (`margin ?? value` mixes units), §5.3 (the currency is never read
   * and a refund never subtracts); N17 (:279) on the published schema and the
   * money meanings. R142(f): where the platform DECIDES, assert the mechanism;
   * where the VALUE is the owner's (D09/DS), assert only that the platform
   * refuses to guess — and send the value to W24.P1.01.
   */
  it('logic: a margin objective never falls back to the value, and an outcome the platform cannot weigh in the declared unit is worth nothing', () => {
    expect(creditWeight('margin', { value: 100, margin: null }),
      'W24.R1.02 — under a margin objective an outcome with no margin is worth NOTHING: the platform never weighs a margin series with a revenue number, which is two units in one counter (F19 §5.2 `margin ?? value`)')
      .toBe(0);
    expect(creditWeight('margin', { value: 100, margin: 40 }),
      'W24.R1.02 — and a real margin is worth its margin').toBe(40);
    expect(creditWeight('revenue', { value: 100, margin: 40 }),
      'W24.R1.02 — while a revenue objective is worth its value, whatever margin came with it').toBe(100);
    expect(creditWeight('unit', { value: 100, margin: 40 }),
      'W24.R1.02 — and a unit objective counts the event, not the money on it').toBe(1);
  });

  it('host: the platform reads the currency it was given, refuses to guess an unset money policy, and the published schema and kit say what the numbers mean', async () => {
    const m = await mount();
    const d = decision(m.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening');
    const revenue = accumulation({ objective: 'revenue' });
    await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: d.visitor_id, records: [d] }, revenue);
    const foreign = { ...purchase(m.env, d, ONLINE_TS + 60_000, 'w24-money-foreign'), currency: 'JPY' } as OutcomeRecord;
    const weighed = await fanOutcome(m.env, TENANT, foreign, DEFAULT_POLICY, BRAND, { hero: revenue() }, revenue());
    await m.drain();
    const answer = weighed as unknown as { outcome?: { money?: { code?: string; reason?: string } } };
    expect(answer.outcome?.money ?? absent('`money` on the outcome receipt', weighed as unknown as object),
      'W24.R1.02 — a purchase in a currency the tenant has not declared is not silently added to a revenue counter: the platform names what it did with it, because no conversion rate is the platform\'s to invent (F19 §5.3, the currency never read; D09 is the owner\'s)')
      .toEqual({ code: 'JPY', reason: 'money_policy_unset' });

    const refund = { ...purchase(m.env, d, ONLINE_TS + 120_000, 'w24-money-refund'), value: -495 } as OutcomeRecord;
    const refunded = await fanOutcome(m.env, TENANT, refund, DEFAULT_POLICY, BRAND, { hero: revenue() }, revenue());
    await m.drain();
    expect((refunded as unknown as { outcome?: { money?: { reason?: string } } }).outcome?.money?.reason
      ?? absent('`money` on the refund receipt', refunded as unknown as object),
      'W24.R1.02 — and a negative value is refused under an unset policy rather than silently dropped or silently subtracted: whether a refund subtracts is the owner\'s rule (D09/DS), and until it is published the platform says so (W24.P1.01)')
      .toBe('money_policy_unset');

    const schema = readFileSync(new URL('../../../docs/kit/03-payload-schemas.md', import.meta.url), 'utf8');
    expect(/`slots\.\{slot\}\.objective`/.test(schema),
      'W24.R1.02 — the PUBLISHED learn schema names `objective` on the slot, so a customer writing the document can see the unit their counters will be in (N17 :279)')
      .toBe(true);
    expect(/units follow the slot objective/.test(schema),
      'W24.R1.02 — and the kit says what `s` means in money terms, beside `p0` and the lift it feeds (N17 :279)')
      .toBe(true);
  });
});
