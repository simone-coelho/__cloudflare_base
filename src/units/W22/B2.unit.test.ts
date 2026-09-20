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
import { catchUp, hourKey, runDayReport, shardOf } from '@/learn/hourly';
import type { DayReport } from '@/learn/report';
import { DEFAULT_STATS } from '@/learn/stats';
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
    const c14 = click(r.env, d12, T12 + 2 * HOUR_MS + 60_000, 'w22-b1-cross-hour');          // 14:01, on the 12:59 item
    await throughTheLedger(r, [d12, d13], [c14]);
    const twelve = dayObjects(r, 'decision').find(key => key.startsWith(`${TENANT}/${DATE}/12/`))!;
    const held = r.storage.objects.get(twelve)!;
    r.storage.objects.delete(twelve);                                   // hour 12 unreadable on the first run
    await fold(r, T12 + 3 * HOUR_MS);                                   // folds 13 and 14 without 12
    r.storage.objects.set(twelve, held);                                // the hour is readable again
    await fold(r, T12 + 3 * HOUR_MS + 60_000);                          // the repair run

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
