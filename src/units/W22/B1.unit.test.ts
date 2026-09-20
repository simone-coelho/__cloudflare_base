// src/units/W22/B1.unit.test.ts
// W22 batch B1 — event and evidence consistency: one logical identity and
// dedup before caps on every read path, online idempotence across calls,
// collision and retry, loss that is never silent, late arrivals re-folded,
// explicit completeness that reaches the reader, cross-sink reconciliation,
// one versioned attribution contract, and durable product-sort evidence.
//
// One `describe('unit:W22.<id>')` per unit of batch W22-B1, one `it` per ruled
// leg. Every expected value comes from a witness or from a hand-computed
// fixture, never from what the engine returns today.
//
// WITNESSES
//   · document 35 §5 row W22 (:424): "Shared logical event identity/dedup
//     before caps; durable online/R2/fold/export reconciliation and explicit
//     completeness. Define one attribution contract with versioned
//     histories/horizons, not blindly identical caps. Wire persisted
//     product-sort evidence via W14. Fault tests include ID collision/retry,
//     late arrivals, partial writes and sink mismatch."
//   · document 35 §2 F16 (:137-:141), F17 (:143-:147), N10 (:272), N23 (:285).
//   · docs/architecture/35-verification-reports/F16.md: §2.1 (the identical
//     message consumed twice — "two objects, two rows"), §2.4 (one redelivery
//     moves every customer-facing number of the day report), §2.5 (the two
//     stores disagreeing, with "no log line, no counter and no alarm
//     anywhere"), §2.6 ("Read-time dedup restores the clean numbers exactly"),
//     §4.2 (the stable ids ALREADY EXIST — the work is to use them), §4.3
//     (idempotent object naming will not hold; "The reliable idempotency point
//     on this path is the read, not the write"), §5(e) (duplicates "can push a
//     legitimate hour into `truncated: true` and silently drop real records"),
//     §5(j) (a naive dedup must not drop two genuinely distinct events that
//     share a legacy id), §7.1-7.4 (dedup on read in two places counted as
//     `duplicates_dropped`; a dead-letter queue on the three consumers; the
//     producer's and the consumer's drops counted; `res.ok` checked in the
//     fan-out), §7 "Then, before learning is trusted" (a bounded set of
//     recently credited `outcome_id`s in `DecisionRing`, `decision_id` back in
//     the `/exposures` payload, and the scheduled comparison of the published
//     lift snapshot against the day report's learning grid), §7 "Defer" (the
//     transactional outbox — the batch's `no-witness` row W22.P1.01).
//   · docs/architecture/35-verification-reports/F17.md: P1 (a late outcome into
//     an already-folded hour is never read again), P3b (a failed hour retried
//     after a later hour: `folded = ctx.from > state.through` is a monotonic
//     high-water mark, so the repaired hour's decisions never enter the rings
//     and the cross-hour credit is lost), P4 (the 48-hour batch horizon against
//     the seven-day purchase policy), P6, P7 (the frozen visitor count), §3.4
//     (the honesty signals die before they reach a human), §6 items 1-4 and
//     "Tests that should exist and do not". Item 5 (the ingest-time clamp) is
//     W23's and is not specified here.
//   · docs/handover/HANDOFF-2026-09-18.md §6 row W22 (:318): "Logical IDs,
//     ledger recovery/dedup and product-sort evidence already exist; W09/W14/W15
//     made further changes. Verify dedup before caps, online/R2/fold/export
//     reconciliation/completeness and one versioned attribution/history
//     contract. Do not assume earlier online-idempotence gaps remain
//     unchanged." — ruling R104(a): MEASURE FIRST. Where a behaviour already
//     holds, the `it` measures it and the row records GREEN-AT-SPEC with the
//     reversing product line; where it is missing, the failing assertion names
//     the missing behaviour.
//   · docs/handover/HANDOFF-2026-09-16.md §6 row W22 (:226): what exists
//     (SDK/realtime/ledger logical ids, `src/ledger/delivery.ts` canonical
//     equality, `writer.ts` conditional identity, report dedup before caps,
//     retained DecisionRing dedup, explicit incomplete fan-out, product-sort
//     records/export) and what is open (`src/learn/fan.ts` exposure call
//     without durable logical ids, `LearnStats.ts` adding each received
//     exposure, no durable outcome journal in DecisionRing, cross-sink and
//     history reconciliation, scheduled sort persistence not a durable
//     acknowledgment).
//   · docs/architecture/tapestry_requirements.txt A.3.6 — every fixture below
//     uses the customer's own vocabulary (Tabby, Rogue, evening, work,
//     Handbags, Small Leather Goods) and an UNKNOWN cell, held here and never
//     in product code (METHOD §6).
//   · rulings R19 (a host leg drives the mounted routes production serves;
//     host-internal only where no public route exposes the observable), R21 (a
//     ruled-but-absent member is named), R68(a) (an operator workflow is the
//     SHIPPED screen under jsdom bound to the mounted app), R104(a)-(i).
//
// ONE REPRESENTATION, SHARED BY EVERY UNIT BELOW
//   (i)   LOGICAL IDENTITY is the id the engine already mints: `decision_id`
//         (`src/content/decide.ts`), `outcome_id` with its event nonce
//         (`src/ledger/records.ts:263`) and the product-sort `record_id`
//         (`src/ledger/productSort.ts:27`). No unit asks for a new id (F16
//         §4.2); every unit asks that the existing one be USED.
//   (ii)  DEDUP IS ON THE READ, BEFORE ANY CAP (F16 §4.3, §7.1). A second copy
//         of one logical event is dropped by the reader and COUNTED, never
//         silently, and never by refusing the whole report; two genuinely
//         DIFFERENT events that collide on one id are never merged (F16 §5(j)).
//   (iii) IDEMPOTENCE ONLINE IS BOUNDED (R104(c)): a journal of recently
//         credited ids pruned with the ring's own horizon. No unit claims
//         absolute idempotence, and none asserts a repeat beyond the horizon.
//   (iv)  A COUNT IS NEVER A SILENCE. Every drop this batch names is reported
//         as a number on a surface an operator reads, and zero is reported as
//         zero, never as an absent member.
//   (v)   COMPLETENESS IS DECLARED, NOT INFERRED: an hour that was never
//         folded, one whose rings did not advance (`ringsFolded: false`) and a
//         truncated hour each reach the day report, the window report and both
//         screens.
//
// SEAMS, NOT CROSSED
//   · W21-B1 (in build on the same files) rules `DayReport.targets`,
//     `WindowReport.targets`, `armVisitors`, `allocation`, `visitorOutcomes`,
//     the `experiment` provenance block, the `source_incomplete` reason and the
//     export listing's `from`/`to`/`date`. No unit below reads or rules any of
//     them; the members ruled here (`counts.duplicates`, `evidenceLoss`,
//     `reconciliation`, `attributionContract`) are disjoint by name.
//   · W23 owns order-invariant counters, exact rates and the bounded validated
//     event time (F17 §6 item 5). W24 owns accumulation-semantics generations.
//     W27 owns replay. W30 owns the capacity/reconstruction envelope. Named in
//     each row; nothing below asserts them.
//
// RULED MISSING MEMBERS (R21), asserted here by the names this specification
// rules and RED until they exist. No new module and no new export is ruled, so
// a missing member is a compiler error and a named assertion, never a module
// that fails to load:
//   1. `MonitorResult.evidenceLoss` — the one vocabulary for every drop path
//      (W22.R1.01): `{ since, producerFailed, consumerSkipped, fanOutRejected,
//      retriesExhausted }`.
//   2. `MonitorResult.reconciliation` — the scheduled cross-sink comparison
//      (W22.R1.04): `{ since, compared, disagreements: [{ brand, slot, online,
//      ledger, difference, threshold }] }`.
//   3. `attributionContract` on the day report, the window report and the
//      published lift snapshot (W22.A1.01): `{ name, version, history,
//      windowsMs, appliedWindowsMs }`.
//   4. `decision_id` on each row of the `/exposures` payload, and the bounded
//      journal of credited `outcome_id`s behind `/outcome` (W22.D1.02) —
//      observable as the lift snapshot a redelivery must not move.

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { JSDOM } from 'jsdom';
import * as jose from 'jose';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotCatalog } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { consumeLedger } from '@/ledger/consume';
import { enqueueDecisions, enqueueOutcome } from '@/ledger/enqueue';
import { captureQuarantine, listQuarantine } from '@/ledger/quarantine';
import { outcomeFromAction, ts36, type OutcomeRecord } from '@/ledger/records';
import { fanDecisions, fanOutcome, ringName, statsName } from '@/learn/fan';
import { buildHour, catchUp, DEFAULT_HORIZON_MS, hourKey, runDayReport, shardOf } from '@/learn/hourly';
import { DEFAULT_POLICY } from '@/learn/policy';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { canonicalReportJson, loadDay, reportKey, runReport, type DayReport } from '@/learn/report';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
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

// ── the ruled-but-absent members, read off the engine's own types (R21) ─────

/** RULED, ABSENT TODAY (R21): W22.R1.01's one vocabulary for every drop path. */
interface EvidenceLoss { since: number; producerFailed: number; consumerSkipped: number; fanOutRejected: number; retriesExhausted: number }
const evidenceLossMember = (result: MonitorResult): EvidenceLoss | undefined => result.evidenceLoss;

/** RULED, ABSENT TODAY (R21): W22.R1.04's scheduled cross-sink comparison. */
interface SinkReconciliation {
  since: number;
  /** How many (brand, slot) pairs the run actually compared; zero is never a clean result. */
  compared: number;
  disagreements: Array<{ brand: string; slot: string; online: number; ledger: number; difference: number; threshold: number }>;
}
const reconciliationMember = (result: MonitorResult): SinkReconciliation | undefined => result.reconciliation;

/** RULED, ABSENT TODAY (R21): W22.A1.01's one named, versioned attribution contract. */
interface AttributionContract {
  name: string;
  version: number;
  history: { scope: 'session' | 'visitor'; match: 'direct' | 'any'; credit: 'first' | 'last' };
  /** What the tenant's published policy asks for, per reward. */
  windowsMs: Record<string, number>;
  /** What this path could actually read, per reward. Never larger than `windowsMs`. */
  appliedWindowsMs: Record<string, number>;
}
const dayContract = (report: DayReport): AttributionContract | undefined => report.attributionContract;
const windowContract = (report: WindowReport): AttributionContract | undefined => report.attributionContract;
const snapshotContract = (snapshot: LiftSnapshot): AttributionContract | undefined => snapshot.attributionContract;

/**
 * The shipped screens run under jsdom; the repository's tsconfig carries the
 * Workers lib and no DOM lib, so the handful of browser shapes this file uses
 * are declared here, as `src/units/W20/B1.unit.test.ts` declares its own.
 */
interface ScreenElement { value: string; textContent: string | null; dispatchEvent: (event: unknown) => void }
interface ScreenWindow extends Record<string, unknown> {
  document: { body: { textContent: string | null }; getElementById: (id: string) => ScreenElement | null };
  Event: new (type: string, options: Record<string, unknown>) => unknown;
  localStorage: { setItem: (key: string, value: string) => void };
  eval: (code: string) => unknown;
  close: () => void;
}

/** The sentence a ruled-but-absent member produces, so the failure names it. */
const absent = (what: string, carrier: object): string => `absent: ${what} (the answer carries ${Object.keys(carrier).sort().join(', ')})`;

// ===========================================================================
// unit:W22.D1.01 — dedup before caps, on every read path
// ===========================================================================

describe('unit:W22.D1.01', () => {
  /**
   * F16 §2.1 measured the duplication: the same message consumed twice leaves
   * "two objects, two rows" with the same `outcome_id`. §2.6 measured the fix:
   * "Read-time dedup restores the clean numbers exactly". §7.1 rules where the
   * count goes: "count the skips into the report … so the rate is visible
   * instead of silent". §5(e) rules that the skip must happen BEFORE the cap,
   * because duplicates counted against `MAX_HOUR_OBJECTS` / `REPORT_CAP`
   * "silently drop real records from the fold".
   */
  it('logic: the day report, the hourly fold and the window report read the distinct rows of a duplicated ledger and name the count they dropped, and a duplicate never consumes a cap a real row needed', async () => {
    const m = await mount();
    const first = [
      decision(m.env, 'v-tabby', T12 + 60_000, 'cnt-tabby-evening'),
      decision(m.env, 'v-rogue', T12 + 120_000, 'cnt-rogue-work'),
    ];
    const second = [
      decision(m.env, 'v-charms', T12 + 180_000, 'cnt-charms-slg'),
      decision(m.env, 'u-unknown', T12 + 240_000, 'cnt-tabby-evening'),
    ];
    const decisions = [...first, ...second];
    const outcomes = [click(m.env, decisions[0]!, T12 + 300_000, 'w22-b1-click-tabby')];
    // Two consumer batches, so the hour holds two legitimate decision objects.
    const wire = await throughTheLedger(m, first, outcomes);
    await throughTheLedger(m, second, []);

    // The ledger as F16 §2.1 measured it: the same message consumed twice
    // leaves "two objects, two rows" under a second batch id (`consume.ts:22`,
    // `writer.ts:60`), and nothing on the write path prevents it.
    expect((await consumeLedger(m.env, wire, NOW)).ok, 'the redelivery is acknowledged by the real consumer').toBe(true);
    expect(dayObjects(m, 'decision').length,
      'the fixture ledger holds the duplicated object F16 §2.1 measured, beside the two legitimate ones').toBe(3);

    // One more copy of the first batch's rows, under the key that sorts LAST in
    // the day, so its duplicate rows are read only after every distinct row is
    // already in hand. A reader that applied the cap before the skip would stop
    // here and call the day truncated; a reader that skips first never reaches
    // the cap at all (F16 §7.1, §5(e)).
    const trailing = dayObjects(m, 'decision').at(-1)!.replace(/-[0-9a-z]+\.ndjson$/, '-zzzzzz.ndjson');
    m.storage.objects.set(trailing, m.storage.objects.get(dayObjects(m, 'decision')[0]!)!);
    expect(dayObjects(m, 'decision').at(-1), 'the trailing duplicate object is the last one the reader opens').toBe(trailing);

    // 1. The direct-record recomputation (`runReport`, `report.ts:loadDay`).
    const fromRecords = await runReport(m.storage as never, { tenant: TENANT, brand: BRAND, date: DATE }, W22_LEARN, null, NOW, m.env as never);
    expect({ decisions: fromRecords.counts.decisions, outcomes: fromRecords.counts.outcomes, visitors: fromRecords.counts.visitors },
      'W22.D1.01 — the day report reads the four distinct decisions and the one distinct click of a ledger that holds each of them twice (F16 §2.6)')
      .toEqual({ decisions: 4, outcomes: 1, visitors: 4 });
    expect(fromRecords.counts.duplicates,
      'W22.D1.01 — and it names what it dropped, in the engine\'s own vocabulary `counts.duplicates` (F16 §7.1)')
      .toEqual({ decisions: 4, outcomes: 1 });

    // 2. The hourly fold (`buildHour` → `loadHourRecords`), then the day from
    //    its hours, the way the cron publishes it (`src/index.ts:272`).
    const hour = await buildHour(m.storage as never, TENANT, { date: DATE, hour: HOUR }, W22_LEARN, NOW, {}, m.env as never);
    expect({ decisions: hour.brands[BRAND]?.decisions, outcomes: hour.brands[BRAND]?.outcomes },
      'W22.D1.01 — the hourly fold counts each logical event once (F16 §2.6, hourly.ts:loadHourRecords)')
      .toEqual({ decisions: 4, outcomes: 1 });
    expect(hour.brands[BRAND]?.duplicates,
      'W22.D1.01 — and the hour names what it dropped, in the same vocabulary as the day report')
      .toEqual({ decisions: 4, outcomes: 1 });
    const fromHours = await runDayReport(m.storage as never, { tenant: TENANT, brand: BRAND, date: DATE }, W22_LEARN, null, NOW, {}, m.env as never);
    expect({ decisions: fromHours.counts.decisions, outcomes: fromHours.counts.outcomes, duplicates: fromHours.counts.duplicates },
      'W22.D1.01 — the day built from its hours reports the same distinct numbers and the same dropped count')
      .toEqual({ decisions: 4, outcomes: 1, duplicates: { decisions: 4, outcomes: 1 } });

    // 3. The window report pools the saved day: the duplicated rows must not
    //    reach the pooled arms either (F16 §2.7 — duplication shrinks the
    //    interval and can call a win the evidence does not support).
    const window = await windowReport(m.storage as never, { tenant: TENANT, brand: BRAND, from: DATE, to: DATE });
    expect(window.slots.hero?.arms.map(row => ({ arm: row.arm, n: row.n, s: row.s })),
      'W22.D1.01 — the window pools the distinct rows: four personalized decisions and one credit')
      .toEqual([{ arm: 'personalized', n: 4, s: 1 }]);

    // 4. BEFORE the cap, and the ORDER matters. The day holds four distinct
    //    decision rows and four duplicates, two of them in the object that
    //    sorts last: a reader capped at exactly four records has its four
    //    distinct rows in hand when the trailing duplicates arrive. Skipping
    //    first, it never reaches the cap and the day is not truncated; checking
    //    the cap first, it stops on the fifth row read and calls a complete day
    //    truncated (F16 §5(e), §7.1).
    const capped = await loadDay<DecisionRecord>(m.storage as never, TENANT, DATE, 'decision', 4);
    expect(capped.records.map(row => row.decision_id).sort(),
      'W22.D1.01 — the cap is applied to the distinct rows, after the duplicate is skipped (F16 §5(e), §7.1)')
      .toEqual(decisions.map(row => row.decision_id).sort());
    expect(capped.truncated,
      'W22.D1.01 — and a day whose DISTINCT rows fit the cap is not reported truncated, even though its duplicates are read after the cap is full')
      .toBe(false);

    // 5. The same rule on the hour's OBJECT cap. The hour holds six objects —
    //    four decision objects (two of them duplicates) and two outcome objects
    //    (one of them a duplicate) — read under a cap of five. Every distinct
    //    row of the hour must still be counted: a duplicate object may not
    //    consume the cap in place of a real one.
    expect([...m.storage.objects.keys()].filter(key => key.startsWith(`${TENANT}/${DATE}/${HOUR}/`)).length,
      'the fixture hour holds six objects: two duplicate decision objects and one duplicate outcome object beside the real ones').toBe(6);
    const hourCapped = await buildHour(m.storage as never, TENANT, { date: DATE, hour: HOUR }, W22_LEARN, NOW, { maxObjects: 5 }, m.env as never);
    expect({ decisions: hourCapped.brands[BRAND]?.decisions, outcomes: hourCapped.brands[BRAND]?.outcomes },
      'W22.D1.01 — a duplicate object never consumes the hour\'s object cap in place of a real one (F16 §5(e): duplicates "can push a legitimate hour into truncated:true and silently drop real records")')
      .toEqual({ decisions: 4, outcomes: 1 });
  });

  it('host: the mounted operator report route answers the distinct numbers over a duplicated ledger and names the dropped count', async () => {
    const m = await mount();
    const decisions = [
      decision(m.env, 'v-tabby', T12 + 60_000, 'cnt-tabby-evening'),
      decision(m.env, 'v-rogue', T12 + 120_000, 'cnt-rogue-work'),
    ];
    const wire = await throughTheLedger(m, decisions, [click(m.env, decisions[1]!, T12 + 200_000, 'w22-b1-click-rogue')]);
    expect((await consumeLedger(m.env, wire, NOW)).ok, 'the redelivery is acknowledged by the real consumer').toBe(true);

    const built = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    expect(built.status, `the report route answers: ${JSON.stringify(built.body).slice(0, 300)}`).toBe(200);
    const report = (built.body as { report: DayReport }).report;
    expect({ decisions: report.counts.decisions, outcomes: report.counts.outcomes, duplicates: report.counts.duplicates },
      'W22.D1.01 — POST /v1/:tenant/learn/report reports the two distinct decisions, the one distinct outcome, and the copies it dropped')
      .toEqual({ decisions: 2, outcomes: 1, duplicates: { decisions: 2, outcomes: 1 } });

    const saved = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${DATE}&brand=${BRAND}`);
    expect(saved.status, `the saved report reads back: ${JSON.stringify(saved.body).slice(0, 300)}`).toBe(200);
    expect((saved.body as { report: DayReport }).report.counts.duplicates,
      'W22.D1.01 — and the canonical report an operator reads later carries the same dropped count')
      .toEqual({ decisions: 2, outcomes: 1 });
  });
});

// ===========================================================================
// unit:W22.D1.02 — online idempotence across calls
// ===========================================================================

/**
 * F16 §2.3 measured the online duplication on the real classes: "credits,
 * outcome delivery #1 / #2 : 1 / 1 (same outcome_id both times)" and an
 * exposure counted twice because "`fan.ts:81` discards decision IDs from
 * exposure payloads". §7 rules the fix: "carry a bounded set of recently
 * credited `outcome_id`s in `DecisionRing`'s stored state … and put
 * `decision_id` back into the `/exposures` payload so `LearnStats` can do the
 * same". R104(c): bounded, pruned with the ring's own horizon — this unit
 * redelivers inside the horizon and never claims a repeat beyond it.
 *
 * TWO LEGS, one representation. The `host` leg reads the observable where an
 * operator reads it — `POST /v1/:tenant/learn/publish` then
 * `GET /v1/:tenant/lift?slot=hero` on the mounted app — and redelivers the
 * OUTCOME, which a client retry really does produce (the same action with the
 * same event nonce mints the same `outcome_id`, `src/ledger/records.ts:263`).
 * The `host-internal` leg (R19) adds the EXPOSURE hop, which no public producer
 * can redeliver — the only caller of `/exposures` is the decision path's own
 * fan-out (`src/content/service.ts:473` → `fanDecisions`) — and repeats the
 * outcome beside it across a restart of both objects, so the journal behind
 * both hops has to be durable rather than in memory. Both legs drive the REAL
 * `DecisionRing` and `LearnStats` classes.
 */
describe('unit:W22.D1.02', () => {
  const slotConfig = () => ({ reward: 'click' as const, stats: DEFAULT_STATS, objective: 'unit' as const, measurementBasis: 'served-v1' as const });

  const snapshotOf = async (m: Mounted): Promise<LiftSnapshot | null> => {
    const namespace = m.env.LEARN_STATS!;
    const response = await namespace.get(namespace.idFromName(statsName(TENANT, BRAND, 'hero'))).fetch('https://learn/snapshot');
    const body = await response.json() as { snapshot: LiftSnapshot | null };
    return body.snapshot;
  };
  const counts = (snapshot: LiftSnapshot | null) => ({
    item: snapshot?.items['cnt-tabby-evening']?.['*'] ? { n: snapshot.items['cnt-tabby-evening']!['*']!.n, s: snapshot.items['cnt-tabby-evening']!['*']!.s } : null,
    slot: snapshot?.slotRates['*'] ? { n: snapshot.slotRates['*']!.n, s: snapshot.slotRates['*']!.s } : null,
  });
  /**
   * Both counters decay against the wall clock with the same τ, so a difference
   * in READING TIME cancels in the ratio while a second delivery does not: one
   * delivery against one delivery is 1.0, two against one is 2.0, whatever the
   * seconds between the two reads.
   */
  const ratio = (later: number, earlier: number) => later / earlier;

  /** What an operator reads: publish the slot now, then read the published snapshot. */
  const publishedLift = async (m: Mounted): Promise<LiftSnapshot | null> => {
    const published = await operatorPost(m, `/v1/${TENANT}/learn/publish`, { slot: 'hero', brand: BRAND });
    expect(published.status, `POST /v1/:tenant/learn/publish answers: ${JSON.stringify(published.body).slice(0, 300)}`).toBe(200);
    const read = await operatorGet(m, `/v1/${TENANT}/lift?slot=hero&brand=${BRAND}`);
    expect(read.status, `GET /v1/:tenant/lift answers: ${JSON.stringify(read.body).slice(0, 300)}`).toBe(200);
    return (read.body as { snapshot?: LiftSnapshot | null }).snapshot ?? null;
  };

  it('host: a redelivered outcome — the same event nonce a client retry re-sends — leaves the PUBLISHED lift snapshot an operator reads where one delivery leaves it', async () => {
    const seed = async (deliveries: number) => {
      const m = await mount();
      const d = decision(m.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening');
      const o = click(m.env, d, ONLINE_TS + 60_000, 'w22-b1-public-click');
      await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: d.visitor_id, records: [d] }, slotConfig);
      for (let n = 0; n < deliveries; n++) {
        // `src/learn/route.ts:40`, the call the action route makes for an
        // outcome; the second call is the client's retry of the same event.
        await fanOutcome(m.env, TENANT, o, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());
      }
      await m.drain();
      return m;
    };
    const control = counts(await publishedLift(await seed(1)));
    expect(control.item && control.item.s > 0,
      `the control must have published the one credit: ${JSON.stringify(control)}`).toBe(true);
    const redelivered = counts(await publishedLift(await seed(2)));
    const why = 'W22.D1.02 — a redelivered outcome must be credited once: `DecisionRing` consults a bounded journal of recently credited `outcome_id`s before `attribute()` (F16 §7, §2.3 measured "credits, outcome delivery #1 / #2 : 1 / 1"). '
      + `One delivery: ${JSON.stringify(control)}; after the redelivery: ${JSON.stringify(redelivered)}`;
    expect(redelivered.item, why).toBeTruthy();
    expect(ratio(redelivered.item!.s, control.item!.s), why).toBeCloseTo(1, 3);
    expect(ratio(redelivered.slot!.s, control.slot!.s), why).toBeCloseTo(1, 3);
    expect(ratio(redelivered.item!.n, control.item!.n),
      'W22.D1.02 — and the exposure behind it is still counted exactly once').toBeCloseTo(1, 3);
  });

  it('host-internal: a redelivered exposure and a redelivered outcome leave the published lift snapshot exactly where one delivery leaves it, across a restart of both objects', async () => {
    // The control: one delivery of each, on its own pair of objects.
    const control = await mount();
    const d0 = decision(control.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening');
    const o0 = click(control.env, d0, ONLINE_TS + 60_000, 'w22-b1-online-click');
    const exposed = await fanDecisions(control.env, { tenant: TENANT, brand: BRAND, visitor_id: d0.visitor_id, records: [d0] }, slotConfig);
    const credited = await fanOutcome(control.env, TENANT, o0, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());
    await control.drain();
    expect({ exposures: exposed.exposures.processed, credits: credited.outcome?.credits.processed },
      'the control pair must have taken exactly one exposure and one credit before anything is compared')
      .toEqual({ exposures: 1, credits: 1 });
    const once = counts(await snapshotOf(control));
    expect(once.item && once.item.n > 0 && once.item.s > 0,
      `the control snapshot must hold that exposure and that credit: ${JSON.stringify(once)}`).toBe(true);

    // The subject: the same two deliveries, each repeated — the at-least-once
    // redelivery F16 §2.3 measured — with a restart of both objects between the
    // first and the second, so the journal has to be durable, not in memory.
    const subject = await mount();
    const d1 = decision(subject.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening');
    const o1 = click(subject.env, d1, ONLINE_TS + 60_000, 'w22-b1-online-click');
    await fanDecisions(subject.env, { tenant: TENANT, brand: BRAND, visitor_id: d1.visitor_id, records: [d1] }, slotConfig);
    await fanOutcome(subject.env, TENANT, o1, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());
    await subject.drain();
    subject.restartObjects();
    await fanDecisions(subject.env, { tenant: TENANT, brand: BRAND, visitor_id: d1.visitor_id, records: [d1] }, slotConfig);
    await fanOutcome(subject.env, TENANT, o1, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());
    await subject.drain();

    const twice = counts(await snapshotOf(subject));
    const why = 'W22.D1.02 — one redelivered exposure and one redelivered outcome must leave the published snapshot where a single delivery leaves it: `LearnStats` counts the exposure once because the `/exposures` payload carries the decision\'s logical id (F16 §7, fan.ts:330), and `DecisionRing` credits the outcome once because a bounded journal of recently credited `outcome_id`s is consulted before `attribute()` (F16 §7, §2.3). One delivery: '
      + `${JSON.stringify(once)}; after the redelivery: ${JSON.stringify(twice)}`;
    // Compared as a ratio, so the seconds between the two reads cancel: one
    // delivery against one delivery is 1.0 whenever they are read, two against
    // one is 2.0.
    expect(twice.item, why).toBeTruthy();
    expect(ratio(twice.item!.n, once.item!.n), why).toBeCloseTo(1, 3);
    expect(ratio(twice.item!.s, once.item!.s), why).toBeCloseTo(1, 3);
    expect(ratio(twice.slot!.n, once.slot!.n), why).toBeCloseTo(1, 3);
    expect(ratio(twice.slot!.s, once.slot!.s), why).toBeCloseTo(1, 3);

    // The ring itself already refuses a duplicate append; the unit states it so
    // the two halves of the online path are read as one representation.
    const ring = subject.env.DECISION_RING!;
    const recent = await ring.get(ring.idFromName(ringName(TENANT, d1.visitor_id))).fetch('https://ring/recent');
    const held = await recent.json() as { ring: DecisionRecord[] };
    expect(held.ring.map(row => row.decision_id),
      'W22.D1.02 — and the visitor\'s ring holds the served decision exactly once after the redelivery')
      .toEqual([d1.decision_id]);
  });
});

// ===========================================================================
// unit:W22.D1.03 — collision and retry
// ===========================================================================

describe('unit:W22.D1.03', () => {
  /**
   * RE-SPECIFIED at ruling R120 item 1. The lead's earlier ruling of WRITE-side
   * idempotence is withdrawn: F16 §4.3 says content-addressed naming "will not
   * work" and that "the reliable idempotency point on this path is the read,
   * not the write", `src/ledger/ledger.test.ts:1445` forbids the consumer
   * reading the hour at all, and this batch's own green-at-spec units need the
   * duplicate object to EXIST (W22.D1.01 :580, W22.R1.05 :1441). The contract
   * is AT-LEAST-ONCE delivery with read-side dedup.
   *
   * So clause (a) of the original unit — an identical retry, and every read
   * path yielding each row once with the copies counted — is FOLDED INTO
   * W22.D1.01 (its logic leg consumes the redelivery and reads the day report,
   * the hourly fold and the window report; W22.R1.05 reads the export listing)
   * and is not repeated here. What remains is the pair of faults document 35 §5
   * row W22 names that no other unit covers:
   *  (b) a COLLISION — two genuinely DIFFERENT events under one logical id,
   *      which at-least-once delivery cannot prevent and the writer really
   *      stores (measured: the consumer answers `ok`, and the day then holds
   *      two rows under one `outcome_id`) — is never merged silently, is NAMED
   *      by the colliding id on an operator-visible answer, and is RECOVERABLE:
   *      the day reads again once the conflict is filed (F16 §5(j): "The dedup
   *      work must come with a decision about both — a per-event nonce in the
   *      id, or an accepted, documented collapse");
   *  (c) a PARTIAL write: the batch is not acknowledged, it is retried, and the
   *      read yields both rows once with the copy the retry left counted
   *      (F16 §2.2 measured three objects for two rows, which at-least-once
   *      permits — losing a row or double-counting it does not).
   *
   * MEASURED at specification, on the product as it stands: the collision is
   * written (`{written:1, objects:1, ok:true}`, two rows under one id), and
   * every read path then fails closed WITHOUT naming it — `POST /learn/report`
   * 400 `invalid raw report input`, `buildHour` and `runDayReport` throw
   * `ReportInputError`, `GET /v1/:tenant/ledger/:id` 500 with an empty body
   * (`writer.ts:463 lookupUnavailable()`), no quarantine case is filed (0), and
   * the window answers 200 with the day merely `missing`. Failing closed for
   * that day's numbers is the behaviour this unit rules; being unnamed and
   * unrecoverable is what it refuses.
   *
   * RULED, ABSENT TODAY (R21), read off the route's JSON answer so the compiler
   * count of ruled members stays at five:
   *   · `conflict: { stream, id }` on the refusal the report route answers;
   *   · `counts.conflicts: { decisions, outcomes }` on the day the report
   *     answers once the conflict is filed, in one vocabulary with
   *     `counts.duplicates`.
   */
  it('host: a collision under one logical id is never merged, is named by that id on an operator answer and on the recovery surface, and the day reads again once it is filed; a partial batch is retried and read once', async () => {
    const m = await mount();
    const d1 = decision(m.env, 'v-tabby', T12 + 60_000, 'cnt-tabby-evening');
    const o1 = click(m.env, d1, T12 + 300_000, 'w22-b1-retry-click');
    await throughTheLedger(m, [d1], [o1]);

    // (b) two DIFFERENT events under one logical id. Not a redelivery: the
    //     second carries another `item_id`, so it is a different event even
    //     under the logical-row equality W21-B1's third build uses (which
    //     excludes the `experiment` block). At-least-once delivery writes it.
    const collision = { ...o1, item_id: 'cnt-rogue-work' } as OutcomeRecord;
    const wrote = await consumeLedger(m.env, [{ kind: 'ledger', type: 'outcome', version: 1, record: collision }], NOW);
    expect(wrote.ok, 'the fixture writes the colliding event the way at-least-once delivery does').toBe(true);
    expect(ledgerRows(m, 'outcome').filter(row => row.outcome_id === o1.outcome_id).map(row => row.item_id).sort(),
      'the day now holds two different events under one logical id, which is the fault under test')
      .toEqual(['cnt-rogue-work', 'cnt-tabby-evening']);

    const refused = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    const refusal = refused.body as { ok?: boolean; conflict?: { stream?: string; id?: string }; report?: DayReport };
    expect(refusal.report?.counts.outcomes ?? 'no day was answered',
      'W22.D1.03 — the two events are never merged into one day: the report does not answer a day that counts the colliding id once (F16 §5(j))')
      .toBe('no day was answered');
    expect(refusal.conflict ?? `absent: \`conflict\` on the refusal (the answer carries ${Object.keys(refusal).sort().join(', ')})`,
      'W22.D1.03 — and the refusal NAMES the colliding logical id and its stream, instead of the unnamed "invalid raw report input" an operator cannot act on (ruled member: `conflict` on the report route\'s refusal)')
      .toEqual({ stream: 'outcome', id: o1.outcome_id });

    // Named on the recovery surface too, by the same id, in this tenant's
    // scope: the existing quarantine path (`src/ledger/quarantine.ts:109`,
    // listed by `GET /operator/ledger-recovery`, mounted here as
    // `src/index.ts:121` mounts it).
    const listing = await listQuarantine(m.env, TENANT);
    const cases = listing.items.map(entry => ({ tenant: entry.tenant,
      wire: m.storage.objects.get(`ledger-quarantine/v1/${entry.id}.json`) ?? '' }));
    expect(cases.filter(entry => entry.tenant === TENANT && entry.wire.includes(o1.outcome_id!)).map(entry => entry.tenant),
      `W22.D1.03 — the conflicting row is filed for recovery under this tenant, carrying ${o1.outcome_id} (the listing held ${listing.items.length} case(s))`)
      .toEqual([TENANT]);

    // RECOVERABLE: with the conflict filed, the day is readable again — the
    // first event stands, the conflicting row is excluded and counted in the
    // same vocabulary the duplicates use.
    const again = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    const recovered = (again.body as { report?: { counts?: Record<string, unknown> } }).report?.counts
      ?? `no report: ${JSON.stringify(again.body).slice(0, 200)}`;
    expect(typeof recovered === 'string' ? recovered
      : { decisions: recovered.decisions, outcomes: recovered.outcomes, conflicts: recovered.conflicts },
      'W22.D1.03 — and once the conflict is filed the day reads again on the existing recovery path: the first event under that id stands, the conflicting row is excluded, and the exclusion is counted (ruled member: `counts.conflicts`, beside `counts.duplicates`)')
      .toEqual({ decisions: 1, outcomes: 1, conflicts: { decisions: 0, outcomes: 1 } });

    // (c) the partial batch of F16 §2.2: R2 accepts the first object of the
    //     batch and throws on the second, then the whole batch is retried. The
    //     retry MAY leave a second copy of the object it already wrote; what it
    //     may not do is lose a row or let a reader count one twice.
    const p = await mount();
    const late = decision(p.env, 'v-charms', T12 + HOUR_MS + 60_000, 'cnt-charms-slg');   // hour 13
    const early = decision(p.env, 'v-tabby', T12 + 60_000, 'cnt-tabby-evening');          // hour 12
    await enqueueDecisions(p.env, [early, late]);
    const partial = p.queued.splice(0);
    let seen = 0;
    p.storage.failPutFrom = (key: string) => key.includes('/decision/') && ++seen === 2;
    const firstRun = await consumeLedger(p.env, partial, NOW);
    expect(firstRun.ok, 'W22.D1.03 — an interrupted batch is not acknowledged, so the queue redelivers it').toBe(false);
    p.storage.failPutFrom = null;
    const retry = await consumeLedger(p.env, partial, NOW);
    expect(retry.ok, 'W22.D1.03 — and the retry is acknowledged').toBe(true);
    const stored = [...p.storage.objects.keys()].filter(key => key.includes('/decision/'));
    const rows = stored.flatMap(key => p.storage.objects.get(key)!.split('\n').filter(Boolean).map(line => JSON.parse(line) as DecisionRecord));
    expect([...new Set(rows.map(row => row.decision_id))].sort(),
      'W22.D1.03 — the retry completes the batch: both rows are in the ledger, neither lost')
      .toEqual([early.decision_id, late.decision_id].sort());
    const readBack = await operatorPost(p, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    expect((readBack.body as { report: DayReport }).report.counts,
      'W22.D1.03 — and the READ yields each row once, with the copy the retry left counted, never a decision counted twice (F16 §2.2, §7.1)')
      .toMatchObject({ decisions: 2, duplicates: { decisions: rows.length - 2, outcomes: 0 } });
  });
});

// ===========================================================================
// unit:W22.R1.01 — loss is never silent
// ===========================================================================

describe('unit:W22.R1.01', () => {
  /**
   * N10: "Producer rejection, partial filtering, whole-message discard/ack, and
   * exhausted consumer retries are not comprehensively reconciled; no DLQ is
   * declared in the three consumer configurations." F16 §7.2-7.4 rules the
   * remedy. R104(d): the DLQ is a DECLARATION in the manifest; creating the
   * queue is provisioning at deployment and is a deployment dependency named in
   * the row, not something this unit can prove.
   */
  it('logic: the manifest declares a dead-letter queue on each of the three event-queue consumers, and the dead-letter queue it names is itself consumed', () => {
    const manifest = readFileSync('wrangler.toml', 'utf8');
    const blocks = [...manifest.matchAll(/\[\[(?:env\.[a-z]+\.)?queues\.consumers\]\]([\s\S]*?)(?=\n\[|$)/g)].map(match => match[1]!);
    const queueOf = (block: string) => /^queue\s*=\s*"([^"]+)"/m.exec(block)?.[1] ?? '';
    const dlqOf = (block: string) => /^dead_letter_queue\s*=\s*"([^"]+)"/m.exec(block)?.[1] ?? null;
    const consumed = new Set(blocks.map(queueOf));
    const sources = blocks.filter(block => !queueOf(block).includes('dead-letter'));
    expect(sources.map(queueOf),
      'the manifest declares one event-queue consumer per environment (F16 §5(a): wrangler.toml:29-34, :250-255, :348-353)')
      .toEqual(['events', 'events-staging', 'events-production']);
    expect(sources.map(block => `${queueOf(block)} → ${dlqOf(block) ?? 'NO dead_letter_queue'}`),
      'W22.R1.01 — every event-queue consumer declares a dead-letter queue, so a message whose retries are exhausted stops vanishing (N10; F16 §5(a), §7.2)')
      .toEqual(['events → events-dead-letter', 'events-staging → events-staging-dead-letter', 'events-production → events-production-dead-letter']);
    expect(sources.map(block => consumed.has(dlqOf(block) ?? '')),
      'W22.R1.01 — and each declared dead-letter queue is itself consumed, so a dead-lettered row is read by something')
      .toEqual([true, true, true]);
  });

  it('host: a producer send failure, a consumer-skipped row, a non-OK fan-out post and an exhausted retry are each counted in one vocabulary on the operator surface, and a tenant that lost nothing reads zero', async () => {
    const clean = await mount();
    const quiet = await operatorPost(clean, `/v1/${TENANT}/monitor`);
    expect(quiet.status, `the monitor run answers: ${JSON.stringify(quiet.body).slice(0, 300)}`).toBe(200);
    const quietLoss = evidenceLossMember((quiet.body as { result: MonitorResult }).result) ?? absent('`MonitorResult.evidenceLoss`', (quiet.body as { result: object }).result);
    expect(typeof quietLoss === 'string' ? quietLoss : { ...quietLoss, since: undefined },
      'W22.R1.01 — the monitor reports the tenant\'s evidence-loss counters, and a tenant that lost nothing reads zero on every path, never an absent member (ruled member: `MonitorResult.evidenceLoss`)')
      .toEqual({ since: undefined, producerFailed: 0, consumerSkipped: 0, fanOutRejected: 0, retriesExhausted: 0 });

    // 1. The producer's own failure: an outage on `queue.send`
    //    (`src/ledger/enqueue.ts` sendAll → `queue_unavailable`).
    const lossy = await mount({ queueFails: true });
    const d1 = decision(lossy.env, 'v-tabby', T12 + 60_000, 'cnt-tabby-evening');
    const produced = await enqueueDecisions(lossy.env, [d1]);
    expect(produced.code, 'the producer reports the outage on its receipt (src/ledger/enqueue.ts:119)').toBe('queue_rejected');

    // 2. The consumer's skipped row: an envelope the writer cannot place
    //    (`src/ledger/consume.ts:20`, `src/index.ts:264`).
    const skipped = await consumeLedger(lossy.env, [{ kind: 'ledger', type: 'outcome', version: 1, record: { outcome_id: 'not-a-carrier', tenant: TENANT } }], NOW);
    expect(skipped.skipped, 'the consumer reports the row it could not place').toBe(1);

    // 3. The fan-out post that was not accepted: the statistics object answers
    //    500 (F16 §5(c) — `post()` never checked `res.ok`).
    const rejecting = await mount({ statsStatus: () => 500 });
    const d2 = decision(rejecting.env, 'v-rogue', T12 + 120_000, 'cnt-rogue-work');
    const fan = await fanDecisions(rejecting.env, { tenant: TENANT, brand: BRAND, visitor_id: d2.visitor_id, records: [d2] },
      () => ({ reward: 'click', stats: DEFAULT_STATS, objective: 'unit', measurementBasis: 'served-v1' }));
    expect(fan.ok, 'the fan-out reports that the exposure was not accepted').toBe(false);

    // 4. The exhausted retry: the message the dead-letter consumer captured
    //    (`src/index.ts:332-336` → `captureQuarantine`, on the queue the
    //    manifest declares as the dead-letter queue).
    const dead = await captureQuarantine(lossy.env, 'events-dead-letter', 'w22-b1-dead-letter-1',
      { kind: 'ledger', type: 'outcome', version: 1, record: click(lossy.env, d1, T12 + 300_000, 'w22-b1-dead-click') });
    expect(dead.state, `the dead-letter capture must have happened before its counter can be demanded: ${JSON.stringify(dead).slice(0, 200)}`).toBe('pending');
    expect(dead.records, 'and it holds the one record whose retries were exhausted').toBe(1);

    for (const [label, host, expected] of [
      ['the tenant whose producer, consumer and dead-letter path lost rows', lossy, { producerFailed: 1, consumerSkipped: 1, fanOutRejected: 0, retriesExhausted: 1 }],
      ['the tenant whose statistics object refused the exposure', rejecting, { producerFailed: 0, consumerSkipped: 0, fanOutRejected: 1, retriesExhausted: 0 }],
    ] as const) {
      const run = await operatorPost(host, `/v1/${TENANT}/monitor`);
      expect(run.status, `the monitor run answers: ${JSON.stringify(run.body).slice(0, 300)}`).toBe(200);
      const loss = evidenceLossMember((run.body as { result: MonitorResult }).result) ?? absent('`MonitorResult.evidenceLoss`', (run.body as { result: object }).result);
      expect(typeof loss === 'string' ? loss : { producerFailed: loss.producerFailed, consumerSkipped: loss.consumerSkipped, fanOutRejected: loss.fanOutRejected, retriesExhausted: loss.retriesExhausted },
        `W22.R1.01 — ${label}: every drop path is counted in one named vocabulary an operator reads (F16 §7.3, §7.4; N10). Ruled member: \`MonitorResult.evidenceLoss\``)
        .toEqual(expected);
      expect(typeof loss === 'string' ? loss : Number.isSafeInteger(loss.since) && loss.since > 0,
        'W22.R1.01 — and the counters state the horizon they count from').toBe(true);
    }
  });
});


// ===========================================================================
// unit:W22.R1.03 — explicit completeness reaches the reader
// ===========================================================================

describe('unit:W22.R1.03', () => {
  /**
   * F17 §3.4: the honesty signals exist on the aggregate and die before they
   * reach a human — `windowReport` "drops every honesty signal except missing
   * days", and neither screen renders `hours.missing` or `hours.horizonMs`.
   * §6 item 4 rules the fix: the unfolded / `ringsFolded: false` / truncated
   * hour lists on `DayReport.hours`, the same fields on `WindowReport`, and
   * both rendered.
   */
  /** A day whose hour 12 is folded but whose rings did not advance, and whose hour 13 was never folded. */
  async function incompleteDay(m: Mounted): Promise<void> {
    const d12 = decision(m.env, 'v-tabby', T12 + 60_000, 'cnt-tabby-evening');
    const d13 = decision(m.env, 'v-rogue', T12 + HOUR_MS + 60_000, 'cnt-rogue-work');
    await throughTheLedger(m, [d12, d13], []);
    // Both hours are folded, out of order, and then hour 12 is REPLAYED over an
    // unchanged ledger. That replay is what honestly reports
    // `ringsFolded: false` once the folded hours are a per-hour set (W22.R1.02,
    // ruling R140): its rows are already in the rings, so the rebuild adds
    // nothing to them — the shape `src/learn/hourly.test.ts` asserts at W30.01
    // (:1011-1012) and W30.02 (:944-946). The out-of-order pair alone no longer
    // produces it, and this fixture must not depend on the high-water mark
    // W22.R1.02 removes.
    await buildHour(m.storage as never, TENANT, { date: DATE, hour: HOUR + 1 }, W22_LEARN, NOW, {}, m.env as never);
    await buildHour(m.storage as never, TENANT, { date: DATE, hour: HOUR }, W22_LEARN, NOW, {}, m.env as never);
    const replayed = await buildHour(m.storage as never, TENANT, { date: DATE, hour: HOUR }, W22_LEARN, NOW, {}, m.env as never);
    expect(replayed.ringsFolded, 'the fixture exists to carry an hour whose rings did not advance: a replay over an unchanged ledger').toBe(false);
    const twelve = JSON.parse(m.storage.objects.get(hourKey(TENANT, DATE, HOUR))!) as { ringsFolded: boolean };
    expect(twelve.ringsFolded, 'and that is the hour the day report reads').toBe(false);
  }

  it('host: the day report and the window report list the hours that were never folded and the hours whose rings did not advance', async () => {
    const m = await mount();
    await incompleteDay(m);
    await runDayReport(m.storage as never, { tenant: TENANT, brand: BRAND, date: DATE }, W22_LEARN, null, NOW, {}, m.env as never);

    const day = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${DATE}&brand=${BRAND}`);
    expect(day.status, `the saved day report reads back: ${JSON.stringify(day.body).slice(0, 300)}`).toBe(200);
    const coverage = (day.body as { report: DayReport }).report.coverage;
    expect(coverage?.unadvancedHours,
      'W22.R1.03 — the day report names the hour whose rings did not advance, so `ringsFolded: false` reaches the reader (F17 §6 item 4; P3b measured "report mentions ringsFolded anywhere: false")')
      .toEqual([HOUR]);
    expect(coverage?.status,
      'W22.R1.03 — and such a day is declared incomplete, never final').toBe('incomplete');

    const window = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${DATE}&to=${DATE}&brand=${BRAND}`);
    expect(window.status, `the window answers: ${JSON.stringify(window.body).slice(0, 300)}`).toBe(200);
    const pooled = (window.body as { report: WindowReport }).report;
    expect(pooled.coverage.days.map(entry => ({ date: entry.date, unadvancedHours: entry.coverage.unadvancedHours, truncatedHours: entry.coverage.truncatedHours })),
      'W22.R1.03 — the window report carries the same honesty signals per day, instead of dropping every one but missing days (F17 §3.4)')
      .toEqual([{ date: DATE, unadvancedHours: [HOUR], truncatedHours: [] }]);
    expect(pooled.coverage.status,
      'W22.R1.03 — and the window over an incomplete day is declared incomplete').toBe('incomplete');
  });

  it('sdk: neither shipped screen renders a report over an incomplete hour as complete', async () => {
    const m = await mount();
    await incompleteDay(m);
    await runDayReport(m.storage as never, { tenant: TENANT, brand: BRAND, date: DATE }, W22_LEARN, null, NOW, {}, m.env as never);

    const screens: Array<{ name: string; text: string }> = [];
    for (const screen of ['console', 'legacy'] as const) {
      const page = screen === 'console' ? 'console/index.html' : 'legacy/learning.html';
      const dom = new JSDOM(readFileSync(`public/${page}`, 'utf8'),
        { url: `${OPERATOR_ORIGIN}/${screen === 'console' ? `console/#/measure?scope=${TENANT}&date=${DATE}` : `legacy/learning.html?scope=${TENANT}&brand=${BRAND}&slot=hero`}`, pretendToBeVisual: true, runScripts: 'outside-only' });
      const w = dom.window as unknown as ScreenWindow;
      w.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        const target = new URL(url, `${OPERATOR_ORIGIN}/`);
        return m.fetch(new Request(OPERATOR_ORIGIN + target.pathname + target.search, {
          method: init?.method ?? 'GET', headers: init?.headers ?? {}, ...(init?.body === undefined ? {} : { body: init.body }),
        }));
      };
      w.TextEncoder = TextEncoder;
      w.setInterval = () => 1;
      w.localStorage.setItem('operator-session', JSON.stringify({ accessToken: m.operatorToken, refreshToken: 'w22-b1-refresh',
        exp: Date.now() + 3_600_000, user: { id: 'ops', name: 'Operator', email: 'ops@brand.test', roles: ['admin'], tenants: [TENANT] }, mustChangePassword: false }));
      const scripts = screen === 'console'
        ? ['operator-session.js', 'console/shell.js', 'console/views.js', 'console/views-config.js', 'console/views-measure.js', 'console/views-accounts.js', 'console/views-explore.js']
        : ['operator-session.js', 'learning.js'];
      for (const script of scripts) w.eval(readFileSync(`public/${script}`, 'utf8'));
      const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 12)); };
      await settle();
      if (screen === 'legacy') {
        // The retained learning screen builds the day on demand: the operator
        // picks the date and presses the button the page ships.
        const date = w.document.getElementById('report-date');
        expect(date, 'the retained learning screen ships a date control').toBeTruthy();
        date!.value = DATE;
        date!.dispatchEvent(new w.Event('change', { bubbles: true }));
        await settle();
      }
      screens.push({ name: page, text: (w.document.body.textContent ?? '').replace(/\s+/g, ' ') });
      w.close();
    }

    for (const screen of screens) {
      expect(screen.text.includes('Ring progress not advanced') || /unfolded|ringsFolded|did not advance/i.test(screen.text),
        `W22.R1.03 — the shipped screen ${screen.name} must say that this day was built over an hour whose rings did not advance, so an operator cannot read it as complete (F17 §3.4, §6 item 4). It rendered: ${screen.text.slice(0, 400)}`)
        .toBe(true);
      expect(/incomplete/i.test(screen.text),
        `W22.R1.03 — and ${screen.name} must say the coverage is incomplete. It rendered: ${screen.text.slice(0, 400)}`).toBe(true);
    }
  });
});

// ===========================================================================
// unit:W22.R1.04 — cross-sink reconciliation
// ===========================================================================

describe('unit:W22.R1.04', () => {
  /**
   * F16 §2.5 measured the disagreement — "the day report says 32 decisions and
   * 1 credit while the live lift table says 40 exposures and 4 successes —
   * permanently, with no log line, no counter and no alarm anywhere" — and §7
   * rules the remedy: "run a nightly comparison of the published lift snapshot
   * against the day report's learning grid, alerting past a threshold. That
   * last check costs a day and is the only thing that would have caught the
   * disagreement in probe 2.5." The scheduled run is the monitor's
   * (`src/index.ts:262`), and its result is what an operator reads.
   */
  it('host: the scheduled run compares the published online snapshot with the day report\'s learning grid, names a disagreement past its threshold with both numbers, and reports clean when the two sinks agree', async () => {
    const slotConfig = () => ({ reward: 'click' as const, stats: DEFAULT_STATS, objective: 'unit' as const, measurementBasis: 'served-v1' as const });

    /** Both sinks fed from the same fixture; `dropLedgerOutcome` injects F16 §2.5's mismatch. */
    const both = async (dropLedgerOutcome: boolean) => {
      const m = await mount();
      const d1 = decision(m.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening');
      const o1 = click(m.env, d1, ONLINE_TS + 60_000, 'w22-b1-reconcile-click');
      await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: d1.visitor_id, records: [d1] }, slotConfig);
      await fanOutcome(m.env, TENANT, o1, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());
      await m.drain();
      await throughTheLedger(m, [d1], dropLedgerOutcome ? [] : [o1], Date.now());
      await runDayReport(m.storage as never, { tenant: TENANT, brand: BRAND, date: ONLINE_DATE }, W22_LEARN, null, Date.now(), {}, m.env as never);
      return m;
    };

    const agreeing = await both(false);
    const clean = await operatorPost(agreeing, `/v1/${TENANT}/monitor`);
    expect(clean.status, `the monitor run answers: ${JSON.stringify(clean.body).slice(0, 300)}`).toBe(200);
    const cleanReconciliation = reconciliationMember((clean.body as { result: MonitorResult }).result)
      ?? absent('`MonitorResult.reconciliation`', (clean.body as { result: object }).result);
    expect(typeof cleanReconciliation === 'string' ? cleanReconciliation : { compared: cleanReconciliation.compared, disagreements: cleanReconciliation.disagreements },
      'W22.R1.04 — the scheduled comparison ran over the tenant\'s one slot and found the two sinks in agreement (ruled member: `MonitorResult.reconciliation`; F16 §7)')
      .toEqual({ compared: 1, disagreements: [] });

    const disagreeing = await both(true);
    const mismatch = await operatorPost(disagreeing, `/v1/${TENANT}/monitor`);
    expect(mismatch.status, `the monitor run answers: ${JSON.stringify(mismatch.body).slice(0, 300)}`).toBe(200);
    const reconciliation = reconciliationMember((mismatch.body as { result: MonitorResult }).result)
      ?? absent('`MonitorResult.reconciliation`', (mismatch.body as { result: object }).result);
    expect(typeof reconciliation === 'string' ? reconciliation : reconciliation.disagreements.map(row => ({ brand: row.brand, slot: row.slot, online: row.online, ledger: row.ledger, difference: row.difference })),
      'W22.R1.04 — the online store is one credited outcome ahead of the ledger, and the scheduled comparison names the disagreement with both numbers and the sinks compared, instead of leaving it permanent and silent (F16 §2.5, §7)')
      .toEqual([{ brand: BRAND, slot: 'hero', online: 1, ledger: 0, difference: 1 }]);
    expect(typeof reconciliation === 'string' ? reconciliation : reconciliation.disagreements.every(row => row.threshold >= 0),
      'W22.R1.04 — and the disagreement is reported against a stated threshold').toBe(true);
  });
});

// ===========================================================================
// unit:W22.A1.01 — one versioned attribution contract
// ===========================================================================

describe('unit:W22.A1.01', () => {
  /**
   * Document 35 §5 row W22: "Define one attribution contract with versioned
   * histories/horizons, not blindly identical caps." N23: "Online, hourly and
   * direct-record recomputation use different histories/caps … One cap
   * everywhere alone is not seven-day reconstruction." F17 P4 measured the
   * concrete gap: `DEFAULT_POLICY.windowsMs.purchase` is seven days, the batch
   * horizon is 48 hours (`hourly.ts:37` `DEFAULT_HORIZON_MS`), and "the engine
   * learns from a credit the report cannot show".
   */
  const PURCHASE_WINDOW_MS = 7 * DAY_MS;   // DEFAULT_POLICY.windowsMs.purchase
  const HISTORY = { scope: DEFAULT_POLICY.scope, match: DEFAULT_POLICY.match, credit: DEFAULT_POLICY.credit };

  it('logic: every path declares the same named contract version, the history it applied and the horizon it could actually read', async () => {
    const m = await mount();
    const d1 = decision(m.env, 'v-tabby', T12 + 60_000, 'cnt-tabby-evening');
    const o1 = purchase(m.env, d1, T12 + 90 * 60_000, 'w22-b1-contract-purchase');
    await throughTheLedger(m, [d1], [o1]);

    const fromRecords = await runReport(m.storage as never, { tenant: TENANT, brand: BRAND, date: DATE }, W22_LEARN, null, NOW, m.env as never);
    await buildHour(m.storage as never, TENANT, { date: DATE, hour: HOUR }, W22_LEARN, NOW, {}, m.env as never);
    await buildHour(m.storage as never, TENANT, { date: DATE, hour: HOUR + 1 }, W22_LEARN, NOW, {}, m.env as never);
    const fromHours = await runDayReport(m.storage as never, { tenant: TENANT, brand: BRAND, date: DATE }, W22_LEARN, null, NOW, {}, m.env as never);

    const recordsContract = dayContract(fromRecords) ?? absent('`attributionContract` on the direct-record day report', fromRecords);
    const hoursContract = dayContract(fromHours) ?? absent('`attributionContract` on the hourly-fold day report', fromHours);
    expect(typeof recordsContract === 'string' ? recordsContract : { name: recordsContract.name, history: recordsContract.history, windowsMs: recordsContract.windowsMs.purchase },
      'W22.A1.01 — the direct-record recomputation declares the one named attribution contract, the history it applied and the window the tenant\'s published policy asks for (ruled member: `attributionContract`)')
      .toEqual({ name: 'attribution', history: HISTORY, windowsMs: PURCHASE_WINDOW_MS });
    expect(typeof hoursContract === 'string' || typeof recordsContract === 'string'
      ? [recordsContract, hoursContract] : { same: hoursContract.name === recordsContract.name && hoursContract.version === recordsContract.version },
      'W22.A1.01 — and the hourly fold declares the SAME contract name and version as the direct-record path, not a second unnamed one (document 35 §5 row W22: "one attribution contract with versioned histories/horizons")')
      .toEqual({ same: true });
    expect(typeof hoursContract === 'string' ? hoursContract : hoursContract.appliedWindowsMs.purchase,
      'W22.A1.01 — the hourly fold says the horizon it could actually read: 48 hours, never the seven days the policy label promises (F17 P4; hourly.ts:37 DEFAULT_HORIZON_MS)')
      .toBe(DEFAULT_HORIZON_MS);
    expect(typeof hoursContract === 'string' ? hoursContract : hoursContract.windowsMs.purchase,
      'W22.A1.01 — while still declaring the policy window it was asked for, so the difference is visible rather than hidden')
      .toBe(PURCHASE_WINDOW_MS);

    // ── the horizon tied to the credit it produced, and DERIVED ─────────────
    // Neither number here is the engine's default, so no stamped constant can
    // satisfy this clause beside the one above: the tenant publishes a SIX-day
    // purchase window (`policyOf`, src/learn/route.ts:17-20) instead of the
    // platform's seven, and the fold is built with an explicit SEVENTY-TWO-hour
    // ring horizon (`BuildOptions.horizonMs`, hourly.ts:678, carried on
    // `ComputationBasis.profile.horizonMs`) instead of the default forty-eight.
    // The purchase then falls four days after the story it followed: inside the
    // published window, outside the fold's horizon. The online path credits it;
    // the fold cannot; each path's declared `appliedWindowsMs` must match the
    // credit that path actually shows.
    const PUBLISHED_PURCHASE_MS = 6 * DAY_MS;
    const FOLD_HORIZON_MS = 72 * HOUR_MS;
    const publishedPolicyLearn = { ...W22_LEARN, policy: { scope: 'session', match: 'direct', credit: 'last',
      windowsMs: { purchase: PUBLISHED_PURCHASE_MS } } } as unknown as LearnConfig;
    const p = await mount({ learn: publishedPolicyLearn });
    const DECIDED_AT = ONLINE_TS - 4 * DAY_MS, BOUGHT_AT = ONLINE_TS;
    const buyDate = new Date(BOUGHT_AT).toISOString().slice(0, 10);
    const decidedDate = new Date(DECIDED_AT).toISOString().slice(0, 10);
    const storyConfig = () => ({ reward: 'purchase' as const, stats: DEFAULT_STATS, objective: 'unit' as const, measurementBasis: 'served-v1' as const });
    const publishedPolicy = { ...DEFAULT_POLICY, windowsMs: { ...DEFAULT_POLICY.windowsMs, purchase: PUBLISHED_PURCHASE_MS } };
    const story = decision(p.env, 'v-tabby', DECIDED_AT, 'cnt-tabby-evening', 'story');
    const bought = purchase(p.env, story, BOUGHT_AT, 'w22-b1-late-purchase');
    await fanDecisions(p.env, { tenant: TENANT, brand: BRAND, visitor_id: story.visitor_id, records: [story] }, storyConfig);
    await fanOutcome(p.env, TENANT, bought, publishedPolicy, BRAND, { story: storyConfig() }, storyConfig());
    await p.drain();
    const statsNs = p.env.LEARN_STATS!;
    const onlineAnswer = await statsNs.get(statsNs.idFromName(statsName(TENANT, BRAND, 'story'))).fetch('https://learn/snapshot');
    const onlineSnapshot = (await onlineAnswer.json() as { snapshot?: LiftSnapshot | null }).snapshot;
    expect(onlineSnapshot, `the online path must hold the story slot's snapshot (it answered ${onlineAnswer.status})`).toBeTruthy();
    const onlineCredits = Math.round(onlineSnapshot!.items['cnt-tabby-evening']?.['*']?.s ?? 0);

    await throughTheLedger(p, [story], [bought], Date.now());
    for (const at of [DECIDED_AT, BOUGHT_AT]) {
      await buildHour(p.storage as never, TENANT, { date: new Date(at).toISOString().slice(0, 10), hour: new Date(at).getUTCHours() },
        publishedPolicyLearn, Date.now(), { horizonMs: FOLD_HORIZON_MS }, p.env as never);
    }
    const foldedDay = await runDayReport(p.storage as never, { tenant: TENANT, brand: BRAND, date: buyDate }, publishedPolicyLearn, null, Date.now(), {}, p.env as never);
    const foldedCredits = foldedDay.policies.find(row => row.role === 'learning')?.credits ?? 0;
    expect(decidedDate < buyDate || decidedDate === buyDate,
      'the fixture decision and its purchase are four days apart, on their own dates').toBe(true);

    const onlineContractLogic = snapshotContract(onlineSnapshot!) ?? absent('`attributionContract` on the online snapshot', onlineSnapshot!);
    const foldContract = dayContract(foldedDay) ?? absent('`attributionContract` on the hourly-fold day report', foldedDay);
    expect(typeof onlineContractLogic === 'string' ? onlineContractLogic
      : { windowsMs: onlineContractLogic.windowsMs.purchase, appliedPurchaseMs: onlineContractLogic.appliedWindowsMs.purchase, credited: onlineCredits },
      'W22.A1.01 — the online path follows the window the TENANT published, not the platform default, reads it in full from its seven-day ring and credits the purchase: the horizon it declares is the one that produced that credit (F17 P4; src/learn/route.ts:17-20 policyOf; DecisionRing.ts:21 RING_MAX_AGE_MS)')
      .toEqual({ windowsMs: PUBLISHED_PURCHASE_MS, appliedPurchaseMs: PUBLISHED_PURCHASE_MS, credited: 1 });
    expect(typeof foldContract === 'string' ? foldContract
      : { windowsMs: foldContract.windowsMs.purchase, appliedPurchaseMs: foldContract.appliedWindowsMs.purchase, credited: foldedCredits },
      'W22.A1.01 — the fold declares the window it was asked for and the horizon it was BUILT with — seventy-two hours, the option this fold actually ran under (hourly.ts:678, ComputationBasis.profile.horizonMs) — and shows no credit for the same purchase, so it never reports under the published label (F17 P4: "The engine learns from a credit the report cannot show")')
      .toEqual({ windowsMs: PUBLISHED_PURCHASE_MS, appliedPurchaseMs: FOLD_HORIZON_MS, credited: 0 });

    for (const [label, contract] of [['the direct-record recomputation', recordsContract], ['the hourly fold', foldContract], ['the online path', onlineContractLogic]] as const) {
      expect(typeof contract === 'string' ? contract : Object.entries(contract.windowsMs).map(([reward, asked]) => [reward, contract.appliedWindowsMs[reward]! <= asked]),
        `W22.A1.01 — ${label} never claims to have read more than the policy asked for: every applied horizon is at or inside its declared window`)
        .toEqual(typeof contract === 'string' ? contract : Object.keys(contract.windowsMs).map(reward => [reward, true]));
    }
  });

  it('host: the day report, the window report and the published lift snapshot each name the contract, and a day written under an earlier contract version is never pooled with a later one', async () => {
    const m = await mount();
    const d1 = decision(m.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening');
    const o1 = click(m.env, d1, ONLINE_TS + 60_000, 'w22-b1-contract-click');
    await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: d1.visitor_id, records: [d1] },
      () => ({ reward: 'click', stats: DEFAULT_STATS, objective: 'unit', measurementBasis: 'served-v1' }));
    await fanOutcome(m.env, TENANT, o1, DEFAULT_POLICY, BRAND, { hero: { reward: 'click', stats: DEFAULT_STATS, objective: 'unit', measurementBasis: 'served-v1' } },
      { reward: 'click', stats: DEFAULT_STATS, objective: 'unit', measurementBasis: 'served-v1' });
    await m.drain();
    await throughTheLedger(m, [d1], [o1], Date.now());
    const built = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: ONLINE_DATE, brand: BRAND });
    expect(built.status, `the report route answers: ${JSON.stringify(built.body).slice(0, 300)}`).toBe(200);
    const day = (built.body as { report: DayReport }).report;

    const namespace = m.env.LEARN_STATS!;
    const answered = await namespace.get(namespace.idFromName(statsName(TENANT, BRAND, 'hero'))).fetch('https://learn/snapshot');
    const snapshot = (await answered.json() as { snapshot?: LiftSnapshot | null }).snapshot;
    expect(snapshot, `the fixture's statistics object holds a snapshot for the slot (it answered ${answered.status})`).toBeTruthy();

    const onlineContract = snapshotContract(snapshot!) ?? absent('`attributionContract` on the published lift snapshot', snapshot!);
    expect(typeof onlineContract === 'string' ? onlineContract : { name: onlineContract.name, history: onlineContract.history, purchase: onlineContract.appliedWindowsMs.purchase },
      'W22.A1.01 — the online path names the same contract and says the history and horizon it actually applied: the online ring keeps seven days (DecisionRing.ts:21 RING_MAX_AGE_MS), so this path can honour the policy\'s purchase window (ruled member: `attributionContract`)')
      .toEqual({ name: 'attribution', history: HISTORY, purchase: PURCHASE_WINDOW_MS });

    const windowAnswer = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${ONLINE_DATE}&to=${ONLINE_DATE}&brand=${BRAND}`);
    const pooled = (windowAnswer.body as { report: WindowReport }).report;
    const pooledContract = windowContract(pooled) ?? absent('`attributionContract` on the window report', pooled);
    const dayReportContract = dayContract(day) ?? absent('`attributionContract` on the day report', day);
    expect(typeof pooledContract === 'string' || typeof dayReportContract === 'string'
      ? [dayReportContract, pooledContract] : { name: pooledContract.name, version: pooledContract.version === dayReportContract.version },
      'W22.A1.01 — the window report names the contract version it pooled under, and it is the version its days were written under')
      .toEqual({ name: 'attribution', version: true });

    // A day saved under an earlier contract version is read as such and never
    // pooled with a later one (document 35 §5 row W22, "versioned histories").
    // The previous day is BUILT by the engine's own report path, so the stored
    // document is the canonical serializer's; only the contract version is then
    // moved back, which is the one thing this clause is about.
    const previousDay = new Date(Date.parse(ONLINE_DATE + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10);
    const dYesterday = decision(m.env, 'v-rogue', Date.parse(previousDay + 'T12:00:00Z'), 'cnt-rogue-work');
    const oYesterday = click(m.env, dYesterday, Date.parse(previousDay + 'T12:05:00Z'), 'w22-b1-contract-yesterday');
    await throughTheLedger(m, [dYesterday], [oYesterday], Date.now());
    await runReport(m.storage as never, { tenant: TENANT, brand: BRAND, date: previousDay }, W22_LEARN, null, Date.now(), m.env as never);
    const stored = JSON.parse(m.storage.objects.get(reportKey(TENANT, BRAND, previousDay))!) as DayReport & { _summary?: unknown; attributionContract?: AttributionContract };
    // The saved document carries the summary prefix the serializer adds; the
    // plain report underneath is what the serializer takes back.
    const { _summary, ...plain } = stored;
    expect(_summary, 'the fixture reads a canonically saved report, summary marker and all').toBeTruthy();
    const earlier = plain as DayReport & { attributionContract?: AttributionContract };
    earlier.attributionContract = { ...(earlier.attributionContract ?? { name: 'attribution', history: HISTORY,
      windowsMs: { ...DEFAULT_POLICY.windowsMs }, appliedWindowsMs: { ...DEFAULT_POLICY.windowsMs } }), version: 0 };
    // Written by the engine's own canonical serializer, not by JSON.stringify:
    // a saved report is a `_summary`-marked document with its framing newline,
    // and `src/measure/window.test.ts:147` requires the window to REFUSE the
    // shape a bare stringify produces (R120 item 4). Only the contract version
    // moves back.
    m.storage.objects.set(reportKey(TENANT, BRAND, previousDay), canonicalReportJson(earlier));
    m.storage.versions.set(reportKey(TENANT, BRAND, previousDay), (m.storage.versions.get(reportKey(TENANT, BRAND, previousDay)) ?? 0) + 1);
    const mixed = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${previousDay}&to=${ONLINE_DATE}&brand=${BRAND}`);
    const mixedReport = (mixed.body as { report?: WindowReport }).report;
    expect(mixedReport?.slots.hero?.compatibility.reasons
      ?? `the window over the two contract versions answered ${mixed.status}: ${JSON.stringify(mixed.body).slice(0, 200)} — a stored report carrying the ruled member must still be readable by the window`,
      'W22.A1.01 — a day written under an earlier contract version is never pooled with a later one: the window declares the mixed basis instead of adding the two together')
      .toContain('mixed_basis');
  });
});

// ===========================================================================
// unit:W22.S1.01 — product-sort evidence is durable and consistent
// ===========================================================================

describe('unit:W22.S1.01', () => {
  /**
   * Document 35 §5 row W22: "Wire persisted product-sort evidence via W14."
   * HANDOFF-2026-09-16 §6 (:226): "Scheduled sort persistence is not durable
   * acknowledgment." R104(a): measure what W14 left. The record's logical id is
   * `record_id` (`src/ledger/productSort.ts:27`); the same read-path rule as
   * every other stream applies to it (representation (ii)).
   */
  const CANDIDATES = [{ id: 'P-tabby-evening', line: 'Tabby', price_usd: 495 },
    { id: 'P-rogue-work', line: 'Rogue', price_usd: 795 },
    { id: 'P-charms-slg', line: 'Unknown', price_usd: 95 }];

  /**
   * A shopper who has made the explicit choice, through the door the shipped
   * SDK uses (`POST /realtime/session/:id/preferences`); without a tracking
   * choice the sort route records nothing at all, by design.
   */
  async function sort(m: Mounted): Promise<{ status: number; body: Record<string, unknown> }> {
    const session = await newAnonymousSession(m.env, TENANT);
    const chosen = await m.fetch(new Request(`http://sort.test/realtime/session/${session.sessionId}/preferences`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': TENANT, [SHOPPER_HEADER]: session.capability },
      body: JSON.stringify({ trackingConsent: true, personalizationEnabled: true,
        choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: session.grantId, iat: session.iat, exp: session.exp } }),
    }));
    expect(chosen.status, `the explicit consent choice answers: ${(await chosen.clone().text()).slice(0, 200)}`).toBe(200);
    await m.drain();
    const response = await m.fetch(new Request('http://sort.test/sort', {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': TENANT, [SHOPPER_HEADER]: session.capability },
      body: JSON.stringify({ userId: session.subject, candidates: CANDIDATES }),
    }));
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  }

  it('host: a sort answer is given only after its record is captured, the record carries its logical id, and a redelivery of that record is stored once', async () => {
    const m = await mount();
    const answered = await sort(m);
    expect(answered.status, `POST /sort answers: ${JSON.stringify(answered.body).slice(0, 300)}`).toBe(200);
    const persistence = answered.body.persistence as { status: string; recordId?: string };
    expect(persistence.status === 'durable' || persistence.status === 'queued',
      `W22.S1.01 — the answer is acknowledged only with a captured record (src/routes/sort.ts:123, src/ledger/productSort.ts): it reported ${JSON.stringify(persistence)}`).toBe(true);
    expect(typeof persistence.recordId === 'string' && persistence.recordId.includes(':product-sort:'),
      'W22.S1.01 — and the captured record carries the logical id every other ledger row carries').toBe(true);
    await m.drain();

    // The queue's own copy, written by the real consumer, then REDELIVERED.
    const wire = m.queued.splice(0);
    expect(wire.length, 'the sort record reaches the ledger like the rest of the evidence').toBeGreaterThan(0);
    expect((await consumeLedger(m.env, wire, Date.now())).ok, 'the sort record is written by the real consumer').toBe(true);
    const afterFirst = [...m.storage.objects.keys()].filter(key => key.includes('/product-sort/')).length;
    expect((await consumeLedger(m.env, wire, Date.now())).ok, 'the redelivery is acknowledged').toBe(true);
    const rows: Array<{ record_id?: string }> = [];
    for (const [key, body] of m.storage.objects) {
      if (!key.includes('/product-sort/')) continue;
      for (const line of body.split('\n')) if (line) rows.push(JSON.parse(line) as { record_id?: string });
    }
    expect(rows.filter(row => row.record_id === persistence.recordId).length,
      'W22.S1.01 — a redelivered sort record is stored once, exactly as a redelivered decision or outcome is (representation (ii))')
      .toBe(1);
    expect([...m.storage.objects.keys()].filter(key => key.includes('/product-sort/')).length,
      'W22.S1.01 — and the redelivery leaves no second object behind').toBe(afterFirst);

    // A capture that did not happen is never acknowledged: the queue is out and
    // the canonical object store refuses the write.
    const failing = await mount({ queueFails: true });
    failing.storage.failPutFrom = (key: string) => key.includes('/product-sort/');
    const refused = await sort(failing);
    expect(refused.status,
      `W22.S1.01 — with neither sink accepting the record, the sorted answer is refused rather than acknowledged (HANDOFF-2026-09-16 :226). It answered ${JSON.stringify(refused.body).slice(0, 300)}`)
      .toBe(503);
    expect((refused.body.persistence as { status: string }).status,
      'W22.S1.01 — and the refusal names that nothing was scheduled').toBe('not_scheduled');
  });
});

// ===========================================================================
// unit:W22.R1.05 — the export reconciles with the day report
// ===========================================================================

/** RULED, ABSENT TODAY (R21): the export listing's own reconciliation counts. */
interface ExportCounts {
  /** Rows the listed objects physically hold, per stream. */
  rows: { decisions: number; outcomes: number };
  /** Distinct logical rows, after the same dedup the report applies. */
  distinct: { decisions: number; outcomes: number };
  /** The canonical day report's own counts, and whether they agree with `distinct`. */
  report: { decisions: number; outcomes: number };
  agrees: boolean;
}
const exportCounts = (body: Record<string, unknown>): ExportCounts | undefined => body.counts as ExportCounts | undefined;

describe('unit:W22.R1.05', () => {
  /**
   * The W22 row asks for "durable online/R2/fold/export reconciliation". F16
   * §4.4: every exported row already carries a stable primary key, "so the
   * customer's warehouse can dedupe on decision_id/outcome_id today — what is
   * missing is the CONTRACT". The export is the R2 partition itself (doc 22
   * §12.4), and `GET /v1/:tenant/ledger/batches` is the listing a warehouse job
   * reads (`src/routes/decisions.ts:536`). This unit makes the listing say what
   * it holds and whether that agrees with the day the platform published, so a
   * warehouse loading the objects and an operator reading the report cannot
   * disagree in silence.
   *
   * Member names are disjoint from W21-B1's `from`/`to`/`date` on the same
   * answer: this unit rules `counts` only.
   */
  it('host: the export listing states the rows it holds, the distinct rows after dedup and the day report\'s own counts, agrees when they match, and names the mismatch when the export loses an object', async () => {
    const m = await mount();
    const decisions = [
      decision(m.env, 'v-tabby', T12 + 60_000, 'cnt-tabby-evening'),
      decision(m.env, 'v-rogue', T12 + 120_000, 'cnt-rogue-work'),
    ];
    const outcomes = [click(m.env, decisions[0]!, T12 + 300_000, 'w22-b1-export-click')];
    const wire = await throughTheLedger(m, decisions, outcomes);
    // One redelivery, so the export physically holds more rows than the day
    // report counts: the reconciliation must be over the DISTINCT rows.
    expect((await consumeLedger(m.env, wire, NOW)).ok, 'the redelivery is acknowledged by the real consumer').toBe(true);
    const built = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    expect(built.status, `the report route answers: ${JSON.stringify(built.body).slice(0, 300)}`).toBe(200);

    const listed = await operatorGet(m, `/v1/${TENANT}/ledger/batches?date=${DATE}`);
    expect(listed.status, `the export listing answers: ${JSON.stringify(listed.body).slice(0, 300)}`).toBe(200);
    const counts = exportCounts(listed.body) ?? absent('`counts` on GET /v1/:tenant/ledger/batches', listed.body);
    expect(counts,
      'W22.R1.05 — the export listing reconciles itself with the day the platform published: four decision rows and two outcome rows on the objects, two and one distinct after dedup on the logical ids, the same two and one in the report, and they agree (document 35 §5 row W22, "durable online/R2/fold/export reconciliation"; F16 §4.4)')
      .toEqual({ rows: { decisions: 4, outcomes: 2 }, distinct: { decisions: 2, outcomes: 1 },
        report: { decisions: 2, outcomes: 1 }, agrees: true });

    // The sink mismatch, at the export: an object the report counted is no
    // longer in the partition a warehouse would load.
    // Every object that carries that outcome goes, its redelivered copy
    // included: the export is short of the row, not merely of one of its
    // copies. (R120 item 3: the two clauses of this unit must be able to hold
    // on one product — the first needs the duplicate present, this one needs
    // the row itself gone.)
    const carrying = dayObjects(m, 'outcome').filter(key => (m.storage.objects.get(key) ?? '').includes(outcomes[0]!.outcome_id!));
    expect(carrying.length, 'the fixture holds that outcome in two objects: the original and its redelivery').toBe(2);
    for (const key of carrying) m.storage.objects.delete(key);
    const after = await operatorGet(m, `/v1/${TENANT}/ledger/batches?date=${DATE}`);
    const mismatch = exportCounts(after.body) ?? absent('`counts` on GET /v1/:tenant/ledger/batches', after.body);
    expect(typeof mismatch === 'string' ? mismatch : { distinct: mismatch.distinct, report: mismatch.report, agrees: mismatch.agrees },
      'W22.R1.05 — and when the export no longer holds what the report counted, the listing says so instead of letting a warehouse load a short day in silence')
      .toEqual({ distinct: { decisions: 2, outcomes: 0 }, report: { decisions: 2, outcomes: 1 }, agrees: false });
  });
});
