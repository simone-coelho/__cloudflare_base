// src/units/W22/B2.unit.test.ts
// W22 batch B2 — late arrivals are re-folded (W22.R1.02), split out of batch
// W22-B1 by the lead's ruling R120 item 5 so its shard-state migration gets its
// own builder and its own review. The unit's `describe` block is the one
// specified and reviewed in B1 at eea76f8, moved here unchanged; only the
// harness around it is the minimum this one unit needs.
//
// The witnesses, the ruled outcome and the residual are on the unit's row in
// docs/remediation/units.json (batch W22-B2). The harness pattern is the one
// `src/units/W22/B1.unit.test.ts` uses (itself after `src/units/W20/B2.unit.test.ts`
// and `src/learn/holdoutArms.test.ts`); neither file is imported or edited here,
// because importing a `.test.ts` would register its whole suite a second time.


import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotCatalog } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { consumeLedger } from '@/ledger/consume';
import { enqueueDecisions, enqueueOutcome } from '@/ledger/enqueue';
import { outcomeFromAction, ts36, type OutcomeRecord } from '@/ledger/records';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { fanDecisions, fanOutcome, statsName } from '@/learn/fan';
import { catchUp, hourKey, runDayReport, shardOf } from '@/learn/hourly';
import { DEFAULT_POLICY } from '@/learn/policy';
import type { DayReport } from '@/learn/report';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
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
  app.route('/v1', decisionRoutes);

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

const dayObjects = (m: Mounted, stream: string): string[] =>
  [...m.storage.objects.keys()].filter(key => key.startsWith(`${TENANT}/${DATE}/`) && key.includes(`/${stream}/`)).sort();

// ===========================================================================
// unit:W22.D1.01 — dedup before caps, on every read path

// ===========================================================================
// unit:W22.R1.02 — late arrivals are re-folded
// ===========================================================================

describe('unit:W22.R1.02', () => {
  /**
   * F17 P1: an outcome delivered into an hour already folded "is durably in R2,
   * is never read again, is counted nowhere, and no field of the report says a
   * repair is pending". §6 item 1 rules the cheap close: `HourAggregate`
   * already stores `objects`, so `catchUp` can list the hour prefix and rebuild
   * when the count exceeds it. F17 P3b: `folded = ctx.from > state.through`
   * (`hourly.ts:291`) is a monotonic high-water mark, so a repaired hour can
   * never put its decisions into the rings; §6 item 2 rules a per-hour set.
   * F17 P7: the day's distinct-visitor count must survive an out-of-order
   * repair.
   *
   * The fold is the cron's, run exactly as `src/index.ts:270-277` runs it; the
   * observable is read through the mounted operator report route.
   */
  /**
   * The cron's own call, with the cron's own options: `catchUp(env.STORAGE,
   * tenant, learn, Date.now(), {}, env)` (`src/index.ts:272`), so the default
   * 26-hour lookback and two-hours-per-run budget are the ones under test. One
   * five-minute run folds at most two hours, so the fixture runs the cron until
   * it has caught up, exactly as a quarter of an hour of real runs would.
   */
  async function fold(m: Mounted, now: number): Promise<{ built: string[]; failed: string[] }> {
    const built: string[] = [], failed: string[] = [];
    for (let run = 0; run < 20; run++) {
      const result = await catchUp(m.storage as never, TENANT, W22_LEARN, now, {}, m.env as never);
      for (const hour of result.built) built.push(`${hour.date} ${hour.hour}`);
      for (const hour of result.failed) failed.push(`${hour.date} ${hour.hour}`);
      if (!result.built.length) break;
    }
    return { built, failed };
  }

  it('host: an hour whose ledger grew after it was folded is folded again, a failed hour repaired after a later hour still credits across the hour boundary, and the day\'s distinct visitors survive an out-of-order repair', async () => {
    // ── P1: the late arrival ────────────────────────────────────────────────
    const m = await mount();
    const d1 = decision(m.env, 'v-tabby', T12 + 10 * 60_000, 'cnt-tabby-evening');
    await throughTheLedger(m, [d1], []);
    await fold(m, T12 + HOUR_MS + 5 * 60_000 + 1000);                // 13:05, hour 12 closes
    expect(m.storage.objects.has(hourKey(TENANT, DATE, HOUR)), 'hour 12 is folded before the late row arrives').toBe(true);

    const lateClick = click(m.env, d1, T12 + 30 * 60_000, 'w22-b1-late-click');   // happened 12:30
    await throughTheLedger(m, [], [lateClick], T12 + HOUR_MS + 6 * 60_000);       // written at 13:06
    await fold(m, T12 + HOUR_MS + 10 * 60_000);                                   // 13:10

    const afterLate = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    expect(afterLate.status, `the report route answers: ${JSON.stringify(afterLate.body).slice(0, 300)}`).toBe(200);
    const late = (afterLate.body as { report: DayReport }).report;
    expect({ decisions: late.counts.decisions, outcomes: late.counts.outcomes },
      'W22.R1.02 — a record delivered into an already-folded hour, inside the maturity window, is counted after the next catch-up: the hour\'s stored object count is compared with the prefix and the hour is rebuilt (F17 P1, §6 item 1)')
      .toEqual({ decisions: 1, outcomes: 1 });
    expect(late.policies.find(row => row.role === 'learning')?.credits,
      'W22.R1.02 — and the credit the late click earns is in the day\'s learning policy').toBe(1);

    // ── P3b: the failed hour repaired after a later hour ────────────────────
    const r = await mount();
    const d12 = decision(r.env, 'v-rogue', T12 + 59 * 60_000, 'cnt-rogue-work');            // 12:59
    const d13 = decision(r.env, 'v-rogue', T12 + HOUR_MS + 5 * 60_000, 'cnt-tabby-evening'); // 13:05
    // 13:10, on the 12:59 item: the following hour, and inside the platform's
    // default click window of thirty minutes (`src/learn/policy.ts:28`), so the
    // credit this clause is about depends on the repaired hour reaching the
    // ring and on nothing else (ruling R139).
    const c14 = click(r.env, d12, T12 + HOUR_MS + 10 * 60_000, 'w22-b1-cross-hour');
    await throughTheLedger(r, [d12, d13], [c14]);
    const twelve = dayObjects(r, 'decision').find(key => key.startsWith(`${TENANT}/${DATE}/12/`))!;
    const held = r.storage.objects.get(twelve)!;
    r.storage.objects.delete(twelve);                                   // hour 12 unreadable on the first run
    // 15:06 and 15:07: past hour 14's own close grace (CLOSE_GRACE_MS), so
    // hours 13 AND 14 — the hour the cross-hour click lands in — are candidates
    // on the first pass, and the repair of 12 follows them (ruling R137 item 2).
    await fold(r, T12 + 3 * HOUR_MS + 6 * 60_000);                      // folds 13 and 14 without 12
    r.storage.objects.set(twelve, held);                                // the hour is readable again
    await fold(r, T12 + 3 * HOUR_MS + 7 * 60_000);                      // the repair run

    const repaired = await operatorPost(r, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    const repairedReport = (repaired.body as { report: DayReport }).report;
    expect(repairedReport.counts.decisions,
      'W22.R1.02 — the repaired hour\'s decisions are counted').toBe(2);
    expect(repairedReport.policies.find(row => row.role === 'learning')?.credits,
      'W22.R1.02 — and its cross-hour credit survives the repair: the folded hours are a per-hour set, not a monotonic high-water mark, so a repaired hour still enters the visitor\'s ring (F17 P3b, §6 item 2; hourly.ts:291 `folded = ctx.from > state.through`)')
      .toBe(1);

    // ── P7: the distinct-visitor count across an out-of-order repair ────────
    // Two visitors are served in the previous day's last hour and NOWHERE else,
    // so the number moves with the repair: if the repaired hour never folds,
    // the previous day's report is short by exactly those two, and if the
    // repair wipes the current day's `seen`, the current day's report is short
    // by the visitors folded before it. Both days are asserted, and the fold is
    // the cron's own, with the cron's cross-date 26-hour lookback.
    const v = await mount();
    const PREVIOUS = '2026-09-02';
    const previousHour = Date.UTC(2026, 8, 2, 23, 0, 0);
    // Two shoppers of the previous day who share a shard with a shopper of the
    // current day, so the repair really meets a shard whose `seenDate` is the
    // newer date: that is the state `hourly.ts:289` refuses and `:316-318`
    // would wipe. With 64 shards this is an ordinary collision, chosen here
    // instead of being left to luck.
    const shardOfToday = shardOf('v-tabby');
    const sameShard = (prefix: string) => {
      for (let n = 0; n < 512; n++) if (shardOf(`${prefix}-${n}`) === shardOfToday) return `${prefix}-${n}`;
      throw new Error('no visitor id of this prefix shares the shard');
    };
    const yesterdayVisitors = [sameShard('v-yesterday-tabby'), sameShard('v-yesterday-rogue')];
    expect(new Set([...yesterdayVisitors.map(id => shardOf(id)), shardOfToday]).size,
      'the fixture puts the previous day\'s shoppers on the same shard as a current-day shopper').toBe(1);
    const yesterday = [
      decision(v.env, yesterdayVisitors[0]!, previousHour + 10 * 60_000, 'cnt-tabby-evening'),
      decision(v.env, yesterdayVisitors[1]!, previousHour + 20 * 60_000, 'cnt-rogue-work'),
    ];
    const today = [
      decision(v.env, 'v-tabby', T12 + 60_000, 'cnt-tabby-evening'),
      decision(v.env, 'v-rogue', T12 + 120_000, 'cnt-rogue-work'),
      decision(v.env, 'u-unknown', T12 + HOUR_MS + 60_000, 'cnt-tabby-evening'),
      decision(v.env, 'v-charms', T12 + HOUR_MS + 120_000, 'cnt-charms-slg'),
    ];
    // A fifth shopper of the current day, on the same shard, in an hour that is
    // still OPEN while the repair runs: her hour is folded only afterwards, so
    // it is the first fold to READ the `seen` state the repair left behind.
    const lateVisitor = sameShard('v-late-tabby');
    const laterHour = decision(v.env, lateVisitor, T12 + 2 * HOUR_MS + 60_000, 'cnt-charms-slg');   // 14:01
    today.push(laterHour);
    await throughTheLedger(v, [...yesterday, ...today], []);
    const previousKey = [...v.storage.objects.keys()].find(key => key.startsWith(`${TENANT}/${PREVIOUS}/23/`))!;
    // UNREADABLE, not absent: the hour's own object throws on read, so the fold
    // FAILS on it (an empty hour would simply be folded and finished with).
    v.storage.failGetFor = (key: string) => key === previousKey;
    const firstPass = await fold(v, T12 + 3 * HOUR_MS);           // today's hours fold; the old hour fails
    expect(firstPass.built, 'the fixture folds the current day while the previous day\'s hour cannot be read')
      .toContain(`${DATE} ${HOUR}`);
    expect(firstPass.failed, 'and that unreadable hour is a failure of the run, not an empty hour it finished with')
      .toContain(`${PREVIOUS} 23`);
    v.storage.failGetFor = null;                                  // the previous day's hour returns
    const repairPass = await fold(v, T12 + 3 * HOUR_MS + 60_000); // the out-of-order repair run

    expect(repairPass.built,
      'W22.R1.02 — the previous day\'s hour is folded when it becomes readable, after the current day\'s hours have already been folded: `seen` is kept per date instead of being wiped whenever the shard\'s date changes, so an older hour is repairable rather than refused for ever (F17 P7, §6 item 3; hourly.ts:289 SeenDateAhead, :316-318 the wipe)')
      .toContain(`${PREVIOUS} 23`);
    const previousDay = await operatorPost(v, `/v1/${TENANT}/learn/report`, { date: PREVIOUS, brand: BRAND });
    expect(previousDay.status, `the previous day's report answers: ${JSON.stringify(previousDay.body).slice(0, 300)}`).toBe(200);
    expect((previousDay.body as { report: DayReport }).report.counts.visitors,
      'W22.R1.02 — and the two visitors served only in that repaired hour are counted on their own day')
      .toBe(2);
    // The hour that was still open during the repair is folded now, so the
    // number the day reports is computed FROM the state the repair left: a fold
    // that wiped the newer date's `seen` while folding the older hour can only
    // count this last hour's own shopper, and the day comes out short.
    expect((await fold(v, T12 + 4 * HOUR_MS)).built,
      'the fixture folds the current day\'s last hour after the repair, so this hour is the first to read what the repair left behind')
      .toContain(`${DATE} ${HOUR + 2}`);
    const currentDay = await operatorPost(v, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    expect((currentDay.body as { report: DayReport }).report.counts.visitors,
      'W22.R1.02 — and the repair of the older date does not cost the current day its own distinct visitors: five shoppers were served on this date, and the hour folded after the repair still knows about the four that came before it, because `seen` is kept per date instead of being wiped whenever a shard folds an hour of another date (F17 P7 measured four visitors where eight were served; hourly.ts:316-318, mergeBrand :175)')
      .toBe(5);
  });
});

// ===========================================================================
// The four units the W22-B1 BUILD review added (ruling R131, findings 1-4).
// Each is measured on the merged product at f0421eb before it is ruled.
// ===========================================================================

const BRAND_B = 'coach-outlet';

/** A second brand of the same tenant: the same record shape, another brand. */
const otherBrand = <T extends { brand: string }>(row: T): T => ({ ...row, brand: BRAND_B });

/** The published lift snapshot an operator reads: publish the slot, then read it. */
async function publishedLift(m: Mounted, slot = 'hero', brand = BRAND): Promise<LiftSnapshot | null> {
  const published = await operatorPost(m, `/v1/${TENANT}/learn/publish`, { slot, brand });
  expect(published.status, `POST /v1/:tenant/learn/publish answers: ${JSON.stringify(published.body).slice(0, 200)}`).toBe(200);
  const read = await operatorGet(m, `/v1/${TENANT}/lift?slot=${slot}&brand=${brand}`);
  expect(read.status, `GET /v1/:tenant/lift answers: ${JSON.stringify(read.body).slice(0, 200)}`).toBe(200);
  return (read.body as { snapshot?: LiftSnapshot | null }).snapshot ?? null;
}
const creditedNow = (snapshot: LiftSnapshot | null): number => snapshot?.items['cnt-tabby-evening']?.['*']?.s ?? 0;

// ===========================================================================
// unit:W22.D1.04 — the credited-outcome journal keys on the record, not the id
// ===========================================================================

describe('unit:W22.D1.04', () => {
  /**
   * The W22-B1 build review, finding 1: `DecisionRing.ts:503-509` matches a
   * credited outcome on `entry.id === id` alone, and `CreditedOutcome` is
   * `{id, ts, expiresAt}`. The id is
   * `tenant:ts36:visitor:event:n1:eventId` (`src/ledger/records.ts:270`) and
   * covers neither `item_id`, nor `value`, nor `products`. So the very fixture
   * W22.D1.03 rules as a NAMED conflict on the ledger — two different records
   * under one stable id — is silently collapsed to one credit online, while
   * the exposure half of the same guarantee already keys on
   * `${row.decision}:${row.digest}` (`LearnStats.ts:449`) "because a different
   * record under the same id is a different event and is applied, never
   * silently dropped (F16 §5(j))". One representation, both halves.
   *
   * The two halves this unit holds together: a different RECORD under one id is
   * a different event and is credited; the SAME record redelivered is one event
   * and is credited once (W22.D1.02, which this unit must not undo).
   */
  it('host: two different outcome records under one stable id each credit the published snapshot, and an identical redelivery of either credits nothing more', async () => {
    const m = await mount();
    const slotConfig = () => ({ reward: 'click' as const, stats: DEFAULT_STATS, objective: 'unit' as const, measurementBasis: 'served-v1' as const });
    const d1 = decision(m.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening');
    const first = click(m.env, d1, ONLINE_TS + 60_000, 'w22-b2-digest-click');
    // A genuinely different event that the engine's own id cannot tell apart:
    // the same `outcome_id`, another VALUE — one of the three fields the id
    // does not cover (`records.ts:270`; F16 §5(j)). `logicalIdentity` calls it
    // `stable`, `attribute()` credits it against the same decision, and only
    // the id-keyed journal drops it (ruling R133 item 1: `item_id` is the field
    // the `direct` match keys on, so a record differing by it never attributes
    // and could not reach this credit at all).
    const second = { ...first, value: 495 } as OutcomeRecord;
    await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: d1.visitor_id, records: [d1] }, slotConfig);

    await fanOutcome(m.env, TENANT, first, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());
    await m.drain();
    const afterFirst = creditedNow(await publishedLift(m));
    expect(afterFirst > 0, `the fixture's first credit must be published: ${afterFirst}`).toBe(true);

    await fanOutcome(m.env, TENANT, second, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());
    await m.drain();
    const afterSecond = creditedNow(await publishedLift(m));
    expect(afterSecond / afterFirst,
      `W22.D1.04 — a DIFFERENT record under one stable \`outcome_id\` is a different event and is credited: the credited-outcome journal keys on the record's digest as the exposure journal does (LearnStats.ts:449 \`${'${row.decision}:${row.digest}'}\`; DecisionRing.ts:503-509 matches on the id alone today). One credit published ${afterFirst}, two published ${afterSecond}`)
      .toBeCloseTo(2, 3);

    await fanOutcome(m.env, TENANT, first, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());
    await fanOutcome(m.env, TENANT, second, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());
    await m.drain();
    expect(creditedNow(await publishedLift(m)) / afterSecond,
      'W22.D1.04 — and redelivering either of them credits nothing more: the same record under the same id is one event (W22.D1.02, F16 §7)')
      .toBeCloseTo(1, 3);
  });
});

// ===========================================================================
// unit:W22.D1.05 — a conflict belongs to its own brand
// ===========================================================================

describe('unit:W22.D1.05', () => {
  /**
   * The W22-B1 build review, finding 2: `ReportRowConflict` is raised in
   * `loadDay` before the brand filter, and `runReport` (`report.ts:1190`) sets
   * `counts.conflicts` from `d.conflicts`/`o.conflicts` without the
   * `row.brand === ids.brand` filter the `duplicates` line right above it
   * applies. A conflict in one brand refuses, and then decorates, another
   * brand's day. Duplicates and conflicts are one vocabulary (W22.D1.03) and
   * must have one scope.
   */
  it('host: a conflict in one brand neither blocks nor decorates another brand of the same tenant, and is named on its own brand', async () => {
    const m = await mount();
    const clean = decision(m.env, 'v-tabby', T12 + 60_000, 'cnt-tabby-evening');
    const cleanClick = click(m.env, clean, T12 + 120_000, 'w22-b2-brand-a-click');
    const other = otherBrand(decision(m.env, 'v-rogue', T12 + 180_000, 'cnt-rogue-work'));
    const otherClick = otherBrand(click(m.env, other, T12 + 240_000, 'w22-b2-brand-b-click'));
    await throughTheLedger(m, [clean, other], [cleanClick, otherClick]);
    // The collision lives in brand B only.
    const collision = { ...otherClick, item_id: 'cnt-charms-slg' } as OutcomeRecord;
    expect((await consumeLedger(m.env, [{ kind: 'ledger', type: 'outcome', version: 1, record: collision }], NOW)).ok,
      'the fixture writes brand B\'s colliding event the way at-least-once delivery does').toBe(true);

    const brandA = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    const answeredA = (brandA.body as { report?: DayReport }).report;
    expect({ status: brandA.status, counts: answeredA ? { decisions: answeredA.counts.decisions, outcomes: answeredA.counts.outcomes,
      conflicts: (answeredA.counts as { conflicts?: unknown }).conflicts ?? 'none' } : `no report: ${JSON.stringify(brandA.body).slice(0, 180)}` },
      'W22.D1.05 — the brand that has no conflict is answered: its own decision and outcome, and no conflict of its own (report.ts:1190 filters `conflicts` by brand as the `duplicates` line above it already does)')
      .toEqual({ status: 200, counts: { decisions: 1, outcomes: 1, conflicts: 'none' } });

    // And brand B's own day names it, then reads again with the exclusion counted.
    const refusedB = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND_B });
    expect((refusedB.body as { conflict?: { stream?: string; id?: string } }).conflict
      ?? `absent: \`conflict\` on brand B's refusal (${JSON.stringify(refusedB.body).slice(0, 180)})`,
      'W22.D1.05 — the brand that HAS the conflict is the one refused, and its refusal names the colliding id (W22.D1.03)')
      .toEqual({ stream: 'outcome', id: otherClick.outcome_id });
    const brandB = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND_B });
    const answeredB = (brandB.body as { report?: DayReport }).report;
    expect(answeredB ? { decisions: answeredB.counts.decisions, outcomes: answeredB.counts.outcomes,
      conflicts: (answeredB.counts as { conflicts?: unknown }).conflicts } : `no report: ${JSON.stringify(brandB.body).slice(0, 180)}`,
      'W22.D1.05 — and once filed, brand B reads again with the exclusion counted on ITS day')
      .toEqual({ decisions: 1, outcomes: 1, conflicts: { decisions: 0, outcomes: 1 } });
  });
});

// ===========================================================================
// unit:W22.R1.06 — the export reconciliation is scoped like the report
// ===========================================================================

/** The ruled member W22.R1.05 built, read off the listing's JSON answer. */
interface ExportCounts {
  rows: { decisions: number; outcomes: number };
  distinct: { decisions: number; outcomes: number };
  report: { decisions: number; outcomes: number };
  agrees: boolean;
}

describe('unit:W22.R1.06', () => {
  /**
   * The W22-B1 build review, finding 3: `exportReconciliation`
   * (`report.ts:1111-1145`) counts `distinct` over every row of the day's
   * objects while `report` comes from ONE brand's saved day, so a tenant with
   * two brands can never agree — `agrees` is structurally false, and an
   * operator reading a healthy multi-brand day is told the export disagrees
   * with the report. The listing takes the same `brand` selector the report
   * route takes, and scopes `distinct` to it.
   */
  it('host: for a tenant with two brands, the listing counts the rows of the brand it was asked for and agrees with that brand\'s published day', async () => {
    const m = await mount();
    const a = decision(m.env, 'v-tabby', T12 + 60_000, 'cnt-tabby-evening');
    const aClick = click(m.env, a, T12 + 120_000, 'w22-b2-export-a');
    const b = otherBrand(decision(m.env, 'v-rogue', T12 + 180_000, 'cnt-rogue-work'));
    const bClick = otherBrand(click(m.env, b, T12 + 240_000, 'w22-b2-export-b'));
    await throughTheLedger(m, [a, b], [aClick, bClick]);
    const built = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    expect(built.status, `the report route answers: ${JSON.stringify(built.body).slice(0, 200)}`).toBe(200);
    expect((built.body as { report: DayReport }).report.counts.decisions,
      'the fixture publishes brand A\'s day: one decision, one outcome').toBe(1);

    const listed = await operatorGet(m, `/v1/${TENANT}/ledger/batches?date=${DATE}&brand=${BRAND}`);
    expect(listed.status, `the export listing answers: ${JSON.stringify(listed.body).slice(0, 200)}`).toBe(200);
    const counts = (listed.body as { counts?: ExportCounts }).counts
      ?? `absent: \`counts\` on the listing (${Object.keys(listed.body).sort().join(', ')})`;
    expect(typeof counts === 'string' ? counts : { distinct: counts.distinct, report: counts.report, agrees: counts.agrees },
      'W22.R1.06 — the listing is scoped by the same `brand` selector the report route takes, so a two-brand tenant reconciles: brand A holds one distinct decision and one distinct outcome, exactly the day published for brand A, and they agree (report.ts:1111-1145)')
      .toEqual({ distinct: { decisions: 1, outcomes: 1 }, report: { decisions: 1, outcomes: 1 }, agrees: true });
    expect(typeof counts === 'string' ? counts : counts.rows,
      'W22.R1.06 — while `rows` still says what the objects of that brand physically hold, so a warehouse job reading them can check itself')
      .toEqual({ decisions: 1, outcomes: 1 });
  });
});

// ===========================================================================
// unit:W22.A1.01 companion — one constant for the ring's reach
// ===========================================================================

describe('unit:W22.A1.02', () => {
  /**
   * The W22-B1 build review, finding 4: `ONLINE_RING_REACH_MS`
   * (`src/learn/fan.ts:56`) is a second literal `7 * 24 * 60 * 60 * 1000`
   * duplicating `RING_MAX_AGE_MS` (`src/durable-objects/DecisionRing.ts:21`),
   * which is not exported. The online snapshot's declared `appliedWindowsMs`
   * is derived from the copy, so it silently stops describing the ring the
   * moment either literal moves. W22.A1.01 rules that a path declares the
   * horizon it ACTUALLY applied; this unit rules that there is one constant to
   * declare.
   */
  it('logic: the ring exports the one constant for its reach and the fan-out reads it instead of restating the number', async () => {
    const ring = await import('@/durable-objects/DecisionRing') as Record<string, unknown>;
    expect(ring.RING_MAX_AGE_MS ?? `absent: \`RING_MAX_AGE_MS\` is not exported by src/durable-objects/DecisionRing.ts (it exports ${Object.keys(ring).sort().join(', ')})`,
      'W22.A1.02 — the object that owns the ring exports the reach it enforces, so every reader can name the same number (build review finding 4)')
      .toBe(7 * 24 * 60 * 60 * 1000);
    const fan = await import('@/learn/fan') as Record<string, unknown>;
    expect(fan.ONLINE_RING_REACH_MS === ring.RING_MAX_AGE_MS,
      `W22.A1.02 — and the fan-out's reach IS that constant, not a copy of its value (fan.ts has ${String(fan.ONLINE_RING_REACH_MS)}, the ring has ${String(ring.RING_MAX_AGE_MS)})`)
      .toBe(true);
    // Read from this file's own location, never from the process's working
    // directory: a cwd-relative read takes another checkout's file (R133 item 2).
    const source = readFileSync(new URL('../../learn/fan.ts', import.meta.url), 'utf8');
    // The module that DECLARES the constant, whichever of the three it is: the
    // ring already imports `@/learn/fan`, so importing back from the ring's own
    // module is a cycle that Vite's hoisting resolves to `undefined` whenever
    // the ring loads first (ruling R137 item 1). A shared declaring module that
    // the ring re-exports satisfies the same rule.
    expect(/import\s*\{[^}]*\bRING_MAX_AGE_MS\b[^}]*\}\s*from\s*'(\.\/stats|@\/learn\/stats|@\/durable-objects\/DecisionRing)'/.test(source),
      'W22.A1.02 — `src/learn/fan.ts` IMPORTS the ring\'s own constant from the module that declares it')
      .toBe(true);
    expect(/ONLINE_RING_REACH_MS\s*=\s*RING_MAX_AGE_MS\s*;/.test(source),
      'W22.A1.02 — and its reach IS that binding, not a second literal')
      .toBe(true);
    expect(/ONLINE_RING_REACH_MS\s*=\s*7\s*\*/.test(source),
      'W22.A1.02 — and no longer restates the literal seven days beside it, which is how the two drifted apart')
      .toBe(false);
  });

  it('host: the published snapshot declares the ring\'s own constant as the horizon it applied, where the published policy asks for more than the ring holds', async () => {
    // A tenant that asks for TEN days of purchase history: longer than the ring
    // can hold, so the horizon the online path declares is the ring's reach
    // itself and nothing else — the one number this unit is about.
    const TEN_DAYS = 10 * DAY_MS;
    const askedForMore = { ...W22_LEARN, policy: { scope: 'session', match: 'direct', credit: 'last',
      windowsMs: { purchase: TEN_DAYS } } } as unknown as LearnConfig;
    const m = await mount({ learn: askedForMore });
    const storyConfig = () => ({ reward: 'purchase' as const, stats: DEFAULT_STATS, objective: 'unit' as const, measurementBasis: 'served-v1' as const });
    const policy = { ...DEFAULT_POLICY, windowsMs: { ...DEFAULT_POLICY.windowsMs, purchase: TEN_DAYS } };
    const story = decision(m.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening', 'story');
    const bought = { ...outcomeFromAction({ type: 'purchase', userId: story.visitor_id, sessionId: story.session_id ?? undefined,
      timestamp: ONLINE_TS + 60_000, eventId: 'w22-b2-reach-purchase', eventIdSource: 'provided',
      data: { contentId: story.item_id, slot: 'story', value: 495, currency: 'USD' } } as never, TENANT, BRAND)!,
      retention: captureRetention(m.env as never, TENANT, ONLINE_TS + 60_000, ONLINE_TS + 60_000) } as OutcomeRecord;
    await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: story.visitor_id, records: [story] }, storyConfig);
    await fanOutcome(m.env, TENANT, bought, policy, BRAND, { story: storyConfig() }, storyConfig());
    await m.drain();
    const snapshot = await publishedLift(m, 'story');
    const ring = await import('@/durable-objects/DecisionRing') as Record<string, unknown>;
    const contract = (snapshot as unknown as { attributionContract?: { appliedWindowsMs?: Record<string, number>; windowsMs?: Record<string, number> } } | null)?.attributionContract;
    // Compared against the ring's OWN export, with no literal of this file's
    // beside it: while the constant is not exported there is nothing for the
    // declaration to follow, and once it is, a change to the ring moves both
    // sides of this assertion together.
    const reach = ring.RING_MAX_AGE_MS ?? 'absent: `RING_MAX_AGE_MS` is not exported by src/durable-objects/DecisionRing.ts, so no reader can name the reach the ring enforces';
    expect({ asked: contract?.windowsMs?.purchase, applied: contract?.appliedWindowsMs?.purchase },
      'W22.A1.02 — the horizon the online path declares is the ring\'s own exported constant, never the longer window the policy asked for, so the declaration follows the ring when the ring changes (W22.A1.01; build review finding 4)')
      .toEqual({ asked: TEN_DAYS, applied: reach });
  });
});
