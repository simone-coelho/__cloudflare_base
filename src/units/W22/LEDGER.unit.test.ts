// src/units/W22/LEDGER.unit.test.ts
// W22 under the Closure Ledger (program.json ticket W22, frozen 2026-09-24).
// D1, R1, A1 and S1 are proven by the existing `unit:W22.D1.*`, `unit:W22.R1.*`,
// `unit:W22.A1.*` and `unit:W22.S1.*` blocks of B1/B2 in this directory; LG1 is
// proven by the acceptance command's second half (every `W22.` test of the
// listed legacy files). This file specifies the remaining-work criteria R2–R5,
// one `describe('unit:W22.<criterion id>')` each.
//
// WITNESSES
//   · document 35 §5 row W22 (:424), quoted by the work order: "Shared logical
//     event identity/dedup before caps; durable online/R2/fold/export
//     reconciliation and explicit completeness. … Fault tests include ID
//     collision/retry, late arrivals, partial writes and sink mismatch."
//   · LANE-LOG R143 (W22-B2 merged at 48a74a3): "Residuals named for a later W22
//     batch: the credited journal's digest fallback (credit-again on a
//     `crypto.subtle` failure instead of id-only dedup); a stored version-1 shard
//     treats every hour at or below its `through` as folded (P3b recovery begins
//     at its first v2 fold); `seenDays` ids without retention stamps
//     (privacy-adjacent, bounded by the prune and the erasure sweep); the dead
//     `FoldContext.now`. Admitted contract recorded: two different records under
//     one stable `outcome_id` credit twice online while the ledger refuses and
//     names that brand's day."
//   · LANE-LOG R145 and `_evidence/W22/reviewer-whole/REPORT.md` findings 1–2:
//     the admitted contract "is not stated where a customer reads —
//     `docs/api/01-rest-endpoints.md` … and `docs/kit/03-payload-schemas.md` …";
//     "On the collision case, online holds 2 credits (`D1.04`) while the day
//     report excludes the conflicting row and counts it in `counts.conflicts`
//     (`D1.03`/`D1.05`); `R1.04`'s threshold is 5 % relative … So a designed,
//     correct behaviour is reported as a `reconciliation.disagreements` entry …
//     worth a named residual so an operator reading the alert is not sent chasing
//     a bug."
//   · docs/architecture/35-verification-reports/F17.md P3b: "Decision for `v3`
//     at 12:59 …, another for `v3` at 13:05 …, click on item `a` … Hour 12's `get`
//     throws on run 1 … hour 12 ringsFolded: false … the 12:59 decision never
//     entered the ring … day report credits: 0"; §6 item 2: "Make a repair
//     actually repair the rings."
//   · `DecisionRing.ts` (the journal's own contract, W22 D1.02/D1.04): "An entry
//     stored before this (id only) still suppresses every repeat of its id: it
//     can lose a credit it cannot tell apart, never grant one twice".
//
// ONE REPRESENTATION, the one W22-B1/B2 delivered, so nothing here asks the
// fixture for a second world:
//   · the credited journal keys an entry on the outcome's logical id AND the
//     digest of the record (D1.04); an id-only entry is a shape it already reads.
//   · `ShardState` stays version 2 with additive members; `seenDays` keeps its
//     meaning (`Record<date, Record<brand, string[]>>`, locked by
//     `src/learn/hourly.test.ts:1262`), and a retention stamp is enforced the way
//     `seenRetention` is for the current date (`cleanupShard`: an id whose
//     `hourly` stamp has expired leaves the membership; an id with no stamp is
//     legacy and is never disposed of on that ground, `src/retention.ts`
//     readRetention).
//   · `MonitorResult.reconciliation.disagreements` rows keep their six members
//     `{ brand, slot, online, ledger, difference, threshold }` (R1.04).
//
// THE DOCUMENT HALF OF R5 is proven by the reviewer reading the two changed
// paragraphs at the artifact revision (the work order's proof column: "or for a
// document sentence the reviewer reading it"). The witnesses fix what they must
// state, and no wording is ruled here: in BOTH `docs/api/01-rest-endpoints.md`
// and `docs/kit/03-payload-schemas.md`, where the ledger's collision is stated,
// (1) two different records under one stable `outcome_id` are each credited by
// the online statistics (D1.04); (2) the ledger read refuses THAT BRAND's day
// only, 409 `report_row_conflict`, and another brand of the tenant is answered
// (D1.05); (3) once filed, the day reads with the row excluded and counted in
// `counts.conflicts` (D1.03); (4) the scheduled reconciliation will show that
// brand and slot as a disagreement that names the collision, which is the
// designed outcome and not a lost credit (the host leg below).

import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';
import ts from 'typescript';

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
import { writeBatches } from '@/ledger/writer';
import { fanDecisions, fanOutcome } from '@/learn/fan';
import { buildHour, catchUp, hourKey, shardKey, shardOf, type HourAggregate, type ShardState } from '@/learn/hourly';
import { DEFAULT_POLICY } from '@/learn/policy';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import type { DayReport } from '@/learn/report';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
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
// The customer's fixture (tapestry_requirements A.3.6), the one W22-B1/B2 use.
// ===========================================================================

const TENANT = 'coach';
const BRAND = 'coach';
const OPERATOR_SECRET = 'w22-ledger-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const MIN = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The day the fold fixtures are written into. */
const DATE = '2026-09-03';
const T12 = Date.UTC(2026, 8, 3, 12, 0, 0);
const NOW = Date.UTC(2026, 8, 3, 14, 30, 0);

/**
 * The ONLINE fixtures are placed two hours ago: the visitor's ring keeps seven
 * days of receipts and every online count decays against the wall clock
 * (W22-B1's own reason, `src/units/W22/B1.unit.test.ts` ONLINE_TS).
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
const W22_CATALOGUE = { version: 'w22-ledger-coach-catalogue', pieces: W22_PIECES };
const W22_SLOTS: SlotCatalog = { version: 'w22-ledger-coach-slots',
  pages: { home: [
    { slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } },
    { slot: 'story', take: 1, weights: { occasion: 0.35, line: 0.25 } },
  ] } };
/** `holdout.share: 0`, so every fixture decision is `personalized` and each count is exact. */
const W22_LEARN: LearnConfig = {
  holdout: { share: 0, salt: 'w22-ledger', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: { hero: { reward: 'click' }, story: { reward: 'purchase' } },
} as unknown as LearnConfig;

const COACH_CELL = { channel: 'web', visit_bucket: 'returning', stage: 'consider', region: 'US-NY', affinity: 'evening' };
const UNKNOWN_CELL = { channel: 'web', visit_bucket: 'new', stage: 'unknown', region: 'none', affinity: 'none' };

// ===========================================================================
// The mounted application, in process, with the REAL DecisionRing, LearnStats
// and ShopperReflex classes bound to their namespaces — the harness of
// `src/units/W22/B1.unit.test.ts`, repeated because a test file is never
// imported.
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


const slotConfig = () => ({ reward: 'click' as const, stats: DEFAULT_STATS, objective: 'unit' as const, measurementBasis: 'served-v1' as const });

/** The published lift snapshot an operator reads: publish the slot, then read it (`src/units/W22/B2.unit.test.ts`). */
async function publishedLift(m: Mounted, slot = 'hero', brand = BRAND): Promise<LiftSnapshot | null> {
  const published = await operatorPost(m, `/v1/${TENANT}/learn/publish`, { slot, brand });
  expect(published.status, `POST /v1/:tenant/learn/publish answers: ${JSON.stringify(published.body).slice(0, 200)}`).toBe(200);
  const read = await operatorGet(m, `/v1/${TENANT}/lift?slot=${slot}&brand=${brand}`);
  expect(read.status, `GET /v1/:tenant/lift answers: ${JSON.stringify(read.body).slice(0, 200)}`).toBe(200);
  return (read.body as { snapshot?: LiftSnapshot | null }).snapshot ?? null;
}
const creditedTo = (snapshot: LiftSnapshot | null, item: string): number => snapshot?.items[item]?.['*']?.s ?? 0;

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

// ===========================================================================
// unit:W22.R2 — the credited journal de-duplicates by id when the digest
// cannot be computed, instead of crediting again (LANE-LOG R143).
//
// Today (`DecisionRing.ts` creditedDigest / alreadyCredited / rememberCredited)
// a digest the object cannot compute makes the delivery "remembered as
// nothing", and a repeat matches only an id-only entry — so an outcome
// delivered while `crypto.subtle` fails is credited again on its redelivery,
// and so is the redelivery of an outcome whose FIRST delivery was digested.
// R143 rules the fallback: id-only dedup, the journal's own documented
// behaviour for an entry it cannot tell apart ("it can lose a credit it cannot
// tell apart, never grant one twice"). The failure is made where R143 names
// it: the platform's `crypto.subtle.digest` refuses while the outcome is
// delivered, and only then. The published snapshot is compared as a RATIO
// (W22.D1.02's own method), so the decay between two reads cancels.
// ===========================================================================

/** Every `crypto.subtle.digest` call refuses while `run` is in flight — the failure R143 names. */
async function withoutDigest<T>(run: () => Promise<T>): Promise<T> {
  const refused = vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('synthetic crypto.subtle digest failure'));
  try { return await run(); } finally { refused.mockRestore(); }
}

describe('unit:W22.R2', () => {
  it('host: an outcome redelivered while the credited journal cannot compute its digest is credited once, recognised by its id — whether or not its first delivery could be digested', async () => {
    const m = await mount();
    const undigested = decision(m.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening');
    const digestedFirst = decision(m.env, 'v-rogue', ONLINE_TS + MIN, 'cnt-rogue-work');
    for (const d of [undigested, digestedFirst]) await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: d.visitor_id, records: [d] }, slotConfig);
    const c1 = click(m.env, undigested, ONLINE_TS + 2 * MIN, 'w22-ledger-r2-undigested');
    const c2 = click(m.env, digestedFirst, ONLINE_TS + 3 * MIN, 'w22-ledger-r2-digested-first');
    const deliver = (o: OutcomeRecord) => fanOutcome(m.env, TENANT, o, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());

    // First deliveries: c1 while the digest cannot be computed, c2 normally.
    await withoutDigest(() => deliver(c1));
    await deliver(c2);
    await m.drain();
    const first = await publishedLift(m);
    const once1 = creditedTo(first, 'cnt-tabby-evening'), once2 = creditedTo(first, 'cnt-rogue-work');
    expect(once1 > 0, `the fixture: the first delivery is credited although its digest could not be computed (${once1})`).toBe(true);
    expect(once2 > 0, `the fixture: the digested first delivery is credited (${once2})`).toBe(true);

    // Both redelivered — the queue's at-least-once retry — while the digest cannot be computed.
    await withoutDigest(async () => { await deliver(c1); await deliver(c2); });
    await m.drain();
    const again = await publishedLift(m);
    expect.soft(creditedTo(again, 'cnt-tabby-evening') / once1,
      'W22.R2 (R143) — an outcome whose first delivery and redelivery both met a digest failure is credited once: the journal remembers it by its id instead of remembering nothing (DecisionRing.ts rememberCredited "unrecordable is remembered as nothing")')
      .toBeCloseTo(1, 3);
    expect.soft(creditedTo(again, 'cnt-rogue-work') / once2,
      'W22.R2 (R143) — a redelivery whose digest cannot be computed is recognised by the id of the digested entry the first delivery left, instead of being credited again (DecisionRing.ts alreadyCredited)')
      .toBeCloseTo(1, 3);
  });
});

// ===========================================================================
// unit:W22.R3 — a stored version-1 shard does not treat every hour at or
// below its through mark as folded (LANE-LOG R143).
//
// F17 P3b's own fixture, with the one change R143 names: the shard state the
// failed hour is repaired against was written by a VERSION-1 fold. The members
// version 2 added (`foldedHours`, `foldedThrough`, `seenDays`, and W21's
// `enrollment`, "a version-1 or version-2 state written before this release
// simply has none") are withdrawn from every stored shard and `version` is 1;
// `through` — "the high-water mark of the hours folded" — is kept, exactly the
// state `src/learn/hourly.ts` ShardState documents a v1 fold leaving. Today
// the migration takes `foldedThrough = through`, so the repaired hour 12 is
// "already folded" and its decision never enters the rings.
//
// BY HAND (DEFAULT_POLICY: click window thirty minutes, ruling R139):
//   12:59 v-rogue decision (cnt-rogue-work)       ← hour 12, unreadable on the first pass
//   13:05 v-rogue decision (cnt-tabby-evening)
//   13:10 v-rogue click on cnt-rogue-work         → credits the 12:59 decision (11 min)
//   13:20 v-tabby decision (cnt-tabby-evening)
//   13:25 v-tabby click on cnt-tabby-evening      → credits the 13:20 decision, folded under v1
// After the repair: 3 decisions, and 2 learning credits — the cross-hour one
// the repaired hour makes possible, and hour 13's own credit counted once, so
// an implementation that re-folds what version 1 already folded (a corrupt-
// state refusal, or a second admission) cannot pass either.
// ===========================================================================

/** The cron's own call, run until it has caught up (W22.R1.02's helper). */
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

/** Every stored shard state, as a version-1 fold wrote it. Answers how many shard states were rewritten. */
function asVersionOne(m: Mounted): number {
  let rewritten = 0;
  for (const [key, raw] of [...m.storage.objects]) {
    if (!key.startsWith(`aggregates/${TENANT}/rings/`)) continue;
    const state = JSON.parse(raw) as Record<string, unknown>;
    state.version = 1;
    for (const member of ['foldedHours', 'foldedThrough', 'seenDays', 'enrollment']) delete state[member];
    m.storage.objects.set(key, JSON.stringify(state)); m.storage.versions.set(key, (m.storage.versions.get(key) ?? 0) + 1);
    rewritten++;
  }
  return rewritten;
}

describe('unit:W22.R3', () => {
  it('host: on shard states stored at version 1, a failed hour repaired after later hours enters the rings — its aggregate says so and its cross-hour credit is counted — and the hour version 1 already folded is counted once', async () => {
    const r = await mount();
    const d12 = decision(r.env, 'v-rogue', T12 + 59 * MIN, 'cnt-rogue-work');
    const d13 = decision(r.env, 'v-rogue', T12 + 65 * MIN, 'cnt-tabby-evening');
    const cross = click(r.env, d12, T12 + 70 * MIN, 'w22-ledger-r3-cross-hour');
    const other = decision(r.env, 'v-tabby', T12 + 80 * MIN, 'cnt-tabby-evening');
    const same = click(r.env, other, T12 + 85 * MIN, 'w22-ledger-r3-same-hour');
    await throughTheLedger(r, [d12, d13, other], [cross, same]);

    // Run 1: hour 12's ledger THROWS on read (F17 P3b), hours 13 and 14 fold.
    r.storage.failGetFor = (key: string) => key.startsWith(`${TENANT}/${DATE}/12/`);
    const firstPass = await fold(r, T12 + 3 * HOUR_MS + 6 * MIN);
    expect(firstPass.failed, 'the fixture: hour 12 fails on the first pass').toContain(`${DATE} 12`);
    expect(firstPass.built, 'the fixture: hours 13 and 14 fold without it').toEqual(expect.arrayContaining([`${DATE} 13`, `${DATE} 14`]));

    // The shard states as a version-1 fold left them.
    expect(asVersionOne(r) > 0, 'the fixture: the fold stored shard states').toBe(true);
    const stored = JSON.parse(r.storage.objects.get(shardKey(TENANT, shardOf('v-rogue')))!) as ShardState;
    expect({ version: stored.version, pastTwelve: stored.through > T12 },
      'the fixture: v-rogue\'s shard is a version-1 state whose through mark is past hour 12').toEqual({ version: 1, pastTwelve: true });

    // Run 2: the hour is readable again and is repaired.
    r.storage.failGetFor = null;
    const repair = await fold(r, T12 + 3 * HOUR_MS + 7 * MIN);
    expect(repair.built, 'the fixture: the repair run folds hour 12').toContain(`${DATE} 12`);

    const twelve = JSON.parse(r.storage.objects.get(hourKey(TENANT, DATE, 12))!) as HourAggregate;
    expect.soft(twelve.ringsFolded,
      'W22.R3 (R143; F17 P3b) — hour 12, at or below a version-1 through mark but never folded, is not taken as folded: its decisions enter the rings, and its aggregate says so')
      .toBe(true);
    const answer = await operatorPost(r, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    expect(answer.status, `the report route answers: ${JSON.stringify(answer.body).slice(0, 300)}`).toBe(200);
    const day = (answer.body as { report: DayReport }).report;
    expect.soft(day.counts.decisions, 'the three decisions of the day').toBe(3);
    expect.soft(day.policies.find(row => row.role === 'learning')?.credits,
      'W22.R3 (R143; F17 P3b, §6 item 2) — both credits, each once: the 13:10 click credits the repaired 12:59 decision, and hour 13\'s own credit, folded under version 1, is not folded twice')
      .toBe(2);
  });
});

// ===========================================================================
// unit:W22.R4 — `seenDays` ids carry retention stamps, and FoldContext.now is
// removed or used (LANE-LOG R143).
//
// (a) A retention stamp is what lets an id leave when its retention ends, as
// `seenRetention` lets an id of the CURRENT date leave (`cleanupShard`). Today
// the stamps are dropped when a date is archived (`foldShard` deletes
// `seenRetention` on the roll-forward), so an archived id outlives its
// retention until the date itself is pruned by the horizon. BY HAND, with the
// tenant's `hourly` retention published at one day and both visitors on ONE
// shard (so a stamp per date, earliest or latest, cannot pass for a stamp per
// id):
//   2026-09-02 20:00  early visitor decides → hourly retention ends 2026-09-03 20:00
//   2026-09-02 23:30  late visitor decides  → ends 2026-09-03 23:30
//   2026-09-03 01:06  the fold rolls the shard forward: both are archived
//   2026-09-03 21:06  the next hourly run: the early visitor's retention has
//                     ended, the late visitor's has not
// → the archived membership of 2026-09-02 holds the late visitor only, and so
//   does that date's enrollment memory (W21's "keys are exactly the
//   membership's").
//
// (b) "removed or used": either the context `foldShard` receives no longer has
// a `now` member, or product source reads it. Measured with the TypeScript
// checker over the product graph `src/learn/hourly.ts` belongs to, so a read by
// destructuring counts and a write does not.
// ===========================================================================

const DAY1 = '2026-09-02', DAY2 = '2026-09-03';
const atUtc = (date: string, hour: number, minute = 0) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);

describe('unit:W22.R4', () => {
  it('logic: an archived date\'s visitor ids carry their retention — past its hourly retention an id leaves seenDays and that date\'s enrollment memory at the next hourly run, and an id inside its retention stays', async () => {
    const oneDay: RetentionPolicy = { id: 'w22-ledger-hourly-one-day', revision: 1, durationMs: DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
    const longer: RetentionPolicy = { id: 'w22-ledger-fixture-policy', revision: 1, durationMs: 3650 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
    const r2 = new UnitR2();
    const env = { DEPLOYMENT_PROFILE: 'demo', STORAGE: r2, TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
      RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category =>
        [category, category === 'hourly' ? oneDay : longer])) as Record<RetentionCategory, RetentionPolicy> } }) } as unknown as Env;
    const late = 'v-archived-late';
    const early = (() => {
      for (let n = 0; n < 512; n++) if (shardOf(`v-archived-early-${n}`) === shardOf(late)) return `v-archived-early-${n}`;
      throw new Error('no early visitor id shares the late visitor\'s shard');
    })();
    const key = shardKey(TENANT, shardOf(late));
    const rows = [decision(env, early, atUtc(DAY1, 20), 'cnt-tabby-evening'), decision(env, late, atUtc(DAY1, 23, 30), 'cnt-charms-slg')];
    const written = await writeBatches(r2 as never, rows.map(record => ({ kind: 'ledger' as const, type: 'decision' as const, record })) as never, 'w22-ledger-r4');
    expect(written.reduce((n, object) => n + object.count, 0), 'the fixture: both decisions are in the ledger').toBe(2);
    expect((rows[0] as DecisionRecord & { retention: { hourly: { expiresAt: number } } }).retention.hourly.expiresAt,
      'the fixture: the early visitor\'s hourly retention ends one day after her decision').toBe(atUtc(DAY2, 20));

    // The five-minute job, with `Date` pinned to each run (finishHour cleans up at Date.now()).
    const run = async (date: string, hour: number, now: number) => {
      vi.setSystemTime(now);
      await buildHour(r2 as never, TENANT, { date, hour }, W22_LEARN, now, {}, env);
    };
    vi.useFakeTimers({ toFake: ['Date'], now: atUtc(DAY1, 21, 6) });
    await run(DAY1, 20, atUtc(DAY1, 21, 6));
    await run(DAY1, 23, atUtc(DAY2, 0, 6));
    await run(DAY2, 0, atUtc(DAY2, 1, 6));
    const stateOf = () => JSON.parse(r2.objects.get(key)!) as ShardState;
    const archived = stateOf();
    expect({ seenDate: archived.seenDate, archived: [...(archived.seenDays?.[DAY1]?.[BRAND] ?? [])].sort() },
      'the fixture: the roll-forward archived both visitors under their date').toEqual({ seenDate: DAY2, archived: [early, late].sort() });

    await run(DAY2, 20, atUtc(DAY2, 21, 6));
    const after = stateOf();
    expect.soft(after.seenDays?.[DAY1]?.[BRAND],
      `W22.R4 (R143) — an archived id carries its retention stamp: the early visitor, whose hourly retention ended at ${new Date(atUtc(DAY2, 20)).toISOString()}, leaves the archived membership at the next hourly run, and the late visitor stays`)
      .toEqual([late]);
    expect.soft(Object.keys(after.enrollment?.[DAY1]?.[BRAND] ?? {}),
      'W22.R4 — and the date\'s enrollment memory keeps exactly the membership: the late visitor only')
      .toEqual([late]);
  });

  it('logic: FoldContext.now is either removed from the context foldShard receives, or read by product source', () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url));
    const file = `${root}src/learn/hourly.ts`;
    const parsed = ts.getParsedCommandLineOfConfigFile(`${root}tsconfig.json`, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => { throw new Error(String(diagnostic.messageText)); } });
    const program = ts.createProgram({ rootNames: [file], options: { ...parsed!.options, composite: false, incremental: false, noEmit: true } });
    const checker = program.getTypeChecker();
    let foldShardNode: ts.FunctionDeclaration | undefined;
    ts.forEachChild(program.getSourceFile(file)!, node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'foldShard') foldShardNode = node; });
    expect(foldShardNode?.parameters.length, 'foldShard(state, decisions, outcomes, context) is the fold').toBe(4);
    const now = checker.getTypeAtLocation(foldShardNode!.parameters[3]!).getProperty('now');
    if (!now) return;                      // removed: the criterion's first branch
    const declared = new Set(now.declarations ?? []);
    const reads: string[] = [];
    for (const source of program.getSourceFiles()) {
      if (!source.fileName.startsWith(`${root}src/`) || source.isDeclarationFile || /\.test\.tsx?$/.test(source.fileName)) continue;
      const visit = (node: ts.Node): void => {
        let target: ts.Symbol | undefined;
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'now') target = checker.getSymbolAtLocation(node.name);
        else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'now') target = checker.getSymbolAtLocation(node.argumentExpression);
        else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)
          && (node.propertyName && ts.isIdentifier(node.propertyName) ? node.propertyName.text : ts.isIdentifier(node.name) ? node.name.text : '') === 'now') {
          target = checker.getTypeAtLocation(node.parent).getProperty('now');
        }
        if (target && (target.declarations ?? []).some(declaration => declared.has(declaration))) {
          const parent = node.parent;
          const written = ts.isBinaryExpression(parent) && parent.left === node
            && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
          if (!written) reads.push(`${source.fileName.slice(root.length)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    const where = [...declared].map(declaration => `${declaration.getSourceFile().fileName.slice(root.length)}:${declaration.getSourceFile().getLineAndCharacterOfPosition(declaration.getStart()).line + 1}`);
    expect(reads.length > 0,
      `W22.R4 (R143) — FoldContext.now is declared (${where.join(', ')}) and set by buildHour, but no product source reads it: remove the member or use it`)
      .toBe(true);
  }, 60_000);
});

// ===========================================================================
// unit:W22.R5 — the designed collision is named in
// reconciliation.disagreements (LANE-LOG R145). The document half of the
// criterion is the reviewer's reading (header of this file).
//
// The designed collision, by hand (R143's admitted contract, measured in the
// whole-W22 review): two different records under one stable `outcome_id` —
// the same click, another `value`, W22.D1.04's own pair — are both credited
// online (online 2), while the ledger refuses the day, files the conflict,
// and then reads the day with the second row excluded and counted in
// `counts.conflicts` (ledger 1). The monitor's threshold is five per cent of
// the larger, rounded down — 0 at this scale — so the difference of 1 is a
// disagreement, and it must say it is the collision. The member that says so
// is not ruled here (no witness fixes its name): any member beyond the six a
// row already carries whose key or value names the conflict or the collision
// is accepted. A disagreement caused by a LOST ledger row (W22.R1.04's own
// mismatch) is the control: it must not be named a collision, or the name
// would tell an operator nothing.
// ===========================================================================

const ROW_MEMBERS = ['brand', 'slot', 'online', 'ledger', 'difference', 'threshold'];
function namesCollision(row: object | undefined): boolean {
  if (!row) return false;
  const beyond = Object.fromEntries(Object.entries(row).filter(([member]) => !ROW_MEMBERS.includes(member)));
  return /conflict|collision/i.test(JSON.stringify(beyond));
}

describe('unit:W22.R5', () => {
  it('host: the scheduled reconciliation names the designed collision on the disagreement it causes, and names none on a disagreement a lost ledger row causes', async () => {
    const heroRow = async (m: Mounted) => {
      const run = await operatorPost(m, `/v1/${TENANT}/monitor`);
      expect(run.status, `the monitor run answers: ${JSON.stringify(run.body).slice(0, 300)}`).toBe(200);
      const rows = (run.body as { result: MonitorResult }).result.reconciliation?.disagreements ?? [];
      return rows.find(row => row.brand === BRAND && row.slot === 'hero');
    };

    // ── the designed collision ─────────────────────────────────────────────
    const m = await mount();
    const d1 = decision(m.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening');
    const first = click(m.env, d1, ONLINE_TS + MIN, 'w22-ledger-r5-collision');
    const second = { ...first, value: 495 } as OutcomeRecord;
    await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: d1.visitor_id, records: [d1] }, slotConfig);
    await fanOutcome(m.env, TENANT, first, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());
    await fanOutcome(m.env, TENANT, second, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());
    await m.drain();
    await throughTheLedger(m, [d1], [first], Date.now());
    expect((await consumeLedger(m.env, [{ kind: 'ledger', type: 'outcome', version: 1, record: second }], Date.now())).ok,
      'the fixture writes the second record under the same id the way at-least-once delivery does').toBe(true);
    const refused = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: ONLINE_DATE, brand: BRAND });
    expect(refused.status, 'the fixture: the ledger refuses the day and files the collision (W22.D1.03)').toBe(409);
    const filed = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: ONLINE_DATE, brand: BRAND });
    expect(filed.status, `the fixture: once filed, the day reads (${JSON.stringify(filed.body).slice(0, 200)})`).toBe(200);
    expect((filed.body as { report: DayReport }).report.counts, 'the fixture: the second row is excluded and counted').toMatchObject({ conflicts: { decisions: 0, outcomes: 1 } });

    const collision = await heroRow(m);
    expect(collision && { online: collision.online, ledger: collision.ledger, difference: collision.difference },
      'the designed outcome is a disagreement: online two credits, ledger one (R145)').toEqual({ online: 2, ledger: 1, difference: 1 });
    expect.soft(namesCollision(collision),
      `W22.R5 (R145) — the reconciliation row the designed collision causes names the collision, so an operator reading it is not sent chasing a lost credit: ${JSON.stringify(collision)}`)
      .toBe(true);

    // ── the control: a lost ledger row ─────────────────────────────────────
    const lost = await mount();
    const d2 = decision(lost.env, 'v-tabby', ONLINE_TS, 'cnt-tabby-evening');
    const o2 = click(lost.env, d2, ONLINE_TS + MIN, 'w22-ledger-r5-lost');
    await fanDecisions(lost.env, { tenant: TENANT, brand: BRAND, visitor_id: d2.visitor_id, records: [d2] }, slotConfig);
    await fanOutcome(lost.env, TENANT, o2, DEFAULT_POLICY, BRAND, { hero: slotConfig() }, slotConfig());
    await lost.drain();
    await throughTheLedger(lost, [d2], [], Date.now());
    const day = await operatorPost(lost, `/v1/${TENANT}/learn/report`, { date: ONLINE_DATE, brand: BRAND });
    expect(day.status, 'the control day reads').toBe(200);
    const mismatch = await heroRow(lost);
    expect(mismatch && { online: mismatch.online, ledger: mismatch.ledger, difference: mismatch.difference },
      'the control: a credit the ledger lost is a disagreement of the same size (W22.R1.04)').toEqual({ online: 1, ledger: 0, difference: 1 });
    expect.soft(namesCollision(mismatch),
      'W22.R5 — and a disagreement no collision caused is not named one: the name is specific to the designed collision')
      .toBe(false);
  });
});
