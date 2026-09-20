// src/units/W24/B2.unit.test.ts
// W24 batch B2 — the three findings of the W24-B1 BUILD review: the reward and
// money filters decided PER CREDITED SLOT inside the visitor's ring, never from
// the slot an outcome happens to name; the operator ORDER after an authorized
// transition stated where a customer reads it; and the corrected margin
// sentence asserted.
//
// WITNESSES
//   · `_evidence/W24-B1/reviewer-build/REPORT.md` findings 1-3. Finding 1:
//     `src/learn/fan.ts:533-534` decides the reward filter from the slot the
//     OUTCOME names. Under the default `policy.match: 'direct'` that is
//     equivalent to a per-credited-slot filter, because `policy.ts:148`
//     confines a named-slot outcome to that slot's entries; under
//     `policy.match: 'any'` — publishable, `src/content/kinds.ts:483` — a
//     purchase naming a click-learning slot is dropped BEFORE the ring and a
//     second, purchase-learning slot loses the credit it had earned
//     (`policy.ts:147,166`). Finding 2: `fan.ts:535` takes the money objective
//     for a no-slot outcome from ANY money-objective slot in scope, so at a
//     tenant holding one money slot and no published `MoneyPolicy` every
//     currency-bearing or nonpositive no-slot outcome is refused before the
//     ring, costing unit-objective slots their credits. Finding 3: kit 03 :417's
//     corrected margin sentence is asserted nowhere, and the kit states the
//     transition route (`02-api-reference.md:583`) but never the ORDER an
//     operator must follow after it.
//   · The W24-B1 implementer's residual 1: an outcome naming no slot still
//     reaches the ring and may credit a slot learning another reward; the union
//     rule that suppressed the ring call broke four ring tests, because the ring
//     is the visitor's own record and her delivery journal.
//   · document 35 §5 row W24 (:426) "Define reward filter … test old callers and
//     partial deployment"; F19 §7 (the online credit path filtered to the slot's
//     reward as `report.ts` does for the batch — PER SLOT).
//
// ONE REPRESENTATION
//   (i)   AN OUTCOME IS NEVER DROPPED BEFORE THE RING for a reward or an
//         objective reason. The ring is the visitor's record and her delivery
//         journal; what the ring does with a credit is a per-slot decision made
//         where the ring groups its per-slot batches (`DecisionRing.outcome()`,
//         each batch carrying that slot's own `config`).
//   (ii)  PER CREDITED SLOT: the credit is taken only if the outcome's reward is
//         that slot's configured reward, and the money mechanics (currency,
//         nonpositive, `money_policy_unset`) apply only to a slot whose
//         objective is money.
//   (iii) EVERY REFUSAL IS COUNTED BY NAME, per slot, beside the counts W24-B1
//         and W23 already put on the same receipt (`notCredited`,
//         `outsideWindow`), so an operator can tell "no slot learns from this"
//         from "this slot does not, that one did".
//
// SEAMS. W22 owns the credited journal (`D1.02`, `D1.04`) — a per-slot refusal
// must not journal a credit; W23 owns `outsideWindow` — a window refusal and a
// reward refusal are different counts; W26-B1 is in build with
// `brandMismatched` and `legacyCredits` on the same receipt, and the
// per-credited-slot placement this batch rules ALSO answers W26's no-slot
// residual — named here, not re-specified. `W24.P1.01` is untouched: the money
// POLICY VALUES remain the owner's.
//
// RULED MISSING MEMBER (R21): `refusedBySlot?: Record<string, 'reward' | 'money'>`
// on the outcome receipt — one entry per slot the ring would have credited and
// did not, naming which rule refused it. Read off the receipt's JSON, beside
// the existing `notCredited`.

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
import { fanDecisions, fanOutcome, liftArchiveKey, liftKey, ringName, statsName, type LearningReceipt } from '@/learn/fan';
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
// The units of batch W24-B2.
// ===========================================================================

type SlotSpec = { reward: 'click' | 'purchase'; objective?: 'unit' | 'revenue' };
const learnWithSlots = (slots: Record<string, SlotSpec>, match: 'direct' | 'any' = 'direct'): LearnConfig =>
  ({ ...W22_LEARN, policy: { scope: 'visitor', match, credit: 'last', windowsMs: { purchase: 7 * DAY_MS, click: 30 * 60_000 } }, slots } as unknown as LearnConfig);

const configOf = (spec: SlotSpec) => ({ reward: spec.reward, stats: DEFAULT_STATS,
  objective: (spec.objective ?? 'unit') as 'unit' | 'revenue', measurementBasis: 'served-v1' as const });

/** The stored series of one slot's statistics object: which rewards it holds. */
const seriesOf = (m: Mounted, slot: string, item = 'cnt-tabby-evening'): string[] => {
  const stored = m.stats.get(statsName(TENANT, BRAND, slot))?.data.get('learn') as { stats?: { items?: Record<string, Record<string, { s?: Record<string, unknown> }>> } } | undefined;
  return Object.keys(stored?.stats?.items?.[item]?.['*']?.s ?? {}).sort();
};

/**
 * RULED, ABSENT TODAY (R21): what each slot refused, by name, on the outcome
 * receipt. Read off the engine's own `OutcomeReceipt`, so the compiler names it
 * as missing — the one ruled error this batch expects.
 */
const refusedBySlot = (receipt: LearningReceipt): Record<string, 'reward' | 'money'> | undefined =>
  receipt.outcome?.refusedBySlot;

/** Served in both slots for one visitor, so the ring holds an entry for each. */
async function servedInBothSlots(m: Mounted, slots: Record<string, SlotSpec>, visitor = 'v-tabby'): Promise<void> {
  for (const [slot, spec] of Object.entries(slots)) {
    const d = decision(m.env, visitor, ONLINE_TS, 'cnt-tabby-evening', slot as 'hero' | 'story');
    await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: visitor, records: [d] }, () => configOf(spec));
  }
  await m.drain();
}

const purchaseOf = (m: Mounted, visitor: string, at: number, nonce: string, data: Record<string, unknown> = {}): OutcomeRecord =>
  ({ ...outcomeFromAction({ type: 'purchase', userId: visitor, sessionId: `s-${visitor}`, timestamp: at,
    eventId: nonce, eventIdSource: 'provided', data: { contentId: 'cnt-tabby-evening', value: 495, ...data } } as never, TENANT, BRAND)!,
    retention: captureRetention(m.env as never, TENANT, at, at) } as OutcomeRecord);

// ===========================================================================
// unit:W24.R1.03 — the reward filter is a per-credited-slot decision
// ===========================================================================

describe('unit:W24.R1.03', () => {
  /**
   * Build review finding 1. The producer cannot decide for a slot it is not
   * looking at: under `policy.match: 'any'` a purchase that names the
   * click-learning slot still attributes to the purchase-learning slot's
   * entries (`policy.ts:147,166`), and dropping it at `fan.ts:533` costs that
   * slot its credit. The filter belongs where the ring groups its per-slot
   * batches, each with that slot's own `config` — the way the fold filters each
   * hour's credits per slot (`hourly.ts:407`).
   */
  const SLOTS: Record<string, SlotSpec> = { hero: { reward: 'click' }, story: { reward: 'purchase' } };

  it('host-internal: under `match: any` a purchase naming the click slot still credits the purchase-learning slot, and the click slot is refused by name', async () => {
    const m = await mount({ learn: learnWithSlots(SLOTS, 'any') });
    await servedInBothSlots(m, SLOTS);
    const policy = { scope: 'visitor' as const, match: 'any' as const, credit: 'last' as const,
      windowsMs: { ...DEFAULT_POLICY.windowsMs, purchase: 7 * DAY_MS } };
    const named = purchaseOf(m, 'v-tabby', ONLINE_TS + 60_000, 'w24-b2-any-purchase', { slot: 'hero' });
    const receipt = await fanOutcome(m.env, TENANT, named, policy, BRAND,
      { hero: configOf(SLOTS.hero!), story: configOf(SLOTS.story!) }, configOf(SLOTS.hero!));
    await m.drain();

    expect({ reachedTheRing: receipt.ring.destinations, notCredited: receipt.outcome?.notCredited ?? 'none' },
      'W24.R1.03 — the outcome is never dropped before the ring for a reward reason: the ring is the visitor\'s own record and her delivery journal, so it is always called (the four ring tests that lock this stay green)')
      .toEqual({ reachedTheRing: 1, notCredited: 'none' });
    expect({ story: seriesOf(m, 'story'), hero: seriesOf(m, 'hero') },
      'W24.R1.03 — and the credit is decided per credited slot: the purchase-learning slot is credited even though the outcome names another slot, while the click-learning slot takes nothing from a purchase (build review finding 1; F19 §7 "as report.ts does", per slot)')
      .toEqual({ story: ['purchase'], hero: [] });
    expect(refusedBySlot(receipt) ?? absent('`refusedBySlot` on the outcome receipt', receipt.outcome ?? {}),
      'W24.R1.03 — and the receipt says which slot refused it and why, beside the counts W24-B1 and W23 already put there (ruled member: `refusedBySlot`)')
      .toEqual({ hero: 'reward' });
    // The receipt's own identity must account for the refusal: `outcomeReply`
    // validates `total(attributed, eligible, weightSkipped)` (`fan.ts:272`), so
    // a per-slot refusal is carried in a named count of its own and the
    // identity includes it (ruling R195 item 3a).
    expect({ refused: receipt.outcome?.refused, attributed: receipt.outcome?.attributed, eligible: receipt.outcome?.eligible },
      'W24.R1.03 — and the count of what was refused is on the receipt beside what was attributed and what was eligible, so the reply\'s own identity adds up (ruled member: `refused`, the sum of `refusedBySlot`\'s entries)')
      .toEqual({ refused: 1, attributed: 1, eligible: 1 });
  });

  it('host-internal: an outcome naming NO slot is refused per slot by reward and counted, and a single-slot tenant behaves exactly as W24-B1 measured', async () => {
    const m = await mount({ learn: learnWithSlots({ hero: { reward: 'click' } }) });
    const d = decision(m.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening');
    await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: 'v-tabby', records: [d] }, () => configOf({ reward: 'click' }));
    await m.drain();
    // A real click first, so the slot's series is what a CREDIT put there
    // (`recordSuccess`), not what an exposure alone would leave — and the clause
    // then proves both halves: the credited reward stays, the other is refused
    // (ruling R195 item 1; the same shape as `B1.unit.test.ts:837`).
    const credited = await fanOutcome(m.env, TENANT, click(m.env, d, ONLINE_TS + 30_000, 'w24-b2-real-click'),
      DEFAULT_POLICY, BRAND, { hero: configOf({ reward: 'click' }) }, configOf({ reward: 'click' }));
    await m.drain();
    expect({ series: seriesOf(m, 'hero'), eligible: credited.outcome?.eligible ?? 0 },
      'the fixture credits one real click to the slot that learns from clicks').toEqual({ series: ['click'], eligible: 1 });

    const anonymous = purchaseOf(m, 'v-tabby', ONLINE_TS + 60_000, 'w24-b2-noslot-purchase');
    const receipt = await fanOutcome(m.env, TENANT, anonymous, DEFAULT_POLICY, BRAND, { hero: configOf({ reward: 'click' }) }, configOf({ reward: 'click' }));
    await m.drain();
    expect({ reachedTheRing: receipt.ring.destinations, series: seriesOf(m, 'hero'), eligible: receipt.outcome?.eligible ?? 0,
      refused: refusedBySlot(receipt) ?? absent('`refusedBySlot` on the outcome receipt', receipt.outcome ?? {}) },
      'W24.R1.03 — a purchase that names no slot reaches the ring, is refused by the one slot that learns from clicks and adds nothing to the series that slot really learns, and that refusal is counted by name: the residual W24-B1 left open (its implementer\'s residual 1) is closed where the ring groups its batches')
      .toEqual({ reachedTheRing: 1, series: ['click'], eligible: 0, refused: { hero: 'reward' } });
  });

  it('host: the shopper\'s own path leaves the same evidence — the purchase-learning slot credited, the click slot untouched', async () => {
    const m = await mount({ learn: learnWithSlots(SLOTS, 'any') });
    const session = await newAnonymousSession(m.env, TENANT);
    // Served to the shopper the session mints, so the ring the purchase reaches
    // is her own (ruling R195 item 2).
    await servedInBothSlots(m, SLOTS, session.subject);
    const chosen = await m.fetch(new Request(`http://shop.test/realtime/session/${session.sessionId}/preferences`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': TENANT, [SHOPPER_HEADER]: session.capability },
      body: JSON.stringify({ trackingConsent: true, personalizationEnabled: true,
        choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: session.grantId, iat: session.iat, exp: session.exp } }),
    }));
    expect(chosen.status, `the explicit consent choice answers: ${(await chosen.clone().text()).slice(0, 160)}`).toBe(200);
    const acted = await m.fetch(new Request('http://shop.test/realtime/action', {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': TENANT, [SHOPPER_HEADER]: session.capability },
      body: JSON.stringify({ type: 'purchase', source: 'sdk', eventId: crypto.randomUUID(), timestamp: Date.now(),
        userId: session.subject, sessionId: session.sessionId, data: { contentId: 'cnt-tabby-evening', slot: 'hero', value: 495, currency: 'USD' } }),
    }));
    expect(acted.status, `the shopper's purchase answers: ${(await acted.clone().text()).slice(0, 160)}`).toBe(200);
    await m.drain();
    expect({ story: seriesOf(m, 'story'), hero: seriesOf(m, 'hero') },
      'W24.R1.03 — the same rule on the shopper\'s own path: her purchase names the band she bought from, and the slot that learns from purchases is the one that learns from it')
      .toEqual({ story: ['purchase'], hero: [] });
  });
});

// ===========================================================================
// unit:W24.R1.04 — the money mechanics are a per-credited-slot decision
// ===========================================================================

describe('unit:W24.R1.04', () => {
  /**
   * Build review finding 2: `fan.ts:535` takes the money objective for a
   * no-slot outcome from ANY money-objective slot in scope, so one money slot
   * at a tenant refuses every currency-bearing or nonpositive no-slot outcome
   * for every slot, including the unit-objective slots that had nothing to do
   * with money. The money mechanics belong to the slot whose objective is
   * money, and to no other.
   */
  const MIXED: Record<string, SlotSpec> = { hero: { reward: 'purchase', objective: 'unit' }, story: { reward: 'purchase', objective: 'revenue' } };

  it('host-internal: with no money policy published the unit slot is credited and only the money slot is refused `money_policy_unset`', async () => {
    const m = await mount({ learn: learnWithSlots(MIXED, 'any') });
    await servedInBothSlots(m, MIXED);
    const policy = { scope: 'visitor' as const, match: 'any' as const, credit: 'last' as const,
      windowsMs: { ...DEFAULT_POLICY.windowsMs, purchase: 7 * DAY_MS } };
    const foreign = purchaseOf(m, 'v-tabby', ONLINE_TS + 60_000, 'w24-b2-money-mixed', { currency: 'JPY' });
    const receipt = await fanOutcome(m.env, TENANT, foreign, policy, BRAND,
      { hero: configOf(MIXED.hero!), story: configOf(MIXED.story!) }, configOf(MIXED.hero!));
    await m.drain();
    expect({ reachedTheRing: receipt.ring.destinations, hero: seriesOf(m, 'hero'), story: seriesOf(m, 'story'),
      refused: refusedBySlot(receipt) ?? absent('`refusedBySlot` on the outcome receipt', receipt.outcome ?? {}) },
      'W24.R1.04 — a currency nobody has declared is a reason not to weigh a MONEY series, and nothing more: the unit-objective slot counts its event, the revenue slot is refused `money_policy_unset` by name, and the outcome is never refused whole (build review finding 2)')
      .toEqual({ reachedTheRing: 1, hero: ['purchase'], story: [], refused: { story: 'money' } });
  });

  it('host-internal: a nonpositive value refuses only the money slot, and the pre-W24 caller shape keeps learning exactly as before', async () => {
    const m = await mount({ learn: learnWithSlots(MIXED, 'any') });
    await servedInBothSlots(m, MIXED);
    const policy = { scope: 'visitor' as const, match: 'any' as const, credit: 'last' as const,
      windowsMs: { ...DEFAULT_POLICY.windowsMs, purchase: 7 * DAY_MS } };
    const refund = purchaseOf(m, 'v-tabby', ONLINE_TS + 60_000, 'w24-b2-money-refund', { value: -495 });
    const refunded = await fanOutcome(m.env, TENANT, refund, policy, BRAND,
      { hero: configOf(MIXED.hero!), story: configOf(MIXED.story!) }, configOf(MIXED.hero!));
    await m.drain();
    expect({ hero: seriesOf(m, 'hero'), refused: refusedBySlot(refunded) ?? absent('`refusedBySlot` on the outcome receipt', refunded.outcome ?? {}) },
      'W24.R1.04 — a nonpositive value is the money policy\'s business and the money slot\'s alone: the unit slot still counts the event it saw')
      .toEqual({ hero: ['purchase'], refused: { story: 'money' } });
    expect(refunded.outcome?.money?.reason ?? absent('`money` on the outcome receipt', refunded.outcome ?? {}),
      'W24.R1.04 — and the reason survives the reply: `outcomeReply` (fan.ts:278-279) carries `money` and `notCredited` back with the rest, so what W24-B1 named on the receipt (`B1.unit.test.ts:903`) still reads (ruling R195 item 3b)')
      .toBe('money_policy_unset');

    // An all-refused outcome is NEVER journalled as credited: W22's credited
    // journal remembers whenever `attributed > 0` (`DecisionRing.ts:253-257`),
    // so a second identical delivery must meet the same per-slot refusal rather
    // than a dedupe that claims it was already credited (ruling R195 item 3c).
    const only = await mount({ learn: learnWithSlots({ story: { reward: 'purchase', objective: 'revenue' } }) });
    const sd = decision(only.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening', 'story');
    await fanDecisions(only.env, { tenant: TENANT, brand: BRAND, visitor_id: 'v-tabby', records: [sd] }, () => configOf(MIXED.story!));
    await only.drain();
    const foreignOnce = purchaseOf(only, 'v-tabby', ONLINE_TS + 60_000, 'w24-b2-journal-once', { currency: 'JPY' });
    const firstTry = await fanOutcome(only.env, TENANT, foreignOnce, DEFAULT_POLICY, BRAND, { story: configOf(MIXED.story!) }, configOf(MIXED.story!));
    const secondTry = await fanOutcome(only.env, TENANT, foreignOnce, DEFAULT_POLICY, BRAND, { story: configOf(MIXED.story!) }, configOf(MIXED.story!));
    await only.drain();
    expect({ first: refusedBySlot(firstTry) ?? absent('`refusedBySlot` on the outcome receipt', firstTry.outcome ?? {}),
      second: refusedBySlot(secondTry) ?? absent('`refusedBySlot` on the outcome receipt', secondTry.outcome ?? {}),
      series: seriesOf(only, 'story') },
      'W24.R1.04 — an outcome every slot refused is not a credited outcome: it is never written into the credited journal, so the same delivery arriving again is refused again by name rather than answered as already applied (W22 D1.02/D1.04 keep their meaning for outcomes that WERE credited)')
      .toEqual({ first: { story: 'money' }, second: { story: 'money' }, series: [] });

    // "Test old callers" (document 35 §5 row W24): the pre-W24 shape — no
    // `data.slot`, no currency — learns on a unit slot exactly as it did.
    const older = await mount({ learn: learnWithSlots({ hero: { reward: 'purchase', objective: 'unit' } }) });
    const d = decision(older.env, 'v-rogue', ONLINE_TS, 'cnt-tabby-evening');
    await fanDecisions(older.env, { tenant: TENANT, brand: BRAND, visitor_id: 'v-rogue', records: [d] }, () => configOf(MIXED.hero!));
    const legacy = purchaseOf(older, 'v-rogue', ONLINE_TS + 60_000, 'w24-b2-legacy-caller');
    const plain = await fanOutcome(older.env, TENANT, legacy, DEFAULT_POLICY, BRAND, { hero: configOf(MIXED.hero!) }, configOf(MIXED.hero!));
    await older.drain();
    expect({ series: seriesOf(older, 'hero'), notCredited: plain.outcome?.notCredited ?? 'none' },
      'W24.R1.04 — and a caller that still sends the pre-W24 shape learns as it always did: a unit slot counts its purchase, with no money question to answer')
      .toEqual({ series: ['purchase'], notCredited: 'none' });
  });
});

// ===========================================================================
// unit:W24.G1.03 — what the kit tells an operator
// ===========================================================================

describe('unit:W24.G1.03', () => {
  /**
   * Build review finding 3. The kit states the transition route
   * (`02-api-reference.md:583`) but never the ORDER an operator must follow
   * after it — the consequence the W24-B1 build named as its residual 3: until
   * the tenant's learn document follows, ordinary exposure writes meet the
   * existing 409 and `readLift`'s compatibility check serves NO lift for that
   * slot. And kit 03 :417's corrected margin sentence is asserted nowhere.
   */
  it('logic: the kit states the order to follow after a transition, and says a margin never falls back to a value', () => {
    const api = readFileSync(new URL('../../../docs/kit/02-api-reference.md', import.meta.url), 'utf8');
    const schema = readFileSync(new URL('../../../docs/kit/03-payload-schemas.md', import.meta.url), 'utf8');

    const transition = api.slice(api.indexOf('POST learn/generation'), api.indexOf('POST learn/generation') + 4000);
    // The route's own sentence already mentions the 409 it is the way past, so
    // the clause asks for what is missing: the ORDER, and what a shopper is
    // served until it is followed.
    const order = /(publish|update)[^.]{0,160}learn document/i.test(transition);
    const meanwhile = /(until|meanwhile|in the meantime)[^.]{0,200}(409|no lift|serves no lift|base scores)/i.test(transition);
    expect({ order, meanwhile },
      `W24.G1.03 — beside the route it documents, the kit tells an operator the ORDER — publish the learn document that matches the new accumulation — and what happens until that is done: the slot serves no lift and ordinary exposure writes meet 409 (build review finding 3; the W24-B1 build's residual 3). The section reads: ${transition.slice(0, 400)}`)
      .toEqual({ order: true, meanwhile: true });

    expect(/NEVER falls back to value|never falls back to value/.test(schema),
      'W24.G1.03 — and the published schema says a margin objective never falls back to the value (kit 03 :417, the correction W24.R1.02 made)')
      .toBe(true);
    expect(/margin uses supplied margin and currently falls back to value/.test(schema),
      'W24.G1.03 — with the old sentence gone, so a customer reading the schema cannot still be told the value stands in')
      .toBe(false);
  });
});
